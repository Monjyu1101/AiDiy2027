@echo off
rem SSL Certificate Generation Script (Windows)
rem Generates self-signed SSL certificates for development

set SSL_DIR=ssl
set COUNTRY=JP
set STATE=Tokyo
set CITY=Tokyo
set ORGANIZATION=RiKi AiDiy
set ORGANIZATIONAL_UNIT=Development
set COMMON_NAME=kondou-envy.local
set EMAIL=admin@localhost

echo Generating SSL certificates...

rem Create SSL directory
if not exist %SSL_DIR% mkdir %SSL_DIR%

rem Check if OpenSSL is installed
openssl version >nul 2>&1
if errorlevel 1 (
    echo ERROR: OpenSSL is not installed.
    echo Please install OpenSSL or use Git Bash or WSL.
    echo.
    echo To use Git Bash: bash generate-ssl.sh
    pause
    exit /b 1
)

rem Generate private key
openssl genrsa -out %SSL_DIR%/key.pem 2048

rem Generate certificate signing request (CSR)
openssl req -new -key %SSL_DIR%/key.pem -out %SSL_DIR%/cert.csr -subj "/C=%COUNTRY%/ST=%STATE%/L=%CITY%/O=%ORGANIZATION%/OU=%ORGANIZATIONAL_UNIT%/CN=%COMMON_NAME%/emailAddress=%EMAIL%"

rem Generate self-signed certificate (valid for 365 days)
openssl x509 -req -days 365 -in %SSL_DIR%/cert.csr -signkey %SSL_DIR%/key.pem -out %SSL_DIR%/cert.pem

rem Remove CSR file
del %SSL_DIR%\cert.csr

echo.
echo SSL certificates generated successfully:
echo   Certificate: %SSL_DIR%\cert.pem
echo   Private Key: %SSL_DIR%\key.pem
echo.
echo NOTE: This is a self-signed certificate for development use only.
echo For production, use certificates issued by a trusted Certificate Authority.
echo.