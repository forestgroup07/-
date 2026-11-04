<?php
/**
 * Sicbo demo account persistence (balance / betlog / roadhist / openbets).
 * GET  ?user=asdg
 * POST JSON { user, balance?, betlog?, roadhist?, openbets? }  — partial update OK
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
  // 固定站点根目录下共享存储，避免 /sicbo/ 子路径各写一份
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
    'roadhist' => [],
    'openbets' => null,
    'updatedAt' => 0,
  ];
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
  if (array_key_exists('betlog', $j) && is_array($j['betlog'])) {
    $doc['betlog'] = array_slice($j['betlog'], 0, 2000);
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
