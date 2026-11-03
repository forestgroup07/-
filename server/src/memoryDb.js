'use strict';

/** In-memory stand-in when MySQL is unavailable (USE_MEMORY_DB=1). */

const state = {
  users: new Map(),
  usersByToken: new Map(),
  tables: new Map(),
  rounds: new Map(),
  bets: new Map(),
  nextUserId: 1,
  nextRoundId: 1,
  nextBetId: 1,
};

function seed(demoToken) {
  const id = state.nextUserId++;
  const user = {
    id,
    username: 'godot_demo',
    token: demoToken || 'demo-godot-token',
    balance: 10000,
    bet_min: Number(process.env.ACCOUNT_BET_MIN || 10),
    bet_max: Number(process.env.ACCOUNT_BET_MAX || 5000),
  };
  state.users.set(id, user);
  state.usersByToken.set(user.token, user);

  const table = {
    id: 1,
    code: process.env.TABLE_CODE || 'S601',
    name: 'Sic Bo S601',
    bet_min: Number(process.env.TABLE_BET_MIN || 10),
    bet_max: Number(process.env.TABLE_BET_MAX || 5000),
    hedge_diff_max: Number(process.env.TABLE_HEDGE_DIFF_MAX || 20000),
    pool_total_max: Number(process.env.TABLE_POOL_TOTAL_MAX || 50000),
    active: 1,
  };
  state.tables.set(table.code, table);
}

async function ping() {
  return true;
}

async function findUserByToken(token) {
  const u = state.usersByToken.get(token);
  return u ? { ...u } : null;
}

async function getActiveTable(code) {
  const key = code || process.env.TABLE_CODE || 'S601';
  const t = state.tables.get(key);
  return t ? { ...t } : null;
}

async function updateBalance(userId, newBalance) {
  const u = state.users.get(userId);
  if (!u) throw new Error('user_missing');
  u.balance = Number(newBalance);
  state.usersByToken.set(u.token, u);
}

async function insertRound({ roundNo, phase, bettingEndsAt }) {
  const id = state.nextRoundId++;
  state.rounds.set(id, {
    id,
    round_no: roundNo,
    phase,
    betting_ends_at: bettingEndsAt,
    die1: null,
    die2: null,
    die3: null,
    sum_total: null,
    is_triple: 0,
    winners_json: null,
    cancel_reason: null,
    closed_at: null,
  });
  return id;
}

async function updateRound(roundId, fields) {
  const r = state.rounds.get(roundId);
  if (!r) throw new Error('round_missing');
  Object.assign(r, fields);
}

async function insertBet({ roundId, userId, betType, amount, odds }) {
  const id = state.nextBetId++;
  state.bets.set(id, {
    id,
    round_id: roundId,
    user_id: userId,
    bet_type: betType,
    amount,
    odds,
    payout: 0,
    won: null,
  });
  return id;
}

async function listBetsForRound(roundId) {
  const out = [];
  for (const bet of state.bets.values()) {
    if (bet.round_id === roundId && bet.won == null) {
      const u = state.users.get(bet.user_id);
      out.push({
        ...bet,
        username: u.username,
        balance: u.balance,
      });
    }
  }
  return out;
}

async function sumBetsByType(roundId) {
  const sums = {};
  for (const bet of state.bets.values()) {
    if (bet.round_id !== roundId) continue;
    if (bet.won === -1) continue; // D4 已取消退本，不计入彩池
    const t = bet.bet_type;
    sums[t] = (sums[t] || 0) + Number(bet.amount);
  }
  return sums;
}

async function settleBet(betId, { won, payout }) {
  const b = state.bets.get(betId);
  if (!b) throw new Error('bet_missing');
  // won: 1 win, 0 lose, -1 cancelled/refunded
  b.won = won;
  b.payout = payout;
}

async function getUserBalance(userId) {
  const u = state.users.get(userId);
  if (!u) throw new Error('user_missing');
  return Number(u.balance);
}

function getPool() {
  return null;
}

module.exports = {
  seed,
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
