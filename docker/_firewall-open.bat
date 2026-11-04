@echo off
REM Windowsファイアウォールでポート開放を行うスクリプト
REM 管理者権限が必要です

echo ========================================
echo   Windowsファイアウォール ポート開放
echo ========================================
echo.

REM 管理者権限チェック
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] 管理者権限が必要です。
    echo このバッチファイルを「管理者として実行」してください。
    echo.
    pause
    exit /b 1
)

echo 管理者権限確認: OK
echo.

echo RiKi AiDiy用ポートを開放中...
echo.

REM HTTPS (443)
echo [1/11] ポート443 (HTTPS) を開放...
netsh advfirewall firewall add rule name="RiKi AiDiy - HTTPS (443)" dir=in action=allow protocol=TCP localport=443
if %errorlevel% equ 0 (
    echo    [SUCCESS] ポート443が開放されました
) else (
    echo    [INFO] ポート443は既に開放されているか、エラーが発生しました
)

REM WebUI (8080)
echo [2/11] ポート8080 (WebUI) を開放...
netsh advfirewall firewall add rule name="RiKi AiDiy - WebUI (8080)" dir=in action=allow protocol=TCP localport=8080
if %errorlevel% equ 0 (
    echo    [SUCCESS] ポート8080が開放されました
) else (
    echo    [INFO] ポート8080は既に開放されているか、エラーが発生しました
)

REM coreAPI1 (8081)
echo [3/11] ポート8081 (coreAPI1) を開放...
netsh advfirewall firewall add rule name="RiKi AiDiy - coreAPI1 (8081)" dir=in action=allow protocol=TCP localport=8081
if %errorlevel% equ 0 (
    echo    [SUCCESS] ポート8081が開放されました
) else (
    echo    [INFO] ポート8081は既に開放されているか、エラーが発生しました
)

REM coreAPI2 (8082)
echo [4/11] ポート8082 (coreAPI2) を開放...
netsh advfirewall firewall add rule name="RiKi AiDiy - coreAPI2 (8082)" dir=in action=allow protocol=TCP localport=8082
if %errorlevel% equ 0 (
    echo    [SUCCESS] ポート8082が開放されました
) else (
    echo    [INFO] ポート8082は既に開放されているか、エラーが発生しました
)

REM coreAPI3 (8083)
echo [5/11] ポート8083 (coreAPI3) を開放...
netsh advfirewall firewall add rule name="RiKi AiDiy - coreAPI3 (8083)" dir=in action=allow protocol=TCP localport=8083
if %errorlevel% equ 0 (
    echo    [SUCCESS] ポート8083が開放されました
) else (
    echo    [INFO] ポート8083は既に開放されているか、エラーが発生しました
)

REM 8084 (予約)
echo [6/11] ポート8084 (予約) を開放...
netsh advfirewall firewall add rule name="RiKi AiDiy - Reserved (8084)" dir=in action=allow protocol=TCP localport=8084
if %errorlevel% equ 0 (
    echo    [SUCCESS] ポート8084が開放されました
) else (
    echo    [INFO] ポート8084は既に開放されているか、エラーが発生しました
)

REM coreAPI5 (8085)
echo [7/11] ポート8085 (coreAPI5) を開放...
netsh advfirewall firewall add rule name="RiKi AiDiy - coreAPI5 (8085)" dir=in action=allow protocol=TCP localport=8085
if %errorlevel% equ 0 (
    echo    [SUCCESS] ポート8085が開放されました
) else (
    echo    [INFO] ポート8085は既に開放されているか、エラーが発生しました
)

REM 8086-8088 (予約)
echo [8/11] ポート8086 (予約) を開放...
netsh advfirewall firewall add rule name="RiKi AiDiy - Reserved (8086)" dir=in action=allow protocol=TCP localport=8086
if %errorlevel% equ 0 (
    echo    [SUCCESS] ポート8086が開放されました
) else (
    echo    [INFO] ポート8086は既に開放されているか、エラーが発生しました
)

echo [9/11] ポート8087 (予約) を開放...
netsh advfirewall firewall add rule name="RiKi AiDiy - Reserved (8087)" dir=in action=allow protocol=TCP localport=8087
if %errorlevel% equ 0 (
    echo    [SUCCESS] ポート8087が開放されました
) else (
    echo    [INFO] ポート8087は既に開放されているか、エラーが発生しました
)

echo [10/11] ポート8088 (予約) を開放...
netsh advfirewall firewall add rule name="RiKi AiDiy - Reserved (8088)" dir=in action=allow protocol=TCP localport=8088
if %errorlevel% equ 0 (
    echo    [SUCCESS] ポート8088が開放されました
) else (
    echo    [INFO] ポート8088は既に開放されているか、エラーが発生しました
)

REM coreAPI9 (8089)
echo [11/11] ポート8089 (coreAPI9) を開放...
netsh advfirewall firewall add rule name="RiKi AiDiy - coreAPI9 (8089)" dir=in action=allow protocol=TCP localport=8089
if %errorlevel% equ 0 (
    echo    [SUCCESS] ポート8089が開放されました
) else (
    echo    [INFO] ポート8089は既に開放されているか、エラーが発生しました
)

echo.
echo ========================================
echo   ポート開放完了
echo ========================================
echo.
echo 開放されたポート:
echo   443  - HTTPS
echo   8080 - WebUI
echo   8081 - coreAPI1 (認証・ユーザー管理・LiveAI)
echo   8082 - coreAPI2 (車両管理・配車区分管理)
echo   8083 - coreAPI3 (配車データ管理)
echo   8084 - 予約
echo   8085 - coreAPI5 (S週表示・S日表示)
echo   8086 - 予約
echo   8087 - 予約
echo   8088 - 予約
echo   8089 - coreAPI9 (共通機能・ユーティリティ)
echo.
echo 現在のファイアウォール規則を確認:
echo   netsh advfirewall firewall show rule name="RiKi AiDiy*"
echo.
pause