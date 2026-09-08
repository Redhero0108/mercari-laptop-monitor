const MAX_HISTORY_POINTS = 12;

/**
 * 値下げについて通知すべきかを判定する。「価格が実際に下がり、現在通知条件を満たし、
 * かつその価格で未通知」の場合のみ値下げ情報を返し、それ以外は null を返す。
 */
export function evaluatePriceDrop({
  previousPrice,
  currentPrice,
  shouldAlert = false,
  maxPriceYen = Number.POSITIVE_INFINITY,
  lastAlertedPrice = null,
}) {
  if (!Number.isFinite(previousPrice) || !Number.isFinite(currentPrice)) return null;
  if (currentPrice >= previousPrice) return null;
  if (shouldAlert !== true) return null;
  if (currentPrice > maxPriceYen) return null;
  if (Number.isFinite(lastAlertedPrice) && lastAlertedPrice === currentPrice) return null;
  return { previousPrice, currentPrice, delta: currentPrice - previousPrice };
}

function validTimestamp(value, fallback) {
  return Number.isFinite(Date.parse(value)) ? value : fallback;
}

function normalizeHistory(points, isValidValue) {
  if (!Array.isArray(points)) return [];
  return points
    .filter((point) => point && isValidValue(point.value) && Number.isFinite(Date.parse(point.at)))
    .map((point) => ({ value: point.value, at: point.at }))
    .slice(-MAX_HISTORY_POINTS);
}

function appendDistinct(points, value, at, isValidValue) {
  if (!isValidValue(value)) return points;
  if (points.at(-1)?.value === value) return points;
  return [...points, { value, at }].slice(-MAX_HISTORY_POINTS);
}

export function mergeResultHistory(previous, current, observedAt, baseline = {}) {
  const observationTime = validTimestamp(observedAt, new Date().toISOString());
  const firstSeenAt = validTimestamp(
    previous?.firstSeenAt,
    validTimestamp(baseline?.firstSeenAt, validTimestamp(previous?.checkedAt, observationTime)),
  );
  const validPrice = (value) => Number.isFinite(value) && value > 0;
  const validLikes = (value) => Number.isInteger(value) && value >= 0;

  let priceHistory = normalizeHistory(previous?.priceHistory, validPrice);
  if (priceHistory.length === 0) {
    priceHistory = appendDistinct(
      priceHistory,
      baseline?.price,
      validTimestamp(baseline?.firstSeenAt, firstSeenAt),
      validPrice,
    );
  }
  priceHistory = appendDistinct(
    priceHistory,
    previous?.price,
    validTimestamp(previous?.checkedAt, observationTime),
    validPrice,
  );
  priceHistory = appendDistinct(priceHistory, current?.price, observationTime, validPrice);

  let likeHistory = normalizeHistory(previous?.likeHistory, validLikes);
  likeHistory = appendDistinct(
    likeHistory,
    previous?.likeCount,
    validTimestamp(previous?.likeCheckedAt, validTimestamp(previous?.checkedAt, observationTime)),
    validLikes,
  );
  likeHistory = appendDistinct(likeHistory, current?.likeCount, observationTime, validLikes);

  return {
    ...current,
    firstSeenAt,
    priceHistory,
    likeHistory,
  };
}
