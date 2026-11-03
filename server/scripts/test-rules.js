'use strict';

const assert = require('assert');
const {
  analyzeDice,
  oddsFor,
  betWins,
  normalizeBetType,
} = require('../src/rules');

function check(dice, expectWin, expectLose = []) {
  const r = analyzeDice(dice);
  for (const t of expectWin) {
    assert.strictEqual(betWins(t, r), true, `${dice} should win ${t} winners=${r.winners}`);
  }
  for (const t of expectLose) {
    assert.strictEqual(betWins(t, r), false, `${dice} should lose ${t}`);
  }
}

// 大/小 + 围骰通吃
check([4, 5, 6], ['big', 'odd', 'total_15', 'combo_45', 'combo_46', 'combo_56'], ['small', 'even', 'any_triple']);
check([1, 1, 1], ['any_triple', 'triple_1', 'all_1', 'pair_1'], ['big', 'small', 'odd', 'even', 'total_4']);
{
  const r = analyzeDice([2, 2, 2]);
  assert.ok(!r.winners.includes('big') && !r.winners.includes('small'));
  assert.ok(!r.winners.includes('odd') && !r.winners.includes('even'));
  assert.ok(r.winners.includes('any_triple') && r.winners.includes('triple_2'));
  assert.ok(r.winners.includes('total_6')); // 总和玩法仍按点数结算
}

// 单骰/双骰/全骰/对子
check([5, 1, 2], ['single_5', 'single_1', 'single_2', 'combo_12', 'combo_15', 'combo_25'], ['double_5', 'pair_5', 'all_5']);
check([5, 5, 1], ['double_5', 'pair_5', 'single_1'], ['single_5', 'all_5']);
check([5, 5, 5], ['all_5', 'pair_5', 'any_triple', 'triple_5'], ['single_5', 'double_5']);

// 赔率
assert.strictEqual(oddsFor('big'), 2);
assert.strictEqual(oddsFor('any_triple'), 25);
assert.strictEqual(oddsFor('triple_6'), 151);
assert.strictEqual(oddsFor('single_3'), 2);
assert.strictEqual(oddsFor('double_3'), 3);
assert.strictEqual(oddsFor('all_3'), 4);
assert.strictEqual(oddsFor('pair_3'), 9);
assert.strictEqual(oddsFor('combo_12'), 6);
assert.strictEqual(oddsFor('total_4'), 51);
assert.strictEqual(oddsFor('total_9'), 7);
assert.strictEqual(oddsFor('total_17'), 51);

assert.strictEqual(normalizeBetType('大'), 'big');
assert.strictEqual(normalizeBetType('單'), 'odd');
assert.strictEqual(normalizeBetType('围6'), 'triple_6');
assert.strictEqual(normalizeBetType('combo_54'), 'combo_45');

console.log('test-rules: OK');
