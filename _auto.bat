@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 932 >nul
if errorlevel 1 goto temp_error
rem Standalone CP932 batch. Keep CRLF and chcp 932; labels stay ASCII.
if /i "%~1"=="--_aidiy_temp" goto temp_entry
if not defined TEMP goto temp_error
if not defined USERPROFILE goto temp_error
set "AIDIY_CWD=%CD%"
set "AIDIY_SOURCE=%~f0"
set "AIDIY_SOURCE_DIR=%~dp0."
set "ATTEMPTS=0"
:make_temp
set /a ATTEMPTS+=1 >nul
if %ATTEMPTS% GTR 10 goto temp_error
set "AIDIY_RUN=%RANDOM%-%RANDOM%-%RANDOM%"
set "AIDIY_TEMP=%TEMP%\AiDiy-automatic-%AIDIY_RUN%"
mkdir "%AIDIY_TEMP%" >nul 2>&1
if errorlevel 1 goto make_temp
copy /b /v /y "%~f0" "%AIDIY_TEMP%\_auto.bat" >nul
if errorlevel 1 goto temp_error
rem Transfer without CALL. Never read the original batch after self-update.
"%AIDIY_TEMP%\_auto.bat" --_aidiy_temp
exit /b 2

:temp_entry
if not defined AIDIY_TEMP goto temp_error
if not defined AIDIY_CWD goto temp_error
if not defined AIDIY_SOURCE goto temp_error
if not defined AIDIY_SOURCE_DIR goto temp_error
if /i not "%~dp0"=="%AIDIY_TEMP%\" goto temp_error
set "RC=0"
set "LOG_ROOT=%LOCALAPPDATA%\AiDiy\automatic\logs"
if not defined LOCALAPPDATA set "LOG_ROOT=%USERPROFILE%\AiDiy\automatic\logs"
if not exist "%LOG_ROOT%\" mkdir "%LOG_ROOT%" >nul 2>&1
set "LOG=%LOG_ROOT%\automatic-%AIDIY_RUN%.log"
>"%LOG%" echo START %DATE% %TIME%
if errorlevel 1 goto log_error
>>"%LOG%" echo CWD="%AIDIY_CWD%"
echo [WARN] 二重実行は防止しません。他の自動実行がないことを利用者が確認してください。
echo [WARN] 追跡ファイルのローカル変更は破棄し、GitHubの最新版で強制的に書き換えます。
set "RUN_AIDIY=y"
set /p "RUN_AIDIY=aidiyセットアップと実行しますか？ [y]/n: "
rem Do not expand user input as command text. Empty input keeps default Yes.
set RUN_AIDIY | findstr /i /x /c:"RUN_AIDIY=n" >nul
if not errorlevel 1 goto cancelled
echo [INFO] 実行記録: "%LOG%"

