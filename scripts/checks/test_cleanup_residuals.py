# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""cleanupの残留物と、別プロファイル・保存版を巻き込まない境界を検証する。"""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]


def load(name, relative):
    spec = importlib.util.spec_from_file_location(name, ROOT / relative)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


cleanup = load('cleanup_residual_root', '_cleanup.py')
tools = load('cleanup_residual_tools', 'backend_tools/_cleanup.py')
diag = load('cleanup_residual_diag', 'frontend_diag/_cleanup.py')


class ResidualTests(unittest.TestCase):
    def test_chrome_owned_profiles_only(self):
        root = Path('C:/project space/backend_tools')
        for profile, expected in [
            ('C:/project space/backend_tools/temp/_chrome_profile', True),
            ('C:/project space/backend_tools/temp/_chrome_profile_s0001', True),
            ('C:/other/backend_tools/temp/_chrome_profile', False),
            ('C:/project space/backend_tools/temp/_chrome_profile_backup', False),
            ('C:/Users/admin/AppData/Local/Google/Chrome/User Data', False),
        ]:
            with self.subTest(profile=profile):
                process = dict(Name='chrome.exe', CommandLine=f'chrome.exe --user-data-dir="{profile}"')
                self.assertEqual(tools.is_tools_chrome_process(process, root, True), expected)

    def test_other_executable_is_not_chrome(self):
        process = dict(Name='node.exe', CommandLine='node.exe --user-data-dir=C:/p/temp/_chrome_profile')
        self.assertFalse(tools.is_tools_chrome_process(process, Path('C:/p'), True))

    def test_stop_integrates_chrome_matcher(self):
        root = tools.BACKEND_TOOLS_DIR
        process = dict(Name='chrome.exe', ProcessId=123,
                       CommandLine=f'chrome.exe --user-data-dir="{root}/temp/_chrome_profile"')
        with patch.object(tools, 'stop_matching', side_effect=lambda match, *args: match(process)):
            self.assertTrue(tools.stop_tools_processes())
            self.assertFalse(tools.stop_tools_processes(frozenset({123})))

    def test_recursive_cache_cleanup_preserves_backup_and_source(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            for relative in ('deep/checks/__pycache__', 'docs/examples/.pytest_cache',
                             '.aidiy_backup/saved/__pycache__', '.backup_local/saved/__pycache__',
                             '.aidiy_cache/__pycache__', '.git/__pycache__', 'source'):
                folder = root / relative
                folder.mkdir(parents=True)
                (folder / 'keep.txt').write_text('evidence', encoding='utf-8')
            with patch.object(cleanup, 'BASE_DIR', root):
                self.assertTrue(cleanup._remove_root_python_caches())
            self.assertFalse((root / 'deep/checks/__pycache__').exists())
            self.assertFalse((root / 'docs/examples/.pytest_cache').exists())
            self.assertTrue((root / '.aidiy_backup/saved/__pycache__/keep.txt').exists())
            self.assertTrue((root / '.git/__pycache__/keep.txt').exists())
            self.assertTrue((root / 'source/keep.txt').exists())

    def test_cache_failure_is_reported(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            (root / '__pycache__').mkdir()
            with patch.object(cleanup, 'BASE_DIR', root), patch.object(cleanup, 'remove_directory', return_value=False):
                self.assertFalse(cleanup._remove_root_python_caches())

    def test_diag_removes_dependencies_preserves_distribution(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            for relative in ('node_modules/electron', 'ui/node_modules/vue', 'static'):
                folder = root / relative
                folder.mkdir(parents=True)
                (folder / 'sample.txt').write_text('data', encoding='utf-8')
            self.assertTrue(diag.cleanup_dependencies(root))
            self.assertFalse((root / 'node_modules').exists())
            self.assertFalse((root / 'ui/node_modules').exists())
            self.assertTrue((root / 'static/sample.txt').exists())
            self.assertTrue(diag.cleanup_dependencies(root))

    def test_diag_delete_failure_is_reported(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            (root / 'node_modules').mkdir()
            with patch.object(diag.shutil, 'rmtree', side_effect=PermissionError('locked')):
                self.assertFalse(diag.cleanup_dependencies(root))


if __name__ == '__main__':
    unittest.main()
