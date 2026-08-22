import assert from 'node:assert/strict';
import * as filters from './laptop-filters.mjs';
import { assessCandidate } from './scoring.mjs';

const allowedSeries = [...filters.DEFAULT_ALLOWED_SERIES];
const seriesCases = [
  ['Lenovo ThinkPad X1 Carbon Gen10', 'thinkpad-x1-carbon'],
  ['X1 Carbon Gen10', 'thinkpad-x1-carbon'],
  ['ThinkPad T14 Gen 3', 'thinkpad-t14'],
  ['ThinkPad T14s', 'thinkpad-t14s'],
  ['ThinkPad X13', 'thinkpad-x13'],
  ['ThinkPad P14s Gen 3', 'thinkpad-p14s'],
  ['ThinkPad P16s', 'thinkpad-p16s'],
  ['ThinkPad L14', 'thinkpad-l14'],
  ['HP EliteBook 840 G9', 'hp-elitebook'],
  ['HP EliteBook 1040 G9', 'hp-elitebook'],
  ['HP ZBook Firefly 14 G9', 'hp-zbook-firefly'],
  ['HP ZBook Power', 'hp-zbook-power'],
  ['Dell Latitude 5430', 'dell-latitude-premium'],
  ['Dynabook G83/KV', 'dynabook-g83'],
  ['Fujitsu LIFEBOOK U9312', 'fujitsu-lifebook-u9312'],
  ["Panasonic Let's note FV", 'panasonic-lets-note'],
  ['ASUS ExpertBook B5', 'asus-expertbook-b5'],
  ['NEC VersaPro UltraLite', 'nec-versapro-premium'],
  ['HP ProBook 450 G9', 'hp-probook'],
  ['Dell Precision 5570', 'dell-precision'],
  ['Dell Precision7780 Core i9', 'dell-precision'],
  ["Panasonic Let's note CF-SV2", 'panasonic-lets-note'],
  ['レッツノート CF-FV3', 'panasonic-lets-note'],
  ['CF-SV2 Core i5', 'panasonic-lets-note'],
  ['dynabook G83/HU', 'dynabook-g83'],
  ['富士通 LIFEBOOK U7412/K Core i5', 'fujitsu-lifebook-u7412'],
  ['NEC VersaPro UltraLite タイプVN Core i5', 'nec-versapro-premium'],
  ['ASUS ExpertBook B9400 Core i7', 'asus-expertbook-b9'],
  ['VAIO Pro PJ VJPJ23 Core i7', 'vaio-pro'],
  ['美品VAIO ProPJ 12.5型 i7-1360P', 'vaio-pro'],
  ['Dell Latitude 5350 Core Ultra 5', 'dell-latitude-premium'],
  ['Dell Latitude 7450 Core Ultra 7', 'dell-latitude-premium'],
  ['Dell Latitude 9450 Core Ultra 7', 'dell-latitude-premium'],
  ['HP EliteBook 840 G9 Core i5', 'hp-elitebook'],
];
for (const [title, expectedId] of seriesCases) {
  assert.equal(filters.detectLaptopSeries(title)?.id, expectedId, title);
  assert.equal(filters.isAllowedLaptopSeries(title, allowedSeries), true, title);
}
for (const title of [
  'NEC VersaPro VKM44/X-C Core i5',
  'VAIO SX12 Core i5',
  'Dell Latitude 3420 Core i5',
]) {
  assert.equal(filters.detectLaptopSeries(title), null, title);
  assert.equal(filters.isAllowedLaptopSeries(title, allowedSeries), false, title);
}

const eligibleAssessment = {
  seriesEligible: true,
  has32GB: true,
  has512GB: true,
  hasSSD: true,
};
assert.equal(filters.hardFilterFailure?.(eligibleAssessment), null);
assert.equal(filters.hardFilterFailure?.({ ...eligibleAssessment, seriesEligible: false }), 'series');
assert.equal(filters.hardFilterFailure?.({ ...eligibleAssessment, has32GB: false }), 'memory');
assert.equal(filters.hardFilterFailure?.({ ...eligibleAssessment, has512GB: false }), 'storage');
assert.equal(filters.hardFilterFailure?.({ ...eligibleAssessment, hasSSD: false }), 'ssd');
assert.equal(filters.hardFilterFailure({ ...eligibleAssessment, price: 99999 }, 99999), null);
assert.equal(filters.hardFilterFailure({ ...eligibleAssessment, price: 100000 }, 99999), 'price');
assert.equal(filters.hardFilterFailure({ ...eligibleAssessment, price: null }, 99999), null);

