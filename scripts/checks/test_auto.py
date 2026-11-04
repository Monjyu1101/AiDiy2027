"""単一batの静的構造・対象選択モデル・実Git契約試験。Windows CMDの実行試験ではない。"""
from pathlib import Path
import re
import shlex
import subprocess
import sys
import os
import tempfile
import unittest
import json

ROOT = Path(__file__).resolve().parents[2]
BAT = ROOT / "_auto.bat"
TEXT = BAT.read_bytes().decode("cp932").replace("\r\n", "\n")


class BatchStructureTests(unittest.TestCase):
    def test_cp932_crlf_no_bom_and_japanese_ui(self):
        data = BAT.read_bytes()
        self.assertEqual(data.decode('cp932').encode('cp932'), data)
        self.assertIn('aidiyセットアップと実行しますか？ [y]/n:', TEXT)
        self.assertIn('chcp 932 >nul', TEXT)
        self.assertNotIn('chcp 65001', TEXT)
        self.assertFalse(data.startswith(b"\xef\xbb\xbf"))
        self.assertNotIn(b"\n", data.replace(b"\r\n", b""))
        self.assertNotIn(b"\x1a", data)
        self.assertNotIn(b"\x00", data)

    def test_nonascii_source_is_only_ui_not_control_flow(self):
        for line in TEXT.splitlines():
            if not line.isascii():
                self.assertRegex(line, r'^(echo |set /p |if .+ echo )')

    def test_labels_and_calls_resolve(self):
        labels = re.findall(r"^:([a-z_]+)$", TEXT, re.M)
        self.assertEqual(len(labels), len(set(labels)))
        for label in re.findall(r"\bgoto\s+([a-z_]+)", TEXT, re.I):
            self.assertIn(label.lower(), labels)
        for label in re.findall(r"\bcall\s+:([a-z_]+)", TEXT, re.I):
            self.assertIn(label.lower(), labels)

    def test_single_file_no_companion_or_embedded_program(self):
        self.assertNotIn("_auto.py", TEXT)
        self.assertNotIn("runpy", TEXT)
        self.assertFalse((ROOT / "_auto.py").exists())
        self.assertFalse((ROOT / "_automatic.bat").exists())
        self.assertNotIn('_automatic.bat', TEXT)

    def test_original_locations_saved_before_control_transfer(self):
        transfer = TEXT.index('"%AIDIY_TEMP%\\_auto.bat" --_aidiy_temp')
        self.assertLess(TEXT.index('set "AIDIY_CWD=%CD%"'), transfer)
        self.assertLess(TEXT.index('set "AIDIY_SOURCE_DIR=%~dp0."'), transfer)
        self.assertNotRegex(TEXT, r"(?im)^\s*call\s+[^:]")
        self.assertIn("DisableDelayedExpansion", TEXT)

    def test_temp_directory_is_unique_and_atomic(self):
        self.assertIn('%RANDOM%-%RANDOM%-%RANDOM%', TEXT)
        self.assertIn('mkdir "%AIDIY_TEMP%"', TEXT)
        self.assertIn('if errorlevel 1 goto make_temp', TEXT)
        self.assertIn('if /i not "%~dp0"=="%AIDIY_TEMP%\\" goto temp_error', TEXT)

    def test_launcher_has_no_run_lock_or_lock_cleanup(self):
        for token in ('run.lock', 'LOCK_OWNED', 'repository_lock', ':locked', ':clean_temp'):
            self.assertNotIn(token.lower(), TEXT.lower())
        self.assertIn('二重実行は防止しません', TEXT)
        self.assertLess(TEXT.index('二重実行は防止しません'), TEXT.index('set /p "RUN_AIDIY='))
        control = TEXT.split(':control_ready\n', 1)[1].split('call :prepare_overwrite', 1)[0]
        self.assertEqual([line for line in control.splitlines() if not line.startswith(('echo ', 'echo('))], [
            'set "STAGE=overwrite_prepare"', 'set "BACKUP=%CONTROL%\\%AIDIY_RUN%"'])
        self.assertNotRegex(TEXT.lower(), r'(?m)^.*\b(?:del|rd|rmdir)\b.*%control%')

    def test_backup_output_is_in_checkout_temp_not_git_metadata(self):
        self.assertIn('set "CONTROL=%TARGET%\\temp\\_auto"', TEXT)
        self.assertNotIn('set "CONTROL=%AIDIY_GIT_DIR%', TEXT)
        self.assertIn('\ntemp/\n', (ROOT / '.gitignore').read_text())
        guard = TEXT.index('Launcher temp path must be a normal directory')
        self.assertLess(guard, TEXT.index('mkdir "%CONTROL%"'))
        self.assertLess(guard, TEXT.index('call :prepare_overwrite'))

    def test_log_path_is_not_displayed_before_execution_confirmation(self):
        before = TEXT.split('if not errorlevel 1 goto cancelled', 1)[0]
        self.assertNotRegex(before, r'(?m)^echo .*%LOG%')
        self.assertIn('if not errorlevel 1 goto cancelled\necho [INFO] 実行記録: "%LOG%"', TEXT)
        cancelled_exit = TEXT[TEXT.index('\n:cancelled\n'):TEXT.index('\n:failed\n')]
        finish = TEXT[TEXT.index('\n:finish\n'):]
        self.assertNotRegex(cancelled_exit + finish, r'(?m)^echo .*%LOG%')

    def test_section_headings_follow_actual_branch_entry(self):
        border = 'echo ' + '=' * 60
        headings = {
            '環境チェック': ('echo [INFO] 実行記録: "%LOG%"', 'set "STAGE=prerequisite_git"'),
            'リポジトリの新規取得': ('if exist "%TARGET%" goto existing', 'set "STAGE=clone"'),
            'リポジトリの確認': (':existing', 'call :validate_repository'),
            '書き換え準備': (':control_ready', 'call :prepare_overwrite'),
            'リポジトリの更新(github優先)': ('echo [INFO] 保全先: "%BACKUP%"', 'set "STAGE=fetch"'),
            'セットアップ': (':setup', 'set "STAGE=setup"'),
            'アプリケーションの起動': ('echo SETUP_EXIT=%RC%', 'set "STAGE=start"'),
        }
        for title, (before, after) in headings.items():
            with self.subTest(title=title):
                heading = f'echo(\n{border}\necho {title}\n{border}\necho('
                self.assertEqual(TEXT.count(heading), 1)
                self.assertLess(TEXT.index(before), TEXT.index(heading))
                self.assertLess(TEXT.index(heading), TEXT.index(after))
        start_section = TEXT[TEXT.index('echo SETUP_EXIT=%RC%'):TEXT.index('echo アプリケーションの起動')]
        self.assertIn('if not "%RC%"=="0" goto failed', start_section)

    def test_only_explicit_remote_reset_no_clean_stash_or_mcp_deletion(self):
        self.assertNotRegex(TEXT.lower(), r"git\s+(clean|stash|push)\b")
        self.assertIn('git -c submodule.recurse=false reset --hard %RESTORE_HEAD%', TEXT)
        self.assertNotIn('git merge --ff-only', TEXT)
        self.assertNotIn('mcp.json', TEXT)
        self.assertNotIn('chatLanguageModels.json', TEXT)
        self.assertNotRegex(TEXT.lower(), r"\b(rd|rmdir|del)\s+/s\b")

    def test_force_restore_is_gated_by_backup_fetch_and_preflight_success(self):
        main = TEXT[TEXT.index('\n:existing\n'):TEXT.index('\n:setup\n')]
        fetch = next(line for line in main.splitlines() if line.startswith('git fetch '))
        self.assertIn(fetch + '\nset "RC=%ERRORLEVEL%"\nif not "%RC%"=="0" goto failed', main)
        self.assertLess(main.index('call :prepare_overwrite'), main.index(fetch))
        self.assertLess(main.index(fetch), main.index('git -c submodule.recurse=false reset --hard %RESTORE_HEAD%'))
        self.assertNotIn('history_bundle_backup', TEXT)
        self.assertIn('# github_overwrite_preflight', TEXT)
        preflight = next(line for line in main.splitlines() if '# github_overwrite_preflight' in line)
        self.assertLess(main.index(fetch), main.index(preflight))
        self.assertIn(preflight + '\nif errorlevel 1 goto preservation_failed', main)
        self.assertLess(main.index(preflight), main.index('git -c submodule.recurse=false reset --hard'))
        self.assertIn('set "RESTORE_HEAD="\nset /p "RESTORE_HEAD="<"%BACKUP%\\remote-head.txt"', main)
        self.assertIn('if not defined RESTORE_HEAD goto preservation_failed', main)
        # CMDには8191文字のコマンド上限があるため、展開パスの余白も残す。
        self.assertLess(len(preflight), 6000)
        self.assertNotIn('merge-base --is-ancestor', main)

    def test_git_redirect_environment_is_rejected_not_created(self):
        for name in ('GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY'):
            self.assertIn(f'if defined {name} goto failed', TEXT)
            self.assertNotIn(f'set "{name}=', TEXT)

    def test_origin_allowlist_never_expanded_as_command_text(self):
        self.assertNotIn('%ORIGIN_URL%', TEXT)
        validator = TEXT[TEXT.index('\n:validate_repository\n'):TEXT.index('\n:prepare_overwrite\n')]
        self.assertNotIn('findstr', validator.lower())
        self.assertNotIn('%%~zF', validator)
        self.assertIn('all(url.lower() in allowed for url in urls)', validator)
        self.assertIn('git remote get-url --all origin', TEXT)

    def test_repository_checks_report_each_guard_without_disclosing_origin(self):
        validator = TEXT[TEXT.index('\n:validate_repository\n'):TEXT.index('\n:prepare_overwrite\n')]
        for name in ('directory', 'files', 'root', 'origin', 'branch', 'gitdir', 'operation'):
            self.assertIn(f'set "STAGE=repository_{name}"', validator)
        for line in validator.splitlines():
            if line.startswith('git '):
                self.assertIn('2>"%AIDIY_TEMP%\\validation.txt"', line)
        failed = validator[validator.index('\n:repository_failed\n'):]
        self.assertIn('REPOSITORY_CHECK_FAILED %STAGE%', failed)
        self.assertIn('type "%AIDIY_TEMP%\\validation.txt" >>"%LOG%"', failed)
        self.assertIn('exit /b 3', failed)
        self.assertNotIn('type "%AIDIY_TEMP%\\origin.txt"', TEXT)
        self.assertIn('if exist "%CONTROL%\\" goto control_ready', TEXT)
        main = TEXT[TEXT.index('\n:existing\n'):TEXT.index('\n:setup\n')]
        self.assertIn('call :validate_repository\nif errorlevel 1 goto failed', main)
        self.assertLess(main.index('call :validate_repository'), main.index('call :prepare_overwrite'))
        self.assertLess(main.index('call :validate_repository'), main.index('git fetch '))

    def test_git_failure_is_not_overwritten_by_following_python_probe(self):
        validator = TEXT[TEXT.index('\n:validate_repository\n'):TEXT.index('\n:repository_failed\n')]
        lines = validator.splitlines()
        for i, line in enumerate(lines):
            if line.startswith('git '):
                self.assertEqual(lines[i + 1], 'if errorlevel 1 goto repository_failed')
        self.assertIn(':repository_failed\nset "VALIDATION_RC=%ERRORLEVEL%"', TEXT)

    def test_clone_publish_uses_rename_not_move_into_existing_target(self):
        self.assertIn('ren "%STAGING%" "AiDiy2027"', TEXT)
        self.assertNotRegex(TEXT, r"(?im)^move\b")
        self.assertNotIn('rd "%STAGING%"', TEXT)

    def test_only_collision_preservation_no_full_backup(self):
        self.assertLess(TEXT.index('call :prepare_overwrite'), TEXT.index('git fetch '))
        self.assertNotIn('robocopy', TEXT.lower())
        for token in ('history.bundle', 'index-blobs', 'working-tree.patch', 'staged.patch', 'call :backup_file'):
            self.assertNotIn(token, TEXT)
        self.assertIn('preserved-files', TEXT)

    def test_interactive_setup_start_and_error_propagation(self):
        block = TEXT[TEXT.index('\n:setup\n'):TEXT.index('\n:validate_repository\n')]
        for script in ('_setup.py', '_start.py'):
            self.assertIn(f'"%PYTHON%" -X utf8 -u {script}\nset "RC=%ERRORLEVEL%"', block)
        self.assertLess(block.index('_setup.py'), block.index('_start.py'))
        self.assertIn('if not "%RC%"=="0" goto failed', block)
        self.assertNotRegex(block, r"(?m)^.*(?:_setup|_start)\.py.*[<>|]")
        self.assertNotIn('再セットアップ', TEXT)
        self.assertNotIn('setup-state', TEXT)

    def test_setup_start_restore_codepage_after_saving_exit_status(self):
        for script in ('_setup.py', '_start.py'):
            start = TEXT.index(f'"%PYTHON%" -X utf8 -u {script}\n')
            lines = TEXT[start:].splitlines()
            self.assertEqual(lines[1], 'set "RC=%ERRORLEVEL%"')
            self.assertEqual(lines[3], 'chcp 932 >nul')
            self.assertTrue(lines[4].startswith('if errorlevel 1 '))
            self.assertIn('exit /b 2', lines[4])
            self.assertTrue(all(line.isascii() for line in lines[:5]))

    def test_cleanup_does_not_remove_unknown_files_or_original(self):
        cleanup = TEXT[TEXT.index(':finish\n'):TEXT.index(':log_error\n')]
        self.assertNotIn('/s', cleanup.lower())
        self.assertNotIn('%AIDIY_SOURCE%', cleanup)
        self.assertIn('exit /b %RC%', cleanup)

    def test_cleanup_keeps_executing_batch_and_restores_caller_before_pause(self):
        cleanup = TEXT[TEXT.index('\n:finish\n'):TEXT.index('\n:log_error\n')]
        self.assertNotIn('del /q "%~f0"', cleanup)
        self.assertNotIn('rd "%AIDIY_TEMP%"', cleanup)
        self.assertIn('TEMP_COPY_RETAINED=', cleanup)
        self.assertIn('do if exist "%AIDIY_TEMP%\\%%F" del', cleanup)
        self.assertLess(cleanup.index('cd /d "%AIDIY_CWD%"'), cleanup.index(' pause'))
        self.assertTrue(cleanup.rstrip().endswith('pause\nexit /b %RC%'))
        self.assertNotRegex(cleanup, r'(?im)^endlocal\b')

    def test_required_checks_identify_failure_and_preserve_diagnostics(self):
        for name in ('git', 'python'):
            self.assertIn(f'set "STAGE=prerequisite_{name}"', TEXT)
        block = TEXT[TEXT.index('\n:prerequisite_failed\n'):TEXT.index('\n:validate_repository\n')]
        self.assertIn('REQUIRED_CHECK_FAILED %STAGE%', block)
        self.assertIn('type "%AIDIY_TEMP%\\probe.txt"', block)
        self.assertIn('set "RC=2"', block)
        self.assertIn('goto failed', block)

    def test_optional_tools_cannot_block_initial_setup(self):
        block = TEXT[TEXT.index('set "STAGE=check_node"'):TEXT.index('set "STAGE=git_environment"')]
        for name in ('node', 'npm', 'uv'):
            self.assertIn(f'set "STAGE=check_{name}"', block)
        self.assertEqual(block.count('set "CHECK_RC=%ERRORLEVEL%"'), 3)
        self.assertEqual(block.count('call :report_optional_check'), 3)
        self.assertNotIn('goto failed', block)
        self.assertNotIn('goto prerequisite_failed', block)
        report = TEXT[TEXT.index('\n:report_optional_check\n'):TEXT.index('\n:prerequisite_failed\n')]
        self.assertIn('exit /b 0', report)

    def test_npm_cmd_is_isolated_in_child_cmd_not_chained(self):
        self.assertIn('"%ComSpec%" /d /c npm --version', TEXT)
        self.assertNotRegex(TEXT, r'(?m)^npm(?:\.cmd)?\s')

    def test_python_path_encoding_matches_cp932_and_does_not_enforce_version(self):
        probes = [line for line in TEXT.splitlines() if 'sys.stdout.buffer.write' in line]
        self.assertEqual(len(probes), 2)
        for line in probes:
            self.assertIn('-X utf8 -c', line)
            self.assertIn("sys.executable.encode('cp932')", line)
            self.assertNotIn('sys.version_info', line)
            self.assertIn('2>"%AIDIY_TEMP%\\probe.txt"', line)
        self.assertIn('chcp 932 >nul\nif errorlevel 1 goto temp_error', TEXT)

    def test_actual_python_probe_returns_zero_and_cp932_japanese_path(self):
        line = next(line for line in TEXT.splitlines() if 'sys.stdout.buffer.write' in line)
        code = re.search(r'-c "([^"]+)"', line).group(1)
        compile(code, '<batch Python probe>', 'exec')
        with tempfile.TemporaryDirectory(prefix='python probe 日本語 ') as folder:
            executable = Path(folder) / 'python'
            executable.symlink_to(sys.executable)
            result = subprocess.run([str(executable), '-X', 'utf8', '-c', code],
                                    capture_output=True, env={**os.environ, 'PYTHONIOENCODING': 'ascii'})
            self.assertEqual(result.returncode, 0)
            self.assertEqual(Path(result.stdout.decode('cp932').strip()), executable)
            self.assertTrue(result.stderr.decode('ascii').startswith('Python '))

    def test_python_310_version_check_routes_only_to_warning(self):
        line = next(line for line in TEXT.splitlines() if 'sys.version_info >=' in line)
        code = re.search(r'-c "([^"]+)"', line).group(1)
        result = subprocess.run([sys.executable, '-c', 'import sys;sys.version_info=(3,10,11);' + code], capture_output=True)
        self.assertEqual(result.returncode, 1)
        self.assertIn(line + '\nif errorlevel 1 call :python_version_warning', TEXT)
        warning = TEXT[TEXT.index('\n:python_version_warning\n'):TEXT.index('\n:convert_git_path_text\n')]
        self.assertIn('exit /b 0', warning)
        self.assertNotIn('goto failed', warning)

    def test_git_path_lists_are_converted_before_cmd_reads_them(self):
        for filename in ('gitdir.txt',):
            marker = f'set "AIDIY_TEXT_FILE=%AIDIY_TEMP%\\{filename}"\ncall :convert_git_path_text\nif errorlevel 1 exit /b '
            self.assertIn(marker, TEXT)

    def test_git_path_conversion_preserves_japanese_and_rejects_loss(self):
        line = next(line for line in TEXT.splitlines() if "os.environ['AIDIY_TEXT_FILE']" in line)
        code = re.search(r'-c "([^"]+)"', line).group(1)
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'paths.txt'
            for text, expected in [('C:/利用者/日本語 path!100%/file.txt\n', 0), ('emoji😀.txt\n', 1), ('wave〜.txt\n', 3)]:
                original = text.encode('utf-8')
                path.write_bytes(original)
                result = subprocess.run([sys.executable, '-X', 'utf8', '-c', code], capture_output=True,
                                        env={**os.environ, 'AIDIY_TEXT_FILE': str(path)})
                self.assertEqual(result.returncode, expected)
                if expected == 0:
                    self.assertEqual(path.read_bytes().decode('cp932'), text)
                else:
                    self.assertEqual(path.read_bytes(), original)


