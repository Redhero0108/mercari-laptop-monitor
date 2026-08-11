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

Mercari笔记本监控命令。只读取公开商品、管理本地监控配置；不购买，也不联系卖家。

用法：
  mercari-watch [--json] doctor [--offline]
  mercari-watch [--json] keywords list
  mercari-watch [--json] keywords add <关键词> [--dry-run]
  mercari-watch [--json] keywords update <任务ID或完整关键词> <新关键词> [--dry-run]
  mercari-watch [--json] keywords remove <任务ID或完整关键词> [--dry-run]
  mercari-watch [--json] keywords clear [--dry-run | --yes]
  mercari-watch [--json] keywords replace-all --keyword <关键词> [--keyword <关键词> ...] [--dry-run | --yes]
  mercari-watch [--json] tasks list
  mercari-watch [--json] tasks resolve <任务ID或完整关键词>
  mercari-watch [--json] check [--show-browser] [--notify] [--timeout <秒>]
  mercari-watch [--json] results recent [--limit <1-200>]
  mercari-watch [--json] results get <商品ID或URL>
  mercari-watch [--json] config show
  mercari-watch [--json] monitor run [--timeout <秒>] -- <monitor.mjs参数>

全局选项：
  --json       仅向stdout输出稳定JSON
  -h, --help   显示帮助
  -v, --version 显示版本

