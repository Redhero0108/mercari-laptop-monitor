import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, readFile, rename, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const CLI_VERSION = '1.1.0';
export const JSON_SCHEMA_VERSION = '1';

export class CliError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'CliError';
    this.code = code;
    this.details = details;
  }
}

export function taskId(keyword) {
  const normalized = normalizeKeywordForCompare(keyword);
  return `query-${createHash('sha256').update(normalized).digest('hex').slice(0, 12)}`;
}

function normalizeKeyword(keyword) {
  const normalized = String(keyword ?? '').normalize('NFKC').trim();
  if (!normalized) throw new CliError('KEYWORD_REQUIRED', 'キーワードを入力してください');
  if (normalized.length > 200) throw new CliError('KEYWORD_TOO_LONG', 'キーワードは200文字以内で入力してください');
  return normalized;
}

function normalizeKeywordForCompare(keyword) {
  return String(keyword ?? '').normalize('NFKC').trim().toLocaleLowerCase('ja-JP');
}

function taskFromKeyword(keyword) {
  return { id: taskId(keyword), keyword, enabled: true };
}

function findTaskIndex(queries, input) {
  const needle = normalizeKeywordForCompare(input);
  if (!needle) throw new CliError('TASK_REQUIRED', 'タスクIDまたは完全なキーワードを指定してください');
  const matches = queries.map((keyword, index) => ({ keyword, index }))
    .filter(({ keyword }) => taskId(keyword) === input || normalizeKeywordForCompare(keyword) === needle);
  if (!matches.length) throw new CliError('TASK_NOT_FOUND', `監視タスクが見つかりません：${input}`);
  if (matches.length > 1) throw new CliError('TASK_AMBIGUOUS', `監視タスクが一意ではありません：${input}`);
  return matches[0].index;
}

async function readKeywordConfig(appDir) {
  const configPath = path.join(appDir, 'config.json');
  const config = await readJson(configPath, 'CONFIG_NOT_FOUND');
  return {
    configPath,
    config,
    queries: Array.isArray(config.queries) ? [...config.queries] : [],
  };
}

export function successEnvelope(command, data, meta = {}) {
  return {
    ok: true,
    command,
    data,
    meta: { schemaVersion: JSON_SCHEMA_VERSION, cliVersion: CLI_VERSION, ...meta },
  };
}

export function errorEnvelope(command, error) {
  return {
    ok: false,
    command,
    error: {
      code: error?.code || 'UNEXPECTED_ERROR',
      message: error?.message || '不明なエラーが発生しました',
      ...(error?.details === undefined ? {} : { details: error.details }),
    },
    meta: { schemaVersion: JSON_SCHEMA_VERSION, cliVersion: CLI_VERSION },
  };
}

export async function readJson(filePath, missingCode = 'FILE_NOT_FOUND') {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') throw new CliError(missingCode, `ファイルが見つかりません：${filePath}`);
    if (error instanceof SyntaxError) throw new CliError('INVALID_JSON', `JSON形式が無効です：${filePath}`);
    throw error;
  }
}

async function writeJsonAtomic(filePath, value) {
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(tempPath, filePath);
}

export async function listTasks(appDir) {
  const config = await readJson(path.join(appDir, 'config.json'), 'CONFIG_NOT_FOUND');
  const queries = Array.isArray(config.queries) ? config.queries : [];
  return {
    tasks: queries.map((keyword) => ({
      id: taskId(keyword),
      keyword,
      enabled: true,
    })),
    count: queries.length,
    filters: {
      maxPriceYen: config.maxPriceYen ?? null,
      minIntelGeneration: config.minIntelGeneration ?? null,
      intelOnly: config.intelOnly === true,
      maxConditionLevel: config.maxConditionLevel ?? null,
    },
  };
}

export async function resolveTask(appDir, input) {
  const { queries } = await readKeywordConfig(appDir);
  return taskFromKeyword(queries[findTaskIndex(queries, input)]);
}

export async function addKeyword(appDir, keyword, { dryRun = false } = {}) {
  const normalized = normalizeKeyword(keyword);
  const { configPath, config, queries } = await readKeywordConfig(appDir);
  const duplicate = queries.find((item) => normalizeKeywordForCompare(item) === normalizeKeywordForCompare(normalized));
  const task = taskFromKeyword(duplicate ?? normalized);
  if (duplicate) return { added: false, duplicate: true, dryRun, task, total: queries.length };
  if (!dryRun) {
    config.queries = [...queries, normalized];
    await writeJsonAtomic(configPath, config);
  }
  return { added: true, duplicate: false, dryRun, task, total: queries.length + 1 };
}

