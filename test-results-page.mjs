import assert from 'node:assert/strict';
import * as resultsPage from './results-page.mjs';

const {
  compactCondition,
  matchesResultRow,
  primaryBlocker,
  renderResultsPage,
  searchText,
} = resultsPage;

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

assert.equal(typeof resultsPage.productFacts, 'function', '结果页应提供结构化商品参数');
assert.equal(typeof resultsPage.sortDescription, 'function', '结果页应提供当前排序文案');
const { productFacts, sortDescription } = resultsPage;
assert.deepEqual(
  productFacts({
    itemConditionLevel: 3,
    reasons: [
      '商品状态第3级',
      '32GB内存',
      '512GB存储',
      'Intel 第13代',
      '价格合理',
      '商务本系列',
      '指定系列： HP EliteBook',
      '电池描述较好',
    ],
  }),
  ['状态3', '32GB', 'SSD 512GB', 'Intel 第13代', 'HP EliteBook', '电池描述较好'],
  '商品说明应转成固定顺序的结构化摘要',
);
assert.deepEqual(
  productFacts({
    itemConditionLevel: 2,
    reasons: ['商品状态第2级', '32GB内存', '1TB存储', '未确认SSD', 'Ryzen 7', '指定系列：ThinkPad T系列'],
  }),
  ['状态2', '32GB', '1TB', 'Ryzen 7', 'ThinkPad T系列'],
  'SSD未确认时不得在结构化摘要中写成SSD',
);
assert.equal(sortDescription('likes', 'desc'), '收藏数 从高到低');
assert.equal(sortDescription('price', 'asc'), '价格 从低到高');
assert.equal(sortDescription(), '推荐顺序');

