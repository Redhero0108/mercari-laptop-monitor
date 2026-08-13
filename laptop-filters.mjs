function compact(text) {
  return String(text ?? '')
    .normalize('NFKC')
    .replace(/[\u00a0\s]+/g, ' ')
    .trim();
}

const SERIES_RULES = [
  {
    id: 'thinkpad-x1-carbon',
    label: 'ThinkPad X1 Carbon',
    pattern: /\bx1\s*carbon\b|\bx1carbon\b/i,
  },
  {
    id: 'hp-probook',
    label: 'HP ProBook',
    pattern: /(?:\bhp\s+)?\bpro\s*book\b/i,
  },
  {
    id: 'dell-precision',
    label: 'Dell Precision',
    pattern: /(?:\bdell\s+)?\bprecision\b/i,
  },
  {
    id: 'panasonic-lets-note',
    label: "Panasonic Let's note",
    pattern: /(?:\bpanasonic\s+)?(?:\blet['’]?s\s*note\b|\bletsnote\b|レッツノート)|\bcf-(?:fv|lv|sv|qv|sr|qr|sc)[a-z0-9/-]*\b/i,
  },
  {
    id: 'dynabook-g83',
    label: 'Dynabook G83',
    pattern: /\bdynabook\s*g83\b|(?:^|\s)g83(?:\/[a-z0-9]+)?\b/i,
  },
];

export const DEFAULT_ALLOWED_SERIES = Object.freeze(SERIES_RULES.map(({ id }) => id));

export function detectLaptopSeries(text) {
  const normalized = compact(text);
  const rule = SERIES_RULES.find(({ pattern }) => pattern.test(normalized));
  return rule ? { id: rule.id, label: rule.label } : null;
}

export function isAllowedLaptopSeries(text, allowedSeries = DEFAULT_ALLOWED_SERIES) {
  const series = typeof text === 'object' && text?.id ? text : detectLaptopSeries(text);
  return Boolean(series && Array.isArray(allowedSeries) && allowedSeries.includes(series.id));
}

export function hardFilterFailure(assessment) {
  if (assessment?.seriesEligible !== true) return 'series';
  if (assessment?.has32GB !== true) return 'memory';
  if (assessment?.has512GB !== true) return 'storage';
  if (assessment?.hasSSD !== true) return 'ssd';
  return null;
}

function persistedBoolean(entry, property, fallback) {
  return typeof entry?.[property] === 'boolean' ? entry[property] : fallback;
}

export function resultMatchesHardFilters(entry, allowedSeries = DEFAULT_ALLOWED_SERIES) {
  const reasons = Array.isArray(entry?.reasons) ? entry.reasons.join(' ') : String(entry?.reasons ?? '');
  const text = compact(`${entry?.title ?? ''} ${reasons}`);
  const series = entry?.seriesId
    ? { id: entry.seriesId, label: entry.seriesLabel ?? entry.seriesId }
    : detectLaptopSeries(text);
  const seriesEligible = isAllowedLaptopSeries(series, allowedSeries);
  const has32GB = persistedBoolean(entry, 'has32GB', /(?:\b32\s*(?:gb|g)\b|32GB内存)/i.test(text));
  const has512GB = persistedBoolean(
    entry,
    'has512GB',
    /(?:\b512\s*(?:gb|g)\b|\b1\s*tb\b|512GB存储|1TB存储)/i.test(text),
  );
  const hasSSD = persistedBoolean(entry, 'hasSSD', !/未确认SSD/.test(reasons));
  return seriesEligible && has32GB && has512GB && hasSSD;
}