class RepositoryValidationTests(unittest.TestCase):
    """実batの短いPython検証を実行。CMD/FINDSTRの実行結果を模倣しない。"""
    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix='repo validation 日本語 & % ! ')
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.gitdir = self.root / 'Git 管理'
        self.gitdir.mkdir()

    def run_guard(self, name):
        block = TEXT.split(f'set "STAGE=repository_{name}"', 1)[1]
        line = next(line for line in block.splitlines() if line.startswith('"%PYTHON%"'))
        code = re.search(r'-c "([^"]+)"', line).group(1)
        return subprocess.run([sys.executable, '-X', 'utf8', '-c', code],
                              cwd=self.root, capture_output=True,
                              env={**os.environ, 'AIDIY_TEMP': str(self.root),
                                   'AIDIY_GIT_DIR': str(self.gitdir)})

    def test_root_accepts_lf_crlf_and_empty_only(self):
        for raw, valid in [(b'\n', True), (b'\r\n', True), (b'', True),
                           (b'a\n', False), (b'a\r\n', False), (b' \n', False)]:
            with self.subTest(raw=raw):
                (self.root / 'prefix.txt').write_bytes(raw)
                self.assertEqual(self.run_guard('root').returncode == 0, valid)

    def test_origin_allowlist_accepts_git_lf_and_crlf(self):
        allowed = ['https://github.com/Monjyu1101/AiDiy2027.git',
                   'https://github.com/Monjyu1101/AiDiy2027',
                   'git@github.com:Monjyu1101/AiDiy2027.git',
                   'git@github.com:Monjyu1101/AiDiy2027']
        for newline in ('\n', '\r\n'):
            for url in allowed + [allowed[0].upper(), newline.join(allowed)]:
                with self.subTest(newline=newline, url=url):
                    (self.root / 'origin.txt').write_bytes((url + newline).encode())
                    self.assertEqual(self.run_guard('origin').returncode, 0)

    def test_origin_rejects_empty_other_mixed_and_command_text_privately(self):
        valid = 'https://github.com/Monjyu1101/AiDiy2027.git'
        secret = 'fixture-secret-token'
        for value in ['', '\n', valid + '/wrong\n', valid + '\nhttps://other.invalid/repo\n',
                      f'https://{secret}@github.com/Monjyu1101/AiDiy2027.git\n',
                      valid + '& echo injected\n', ' ' + valid + '\n']:
            with self.subTest(value=value):
                (self.root / 'origin.txt').write_bytes(value.encode())
                result = self.run_guard('origin')
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(b'Origin must be', result.stderr)
                self.assertNotIn(secret.encode(), result.stderr + result.stdout)
                self.assertNotIn(b'injected', result.stderr + result.stdout)

    def test_branch_accepts_only_main_with_normal_line_endings(self):
        for raw, valid in [(b'main\n', True), (b'main\r\n', True), (b'main', True),
                           (b'', False), (b'develop\n', False), (b'Main\n', False),
                           (b'main\nother\n', False), (b'main \n', False)]:
            with self.subTest(raw=raw):
                (self.root / 'branch.txt').write_bytes(raw)
                self.assertEqual(self.run_guard('branch').returncode == 0, valid)

    def test_files_guard_allows_missing_launchers_to_be_restored(self):
        self.assertNotEqual(self.run_guard('files').returncode, 0)
        (self.root / '.git').write_text('gitdir: fixture')
        self.assertEqual(self.run_guard('files').returncode, 0)
        (self.root / '_start.py').mkdir()
        self.assertEqual(self.run_guard('files').returncode, 0)

    def test_gitdir_requires_one_existing_path_with_lf_or_crlf(self):
        for suffix in ('\n', '\r\n'):
            (self.root / 'gitdir.txt').write_bytes((str(self.gitdir) + suffix).encode())
            self.assertEqual(self.run_guard('gitdir').returncode, 0)
        for value in ['', str(self.root / 'absent') + '\n', str(self.gitdir) + '\nextra\n']:
            (self.root / 'gitdir.txt').write_bytes(value.encode())
            self.assertNotEqual(self.run_guard('gitdir').returncode, 0)

    def test_merge_conflict_is_allowed_but_other_incomplete_operations_stop(self):
        self.assertEqual(self.run_guard('operation').returncode, 0)
        (self.gitdir / 'MERGE_HEAD').write_text('fixture')
        self.assertEqual(self.run_guard('operation').returncode, 0)
        for name in ('CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer'):
            marker = self.gitdir / name
            marker.write_text('fixture')
            result = self.run_guard('operation')
            self.assertNotEqual(result.returncode, 0)
            self.assertIn(name.encode(), result.stderr)
            marker.unlink()

    def test_all_inline_validators_support_python_310_syntax(self):
        import ast
        for line in TEXT.splitlines():
            if ' -c "' in line:
                code = re.search(r'-c "([^"]+)"', line).group(1)
                ast.parse(code, feature_version=(3, 10))


