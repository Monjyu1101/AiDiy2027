# -*- coding: utf-8 -*-
#
# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""Slack のセットアップ・起動・停止と、限定された cleanup 対象を検証する（Discord の test_lifecycle.py の双子）。"""
import contextlib
import importlib.util
import io
import json
import subprocess
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[3]
FRONTEND = ROOT / 'frontend_channels' / 'slack'


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


slack_start = load('slack_start_test', FRONTEND / '_start.py')
slack_setup = load('slack_setup_test', FRONTEND / '_setup.py')
slack_cleanup = load('slack_cleanup_test', FRONTEND / '_cleanup.py')
processes = load('slack_processes_test', FRONTEND / 'slack_processes.py')
launcher = load('slack_launcher_test', FRONTEND / 'launcher.py')


class SlackSetupTest(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch.object(slack_setup, "check_project_node_runtime", return_value=(True, "fixture Node")))
        self.enterContext(contextlib.redirect_stdout(io.StringIO()))
        self.enterContext(patch.object(slack_setup, '_slack_in_use', return_value=False))
        self.enterContext(patch.object(slack_setup.shutil, 'which', return_value='npm'))
        self.run = self.enterContext(patch.object(slack_setup.subprocess, 'run'))
        self.prepare = self.enterContext(patch.object(slack_setup, 'prepare_electron_binary', return_value=True))
        self.launcher = self.enterContext(patch.object(slack_setup, 'install_launcher'))
        # 共通設定・実ランチャーへ書き込まず、呼び出し順だけを確認する。
        self.enterContext(patch.object(slack_setup.importlib.util, 'spec_from_file_location', return_value=Mock()))
        self.enterContext(patch.object(slack_setup.importlib.util, 'module_from_spec', return_value=Mock()))

    def test_same_steps_as_discord_before_binary_preparation(self):
        calls = Mock()
        calls.attach_mock(self.run, 'npm')
        calls.attach_mock(self.prepare, 'prepare')
        self.assertTrue(slack_setup.setup())
        self.assertEqual([call.args[0] for call in self.run.call_args_list], [
            ['npm', 'ci', '--include=dev', '--no-fund', '--no-audit'],
            ['npm', 'run', 'update:electron'],
            ['npm', 'run', 'build:panel'],
            ['npm', 'run', 'check:panel'],
        ])
        for call in self.run.call_args_list:
            self.assertEqual(call.kwargs['env']['ELECTRON_SKIP_BINARY_DOWNLOAD'], '1')
        self.assertEqual([call[0] for call in calls.mock_calls], ['npm', 'npm', 'npm', 'npm', 'prepare'])
        self.launcher.assert_called_once()

    def test_failed_step_does_not_prepare_binary_or_publish_launcher(self):
        for failed_step in ('update:electron', 'build:panel', 'check:panel'):
            with self.subTest(failed_step=failed_step):
                self.run.reset_mock()
                def run(command, **kwargs):
                    if command[-1] == failed_step:
                        raise subprocess.CalledProcessError(1, command)
                self.run.side_effect = run
                self.assertFalse(slack_setup.setup())
                self.prepare.assert_not_called()
                self.launcher.assert_not_called()

    def test_running_panel_keeps_dependencies(self):
        with patch.object(slack_setup, '_slack_in_use', return_value=True):
            self.assertFalse(slack_setup.setup())
        self.run.assert_not_called()


