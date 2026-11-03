'use strict';

const assert = require('assert');
const {
  intersectLimits,
  checkPlayLimit,
  effectivePlayLimits,
} = require('../src/limits');

// 例：账号 10–5000 ∩ 桌台 10–5000 → 10–5000
{
  const x = intersectLimits({ min: 10, max: 5000 }, { min: 10, max: 5000 });
  assert.deepStrictEqual({ min: x.min, max: x.max, ok: x.ok }, { min: 10, max: 5000, ok: true });
}

// 账号更严：50–1000 ∩ 桌台 10–5000 → 50–1000
{
  const x = intersectLimits({ min: 50, max: 1000 }, { min: 10, max: 5000 });
  assert.strictEqual(x.min, 50);
  assert.strictEqual(x.max, 1000);
}

// 桌台更严：10–5000 ∩ 20–200 → 20–200
{
  const x = intersectLimits({ min: 10, max: 5000 }, { min: 20, max: 200, code: 'S601' });
  assert.strictEqual(x.min, 20);
  assert.strictEqual(x.max, 200);
}

// 无交集
{
  const x = intersectLimits({ min: 1000, max: 2000 }, { min: 10, max: 100 });
  assert.strictEqual(x.ok, false);
}

const user = { bet_min: 10, bet_max: 5000 };
const table = { bet_min: 10, bet_max: 5000, code: 'S601' };

assert.strictEqual(checkPlayLimit(user, 10, table).ok, true);
assert.strictEqual(checkPlayLimit(user, 5000, table).ok, true);
assert.strictEqual(checkPlayLimit(user, 9, table).error, 'below_min');
assert.strictEqual(checkPlayLimit(user, 5001, table).error, 'above_max');

const tight = { ...user, bet_min: 100, bet_max: 200 };
assert.strictEqual(checkPlayLimit(tight, 50, table).error, 'below_min');
assert.strictEqual(effectivePlayLimits(tight, table).min, 100);
assert.strictEqual(effectivePlayLimits(tight, table).max, 200);

console.log('test-limits: OK');
