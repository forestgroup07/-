'use strict';

const db = require('./db');
const {
  rollValidDice,
  analyzeDice,
  normalizeBetType,
  oddsFor,
  betWins,
} = require('./rules');
const {
  checkPlayLimit,
  effectivePlayLimits,
  checkPoolLimit,
  poolCaps,
} = require('./limits');

class GameEngine {
  constructor(broadcast, opts = {}) {
    this.broadcast = broadcast;
    this.bettingSeconds = Number(opts.bettingSeconds || 20);
    this.rollingSeconds = Number(opts.rollingSeconds || 5);
    this.settleSeconds = Number(opts.settleSeconds || 5);
    this.tableCode = opts.tableCode || process.env.TABLE_CODE || 'S601';
    this.table = null;
    this.roundNo = 0;
    this.roundId = null;
    this.phase = 'idle';
    this.bettingEndsAt = null;
    this.result = null;
    this.timer = null;
    this.countdownTimer = null;
    this.reshakeCount = 0;
    this.simulateInvalidRate = Number(
      opts.simulateInvalidRate != null
        ? opts.simulateInvalidRate
        : process.env.SIMULATE_EDGE_RATE || 0
    );
  }

  async ensureTable() {
    if (this.table) return this.table;
    this.table = await db.getActiveTable(this.tableCode);
    if (!this.table) {
      // env fallback so memory/MySQL without row still works
      this.table = {
        code: this.tableCode,
        bet_min: Number(process.env.TABLE_BET_MIN || 10),
        bet_max: Number(process.env.TABLE_BET_MAX || 5000),
        hedge_diff_max: Number(process.env.TABLE_HEDGE_DIFF_MAX || 20000),
        pool_total_max: Number(process.env.TABLE_POOL_TOTAL_MAX || 50000),
      };
    }
    return this.table;
  }

  snapshot(user) {
    const now = Date.now();
    let countdown = 0;
    if (this.phase === 'betting' && this.bettingEndsAt) {
      countdown = Math.max(0, Math.ceil((this.bettingEndsAt.getTime() - now) / 1000));
    }
    const out = {
      type: 'state',
      roundNo: this.roundNo,
      roundId: this.roundId,
      phase: this.phase,
      countdown,
      tableCode: this.tableCode,
      dice: this.result ? this.result.dice : null,
      sum: this.result ? this.result.sum : null,
      isTriple: this.result ? this.result.isTriple : null,
      winners: this.result ? this.result.winners : [],
      reshakeCount: this.reshakeCount,
    };
    if (this.table) {
      out.poolCaps = poolCaps(this.table);
    }
    if (user && this.table) {
      out.playLimits = effectivePlayLimits(user, this.table);
    }
    return out;
  }

  async start() {
    await this.ensureTable();
    this.nextRound();
  }

  stop() {
    clearTimeout(this.timer);
    clearInterval(this.countdownTimer);
  }

  async nextRound() {
    clearTimeout(this.timer);
    clearInterval(this.countdownTimer);

    this.roundNo += 1;
    this.result = null;
    this.reshakeCount = 0;
    this.phase = 'betting';
    this.bettingEndsAt = new Date(Date.now() + this.bettingSeconds * 1000);

    this.roundId = await db.insertRound({
      roundNo: this.roundNo,
      phase: 'betting',
      bettingEndsAt: this.bettingEndsAt,
    });

    this.emitState();
    this.countdownTimer = setInterval(() => this.emitState(), 1000);

    this.timer = setTimeout(() => this.beginRolling(), this.bettingSeconds * 1000);
  }

  emitState() {
    this.broadcast(this.snapshot());
  }

  async beginRolling() {
    try {
      clearInterval(this.countdownTimer);
      this.phase = 'rolling';
      await db.updateRound(this.roundId, { phase: 'rolling' });
      this.emitState();
      this.timer = setTimeout(() => this.settle(), this.rollingSeconds * 1000);
    } catch (err) {
      console.error('[engine] beginRolling failed, cancel round', err);
      await this.cancelRound('system_error');
    }
  }

