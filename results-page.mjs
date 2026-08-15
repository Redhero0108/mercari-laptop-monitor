export function memorySpecConflict(entry) {
  const reasons = Array.isArray(entry?.reasons) ? entry.reasons : [];
  if (!reasons.includes('32GB内存')) return { conflict: false, label: '' };

  const title = String(entry?.title ?? '').normalize('NFKC');
  const explicit32GB = /(?<!\d)32\s*(?:gb|g)(?![a-z])/i.test(title);
  const dual16GB = /(?<!\d)16\s*(?:gb|g)\s*(?:[x×*]\s*2|\+\s*16\s*(?:gb|g))/i.test(title);
  if (explicit32GB || dual16GB) return { conflict: false, label: '' };

  const mentionedSizes = [...title.matchAll(/(?<!\d)(4|8|12|16|24|48|64)\s*(?:gb|g)(?![a-z])/gi)]
    .map((match) => Number(match[1]));
  const conflictingSize = mentionedSizes[0];
  return Number.isFinite(conflictingSize)
    ? { conflict: true, label: `标题${conflictingSize}GB / 检测32GB · 需要人工确认` }
    : { conflict: false, label: '' };
}

export function isDisplayQualified(entry) {
  const reasons = Array.isArray(entry?.reasons) ? entry.reasons : [];
  return entry?.shouldAlert === true
    && entry?.conditionEligible === true
    && !reasons.includes('严重故障/锁机风险')
    && !reasons.includes('不是目标Windows笔记本')
    && !memorySpecConflict(entry).conflict;
}

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

export function productFacts(entry) {
  const reasons = Array.isArray(entry?.reasons) ? entry.reasons : [];
  const facts = [];
  if (Number.isInteger(entry?.itemConditionLevel)) facts.push(`状态${entry.itemConditionLevel}`);
  if (reasons.includes('32GB内存')) facts.push('32GB');

  const storage = reasons.includes('1TB存储')
    ? '1TB'
    : reasons.includes('512GB存储')
      ? '512GB'
      : '';
  if (storage) facts.push(reasons.includes('未确认SSD') ? storage : `SSD ${storage}`);

  const processor = reasons.find((reason) => /^(?:Intel|Ryzen)\b/i.test(reason));
  if (processor) facts.push(processor);

  const series = reasons.find((reason) => reason.startsWith('指定系列：'));
  if (series) facts.push(series.slice('指定系列：'.length).trim());

  for (const detail of ['电池描述较好', '电池状态较差', '外观或屏幕有缺陷', '严重故障/锁机风险']) {
    if (reasons.includes(detail)) facts.push(detail);
  }
  return [...new Set(facts.filter(Boolean))];
}

export function sortDescription(key, direction) {
  const labels = {
    grade: '等级',
    price: '价格',
    decision: '判断',
    likes: '收藏数',
    condition: '商品状态',
    title: '商品名称',
    published: '发布时间',
  };
  if (!labels[key]) return '推荐顺序';
  return `${labels[key]} ${direction === 'asc' ? '从低到高' : '从高到低'}`;
}

export function formatJstShort(value) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return { short: '时间不明', full: '时间不明' };
  const parts = Object.fromEntries(new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(timestamp).map((part) => [part.type, part.value]));
  return {
    short: `${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`,
    full: `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`,
  };
}

export function searchText(entry, priceText, blockerText = '') {
  const reasons = Array.isArray(entry?.reasons) ? entry.reasons.join(' ') : String(entry?.reasons ?? '');
  return [
    entry?.title,
    reasons,
    entry?.itemCondition,
    entry?.grade,
    priceText,
    blockerText,
  ].filter(Boolean).join(' ');
}

export function primaryBlocker(entry, config = {}) {
  const reasons = Array.isArray(entry?.reasons) ? entry.reasons : [];
  if (reasons.includes('严重故障/锁机风险')) return '严重故障/锁机风险';
  if (reasons.includes('不是目标Windows笔记本')) return '非目标Windows笔记本';
  const memoryConflict = memorySpecConflict(entry);
  if (memoryConflict.conflict) return memoryConflict.label;
  if (entry?.shouldAlert === true && entry?.conditionEligible !== false) return '符合提醒';
  if (!reasons.includes('32GB内存')) return '未确认32GB内存';
  if (!reasons.some((reason) => reason === '512GB存储' || reason === '1TB存储')) {
    return '未确认512GB以上存储';
  }
  if (reasons.includes('未确认SSD')) return '未确认SSD';
  if (!Number.isFinite(entry?.price)) return '价格不明';
  const maxPriceYen = Number(config.maxPriceYen ?? 70000);
  if (entry.price > maxPriceYen) {
    return `超预算 ¥${(entry.price - maxPriceYen).toLocaleString('ja-JP')}`;
  }
  return '评分低于提醒线';
}

