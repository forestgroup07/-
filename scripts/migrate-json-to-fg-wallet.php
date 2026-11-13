<?php
/**
 * 把 data/sicbo-accounts/*.json 迁入 MySQL fg_wallet（只追加，不删 JSON）。
 * php scripts/migrate-json-to-fg-wallet.php
 */
declare(strict_types=1);

$root = dirname(__DIR__);
require_once $root . '/api/fg-wallet-db.php';

$jsonDir = '/www/wwwroot/forestgroup.ai/data/sicbo-accounts';
if (!is_dir($jsonDir)) $jsonDir = $root . '/data/sicbo-accounts';

$pdo = fg_wallet_pdo();
$files = glob(rtrim($jsonDir, '/') . '/*.json') ?: [];
$stats = ['files' => 0, 'accounts' => 0, 'ledger' => 0, 'bets' => 0, 'skipped_dup' => 0];

foreach ($files as $path) {
  if (substr($path, -9) === '.json.tmp') continue;
  $stats['files']++;
  $j = json_decode((string)file_get_contents($path), true);
  if (!is_array($j)) continue;
  $user = fg_sanitize_user((string)($j['user'] ?? basename($path, '.json')));
  if ($user === '') continue;

  /* 先建号，起始余额 0，再用 JSON balance 校准一次（仅迁移脚本） */
  $aid = fg_ensure_account($pdo, $user, 0);
  $stats['accounts']++;

  if (!empty($j['creditlog']) && is_array($j['creditlog'])) {
    /* 按时间正序重放，重建余额更接近真实 */
    $rows = $j['creditlog'];
    usort($rows, function ($a, $b) {
      return ((int)($a['ts'] ?? 0)) <=> ((int)($b['ts'] ?? 0));
    });
    foreach ($rows as $e) {
      if (!is_array($e)) continue;
      $txId = substr((string)($e['id'] ?? ''), 0, 48);
      if ($txId === '') continue;
      $amount = (int)round((float)($e['amount'] ?? 0));
      if ($amount === 0) continue;
      $type = (string)($e['type'] ?? 'adjust');
      $allowed = ['recharge','debit','bet','payout','adjust','refund'];
      if (!in_array($type, $allowed, true)) $type = 'adjust';
      try {
        $r = fg_ledger_append(
          $pdo, $aid, $txId, $type, $amount, null,
          isset($e['source']) ? (string)$e['source'] : null,
          isset($e['note']) ? (string)$e['note'] : null,
          isset($e['source']) ? (string)$e['source'] : null
        );
        if ($r['inserted']) $stats['ledger']++;
        else $stats['skipped_dup']++;
      } catch (Throwable $ex) {
        /* 余额不足等历史脏数据：强制 insert ledger 并 set balance（仅迁移） */
        if ($ex->getMessage() === 'insufficient balance') {
          $pdo->beginTransaction();
          try {
            $st = $pdo->prepare('SELECT balance, version FROM fg_wallet WHERE account_id = ? FOR UPDATE');
            $st->execute([$aid]);
            $row = $st->fetch();
            $next = max(0, (int)$row['balance'] + $amount);
            $pdo->prepare(
              'INSERT IGNORE INTO fg_ledger (account_id, tx_id, tx_type, amount, balance_after, note, source, status)
               VALUES (?,?,?,?,?,?,?,\'ok\')'
            )->execute([$aid, $txId, $type, $amount, $next, $e['note'] ?? null, $e['source'] ?? null]);
            $pdo->prepare('UPDATE fg_wallet SET balance = ?, version = version + 1 WHERE account_id = ?')
              ->execute([$next, $aid]);
            $pdo->commit();
            $stats['ledger']++;
          } catch (Throwable $e2) {
            if ($pdo->inTransaction()) $pdo->rollBack();
          }
        }
      }
    }
  }

  /* 最终对齐 JSON 余额（迁移专用，不走对外 API） */
  if (isset($j['balance'])) {
    $target = max(0, (int)round((float)$j['balance']));
    $pdo->prepare('UPDATE fg_wallet SET balance = ? WHERE account_id = ?')->execute([$target, $aid]);
  }

  if (!empty($j['betlog']) && is_array($j['betlog'])) {
    foreach ($j['betlog'] as $e) {
      if (!is_array($e)) continue;
      fg_upsert_bet($pdo, $aid, $e);
      $stats['bets']++;
    }
  }
}

echo json_encode(['ok' => true, 'stats' => $stats, 'engine' => 'mysql'], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), "\n";
