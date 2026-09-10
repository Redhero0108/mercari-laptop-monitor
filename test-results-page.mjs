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
  { label: '2｜ほぼ未使用', title: '2｜未使用に近い' },
  '商品状态2应显示紧凑中文，同时保留完整原文',
);
assert.deepEqual(
  compactCondition(baseEntry),
  { label: '3｜目立った傷や汚れなし', title: '3｜目立った傷や汚れなし' },
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
  ['状態3', '32GB', 'SSD 512GB', 'Intel 第13世代', 'HP EliteBook', 'バッテリー状態が良好'],
  '商品说明应转成固定顺序的结构化摘要',
);
assert.deepEqual(
  productFacts({
    itemConditionLevel: 2,
    reasons: ['商品状态第2级', '32GB内存', '1TB存储', '未确认SSD', 'Ryzen 7', '指定系列：ThinkPad T系列'],
  }),
  ['状態2', '32GB', '1TB', 'Ryzen 7', 'ThinkPad T系列'],
  'SSD未确认时不得在结构化摘要中写成SSD',
);
assert.equal(sortDescription('likes', 'desc'), 'いいね数 降順');
assert.equal(sortDescription('price', 'asc'), '価格 昇順');
assert.equal(sortDescription(), 'おすすめ順');

assert.equal(typeof resultsPage.memorySpecConflict, 'function', '结果页应提供标题内存规格矛盾检测');
assert.equal(typeof resultsPage.isDisplayQualified, 'function', '结果页应提供前端展示资格判断');
const { memorySpecConflict, isDisplayQualified } = resultsPage;
assert.deepEqual(
  memorySpecConflict({ title: 'HP EliteBook 16GB 1TB', reasons: ['32GB内存'] }),
  { conflict: true, label: 'タイトル16GB / 検出32GB・要確認' },
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
  '深刻な故障・ロックのリスク',
  '安全风险必须优先于标题规格矛盾',
);
assert.equal(
  isDisplayQualified(conflictingDangerEntry),
  false,
  '即使持久化提醒状态异常，安全风险商品也不得进入前端合格结果',
);

for (const helper of ['storageSpecConflict', 'specConfidence', 'priceTrend', 'recentChangeBadges', 'compareRecommendedEntries']) {
  assert.equal(typeof resultsPage[helper], 'function', `结果页应提供${helper}辅助函数`);
}
const {
  storageSpecConflict,
  specConfidence,
  priceTrend,
  recentChangeBadges,
  compareRecommendedEntries,
} = resultsPage;
assert.deepEqual(
  storageSpecConflict({ title: 'EliteBook 32GB SSD512GB', reasons: ['1TB存储'] }),
  { conflict: true, label: 'タイトル512GB / 検出1TB・要確認' },
  '标题存储和检测存储不一致时应要求人工确认',
);
assert.deepEqual(
  storageSpecConflict({ title: 'EliteBook 32GB SSD 512GB', reasons: ['512GB存储'] }),
  { conflict: false, label: '' },
  '标题和检测存储一致时不得误报',
);
assert.deepEqual(
  storageSpecConflict({ title: 'EliteBook 32GB SSD256GB', reasons: ['512GB存储'] }),
  { conflict: true, label: 'タイトル256GB / 検出512GB・要確認' },
  '标题明确写256GB时应识别存储冲突',
);

const titleConfirmed = {
  ...baseEntry,
  title: 'HP EliteBook 830 G10 32GB SSD 512GB',
  reasons: [...goodReasons, '指定系列：HP EliteBook'],
};
assert.equal(specConfidence(titleConfirmed).label, 'タイトル確認');
assert.equal(specConfidence({ ...titleConfirmed, title: 'HP EliteBook 830 G10' }).label, '詳細確認');
assert.equal(
  specConfidence({ ...titleConfirmed, title: 'HP EliteBook 16GB SSD 512GB' }).label,
  'スペック矛盾',
);
assert.equal(specConfidence({ title: 'HP EliteBook', reasons: [] }).label, '情報不足');
assert.equal(
  isDisplayQualified({ ...titleConfirmed, title: 'HP EliteBook 32GB SSD 256GB', shouldAlert: true, conditionEligible: true }),
  false,
  '存储规格冲突商品不得显示为符合提醒',
);
assert.equal(
  primaryBlocker(
    { ...titleConfirmed, title: 'HP EliteBook 32GB SSD 256GB', shouldAlert: true, conditionEligible: true },
    { maxPriceYen: 95000 },
  ),
  'タイトル256GB / 検出512GB・要確認',
  '存储规格冲突应成为主要判断原因',
);

