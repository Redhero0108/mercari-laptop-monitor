import assert from 'node:assert/strict';

const resultHistory = await import('./result-history.mjs').catch(() => ({}));
assert.equal(typeof resultHistory.mergeResultHistory, 'function', '应提供结果历史合并函数');
assert.equal(typeof resultHistory.evaluatePriceDrop, 'function', '应提供降价提醒判定函数');
const { mergeResultHistory, evaluatePriceDrop } = resultHistory;

// 降价提醒判定
assert.deepEqual(
  evaluatePriceDrop({ previousPrice: 70000, currentPrice: 65000, shouldAlert: true, maxPriceYen: 70000 }),
  { previousPrice: 70000, currentPrice: 65000, delta: -5000 },
  '价格下降且满足提醒条件时应提醒',
);
assert.equal(
  evaluatePriceDrop({ previousPrice: 70000, currentPrice: 70000, shouldAlert: true, maxPriceYen: 70000 }),
  null,
  '价格未下降不得提醒',
);
assert.equal(
  evaluatePriceDrop({ previousPrice: 70000, currentPrice: 72000, shouldAlert: true, maxPriceYen: 70000 }),
  null,
  '价格上涨不得提醒',
);
assert.equal(
  evaluatePriceDrop({ previousPrice: 70000, currentPrice: 65000, shouldAlert: false, maxPriceYen: 70000 }),
  null,
  '不满足提醒条件不得提醒',
);
assert.equal(
  evaluatePriceDrop({ previousPrice: 80000, currentPrice: 75000, shouldAlert: true, maxPriceYen: 70000 }),
  null,
  '超出预算上限不得提醒',
);
assert.equal(
  evaluatePriceDrop({ previousPrice: 70000, currentPrice: 65000, shouldAlert: true, maxPriceYen: 70000, lastAlertedPrice: 65000 }),
  null,
  '同一价格已提醒过不得重复提醒',
);
assert.equal(
  evaluatePriceDrop({ previousPrice: null, currentPrice: 65000, shouldAlert: true, maxPriceYen: 70000 }),
  null,
  '缺少前价时无法判断降价，不得提醒',
);

assert.deepEqual(
  mergeResultHistory(null, { price: 70000, likeCount: 2 }, '2026-08-15T00:00:00.000Z', {}),
  {
    price: 70000,
    likeCount: 2,
    firstSeenAt: '2026-08-15T00:00:00.000Z',
    priceHistory: [{ value: 70000, at: '2026-08-15T00:00:00.000Z' }],
    likeHistory: [{ value: 2, at: '2026-08-15T00:00:00.000Z' }],
  },
  '首次观察应建立发现时间、价格和收藏数基线',
);

const unchanged = mergeResultHistory(
  {
    price: 70000,
    likeCount: 2,
    firstSeenAt: '2026-08-14T00:00:00.000Z',
    priceHistory: [{ value: 70000, at: '2026-08-14T00:00:00.000Z' }],
    likeHistory: [{ value: 2, at: '2026-08-14T00:00:00.000Z' }],
  },
  { price: 70000, likeCount: 2 },
  '2026-08-15T00:00:00.000Z',
  {},
);
assert.equal(unchanged.priceHistory.length, 1, '相同价格不得重复追加');
assert.equal(unchanged.likeHistory.length, 1, '相同收藏数不得重复追加');
assert.equal(unchanged.firstSeenAt, '2026-08-14T00:00:00.000Z', '首次发现时间不得被刷新覆盖');

const existingHistory = mergeResultHistory(
  {
    price: 58000,
    likeCount: 5,
    firstSeenAt: '2026-08-14T00:00:00.000Z',
    checkedAt: '2026-08-15T00:00:00.000Z',
    priceHistory: [
      { value: 60000, at: '2026-08-14T00:00:00.000Z' },
      { value: 58000, at: '2026-08-15T00:00:00.000Z' },
    ],
    likeHistory: [{ value: 5, at: '2026-08-15T00:00:00.000Z' }],
  },
  { price: 58000, likeCount: 5 },
  '2026-08-15T01:00:00.000Z',
  { firstSeenAt: '2026-08-14T00:00:00.000Z', price: 60000 },
);
assert.deepEqual(
  existingHistory.priceHistory,
  [
    { value: 60000, at: '2026-08-14T00:00:00.000Z' },
    { value: 58000, at: '2026-08-15T00:00:00.000Z' },
  ],
  '已有历史时不得在每轮检查中重新插入旧基线',
);

const changed = mergeResultHistory(
  {
    price: 70000,
    likeCount: 2,
    checkedAt: '2026-08-14T00:00:00.000Z',
    likeCheckedAt: '2026-08-14T00:00:00.000Z',
  },
  { price: 65000, likeCount: 5 },
  '2026-08-15T00:00:00.000Z',
  { firstSeenAt: '2026-08-13T00:00:00.000Z', price: 72000 },
);
assert.deepEqual(
  changed.priceHistory,
  [
    { value: 72000, at: '2026-08-13T00:00:00.000Z' },
    { value: 70000, at: '2026-08-14T00:00:00.000Z' },
    { value: 65000, at: '2026-08-15T00:00:00.000Z' },
  ],
  '旧结果应使用state基线并保留本次价格变化',
);
assert.deepEqual(
  changed.likeHistory,
  [
    { value: 2, at: '2026-08-14T00:00:00.000Z' },
    { value: 5, at: '2026-08-15T00:00:00.000Z' },
  ],
  '收藏数变化应保留旧值与新值',
);
assert.equal(changed.firstSeenAt, '2026-08-13T00:00:00.000Z');

const invalid = mergeResultHistory(
  null,
  { price: null, likeCount: '5' },
  '2026-08-15T00:00:00.000Z',
  { price: null },
);
assert.deepEqual(invalid.priceHistory, [], '无效价格不得进入历史');
assert.deepEqual(invalid.likeHistory, [], '非整数收藏数不得进入历史');

let capped = null;
for (let value = 1; value <= 13; value += 1) {
  capped = mergeResultHistory(
    capped,
    { price: value, likeCount: value },
    `2026-08-${String(value).padStart(2, '0')}T00:00:00.000Z`,
    {},
  );
}
assert.equal(capped.priceHistory.length, 12, '价格历史最多保留12条');
assert.equal(capped.likeHistory.length, 12, '收藏历史最多保留12条');
assert.deepEqual(capped.priceHistory.map((point) => point.value), [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);

console.log('result history tests: OK');
