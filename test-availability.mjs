import assert from 'node:assert/strict';
import { detectListingAvailability } from './availability.mjs';

assert.deepEqual(
  detectListingAvailability('該当する商品は削除されています。', 200),
  { removed: true, sold: false, reason: '該当する商品は削除されています' },
);
assert.equal(detectListingAvailability('通常の商品ページ', 404).removed, true);
assert.equal(detectListingAvailability('目立った傷や汚れなし', 200).removed, false);
assert.equal(detectListingAvailability('', null).removed, false);
assert.deepEqual(
  detectListingAvailability('通常の商品ページ', 200, '売り切れました'),
  { removed: false, sold: true, reason: '売り切れました' },
);
assert.equal(detectListingAvailability('売り切れました記念セール', 200).sold, false);
assert.equal(detectListingAvailability('※売り切れのためコメントできません', 200).sold, true);
assert.equal(detectListingAvailability('通常の商品ページ', 200).sold, false);

console.log('availability tests: OK');
