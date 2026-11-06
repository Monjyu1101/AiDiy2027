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
    def setUp(self):
        self.temp = self.enterContext(tempfile.TemporaryDirectory())
        self.directory = Path(self.temp) / '.local' / 'bin'
        self.directory.mkdir(parents=True)
        self.value = (r'%USERPROFILE%\tools;', 2)
        key = MagicMock()
        self.registry = SimpleNamespace(
            HKEY_CURRENT_USER='user', KEY_QUERY_VALUE=1, KEY_SET_VALUE=2,
            REG_SZ=1, REG_EXPAND_SZ=2,
            CreateKeyEx=Mock(return_value=key),
            QueryValueEx=Mock(side_effect=self.query),
            SetValueEx=Mock(side_effect=self.write),
            DeleteValue=Mock(side_effect=self.delete),
        )
        self.enterContext(patch.dict('sys.modules', {'winreg': self.registry, 'msvcrt': SimpleNamespace()}))
        self.enterContext(patch.object(helper.sys, 'platform', 'win32'))
        self.enterContext(patch.dict(os.environ, {'PATH': r'C:\Windows\System32',
                                                'USERPROFILE': self.temp}))
        self.notify = self.enterContext(patch.object(helper, '_notify_environment_change'))
        self.enterContext(patch('builtins.print'))

    def query(self, *_):
        if self.value is None:
            raise FileNotFoundError('Path')
        return self.value

    def write(self, key, name, reserved, kind, value):
        self.value = (value, kind)

    def delete(self, *_):
        self.value = None

    def register(self):
        self.assertTrue(helper.ensure_launcher_path(self.directory))

    def test_preserves_user_value_type_and_does_not_copy_system_path(self):
        self.register()
        self.assertEqual(self.value, (r'%USERPROFILE%\tools;' + str(self.directory), 2))
        self.assertEqual(os.environ['PATH'], r'C:\Windows\System32;' + str(self.directory))
        self.notify.assert_called_once()

    def test_missing_value_is_created_and_deleted_on_cleanup(self):
        self.value = None
        self.register()
        self.assertEqual(self.value, (str(self.directory), 2))
        self.assertTrue(helper.remove_launcher_path(self.directory))
        self.assertIsNone(self.value)
        self.registry.DeleteValue.assert_called_once()

    def test_empty_existing_value_remains_a_value(self):
        self.value = ('', 1)
        self.register()
        self.assertTrue(helper.remove_launcher_path(self.directory))
        self.assertEqual(self.value, ('', 1))
        self.registry.DeleteValue.assert_not_called()

    def test_rerun_does_not_duplicate_or_lose_original_value(self):
        original = self.value
        self.register()
        self.register()
        self.registry.SetValueEx.assert_called_once()
        self.assertTrue(helper.remove_launcher_path(self.directory))
        self.assertEqual(self.value, original)
        self.assertFalse(helper._state_file(self.directory).exists())
        self.assertEqual(os.environ['PATH'], r'C:\Windows\System32')

    def test_existing_expanded_case_and_slash_variant_is_not_owned(self):
        self.value = (r'"%USERPROFILE%\.LOCAL\BIN\"', 2)
        self.register()
        self.registry.SetValueEx.assert_not_called()
        self.assertFalse(helper._state_file(self.directory).exists())
        self.assertTrue(helper.remove_launcher_path(self.directory))
        self.registry.DeleteValue.assert_not_called()

    def test_process_path_presence_does_not_replace_persistent_check(self):
        os.environ['PATH'] = str(self.directory)
        self.register()
        self.registry.SetValueEx.assert_called_once()
        self.assertEqual(os.environ['PATH'], str(self.directory))

    def test_stale_process_is_updated_when_user_path_already_registered(self):
        self.value = (str(self.directory), 1)
        self.register()
        self.registry.SetValueEx.assert_not_called()
        self.assertIn(str(self.directory), os.environ['PATH'])

    def test_access_denied_fails_without_overwriting_path(self):
        self.registry.SetValueEx.side_effect = PermissionError('denied')
        original = self.value
        self.assertFalse(helper.ensure_launcher_path(self.directory))
        self.assertEqual(self.value, original)
        self.assertEqual(os.environ['PATH'], r'C:\Windows\System32')

    def test_state_write_failure_prevents_path_write(self):
        with patch.object(Path, 'write_text', side_effect=PermissionError('denied')):
            self.assertFalse(helper.ensure_launcher_path(self.directory))
        self.registry.SetValueEx.assert_not_called()

    def test_notification_failure_does_not_undo_persisted_path(self):
        self.notify.side_effect = OSError('notify failed')
        self.register()
        self.assertIn(str(self.directory), self.value[0])

    def test_shared_bin_keeps_path_until_last_file_is_removed(self):
        self.register()
        for name in ('aidiy_code.cmd', 'other-tool.exe'):
            with self.subTest(name=name):
                launcher = self.directory / name
                launcher.write_text('fixture', encoding='utf-8')
                registered = self.value
                self.assertTrue(helper.remove_launcher_path(self.directory))
                self.assertEqual(self.value, registered)
                self.assertTrue(helper._state_file(self.directory).exists())
                launcher.unlink()
        self.assertTrue(helper.remove_launcher_path(self.directory))
        self.assertEqual(self.value, (r'%USERPROFILE%\tools;', 2))

    def test_cleanup_preserves_path_entries_added_after_setup(self):
        self.register()
        self.value = (self.value[0] + r';C:\later', 2)
        self.assertTrue(helper.remove_launcher_path(self.directory))
        self.assertEqual(self.value, (r'%USERPROFILE%\tools;C:\later', 2))

    def test_cleanup_failure_keeps_ownership_for_retry(self):
        self.register()
        self.registry.SetValueEx.side_effect = PermissionError('denied')
        self.assertFalse(helper.remove_launcher_path(self.directory))
        self.assertTrue(helper._state_file(self.directory).exists())

    def test_invalid_state_does_not_modify_registry(self):
        state = helper._state_file(self.directory)
        state.write_text(json.dumps({'directory': 'elsewhere'}), encoding='utf-8')
        self.assertFalse(helper.remove_launcher_path(self.directory))
        self.registry.SetValueEx.assert_not_called()
        self.assertTrue(state.exists())

    def test_non_windows_uses_shell_profiles_instead_of_registry(self):
        with patch.object(helper.sys, 'platform', 'linux'), \
                patch.object(helper, '_ensure_posix_path', return_value=True) as register, \
                patch.object(helper, '_remove_posix_path', return_value=True) as remove:
            self.register()
            self.assertTrue(helper.remove_launcher_path(self.directory))
        register.assert_called_once_with(self.directory)
        remove.assert_called_once_with(self.directory)
        self.registry.CreateKeyEx.assert_not_called()
        self.assertEqual(os.environ['PATH'], r'C:\Windows\System32')

    def test_diag_setup_calls_registration_and_propagates_failure(self):
        setup = load(ROOT / 'backend_diag/_setup.py')
        with patch.object(Path, 'home', return_value=Path(self.temp)), \
                patch.object(setup, 'ensure_launcher_path', return_value=False) as register, \
                patch.object(setup, 'setup_desktop') as desktop:
            self.assertFalse(setup.setup())
        register.assert_called_once_with(self.directory)
        desktop.assert_not_called()

    def test_diag_cleanup_unlinks_launcher_then_removes_owned_path(self):
        self.register()
        setup = load(ROOT / 'backend_diag/_setup.py')
        cleanup = load(ROOT / 'backend_diag/_cleanup.py')
        fixture = Path(self.temp) / 'checkout'
        fixture.mkdir()
        launcher = self.directory / 'aidiy_diag.cmd'
        launcher.write_text(setup.launcher_content(fixture / 'diag_main.mjs', True), encoding='utf-8')
        with patch.object(Path, 'home', return_value=Path(self.temp)), \
                patch.object(cleanup, '__file__', str(fixture / '_cleanup.py')), \
                patch.object(cleanup._path_helper, '_notify_environment_change'), \
                patch.object(cleanup, 'stop_processes', return_value=True):
            self.assertTrue(cleanup.cleanup())
        self.assertFalse(launcher.exists())
        self.assertEqual(self.value, (r'%USERPROFILE%\tools;', 2))

    def test_root_cleanup_rechecks_path_after_all_selected_launchers(self):
        self.register()
        cleanup = load(ROOT / '_cleanup.py')
        launchers = {'backend_diag': 'aidiy_diag.cmd', 'frontend_channels': 'aidiy_discord.cmd',
                     'frontend_channels/slack': 'aidiy_slack.cmd'}
        for name in launchers.values():
            (self.directory / name).write_text('fixture', encoding='utf-8')
        events = []

        def folder_cleanup(folder, _, **kwargs):
            events.append(folder)
            (self.directory / launchers[folder]).unlink()
            if folder == 'backend_diag':
                self.assertTrue(helper.remove_launcher_path(self.directory))
                self.assertTrue(helper._state_file(self.directory).exists())
            return True

        def remove_path():
            events.append('path')
            return helper.remove_launcher_path(self.directory)

        choices = dict.fromkeys(['diag', 'npm_uninstall', 'local', 'tools', 'backend',
                                 'taskteam', 'web', 'avatar', 'hermes', 'ide', 'channels'], False)
        choices.update(diag=True, channels=True)
        for name in ('stop_all_services', 'cleanup_backup', '_remove_folder_import_cache',
                     '_remove_root_python_caches'):
            self.enterContext(patch.object(cleanup, name))
        self.enterContext(patch.object(cleanup, 'cleanup_temp_directories', return_value=True))
        self.enterContext(patch.object(cleanup.time, 'sleep'))
        self.enterContext(patch.object(cleanup, '_run_folder_cleanup', side_effect=folder_cleanup))
        self.enterContext(patch.object(cleanup, 'remove_launcher_path', side_effect=remove_path))
        self.assertTrue(cleanup.execute_cleanup(ROOT, choices))
        self.assertEqual(events, ['backend_diag', 'frontend_channels', 'frontend_channels/slack', 'path'])
        self.assertEqual(self.value, (r'%USERPROFILE%\tools;', 2))

    def test_all_eight_launchers_register_resolve_and_unlink(self):
        self.enterContext(patch.object(Path, 'home', return_value=Path(self.temp)))
        project = Path(self.temp) / 'checkout with spaces'
        scripts = {
            'backend_diag': 'diag_main.mjs',
            'frontend_ide/viewer': 'launch.mjs',
            'frontend_ide/aidiy_console': 'launch.mjs',
            'frontend_channels': 'panel/launch.mjs',
            'frontend_ide/host': 'aidiy_code/launch.mjs',
            'frontend_avatar': 'launch.mjs',
            'command_hermes': 'pyproject.toml',
        }
        for folder, script in scripts.items():
            file = project / folder / script
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text('', encoding='utf-8')
        (project / 'command_hermes/pyproject.toml').write_text('[project]\nrequires-python = ">=3.13"\n', encoding='utf-8')
        live = project / 'frontend_ide/host/aidiy_live/launch.mjs'
        live.parent.mkdir()
        live.write_text('', encoding='utf-8')
        diag = load(ROOT / 'backend_diag/_setup.py')
        viewer = load(ROOT / 'frontend_ide/viewer/launcher.py')
        discord = load(ROOT / 'frontend_channels/launcher.py')
        host = load(ROOT / 'frontend_ide/host/_setup.py')
        avatar = load(ROOT / 'frontend_avatar/_setup.py')
        hermes = load(ROOT / 'command_hermes/_setup.py')
        for module in (diag, viewer, discord, host, avatar, hermes):
            self.enterContext(patch.object(module, 'ensure_launcher_path', side_effect=helper.ensure_launcher_path))
        self.enterContext(patch.object(diag, 'THIS_DIR', project / 'backend_diag'))
        self.enterContext(patch.object(host, 'FRONTEND_VSCODE_DIR', project / 'frontend_ide/host'))
        self.enterContext(patch.object(avatar, 'FRONTEND_AVATAR_DIR', project / 'frontend_avatar'))
        self.enterContext(patch.object(hermes, 'BACKEND_HERMES_DIR', project / 'command_hermes'))
        self.enterContext(patch.object(hermes, 'check_uv_installed', return_value=True))
        self.enterContext(patch.object(hermes, 'run_command', return_value=True))
        self.assertTrue(diag.setup(desktop=False))
        self.assertTrue(host.install_standalone_launcher())
        with patch.object(shutil, 'which', return_value='node.exe'):
            self.assertTrue(avatar.install_standalone_launcher())
        self.assertTrue(hermes.setup())
        with patch.object(shutil, 'which', return_value='node.exe'):
            viewer.install_launcher(project / 'frontend_ide/viewer')
            viewer.install_launcher(project / 'frontend_ide/aidiy_console', 'console')
            discord.install_launcher(project / 'frontend_channels')
        commands = ('diag', 'ide', 'console', 'code', 'live', 'avatar', 'hermes', 'discord')
        for command in commands:
            name = f'aidiy_{command}.cmd'
            # PATH / PATHEXT は Windows 形式で解釈し、POSIX の実行権限には依存しない。
            with patch.object(os, 'pathsep', ';'), patch.dict(os.environ, {'PATHEXT': '.COM;.EXE;.BAT;.CMD'}):
                resolved = shutil.which(name, mode=os.F_OK, path=os.environ['PATH'])
            self.assertEqual(Path(resolved), self.directory / name)
        self.registry.SetValueEx.assert_called_once()

        diag_cleanup = load(ROOT / 'backend_diag/_cleanup.py')
        host_cleanup = load(ROOT / 'frontend_ide/host/_cleanup.py')
        avatar_cleanup = load(ROOT / 'frontend_avatar/_cleanup.py')
        hermes_cleanup = load(ROOT / 'command_hermes/_cleanup.py')
        for module in (diag_cleanup, viewer, discord, host_cleanup, avatar_cleanup, hermes_cleanup):
            self.enterContext(patch.object(module, 'remove_launcher_path', side_effect=helper.remove_launcher_path))
        self.enterContext(patch.object(host_cleanup, 'FRONTEND_VSCODE_DIR', project / 'frontend_ide/host'))
        self.enterContext(patch.object(host_cleanup, 'uninstall_extension', return_value=(True, 0)))
        self.enterContext(patch.object(host_cleanup, 'stop_standalone_processes', return_value=True))
        self.enterContext(patch.object(avatar_cleanup, 'FRONTEND_AVATAR_DIR', project / 'frontend_avatar'))
        self.enterContext(patch.object(hermes_cleanup, 'BACKEND_HERMES_DIR', project / 'command_hermes'))
        self.enterContext(patch.object(diag_cleanup, '__file__', str(project / 'backend_diag/_cleanup.py')))
        self.enterContext(patch.object(diag_cleanup, 'stop_processes', return_value=True))
        self.assertTrue(viewer.remove_launcher(project / 'frontend_ide/viewer'))
        self.assertTrue(viewer.remove_launcher(project / 'frontend_ide/aidiy_console', 'console'))
        self.assertTrue(discord.remove_launcher(project / 'frontend_channels'))
        self.assertTrue(host_cleanup.cleanup_app('code', report=False))
        self.assertTrue(host_cleanup.cleanup_app('live', report=False))
        self.assertTrue(avatar_cleanup.cleanup())
        self.assertTrue(hermes_cleanup.cleanup({}))
        self.assertTrue(helper._state_file(self.directory).exists())
        self.assertTrue(diag_cleanup.cleanup())
        self.assertEqual(list(self.directory.iterdir()), [])
        self.assertEqual(self.value, (r'%USERPROFILE%\tools;', 2))
        self.assertFalse(helper._state_file(self.directory).exists())

    def test_avatar_cleanup_preserves_other_checkout_launcher(self):
        cleanup = load(ROOT / 'frontend_avatar/_cleanup.py')
        file = self.directory / 'aidiy_avatar.cmd'
        file.write_text('python "D:/other/frontend_avatar/_start.py"', encoding='utf-8')
        with patch.object(Path, 'home', return_value=Path(self.temp)):
            self.assertTrue(cleanup.remove_standalone_launcher())
        self.assertTrue(file.exists())


if __name__ == '__main__':
    unittest.main()
