<?php
/**
 * 百家乐桌台级路单（系统共用，非个人账户）
 * GET  ?table=B601
 * POST JSON {
 *   table: 'B601',
 *   action: 'append' | 'hydrate_ok',
 *   item?: { roundId, outcome, lucky6, p, b, player?, banker?, ts? },
 *   items?: [ ... ]   // 批量按 roundId 合并
 * }
 *
 * 硬规则：只追加/按 roundId 合并；空列表不得清空已有路单。
 */
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
  http_response_code(204);
  exit;
}

function bad($code, $msg) {
  http_response_code($code);
  echo json_encode(['ok' => false, 'error' => $msg], JSON_UNESCAPED_UNICODE);
  exit;
}

function data_dir() {
  $dir = '/www/wwwroot/forestgroup.ai/data/baccarat-tables';
  if (!is_dir($dir)) {
    if (!mkdir($dir, 0755, true) && !is_dir($dir)) {
      bad(500, 'cannot create data dir');
    }
  }
  return $dir;
}

function sanitize_table($t) {
  $t = strtoupper(trim((string)$t));
  $t = preg_replace('/[^A-Z0-9_\-]/', '', $t);
  if ($t === '' || strlen($t) > 16) return '';
  return $t;
}

function table_path($table) {
  return data_dir() . '/' . $table . '.json';
}

function default_doc($table) {
  return [
    'tableId' => $table,
    'shoeId' => 'shoe_' . (string)round(microtime(true) * 1000),
    'results' => [],
    'updatedAt' => 0,
  ];
}

function load_doc($table) {
  $path = table_path($table);
  if (!is_file($path)) return default_doc($table);
  $raw = file_get_contents($path);
  if ($raw === false || $raw === '') return default_doc($table);
  $j = json_decode($raw, true);
  if (!is_array($j)) return default_doc($table);
  if (!isset($j['results']) || !is_array($j['results'])) $j['results'] = [];
  if (empty($j['tableId'])) $j['tableId'] = $table;
  if (empty($j['shoeId'])) $j['shoeId'] = 'shoe_' . (string)round(microtime(true) * 1000);
  $j['updatedAt'] = (int)($j['updatedAt'] ?? 0);
  return $j;
}

function save_doc($table, &$doc) {
  $path = table_path($table);
  $doc['updatedAt'] = (int)round(microtime(true) * 1000);
  $json = json_encode($doc, JSON_UNESCAPED_UNICODE);
  if ($json === false) bad(500, 'encode failed');
  $tmp = $path . '.tmp.' . getmypid();
  if (file_put_contents($tmp, $json, LOCK_EX) === false) bad(500, 'write failed');
  if (!rename($tmp, $path)) {
    @unlink($tmp);
    bad(500, 'rename failed');
  }
}

function normalize_item($e) {
  if (!is_array($e)) return null;
  $outcome = trim((string)($e['outcome'] ?? ''));
  if ($outcome !== 'banker' && $outcome !== 'player' && $outcome !== 'tie') return null;
  $roundId = trim((string)($e['roundId'] ?? $e['id'] ?? ''));
  $ts = (int)($e['ts'] ?? 0);
  if ($ts <= 0) $ts = (int)round(microtime(true) * 1000);
  if ($roundId === '') $roundId = 'r' . $ts . sprintf('%02d', random_int(10, 99));
  $item = [
    'roundId' => substr($roundId, 0, 48),
    'ts' => $ts,
    'outcome' => $outcome,
    'lucky6' => !empty($e['lucky6']),
    'p' => max(0, min(9, (int)($e['p'] ?? 0))),
    'b' => max(0, min(9, (int)($e['b'] ?? 0))),
  ];
  if (isset($e['player']) && is_array($e['player'])) {
    $item['player'] = array_slice($e['player'], 0, 3);
  }
  if (isset($e['banker']) && is_array($e['banker'])) {
    $item['banker'] = array_slice($e['banker'], 0, 3);
  }
  return $item;
}

function merge_results($existing, $incoming) {
  $map = [];
  foreach ($existing as $r) {
    if (!is_array($r)) continue;
    $id = trim((string)($r['roundId'] ?? $r['id'] ?? ''));
    if ($id === '') continue;
    $map[$id] = $r;
  }
  foreach ($incoming as $r) {
    $n = normalize_item($r);
    if (!$n) continue;
    $id = $n['roundId'];
    $prev = $map[$id] ?? null;
    if (!$prev || ((int)($n['ts'] ?? 0) >= (int)($prev['ts'] ?? 0))) {
      $map[$id] = $n;
    }
  }
  $out = array_values($map);
  usort($out, function ($a, $b) {
    return ((int)($a['ts'] ?? 0)) - ((int)($b['ts'] ?? 0));
  });
  /* 珠盘约 8×6=48，保留最近足够长，避免文件膨胀 */
  if (count($out) > 120) $out = array_slice($out, -120);
  return $out;
}

$table = sanitize_table($_GET['table'] ?? '');
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
  if ($table === '') {
    $table = sanitize_table($_GET['tableId'] ?? 'B601');
  }
  if ($table === '') bad(400, 'bad table');
  $doc = load_doc($table);
  echo json_encode(['ok' => true, 'data' => $doc], JSON_UNESCAPED_UNICODE);
  exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') bad(405, 'method');

$raw = file_get_contents('php://input');
$j = json_decode($raw ?: '{}', true);
if (!is_array($j)) bad(400, 'bad json');

$table = sanitize_table($j['table'] ?? $j['tableId'] ?? '');
if ($table === '') $table = 'B601';
$action = trim((string)($j['action'] ?? 'append'));

$doc = load_doc($table);
$existing = is_array($doc['results']) ? $doc['results'] : [];

if ($action === 'clearShoe') {
  /* 仅桌台明示换靴才清空；禁止用空数组误清 */
  $doc['results'] = [];
  $doc['shoeId'] = 'shoe_' . (string)round(microtime(true) * 1000);
  save_doc($table, $doc);
  echo json_encode(['ok' => true, 'data' => $doc], JSON_UNESCAPED_UNICODE);
  exit;
}

$incoming = [];
if (isset($j['item']) && is_array($j['item'])) $incoming[] = $j['item'];
if (isset($j['items']) && is_array($j['items'])) {
  foreach ($j['items'] as $it) $incoming[] = $it;
}
if (!$incoming && $action === 'append') bad(400, 'no item');

/* 空 incoming 且非 append：直接回读，绝不清空 */
if (!$incoming) {
  echo json_encode(['ok' => true, 'data' => $doc], JSON_UNESCAPED_UNICODE);
  exit;
}

$doc['results'] = merge_results($existing, $incoming);
save_doc($table, $doc);
echo json_encode(['ok' => true, 'data' => $doc], JSON_UNESCAPED_UNICODE);
exit;
