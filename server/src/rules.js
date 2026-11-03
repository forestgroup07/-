'use strict';

/**
 * Official Sic Bo rules (see ../RULES.md).
 * odds = (1赔N) + 1  → includes stake return.
 */

const PAYOUT_N = {
  big: 1,
  small: 1,
  odd: 1,
  even: 1,
  any_triple: 24,
  specific_triple: 150,
  single: 1,
  double: 2,
  all: 3,
  pair: 8,
  combo: 5,
  total: {
    4: 50,
    5: 18,
    6: 14,
    7: 12,
    8: 8,
    9: 6,
    10: 6,
    11: 6,
    12: 6,
    13: 8,
    14: 12,
    15: 14,
    16: 18,
    17: 50,
  },
};

function nToOdds(n) {
  return n + 1;
}

const COMBO_SET = new Set();
for (let a = 1; a <= 6; a++) {
  for (let b = a + 1; b <= 6; b++) {
    COMBO_SET.add(`${a}${b}`);
  }
}

function rollDie() {
  return 1 + Math.floor(Math.random() * 6);
}

function rollDice() {
  return [rollDie(), rollDie(), rollDie()];
}

/**
 * D5: 是否可读有效结果。
 * 数字 RNG：三点均在 1–6 即有效（无贴边/重叠物理态）。
 * 实况荷官可传入 flags.edge / flags.overlap 判无效并触发重摇。
 */
function isValidDiceResult(dice, flags = {}) {
  if (!Array.isArray(dice) || dice.length !== 3) {
    return { ok: false, reason: 'bad_count' };
  }
  for (const d of dice) {
    const n = Number(d);
    if (!Number.isInteger(n) || n < 1 || n > 6) {
      return { ok: false, reason: 'bad_face' };
    }
  }
  if (flags.edge) return { ok: false, reason: 'edge' };
  if (flags.overlap) return { ok: false, reason: 'overlap' };
  if (flags.unreadable) return { ok: false, reason: 'unreadable' };
  return { ok: true, reason: null };
}

/**
 * 摇至有效；每次无效计入 reshakes。
 * opts.validate(dice) → {ok, reason} 可覆盖默认判定（单测用）。
 * opts.simulateInvalidRate：0–1，模拟贴边概率（仅开发/演练）。
 */
function rollValidDice(opts = {}) {
  const maxAttempts = Number(opts.maxAttempts || 32);
  const rate = Number(opts.simulateInvalidRate || 0);
  let reshakes = 0;

  for (let i = 0; i < maxAttempts; i++) {
    const dice = typeof opts.rollFn === 'function' ? opts.rollFn() : rollDice();
    let check;
    if (typeof opts.validate === 'function') {
      check = opts.validate(dice, i);
    } else {
      const flags = {};
      if (rate > 0 && Math.random() < rate) flags.edge = true;
      check = isValidDiceResult(dice, flags);
    }
    if (check && check.ok) {
      return { dice, reshakes, attempts: i + 1 };
    }
    reshakes += 1;
  }
  const err = new Error('reshake_exhausted');
  err.code = 'reshake_exhausted';
  throw err;
}

function countFaces(dice) {
  const c = [0, 0, 0, 0, 0, 0, 0];
  for (const d of dice) c[d] += 1;
  return c;
}

function analyzeDice(dice) {
  const [d1, d2, d3] = dice.map(Number);
  const sum = d1 + d2 + d3;
  const isTriple = d1 === d2 && d2 === d3;
  const counts = countFaces([d1, d2, d3]);
  const winners = new Set();

  // 大/小、单/双：围骰庄家通吃
  if (!isTriple) {
    if (sum >= 11 && sum <= 17) winners.add('big');
    if (sum >= 4 && sum <= 10) winners.add('small');
    if ([5, 7, 9, 11, 13, 15, 17].includes(sum)) winners.add('odd');
    if ([4, 6, 8, 10, 12, 14, 16].includes(sum)) winners.add('even');
  }

  if (isTriple) {
    winners.add('any_triple');
    winners.add(`triple_${d1}`);
  }

  for (let n = 1; n <= 6; n++) {
    const c = counts[n];
    if (c === 1) winners.add(`single_${n}`);
    if (c === 2) winners.add(`double_${n}`);
    if (c === 3) winners.add(`all_${n}`);
    if (c >= 2) winners.add(`pair_${n}`);
  }

  for (const key of COMBO_SET) {
    const a = Number(key[0]);
    const b = Number(key[1]);
    if (counts[a] >= 1 && counts[b] >= 1) winners.add(`combo_${a}${b}`);
  }

  if (sum >= 4 && sum <= 17) winners.add(`total_${sum}`);

  return {
    dice: [d1, d2, d3],
    sum,
    isTriple,
    counts,
    winners: [...winners],
  };
}

