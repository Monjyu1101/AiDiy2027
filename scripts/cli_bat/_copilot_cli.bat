@echo off
setlocal
cd /d "%~dp0../.."

title GitHub Copilot CLI
ECHO.
ECHO ============================================================
ECHO   GitHub Copilot CLI
ECHO   %~nx0
ECHO ============================================================

set "MODEL="
set /p "UPDATE=update [N]/y: "
if /I "%UPDATE%"=="y" (
    ECHO Install/update GitHub Copilot CLI
    call npm install -g @github/copilot
    if errorlevel 1 goto INSTALL_FAILED
)

:SELECT_MODEL
ECHO.
ECHO GitHub Copilot CLI model list
ECHO   1: GPT-6.2 Astra - frontier reasoning and coding
ECHO   2: GPT-6.2 Sol - frontier reasoning and coding
ECHO   3: GPT-6.1 Terra - balanced quality and cost
ECHO   4: GPT-6 Luna - fast, high-volume work
ECHO   5: Claude Fable 5.1 - highest Claude capability
ECHO   6: Claude Opus 5.5 - complex agentic coding
ECHO   7: Claude Sonnet 5.5 - balanced coding and speed
ECHO   8: Claude Haiku 5.5 - fast and lightweight
ECHO   9: Gemini 3.8 Flash - latest Gemini Flash
ECHO   0: Exit
ECHO.
set "MODEL_NUMBER="
set /p "MODEL_NUMBER=Model number [Enter: default]: "
if "%MODEL_NUMBER%"=="0" goto END
if not defined MODEL_NUMBER goto LAUNCH
if "%MODEL_NUMBER%"=="1" set "MODEL=gpt-6.2-astra"
if "%MODEL_NUMBER%"=="2" set "MODEL=gpt-6.2-sol"
if "%MODEL_NUMBER%"=="3" set "MODEL=gpt-6.1-terra"
if "%MODEL_NUMBER%"=="4" set "MODEL=gpt-6-luna"
if "%MODEL_NUMBER%"=="5" set "MODEL=claude-fable-5.2"
if "%MODEL_NUMBER%"=="6" set "MODEL=claude-opus-5.5"
if "%MODEL_NUMBER%"=="7" set "MODEL=claude-sonnet-5.5"
if "%MODEL_NUMBER%"=="8" set "MODEL=claude-haiku-5.5"
if "%MODEL_NUMBER%"=="9" set "MODEL=gemini-3.8-flash"
if defined MODEL goto LAUNCH
ECHO Invalid input. Enter a number or press Enter.
goto SELECT_MODEL

:LAUNCH
rem Same rule as Diag: the npm copilot.cmd first, then the MSI copilot.exe.
rem The VS Code copilot-shim is only a launcher and is not GitHub Copilot CLI itself.
set "COPILOT_CMD="
if exist "%APPDATA%\npm\copilot.cmd" set "COPILOT_CMD=%APPDATA%\npm\copilot.cmd"
if not defined COPILOT_CMD if exist "%LOCALAPPDATA%\GitHubCopilotCLI\copilot.exe" set "COPILOT_CMD=%LOCALAPPDATA%\GitHubCopilotCLI\copilot.exe"
if not defined COPILOT_CMD goto NOT_INSTALLED
if defined MODEL (
    ECHO copilot --allow-all-tools --model %MODEL% %*
    call "%COPILOT_CMD%" --allow-all-tools --model "%MODEL%" %*
) else (
    ECHO copilot --allow-all-tools %*
    call "%COPILOT_CMD%" --allow-all-tools %*
)
set "EXIT_CODE=%ERRORLEVEL%"
endlocal & exit /b %EXIT_CODE%

:NOT_INSTALLED
ECHO GitHub Copilot CLI is not installed.
ECHO The copilot command from VS Code - copilot-shim - is only a launcher and is not used here.
ECHO Restart this script and enter y at the update prompt.
endlocal & exit /b 1

:INSTALL_FAILED
ECHO GitHub Copilot CLI installation failed.
endlocal & exit /b 1

:END
endlocal & exit /b 0
