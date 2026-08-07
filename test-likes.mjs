import assert from 'node:assert/strict';
import { parseLikeCount } from './likes.mjs';

assert.equal(parseLikeCount('5'), 5);
assert.equal(parseLikeCount('1,234'), 1234);
assert.equal(parseLikeCount('１２'), 12);
assert.equal(parseLikeCount('いいね！'), 0);
assert.equal(parseLikeCount(null), null);
assert.equal(parseLikeCount('コメント'), null);

console.log('like tests: OK');
