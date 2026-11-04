@echo off
rem AiDiy2027 Docker - Step 4: Delete and Cleanup
rem Complete cleanup: containers, images, SSL certificates

echo AiDiy2027 Docker - Step 4: Delete and Cleanup
echo ======================================================

cd /d "%~dp0"

rem Docker check
docker version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Docker not available
    pause
    exit /b 1
)

rem Stop and remove containers
echo Stopping and removing containers...
docker-compose down --remove-orphans

rem Remove specific images
echo Removing Docker images...
for /f "tokens=*" %%i in ('docker images "aidiy2027*" -q 2^>nul') do docker rmi %%i 2>nul
for /f "tokens=*" %%i in ('docker images "docker-aidiy2027*" -q 2^>nul') do docker rmi %%i 2>nul
for /f "tokens=*" %%i in ('docker images "nginx" -q 2^>nul') do docker rmi %%i 2>nul

rem Clean up Docker system
echo Cleaning up Docker system...
docker system prune -f >nul 2>&1

rem Remove SSL certificates
echo Removing SSL certificates...
if exist ssl (
    rmdir /s /q ssl
    echo [OK] SSL certificates removed
) else (
    echo [OK] No SSL certificates found
)

rem Clean up any remaining Docker volumes
echo Cleaning up Docker volumes...
docker volume rm docker_frontend-dist >nul 2>&1
docker volume prune -f >nul 2>&1

rem Clean up any orphaned networks
echo Cleaning up Docker networks...
docker network prune -f >nul 2>&1

echo.
echo ======================================================
echo   DELETE AND CLEANUP COMPLETE
echo ======================================================
echo.
echo All containers, images, and SSL certificates removed.
echo Database files in ../_data are preserved.
echo.
echo To rebuild: Run docker_1build.bat
echo.

pause
