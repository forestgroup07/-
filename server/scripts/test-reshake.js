'use strict';

const assert = require('assert');
const { isValidDiceResult, rollValidDice } = require('../src/rules');

assert.strictEqual(isValidDiceResult([1, 2, 3]).ok, true);
assert.strictEqual(isValidDiceResult([1, 2]).ok, false);
assert.strictEqual(isValidDiceResult([1, 2, 7]).reason, 'bad_face');
assert.strictEqual(isValidDiceResult([1, 2, 3], { edge: true }).reason, 'edge');
assert.strictEqual(isValidDiceResult([1, 2, 3], { overlap: true }).reason, 'overlap');

// 前两次判无效，第三次通过 → reshakes=2
let i = 0;
const r = rollValidDice({
  validate: () => {
    i += 1;
    return i < 3 ? { ok: false, reason: 'edge' } : { ok: true };
  },
});
assert.strictEqual(r.reshakes, 2);
assert.strictEqual(r.attempts, 3);
assert.strictEqual(r.dice.length, 3);

let threw = false;
try {
  rollValidDice({
    maxAttempts: 3,
    validate: () => ({ ok: false, reason: 'edge' }),
  });
} catch (e) {
  threw = e.code === 'reshake_exhausted';
}
assert.strictEqual(threw, true);

console.log('test-reshake: OK');