assert.equal(
  filters.titleHasDisallowed16GB?.('HP EliteBook 840 G9 16GB SSD512GB'),
  true,
  '标题当前规格仅16GB时必须剔除',
);
assert.equal(
  filters.titleHasDisallowed16GB?.('HP EliteBook 840 G9 16GB 最大32GB SSD512GB'),
  true,
  '标题当前16GB但仅表示最大支持32GB时必须剔除',
);
for (const title of [
  'HP EliteBook 840 G9 32GB SSD512GB',
  'HP EliteBook 840 G9 16GB×2 SSD512GB',
  'HP EliteBook 840 G9 16GBx2 SSD512GB',
  'HP EliteBook 840 G9 16GB*2 SSD512GB',
  'HP EliteBook 840 G9 16GB+16GB SSD512GB',
]) {
  assert.equal(filters.titleHasDisallowed16GB?.(title), false, `${title} 应保留`);
}
assert.equal(
  filters.hardFilterFailure(eligibleAssessment, Number.POSITIVE_INFINITY, 'HP EliteBook 16GB 最大32GB'),
  'memory',
  '新结果必须在写入前剔除标题16GB商品',
);
const assessedUpgradeable16GB = assessCandidate({
  title: 'HP EliteBook 840 G9 16GB 最大32GB',
  detail: 'メモリ32GB SSD512GB 第12世代 Core i5',
  price: 60000,
  itemCondition: '目立った傷や汚れなし',
}, { allowedSeries, minIntelGeneration: 12, maxConditionLevel: 3 });
assert.equal(
  filters.hardFilterFailure(assessedUpgradeable16GB),
  'memory',
  '实际评估结果必须携带标题并在写入前剔除可升级16GB商品',
);
for (const reason of ['外观或屏幕有缺陷', '严重故障/锁机风险']) {
  assert.equal(
    filters.hardFilterFailure({ ...eligibleAssessment, reasons: [reason] }),
    'risk',
    `${reason}必须在写入前剔除`,
  );
}

assert.equal(filters.resultMatchesHardFilters?.({
  title: 'HP ProBook 450 G9',
  seriesId: 'hp-probook',
  has32GB: true,
  has512GB: true,
  hasSSD: true,
}, allowedSeries), true);
assert.equal(filters.resultMatchesHardFilters?.({
  title: 'HP EliteBook 840 G9',
  has32GB: true,
  has512GB: true,
  hasSSD: true,
}, allowedSeries), true);
assert.equal(filters.resultMatchesHardFilters?.({
  title: 'Dell Precision 5570 32GB 512GB',
  reasons: ['32GB内存', '512GB存储', '未确认SSD'],
}, allowedSeries), false);
assert.equal(filters.resultMatchesHardFilters?.({
  title: 'ThinkPad X1 Carbon Gen 10',
  reasons: ['32GB内存', '1TB存储', 'Intel 第12代', '商务本系列'],
}, allowedSeries), true);
assert.equal(filters.resultMatchesHardFilters({
  title: 'HP ProBook 450 G9',
  seriesId: 'hp-probook',
  has32GB: true,
  has512GB: true,
  hasSSD: true,
  price: 99999,
}, allowedSeries, 99999), true);
assert.equal(filters.resultMatchesHardFilters({
  title: 'HP ProBook 450 G9',
  seriesId: 'hp-probook',
  has32GB: true,
  has512GB: true,
  hasSSD: true,
  price: 100000,
}, allowedSeries, 99999), false);
assert.equal(filters.resultMatchesHardFilters({
  title: 'HP ProBook 450 G9',
  seriesId: 'hp-probook',
  has32GB: true,
  has512GB: true,
  hasSSD: true,
  price: null,
}, allowedSeries, 99999), true);
assert.equal(filters.resultMatchesHardFilters({
  title: 'HP EliteBook 840 G9 16GB 最大32GB SSD512GB',
  seriesId: 'hp-elitebook',
  has32GB: true,
  has512GB: true,
  hasSSD: true,
}, allowedSeries), false, '已有结果中的标题16GB商品必须被清理');
assert.equal(filters.resultMatchesHardFilters({
  title: 'HP EliteBook 840 G9 16GB×2 SSD512GB',
  seriesId: 'hp-elitebook',
  has32GB: true,
  has512GB: true,
  hasSSD: true,
}, allowedSeries), true, '明确16GB双条合计32GB必须保留');
for (const reason of ['外观或屏幕有缺陷', '严重故障/锁机风险']) {
  assert.equal(filters.resultMatchesHardFilters({
    title: 'HP EliteBook 840 G9 32GB SSD512GB',
    seriesId: 'hp-elitebook',
    has32GB: true,
    has512GB: true,
    hasSSD: true,
    reasons: [reason],
  }, allowedSeries), false, `已有结果中的${reason}商品必须被清理`);
}

console.log('laptop filter tests: OK');
