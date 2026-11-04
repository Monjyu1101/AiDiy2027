@echo off
setlocal
cd /d "%~dp0../.."

:SELECT_MODEL
ECHO.
ECHO OpenCode model list
ECHO   1: Kimi K2.6 (Ollama cloud) - default
ECHO   0: Exit
ECHO.
set "MODEL_NUMBER="
set /p "MODEL_NUMBER=Model number [Enter: default]: "
if "%MODEL_NUMBER%"=="0" goto END
if not defined MODEL_NUMBER goto LAUNCH
if "%MODEL_NUMBER%"=="1" goto LAUNCH
ECHO Invalid input. Enter a number or press Enter.
goto SELECT_MODEL

:LAUNCH
ECHO ollama launch opencode --model kimi-k2.6:cloud
call ollama launch opencode --model kimi-k2.6:cloud
set "EXIT_CODE=%ERRORLEVEL%"
endlocal & exit /b %EXIT_CODE%

:END
endlocal & exit /b 0
