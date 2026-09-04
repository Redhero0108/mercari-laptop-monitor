import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseLikeCount } from './likes.mjs';

assert.equal(parseLikeCount('5'), 5);
assert.equal(parseLikeCount('1,234'), 1234);
assert.equal(parseLikeCount('１２'), 12);
assert.equal(parseLikeCount('いいね！'), 0);
assert.equal(parseLikeCount(null), null);
assert.equal(parseLikeCount('コメント'), null);

const adapterSource = await readFile(new URL('./mercari-adapter.mjs', import.meta.url), 'utf8');
assert.match(adapterSource, /querySelector\('\[data-testid="icon-heart-button"\]'\)/, '点赞抓取必须读取点赞按钮本身的文字');

console.log('like tests: OK');
