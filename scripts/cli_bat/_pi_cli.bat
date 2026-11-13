@echo off
setlocal
cd /d "%~dp0../.."

title AiDiy Pi CLI
ECHO.
ECHO ============================================================
ECHO   AiDiy Pi CLI
ECHO   %~nx0
ECHO ============================================================

:SELECT_MODEL
ECHO.
ECHO Model list
ECHO   1: same (last selected model)
ECHO   2: openai_oauth/gpt-6-astra
ECHO   3: openai_oauth/gpt-6.1-sol
ECHO   4: openai_oauth/gpt-6.1-terra
ECHO   5: openai_oauth/gpt-6-luna
ECHO   0: Exit
ECHO.
set "MODEL="
set "MODEL_NUMBER="
set /p "MODEL_NUMBER=Model number [Enter: same]: "
if "%MODEL_NUMBER%"=="0" goto END
if not defined MODEL_NUMBER set "MODEL_NUMBER=1"
if "%MODEL_NUMBER%"=="1" set "MODEL=same"
if "%MODEL_NUMBER%"=="2" set "MODEL=openai_oauth/gpt-6-astra"
if "%MODEL_NUMBER%"=="3" set "MODEL=openai_oauth/gpt-6.1-sol"
if "%MODEL_NUMBER%"=="4" set "MODEL=openai_oauth/gpt-6.1-terra"
if "%MODEL_NUMBER%"=="5" set "MODEL=openai_oauth/gpt-6-luna"
if defined MODEL goto LAUNCH
ECHO Invalid input. Enter a number or press Enter.
goto SELECT_MODEL

:LAUNCH
REM Pi has no approval prompts. Other models can be selected with /model in Pi.
ECHO aidiy_pi --model %MODEL% %*
call aidiy_pi --model "%MODEL%" %*
set "EXIT_CODE=%ERRORLEVEL%"

endlocal & exit /b %EXIT_CODE%

:END
endlocal & exit /b 0
