# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE for full terms.
"""Diag フォルダ改名時、同じ配置元だけを移行する回帰。"""
import importlib.util
import base64
import json
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from contextlib import ExitStack

ROOT = Path(__file__).resolve().parents[1]
def load(name):
    spec = importlib.util.spec_from_file_location('migration_' + name, ROOT / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
setup, cleanup = load('_setup'), load('_cleanup')

class DirectoryMigration(unittest.TestCase):
    def test_setup_rewrites_both_old_launchers_and_cleanup_removes_old(self):
        for windows in (False, True):
            with self.subTest(windows=windows), tempfile.TemporaryDirectory() as folder:
                root = Path(folder) / 'frontend_diag'; root.mkdir()
                old = root.parent / 'backend_diag'
                directory = root.parent / 'bin'; directory.mkdir()
                suffix = '.cmd' if windows else ''
                def old_launchers():
                    for program, entry in (('aidiy_diag', 'diag_main.mjs'), ('aidiy_memo', 'memo_main.mjs')):
                        (directory / (program + suffix)).write_bytes(setup.launcher_content(old / entry, windows).encode())
                old_launchers()
                with patch.object(setup, 'THIS_DIR', root), patch.object(setup.sys, 'platform', 'win32' if windows else 'linux'), patch.object(setup._path_helper, 'launcher_directory', return_value=directory), patch.object(setup, 'ensure_launcher_path', return_value=True), patch('builtins.print'):
                    self.assertTrue(setup.setup(desktop=False))
                for program, entry in (('aidiy_diag', 'diag_main.mjs'), ('aidiy_memo', 'memo_main.mjs')):
                    self.assertEqual((directory / (program + suffix)).read_bytes(), setup.launcher_content(root / entry, windows).encode())
                old_launchers()
                with patch.object(cleanup, '__file__', str(root / '_cleanup.py')), patch.object(cleanup._path_helper, 'launcher_directory', return_value=directory), patch.object(cleanup, 'stop_processes', return_value=True), patch.object(cleanup, 'stop_memo_processes', return_value=True), patch.object(cleanup, 'cleanup_dependencies', return_value=True), patch.object(cleanup, 'remove_launcher_path', return_value=True), patch('builtins.print'):
                    self.assertTrue(cleanup.cleanup())
                self.assertEqual(list(directory.iterdir()), [])

    @unittest.skipUnless(shutil.which('node'), 'Node.js が必要です')
    def test_deleted_old_folder_windows_payload_runs_current_entry_after_repair(self):
        # git 更新では生成済み cmd は書き換わらない。旧フォルダを消した状態を再現。
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / 'frontend_diag'; root.mkdir()
            old = root.parent / 'backend_diag'
            directory = root.parent / '_AIDIY' / 'aidiy_diag' / 'bin'
            directory.mkdir(parents=True)
            launcher = directory / 'aidiy_diag.cmd'
            launcher.write_bytes(setup.launcher_content(old / 'diag_main.mjs', True).encode())
            def command():
                payload = re.search(r"Buffer\.from\('([A-Za-z0-9+/=]+)','base64'\)", launcher.read_text())
                return json.loads(base64.b64decode(payload.group(1)))
            self.assertFalse(old.exists())
            stale = subprocess.run([shutil.which('node'), *command()[1:]], capture_output=True, text=True)
            self.assertNotEqual(stale.returncode, 0)
            self.assertIn('MODULE_NOT_FOUND', stale.stderr)
            (root / 'diag_main.mjs').write_text('console.log(JSON.stringify(process.argv.slice(2)))', encoding='utf-8')
            with patch.object(setup, 'THIS_DIR', root), patch.object(setup.sys, 'platform', 'win32'), patch.object(setup._path_helper, 'launcher_directory', return_value=directory), patch.object(setup, 'ensure_launcher_path', return_value=True), patch.object(setup, 'setup_desktop') as desktop, patch('builtins.print'):
                self.assertTrue(setup.setup(desktop=False))
                desktop.assert_not_called()
            self.assertEqual(command(), ['node.exe', str(root / 'diag_main.mjs')])
            result = subprocess.run([shutil.which('node'), *command()[1:], '--browser', 'space argument'], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout), ['--browser', 'space argument'])
            self.assertFalse(old.exists())

    def test_normal_root_setup_repairs_deleted_old_directory_for_both_apps(self):
        spec = importlib.util.spec_from_file_location('migration_root_setup', ROOT.parent / '_setup.py')
        root_setup = importlib.util.module_from_spec(spec); spec.loader.exec_module(root_setup)
        for windows in (False, True):
            with self.subTest(windows=windows), tempfile.TemporaryDirectory() as folder, ExitStack() as stack:
                root = Path(folder) / 'frontend_diag'; root.mkdir()
                old = root.parent / 'backend_diag'
                def directory(program):
                    return root.parent / '_AIDIY' / program / 'bin'
                suffix = '.cmd' if windows else ''
                for program, entry in (('aidiy_diag', 'diag_main.mjs'), ('aidiy_memo', 'memo_main.mjs')):
                    target = directory(program); target.mkdir(parents=True)
                    (target / (program + suffix)).write_bytes(setup.launcher_content(old / entry, windows).encode())
                choices = dict.fromkeys(('common', 'local', 'mcp', 'backend', 'taskteam', 'web', 'avatar', 'hermes', 'ide', 'continue_on_error'), False)
                choices['diag'] = True
                stack.enter_context(patch.object(setup, 'THIS_DIR', root))
                stack.enter_context(patch.object(setup.sys, 'platform', 'win32' if windows else 'linux'))
                stack.enter_context(patch.object(setup._path_helper, 'launcher_directory', side_effect=directory))
                stack.enter_context(patch.object(setup, 'ensure_launcher_path', return_value=True))
                desktop = stack.enter_context(patch.object(setup, 'setup_desktop', return_value=True))
                stack.enter_context(patch.object(root_setup.sys, 'argv', ['_setup.py']))
                stack.enter_context(patch.object(root_setup, 'collect_setup_choices', return_value=choices))
                stack.enter_context(patch.object(root_setup, 'stop_setup_apps'))
                stack.enter_context(patch.object(root_setup, 'ensure_prerequisites', return_value=True))
                stack.enter_context(patch('scripts.local_git_setup.ensure_local_git', return_value=('existing', 'test')))
                def load_folder(folder):
                    self.assertEqual(folder, 'frontend_diag')
                    return setup
                stack.enter_context(patch.object(root_setup, '_load_folder_module', side_effect=load_folder))
                stack.enter_context(patch.object(root_setup, 'setup_channels', return_value=[]))
                stack.enter_context(patch.object(root_setup, 'remove_folder_import_caches'))
                headless = stack.enter_context(patch.object(root_setup, 'run_diag_headless', return_value=True))
                summary = stack.enter_context(patch.object(root_setup, 'print_setup_summary'))
                stack.enter_context(patch.object(root_setup.time, 'sleep'))
                stack.enter_context(patch('builtins.print'))
                root_setup.main()
                summary.assert_called_once_with([])
                desktop.assert_called_once()
                headless.assert_called_once()
                self.assertFalse(old.exists())
                for program, entry in (('aidiy_diag', 'diag_main.mjs'), ('aidiy_memo', 'memo_main.mjs')):
                    self.assertEqual((directory(program) / (program + suffix)).read_bytes(), setup.launcher_content(root / entry, windows).encode())

    def test_rejects_foreign_modified_and_symlink_old_launchers(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / 'frontend_diag'; root.mkdir()
            old = root.parent / 'backend_diag'
            for windows in (False, True):
                current = root / 'memo_main.mjs'
                valid = setup.launcher_content(old / current.name, windows)
                self.assertTrue(setup.owns_launcher(valid, current, windows))
                self.assertFalse(setup.owns_launcher(valid + '\necho changed', current, windows))
                self.assertFalse(setup.owns_launcher(setup.launcher_content(root.parent / 'other' / 'backend_diag' / current.name, windows), current, windows))
            target = root.parent / 'other'; target.mkdir()
            old.symlink_to(target, target_is_directory=True)
            self.assertFalse(setup.owns_launcher(valid, current, True))

    def test_old_process_owned_only_for_same_checkout(self):
        processes = cleanup._stop_helper
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / 'frontend_diag'; root.mkdir()
            old = root.parent / 'backend_diag'
            for windows in (False, True):
                node = 'node.exe' if windows else 'node'
                for entry in ('diag_main.mjs', 'memo_main.mjs', 'diag/起動/electron-main.cjs'):
                    proc = dict(Name=node, CommandLine=f'{node} "{old / entry}"')
                    self.assertTrue(processes.is_diag(proc, root, windows))
                    self.assertFalse(processes.is_diag(dict(Name=node, CommandLine=f'{node} "{root.parent / "other" / "backend_diag" / entry}"'), root, windows))
                    self.assertFalse(processes.is_diag(dict(Name=node, CommandLine=f'{node} unrelated.js "{old / entry}"'), root, windows))
                with self.assertRaises(ValueError):
                    processes.is_diag(dict(Name=node, CommandLine=f'{node} backend_diag/diag_main.mjs'), root, windows)
                exe = old / 'node_modules/electron/dist' / ('electron.exe' if windows else 'electron')
                self.assertTrue(processes.is_diag(dict(Name=exe.name, CommandLine=f'"{exe}" --type=renderer', ExecutablePath=str(exe)), root, windows))
            target = root.parent / 'other'; target.mkdir(); old.symlink_to(target, target_is_directory=True)
            self.assertFalse(processes.is_diag(dict(Name='node', CommandLine=f'node "{old / "diag_main.mjs"}"'), root, False))

if __name__ == '__main__': unittest.main()
