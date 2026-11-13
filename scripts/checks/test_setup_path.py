# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""実際のユーザー PATH を変更せず、登録・解除の境界を確認する。"""
import importlib.util
import contextlib
import io
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
        with tempfile.TemporaryDirectory() as directory, patch.object(helper.sys, 'platform', 'linux'), patch.dict(os.environ, {'PATH': '/existing'}), patch.object(Path, 'home', side_effect=AssertionError('home forbidden')):
            target = Path(directory) / '_AIDIY/aidiy_console/bin'
            self.assertTrue(helper.ensure_launcher_path(target))
            self.assertTrue(helper.ensure_launcher_path(target))
            self.assertEqual(os.environ['PATH'], str(target) + os.pathsep + '/existing')
            self.assertEqual(list(Path(directory).iterdir()), [])
            self.assertTrue(helper.remove_launcher_path(target))
            self.assertEqual(os.environ['PATH'], '/existing')
            self.assertTrue(helper.remove_launcher_path())

    def test_old_profile_and_launchers_are_preserved(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(helper.sys, 'platform', 'linux'), patch.dict(os.environ, {'HOME': directory, 'PATH': '/existing'}):
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



class WindowsProjectPathTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.directory = self.root / '日本語 project/_AIDIY/aidiy_cpu/bin'
        self.directory.mkdir(parents=True)
        self.original = r'%APPDATA%\npm;C:\Tools;;'
        self.registry = {'Path': (self.original, 2)}
        self.winreg = SimpleNamespace(HKEY_CURRENT_USER=1, KEY_QUERY_VALUE=1, KEY_SET_VALUE=2,
                                     REG_SZ=1, REG_EXPAND_SZ=2)
        self.winreg.CreateKeyEx = MagicMock(return_value=MagicMock())
        def read_value(key, name):
            if name not in self.registry:
                raise FileNotFoundError(name)
            return self.registry[name]
        self.winreg.QueryValueEx = Mock(side_effect=read_value)
        self.winreg.SetValueEx = Mock(side_effect=lambda key, name, reserved, kind, value:
                                      self.registry.update({name: (value, kind)}))
        self.winreg.DeleteValue = Mock(side_effect=lambda key, name: self.registry.pop(name))
        self.enterContext(patch.dict('sys.modules', {'winreg': self.winreg}))
        self.enterContext(patch.object(helper.sys, 'platform', 'win32'))
        self.enterContext(patch.object(Path, 'home', side_effect=AssertionError('home forbidden')))
        self.enterContext(patch.dict(os.environ, {'PATH': r'C:\SystemOnly'}))
        self.enterContext(patch.object(helper, '_notify_change'))
        self.output = self.enterContext(contextlib.redirect_stdout(io.StringIO()))

    def test_registration_is_idempotent_and_keeps_existing_user_path_exactly(self):
        for _ in range(2):
            self.assertTrue(helper.ensure_launcher_path(self.directory))
        self.assertEqual(self.registry['Path'], (self.original + str(self.directory), 2))
        self.assertNotIn('SystemOnly', self.registry['Path'][0])
        self.winreg.SetValueEx.assert_called_once()
        self.assertEqual(os.environ['PATH'], 'C:\\SystemOnly;' + str(self.directory))
        self.assertTrue(helper._state_file(self.directory).is_file())
        self.assertIn('開き直して', self.output.getvalue())
        for call in self.winreg.CreateKeyEx.call_args_list:
            self.assertEqual(call.args[:2], (self.winreg.HKEY_CURRENT_USER, 'Environment'))

    def test_cleanup_removes_only_our_addition_and_preserves_later_entries(self):
        self.assertTrue(helper.ensure_launcher_path(self.directory))
        entry = self.directory / 'aidiy_cpu.cmd'
        entry.touch()
        self.assertTrue(helper.remove_launcher_path(self.directory))
        self.assertTrue(helper._state_file(self.directory).exists())
        entry.unlink()
        self.registry['Path'] = (self.registry['Path'][0] + ';C:\\Later', 2)
        self.assertTrue(helper.remove_launcher_path(self.directory))
        self.assertEqual(self.registry['Path'], (self.original + ';C:\\Later', 2))
        self.assertFalse(helper._state_file(self.directory).exists())

    def test_preexisting_case_insensitive_entry_is_not_duplicated_or_removed(self):
        original = self.original + str(self.directory).upper().replace('/', '\\')
        self.registry['Path'] = (original, 1)
        self.assertTrue(helper.ensure_launcher_path(self.directory))
        self.assertFalse(helper._state_file(self.directory).exists())
        self.assertTrue(helper.remove_launcher_path(self.directory))
        self.assertEqual(self.registry['Path'], (original, 1))
        self.winreg.SetValueEx.assert_not_called()

    def test_missing_path_is_restored_to_missing_after_cleanup(self):
        self.registry.clear()
        self.assertTrue(helper.ensure_launcher_path(self.directory))
        self.assertEqual(self.registry['Path'], (str(self.directory), 2))
        self.assertTrue(helper.remove_launcher_path(self.directory))
        self.assertNotIn('Path', self.registry)

    def test_plain_string_path_type_is_preserved(self):
        self.registry['Path'] = (self.original, self.winreg.REG_SZ)
        self.assertTrue(helper.ensure_launcher_path(self.directory))
        self.assertEqual(self.registry['Path'][1], self.winreg.REG_SZ)
        self.assertTrue(helper.remove_launcher_path(self.directory))
        self.assertEqual(self.registry['Path'], (self.original, self.winreg.REG_SZ))

    def test_registry_failure_is_reported_without_changing_process_path(self):
        self.winreg.SetValueEx.side_effect = PermissionError('fixture denied')
        self.assertFalse(helper.ensure_launcher_path(self.directory))
        self.assertEqual(self.registry['Path'], (self.original, 2))
        self.assertEqual(os.environ['PATH'], r'C:\SystemOnly')
        self.assertIn('登録できません', self.output.getvalue())

    def test_normal_ide_setup_registers_all_nine_commands_without_home_files(self):
        group = load(ROOT / 'frontend_ide/_setup.py')
        launcher = load(ROOT / 'frontend_ide/viewer/launcher.py')
        with patch.object(helper.sys, 'platform', 'linux'):
            host = load(ROOT / 'frontend_ide/host/_setup.py')
        local = lambda name: self.root / 'checkout/_AIDIY' / name / 'bin'
        def child(name):
            if name == 'frontend_ide/viewer/launcher.py':
                return launcher
            return host if name == 'frontend_ide/host/_setup.py' else SimpleNamespace(setup=Mock(return_value=True))
        with patch.object(group, 'load_setup_module', side_effect=child), \
                patch.object(host, 'setup', return_value=True), \
                patch.object(launcher._path_helper, 'launcher_directory', side_effect=local), \
                patch.object(host, 'launcher_directory', side_effect=local), \
                patch.object(launcher, 'ensure_launcher_path', side_effect=helper.ensure_launcher_path), \
                patch.object(launcher.shutil, 'which', return_value='node.exe'):
            for _ in range(2):
                self.assertTrue(group.setup())
        self.assertEqual(self.winreg.SetValueEx.call_count, 9)
        for kind in ('ide', 'console', 'browser', 'navi', 'code', 'live', 'task', 'team', 'cpu'):
            directory = local('aidiy_' + kind)
            self.assertIn(str(directory), self.registry['Path'][0].split(';'))
            self.assertTrue((directory / f'aidiy_{kind}.cmd').is_file())
            self.assertTrue(helper._state_file(directory).is_file())
        self.assertTrue(self.registry['Path'][0].startswith(self.original))

    def test_code_live_cleanup_removes_only_the_selected_app_path(self):
        with patch.object(helper.sys, 'platform', 'linux'):
            cleanup = load(ROOT / 'frontend_ide/host/_cleanup.py')
        local = lambda name: self.root / 'checkout/_AIDIY' / name / 'bin'
        for kind in ('code', 'live'):
            directory = local('aidiy_' + kind)
            directory.mkdir(parents=True)
            (directory / f'aidiy_{kind}.cmd').write_text('fixture', encoding='utf-8')
            self.assertTrue(helper.ensure_launcher_path(directory))
        with patch.object(cleanup, 'FRONTEND_VSCODE_DIR', self.root / 'checkout/frontend_ide/host'), \
                patch.object(cleanup, 'launcher_directory', side_effect=local), \
                patch.object(cleanup, 'uninstall_extension', return_value=(True, 0)), \
                patch.object(cleanup, 'stop_standalone_processes', return_value=True), \
                patch.object(cleanup, 'remove_launcher_path', side_effect=helper.remove_launcher_path):
            self.assertTrue(cleanup.cleanup_app('code', report=False))
            self.assertNotIn(str(local('aidiy_code')), self.registry['Path'][0])
            self.assertFalse(helper._state_file(local('aidiy_code')).exists())
            self.assertTrue((local('aidiy_live') / 'aidiy_live.cmd').exists())
            self.assertIn(str(local('aidiy_live')), self.registry['Path'][0])
            self.assertTrue(cleanup.cleanup_app('live', report=False))
        self.assertEqual(self.registry['Path'], (self.original, 2))

    def test_diag_cleanup_keeps_foreign_launcher_then_removes_owned_path(self):
        cleanup = load(ROOT / 'frontend_diag/_cleanup.py')
        root = self.root / 'checkout/frontend_diag'
        root.mkdir(parents=True)
        directory = self.root / 'checkout/_AIDIY/aidiy_diag/bin'
        directory.mkdir(parents=True)
        launcher = directory / 'aidiy_diag.cmd'
        launcher.write_text('another checkout', encoding='utf-8')
        self.assertTrue(helper.ensure_launcher_path(directory))
        with patch.object(cleanup, '__file__', str(root / '_cleanup.py')), \
                patch.object(cleanup._path_helper, 'launcher_directory', return_value=directory), \
                patch.object(cleanup, 'stop_processes', return_value=True), \
                patch.object(cleanup, 'cleanup_dependencies', return_value=True), \
                patch.object(cleanup, 'remove_launcher_path', side_effect=helper.remove_launcher_path):
            self.assertTrue(cleanup.cleanup())
            self.assertTrue(launcher.exists())
            self.assertIn(str(directory), self.registry['Path'][0])
            marker = 'aidiy_diag-owner:' + cleanup.hashlib.sha256(str(root / 'diag_main.mjs').encode('utf-8')).hexdigest()
            launcher.write_text(marker, encoding='utf-8')
            self.assertTrue(cleanup.cleanup())
        self.assertFalse(launcher.exists())
        self.assertFalse(helper._state_file(directory).exists())
        self.assertEqual(self.registry['Path'], (self.original, 2))


class LauncherIntegrationTests(unittest.TestCase):
    def test_all_ide_launchers_stay_project_local(self):
        viewer = load(ROOT / 'frontend_ide/viewer/launcher.py')
        host = load(ROOT / 'frontend_ide/host/_setup.py')
        with tempfile.TemporaryDirectory() as directory, patch.object(helper.sys, 'platform', 'linux'), patch.object(Path, 'home', side_effect=AssertionError('home forbidden')), patch.dict(os.environ):
            def local(name):
                return Path(directory) / '_AIDIY' / name / 'bin'
            with patch.object(viewer._path_helper, 'launcher_directory', side_effect=local), patch.object(host, 'launcher_directory', side_effect=local), patch.object(viewer.shutil, 'which', return_value='/usr/bin/node'):
                for kind, folder in [('ide', 'viewer'), ('navi', 'aidiy_navi'), ('console', 'aidiy_console'), ('task', 'aidiy_task'), ('team', 'aidiy_team'), ('browser', 'aidiy_browser'), ('cpu', 'aidiy_cpu')]:
                    root = ROOT / 'frontend_ide' / folder
                    viewer.install_launcher(root, kind)
                    self.assertTrue(viewer.launcher_path(kind).is_file())
                    self.assertTrue(viewer.remove_launcher(root, kind))
                self.assertTrue(host.install_standalone_launcher())
                for kind in ('code', 'live'):
                    name = f'aidiy_{kind}'
                    self.assertTrue((local(f'aidiy_{kind}') / name).is_file())

if __name__ == '__main__':
    unittest.main()
