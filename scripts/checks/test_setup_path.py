# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""実際のユーザー PATH を変更せず、登録・解除の境界を確認する。"""
import importlib.util
import json
import os
import shutil
import subprocess  # msvcrt の模擬登録より先にホスト OS の subprocess を初期化する。
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, Mock, patch


ROOT = Path(__file__).resolve().parents[2]


def load(relative):
    spec = importlib.util.spec_from_file_location('path_test_' + relative.stem, relative)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


helper = load(ROOT / 'scripts/_setup_path.py')


class PathTests(unittest.TestCase):
    def test_project_directory_and_empty_project(self):
        self.assertEqual(helper.launcher_directory('aidiy_console'), ROOT / '_AIDIY/aidiy_console/bin')
        self.assertEqual(helper.launcher_directory('aidiy_console', ''), ROOT / '_AIDIY/aidiy_console/bin')
        with tempfile.TemporaryDirectory() as directory:
            self.assertEqual(helper.launcher_directory('aidiy_code', directory), Path(directory) / '_AIDIY/aidiy_code/bin')
        with self.assertRaises(ValueError):
            helper.launcher_directory('../bad')

    def test_only_process_path_changes_and_home_is_never_read(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'PATH': '/existing'}), patch.object(Path, 'home', side_effect=AssertionError('home forbidden')):
            target = Path(directory) / '_AIDIY/aidiy_console/bin'
            self.assertTrue(helper.ensure_launcher_path(target))
            self.assertTrue(helper.ensure_launcher_path(target))
            self.assertEqual(os.environ['PATH'], str(target) + os.pathsep + '/existing')
            self.assertEqual(list(Path(directory).iterdir()), [])
            self.assertTrue(helper.remove_launcher_path(target))
            self.assertEqual(os.environ['PATH'], '/existing')
            self.assertTrue(helper.remove_launcher_path())

    def test_old_profile_and_launchers_are_preserved(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'HOME': directory, 'PATH': '/existing'}):
            old = Path(directory) / '.profile'
            old.write_text('legacy profile')
            helper.ensure_launcher_path(Path(directory) / 'project/_AIDIY/aidiy_code/bin')
            helper.remove_launcher_path()
            self.assertEqual(old.read_text(), 'legacy profile')

class HermesSharedPathTests(unittest.TestCase):
    def setUp(self):
        self.home = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.directory = self.home / '.local/bin'
        self.directory.mkdir(parents=True)
        self.enterContext(patch.object(Path, 'home', return_value=self.home))
        self.enterContext(patch.dict(os.environ, {'HOME': str(self.home), 'PATH': '/existing', 'SHELL': '/bin/bash'}, clear=True))
        self.enterContext(patch('builtins.print'))

    def test_posix_persistent_registration_is_idempotent_and_restores_profiles(self):
        with patch.object(helper.sys, 'platform', 'linux'):
            profile = self.home / '.profile'
            original = b'# user settings\n\n'
            profile.write_bytes(original)
            self.assertTrue(helper.ensure_launcher_path(self.directory))
            first = profile.read_bytes()
            self.assertIn(helper.SHELL_PATH_BEGIN.encode(), first)
            self.assertTrue(helper.ensure_launcher_path(self.directory))
            self.assertEqual(profile.read_bytes(), first)
            self.assertTrue(helper._state_file(self.directory).exists())
            other = self.directory / 'other-tool'
            other.touch()
            self.assertTrue(helper.remove_launcher_path(self.directory))
            self.assertEqual(profile.read_bytes(), first)
            other.unlink()
            self.assertTrue(helper.remove_launcher_path(self.directory))
            self.assertEqual(profile.read_bytes(), original)
            self.assertFalse((self.home / '.bashrc').exists())
            self.assertFalse(helper._state_file(self.directory).exists())

    def test_windows_persistent_registration_preserves_unrelated_entries(self):
        registry = {'Path': 'existing'}
        mock = SimpleNamespace(HKEY_CURRENT_USER=1, KEY_QUERY_VALUE=1, KEY_SET_VALUE=2,
                               REG_SZ=1, REG_EXPAND_SZ=2)
        mock.CreateKeyEx = MagicMock(return_value=MagicMock())
        mock.QueryValueEx = lambda *_: (registry['Path'], mock.REG_EXPAND_SZ)
        mock.SetValueEx = lambda key, name, reserved, kind, value: registry.update({name: value})
        mock.DeleteValue = lambda key, name: registry.pop(name)
        with patch.dict('sys.modules', {'winreg': mock}), patch.object(helper.sys, 'platform', 'win32'), patch.object(helper, '_notify_change'):
            self.assertTrue(helper.ensure_launcher_path(self.directory))
            registered = 'existing;' + str(self.directory)
            self.assertEqual(registry['Path'], registered)
            self.assertTrue(helper.ensure_launcher_path(self.directory))
            self.assertEqual(registry['Path'], registered)
            other = self.directory / 'other-tool'
            other.touch()
            self.assertTrue(helper.remove_launcher_path(self.directory))
            self.assertEqual(registry['Path'], registered)
            other.unlink()
            registry['Path'] += ';later'
            self.assertTrue(helper.remove_launcher_path(self.directory))
            self.assertEqual(registry['Path'], 'existing;later')
            self.assertFalse(helper._state_file(self.directory).exists())

    def test_project_path_never_opens_registry_or_reads_home(self):
        with patch.object(helper.sys, 'platform', 'win32'), patch.object(Path, 'home', side_effect=AssertionError('home forbidden')), patch.dict('sys.modules', {'winreg': None}):
            target = self.home / 'project/_AIDIY/aidiy_code/bin'
            self.assertTrue(helper.ensure_launcher_path(target))
            self.assertTrue(helper.remove_launcher_path(target))
            self.assertEqual(list(self.home.iterdir()), [self.home / '.local'])


class LauncherIntegrationTests(unittest.TestCase):
    def test_all_ide_launchers_stay_project_local(self):
        viewer = load(ROOT / 'frontend_ide/viewer/launcher.py')
        host = load(ROOT / 'frontend_ide/host/_setup.py')
        with tempfile.TemporaryDirectory() as directory, patch.object(Path, 'home', side_effect=AssertionError('home forbidden')), patch.dict(os.environ):
            def local(name):
                return Path(directory) / '_AIDIY' / name / 'bin'
            with patch.object(viewer._path_helper, 'launcher_directory', side_effect=local), patch.object(host, 'launcher_directory', side_effect=local), patch.object(viewer.shutil, 'which', return_value='/usr/bin/node'):
                for kind, folder in [('ide', 'viewer'), ('navi', 'aidiy_navi'), ('console', 'aidiy_console'), ('task', 'aidiy_task'), ('team', 'aidiy_team'), ('browser', 'aidiy_browser')]:
                    root = ROOT / 'frontend_ide' / folder
                    viewer.install_launcher(root, kind)
                    self.assertTrue(viewer.launcher_path(kind).is_file())
                    self.assertTrue(viewer.remove_launcher(root, kind))
                self.assertTrue(host.install_standalone_launcher())
                for kind in ('code', 'live'):
                    name = f'aidiy_{kind}' + ('.cmd' if os.name == 'nt' else '')
                    self.assertTrue((local(f'aidiy_{kind}') / name).is_file())

if __name__ == '__main__':
    unittest.main()
