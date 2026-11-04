@echo off
setlocal
cd /d "%~dp0../.."

title AiDiy Hermes CLI
ECHO.
ECHO ============================================================
ECHO   AiDiy Hermes CLI
ECHO   %~nx0
ECHO ============================================================

:SELECT_MODEL
ECHO.
ECHO Model list
ECHO   1: codex_cli/same
ECHO   2: copilot_cli/same
ECHO   3: openai_oauth/gpt-6-astra
ECHO   4: openai_oauth/gpt-6.1-sol
ECHO   5: openai_oauth/gpt-6.1-terra
ECHO   6: openai_oauth/gpt-6-luna
ECHO   0: Exit
ECHO.
set "MODEL="
set "MODEL_NUMBER="
set /p "MODEL_NUMBER=Model number [Enter: openai_oauth/gpt-6.1-sol]: "
if "%MODEL_NUMBER%"=="0" goto END
if not defined MODEL_NUMBER set "MODEL_NUMBER=4"
if "%MODEL_NUMBER%"=="1" set "MODEL=codex_cli/same"
if "%MODEL_NUMBER%"=="2" set "MODEL=copilot_cli/same"
if "%MODEL_NUMBER%"=="3" set "MODEL=openai_oauth/gpt-6-astra"
if "%MODEL_NUMBER%"=="4" set "MODEL=openai_oauth/gpt-6.1-sol"
if "%MODEL_NUMBER%"=="5" set "MODEL=openai_oauth/gpt-6.1-terra"
if "%MODEL_NUMBER%"=="6" set "MODEL=openai_oauth/gpt-6-luna"
if defined MODEL goto LAUNCH
ECHO Invalid input. Enter a number or press Enter.
goto SELECT_MODEL

:LAUNCH
for /f "tokens=1,* delims=/" %%A in ("%MODEL%") do (
    set "MODEL_PROVIDER=%%A"
    set "MODEL_NAME=%%B"
)
if "%MODEL_PROVIDER%"=="codex_cli" set "MODEL_PROVIDER=codex-cli"
if "%MODEL_PROVIDER%"=="copilot_cli" set "MODEL_PROVIDER=copilot-cli"
ECHO aidiy_hermes --yolo --provider %MODEL_PROVIDER% --model %MODEL_NAME% %*
call aidiy_hermes --yolo --provider "%MODEL_PROVIDER%" --model "%MODEL_NAME%" %*
set "EXIT_CODE=%ERRORLEVEL%"

endlocal & exit /b %EXIT_CODE%

:END
endlocal & exit /b 0
