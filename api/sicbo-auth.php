<?php
/**
 * Sicbo / Forest Group auth + referral tree (demo).
 * POST JSON:
 *   { action: "register", user, password, nick, contactType, contact, email, referrerCode }
 *   contactType: whatsapp | telegram
 *   { action: "login", user, password }
 *   { action: "check_ref", referrerCode }
 * GET ?check_ref=CODE
 *
 * Root: FOREST（无上级；推荐码 FOREST）
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

function ok($data = []) {
  echo json_encode(array_merge(['ok' => true], $data), JSON_UNESCAPED_UNICODE);
  exit;
}

function data_dir() {
  $dir = '/www/wwwroot/forestgroup.ai/data/sicbo-users';
  if (!is_dir(dirname($dir))) {
    $dir = dirname(__DIR__) . '/data/sicbo-users';
  }
  if (!is_dir($dir)) {
    if (!mkdir($dir, 0755, true) && !is_dir($dir)) {
      bad(500, 'cannot create user data dir');
    }
  }
  return $dir;
}

function codes_path() {
  return data_dir() . '/_codes.json';
}

function user_path($user) {
  return data_dir() . '/' . $user . '.json';
}

function sanitize_user($u) {
  $u = strtolower(trim((string)$u));
  $u = preg_replace('/[^a-z0-9_]/', '', $u);
  if ($u === '' || strlen($u) < 3 || strlen($u) > 24) return '';
  return $u;
}

function sanitize_code($c) {
  $c = strtoupper(trim((string)$c));
  $c = preg_replace('/[^A-Z0-9_]/', '', $c);
  if ($c === '' || strlen($c) > 32) return '';
  return $c;
}

function load_codes() {
  $path = codes_path();
  if (!is_file($path)) return [];
  $j = json_decode(file_get_contents($path) ?: '{}', true);
  return is_array($j) ? $j : [];
}

function save_codes($map) {
  $path = codes_path();
  $tmp = $path . '.tmp';
  $json = json_encode($map, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
  if ($json === false) bad(500, 'codes encode failed');
  if (file_put_contents($tmp, $json, LOCK_EX) === false) bad(500, 'codes write failed');
  if (!rename($tmp, $path)) {
    @unlink($tmp);
    bad(500, 'codes rename failed');
  }
}

function load_user($user) {
  $path = user_path($user);
  if (!is_file($path)) return null;
  $j = json_decode(file_get_contents($path) ?: 'null', true);
  return is_array($j) ? $j : null;
}

function save_user($doc) {
  $path = user_path($doc['user']);
  $tmp = $path . '.tmp';
  $doc['updatedAt'] = (int)round(microtime(true) * 1000);
  $json = json_encode($doc, JSON_UNESCAPED_UNICODE);
  if ($json === false) bad(500, 'user encode failed');
  if (file_put_contents($tmp, $json, LOCK_EX) === false) bad(500, 'user write failed');
  if (!rename($tmp, $path)) {
    @unlink($tmp);
    bad(500, 'user rename failed');
  }
  return $doc;
}

function public_user($doc) {
  return [
    'user' => $doc['user'],
    'nick' => $doc['nick'] ?? $doc['user'],
    'contactType' => $doc['contactType'] ?? '',
    'contact' => $doc['contact'] ?? '',
    'phone' => $doc['phone'] ?? '',
    'whatsapp' => $doc['whatsapp'] ?? '',
    'telegram' => $doc['telegram'] ?? '',
    'email' => $doc['email'] ?? '',
    'referralCode' => $doc['referralCode'] ?? strtoupper($doc['user']),
    'referrerId' => $doc['referrerId'] ?? null,
    'createdAt' => $doc['createdAt'] ?? 0,
  ];
}

function ensure_root() {
  $root = 'forest';
  $codes = load_codes();
  $doc = load_user($root);
  if ($doc) {
    if (!isset($codes['FOREST'])) {
      $codes['FOREST'] = $root;
      save_codes($codes);
    }
    return;
  }
  $doc = [
    'user' => $root,
    'passHash' => password_hash('Forest@2026', PASSWORD_DEFAULT),
    'nick' => 'Forest Group',
    'contactType' => 'email',
    'contact' => 'admin@forestgroup.ai',
    'phone' => '',
    'whatsapp' => '',
    'telegram' => '',
    'email' => 'admin@forestgroup.ai',
    'referralCode' => 'FOREST',
    'referrerId' => null,
    'isRoot' => true,
    'createdAt' => (int)round(microtime(true) * 1000),
  ];
  save_user($doc);
  $codes['FOREST'] = $root;
  save_codes($codes);
}

ensure_root();

function find_user_by_code($code) {
  $code = sanitize_code($code);
  if ($code === '') return null;
  $codes = load_codes();
  if (!isset($codes[$code])) return null;
  $uid = sanitize_user($codes[$code]);
  if ($uid === '') return null;
  return load_user($uid);
}

$method = $_SERVER['REQUEST_METHOD'];
$body = [];
if ($method === 'POST') {
  $raw = file_get_contents('php://input');
  $body = json_decode($raw ?: '{}', true);
  if (!is_array($body)) bad(400, 'invalid json');
}

$action = '';
if ($method === 'GET') {
  if (isset($_GET['check_ref'])) $action = 'check_ref';
} else {
  $action = strtolower(trim((string)($body['action'] ?? '')));
}

if ($action === 'check_ref') {
  $code = sanitize_code($body['referrerCode'] ?? ($_GET['check_ref'] ?? ''));
  if ($code === '') bad(400, '推荐码不能为空');
  $ref = find_user_by_code($code);
  if (!$ref) bad(404, '推荐码无效');
  ok([
    'referrer' => [
      'user' => $ref['user'],
      'nick' => $ref['nick'] ?? $ref['user'],
      'referralCode' => $ref['referralCode'] ?? strtoupper($ref['user']),
    ],
  ]);
}

if ($action === 'login') {
  $user = sanitize_user($body['user'] ?? '');
  $pass = (string)($body['password'] ?? '');
  if ($user === '' || $pass === '') bad(400, '请输入账号和密码');
  $doc = load_user($user);
  if (!$doc || empty($doc['passHash'])) bad(401, '账号或密码错误');
  if (!password_verify($pass, $doc['passHash'])) bad(401, '账号或密码错误');
  ok(['user' => public_user($doc)]);
}

if ($action === 'register') {
  $user = sanitize_user($body['user'] ?? '');
  $pass = (string)($body['password'] ?? '');
  $nick = trim((string)($body['nick'] ?? ''));
  $contactType = strtolower(trim((string)($body['contactType'] ?? '')));
  $contact = trim((string)($body['contact'] ?? ''));
  $email = strtolower(trim((string)($body['email'] ?? '')));
  $refCode = sanitize_code($body['referrerCode'] ?? '');

  if ($user === '') bad(400, '账号须为 3-24 位字母数字或下划线');
  if (strlen($pass) < 8) bad(400, '密码至少 8 位');
  if ($nick === '' || mb_strlen($nick) > 24) bad(400, '请填写游戏昵称（最多 24 字）');
  /* 成品：只收 WhatsApp */
  $contactType = 'whatsapp';
  if ($contact === '' || !preg_match('/^\+?[0-9\-\s]{8,20}$/', $contact)) {
    bad(400, '请填写有效 WhatsApp 号码');
  }
  if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) bad(400, '请填写有效邮箱');
  if ($refCode === '') bad(400, '必须填写推荐人推荐码');

  if (load_user($user)) bad(409, '账号已存在');

  $codes = load_codes();
  $myCode = strtoupper($user);
  if (isset($codes[$myCode])) bad(409, '推荐码冲突，请换账号');

  $ref = find_user_by_code($refCode);
  if (!$ref) bad(400, '推荐码无效，请向推荐人索取正确推荐码');

  $doc = [
    'user' => $user,
    'passHash' => password_hash($pass, PASSWORD_DEFAULT),
    'nick' => $nick,
    'contactType' => $contactType,
    'contact' => $contact,
    'phone' => $contactType === 'whatsapp' ? $contact : '',
    'whatsapp' => $contactType === 'whatsapp' ? $contact : '',
    'telegram' => $contactType === 'telegram' ? $contact : '',
    'email' => $email,
    'referralCode' => $myCode,
    'referrerId' => $ref['user'],
    'isRoot' => false,
    'createdAt' => (int)round(microtime(true) * 1000),
  ];
  save_user($doc);
  $codes[$myCode] = $user;
  save_codes($codes);

  ok(['user' => public_user($doc)]);
}

bad(400, 'unknown action');
