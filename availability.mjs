const REMOVED_LISTING = /該当する商品は削除されています|この商品は(?:削除されました|公開停止中です)|商品が見つかりません/;
const SOLD_COMMENT_NOTICE = /売り切れのためコメントできません/;

export function detectListingAvailability(text, httpStatus = null, soldButtonText = null) {
  const normalized = String(text ?? '').normalize('NFKC').replace(/[\s\u00a0]+/g, ' ').trim();
  const normalizedSoldButton = String(soldButtonText ?? '').normalize('NFKC').trim();
  if (httpStatus === 404 || httpStatus === 410) {
    return { removed: true, sold: false, reason: `HTTP ${httpStatus}` };
  }
  const match = normalized.match(REMOVED_LISTING);
  if (match) return { removed: true, sold: false, reason: match[0] };
  const soldMatch = normalizedSoldButton === '売り切れました'
    ? normalizedSoldButton
    : normalized.match(SOLD_COMMENT_NOTICE)?.[0];
  if (soldMatch) return { removed: false, sold: true, reason: soldMatch };
  return { removed: false, sold: false, reason: null };
}
