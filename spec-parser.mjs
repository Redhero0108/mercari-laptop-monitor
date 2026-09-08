function compact(text) {
  return String(text ?? '')
    .normalize('NFKC')
    .replace(/[\u00a0\s]+/g, ' ')
    .trim();
}

// 前置型：容量の前に現れる増設/アップグレード表記（例「最大32GB」）。
const UPGRADE_HINT_BEFORE = /(?:最大|拡張|アップグレード|upgradeable|max(?:imum)?)/i;
// 後置型：容量の後に現れる増設表記（例「32GBまで」「32GB対応」）。
const UPGRADE_HINT_AFTER = /(?:まで|対応)/i;

/**
 * 商品テキストからメモリ容量を解析し、「実装容量」「デュアルチャネル合計」「最大サポート値」を区別する。
 * 戻り値 { detectedGB, dual16GB, quad8GB, upgradeClaim, raw }。
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
    // 「最大32GB」などの表記だけでは実装容量を確認できない。
    result.detectedGB = null;
    result.raw = mentions[0].raw;
  }
  return result;
}

const SSD_TYPE = /^(?:ssd|nvme|m\.2)$/i;
// 「型番が先」が最も確実（例 SSD1TB、SSD 512GB）。「容量が先」は追加の曖昧性解消が必要（例 512GB SSD）。
const TYPE_FIRST_RE = /(?<type>ssd|nvme|m\.2|hdd|emmc|ハードディスク|\bhd\b)\s*(?<value>\d{1,4})\s*(?<unit>tb|t|gb|g)\b/gi;
const CAP_FIRST_RE = /(?<value>\d{1,4})\s*(?<unit>tb|t|gb|g)\b\s*(?<type>ssd|nvme|m\.2|hdd|emmc|ハードディスク|\bhd\b)/gi;

/**
 * 商品テキストからストレージ機器を解析し、SSD 系と非 SSD 系（HDD/eMMC）を区別する。
 * それぞれの容量を別々に集計し、HDD の 1TB を SSD 容量と誤算しないようにする。
 * また「32GB SSD1TB」のメモリ 32GB を SSD 容量と誤算しないようにする。
 * 戻り値 { hasSSD, hasNVMe, totalSSDGB, totalNonSsdGB, ssdCapacities, nonSsdCapacities }。
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
    // 型番の後に容量が続く場合は「型番が先」のストレージに該当する（例「32GB SSD 512GB」の SSD 512GB）。
    // このとき前の 32GB はメモリなので、SSD 容量として数えてはいけない。
    if (/^\s*\d{1,4}\s*(?:tb|t|gb|g)\b/i.test(afterType)) continue;
    addDrive(match.groups.type, Number(match.groups.value), match.groups.unit);
  }
  return result;
}
