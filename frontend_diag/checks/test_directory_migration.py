# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE for full terms.
"""Diag フォルダ改名時、同じ配置元だけを移行する回帰。"""
import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

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
