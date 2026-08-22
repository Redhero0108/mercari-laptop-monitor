import { spawn } from 'node:child_process';
import { appendFile, open, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_ALLOWED_SERIES,
  hardFilterFailure,
  resultMatchesHardFilters,
} from './laptop-filters.mjs';
import { launchBrowser, readDetail, readSearch } from './mercari-adapter.mjs';
import { compareRecommendedEntries, renderResultsPage } from './results-page.mjs';
import { evaluatePriceDrop, mergeResultHistory } from './result-history.mjs';
import { assessCandidate, detectCpu } from './scoring.mjs';
import { restoreNewlyAllowedSeriesSkips } from './state-migrations.mjs';

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = path.join(APP_DIR, 'config.json');
const STATE_FILE = path.join(APP_DIR, 'state.json');
const ALERTS_FILE = path.join(APP_DIR, 'alerts.jsonl');
const LOG_FILE = path.join(APP_DIR, 'monitor.log');
const RESULTS_DATA_FILE = path.join(APP_DIR, 'results.json');
const RESULTS_HTML_FILE = path.join(APP_DIR, 'results.html');
const RESULTS_LOCK_FILE = path.join(APP_DIR, '.results.lock');
const PID_FILE = path.join(APP_DIR, 'monitor.pid');
const STATUS_SCRIPT_FILE = path.join(APP_DIR, 'monitor-status.js');

const args = new Set(process.argv.slice(2));
const diagnose = args.has('--diagnose');
const refreshMetadata = args.has('--refresh-metadata');
const refreshLikes = args.has('--refresh-likes');
const pruneInactive = args.has('--prune-inactive');
const once = diagnose || refreshMetadata || refreshLikes || pruneInactive || args.has('--once');
const alertExisting = args.has('--alert-existing');
const noNotify = diagnose || refreshLikes || pruneInactive || args.has('--no-notify');
const showBrowser = args.has('--show-browser');
const persistentMonitor = !once;

const defaults = {
  pollMinutes: 10,
  maxPriceYen: 70000,
  maxResultPriceYen: 99999,
  minScore: 58,
  minIntelGeneration: 12,
  intelOnly: false,
  minRyzenSeries: 6,
  maxConditionLevel: 3,
  detailCheckLimit: 15,
  metadataRefreshLimit: 5,
  likesRefreshMinutes: 10,
  likesRefreshConcurrency: 3,
  searchConcurrency: 3,
  headless: true,
  notify: true,
  allowedSeries: [...DEFAULT_ALLOWED_SERIES],
  excludeKeywords: ['ジャンク', 'JUNK', '部品取り'],
  queries: [
    'X1 Carbon 32GB',
    'HP ProBook 32GB',
    'Dell Precision 32GB',
    'レッツノート 32GB',
    'dynabook G83 32GB',
    'LIFEBOOK U7412 32GB',
    'NEC VersaPro 32GB',
    'ExpertBook B9 32GB',
    'VAIO Pro 32GB',
    'Dell Latitude 32GB',
    'HP EliteBook 32GB',
  ],
  wideQueries: [
    'X1 Carbon',
    'HP ProBook',
    'Dell Precision',
    'レッツノート',
    'dynabook G83',
    'LIFEBOOK U7412',
    'NEC VersaPro',
    'ExpertBook B9',
    'VAIO Pro',
    'Dell Latitude',
    'HP EliteBook',
  ],
};