assert.equal(typeof resultsPage.memorySpecConflict, 'function', '结果页应提供标题内存规格矛盾检测');
assert.equal(typeof resultsPage.isDisplayQualified, 'function', '结果页应提供前端展示资格判断');
const { memorySpecConflict, isDisplayQualified } = resultsPage;
assert.deepEqual(
  memorySpecConflict({ title: 'HP EliteBook 16GB 1TB', reasons: ['32GB内存'] }),
  { conflict: true, label: '标题16GB / 检测32GB · 需要人工确认' },
  '标题明确写16GB但检测为32GB时应要求人工确认',
);
assert.deepEqual(
  memorySpecConflict({ title: 'HP EliteBook 16GB×2 1TB', reasons: ['32GB内存'] }),
  { conflict: false, label: '' },
  '标题明确为16GB双通道时不应误报规格矛盾',
);
assert.equal(
  isDisplayQualified({ ...baseEntry, title: 'HP EliteBook 16GB 1TB', shouldAlert: true, conditionEligible: true }),
  false,
  '规格矛盾商品不得显示为符合提醒',
);
assert.equal(
  isDisplayQualified({ ...baseEntry, shouldAlert: true, conditionEligible: true }),
  true,
  '没有规格矛盾的后台合格商品应保持符合提醒',
);
const conflictingDangerEntry = {
  ...baseEntry,
  title: 'HP EliteBook 16GB 1TB 严重故障',
  shouldAlert: true,
  conditionEligible: true,
  reasons: [...goodReasons, '严重故障/锁机风险'],
};
assert.equal(
  primaryBlocker(conflictingDangerEntry, { maxPriceYen: 95000 }),
  '严重故障/锁机风险',
  '安全风险必须优先于标题规格矛盾',
);
assert.equal(
  isDisplayQualified(conflictingDangerEntry),
  false,
  '即使持久化提醒状态异常，安全风险商品也不得进入前端合格结果',
);
assert.equal(typeof resultsPage.formatJstShort, 'function', '结果页应提供统一的JST短时间格式');
const { formatJstShort } = resultsPage;
assert.deepEqual(
  formatJstShort('2026-08-12T03:00:00.000Z'),
  { short: '08-12 12:00', full: '2026/08/12 12:00' },
  '可见时间应简短，并保留完整JST时间供提示使用',
);
assert.deepEqual(
  formatJstShort('invalid'),
  { short: '时间不明', full: '时间不明' },
  '无效时间应使用明确占位文案',
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
assert.equal(
  matchesResultRow({ budget: '1', match: '0', grade: '2', new: '0', search: 'HP' }, 'budget', ''),
  true,
  '预算内筛选应显示价格不超过提醒线的商品',
);
assert.equal(
  matchesResultRow({ budget: '0', match: '1', grade: '4', new: '1', search: 'HP' }, 'budget', ''),
  false,
  '预算内筛选应隐藏超出提醒线的商品',
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
  {
    ...baseEntry,
    id: 'm3',
    title: 'HP EliteBook 830 G10 16GB 1TB',
    url: 'https://jp.mercari.com/item/m3',
    price: 60000,
    score: 90,
    grade: 'A',
    shouldAlert: true,
    conditionEligible: true,
    reasons: ['商品状态第2级', '32GB内存', '1TB存储', 'Intel 第13代'],
    itemConditionLevel: 2,
    itemCondition: '未使用に近い',
    likeCount: 3,
    likeCheckedAt: '2026-08-12T03:00:00.000Z',
    publishedAt: '2026-08-12T02:30:00.000Z',
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
assert.match(rendered, /<title>Mercari 笔记本监测结果<\/title>/);
assert.match(rendered, /class="summary-strip"/);
assert.doesNotMatch(rendered, /summary-card/);
assert.match(rendered, /data-filter="budget"[^>]*>[\s\S]*?预算内 ≤ ¥95,000[\s\S]*?>2</);
assert.match(rendered, /class="best-candidate"/);
assert.match(rendered, /当前最佳候选/);
assert.match(rendered, /class="best-title"[^>]*>ThinkPad X1 Carbon 32GB 1TB/);
assert.doesNotMatch(rendered, /BEST SIGNAL/);
assert.match(rendered, /收藏数（いいね）/);
const sortKeys = [...rendered.matchAll(/data-sort="([^"]+)"/g)].map((match) => match[1]);
assert.deepEqual(sortKeys, ['grade', 'price', 'decision', 'likes', 'condition', 'title', 'published']);
assert.match(rendered, /id="sort-summary"[^>]*>当前排序：推荐顺序</);
assert.match(rendered, /id="reset-sort"[^>]*hidden[^>]*>恢复推荐顺序</);
assert.match(rendered, /data-order="0"/);
assert.match(rendered, /<th[^>]*>[\s\S]*?data-sort="decision"[^>]*>判断/);
assert.doesNotMatch(rendered, /data-sort="time"|>检查时间</);
assert.doesNotMatch(rendered, /data-time=/);
assert.doesNotMatch(rendered, /<th[^>]*>\s*链接/);
assert.doesNotMatch(rendered, /class="action-cell"/);
assert.match(rendered, /class="condition-cell" title="3｜目立った傷や汚れなし">3｜无明显伤污/);
assert.match(rendered, /class="title"[^>]*>HP EliteBook 830 G10 32GB 512GB<span class="external-mark"/);
assert.match(rendered, /class="product-facts"[^>]*>状态3 ｜ 32GB ｜ SSD 512GB ｜ Intel 第13代</);
assert.match(rendered, /class="price-detail is-over">\+¥5,000/);
assert.match(rendered, /class="decision-cell"><span class="decision decision-blocked">超预算 ¥5,000/);
assert.match(rendered, /class="decision-cell"><span class="decision decision-match">符合提醒/);
assert.match(rendered, /class="decision-cell"><span class="decision decision-warning">标题16GB \/ 检测32GB · 需要人工确认/);
assert.match(rendered, /data-title="HP EliteBook 830 G10 16GB 1TB" data-match="0" data-budget="1"/);
assert.match(rendered, /data-search="[^"]*HP EliteBook[^"]*Intel 第13代[^"]*超预算 ¥5,000/);
assert.match(rendered, /class="date-cell" title="2026\/08\/12 10:30 JST">08-12 10:30/);
assert.match(rendered, /收藏数最后更新：2026\/08\/12 12:00 JST/);
assert.match(rendered, /后台正常｜上次检查/);
assert.match(rendered, /｜下次约/);
assert.match(rendered, /@media \(max-width: 920px\)/);
assert.doesNotMatch(rendered, /status-pulse/);
assert.doesNotMatch(rendered, /font-size: (?:8|9|10|11)px/);

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
