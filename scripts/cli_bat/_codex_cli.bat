@echo off
setlocal
cd /d "%~dp0../.."

title Codex CLI
ECHO.
ECHO ============================================================
ECHO   Codex CLI
ECHO   %~nx0
ECHO ============================================================

set "CODEX_CMD=%USERPROFILE%\AppData\Roaming\npm\codex.cmd"
set "MODEL="
set "MODEL_SETTING_DIR=%LOCALAPPDATA%\AiDiy"
set "MODEL_SETTING_FILE=%MODEL_SETTING_DIR%\codex_cli_model.txt"
set "PREVIOUS_MODEL="
if exist "%MODEL_SETTING_FILE%" set /p "PREVIOUS_MODEL="<"%MODEL_SETTING_FILE%"
if "%PREVIOUS_MODEL%"=="gpt-6-sol" (
    set "PREVIOUS_MODEL=gpt-6.1-sol"
    >"%MODEL_SETTING_FILE%" ECHO gpt-6.1-sol
)
if defined PREVIOUS_MODEL (
    set "PREVIOUS_MODEL_LABEL=%PREVIOUS_MODEL%"
) else (
    set "PREVIOUS_MODEL_LABEL=not set"
)
set /p "UPDATE=update [N]/y: "
if /I "%UPDATE%"=="y" (
    ECHO Install/update Codex CLI
    call npm install -g @openai/codex
    if errorlevel 1 goto INSTALL_FAILED
)

:SELECT_MODEL
ECHO.
ECHO Codex CLI model list
ECHO   1: GPT-6 Astra - frontier reasoning and coding
ECHO   2: GPT-6.1 Sol - frontier reasoning and coding
ECHO   3: GPT-6.1 Terra - balanced quality and cost
ECHO   4: GPT-6 Luna - fast, high-volume work
ECHO   0: Exit
ECHO.
set "MODEL_NUMBER="
set /p "MODEL_NUMBER=Model number [Enter: previous (%PREVIOUS_MODEL_LABEL%)]: "
if "%MODEL_NUMBER%"=="0" goto END
if not defined MODEL_NUMBER (
    set "MODEL=%PREVIOUS_MODEL%"
    goto LAUNCH
)
if "%MODEL_NUMBER%"=="1" set "MODEL=gpt-6-astra"
if "%MODEL_NUMBER%"=="2" set "MODEL=gpt-6.1-sol"
if "%MODEL_NUMBER%"=="3" set "MODEL=gpt-6.1-terra"
if "%MODEL_NUMBER%"=="4" set "MODEL=gpt-6-luna"
if defined MODEL (
    if not exist "%MODEL_SETTING_DIR%" mkdir "%MODEL_SETTING_DIR%" >nul 2>&1
    >"%MODEL_SETTING_FILE%" ECHO %MODEL%
    goto LAUNCH
)
ECHO Invalid input. Enter a number or press Enter.
goto SELECT_MODEL

:LAUNCH
if defined MODEL (
    ECHO codex --dangerously-bypass-approvals-and-sandbox --model %MODEL% %*
    call "%CODEX_CMD%" --dangerously-bypass-approvals-and-sandbox --model "%MODEL%" %*
) else (
    ECHO codex --dangerously-bypass-approvals-and-sandbox %*
    call "%CODEX_CMD%" --dangerously-bypass-approvals-and-sandbox %*
)
set "EXIT_CODE=%ERRORLEVEL%"
endlocal & exit /b %EXIT_CODE%

:INSTALL_FAILED
ECHO Codex CLI installation failed.
endlocal & exit /b 1

:END
endlocal & exit /b 0
