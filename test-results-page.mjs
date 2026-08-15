import assert from 'node:assert/strict';
import {
  compactCondition,
  matchesResultRow,
  primaryBlocker,
  renderResultsPage,
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
}, '¥90,000', '超预算 ¥5,000');
for (const expected of ['HP EliteBook', '32GB内存', 'Intel 第13代', '目立った傷や汚れなし', 'S', '¥90,000', '超预算 ¥5,000']) {
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
  primaryBlocker({ ...baseEntry, price: 70001 }),
  '超预算 ¥1',
);
assert.equal(
  primaryBlocker({ ...baseEntry, score: 50 }, { maxPriceYen: 95000, minScore: 58 }),
  '评分低于提醒线',
);
assert.equal(
  primaryBlocker({ ...baseEntry, shouldAlert: true }, { maxPriceYen: 95000, minScore: 58 }),
  '符合提醒',
);

assert.equal(
  matchesResultRow({ match: '1', grade: '3', new: '0', search: 'ＨＰ EliteBook Intel 第13代' }, 'match', 'hp 13代'),
  true,
  '搜索应进行NFKC和大小写归一化，并与快捷筛选同时生效',
);
assert.equal(
  matchesResultRow({ match: '0', grade: '4', new: '1', search: 'HP EliteBook Intel 第13代' }, 'match', 'HP'),
  false,
  '搜索命中不能绕过当前快捷筛选',
);
assert.equal(
  matchesResultRow({ match: '1', grade: '4', new: '1', search: 'HP EliteBook Intel 第13代' }, 'new', 'HP ThinkPad'),
  false,
  '多个搜索词必须全部命中',
);

const renderEntries = [
  {
    ...baseEntry,
    id: 'm1',
    url: 'https://jp.mercari.com/item/m1',
    price: 100000,
    score: 55,
    grade: 'B',
    shouldAlert: false,
    conditionEligible: true,
    likeCount: 4,
    likeCheckedAt: '2026-08-12T03:00:00.000Z',
    publishedAt: '2026-08-12T01:30:00.000Z',
    checkedAt: '2026-08-12T03:00:00.000Z',
  },
  {
    ...baseEntry,
    id: 'm2',
    title: 'ThinkPad X1 Carbon 32GB 1TB',
    url: 'https://jp.mercari.com/item/m2',
    price: 76000,
    score: 80,
    grade: 'S',
    shouldAlert: true,
    conditionEligible: true,
    reasons: ['商品状态第2级', '32GB内存', '1TB存储', 'Intel 第13代'],
    itemConditionLevel: 2,
    itemCondition: '未使用に近い',
    likeCount: 8,
    likeCheckedAt: '2026-08-12T03:00:00.000Z',
    publishedAt: '2026-08-12T02:00:00.000Z',
    checkedAt: '2026-08-12T03:00:00.000Z',
  },
];
const rendered = renderResultsPage(renderEntries, {
  maxPriceYen: 95000,
  minScore: 58,
  likesRefreshMinutes: 10,
}, { nowMs: Date.parse('2026-08-12T04:00:00.000Z') });

assert.match(rendered, /<meta http-equiv="refresh" content="600">/);
assert.match(rendered, /页面每10分钟刷新/);
assert.match(rendered, /refreshMonitorStatus\(\);/);
assert.match(rendered, /ageMs > 900_000/);
assert.doesNotMatch(rendered, /setInterval\(refreshMonitorStatus/);
assert.match(rendered, /type="search"/);
assert.match(rendered, /aria-label="搜索商品"/);
assert.match(rendered, /id="result-count"/);
assert.match(rendered, /mercari-laptop-monitor-search/);
const sortKeys = [...rendered.matchAll(/data-sort="([^"]+)"/g)].map((match) => match[1]);
assert.deepEqual(sortKeys, ['grade', 'price', 'likes', 'condition', 'title', 'published', 'time']);
assert.doesNotMatch(rendered, /<th[^>]*>\s*判断/);
assert.doesNotMatch(rendered, /<th[^>]*>\s*链接/);
assert.doesNotMatch(rendered, /class="status-cell"/);
assert.doesNotMatch(rendered, /class="action-cell"/);
assert.match(rendered, /class="condition-cell" title="3｜目立った傷や汚れなし">3｜无明显伤污/);
assert.match(rendered, /class="title"[^>]*>HP EliteBook 830 G10 32GB 512GB<span class="external-mark"/);
assert.match(rendered, /class="decision decision-blocked">超预算 ¥5,000/);
assert.match(rendered, /class="decision decision-match">符合提醒/);
assert.match(rendered, /data-search="[^"]*HP EliteBook[^"]*Intel 第13代[^"]*超预算 ¥5,000/);

const inlineScript = rendered.match(/<script>\s*([\s\S]*?)\s*<\/script>/)?.[1];
assert.ok(inlineScript, '结果页应包含交互脚本');
assert.doesNotThrow(() => new Function(inlineScript), '结果页交互脚本必须是有效JavaScript');

const emptyRendered = renderResultsPage([], { likesRefreshMinutes: 10 }, { nowMs: Date.now() });
assert.match(emptyRendered, /colspan="7"/);
assert.match(emptyRendered, /没有符合当前筛选和搜索的商品/);

const escapedRendered = renderResultsPage([
  {
    ...baseEntry,
    id: 'm3',
    title: '<script>alert("xss")</script>',
    url: 'https://jp.mercari.com/item/m3?ref="unsafe"',
    publishedAt: '2026-08-12T02:00:00.000Z',
    checkedAt: '2026-08-12T03:00:00.000Z',
  },
], { likesRefreshMinutes: 10 }, { nowMs: Date.now() });
assert.doesNotMatch(escapedRendered, /<script>alert\("xss"\)<\/script>/);
assert.match(escapedRendered, /&lt;script&gt;alert\(&quot;xss&quot;\)&lt;\/script&gt;/);
assert.match(escapedRendered, /ref=&quot;unsafe&quot;/);

console.log('results page tests: OK');
