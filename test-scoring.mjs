import assert from 'node:assert/strict';
import { assessCandidate, detectCpu, parsePrice } from './scoring.mjs';

assert.equal(parsePrice('¥\n85,800\nHP'), 85800);
assert.equal(detectCpu('Core i5-1335U 第13世代').generation, 13);
assert.equal(detectCpu('i7-1360P').generation, 13);
assert.equal(detectCpu('Ultra 7 255H').family, 'core-ultra');
assert.equal(detectCpu('Core i7-1165G7').generation, 11);
assert.equal(detectCpu('Core i5-10210U').eligible, true);
assert.equal(detectCpu('Ryzen 7 5700U').series, 5);

const strong = assessCandidate({
  title: 'HP EliteBook 630 G10 第13世代 i5-1335U 32GB SSD1TB Windows11 Pro',
  detail: '13.3インチ FHD バッテリー未消耗',
  price: 70000,
  itemCondition: '目立った傷や汚れなし',
});
assert.equal(strong.shouldAlert, true);
assert.ok(strong.score >= 58);

const priceBoundaryTitle = 'HP EliteBook 840 G10 第13世代 i5-1335U 32GB SSD1TB Windows11 Pro';
const alertAtPriceCeiling = assessCandidate({
  title: priceBoundaryTitle,
  detail: '14インチ FHD バッテリー良好',
  price: 70000,
  itemCondition: '目立った傷や汚れなし',
});
assert.equal(alertAtPriceCeiling.shouldAlert, true);
assert.equal(assessCandidate({
  title: priceBoundaryTitle,
  detail: '14インチ FHD バッテリー良好',
  price: 70001,
  itemCondition: '目立った傷や汚れなし',
}).shouldAlert, false);
assert.equal(assessCandidate({
  title: 'HP EliteBook 630 G10 第13世代 i5-1335U 32GB SSD1TB Windows11 Pro',
  detail: '13.3インチ FHD',
  price: 85800,
  itemCondition: '目立った傷や汚れなし',
}, { maxConditionLevel: 2 }).shouldAlert, false);

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
  itemCondition: '未使用に近い',
}, { minIntelGeneration: 10 });
assert.equal(tenthGen.shouldAlert, true);
assert.equal(assessCandidate({
  title: tenthGen.cpu.label + ' HP ProBook Core i5-10210U 32GB SSD 1TB Windows11',
  detail: '第10世代 1920x1080',
  price: 30000,
  itemCondition: '未使用に近い',
}, { minIntelGeneration: 11 }).shouldAlert, false);
assert.equal(assessCandidate({
  title: 'HP ProBook Core i5-10210U 32GB SSD 1TB Windows11',
  detail: '第10世代 1920x1080',
  price: 30000,
  itemCondition: '未使用に近い',
}, { minIntelGeneration: 12, intelOnly: true }).shouldAlert, false);

const twelfthGen = assessCandidate({
  title: 'ThinkPad X1 Carbon Core i5-1240P 32GB SSD 1TB Windows11',
  detail: '第12世代 1920x1200',
  price: 65000,
  itemCondition: '目立った傷や汚れなし',
}, { minIntelGeneration: 12, intelOnly: true });
assert.equal(twelfthGen.cpu.generation, 12);
assert.equal(twelfthGen.shouldAlert, true);

const ryzenIncluded = assessCandidate({
  title: 'Ryzen 7 7840U 32GB SSD 1TB Windows11',
  price: 65000,
  itemCondition: '目立った傷や汚れなし',
}, { minIntelGeneration: 12, minRyzenSeries: 6, intelOnly: false });
assert.equal(ryzenIncluded.cpu.eligible, true);
assert.equal(ryzenIncluded.shouldAlert, true);

const oldRyzenExcluded = assessCandidate({
  title: 'Ryzen 7 5700U 32GB SSD 1TB Windows11',
  price: 65000,
  itemCondition: '目立った傷や汚れなし',
}, { minIntelGeneration: 12, minRyzenSeries: 6, intelOnly: false });
assert.equal(oldRyzenExcluded.cpu.eligible, false);
assert.equal(oldRyzenExcluded.shouldAlert, false);

const coreUltra = assessCandidate({
  title: 'Intel Core Ultra 7 155H 32GB SSD 1TB Windows11',
  price: 90000,
  itemCondition: '未使用に近い',
}, { minIntelGeneration: 12, intelOnly: true });
assert.equal(coreUltra.cpu.family, 'core-ultra');
assert.equal(coreUltra.cpu.eligible, true);

const junk = assessCandidate({
  title: 'Core i5-1335U 32GB SSD 1TB Windows11 JUNK品',
  price: 30000,
});
assert.equal(junk.shouldAlert, false);

const ssd512 = assessCandidate({
  title: 'HP EliteBook 第13世代 Core i5-1335U 32GB SSD512GB Windows11 Pro',
  detail: 'FHD バッテリー良好',
  price: 70000,
  itemCondition: '新品、未使用',
});
assert.equal(ssd512.has512GB, true);
assert.equal(ssd512.has1TB, false);
assert.equal(ssd512.hasSSD, true);

const replaceable256 = assessCandidate({
  title: 'ThinkPad T14 第12世代 Core i5 32GB SSD256GB 可更换 支持扩容至2TB Windows11',
  price: 55000,
  itemCondition: '目立った傷や汚れなし',
}, { minIntelGeneration: 12, intelOnly: true });
assert.equal(replaceable256.has512GB, true);
assert.equal(replaceable256.shouldAlert, true);