export async function updateKeyword(appDir, target, keyword, { dryRun = false } = {}) {
  const normalized = normalizeKeyword(keyword);
  const { configPath, config, queries } = await readKeywordConfig(appDir);
  const index = findTaskIndex(queries, target);
  const duplicateIndex = queries.findIndex((item, itemIndex) => itemIndex !== index
    && normalizeKeywordForCompare(item) === normalizeKeywordForCompare(normalized));
  if (duplicateIndex >= 0) {
    throw new CliError('DUPLICATE_KEYWORD', `キーワードは別の監視タスクで使用されています：${queries[duplicateIndex]}`, {
      task: taskFromKeyword(queries[duplicateIndex]),
    });
  }
  const before = taskFromKeyword(queries[index]);
  const after = taskFromKeyword(normalized);
  const updated = before.keyword !== after.keyword;
  if (!dryRun && updated) {
    queries[index] = normalized;
    config.queries = queries;
    await writeJsonAtomic(configPath, config);
  }
  return { updated, dryRun, before, after, total: queries.length };
}

export async function removeKeyword(appDir, target, { dryRun = false } = {}) {
  const { configPath, config, queries } = await readKeywordConfig(appDir);
  const index = findTaskIndex(queries, target);
  const task = taskFromKeyword(queries[index]);
  const nextQueries = queries.filter((_, itemIndex) => itemIndex !== index);
  if (!dryRun) {
    config.queries = nextQueries;
    await writeJsonAtomic(configPath, config);
  }
  return { removed: true, dryRun, task, previousTotal: queries.length, total: nextQueries.length };
}

export async function clearKeywords(appDir, { dryRun = false, confirmed = false } = {}) {
  if (!dryRun && !confirmed) {
    throw new CliError('CONFIRMATION_REQUIRED', '全キーワードをクリアするには --yes が必要です。事前に --dry-run で確認できます');
  }
  const { configPath, config, queries } = await readKeywordConfig(appDir);
  const removedTasks = queries.map(taskFromKeyword);
  if (!dryRun && queries.length) {
    config.queries = [];
    await writeJsonAtomic(configPath, config);
  }
  return {
    cleared: queries.length > 0,
    dryRun,
    removedTasks,
    previousTotal: queries.length,
    total: 0,
  };
}

export async function replaceAllKeywords(appDir, keywords, { dryRun = false, confirmed = false } = {}) {
  if (!Array.isArray(keywords) || !keywords.length) {
    throw new CliError('KEYWORDS_REQUIRED', 'replace-all には --keyword が1つ以上必要です');
  }
  if (keywords.length > 100) throw new CliError('TOO_MANY_KEYWORDS', 'キーワードは一度に最大100個まで設定できます');
  if (!dryRun && !confirmed) {
    throw new CliError('CONFIRMATION_REQUIRED', '全キーワードを置き換えるには --yes が必要です。事前に --dry-run で確認できます');
  }
  const normalizedKeywords = keywords.map(normalizeKeyword);
  const seen = new Map();
  for (const keyword of normalizedKeywords) {
    const normalized = normalizeKeywordForCompare(keyword);
    if (seen.has(normalized)) {
      throw new CliError('DUPLICATE_KEYWORD', `キーワードが重複しています：${keyword}`);
    }
    seen.set(normalized, keyword);
  }
  const { configPath, config, queries } = await readKeywordConfig(appDir);
  const replaced = queries.length !== normalizedKeywords.length
    || queries.some((keyword, index) => keyword !== normalizedKeywords[index]);
  if (!dryRun && replaced) {
    config.queries = normalizedKeywords;
    await writeJsonAtomic(configPath, config);
  }
  return {
    replaced,
    dryRun,
    previousTasks: queries.map(taskFromKeyword),
    tasks: normalizedKeywords.map(taskFromKeyword),
    previousTotal: queries.length,
    total: normalizedKeywords.length,
  };
}

function cpuFromEntry(entry) {
  const label = entry.cpuLabel
    ?? (Array.isArray(entry.reasons)
      ? entry.reasons.find((reason) => /Intel 第\d+代|Intel Core Ultra/.test(reason))
      : null)
    ?? null;
  return {
    family: entry.cpuFamily ?? (label?.includes('Core Ultra') ? 'core-ultra' : label ? 'intel' : null),
    generation: Number.isInteger(entry.cpuGeneration) ? entry.cpuGeneration : null,
    label,
  };
}

export function normalizeResult(entry) {
  return {
    id: entry.id,
    title: entry.title,
    url: entry.url,
    priceYen: Number.isFinite(entry.price) ? entry.price : null,
    grade: entry.grade ?? null,
    score: Number.isFinite(entry.score) ? entry.score : null,
    shouldAlert: entry.shouldAlert === true,
    likeCount: Number.isInteger(entry.likeCount) ? entry.likeCount : null,
    itemCondition: entry.itemCondition ?? null,
    itemConditionLevel: Number.isInteger(entry.itemConditionLevel) ? entry.itemConditionLevel : null,
    cpu: cpuFromEntry(entry),
    publishedAt: entry.publishedAt ?? null,
    checkedAt: entry.checkedAt ?? null,
  };
}

