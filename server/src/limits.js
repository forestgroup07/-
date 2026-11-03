'use strict';

/**
 * D2 玩法限红：账号限红 ∩ 桌台限红
 * 有效区间 [max(accMin, tableMin), min(accMax, tableMax)]
 * 若 max < min → 无交集，禁止下注。
 */

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function loadTableLimits(tableOrEnv) {
  // Prefer DB/table row; fallback env
  if (tableOrEnv && (tableOrEnv.bet_min != null || tableOrEnv.betMin != null)) {
    return {
      min: num(tableOrEnv.bet_min ?? tableOrEnv.betMin, 10),
      max: num(tableOrEnv.bet_max ?? tableOrEnv.betMax, 5000),
      code: tableOrEnv.code || null,
    };
  }
  const env = tableOrEnv && tableOrEnv.TABLE_BET_MIN != null ? tableOrEnv : process.env;
  return {
    min: num(env.TABLE_BET_MIN, 10),
    max: num(env.TABLE_BET_MAX, 5000),
    code: env.TABLE_CODE || 'S601',
  };
}

function accountLimits(user) {
  return {
    min: num(user.bet_min ?? user.betMin, 10),
    max: num(user.bet_max ?? user.betMax, 5000),
  };
}

function intersectLimits(account, table) {
  const min = Math.max(account.min, table.min);
  const max = Math.min(account.max, table.max);
  return {
    min,
    max,
    ok: max >= min,
    account: { min: account.min, max: account.max },
    table: { min: table.min, max: table.max, code: table.code || null },
  };
}

function effectivePlayLimits(user, table) {
  return intersectLimits(accountLimits(user), loadTableLimits(table || process.env));
}

/**
 * @returns {{ ok: true, limits } | { ok: false, error, limits }}
 */
function checkPlayLimit(user, amount, table) {
  const limits = effectivePlayLimits(user, table);
  const amt = Number(amount);

  if (!limits.ok) {
    return { ok: false, error: 'limit_no_intersection', limits };
  }
  if (!Number.isFinite(amt) || amt <= 0) {
    return { ok: false, error: 'invalid_amount', limits };
  }
  if (amt < limits.min) {
    return { ok: false, error: 'below_min', limits, amount: amt };
  }
  if (amt > limits.max) {
    return { ok: false, error: 'above_max', limits, amount: amt };
  }
  return { ok: true, limits, amount: amt };
}

/** D3 对冲类型：大/小、单/双 */
const HEDGE_PAIRS = {
  big: 'small',
  small: 'big',
  odd: 'even',
  even: 'odd',
};

function isHedgeType(betType) {
  return Object.prototype.hasOwnProperty.call(HEDGE_PAIRS, betType);
}

function poolCaps(table) {
  return {
    hedgeDiffMax: num(
      table?.hedge_diff_max ?? table?.hedgeDiffMax ?? process.env.TABLE_HEDGE_DIFF_MAX,
      20000
    ),
    poolTotalMax: num(
      table?.pool_total_max ?? table?.poolTotalMax ?? process.env.TABLE_POOL_TOTAL_MAX,
      50000
    ),
  };
}

/**
 * sumsByType: { [betType]: number } 本局已接受注额（不含本笔）
 * @returns {{ ok: true, pool } | { ok: false, error, pool }}
 */
function checkPoolLimit(betType, amount, sumsByType, table) {
  const amt = Number(amount);
  const caps = poolCaps(table);
  const sums = sumsByType || {};
  const current = num(sums[betType], 0);

  if (isHedgeType(betType)) {
    const opp = HEDGE_PAIRS[betType];
    const side = current + amt;
    const other = num(sums[opp], 0);
    const diff = Math.abs(side - other);
    const pool = {
      kind: 'hedge',
      betType,
      opposite: opp,
      sideTotal: side,
      oppositeTotal: other,
      diff,
      hedgeDiffMax: caps.hedgeDiffMax,
    };
    if (diff > caps.hedgeDiffMax) {
      return { ok: false, error: 'hedge_diff_exceeded', pool };
    }
    return { ok: true, pool };
  }

  const itemTotal = current + amt;
  const pool = {
    kind: 'total',
    betType,
    itemTotal,
    poolTotalMax: caps.poolTotalMax,
  };
  if (itemTotal > caps.poolTotalMax) {
    return { ok: false, error: 'pool_total_exceeded', pool };
  }
  return { ok: true, pool };
}

module.exports = {
  loadTableLimits,
  accountLimits,
  intersectLimits,
  effectivePlayLimits,
  checkPlayLimit,
  HEDGE_PAIRS,
  isHedgeType,
  poolCaps,
  checkPoolLimit,
};
