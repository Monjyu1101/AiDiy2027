@echo off
cd /d "%~dp0../.."

title Claude Code on Ollama - Kimi K2.6
ECHO.
ECHO ============================================================
ECHO   Claude Code on Ollama - Kimi K2.6
ECHO   %~nx0
ECHO ============================================================

    ECHO "ollama" launch claude --model kimi-k2.6:cloud   -- --dangerously-skip-permissions --chrome
    call "ollama" launch claude --model kimi-k2.6:cloud   -- --dangerously-skip-permissions --chrome

exit
