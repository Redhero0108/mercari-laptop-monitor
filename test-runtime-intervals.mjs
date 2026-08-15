import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const config = JSON.parse(await readFile(new URL('./config.json', import.meta.url), 'utf8'));
const monitorSource = await readFile(new URL('./monitor.mjs', import.meta.url), 'utf8');

assert.equal(config.pollMinutes, 10, '新品搜索间隔必须为10分钟');
assert.equal(config.likesRefreshMinutes, 10, '现有商品资料刷新间隔必须为10分钟');
assert.match(monitorSource, /pollMinutes:\s*10,/, '缺省新品搜索间隔必须为10分钟');
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
