-- Forest Group 统一钱包 — 按 50 万同时在线设计（MySQL 5.7+ InnoDB）
-- 正确性硬规则：
-- 1) 一账号一余额，全游戏共用
-- 2) 余额只允许在「行锁 + 插入流水」同一事务内变更
-- 3) (account_id, tx_id) 唯一 → 幂等，防重复扣款/重复派彩
-- 4) 禁止 DELETE/TRUNCATE 流水；作废只改 status=void
-- 5) 客户端禁止直接盖 balance（由 API STRICT 模式拒绝）
-- 6) 本库独立：fg_wallet，禁止写入 ucoin_*

CREATE DATABASE IF NOT EXISTS fg_wallet
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE fg_wallet;

CREATE TABLE IF NOT EXISTS fg_account (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  username      VARCHAR(64) NOT NULL,
  status        ENUM('active','frozen','closed') NOT NULL DEFAULT 'active',
  display_name  VARCHAR(64) NULL,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_username (username)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC;

-- 热行：同一账号并发下注时靠事务内 SELECT ... FOR UPDATE 串行化
CREATE TABLE IF NOT EXISTS fg_wallet (
  account_id    BIGINT UNSIGNED NOT NULL,
  balance       BIGINT NOT NULL DEFAULT 0,
  version       BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '乐观锁版本，每次变更 +1',
  currency      VARCHAR(8) NOT NULL DEFAULT 'CHIP',
  updated_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (account_id),
  CONSTRAINT fk_wallet_account FOREIGN KEY (account_id) REFERENCES fg_account(id)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS fg_game (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code          VARCHAR(32) NOT NULL,
  name_zh       VARCHAR(64) NOT NULL,
  name_en       VARCHAR(64) NULL,
  active        TINYINT(1) NOT NULL DEFAULT 1,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_game_code (code)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS fg_game_client (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  game_id       INT UNSIGNED NOT NULL,
  platform      ENUM('pc','mobile') NOT NULL,
  client_code   VARCHAR(40) NOT NULL,
  entry_path    VARCHAR(128) NULL,
  active        TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uk_client_code (client_code),
  UNIQUE KEY uk_game_platform (game_id, platform),
  CONSTRAINT fk_client_game FOREIGN KEY (game_id) REFERENCES fg_game(id)
) ENGINE=InnoDB;

-- 流水：按 account_id HASH 分片，降低单表热点；唯一键含分片键保证幂等
CREATE TABLE IF NOT EXISTS fg_ledger (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  account_id      BIGINT UNSIGNED NOT NULL,
  tx_id           VARCHAR(48) NOT NULL,
  tx_type         ENUM('recharge','debit','bet','payout','adjust','refund') NOT NULL,
  amount          BIGINT NOT NULL COMMENT '有符号：入账+ 出账-',
  balance_after   BIGINT NOT NULL,
  game_code       VARCHAR(32) NULL,
  client_code     VARCHAR(40) NULL,
  ref_bet_id      VARCHAR(48) NULL,
  note            VARCHAR(120) NULL,
  source          VARCHAR(32) NULL,
  status          ENUM('ok','void') NOT NULL DEFAULT 'ok',
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id, account_id),
  UNIQUE KEY uk_ledger_tx (account_id, tx_id),
  KEY idx_ledger_account_id (account_id, id),
  KEY idx_ledger_time (created_at),
  KEY idx_ledger_type_time (tx_type, created_at),
  KEY idx_ledger_game_time (game_code, created_at)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC
PARTITION BY HASH(account_id) PARTITIONS 32;

CREATE TABLE IF NOT EXISTS fg_bet (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  bet_id        VARCHAR(48) NOT NULL,
  account_id    BIGINT UNSIGNED NOT NULL,
  game_code     VARCHAR(32) NOT NULL,
  client_code   VARCHAR(40) NULL,
  table_code    VARCHAR(32) NULL,
  round_id      VARCHAR(64) NULL,
  market        VARCHAR(64) NULL,
  stake         BIGINT NOT NULL DEFAULT 0,
  payout        BIGINT NOT NULL DEFAULT 0,
  pnl           BIGINT NOT NULL DEFAULT 0,
  status        ENUM('open','won','lost','push','cancelled','settled') NOT NULL DEFAULT 'open',
  ledger_bet_tx VARCHAR(48) NULL,
  ledger_pay_tx VARCHAR(48) NULL,
  payload_json  JSON NULL,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  settled_at    DATETIME(3) NULL,
  PRIMARY KEY (id, account_id),
  UNIQUE KEY uk_bet_id (account_id, bet_id),
  KEY idx_bet_account_id (account_id, id),
  KEY idx_bet_time (created_at),
  KEY idx_bet_game_round (game_code, round_id)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC
PARTITION BY HASH(account_id) PARTITIONS 32;

CREATE TABLE IF NOT EXISTS fg_game_state (
  account_id    BIGINT UNSIGNED NOT NULL,
  game_code     VARCHAR(32) NOT NULL,
  state_key     VARCHAR(32) NOT NULL,
  state_json    JSON NOT NULL,
  updated_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (account_id, game_code, state_key)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC;

-- 幂等去重辅助（跨分区查询兜底可不用；主路径靠 uk_ledger_tx）
CREATE TABLE IF NOT EXISTS fg_tx_dedupe (
  account_id    BIGINT UNSIGNED NOT NULL,
  tx_id         VARCHAR(48) NOT NULL,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (account_id, tx_id)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC
PARTITION BY HASH(account_id) PARTITIONS 32;

INSERT INTO fg_game (code, name_zh, name_en) VALUES
  ('sicbo', '骰宝', 'Sic Bo'),
  ('roulette', '轮盘', 'Roulette')
ON DUPLICATE KEY UPDATE name_zh = VALUES(name_zh);

INSERT INTO fg_game_client (game_id, platform, client_code, entry_path)
SELECT g.id, x.platform, x.client_code, x.entry_path
FROM fg_game g
JOIN (
  SELECT 'sicbo' AS code, 'pc' AS platform, 'sicbo_pc' AS client_code, '/game.html' AS entry_path
  UNION ALL SELECT 'sicbo', 'mobile', 'sicbo_m', '/game-m.html'
  UNION ALL SELECT 'roulette', 'pc', 'roulette_pc', '/roulette.html'
  UNION ALL SELECT 'roulette', 'mobile', 'roulette_m', '/roulette-m.html'
) x ON x.code = g.code
ON DUPLICATE KEY UPDATE entry_path = VALUES(entry_path);