安全：check默认带--no-notify；所有命令都不会购买商品或联系卖家。`;

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
  if (index === args.length - 1) throw new CliError('OPTION_VALUE_REQUIRED', `${name}需要参数`);
  const value = args[index + 1];
  args.splice(index, 2);
  return value;
}

function takeOptions(args, name) {
  const values = [];
  let index = args.indexOf(name);
  while (index >= 0) {
    if (index === args.length - 1 || args[index + 1].startsWith('-')) {
      throw new CliError('OPTION_VALUE_REQUIRED', `${name}需要参数`);
    }
    values.push(args[index + 1]);
    args.splice(index, 2);
    index = args.indexOf(name);
  }
  return values;
}

function rejectUnknown(args) {
  const unknown = args.find((arg) => arg.startsWith('-'));
  if (unknown) throw new CliError('UNKNOWN_OPTION', `未知选项：${unknown}`);
}

function humanPrint(command, data) {
  if (command === 'doctor') {
    console.log(data.ready ? 'mercari-watch：可以使用' : 'mercari-watch：配置不完整');
    console.log(`源码：${data.sourceDirectory}`);
    console.log(`Mercari：${data.network.checked ? (data.network.reachable ? `可访问（HTTP ${data.network.status}）` : '无法访问') : '未检查（offline）'}`);
    console.log('安全：不会购买商品，不会联系卖家');
  } else if (command === 'keywords.add') {
    console.log(data.duplicate ? `关键词已存在：${data.task.keyword}` : `${data.dryRun ? '[预览] 将添加' : '已添加'}：${data.task.keyword}`);
    console.log(`任务ID：${data.task.id}`);
  } else if (command === 'keywords.update') {
    console.log(`${data.dryRun ? '[预览] 将修改' : data.updated ? '已修改' : '没有变化'}：${data.before.keyword} → ${data.after.keyword}`);
    console.log(`任务ID：${data.before.id} → ${data.after.id}`);
  } else if (command === 'keywords.remove') {
    console.log(`${data.dryRun ? '[预览] 将删除' : '已删除'}：${data.task.keyword}`);
    console.log(`剩余 ${data.total} 个任务`);
  } else if (command === 'keywords.clear') {
    console.log(`${data.dryRun ? '[预览] 将清空' : '已清空'} ${data.previousTotal} 个关键词`);
  } else if (command === 'keywords.replace-all') {
    console.log(`${data.dryRun ? '[预览] 将替换为' : data.replaced ? '已替换为' : '没有变化，共'} ${data.total} 个关键词`);
    for (const task of data.tasks) console.log(`${task.id}\t${task.keyword}`);
  } else if (command === 'keywords.list' || command === 'tasks.list') {
    if (!data.tasks.length) console.log('没有监控任务。');
    for (const task of data.tasks) console.log(`${task.id}\t${task.keyword}`);
    console.log(`共 ${data.count} 个任务`);
  } else if (command === 'tasks.resolve') {
    console.log(`${data.id}\t${data.keyword}`);
  } else if (command === 'results.recent') {
    for (const item of data.results) {
      console.log(`${item.id}\t¥${item.priceYen ?? '?'}\t${item.grade ?? '?'}\t${item.title}\t${item.url}`);
    }
    console.log(`显示 ${data.count} 件`);
  } else if (command === 'results.get') {
    console.log(`${data.id}\t¥${data.priceYen ?? '?'}\t${data.title}`);
    console.log(data.url);
  } else if (command === 'config.show') {
    console.log(JSON.stringify(data, null, 2));
  } else if (command === 'check' || command === 'monitor.run') {
    console.log(`完成，退出代码 ${data.exitCode}，耗时 ${(data.durationMs / 1000).toFixed(1)} 秒`);
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
    if (args.length) throw new CliError('UNEXPECTED_ARGUMENT', `doctor不接受参数：${args.join(' ')}`);
    data = await doctor(APP_DIR, { offline });
  } else if (noun === 'keywords') {
    const verb = args.shift();
    command = `keywords.${verb ?? ''}`;
    if (verb === 'list') {
      rejectUnknown(args);
      if (args.length) throw new CliError('UNEXPECTED_ARGUMENT', `keywords list不接受参数：${args.join(' ')}`);
      data = await listTasks(APP_DIR);
    } else if (verb === 'add') {
      const dryRun = takeFlag(args, '--dry-run');
      rejectUnknown(args);
      if (args.length !== 1) throw new CliError('KEYWORD_REQUIRED', '用法：mercari-watch keywords add <关键词>');
      data = await addKeyword(APP_DIR, args[0], { dryRun });
    } else if (verb === 'update') {
      const dryRun = takeFlag(args, '--dry-run');
      rejectUnknown(args);
      if (args.length !== 2) {
        throw new CliError('KEYWORD_UPDATE_ARGUMENTS_REQUIRED', '用法：mercari-watch keywords update <任务ID或完整关键词> <新关键词>');
      }
      data = await updateKeyword(APP_DIR, args[0], args[1], { dryRun });
    } else if (verb === 'remove') {
      const dryRun = takeFlag(args, '--dry-run');
      rejectUnknown(args);
      if (args.length !== 1) {
        throw new CliError('TASK_REQUIRED', '用法：mercari-watch keywords remove <任务ID或完整关键词>');
      }
      data = await removeKeyword(APP_DIR, args[0], { dryRun });
    } else if (verb === 'clear') {
      const dryRun = takeFlag(args, '--dry-run');
      const confirmed = takeFlag(args, '--yes');
      rejectUnknown(args);
      if (args.length) throw new CliError('UNEXPECTED_ARGUMENT', `keywords clear不接受参数：${args.join(' ')}`);
      data = await clearKeywords(APP_DIR, { dryRun, confirmed });
    } else if (verb === 'replace-all') {
      const dryRun = takeFlag(args, '--dry-run');
      const confirmed = takeFlag(args, '--yes');
      const keywords = takeOptions(args, '--keyword');
      rejectUnknown(args);
      if (args.length) throw new CliError('UNEXPECTED_ARGUMENT', `keywords replace-all不接受参数：${args.join(' ')}`);
      data = await replaceAllKeywords(APP_DIR, keywords, { dryRun, confirmed });
    } else throw new CliError('UNKNOWN_COMMAND', 'keywords支持：list、add、update、remove、clear、replace-all');
  } else if (noun === 'tasks') {
    const verb = args.shift();
    command = `tasks.${verb ?? ''}`;
    if (verb === 'list') {
      rejectUnknown(args);
      if (args.length) throw new CliError('UNEXPECTED_ARGUMENT', `tasks list不接受参数：${args.join(' ')}`);
      data = await listTasks(APP_DIR);
    } else if (verb === 'resolve') {
      rejectUnknown(args);
      if (args.length !== 1) throw new CliError('TASK_REQUIRED', '用法：mercari-watch tasks resolve <任务ID或完整关键词>');
      data = await resolveTask(APP_DIR, args[0]);
    } else throw new CliError('UNKNOWN_COMMAND', 'tasks支持：list、resolve');
  } else if (noun === 'results') {
    const verb = args.shift();
    command = `results.${verb ?? ''}`;
    if (verb === 'recent') {
      const limit = Number(takeOption(args, '--limit', '20'));
      rejectUnknown(args);
      if (args.length) throw new CliError('UNEXPECTED_ARGUMENT', `results recent不接受参数：${args.join(' ')}`);
      data = await recentResults(APP_DIR, limit);
    } else if (verb === 'get') {
      rejectUnknown(args);
      if (args.length !== 1) throw new CliError('RESULT_REQUIRED', '用法：mercari-watch results get <商品ID或URL>');
      data = await getResult(APP_DIR, args[0]);
    } else throw new CliError('UNKNOWN_COMMAND', 'results支持：recent、get');
  } else if (noun === 'config') {
    const verb = args.shift();
    command = `config.${verb ?? ''}`;
    if (verb !== 'show' || args.length) throw new CliError('UNKNOWN_COMMAND', 'config仅支持：show');
    data = await configView(APP_DIR);
  } else if (noun === 'check') {
    command = 'check';
    const showBrowser = takeFlag(args, '--show-browser');
    const notify = takeFlag(args, '--notify');
    const timeoutSeconds = Number(takeOption(args, '--timeout', '900'));
    rejectUnknown(args);
    if (args.length) throw new CliError('UNEXPECTED_ARGUMENT', `check不接受参数：${args.join(' ')}`);
    if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 10 || timeoutSeconds > 3600) {
      throw new CliError('INVALID_TIMEOUT', '--timeout必须是10到3600秒');
    }
    const monitorArgs = ['--once', ...(notify ? [] : ['--no-notify']), ...(showBrowser ? ['--show-browser'] : [])];
    data = await runMonitor(APP_DIR, monitorArgs, {
      timeoutMs: timeoutSeconds * 1000,
      onStart: () => { if (!json) console.error('正在执行一次Mercari检查…'); },
    });
  } else if (noun === 'monitor') {
    const verb = args.shift();
    command = `monitor.${verb ?? ''}`;
    if (verb !== 'run') throw new CliError('UNKNOWN_COMMAND', 'monitor仅支持：run');
    const separator = args.indexOf('--');
    const optionArgs = separator < 0 ? args : args.slice(0, separator);
    const monitorArgs = separator < 0 ? [] : args.slice(separator + 1);
    const timeoutSeconds = Number(takeOption(optionArgs, '--timeout', '900'));
    rejectUnknown(optionArgs);
    if (optionArgs.length) throw new CliError('UNEXPECTED_ARGUMENT', `monitor run未知参数：${optionArgs.join(' ')}`);
    if (!monitorArgs.length) throw new CliError('MONITOR_ARGS_REQUIRED', '用法：mercari-watch monitor run -- <monitor.mjs参数>');
    data = await runMonitor(APP_DIR, monitorArgs, {
      timeoutMs: timeoutSeconds * 1000,
      onStart: () => { if (!json) console.error('正在运行原监控器参数…'); },
    });
  } else {
    throw new CliError('UNKNOWN_COMMAND', `未知命令：${noun}`);
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
    else console.error(`错误 [${error.code}]：${error.message}`);
    process.exitCode = 2;
  } else {
    const safeError = new CliError('UNEXPECTED_ERROR', error?.message || '发生未知错误');
    if (jsonRequested) console.log(JSON.stringify(errorEnvelope(activeCommand, safeError)));
    else console.error(`错误 [${safeError.code}]：${safeError.message}`);
    process.exitCode = 1;
  }
}
