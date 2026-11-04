@echo off
setlocal
cd /d "%~dp0../.."

title Claude Code
ECHO.
ECHO ============================================================
ECHO   Claude Code
ECHO   %~nx0
ECHO ============================================================

set "CLAUDE_CMD=%USERPROFILE%\AppData\Roaming\npm\claude.cmd"
set "MODEL="
set /p "UPDATE=update [N]/y: "
if /I "%UPDATE%"=="y" (
    ECHO Install/update Claude Code
    call npm install -g @anthropic-ai/claude-code
    if errorlevel 1 goto INSTALL_FAILED
)

:SELECT_MODEL
ECHO.
ECHO Claude Code model list
ECHO   1: Fable - latest Claude Fable
ECHO   2: Opus - latest Claude Opus
ECHO   3: Sonnet - latest Claude Sonnet
ECHO   4: Haiku - latest Claude Haiku
ECHO   0: Exit
ECHO.
set "MODEL_NUMBER="
set /p "MODEL_NUMBER=Model number [Enter: default]: "
if "%MODEL_NUMBER%"=="0" goto END
if not defined MODEL_NUMBER goto LAUNCH
if "%MODEL_NUMBER%"=="1" set "MODEL=fable"
if "%MODEL_NUMBER%"=="2" set "MODEL=opus"
if "%MODEL_NUMBER%"=="3" set "MODEL=sonnet"
if "%MODEL_NUMBER%"=="4" set "MODEL=haiku"
if defined MODEL goto LAUNCH
ECHO Invalid input. Enter a number or press Enter.
goto SELECT_MODEL

:LAUNCH
if defined MODEL (
    ECHO claude --dangerously-skip-permissions --chrome --model %MODEL% %*
    call "%CLAUDE_CMD%" --dangerously-skip-permissions --chrome --model "%MODEL%" %*
) else (
    ECHO claude --dangerously-skip-permissions --chrome %*
    call "%CLAUDE_CMD%" --dangerously-skip-permissions --chrome %*
)
set "EXIT_CODE=%ERRORLEVEL%"
endlocal & exit /b %EXIT_CODE%

:INSTALL_FAILED
ECHO Claude Code installation failed.
endlocal & exit /b 1

:END
endlocal & exit /b 0
