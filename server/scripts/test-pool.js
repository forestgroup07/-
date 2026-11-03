'use strict';

const assert = require('assert');
const { checkPoolLimit, isHedgeType } = require('../src/limits');

assert.strictEqual(isHedgeType('big'), true);
assert.strictEqual(isHedgeType('odd'), true);
assert.strictEqual(isHedgeType('total_9'), false);
assert.strictEqual(isHedgeType('combo_12'), false);

const table = { hedge_diff_max: 100, pool_total_max: 500 };

// 对冲：大 80、小 0 → diff 80 OK；再加大 30 → 大110 小0 diff110 超限
{
  const a = checkPoolLimit('big', 80, {}, table);
  assert.strictEqual(a.ok, true);
  const b = checkPoolLimit('big', 30, { big: 80 }, table);
  assert.strictEqual(b.ok, false);
  assert.strictEqual(b.error, 'hedge_diff_exceeded');
}

// 对冲：大 100、再下小 100 → diff 0 OK
{
  const c = checkPoolLimit('small', 100, { big: 100 }, table);
  assert.strictEqual(c.ok, true);
  assert.strictEqual(c.pool.diff, 0);
}

// 非对冲总值：已 400，再 150 → 550 > 500
{
  const d = checkPoolLimit('total_9', 150, { total_9: 400 }, table);
  assert.strictEqual(d.ok, false);
  assert.strictEqual(d.error, 'pool_total_exceeded');
  const e = checkPoolLimit('total_9', 100, { total_9: 400 }, table);
  assert.strictEqual(e.ok, true);
}

console.log('test-pool: OK');
