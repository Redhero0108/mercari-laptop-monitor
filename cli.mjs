#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  CLI_VERSION,
  CliError,
  addKeyword,
  clearKeywords,
  configView,
  doctor,
  errorEnvelope,
  getResult,
  listTasks,
  recentResults,
  removeKeyword,
  replaceAllKeywords,
  resolveTask,
  runMonitor,
  successEnvelope,
  updateKeyword,
} from './cli-lib.mjs';

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));

const HELP = `mercari-watch ${CLI_VERSION}

Mercari ノートPC監視コマンド。公開商品の読み取りとローカル監視設定の管理のみを行い、購入や出品者への連絡は行いません。

使い方：
  mercari-watch [--json] doctor [--offline]
  mercari-watch [--json] keywords list
  mercari-watch [--json] keywords add <キーワード> [--dry-run]
  mercari-watch [--json] keywords update <タスクIDまたは完全なキーワード> <新キーワード> [--dry-run]
  mercari-watch [--json] keywords remove <タスクIDまたは完全なキーワード> [--dry-run]
  mercari-watch [--json] keywords clear [--dry-run | --yes]
  mercari-watch [--json] keywords replace-all --keyword <キーワード> [--keyword <キーワード> ...] [--dry-run | --yes]
  mercari-watch [--json] tasks list
  mercari-watch [--json] tasks resolve <タスクIDまたは完全なキーワード>
  mercari-watch [--json] check [--show-browser] [--notify] [--timeout <秒>]
  mercari-watch [--json] results recent [--limit <1-200>]
  mercari-watch [--json] results get <商品IDまたはURL>
  mercari-watch [--json] config show
  mercari-watch [--json] monitor run [--timeout <秒>] -- <monitor.mjsパラメータ>

グローバルオプション：
  --json       安定したJSONのみをstdoutに出力
  -h, --help   ヘルプを表示
  -v, --version バージョンを表示

安全性：check は既定で --no-notify 付きです。どのコマンドも商品を購入したり出品者に連絡したりしません。`;

function commandFromArgs(argv) {
  const positional = argv.filter((arg) => !['--json', '--help', '-h', '--version', '-v'].includes(arg));
  if (argv.includes('--version') || argv.includes('-v')) return 'version';
  if (argv.includes('--help') || argv.includes('-h') || !positional.length) return 'help';
  if (['keywords', 'tasks', 'results', 'config', 'monitor'].includes(positional[0])) {
    return positional[1] ? `${positional[0]}.${positional[1]}` : positional[0];
  }
  return positional[0];
}

function takeFlag(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return false;
  args.splice(index, 1);
  return true;
}

function takeOption(args, name, fallback = undefined) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (index === args.length - 1) throw new CliError('OPTION_VALUE_REQUIRED', `${name} には引数が必要です`);
  const value = args[index + 1];
  args.splice(index, 2);
  return value;
}

function takeOptions(args, name) {
  const values = [];
  let index = args.indexOf(name);
  while (index >= 0) {
    if (index === args.length - 1 || args[index + 1].startsWith('-')) {
      throw new CliError('OPTION_VALUE_REQUIRED', `${name} には引数が必要です`);
    }
    values.push(args[index + 1]);
    args.splice(index, 2);
    index = args.indexOf(name);
  }
  return values;
}

function rejectUnknown(args) {
  const unknown = args.find((arg) => arg.startsWith('-'));
  if (unknown) throw new CliError('UNKNOWN_OPTION', `不明なオプション：${unknown}`);
}

function humanPrint(command, data) {
  if (command === 'doctor') {
    console.log(data.ready ? 'mercari-watch：利用可能です' : 'mercari-watch：設定が不完全です');
    console.log(`ソース：${data.sourceDirectory}`);
    console.log(`Mercari：${data.network.checked ? (data.network.reachable ? `アクセス可能（HTTP ${data.network.status}）` : 'アクセス不可') : '未チェック（offline）'}`);
    console.log('安全性：商品を購入せず、出品者への連絡もしません');
  } else if (command === 'keywords.add') {
    console.log(data.duplicate ? `キーワードは既に存在します：${data.task.keyword}` : `${data.dryRun ? '[プレビュー] 追加予定' : '追加しました'}：${data.task.keyword}`);
    console.log(`タスクID：${data.task.id}`);
  } else if (command === 'keywords.update') {
    console.log(`${data.dryRun ? '[プレビュー] 変更予定' : data.updated ? '変更しました' : '変更なし'}：${data.before.keyword} → ${data.after.keyword}`);
    console.log(`タスクID：${data.before.id} → ${data.after.id}`);
  } else if (command === 'keywords.remove') {
    console.log(`${data.dryRun ? '[プレビュー] 削除予定' : '削除しました'}：${data.task.keyword}`);
    console.log(`残り ${data.total} 件のタスク`);
  } else if (command === 'keywords.clear') {
    console.log(`${data.dryRun ? '[プレビュー] クリア予定' : 'クリアしました'} ${data.previousTotal} 件のキーワード`);
  } else if (command === 'keywords.replace-all') {
    console.log(`${data.dryRun ? '[プレビュー] 置換予定' : data.replaced ? '置換しました' : '変更なし、合計'} ${data.total} 件のキーワード`);
    for (const task of data.tasks) console.log(`${task.id}\t${task.keyword}`);
  } else if (command === 'keywords.list' || command === 'tasks.list') {
    if (!data.tasks.length) console.log('監視タスクがありません。');
    for (const task of data.tasks) console.log(`${task.id}\t${task.keyword}`);
    console.log(`合計 ${data.count} 件のタスク`);
  } else if (command === 'tasks.resolve') {
    console.log(`${data.id}\t${data.keyword}`);
  } else if (command === 'results.recent') {
    for (const item of data.results) {
      console.log(`${item.id}\t¥${item.priceYen ?? '?'}\t${item.grade ?? '?'}\t${item.title}\t${item.url}`);
    }
    console.log(`${data.count} 件を表示`);
  } else if (command === 'results.get') {
    console.log(`${data.id}\t¥${data.priceYen ?? '?'}\t${data.title}`);
    console.log(data.url);
  } else if (command === 'config.show') {
    console.log(JSON.stringify(data, null, 2));
  } else if (command === 'check' || command === 'monitor.run') {
    console.log(`完了、終了コード ${data.exitCode}、所要時間 ${(data.durationMs / 1000).toFixed(1)} 秒`);
    for (const line of data.logTail) console.log(line);
  }
}

