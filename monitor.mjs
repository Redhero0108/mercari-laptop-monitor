import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
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
const SEARCH_BASE = 'https://jp.mercari.com/search';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36';

const args = new Set(process.argv.slice(2));
const diagnose = args.has('--diagnose');
const refreshMetadata = args.has('--refresh-metadata');
const once = diagnose || refreshMetadata || args.has('--once');
const alertExisting = args.has('--alert-existing');
const noNotify = diagnose || args.has('--no-notify');
const showBrowser = args.has('--show-browser');

const defaults = {
  pollMinutes: 5,
  maxPriceYen: 95000,
  minScore: 58,
  minIntelGeneration: 10,
  minRyzenSeries: 5,
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
config.queries = Array.isArray(config.queries) && config.queries.length ? config.queries : defaults.queries;
config.excludeKeywords = Array.isArray(config.excludeKeywords)
  ? config.excludeKeywords.map(String).map((word) => word.trim()).filter(Boolean)
  : defaults.excludeKeywords;

let state = await loadState();
let results = await loadResults();
let browser;

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

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderResultsPage(entries) {
  const rows = entries.length
    ? entries.map((entry) => {
      const price = entry.price === null ? '价格不明' : `¥${Number(entry.price).toLocaleString('ja-JP')}`;
      const likeCount = Number.isInteger(entry.likeCount)
        ? entry.likeCount.toLocaleString('ja-JP')
        : entry.likeCheckedAt ? '无法取得' : '尚未检查';
      const publishedAt = formatJstMinute(entry.publishedAt);
      const checkedAt = new Date(entry.checkedAt).toLocaleString('zh-CN', { hour12: false });
      const reasons = Array.isArray(entry.reasons) ? entry.reasons.join('、') : '';
      const status = entry.shouldAlert ? '<span class="match">符合提醒条件</span>' : '<span class="normal">未达提醒线</span>';
      const gradeRank = { S: 4, A: 3, B: 2, C: 1 }[entry.grade] ?? 0;
      return `<tr class="result-row" data-grade="${gradeRank}" data-price="${entry.price ?? ''}" data-likes="${Number.isInteger(entry.likeCount) ? entry.likeCount : ''}" data-title="${escapeHtml(entry.title)}" data-match="${entry.shouldAlert ? 1 : 0}" data-published="${entry.publishedAt ? Date.parse(entry.publishedAt) : ''}" data-time="${Date.parse(entry.checkedAt) || 0}">
        <td><span class="grade grade-${escapeHtml(entry.grade)}">${escapeHtml(entry.grade)}</span><span class="grade-label">级</span></td>
        <td>${escapeHtml(price)}</td>
        <td>${escapeHtml(likeCount)}</td>
        <td><a class="title" href="${escapeHtml(entry.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(entry.title)}</a><div class="reasons">${escapeHtml(reasons)}</div></td>
        <td>${status}</td>
        <td class="date-cell">${escapeHtml(publishedAt)}</td>
        <td>${escapeHtml(checkedAt)}</td>
        <td><a class="open" href="${escapeHtml(entry.url)}" target="_blank" rel="noopener noreferrer">打开商品</a></td>
      </tr>`;
    }).join('\n')
    : '<tr><td class="empty" colspan="8">还没有检查结果，请先运行监测器或诊断模式。</td></tr>';

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="refresh" content="30">
  <title>メルカリ笔记本监测结果</title>
  <style>
    :root { color-scheme: light; font-family: "Segoe UI", "Microsoft YaHei", sans-serif; }
    body { margin: 0; background: #f5f7fb; color: #1d2733; }
    main { width: min(1380px, calc(100% - 32px)); margin: 26px auto; }
    h1 { margin: 0 0 6px; font-size: 25px; }
    .hint { margin: 0 0 18px; color: #667085; }
    .panel { overflow-x: auto; background: white; border: 1px solid #e4e7ec; border-radius: 12px; box-shadow: 0 8px 28px rgba(16,24,40,.06); }
    table { width: 100%; border-collapse: collapse; min-width: 1240px; }
    th, td { padding: 13px 14px; border-bottom: 1px solid #edf0f4; text-align: left; vertical-align: top; }
    th { background: #fafbfc; color: #475467; font-size: 13px; }
    .sort-button { display: inline-flex; align-items: center; gap: 6px; padding: 3px 5px; margin: -3px -5px; border: 0; border-radius: 6px; background: transparent; color: inherit; font: inherit; font-weight: 700; cursor: pointer; }
    .sort-button:hover { background: #eef2f6; color: #1d2733; }
    .sort-button:focus-visible { outline: 2px solid #1677d2; outline-offset: 2px; }
    .sort-icon { min-width: 12px; color: #98a2b3; font-size: 15px; line-height: 1; }
    th[aria-sort="ascending"] .sort-icon, th[aria-sort="descending"] .sort-icon { color: #075ec7; }
    td { font-size: 14px; }
    tr:last-child td { border-bottom: 0; }
    .title { color: #075ec7; font-weight: 650; text-decoration: none; }
    .title:hover { text-decoration: underline; }
    .reasons { margin-top: 5px; color: #667085; font-size: 12px; }
    .grade { display: inline-grid; width: 25px; height: 25px; place-items: center; border-radius: 7px; font-weight: 750; color: white; }
    .grade-label { margin-left: 4px; color: #475467; }
    .grade-S { background: #9b51e0; } .grade-A { background: #12a66a; } .grade-B { background: #e8a20c; } .grade-C { background: #7a8491; }
    .match { color: #087443; font-weight: 700; } .normal { color: #667085; }
    .date-cell { white-space: nowrap; }
    .open { display: inline-block; padding: 7px 11px; border-radius: 7px; background: #e60023; color: white; text-decoration: none; white-space: nowrap; }
    .open:hover { background: #c9001f; }
    .empty { padding: 42px; color: #667085; text-align: center; }
  </style>
</head>
<body><main>
  <h1>メルカリ笔记本监测结果</h1>
  <p class="hint">点击栏目名称可切换升序／降序；页面每30秒自动刷新。点击商品标题或“打开商品”即可跳转。</p>
  <div class="panel"><table>
    <thead><tr>
      <th aria-sort="none"><button type="button" class="sort-button" data-sort="grade" data-default-direction="desc">等级 <span class="sort-icon" aria-hidden="true">⇅</span></button></th>
      <th aria-sort="none"><button type="button" class="sort-button" data-sort="price" data-default-direction="asc">价格 <span class="sort-icon" aria-hidden="true">⇅</span></button></th>
      <th aria-sort="none"><button type="button" class="sort-button" data-sort="likes" data-default-direction="desc">いいね数 <span class="sort-icon" aria-hidden="true">⇅</span></button></th>
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
    const buttons = [...document.querySelectorAll('.sort-button')];
    const storageKey = 'mercari-laptop-monitor-sort';
    let currentSort = null;
    try { currentSort = JSON.parse(localStorage.getItem(storageKey)); } catch {}

    function valueFor(row, key) {
      if (key === 'title') return row.dataset.title || '';
      if ((key === 'price' || key === 'likes' || key === 'published') && row.dataset[key] === '') return null;
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
      buttons.forEach((button) => {
        const active = button.dataset.sort === key;
        button.querySelector('.sort-icon').textContent = active ? (direction === 'asc' ? '↑' : '↓') : '⇅';
        button.closest('th').setAttribute('aria-sort', active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none');
      });
      currentSort = { key, direction };
      if (remember) {
        try { localStorage.setItem(storageKey, JSON.stringify(currentSort)); } catch {}
      }
    }

    buttons.forEach((button) => button.addEventListener('click', () => {
      const key = button.dataset.sort;
      const direction = currentSort?.key === key
        ? (currentSort.direction === 'asc' ? 'desc' : 'asc')
        : button.dataset.defaultDirection;
      applySort(key, direction);
    }));

    if (currentSort && buttons.some((button) => button.dataset.sort === currentSort.key)) {
      applySort(currentSort.key, currentSort.direction === 'asc' ? 'asc' : 'desc', false);
    }
  })();
</script>
</body></html>\n`;
}

async function writeResultsPage() {
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

async function recordResult(item, assessment) {
  results[item.id] = {
    id: item.id,
    title: item.title,
    url: item.url,
    price: assessment.price,
    score: assessment.score,
    grade: assessment.grade,
    shouldAlert: assessment.shouldAlert,
    reasons: assessment.reasons,
    likeCount: Number.isInteger(item.likeCount) ? item.likeCount : results[item.id]?.likeCount ?? null,
    likeCheckedAt: new Date().toISOString(),
    publishedAt: item.publishedAt ?? results[item.id]?.publishedAt ?? null,
    checkedAt: new Date().toISOString(),
  };
  await writeResultsPage();
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
  await page.goto(item.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  let pageData = { mainText: '', photoUrls: [], likeText: null };
  for (const delay of [1400, 2200, 3200]) {
    await page.waitForTimeout(delay);
    pageData = await page.evaluate(() => ({
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
    }));
    if (pageData.mainText.trim()) break;
  }
  if (!pageData.mainText.trim()) throw new Error(`商品详情为空（页面：${page.url()}）`);
  const ownListing = pageData.mainText.split('商品の情報')[0].slice(0, 12000);
  return {
    ...item,
    detail: ownListing,
    price: item.price ?? parsePrice(ownListing),
    likeCount: parseLikeCount(pageData.likeText),
    publishedAt: extractPublishedAtFromPhotoUrls(pageData.photoUrls, item.id),
    sold: /売り切れました|SOLD/i.test(ownListing),
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
  const existing = results[item.id];
  if (!existing) return;
  results[item.id] = {
    ...existing,
    likeCheckedAt: new Date().toISOString(),
    metadataError: error.message,
  };
  await writeResultsPage();
}

async function refreshResultsMetadata(limit, excludeIds = new Set(), missingLikesOnly = false) {
  if (limit <= 0) return 0;
  const candidates = Object.values(results)
    .filter((entry) => entry.id
      && entry.url
      && !excludeIds.has(entry.id)
      && (!missingLikesOnly || !Number.isInteger(entry.likeCount)))
    .sort((a, b) => Number(Number.isInteger(a.likeCount)) - Number(Number.isInteger(b.likeCount))
      || String(a.likeCheckedAt || '').localeCompare(String(b.likeCheckedAt || '')))
    .slice(0, limit);
  if (!candidates.length) return 0;

  const page = await browser.newPage();
  let refreshed = 0;
  for (const entry of candidates) {
    try {
      const detailed = await readDetail(page, entry);
      const assessment = assessCandidate(detailed, config);
      await recordResult(detailed, assessment);
      refreshed += 1;
      const likeText = Number.isInteger(detailed.likeCount) ? detailed.likeCount : '无法取得';
      await log(`补查资料：いいね ${likeText}；${detailed.title}`);
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
      const assessment = assessCandidate(detailed, config);
      const priceText = assessment.price === null ? '价格不明' : `¥${assessment.price.toLocaleString('ja-JP')}`;
      await log(`[${assessment.grade}级] ${priceText} ${detailed.title} ${detailed.url}`);
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

await writeResultsPage();
const startupMessage = refreshMetadata
  ? `资料补查模式启动；本次最多补查 ${config.detailCheckLimit} 条旧记录。`
  : `${diagnose ? '诊断模式' : '监测器'}启动；查询 ${config.queries.length} 组，每 ${config.pollMinutes} 分钟检查一次。`;
await log(startupMessage);
await log('可点击结果页：results.html（双击 open-results.cmd 打开）');
try {
  browser = await launchBrowser();
  do {
    try {
      if (refreshMetadata) await refreshResultsMetadata(config.detailCheckLimit, new Set(), true);
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
