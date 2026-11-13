# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE for full terms.
"""通常登録の15コマンドが旧共有bin優先でも同じ配置元を起動する回帰。"""
import base64
from contextlib import contextmanager, ExitStack
import importlib.util
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]


def load(relative):
    spec = importlib.util.spec_from_file_location('shared_integration_' + relative.replace('/', '_'), ROOT / relative)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class SharedLauncherIntegration(unittest.TestCase):
    @contextmanager
    def fixture(self, windows):
        with tempfile.TemporaryDirectory() as temp, ExitStack() as stack:
            home = Path(temp) / 'user home'; home.mkdir()
            checkout = home / 'checkout'; checkout.mkdir()
            shared = home / '.local/bin'; shared.mkdir(parents=True)
            modules = {name: load(path) for name, path in {
                'diag': 'frontend_diag/_setup.py', 'viewer': 'frontend_ide/viewer/launcher.py',
                'host': 'frontend_ide/host/_setup.py', 'avatar': 'frontend_avatar/_setup.py',
                'discord': 'frontend_channels/discord/launcher.py', 'slack': 'frontend_channels/slack/launcher.py',
                'hermes': 'command_hermes/_setup.py', 'ide': 'frontend_ide/_setup.py',
                'root': '_setup.py',
            }.items()}
            entries = {
                'diag': 'frontend_diag/diag_main.mjs', 'memo': 'frontend_diag/memo_main.mjs',
                'avatar': 'frontend_avatar/launch.mjs', 'hermes': 'command_hermes/cli_main.py',
                'discord': 'frontend_channels/discord/panel/launch.mjs',
                'slack': 'frontend_channels/slack/panel/launch.mjs',
                'code': 'frontend_ide/host/aidiy_code/launch.mjs',
                'live': 'frontend_ide/host/aidiy_live/launch.mjs',
            }
            entries.update({name: 'frontend_ide/' + ('viewer' if name == 'ide' else 'aidiy_' + name) + '/launch.mjs'
                            for name in ('ide', 'console', 'browser', 'navi', 'task', 'team', 'cpu')})
            for relative in entries.values():
                script = checkout / relative; script.parent.mkdir(parents=True, exist_ok=True)
                script.write_text('// fixture', encoding='utf-8')
            local = lambda name: checkout / '_AIDIY' / name / 'bin'
            stack.enter_context(patch.object(Path, 'home', return_value=home))
            stack.enter_context(patch.object(sys, 'platform', 'win32' if windows else 'linux'))
            stack.enter_context(patch.object(shutil, 'which', return_value='/new node/node'))
            stack.enter_context(patch('builtins.print'))
            path_calls = {}
            for name in ('diag', 'viewer', 'host', 'avatar', 'discord', 'slack', 'hermes'):
                module = modules[name]
                path_calls[name] = stack.enter_context(patch.object(module, 'ensure_launcher_path', return_value=True))
                if name != 'hermes':
                    stack.enter_context(patch.object(getattr(module, '_path_helper', module), 'launcher_directory', side_effect=local))
            stack.enter_context(patch.object(modules['diag'], 'THIS_DIR', checkout / 'frontend_diag'))
            stack.enter_context(patch.object(modules['host'], 'FRONTEND_VSCODE_DIR', checkout / 'frontend_ide/host'))
            stack.enter_context(patch.object(modules['avatar'], 'FRONTEND_AVATAR_DIR', checkout / 'frontend_avatar'))
            stack.enter_context(patch.object(modules['hermes'], 'BACKEND_HERMES_DIR', checkout / 'command_hermes'))
            stack.enter_context(patch.object(modules['ide'], 'ROOT', checkout / 'frontend_ide'))
            stack.enter_context(patch.object(modules['ide'], 'load_setup_module', return_value=modules['viewer']))
            suffix = '.cmd' if windows else ''
            paths = {name: (shared if name == 'hermes' else local('aidiy_' + name)) / ('aidiy_' + name + suffix)
                     for name in entries}
            yield modules, checkout, shared, entries, paths, path_calls, stack

    def register_all(self, modules):
        self.assertTrue(modules['diag'].setup(desktop=False))
        self.assertTrue(modules['avatar'].install_standalone_launcher())
        self.assertTrue(modules['hermes'].install_standalone_launcher())
        # 通常IDE setupと同じ一括登録。内部はregister_path=Falseで9コマンドを生成。
        self.assertTrue(modules['ide'].register_launchers(modules['host']))
        modules['discord'].install_launcher(modules['diag'].THIS_DIR.parent / 'frontend_channels/discord')
        modules['slack'].install_launcher(modules['diag'].THIS_DIR.parent / 'frontend_channels/slack')

    def test_all_fifteen_shared_first_launchers_refresh_twice(self):
        for windows in (False, True):
            with self.subTest(windows=windows), self.fixture(windows) as (modules, checkout, shared, entries, paths, _, stack):
                self.register_all(modules)
                self.assertEqual(len(paths), 15)
                original = {name: path.read_bytes() for name, path in paths.items()}
                for name, path in paths.items():
                    if name == 'hermes':
                        # 正規の共有bin配置も毎回上書きされる。
                        path.write_text('stale hermes', encoding='utf-8')
                        continue
                    target = shared / path.name
                    if name in ('diag', 'memo'):
                        old_entry = checkout / 'backend_diag' / Path(entries[name]).name
                        data = modules['diag'].launcher_content(old_entry, windows).encode()
                    elif name == 'avatar':
                        old_entry = checkout / 'frontend_avatar/_start.py'
                        if windows:
                            data = ('@echo off\r\nsetlocal EnableExtensions DisableDelayedExpansion\r\n'
                                    + modules['avatar'].launcher_owner_comment(old_entry) + '\r\n'
                                    + modules['avatar'].windows_launcher_command(['/old python/python', '-X', 'utf8', str(old_entry)])
                                    + '\r\nexit /b %ERRORLEVEL%\r\n').encode()
                        else:
                            data = ('#!/usr/bin/env sh\nexec ' + shlex.quote('/old python/python') + ' -X utf8 '
                                    + shlex.quote(str(old_entry)) + ' "$@"\n').encode()
                    else:
                        data = original[name]
                        if windows:
                            text = data.decode(); payload = re.search(r"Buffer\.from\('([A-Za-z0-9+/=]+)','base64'\)", text)
                            command = json.loads(base64.b64decode(payload.group(1))); command[0] = '/old node/node'
                            text = text.replace(payload.group(1), base64.b64encode(json.dumps(command, ensure_ascii=False).encode()).decode())
                            data = text.encode()
                        else:
                            data = data.replace(b'/new node/node', b'/old node/node')
                    target.write_bytes(data)
                    if not windows: target.chmod(0o755)
                self.assertFalse((checkout / 'backend_diag').exists())
                # sharedが先頭のPATHを維持したまま2回実行する。
                path_value = os.pathsep.join([str(shared), *[str(path.parent) for path in paths.values()]])
                stack.enter_context(patch.dict(os.environ, {'PATH': path_value}))
                for _ in range(2):
                    self.register_all(modules)
                    self.assertEqual(os.environ['PATH'], path_value)
                    for name, path in paths.items():
                        with self.subTest(command=name):
                            selected = next(Path(folder) / path.name for folder in path_value.split(os.pathsep)
                                            if (Path(folder) / path.name).is_file())
                            self.assertEqual(selected, shared / path.name)
                            self.assertEqual(selected.read_bytes(), original[name])
                            self.assertEqual(path.read_bytes(), original[name])
                self.assertFalse((checkout / 'backend_diag').exists())

    def test_normal_root_setup_repairs_shared_diag_memo_before_desktop(self):
        for windows in (False, True):
            with self.subTest(windows=windows), self.fixture(windows) as (modules, checkout, shared, _, paths, _, stack):
                root, diag = modules['root'], modules['diag']
                for name in ('diag', 'memo'):
                    (shared / paths[name].name).write_bytes(diag.launcher_content(checkout / 'backend_diag' / (name + '_main.mjs'), windows).encode())
                choices = dict.fromkeys(('common', 'local', 'mcp', 'backend', 'taskteam', 'web', 'avatar', 'hermes', 'ide', 'continue_on_error'), False)
                choices['diag'] = True
                stack.enter_context(patch.object(root.sys, 'argv', ['_setup.py']))
                stack.enter_context(patch.object(root, 'collect_setup_choices', return_value=choices))
                stack.enter_context(patch.object(root, 'stop_setup_apps'))
                stack.enter_context(patch.object(root, 'ensure_prerequisites', return_value=True))
                stack.enter_context(patch('scripts.local_git_setup.ensure_local_git', return_value=('existing', 'fixture')))
                stack.enter_context(patch.object(root, '_load_folder_module', return_value=diag))
                stack.enter_context(patch.object(root, 'setup_channels', return_value=[]))
                stack.enter_context(patch.object(root, 'remove_folder_import_caches'))
                stack.enter_context(patch.object(root, 'run_diag_headless', return_value=True))
                stack.enter_context(patch.object(root.time, 'sleep'))
                summary = stack.enter_context(patch.object(root, 'print_setup_summary'))
                def desktop(**kwargs):
                    for name in ('diag', 'memo'):
                        expected = diag.launcher_content(checkout / 'frontend_diag' / (name + '_main.mjs'), windows).encode()
                        self.assertEqual((shared / paths[name].name).read_bytes(), expected)
                        self.assertEqual(paths[name].read_bytes(), expected)
                    return True
                stack.enter_context(patch.object(diag, 'setup_desktop', side_effect=desktop))
                for _ in range(2):
                    root.main()
                self.assertEqual(summary.call_count, 2)
                self.assertEqual(summary.call_args.args, ([],))
                self.assertFalse((checkout / 'backend_diag').exists())


if __name__ == '__main__':
    unittest.main()
