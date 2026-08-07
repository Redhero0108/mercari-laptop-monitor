const REMOVED_LISTING = /該当する商品は削除されています|この商品は(?:削除されました|公開停止中です)|商品が見つかりません/;

export function detectListingAvailability(text, httpStatus = null) {
  const normalized = String(text ?? '').normalize('NFKC').replace(/[\s\u00a0]+/g, ' ').trim();
  if (httpStatus === 404 || httpStatus === 410) {
    return { removed: true, reason: `HTTP ${httpStatus}` };
  }
  const match = normalized.match(REMOVED_LISTING);
  if (match) return { removed: true, reason: match[0] };
  return { removed: false, reason: null };
}
