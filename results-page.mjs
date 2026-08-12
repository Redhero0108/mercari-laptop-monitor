export function compactCondition(entry) {
  const level = Number.isInteger(entry?.itemConditionLevel) ? entry.itemConditionLevel : null;
  const labels = {
    1: '新品',
    2: '近乎未使用',
    3: '无明显伤污',
  };
  if (level === null) {
    const fallback = entry?.conditionCheckedAt ? '无法取得' : '尚未检查';
    return { label: fallback, title: fallback };
  }
  const original = entry?.itemCondition || '状态名称不明';
  return {
    label: `${level}｜${labels[level] ?? original}`,
    title: `${level}｜${original}`,
  };
}

export function searchText(entry, priceText) {
  const reasons = Array.isArray(entry?.reasons) ? entry.reasons.join(' ') : String(entry?.reasons ?? '');
  return [
    entry?.title,
    reasons,
    entry?.itemCondition,
    entry?.grade,
    priceText,
  ].filter(Boolean).join(' ');
}

export function primaryBlocker(entry, config = {}) {
  if (entry?.shouldAlert === true && entry?.conditionEligible !== false) return '符合提醒';
  const reasons = Array.isArray(entry?.reasons) ? entry.reasons : [];
  if (reasons.includes('严重故障/锁机风险')) return '严重故障/锁机风险';
  if (reasons.includes('不是目标Windows笔记本')) return '非目标Windows笔记本';
  if (!reasons.includes('32GB内存')) return '未确认32GB内存';
  if (!reasons.some((reason) => reason === '512GB存储' || reason === '1TB存储')) {
    return '未确认512GB以上存储';
  }
  if (reasons.includes('未确认SSD')) return '未确认SSD';
  if (!Number.isFinite(entry?.price)) return '价格不明';
  const maxPriceYen = Number(config.maxPriceYen ?? 95000);
  if (entry.price > maxPriceYen) {
    return `超预算 ¥${(entry.price - maxPriceYen).toLocaleString('ja-JP')}`;
  }
  return '评分低于提醒线';
}
