<?php
/**
 * 统一钱包 HTTP API（50 万并发正确性模式）
 * GET  ?user=
 * POST {
 *   user,
 *   ledgerAppend|creditAppend: { id|tx_id, type, amount, ... },  // 唯一写钱入口
 *   betAppend: { betId, stake, ... },
 *   balance:  <STRICT 下拒绝>
 *   creditlog:[], betlog:[]  <忽略，永不删流水>
 * }
 */
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
  http_response_code(204);
  exit;
}

require_once __DIR__ . '/fg-wallet-db.php';

function fg_api_bad(int $code, string $msg): void {
  http_response_code($code);
  echo json_encode(['ok' => false, 'error' => $msg], JSON_UNESCAPED_UNICODE);
  exit;
}

function fg_api_doc(PDO $pdo, int $accountId, string $user): array {
  $bal = fg_get_balance($pdo, $accountId);
  $ledger = fg_list_ledger($pdo, $accountId, 200);
  $bets = fg_list_bets($pdo, $accountId, 200);
  $creditlog = [];
  foreach ($ledger as $e) {
    /* 额度时间：优先 MySQL UNIX_TIMESTAMP；勿用 PRC strtotime(created_at)（会少 8 小时） */
    $ts = 0;
    if (isset($e['created_unix']) && $e['created_unix'] !== null && $e['created_unix'] !== '') {
      $ts = (int)round(((float)$e['created_unix']) * 1000);
    } elseif (!empty($e['created_at'])) {
      try {
        $raw = preg_replace('/\.\d+$/', '', (string)$e['created_at']);
        $dt = new DateTimeImmutable($raw ?: 'now', new DateTimeZone('UTC'));
        $ts = ((int)$dt->getTimestamp()) * 1000;
      } catch (Throwable $ex) {
        $ts = 0;
      }
    }
    $creditlog[] = [
      'id' => $e['tx_id'],
      'ts' => $ts,
      'type' => $e['tx_type'],
      'amount' => (int)$e['amount'],
      'balance' => (int)$e['balance_after'],
      'note' => $e['note'] ?? '',
      'source' => $e['source'] ?? '',
      'status' => $e['status'] ?? 'ok',
      'game_code' => $e['game_code'] ?? '',
      'client_code' => $e['client_code'] ?? '',
    ];
  }
  $betlog = [];
  foreach ($bets as $b) {
    $payload = [];
    if (!empty($b['payload_json'])) {
      $decoded = json_decode((string)$b['payload_json'], true);
      if (is_array($decoded)) $payload = $decoded;
    }
    $betlog[] = array_merge($payload, [
      'betId' => $b['bet_id'],
      'stake' => (int)$b['stake'],
      'pnl' => (int)$b['pnl'],
      'status' => $b['status'],
      'market' => $b['market'],
      'tableId' => $b['table_code'],
      'roundId' => $b['round_id'],
      'game_code' => $b['game_code'],
      'source' => $b['client_code'],
    ]);
  }
  return [
    'user' => $user,
    'balance' => $bal,
    'version' => fg_wallet_version($pdo, $accountId),
    'creditlog' => $creditlog,
    'betlog' => $betlog,
    'updatedAt' => (int)round(microtime(true) * 1000),
    'walletEngine' => 'fg_wallet_mysql_v2',
    'strict' => fg_wallet_strict(),
  ];
}

try {
  $pdo = fg_wallet_pdo();
} catch (Throwable $e) {
  fg_api_bad(500, 'db init failed');
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
  $user = fg_sanitize_user((string)($_GET['user'] ?? ''));
  if ($user === '') fg_api_bad(400, 'user required');
  try {
    $aid = fg_ensure_account($pdo, $user);
    /* lean=1：大厅顶栏只要余额，不拉整包流水（手机打开更快、数字能及时刷新） */
    $lean = isset($_GET['lean']) && (string)$_GET['lean'] !== '' && (string)$_GET['lean'] !== '0';
    if ($lean) {
      $bal = fg_get_balance($pdo, $aid);
      echo json_encode([
        'ok' => true,
        'data' => [
          'user' => $user,
          'balance' => $bal,
          'version' => fg_wallet_version($pdo, $aid),
          'updatedAt' => (int)round(microtime(true) * 1000),
        ],
      ], JSON_UNESCAPED_UNICODE);
    } else {
      echo json_encode(['ok' => true, 'data' => fg_api_doc($pdo, $aid, $user)], JSON_UNESCAPED_UNICODE);
    }
  } catch (Throwable $e) {
    fg_api_bad(500, 'read failed');
  }
  exit;
}

