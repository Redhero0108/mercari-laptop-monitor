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
    id: 'thinkpad-t14',
    label: 'ThinkPad T14',
    pattern: /\bthink\s*pad\s+t14(?:\b|\s|[-/])/i,
  },
  {
    id: 'thinkpad-t14s',
    label: 'ThinkPad T14s',
    pattern: /\bthink\s*pad\s+t14s\b/i,
  },
  {
    id: 'thinkpad-x13',
    label: 'ThinkPad X13',
    pattern: /\bthink\s*pad\s+x13\b/i,
  },
  {
    id: 'thinkpad-p14s',
    label: 'ThinkPad P14s',
    pattern: /\bthink\s*pad\s+p14s\b/i,
  },
  {
    id: 'thinkpad-p16s',
    label: 'ThinkPad P16s',
    pattern: /\bthink\s*pad\s+p16s\b/i,
  },
  {
    id: 'thinkpad-l14',
    label: 'ThinkPad L14',
    pattern: /\bthink\s*pad\s+l14\b/i,
  },
  {
    id: 'hp-probook',
    label: 'HP ProBook',
    pattern: /(?:\bhp\s+)?\bpro\s*book\b/i,
  },
  {
    id: 'dell-precision',
    label: 'Dell Precision',
    pattern: /(?:\bdell\s+)?\bprecision(?:\b|(?=\d{4}\b))/i,
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
  {
    id: 'fujitsu-lifebook-u7412',
    label: 'Fujitsu LIFEBOOK U7412',
    pattern: /\blife\s*book\s*u7412\b/i,
  },
  {
    id: 'fujitsu-lifebook-u9312',
    label: 'Fujitsu LIFEBOOK U9312',
    pattern: /\blife\s*book\s*u9312\b/i,
  },
  {
    id: 'nec-versapro-premium',
    label: 'NEC VersaPro Premium Mobile',
    pattern: /^(?=.*\bversapro\b)(?=.*(?:ultra\s*lite|タイプ\s*v(?:n|g|h|m)\b))/i,
  },
  {
    id: 'asus-expertbook-b9',
    label: 'ASUS ExpertBook B9',
    pattern: /\bexpert\s*book\s*b9(?:\d{3})?\b/i,
  },
  {
    id: 'asus-expertbook-b5',
    label: 'ASUS ExpertBook B5',
    pattern: /\bexpert\s*book\s*b5(?:\d{3})?\b/i,
  },
  {
    id: 'hp-zbook-firefly',
    label: 'HP ZBook Firefly',
    pattern: /(?:\bhp\s+)?\bz\s*book\s+firefly\b/i,
  },
  {
    id: 'hp-zbook-power',
    label: 'HP ZBook Power',
    pattern: /(?:\bhp\s+)?\bz\s*book\s+power\b/i,
  },
  {
    id: 'vaio-pro',
    label: 'VAIO Pro',
    pattern: /\bvaio\s*pro(?:\b|(?=(?:pj|pg|pk|bk|bm)\b))/i,
  },
  {
    id: 'dell-latitude-premium',
    label: 'Dell Latitude 5000/7000/9000',
    pattern: /\blatitude\s*(?:5|7|9)\d{3}\b/i,
  },
  {
    id: 'hp-elitebook',
    label: 'HP EliteBook',
    pattern: /(?:\bhp\s+)?\belite\s*book\b/i,
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

export function titleHasDisallowed16GB(title) {
  const normalized = compact(title);
  const explicitDual16GB = /(?<!\d)16\s*(?:gb|g)\s*(?:[x×*]\s*2|\+\s*16\s*(?:gb|g))/i.test(normalized);
  if (explicitDual16GB) return false;
  return /(?<!\d)16\s*(?:gb|g)\b/i.test(normalized);
}

function hasDisallowedRiskReason(reasons) {
  const text = Array.isArray(reasons) ? reasons.join(' ') : String(reasons ?? '');
  return /外观或屏幕有缺陷|严重故障\/锁机风险/.test(text);
}

export function hardFilterFailure(
  assessment,
  maxResultPriceYen = Number.POSITIVE_INFINITY,
  title = assessment?.title,
) {
  if (assessment?.seriesEligible !== true) return 'series';
  if (assessment?.has32GB !== true) return 'memory';
  if (titleHasDisallowed16GB(title)) return 'memory';
  if (assessment?.has512GB !== true) return 'storage';
  if (assessment?.hasSSD !== true) return 'ssd';
  if (hasDisallowedRiskReason(assessment?.reasons)) return 'risk';
  if (Number.isFinite(assessment?.price) && assessment.price > maxResultPriceYen) return 'price';
  return null;
}

function persistedBoolean(entry, property, fallback) {
  return typeof entry?.[property] === 'boolean' ? entry[property] : fallback;
}

export function resultMatchesHardFilters(
  entry,
  allowedSeries = DEFAULT_ALLOWED_SERIES,
  maxResultPriceYen = Number.POSITIVE_INFINITY,
) {
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
  const priceEligible = !Number.isFinite(entry?.price) || entry.price <= maxResultPriceYen;
  const titleMemoryEligible = !titleHasDisallowed16GB(entry?.title);
  const riskEligible = !hasDisallowedRiskReason(entry?.reasons);
  return seriesEligible
    && has32GB
    && has512GB
    && hasSSD
    && priceEligible
    && titleMemoryEligible
    && riskEligible;
}