class RoutingModelTests(unittest.TestCase):
    """実batの3本の選択文を読み、ディレクトリ有無だけmockする。"""
    def route(self, cwd_has=False, source_has=False):
        lines = [line for line in TEXT.splitlines() if 'set "TARGET=' in line]
        env = {'USERPROFILE': '利用者 home', 'AIDIY_CWD': '起動 cwd', 'AIDIY_SOURCE_DIR': 'script 配置'}
        exists = {'%AIDIY_CWD%': cwd_has, '%AIDIY_SOURCE_DIR%': source_has}
        target = None
        for line in lines:
            if line.startswith('if exist'):
                condition = re.search(r'"(%\w+%)\\backend_server\\"', line).group(1)
                if not exists[condition]:
                    continue
            value = re.search(r'set "TARGET=([^"]+)"', line).group(1)
            target = re.sub(r'%(\w+)%', lambda m: env[m.group(1)], value)
        return target

    def test_desktop_copy_uses_userprofile(self):
        self.assertEqual(self.route(), '利用者 home\\AiDiy2027')

    def test_shortcut_empty_working_directory_uses_source_repo(self):
        self.assertEqual(self.route(source_has=True), 'script 配置')

    def test_explicit_cwd_checkout_wins(self):
        self.assertEqual(self.route(cwd_has=True, source_has=True), '起動 cwd')

    def test_explicit_cwd_without_source_checkout(self):
        self.assertEqual(self.route(cwd_has=True), '起動 cwd')


