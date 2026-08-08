$ErrorActionPreference = 'Stop'
$appDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$pidFile = Join-Path $appDir 'monitor.pid'
$monitorScript = Join-Path $appDir 'start-monitor.ps1'

if (Test-Path -LiteralPath $pidFile) {
    $monitorPid = [int](Get-Content -LiteralPath $pidFile -Raw -ErrorAction SilentlyContinue)
    if ($monitorPid -gt 0 -and (Get-Process -Id $monitorPid -ErrorAction SilentlyContinue)) {
        exit 0
    }
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
}

$arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$monitorScript`""
Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -WorkingDirectory $appDir -WindowStyle Hidden
