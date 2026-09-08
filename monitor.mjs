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
let monitorPhase = '起動中';
let monitorMessage = 'ブラウザへ接続中';
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
    if (isRunning) throw new Error(`モニターはすでにバックグラウンドで実行中です（PID ${existingPid}）`);
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
  await writeMonitorStatus(false, '停止済み', 'open-results.cmd をダブルクリックしてバックグラウンド監視を開始してください');
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
  if (!lockHandle) throw new Error('結果ファイルのロック待機がタイムアウトしました');

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
    // 書き込み前に毎回ディスク上の最新版を読み直し、並行する監視プロセスが古いメモリで補完済みデータを上書きしないようにする。
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
      likeRefreshError: hasLikeCount ? null : '商品ページからいいね数を取得できませんでした',
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
  const line = `[${new Date().toLocaleString('ja-JP', { hour12: false })}] ${message}`;
  console.log(line);
  await appendFile(LOG_FILE, `${line}\n`, 'utf8').catch(() => {});
}

function notificationBody(item, assessment) {
  const reasonText = assessment.reasons.slice(0, 5).join('、');
  return `${item.title}\n¥${assessment.price.toLocaleString('ja-JP')}　${assessment.grade}ランク\n${reasonText}\n\n商品ページを開きますか？`;
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
    `メルカリ高コスパノートPC：${assessment.grade}ランク`,
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
  await log(`  ↳ 値下げ通知：¥${drop.previousPrice.toLocaleString('ja-JP')} → ¥${drop.currentPrice.toLocaleString('ja-JP')}；${item.title}`);
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
        await log(`無効商品を除外しました：${detailed.title}（${detailed.unavailableReason}）`);
        continue;
      }
      const assessment = assessCandidate(detailed, config);
      if (!isAllowedCpu(assessment.cpu)) {
        await removeResult(detailed);
        refreshed += 1;
        await log(`CPU条件に合わない商品を除外しました：${assessment.cpu.label}；${detailed.title}`);
        continue;
      }
      if (!isAllowedConditionLevel(assessment.itemConditionLevel)) {
        await removeResult(detailed);
        refreshed += 1;
        await log(`商品状態レベル${assessment.itemConditionLevel ?? '不明'}の商品を除外しました：${detailed.title}`);
        continue;
      }
      const rejection = hardFilterMessage(assessment);
      if (rejection) {
        await removeResult(detailed);
        refreshed += 1;
        await log(`対象スペックに合わない商品を除外しました：${rejection}；${detailed.title}`);
        continue;
      }
      await recordResult(detailed, assessment);
      refreshed += 1;
      const likeText = Number.isInteger(detailed.likeCount) ? detailed.likeCount : '取得不可';
      const conditionText = detailed.itemCondition ?? '取得不可';
      await log(`資料を補完しました：状態 ${conditionText}；いいね ${likeText}；${detailed.title}`);
    } catch (error) {
      await markMetadataFailure(entry, error);
      await log(`${entry.id} の資料補完に失敗：${error.message}`);
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
  await log(`開始：${candidates.length} 件の商品の価格・いいね・状態を更新します（${workerCount} 並列）。`);

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
            await log(`無効商品を除外しました：${detailed.title}（${detailed.unavailableReason}）`);
            continue;
          }
          const assessment = assessCandidate(detailed, config);
          if (!isAllowedCpu(assessment.cpu)) {
            if (await removeResult(detailed)) totals.filtered += 1;
            await log(`CPU条件に合わない商品を除外しました：${assessment.cpu.label}；${detailed.title}`);
            continue;
          }
          if (!isAllowedConditionLevel(assessment.itemConditionLevel)) {
            if (await removeResult(detailed)) totals.filtered += 1;
            await log(`商品状態レベル${assessment.itemConditionLevel ?? '不明'}の商品を除外しました：${detailed.title}`);
            continue;
          }
          const rejection = hardFilterMessage(assessment);
          if (rejection) {
            if (await removeResult(detailed)) totals.filtered += 1;
            await log(`対象スペックに合わない商品を除外しました：${rejection}；${detailed.title}`);
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
          await log(`リアルタイム資料更新 ${entry.id} 失敗：${error.message}`);
        }
      }
    } finally {
      await page.close().catch(() => {});
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  await log(`リアルタイム資料更新が完了：確認 ${totals.checked} 件、いいね変化 ${totals.changed} 件、無効除外 ${totals.removed} 件、条件除外 ${totals.filtered} 件、取得不可 ${totals.failed} 件、値下げ通知 ${totals.priceDrops} 件。`);
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
          await log(`「${query}」を検索：販売中商品を ${items.length} 件取得`);
        } catch (error) {
          results.push({ query, items: [], ok: false, error });
          await log(`「${query}」の検索に失敗：${error.message}`);
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

  if (!successfulQueries) throw new Error('すべての検索に失敗したため、今回は状態を更新しません');
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
    await log(`初回実行でベースラインを確立：現在の商品を ${allItems.length} 件記録しました。次回から新規出品のみ通知します。`);
    return;
  }

  const pending = diagnose
    ? allItems.slice(0, config.detailCheckLimit)
    : allItems.filter((item) => !state.seen[item.id]).slice(0, config.detailCheckLimit);
  if (!pending.length) {
    await log('今回は新しい商品は見つかりませんでした。');
  }

  const detailPage = pending.length ? await browser.newPage() : null;
  let alertCount = 0;
  for (const item of pending) {
    try {
      const detailed = await readDetail(detailPage, item);
      if (detailed.removed || detailed.sold) {
        await removeResult(detailed);
        await log(`無効商品を除外しました：${detailed.title}（${detailed.unavailableReason}）`);
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
        await log(`CPU条件に合わない商品をスキップしました：${assessment.cpu.label}；${detailed.title}`);
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
        await log(`商品状態レベル${assessment.itemConditionLevel ?? '不明'}の商品をスキップしました：${detailed.title}`);
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
        await log(`対象スペックに合わない商品をスキップしました：${rejection}；${detailed.title}`);
        if (!diagnose) {
          state.seen[item.id] = {
            seenAt: new Date().toISOString(),
            title: detailed.title,
            filtered: rejection,
          };
        }
        continue;
      }
      const priceText = assessment.price === null ? '価格不明' : `¥${assessment.price.toLocaleString('ja-JP')}`;
      const conditionText = detailed.itemCondition ?? '状態不明';
      await log(`[${assessment.grade}ランク] [状態 ${conditionText}] ${priceText} ${detailed.title} ${detailed.url}`);
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
        await log(`  ↳ 通知条件に合致：${assessment.reasons.slice(0, 6).join('、')}`);
      }
    } catch (error) {
      await log(`${item.id} の読み込みに失敗：${error.message}`);
      // 一時的に読み込みに失敗した商品は次のラウンドで再試行し、ネットワークの揺らぎによる見逃しを防ぐ。
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
  await log(`今回は新商品 ${pending.length} 件を確認、通知条件合致 ${alertCount} 件；旧記録の補完 ${refreshedCount} 件。`);
}

