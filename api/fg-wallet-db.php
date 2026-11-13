<?php
/**
 * Forest 统一钱包 DB — 50 万同时在线正确性优先
 *
 * 硬规则：
 * - 余额变更必须在单事务内：SELECT … FOR UPDATE → 校验 → INSERT ledger → UPDATE wallet
 * - (account_id, tx_id) 唯一幂等，重复请求不二次扣款
 * - STRICT 模式禁止客户端直接 POST 绝对 balance
 * - 空数组永不清空流水；禁止 DELETE 流水
 * - 驱动：MySQL（生产）；无 MySQL 时拒绝启动（不再用 SQLite 顶高并发）
 */
declare(strict_types=1);

function fg_wallet_env(string $key, ?string $default = null): ?string {
  static $env = null;
  if ($env === null) {
    $env = [];
    $paths = [
      '/www/wwwroot/forestgroup.ai/data/fg-wallet.env',
      dirname(__DIR__) . '/data/fg-wallet.env',
      dirname(__DIR__) . '/server/.env.fg-wallet',
    ];
    foreach ($paths as $p) {
      if (!is_file($p)) continue;
      foreach (file($p, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '#') continue;
        if (strpos($line, '=') === false) continue;
        [$k, $v] = explode('=', $line, 2);
        $env[trim($k)] = trim($v);
      }
      break;
    }
  }
  return array_key_exists($key, $env) ? $env[$key] : $default;
}

function fg_wallet_strict(): bool {
  return (fg_wallet_env('FG_WALLET_STRICT', '1') === '1');
}

function fg_wallet_pdo_reset(): void {
  /* 子进程 fork 后必须断开继承连接 */
  $GLOBALS['__fg_wallet_pdo'] = null;
}

function fg_wallet_pdo(): PDO {
  if (!empty($GLOBALS['__fg_wallet_pdo']) && $GLOBALS['__fg_wallet_pdo'] instanceof PDO) {
    return $GLOBALS['__fg_wallet_pdo'];
  }
  $pdo = null;

  $driver = strtolower((string)fg_wallet_env('FG_WALLET_DRIVER', 'mysql'));
  if ($driver !== 'mysql') {
    throw new RuntimeException('FG_WALLET_DRIVER must be mysql for 500k-scale');
  }

  $host = fg_wallet_env('FG_WALLET_MYSQL_HOST', '127.0.0.1');
  $port = fg_wallet_env('FG_WALLET_MYSQL_PORT', '3306');
  $db   = fg_wallet_env('FG_WALLET_MYSQL_DB', 'fg_wallet');
  $user = fg_wallet_env('FG_WALLET_MYSQL_USER', 'fg_wallet');
  $pass = fg_wallet_env('FG_WALLET_MYSQL_PASS', '');

  $dsn = "mysql:host={$host};port={$port};dbname={$db};charset=utf8mb4";
  $pdo = new PDO($dsn, $user, $pass, [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    PDO::ATTR_EMULATE_PREPARES => false,
    PDO::ATTR_PERSISTENT => false, /* 短连接 + 连接池（php-fpm/proxy）更稳；避免粘滞脏事务 */
  ]);
  $pdo->exec("SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci");
  $pdo->exec("SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED");
  $GLOBALS['__fg_wallet_pdo'] = $pdo;
  return $pdo;
}

function fg_sanitize_user(string $u): string {
  $u = strtolower(trim($u));
  $u = preg_replace('/[^a-z0-9._\-@]/', '', $u) ?? '';
  if ($u === '' || strlen($u) > 64) return '';
  return $u;
}

function fg_ensure_account(PDO $pdo, string $username, int $startBal = 2000): int {
  $st = $pdo->prepare('SELECT id FROM fg_account WHERE username = ? LIMIT 1');
  $st->execute([$username]);
  $id = $st->fetchColumn();
  if ($id) return (int)$id;

  try {
    $pdo->beginTransaction();
    $pdo->prepare('INSERT INTO fg_account (username) VALUES (?)')->execute([$username]);
    $id = (int)$pdo->lastInsertId();
    $pdo->prepare('INSERT INTO fg_wallet (account_id, balance, version) VALUES (?, ?, 0)')
      ->execute([$id, max(0, $startBal)]);
    $pdo->commit();
    return $id;
  } catch (PDOException $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    /* 并发建号：再读一次 */
    $st->execute([$username]);
    $id = $st->fetchColumn();
    if ($id) return (int)$id;
    throw $e;
  }
}

function fg_account_active(PDO $pdo, int $accountId): bool {
  $st = $pdo->prepare('SELECT status FROM fg_account WHERE id = ? LIMIT 1');
  $st->execute([$accountId]);
  return $st->fetchColumn() === 'active';
}