class SlackLifecycleTest(unittest.TestCase):
    def test_stop_failure_preserves_dependencies(self):
        with patch.object(slack_cleanup, 'stop_slack_processes', return_value=False), patch.object(
            slack_cleanup, 'remove_directory'
        ) as remove, contextlib.redirect_stdout(io.StringIO()):
            self.assertFalse(slack_cleanup.cleanup())
        remove.assert_not_called()
        with patch.object(slack_start, 'stop_slack_processes', return_value=False):
            with self.assertRaises(RuntimeError):
                slack_start.kill_ports()

    def test_unselected_slack_is_left_untouched(self):
        with patch.object(slack_cleanup, 'stop_slack_processes') as stop:
            self.assertTrue(slack_cleanup.cleanup({'slack': False}))
        stop.assert_not_called()

    def test_cleanup_only_removes_generated_files_inside_component(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder).resolve()
            component = root / 'frontend_channels' / 'slack'; component.mkdir(parents=True)
            for name in slack_cleanup.TARGETS:
                target = component / name; target.mkdir(); (target / 'dummy').write_text('test', encoding='utf-8')
            source = component / 'src'; source.mkdir(); (source / 'main.ts').write_text('source', encoding='utf-8')
            (component / 'package-lock.json').write_text('{}', encoding='utf-8')
            (root / '_config').mkdir(); key = root / '_config/AiDiy_key.json'; key.write_text('keep', encoding='utf-8')
            with patch.object(slack_cleanup, 'THIS_DIR', component), patch.object(
                slack_cleanup, 'stop_slack_processes', return_value=True
            ), patch.object(slack_cleanup, 'remove_launcher', return_value=True), patch.object(
                slack_cleanup.shutil, 'rmtree', wraps=slack_cleanup.shutil.rmtree
            ) as remove, contextlib.redirect_stdout(io.StringIO()):
                self.assertFalse(slack_cleanup.remove_directory(root / '_config'))
                self.assertFalse(slack_cleanup.remove_directory(component))
                remove.assert_not_called()
                self.assertTrue(slack_cleanup.cleanup())
            self.assertEqual(key.read_text(encoding='utf-8'), 'keep')
            self.assertTrue((source / 'main.ts').exists()); self.assertTrue((component / 'package-lock.json').exists())
            self.assertTrue(all(not (component / name).exists() for name in slack_cleanup.TARGETS))
            self.assertIn('out', slack_cleanup.TARGETS, 'ブラウザ版の保存 profile も Discord と同じく削除対象')

    def test_launch_uses_panel_entry_and_auto_connect_flags_like_discord(self):
        with patch.object(slack_start, 'check_project_node_runtime', return_value=(True, 'fixture Node')), patch.object(
            slack_start.shutil, 'which', return_value='node'
        ), patch.object(slack_start.Path, 'is_file', return_value=True), patch.dict(
            'sys.modules', {'_setup_electron': Mock(electron_binary_ready=Mock(return_value=True))}
        ):
            command = slack_start.launch_command()
            self.assertEqual(command[-1], str(FRONTEND / 'panel/launch.mjs'))
            with patch.object(slack_start.subprocess, 'run', return_value=Mock(returncode=0)) as run:
                self.assertTrue(slack_start.check_environment()[0])
            self.assertEqual(run.call_args.args[0][-1], '--check')
            with patch.object(slack_start.subprocess, 'Popen') as spawn:
                slack_start.start()
            self.assertEqual(spawn.call_args.args[0], command + ['--no-connect'])
            self.assertNotIn('shell', spawn.call_args.kwargs)
            with patch.object(slack_start.subprocess, 'Popen') as spawn:
                slack_start.start(auto_connect=True)
            self.assertEqual(spawn.call_args.args[0], command + ['--connect'])
            self.assertEqual(spawn.call_args.kwargs['cwd'], ROOT, '全体起動ではリポジトリ直下をプロジェクトにする')


