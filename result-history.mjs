const MAX_HISTORY_POINTS = 12;

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
