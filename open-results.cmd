@echo off
set "RESULT_FILE=%~dp0results.html"
if not exist "%RESULT_FILE%" (
  echo 还没有结果页，请先运行 start-monitor.cmd 或诊断模式。
  pause
  exit /b 1
)
start "" "%RESULT_FILE%"
