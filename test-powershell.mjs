import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') {
  console.log('PowerShell tests: skipped (Windows only)');
  process.exit(0);
}

const appDir = fileURLToPath(new URL('.', import.meta.url));
const scripts = ['start-background.ps1', 'start-monitor.ps1', 'stop-background.ps1'];
const parseCommand = [
  '$tokens = $null',
  '$errors = $null',
  '[System.Management.Automation.Language.Parser]::ParseFile($env:MERCARI_PS_TEST_FILE, [ref]$tokens, [ref]$errors) | Out-Null',
  'if ($errors.Count) { $errors | ForEach-Object { Write-Error $_.Message }; exit 1 }',
].join('; ');

for (const script of scripts) {
  const result = spawnSync('powershell.exe', [
    '-NoProfile',
    '-Command',
    parseCommand,
  ], {
    cwd: appDir,
    encoding: 'utf8',
    env: { ...process.env, MERCARI_PS_TEST_FILE: fileURLToPath(new URL(script, new URL('.', import.meta.url))) },
  });
  assert.equal(result.status, 0, `${script} must parse in Windows PowerShell 5.1:\n${result.stderr || result.stdout}`);
}

const wrapperTestDir = mkdtempSync(join(tmpdir(), 'mercari-cmd-utf8-'));
try {
  const wrapperPath = join(wrapperTestDir, 'start-monitor.cmd');
  copyFileSync(fileURLToPath(new URL('start-monitor.cmd', new URL('.', import.meta.url))), wrapperPath);
  writeFileSync(
    join(wrapperTestDir, 'start-monitor.ps1'),
    "& $env:ComSpec /d /c chcp\r\n" +
      "[Console]::WriteLine(([string][char]0x4E2D) + ([string][char]0x6587))\r\n",
    'ascii',
  );

  const result = spawnSync('cmd.exe', ['/d', '/c', wrapperPath], {
    cwd: wrapperTestDir,
    encoding: 'buffer',
  });
  const stdout = result.stdout.toString('utf8').replace(/\r/g, '');

  assert.equal(result.status, 0, result.stderr.toString('utf8'));
  assert.match(stdout, /65001/);
  assert.match(stdout, /中文/);
} finally {
  rmSync(wrapperTestDir, { recursive: true, force: true });
}

console.log('PowerShell tests: OK');
