import assert from 'node:assert/strict';
import { detectListingAvailability } from './availability.mjs';

assert.deepEqual(
  detectListingAvailability('該当する商品は削除されています。', 200),
  { removed: true, reason: '該当する商品は削除されています' },
);
assert.equal(detectListingAvailability('通常の商品ページ', 404).removed, true);
assert.equal(detectListingAvailability('目立った傷や汚れなし', 200).removed, false);
assert.equal(detectListingAvailability('', null).removed, false);

console.log('availability tests: OK');
