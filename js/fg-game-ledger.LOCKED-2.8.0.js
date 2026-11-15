/**
 * Forest 各游戏共用账本展示/结账辅助（骰宝 / 轮盘 / 未来新桌）
 *
 * 约定：
 * - 账号合并一本流水；界面游戏列只显示「骰宝」「轮盘」（不带桌号）
 * - 写服务器只用 betAppend / creditAppend，禁止整包 betlog 覆盖清空
 * - 结算只结本游戏 + 本局（betId 集合或同 roundId）
 * - game_code: sicbo | roulette | <未来游戏码>
 */
(function (root) {
  'use strict';

  function str(v) {
    return v == null ? '' : String(v);
  }

  /** 界面游戏名：只「骰宝」「轮盘」等，不带 S601/R501 */
  function gameLabel(row) {
    const code = str(row && (row.game_code || row.gameCode)).toLowerCase();
    const tid = str(row && (row.tableId || row.table_code));
    const src = str(row && (row.source || row.client_code));
    if (code === 'sicbo' || /^S/i.test(tid) || /sicbo/i.test(src)) return '骰宝';
    if (code === 'roulette' || /^R/i.test(tid) || /roulette/i.test(src)) return '轮盘';
    if (code) return code;
    return '—';
  }

  function isGameRow(row, gameCode) {
    if (!row) return false;
    const want = str(gameCode).toLowerCase();
    const code = str(row.game_code || row.gameCode).toLowerCase();
    const tid = str(row.tableId || row.table_code);
    const src = str(row.source || row.client_code);
    if (want === 'sicbo') {
      if (code === 'roulette' || /^R/i.test(tid) || /roulette/i.test(src)) return false;
      return code === 'sicbo' || /^S/i.test(tid) || /sicbo/i.test(src);
    }
    if (want === 'roulette') {
      if (code === 'sicbo' || /^S/i.test(tid) || /sicbo/i.test(src)) return false;
      return code === 'roulette' || /^R/i.test(tid) || /roulette/i.test(src);
    }
    return code === want;
  }

  function collectBetIds(stack) {
    const set = new Set();
    (stack || []).forEach(function (batch) {
      ((batch && batch.betIds) || []).forEach(function (id) {
        if (id != null && id !== '') set.add(String(id));
      });
    });
    return set;
  }

  /**
   * 规范化额度行（写入本地 + creditAppend）
   * defaults: { source, game_code, tableId }
   */
  function buildCreditEntry(row, balanceFallback, defaults) {
    defaults = defaults || {};
    if (!row) return null;
    const amount = Math.round(Number(row.amount) || 0);
    if (!amount) return null;
    const ts = Number(row.ts) || Date.now();
    const src = str(row.source || defaults.source || '');
    const gameCode = str(
      row.game_code || row.gameCode || defaults.game_code
      || (/sicbo/i.test(src) ? 'sicbo' : (/roulette/i.test(src) ? 'roulette' : ''))
    );
    const tableId = str(
      row.tableId || defaults.tableId
      || (gameCode === 'sicbo' ? 'S601' : (gameCode === 'roulette' ? 'R501' : ''))
    );
    return {
      id: str(row.id || (String(ts) + String(Math.floor(Math.random() * 90) + 10))),
      ts: ts,
      type: str(row.type || (amount > 0 ? 'credit' : 'debit')),
      amount: amount,
      balance: Math.max(0, Math.round(Number(row.balance != null ? row.balance : balanceFallback) || 0)),
      note: str(row.note || ''),
      source: src || defaults.source || '',
      status: str(row.status || 'ok'),
      game_code: gameCode,
      tableId: tableId,
    };
  }

  /**
   * 取消注单：本地改 cancelled，返回需 betAppend 的行
   */
  function markCancelled(list, ids, patch) {
    patch = patch || {};
    const idset = new Set((ids || []).map(function (x) { return String(x); }));
    const updated = [];
    (list || []).forEach(function (r) {
      if (!r) return;
      const id = str(r.betId || r.id);
      if (!idset.has(id)) return;
      if (r.status === 'cancelled') return;
      r.status = 'cancelled';
      r.pnl = 0;
      if (!r.game_code && !r.gameCode && patch.game_code) r.game_code = patch.game_code;
      if (!r.tableId && patch.tableId) r.tableId = patch.tableId;
      if (!r.source && patch.source) r.source = patch.source;
      updated.push(r);
    });
    return updated;
  }

  /**
   * 结算 open → settled（只本游戏 + 本局）
   * opts: {
   *   list, meta: { key: { stake, pnl } }, roundId, thisRoundBetIds: Set,
   *   gameCode, tableId, source, result
   * }
   * 返回 updated 行数组（已改 list 内对象）
   */
  function settleOpenBets(opts) {
    opts = opts || {};
    const list = opts.list || [];
    const meta = opts.meta || {};
    const rid = str(opts.roundId || '');
    const idset = opts.thisRoundBetIds || new Set();
    const gameCode = str(opts.gameCode || '');
    const resultStr = str(opts.result != null ? opts.result : '');
    const updated = [];

    for (let i = 0; i < list.length; i++) {
      const row = list[i];
      if (!row || row.status !== 'open') continue;
      if (gameCode && !isGameRow(row, gameCode)) continue;
      const id = str(row.betId || row.id);
      const inIds = id && idset.has(id);
      const sameRound = !!(rid && str(row.roundId) === rid);
      if (!inIds && !sameRound) continue;
      const line = row.key ? meta[row.key] : null;
      const stake = Math.max(0, Math.round(Number(row.stake) || 0));
      if (!line || stake <= 0) continue;
      const unit = line.stake > 0 ? (line.pnl / line.stake) : -1;
      row.result = resultStr;
      row.pnl = Math.round(stake * unit);
      row.status = 'settled';
      if (!row.roundId) row.roundId = rid;
      if (!row.game_code && !row.gameCode) row.game_code = gameCode || opts.game_code;
      if (!row.tableId && opts.tableId) row.tableId = opts.tableId;
      if (!row.source && opts.source) row.source = opts.source;
      updated.push(row);
    }
    return updated;
  }

  /**
   * 按 .rec-table-wrap 可视高度铺满一页行数（对齐电脑版 measureRecPageSize）
   * @param {string|Element} sheetOrWrap 记录弹层根节点或 table-wrap
   * @param {number} [fallback=10]
   */
  function measureRecPageSize(sheetOrWrap, fallback) {
    const fb = fallback == null ? 10 : fallback;
    let wrap = null;
    if (typeof sheetOrWrap === 'string') {
      const root = document.getElementById(sheetOrWrap) || document.querySelector(sheetOrWrap);
      wrap = root && (root.classList && root.classList.contains('rec-table-wrap')
        ? root
        : root.querySelector('.rec-table-wrap'));
    } else if (sheetOrWrap && sheetOrWrap.nodeType === 1) {
      wrap = sheetOrWrap.classList.contains('rec-table-wrap')
        ? sheetOrWrap
        : sheetOrWrap.querySelector('.rec-table-wrap');
    }
    if (!wrap) return Math.max(8, fb);
    const wrapH = wrap.clientHeight || 0;
    if (wrapH < 40) return Math.max(8, fb);
    const table = wrap.querySelector('.rec-table');
    let headH = 0;
    const headRow = table && table.querySelector('thead tr');
    if (headRow) headH = headRow.getBoundingClientRect().height || 0;
    let rowH = 0;
    const sample = table && table.querySelector('tbody tr:not(.rec-empty)');
    if (sample) rowH = sample.getBoundingClientRect().height || 0;
    if (rowH < 8) {
      const fs = parseFloat(getComputedStyle(table || wrap).fontSize) || 14;
      rowH = fs * 2.55;
    }
    if (headH < 8) {
      const fs = parseFloat(getComputedStyle(table || wrap).fontSize) || 14;
      headH = fs * 2.7;
    }
    const n = Math.floor(Math.max(0, wrapH - headH - 2) / rowH);
    return Math.max(8, n);
  }

  root.FgGameLedger = {
    gameLabel: gameLabel,
    isGameRow: isGameRow,
    collectBetIds: collectBetIds,
    buildCreditEntry: buildCreditEntry,
    markCancelled: markCancelled,
    settleOpenBets: settleOpenBets,
    measureRecPageSize: measureRecPageSize,
  };
})(typeof window !== 'undefined' ? window : globalThis);
