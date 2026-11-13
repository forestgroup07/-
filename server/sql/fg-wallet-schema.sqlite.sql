-- Forest Group 统一钱包（SQLite 运行版；表结构对齐 MySQL 版）
-- 路径建议：/www/wwwroot/forestgroup.ai/data/fg_wallet.sqlite

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS fg_account (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  status        TEXT NOT NULL DEFAULT 'active',
  display_name  TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS fg_wallet (
  account_id    INTEGER PRIMARY KEY,
  balance       INTEGER NOT NULL DEFAULT 0,
  currency      TEXT NOT NULL DEFAULT 'CHIP',
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (account_id) REFERENCES fg_account(id)
);

CREATE TABLE IF NOT EXISTS fg_game (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT NOT NULL UNIQUE,
  name_zh       TEXT NOT NULL,
  name_en       TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS fg_game_client (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id       INTEGER NOT NULL,
  platform      TEXT NOT NULL,
  client_code   TEXT NOT NULL UNIQUE,
  entry_path    TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  UNIQUE (game_id, platform),
  FOREIGN KEY (game_id) REFERENCES fg_game(id)
);

CREATE TABLE IF NOT EXISTS fg_ledger (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id      INTEGER NOT NULL,
  tx_id           TEXT NOT NULL,
  tx_type         TEXT NOT NULL,
  amount          INTEGER NOT NULL,
  balance_after   INTEGER NOT NULL,
  game_code       TEXT,
  client_code     TEXT,
  ref_bet_id      TEXT,
  note            TEXT,
  source          TEXT,
  status          TEXT NOT NULL DEFAULT 'ok',
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (account_id, tx_id),
  FOREIGN KEY (account_id) REFERENCES fg_account(id)
);

CREATE INDEX IF NOT EXISTS idx_ledger_account_time ON fg_ledger(account_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ledger_type_time ON fg_ledger(tx_type, created_at);
CREATE INDEX IF NOT EXISTS idx_ledger_game ON fg_ledger(game_code, created_at);

CREATE TABLE IF NOT EXISTS fg_bet (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  bet_id        TEXT NOT NULL UNIQUE,
  account_id    INTEGER NOT NULL,
  game_code     TEXT NOT NULL,
  client_code   TEXT,
  table_code    TEXT,
  round_id      TEXT,
  market        TEXT,
  stake         INTEGER NOT NULL DEFAULT 0,
  payout        INTEGER NOT NULL DEFAULT 0,
  pnl           INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'open',
  ledger_bet_tx TEXT,
  ledger_pay_tx TEXT,
  payload_json  TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  settled_at    TEXT,
  FOREIGN KEY (account_id) REFERENCES fg_account(id)
);

CREATE INDEX IF NOT EXISTS idx_bet_account_time ON fg_bet(account_id, created_at);
CREATE INDEX IF NOT EXISTS idx_bet_game_round ON fg_bet(game_code, round_id);

CREATE TABLE IF NOT EXISTS fg_game_state (
  account_id    INTEGER NOT NULL,
  game_code     TEXT NOT NULL,
  state_key     TEXT NOT NULL,
  state_json    TEXT NOT NULL,
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (account_id, game_code, state_key),
  FOREIGN KEY (account_id) REFERENCES fg_account(id)
);

INSERT OR IGNORE INTO fg_game (code, name_zh, name_en) VALUES
  ('sicbo', '骰宝', 'Sic Bo'),
  ('roulette', '轮盘', 'Roulette');

INSERT OR IGNORE INTO fg_game_client (game_id, platform, client_code, entry_path)
SELECT g.id, x.platform, x.client_code, x.entry_path
FROM fg_game g
JOIN (
  SELECT 'sicbo' AS code, 'pc' AS platform, 'sicbo_pc' AS client_code, '/game.html' AS entry_path
  UNION ALL SELECT 'sicbo', 'mobile', 'sicbo_m', '/game-m.html'
  UNION ALL SELECT 'roulette', 'pc', 'roulette_pc', '/roulette.html'
  UNION ALL SELECT 'roulette', 'mobile', 'roulette_m', '/roulette-m.html'
) x ON x.code = g.code;
