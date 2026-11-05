<?php
/**
 * Customer support ticket intake.
 * POST JSON { user, whatsapp, body }
 */
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
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

if ($_SERVER['REQUEST_METHOD'] !== 'POST') bad(405, 'POST only');

$dir = '/www/wwwroot/forestgroup.ai/data/sicbo-cs';
if (!is_dir(dirname($dir))) {
  $dir = dirname(__DIR__) . '/data/sicbo-cs';
}
if (!is_dir($dir)) {
  if (!mkdir($dir, 0755, true) && !is_dir($dir)) bad(500, 'cannot create cs dir');
}

$raw = file_get_contents('php://input');
$j = json_decode($raw ?: '{}', true);
if (!is_array($j)) bad(400, 'invalid json');

$user = trim((string)($j['user'] ?? ''));
$wa = trim((string)($j['whatsapp'] ?? ''));
$body = trim((string)($j['body'] ?? ''));

if ($user === '' || mb_strlen($user) > 32) bad(400, '请填写用户名');
if ($wa === '' || !preg_match('/^\+?[0-9\-\s]{8,20}$/', $wa)) bad(400, '请填写有效 WhatsApp');
if ($body === '') bad(400, '请填写问题与需求');
if (mb_strlen($body) > 300) bad(400, '问题与需求请控制在 300 字以内');

$safeUser = preg_replace('/[^a-zA-Z0-9_\-\.@]/', '', $user);
if ($safeUser === '') $safeUser = 'guest';
$id = date('Ymd-His') . '-' . substr(md5($safeUser . microtime(true)), 0, 8);
$doc = [
  'id' => $id,
  'user' => $user,
  'whatsapp' => $wa,
  'body' => $body,
  'createdAt' => (int)round(microtime(true) * 1000),
  'ip' => $_SERVER['REMOTE_ADDR'] ?? '',
];
$path = $dir . '/' . $id . '.json';
$tmp = $path . '.tmp';
$json = json_encode($doc, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
if ($json === false) bad(500, 'encode failed');
if (file_put_contents($tmp, $json, LOCK_EX) === false) bad(500, 'write failed');
if (!rename($tmp, $path)) {
  @unlink($tmp);
  bad(500, 'rename failed');
}

echo json_encode(['ok' => true, 'id' => $id], JSON_UNESCAPED_UNICODE);
