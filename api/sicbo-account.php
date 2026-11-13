<?php
/**
 * Demo account persistence (balance / betlog / creditlog / roadhist / openbets).
 * GET  ?user=asdg
 * POST JSON { user, balance?, betlog?, betAppend?, creditlog?, creditAppend?, roadhist?, openbets? }
 *
 * 硬规则（用户 2026-11-13）：流水只追加/按 id 合并；空数组永不清空已有记录；
 * 未经用户书面「删除某某流水」禁止删除。
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

function sanitize_user($u) {
  $u = strtolower(trim((string)$u));
  $u = preg_replace('/[^a-z0-9._\-@]/', '', $u);
  if ($u === '' || strlen($u) > 64) return '';
  return $u;
}

function data_dir() {
  $dir = '/www/wwwroot/forestgroup.ai/data/sicbo-accounts';
  if (!is_dir($dir)) {
    if (!mkdir($dir, 0755, true) && !is_dir($dir)) {
      bad(500, 'cannot create data dir');
    }
  }
  return $dir;
}

function user_path($user) {
  return data_dir() . '/' . $user . '.json';
}

function default_doc($user) {
  return [
    'user' => $user,
    'balance' => 2000,
    'betlog' => [],
    'creditlog' => [],
    'roadhist' => [],
    'openbets' => null,
    'updatedAt' => 0,
  ];
}

function normalize_credit_entry($e) {
  if (!is_array($e)) return null;
  $amount = (int)round((float)($e['amount'] ?? 0));
  if ($amount === 0 && empty($e['type'])) return null;
  $ts = (int)($e['ts'] ?? 0);
  if ($ts <= 0) $ts = (int)round(microtime(true) * 1000);
  $id = trim((string)($e['id'] ?? ''));
  if ($id === '') $id = (string)$ts . sprintf('%02d', random_int(10, 99));
  return [
    'id' => substr($id, 0, 48),
    'ts' => $ts,
    'type' => substr(trim((string)($e['type'] ?? 'adjust')), 0, 32),
    'amount' => $amount,
    'balance' => max(0, (int)round((float)($e['balance'] ?? 0))),
    'note' => substr(trim((string)($e['note'] ?? '')), 0, 120),
    'source' => substr(trim((string)($e['source'] ?? '')), 0, 32),
    'status' => substr(trim((string)($e['status'] ?? 'ok')), 0, 16),
  ];
}

function normalize_bet_entry($e) {
  if (!is_array($e)) return null;
  $stake = (int)round((float)($e['stake'] ?? 0));
  $ts = (int)($e['ts'] ?? 0);
  if ($ts <= 0) $ts = (int)round(microtime(true) * 1000);
  $betId = trim((string)($e['betId'] ?? $e['id'] ?? ''));
  if ($betId === '') $betId = (string)$ts . sprintf('%02d', random_int(10, 99));
  $row = $e;
  $row['betId'] = substr($betId, 0, 48);
  $row['ts'] = $ts;
  $row['stake'] = max(0, $stake);
  if (!isset($row['status'])) $row['status'] = 'open';
  return $row;
}

function as_entry_list($raw) {
  if ($raw === null) return [];
  if (is_array($raw) && array_keys($raw) !== range(0, count($raw) - 1)) {
    return [$raw];
  }
  if (is_array($raw)) return $raw;
  return [];
}

/** 按 id 合并：空入站永不清空已有；入站覆盖同 id；保留其余旧行 */
function merge_log_union(&$doc, $field, $incoming, $idKey, $normalizeFn) {
  if (!is_array($incoming)) return;
  if (!isset($doc[$field]) || !is_array($doc[$field])) $doc[$field] = [];
  if (count($incoming) === 0) {
    /* 硬规则：空数组禁止清空 */
    return;
  }
  $map = [];
  foreach ($doc[$field] as $e) {
    if (!is_array($e)) continue;
    $id = isset($e[$idKey]) ? (string)$e[$idKey] : '';
    if ($id === '' && isset($e['id'])) $id = (string)$e['id'];
    if ($id === '') continue;
    $map[$id] = $e;
  }
  foreach ($incoming as $e) {
    $row = $normalizeFn ? $normalizeFn($e) : (is_array($e) ? $e : null);
    if (!$row) continue;
    $id = isset($row[$idKey]) ? (string)$row[$idKey] : '';
    if ($id === '' && isset($row['id'])) $id = (string)$row['id'];
    if ($id === '') continue;
    $map[$id] = $row;
  }
  $merged = array_values($map);
  usort($merged, function ($a, $b) {
    return ((int)($b['ts'] ?? 0)) <=> ((int)($a['ts'] ?? 0));
  });
  $doc[$field] = array_slice($merged, 0, 2000);
}

function merge_credit_append(&$doc, $raw) {
  $list = as_entry_list($raw);
  if (!$list) return;
  if (!isset($doc['creditlog']) || !is_array($doc['creditlog'])) $doc['creditlog'] = [];
  $seen = [];
  foreach ($doc['creditlog'] as $e) {
    if (is_array($e) && isset($e['id'])) $seen[(string)$e['id']] = true;
  }
  for ($i = count($list) - 1; $i >= 0; $i--) {
    $row = normalize_credit_entry($list[$i]);
    if (!$row) continue;
    $id = (string)$row['id'];
    if (isset($seen[$id])) {
      /* 同 id：用新行替换 */
      foreach ($doc['creditlog'] as $idx => $old) {
        if (is_array($old) && (string)($old['id'] ?? '') === $id) {
          $doc['creditlog'][$idx] = $row;
          break;
        }
      }
      continue;
    }
    $seen[$id] = true;
    array_unshift($doc['creditlog'], $row);
  }
  $doc['creditlog'] = array_slice($doc['creditlog'], 0, 2000);
}