class SlackProcessMatchingTest(unittest.TestCase):
    def owned(self, command, name='node.exe'):
        return processes.is_slack_process(dict(Name=name, CommandLine=command), FRONTEND, True)

    def test_preserved_slack_tree_contains_hermes_and_mcp_only(self):
        records = [
            dict(ProcessId=10, ParentProcessId=1, Name='node.exe', CommandLine=f'node.exe "{FRONTEND / "src/panel-worker.ts"}"'),
            dict(ProcessId=11, ParentProcessId=10, Name='python.exe', CommandLine='python.exe hermes'),
            dict(ProcessId=12, ParentProcessId=11, Name='python.exe', CommandLine='python.exe mcp_stdio.py'),
            dict(ProcessId=20, ParentProcessId=1, Name='node.exe', CommandLine=f'node.exe "{FRONTEND.parent / "discord/src/panel-worker.ts"}"'),
            dict(ProcessId=21, ParentProcessId=20, Name='python.exe', CommandLine='python.exe mcp_stdio.py'),
        ]
        with patch.object(processes, 'list_processes', return_value=records), patch.object(processes.sys, 'platform', 'win32'):
            self.assertEqual(processes.slack_tree_pids(FRONTEND), {10, 11, 12})

    def test_bot_and_npm_entrypoints(self):
        main = FRONTEND / 'src/main.ts'; cli = FRONTEND / 'node_modules/tsx/dist/cli.mjs'; loader = FRONTEND / 'node_modules/tsx/dist/loader.mjs'
        for command in (
            f'node.exe --import "{loader.as_uri()}" "{main}"',
            f'node.exe "{cli}" "{main}"',
            f'node.exe "{cli}" src/main.ts',
        ):
            self.assertTrue(self.owned(command), command)

    def test_discord_other_checkouts_and_script_arguments_are_excluded(self):
        main = FRONTEND / 'src/main.ts'; cli = FRONTEND / 'node_modules/tsx/dist/cli.mjs'
        discord = FRONTEND.parent / 'discord'
        for command in (
            f'node.exe other.js "{main}"', f'node.exe "{main}.other"', f'node.exe "{cli}" checks/code.test.ts',
            'node.exe src/main.ts', f'node.exe --eval "{main}"',
            f'node.exe "{discord / "src/main.ts"}"', f'node.exe "{discord / "panel/launch.mjs"}"',
        ):
            self.assertFalse(self.owned(command), command)
        self.assertFalse(self.owned(f'electron.exe "{discord / "panel/desktop.cjs"}"', 'electron.exe'))

    def test_panel_worker_and_electron_match_only_this_checkout(self):
        for entry, name in (('panel/launch.mjs', 'node.exe'), ('src/panel-worker.ts', 'node.exe'), ('src/web-server.ts', 'node.exe'), ('panel/desktop.cjs', 'electron.exe')):
            self.assertTrue(self.owned(f'{name} "{FRONTEND / entry}"', name))
            self.assertFalse(self.owned(f'{name} "{FRONTEND}.other/{entry}"', name))
            self.assertFalse(self.owned(f'{name} other.js "{FRONTEND / entry}"', name))


class SlackLauncherTest(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch.object(launcher, 'ensure_launcher_path', return_value=True))
        self.enterContext(patch.object(launcher, 'remove_launcher_path', return_value=True))
        self.enterContext(contextlib.redirect_stdout(io.StringIO()))

    def test_package_name_and_module_names_stay_separate_from_discord(self):
        self.assertEqual(json.loads((FRONTEND / 'package.json').read_text(encoding='utf-8'))['name'], 'aidiy-slack')
        discord_scripts = json.loads((FRONTEND.parent / 'discord' / 'package.json').read_text(encoding='utf-8'))['scripts']
        slack_scripts = json.loads((FRONTEND / 'package.json').read_text(encoding='utf-8'))['scripts']
        for name in ('start', 'bot', 'config:check', 'check', 'test', 'build:panel', 'check:panel', 'update:electron'):
            self.assertIn(name, discord_scripts, name); self.assertIn(name, slack_scripts, name)
        self.assertEqual(slack_scripts['start'], discord_scripts['start'])

    def test_launcher_keeps_command_and_folder_for_windows_and_linux(self):
        for platform in ('win32', 'linux'):
            with self.subTest(platform=platform), tempfile.TemporaryDirectory() as directory:
                root = Path(directory) / 'project with spaces' / 'frontend_channels' / 'slack'
                (root / 'panel').mkdir(parents=True)
                (root / 'panel/launch.mjs').write_text('// fixture', encoding='utf-8')
                command = Path(directory) / ('aidiy_slack.cmd' if platform == 'win32' else 'aidiy_slack')
                with patch.object(launcher, 'launcher_path', return_value=command), patch.object(launcher.sys, 'platform', platform), patch.object(launcher.shutil, 'which', return_value='node'):
                    launcher.install_launcher(root)
                    content = command.read_text(encoding='utf-8')
                    self.assertIn(str(root / 'panel/launch.mjs'), content)
                    self.assertIn('%*' if platform == 'win32' else '"$@"', content)
                    self.assertTrue(launcher.remove_launcher(root))
                    self.assertFalse(command.exists())

    def test_cleanup_preserves_launcher_for_another_checkout(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'aidiy_slack.cmd'
            file.write_text('node "D:/Other/frontend_channels/slack/panel/launch.mjs"', encoding='utf-8')
            with patch.object(launcher, 'launcher_path', return_value=file):
                self.assertTrue(launcher.remove_launcher(FRONTEND))
                self.assertTrue(file.exists())
                file.write_text(f'node "{FRONTEND / "panel/launch.mjs"}"', encoding='utf-8')
                self.assertTrue(launcher.remove_launcher(FRONTEND))
                self.assertFalse(file.exists())


if __name__ == '__main__':
    unittest.main()
