$ErrorActionPreference = 'Stop'
$appDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$runtimeRoot = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node'
$bundledNode = Join-Path $runtimeRoot 'bin\node.exe'
$bundledModules = Join-Path $runtimeRoot 'node_modules'

if ((Test-Path -LiteralPath $bundledNode) -and (Test-Path -LiteralPath $bundledModules)) {
    $nodeExe = $bundledNode
    $env:NODE_PATH = $bundledModules
} else {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    $nodeExe = if ($nodeCommand) { $nodeCommand.Source } else { $null }
}

if (-not $nodeExe -or -not (Test-Path -LiteralPath $nodeExe)) {
    Write-Host 'Node.jsが見つかりません。Node.js 20以上をインストールしてください。' -ForegroundColor Red
    Read-Host 'Enterキーで終了'
    exit 1
}

try {
    & $nodeExe -e "require.resolve('playwright')" 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'missing' }
} catch {
    Write-Host 'Playwrightが見つかりません。プロジェクトで npm install playwright を実行してください。' -ForegroundColor Red
    Read-Host 'Enterキーで終了'
    exit 1
}

Push-Location $appDir
try {
    & $nodeExe '.\monitor.mjs' @args
} finally {
    Pop-Location
}
