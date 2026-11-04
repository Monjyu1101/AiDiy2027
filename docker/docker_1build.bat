@echo off
rem AiDiy2027 Docker - Step 1: Build Images
rem SSL certificate generation and Docker image building

echo AiDiy2027 Docker - Step 1: Build Images
echo ========================================

cd /d "%~dp0"

rem Docker check
docker version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Docker not available
    echo Please install Docker Desktop and ensure it is running
    pause
    exit /b 1
)

rem SSL Certificate Generation
echo Generating SSL certificates...
if not exist ssl mkdir ssl

rem Check for OpenSSL (try multiple common locations)
set OPENSSL_FOUND=0
openssl version >nul 2>&1
if %errorlevel% == 0 (
    set OPENSSL_FOUND=1
) else (
    rem Try Git's OpenSSL
    if exist "C:\Program Files\Git\usr\bin\openssl.exe" (
        set "PATH=C:\Program Files\Git\usr\bin;%PATH%"
        set OPENSSL_FOUND=1
    ) else if exist "C:\Program Files (x86)\Git\usr\bin\openssl.exe" (
        set "PATH=C:\Program Files (x86)\Git\usr\bin;%PATH%"
        set OPENSSL_FOUND=1
    )
)

if %OPENSSL_FOUND% == 1 (
    rem Generate new SSL certificates (SAN: localhost, kondou-envy.local)
    echo Generating new SSL certificate for localhost and kondou-envy.local...
    openssl genrsa -out ssl/key.pem 2048 >nul 2>&1
    openssl req -x509 -new -key ssl/key.pem -sha256 -days 365 -out ssl/cert.pem -subj "/C=JP/ST=Tokyo/L=Tokyo/O=AiDiy2027/OU=Development/CN=localhost/emailAddress=admin@localhost" -addext "subjectAltName=DNS:localhost,DNS:kondou-envy.local" >nul 2>&1
    echo [OK] SSL certificates generated
) else (
    echo [WARN] OpenSSL not found. Using Docker to generate SSL certificates...
    docker run --rm -v "%cd%\ssl:/ssl" alpine/openssl genrsa -out /ssl/key.pem 2048
    docker run --rm -v "%cd%\ssl:/ssl" alpine/openssl req -x509 -new -key /ssl/key.pem -sha256 -days 365 -out /ssl/cert.pem -subj "/C=JP/ST=Tokyo/L=Tokyo/O=AiDiy2027/OU=Development/CN=localhost/emailAddress=admin@localhost" -addext "subjectAltName=DNS:localhost,DNS:kondou-envy.local"
    echo [OK] SSL certificates generated via Docker
)

rem Build Docker images
echo.
echo Building Docker images (this may take a few minutes)...
docker-compose build --no-cache

if %errorlevel% == 0 (
    echo.
    echo ========================================
    echo   BUILD COMPLETE
    echo ========================================
    echo.
    echo Docker images and SSL certificates are ready.
    echo Next step: Run docker_2start.bat
    echo.
) else (
    echo.
    echo ERROR: Failed to build images
    docker-compose logs --tail=20
)

echo.
pause