export async function recentResults(appDir, limit = 20) {
  const boundedLimit = Number(limit);
  if (!Number.isInteger(boundedLimit) || boundedLimit < 1 || boundedLimit > 200) {
    throw new CliError('INVALID_LIMIT', '--limit は1〜200の整数で指定してください');
  }
  const parsed = await readJson(path.join(appDir, 'results.json'), 'RESULTS_NOT_FOUND');
  const entries = Object.values(parsed && typeof parsed === 'object' ? parsed : {})
    .sort((a, b) => String(b.checkedAt ?? '').localeCompare(String(a.checkedAt ?? '')))
    .slice(0, boundedLimit)
    .map(normalizeResult);
  return { results: entries, count: entries.length, limit: boundedLimit };
}

export async function getResult(appDir, input) {
  const parsed = await readJson(path.join(appDir, 'results.json'), 'RESULTS_NOT_FOUND');
  const id = String(input ?? '').match(/m\d+/)?.[0] ?? String(input ?? '');
  const entry = parsed?.[id];
  if (!entry) throw new CliError('RESULT_NOT_FOUND', `商品の結果が見つかりません：${input}`);
  return normalizeResult(entry);
}

function exists(filePath) {
  return access(filePath).then(() => true, () => false);
}

async function checkEndpoint() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch('https://jp.mercari.com/', {
      method: 'HEAD',
      redirect: 'manual',
      signal: controller.signal,
      headers: { 'user-agent': `mercari-watch/${CLI_VERSION}` },
    });
    return { checked: true, reachable: true, status: response.status };
  } catch (error) {
    return { checked: true, reachable: false, status: null, error: error.name };
  } finally {
    clearTimeout(timer);
  }
}

export async function doctor(appDir, { offline = false } = {}) {
  const paths = {
    config: path.join(appDir, 'config.json'),
    monitor: path.join(appDir, 'monitor.mjs'),
    launcher: path.join(appDir, 'start-monitor.ps1'),
    results: path.join(appDir, 'results.json'),
  };
  const checks = Object.fromEntries(await Promise.all(Object.entries(paths)
    .map(async ([key, filePath]) => [key, { path: filePath, exists: await exists(filePath) }])));
  const runtimeRoot = path.join(os.homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node');
  const bundledNode = path.join(runtimeRoot, 'bin', 'node.exe');
  const bundledModules = path.join(runtimeRoot, 'node_modules');
  const runtime = {
    currentNode: process.execPath,
    currentNodeVersion: process.version,
    bundledNode: { path: bundledNode, exists: await exists(bundledNode) },
    bundledModules: { path: bundledModules, exists: await exists(bundledModules) },
  };
  const network = offline ? { checked: false, reachable: null, status: null } : await checkEndpoint();
  const ready = checks.config.exists && checks.monitor.exists && checks.launcher.exists
    && runtime.bundledNode.exists && runtime.bundledModules.exists;
  return {
    ready,
    sourceDirectory: appDir,
    auth: { required: false, source: 'not_required' },
    checks,
    runtime,
    network,
    capabilities: {
      monitorPublicListings: true,
      purchase: false,
      contactSeller: false,
    },
  };
}

export async function configView(appDir) {
  return readJson(path.join(appDir, 'config.json'), 'CONFIG_NOT_FOUND');
}

export function runProcess(file, args, { cwd, timeoutMs = 15 * 60_000, onStart } = {}) {
  return new Promise((resolve, reject) => {
    const startedAtMs = Date.now();
    onStart?.();
    const child = spawn(file, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(new CliError('PROCESS_START_FAILED', error.message));
    });
    child.on('close', async (exitCode) => {
      clearTimeout(timer);
      const finishedAtMs = Date.now();
      if (timedOut) {
        reject(new CliError('CHECK_TIMEOUT', `チェックが${Math.round(timeoutMs / 1000)}秒を超えたため、待機を停止しました`));
        return;
      }
      const result = {
        exitCode,
        startedAt: new Date(startedAtMs).toISOString(),
        finishedAt: new Date(finishedAtMs).toISOString(),
        durationMs: finishedAtMs - startedAtMs,
        stdout,
        stderr,
      };
      if (exitCode !== 0) {
        reject(new CliError('MONITOR_FAILED', `監視スクリプトが終了しました（コード${exitCode}）`, {
          exitCode,
          stderrTail: stderr.split(/\r?\n/).filter(Boolean).slice(-20),
        }));
        return;
      }
      resolve(result);
    });
  });
}

export async function runMonitor(appDir, monitorArgs, options = {}) {
  const script = path.join(appDir, 'start-monitor.ps1');
  const processResult = await runProcess('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...monitorArgs,
  ], { cwd: appDir, timeoutMs: options.timeoutMs, onStart: options.onStart });
  const resultsPath = path.join(appDir, 'results.json');
  const resultsStat = await stat(resultsPath).catch(() => null);
  return {
    exitCode: processResult.exitCode,
    startedAt: processResult.startedAt,
    finishedAt: processResult.finishedAt,
    durationMs: processResult.durationMs,
    logTail: processResult.stdout.split(/\r?\n/).filter(Boolean).slice(-30),
    stderrTail: processResult.stderr.split(/\r?\n/).filter(Boolean).slice(-30),
    resultsUpdatedAt: resultsStat?.mtime?.toISOString() ?? null,
    safety: { purchased: false, contactedSeller: false },
  };
}
