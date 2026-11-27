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
rem Same rule as Diag: the standard agy.exe first, then another agy.exe on PATH.
rem The VS Code extension agy.exe is used only when nothing else exists, with the same approval mode.
set "AGY_EXTENSION=%USERPROFILE%\.gemini\bin\agy.exe"
set "AGY_RUN="
set "AGY_ARGS=--dangerously-skip-permissions"
if exist "%AGY_EXE%" set "AGY_RUN=%AGY_EXE%"
if not defined AGY_RUN for /f "delims=" %%P in ('where agy.exe 2^>nul') do if not defined AGY_RUN if /I not "%%~fP"=="%AGY_EXTENSION%" set "AGY_RUN=%%~fP"
if not defined AGY_RUN if exist "%AGY_EXTENSION%" set "AGY_RUN=%AGY_EXTENSION%"
if not defined AGY_RUN goto NOT_INSTALLED

if defined MODEL (
    ECHO "%AGY_RUN%" %AGY_ARGS% --model %MODEL% %*
    call "%AGY_RUN%" %AGY_ARGS% --model "%MODEL%" %*
) else (
    ECHO "%AGY_RUN%" %AGY_ARGS% %*
    call "%AGY_RUN%" %AGY_ARGS% %*
)
set "EXIT_CODE=%ERRORLEVEL%"
endlocal & exit /b %EXIT_CODE%

:NOT_INSTALLED
ECHO Antigravity CLI is not installed. Restart this script and enter y at the update prompt.
call "%~dp0check_agy_exe.bat"
endlocal & exit /b 1

:INSTALL_FAILED
ECHO Antigravity CLI installation failed.
endlocal & exit /b 1

:END
endlocal & exit /b 0
