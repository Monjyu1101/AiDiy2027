@echo off
setlocal DisableDelayedExpansion
where node.exe >nul 2>nul
if errorlevel 1 (echo Node.js 18+ is required: https://nodejs.org/ & exit /b 1)
node.exe "%~dp0memo_main.mjs" %*
exit /b %ERRORLEVEL%
