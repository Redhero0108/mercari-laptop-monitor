@echo off
chcp 65001 >nul
set "RESULT_FILE=%~dp0results.html"
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0start-background.ps1"
if not exist "%RESULT_FILE%" (
  echo まだ結果ページがありません。start-monitor.cmd または診断モードを先に実行してください。
  pause
  exit /b 1
)
start "" "%RESULT_FILE%"
