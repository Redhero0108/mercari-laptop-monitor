$ErrorActionPreference = 'Stop'

if ($Host.Name -eq 'ConsoleHost') {
    $utf8 = New-Object System.Text.UTF8Encoding $false
    [Console]::InputEncoding = $utf8
    [Console]::OutputEncoding = $utf8
    $OutputEncoding = $utf8

    Add-Type @'
using System;
using System.Runtime.InteropServices;

public static class MercariConsoleFont {
    [StructLayout(LayoutKind.Sequential)]
    public struct COORD { public short X; public short Y; }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct CONSOLE_FONT_INFOEX {
        public uint Size;
        public uint FontIndex;
        public COORD FontSize;
        public int FontFamily;
        public int FontWeight;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string FaceName;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr GetStdHandle(int handle);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool GetCurrentConsoleFontEx(IntPtr output, bool maximumWindow, ref CONSOLE_FONT_INFOEX info);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool SetCurrentConsoleFontEx(IntPtr output, bool maximumWindow, ref CONSOLE_FONT_INFOEX info);
}
'@

    $consoleOutput = [MercariConsoleFont]::GetStdHandle(-11)
    $consoleFont = New-Object MercariConsoleFont+CONSOLE_FONT_INFOEX
    $consoleFont.Size = [Runtime.InteropServices.Marshal]::SizeOf($consoleFont)
    if ([MercariConsoleFont]::GetCurrentConsoleFontEx($consoleOutput, $false, [ref]$consoleFont)) {
        $consoleFont.FontFamily = 54
        $consoleFont.FontWeight = 400
        $consoleFont.FaceName = 'NSimSun'
        [MercariConsoleFont]::SetCurrentConsoleFontEx($consoleOutput, $false, [ref]$consoleFont) | Out-Null
    }
}

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
    Write-Host 'Node.js was not found. Install Node.js 20 or later.' -ForegroundColor Red
    Read-Host 'Press Enter to exit'
    exit 1
}

try {
    & $nodeExe -e "require.resolve('playwright')" 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'missing' }
} catch {
    Write-Host 'Playwright was not found. Run npm install playwright in this project.' -ForegroundColor Red
    Read-Host 'Press Enter to exit'
    exit 1
}

Push-Location $appDir
try {
    & $nodeExe '.\monitor.mjs' @args
} finally {
    Pop-Location
}