const fixed256 = assessCandidate({
  title: 'ThinkPad T14 第12世代 Core i5 32GB SSD256GB Windows11',
  price: 55000,
  itemCondition: '目立った傷や汚れなし',
}, { minIntelGeneration: 12, intelOnly: true });
assert.equal(fixed256.has512GB, false);
assert.equal(fixed256.shouldAlert, false);
assert.equal(ssd512.shouldAlert, true);

const hdd512 = assessCandidate({
  title: 'HP EliteBook 第13世代 Core i5-1335U 32GB HDD 512GB Windows11 Pro',
  detail: 'FHD バッテリー良好',
  price: 50000,
});
assert.equal(hdd512.hasSSD, false);
assert.equal(hdd512.shouldAlert, false);

const conditionLevel4 = assessCandidate({
  title: 'HP EliteBook 第13世代 Core i5-1335U 32GB SSD1TB Windows11 Pro',
  detail: 'FHD バッテリー良好',
  price: 76800,
  itemCondition: 'やや傷や汚れあり',
});
assert.equal(conditionLevel4.itemConditionLevel, 4);
assert.equal(conditionLevel4.conditionEligible, false);
assert.equal(conditionLevel4.shouldAlert, false);

const unknownCondition = assessCandidate({
  title: 'HP EliteBook 第13世代 Core i5-1335U 32GB SSD1TB Windows11 Pro',
  price: 70000,
});
assert.equal(unknownCondition.conditionEligible, false);
assert.equal(unknownCondition.shouldAlert, false);

const allowedSeries = [
  'thinkpad-x1-carbon',
  'hp-probook',
  'dell-precision',
  'panasonic-lets-note',
  'dynabook-g83',
  'fujitsu-lifebook-u7412',
  'nec-versapro-premium',
  'asus-expertbook-b9',
  'vaio-pro',
  'dell-latitude-premium',
  'hp-elitebook',
];
const targetSeriesCases = [
  ['ThinkPad X1 Carbon Gen 10 Core i5-1240P 32GB NVMe 512GB', 'thinkpad-x1-carbon'],
  ['HP ProBook 450 G9 Core i5-1235U 32GB SSD 512GB', 'hp-probook'],
  ['Dell Precision 5570 Core i7-12700H 32GB NVMe 1TB', 'dell-precision'],
  ['Panasonic レッツノート CF-SV2 Core i5-1245U 32GB SSD 512GB', 'panasonic-lets-note'],
  ['dynabook G83/HU Core i5-1240P 32GB SSD 512GB', 'dynabook-g83'],
  ['Fujitsu LIFEBOOK U7412/K Core i5-1240P 32GB SSD 512GB', 'fujitsu-lifebook-u7412'],
  ['NEC VersaPro UltraLite タイプVN Core i5-1335U 32GB SSD 512GB', 'nec-versapro-premium'],
  ['ASUS ExpertBook B9400 Core i5-1240P 32GB SSD 512GB', 'asus-expertbook-b9'],
  ['VAIO Pro PJ Core i5-1235U 32GB SSD 512GB', 'vaio-pro'],
  ['Dell Latitude 5350 Core Ultra 5 32GB SSD 512GB', 'dell-latitude-premium'],
  ['HP EliteBook 840 G9 Core i5-1235U 32GB SSD 512GB', 'hp-elitebook'],
];
for (const [title, expectedSeriesId] of targetSeriesCases) {
  const assessment = assessCandidate({
    title,
    price: 60000,
    itemCondition: '目立った傷や汚れなし',
  }, { minIntelGeneration: 12, intelOnly: true, allowedSeries });
  assert.equal(assessment.series?.id, expectedSeriesId, title);
  assert.equal(assessment.seriesEligible, true, title);
  assert.equal(assessment.shouldAlert, true, title);
}

const restrictedLatitude = assessCandidate({
  title: 'Dell Latitude 3420 Core i5-1235U 32GB SSD 1TB',
  price: 60000,
  itemCondition: '目立った傷や汚れなし',
}, { minIntelGeneration: 12, intelOnly: true, allowedSeries });
assert.equal(restrictedLatitude.series, null);
assert.equal(restrictedLatitude.seriesEligible, false);
assert.equal(restrictedLatitude.shouldAlert, false);

for (const title of [
  'NEC VersaPro UltraLite タイプVN Core i5-1335U 32GB SSD 512GB',
  'ASUS ExpertBook B9400 Core i5-1240P 32GB SSD 512GB',
]) {
  const assessment = assessCandidate({
    title,
    price: 60000,
    itemCondition: '目立った傷や汚れなし',
  }, { minIntelGeneration: 12, intelOnly: true, allowedSeries });
  assert.ok(assessment.reasons.includes('商务本系列'), title);
}

const genericVersaPro = assessCandidate({
  title: 'NEC VersaPro VKM44/X-C Core i5-1235U 32GB SSD 512GB',
  price: 60000,
  itemCondition: '目立った傷や汚れなし',
}, { minIntelGeneration: 12, intelOnly: true, allowedSeries });
assert.equal(genericVersaPro.seriesEligible, false);
assert.equal(genericVersaPro.reasons.includes('商务本系列'), false);

console.log('scoring tests: OK');
