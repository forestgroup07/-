<?php
/**
 * 正确性冒烟：同账号并发扣款不超卖 + 同 tx_id 幂等不双花
 * php scripts/fg-wallet-concurrency-smoke.php
 */
declare(strict_types=1);
$root = dirname(__DIR__);
require_once $root . '/api/fg-wallet-db.php';

$user = 'scale_smoke_' . getmypid();
$pdo = fg_wallet_pdo();
$aid = fg_ensure_account($pdo, $user, 1000);

/* 重置 */
$pdo->prepare('UPDATE fg_wallet SET balance = 1000, version = 0 WHERE account_id = ?')->execute([$aid]);

$children = 20;
$per = 100; /* 每人尝试扣 100，共 20 人 → 最多成功 10 笔 */
$okFile = sys_get_temp_dir() . '/fg_smoke_ok_' . getmypid();
@unlink($okFile);

for ($i = 0; $i < $children; $i++) {
  $pid = pcntl_fork();
  if ($pid === -1) throw new RuntimeException('fork failed');
  if ($pid === 0) {
    fg_wallet_pdo_reset();
    $pdo = fg_wallet_pdo(); /* 子进程新连接 */
    $aid = fg_ensure_account($pdo, $user, 0);
    $tx = 'smoke-bet-' . $i . '-' . getmypid();
    try {
      fg_ledger_append($pdo, $aid, $tx, 'bet', -$per, 'sicbo', 'sicbo_pc', 'smoke', 'smoke');
      file_put_contents($okFile, '1', FILE_APPEND | LOCK_EX);
    } catch (Throwable $e) {
      /* insufficient expected */
    }
    exit(0);
  }
}
while (pcntl_wait($status) > 0) {}

$success = is_file($okFile) ? strlen((string)file_get_contents($okFile)) : 0;
$bal = fg_get_balance($pdo, $aid);
$ledgerCnt = (int)$pdo->query("SELECT COUNT(*) FROM fg_ledger WHERE account_id = {$aid} AND tx_type='bet'")->fetchColumn();

/* 幂等：同一 tx 打两次 */
$tx = 'idem-' . getmypid();
$r1 = fg_ledger_append($pdo, $aid, $tx, 'recharge', 50, null, null, 'idem', 'smoke');
$r2 = fg_ledger_append($pdo, $aid, $tx, 'recharge', 50, null, null, 'idem', 'smoke');
$bal2 = fg_get_balance($pdo, $aid);

$pass = ($success === 10 && $bal === 0 && $ledgerCnt === 10 && $r1['inserted'] === true && $r2['inserted'] === false && $bal2 === 50);

echo json_encode([
  'ok' => $pass,
  'concurrent_success' => $success,
  'balance_after_race' => $bal,
  'bet_ledger_rows' => $ledgerCnt,
  'idempotent_second_insert' => $r2['inserted'],
  'balance_after_idem' => $bal2,
  'expect' => 'success=10 bal=0 then after idem bal=50',
], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), "\n";
exit($pass ? 0 : 1);
