function compact(text) {
  return String(text ?? '')
    .normalize('NFKC')
    .replace(/[\u00a0\s]+/g, ' ')
    .trim();
}

// 前缀型：出现在容量之前的升级提示（如“最大32GB”）。
const UPGRADE_HINT_BEFORE = /(?:最大|拡張|アップグレード|upgradeable|max(?:imum)?)/i;
// 后缀型：出现在容量之后的升级提示（如“32GBまで”“32GB対応”）。
const UPGRADE_HINT_AFTER = /(?:まで|対応)/i;

/**
 * 从商品文本中解析内存容量，区分“实装容量”“双通道合计”与“最大支持值”。
 * 返回 { detectedGB, dual16GB, quad8GB, upgradeClaim, raw }。
 */
export function parseMemorySpec(text) {
  const normalized = compact(text);
  const result = {
    detectedGB: null,
    dual16GB: false,
    quad8GB: false,
    upgradeClaim: false,
    raw: null,
  };
  if (!normalized) return result;

  const dual16 = normalized.match(/(?<!\d)16\s*(?:gb|g)\s*(?:[×xX*]\s*2|\+\s*16\s*(?:gb|g))/i);
  if (dual16) {
    result.detectedGB = 32;
    result.dual16GB = true;
    result.raw = dual16[0];
    return result;
  }
  const quad8 = normalized.match(/(?<!\d)8\s*(?:gb|g)\s*[×xX*]\s*4\b/i);
  if (quad8) {
    result.detectedGB = 32;
    result.quad8GB = true;
    result.raw = quad8[0];
    return result;
  }

  const mentions = [...normalized.matchAll(/(?<!\d)(\d{1,3})\s*(?:gb|g)\b/gi)]
    .map((match) => ({
      value: Number(match[1]),
      index: match.index,
      raw: match[0],
    }));
  if (!mentions.length) return result;

  const isUpgradeMention = (mention) => {
    const before = normalized.slice(Math.max(0, mention.index - 12), mention.index);
    const after = normalized.slice(mention.index, mention.index + 16);
    return UPGRADE_HINT_BEFORE.test(before) || UPGRADE_HINT_AFTER.test(after);
  };
  const upgradeMentions = mentions.filter(isUpgradeMention);
  result.upgradeClaim = upgradeMentions.length > 0;

  const direct = mentions.filter((mention) => !isUpgradeMention(mention));
  if (direct.length) {
    result.detectedGB = direct[0].value;
    result.raw = direct[0].raw;
  } else {
    // 只有“最大32GB”等表述时，无法确认实装容量。
    result.detectedGB = null;
    result.raw = mentions[0].raw;
  }
  return result;
}

const SSD_TYPE = /^(?:ssd|nvme|m\.2)$/i;
// “类型在前”最可靠（如 SSD1TB、SSD 512GB）；“容量在前”需要额外消歧（如 512GB SSD）。
const TYPE_FIRST_RE = /(?<type>ssd|nvme|m\.2|hdd|emmc|ハードディスク|\bhd\b)\s*(?<value>\d{1,4})\s*(?<unit>tb|t|gb|g)\b/gi;
const CAP_FIRST_RE = /(?<value>\d{1,4})\s*(?<unit>tb|t|gb|g)\b\s*(?<type>ssd|nvme|m\.2|hdd|emmc|ハードディスク|\bhd\b)/gi;

/**
 * 从商品文本中解析存储设备，区分 SSD 类与非 SSD 类（HDD/eMMC），
 * 并分别累计容量，避免把 HDD 的 1TB 误算成 SSD 容量，
 * 也避免把“32GB SSD1TB”中的内存 32GB 误算成 SSD 容量。
 * 返回 { hasSSD, hasNVMe, totalSSDGB, totalNonSsdGB, ssdCapacities, nonSsdCapacities }。
 */
export function parseStorageSpec(text) {
  const normalized = compact(text);
  const result = {
    hasSSD: false,
    hasNVMe: false,
    totalSSDGB: 0,
    totalNonSsdGB: 0,
    ssdCapacities: [],
    nonSsdCapacities: [],
  };
  if (!normalized) return result;

  const addDrive = (type, value, unit) => {
    if (!Number.isFinite(value)) return;
    const normalizedType = String(type).toLowerCase();
    const capacityGB = String(unit).toLowerCase().startsWith('t') ? value * 1000 : value;
    if (SSD_TYPE.test(normalizedType)) {
      result.hasSSD = true;
      result.hasNVMe = result.hasNVMe || /nvme|m\.2/.test(normalizedType);
      result.totalSSDGB += capacityGB;
      result.ssdCapacities.push(capacityGB);
    } else {
      result.totalNonSsdGB += capacityGB;
      result.nonSsdCapacities.push(capacityGB);
    }
  };

  for (const match of normalized.matchAll(TYPE_FIRST_RE)) {
    addDrive(match.groups.type, Number(match.groups.value), match.groups.unit);
  }
  for (const match of normalized.matchAll(CAP_FIRST_RE)) {
    const afterType = normalized.slice(match.index + match[0].length);
    // 若该类型后面紧跟容量，说明它属于“类型在前”的存储（如“32GB SSD 512GB”里的 SSD 512GB），
    // 此时前面的 32GB 是内存，不应算作 SSD 容量。
    if (/^\s*\d{1,4}\s*(?:tb|t|gb|g)\b/i.test(afterType)) continue;
    addDrive(match.groups.type, Number(match.groups.value), match.groups.unit);
  }
  return result;
}
