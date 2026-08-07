import assert from 'node:assert/strict';
import { assessCandidate, detectCpu, parsePrice } from './scoring.mjs';

assert.equal(parsePrice('¥\n85,800\nHP'), 85800);
assert.equal(detectCpu('Core i5-1335U 第13世代').generation, 13);
assert.equal(detectCpu('Core i7-1165G7').generation, 11);
assert.equal(detectCpu('Core i5-10210U').eligible, true);
assert.equal(detectCpu('Ryzen 7 5700U').series, 5);

const strong = assessCandidate({
  title: 'HP EliteBook 630 G10 第13世代 i5-1335U 32GB SSD1TB Windows11 Pro',
  detail: '13.3インチ FHD バッテリー未消耗',
  price: 85800,
});
assert.equal(strong.shouldAlert, true);
assert.ok(strong.score >= 58);

const weak = assessCandidate({
  title: 'Windows11 32GB SSD1TB Intel Celeron N5095',
  price: 24444,
});
assert.equal(weak.shouldAlert, false);

const broken = assessCandidate({
  title: '第13世代 i5 32GB 1TB ジャンク 液晶割れ',
  price: 30000,
});
assert.equal(broken.shouldAlert, false);

const warrantyWording = assessCandidate({
  title: 'dynabook Core i7 8550U 32GB 新品SSD 1TB Windows11',
  price: 54600,
  detail: '商品到着後、1週間以内に電源が入らないなどの不具合が発生した場合、対応します。第8世代 Core i7。',
});
assert.equal(warrantyWording.cpu.generation, 8);
assert.equal(warrantyWording.shouldAlert, false);
assert.ok(warrantyWording.score > -40, '保修措辞不应被误判为当前严重故障');

const tenthGen = assessCandidate({
  title: 'HP ProBook Core i5-10210U 32GB SSD 1TB Windows11',
  detail: '第10世代 1920x1080',
  price: 30000,
}, { minIntelGeneration: 10 });
assert.equal(tenthGen.shouldAlert, true);
assert.equal(assessCandidate({
  title: tenthGen.cpu.label + ' HP ProBook Core i5-10210U 32GB SSD 1TB Windows11',
  detail: '第10世代 1920x1080',
  price: 30000,
}, { minIntelGeneration: 11 }).shouldAlert, false);

const junk = assessCandidate({
  title: 'Core i5-1335U 32GB SSD 1TB Windows11 JUNK品',
  price: 30000,
});
assert.equal(junk.shouldAlert, false);

const ssd512 = assessCandidate({
  title: 'HP EliteBook 第13世代 Core i5-1335U 32GB SSD512GB Windows11 Pro',
  detail: 'FHD バッテリー良好',
  price: 76800,
});
assert.equal(ssd512.has512GB, true);
assert.equal(ssd512.has1TB, false);
assert.equal(ssd512.hasSSD, true);
assert.equal(ssd512.shouldAlert, true);

const hdd512 = assessCandidate({
  title: 'HP EliteBook 第13世代 Core i5-1335U 32GB HDD 512GB Windows11 Pro',
  detail: 'FHD バッテリー良好',
  price: 50000,
});
assert.equal(hdd512.hasSSD, false);
assert.equal(hdd512.shouldAlert, false);

console.log('scoring tests: OK');