const changedHistoryEntry = {
  firstSeenAt: '2026-08-15T00:00:00.000Z',
  priceHistory: [
    { value: 70000, at: '2026-08-14T00:00:00.000Z' },
    { value: 65000, at: '2026-08-15T10:00:00.000Z' },
  ],
  likeHistory: [
    { value: 3, at: '2026-08-14T00:00:00.000Z' },
    { value: 5, at: '2026-08-15T11:00:00.000Z' },
  ],
};
assert.deepEqual(
  priceTrend(changedHistoryEntry),
  { previous: 70000, current: 65000, delta: -5000, changedAt: '2026-08-15T10:00:00.000Z' },
  '价格趋势应比较最近两个不同价格',
);
assert.equal(priceTrend({ priceHistory: [{ value: 65000, at: '2026-08-15T10:00:00.000Z' }] }), null);
assert.deepEqual(
  recentChangeBadges(changedHistoryEntry, Date.parse('2026-08-15T12:00:00.000Z')).map((badge) => badge.label),
  ['新着', '値下げ', 'いいね +2'],
  '24小时变化应区分新发现、降价和收藏增加',
);
assert.deepEqual(
  recentChangeBadges(changedHistoryEntry, Date.parse('2026-08-17T12:00:00.000Z')),
  [],
  '超过24小时的变化不得继续显示短期标记',
);

const recommendedEntries = [
  { ...titleConfirmed, id: 'unqualified', shouldAlert: false, conditionEligible: true, score: 100, price: 50000, checkedAt: '2026-08-15T11:00:00.000Z' },
  { ...titleConfirmed, id: 'lower-score', shouldAlert: true, conditionEligible: true, score: 70, price: 60000, checkedAt: '2026-08-15T10:00:00.000Z' },
  { ...titleConfirmed, id: 'higher-price', shouldAlert: true, conditionEligible: true, score: 80, price: 70000, checkedAt: '2026-08-15T10:00:00.000Z' },
  { ...titleConfirmed, id: 'recommended', shouldAlert: true, conditionEligible: true, score: 80, price: 65000, checkedAt: '2026-08-15T09:00:00.000Z' },
];
assert.deepEqual(
  [...recommendedEntries].sort(compareRecommendedEntries).map((entry) => entry.id),
  ['recommended', 'higher-price', 'lower-score', 'unqualified'],
  '推荐顺序应依次比较资格、分数和价格',
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
  { short: '時刻不明', full: '時刻不明' },
  '无效时间应使用明确占位文案',
);

const searchable = searchText({
  ...baseEntry,
  grade: 'S',
  reasons: ['32GB内存', 'Intel 第13代', '商务本系列'],
}, '¥90,000', '予算超過 ¥5,000');
for (const expected of ['HP EliteBook', '32GB内存', 'Intel 第13代', '目立った傷や汚れなし', 'S', '¥90,000', '予算超過 ¥5,000']) {
  assert.ok(searchable.includes(expected), `搜索文本应包含：${expected}`);
}