class BackupDestinationTests(unittest.TestCase):
    """実bat内の退避先ガードを一時フォルダだけで実行する。"""
    def test_renamed_checkout_uses_its_own_temp_not_aidiy2027(self):
        control_line = next(line for line in TEXT.splitlines() if line.startswith('set "CONTROL='))
        backup_line = next(line for line in TEXT.splitlines() if line.startswith('set "BACKUP='))
        guard_line = next(line for line in TEXT.splitlines() if 'Launcher temp path must be' in line)
        code = re.search(r'-c "([^"]+)"', guard_line).group(1)
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / '変更した Xxxxx 作業'
            target.mkdir()
            env = {'TARGET': str(target), 'AIDIY_RUN': 'fixture-run'}
            for line in (control_line, backup_line):
                name, value = re.fullmatch(r'set "(\w+)=(.*)"', line).groups()
                env[name] = re.sub(r'%(\w+)%', lambda m: env[m.group(1)], value)
            result = subprocess.run([sys.executable, '-c', code], cwd=target, capture_output=True)
            self.assertEqual(result.returncode, 0)
            backup = Path(env['BACKUP'].replace('\\', os.sep))
            self.assertEqual(backup, target / 'temp/_auto/fixture-run')
            backup.mkdir(parents=True)
            self.assertTrue(backup.is_dir())
            self.assertFalse((Path(folder) / 'AiDiy2027').exists())

    def test_guard_accepts_absent_or_normal_directories_and_rejects_files_links(self):
        line = next(line for line in TEXT.splitlines() if 'Launcher temp path must be' in line)
        code = re.search(r'-c "([^"]+)"', line).group(1)
        for kind in ('absent', 'normal', 'temp_file', 'control_file', 'temp_link', 'control_link', 'reparse'):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                prefix = ''
                if kind != 'absent':
                    (root / 'outside').mkdir()
                    if kind == 'temp_file':
                        (root / 'temp').write_text('keep')
                    elif kind == 'temp_link':
                        (root / 'temp').symlink_to(root / 'outside', target_is_directory=True)
                    else:
                        (root / 'temp').mkdir()
                        control = root / 'temp/_auto'
                        if kind == 'control_file':
                            control.write_text('keep')
                        elif kind == 'control_link':
                            control.symlink_to(root / 'outside', target_is_directory=True)
                        else:
                            control.mkdir()
                    if kind == 'reparse':
                        prefix = "from unittest.mock import patch;from types import SimpleNamespace;from pathlib import Path;old=Path.lstat;fake=lambda p,*a,**k:SimpleNamespace(st_mode=old(p,*a,**k).st_mode,st_file_attributes=1024);patch.object(Path,'lstat',fake).start();"
                result = subprocess.run([sys.executable, '-c', prefix + code], cwd=root, capture_output=True)
                self.assertEqual(result.returncode == 0, kind in ('absent', 'normal'))
                if kind == 'temp_file':
                    self.assertEqual((root / 'temp').read_text(), 'keep')
                if kind == 'control_file':
                    self.assertEqual((root / 'temp/_auto').read_text(), 'keep')


