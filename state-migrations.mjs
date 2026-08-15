import { isAllowedLaptopSeries } from './laptop-filters.mjs';

const SERIES_REJECTION_MESSAGES = new Set([
  '不在指定五个商务系列中',
  '非指定商务系列',
]);

export function restoreNewlyAllowedSeriesSkips(state, allowedSeries) {
  if (!state?.seen || typeof state.seen !== 'object' || !Array.isArray(allowedSeries)) return [];

  const restoredIds = [];
  for (const [id, entry] of Object.entries(state.seen)) {
    if (!SERIES_REJECTION_MESSAGES.has(entry?.filtered)) continue;
    if (!isAllowedLaptopSeries(entry?.title, allowedSeries)) continue;
    delete state.seen[id];
    restoredIds.push(id);
  }
  return restoredIds;
}
