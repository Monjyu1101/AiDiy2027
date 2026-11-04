@echo off
setlocal
cd /d "%~dp0../.."

title Antigravity CLI
ECHO.
ECHO ============================================================
ECHO   Antigravity CLI
ECHO   %~nx0
ECHO ============================================================

set "MODEL="
set "AGY_EXE=%LOCALAPPDATA%\agy\bin\agy.exe"
set /p "UPDATE=update [N]/y: "
if /I "%UPDATE%"=="y" (
    ECHO Install/update Antigravity CLI
    call "%~dp0install_antigravity.bat" /no-pause
    if errorlevel 1 goto INSTALL_FAILED
)

:SELECT_MODEL
ECHO.
ECHO Antigravity CLI model list
ECHO   1: Gemini 3.8 Flash (High)
ECHO   2: Gemini 3.8 Flash (Medium) - default
ECHO   3: Gemini 3.8 Flash (Low)
ECHO   0: Exit
ECHO.
set "MODEL_NUMBER="
set /p "MODEL_NUMBER=Model number [Enter: default]: "
if "%MODEL_NUMBER%"=="0" goto END
if not defined MODEL_NUMBER goto LAUNCH
if "%MODEL_NUMBER%"=="1" set "MODEL=gemini-3.8-flash-high"
if "%MODEL_NUMBER%"=="2" set "MODEL=gemini-3.8-flash-medium"
if "%MODEL_NUMBER%"=="3" set "MODEL=gemini-3.8-flash-low"
if defined MODEL goto LAUNCH
ECHO Invalid input. Enter a number or press Enter.
goto SELECT_MODEL

:LAUNCH
if exist "%AGY_EXE%" goto LAUNCH_BY_PATH
where agy >nul 2>&1
if errorlevel 1 goto NOT_INSTALLED

if defined MODEL (
    ECHO agy --dangerously-skip-permissions --model %MODEL% %*
    call agy --dangerously-skip-permissions --model "%MODEL%" %*
) else (
    ECHO agy --dangerously-skip-permissions %*
    call agy --dangerously-skip-permissions %*
)
set "EXIT_CODE=%ERRORLEVEL%"
endlocal & exit /b %EXIT_CODE%

:LAUNCH_BY_PATH
if defined MODEL (
    ECHO "%AGY_EXE%" --dangerously-skip-permissions --model %MODEL% %*
    call "%AGY_EXE%" --dangerously-skip-permissions --model "%MODEL%" %*
) else (
    ECHO "%AGY_EXE%" --dangerously-skip-permissions %*
    call "%AGY_EXE%" --dangerously-skip-permissions %*
)
set "EXIT_CODE=%ERRORLEVEL%"
endlocal & exit /b %EXIT_CODE%

:NOT_INSTALLED
ECHO Antigravity CLI is not installed. Restart this script and enter y at the update prompt.
endlocal & exit /b 1

:INSTALL_FAILED
ECHO Antigravity CLI installation failed.
endlocal & exit /b 1

:END
endlocal & exit /b 0
