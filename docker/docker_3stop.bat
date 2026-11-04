@echo off
rem AiDiy2027 Docker - Step 3: Stop Containers
rem Stop running Docker containers (keep images and data)

echo AiDiy2027 Docker - Step 3: Stop Containers
echo ===================================================

cd /d "%~dp0"

rem Docker check
docker version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Docker not available
    pause
    exit /b 1
)

rem Stop containers
echo Stopping containers...
docker-compose stop

if %errorlevel% == 0 (
    echo.
    echo ===================================================
    echo   STOP COMPLETE
    echo ===================================================
    echo.
    echo All containers have been stopped.
    echo Images and data are preserved.
    echo.
    echo To restart:  Run docker_2start.bat
    echo To cleanup:  Run docker_4delete.bat
    echo.
    docker-compose ps -a
) else (
    echo.
    echo ERROR: Failed to stop containers
    docker-compose logs --tail=10
)

echo.
pause