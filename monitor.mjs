import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { appendFile, open, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { detectListingAvailability } from './availability.mjs';
import { parseLikeCount } from './likes.mjs';
import { assessCandidate, parsePrice } from './scoring.mjs';
import { extractPublishedAtFromPhotoUrls, formatJstMinute } from './time.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = path.join(APP_DIR, 'config.json');
const STATE_FILE = path.join(APP_DIR, 'state.json');
const ALERTS_FILE = path.join(APP_DIR, 'alerts.jsonl');
const LOG_FILE = path.join(APP_DIR, 'monitor.log');
const RESULTS_DATA_FILE = path.join(APP_DIR, 'results.json');
const RESULTS_HTML_FILE = path.join(APP_DIR, 'results.html');
const RESULTS_LOCK_FILE = path.join(APP_DIR, '.results.lock');
const SEARCH_BASE = 'https://jp.mercari.com/search';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36';

const args = new Set(process.argv.slice(2));
const diagnose = args.has('--diagnose');
const refreshMetadata = args.has('--refresh-metadata');
const pruneInactive = args.has('--prune-inactive');
const once = diagnose || refreshMetadata || pruneInactive || args.has('--once');
const alertExisting = args.has('--alert-existing');
const noNotify = diagnose || pruneInactive || args.has('--no-notify');
const showBrowser = args.has('--show-browser');

const defaults = {
  pollMinutes: 5,
  maxPriceYen: 95000,
  minScore: 58,
  minIntelGeneration: 10,
  minRyzenSeries: 5,
  maxConditionLevel: 3,
  detailCheckLimit: 15,
  metadataRefreshLimit: 5,
  headless: true,
  notify: true,
  excludeKeywords: ['ジャンク', 'JUNK', '部品取り'],
  queries: [
    '32GB 1TB ノートPC',
    '32G 1TB ノートパソコン',
    'メモリ32GB SSD1TB ノート',
    '32GB 512GB ノートPC',
    'メモリ32GB SSD512GB ノート',
  ],
};

const config = { ...defaults, ...JSON.parse(await readFile(CONFIG_FILE, 'utf8')) };
config.pollMinutes = Math.max(2, Number(config.pollMinutes) || 5);
config.detailCheckLimit = Math.max(1, Math.min(30, Number(config.detailCheckLimit) || 15));
config.metadataRefreshLimit = Math.max(0, Math.min(10, Number(config.metadataRefreshLimit) || 0));
config.maxConditionLevel = Math.max(1, Math.min(6, Number(config.maxConditionLevel) || 3));
config.queries = Array.isArray(config.queries) && config.queries.length ? config.queries : defaults.queries;
config.excludeKeywords = Array.isArray(config.excludeKeywords)
  ? config.excludeKeywords.map(String).map((word) => word.trim()).filter(Boolean)
  : defaults.excludeKeywords;

let state = await loadState();
let results = await loadResults();
let browser;

function missingMetadataCount() {
  return Object.values(results).filter((entry) => entry.id
    && entry.url
    && (!Number.isInteger(entry.likeCount) || !Number.isInteger(entry.itemConditionLevel))).length;
}

async function loadState() {
  try {
    const parsed = JSON.parse(await readFile(STATE_FILE, 'utf8'));
    return {
      initialized: Boolean(parsed.initialized),
      seen: parsed.seen && typeof parsed.seen === 'object' ? parsed.seen : {},
    };
  } catch {
    return { initialized: false, seen: {} };
  }
}

async function saveState() {
  const entries = Object.entries(state.seen)
    .sort((a, b) => String(b[1].seenAt).localeCompare(String(a[1].seenAt)))
    .slice(0, 5000);
  state.seen = Object.fromEntries(entries);
  await writeFile(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

async function loadResults() {
  try {
    const parsed = JSON.parse(await readFile(RESULTS_DATA_FILE, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function withResultsLock(action) {
  let lockHandle = null;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      lockHandle = await open(RESULTS_LOCK_FILE, 'wx');
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (attempt % 20 === 19) {
        const lockAge = Date.now() - (await stat(RESULTS_LOCK_FILE).catch(() => null))?.mtimeMs;
        if (Number.isFinite(lockAge) && lockAge > 120_000) {
          await unlink(RESULTS_LOCK_FILE).catch(() => {});
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  if (!lockHandle) throw new Error('等待结果文件锁超时');

  try {
    return await action();
  } finally {
    await lockHandle.close().catch(() => {});
    await unlink(RESULTS_LOCK_FILE).catch(() => {});
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderResultsPage(entries) {
  const recentCutoff = Date.now() - 24 * 60 * 60 * 1000;
  const isRecentEntry = (entry) => entry.publishedAt && Date.parse(entry.publishedAt) >= recentCutoff;
  const qualifiedEntries = entries.filter((entry) => entry.shouldAlert && entry.conditionEligible === true);
  const recentEntries = entries.filter(isRecentEntry);
  const topGradeEntries = entries.filter((entry) => entry.grade === 'S' || entry.grade === 'A');
  const bestEntry = [...qualifiedEntries].sort((a, b) => Number(b.score) - Number(a.score)
    || Number(a.price ?? Infinity) - Number(b.price ?? Infinity))[0] ?? null;
  const rows = entries.length
    ? entries.map((entry) => {
      const price = entry.price === null ? '价格不明' : `¥${Number(entry.price).toLocaleString('ja-JP')}`;
      const likeCount = Number.isInteger(entry.likeCount)
        ? entry.likeCount.toLocaleString('ja-JP')
        : entry.likeCheckedAt ? '无法取得' : '尚未检查';
      const conditionLevel = Number.isInteger(entry.itemConditionLevel) ? entry.itemConditionLevel : null;
      const itemCondition = conditionLevel === null
        ? entry.conditionCheckedAt ? '无法取得' : '尚未检查'
        : `${conditionLevel}｜${entry.itemCondition}`;
      const publishedAt = formatJstMinute(entry.publishedAt);
      const checkedAt = new Date(entry.checkedAt).toLocaleString('zh-CN', { hour12: false });
      const reasons = Array.isArray(entry.reasons) ? entry.reasons.join('、') : '';
      const shouldAlert = entry.shouldAlert && entry.conditionEligible === true;
      const status = shouldAlert ? '<span class="match">符合提醒条件</span>' : '<span class="normal">未达提醒线</span>';
      const gradeRank = { S: 4, A: 3, B: 2, C: 1 }[entry.grade] ?? 0;
      const isRecent = isRecentEntry(entry);
      const newBadge = isRecent ? '<span class="new-badge">NEW</span>' : '';
      return `<tr class="result-row" data-grade="${gradeRank}" data-price="${entry.price ?? ''}" data-likes="${Number.isInteger(entry.likeCount) ? entry.likeCount : ''}" data-condition="${conditionLevel ?? ''}" data-title="${escapeHtml(entry.title)}" data-match="${shouldAlert ? 1 : 0}" data-new="${isRecent ? 1 : 0}" data-published="${entry.publishedAt ? Date.parse(entry.publishedAt) : ''}" data-time="${Date.parse(entry.checkedAt) || 0}">
        <td class="grade-cell"><span class="grade grade-${escapeHtml(entry.grade)}">${escapeHtml(entry.grade)}</span><span class="grade-label">级</span></td>
        <td class="numeric-cell">${escapeHtml(price)}</td>
        <td class="numeric-cell">${escapeHtml(likeCount)}</td>
        <td class="condition-cell">${escapeHtml(itemCondition)}</td>
        <td class="product-cell"><div class="product-title-line">${newBadge}<a class="title" title="${escapeHtml(entry.title)}" href="${escapeHtml(entry.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(entry.title)}</a></div><div class="reasons" title="${escapeHtml(reasons)}">${escapeHtml(reasons)}</div></td>
        <td class="status-cell">${status}</td>
        <td class="date-cell">${escapeHtml(publishedAt)}</td>
        <td class="date-cell">${escapeHtml(checkedAt)}</td>
        <td class="action-cell"><a class="open" href="${escapeHtml(entry.url)}" target="_blank" rel="noopener noreferrer">打开商品</a></td>
      </tr>`;
    }).join('\n')
    : '<tr><td class="empty" colspan="9">还没有检查结果，请先运行监测器或诊断模式。</td></tr>';

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="refresh" content="30">
  <title>メルカリ笔记本监测结果</title>
  <style>
    :root { color-scheme: light; font-family: Inter, "Segoe UI", "Microsoft YaHei", "Yu Gothic UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: linear-gradient(180deg, #f7f4ed 0, #f1ede4 48%, #ebe6dc 100%); color: #25282d; }
    main { width: min(1880px, calc(100% - 40px)); margin: 30px auto 46px; }
    .page-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 32px; margin: 0 4px 20px; }
    .brand-lockup { display: flex; align-items: center; gap: 14px; min-width: 0; }
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
    .toolbar { display: flex; align-items: center; justify-content: space-between; gap: 18px; min-height: 46px; margin-bottom: 10px; padding: 7px 9px; border: 1px solid #ddd3c1; border-radius: 10px; background: rgba(255,253,248,.88); }
    .filters { display: flex; align-items: center; gap: 5px; }
    .filter-button { padding: 7px 10px; border: 1px solid transparent; border-radius: 7px; background: transparent; color: #736e65; font: inherit; font-size: 11px; font-weight: 700; white-space: nowrap; cursor: pointer; }
    .filter-button:hover { color: #3c3d40; background: #f1ece2; }
    .filter-button.active { border-color: #c7ad78; background: #f5ebd5; color: #7d5a1e; }
    .filter-count { margin-left: 4px; color: #9a9489; font-family: "Cascadia Mono", Consolas, monospace; }
    .filter-button.active .filter-count { color: #a17831; }
    .best-signal { min-width: 0; color: #817b70; font-size: 11px; white-space: nowrap; }
    .best-signal strong { margin-right: 7px; color: #98702c; font-size: 9px; letter-spacing: .12em; }
    .best-signal a { display: inline-block; max-width: 520px; overflow: hidden; color: #5f5c56; text-overflow: ellipsis; text-decoration: none; vertical-align: bottom; white-space: nowrap; }
    .best-signal a:hover { color: #8b631f; }
    .panel { overflow: auto; background: #fffefa; border: 1px solid #d8cdb7; border-radius: 15px; box-shadow: 0 15px 42px rgba(72,58,34,.1), inset 0 1px rgba(255,255,255,.9); scrollbar-color: #b4965d #eee8dc; }
    table { width: 100%; min-width: 1660px; border-collapse: separate; border-spacing: 0; }
    th, td { padding: 14px 16px; border-bottom: 1px solid #ebe5da; text-align: left; vertical-align: middle; white-space: nowrap; }
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
    th:first-child, td:first-child { padding-left: 20px; }
    th:last-child, td:last-child { padding-right: 20px; }
    th:first-child { left: 0; z-index: 4; }
    td:first-child { position: sticky; left: 0; z-index: 1; background: #fffefa; box-shadow: 1px 0 #e2dacb; }
    tbody tr:hover td:first-child { background: #fbf4e7; }
    .grade-cell, .numeric-cell, .condition-cell, .status-cell, .date-cell, .action-cell { width: 1%; white-space: nowrap; }
    .product-cell { width: 100%; min-width: 520px; }
    .product-title-line { display: flex; align-items: center; gap: 7px; max-width: 720px; min-width: 0; }
    .title, .reasons { display: block; max-width: 720px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .title { min-width: 0; }
    .title { color: #7f5b1d; font-weight: 720; text-decoration: none; letter-spacing: .005em; }
    .title:hover { color: #a77a2d; text-decoration: underline; text-underline-offset: 3px; }
    .reasons { margin-top: 5px; color: #817b72; font-size: 11px; }
    .new-badge { flex: 0 0 auto; padding: 2px 5px; border: 1px solid #c2a66f; border-radius: 4px; background: #f7eedb; color: #8f6723; font: 800 8px/1.2 "Cascadia Mono", Consolas, monospace; letter-spacing: .08em; }
    .grade { display: inline-grid; width: 27px; height: 27px; place-items: center; border: 1px solid rgba(70,60,40,.12); border-radius: 8px; font-weight: 850; box-shadow: inset 0 1px rgba(255,255,255,.3); }
    .grade-label { margin-left: 5px; color: #817b72; font-size: 11px; }
    .grade-S { background: linear-gradient(145deg, #c89d47, #8c611f); color: #fffaf0; } .grade-A { background: #3f8766; color: #fff; } .grade-B { background: #d39b31; color: #33250d; } .grade-C { background: #8b8b86; color: #fff; }
    .match, .normal { display: inline-flex; align-items: center; min-height: 26px; padding: 4px 9px; border-radius: 999px; font-size: 11px; font-weight: 750; white-space: nowrap; }
    .match { border: 1px solid #8ebca5; background: #e8f4ed; color: #2f7254; } .normal { border: 1px solid #ddd8ce; background: #f4f2ed; color: #77736b; }
    .open { display: inline-block; padding: 8px 13px; border: 1px solid #8d6422; border-radius: 8px; background: linear-gradient(145deg, #b58738, #8f6422); color: #fffaf0; font-weight: 800; text-decoration: none; white-space: nowrap; box-shadow: 0 5px 14px rgba(126,88,28,.17); transition: transform .15s ease, filter .15s ease; }
    .open:hover { filter: brightness(1.1); transform: translateY(-1px); }
    .empty { padding: 48px; color: #817b72; text-align: center; }
    @media (max-width: 1050px) { .page-header { align-items: flex-start; flex-direction: column; gap: 10px; } .hint { text-align: left; } .summary-grid { grid-template-columns: repeat(2, minmax(150px, 1fr)); } .toolbar { align-items: flex-start; flex-direction: column; } }
  </style>
</head>
<body><main>
  <header class="page-header">
    <div class="brand-lockup"><span class="brand-mark">M</span><div><p class="eyebrow">MERCARI LAPTOP MONITOR</p><h1>メルカリ笔记本监测结果</h1></div></div>
    <p class="hint">点击栏目排序 · 每30秒自动刷新 · 点击商品即可跳转</p>
  </header>
  <section class="summary-grid" aria-label="监测概览">
    <div class="summary-card"><span class="summary-label">当前记录</span><span class="summary-value">${entries.length}</span></div>
    <div class="summary-card positive"><span class="summary-label">符合提醒</span><span class="summary-value">${qualifiedEntries.length}</span></div>
    <div class="summary-card signal"><span class="summary-label">24H 新上架</span><span class="summary-value">${recentEntries.length}</span></div>
    <div class="summary-card"><span class="summary-label">S / A 级</span><span class="summary-value">${topGradeEntries.length}</span></div>
  </section>
  <section class="toolbar" aria-label="快捷筛选">
    <div class="filters" role="group" aria-label="结果筛选">
      <button type="button" class="filter-button active" data-filter="all">全部<span class="filter-count">${entries.length}</span></button>
      <button type="button" class="filter-button" data-filter="match">只看符合<span class="filter-count">${qualifiedEntries.length}</span></button>
      <button type="button" class="filter-button" data-filter="top">S/A级<span class="filter-count">${topGradeEntries.length}</span></button>
      <button type="button" class="filter-button" data-filter="new">24H新增<span class="filter-count">${recentEntries.length}</span></button>
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
      <th aria-sort="none"><button type="button" class="sort-button" data-sort="match" data-default-direction="desc">判断 <span class="sort-icon" aria-hidden="true">⇅</span></button></th>
      <th aria-sort="none"><button type="button" class="sort-button" data-sort="published" data-default-direction="desc">发布时间 <span class="sort-icon" aria-hidden="true">⇅</span></button></th>
      <th aria-sort="none"><button type="button" class="sort-button" data-sort="time" data-default-direction="desc">检查时间 <span class="sort-icon" aria-hidden="true">⇅</span></button></th>
      <th>链接</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table></div>
</main>
<script>
  (() => {
    const tbody = document.querySelector('tbody');
    const sortButtons = [...document.querySelectorAll('.sort-button')];
    const filterButtons = [...document.querySelectorAll('.filter-button')];
    const storageKey = 'mercari-laptop-monitor-sort';
    const filterStorageKey = 'mercari-laptop-monitor-filter';
    let currentSort = null;
    let currentFilter = 'all';
    try { currentSort = JSON.parse(localStorage.getItem(storageKey)); } catch {}
    try { currentFilter = localStorage.getItem(filterStorageKey) || 'all'; } catch {}

    function valueFor(row, key) {
      if (key === 'title') return row.dataset.title || '';
      if ((key === 'price' || key === 'likes' || key === 'condition' || key === 'published') && row.dataset[key] === '') return null;
      return Number(row.dataset[key]);
    }

    function applySort(key, direction, remember = true) {
      const rows = [...tbody.querySelectorAll('.result-row')];
      rows.sort((left, right) => {
        const a = valueFor(left, key);
        const b = valueFor(right, key);
        if (a === null && b !== null) return 1;
        if (a !== null && b === null) return -1;
        const comparison = typeof a === 'string'
          ? a.localeCompare(b, 'ja-JP', { numeric: true, sensitivity: 'base' })
          : a - b;
        return direction === 'asc' ? comparison : -comparison;
      });
      rows.forEach((row) => tbody.append(row));
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

    function applyFilter(filter, remember = true) {
      const validFilter = ['all', 'match', 'top', 'new'].includes(filter) ? filter : 'all';
      [...tbody.querySelectorAll('.result-row')].forEach((row) => {
        const visible = validFilter === 'all'
          || (validFilter === 'match' && row.dataset.match === '1')
          || (validFilter === 'top' && Number(row.dataset.grade) >= 3)
          || (validFilter === 'new' && row.dataset.new === '1');
        row.hidden = !visible;
      });
      filterButtons.forEach((button) => button.classList.toggle('active', button.dataset.filter === validFilter));
      currentFilter = validFilter;
      if (remember) {
        try { localStorage.setItem(filterStorageKey, validFilter); } catch {}
      }
    }

    sortButtons.forEach((button) => button.addEventListener('click', () => {
      const key = button.dataset.sort;
      const direction = currentSort?.key === key
        ? (currentSort.direction === 'asc' ? 'desc' : 'asc')
        : button.dataset.defaultDirection;
      applySort(key, direction);
    }));

    filterButtons.forEach((button) => button.addEventListener('click', () => applyFilter(button.dataset.filter)));

    if (currentSort && sortButtons.some((button) => button.dataset.sort === currentSort.key)) {
      applySort(currentSort.key, currentSort.direction === 'asc' ? 'asc' : 'desc', false);
    }
    applyFilter(currentFilter, false);
  })();
</script>
</body></html>\n`;
}

async function writeResultsPageUnlocked() {
  const entries = Object.values(results)
    .sort((a, b) => Number(b.shouldAlert) - Number(a.shouldAlert)
      || String(b.checkedAt).localeCompare(String(a.checkedAt)))
    .slice(0, 500);
  results = Object.fromEntries(entries.map((entry) => [entry.id, entry]));
  await Promise.all([
    writeFile(RESULTS_DATA_FILE, `${JSON.stringify(results, null, 2)}\n`, 'utf8'),
    writeFile(RESULTS_HTML_FILE, renderResultsPage(entries), 'utf8'),
  ]);
}

async function syncResultsPage() {
  await withResultsLock(async () => {
    results = await loadResults();
    await writeResultsPageUnlocked();
  });
}

async function recordResult(item, assessment) {
  await withResultsLock(async () => {
    // 每次写入前重新读取磁盘最新版，避免并行监测进程用旧内存覆盖已补查的数据。
    results = await loadResults();
    const previous = results[item.id];
    results[item.id] = {
      id: item.id,
      title: item.title,
      url: item.url,
      price: assessment.price,
      score: assessment.score,
      grade: assessment.grade,
      shouldAlert: assessment.shouldAlert,
      reasons: assessment.reasons,
      likeCount: Number.isInteger(item.likeCount) ? item.likeCount : previous?.likeCount ?? null,
      likeCheckedAt: new Date().toISOString(),
      itemCondition: item.itemCondition ?? previous?.itemCondition ?? null,
      itemConditionLevel: assessment.itemConditionLevel ?? previous?.itemConditionLevel ?? null,
      conditionEligible: assessment.conditionEligible,
      conditionCheckedAt: new Date().toISOString(),
      publishedAt: item.publishedAt ?? previous?.publishedAt ?? null,
      checkedAt: new Date().toISOString(),
    };
    await writeResultsPageUnlocked();
  });
}

async function removeResult(item) {
  let removed = false;
  await withResultsLock(async () => {
    results = await loadResults();
    if (!results[item.id]) return;
    delete results[item.id];
    removed = true;
    await writeResultsPageUnlocked();
  });
  return removed;
}

async function log(message) {
  const line = `[${new Date().toLocaleString('zh-CN', { hour12: false })}] ${message}`;
  console.log(line);
  await appendFile(LOG_FILE, `${line}\n`, 'utf8').catch(() => {});
}

function searchUrl(query) {
  const url = new URL(SEARCH_BASE);
  url.searchParams.set('keyword', query);
  url.searchParams.set('status', 'on_sale');
  url.searchParams.set('sort', 'created_time');
  url.searchParams.set('order', 'desc');
  url.searchParams.set(
    'item_condition_id',
    Array.from({ length: config.maxConditionLevel }, (_, index) => index + 1).join(','),
  );
  if (config.excludeKeywords.length) {
    url.searchParams.set('exclude_keyword', config.excludeKeywords.join(' '));
  }
  return url.href;
}

async function launchBrowser() {
  const headless = showBrowser ? false : Boolean(config.headless);
  const common = { headless, locale: 'ja-JP', userAgent: USER_AGENT };
  const attempts = [
    ['Brave', { ...common, executablePath: 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe' }],
    ['Google Chrome', { ...common, channel: 'chrome' }],
    ['Microsoft Edge', { ...common, channel: 'msedge' }],
    ['Playwright Chromium', common],
  ];
  const errors = [];
  for (const [name, options] of attempts) {
    try {
      const instance = await chromium.launch(options);
      await log(`浏览器已启动：${name}${headless ? '（后台）' : '（可见）'}`);
      return instance;
    } catch (error) {
      errors.push(`${name}: ${error.message.split(/\r?\n/, 1)[0]}`);
    }
  }
  throw new Error(`无法启动浏览器：${errors.join('；')}`);
}

async function readSearch(page, query) {
  await page.goto(searchUrl(query), { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForTimeout(2200);
  const cards = await page.evaluate(() => Array.from(document.querySelectorAll('a[href*="/item/"]'))
    .slice(0, 60)
    .map((anchor) => ({
      href: anchor.href,
      text: (anchor.innerText || anchor.getAttribute('aria-label') || anchor.querySelector('img')?.alt || '').trim(),
      alt: (anchor.querySelector('img')?.alt || '').trim(),
    }))
    .filter((item) => /\/item\/m\d+/.test(item.href) && item.text));

  const unique = new Map();
  for (const card of cards) {
    const id = card.href.match(/\/item\/(m\d+)/)?.[1];
    if (!id || unique.has(id)) continue;
    const lines = card.text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const rawTitle = card.alt || lines
      .filter((line) => !/^(?:¥|￥|\d+%OFF|現在|[\d,]+円?)$/.test(line))
      .join(' ')
      .trim() || card.text;
    const title = rawTitle.replace(/のサムネイル$/, '').trim();
    unique.set(id, {
      id,
      title,
      price: parsePrice(card.text),
      url: `https://jp.mercari.com/item/${id}`,
      query,
    });
  }
  return [...unique.values()];
}

async function readDetail(page, item) {
  const response = await page.goto(item.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  let pageData = { mainText: '', photoUrls: [], likeText: null, itemCondition: null, soldButtonText: null };
  for (const delay of [1400, 2200, 3200]) {
    await page.waitForTimeout(delay);
    pageData = await page.evaluate(() => {
      const conditionElement = document.querySelector('[data-testid="商品の状態"]');
      const itemCondition = conditionElement
        ? [...conditionElement.childNodes]
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent)
          .join(' ')
          .trim()
        : null;
      return {
        mainText: document.querySelector('main')?.innerText || '',
        photoUrls: [
        document.querySelector('meta[property="og:image"]')?.content,
        ...[...document.images].flatMap((image) => [
          image.getAttribute('src'),
          image.currentSrc,
          ...(image.getAttribute('srcset') || '').split(',').map((part) => part.trim().split(/\s+/, 1)[0]),
        ]),
        ].filter(Boolean),
        likeText: document.querySelector('[data-testid="icon-heart-button"] button')?.innerText?.trim() ?? null,
        itemCondition,
        soldButtonText: [...document.querySelectorAll('button')]
          .find((button) => button.disabled && button.textContent?.trim() === '売り切れました')
          ?.textContent?.trim() ?? null,
      };
    });
    if (pageData.mainText.trim()) break;
  }
  if (!pageData.mainText.trim()) throw new Error(`商品详情为空（页面：${page.url()}）`);
  const availability = detectListingAvailability(
    pageData.mainText,
    response?.status() ?? null,
    pageData.soldButtonText,
  );
  const ownListing = pageData.mainText.split('商品の情報')[0].slice(0, 12000);
  return {
    ...item,
    detail: ownListing,
    price: item.price ?? parsePrice(ownListing),
    likeCount: parseLikeCount(pageData.likeText),
    itemCondition: pageData.itemCondition ?? item.itemCondition ?? null,
    publishedAt: extractPublishedAtFromPhotoUrls(pageData.photoUrls, item.id),
    sold: availability.sold,
    removed: availability.removed,
    unavailableReason: availability.reason,
  };
}

function notificationBody(item, assessment) {
  const reasonText = assessment.reasons.slice(0, 5).join('、');
  return `${item.title}\n¥${assessment.price.toLocaleString('ja-JP')}　${assessment.grade}级\n${reasonText}\n\n是否打开商品页面？`;
}

function notify(item, assessment) {
  if (noNotify || !config.notify) return;
  const script = [
    'Add-Type -AssemblyName PresentationFramework',
    '$r=[System.Windows.MessageBox]::Show($args[1],$args[0],[System.Windows.MessageBoxButton]::YesNo,[System.Windows.MessageBoxImage]::Information)',
    "if($r -eq [System.Windows.MessageBoxResult]::Yes){Start-Process $args[2]}",
  ].join(';');
  spawn('powershell.exe', [
    '-NoProfile', '-STA', '-Command', script,
    `メルカリ高性价比笔记本：${assessment.grade}级`,
    notificationBody(item, assessment),
    item.url,
  ], { detached: true, windowsHide: false, stdio: 'ignore' }).unref();
}

async function recordAlert(item, assessment) {
  const record = { alertedAt: new Date().toISOString(), ...item, assessment };
  await appendFile(ALERTS_FILE, `${JSON.stringify(record)}\n`, 'utf8');
}

async function markMetadataFailure(item, error) {
  await withResultsLock(async () => {
    results = await loadResults();
    const existing = results[item.id];
    if (!existing) return;
    results[item.id] = {
      ...existing,
      likeCheckedAt: new Date().toISOString(),
      conditionCheckedAt: new Date().toISOString(),
      metadataError: error.message,
    };
    await writeResultsPageUnlocked();
  });
}

async function refreshResultsMetadata(limit, excludeIds = new Set(), uncheckedMetadataOnly = false) {
  if (limit <= 0) return 0;
  const candidates = Object.values(results)
    .filter((entry) => entry.id
      && entry.url
      && !excludeIds.has(entry.id)
      && (!uncheckedMetadataOnly
        || !Number.isInteger(entry.likeCount)
        || !Number.isInteger(entry.itemConditionLevel)))
    .sort((a, b) => (Number(Number.isInteger(a.likeCount)) + Number(Number.isInteger(a.itemConditionLevel)))
      - (Number(Number.isInteger(b.likeCount)) + Number(Number.isInteger(b.itemConditionLevel)))
      || String(a.likeCheckedAt || '').localeCompare(String(b.likeCheckedAt || '')))
    .slice(0, limit);
  if (!candidates.length) return 0;

  const page = await browser.newPage();
  let refreshed = 0;
  for (const entry of candidates) {
    try {
      const detailed = await readDetail(page, entry);
      if (detailed.removed || detailed.sold) {
        await removeResult(detailed);
        refreshed += 1;
        await log(`已剔除失效商品：${detailed.title}（${detailed.unavailableReason}）`);
        continue;
      }
      const assessment = assessCandidate(detailed, config);
      await recordResult(detailed, assessment);
      refreshed += 1;
      const likeText = Number.isInteger(detailed.likeCount) ? detailed.likeCount : '无法取得';
      const conditionText = detailed.itemCondition ?? '无法取得';
      await log(`补查资料：状态 ${conditionText}；いいね ${likeText}；${detailed.title}`);
    } catch (error) {
      await markMetadataFailure(entry, error);
      await log(`补查 ${entry.id} 失败：${error.message}`);
    }
  }
  await page.close();
  return refreshed;
}

async function scanOnce() {
  const searchPage = await browser.newPage();
  const itemsById = new Map();
  const queryResults = [];
  let successfulQueries = 0;

  for (const query of config.queries) {
    try {
      const items = await readSearch(searchPage, query);
      successfulQueries += 1;
      queryResults.push(items);
      await log(`搜索“${query}”：读取 ${items.length} 件在售商品`);
    } catch (error) {
      await log(`搜索“${query}”失败：${error.message}`);
    }
  }
  await searchPage.close();

  if (!successfulQueries) throw new Error('所有搜索均失败，本轮不更新状态');
  const longestResult = Math.max(0, ...queryResults.map((items) => items.length));
  for (let index = 0; index < longestResult; index += 1) {
    for (const items of queryResults) {
      const item = items[index];
      if (item && !itemsById.has(item.id)) itemsById.set(item.id, item);
    }
  }
  const allItems = [...itemsById.values()];

  if (!state.initialized && !alertExisting && !diagnose) {
    const now = new Date().toISOString();
    for (const item of allItems) state.seen[item.id] = { seenAt: now, title: item.title, price: item.price };
    state.initialized = true;
    await saveState();
    await log(`首次运行已建立基线：记录 ${allItems.length} 件当前商品；从下一轮开始只提醒新上架商品。`);
    return;
  }

  const pending = diagnose
    ? allItems.slice(0, config.detailCheckLimit)
    : allItems.filter((item) => !state.seen[item.id]).slice(0, config.detailCheckLimit);
  if (!pending.length) {
    await log('本轮没有发现新商品。');
  }

  const detailPage = pending.length ? await browser.newPage() : null;
  let alertCount = 0;
  for (const item of pending) {
    try {
      const detailed = await readDetail(detailPage, item);
      if (detailed.removed || detailed.sold) {
        await removeResult(detailed);
        await log(`已剔除失效商品：${detailed.title}（${detailed.unavailableReason}）`);
        if (!diagnose) {
          state.seen[item.id] = {
            seenAt: new Date().toISOString(),
            title: detailed.title,
            removed: detailed.removed,
            sold: detailed.sold,
          };
        }
        continue;
      }
      const assessment = assessCandidate(detailed, config);
      const priceText = assessment.price === null ? '价格不明' : `¥${assessment.price.toLocaleString('ja-JP')}`;
      const conditionText = detailed.itemCondition ?? '状态不明';
      await log(`[${assessment.grade}级] [状态 ${conditionText}] ${priceText} ${detailed.title} ${detailed.url}`);
      await recordResult(detailed, assessment);
      if (!diagnose) {
        state.seen[item.id] = {
          seenAt: new Date().toISOString(),
          title: detailed.title,
          price: assessment.price,
          score: assessment.score,
        };
      }
      if (!detailed.sold && assessment.shouldAlert) {
        alertCount += 1;
        if (!diagnose) {
          notify(detailed, assessment);
          await recordAlert(detailed, assessment);
        }
        await log(`  ↳ 符合提醒条件：${assessment.reasons.slice(0, 6).join('、')}`);
      }
    } catch (error) {
      await log(`读取 ${item.id} 失败：${error.message}`);
      // 暂时加载失败的商品留到下一轮重试，避免因为网络波动漏报。
    }
  }
  if (detailPage) await detailPage.close();

  if (!diagnose) {
    state.initialized = true;
    await saveState();
  }
  const refreshedCount = diagnose
    ? 0
    : await refreshResultsMetadata(config.metadataRefreshLimit, new Set(pending.map((item) => item.id)));
  await log(`本轮检查 ${pending.length} 件新商品，符合提醒条件 ${alertCount} 件；补查旧记录 ${refreshedCount} 件。`);
}

async function shutdown() {
  if (browser) await browser.close().catch(() => {});
}

process.on('SIGINT', async () => {
  await log('收到停止指令，正在关闭。');
  await shutdown();
  process.exit(0);
});

await syncResultsPage();
const startupMessage = pruneInactive
  ? `失效商品清理模式启动；本次将检查全部 ${Object.keys(results).length} 条结果。`
  : refreshMetadata
    ? `资料补查模式启动；本次将复查全部 ${missingMetadataCount()} 条缺少资料的旧记录。`
    : `${diagnose ? '诊断模式' : '监测器'}启动；查询 ${config.queries.length} 组，每 ${config.pollMinutes} 分钟检查一次。`;
await log(startupMessage);
await log('可点击结果页：results.html（双击 open-results.cmd 打开）');
try {
  browser = await launchBrowser();
  do {
    try {
      if (pruneInactive) await refreshResultsMetadata(Number.POSITIVE_INFINITY, new Set(), false);
      else if (refreshMetadata) await refreshResultsMetadata(Number.POSITIVE_INFINITY, new Set(), true);
      else await scanOnce();
    } catch (error) {
      await log(`本轮失败：${error.message}`);
    }
    if (once) break;
    await new Promise((resolve) => setTimeout(resolve, config.pollMinutes * 60_000));
  } while (true);
} finally {
  await shutdown();
}