if ($method === 'POST') {
  $body = file_get_contents('php://input');
  $j = json_decode($body ?: '{}', true);
  if (!is_array($j)) fg_api_bad(400, 'invalid json');
  $user = fg_sanitize_user((string)($j['user'] ?? ($_GET['user'] ?? '')));
  if ($user === '') fg_api_bad(400, 'user required');

  try {
    $aid = fg_ensure_account($pdo, $user);

    /* 空数组：忽略（永不清空） */
    if (array_key_exists('creditlog', $j) && is_array($j['creditlog']) && count($j['creditlog']) === 0) {
      /* ignore wipe */
    }
    if (array_key_exists('betlog', $j) && is_array($j['betlog']) && count($j['betlog']) === 0) {
      /* ignore wipe */
    }

    $appendRaw = $j['ledgerAppend'] ?? $j['creditAppend'] ?? null;
    if ($appendRaw !== null) {
      $list = is_array($appendRaw) && array_keys($appendRaw) !== range(0, count($appendRaw) - 1)
        ? [$appendRaw] : (is_array($appendRaw) ? $appendRaw : []);
      foreach ($list as $e) {
        if (!is_array($e)) continue;
        $txId = (string)($e['tx_id'] ?? $e['id'] ?? '');
        if ($txId === '') $txId = (string)((int)round(microtime(true) * 1000)) . bin2hex(random_bytes(3));
        $type = (string)($e['type'] ?? $e['tx_type'] ?? 'adjust');
        $amount = (int)round((float)($e['amount'] ?? 0));
        if ($amount === 0) continue;
        fg_ledger_append(
          $pdo, $aid, $txId, $type, $amount,
          isset($e['game_code']) ? (string)$e['game_code'] : (isset($e['gameCode']) ? (string)$e['gameCode'] : null),
          isset($e['client_code']) ? (string)$e['client_code'] : (isset($e['source']) ? (string)$e['source'] : null),
          isset($e['note']) ? (string)$e['note'] : null,
          isset($e['source']) ? (string)$e['source'] : null,
          isset($e['ref_bet_id']) ? (string)$e['ref_bet_id'] : (isset($e['betId']) ? (string)$e['betId'] : null)
        );
      }
    }

    if (array_key_exists('betAppend', $j)) {
      $raw = $j['betAppend'];
      $list = is_array($raw) && array_keys($raw) !== range(0, count($raw) - 1) ? [$raw] : (is_array($raw) ? $raw : []);
      foreach ($list as $e) {
        if (is_array($e)) fg_upsert_bet($pdo, $aid, $e);
      }
    }

    /* 非空 creditlog：只追加缺失 tx，绝不删已有 */
    if (array_key_exists('creditlog', $j) && is_array($j['creditlog']) && count($j['creditlog']) > 0) {
      foreach ($j['creditlog'] as $e) {
        if (!is_array($e)) continue;
        $txId = (string)($e['id'] ?? $e['tx_id'] ?? '');
        if ($txId === '') continue;
        $chk = $pdo->prepare('SELECT 1 FROM fg_ledger WHERE account_id = ? AND tx_id = ? LIMIT 1');
        $chk->execute([$aid, $txId]);
        if ($chk->fetchColumn()) continue;
        $amount = (int)round((float)($e['amount'] ?? 0));
        if ($amount === 0) continue;
        $type = (string)($e['type'] ?? 'adjust');
        try {
          fg_ledger_append(
            $pdo, $aid, $txId, $type, $amount, null,
            isset($e['source']) ? (string)$e['source'] : null,
            isset($e['note']) ? (string)$e['note'] : null,
            isset($e['source']) ? (string)$e['source'] : null
          );
        } catch (Throwable $ex) {
          /* skip bad historical row */
        }
      }
    }

    if (array_key_exists('betlog', $j) && is_array($j['betlog']) && count($j['betlog']) > 0) {
      foreach ($j['betlog'] as $e) {
        if (is_array($e)) fg_upsert_bet($pdo, $aid, $e);
      }
    }

    /* 绝对 balance 字段一律不改钱包；钱只走 creditAppend / ledgerAppend */

    echo json_encode(['ok' => true, 'data' => fg_api_doc($pdo, $aid, $user)], JSON_UNESCAPED_UNICODE);
  } catch (Throwable $e) {
    $msg = $e->getMessage();
    if ($msg === 'insufficient balance') fg_api_bad(409, 'insufficient balance');
    if ($msg === 'account not active') fg_api_bad(403, 'account not active');
    fg_api_bad(500, 'write failed');
  }
  exit;
}

fg_api_bad(405, 'method not allowed');
