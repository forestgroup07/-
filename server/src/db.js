'use strict';

const mysql = require('mysql2/promise');

let impl = null;
let pool = null;

function useMemory() {
  return String(process.env.USE_MEMORY_DB || '') === '1';
}

function api() {
  if (!impl) {
    if (useMemory()) {
      impl = require('./memoryDb');
      impl.seed(process.env.DEMO_TOKEN || 'demo-godot-token');
      console.log('[db] USE_MEMORY_DB=1 (no MySQL)');
    } else {
      impl = null;
    }
  }
  return impl;
}

function getPool() {
  const mem = api();
  if (mem) return null;
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.MYSQL_HOST || '127.0.0.1',
      port: Number(process.env.MYSQL_PORT || 3306),
      user: process.env.MYSQL_USER || 'sicbo',
      password: process.env.MYSQL_PASSWORD || 'sicbo',
      database: process.env.MYSQL_DATABASE || 'sicbo_demo',
      waitForConnections: true,
      connectionLimit: 10,
      namedPlaceholders: true,
    });
  }
  return pool;
}

async function ping() {
  const mem = api();
  if (mem) return mem.ping();
  const [rows] = await getPool().query('SELECT 1 AS ok');
  return rows[0].ok === 1;
}

async function findUserByToken(token) {
  const mem = api();
  if (mem) return mem.findUserByToken(token);
  const [rows] = await getPool().execute(
    `SELECT id, username, token, balance, bet_min, bet_max
     FROM users WHERE token = :token LIMIT 1`,
    { token }
  );
  return rows[0] || null;
}

async function getActiveTable(code) {
  const mem = api();
  if (mem) return mem.getActiveTable(code);
  const [rows] = await getPool().execute(
    `SELECT id, code, name, bet_min, bet_max, hedge_diff_max, pool_total_max
     FROM tables WHERE code = :code AND active = 1 LIMIT 1`,
    { code: code || process.env.TABLE_CODE || 'S601' }
  );
  return rows[0] || null;
}

async function updateBalance(userId, newBalance) {
  const mem = api();
  if (mem) return mem.updateBalance(userId, newBalance);
  await getPool().execute(
    'UPDATE users SET balance = :balance WHERE id = :id',
    { balance: newBalance, id: userId }
  );
}

async function insertRound({ roundNo, phase, bettingEndsAt }) {
  const mem = api();
  if (mem) return mem.insertRound({ roundNo, phase, bettingEndsAt });
  const [res] = await getPool().execute(
    `INSERT INTO game_rounds (round_no, phase, betting_ends_at)
     VALUES (:roundNo, :phase, :bettingEndsAt)`,
    { roundNo, phase, bettingEndsAt }
  );
  return res.insertId;
}

async function updateRound(roundId, fields) {
  const mem = api();
  if (mem) return mem.updateRound(roundId, fields);
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const sets = keys.map((k) => `${k} = :${k}`).join(', ');
  await getPool().execute(
    `UPDATE game_rounds SET ${sets} WHERE id = :id`,
    { ...fields, id: roundId }
  );
}

async function insertBet({ roundId, userId, betType, amount, odds }) {
  const mem = api();
  if (mem) return mem.insertBet({ roundId, userId, betType, amount, odds });
  const [res] = await getPool().execute(
    `INSERT INTO bets (round_id, user_id, bet_type, amount, odds)
     VALUES (:roundId, :userId, :betType, :amount, :odds)`,
    { roundId, userId, betType, amount, odds }
  );
  return res.insertId;
}

async function listBetsForRound(roundId) {
  const mem = api();
  if (mem) return mem.listBetsForRound(roundId);
  const [rows] = await getPool().execute(
    `SELECT b.*, u.username, u.balance
     FROM bets b JOIN users u ON u.id = b.user_id
     WHERE b.round_id = :roundId AND b.won IS NULL`,
    { roundId }
  );
  return rows;
}

async function sumBetsByType(roundId) {
  const mem = api();
  if (mem) return mem.sumBetsByType(roundId);
  const [rows] = await getPool().execute(
    `SELECT bet_type, SUM(amount) AS total
     FROM bets
     WHERE round_id = :roundId AND (won IS NULL OR won >= 0)
     GROUP BY bet_type`,
    { roundId }
  );
  const sums = {};
  for (const row of rows) sums[row.bet_type] = Number(row.total);
  return sums;
}

async function settleBet(betId, { won, payout }) {
  const mem = api();
  if (mem) return mem.settleBet(betId, { won, payout });
  // won: 1 win, 0 lose, -1 cancelled
  await getPool().execute(
    'UPDATE bets SET won = :won, payout = :payout WHERE id = :id',
    { won, payout, id: betId }
  );
}

async function getUserBalance(userId) {
  const mem = api();
  if (mem) return mem.getUserBalance(userId);
  const [rows] = await getPool().execute(
    'SELECT balance FROM users WHERE id = :id LIMIT 1',
    { id: userId }
  );
  if (!rows[0]) throw new Error('user_missing');
  return Number(rows[0].balance);
}

module.exports = {
  getPool,
  ping,
  findUserByToken,
  getActiveTable,
  updateBalance,
  insertRound,
  updateRound,
  insertBet,
  listBetsForRound,
  sumBetsByType,
  settleBet,
  getUserBalance,
};
