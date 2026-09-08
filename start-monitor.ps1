$ErrorActionPreference = 'Stop'

$appDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$runtimeRoot = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node'
$bundledNode = Join-Path $runtimeRoot 'bin\node.exe'
$bundledModules = Join-Path $runtimeRoot 'node_modules'

if (Test-Path -LiteralPath $bundledNode) {
    $nodeExe = $bundledNode
    $env:NODE_PATH = $bundledModules
} else {
    $node = Get-Command node -ErrorAction SilentlyContinue
    $nodeExe = if ($node) { $node.Source } else { $null }
}

if (-not $nodeExe) {
    Write-Host 'Node.js 20 以降が見つかりませんでした。' -ForegroundColor Red
    Read-Host 'Enter キーを押して終了'
    exit 1
}

Push-Location $appDir
try {
    & $nodeExe '.\monitor.mjs' @args
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