async function execute(argv) {
  const args = [...argv];
  const json = takeFlag(args, '--json');
  const help = takeFlag(args, '--help') || takeFlag(args, '-h');
  const version = takeFlag(args, '--version') || takeFlag(args, '-v');
  if (version) return { json, command: 'version', data: { version: CLI_VERSION }, directText: CLI_VERSION };
  if (help || !args.length) return { json, command: 'help', data: { text: HELP }, directText: HELP };

  const noun = args.shift();
  let command = noun;
  let data;
  if (noun === 'doctor') {
    const offline = takeFlag(args, '--offline');
    rejectUnknown(args);
    if (args.length) throw new CliError('UNEXPECTED_ARGUMENT', `doctor は引数を受け付けません：${args.join(' ')}`);
    data = await doctor(APP_DIR, { offline });
  } else if (noun === 'keywords') {
    const verb = args.shift();
    command = `keywords.${verb ?? ''}`;
    if (verb === 'list') {
      rejectUnknown(args);
      if (args.length) throw new CliError('UNEXPECTED_ARGUMENT', `keywords list は引数を受け付けません：${args.join(' ')}`);
      data = await listTasks(APP_DIR);
    } else if (verb === 'add') {
      const dryRun = takeFlag(args, '--dry-run');
      rejectUnknown(args);
      if (args.length !== 1) throw new CliError('KEYWORD_REQUIRED', '使い方：mercari-watch keywords add <キーワード>');
      data = await addKeyword(APP_DIR, args[0], { dryRun });
    } else if (verb === 'update') {
      const dryRun = takeFlag(args, '--dry-run');
      rejectUnknown(args);
      if (args.length !== 2) {
        throw new CliError('KEYWORD_UPDATE_ARGUMENTS_REQUIRED', '使い方：mercari-watch keywords update <タスクIDまたは完全なキーワード> <新キーワード>');
      }
      data = await updateKeyword(APP_DIR, args[0], args[1], { dryRun });
    } else if (verb === 'remove') {
      const dryRun = takeFlag(args, '--dry-run');
      rejectUnknown(args);
      if (args.length !== 1) {
        throw new CliError('TASK_REQUIRED', '使い方：mercari-watch keywords remove <タスクIDまたは完全なキーワード>');
      }
      data = await removeKeyword(APP_DIR, args[0], { dryRun });
    } else if (verb === 'clear') {
      const dryRun = takeFlag(args, '--dry-run');
      const confirmed = takeFlag(args, '--yes');
      rejectUnknown(args);
      if (args.length) throw new CliError('UNEXPECTED_ARGUMENT', `keywords clear は引数を受け付けません：${args.join(' ')}`);
      data = await clearKeywords(APP_DIR, { dryRun, confirmed });
    } else if (verb === 'replace-all') {
      const dryRun = takeFlag(args, '--dry-run');
      const confirmed = takeFlag(args, '--yes');
      const keywords = takeOptions(args, '--keyword');
      rejectUnknown(args);
      if (args.length) throw new CliError('UNEXPECTED_ARGUMENT', `keywords replace-all は引数を受け付けません：${args.join(' ')}`);
      data = await replaceAllKeywords(APP_DIR, keywords, { dryRun, confirmed });
    } else throw new CliError('UNKNOWN_COMMAND', 'keywords の操作：list、add、update、remove、clear、replace-all');
  } else if (noun === 'tasks') {
    const verb = args.shift();
    command = `tasks.${verb ?? ''}`;
    if (verb === 'list') {
      rejectUnknown(args);
      if (args.length) throw new CliError('UNEXPECTED_ARGUMENT', `tasks list は引数を受け付けません：${args.join(' ')}`);
      data = await listTasks(APP_DIR);
    } else if (verb === 'resolve') {
      rejectUnknown(args);
      if (args.length !== 1) throw new CliError('TASK_REQUIRED', '使い方：mercari-watch tasks resolve <タスクIDまたは完全なキーワード>');
      data = await resolveTask(APP_DIR, args[0]);
    } else throw new CliError('UNKNOWN_COMMAND', 'tasks の操作：list、resolve');
  } else if (noun === 'results') {
    const verb = args.shift();
    command = `results.${verb ?? ''}`;
    if (verb === 'recent') {
      const limit = Number(takeOption(args, '--limit', '20'));
      rejectUnknown(args);
      if (args.length) throw new CliError('UNEXPECTED_ARGUMENT', `results recent は引数を受け付けません：${args.join(' ')}`);
      data = await recentResults(APP_DIR, limit);
    } else if (verb === 'get') {
      rejectUnknown(args);
      if (args.length !== 1) throw new CliError('RESULT_REQUIRED', '使い方：mercari-watch results get <商品IDまたはURL>');
      data = await getResult(APP_DIR, args[0]);
    } else throw new CliError('UNKNOWN_COMMAND', 'results の操作：recent、get');
  } else if (noun === 'config') {
    const verb = args.shift();
    command = `config.${verb ?? ''}`;
    if (verb !== 'show' || args.length) throw new CliError('UNKNOWN_COMMAND', 'config は show のみサポート');
    data = await configView(APP_DIR);
  } else if (noun === 'check') {
    command = 'check';
    const showBrowser = takeFlag(args, '--show-browser');
    const notify = takeFlag(args, '--notify');
    const timeoutSeconds = Number(takeOption(args, '--timeout', '900'));
    rejectUnknown(args);
    if (args.length) throw new CliError('UNEXPECTED_ARGUMENT', `check は引数を受け付けません：${args.join(' ')}`);
    if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 10 || timeoutSeconds > 3600) {
      throw new CliError('INVALID_TIMEOUT', '--timeout は10〜3600秒で指定してください');
    }
    const monitorArgs = ['--once', ...(notify ? [] : ['--no-notify']), ...(showBrowser ? ['--show-browser'] : [])];
    data = await runMonitor(APP_DIR, monitorArgs, {
      timeoutMs: timeoutSeconds * 1000,
      onStart: () => { if (!json) console.error('Mercari チェックを1回実行中…'); },
    });
  } else if (noun === 'monitor') {
    const verb = args.shift();
    command = `monitor.${verb ?? ''}`;
    if (verb !== 'run') throw new CliError('UNKNOWN_COMMAND', 'monitor は run のみサポート');
    const separator = args.indexOf('--');
    const optionArgs = separator < 0 ? args : args.slice(0, separator);
    const monitorArgs = separator < 0 ? [] : args.slice(separator + 1);
    const timeoutSeconds = Number(takeOption(optionArgs, '--timeout', '900'));
    rejectUnknown(optionArgs);
    if (optionArgs.length) throw new CliError('UNEXPECTED_ARGUMENT', `monitor run に不明な引数：${optionArgs.join(' ')}`);
    if (!monitorArgs.length) throw new CliError('MONITOR_ARGS_REQUIRED', '使い方：mercari-watch monitor run -- <monitor.mjsパラメータ>');
    data = await runMonitor(APP_DIR, monitorArgs, {
      timeoutMs: timeoutSeconds * 1000,
      onStart: () => { if (!json) console.error('元のモニター引数で実行中…'); },
    });
  } else {
    throw new CliError('UNKNOWN_COMMAND', `不明なコマンド：${noun}`);
  }
  return { json, command, data };
}

let activeCommand = commandFromArgs(process.argv.slice(2));
let jsonRequested = process.argv.includes('--json');
try {
  const result = await execute(process.argv.slice(2));
  jsonRequested = result.json;
  if (result.directText !== undefined) {
    if (result.json) console.log(JSON.stringify(successEnvelope(result.command, result.data)));
    else console.log(result.directText);
  } else {
    activeCommand = result.command;
    const envelope = successEnvelope(result.command, result.data);
    if (result.json) console.log(JSON.stringify(envelope));
    else humanPrint(result.command, result.data);
  }
} catch (error) {
  if (error instanceof CliError) {
    if (jsonRequested) console.log(JSON.stringify(errorEnvelope(activeCommand, error)));
    else console.error(`エラー [${error.code}]：${error.message}`);
    process.exitCode = 2;
  } else {
    const safeError = new CliError('UNEXPECTED_ERROR', error?.message || '不明なエラーが発生しました');
    if (jsonRequested) console.log(JSON.stringify(errorEnvelope(activeCommand, safeError)));
    else console.error(`エラー [${safeError.code}]：${safeError.message}`);
    process.exitCode = 1;
  }
}
