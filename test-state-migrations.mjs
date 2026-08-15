import assert from 'node:assert/strict';
import { DEFAULT_ALLOWED_SERIES } from './laptop-filters.mjs';
import { restoreNewlyAllowedSeriesSkips } from './state-migrations.mjs';

const state = {
  initialized: true,
  seen: {
    newlyAllowed: {
      title: 'Dell Latitude 5350 Core Ultra 5 32GB SSD 512GB',
      filtered: '不在指定五个商务系列中',
    },
    stillDisallowed: {
      title: 'Dell Latitude 3420 Core i5 32GB SSD 512GB',
      filtered: '不在指定五个商务系列中',
    },
    wrongReason: {
      title: 'HP EliteBook 840 G9 Core i5 32GB SSD 256GB',
      filtered: '存储不足512GB或无法确认',
    },
    normalSeen: {
      title: 'VAIO Pro PJ Core i5 32GB SSD 512GB',
      seenAt: '2026-08-15T00:00:00.000Z',
    },
  },
};

assert.deepEqual(
  restoreNewlyAllowedSeriesSkips(state, [...DEFAULT_ALLOWED_SERIES]),
  ['newlyAllowed'],
);
assert.equal(state.initialized, true);
assert.deepEqual(Object.keys(state.seen).sort(), ['normalSeen', 'stillDisallowed', 'wrongReason']);
assert.deepEqual(restoreNewlyAllowedSeriesSkips(state, [...DEFAULT_ALLOWED_SERIES]), []);

const alternateMessageState = {
  initialized: true,
  seen: {
    vaio: {
      title: 'VAIO Pro PJ Core i5 32GB SSD 512GB',
      filtered: '非指定商务系列',
    },
  },
};
assert.deepEqual(
  restoreNewlyAllowedSeriesSkips(alternateMessageState, [...DEFAULT_ALLOWED_SERIES]),
  ['vaio'],
);

console.log('state migration tests: OK');
