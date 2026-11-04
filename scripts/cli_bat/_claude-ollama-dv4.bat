@echo off
cd /d "%~dp0../.."

title Claude Code on Ollama - DeepSeek V4
ECHO.
ECHO ============================================================
ECHO   Claude Code on Ollama - DeepSeek V4
ECHO   %~nx0
ECHO ============================================================

rem ECHO "ollama" launch claude --model deepseek-v4-flash:cloud -- --dangerously-skip-permissions --chrome
    ECHO "ollama" launch claude --model deepseek-v4-pro:cloud   -- --dangerously-skip-permissions --chrome
rem call "ollama" launch claude --model deepseek-v4-flash:cloud -- --dangerously-skip-permissions --chrome
    call "ollama" launch claude --model deepseek-v4-pro:cloud   -- --dangerously-skip-permissions --chrome

exit
