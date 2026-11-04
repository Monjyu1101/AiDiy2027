@echo off
REM Setup hosts file for kondou-envy.local domain

echo ========================================
echo   kondou-envy Host Setup
echo ========================================

set HOSTS_FILE=C:\Windows\System32\drivers\etc\hosts
set HOSTNAME=kondou-envy.local
set IP_ADDRESS=127.0.0.1

echo Checking current hosts file content...
echo.

REM Check if entry already exists
findstr /C:"%HOSTNAME%" "%HOSTS_FILE%" >nul 2>&1
if %errorlevel% equ 0 (
    echo [INFO] %HOSTNAME% is already registered in hosts file.
    echo Current setting:
    findstr /C:"%HOSTNAME%" "%HOSTS_FILE%"
    echo.
    goto :choice
) else (
    echo [INFO] %HOSTNAME% is not registered in hosts file.
    echo.
)

:choice
echo Add the following setting to hosts file?
echo   %IP_ADDRESS% %HOSTNAME%
echo.
echo 1. Add automatically (Administrator privileges required)
echo 2. Show manual setup instructions
echo 3. Cancel
echo.
set /p choice="Please select (1-3): "

if "%choice%"=="1" goto :add_auto
if "%choice%"=="2" goto :manual
if "%choice%"=="3" goto :exit

:add_auto
echo.
echo Adding entry to hosts file with administrator privileges...

REM Check administrator privileges
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Administrator privileges required.
    echo Please run this batch file as "Run as administrator".
    echo.
    goto :manual
)

REM Add entry to hosts file
echo %IP_ADDRESS% %HOSTNAME% >> "%HOSTS_FILE%"
if %errorlevel% equ 0 (
    echo [SUCCESS] Entry added to hosts file.
    echo Added content: %IP_ADDRESS% %HOSTNAME%
) else (
    echo [ERROR] Failed to add entry to hosts file.
    goto :manual
)

echo.
echo Clearing DNS cache...
ipconfig /flushdns >nul 2>&1
echo [SUCCESS] DNS cache cleared successfully.

goto :test

:manual
echo.
echo ========================================
echo   Manual Setup Instructions
echo ========================================
echo.
echo 1. Start Command Prompt as "Run as administrator"
echo 2. File menu - Open the following file:
echo    %HOSTS_FILE%
echo.
echo 3. Add the following line at the end of the file:
echo    %IP_ADDRESS% %HOSTNAME%
echo.
echo 4. Save the file
echo.
echo 5. Run the following command in Command Prompt:
echo    ipconfig /flushdns
echo.
goto :test

:test
echo ========================================
echo   Connection Test
echo ========================================
echo.
echo After setup completion, you can access at:
echo   https://%HOSTNAME%/
echo.
echo Please make sure Docker containers are running:
echo   docker ps
echo.
echo Run connection test (ping)? (y/n)
set /p test_choice="Select: "

if /i "%test_choice%"=="y" (
    echo.
    echo Ping test to %HOSTNAME%:
    ping -n 4 %HOSTNAME%
)

:exit
echo.
echo Setup completed.
echo Start Docker and access https://%HOSTNAME%/
echo.
pause