export function normalizeSearch(value) {
  return String(value ?? '').normalize('NFKC').toLocaleLowerCase('ja-JP').trim();
}

export function matchesResultRow(dataset, filter, query) {
  const validFilter = ['all', 'match', 'budget', 'top', 'new'].includes(filter) ? filter : 'all';
  const filterMatches = validFilter === 'all'
    || (validFilter === 'match' && dataset.match === '1')
    || (validFilter === 'budget' && dataset.budget === '1')
    || (validFilter === 'top' && Number(dataset.grade) >= 3)
    || (validFilter === 'new' && dataset.new === '1');
  const tokens = normalizeSearch(query).split(/\s+/).filter(Boolean);
  const haystack = normalizeSearch(dataset.search);
  return filterMatches && tokens.every((token) => haystack.includes(token));
}

export function renderResultsPage(entries, config = {}, { nowMs = Date.now() } = {}) {
  const safeEntries = Array.isArray(entries) ? entries : [];
  const maxPriceYen = Number(config.maxPriceYen ?? 70000);
  const requestedPollMinutes = Number(config.pollMinutes ?? 10);
  const pollMinutes = Number.isFinite(requestedPollMinutes) && requestedPollMinutes > 0
    ? requestedPollMinutes
    : 10;
  const recentCutoff = nowMs - 24 * 60 * 60 * 1000;
  const isRecentEntry = (entry) => entry.publishedAt && Date.parse(entry.publishedAt) >= recentCutoff;
  const qualifiedEntries = safeEntries.filter(isDisplayQualified);
  const budgetEntries = safeEntries.filter((entry) => Number.isFinite(entry.price) && entry.price <= maxPriceYen);
  const recentEntries = safeEntries.filter(isRecentEntry);
  const topGradeEntries = safeEntries.filter((entry) => entry.grade === 'S' || entry.grade === 'A');
  const bestEntry = [...qualifiedEntries].sort((a, b) => Number(b.score) - Number(a.score)
    || Number(a.price ?? Infinity) - Number(b.price ?? Infinity))[0] ?? null;

  const resultRows = safeEntries.map((entry, orderIndex) => {
    const hasPrice = Number.isFinite(entry.price);
    const price = hasPrice ? `¥${Number(entry.price).toLocaleString('ja-JP')}` : '价格不明';
    const likeCount = Number.isInteger(entry.likeCount)
      ? entry.likeCount.toLocaleString('ja-JP')
      : entry.likeCheckedAt ? '无法取得' : '尚未检查';
    const likeCheckedMs = Date.parse(entry.likeCheckedAt) || 0;
    const likeFresh = likeCheckedMs > 0
      && nowMs - likeCheckedMs <= Math.max(15, Number(config.likesRefreshMinutes ?? 10) * 2) * 60_000;
    const likeCheckedText = likeCheckedMs
      ? `${formatJstShort(entry.likeCheckedAt).full} JST`
      : '尚未更新';
    const likeCellTitle = `收藏数最后更新：${likeCheckedText}（${likeFresh ? '数据新鲜' : '等待后台更新'}）`;
    const condition = compactCondition(entry);
    const publishedAt = formatJstShort(entry.publishedAt);
    const reasons = Array.isArray(entry.reasons) ? entry.reasons.join('、') : '';
    const facts = productFacts(entry).join(' ｜ ') || reasons;
    const memoryConflict = memorySpecConflict(entry);
    const shouldAlert = isDisplayQualified(entry);
    const blocker = primaryBlocker(entry, config);
    const decisionClass = shouldAlert
      ? 'decision-match'
      : memoryConflict.conflict && blocker === memoryConflict.label
        ? 'decision-warning'
        : 'decision-blocked';
    const decision = `<span class="decision ${decisionClass}">${escapeHtml(blocker)}</span>`;
    const isWithinBudget = hasPrice && entry.price <= maxPriceYen;
    const priceDetail = hasPrice
      ? isWithinBudget
        ? '<span class="price-detail is-within">预算内</span>'
        : `<span class="price-detail is-over">+¥${(entry.price - maxPriceYen).toLocaleString('ja-JP')}</span>`
      : '';
    const gradeRank = { S: 4, A: 3, B: 2, C: 1 }[entry.grade] ?? 0;
    const decisionRank = shouldAlert ? 2 : memoryConflict.conflict ? 1 : 0;
    const isRecent = isRecentEntry(entry);
    const newBadge = isRecent ? '<span class="new-badge">新上架</span>' : '';
    const searchable = searchText(entry, price, blocker);
    return `<tr class="result-row" data-order="${orderIndex}" data-grade="${gradeRank}" data-price="${hasPrice ? entry.price : ''}" data-decision="${decisionRank}" data-likes="${Number.isInteger(entry.likeCount) ? entry.likeCount : ''}" data-condition="${Number.isInteger(entry.itemConditionLevel) ? entry.itemConditionLevel : ''}" data-title="${escapeHtml(entry.title)}" data-match="${shouldAlert ? 1 : 0}" data-budget="${isWithinBudget ? 1 : 0}" data-new="${isRecent ? 1 : 0}" data-published="${entry.publishedAt ? Date.parse(entry.publishedAt) : ''}" data-search="${escapeHtml(searchable)}">
      <td class="grade-cell"><span class="grade grade-${escapeHtml(entry.grade)}">${escapeHtml(entry.grade)}</span><span class="grade-label">级</span></td>
      <td class="numeric-cell price-cell"><span class="price-main">${escapeHtml(price)}</span>${priceDetail}</td>
      <td class="decision-cell">${decision}</td>
      <td class="numeric-cell like-cell" title="${escapeHtml(likeCellTitle)}"><span>${escapeHtml(likeCount)}</span><span class="freshness-dot ${likeFresh ? 'is-fresh' : 'is-stale'}" aria-hidden="true"></span></td>
      <td class="condition-cell" title="${escapeHtml(condition.title)}">${escapeHtml(condition.label)}</td>
      <td class="product-cell"><div class="product-title-line">${newBadge}<a class="title" title="${escapeHtml(entry.title)}" href="${escapeHtml(entry.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(entry.title)}<span class="external-mark" aria-hidden="true">↗</span></a></div><div class="product-meta"><span class="product-facts" title="${escapeHtml(reasons)}">${escapeHtml(facts)}</span></div></td>
      <td class="date-cell" title="${escapeHtml(`${publishedAt.full} JST`)}">${escapeHtml(publishedAt.short)}</td>
    </tr>`;
  }).join('\n');

  const rows = resultRows || '<tr class="initial-empty"><td class="empty" colspan="7">还没有检查结果，请先运行监测器或诊断模式。</td></tr>';
  const embeddedNormalizeSearch = normalizeSearch.toString();
  const embeddedMatchesResultRow = matchesResultRow.toString();
  const embeddedSortDescription = sortDescription.toString();

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="refresh" content="600">
  <title>Mercari 笔记本监测结果</title>
  <style>
    :root { color-scheme: light; font-family: Inter, "Segoe UI", "Microsoft YaHei", "Yu Gothic UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: linear-gradient(180deg, #f7f4ed 0, #f1ede4 48%, #ebe6dc 100%); color: #25282d; }
    main { width: min(1680px, calc(100% - 32px)); margin: 24px auto 40px; }
    .page-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 32px; margin: 0 4px 14px; }
    .brand-lockup { display: flex; align-items: center; gap: 14px; min-width: 0; }
    .header-meta { display: flex; align-items: flex-end; flex-direction: column; gap: 8px; }
    .monitor-status { display: inline-flex; align-items: center; gap: 8px; min-height: 30px; padding: 5px 11px; border: 1px solid #d8cdb7; border-radius: 999px; background: rgba(255,254,250,.9); color: #77736b; font-size: 12px; font-weight: 750; white-space: nowrap; }
    .monitor-status-dot { width: 8px; height: 8px; border-radius: 50%; background: #9b958a; box-shadow: 0 0 0 3px rgba(155,149,138,.12); }
    .monitor-status.is-online { border-color: #a8c8b7; color: #2f7254; }
    .monitor-status.is-online .monitor-status-dot { background: #3f8766; box-shadow: 0 0 0 3px rgba(63,135,102,.14); }
    .monitor-status.is-busy { border-color: #cbb27e; color: #8b631f; }
    .monitor-status.is-busy .monitor-status-dot { background: #b58a3d; box-shadow: 0 0 0 3px rgba(181,138,61,.14); }
    .monitor-status.is-offline { border-color: #d8b2aa; color: #9a5145; }
    .monitor-status.is-offline .monitor-status-dot { background: #b76b5d; box-shadow: 0 0 0 3px rgba(183,107,93,.12); }
    .brand-mark { display: grid; width: 44px; height: 44px; flex: 0 0 44px; place-items: center; border: 1px solid #a77a2d; border-radius: 12px; background: linear-gradient(145deg, #d8b86e, #9b6e25 72%); color: #fffaf0; font: 900 23px/1 Georgia, serif; box-shadow: 0 7px 20px rgba(133,95,31,.16), inset 0 1px rgba(255,255,255,.4); }
    .eyebrow { margin: 0 0 4px; color: #9a732f; font-size: 12px; font-weight: 800; letter-spacing: .16em; }
    h1 { margin: 0; color: #25282d; font-size: clamp(22px, 2vw, 30px); font-weight: 760; letter-spacing: .015em; white-space: nowrap; }
    .hint { margin: 0 0 4px; color: #77736b; font-size: 12px; text-align: right; white-space: nowrap; }
    .summary-strip { display: grid; grid-template-columns: repeat(5, minmax(130px, 1fr)); margin-bottom: 10px; overflow: hidden; border: 1px solid #ddd3c1; border-radius: 10px; background: rgba(255,254,250,.9); }
    .filter-button { min-height: 54px; padding: 9px 14px; border: 0; border-right: 1px solid #e5ddcf; background: transparent; color: #736e65; font: inherit; text-align: left; cursor: pointer; }
    .filter-button:last-child { border-right: 0; }
    .filter-button:hover { background: #f5f0e7; color: #3c3d40; }
    .filter-button.active { background: #f3e8d2; color: #7d5a1e; box-shadow: inset 0 -3px #b58a3d; }
    .metric-label { display: block; font-size: 12px; font-weight: 700; white-space: nowrap; }
    .metric-value { display: block; margin-top: 3px; color: #292c31; font: 760 18px/1 "Cascadia Mono", Consolas, monospace; font-variant-numeric: tabular-nums; }
    .filter-button.active .metric-value { color: #8a631f; }
    .best-candidate { display: grid; grid-template-columns: auto auto minmax(0, 1fr); align-items: center; gap: 14px; min-height: 48px; margin-bottom: 10px; padding: 9px 14px; border-left: 3px solid #b58a3d; background: rgba(255,253,248,.82); }
    .best-label { color: #8f6723; font-size: 12px; font-weight: 800; letter-spacing: .06em; white-space: nowrap; }
    .best-facts { display: inline-flex; align-items: center; gap: 7px; color: #35373b; font-size: 12px; white-space: nowrap; }
    .best-grade { color: #2f7254; font-weight: 800; }
    .best-budget { padding: 2px 6px; border-radius: 4px; background: #e8f4ed; color: #2f7254; font-weight: 750; }
    .best-title { min-width: 0; overflow: hidden; color: #72511b; font-size: 13px; font-weight: 720; text-overflow: ellipsis; text-decoration: none; white-space: nowrap; }
    .best-title:hover { color: #a77a2d; text-decoration: underline; text-underline-offset: 3px; }
    .best-empty { color: #817b70; font-size: 12px; }
    .toolbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 48px; margin-bottom: 10px; padding: 7px 10px; border: 1px solid #ddd3c1; border-radius: 10px; background: rgba(255,253,248,.88); }
    .search-group { display: flex; align-items: center; gap: 9px; min-width: 0; }
    .search-input { width: clamp(260px, 32vw, 520px); min-height: 34px; padding: 7px 10px; border: 1px solid #d5c9b4; border-radius: 8px; background: #fffefa; color: #303238; font: inherit; font-size: 12px; outline: none; }
    .search-input::placeholder { color: #9a9489; }
    .search-input:focus { border-color: #a77a2d; box-shadow: 0 0 0 3px rgba(167,122,45,.12); }
    .toolbar-state { display: flex; align-items: center; justify-content: flex-end; gap: 9px; min-width: 0; }
    .toolbar-note { color: #817b70; font-size: 12px; white-space: nowrap; }
    .result-count { min-width: 82px; color: #817b70; font: 700 12px/1.2 "Cascadia Mono", Consolas, monospace; white-space: nowrap; }
    .sort-summary { color: #6f6a61; font-size: 12px; font-weight: 700; white-space: nowrap; }
    .reset-sort { min-height: 30px; padding: 5px 9px; border: 1px solid #d5c9b4; border-radius: 7px; background: #fffefa; color: #76591f; font: inherit; font-size: 12px; font-weight: 750; white-space: nowrap; cursor: pointer; }
    .reset-sort:hover { border-color: #b58a3d; background: #f7eedb; }
    .reset-sort:focus-visible { outline: 2px solid #a77a2d; outline-offset: 2px; }
    .reset-sort[hidden] { display: none; }
    .panel { overflow: auto; background: #fffefa; border: 1px solid #d8cdb7; border-radius: 12px; box-shadow: 0 10px 30px rgba(72,58,34,.07); scrollbar-color: #b4965d #eee8dc; }
    table { width: 100%; min-width: 1180px; table-layout: fixed; border-collapse: separate; border-spacing: 0; }
    th:nth-child(1) { width: 76px; }
    th:nth-child(2) { width: 80px; }
    th:nth-child(3) { width: 145px; }
    th:nth-child(4) { width: 142px; }
    th:nth-child(5) { width: 112px; }
    th:nth-child(7) { width: 108px; }
    th, td { padding: 12px 13px; border-bottom: 1px solid #ebe5da; text-align: left; vertical-align: middle; white-space: nowrap; }
    th { position: sticky; top: 0; z-index: 2; background: #ece6da; color: #735824; font-size: 12px; font-weight: 750; letter-spacing: .025em; box-shadow: inset 0 -1px #d2c6af; }
    tbody tr { transition: background-color .16s ease; }
    tbody tr:hover { background: #fbf4e7; }
    .sort-button { display: inline-flex; align-items: center; gap: 6px; padding: 5px 7px; margin: -5px -7px; border: 0; border-radius: 7px; background: transparent; color: inherit; font: inherit; font-weight: inherit; white-space: nowrap; cursor: pointer; }
    .sort-button:hover { background: rgba(167,122,45,.09); color: #8f6723; }
    .sort-button:focus-visible { outline: 2px solid #a77a2d; outline-offset: 2px; }
    .sort-icon { min-width: 12px; color: #aa9a79; font-size: 14px; line-height: 1; }
    th[aria-sort="ascending"] .sort-icon, th[aria-sort="descending"] .sort-icon { color: #9b6f24; }
    th[aria-sort="ascending"] .sort-button, th[aria-sort="descending"] .sort-button { background: #f5e8ce; color: #7b581d; }
    td { color: #34373c; font-size: 13px; }
    tr:last-child td { border-bottom: 0; }
    th:first-child, td:first-child { padding-left: 18px; }
    th:last-child, td:last-child { padding-right: 18px; }
    th:first-child { left: 0; z-index: 4; }
    td:first-child { position: sticky; left: 0; z-index: 1; background: #fffefa; box-shadow: 1px 0 #e2dacb; }
    tbody tr:hover td:first-child { background: #fbf4e7; }
    .grade-cell, .numeric-cell, .decision-cell, .condition-cell, .date-cell { width: 1%; white-space: nowrap; }
    .decision-cell { min-width: 145px; }
    .price-cell { font-variant-numeric: tabular-nums; }
    .price-main, .price-detail { display: block; }
    .price-detail { margin-top: 3px; font-size: 12px; font-weight: 700; }
    .price-detail.is-within { color: #2f7254; }
    .price-detail.is-over { color: #985a45; }
    .like-cell { font-variant-numeric: tabular-nums; }
    .freshness-dot { display: inline-block; width: 7px; height: 7px; margin-left: 7px; border-radius: 50%; vertical-align: 1px; }
    .freshness-dot.is-fresh { background: #3f8766; box-shadow: 0 0 0 3px rgba(63,135,102,.12); }
    .freshness-dot.is-stale { background: #b58a3d; box-shadow: 0 0 0 3px rgba(181,138,61,.12); }
    .product-cell { width: 100%; min-width: 440px; }
    .product-title-line { display: flex; align-items: flex-start; gap: 7px; min-width: 0; }
    .title { display: -webkit-box; min-width: 0; overflow: hidden; color: #7f5b1d; font-weight: 720; line-height: 1.38; text-decoration: none; letter-spacing: .005em; white-space: normal; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
    .title:hover { color: #a77a2d; text-decoration: underline; text-underline-offset: 3px; }
    .external-mark { margin-left: 5px; color: #a77a2d; font-size: 12px; }
    .product-meta { min-width: 0; margin-top: 5px; }
    .product-facts { display: block; min-width: 0; overflow: hidden; color: #817b72; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
    .decision { display: inline-block; max-width: 210px; padding: 3px 7px; border: 1px solid; border-radius: 5px; font-size: 12px; font-weight: 800; line-height: 1.35; white-space: normal; }
    .decision-match { border-color: #8ebca5; background: #e8f4ed; color: #2f7254; }
    .decision-blocked { border-color: #d5b8a8; background: #f8eee8; color: #985a45; }
    .decision-warning { border-color: #d6bd7c; background: #fff5d9; color: #815d18; }
    .new-badge { flex: 0 0 auto; margin-top: 1px; padding: 2px 5px; border: 1px solid #c2a66f; border-radius: 4px; background: #f7eedb; color: #8f6723; font-size: 12px; font-weight: 800; line-height: 1.2; white-space: nowrap; }
    .grade { display: inline-grid; width: 27px; height: 27px; place-items: center; border: 1px solid rgba(70,60,40,.12); border-radius: 8px; font-weight: 850; box-shadow: inset 0 1px rgba(255,255,255,.3); }
    .grade-label { margin-left: 5px; color: #817b72; font-size: 12px; }
    .grade-S { background: linear-gradient(145deg, #c89d47, #8c611f); color: #fffaf0; } .grade-A { background: #3f8766; color: #fff; } .grade-B { background: #d39b31; color: #33250d; } .grade-C { background: #8b8b86; color: #fff; }
    .empty { padding: 48px; color: #817b72; text-align: center; }
    @media (max-width: 1120px) { .page-header { align-items: flex-start; flex-direction: column; gap: 10px; } .header-meta { align-items: flex-start; } .hint { text-align: left; } .best-candidate { grid-template-columns: auto 1fr; } .best-title { grid-column: 1 / -1; } .toolbar-note { display: none; } }
    @media (max-width: 920px) { .summary-strip { grid-template-columns: repeat(3, minmax(130px, 1fr)); } .filter-button:nth-child(3) { border-right: 0; } .filter-button:nth-child(-n+3) { border-bottom: 1px solid #e5ddcf; } table { min-width: 820px; } th:nth-child(7), td:nth-child(7) { display: none; } }
    @media (max-width: 700px) { main { width: min(100% - 20px, 1680px); margin-top: 16px; } h1 { white-space: normal; } .summary-strip { grid-template-columns: repeat(2, minmax(120px, 1fr)); } .filter-button { border-right: 1px solid #e5ddcf; border-bottom: 1px solid #e5ddcf; } .filter-button:nth-child(even) { border-right: 0; } .filter-button:last-child { grid-column: 1 / -1; border-right: 0; border-bottom: 0; } .best-candidate { grid-template-columns: 1fr; gap: 6px; } .best-title { grid-column: auto; white-space: normal; } .toolbar { align-items: stretch; flex-direction: column; } .search-group { width: 100%; flex-wrap: wrap; } .search-input { flex: 1 1 240px; width: auto; } table { min-width: 690px; } .decision-cell { min-width: 132px; } .product-cell { min-width: 300px; } th:nth-child(4), td:nth-child(4), th:nth-child(5), td:nth-child(5) { display: none; } }
  </style>
</head>
<body><main>
  <header class="page-header">
    <div class="brand-lockup"><span class="brand-mark">M</span><div><p class="eyebrow">MERCARI LAPTOP MONITOR</p><h1>Mercari 笔记本监测结果</h1></div></div>
    <div class="header-meta">
      <div id="monitor-status" class="monitor-status" title="未运行时请双击 open-results.cmd"><span class="monitor-status-dot" aria-hidden="true"></span><span id="monitor-status-text">正在检测后台状态…</span></div>
      <p class="hint">搜索或点击栏目排序 · 页面每10分钟刷新 · 后台每${escapeHtml(pollMinutes)}分钟检查</p>
    </div>
  </header>
  <section class="summary-strip" role="group" aria-label="结果概览与快捷筛选">
    <button type="button" class="filter-button active" data-filter="all"><span class="metric-label">当前记录</span><strong class="metric-value">${safeEntries.length}</strong></button>
    <button type="button" class="filter-button" data-filter="match"><span class="metric-label">符合提醒</span><strong class="metric-value">${qualifiedEntries.length}</strong></button>
    <button type="button" class="filter-button" data-filter="budget"><span class="metric-label">预算内 ≤ ¥${maxPriceYen.toLocaleString('ja-JP')}</span><strong class="metric-value">${budgetEntries.length}</strong></button>
    <button type="button" class="filter-button" data-filter="new"><span class="metric-label">24H 新上架</span><strong class="metric-value">${recentEntries.length}</strong></button>
    <button type="button" class="filter-button" data-filter="top"><span class="metric-label">S / A 级</span><strong class="metric-value">${topGradeEntries.length}</strong></button>
  </section>
  <section class="best-candidate" aria-label="当前最佳候选">
    <strong class="best-label">当前最佳候选</strong>
    ${bestEntry ? `<span class="best-facts"><span class="best-grade">${escapeHtml(bestEntry.grade)}级</span><strong>¥${Number(bestEntry.price).toLocaleString('ja-JP')}</strong><span class="best-budget">预算内</span></span><a class="best-title" title="${escapeHtml(bestEntry.title)}" href="${escapeHtml(bestEntry.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(bestEntry.title)}<span class="external-mark" aria-hidden="true">↗</span></a>` : '<span class="best-empty">暂无符合条件且规格一致的商品</span>'}
  </section>
  <section class="toolbar" aria-label="商品搜索">
    <div class="search-group">
      <input id="product-search" class="search-input" type="search" aria-label="搜索商品" placeholder="搜索品牌、型号、CPU、判断…" autocomplete="off">
      <output id="result-count" class="result-count" for="product-search" aria-live="polite">显示 ${safeEntries.length} / ${safeEntries.length}</output>
    </div>
    <div class="toolbar-state">
      <output id="sort-summary" class="sort-summary" aria-live="polite">当前排序：推荐顺序</output>
      <button id="reset-sort" class="reset-sort" type="button" hidden>恢复推荐顺序</button>
      <span class="toolbar-note">点击上方指标筛选 · 点击栏目排序 · Esc 清空搜索</span>
    </div>
  </section>
  <div class="panel"><table>
    <thead><tr>
      <th aria-sort="none"><button type="button" class="sort-button" data-sort="grade" data-default-direction="desc">等级 <span class="sort-icon" aria-hidden="true">⇅</span></button></th>
      <th aria-sort="none"><button type="button" class="sort-button" data-sort="price" data-default-direction="asc">价格 <span class="sort-icon" aria-hidden="true">⇅</span></button></th>
      <th aria-sort="none"><button type="button" class="sort-button" data-sort="decision" data-default-direction="desc">判断 <span class="sort-icon" aria-hidden="true">⇅</span></button></th>
      <th aria-sort="none"><button type="button" class="sort-button" data-sort="likes" data-default-direction="desc">收藏数（いいね） <span class="sort-icon" aria-hidden="true">⇅</span></button></th>
      <th aria-sort="none"><button type="button" class="sort-button" data-sort="condition" data-default-direction="asc">商品状态 <span class="sort-icon" aria-hidden="true">⇅</span></button></th>
      <th aria-sort="none"><button type="button" class="sort-button" data-sort="title" data-default-direction="asc">商品 <span class="sort-icon" aria-hidden="true">⇅</span></button></th>
      <th aria-sort="none"><button type="button" class="sort-button" data-sort="published" data-default-direction="desc">发布时间 <span class="sort-icon" aria-hidden="true">⇅</span></button></th>
    </tr></thead>
    <tbody>${rows}<tr id="no-results-row" hidden><td class="empty" colspan="7">没有符合当前筛选和搜索的商品。</td></tr></tbody>
  </table></div>
</main>
<script>
  (() => {
    const tbody = document.querySelector('tbody');
    const sortButtons = [...document.querySelectorAll('.sort-button')];
    const filterButtons = [...document.querySelectorAll('.filter-button')];
    const searchInput = document.querySelector('#product-search');
    const resultCount = document.querySelector('#result-count');
    const sortSummary = document.querySelector('#sort-summary');
    const resetSortButton = document.querySelector('#reset-sort');
    const noResultsRow = document.querySelector('#no-results-row');
    const monitorStatus = document.querySelector('#monitor-status');
    const monitorStatusText = document.querySelector('#monitor-status-text');
    const storageKey = 'mercari-laptop-monitor-sort';
    const filterStorageKey = 'mercari-laptop-monitor-filter';
    const searchStorageKey = 'mercari-laptop-monitor-search';
    const pollMinutes = ${JSON.stringify(pollMinutes)};
    let currentSort = null;
    let currentFilter = 'all';
    let currentSearch = '';
    try { currentSort = JSON.parse(localStorage.getItem(storageKey)); } catch {}
    try { currentFilter = localStorage.getItem(filterStorageKey) || 'all'; } catch {}
    try { currentSearch = localStorage.getItem(searchStorageKey) || ''; } catch {}
    searchInput.value = currentSearch;

    ${embeddedNormalizeSearch}
    ${embeddedMatchesResultRow}
    ${embeddedSortDescription}

    function renderMonitorStatus(status) {
      const heartbeatMs = Date.parse(status?.heartbeatAt) || 0;
      const ageMs = heartbeatMs ? Date.now() - heartbeatMs : Infinity;
      const heartbeatText = heartbeatMs
        ? new Intl.DateTimeFormat('zh-CN', {
            timeZone: 'Asia/Tokyo',
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23',
          }).format(heartbeatMs)
        : '';
      const nextCheckText = heartbeatMs
        ? new Intl.DateTimeFormat('zh-CN', {
            timeZone: 'Asia/Tokyo',
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23',
          }).format(heartbeatMs + pollMinutes * 60_000)
        : '';
      monitorStatus.classList.remove('is-online', 'is-busy', 'is-offline');
      monitorStatus.title = [status?.phase, status?.message].filter(Boolean).join('｜')
        || '未运行时请双击 open-results.cmd';
      if (!status || status.running !== true || ageMs > 900_000) {
        monitorStatus.classList.add('is-offline');
        monitorStatusText.textContent = heartbeatText
          ? '后台未运行｜最后记录 ' + heartbeatText
          : '后台未启动｜请运行 open-results.cmd';
        return;
      }
      const busy = String(status.phase || '').startsWith('正在');
      monitorStatus.classList.add(busy ? 'is-busy' : 'is-online');
      monitorStatusText.textContent = busy
        ? (status.phase || '正在检查') + '｜状态更新 ' + heartbeatText
        : '后台正常｜上次检查 ' + heartbeatText + '｜下次约 ' + nextCheckText;
    }

    function refreshMonitorStatus() {
      window.__MERCARI_MONITOR_STATUS__ = undefined;
      const script = document.createElement('script');
      script.src = 'monitor-status.js?t=' + Date.now();
      script.onload = () => {
        renderMonitorStatus(window.__MERCARI_MONITOR_STATUS__);
        script.remove();
      };
      script.onerror = () => {
        renderMonitorStatus(null);
        script.remove();
      };
      document.head.append(script);
    }

    function valueFor(row, key) {
      if (key === 'title') return row.dataset.title || '';
      if ((key === 'price' || key === 'likes' || key === 'condition' || key === 'published') && row.dataset[key] === '') return null;
      return Number(row.dataset[key]);
    }

    function applySort(key, direction, remember = true) {
      const resultRows = [...tbody.querySelectorAll('.result-row')];
      resultRows.sort((left, right) => {
        const a = valueFor(left, key);
        const b = valueFor(right, key);
        if (a === null && b !== null) return 1;
        if (a !== null && b === null) return -1;
        const comparison = typeof a === 'string'
          ? a.localeCompare(b, 'ja-JP', { numeric: true, sensitivity: 'base' })
          : a - b;
        return comparison === 0
          ? Number(left.dataset.order) - Number(right.dataset.order)
          : direction === 'asc' ? comparison : -comparison;
      });
      resultRows.forEach((row) => tbody.insertBefore(row, noResultsRow));
      sortButtons.forEach((button) => {
        const active = button.dataset.sort === key;
        button.querySelector('.sort-icon').textContent = active ? (direction === 'asc' ? '↑' : '↓') : '⇅';
        button.closest('th').setAttribute('aria-sort', active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none');
      });
      currentSort = { key, direction };
      sortSummary.textContent = '当前排序：' + sortDescription(key, direction);
      resetSortButton.hidden = false;
      if (remember) {
        try { localStorage.setItem(storageKey, JSON.stringify(currentSort)); } catch {}
      }
    }

    function resetRecommendedOrder(remember = true) {
      const resultRows = [...tbody.querySelectorAll('.result-row')]
        .sort((left, right) => Number(left.dataset.order) - Number(right.dataset.order));
      resultRows.forEach((row) => tbody.insertBefore(row, noResultsRow));
      sortButtons.forEach((button) => {
        button.querySelector('.sort-icon').textContent = '⇅';
        button.closest('th').setAttribute('aria-sort', 'none');
      });
      currentSort = null;
      sortSummary.textContent = '当前排序：' + sortDescription();
      resetSortButton.hidden = true;
      if (remember) {
        try { localStorage.removeItem(storageKey); } catch {}
      }
    }

    function applyVisibility({ rememberFilter = false, rememberSearch = false } = {}) {
      const resultRows = [...tbody.querySelectorAll('.result-row')];
      let visibleCount = 0;
      resultRows.forEach((row) => {
        const visible = matchesResultRow(row.dataset, currentFilter, currentSearch);
        row.hidden = !visible;
        if (visible) visibleCount += 1;
      });
      filterButtons.forEach((button) => button.classList.toggle('active', button.dataset.filter === currentFilter));
      resultCount.textContent = '显示 ' + visibleCount + ' / ' + resultRows.length;
      noResultsRow.hidden = resultRows.length === 0 || visibleCount !== 0;
      if (rememberFilter) {
        try { localStorage.setItem(filterStorageKey, currentFilter); } catch {}
      }
      if (rememberSearch) {
        try { localStorage.setItem(searchStorageKey, currentSearch); } catch {}
      }
    }

    sortButtons.forEach((button) => button.addEventListener('click', () => {
      const key = button.dataset.sort;
      const direction = currentSort?.key === key
        ? (currentSort.direction === 'asc' ? 'desc' : 'asc')
        : button.dataset.defaultDirection;
      applySort(key, direction);
    }));
    resetSortButton.addEventListener('click', () => resetRecommendedOrder());

    filterButtons.forEach((button) => button.addEventListener('click', () => {
      currentFilter = ['all', 'match', 'budget', 'top', 'new'].includes(button.dataset.filter) ? button.dataset.filter : 'all';
      applyVisibility({ rememberFilter: true });
    }));

    searchInput.addEventListener('input', () => {
      currentSearch = searchInput.value;
      applyVisibility({ rememberSearch: true });
    });
    searchInput.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && searchInput.value) {
        searchInput.value = '';
        currentSearch = '';
        applyVisibility({ rememberSearch: true });
      }
    });

    if (currentSort && sortButtons.some((button) => button.dataset.sort === currentSort.key)) {
      applySort(currentSort.key, currentSort.direction === 'asc' ? 'asc' : 'desc', false);
    } else {
      resetRecommendedOrder(Boolean(currentSort));
    }
    currentFilter = ['all', 'match', 'budget', 'top', 'new'].includes(currentFilter) ? currentFilter : 'all';
    applyVisibility();
    refreshMonitorStatus();
  })();
</script>
</body></html>\n`;
}
function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