const config = { ...defaults, ...JSON.parse(await readFile(CONFIG_FILE, 'utf8')) };
config.pollMinutes = Math.max(2, Number(config.pollMinutes) || 10);
config.detailCheckLimit = Math.max(1, Math.min(80, Number(config.detailCheckLimit) || 15));
config.metadataRefreshLimit = Math.max(0, Math.min(10, Number(config.metadataRefreshLimit) || 0));
config.likesRefreshMinutes = Math.max(5, Number(config.likesRefreshMinutes) || 10);
config.likesRefreshConcurrency = Math.max(1, Math.min(5, Number(config.likesRefreshConcurrency) || 3));
config.searchConcurrency = Math.max(1, Math.min(5, Number(config.searchConcurrency) || 3));
config.maxConditionLevel = Math.max(1, Math.min(6, Number(config.maxConditionLevel) || 3));
config.minIntelGeneration = Math.max(7, Math.min(15, Number(config.minIntelGeneration) || 12));
config.intelOnly = config.intelOnly !== false;
const parsedMaxResultPriceYen = Number(config.maxResultPriceYen);
config.maxResultPriceYen = Number.isFinite(parsedMaxResultPriceYen) && parsedMaxResultPriceYen >= 1
  ? Math.floor(parsedMaxResultPriceYen)
  : defaults.maxResultPriceYen;
config.allowedSeries = Array.isArray(config.allowedSeries)
  ? config.allowedSeries.map(String).map((id) => id.trim()).filter(Boolean)
  : defaults.allowedSeries;
config.queries = Array.isArray(config.queries) && config.queries.length ? config.queries : defaults.queries;
config.wideQueries = Array.isArray(config.wideQueries)
  ? config.wideQueries.map(String).map((query) => query.trim()).filter(Boolean)
  : defaults.wideQueries;
config.excludeKeywords = Array.isArray(config.excludeKeywords)
  ? config.excludeKeywords.map(String).map((word) => word.trim()).filter(Boolean)
  : defaults.excludeKeywords;

let state = await loadState();
let results = await loadResults();
let browser;
let nextSearchAt = 0;
let nextLikesRefreshAt = 0;
let monitorPhase = '正在启动';
let monitorMessage = '正在连接浏览器';
let statusWriteQueue = Promise.resolve();

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

async function claimMonitorPid() {
  if (!persistentMonitor) return;
  const existingPid = Number.parseInt(await readFile(PID_FILE, 'utf8').catch(() => ''), 10);
  if (Number.isInteger(existingPid) && existingPid > 0 && existingPid !== process.pid) {
    let isRunning = false;
    try {
      process.kill(existingPid, 0);
      isRunning = true;
    } catch {}
    if (isRunning) throw new Error(`监测器已经在后台运行（PID ${existingPid}）`);
  }
  await writeFile(PID_FILE, `${process.pid}\n`, 'utf8');
}

async function clearMonitorPid() {
  if (!persistentMonitor) return;
  const existingPid = Number.parseInt(await readFile(PID_FILE, 'utf8').catch(() => ''), 10);
  if (existingPid === process.pid) await unlink(PID_FILE).catch(() => {});
}

function writeMonitorStatus(running = true, phase = monitorPhase, message = monitorMessage) {
  if (!persistentMonitor) return Promise.resolve();
  const payload = {
    running,
    phase,
    message,
    pid: process.pid,
    heartbeatAt: new Date().toISOString(),
  };
  const script = `window.__MERCARI_MONITOR_STATUS__ = ${JSON.stringify(payload)};\n`;
  statusWriteQueue = statusWriteQueue
    .catch(() => {})
    .then(() => writeFile(STATUS_SCRIPT_FILE, script, 'utf8'));
  return statusWriteQueue;
}

async function setMonitorPhase(phase, message = '') {
  monitorPhase = phase;
  monitorMessage = message;
  await writeMonitorStatus().catch(() => {});
}

