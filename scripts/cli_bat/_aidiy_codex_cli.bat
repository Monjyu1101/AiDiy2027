@echo off
setlocal
cd /d "%~dp0../.."

title AiDiy Codex CLI
ECHO.
ECHO ============================================================
ECHO   AiDiy Codex CLI
ECHO   %~nx0
ECHO ============================================================

REM command_codex/_compile.py places the binary here. The same name on PATH is not used.
set "CODEX_CMD=%USERPROFILE%\.aidiy\bin\aidiy_codex.exe"
if not exist "%CODEX_CMD%" goto NOT_COMPILED

:SELECT_MODEL
ECHO.
ECHO Model list (openai_oauth only for now)
ECHO   1: same (last selected model)
ECHO   2: openai_oauth/gpt-6.2-astra
ECHO   3: openai_oauth/gpt-6.2-sol
ECHO   4: openai_oauth/gpt-6.1-terra
ECHO   5: openai_oauth/gpt-6-luna
ECHO   0: Exit
ECHO.
set "MODEL="
set "MODEL_NUMBER="
set /p "MODEL_NUMBER=Model number [Enter: same]: "
if "%MODEL_NUMBER%"=="0" goto END
if not defined MODEL_NUMBER set "MODEL_NUMBER=1"
if "%MODEL_NUMBER%"=="1" set "MODEL=same"
if "%MODEL_NUMBER%"=="2" set "MODEL=openai_oauth/gpt-6.2-astra"
if "%MODEL_NUMBER%"=="3" set "MODEL=openai_oauth/gpt-6.2-sol"
if "%MODEL_NUMBER%"=="4" set "MODEL=openai_oauth/gpt-6.1-terra"
if "%MODEL_NUMBER%"=="5" set "MODEL=openai_oauth/gpt-6-luna"
if defined MODEL goto LAUNCH
ECHO Invalid input. Enter a number or press Enter.
goto SELECT_MODEL

:LAUNCH
if "%MODEL%"=="same" (
    ECHO aidiy_codex --dangerously-bypass-approvals-and-sandbox %*
    call "%CODEX_CMD%" --dangerously-bypass-approvals-and-sandbox %*
) else (
    ECHO aidiy_codex --dangerously-bypass-approvals-and-sandbox --model %MODEL% %*
    call "%CODEX_CMD%" --dangerously-bypass-approvals-and-sandbox --model "%MODEL%" %*
)
set "EXIT_CODE=%ERRORLEVEL%"
endlocal & exit /b %EXIT_CODE%

:NOT_COMPILED
ECHO aidiy_codex is not compiled: %CODEX_CMD%
ECHO Run "python command_codex/_compile.py" or use "Compile" in aidiy_diag.
endlocal & exit /b 1

:END
endlocal & exit /b 0
