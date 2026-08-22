import { conditionLevel } from './conditions.mjs';
import { detectLaptopSeries, isAllowedLaptopSeries } from './laptop-filters.mjs';
import { parseMemorySpec, parseStorageSpec } from './spec-parser.mjs';

const BUSINESS_MODELS = /elitebook|probook|latitude|thinkpad|dynabook\s*g\d|lifebook\s*u|let'?s\s*note|vaio\s*pro|expertbook\s*b9/i;
const SEVERE_DEFECTS = /ジャンク|junk|部品取り|起動不可|電源(?:が)?入らない|ssdなし|ストレージなし|画面割れ|液晶割れ|bios(?:ロック|パスワード)|パスワード不明/i;

function hasSevereDefect(text) {
  // 中古店常见的保修句子会写“电源打不开时请联系”，这不代表当前机器无法开机。
  const riskText = text
    .replace(/電源(?:が)?入らないなどの不具合が発生した場合/g, '')
    .replace(/(?:ジャンク(?:品)?|起動不可|部品取り)(?:ではありません|ではない)/g, '');
  return SEVERE_DEFECTS.test(riskText);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function compact(text) {
  return String(text ?? '')
    .normalize('NFKC')
    .replace(/[\u00a0\s]+/g, ' ')
    .trim();
}

function hasUpgradeable256GBStorage(text) {
  const has256GB = /256\s*(?:gb|g)\b/i.test(text);
  const hasUpgradeLanguage = /可更换|可替换|可升级|支持扩容|扩容|換装|交換可能|増設可能|upgradeable|replaceable|expandable/i.test(text);
  const supportsAtLeast1TB = /(?:1\s*tb|1000\s*gb|1024\s*gb|[2-9]\s*tb)\b|1\s*tb以上|1t以上/i.test(text);
  return has256GB && hasUpgradeLanguage && supportsAtLeast1TB;
}

export function parsePrice(text) {
  const match = compact(text).match(/[¥￥]\s*([\d,]+)/);
  return match ? Number(match[1].replaceAll(',', '')) : null;
}

function detectIntelGeneration(text) {
  const explicit = text.match(/第?\s*(1[0-5]|[7-9])\s*世代/i);
  if (explicit) return Number(explicit[1]);

  const model = text.match(/(?:core\s*)?i[3579]\s*[- ]?\s*(\d{4,5})[a-z]*/i);
  if (!model) return null;
  const digits = model[1];
  const firstTwo = Number(digits.slice(0, 2));
  return firstTwo >= 10 && firstTwo <= 15 ? firstTwo : Number(digits[0]);
}

function detectRyzenSeries(text) {
  const model = text.match(/ryzen(?:\s+ai)?\s*[3579]?\s*[- ]?\s*(\d{4})[a-z]*/i);
  return model ? Number(model[1][0]) : null;
}

export function detectCpu(text) {
  const normalized = compact(text);
  if (/\b(?:core\s*)?ultra\s*[3579]\b/i.test(normalized)) {
    return { family: 'core-ultra', label: 'Intel Core Ultra', eligible: true, fairPrice: 120000, score: 30 };
  }
  if (/celeron|pentium|atom|n5095|n5105|n100\b|n95\b/i.test(normalized)) {
    return { family: 'low-end', label: '低功耗入门CPU', eligible: false, fairPrice: 30000, score: -45 };
  }

  const intelGeneration = detectIntelGeneration(normalized);
  if (intelGeneration !== null) {
    const scoreByGeneration = { 7: -25, 8: -12, 9: -8, 10: 7, 11: 16, 12: 23, 13: 27, 14: 29, 15: 30 };
    const fairByGeneration = { 7: 30000, 8: 40000, 9: 45000, 10: 55000, 11: 65000, 12: 78000, 13: 90000, 14: 105000, 15: 115000 };
    return {
      family: 'intel',
      generation: intelGeneration,
      label: `Intel 第${intelGeneration}代`,
      eligible: intelGeneration >= 10,
      fairPrice: fairByGeneration[intelGeneration] ?? 80000,
      score: scoreByGeneration[intelGeneration] ?? 0,
    };
  }

  if (/ryzen\s*ai/i.test(normalized)) {
    return { family: 'ryzen-ai', label: 'Ryzen AI', eligible: true, fairPrice: 120000, score: 30 };
  }
  const ryzenSeries = detectRyzenSeries(normalized);
  if (ryzenSeries !== null) {
    const scoreBySeries = { 3: -12, 4: 6, 5: 19, 6: 23, 7: 27, 8: 29, 9: 30 };
    const fairBySeries = { 3: 35000, 4: 50000, 5: 70000, 6: 80000, 7: 90000, 8: 105000, 9: 120000 };
    return {
      family: 'ryzen',
      series: ryzenSeries,
      label: `Ryzen ${ryzenSeries}000系列`,
      eligible: ryzenSeries >= 5,
      fairPrice: fairBySeries[ryzenSeries] ?? 75000,
      score: scoreBySeries[ryzenSeries] ?? 0,
    };
  }

  return { family: 'unknown', label: 'CPU型号不明', eligible: false, fairPrice: 70000, score: -15 };
}

export function assessCandidate({ title, detail = '', price = null, itemCondition = null }, config = {}) {
  const text = compact(`${title} ${detail}`);
  const resolvedPrice = price ?? parsePrice(text);
  const series = detectLaptopSeries(text);
  const seriesRestricted = Array.isArray(config.allowedSeries);
  const seriesEligible = !seriesRestricted || isAllowedLaptopSeries(series, config.allowedSeries);
  const cpu = { ...detectCpu(text) };
  if (cpu.family === 'intel') {
    cpu.eligible = cpu.generation >= Number(config.minIntelGeneration ?? 10);
  } else if (cpu.family === 'ryzen') {
    cpu.eligible = cpu.series >= Number(config.minRyzenSeries ?? 5);
  }
  if (config.intelOnly === true && !['intel', 'core-ultra'].includes(cpu.family)) {
    cpu.eligible = false;
  }
  const reasons = [];
  let score = 0;

  const memory = parseMemorySpec(text);
  const storage = parseStorageSpec(text);
  const has32GB = memory.detectedGB === 32;
  const has1TB = storage.totalSSDGB >= 1000;
  const has512GB = has1TB || storage.totalSSDGB >= 512 || hasUpgradeable256GBStorage(text);
  const hasSSD = storage.hasSSD;
  const hasWindows11 = /windows\s*11|win\s*11/i.test(text);
  const excludedPlatform = /macbook|chromebook|chrome\s*os|iMac/i.test(text);
  const severeDefect = hasSevereDefect(text);
  const itemConditionLevel = conditionLevel(itemCondition);
  const maxConditionLevel = Number(config.maxConditionLevel ?? 3);
  const conditionEligible = itemConditionLevel !== null && itemConditionLevel <= maxConditionLevel;

  if (conditionEligible) {
    reasons.push(`商品状态第${itemConditionLevel}级`);
  } else if (itemConditionLevel !== null) {
    score -= 30;
    reasons.push(`商品状态第${itemConditionLevel}级，不在筛选范围`);
  } else {
    score -= 20;
    reasons.push('商品状态无法确认');
  }

  if (has32GB) {
    score += 13;
    reasons.push('32GB内存');
  } else {
    score -= 35;
  }
  if (has1TB) {
    score += 13;
    reasons.push('1TB存储');
  } else if (has512GB) {
    score += 10;
    reasons.push(hasUpgradeable256GBStorage(text) ? '256GB但明确可升级至1TB以上' : '512GB存储');
  } else {
    score -= 30;
  }
  if (!hasSSD) {
    score -= 25;
    reasons.push('未确认SSD');
  }

  score += cpu.score;
  reasons.push(cpu.label);

  if (resolvedPrice !== null) {
    const valueDelta = clamp(Math.round((cpu.fairPrice - resolvedPrice) / 1500), -25, 30);
    score += valueDelta;
    if (valueDelta >= 12) reasons.push('价格明显低于同级参考线');
    else if (valueDelta >= 3) reasons.push('价格合理');
    else if (valueDelta <= -10) reasons.push('价格偏高');
    if (resolvedPrice < 25000 && cpu.eligible) {
      score -= 18;
      reasons.push('低价异常，需防故障或描述不实');
    }
  }

  if (BUSINESS_MODELS.test(text) || series?.id === 'nec-versapro-premium') {
    score += 6;
    reasons.push('商务本系列');
  }
  if (seriesRestricted) {
    reasons.push(seriesEligible ? `指定系列：${series.label}` : '非指定商务系列');
  }
  if (/full\s*hd|fhd|1920\s*[x×*]\s*1080|1920\s*[x×*]\s*1200/i.test(text)) score += 3;
  if (/バッテリー.{0,12}(?:未消耗|良好|9\d\s*%|100\s*%)/i.test(text)) {
    score += 5;
    reasons.push('电池描述较好');
  }
  if (/新品.{0,8}(?:ssd|nvme)|(?:ssd|nvme).{0,8}新品/i.test(text)) score += 3;
  if (hasWindows11) score += 2;

  if (/訳あり|難あり/i.test(text)) {
    score -= 25;
    reasons.push('有瑕疵说明');
  }
  if (/液晶.{0,8}(?:ムラ|シミ|線)|底面.{0,8}割れ|筐体.{0,8}割れ|破損|キー.{0,8}(?:剥がれ|欠け)/i.test(text)) {
    score -= 14;
    reasons.push('外观或屏幕有缺陷');
  }
  if (/バッテリー.{0,10}(?:不良|不可|劣化|持ちません)/i.test(text)) {
    score -= 16;
    reasons.push('电池状态较差');
  }
  if (severeDefect) {
    score -= 80;
    reasons.push('严重故障/锁机风险');
  }
  if (excludedPlatform) {
    score -= 80;
    reasons.push('不是目标Windows笔记本');
  }

  const minScore = Number(config.minScore ?? 58);
  const maxPriceYen = Number(config.maxPriceYen ?? 70000);
  const shouldAlert = Boolean(
    has32GB
      && has512GB
      && hasSSD
      && seriesEligible
      && cpu.eligible
      && conditionEligible
      && !severeDefect
      && !excludedPlatform
      && resolvedPrice !== null
      && resolvedPrice <= maxPriceYen
      && score >= minScore
  );

  const grade = score >= 75 ? 'S' : score >= 60 ? 'A' : score >= 45 ? 'B' : 'C';
  return {
    title: String(title ?? ''),
    score,
    grade,
    shouldAlert,
    price: resolvedPrice,
    cpu,
    has32GB,
    has512GB,
    has1TB,
    hasSSD,
    series,
    seriesEligible,
    itemConditionLevel,
    conditionEligible,
    reasons,
  };
}
