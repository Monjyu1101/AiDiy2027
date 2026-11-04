# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""Mac / Linux の PATH 登録・解除とシェルからの起動を一時 HOME で確認する。"""
import importlib.util
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
import urllib.request  # Linux 上で darwin 分岐を模擬する前に標準ライブラリを初期化する。
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))


def load(path):
    spec = importlib.util.spec_from_file_location('posix_test_' + path.stem, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class PosixPathTests(unittest.TestCase):
    def setUp(self):
        self.home = Path(self.enterContext(tempfile.TemporaryDirectory())) / 'user space'
        self.home.mkdir()
        self.directory = self.home / '.local/bin'
        self.directory.mkdir(parents=True)
        self.helper = load(ROOT / 'scripts/_setup_path.py')
        self.enterContext(patch.object(Path, 'home', return_value=self.home))
        self.enterContext(patch.object(sys, 'platform', 'darwin'))
        self.enterContext(patch.dict(os.environ, {'HOME': str(self.home), 'PATH': '/usr/bin:/bin', 'SHELL': '/bin/zsh'}, clear=True))
        self.enterContext(patch('builtins.print'))

    def test_mac_profiles_idempotence_preserve_user_text_and_exact_cleanup(self):
        profiles = {'.zprofile': '# user\nexport USER_SETTING=1', '.zshrc': '# zsh\n\n', '.bash_profile': '# bash\n'}
        for name, text in profiles.items():
            (self.home / name).write_bytes(text.encode())
        self.assertTrue(self.helper.ensure_launcher_path(self.directory))
        first = {path: path.read_bytes() for path in self.helper.shell_profile_paths()}
        self.assertTrue(self.helper.ensure_launcher_path(self.directory))
        self.assertEqual(first, {path: path.read_bytes() for path in first})
        for content in first.values():
            self.assertEqual(content.count(self.helper.SHELL_PATH_BEGIN.encode()), 1)
        self.assertTrue(self.helper.remove_launcher_path(self.directory))
        for name, text in profiles.items():
            self.assertEqual((self.home / name).read_bytes(), text.encode())
        self.assertFalse((self.home / '.bashrc').exists())
        self.assertFalse(self.helper._state_file(self.directory).exists())

    def test_linux_bash_keeps_existing_login_priority_and_handles_inherited_path(self):
        (self.home / '.bash_login').write_text('# existing login\n', encoding='utf-8')
        os.environ['PATH'] = str(self.directory) + ':/usr/bin'
        with patch.object(sys, 'platform', 'linux'), patch.dict(os.environ, {'SHELL': '/bin/bash'}):
            self.assertTrue(self.helper.ensure_launcher_path(self.directory))
            self.assertEqual([p.name for p in self.helper.shell_profile_paths()], ['.bash_login', '.bashrc'])
            self.assertFalse((self.home / '.bash_profile').exists())
            self.assertFalse((self.home / '.profile').exists())
            self.assertIn(self.helper.SHELL_PATH_BEGIN, (self.home / '.bash_login').read_text(encoding='utf-8'))

    def test_linux_profile_and_zsh_custom_zdotdir(self):
        with patch.object(sys, 'platform', 'linux'), patch.dict(os.environ, {'SHELL': '/bin/bash'}):
            self.assertTrue(self.helper.ensure_launcher_path(self.directory))
            self.assertTrue((self.home / '.profile').exists())
            self.assertFalse((self.home / '.zshrc').exists())
        custom = self.home / 'zsh config'
        with patch.object(sys, 'platform', 'linux'), patch.dict(os.environ, {'SHELL': '/bin/zsh', 'ZDOTDIR': str(custom)}):
            self.assertTrue(self.helper.ensure_launcher_path(self.directory))
            self.assertTrue((custom / '.zshrc').exists())
            self.assertTrue((custom / '.zprofile').exists())
            self.assertTrue(self.helper.remove_launcher_path(self.directory))
            self.assertFalse((custom / '.zshrc').exists())
        self.assertFalse((self.home / '.profile').exists())

    def test_partial_cleanup_keeps_shared_path_and_later_user_edits(self):
        profile = self.home / '.zshrc'
        original = '# user\n'
        profile.write_bytes(original.encode())
        self.assertTrue(self.helper.ensure_launcher_path(self.directory))
        launcher = self.directory / 'aidiy_ide'
        launcher.write_text('fixture', encoding='utf-8')
        self.assertTrue(self.helper.remove_launcher_path(self.directory))
        self.assertIn(self.helper.SHELL_PATH_BEGIN, profile.read_text(encoding='utf-8'))
        later = 'export LATER=kept\n'
        profile.write_bytes(profile.read_bytes() + later.encode())
        launcher.unlink()
        self.assertTrue(self.helper.remove_launcher_path(self.directory))
        self.assertEqual(profile.read_bytes(), (original + later).encode())

    def test_write_failure_is_not_success_and_owned_metadata_allows_retry(self):
        with patch.object(Path, 'write_bytes', side_effect=PermissionError('read only')):
            self.assertFalse(self.helper.ensure_launcher_path(self.directory))
        self.assertTrue(self.helper._state_file(self.directory).exists())
        self.assertEqual(os.environ['PATH'], '/usr/bin:/bin')
        self.assertTrue(self.helper.ensure_launcher_path(self.directory))
        self.assertTrue(self.helper.remove_launcher_path(self.directory))

    def test_modified_owned_block_is_preserved_and_cleanup_can_retry(self):
        self.assertTrue(self.helper.ensure_launcher_path(self.directory))
        profile = self.home / '.zshrc'
        original = profile.read_bytes()
        profile.write_bytes(original.replace(b'export PATH=', b'export PATH="manual" #'))
        self.assertFalse(self.helper.remove_launcher_path(self.directory))
        self.assertTrue(self.helper._state_file(self.directory).exists())
        self.assertIn('manual', profile.read_text(encoding='utf-8'))
        profile.write_bytes(original)
        self.assertTrue(self.helper.remove_launcher_path(self.directory))

    def test_hermes_legacy_cleanup_does_not_reformat_unrelated_profiles(self):
        cleanup = load(ROOT / 'command_hermes/_cleanup.py')
        profile = self.home / '.zshrc'
        original = b'# user settings\n\n\n'
        profile.write_bytes(original)
        self.assertEqual(cleanup.cleanup_shell_path_entries('fixture'), (0, True))
        self.assertEqual(profile.read_bytes(), original)

    def test_root_repair_uses_launcher_actions_and_continues_after_failure(self):
        root = load(ROOT / '_setup.py')
        events = []
        def action(label):
            events.append(label)
            return False if label == 'backend_diag' else True
        def folder(name):
            return SimpleNamespace(
                setup=lambda **_: action(name),
                install_standalone_launcher=lambda: action(name),
                install_launcher=lambda *_: action(name))
        with patch.object(root, '_load_folder_module', side_effect=folder), patch.object(root.subprocess, 'run') as process:
            self.assertEqual(root.setup_launchers_only(), ['Diag'])
            process.assert_not_called()
        self.assertEqual(events, ['backend_diag', 'frontend_avatar', 'command_hermes', 'frontend_ide/aidiy_navi',
                                  'frontend_ide/aidiy_console',
                                  'frontend_ide/host', 'frontend_ide/viewer', 'frontend_ide/aidiy_task',
                                  'frontend_ide/aidiy_team', 'frontend_ide/aidiy_browser', 'frontend_channels',
                                  'frontend_channels/slack'])

    def test_root_repair_flag_does_not_enter_normal_setup(self):
        root = load(ROOT / '_setup.py')
        with patch.object(sys, 'argv', ['_setup.py', '--launchers-only']), \
                patch.object(root, 'setup_launchers_only', return_value=[]) as repair, \
                patch.object(root, 'collect_setup_choices') as normal:
            with self.assertRaises(SystemExit) as result:
                root.main()
            self.assertEqual(result.exception.code, 0)
            repair.assert_called_once(); normal.assert_not_called()

    @unittest.skipIf(os.name == 'nt', 'POSIX の実シェルで実行する試験')
    def test_real_shell_handles_spaces_quotes_dollars_and_does_not_duplicate_path(self):
        odd = self.home / "quote' dollar$ `literal`"
        self.assertTrue(self.helper.ensure_launcher_path(odd))
        shell = shutil.which('bash') or '/bin/sh'
        profile = self.home / '.zshrc'
        command = '. "$1"; . "$1"; printf "%s" "$PATH"'
        result = subprocess.run([shell, '-c', command, 'fixture', str(profile)], env=dict(os.environ, PATH='/usr/bin:/bin'), text=True, capture_output=True, check=True)
        self.assertEqual(result.stdout, str(odd) + ':/usr/bin:/bin')

    @unittest.skipIf(os.name == 'nt', 'POSIX の実シェルで8コマンドを実行する試験')
    def test_all_eight_launchers_resolve_execute_forward_arguments_and_unlink(self):
        self.check_all_launchers()

    @unittest.skipIf(os.name == 'nt', 'POSIX の実シェルで8コマンドを実行する試験')
    def test_linux_all_eight_launchers_resolve_execute_forward_arguments_and_unlink(self):
        with patch.object(sys, 'platform', 'linux'), patch.dict(os.environ, {'SHELL': '/bin/bash'}):
            self.check_all_launchers()

    def check_all_launchers(self):
        profile = self.home / ('.zshrc' if sys.platform == 'darwin' else '.bashrc')
        checkout = self.home / 'checkout with spaces'
        node = self.home / 'node fixture'
        # 本物のサービス・GUI の代わりに、渡された起動引数を出力する。
        stub = '#!' + sys.executable + '\nimport json,sys\nprint(json.dumps(sys.argv[1:]))\n'
        node.write_text(stub, encoding='utf-8'); node.chmod(0o755)
        files = {'backend_diag': 'diag_main.mjs', 'frontend_ide/viewer': 'launch.mjs',
                 'frontend_ide/aidiy_console': 'launch.mjs', 'frontend_channels': 'panel/launch.mjs',
                 'frontend_ide/host': 'aidiy_code/launch.mjs', 'frontend_avatar': 'launch.mjs',
                 'command_hermes': 'cli_main.py'}
        for folder, file in files.items():
            target = checkout / folder / file
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text('import json,sys;print(json.dumps(sys.argv))\n', encoding='utf-8')
        live = checkout / 'frontend_ide/host/aidiy_live/launch.mjs'
        live.parent.mkdir(); live.touch()
        py = checkout / 'command_hermes/.venv/bin/python'
        py.parent.mkdir(parents=True); py.write_text(stub, encoding='utf-8'); py.chmod(0o755)
        diag = load(ROOT / 'backend_diag/_setup.py')
        viewer = load(ROOT / 'frontend_ide/viewer/launcher.py')
        discord = load(ROOT / 'frontend_channels/launcher.py')
        host = load(ROOT / 'frontend_ide/host/_setup.py')
        avatar = load(ROOT / 'frontend_avatar/_setup.py')
        hermes = load(ROOT / 'command_hermes/_setup.py')
        for module in (diag, viewer, discord, host, avatar, hermes):
            self.enterContext(patch.object(module, 'ensure_launcher_path', side_effect=self.helper.ensure_launcher_path))
        self.enterContext(patch.object(diag, 'THIS_DIR', checkout / 'backend_diag'))
        self.enterContext(patch.object(host, 'FRONTEND_VSCODE_DIR', checkout / 'frontend_ide/host'))
        self.enterContext(patch.object(avatar, 'FRONTEND_AVATAR_DIR', checkout / 'frontend_avatar'))
        self.enterContext(patch.object(hermes, 'BACKEND_HERMES_DIR', checkout / 'command_hermes'))
        # node を PATH で要求する Diag / Code / Live 用にも同じスタブを使う。
        node_link = self.directory / 'node'; node_link.symlink_to(node)
        self.assertTrue(diag.setup(desktop=False))
        self.assertTrue(host.install_standalone_launcher())
        self.assertTrue(avatar.install_standalone_launcher())
        self.assertTrue(hermes.install_standalone_launcher())
        with patch.object(shutil, 'which', return_value=str(node)):
            viewer.install_launcher(checkout / 'frontend_ide/viewer')
            viewer.install_launcher(checkout / 'frontend_ide/aidiy_console', 'console')
            discord.install_launcher(checkout / 'frontend_channels')
        for kind in ('diag', 'ide', 'console', 'code', 'live', 'avatar', 'hermes', 'discord'):
            with self.subTest(kind=kind):
                launcher = self.directory / ('aidiy_' + kind)
                self.assertEqual(launcher.read_bytes().count(b'\r'), 0)
                self.assertTrue(os.access(launcher, os.X_OK))
                env = dict(os.environ, PATH='/usr/bin:/bin')
                command = '. "$1"; shift; exec "$@"'
                result = subprocess.run(['/bin/sh', '-c', command, 'fixture', str(profile),
                                         'aidiy_' + kind, '--test', '引数 with spaces', 'literal$'],
                                        env=env, text=True, capture_output=True, check=True)
                self.assertEqual(json.loads(result.stdout)[-3:], ['--test', '引数 with spaces', 'literal$'])
        self.assertTrue(viewer.remove_launcher(checkout / 'frontend_ide/viewer'))
        self.assertTrue(viewer.remove_launcher(checkout / 'frontend_ide/aidiy_console', 'console'))
        self.assertTrue(discord.remove_launcher(checkout / 'frontend_channels'))
        diag_cleanup = load(ROOT / 'backend_diag/_cleanup.py')
        self.enterContext(patch.object(diag_cleanup, '__file__', str(checkout / 'backend_diag/_cleanup.py')))
        self.assertTrue(diag_cleanup.cleanup())
        host_cleanup = load(ROOT / 'frontend_ide/host/_cleanup.py')
        self.enterContext(patch.object(host_cleanup, 'FRONTEND_VSCODE_DIR', checkout / 'frontend_ide/host'))
        self.enterContext(patch.object(host_cleanup, 'uninstall_extension', return_value=(True, 0)))
        self.enterContext(patch.object(host_cleanup, 'stop_standalone_processes', return_value=True))
        self.assertTrue(host_cleanup.cleanup_app('code', report=False))
        self.assertTrue(host_cleanup.cleanup_app('live', report=False))
        avatar_cleanup = load(ROOT / 'frontend_avatar/_cleanup.py')
        self.enterContext(patch.object(avatar_cleanup, 'FRONTEND_AVATAR_DIR', checkout / 'frontend_avatar'))
        self.assertTrue(avatar_cleanup.remove_standalone_launcher())
        hermes_cleanup = load(ROOT / 'command_hermes/_cleanup.py')
        self.enterContext(patch.object(hermes_cleanup, 'BACKEND_HERMES_DIR', checkout / 'command_hermes'))
        self.assertTrue(hermes_cleanup.cleanup({}))
        node_link.unlink()
        self.assertTrue(self.helper.remove_launcher_path(self.directory))
        self.assertEqual(list(self.directory.iterdir()), [])
        self.assertFalse(profile.exists())


if __name__ == '__main__':
    unittest.main()
