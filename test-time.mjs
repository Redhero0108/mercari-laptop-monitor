import assert from 'node:assert/strict';
import { extractPublishedAtFromPhotoUrls, formatJstMinute } from './time.mjs';

const itemId = 'm96758795097';
const publishedAt = extractPublishedAtFromPhotoUrls([
  'https://static.mercdn.net/item/detail/orig/photos/other_1.jpg?1786024407',
  `https://static.mercdn.net/item/detail/orig/photos/${itemId}_1.jpg?1786024407`,
], itemId, Date.UTC(2026, 7, 7));

assert.equal(publishedAt, '2026-08-06T13:53:27.000Z');
assert.equal(formatJstMinute(publishedAt), '2026/08/06 22:53');
assert.equal(extractPublishedAtFromPhotoUrls([
  `https://static.mercdn.net/item/detail/orig/photos/${itemId}_2.jpg?1786024407`,
], itemId, Date.UTC(2026, 7, 7)), null);
assert.equal(formatJstMinute(null), '无法取得');

console.log('time tests: OK');
