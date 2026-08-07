import assert from 'node:assert/strict';
import { conditionLevel, isConditionAllowed } from './conditions.mjs';

assert.equal(conditionLevel('新品、未使用'), 1);
assert.equal(conditionLevel('新品 未使用'), 1);
assert.equal(conditionLevel('未使用に近い'), 2);
assert.equal(conditionLevel('目立った傷や汚れなし'), 3);
assert.equal(conditionLevel('やや傷や汚れあり'), 4);
assert.equal(conditionLevel('傷や汚れあり'), 5);
assert.equal(conditionLevel('全体的に状態が悪い'), 6);
assert.equal(conditionLevel('不明'), null);
assert.equal(isConditionAllowed('目立った傷や汚れなし', 3), true);
assert.equal(isConditionAllowed('やや傷や汚れあり', 3), false);
assert.equal(isConditionAllowed(null, 3), false);

console.log('condition tests: OK');
