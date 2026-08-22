import assert from 'node:assert/strict';
import { parseMemorySpec, parseStorageSpec } from './spec-parser.mjs';

// 内存：实装容量识别
assert.equal(parseMemorySpec('32GB').detectedGB, 32);
assert.equal(parseMemorySpec('メモリ 32GB').detectedGB, 32);
assert.equal(parseMemorySpec('Memory 32G').detectedGB, 32);
assert.equal(parseMemorySpec('8GB').detectedGB, 8);
assert.equal(parseMemorySpec('16GB').detectedGB, 16);
assert.equal(parseMemorySpec('').detectedGB, null);

// 内存：双通道/四通道合计
assert.deepEqual(parseMemorySpec('16GB×2'), { detectedGB: 32, dual16GB: true, quad8GB: false, upgradeClaim: false, raw: '16GB×2' });
assert.equal(parseMemorySpec('16GBx2').detectedGB, 32);
assert.equal(parseMemorySpec('16GB*2').detectedGB, 32);
assert.equal(parseMemorySpec('16GB+16GB').detectedGB, 32);
assert.equal(parseMemorySpec('8GB×4').detectedGB, 32);
assert.equal(parseMemorySpec('8GBx4').detectedGB, 32);

// 内存：最大支持值不得当作实装
assert.equal(parseMemorySpec('最大32GB').detectedGB, null);
assert.equal(parseMemorySpec('最大32GB').upgradeClaim, true);
assert.equal(parseMemorySpec('最大メモリ32GB').detectedGB, null);
assert.equal(parseMemorySpec('32GBまで拡張').detectedGB, null);
assert.equal(parseMemorySpec('32GB対応').detectedGB, null);

// 内存：实装 + 最大支持值并存时，取实装容量
assert.equal(parseMemorySpec('16GB 最大32GB').detectedGB, 16);
assert.equal(parseMemorySpec('16GB 最大32GB').upgradeClaim, true);
assert.equal(parseMemorySpec('32GB(最大64GB)').detectedGB, 32);

// 存储：SSD 容量识别
assert.deepEqual(parseStorageSpec('SSD 512GB'), {
  hasSSD: true,
  hasNVMe: false,
  totalSSDGB: 512,
  totalNonSsdGB: 0,
  ssdCapacities: [512],
  nonSsdCapacities: [],
});
assert.equal(parseStorageSpec('SSD512GB').totalSSDGB, 512);
assert.equal(parseStorageSpec('SSD 1TB').totalSSDGB, 1000);
assert.equal(parseStorageSpec('NVMe 1TB').hasNVMe, true);
assert.equal(parseStorageSpec('M.2 512GB').hasSSD, true);
assert.equal(parseStorageSpec('512GB SSD').totalSSDGB, 512);

// 存储：HDD 不得计为 SSD
const hddOnly = parseStorageSpec('HDD 512GB');
assert.equal(hddOnly.hasSSD, false);
assert.equal(hddOnly.totalSSDGB, 0);
assert.equal(hddOnly.totalNonSsdGB, 512);
assert.equal(parseStorageSpec('ハードディスク 1TB').hasSSD, false);
assert.equal(parseStorageSpec('eMMC 128GB').hasSSD, false);

// 存储：内存容量不得被误算为 SSD 容量
assert.equal(parseStorageSpec('32GB SSD1TB').totalSSDGB, 1000);
assert.equal(parseStorageSpec('32GB SSD 512GB').totalSSDGB, 512);
assert.equal(parseStorageSpec('メモリ32GB SSD512GB').totalSSDGB, 512);

// 存储：SSD + HDD 组合只把 SSD 部分计入 SSD 容量
const combo = parseStorageSpec('SSD 256GB + HDD 1TB');
assert.equal(combo.hasSSD, true);
assert.equal(combo.totalSSDGB, 256);
assert.equal(combo.totalNonSsdGB, 1000);

const combo2 = parseStorageSpec('HDD 1TB + SSD256GB');
assert.equal(combo2.hasSSD, true);
assert.equal(combo2.totalSSDGB, 256);

// 存储：无设备信息
assert.equal(parseStorageSpec('').hasSSD, false);

console.log('spec parser tests: OK');
