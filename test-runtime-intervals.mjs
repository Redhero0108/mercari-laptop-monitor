import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const config = JSON.parse(await readFile(new URL('./config.json', import.meta.url), 'utf8'));
const monitorSource = await readFile(new URL('./monitor.mjs', import.meta.url), 'utf8');

assert.equal(config.pollMinutes, 10, '新品搜索间隔必须为10分钟');
assert.equal(config.likesRefreshMinutes, 10, '现有商品资料刷新间隔必须为10分钟');
assert.equal(config.maxPriceYen, 70000, '提醒价格上限必须为70000日元');
assert.equal(config.maxResultPriceYen, 99999, '结果页价格上限必须保持99999日元');
assert.deepEqual(config.allowedSeries, [
  'thinkpad-x1-carbon',
  'thinkpad-t14',
  'thinkpad-t14s',
  'thinkpad-x13',
  'thinkpad-p14s',
  'thinkpad-p16s',
  'thinkpad-l14',
  'hp-probook',
  'dell-precision',
  'panasonic-lets-note',
  'dynabook-g83',
  'fujitsu-lifebook-u7412',
  'fujitsu-lifebook-u9312',
  'nec-versapro-premium',
  'asus-expertbook-b9',
  'asus-expertbook-b5',
  'hp-zbook-firefly',
  'hp-zbook-power',
  'vaio-pro',
  'dell-latitude-premium',
  'hp-elitebook',
], '当前配置必须允许全部扩展后的品质商务系列');
assert.match(monitorSource, /pollMinutes:\s*10,/, '缺省新品搜索间隔必须为10分钟');
assert.match(monitorSource, /maxPriceYen:\s*70000,/, '缺省提醒价格上限必须为70000日元');
assert.match(monitorSource, /maxResultPriceYen:\s*99999,/, '缺省结果页价格上限必须保持99999日元');
for (const query of [
  'LIFEBOOK U7412 32GB',
  'NEC VersaPro 32GB',
  'ExpertBook B9 32GB',
  'VAIO Pro 32GB',
  'Dell Latitude 32GB',
  'HP EliteBook 32GB',
]) {
  assert.ok(monitorSource.includes(`'${query}'`), `缺省关键词必须包含 ${query}`);
}
assert.match(
  monitorSource,
  /config\.pollMinutes\s*=\s*Math\.max\(2,\s*Number\(config\.pollMinutes\)\s*\|\|\s*10\)/,
  '无效配置必须回退到10分钟',
);
assert.doesNotMatch(
  monitorSource,
  /setInterval\(\(\)\s*=>\s*\{\s*writeMonitorStatus\(\)/,
  '等待期间不得通过定时器持续写入心跳状态',
);

console.log('runtime interval tests: OK');