class ConfirmationModelTests(unittest.TestCase):
    """確認部分の実コマンドを限定モデルで実行。入力/FINDSTRのみ模擬する。"""
    def confirm(self, answer):
        block = TEXT[TEXT.index('set "RUN_AIDIY=y"'):TEXT.index('rem Only bootstrap requirements')]
        value, matched, output = None, False, []
        for line in block.splitlines():
            if not line or line.startswith('rem '):
                continue
            if line == 'set "RUN_AIDIY=y"':
                value = 'y'
            elif line == 'set /p "RUN_AIDIY=aidiyセットアップと実行しますか？ [y]/n: "':
                value = answer or value
            elif line == 'set RUN_AIDIY | findstr /i /x /c:"RUN_AIDIY=n" >nul':
                matched = ('RUN_AIDIY=' + value).lower() == 'run_aidiy=n'
            elif line == 'if not errorlevel 1 goto cancelled':
                if matched:
                    return False, output
            elif line == 'echo(':
                output.append('')
            elif line.startswith('echo '):
                output.append(line[5:])
            else:
                self.fail(f'Unsupported confirmation model command: {line}')
        return True, output

    def test_log_and_environment_title_only_on_execution(self):
        for answer in ('n', 'N', 'y', 'Y', ''):
            with self.subTest(answer=answer):
                accepted, output = self.confirm(answer)
                self.assertEqual(accepted, answer.lower() != 'n')
                self.assertEqual(any('%LOG%' in line for line in output), accepted)
                self.assertEqual('環境チェック' in output, accepted)


class ExitFlowModelTests(unittest.TestCase):
    """実batの終了部を限定モデルで追跡。CMD実行ではなく、未知の構文は失敗する。"""
    def run_exit(self, entry, rc, restore_ok=True):
        lines = TEXT[TEXT.index('\n:cancelled\n'):TEXT.index('\n:log_error\n')].splitlines()
        labels = {line[1:]: i for i, line in enumerate(lines) if line.startswith(':')}
        i, paused, cleaned, restored = labels[entry], False, False, False
        for _ in range(100):
            line = lines[i]
            i += 1
            if not line or line.startswith((':', 'rem ', 'echo ', '>>', 'if defined STAGING echo ')):
                continue
            if line == 'set "RC=0"':
                rc = 0
            elif line == 'if "%RC%"=="0" set "RC=1"':
                if rc == 0:
                    rc = 1
            elif line == 'goto finish':
                i = labels['finish']
            elif line.startswith('for %%F in ('):
                self.assertRegex(line, r'\) do if exist "%AIDIY_TEMP%\\%%F" del /q "%AIDIY_TEMP%\\%%F" >nul 2>&1$')
                self.assertNotIn('run.lock', line)
                self.assertNotIn('_auto.bat', line)
                cleaned = True
            elif line == 'cd /d "%AIDIY_CWD%" >nul 2>&1':
                restored = restore_ok
            elif line == 'if not errorlevel 1 goto exit_ready':
                if restore_ok:
                    i = labels['exit_ready']
            elif line == 'if not "%RC%"=="0" pause':
                self.assertTrue(cleaned)
                paused = rc != 0
            elif line == 'exit /b %RC%':
                return rc, paused, cleaned, restored
            else:
                self.fail(f'Unsupported exit model command: {line}')
        self.fail('Exit model did not terminate')

    def test_normal_cancel_and_failure_exits_without_lock_ownership(self):
        for entry, rc, expected in [('finish', 0, 0), ('cancelled', 7, 0),
                                    ('failed', 0, 1), ('failed', 2, 2),
                                    ('failed', 3, 3), ('failed', 17, 17)]:
            with self.subTest(entry=entry, rc=rc):
                self.assertEqual(self.run_exit(entry, rc), (expected, expected != 0, True, True))

    def test_cwd_restore_failure_does_not_hide_original_failure(self):
        for rc, expected in [(0, 1), (2, 2), (17, 17)]:
            with self.subTest(rc=rc):
                self.assertEqual(self.run_exit('finish', rc, restore_ok=False),
                                 (expected, True, True, False))