function merge_bet_append(&$doc, $raw) {
  $list = as_entry_list($raw);
  if (!$list) return;
  if (!isset($doc['betlog']) || !is_array($doc['betlog'])) $doc['betlog'] = [];
  $seen = [];
  foreach ($doc['betlog'] as $e) {
    if (!is_array($e)) continue;
    $id = (string)($e['betId'] ?? $e['id'] ?? '');
    if ($id !== '') $seen[$id] = true;
  }
  for ($i = count($list) - 1; $i >= 0; $i--) {
    $row = normalize_bet_entry($list[$i]);
    if (!$row) continue;
    $id = (string)$row['betId'];
    if (isset($seen[$id])) {
      foreach ($doc['betlog'] as $idx => $old) {
        $oid = is_array($old) ? (string)($old['betId'] ?? $old['id'] ?? '') : '';
        if ($oid === $id) {
          $doc['betlog'][$idx] = $row;
          break;
        }
      }
      continue;
    }
    $seen[$id] = true;
    array_unshift($doc['betlog'], $row);
  }
  $doc['betlog'] = array_slice($doc['betlog'], 0, 2000);
}

function load_doc($user) {
  $path = user_path($user);
  if (!is_file($path)) return default_doc($user);
  $raw = file_get_contents($path);
  $j = json_decode($raw, true);
  if (!is_array($j)) return default_doc($user);
  $doc = default_doc($user);
  if (isset($j['balance'])) $doc['balance'] = max(0, (int)round((float)$j['balance']));
  if (isset($j['betlog']) && is_array($j['betlog'])) $doc['betlog'] = array_slice($j['betlog'], 0, 2000);
  if (isset($j['creditlog']) && is_array($j['creditlog'])) {
    $norm = [];
    foreach ($j['creditlog'] as $e) {
      $row = normalize_credit_entry($e);
      if ($row) $norm[] = $row;
    }
    $doc['creditlog'] = array_slice($norm, 0, 2000);
  }
  if (isset($j['roadhist']) && is_array($j['roadhist'])) $doc['roadhist'] = array_values($j['roadhist']);
  if (array_key_exists('openbets', $j)) $doc['openbets'] = $j['openbets'];
  if (isset($j['updatedAt'])) $doc['updatedAt'] = (int)$j['updatedAt'];
  return $doc;
}

function save_doc($doc) {
  $doc['updatedAt'] = (int)round(microtime(true) * 1000);
  if (isset($doc['betlog']) && is_array($doc['betlog'])) {
    $doc['betlog'] = array_slice($doc['betlog'], 0, 2000);
  }
  if (isset($doc['creditlog']) && is_array($doc['creditlog'])) {
    $doc['creditlog'] = array_slice($doc['creditlog'], 0, 2000);
  }
  $path = user_path($doc['user']);
  $tmp = $path . '.tmp';
  $json = json_encode($doc, JSON_UNESCAPED_UNICODE);
  if ($json === false) bad(500, 'encode failed');
  if (file_put_contents($tmp, $json, LOCK_EX) === false) bad(500, 'write failed');
  if (!rename($tmp, $path)) {
    @unlink($tmp);
    bad(500, 'rename failed');
  }
  return $doc;
}

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
  $user = sanitize_user($_GET['user'] ?? '');
  if ($user === '') bad(400, 'user required');
  $doc = load_doc($user);
  echo json_encode(['ok' => true, 'data' => $doc], JSON_UNESCAPED_UNICODE);
  exit;
}

if ($method === 'POST') {
  $body = file_get_contents('php://input');
  $j = json_decode($body ?: '{}', true);
  if (!is_array($j)) bad(400, 'invalid json');
  $user = sanitize_user($j['user'] ?? ($_GET['user'] ?? ''));
  if ($user === '') bad(400, 'user required');
  $doc = load_doc($user);
  if (array_key_exists('balance', $j)) {
    $doc['balance'] = max(0, (int)round((float)$j['balance']));
  }
  /* 全量字段：按 id 合并；空数组忽略（永不清空） */
  if (array_key_exists('betlog', $j) && is_array($j['betlog'])) {
    merge_log_union($doc, 'betlog', $j['betlog'], 'betId', 'normalize_bet_entry');
  }
  if (array_key_exists('creditlog', $j) && is_array($j['creditlog'])) {
    merge_log_union($doc, 'creditlog', $j['creditlog'], 'id', 'normalize_credit_entry');
  }
  if (array_key_exists('betAppend', $j)) {
    merge_bet_append($doc, $j['betAppend']);
  }
  if (array_key_exists('creditAppend', $j)) {
    merge_credit_append($doc, $j['creditAppend']);
  }
  if (array_key_exists('roadhist', $j) && is_array($j['roadhist'])) {
    $doc['roadhist'] = array_values($j['roadhist']);
  }
  if (array_key_exists('openbets', $j)) {
    $doc['openbets'] = $j['openbets'];
  }
  $doc = save_doc($doc);
  echo json_encode(['ok' => true, 'data' => $doc], JSON_UNESCAPED_UNICODE);
  exit;
}

bad(405, 'method not allowed');