async function stopHeartbeat() {
  await writeMonitorStatus(false, '已停止', '请双击 open-results.cmd 启动后台监测');
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

function isAllowedConditionLevel(level) {
  return Number.isInteger(level) && level >= 1 && level <= config.maxConditionLevel;
}

function isAllowedCpu(cpu) {
  if (cpu?.family === 'core-ultra') return true;
  return cpu?.family === 'intel'
    && Number.isInteger(cpu.generation)
    && cpu.generation >= config.minIntelGeneration;
}

function isAllowedResultCpu(entry) {
  if (entry.cpuFamily === 'core-ultra') return true;
  if (entry.cpuFamily === 'intel' && Number.isInteger(entry.cpuGeneration)) {
    return entry.cpuGeneration >= config.minIntelGeneration;
  }
  const reasonText = Array.isArray(entry.reasons) ? entry.reasons.join(' ') : String(entry.reasons ?? '');
  const cpu = detectCpu(`${entry.title ?? ''} ${reasonText}`);
  return isAllowedCpu(cpu);
}

const HARD_FILTER_MESSAGES = {
  series: '不在指定品质商务系列中',
  memory: '内存不是32GB或无法确认',
  storage: '存储不足512GB或无法确认',
  ssd: '无法确认是SSD',
  risk: '存在外观、屏幕、严重故障或锁机风险',
  price: '价格达到或超过10万日元',
};

function hardFilterMessage(assessment) {
  const failure = hardFilterFailure(assessment, config.maxResultPriceYen);
  return failure ? HARD_FILTER_MESSAGES[failure] : null;
}

async function writeResultsPageUnlocked() {
  const entries = Object.values(results)
    .filter((entry) => isAllowedConditionLevel(entry.itemConditionLevel))
    .filter(isAllowedResultCpu)
    .filter((entry) => resultMatchesHardFilters(
      entry,
      config.allowedSeries,
      config.maxResultPriceYen,
    ))
    .sort(compareRecommendedEntries)
    .slice(0, 500);
  results = Object.fromEntries(entries.map((entry) => [entry.id, entry]));
  await Promise.all([
    writeFile(RESULTS_DATA_FILE, `${JSON.stringify(results, null, 2)}\n`, 'utf8'),
    writeFile(RESULTS_HTML_FILE, renderResultsPage(entries, config), 'utf8'),
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
    const now = new Date().toISOString();
    const current = {
      id: item.id,
      title: item.title,
      url: item.url,
      price: assessment.price,
      score: assessment.score,
      grade: assessment.grade,
      shouldAlert: assessment.shouldAlert,
      reasons: assessment.reasons,
      cpuFamily: assessment.cpu.family,
      cpuGeneration: assessment.cpu.generation ?? null,
      cpuLabel: assessment.cpu.label,
      has32GB: assessment.has32GB,
      has512GB: assessment.has512GB,
      hasSSD: assessment.hasSSD,
      seriesId: assessment.series?.id ?? null,
      seriesLabel: assessment.series?.label ?? null,
      seriesEligible: assessment.seriesEligible,
      likeCount: Number.isInteger(item.likeCount) ? item.likeCount : previous?.likeCount ?? null,
      likeCheckedAt: now,
      itemCondition: item.itemCondition ?? previous?.itemCondition ?? null,
      itemConditionLevel: assessment.itemConditionLevel ?? previous?.itemConditionLevel ?? null,
      conditionEligible: assessment.conditionEligible,
      conditionCheckedAt: now,
      publishedAt: item.publishedAt ?? previous?.publishedAt ?? null,
      checkedAt: now,
    };
    results[item.id] = mergeResultHistory(previous, current, now, {
      firstSeenAt: state.seen[item.id]?.seenAt,
      price: state.seen[item.id]?.price,
    });
    await writeResultsPageUnlocked();
  });
}

async function recordLiveResult(item, assessment) {
  let change = null;
  await withResultsLock(async () => {
    results = await loadResults();
    const previous = results[item.id];
    if (!previous) return;
    const now = new Date().toISOString();
    const hasLikeCount = Number.isInteger(item.likeCount);
    const current = {
      ...previous,
      title: item.title ?? previous.title,
      url: item.url ?? previous.url,
      price: assessment.price,
      score: assessment.score,
      grade: assessment.grade,
      shouldAlert: assessment.shouldAlert,
      reasons: assessment.reasons,
      cpuFamily: assessment.cpu.family,
      cpuGeneration: assessment.cpu.generation ?? null,
      cpuLabel: assessment.cpu.label,
      has32GB: assessment.has32GB,
      has512GB: assessment.has512GB,
      hasSSD: assessment.hasSSD,
      seriesId: assessment.series?.id ?? null,
      seriesLabel: assessment.series?.label ?? null,
      seriesEligible: assessment.seriesEligible,
      likeCount: hasLikeCount ? item.likeCount : previous.likeCount ?? null,
      likeCheckedAt: hasLikeCount ? now : previous.likeCheckedAt ?? null,
      likeAttemptedAt: now,
      likeRefreshError: hasLikeCount ? null : '商品页未返回いいね数',
      itemCondition: item.itemCondition ?? previous.itemCondition ?? null,
      itemConditionLevel: assessment.itemConditionLevel ?? previous.itemConditionLevel ?? null,
      conditionEligible: assessment.conditionEligible,
      conditionCheckedAt: now,
      publishedAt: item.publishedAt ?? previous.publishedAt ?? null,
      checkedAt: now,
    };
    results[item.id] = mergeResultHistory(previous, current, now, {
      firstSeenAt: state.seen[item.id]?.seenAt,
      price: state.seen[item.id]?.price,
    });
    change = { previousLike: previous.likeCount, currentLike: results[item.id].likeCount, hasLikeCount };
    await writeResultsPageUnlocked();
  });
  return change;
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

async function maybeNotifyPriceDrop(item, previousPrice, assessment) {
  if (noNotify || !config.notify) return false;
  const seen = state.seen[item.id];
  const drop = evaluatePriceDrop({
    previousPrice,
    currentPrice: assessment.price,
    shouldAlert: assessment.shouldAlert,
    maxPriceYen: config.maxPriceYen,
    lastAlertedPrice: seen?.alertedAtPrice,
  });
  if (!drop) return false;
  state.seen[item.id] = {
    ...seen,
    title: item.title,
    alertedAtPrice: drop.currentPrice,
    alertedAt: new Date().toISOString(),
  };
  await saveState();
  notify(item, assessment);
  await recordAlert(item, assessment);
  await log(`  ↳ 降价提醒：¥${drop.previousPrice.toLocaleString('ja-JP')} → ¥${drop.currentPrice.toLocaleString('ja-JP')}；${item.title}`);
  return true;
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
      if (!isAllowedCpu(assessment.cpu)) {
        await removeResult(detailed);
        refreshed += 1;
        await log(`已剔除不符合CPU条件的商品：${assessment.cpu.label}；${detailed.title}`);
        continue;
      }
      if (!isAllowedConditionLevel(assessment.itemConditionLevel)) {
        await removeResult(detailed);
        refreshed += 1;
        await log(`已剔除商品状态第${assessment.itemConditionLevel ?? '未知'}级：${detailed.title}`);
        continue;
      }
      const rejection = hardFilterMessage(assessment);
      if (rejection) {
        await removeResult(detailed);
        refreshed += 1;
        await log(`已剔除不符合目标规格的商品：${rejection}；${detailed.title}`);
        continue;
      }
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

async function refreshAllLiveResults() {
  const refreshStartedAt = Date.now();
  nextLikesRefreshAt = refreshStartedAt + config.likesRefreshMinutes * 60_000;
  results = await loadResults();
  const candidates = Object.values(results)
    .filter((entry) => entry.id && entry.url)
    .sort((a, b) => String(a.likeCheckedAt || '').localeCompare(String(b.likeCheckedAt || '')));
  if (!candidates.length) {
    return { checked: 0, changed: 0, removed: 0, failed: 0 };
  }

  let cursor = 0;
  const totals = { checked: 0, changed: 0, removed: 0, filtered: 0, failed: 0, priceDrops: 0 };
  const workerCount = Math.min(config.likesRefreshConcurrency, candidates.length);
  await log(`开始刷新 ${candidates.length} 件商品的价格、いいね和状态（${workerCount} 路并行）。`);

  async function worker() {
    const page = await browser.newPage();
    try {
      while (cursor < candidates.length) {
        const entry = candidates[cursor];
        cursor += 1;
        try {
          const detailed = await readDetail(page, entry);
          totals.checked += 1;
          if (detailed.removed || detailed.sold) {
            if (await removeResult(detailed)) totals.removed += 1;
            await log(`已剔除失效商品：${detailed.title}（${detailed.unavailableReason}）`);
            continue;
          }
          const assessment = assessCandidate(detailed, config);
          if (!isAllowedCpu(assessment.cpu)) {
            if (await removeResult(detailed)) totals.filtered += 1;
            await log(`已剔除不符合CPU条件的商品：${assessment.cpu.label}；${detailed.title}`);
            continue;
          }
          if (!isAllowedConditionLevel(assessment.itemConditionLevel)) {
            if (await removeResult(detailed)) totals.filtered += 1;
            await log(`已剔除商品状态第${assessment.itemConditionLevel ?? '未知'}级：${detailed.title}`);
            continue;
          }
          const rejection = hardFilterMessage(assessment);
          if (rejection) {
            if (await removeResult(detailed)) totals.filtered += 1;
            await log(`已剔除不符合目标规格的商品：${rejection}；${detailed.title}`);
            continue;
          }
          const change = await recordLiveResult(detailed, assessment);
          if (await maybeNotifyPriceDrop(detailed, Number(entry.price), assessment)) {
            totals.priceDrops += 1;
          }
          if (!change?.hasLikeCount) totals.failed += 1;
          if (change?.hasLikeCount && change.previousLike !== change.currentLike) {
            totals.changed += 1;
            await log(`いいね更新：${change.previousLike ?? '未取得'} → ${change.currentLike}；${detailed.title}`);
          }
        } catch (error) {
          totals.failed += 1;
          await log(`实时资料更新 ${entry.id} 失败：${error.message}`);
        }
      }
    } finally {
      await page.close().catch(() => {});
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  await log(`实时资料刷新完成：检查 ${totals.checked} 件，いいね变化 ${totals.changed} 件，失效剔除 ${totals.removed} 件，筛选条件剔除 ${totals.filtered} 件，未取得 ${totals.failed} 件，降价提醒 ${totals.priceDrops} 件。`);
  return totals;
}

async function searchQueries(queries, { limit = 60 } = {}) {
  if (!queries.length) return [];
  const results = [];
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(config.searchConcurrency, queries.length));
  async function worker() {
    const page = await browser.newPage();
    try {
      while (cursor < queries.length) {
        const query = queries[cursor];
        cursor += 1;
        try {
          const items = await readSearch(page, query, { limit });
          results.push({ query, items, ok: true });
          await log(`搜索“${query}”：读取 ${items.length} 件在售商品`);
        } catch (error) {
          results.push({ query, items: [], ok: false, error });
          await log(`搜索“${query}”失败：${error.message}`);
        }
      }
    } finally {
      await page.close().catch(() => {});
    }
  }
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

async function scanOnce() {
  const itemsById = new Map();
  const preciseResults = await searchQueries(config.queries, { limit: 60 });
  const wideResults = await searchQueries(config.wideQueries, { limit: 100 });
  const allQueryResults = [...preciseResults, ...wideResults];
  const successfulQueries = allQueryResults.filter((result) => result.ok).length;
  const queryResults = allQueryResults.map((result) => result.items);

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
      if (!isAllowedCpu(assessment.cpu)) {
        await removeResult(detailed);
        await log(`已跳过不符合CPU条件的商品：${assessment.cpu.label}；${detailed.title}`);
        if (!diagnose) {
          state.seen[item.id] = {
            seenAt: new Date().toISOString(),
            title: detailed.title,
            cpu: assessment.cpu.label,
          };
        }
        continue;
      }
      if (!isAllowedConditionLevel(assessment.itemConditionLevel)) {
        await removeResult(detailed);
        await log(`已跳过商品状态第${assessment.itemConditionLevel ?? '未知'}级：${detailed.title}`);
        if (!diagnose) {
          state.seen[item.id] = {
            seenAt: new Date().toISOString(),
            title: detailed.title,
            itemConditionLevel: assessment.itemConditionLevel,
          };
        }
        continue;
      }
      const rejection = hardFilterMessage(assessment);
      if (rejection) {
        await removeResult(detailed);
        await log(`已跳过不符合目标规格的商品：${rejection}；${detailed.title}`);
        if (!diagnose) {
          state.seen[item.id] = {
            seenAt: new Date().toISOString(),
            title: detailed.title,
            filtered: rejection,
          };
        }
        continue;
      }
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
    : await refreshResultsMetadata(config.metadataRefreshLimit, new Set(pending.map((item) => item.id)), true);
  await log(`本轮检查 ${pending.length} 件新商品，符合提醒条件 ${alertCount} 件；补查旧记录 ${refreshedCount} 件。`);
}

async function shutdown() {
  if (browser) await browser.close().catch(() => {});
  await clearMonitorPid();
  await stopHeartbeat().catch(() => {});
}

process.on('SIGINT', async () => {
  await log('收到停止指令，正在关闭。');
  await shutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await log('收到后台停止指令，正在关闭。');
  await shutdown();
  process.exit(0);
});

await claimMonitorPid();
const restoredSeriesSkips = restoreNewlyAllowedSeriesSkips(state, config.allowedSeries);
if (restoredSeriesSkips.length) {
  await saveState();
  await log(`已恢复 ${restoredSeriesSkips.length} 件因旧系列规则跳过的商品，等待重新检查。`);
}
await setMonitorPhase('正在启动', '正在准备结果页');
await syncResultsPage();
const startupMessage = pruneInactive
  ? `失效商品清理模式启动；本次将检查全部 ${Object.keys(results).length} 条结果。`
  : refreshLikes
    ? `实时资料刷新模式启动；本次将更新全部 ${Object.keys(results).length} 条结果。`
    : refreshMetadata
      ? `资料补查模式启动；本次将复查全部 ${missingMetadataCount()} 条缺少资料的旧记录。`
      : `${diagnose ? '诊断模式' : '监测器'}启动；每 ${config.pollMinutes} 分钟搜索新品，每 ${config.likesRefreshMinutes} 分钟刷新全部商品资料。`;
await log(startupMessage);
await log('可点击结果页：results.html（双击 open-results.cmd 打开）');
try {
  browser = await launchBrowser({ showBrowser, headless: config.headless, log });
  await setMonitorPhase('正在启动', '浏览器已连接，准备首次检查');
  do {
    try {
      if (pruneInactive) await refreshResultsMetadata(Number.POSITIVE_INFINITY, new Set(), false);
      else if (refreshLikes) await refreshAllLiveResults();
      else if (refreshMetadata) await refreshResultsMetadata(Number.POSITIVE_INFINITY, new Set(), true);
      else {
        if (Date.now() >= nextSearchAt) {
          nextSearchAt = Date.now() + config.pollMinutes * 60_000;
          await setMonitorPhase('正在搜索新品', '正在读取 Mercari 搜索结果');
          await scanOnce();
        }
        if (Date.now() >= nextLikesRefreshAt) {
          await setMonitorPhase('正在更新商品资料', '正在刷新价格、いいね和状态');
          await refreshAllLiveResults();
        }
        await setMonitorPhase('运行中', '等待下一轮检查');
      }
    } catch (error) {
      await log(`本轮失败：${error.message}`);
      await setMonitorPhase('运行中', '上一轮发生错误，稍后自动重试');
    }
    if (once) break;
    const nextWakeAt = Math.min(nextSearchAt, nextLikesRefreshAt);
    const waitMs = Math.max(1000, nextWakeAt - Date.now());
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  } while (true);
} finally {
  await shutdown();
}