  /**
   * D5: 实况判贴边/重叠/无法辨认 → 本局继续 rolling，延时后再结算（重摇）。
   * 不退注；与 D4 取消不同。
   */
  requestReshake(reason = 'edge') {
    if (this.phase !== 'rolling') {
      return { ok: false, error: 'not_rolling_phase', phase: this.phase };
    }
    const why = String(reason || 'edge');
    if (!['edge', 'overlap', 'unreadable'].includes(why)) {
      return { ok: false, error: 'invalid_reshake_reason' };
    }
    clearTimeout(this.timer);
    this.reshakeCount += 1;
    this.broadcast({
      type: 'dice_invalid',
      roundNo: this.roundNo,
      roundId: this.roundId,
      reason: why,
      reshakeCount: this.reshakeCount,
    });
    this.emitState();
    this.timer = setTimeout(() => this.settle(), this.rollingSeconds * 1000);
    return { ok: true, reason: why, reshakeCount: this.reshakeCount };
  }

  async settle() {
    try {
      // D5: 摇至可读有效；数字 RNG 默认一次通过
      let rolled;
      try {
        rolled = rollValidDice({
          simulateInvalidRate: this.simulateInvalidRate,
          maxAttempts: 32,
        });
      } catch (e) {
        if (e.code === 'reshake_exhausted') {
          console.error('[engine] reshake exhausted → cancel round');
          await this.cancelRound('reshake_exhausted');
          return;
        }
        throw e;
      }

      if (rolled.reshakes > 0) {
        this.reshakeCount += rolled.reshakes;
        this.broadcast({
          type: 'dice_reshaken',
          roundNo: this.roundNo,
          roundId: this.roundId,
          reshakes: rolled.reshakes,
          reshakeCount: this.reshakeCount,
        });
      }

      const dice = rolled.dice;
      this.result = analyzeDice(dice);
      this.phase = 'settle';

      await db.updateRound(this.roundId, {
        phase: 'settle',
        die1: dice[0],
        die2: dice[1],
        die3: dice[2],
        sum_total: this.result.sum,
        is_triple: this.result.isTriple ? 1 : 0,
        winners_json: JSON.stringify(this.result.winners),
      });

      const bets = await db.listBetsForRound(this.roundId);
      const settlements = [];
      const balByUser = new Map();

      for (const bet of bets) {
        if (!balByUser.has(bet.user_id)) {
          balByUser.set(bet.user_id, Number(bet.balance));
        }
        const won = betWins(bet.bet_type, this.result);
        const payout = won ? Number(bet.amount) * Number(bet.odds) : 0;
        await db.settleBet(bet.id, { won: won ? 1 : 0, payout });

        let bal = balByUser.get(bet.user_id);
        if (won && payout > 0) {
          bal += payout;
          await db.updateBalance(bet.user_id, bal);
          balByUser.set(bet.user_id, bal);
        }

        settlements.push({
          userId: bet.user_id,
          username: bet.username,
          betType: bet.bet_type,
          amount: Number(bet.amount),
          won,
          payout,
          balance: bal,
        });
      }

      this.broadcast({
        type: 'result',
        roundNo: this.roundNo,
        roundId: this.roundId,
        dice: this.result.dice,
        sum: this.result.sum,
        isTriple: this.result.isTriple,
        winners: this.result.winners,
        settlements,
      });
      this.emitState();

      this.timer = setTimeout(async () => {
        await db.updateRound(this.roundId, {
          phase: 'closed',
          closed_at: new Date(),
        });
        this.phase = 'closed';
        this.emitState();
        this.nextRound();
      }, this.settleSeconds * 1000);
    } catch (err) {
      console.error('[engine] settle failed, cancel round', err);
      // 若已部分派彩较复杂；此处仅在写入结果前失败时安全取消
      if (this.phase === 'betting' || this.phase === 'rolling' || this.phase === 'settle') {
        // 已进入 settle 且可能部分结算：仅对仍 won IS NULL 的注退本
        clearTimeout(this.timer);
        clearInterval(this.countdownTimer);
        const bets = await db.listBetsForRound(this.roundId);
        if (bets.length) {
          await this._refundOpenBets(bets, 'system_error');
        } else {
          this.phase = 'cancelled';
          await db.updateRound(this.roundId, {
            phase: 'cancelled',
            cancel_reason: 'system_error',
            closed_at: new Date(),
          });
          this.broadcast({
            type: 'round_cancelled',
            roundNo: this.roundNo,
            roundId: this.roundId,
            reason: 'system_error',
            refunds: [],
          });
          this.emitState();
        }
        this.timer = setTimeout(() => this.nextRound(), this.settleSeconds * 1000);
      }
    }
  }