class GitContractTests(unittest.TestCase):
    """batと同じGitコマンドをローカル一時repoへ実行。外部通信/実setup/GUIなし。"""
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='AiDiy mock 日本語 ')
        self.base = Path(self.tmp.name)
        self.remote = self.base / 'remote.git'
        self.seed = self.base / 'seed'
        self.repo = self.base / '利用者 home' / 'AiDiy2027'
        self.git(self.base, 'init', '--bare', str(self.remote))
        self.git(self.base, 'init', '-b', 'main', str(self.seed))
        self.git(self.seed, 'config', 'user.name', 'Fixture')
        self.git(self.seed, 'config', 'user.email', 'fixture@example.invalid')
        (self.seed / 'local.txt').write_text('base\n')
        (self.seed / '.gitignore').write_text('_config/\n_data/\n')
        self.commit()
        self.git(self.seed, 'remote', 'add', 'origin', str(self.remote))
        self.git(self.seed, 'push', '-u', 'origin', 'main')
        self.repo.parent.mkdir()
        self.git(self.base, 'clone', '--branch', 'main', str(self.remote), str(self.repo))

    def tearDown(self):
        self.tmp.cleanup()

    def git(self, repo, *args, check=True):
        return subprocess.run(['git', '-C', str(repo), *args], capture_output=True, check=check)

    def commit(self):
        self.git(self.seed, 'add', '.')
        self.git(self.seed, 'commit', '-m', 'fixture')

    def advance(self, name='remote.txt'):
        (self.seed / name).write_text('remote\n')
        self.commit()
        self.git(self.seed, 'push', 'origin', 'main')

    def preflight(self, prefix=''):
        line = next(line for line in TEXT.splitlines() if '# github_overwrite_preflight' in line)
        code = re.search(r'-c "([^"]+)"', line).group(1)
        return subprocess.run([sys.executable, '-X', 'utf8', '-c', prefix + code],
                              cwd=self.repo, capture_output=True,
                              env={**os.environ, 'BACKUP': str(self.backup),
                                   'AIDIY_GIT_DIR': str(self.repo / '.git')})

    def update(self, preflight_prefix='', commit_after_preflight=False):
        """実batの重要コマンドをfixtureのみで実行。CMDそのものの試験ではない。"""
        self.backup = self.repo / 'temp/_auto/fixture-run'
        self.backup.mkdir(parents=True)
        (self.backup / 'head.txt').write_bytes(self.git(self.repo, 'rev-parse', 'HEAD').stdout)
        fetch = next(line for line in TEXT.splitlines() if line.startswith('git fetch '))
        result = self.git(self.repo, *shlex.split(fetch)[1:], check=False)
        if result.returncode:
            return result
        result = self.preflight(preflight_prefix)
        if result.returncode:
            return result
        if commit_after_preflight:
            self.git(self.repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
                     'commit', '--allow-empty', '-m', 'concurrent fixture change')
        guard = next(line for line in TEXT.splitlines() if 'HEAD changed before restore' in line)
        code = re.search(r'-c "([^"]+)"', guard).group(1)
        result = subprocess.run([sys.executable, '-X', 'utf8', '-c', code], cwd=self.repo,
                                capture_output=True, env={**os.environ, 'BACKUP': str(self.backup)})
        if result.returncode:
            return result
        reset = next(line for line in TEXT.splitlines() if ' reset --hard ' in line and line.startswith('git '))
        reset = reset.replace('%RESTORE_HEAD%', (self.backup / 'remote-head.txt').read_text().strip())
        return self.git(self.repo, *shlex.split(reset)[1:], check=False)

    def test_no_update_is_success(self):
        self.assertEqual(self.update().returncode, 0)

    def test_clean_update_has_constant_git_calls_and_no_content_backup(self):
        for number in range(120):
            (self.seed / f'tracked-{number}.txt').write_text(f'committed {number}')
        self.commit()
        self.git(self.seed, 'push', 'origin', 'main')
        self.git(self.repo, 'fetch', 'origin', 'main')
        self.git(self.repo, 'merge', '--ff-only', 'FETCH_HEAD')
        prefix = "import subprocess,atexit,json,os;_calls=[];_popen=subprocess.Popen;subprocess.Popen=lambda *a,**kw:(_calls.append(a[0] if a else kw.get('args')),_popen(*a,**kw))[1];atexit.register(lambda:open(os.path.join(os.environ['BACKUP'],'processes.json'),'w').write(json.dumps(_calls)));"
        result = self.update(prefix)
        self.assertEqual(result.returncode, 0, result.stderr)
        calls = json.loads((self.backup / 'processes.json').read_text())
        self.assertLessEqual(len(calls), 8)
        self.assertFalse(any('cat-file' in args or 'bundle' in args for args in calls))
        self.assertFalse((self.backup / 'preserved-files').exists())
        manifest = json.loads((self.backup / 'preserved-manifest.json').read_text())
        self.assertEqual(manifest['saved'], [])
        self.assertTrue(manifest['tracked_changes_discarded'])

    def test_dirty_index_flags_do_not_trigger_full_backup(self):
        self.git(self.repo, 'update-index', '--assume-unchanged', 'local.txt')
        (self.repo / 'local.txt').write_text('hidden local changes')
        result = self.update()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.repo / 'local.txt').read_text(), 'base\n')
        self.assertFalse((self.backup / 'preserved-files/local.txt').exists())




    def test_stale_launcher_lock_does_not_block_git_update_or_get_removed(self):
        lock = self.repo / '.git/aidiy-automatic/run.lock'
        lock.mkdir(parents=True)
        owner = lock / 'owner.txt'
        owner.write_bytes(b'previous-interrupted-run\r\n')
        self.advance()
        self.assertEqual(self.update().returncode, 0)
        self.assertEqual(owner.read_bytes(), b'previous-interrupted-run\r\n')
        self.assertEqual(self.git(self.repo, 'rev-parse', 'HEAD').stdout,
                         self.git(self.seed, 'rev-parse', 'HEAD').stdout)


    def test_ignored_backup_overlap_is_not_overwritten_by_update(self):
        ignore = self.repo / '.gitignore'
        ignore.write_text(ignore.read_text() + 'temp/\n')
        local = self.repo / 'temp/_auto/run/head.txt'
        local.parent.mkdir(parents=True)
        local.write_text('private backup')
        remote = self.seed / 'temp/_auto/run/head.txt'
        remote.parent.mkdir(parents=True)
        remote.write_text('remote tracked file')
        self.commit()
        self.git(self.seed, 'push', 'origin', 'main')
        self.assertNotEqual(self.update().returncode, 0)
        self.assertEqual(local.read_text(), 'private backup')

    def test_clean_checkout_reaches_remote(self):
        self.advance()
        self.assertEqual(self.update().returncode, 0)
        self.assertEqual(self.git(self.repo, 'rev-parse', 'HEAD').stdout, self.git(self.seed, 'rev-parse', 'HEAD').stdout)

    def test_same_named_tag_cannot_replace_remote_main_branch(self):
        self.advance('local.txt')
        self.git(self.seed, 'tag', 'main', 'HEAD~1')
        self.git(self.seed, 'push', 'origin', 'refs/tags/main')
        result = self.update()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.repo / 'local.txt').read_text(), 'remote\n')
        self.assertEqual(self.git(self.repo, 'rev-parse', 'HEAD').stdout,
                         self.git(self.seed, 'rev-parse', 'refs/heads/main').stdout)

    def test_tracked_changes_are_replaced_but_unrelated_untracked_survives(self):
        (self.repo / 'local.txt').write_text('unsaved\n')
        (self.repo / '未追跡.txt').write_text('keep')
        self.advance()
        self.assertEqual(self.update().returncode, 0)
        self.assertEqual((self.repo / 'local.txt').read_text(), 'base\n')
        self.assertFalse((self.backup / 'preserved-files/local.txt').exists())
        self.assertEqual((self.repo / '未追跡.txt').read_text(), 'keep')

    def test_conflicting_unsaved_is_restored_from_remote_without_autostash(self):
        self.git(self.repo, 'config', 'merge.autoStash', 'true')
        (self.repo / 'local.txt').write_text('unsaved\n')
        self.advance('local.txt')
        result = self.update()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.repo / 'local.txt').read_text(), 'remote\n')
        self.assertFalse((self.backup / 'preserved-files/local.txt').exists())
        self.assertEqual(self.git(self.repo, 'stash', 'list').stdout, b'')

    def test_untracked_overlap_is_backed_up_then_remote_wins(self):
        (self.repo / 'remote.txt').write_text('local private')
        self.advance()
        result = self.update()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.repo / 'remote.txt').read_text(), 'remote\n')
        self.assertEqual((self.backup / 'preserved-files/remote.txt').read_text(), 'local private')

    def test_ignored_overlap_is_backed_up_then_remote_wins(self):
        for repo in (self.repo, self.seed):
            (repo / '_data').mkdir()
        (self.repo / '_data' / 'db').write_text('local private')
        (self.seed / '_data' / 'db').write_text('remote')
        self.git(self.seed, 'add', '--force', '_data/db')
        self.git(self.seed, 'commit', '-m', 'track data')
        self.git(self.seed, 'push', 'origin', 'main')
        result = self.update()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.repo / '_data' / 'db').read_text(), 'remote')
        self.assertEqual((self.backup / 'preserved-files/_data/db').read_text(), 'local private')

    def test_local_divergent_commit_is_replaced_without_history_bundle(self):
        (self.repo / 'local.txt').write_text('local committed\n')
        self.git(self.repo, 'add', 'local.txt')
        self.git(self.repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'local')
        self.advance('local.txt')
        result = self.update()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.git(self.repo, 'rev-parse', 'HEAD').stdout, self.git(self.seed, 'rev-parse', 'HEAD').stdout)
        self.assertFalse((self.backup / 'history.bundle').exists())

    def test_failed_fetch_never_uses_stale_fetch_head(self):
        self.git(self.repo, 'fetch', '--no-tags', 'origin', 'main')
        self.git(self.repo, 'remote', 'set-url', 'origin', str(self.base / 'missing-remote.git'))
        (self.repo / 'local.txt').write_text('keep unsaved')
        before = self.git(self.repo, 'rev-parse', 'HEAD').stdout
        result = self.update()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((self.repo / 'local.txt').read_text(), 'keep unsaved')
        self.assertEqual(self.git(self.repo, 'rev-parse', 'HEAD').stdout, before)


    def test_preflight_failure_stops_before_reset(self):
        (self.repo / 'local.txt').write_text('keep unsaved')
        before = self.git(self.repo, 'rev-parse', 'HEAD').stdout
        self.advance('local.txt')
        result = self.update("raise PermissionError('fixture backup failure');")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b'fixture backup failure', result.stderr)
        self.assertEqual((self.repo / 'local.txt').read_text(), 'keep unsaved')
        self.assertEqual(self.git(self.repo, 'rev-parse', 'HEAD').stdout, before)

    def test_preflight_copy_error_keeps_original_and_stops_before_reset(self):
        (self.repo / 'remote.txt').write_text('keep untracked')
        (self.repo / 'local.txt').write_text('keep unsaved')
        self.advance()
        prefix = "from unittest.mock import patch;import shutil;patch.object(shutil,'copy2',side_effect=PermissionError('fixture copy denied')).start();"
        result = self.update(prefix)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b'fixture copy denied', result.stderr)
        self.assertEqual((self.repo / 'local.txt').read_text(), 'keep unsaved')

    def test_head_change_after_history_backup_stops_before_preflight_reset(self):
        self.advance('local.txt')
        prefix = "import subprocess;subprocess.run(['git','-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--allow-empty','-m','concurrent fixture change'],check=True);"
        result = self.update(prefix)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b'HEAD changed', result.stderr)
        self.assertEqual(self.git(self.repo, 'log', '-1', '--format=%s').stdout.strip(),
                         b'concurrent fixture change')
        self.assertEqual((self.repo / 'local.txt').read_text(), 'base\n')

    def test_head_change_after_preflight_stops_immediately_before_reset(self):
        self.advance('local.txt')
        result = self.update(commit_after_preflight=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b'HEAD changed before restore', result.stderr)
        self.assertEqual(self.git(self.repo, 'log', '-1', '--format=%s').stdout.strip(),
                         b'concurrent fixture change')
        self.assertEqual((self.repo / 'local.txt').read_text(), 'base\n')

    def test_unrelated_ignored_runtime_and_config_are_not_cleaned(self):
        for directory in ('_data', '_config'):
            (self.repo / directory).mkdir()
            (self.repo / directory / 'private').write_bytes(b'keep private')
        self.advance()
        result = self.update()
        self.assertEqual(result.returncode, 0, result.stderr)
        for directory in ('_data', '_config'):
            self.assertEqual((self.repo / directory / 'private').read_bytes(), b'keep private')

    def test_remote_backup_alias_is_rejected_before_reset(self):
        # Windowsのcasefold/末尾空白・ドット別名をLinux一時repoで構成する。
        alias = self.seed / 'TEMP. /_AUTO /replace.txt'
        alias.parent.mkdir(parents=True)
        alias.write_text('remote')
        self.commit()
        self.git(self.seed, 'push', 'origin', 'main')
        (self.repo / 'local.txt').write_text('keep unsaved')
        result = self.update()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b'overlaps launcher backup', result.stderr)
        self.assertEqual((self.repo / 'local.txt').read_text(), 'keep unsaved')

    def test_real_merge_conflict_is_replaced_by_remote(self):
        (self.repo / 'local.txt').write_text('local committed\n')
        self.git(self.repo, 'add', 'local.txt')
        self.git(self.repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'local')
        self.advance('local.txt')
        self.git(self.repo, 'fetch', 'origin', 'main')
        merge = self.git(self.repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'merge', 'FETCH_HEAD', check=False)
        self.assertNotEqual(merge.returncode, 0)
        self.assertTrue(self.git(self.repo, 'ls-files', '--unmerged').stdout)
        conflict = (self.repo / 'local.txt').read_bytes()
        self.assertIn(b'<<<<<<<', conflict)
        result = self.update()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.repo / 'local.txt').read_text(), 'remote\n')
        self.assertEqual(self.git(self.repo, 'ls-files', '--unmerged').stdout, b'')
        self.assertFalse((self.repo / '.git/MERGE_HEAD').exists())
        self.assertFalse((self.backup / 'preserved-files/local.txt').exists())

    def test_untracked_directory_obstruction_is_saved_before_remote_file(self):
        obstruction = self.repo / 'remote.txt'
        obstruction.mkdir()
        (obstruction / 'private').write_text('keep private')
        self.advance()
        result = self.update()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(obstruction.read_text(), 'remote\n')
        self.assertEqual((self.backup / 'preserved-files/remote.txt/private').read_text(), 'keep private')

    def test_untracked_ancestor_file_is_saved_before_remote_directory(self):
        (self.repo / 'folder').write_text('keep ancestor')
        (self.seed / 'folder').mkdir()
        self.advance('folder/remote.txt')
        result = self.update()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.repo / 'folder/remote.txt').read_text(), 'remote\n')
        self.assertEqual((self.backup / 'preserved-files/folder').read_text(), 'keep ancestor')

    def test_staged_and_unstaged_changes_are_discarded_without_copying_them(self):
        (self.repo / 'local.txt').write_bytes(b'staged\x00binary')
        self.git(self.repo, 'add', 'local.txt')
        (self.repo / 'local.txt').write_bytes(b'unstaged\x00binary')
        self.advance('local.txt')
        result = self.update()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.repo / 'local.txt').read_bytes(), b'remote\n')
        self.assertFalse((self.backup / 'preserved-files/local.txt').exists())
        self.assertFalse((self.backup / 'index-blobs').exists())

    def test_deleted_setup_and_start_are_restored_from_remote(self):
        for name in ('_setup.py', '_start.py'):
            (self.seed / name).write_text('# remote launcher\n')
        self.commit()
        self.git(self.seed, 'push', 'origin', 'main')
        self.git(self.repo, 'fetch', 'origin', 'main')
        self.git(self.repo, 'merge', '--ff-only', 'FETCH_HEAD')
        self.git(self.repo, 'rm', '_setup.py')
        (self.repo / '_start.py').unlink()
        result = self.update()
        self.assertEqual(result.returncode, 0, result.stderr)
        for name in ('_setup.py', '_start.py'):
            self.assertEqual((self.repo / name).read_text(), '# remote launcher\n')

    def test_symlink_obstruction_is_rejected_without_modifying_external_file(self):
        outside = self.base / 'outside'
        outside.write_text('outside private')
        (self.repo / 'remote.txt').symlink_to(outside)
        self.advance()
        result = self.update()
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue((self.repo / 'remote.txt').is_symlink())
        self.assertEqual(outside.read_text(), 'outside private')

    def test_tracked_symlink_replacement_is_still_rejected(self):
        outside = self.base / 'outside'
        outside.write_text('outside private')
        (self.repo / 'local.txt').unlink()
        (self.repo / 'local.txt').symlink_to(outside)
        result = self.update()
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue((self.repo / 'local.txt').is_symlink())
        self.assertEqual(outside.read_text(), 'outside private')

    def test_config_collision_is_preserved_but_unrelated_config_is_not_copied(self):
        for repo in (self.seed, self.repo):
            (repo / '_config').mkdir()
        (self.repo / '_config/overlap').write_text('local configuration')
        (self.repo / '_config/unrelated').write_text('keep private')
        (self.seed / '_config/overlap').write_text('remote configuration')
        self.git(self.seed, 'add', '--force', '_config/overlap')
        self.git(self.seed, 'commit', '-m', 'remote config')
        self.git(self.seed, 'push', 'origin', 'main')
        result = self.update()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.repo / '_config/overlap').read_text(), 'remote configuration')
        self.assertEqual((self.backup / 'preserved-files/_config/overlap').read_text(), 'local configuration')
        self.assertEqual((self.repo / '_config/unrelated').read_text(), 'keep private')
        self.assertFalse((self.backup / 'preserved-files/_config/unrelated').exists())

    def test_unrelated_venv_and_node_modules_are_not_scanned_or_copied(self):
        outside = self.base / 'external runtime'
        outside.mkdir()
        (outside / 'private').write_text('keep private')
        for name in ('.venv', 'node_modules'):
            (self.repo / name).symlink_to(outside, target_is_directory=True)
        self.advance()
        result = self.update()
        self.assertEqual(result.returncode, 0, result.stderr)
        for name in ('.venv', 'node_modules'):
            self.assertTrue((self.repo / name).is_symlink())
            self.assertFalse((self.backup / 'preserved-files' / name).exists())
        self.assertEqual((outside / 'private').read_text(), 'keep private')


    @unittest.skipUnless(os.name == 'nt', 'Windows CMD unavailable; no Windows execution claim')
    def test_real_cmd_repository_validator_success_and_failures(self):
        """Windowsでは実bat subroutineのみ実行。fetch/setup/startは含めない。"""
        for name in ('_setup.py', '_start.py'):
            (self.repo / name).write_text('# fixture', encoding='utf-8')
        temporary = self.base / '診断 temp'
        temporary.mkdir()
        log = temporary / 'validation.log'
        script = temporary / 'validator.bat'
        validator = TEXT[TEXT.index('\n:validate_repository\n'):TEXT.index('\n:control_failed\n')]
        conversion = TEXT[TEXT.index('\n:convert_git_path_text\n'):TEXT.index('\n:report_optional_check\n')]
        harness = ('@echo off\nsetlocal EnableExtensions DisableDelayedExpansion\n'
                   'chcp 932 >nul\ncall :validate_repository\nexit /b %ERRORLEVEL%\n')
        script.write_bytes((harness + validator + conversion).replace('\n', '\r\n').encode('cp932'))
        env = {**os.environ, 'TARGET': str(self.repo), 'AIDIY_TEMP': str(temporary),
               'PYTHON': sys.executable, 'LOG': str(log)}

        def run():
            return subprocess.run([os.environ['ComSpec'], '/d', '/c', str(script)],
                                  capture_output=True, env=env)

        self.git(self.repo, 'remote', 'set-url', 'origin', 'https://github.com/Monjyu1101/AiDiy2027.git')
        result = run()
        self.assertEqual(result.returncode, 0, result.stdout.decode('cp932', errors='replace'))
        self.git(self.repo, 'checkout', '-b', 'not-main')
        self.assertEqual(run().returncode, 3)
        self.assertIn('repository_branch', log.read_text(encoding='cp932'))
        self.git(self.repo, 'checkout', 'main')
        self.git(self.repo, 'remote', 'set-url', 'origin', 'https://other.invalid/wrong.git')
        self.assertEqual(run().returncode, 3)
        self.assertIn('repository_origin', log.read_text(encoding='cp932'))


if __name__ == '__main__':
    unittest.main()
