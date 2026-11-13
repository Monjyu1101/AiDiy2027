# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE for full terms.
import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
def load(name):
    spec = importlib.util.spec_from_file_location('memo_launcher_' + name, ROOT / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
setup, cleanup = load('_setup'), load('_cleanup')

class MemoLaunchers(unittest.TestCase):
    def test_both_launchers_register_and_owned_cleanup_leaves_sources(self):
        for platform in ('linux', 'win32'):
            with self.subTest(platform=platform), tempfile.TemporaryDirectory() as folder:
                root = Path(folder) / 'frontend_diag'; root.mkdir()
                for entry in ('diag_main.mjs', 'memo_main.mjs'):
                    (root / entry).write_text('// source', encoding='utf-8')
                local = lambda program: Path(folder) / '_AIDIY' / program / 'bin'
                with patch.object(setup, 'THIS_DIR', root), patch.object(setup.sys, 'platform', platform), patch.object(setup._path_helper, 'launcher_directory', side_effect=local), patch.object(setup, 'ensure_launcher_path', return_value=True) as register, patch('builtins.print'):
                    self.assertTrue(setup.setup(desktop=False)); self.assertEqual(register.call_count, 2)
                    self.assertTrue(setup.setup(desktop=False))
                suffix = '.cmd' if platform == 'win32' else ''
                for program in ('aidiy_diag', 'aidiy_memo'):
                    launcher = local(program) / (program + suffix)
                    self.assertIn(program + '-owner:', launcher.read_text(encoding='utf-8'))
                with patch.object(cleanup, '__file__', str(root / '_cleanup.py')), patch.object(cleanup._path_helper, 'launcher_directory', side_effect=local), patch.object(cleanup, 'stop_processes', return_value=True) as stop, patch.object(cleanup, 'cleanup_dependencies', return_value=True), patch.object(cleanup, 'remove_launcher_path', return_value=True) as remove, patch('builtins.print'):
                    self.assertTrue(cleanup.cleanup()); stop.assert_called_once(); self.assertEqual(remove.call_count, 2)
                for program in ('aidiy_diag', 'aidiy_memo'):
                    self.assertFalse((local(program) / (program + suffix)).exists())
                self.assertTrue((root / 'memo_main.mjs').exists())

    def test_foreign_memo_blocks_setup_before_diag_change_and_is_not_removed(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); local = lambda program: root / program / 'bin'
            memo = local('aidiy_memo') / 'aidiy_memo'; memo.parent.mkdir(parents=True)
            memo.write_text(setup.launcher_content(root / 'other' / 'memo_main.mjs', False), encoding='utf-8')
            before = memo.read_bytes()
            with patch.object(setup, 'THIS_DIR', root), patch.object(setup.sys, 'platform', 'linux'), patch.object(setup._path_helper, 'launcher_directory', side_effect=local), patch.object(setup, 'ensure_launcher_path') as register, patch('builtins.print'):
                self.assertFalse(setup.setup(desktop=False)); register.assert_not_called()
            self.assertFalse((local('aidiy_diag') / 'aidiy_diag').exists()); self.assertEqual(memo.read_bytes(), before)
            with patch.object(cleanup, '__file__', str(root / '_cleanup.py')), patch.object(cleanup._path_helper, 'launcher_directory', side_effect=local), patch.object(cleanup, 'stop_processes', return_value=True), patch.object(cleanup, 'cleanup_dependencies', return_value=True), patch.object(cleanup, 'remove_launcher_path', return_value=True) as remove, patch('builtins.print'):
                self.assertTrue(cleanup.cleanup())
                self.assertNotIn(local('aidiy_memo'), [call.args[0] for call in remove.call_args_list])
            self.assertEqual(memo.read_bytes(), before)

    def test_symlink_launcher_never_overwrites_or_unlinks_target(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); directory = root / 'bin'; directory.mkdir()
            target = root / 'target'; target.write_text(setup.launcher_content(root / 'memo_main.mjs', False), encoding='utf-8')
            memo = directory / 'aidiy_memo'
            try: memo.symlink_to(target)
            except OSError: self.skipTest('symlink unavailable')
            with patch.object(setup, 'THIS_DIR', root), patch.object(setup.sys, 'platform', 'linux'), patch.object(setup._path_helper, 'launcher_directory', return_value=directory), patch('builtins.print'):
                self.assertFalse(setup.setup(desktop=False))
            with patch.object(cleanup, '__file__', str(root / '_cleanup.py')), patch.object(cleanup._path_helper, 'launcher_directory', return_value=directory), patch.object(cleanup, 'stop_processes', return_value=True), patch.object(cleanup, 'cleanup_dependencies', return_value=True), patch.object(cleanup, 'remove_launcher_path') as remove, patch('builtins.print'):
                self.assertTrue(cleanup.cleanup()); remove.assert_not_called()
            self.assertTrue(memo.is_symlink()); self.assertTrue(target.exists())

    def test_memo_launcher_keeps_cwd_and_forwards_arguments(self):
        for windows in (False, True):
            value = setup.launcher_content('/project/memo_main.mjs', windows)
            self.assertIn('aidiy_memo-owner:', value)
            self.assertNotIn('chdir', value); self.assertNotIn('cd /', value)
            self.assertIn('%*' if windows else '"$@"', value)

if __name__ == '__main__': unittest.main()
