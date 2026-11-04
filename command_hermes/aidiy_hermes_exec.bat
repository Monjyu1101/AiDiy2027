@echo off
chcp 65001 >nul
setlocal

set "HERMES_DIR=%~dp0"
set "ROOT=%~dp0.."
set "PY=%HERMES_DIR%.venv\Scripts\python.exe"
set "HERMES_TUI=0"

cd /d "%ROOT%"

if not exist "%PY%" (
  echo Python virtual environment was not found:
  echo   %PY%
  echo.
  echo Run command_hermes\_setup.py to create it.
  pause
  exit /b 1
)

"%PY%" "%HERMES_DIR%cli_main.py" %*
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo Hermes TUI exited with code %EXIT_CODE%.
  pause
)

exit /b %EXIT_CODE%
