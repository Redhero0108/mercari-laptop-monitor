import assert from 'node:assert/strict';
import {
  compactCondition,
  primaryBlocker,
  searchText,
} from './results-page.mjs';

const goodReasons = ['商品状态第3级', '32GB内存', '512GB存储', 'Intel 第13代', '价格合理'];
const baseEntry = {
  title: 'HP EliteBook 830 G10 32GB 512GB',
  price: 90000,
  score: 60,
  grade: 'A',
  shouldAlert: false,
  itemCondition: '目立った傷や汚れなし',
  itemConditionLevel: 3,
  reasons: goodReasons,
};

assert.deepEqual(
  compactCondition({ itemConditionLevel: 1, itemCondition: '新品、未使用' }),
  { label: '1｜新品', title: '1｜新品、未使用' },
  '商品状态1应显示紧凑中文，同时保留完整原文',
);
assert.deepEqual(
  compactCondition({ itemConditionLevel: 2, itemCondition: '未使用に近い' }),
  { label: '2｜近乎未使用', title: '2｜未使用に近い' },
  '商品状态2应显示紧凑中文，同时保留完整原文',
);
assert.deepEqual(
  compactCondition(baseEntry),
  { label: '3｜无明显伤污', title: '3｜目立った傷や汚れなし' },
  '商品状态3应显示紧凑中文，同时保留完整原文',
);

const searchable = searchText({
  ...baseEntry,
  grade: 'S',
  reasons: ['32GB内存', 'Intel 第13代', '商务本系列'],
}, '¥90,000');
for (const expected of ['HP EliteBook', '32GB内存', 'Intel 第13代', '目立った傷や汚れなし', 'S', '¥90,000']) {
  assert.ok(searchable.includes(expected), `搜索文本应包含：${expected}`);
}

assert.equal(
  primaryBlocker({ ...baseEntry, reasons: [...goodReasons, '严重故障/锁机风险'], price: 120000 }, { maxPriceYen: 95000, minScore: 58 }),
  '严重故障/锁机风险',
  '安全风险必须优先于价格原因',
);
assert.equal(
  primaryBlocker({ ...baseEntry, reasons: [...goodReasons, '不是目标Windows笔记本'] }, { maxPriceYen: 95000, minScore: 58 }),
  '非目标Windows笔记本',
);
assert.equal(
  primaryBlocker({ ...baseEntry, reasons: goodReasons.filter((reason) => reason !== '32GB内存') }, { maxPriceYen: 95000, minScore: 58 }),
  '未确认32GB内存',
);
assert.equal(
  primaryBlocker({ ...baseEntry, reasons: goodReasons.filter((reason) => reason !== '512GB存储') }, { maxPriceYen: 95000, minScore: 58 }),
  '未确认512GB以上存储',
);
assert.equal(
  primaryBlocker({ ...baseEntry, reasons: [...goodReasons, '未确认SSD'] }, { maxPriceYen: 95000, minScore: 58 }),
  '未确认SSD',
);
assert.equal(
  primaryBlocker({ ...baseEntry, price: null }, { maxPriceYen: 95000, minScore: 58 }),
  '价格不明',
);
assert.equal(
  primaryBlocker({ ...baseEntry, price: 100000 }, { maxPriceYen: 95000, minScore: 58 }),
  '超预算 ¥5,000',
);
assert.equal(
  primaryBlocker({ ...baseEntry, score: 50 }, { maxPriceYen: 95000, minScore: 58 }),
  '评分低于提醒线',
);
assert.equal(
  primaryBlocker({ ...baseEntry, shouldAlert: true }, { maxPriceYen: 95000, minScore: 58 }),
  '符合提醒',
);

console.log('results page helper tests: OK');
