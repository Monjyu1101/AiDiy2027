@echo off
setlocal
rem List agy.exe locations like the "agy.exe" row in Diag: standard, VS Code extension and PATH.
rem Check only. Nothing is executed or changed.
echo.
echo agy.exe locations - check only:
set "FOUND="
if exist "%LOCALAPPDATA%\agy\bin\agy.exe" set "FOUND=1"
if exist "%LOCALAPPDATA%\agy\bin\agy.exe" echo   standard : "%LOCALAPPDATA%\agy\bin\agy.exe"
if exist "%USERPROFILE%\.gemini\bin\agy.exe" set "FOUND=1"
if exist "%USERPROFILE%\.gemini\bin\agy.exe" echo   VS Code  : "%USERPROFILE%\.gemini\bin\agy.exe"
for /f "delims=" %%P in ('where agy.exe 2^>nul') do (
    set "FOUND=1"
    if /I not "%%~fP"=="%LOCALAPPDATA%\agy\bin\agy.exe" if /I not "%%~fP"=="%USERPROFILE%\.gemini\bin\agy.exe" echo   PATH     : "%%~fP"
)
if not defined FOUND echo   not found
endlocal & exit /b 0
