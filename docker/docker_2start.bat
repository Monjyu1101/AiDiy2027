@echo off
rem AiDiy2027 Docker - Step 2: Start Containers
rem Start Docker containers from built images

echo AiDiy2027 Docker - Step 2: Start Containers
echo =============================================

cd /d "%~dp0"

rem Docker check
docker version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Docker not available
    echo Please ensure Docker Desktop is running
    pause
    exit /b 1
)

rem Check if images exist
echo Checking Docker images...
docker images aidiy2027* -q >nul 2>&1
if errorlevel 1 (
    echo ERROR: Docker images not found.
    echo Please run docker_1build.bat first.
    pause
    exit /b 1
)

rem Start containers
echo Starting containers...
docker-compose up -d
set START_ERROR=%errorlevel%

rem Check running containers (ignore docker-compose exit code quirks)
docker ps --format "{{.Names}}" | findstr /i /c:"aidiy2027" >nul 2>&1
if %errorlevel% == 0 (
    echo.
    echo =============================================
    echo   STARTUP COMPLETE
    echo =============================================
    echo.
    echo *** IMPORTANT: For audio/video features, use HTTPS ***
    echo.
    echo Allowed Access ^(HTTPS^):
    echo   - Frontend ^(HTTPS^):  https://localhost/
    echo   - Frontend ^(HTTPS^):  https://kondou-envy.local/
    echo.
    echo Backend API Documentation ^(Direct only^):
    echo   - Core API ^(Direct^): http://kondou-envy:8091/docs
    echo   - Apps API ^(Direct^): http://kondou-envy:8098/docs
    echo.
    echo Default Login:
    echo   - Username: admin
    echo   - Password: ^(check README.md^)
    echo.
    echo Note: You will need to accept the self-signed certificate warning
    echo       in your browser when accessing HTTPS for the first time.
    echo.
    docker-compose ps
    echo.
    echo Opening browser: https://localhost/
    start "" "https://localhost/"
) else (
    echo.
    echo ERROR: Failed to start containers
    echo docker-compose exit code: %START_ERROR%
    docker-compose logs --tail=20
)

echo.
pause