echo(
echo ============================================================
echo 環境チェック
echo ============================================================
echo(
rem Only bootstrap requirements are fatal here. Normal setup owns Node/npm/uv.
set "RC=2"
set "STAGE=prerequisite_git"
echo [INFO] Git
git --version >"%AIDIY_TEMP%\probe.txt" 2>&1
if errorlevel 1 goto prerequisite_failed
type "%AIDIY_TEMP%\probe.txt"
type "%AIDIY_TEMP%\probe.txt" >>"%LOG%"
set "STAGE=prerequisite_python"
echo [INFO] Python実行環境（3.13以上を推奨、旧版でも続行）
py -3 -X utf8 -c "import sys;encoded=sys.executable.encode('cp932');encoded.decode('cp932')!=sys.executable and sys.exit(3);sys.stdout.buffer.write(encoded+b'\r\n');sys.stderr.write('Python '+sys.version.split()[0]+'\n')" >"%AIDIY_TEMP%\python.txt" 2>"%AIDIY_TEMP%\probe.txt"
if not errorlevel 1 goto python_ready
type "%AIDIY_TEMP%\probe.txt" >>"%LOG%"
python -X utf8 -c "import sys;encoded=sys.executable.encode('cp932');encoded.decode('cp932')!=sys.executable and sys.exit(3);sys.stdout.buffer.write(encoded+b'\r\n');sys.stderr.write('Python '+sys.version.split()[0]+'\n')" >"%AIDIY_TEMP%\python.txt" 2>"%AIDIY_TEMP%\probe.txt"
if errorlevel 1 goto prerequisite_failed
:python_ready
set "PYTHON="
set /p "PYTHON="<"%AIDIY_TEMP%\python.txt"
if not defined PYTHON goto prerequisite_failed
type "%AIDIY_TEMP%\probe.txt"
type "%AIDIY_TEMP%\probe.txt" >>"%LOG%"
rem Minimum versions are warnings only. Never block an executable old Python.
"%PYTHON%" -c "import sys;sys.exit(0 if sys.version_info >= (3,13) else 1)" >nul 2>&1
if errorlevel 1 call :python_version_warning

rem Advisory only: setup offers its normal installation and update choices.
set "STAGE=check_node"
node --version >"%AIDIY_TEMP%\probe.txt" 2>&1
set "CHECK_RC=%ERRORLEVEL%"
call :report_optional_check
set "STAGE=check_npm"
rem npm is commonly npm.cmd. A child CMD returns here instead of chaining away.
"%ComSpec%" /d /c npm --version >"%AIDIY_TEMP%\probe.txt" 2>&1
set "CHECK_RC=%ERRORLEVEL%"
call :report_optional_check
set "STAGE=check_uv"
uv --version >"%AIDIY_TEMP%\probe.txt" 2>&1
set "CHECK_RC=%ERRORLEVEL%"
call :report_optional_check
set "STAGE=git_environment"
rem Refuse inherited Git environment variables that redirect the checkout.
if defined GIT_DIR goto failed
if defined GIT_WORK_TREE goto failed
if defined GIT_COMMON_DIR goto failed
if defined GIT_INDEX_FILE goto failed
if defined GIT_OBJECT_DIRECTORY goto failed
set "GIT_TERMINAL_PROMPT=0"
rem Priority: original cwd, original script directory, USERPROFILE fallback.
set "TARGET=%USERPROFILE%\AiDiy2027"
if exist "%AIDIY_SOURCE_DIR%\backend_server\" set "TARGET=%AIDIY_SOURCE_DIR%"
if exist "%AIDIY_CWD%\backend_server\" set "TARGET=%AIDIY_CWD%"
>>"%LOG%" echo TARGET="%TARGET%"
echo [INFO] 対象フォルダ: "%TARGET%"
if exist "%TARGET%" goto existing

echo(
echo ============================================================
echo リポジトリの新規取得
echo ============================================================
echo(
set "STAGE=clone"
set "STAGING=%USERPROFILE%\.AiDiy2027-clone-%AIDIY_RUN%"
git clone --branch main --single-branch https://github.com/Monjyu1101/AiDiy2027.git "%STAGING%"
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" goto failed
rem REN refuses an existing destination. Keep the staging clone on failure.
ren "%STAGING%" "AiDiy2027"
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" goto failed

:existing
echo(
echo ============================================================
echo リポジトリの確認
echo ============================================================
echo(
set "RC=3"
call :validate_repository
if errorlevel 1 goto failed
set "CONTROL=%TARGET%\temp\_auto"
set "STAGE=repository_control_directory"
rem Keep launcher backups outside Git metadata; never follow temp junctions.
"%PYTHON%" -X utf8 -c "import os,sys;from pathlib import Path;sys.stderr.reconfigure(encoding='cp932',errors='backslashreplace');paths=[Path('temp'),Path('temp')/'_auto'];safe=lambda p:not (p.is_symlink() or getattr(p.lstat(),'st_file_attributes',0) & 1024) and p.is_dir();all(not os.path.lexists(p) or safe(p) for p in paths) or sys.exit('Launcher temp path must be a normal directory, not a link/reparse point or file.')" >"%AIDIY_TEMP%\validation.txt" 2>&1
if errorlevel 1 goto control_failed
if exist "%CONTROL%\" goto control_ready
mkdir "%CONTROL%" >"%AIDIY_TEMP%\validation.txt" 2>&1
if errorlevel 1 goto control_failed
:control_ready
echo(
echo ============================================================
echo 書き換え準備
echo ============================================================
echo(
set "STAGE=overwrite_prepare"
set "BACKUP=%CONTROL%\%AIDIY_RUN%"
call :prepare_overwrite
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" goto failed
>>"%LOG%" echo BACKUP="%BACKUP%"
echo [INFO] 保全先: "%BACKUP%"

echo(
echo ============================================================
echo リポジトリの更新(github優先)
echo ============================================================
echo(
set "STAGE=fetch"
git fetch --no-tags origin refs/heads/main
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" goto failed
set "STAGE=overwrite_preservation"
"%PYTHON%" -X utf8 -c "import builtins;builtins.exec('# github_overwrite_preflight\nimport os, sys, shutil, subprocess, json\nfrom pathlib import Path, PurePosixPath\nsys.stderr.reconfigure(encoding=\'cp932\', errors=\'backslashreplace\')\nbackup = Path(os.environ[\'BACKUP\'])\ndef git(*args):\n    return subprocess.check_output([\'git\', *args])\ndef safe(p):\n    return not (p.is_symlink() or getattr(p.lstat(), \'st_file_attributes\', 0) & 1024)\ndef guard(folder, names):\n    if not all(safe(Path(folder) / name) for name in names):\n        sys.exit(\'Preservation refuses links/reparse points: \' + str(folder))\n    return []\ndef checked(name):\n    parts = PurePosixPath(name).parts\n    if not parts or any(p in (\'\', \'.\', \'..\') or \':\' in p or \'\\\\\' in p for p in parts) or name.startswith(\'/\'):\n        sys.exit(\'Unsafe repository path\')\n    folded = \'/\'.join(p.rstrip(\' .\').casefold() for p in parts)\n    if folded in (\'temp\', \'temp/_auto\') or folded.startswith(\'temp/_auto/\') or \'.git\' in folded.split(\'/\'):\n        sys.exit(\'Repository content overlaps launcher backup or Git metadata\')\n    return Path(*parts)\nexpected_head = (backup / \'head.txt\').read_text(encoding=\'ascii\').strip()\nif git(\'rev-parse\', \'HEAD\').decode(\'ascii\').strip() != expected_head:\n    sys.exit(\'HEAD changed before overwrite; stop concurrent Git operations\')\nremote = git(\'rev-parse\', \'--verify\', \'FETCH_HEAD^{commit}\').decode(\'ascii\').strip()\nif len(remote) not in (40, 64) or any(ch not in \'0123456789abcdef\' for ch in remote):\n    sys.exit(\'Invalid fetched commit\')\n(backup / \'remote-head.txt\').write_text(remote + \'\\n\', encoding=\'ascii\')\nindex = git(\'ls-files\', \'--stage\', \'-z\')\ntracked = set()\nfor entry in index.split(b\'\\0\'):\n    if not entry:\n        continue\n    meta, raw = entry.split(b\'\\t\', 1)\n    if meta.split()[0] == b\'160000\':\n        sys.exit(\'Submodule index requires manual handling\')\n    tracked.add(checked(raw.decode(\'utf-8\')))\ntracked.update(checked(raw.decode(\'utf-8\')) for raw in git(\'ls-tree\', \'-r\', \'--name-only\', \'-z\', expected_head).split(b\'\\0\') if raw)\npaths = set(tracked)\nfor entry in git(\'ls-tree\', \'-r\', \'-z\', remote).split(b\'\\0\'):\n    if not entry:\n        continue\n    meta, raw = entry.split(b\'\\t\', 1)\n    if meta.split()[0] in (b\'160000\', b\'120000\'):\n        sys.exit(\'Remote submodule/link requires manual handling\')\n    paths.add(checked(raw.decode(\'utf-8\')))\nselected = set()\nfor path in sorted(paths):\n    candidates = [*reversed(path.parents)][1:] + [path]\n    for part in candidates:\n        if not os.path.lexists(part):\n            break\n        if not safe(part):\n            sys.exit(\'Preservation refuses links/reparse points: \' + str(part))\n        if part.is_file():\n            if part not in tracked:\n                selected.add(part)\n            break\n        if part == path:\n            if not part.is_dir():\n                sys.exit(\'Unsupported local file type: \' + str(part))\n            selected.add(part)\nroots = [p for p in sorted(selected, key=lambda p: (len(p.parts), str(p))) if not any(a in selected for a in p.parents)]\nfor src in roots:\n    dst = backup / \'preserved-files\' / src\n    dst.parent.mkdir(parents=True, exist_ok=True)\n    if src.is_dir():\n        shutil.copytree(src, dst, symlinks=True, ignore=guard)\n    else:\n        shutil.copy2(src, dst)\n(backup / \'preserved-manifest.json\').write_text(json.dumps({\'saved\': [str(p) for p in roots], \'head\': expected_head, \'remote\': remote, \'tracked_changes_discarded\': True}, ensure_ascii=True, indent=2), encoding=\'utf-8\')\nif git(\'rev-parse\', \'HEAD\').decode(\'ascii\').strip() != expected_head:\n    sys.exit(\'HEAD changed during preservation; stop concurrent Git operations\')\n')" >"%AIDIY_TEMP%\backup.txt" 2>&1
if errorlevel 1 goto preservation_failed
set "RESTORE_HEAD="
set /p "RESTORE_HEAD="<"%BACKUP%\remote-head.txt"
if not defined RESTORE_HEAD goto preservation_failed
set "STAGE=overwrite_guard"
"%PYTHON%" -X utf8 -c "import os,sys,subprocess;from pathlib import Path;expected=(Path(os.environ['BACKUP'])/'head.txt').read_text(encoding='ascii').strip();subprocess.check_output(['git','rev-parse','HEAD']).decode('ascii').strip()==expected or sys.exit('HEAD changed before restore; stop concurrent Git operations')" >"%AIDIY_TEMP%\backup.txt" 2>&1
if errorlevel 1 goto preservation_failed
set "STAGE=github_overwrite"
git -c submodule.recurse=false reset --hard %RESTORE_HEAD%
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" goto failed
>>"%LOG%" echo HEAD:
git rev-parse HEAD >>"%LOG%"
if errorlevel 1 goto failed

rem Copy this launcher only when absent. Never overwrite an existing file.
set "STAGE=launcher_copy"
if exist "%TARGET%\_auto.bat" goto setup
copy /b /v /-y "%~f0" "%TARGET%\_auto.bat" <nul >nul
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" goto failed

:setup
echo(
echo ============================================================
echo セットアップ
echo ============================================================
echo(
set "STAGE=setup"
>>"%LOG%" echo SETUP %DATE% %TIME%
echo [INFO] セットアップ開始。通常の確認入力に回答してください。
"%PYTHON%" -X utf8 -u _setup.py
set "RC=%ERRORLEVEL%"
rem Child tools may change the shared console code page. Restore before Japanese.
chcp 932 >nul
if errorlevel 1 (echo [NG] Cannot restore code page 932. TEMP kept. & exit /b 2)
>>"%LOG%" echo SETUP_EXIT=%RC%
if not "%RC%"=="0" goto failed
echo(
echo ============================================================
echo アプリケーションの起動
echo ============================================================
echo(
set "STAGE=start"
>>"%LOG%" echo START_APP %DATE% %TIME%
"%PYTHON%" -X utf8 -u _start.py
set "RC=%ERRORLEVEL%"
rem Child tools may change the shared console code page. Restore before Japanese.
chcp 932 >nul
if errorlevel 1 (echo [NG] Cannot restore code page 932. TEMP kept. & exit /b 2)
>>"%LOG%" echo START_EXIT=%RC%
if not "%RC%"=="0" goto failed
>>"%LOG%" echo SUCCESS %DATE% %TIME%
goto finish

:python_version_warning
echo [WARN] Pythonは3.13未満です。版の判定では止めず、このPythonでsetup・起動へ進みます。
echo [WARN] setupや依存ライブラリが旧版に対応しない場合は、その実際のエラーで停止します。
>>"%LOG%" echo WARNING Python version below 3.13; continuing
exit /b 0

:convert_git_path_text
rem Convert Git UTF-8 path data before FOR/SET reads under CP932. No replacement.
"%PYTHON%" -X utf8 -c "import os,sys;from pathlib import Path;p=Path(os.environ['AIDIY_TEXT_FILE']);text=p.read_bytes().decode('utf-8');encoded=text.encode('cp932');encoded.decode('cp932')!=text and sys.exit(3);p.write_bytes(encoded)" >nul 2>&1
if not errorlevel 1 exit /b 0
echo [NG] Gitのパス一覧をCP932へ変換できません。文字・読書き権限を確認してください。
>>"%LOG%" echo PATH_ENCODING_FAILED
exit /b 3

:report_optional_check
echo [INFO] %STAGE% 終了コード=%CHECK_RC%
>>"%LOG%" echo CHECK %STAGE% exit=%CHECK_RC%
type "%AIDIY_TEMP%\probe.txt"
type "%AIDIY_TEMP%\probe.txt" >>"%LOG%"
if not "%CHECK_RC%"=="0" echo [WARN] ツールを確認できません。通常setupの確認・選択へ進みます。
exit /b 0

:prerequisite_failed
echo [NG] 必須ツールを実行できません: %STAGE%
>>"%LOG%" echo REQUIRED_CHECK_FAILED %STAGE%
type "%AIDIY_TEMP%\probe.txt"
type "%AIDIY_TEMP%\probe.txt" >>"%LOG%"
set "RC=2"
goto failed

:validate_repository
set "STAGE=repository_directory"
cd /d "%TARGET%" >"%AIDIY_TEMP%\validation.txt" 2>&1
if errorlevel 1 goto repository_failed
set "STAGE=repository_files"
echo [INFO] Git管理ファイル
>>"%LOG%" echo CHECK %STAGE%
"%PYTHON%" -X utf8 -c "import os,sys;from pathlib import Path;sys.stderr.reconfigure(encoding='cp932',errors='backslashreplace');Path('.git').exists() or sys.exit('Required .git is missing.')" >"%AIDIY_TEMP%\validation.txt" 2>&1
if errorlevel 1 goto repository_failed
set "STAGE=repository_root"
echo [INFO] Gitルートフォルダ
>>"%LOG%" echo CHECK %STAGE%
git rev-parse --show-prefix >"%AIDIY_TEMP%\prefix.txt" 2>"%AIDIY_TEMP%\validation.txt"
if errorlevel 1 goto repository_failed
"%PYTHON%" -X utf8 -c "import os,sys;from pathlib import Path;sys.stderr.reconfigure(encoding='cp932',errors='backslashreplace');value=(Path(os.environ['AIDIY_TEMP'])/'prefix.txt').read_bytes();value in (b'',b'\n',b'\r\n') or sys.exit('Selected directory is not the Git worktree root.')" >"%AIDIY_TEMP%\validation.txt" 2>&1
if errorlevel 1 goto repository_failed
set "STAGE=repository_origin"
echo [INFO] originの接続先
>>"%LOG%" echo CHECK %STAGE%
git remote get-url --all origin >"%AIDIY_TEMP%\origin.txt" 2>"%AIDIY_TEMP%\validation.txt"
if errorlevel 1 goto repository_failed
"%PYTHON%" -X utf8 -c "import os,sys;from pathlib import Path;sys.stderr.reconfigure(encoding='cp932',errors='backslashreplace');urls=(Path(os.environ['AIDIY_TEMP'])/'origin.txt').read_text(encoding='utf-8').splitlines();allowed={'https://github.com/monjyu1101/aidiy2027.git','https://github.com/monjyu1101/aidiy2027','git@github.com:monjyu1101/aidiy2027.git','git@github.com:monjyu1101/aidiy2027'};urls and all(url.lower() in allowed for url in urls) or sys.exit('Origin must be Monjyu1101/AiDiy2027 on GitHub (HTTPS or git@github.com). URL values omitted for privacy.')" >"%AIDIY_TEMP%\validation.txt" 2>&1
if errorlevel 1 goto repository_failed
set "STAGE=repository_branch"
echo [INFO] mainブランチ
>>"%LOG%" echo CHECK %STAGE%
git branch --show-current >"%AIDIY_TEMP%\branch.txt" 2>"%AIDIY_TEMP%\validation.txt"
if errorlevel 1 goto repository_failed
"%PYTHON%" -X utf8 -c "import os,sys;from pathlib import Path;sys.stderr.reconfigure(encoding='cp932',errors='backslashreplace');lines=(Path(os.environ['AIDIY_TEMP'])/'branch.txt').read_text(encoding='utf-8').splitlines();lines==['main'] or sys.exit('Current branch must be main; detached HEAD is not supported.')" >"%AIDIY_TEMP%\validation.txt" 2>&1
if errorlevel 1 goto repository_failed
set "STAGE=repository_gitdir"
echo [INFO] Git管理フォルダ
>>"%LOG%" echo CHECK %STAGE%
git rev-parse --absolute-git-dir >"%AIDIY_TEMP%\gitdir.txt" 2>"%AIDIY_TEMP%\validation.txt"
if errorlevel 1 goto repository_failed
"%PYTHON%" -X utf8 -c "import os,sys;from pathlib import Path;sys.stderr.reconfigure(encoding='cp932',errors='backslashreplace');lines=(Path(os.environ['AIDIY_TEMP'])/'gitdir.txt').read_text(encoding='utf-8').splitlines();len(lines)==1 and Path(lines[0]).is_dir() or sys.exit('Git directory is missing or its path output is invalid.')" >"%AIDIY_TEMP%\validation.txt" 2>&1
if errorlevel 1 goto repository_failed
set "AIDIY_TEXT_FILE=%AIDIY_TEMP%\gitdir.txt"
call :convert_git_path_text
if errorlevel 1 exit /b 3
set "AIDIY_GIT_DIR="
for /f "usebackq delims=" %%G in ("%AIDIY_TEMP%\gitdir.txt") do set "AIDIY_GIT_DIR=%%G"
if not defined AIDIY_GIT_DIR goto repository_failed
set "STAGE=repository_operation"
echo [INFO] 未完了のGit操作
>>"%LOG%" echo CHECK %STAGE%
"%PYTHON%" -X utf8 -c "import os,sys;from pathlib import Path;sys.stderr.reconfigure(encoding='cp932',errors='backslashreplace');pending=[name for name in ('CHERRY_PICK_HEAD','REVERT_HEAD','rebase-merge','rebase-apply','sequencer') if (Path(os.environ['AIDIY_GIT_DIR'])/name).exists()];not pending or sys.exit('Unfinished Git operation: '+', '.join(pending))" >"%AIDIY_TEMP%\validation.txt" 2>&1
if errorlevel 1 goto repository_failed
exit /b 0

:repository_failed
set "VALIDATION_RC=%ERRORLEVEL%"
echo [NG] リポジトリの安全確認に失敗しました: %STAGE%
echo 接続先・ブランチ・Gitの権限・未完了操作を確認してください。自動修正はしません。
>>"%LOG%" echo REPOSITORY_CHECK_FAILED %STAGE% command_exit=%VALIDATION_RC%
type "%AIDIY_TEMP%\validation.txt"
type "%AIDIY_TEMP%\validation.txt" >>"%LOG%"
exit /b 3

:control_failed
call :repository_failed
goto failed

:prepare_overwrite
mkdir "%BACKUP%" >nul 2>&1
if errorlevel 1 exit /b 1
git rev-parse HEAD >"%BACKUP%\head.txt"
if errorlevel 1 exit /b 1
exit /b 0

:preservation_failed
set "RC=1"
echo [NG] ローカルファイルを安全に保全できません。強制書き換えせず停止します。
type "%AIDIY_TEMP%\backup.txt"
type "%AIDIY_TEMP%\backup.txt" >>"%LOG%"
goto failed

:cancelled
set "RC=0"
>>"%LOG%" echo CANCELLED
goto finish

:failed
if "%RC%"=="0" set "RC=1"
>>"%LOG%" echo FAILED stage=%STAGE% exit=%RC% %DATE% %TIME%
echo [NG] "%STAGE%" で停止しました。終了コード=%RC%
echo Git・Pythonの実行環境が必要です。版の不足だけでは停止しません。
echo 上記の処理名とエラー表示、origin/main、競合、権限を確認してください。
echo 保全先・途中cloneは保持しています。書き換え開始後の失敗では一部だけ更新されている場合があります。
echo [INFO] 実行記録: "%LOG%"
if defined STAGING echo 途中clone: "%STAGING%"

:finish
rem Delete only known scratch files. Never delete the currently executing batch.
for %%F in (python.txt probe.txt prefix.txt origin.txt branch.txt gitdir.txt unmerged.txt untracked.txt backup.txt validation.txt) do if exist "%AIDIY_TEMP%\%%F" del /q "%AIDIY_TEMP%\%%F" >nul 2>&1
>>"%LOG%" echo TEMP_COPY_RETAINED="%~f0"
rem Restore the caller directory before returning. Do not modify that directory.
cd /d "%AIDIY_CWD%" >nul 2>&1
if not errorlevel 1 goto exit_ready
echo [WARN] 元の実行フォルダへ復帰できませんでした。
>>"%LOG%" echo CWD_RESTORE_FAILED
if "%RC%"=="0" set "RC=1"
:exit_ready
rem Keep this small TEMP batch so CMD can finish reading it without path errors.
rem No deferred deletion process, wildcard cleanup, ENDLOCAL or self-delete.
if not "%RC%"=="0" pause
exit /b %RC%

:log_error
echo [NG] 実行ログを作成できません。TEMPのファイルは保持しました。
pause
exit /b 2
:temp_error
echo [NG] TEMPの自己コピーまたは内部起動情報を確認できません。
echo 引数なしで実行し、TEMPの空き容量・権限を確認してください。ファイルは保持しています。
pause
exit /b 2
