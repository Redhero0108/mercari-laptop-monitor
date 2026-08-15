import { formatJstMinute } from './time.mjs';

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
  const validFilter = ['all', 'match', 'top', 'new'].includes(filter) ? filter : 'all';
  const filterMatches = validFilter === 'all'
    || (validFilter === 'match' && dataset.match === '1')
    || (validFilter === 'top' && Number(dataset.grade) >= 3)
    || (validFilter === 'new' && dataset.new === '1');
  const tokens = normalizeSearch(query).split(/\s+/).filter(Boolean);
  const haystack = normalizeSearch(dataset.search);
  return filterMatches && tokens.every((token) => haystack.includes(token));
}

function formatCheckedAt(value) {
  const timestamp = Date.parse(value);
  return timestamp
    ? new Date(timestamp).toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Tokyo' })
    : '时间不明';
}

export function renderResultsPage(entries, config = {}, { nowMs = Date.now() } = {}) {
  const safeEntries = Array.isArray(entries) ? entries : [];
  const recentCutoff = nowMs - 24 * 60 * 60 * 1000;
  const isRecentEntry = (entry) => entry.publishedAt && Date.parse(entry.publishedAt) >= recentCutoff;
  const qualifiedEntries = safeEntries.filter((entry) => entry.shouldAlert && entry.conditionEligible === true);
  const recentEntries = safeEntries.filter(isRecentEntry);
  const topGradeEntries = safeEntries.filter((entry) => entry.grade === 'S' || entry.grade === 'A');
  const bestEntry = [...qualifiedEntries].sort((a, b) => Number(b.score) - Number(a.score)
    || Number(a.price ?? Infinity) - Number(b.price ?? Infinity))[0] ?? null;

  const resultRows = safeEntries.map((entry) => {
    const hasPrice = Number.isFinite(entry.price);
    const price = hasPrice ? `¥${Number(entry.price).toLocaleString('ja-JP')}` : '价格不明';
    const likeCount = Number.isInteger(entry.likeCount)
      ? entry.likeCount.toLocaleString('ja-JP')
      : entry.likeCheckedAt ? '无法取得' : '尚未检查';
    const likeCheckedMs = Date.parse(entry.likeCheckedAt) || 0;
    const likeFresh = likeCheckedMs > 0
      && nowMs - likeCheckedMs <= Math.max(15, Number(config.likesRefreshMinutes ?? 10) * 2) * 60_000;
    const likeCheckedText = likeCheckedMs
      ? new Date(likeCheckedMs).toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Tokyo' })
      : '尚未更新';
    const likeCellTitle = `いいね最后更新：${likeCheckedText}（${likeFresh ? '数据新鲜' : '等待后台更新'}）`;
    const condition = compactCondition(entry);
    const publishedAt = formatJstMinute(entry.publishedAt);
    const checkedAt = formatCheckedAt(entry.checkedAt);
    const reasons = Array.isArray(entry.reasons) ? entry.reasons.join('、') : '';
    const shouldAlert = entry.shouldAlert && entry.conditionEligible === true;
    const blocker = primaryBlocker(entry, config);
    const decision = shouldAlert
      ? `<span class="decision decision-match">${escapeHtml(blocker)}</span>`
      : `<span class="decision decision-blocked">${escapeHtml(blocker)}</span>`;
    const gradeRank = { S: 4, A: 3, B: 2, C: 1 }[entry.grade] ?? 0;
    const isRecent = isRecentEntry(entry);
    const newBadge = isRecent ? '<span class="new-badge">NEW</span>' : '';
    const searchable = searchText(entry, price, blocker);
    return `<tr class="result-row" data-grade="${gradeRank}" data-price="${hasPrice ? entry.price : ''}" data-likes="${Number.isInteger(entry.likeCount) ? entry.likeCount : ''}" data-condition="${Number.isInteger(entry.itemConditionLevel) ? entry.itemConditionLevel : ''}" data-title="${escapeHtml(entry.title)}" data-match="${shouldAlert ? 1 : 0}" data-new="${isRecent ? 1 : 0}" data-published="${entry.publishedAt ? Date.parse(entry.publishedAt) : ''}" data-time="${Date.parse(entry.checkedAt) || 0}" data-search="${escapeHtml(searchable)}">
      <td class="grade-cell"><span class="grade grade-${escapeHtml(entry.grade)}">${escapeHtml(entry.grade)}</span><span class="grade-label">级</span></td>
      <td class="numeric-cell">${escapeHtml(price)}</td>
      <td class="numeric-cell like-cell" title="${escapeHtml(likeCellTitle)}"><span>${escapeHtml(likeCount)}</span><span class="freshness-dot ${likeFresh ? 'is-fresh' : 'is-stale'}" aria-hidden="true"></span></td>
      <td class="condition-cell" title="${escapeHtml(condition.title)}">${escapeHtml(condition.label)}</td>
      <td class="product-cell"><div class="product-title-line">${newBadge}<a class="title" title="${escapeHtml(entry.title)}" href="${escapeHtml(entry.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(entry.title)}<span class="external-mark" aria-hidden="true">↗</span></a></div><div class="product-meta">${decision}<span class="reasons" title="${escapeHtml(reasons)}">${escapeHtml(reasons)}</span></div></td>
      <td class="date-cell">${escapeHtml(publishedAt)}</td>
      <td class="date-cell">${escapeHtml(checkedAt)}</td>
    </tr>`;
  }).join('\n');

  const rows = resultRows || '<tr class="initial-empty"><td class="empty" colspan="7">还没有检查结果，请先运行监测器或诊断模式。</td></tr>';
  const embeddedNormalizeSearch = normalizeSearch.toString();
  const embeddedMatchesResultRow = matchesResultRow.toString();

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="refresh" content="600">
  <title>メルカリ笔记本监测结果</title>
  <style>
    :root { color-scheme: light; font-family: Inter, "Segoe UI", "Microsoft YaHei", "Yu Gothic UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: linear-gradient(180deg, #f7f4ed 0, #f1ede4 48%, #ebe6dc 100%); color: #25282d; }
    main { width: min(1880px, calc(100% - 40px)); margin: 30px auto 46px; }
    .page-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 32px; margin: 0 4px 20px; }
    .brand-lockup { display: flex; align-items: center; gap: 14px; min-width: 0; }
    .header-meta { display: flex; align-items: flex-end; flex-direction: column; gap: 8px; }
    .monitor-status { display: inline-flex; align-items: center; gap: 8px; min-height: 28px; padding: 5px 10px; border: 1px solid #d8cdb7; border-radius: 999px; background: rgba(255,254,250,.86); color: #77736b; font-size: 11px; font-weight: 750; white-space: nowrap; box-shadow: 0 3px 10px rgba(70,57,35,.04); }
    .monitor-status-dot { width: 8px; height: 8px; border-radius: 50%; background: #9b958a; box-shadow: 0 0 0 3px rgba(155,149,138,.12); }
    .monitor-status.is-online { border-color: #a8c8b7; color: #2f7254; }
    .monitor-status.is-online .monitor-status-dot { background: #3f8766; box-shadow: 0 0 0 3px rgba(63,135,102,.14); }
    .monitor-status.is-busy { border-color: #cbb27e; color: #8b631f; }
    .monitor-status.is-busy .monitor-status-dot { background: #b58a3d; box-shadow: 0 0 0 3px rgba(181,138,61,.14); animation: status-pulse 1.4s ease-in-out infinite; }
    .monitor-status.is-offline { border-color: #d8b2aa; color: #9a5145; }
    .monitor-status.is-offline .monitor-status-dot { background: #b76b5d; box-shadow: 0 0 0 3px rgba(183,107,93,.12); }
    @keyframes status-pulse { 50% { opacity: .45; transform: scale(.82); } }
    .brand-mark { display: grid; width: 44px; height: 44px; flex: 0 0 44px; place-items: center; border: 1px solid #a77a2d; border-radius: 12px; background: linear-gradient(145deg, #d8b86e, #9b6e25 72%); color: #fffaf0; font: 900 23px/1 Georgia, serif; box-shadow: 0 7px 20px rgba(133,95,31,.16), inset 0 1px rgba(255,255,255,.4); }
    .eyebrow { margin: 0 0 4px; color: #9a732f; font-size: 10px; font-weight: 800; letter-spacing: .18em; }
    h1 { margin: 0; color: #25282d; font-size: clamp(22px, 2vw, 30px); font-weight: 760; letter-spacing: .015em; white-space: nowrap; }
    .hint { margin: 0 0 4px; color: #77736b; font-size: 13px; text-align: right; white-space: nowrap; }
    .summary-grid { display: grid; grid-template-columns: repeat(4, minmax(150px, 1fr)); gap: 10px; margin-bottom: 12px; }
    .summary-card { position: relative; min-height: 82px; padding: 15px 17px; overflow: hidden; border: 1px solid #ddd3c1; border-radius: 11px; background: rgba(255,254,250,.94); box-shadow: 0 5px 18px rgba(70,57,35,.05), inset 0 1px rgba(255,255,255,.8); }
    .summary-card::after { content: ""; position: absolute; inset: auto 0 0; height: 2px; background: linear-gradient(90deg, #b58a3d, transparent 70%); opacity: .52; }
    .summary-label { display: block; color: #817b70; font-size: 10px; font-weight: 750; letter-spacing: .12em; text-transform: uppercase; }
    .summary-value { display: block; margin-top: 6px; color: #292c31; font-family: "Cascadia Mono", Consolas, monospace; font-size: 25px; font-weight: 720; font-variant-numeric: tabular-nums; line-height: 1; }
    .summary-card.signal .summary-value { color: #9b6f24; }
    .summary-card.positive .summary-value { color: #2f7d5b; }
    .toolbar { display: flex; align-items: center; justify-content: space-between; gap: 18px; min-height: 52px; margin-bottom: 10px; padding: 8px 10px; border: 1px solid #ddd3c1; border-radius: 10px; background: rgba(255,253,248,.88); }
    .toolbar-left { display: flex; align-items: center; gap: 12px; min-width: 0; }
    .filters { display: flex; align-items: center; gap: 5px; }
    .filter-button { padding: 7px 10px; border: 1px solid transparent; border-radius: 7px; background: transparent; color: #736e65; font: inherit; font-size: 11px; font-weight: 700; white-space: nowrap; cursor: pointer; }
    .filter-button:hover { color: #3c3d40; background: #f1ece2; }
    .filter-button.active { border-color: #c7ad78; background: #f5ebd5; color: #7d5a1e; }
    .filter-count { margin-left: 4px; color: #9a9489; font-family: "Cascadia Mono", Consolas, monospace; }
    .filter-button.active .filter-count { color: #a17831; }
    .search-group { display: flex; align-items: center; gap: 8px; padding-left: 12px; border-left: 1px solid #ddd3c1; }
    .search-input { width: clamp(190px, 19vw, 290px); min-height: 34px; padding: 7px 10px; border: 1px solid #d5c9b4; border-radius: 8px; background: #fffefa; color: #303238; font: inherit; font-size: 12px; outline: none; }
    .search-input::placeholder { color: #9a9489; }
    .search-input:focus { border-color: #a77a2d; box-shadow: 0 0 0 3px rgba(167,122,45,.12); }
    .result-count { min-width: 76px; color: #817b70; font: 700 10px/1.2 "Cascadia Mono", Consolas, monospace; white-space: nowrap; }
    .best-signal { min-width: 0; color: #817b70; font-size: 11px; white-space: nowrap; }
    .best-signal strong { margin-right: 7px; color: #98702c; font-size: 9px; letter-spacing: .12em; }
    .best-signal a { display: inline-block; max-width: 460px; overflow: hidden; color: #5f5c56; text-overflow: ellipsis; text-decoration: none; vertical-align: bottom; white-space: nowrap; }
    .best-signal a:hover { color: #8b631f; }
    .panel { overflow: auto; background: #fffefa; border: 1px solid #d8cdb7; border-radius: 15px; box-shadow: 0 15px 42px rgba(72,58,34,.1), inset 0 1px rgba(255,255,255,.9); scrollbar-color: #b4965d #eee8dc; }
    table { width: 100%; min-width: 1280px; border-collapse: separate; border-spacing: 0; }
    th, td { padding: 13px 14px; border-bottom: 1px solid #ebe5da; text-align: left; vertical-align: middle; white-space: nowrap; }
    th { position: sticky; top: 0; z-index: 2; background: linear-gradient(180deg, #eee9df, #e8e2d7); color: #735824; font-size: 12px; font-weight: 750; letter-spacing: .035em; box-shadow: inset 0 -1px #d2c6af; }
    tbody tr { transition: background-color .16s ease; }
    tbody tr:hover { background: #fbf4e7; }
    .sort-button { display: inline-flex; align-items: center; gap: 6px; padding: 5px 7px; margin: -5px -7px; border: 0; border-radius: 7px; background: transparent; color: inherit; font: inherit; font-weight: inherit; white-space: nowrap; cursor: pointer; }
    .sort-button:hover { background: rgba(167,122,45,.09); color: #8f6723; }
    .sort-button:focus-visible { outline: 2px solid #a77a2d; outline-offset: 2px; }
    .sort-icon { min-width: 12px; color: #aa9a79; font-size: 14px; line-height: 1; }
    th[aria-sort="ascending"] .sort-icon, th[aria-sort="descending"] .sort-icon { color: #9b6f24; }
    td { color: #34373c; font-size: 13px; }
    tr:last-child td { border-bottom: 0; }
    th:first-child, td:first-child { padding-left: 18px; }
    th:last-child, td:last-child { padding-right: 18px; }
    th:first-child { left: 0; z-index: 4; }
    td:first-child { position: sticky; left: 0; z-index: 1; background: #fffefa; box-shadow: 1px 0 #e2dacb; }
    tbody tr:hover td:first-child { background: #fbf4e7; }
    .grade-cell, .numeric-cell, .condition-cell, .date-cell { width: 1%; white-space: nowrap; }
    .like-cell { font-variant-numeric: tabular-nums; }
    .freshness-dot { display: inline-block; width: 7px; height: 7px; margin-left: 7px; border-radius: 50%; vertical-align: 1px; }
    .freshness-dot.is-fresh { background: #3f8766; box-shadow: 0 0 0 3px rgba(63,135,102,.12); }
    .freshness-dot.is-stale { background: #b58a3d; box-shadow: 0 0 0 3px rgba(181,138,61,.12); }
    .product-cell { width: 100%; min-width: 430px; }
    .product-title-line { display: flex; align-items: center; gap: 7px; max-width: 680px; min-width: 0; }
    .title, .reasons { display: block; max-width: 680px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .title { min-width: 0; color: #7f5b1d; font-weight: 720; text-decoration: none; letter-spacing: .005em; }
    .title:hover { color: #a77a2d; text-decoration: underline; text-underline-offset: 3px; }
    .external-mark { margin-left: 5px; color: #a77a2d; font-size: 10px; }
    .product-meta { display: flex; align-items: center; gap: 7px; max-width: 680px; min-width: 0; margin-top: 5px; }
    .reasons { min-width: 0; color: #817b72; font-size: 11px; }
    .decision { flex: 0 0 auto; padding: 2px 6px; border: 1px solid; border-radius: 5px; font-size: 9px; font-weight: 800; line-height: 1.35; white-space: nowrap; }
    .decision-match { border-color: #8ebca5; background: #e8f4ed; color: #2f7254; }
    .decision-blocked { border-color: #d5b8a8; background: #f8eee8; color: #985a45; }
    .new-badge { flex: 0 0 auto; padding: 2px 5px; border: 1px solid #c2a66f; border-radius: 4px; background: #f7eedb; color: #8f6723; font: 800 8px/1.2 "Cascadia Mono", Consolas, monospace; letter-spacing: .08em; }
    .grade { display: inline-grid; width: 27px; height: 27px; place-items: center; border: 1px solid rgba(70,60,40,.12); border-radius: 8px; font-weight: 850; box-shadow: inset 0 1px rgba(255,255,255,.3); }
    .grade-label { margin-left: 5px; color: #817b72; font-size: 11px; }
    .grade-S { background: linear-gradient(145deg, #c89d47, #8c611f); color: #fffaf0; } .grade-A { background: #3f8766; color: #fff; } .grade-B { background: #d39b31; color: #33250d; } .grade-C { background: #8b8b86; color: #fff; }
    .empty { padding: 48px; color: #817b72; text-align: center; }
    @media (max-width: 1280px) { .toolbar { align-items: flex-start; flex-direction: column; } .toolbar-left { width: 100%; flex-wrap: wrap; } }
    @media (max-width: 1050px) { .page-header { align-items: flex-start; flex-direction: column; gap: 10px; } .header-meta { align-items: flex-start; } .hint { text-align: left; } .summary-grid { grid-template-columns: repeat(2, minmax(150px, 1fr)); } .search-group { width: 100%; padding: 8px 0 0; border-top: 1px solid #ddd3c1; border-left: 0; } .search-input { flex: 1; width: auto; } }
  </style>
</head>
<body><main>
  <header class="page-header">
    <div class="brand-lockup"><span class="brand-mark">M</span><div><p class="eyebrow">MERCARI LAPTOP MONITOR</p><h1>メルカリ笔记本监测结果</h1></div></div>
    <div class="header-meta">
      <div id="monitor-status" class="monitor-status" title="未运行时请双击 open-results.cmd"><span class="monitor-status-dot" aria-hidden="true"></span><span id="monitor-status-text">正在检测后台状态…</span></div>
      <p class="hint">搜索或点击栏目排序 · 页面每10分钟刷新 · 后台每${escapeHtml(config.pollMinutes ?? 10)}分钟检查</p>
    </div>
  </header>
  <section class="summary-grid" aria-label="监测概览">
    <div class="summary-card"><span class="summary-label">当前记录</span><span class="summary-value">${safeEntries.length}</span></div>
    <div class="summary-card positive"><span class="summary-label">符合提醒</span><span class="summary-value">${qualifiedEntries.length}</span></div>
    <div class="summary-card signal"><span class="summary-label">24H 新上架</span><span class="summary-value">${recentEntries.length}</span></div>
    <div class="summary-card"><span class="summary-label">S / A 级</span><span class="summary-value">${topGradeEntries.length}</span></div>
  </section>
  <section class="toolbar" aria-label="搜索与快捷筛选">
    <div class="toolbar-left">
      <div class="filters" role="group" aria-label="结果筛选">
        <button type="button" class="filter-button active" data-filter="all">全部<span class="filter-count">${safeEntries.length}</span></button>
        <button type="button" class="filter-button" data-filter="match">只看符合<span class="filter-count">${qualifiedEntries.length}</span></button>
        <button type="button" class="filter-button" data-filter="top">S/A级<span class="filter-count">${topGradeEntries.length}</span></button>
        <button type="button" class="filter-button" data-filter="new">24H新增<span class="filter-count">${recentEntries.length}</span></button>
      </div>
      <div class="search-group">
        <input id="product-search" class="search-input" type="search" aria-label="搜索商品" placeholder="搜索品牌、型号、CPU、判断…" autocomplete="off">
        <output id="result-count" class="result-count" for="product-search" aria-live="polite">显示 ${safeEntries.length} / ${safeEntries.length}</output>
      </div>
    </div>
    <div class="best-signal"><strong>BEST SIGNAL</strong>${bestEntry ? `<a title="${escapeHtml(bestEntry.title)}" href="${escapeHtml(bestEntry.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(bestEntry.grade)}级 · ¥${Number(bestEntry.price).toLocaleString('ja-JP')} · ${escapeHtml(bestEntry.title)}</a>` : '<span>暂无符合条件的商品</span>'}</div>
  </section>
  <div class="panel"><table>
    <thead><tr>
      <th aria-sort="none"><button type="button" class="sort-button" data-sort="grade" data-default-direction="desc">等级 <span class="sort-icon" aria-hidden="true">⇅</span></button></th>
      <th aria-sort="none"><button type="button" class="sort-button" data-sort="price" data-default-direction="asc">价格 <span class="sort-icon" aria-hidden="true">⇅</span></button></th>
      <th aria-sort="none"><button type="button" class="sort-button" data-sort="likes" data-default-direction="desc">いいね数 <span class="sort-icon" aria-hidden="true">⇅</span></button></th>
      <th aria-sort="none"><button type="button" class="sort-button" data-sort="condition" data-default-direction="asc">商品状态 <span class="sort-icon" aria-hidden="true">⇅</span></button></th>
      <th aria-sort="none"><button type="button" class="sort-button" data-sort="title" data-default-direction="asc">商品 <span class="sort-icon" aria-hidden="true">⇅</span></button></th>
      <th aria-sort="none"><button type="button" class="sort-button" data-sort="published" data-default-direction="desc">发布时间 <span class="sort-icon" aria-hidden="true">⇅</span></button></th>
      <th aria-sort="none"><button type="button" class="sort-button" data-sort="time" data-default-direction="desc">检查时间 <span class="sort-icon" aria-hidden="true">⇅</span></button></th>
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
    const noResultsRow = document.querySelector('#no-results-row');
    const monitorStatus = document.querySelector('#monitor-status');
    const monitorStatusText = document.querySelector('#monitor-status-text');
    const storageKey = 'mercari-laptop-monitor-sort';
    const filterStorageKey = 'mercari-laptop-monitor-filter';
    const searchStorageKey = 'mercari-laptop-monitor-search';
    let currentSort = null;
    let currentFilter = 'all';
    let currentSearch = '';
    try { currentSort = JSON.parse(localStorage.getItem(storageKey)); } catch {}
    try { currentFilter = localStorage.getItem(filterStorageKey) || 'all'; } catch {}
    try { currentSearch = localStorage.getItem(searchStorageKey) || ''; } catch {}
    searchInput.value = currentSearch;

    ${embeddedNormalizeSearch}
    ${embeddedMatchesResultRow}

    function renderMonitorStatus(status) {
      const heartbeatMs = Date.parse(status?.heartbeatAt) || 0;
      const ageMs = heartbeatMs ? Date.now() - heartbeatMs : Infinity;
      const heartbeatText = heartbeatMs
        ? new Date(heartbeatMs).toLocaleTimeString('zh-CN', { hour12: false })
        : '';
      monitorStatus.classList.remove('is-online', 'is-busy', 'is-offline');
      if (!status || status.running !== true || ageMs > 900_000) {
        monitorStatus.classList.add('is-offline');
        monitorStatusText.textContent = heartbeatText
          ? '后台未运行 · 最后心跳 ' + heartbeatText
          : '后台未启动 · 请运行 open-results.cmd';
        return;
      }
      const busy = String(status.phase || '').startsWith('正在');
      monitorStatus.classList.add(busy ? 'is-busy' : 'is-online');
      monitorStatusText.textContent = (status.phase || '后台运行中')
        + (status.message ? ' · ' + status.message : '')
        + ' · ' + heartbeatText;
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
        return direction === 'asc' ? comparison : -comparison;
      });
      resultRows.forEach((row) => tbody.insertBefore(row, noResultsRow));
      sortButtons.forEach((button) => {
        const active = button.dataset.sort === key;
        button.querySelector('.sort-icon').textContent = active ? (direction === 'asc' ? '↑' : '↓') : '⇅';
        button.closest('th').setAttribute('aria-sort', active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none');
      });
      currentSort = { key, direction };
      if (remember) {
        try { localStorage.setItem(storageKey, JSON.stringify(currentSort)); } catch {}
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

    filterButtons.forEach((button) => button.addEventListener('click', () => {
      currentFilter = ['all', 'match', 'top', 'new'].includes(button.dataset.filter) ? button.dataset.filter : 'all';
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
    }
    currentFilter = ['all', 'match', 'top', 'new'].includes(currentFilter) ? currentFilter : 'all';
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