  async _refundOpenBets(bets, reason) {
    const refunds = [];
    const balByUser = new Map();
    for (const bet of bets) {
      if (!balByUser.has(bet.user_id)) {
        balByUser.set(bet.user_id, await db.getUserBalance(bet.user_id));
      }
      const amt = Number(bet.amount);
      let bal = balByUser.get(bet.user_id) + amt;
      await db.updateBalance(bet.user_id, bal);
      balByUser.set(bet.user_id, bal);
      await db.settleBet(bet.id, { won: -1, payout: amt });
      refunds.push({
        userId: bet.user_id,
        username: bet.username,
        betId: bet.id,
        betType: bet.bet_type,
        amount: amt,
        balance: bal,
      });
    }
    this.phase = 'cancelled';
    this.result = null;
    await db.updateRound(this.roundId, {
      phase: 'cancelled',
      cancel_reason: String(reason || 'network').slice(0, 128),
      closed_at: new Date(),
    });
    this.broadcast({
      type: 'round_cancelled',
      roundNo: this.roundNo,
      roundId: this.roundId,
      reason: String(reason || 'network'),
      refunds,
    });
    this.emitState();
    return refunds;
  }

  /**
   * D4: 故障整局取消并退回本金。
   * 可在 betting / rolling 调用；closed / cancelled 不可。
   */
  async cancelRound(reason = 'network') {
    if (this.phase === 'closed' || this.phase === 'cancelled' || this.phase === 'idle') {
      return { ok: false, error: 'cannot_cancel_phase', phase: this.phase };
    }

    clearTimeout(this.timer);
    clearInterval(this.countdownTimer);

    const roundNo = this.roundNo;
    const roundId = this.roundId;
    const bets = await db.listBetsForRound(roundId);
    const refunds = await this._refundOpenBets(bets, reason);

    this.timer = setTimeout(() => this.nextRound(), this.settleSeconds * 1000);
    return { ok: true, roundNo, roundId, refundCount: refunds.length, refunds };
  }

  async placeBet(user, { betType, amount }) {
    if (this.phase !== 'betting') {
      return { ok: false, error: 'not_betting_phase' };
    }
    await this.ensureTable();

    const type = normalizeBetType(betType);
    const odds = oddsFor(type);
    if (!type || !odds) return { ok: false, error: 'invalid_bet_type' };

    const lim = checkPlayLimit(user, amount, this.table);
    if (!lim.ok) {
      return {
        ok: false,
        error: lim.error,
        playLimits: lim.limits,
        amount: lim.amount,
      };
    }
    const amt = lim.amount;
    if (Number(user.balance) < amt) {
      return { ok: false, error: 'insufficient_balance', playLimits: lim.limits };
    }

    // D3 彩池限红
    const sums = await db.sumBetsByType(this.roundId);
    const pool = checkPoolLimit(type, amt, sums, this.table);
    if (!pool.ok) {
      return {
        ok: false,
        error: pool.error,
        playLimits: lim.limits,
        pool: pool.pool,
        amount: amt,
      };
    }

    const newBal = Number(user.balance) - amt;
    await db.updateBalance(user.id, newBal);
    user.balance = newBal;

    const betId = await db.insertBet({
      roundId: this.roundId,
      userId: user.id,
      betType: type,
      amount: amt,
      odds,
    });

    return {
      ok: true,
      betId,
      betType: type,
      amount: amt,
      odds,
      balance: newBal,
      roundNo: this.roundNo,
      playLimits: lim.limits,
      pool: pool.pool,
    };
  }
}

module.exports = { GameEngine };
