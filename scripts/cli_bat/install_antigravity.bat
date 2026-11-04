@echo off
setlocal DisableDelayedExpansion
rem Keep the official installer CMDCMDLINE free of shell command chaining.
rem It rejects ampersands, pipes, semicolons and redirection characters.
set "NO_PAUSE=%~1"
set "INSTALL_DIR="
set "EXIT_CODE=1"
set /a ATTEMPTS=0 >nul
if not defined LOCALAPPDATA goto FAILED
if not defined TEMP goto FAILED

:CREATE_TEMP
set /a ATTEMPTS+=1 >nul
if %ATTEMPTS% GTR 10 goto FAILED
set "CANDIDATE=%TEMP%\aidiy-agy-%RANDOM%-%RANDOM%"
mkdir "%CANDIDATE%" >nul 2>&1
if errorlevel 1 goto CREATE_TEMP
set "INSTALL_DIR=%CANDIDATE%"
set "INSTALLER=%INSTALL_DIR%\install.cmd"

echo Downloading the official Antigravity CLI installer...
curl.exe -fsSL https://antigravity.google/cli/install.cmd -o "%INSTALLER%"
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" goto FAILED
rem A separate cmd is required: CALL would inherit the caller's CMDCMDLINE.
cmd.exe /d /v:off /s /c ""%INSTALLER%""
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" goto FAILED
if not exist "%LOCALAPPDATA%\agy\bin\agy.exe" (
    set "EXIT_CODE=1"
    echo ERROR: Installer finished but agy.exe was not found.
    goto FAILED
)
echo Antigravity CLI found: "%LOCALAPPDATA%\agy\bin\agy.exe"
echo In Diag, run the installation check again.
goto CLEANUP

:FAILED
if "%EXIT_CODE%"=="0" set "EXIT_CODE=1"
echo ERROR: Antigravity CLI installation failed. Exit code: %EXIT_CODE%
echo Review the error above. No login or version command was run.
if /I not "%NO_PAUSE%"=="/no-pause" pause

:CLEANUP
if defined INSTALL_DIR (
    del /q "%INSTALLER%" >nul 2>&1
    rmdir "%INSTALL_DIR%" >nul 2>&1
)
endlocal & exit /b %EXIT_CODE%
