import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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

console.log('PowerShell tests: OK');
