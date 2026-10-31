/**
 * Sicbo settlement core (matches published odds tables).
 * Internal HOUSE_RAKE_RATE is never shown in UI/rules copy.
 */
(function (root) {
  'use strict';

  let HOUSE_RAKE_RATE = 0.05;

  const SUM_PAYOUT = {
    4: 50, 5: 18, 6: 14, 7: 12, 8: 8,
    9: 6, 10: 6, 11: 6, 12: 6,
    13: 8, 14: 12, 15: 14, 16: 18, 17: 50,
  };

  function getRakeRate() {
    return HOUSE_RAKE_RATE;
  }

  function setRakeRate(rate) {
    const n = Number(rate);
    if (!Number.isFinite(n) || n < 0 || n >= 1) {
      throw new Error('HOUSE_RAKE_RATE must be in [0, 1)');
    }
    HOUSE_RAKE_RATE = n;
    return HOUSE_RAKE_RATE;
  }

  function faceCounts(dice) {
    const c = [0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 3; i++) c[dice[i]] += 1;
    return c;
  }

  function classify(dice) {
    const d = [dice[0], dice[1], dice[2]];
    const sum = d[0] + d[1] + d[2];
    const triple = d[0] === d[1] && d[1] === d[2];
    return {
      dice: d,
      sum,
      size: sum >= 11 ? 'big' : 'small',
      parity: sum % 2 === 0 ? 'even' : 'odd',
      triple,
      counts: faceCounts(d),
    };
  }

  function rollDice(rng) {
    const r = typeof rng === 'function' ? rng : Math.random;
    const one = () => 1 + Math.floor(r() * 6);
    return [one(), one(), one()];
  }

  /**
   * 單一注項：是否中獎 + 規則賠率 N（1 賠 N；未中 N=0）
   * payout 為淨贏倍數（不含本金）；返還倍數 = payout + 1
   */
  function evalBet(key, info) {
    const counts = info.counts;
    const triple = info.triple;

    if (key === 'small') {
      if (triple) return { win: false, payout: 0, voidByTriple: true };
      return { win: info.size === 'small', payout: 1, voidByTriple: false };
    }
    if (key === 'big') {
      if (triple) return { win: false, payout: 0, voidByTriple: true };
      return { win: info.size === 'big', payout: 1, voidByTriple: false };
    }
    if (key === 'odd') {
      if (triple) return { win: false, payout: 0, voidByTriple: true };
      return { win: info.parity === 'odd', payout: 1, voidByTriple: false };
    }
    if (key === 'even') {
      if (triple) return { win: false, payout: 0, voidByTriple: true };
      return { win: info.parity === 'even', payout: 1, voidByTriple: false };
    }
    if (key === 'wrap') {
      return { win: triple, payout: 24, voidByTriple: false };
    }
    if (/^t[1-6]$/.test(key)) {
      const n = Number(key[1]);
      return { win: counts[n] === 3, payout: 150, voidByTriple: false };
    }
    if (/^f[1-6]$/.test(key)) {
      const n = Number(key[1]);
      const cnt = counts[n] || 0;
      if (cnt >= 1) return { win: true, payout: cnt, voidByTriple: false }; /* 1/2/3 */
      return { win: false, payout: 0, voidByTriple: false };
    }
    if (/^d[1-6]$/.test(key)) {
      const n = Number(key[1]);
      return { win: counts[n] >= 2, payout: 8, voidByTriple: false };
    }
    if (/^c\d\d$/.test(key)) {
      const a = Number(key[1]);
      const b = Number(key[2]);
      return { win: counts[a] > 0 && counts[b] > 0, payout: 5, voidByTriple: false };
    }
    if (/^s(4|5|6|7|8|9|10|11|12|13|14|15|16|17)$/.test(key)) {
      const n = Number(key.slice(1));
      const p = SUM_PAYOUT[n] || 0;
      return { win: info.sum === n, payout: p, voidByTriple: false };
    }
    return { win: false, payout: 0, voidByTriple: false, unknown: true };
  }

  function rakeOf(stake) {
    return stake * HOUSE_RAKE_RATE;
  }

  function effectiveStake(stake) {
    return stake * (1 - HOUSE_RAKE_RATE);
  }

  /**
   * 結算一局
   * @param {number[]} dice
   * @param {Record<string, number>} bets  各注項本金（下注時已從餘額扣減的面額）
   * @returns 結算明細
   */
  function settleRound(dice, bets) {
    const info = classify(dice);
    let staked = 0;
    let rakeTotal = 0;
    let returned = 0;
    const hits = [];
    const lines = [];
    const pnl = {};

    const keys = Object.keys(bets || {});
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const stake = Number(bets[key]) || 0;
      if (stake <= 0) continue;

      staked += stake;
      const rake = rakeOf(stake);
      const eff = effectiveStake(stake);
      rakeTotal += rake;

      const ev = evalBet(key, info);
      let lineReturn = 0;
      let linePnl = -stake;
      if (ev.win) {
        lineReturn = eff * (ev.payout + 1);
        linePnl = lineReturn - stake;
        hits.push(key);
      }
      returned += lineReturn;
      if (key === 'big' || key === 'small' || key === 'odd' || key === 'even' || key === 'wrap') {
        pnl[key] = linePnl;
      }
      lines.push({
        key,
        stake,
        rake,
        effectiveStake: eff,
        win: !!ev.win,
        payout: ev.payout,
        voidByTriple: !!ev.voidByTriple,
        returned: lineReturn,
        pnl: linePnl,
      });
    }

    return {
      info,
      staked,
      rakeRate: HOUSE_RAKE_RATE,
      rake: rakeTotal,
      returned,
      net: returned - staked,
      hits,
      lines,
      pnl,
      cancelled: false,
    };
  }

  /** Fault cancel: refund full stake; rake = 0 */
  function cancelRound(bets) {
    let staked = 0;
    const lines = [];
    const keys = Object.keys(bets || {});
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const stake = Number(bets[key]) || 0;
      if (stake <= 0) continue;
      staked += stake;
      lines.push({
        key,
        stake,
        rake: 0,
        effectiveStake: stake,
        win: false,
        payout: 0,
        voidByTriple: false,
        returned: stake,
        pnl: 0,
      });
    }
    return {
      info: null,
      staked,
      rakeRate: HOUSE_RAKE_RATE,
      rake: 0,
      returned: staked,
      net: 0,
      hits: [],
      lines,
      pnl: {},
      cancelled: true,
    };
  }

  const api = {
    getRakeRate,
    setRakeRate,
    SUM_PAYOUT,
    classify,
    rollDice,
    evalBet,
    rakeOf,
    effectiveStake,
    settleRound,
    cancelRound,
  };

  root.SicboEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
