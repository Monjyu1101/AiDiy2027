@echo off
REM Windowsファイアウォールでポート閉鎖を行うスクリプト
REM 管理者権限が必要です

echo ========================================
echo   Windowsファイアウォール ポート閉鎖
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

echo RiKi AiDiy用ポートを閉鎖中...
echo.

REM すべてのRiKi AiDiy関連ルールを削除
echo RiKi AiDiy関連のファイアウォール規則を削除...

netsh advfirewall firewall delete rule name="RiKi AiDiy - HTTPS (443)"
netsh advfirewall firewall delete rule name="RiKi AiDiy - WebUI (8080)"
netsh advfirewall firewall delete rule name="RiKi AiDiy - coreAPI1 (8081)"
netsh advfirewall firewall delete rule name="RiKi AiDiy - coreAPI2 (8082)"
netsh advfirewall firewall delete rule name="RiKi AiDiy - coreAPI3 (8083)"
netsh advfirewall firewall delete rule name="RiKi AiDiy - Reserved (8084)"
netsh advfirewall firewall delete rule name="RiKi AiDiy - coreAPI5 (8085)"
netsh advfirewall firewall delete rule name="RiKi AiDiy - Reserved (8086)"
netsh advfirewall firewall delete rule name="RiKi AiDiy - Reserved (8087)"
netsh advfirewall firewall delete rule name="RiKi AiDiy - Reserved (8088)"
netsh advfirewall firewall delete rule name="RiKi AiDiy - coreAPI9 (8089)"

echo.
echo ========================================
echo   ポート閉鎖完了
echo ========================================
echo.
echo 削除されたポート:
echo   443, 8080-8089
echo.
echo 現在のファイアウォール規則を確認:
echo   netsh advfirewall firewall show rule name="RiKi AiDiy*"
echo.
pause