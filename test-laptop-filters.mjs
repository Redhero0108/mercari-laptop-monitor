import assert from 'node:assert/strict';
import * as filters from './laptop-filters.mjs';

const allowedSeries = [...filters.DEFAULT_ALLOWED_SERIES];
const seriesCases = [
  ['Lenovo ThinkPad X1 Carbon Gen10', 'thinkpad-x1-carbon'],
  ['X1 Carbon Gen10', 'thinkpad-x1-carbon'],
  ['HP ProBook 450 G9', 'hp-probook'],
  ['Dell Precision 5570', 'dell-precision'],
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
  'Fujitsu LIFEBOOK U9312 Core i5',
  'NEC VersaPro VKM44/X-C Core i5',
  'ASUS ExpertBook B5 Core i5',
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

console.log('laptop filter tests: OK');
