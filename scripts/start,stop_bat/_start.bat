@echo off
cd /d "%~dp0../.."

ECHO python _start.py
start "cmd.exe" "python" _start.py

ECHO;
ECHO Waiting... 5s
ping 127.0.0.1 -w 1000 -n 5 >nul

exit
