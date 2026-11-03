-- Sic Bo demo schema (MySQL 8+)
CREATE DATABASE IF NOT EXISTS sicbo_demo
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE sicbo_demo;

CREATE TABLE IF NOT EXISTS users (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(64) NOT NULL UNIQUE,
  token         VARCHAR(128) NOT NULL UNIQUE,
  balance       DECIMAL(14,2) NOT NULL DEFAULT 10000.00,
  -- D2 账号限红（开户设定）
  bet_min       DECIMAL(14,2) NOT NULL DEFAULT 10.00,
  bet_max       DECIMAL(14,2) NOT NULL DEFAULT 5000.00,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tables (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code          VARCHAR(32) NOT NULL UNIQUE,
  name          VARCHAR(64) NOT NULL,
  -- D2 桌台限红
  bet_min       DECIMAL(14,2) NOT NULL DEFAULT 10.00,
  bet_max       DECIMAL(14,2) NOT NULL DEFAULT 5000.00,
  -- D3 预留：对冲差额限 / 非对冲单项总值限
  hedge_diff_max DECIMAL(14,2) NOT NULL DEFAULT 20000.00,
  pool_total_max DECIMAL(14,2) NOT NULL DEFAULT 50000.00,
  active        TINYINT(1) NOT NULL DEFAULT 1,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS game_rounds (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  round_no      BIGINT UNSIGNED NOT NULL UNIQUE,
  -- D4: cancelled = 故障整局取消
  phase         ENUM('betting','rolling','settle','closed','cancelled') NOT NULL,
  die1          TINYINT UNSIGNED NULL,
  die2          TINYINT UNSIGNED NULL,
  die3          TINYINT UNSIGNED NULL,
  sum_total     TINYINT UNSIGNED NULL,
  is_triple     TINYINT(1) NOT NULL DEFAULT 0,
  winners_json  JSON NULL,
  cancel_reason VARCHAR(128) NULL,
  betting_ends_at DATETIME(3) NULL,
  opened_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  closed_at     DATETIME(3) NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS bets (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  round_id      BIGINT UNSIGNED NOT NULL,
  user_id       BIGINT UNSIGNED NOT NULL,
  bet_type      VARCHAR(32) NOT NULL,
  amount        DECIMAL(14,2) NOT NULL,
  odds          DECIMAL(10,2) NOT NULL,
  payout        DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  won           TINYINT(1) NULL,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_bets_round (round_id),
  INDEX idx_bets_user (user_id),
  CONSTRAINT fk_bets_round FOREIGN KEY (round_id) REFERENCES game_rounds(id),
  CONSTRAINT fk_bets_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

INSERT INTO users (username, token, balance, bet_min, bet_max)
VALUES ('godot_demo', 'demo-godot-token', 10000.00, 10.00, 5000.00)
ON DUPLICATE KEY UPDATE token = VALUES(token);

INSERT INTO tables (code, name, bet_min, bet_max, hedge_diff_max, pool_total_max)
VALUES ('S601', 'Sic Bo S601', 10.00, 5000.00, 20000.00, 50000.00)
ON DUPLICATE KEY UPDATE name = VALUES(name);