async function shutdown() {
  if (browser) await browser.close().catch(() => {});
  await clearMonitorPid();
  await stopHeartbeat().catch(() => {});
}

process.on('SIGINT', async () => {
  await log('停止指令を受け取りました。シャットダウンします。');
  await shutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await log('バックグラウンド停止指令を受け取りました。シャットダウンします。');
  await shutdown();
  process.exit(0);
});

await claimMonitorPid();
const restoredSeriesSkips = restoreNewlyAllowedSeriesSkips(state, config.allowedSeries);
if (restoredSeriesSkips.length) {
  await saveState();
  await log(`旧シリーズルールでスキップされた ${restoredSeriesSkips.length} 件を復元し、再チェックを待っています。`);
}
await setMonitorPhase('起動中', '結果ページを準備中');
await syncResultsPage();
const startupMessage = pruneInactive
  ? `無効商品クリーンモードを開始；今回は全 ${Object.keys(results).length} 件の結果を確認します。`
  : refreshLikes
    ? `リアルタイム資料更新モードを開始；今回は全 ${Object.keys(results).length} 件の結果を更新します。`
    : refreshMetadata
      ? `資料補完モードを開始；今回は資料不足の旧記録 ${missingMetadataCount()} 件を再確認します。`
      : `${diagnose ? '診断モード' : 'モニター'}を開始；${config.pollMinutes} 分ごとに新商品を検索し、${config.likesRefreshMinutes} 分ごとに全商品資料を更新します。`;
await log(startupMessage);
await log('結果ページを開けます：results.html（open-results.cmd をダブルクリック）');
try {
  browser = await launchBrowser({ showBrowser, headless: config.headless, log });
  await setMonitorPhase('起動中', 'ブラウザ接続完了、初回チェックを準備中');
  do {
    try {
      if (pruneInactive) await refreshResultsMetadata(Number.POSITIVE_INFINITY, new Set(), false);
      else if (refreshLikes) await refreshAllLiveResults();
      else if (refreshMetadata) await refreshResultsMetadata(Number.POSITIVE_INFINITY, new Set(), true);
      else {
        if (Date.now() >= nextSearchAt) {
          nextSearchAt = Date.now() + config.pollMinutes * 60_000;
          await setMonitorPhase('新商品を検索中', 'Mercari の検索結果を読み込み中');
          await scanOnce();
        }
        if (Date.now() >= nextLikesRefreshAt) {
          await setMonitorPhase('商品資料を更新中', '価格・いいね・状態を更新中');
          await refreshAllLiveResults();
        }
        await setMonitorPhase('実行中', '次のチェックを待機中');
      }
    } catch (error) {
      await log(`今回の処理に失敗：${error.message}`);
      await setMonitorPhase('実行中', '前回エラーが発生、しばらくして自動再試行します');
    }
    if (once) break;
    const nextWakeAt = Math.min(nextSearchAt, nextLikesRefreshAt);
    const waitMs = Math.max(1000, nextWakeAt - Date.now());
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  } while (true);
} finally {
  await shutdown();
}
