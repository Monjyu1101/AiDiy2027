@ECHO OFF

rem  --------
     PAUSE
rem  --------

ECHO;
ECHO ---------
ECHO uninstall
ECHO ---------
start npm uninstall -g @anthropic-ai/claude-code
start npm uninstall -g @openai/codex
start npm uninstall -g @opencode/cli
start npm uninstall -g opencode-ai
start npm uninstall -g @github/copilot

ECHO;
ECHO Waiting...5s
ping 127.0.0.1 -w 1000 -n 5 >nul

ECHO;
ECHO -----------
ECHO antigravity
ECHO -----------
rem  antigravity CLI has no uninstall subcommand, so remove it manually
if exist "%LOCALAPPDATA%\agy"         rmdir /s /q "%LOCALAPPDATA%\agy"
rem  %LOCALAPPDATA%\antigravity holds the shared installer staging and is kept, same as Diag
powershell -NoProfile -ExecutionPolicy Bypass -Command "$k='HKCU:\Environment'; $raw=(Get-Item $k).GetValue('Path',$null,'DoNotExpandEnvironmentNames'); if ($raw) { $t=[IO.Path]::Combine($env:LOCALAPPDATA,'agy','bin').TrimEnd('\'); $keep=@(); foreach ($e in ($raw -split ';')) { if ($e -eq '') { continue }; if ([Environment]::ExpandEnvironmentVariables($e).TrimEnd('\') -ieq $t) { continue }; $keep += $e }; $new=($keep -join ';'); if ($new -ne $raw) { Set-ItemProperty -Path $k -Name Path -Value $new -Type ExpandString; Write-Host ('PATH removed: ' + $t) } else { Write-Host 'PATH entry not found' } }"
rem  user settings in %USERPROFILE%\.antigravity are kept
rem  the VS Code extension agy.exe is not removed. Recheck agy.exe like Diag does after the operation
call "%~dp0check_agy_exe.bat"

ECHO;
ECHO --------------
ECHO Grok Build CLI
ECHO --------------
rem  Grok Build CLI (xai-org/grok-build, command: grok) has no uninstall subcommand, so remove it manually
rem  installer: irm https://x.ai/cli/install.ps1 | iex  (root: %USERPROFILE%\.grok)
rem  remove only bin / downloads / completions so config.toml is kept
if exist "%USERPROFILE%\.grok\bin"         rmdir /s /q "%USERPROFILE%\.grok\bin"
if exist "%USERPROFILE%\.grok\downloads"   rmdir /s /q "%USERPROFILE%\.grok\downloads"
if exist "%USERPROFILE%\.grok\completions" rmdir /s /q "%USERPROFILE%\.grok\completions"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$k='HKCU:\Environment'; $raw=(Get-Item $k).GetValue('Path',$null,'DoNotExpandEnvironmentNames'); if ($raw) { $t=[IO.Path]::Combine($env:USERPROFILE,'.grok','bin').TrimEnd('\'); $keep=@(); foreach ($e in ($raw -split ';')) { if ($e -eq '') { continue }; if ([Environment]::ExpandEnvironmentVariables($e).TrimEnd('\') -ieq $t) { continue }; $keep += $e }; $new=($keep -join ';'); if ($new -ne $raw) { Set-ItemProperty -Path $k -Name Path -Value $new -Type ExpandString; Write-Host ('PATH removed: ' + $t) } else { Write-Host 'PATH entry not found' } }"
rem  user settings in %USERPROFILE%\.grok\config.toml are kept

ECHO;
ECHO ------------------
ECHO GitHub Copilot CLI
ECHO ------------------
rem  only the npm version is removed. The MSI version and the VS Code copilot-shim are kept, same as Diag
if exist "%APPDATA%\npm\copilot.cmd" ECHO   npm : still found "%APPDATA%\npm\copilot.cmd"
if not exist "%APPDATA%\npm\copilot.cmd" ECHO   npm : removed
if exist "%LOCALAPPDATA%\GitHubCopilotCLI\copilot.exe" ECHO   MSI : "%LOCALAPPDATA%\GitHubCopilotCLI\copilot.exe" - remove it from Settings, Apps
ECHO   the copilot command in VS Code - copilot-shim - is only a launcher, not Copilot CLI

ECHO;
ECHO --------
ECHO npm list
ECHO --------
npm ls -g --depth=0

ECHO;
ECHO NOTE: PATH change takes effect in a new console (or after sign-out).
ECHO NOTE: user settings (.claude / .codex / .antigravity / .grok) are NOT removed.

rem  --------
     PAUSE
rem  --------