assert.equal(
  primaryBlocker({ ...baseEntry, reasons: [...goodReasons, '严重故障/锁机风险'], price: 120000 }, { maxPriceYen: 95000, minScore: 58 }),
  '深刻な故障・ロックのリスク',
  '安全风险必须优先于价格原因',
);
assert.equal(
  primaryBlocker({ ...baseEntry, reasons: [...goodReasons, '不是目标Windows笔记本'] }, { maxPriceYen: 95000, minScore: 58 }),
  '対象外のWindowsノートPC',
);
assert.equal(
  primaryBlocker({ ...baseEntry, reasons: goodReasons.filter((reason) => reason !== '32GB内存') }, { maxPriceYen: 95000, minScore: 58 }),
  '32GBメモリ未確認',
);
assert.equal(
  primaryBlocker({ ...baseEntry, reasons: goodReasons.filter((reason) => reason !== '512GB存储') }, { maxPriceYen: 95000, minScore: 58 }),
  '512GB以上のストレージ未確認',
);
assert.equal(
  primaryBlocker({ ...baseEntry, reasons: [...goodReasons, '未确认SSD'] }, { maxPriceYen: 95000, minScore: 58 }),
  'SSD未確認',
);
assert.equal(
  primaryBlocker({ ...baseEntry, price: null }, { maxPriceYen: 95000, minScore: 58 }),
  '価格不明',
);
assert.equal(
  primaryBlocker({ ...baseEntry, price: 100000 }, { maxPriceYen: 95000, minScore: 58 }),
  '予算超過 ¥5,000',
);
assert.equal(
  primaryBlocker({ ...baseEntry, price: 70001 }),
  '予算超過 ¥1',
);
assert.equal(
  primaryBlocker({ ...baseEntry, score: 50 }, { maxPriceYen: 95000, minScore: 58 }),
  'スコアが通知基準未満',
);
assert.equal(
  primaryBlocker({ ...baseEntry, shouldAlert: true }, { maxPriceYen: 95000, minScore: 58 }),
  '通知条件合致',
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
assert.equal(
  matchesResultRow(
    { match: '1', changed: '1', grade: '3', search: 'elitebook', series: 'hp-elitebook', triage: 'watch' },
    'changed',
    'EliteBook',
    { series: 'hp-elitebook', triage: 'watch' },
  ),
  true,
  '变化、搜索、系列和浏览状态筛选应能同时命中',
);
assert.equal(
  matchesResultRow(
    { match: '1', changed: '1', grade: '3', search: 'elitebook', series: 'hp-elitebook', triage: 'ignored' },
    'all',
    '',
    { series: 'all', triage: 'active' },
  ),
  false,
  '默认活跃商品筛选应隐藏忽略项',
);
assert.equal(
  matchesResultRow(
    { match: '1', changed: '1', grade: '3', search: 'elitebook', series: 'hp-elitebook', triage: 'ignored' },
    'all',
    '',
    { series: 'all', triage: 'ignored' },
  ),
  true,
  '忽略筛选应重新显示忽略项',
);

const renderEntries = [
  {
    ...baseEntry,
    id: 'm1',
    title: 'HP EliteBook 830 G10 32GB SSD 512GB',
    url: 'https://jp.mercari.com/item/m1',
    price: 100000,
    score: 55,
    grade: 'B',
    shouldAlert: false,
    conditionEligible: true,
    likeCount: 4,
    likeCheckedAt: '2026-08-12T03:00:00.000Z',
    firstSeenAt: '2026-08-12T01:00:00.000Z',
    priceHistory: [
      { value: 105000, at: '2026-08-11T03:00:00.000Z' },
      { value: 100000, at: '2026-08-12T03:00:00.000Z' },
    ],
    likeHistory: [
      { value: 2, at: '2026-08-11T03:00:00.000Z' },
      { value: 4, at: '2026-08-12T03:00:00.000Z' },
    ],
    seriesId: 'hp-elitebook',
    seriesLabel: 'HP EliteBook',
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
    seriesId: 'thinkpad-x1-carbon',
    seriesLabel: 'ThinkPad X1 Carbon',
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
    seriesId: 'hp-elitebook',
    seriesLabel: 'HP EliteBook',
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
assert.match(rendered, /10分ごとに自動更新/);
assert.match(rendered, /refreshMonitorStatus\(\);/);
assert.match(rendered, /ageMs > 900_000/);
assert.doesNotMatch(rendered, /setInterval\(refreshMonitorStatus/);
assert.match(rendered, /type="search"/);
assert.match(rendered, /aria-label="商品を検索"/);
assert.match(rendered, /id="result-count"/);
assert.match(rendered, /mercari-laptop-monitor-search/);
assert.match(rendered, /<title>Mercari ノートPC監視結果<\/title>/);
assert.match(rendered, /<link rel="icon" href="data:,">/);
assert.match(rendered, /class="summary-strip"/);
assert.doesNotMatch(rendered, /summary-card/);
assert.match(rendered, /data-filter="budget"[^>]*>[\s\S]*?予算内 ≤ ¥95,000[\s\S]*?>2</);
assert.match(rendered, /data-filter="changed"[^>]*>[\s\S]*?24H 変動あり[\s\S]*?>1</);
assert.doesNotMatch(rendered, /data-filter="new"[^>]*>[\s\S]*?24H 新上架/);
assert.match(rendered, /class="best-candidate"/);
assert.match(rendered, /現在の最有力候補/);
assert.match(rendered, /class="best-title"[^>]*>ThinkPad X1 Carbon 32GB 1TB/);
assert.doesNotMatch(rendered, /BEST SIGNAL/);
assert.match(rendered, /いいね数/);
const sortKeys = [...rendered.matchAll(/data-sort="([^"]+)"/g)].map((match) => match[1]);
assert.deepEqual(sortKeys, ['grade', 'price', 'decision', 'likes', 'condition', 'title', 'published']);
assert.match(rendered, /id="sort-summary"[^>]*>現在の並び順：おすすめ順</);
assert.match(rendered, /class="recommendation-help"[^>]*title="おすすめ順：通知条件合致を優先し、次にスコア・価格・確認時刻で並べ替え"/);
assert.match(rendered, /id="reset-sort"[^>]*hidden[^>]*>おすすめ順に戻す</);
assert.match(rendered, /id="series-filter"[^>]*aria-label="シリーズで絞り込み"/);
assert.match(rendered, /value="hp-elitebook">HP EliteBook</);
assert.match(rendered, /value="thinkpad-x1-carbon">ThinkPad X1 Carbon</);
assert.match(rendered, /id="triage-filter"[^>]*aria-label="閲覧状態で絞り込み"/);
assert.match(rendered, /value="active">アクティブ商品</);
assert.match(rendered, /data-order="0"/);
assert.match(rendered, /data-id="m1"[^>]*data-series="hp-elitebook"[^>]*data-changed="1"/);
assert.match(rendered, /<th[^>]*>[\s\S]*?data-sort="decision"[^>]*>判定/);
assert.doesNotMatch(rendered, /data-sort="time"|>检查时间</);
assert.doesNotMatch(rendered, /data-time=/);
assert.doesNotMatch(rendered, /<th[^>]*>\s*链接/);
assert.doesNotMatch(rendered, /class="action-cell"/);
assert.match(rendered, /class="grade-cell" aria-label="Bランク"><span class="grade grade-B" aria-hidden="true">B<\/span><\/td>/);
assert.doesNotMatch(rendered, /class="grade-label"/);
assert.match(rendered, /class="condition-cell" title="3｜目立った傷や汚れなし"><span class="condition-text">3｜目立った傷や汚れなし<\/span><\/td>/);
assert.match(rendered, /class="product-main"><div class="product-copy">[\s\S]*?<\/div><span class="product-actions">[\s\S]*?未確認[\s\S]*?詳細[\s\S]*?<\/span><\/div>/);
assert.match(rendered, /class="title"[^>]*>HP EliteBook 830 G10 32GB SSD 512GB<span class="external-mark"/);
assert.match(rendered, /class="product-facts"[^>]*>状態3 ｜ 32GB ｜ SSD 512GB ｜ Intel 第13世代</);
assert.match(rendered, /class="change-badge change-new"[^>]*>新着</);
assert.match(rendered, /class="change-badge change-price-down"[^>]*>値下げ</);
assert.match(rendered, /class="change-badge change-likes-up"[^>]*>いいね \+2</);
assert.match(rendered, /class="price-trend trend-down"[^>]*>↓¥5,000</);
assert.match(rendered, /class="triage-status"[^>]*>未確認</);
assert.match(rendered, /class="detail-toggle"[^>]*aria-expanded="false"[^>]*aria-controls="details-m1"[^>]*>詳細</);
assert.match(rendered, /id="details-m1" class="product-details" hidden/);
assert.match(rendered, /class="confidence confidence-title"[^>]*>タイトル確認</);
assert.match(rendered, /判定理由/);
assert.match(rendered, /元の商品状態/);
assert.match(rendered, /最終確認/);
assert.match(rendered, /data-triage-action="watch"[^>]*aria-pressed="false"[^>]*>ウォッチ</);
assert.match(rendered, /class="price-detail is-over">\+¥5,000/);
assert.match(rendered, /class="decision-cell"><span class="decision decision-blocked">予算超過 ¥5,000/);
assert.match(rendered, /class="decision-cell"><span class="decision decision-match">通知条件合致/);
assert.match(rendered, /class="decision-cell"><span class="decision decision-warning">タイトル16GB \/ 検出32GB・要確認/);
assert.match(rendered, /data-title="HP EliteBook 830 G10 16GB 1TB" data-match="0" data-budget="1"/);
assert.match(rendered, /data-search="[^"]*HP EliteBook[^"]*Intel 第13代[^"]*予算超過 ¥5,000/);
assert.match(rendered, /class="date-cell" title="2026\/08\/12 10:30 JST">08-12 10:30/);
assert.match(rendered, /いいね数 最終更新：2026\/08\/12 12:00 JST/);
assert.match(rendered, /バックグラウンド正常｜前回チェック/);
assert.match(rendered, /｜次回目安/);
assert.match(rendered, /@media \(max-width: 920px\)/);
assert.match(rendered, /@media \(max-width: 920px\)[\s\S]*?th:nth-child\(5\), td:nth-child\(5\), th:nth-child\(7\), td:nth-child\(7\) \{ display: none; \}/);
assert.match(rendered, /@media \(prefers-reduced-motion: reduce\)/);
assert.doesNotMatch(rendered, /status-pulse/);
assert.doesNotMatch(rendered, /font-size: (?:8|9|10|11)px/);

const inlineScript = rendered.match(/<script>\s*([\s\S]*?)\s*<\/script>/)?.[1];
assert.ok(inlineScript, '结果页应包含交互脚本');
assert.doesNotThrow(() => new Function(inlineScript), '结果页交互脚本必须是有效JavaScript');
assert.match(inlineScript, /mercari-laptop-monitor-triage-v1/);
assert.match(inlineScript, /mercari-laptop-monitor-series/);

const emptyRendered = renderResultsPage([], { likesRefreshMinutes: 10 }, { nowMs: Date.now() });
assert.match(emptyRendered, /colspan="7"/);
assert.match(emptyRendered, /現在の絞り込み・検索に一致する商品はありません/);

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
