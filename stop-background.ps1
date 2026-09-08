$ErrorActionPreference = 'Stop'
$appDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$pidFile = Join-Path $appDir 'monitor.pid'

if (-not (Test-Path -LiteralPath $pidFile)) {
    Write-Host 'バックグラウンドモニターは実行されていません。'
    exit 0
}

$monitorPid = [int](Get-Content -LiteralPath $pidFile -Raw)
$process = Get-Process -Id $monitorPid -ErrorAction SilentlyContinue
if ($process) {
    Stop-Process -Id $monitorPid
    [void]$process.WaitForExit(5000)
}
Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
Write-Host 'バックグラウンドモニターを停止しました。'