function normalizeBetType(betType) {
  const raw = String(betType || '').trim();
  const t = raw.toLowerCase();

  const simple = {
    big: 'big',
    大: 'big',
    small: 'small',
    小: 'small',
    odd: 'odd',
    单: 'odd',
    單: 'odd',
    even: 'even',
    双: 'even',
    雙: 'even',
    any_triple: 'any_triple',
    全围: 'any_triple',
    全圍: 'any_triple',
  };
  if (simple[t] || simple[raw]) return simple[t] || simple[raw];

  // 围骰 / specific triple
  let m = t.match(/^(?:triple_|wei_|围|圍)([1-6])$/) || raw.match(/^(?:围|圍)\s*([1-6])$/);
  if (m) return `triple_${m[1]}`;
  m = t.match(/^specific_triple_([1-6])$/);
  if (m) return `triple_${m[1]}`;

  // 单骰 / 双骰 / 全骰 / 对子
  m = t.match(/^(?:single_|die1_|单骰_?)([1-6])$/) || raw.match(/^单骰\s*([1-6])$/);
  if (m) return `single_${m[1]}`;
  m = t.match(/^(?:double_|die2_|双骰_?)([1-6])$/) || raw.match(/^双骰\s*([1-6])$/);
  if (m) return `double_${m[1]}`;
  m = t.match(/^(?:all_|die3_|全骰_?)([1-6])$/) || raw.match(/^全骰\s*([1-6])$/);
  if (m) return `all_${m[1]}`;
  m = t.match(/^(?:pair_|对|對)([1-6])$/) || raw.match(/^(?:对子|對子)\s*([1-6])$/);
  if (m) return `pair_${m[1]}`;

  // 两骰组合 combo_12 / 12 / 1-2
  m = t.match(/^combo[_-]?([1-6])([1-6])$/);
  if (m) {
    const a = Math.min(Number(m[1]), Number(m[2]));
    const b = Math.max(Number(m[1]), Number(m[2]));
    if (a === b) return null;
    return `combo_${a}${b}`;
  }

  if (/^total_(4|5|6|7|8|9|10|11|12|13|14|15|16|17)$/.test(t)) return t;

  return null;
}

function oddsFor(betType) {
  const t = normalizeBetType(betType);
  if (!t) return null;

  if (t === 'big' || t === 'small' || t === 'odd' || t === 'even') {
    return nToOdds(PAYOUT_N[t]);
  }
  if (t === 'any_triple') return nToOdds(PAYOUT_N.any_triple);
  if (t.startsWith('triple_')) return nToOdds(PAYOUT_N.specific_triple);
  if (t.startsWith('single_')) return nToOdds(PAYOUT_N.single);
  if (t.startsWith('double_')) return nToOdds(PAYOUT_N.double);
  if (t.startsWith('all_')) return nToOdds(PAYOUT_N.all);
  if (t.startsWith('pair_')) return nToOdds(PAYOUT_N.pair);
  if (t.startsWith('combo_')) return nToOdds(PAYOUT_N.combo);
  if (t.startsWith('total_')) {
    const s = Number(t.slice(6));
    const n = PAYOUT_N.total[s];
    return n == null ? null : nToOdds(n);
  }
  return null;
}

function betWins(betType, result) {
  const t = normalizeBetType(betType);
  if (!t) return false;
  return result.winners.includes(t);
}

/** Legacy export shape: multipliers including stake */
const ODDS = {
  big: nToOdds(1),
  small: nToOdds(1),
  odd: nToOdds(1),
  even: nToOdds(1),
  any_triple: nToOdds(24),
  specific_triple: nToOdds(150),
  ...Object.fromEntries(
    Object.entries(PAYOUT_N.total).map(([s, n]) => [`total_${s}`, nToOdds(n)])
  ),
};

module.exports = {
  PAYOUT_N,
  ODDS,
  COMBO_SET,
  rollDice,
  rollValidDice,
  isValidDiceResult,
  analyzeDice,
  normalizeBetType,
  oddsFor,
  betWins,
  countFaces,
};