function fg_get_balance(PDO $pdo, int $accountId): int {
  $st = $pdo->prepare('SELECT balance FROM fg_wallet WHERE account_id = ? LIMIT 1');
  $st->execute([$accountId]);
  return max(0, (int)$st->fetchColumn());
}

/**
 * 核心：带行锁的幂等记账。任何余额变动只能走这里。
 * @return array{balance:int, inserted:bool, tx_id:string, version:int}
 */
function fg_ledger_append(
  PDO $pdo,
  int $accountId,
  string $txId,
  string $txType,
  int $amount,
  ?string $gameCode = null,
  ?string $clientCode = null,
  ?string $note = null,
  ?string $source = null,
  ?string $refBetId = null
): array {
  $txId = substr(trim($txId), 0, 48);
  if ($txId === '') throw new InvalidArgumentException('tx_id required');
  $allowed = ['recharge','debit','bet','payout','adjust','refund'];
  if (!in_array($txType, $allowed, true)) throw new InvalidArgumentException('bad tx_type');
  if ($amount === 0) throw new InvalidArgumentException('amount cannot be 0');

  $ownTx = !$pdo->inTransaction();
  if ($ownTx) $pdo->beginTransaction();

  try {
    if (!fg_account_active($pdo, $accountId)) {
      throw new RuntimeException('account not active');
    }

    /* 幂等：已存在直接返回（不加锁改余额） */
    $chk = $pdo->prepare('SELECT balance_after FROM fg_ledger WHERE account_id = ? AND tx_id = ? LIMIT 1');
    $chk->execute([$accountId, $txId]);
    $existAfter = $chk->fetchColumn();
    if ($existAfter !== false) {
      $ver = $pdo->prepare('SELECT version FROM fg_wallet WHERE account_id = ? LIMIT 1');
      $ver->execute([$accountId]);
      if ($ownTx) $pdo->commit();
      return [
        'balance' => (int)$existAfter,
        'inserted' => false,
        'tx_id' => $txId,
        'version' => (int)$ver->fetchColumn(),
      ];
    }

    /* 行锁：同一账号串行化，防超卖/负余额 */
    $st = $pdo->prepare('SELECT balance, version FROM fg_wallet WHERE account_id = ? FOR UPDATE');
    $st->execute([$accountId]);
    $row = $st->fetch();
    if (!$row) throw new RuntimeException('wallet missing');

    $bal = (int)$row['balance'];
    $ver = (int)$row['version'];
    $next = $bal + $amount;
    if ($next < 0) {
      throw new RuntimeException('insufficient balance');
    }

    $pdo->prepare(
      'INSERT INTO fg_ledger
        (account_id, tx_id, tx_type, amount, balance_after, game_code, client_code, ref_bet_id, note, source, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,\'ok\')'
    )->execute([
      $accountId,
      $txId,
      $txType,
      $amount,
      $next,
      $gameCode !== null ? substr($gameCode, 0, 32) : null,
      $clientCode !== null ? substr($clientCode, 0, 40) : null,
      $refBetId !== null ? substr($refBetId, 0, 48) : null,
      $note !== null ? substr($note, 0, 120) : null,
      $source !== null ? substr($source, 0, 32) : null,
    ]);

    /* 二次幂等表（防极端重放） */
    try {
      $pdo->prepare('INSERT INTO fg_tx_dedupe (account_id, tx_id) VALUES (?, ?)')->execute([$accountId, $txId]);
    } catch (PDOException $e) {
      /* 若 dedupe 冲突而 ledger 已插入，仍算成功；若 ledger 未插入则回滚 */
      throw new RuntimeException('duplicate tx');
    }

    $upd = $pdo->prepare(
      'UPDATE fg_wallet SET balance = ?, version = version + 1 WHERE account_id = ? AND version = ?'
    );
    $upd->execute([$next, $accountId, $ver]);
    if ($upd->rowCount() < 1) {
      /* 版本冲突（理论上 FOR UPDATE 下不应发生） */
      throw new RuntimeException('wallet version conflict');
    }

    if ($ownTx) $pdo->commit();
    return ['balance' => $next, 'inserted' => true, 'tx_id' => $txId, 'version' => $ver + 1];
  } catch (Throwable $e) {
    if ($ownTx && $pdo->inTransaction()) $pdo->rollBack();
    /* 唯一键冲突 → 当作幂等成功 */
    if ($e instanceof PDOException && (int)($e->errorInfo[1] ?? 0) === 1062) {
      $chk = $pdo->prepare('SELECT balance_after FROM fg_ledger WHERE account_id = ? AND tx_id = ? LIMIT 1');
      $chk->execute([$accountId, $txId]);
      $after = $chk->fetchColumn();
      if ($after !== false) {
        return [
          'balance' => (int)$after,
          'inserted' => false,
          'tx_id' => $txId,
          'version' => (int)fg_wallet_version($pdo, $accountId),
        ];
      }
    }
    throw $e;
  }
}

function fg_wallet_version(PDO $pdo, int $accountId): int {
  $st = $pdo->prepare('SELECT version FROM fg_wallet WHERE account_id = ? LIMIT 1');
  $st->execute([$accountId]);
  return (int)$st->fetchColumn();
}

/** STRICT 下禁止使用：绝对余额写入会引入竞态 */
function fg_set_balance_with_adjust(PDO $pdo, int $accountId, int $newBal, string $source = 'sync'): array {
  if (fg_wallet_strict()) {
    throw new RuntimeException('strict mode: absolute balance write forbidden; use ledgerAppend');
  }
  $newBal = max(0, $newBal);
  $pdo->beginTransaction();
  try {
    $st = $pdo->prepare('SELECT balance, version FROM fg_wallet WHERE account_id = ? FOR UPDATE');
    $st->execute([$accountId]);
    $row = $st->fetch();
    $cur = (int)$row['balance'];
    $delta = $newBal - $cur;
    if ($delta === 0) {
      $pdo->commit();
      return ['balance' => $cur, 'inserted' => false, 'tx_id' => '', 'version' => (int)$row['version']];
    }
    $txId = 'adj-' . (int)round(microtime(true) * 1000) . '-' . bin2hex(random_bytes(4));
    $type = $delta > 0 ? 'adjust' : 'debit';
    $res = fg_ledger_append($pdo, $accountId, $txId, $type, $delta, null, null, 'balance sync', $source);
    $pdo->commit();
    return $res;
  } catch (Throwable $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    throw $e;
  }
}

function fg_list_ledger(PDO $pdo, int $accountId, int $limit = 200): array {
  $limit = max(1, min(500, $limit));
  $st = $pdo->prepare(
    "SELECT * FROM fg_ledger WHERE account_id = ? AND status = 'ok' ORDER BY id DESC LIMIT {$limit}"
  );
  $st->execute([$accountId]);
  return $st->fetchAll();
}

function fg_upsert_bet(PDO $pdo, int $accountId, array $row): void {
  $betId = substr(trim((string)($row['betId'] ?? $row['bet_id'] ?? '')), 0, 48);
  if ($betId === '') return;
  $fields = [
    'game_code' => substr((string)($row['game_code'] ?? $row['gameCode'] ?? 'unknown'), 0, 32),
    'client_code' => substr((string)($row['client_code'] ?? $row['clientCode'] ?? $row['source'] ?? ''), 0, 40) ?: null,
    'table_code' => isset($row['tableId']) || isset($row['table_code']) ? substr((string)($row['tableId'] ?? $row['table_code']), 0, 32) : null,
    'round_id' => isset($row['roundId']) || isset($row['round_id']) ? substr((string)($row['roundId'] ?? $row['round_id']), 0, 64) : null,
    'market' => isset($row['market']) ? substr((string)$row['market'], 0, 64) : null,
    'stake' => max(0, (int)round((float)($row['stake'] ?? 0))),
    'payout' => (int)round((float)($row['payout'] ?? 0)),
    'pnl' => (int)round((float)($row['pnl'] ?? 0)),
    'status' => substr((string)($row['status'] ?? 'open'), 0, 16),
    'payload_json' => json_encode($row, JSON_UNESCAPED_UNICODE),
  ];
  $pdo->prepare(
    'INSERT INTO fg_bet
      (bet_id, account_id, game_code, client_code, table_code, round_id, market, stake, payout, pnl, status, payload_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE
      game_code=VALUES(game_code), client_code=VALUES(client_code), table_code=VALUES(table_code),
      round_id=VALUES(round_id), market=VALUES(market), stake=VALUES(stake), payout=VALUES(payout),
      pnl=VALUES(pnl), status=VALUES(status), payload_json=VALUES(payload_json)'
  )->execute([
    $betId, $accountId, $fields['game_code'], $fields['client_code'], $fields['table_code'],
    $fields['round_id'], $fields['market'], $fields['stake'], $fields['payout'], $fields['pnl'],
    $fields['status'], $fields['payload_json'],
  ]);
}

function fg_list_bets(PDO $pdo, int $accountId, int $limit = 200): array {
  $limit = max(1, min(500, $limit));
  $st = $pdo->prepare("SELECT * FROM fg_bet WHERE account_id = ? ORDER BY id DESC LIMIT {$limit}");
  $st->execute([$accountId]);
  return $st->fetchAll();
}
