# -*- coding: utf-8 -*-
#
# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""Discord の全体起動・停止連携と、限定された cleanup 対象を検証する。"""
import contextlib
import importlib.util
import io
import json
import ntpath
import posixpath
import subprocess
from pathlib import Path, PurePosixPath, PureWindowsPath
import tempfile
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / 'frontend_channels'
NAME = 'フロントエンド(Discord)'


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


start = load('discord_root_start_test', ROOT / '_start.py')
setup = load('discord_root_setup_test', ROOT / '_setup.py')
cleanup = load('discord_root_cleanup_test', ROOT / '_cleanup.py')
discord_start = load('discord_start_test', FRONTEND / '_start.py')
discord_setup = load('discord_setup_test', FRONTEND / '_setup.py')
discord_cleanup = load('discord_cleanup_test', FRONTEND / '_cleanup.py')
import discord_processes as processes
import launcher


class DiscordSetupTest(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch.object(discord_setup, "check_project_node_runtime", return_value=(True, "fixture Node")))
        self.enterContext(patch.object(discord_start, "check_project_node_runtime", return_value=(True, "fixture Node")))
        self.enterContext(contextlib.redirect_stdout(io.StringIO()))
        self.enterContext(patch.object(discord_setup, '_discord_in_use', return_value=False))
        self.enterContext(patch.object(discord_setup.shutil, 'which', return_value='npm'))
        self.run = self.enterContext(patch.object(discord_setup.subprocess, 'run'))
        self.prepare = self.enterContext(patch.object(discord_setup, 'prepare_electron_binary', return_value=True))
        self.launcher = self.enterContext(patch.object(discord_setup, 'install_launcher'))
        # 共通設定・実ランチャーへ書き込まず、呼び出し順だけを確認する。
        self.enterContext(patch.object(discord_setup.importlib.util, 'spec_from_file_location', return_value=Mock()))
        self.enterContext(patch.object(discord_setup.importlib.util, 'module_from_spec', return_value=Mock()))

    def test_electron_is_updated_before_binary_preparation(self):
        calls = Mock()
        calls.attach_mock(self.run, 'npm')
        calls.attach_mock(self.prepare, 'prepare')
        self.assertTrue(discord_setup.setup())
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

    def test_failed_electron_update_does_not_prepare_binary_or_publish_launcher(self):
        self.run.side_effect = [None, subprocess.CalledProcessError(1, ['npm', 'update', 'electron'])]
        self.assertFalse(discord_setup.setup())
        self.prepare.assert_not_called()
        self.launcher.assert_not_called()

    def test_failed_panel_build_or_verification_does_not_publish_launcher(self):
        for failed_step in ('build:panel', 'check:panel'):
            with self.subTest(failed_step=failed_step):
                self.run.reset_mock()
                def run(command, **kwargs):
                    if command[-1] == failed_step:
                        raise subprocess.CalledProcessError(1, command)
                self.run.side_effect = run
                self.assertFalse(discord_setup.setup())
                self.prepare.assert_not_called()
                self.launcher.assert_not_called()
                commands = [call.args[0] for call in self.run.call_args_list]
                self.assertEqual(commands[-1], ['npm', 'run', failed_step])


class DiscordSetupOwnershipTest(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch.object(discord_setup, '_runtime_in_use', return_value=False))
        self.snapshot = self.enterContext(patch.object(discord_setup, 'snapshot', return_value=[]))
        self.enterContext(patch.object(discord_setup.os, 'getpid', return_value=999))

    def roots(self):
        return ((False, PurePosixPath('/fixture/frontend_channels')),
                (True, PureWindowsPath(r'C:\fixture\frontend_channels')))

    @contextlib.contextmanager
    def platform(self, windows, root):
        # ホスト OS に依存せず、実パス規則と platform をセットで模擬する。
        path_module = ntpath if windows else posixpath
        with patch.object(discord_setup, 'THIS_DIR', root), patch.object(discord_setup.sys, 'platform', 'win32' if windows else 'linux'), patch.object(discord_setup.os, 'path', path_module), patch.object(discord_setup.os, 'sep', path_module.sep):
            yield

    def record(self, root, entry, name='node', tail='', executable=''):
        return dict(ProcessId=10, Name=name, ExecutablePath=executable,
                    CommandLine=f'{name} "{root / entry}" {tail}')

    def test_discord_project_inside_slack_is_still_running(self):
        for windows, root in self.roots():
            for option in ('--project ', ''):
                with self.subTest(windows=windows, option=option), self.platform(windows, root):
                    self.snapshot.return_value = [self.record(root, 'panel/launch.mjs', tail=f'{option}"{root / "slack/work"}"')]
                    self.assertTrue(discord_setup._discord_in_use())

    def test_slack_entries_and_start_wrapper_do_not_block_discord(self):
        for windows, root in self.roots():
            for entry in ('panel/launch.mjs', 'panel/desktop.cjs', 'src/panel-worker.ts', 'src/web-server.ts', 'src/main.ts', '_start.py'):
                name = 'python' if entry == '_start.py' else 'electron' if entry.endswith('.cjs') else 'node'
                if windows:
                    name += '.exe'
                with self.subTest(windows=windows, entry=entry), self.platform(windows, root):
                    self.snapshot.return_value = [self.record(root / 'slack', entry, name, tail=f'--project "{root}"')]
                    self.assertFalse(discord_setup._discord_in_use())

    def test_slack_orphan_electron_is_excluded_but_discord_runtime_is_protected(self):
        for windows, root in self.roots():
            for slack in (False, True):
                for reported_executable in (False, True):
                    name = 'electron.exe' if windows else 'electron'
                    runtime = (root / 'slack' if slack else root) / 'node_modules/electron/dist' / name
                    with self.subTest(windows=windows, slack=slack, reported_executable=reported_executable), self.platform(windows, root):
                        self.snapshot.return_value = [dict(ProcessId=10, Name=name, CommandLine=f'"{runtime}" --type=renderer', ExecutablePath=str(runtime) if reported_executable else '')]
                        self.assertEqual(discord_setup._discord_in_use(), not slack)

    def test_slack_does_not_hide_another_discord_process(self):
        for windows, root in self.roots():
            with self.subTest(windows=windows), self.platform(windows, root):
                self.snapshot.return_value = [self.record(root / 'slack', 'panel/launch.mjs'),
                                              self.record(root, 'panel/launch.mjs', tail=f'--project "{root / "slack"}"')]
                self.assertTrue(discord_setup._discord_in_use())

    def test_other_checkout_or_argument_only_is_not_owned(self):
        for windows, root in self.roots():
            with self.subTest(windows=windows), self.platform(windows, root):
                self.snapshot.return_value = [self.record(root.parent / 'other/frontend_channels', 'panel/launch.mjs', tail=f'--project "{root / "slack"}"'),
                                              self.record(root.parent / 'other', 'worker.js', tail=f'"{root / "panel/launch.mjs"}"')]
                self.assertFalse(discord_setup._discord_in_use())

    def test_unreadable_node_command_still_fails_closed(self):
        self.snapshot.return_value = [dict(ProcessId=10, Name='node', CommandLine='')]
        with self.assertRaises(ValueError):
            discord_setup._discord_in_use()

    def test_launching_discord_prevents_npm_and_launcher_changes(self):
        self.snapshot.return_value = [self.record(FRONTEND, 'panel/launch.mjs', tail=f'--project "{FRONTEND / "slack/work"}"')]
        with patch.object(discord_setup, 'check_project_node_runtime', return_value=(True, 'fixture Node')), patch.object(discord_setup.subprocess, 'run', side_effect=AssertionError('起動中に npm を呼ばない')) as run, patch.object(discord_setup, 'install_launcher') as install, contextlib.redirect_stdout(io.StringIO()):
            self.assertFalse(discord_setup.setup())
        run.assert_not_called()
        install.assert_not_called()


class DiscordLifecycleTest(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch.object(cleanup._opencode_service, 'stop_opencode_service'))
        self.enterContext(patch.object(cleanup, 'remove_launcher_path', return_value=True))
        self.enterContext(patch.object(discord_setup, "check_project_node_runtime", return_value=(True, "fixture Node")))
        self.enterContext(patch.object(discord_start, "check_project_node_runtime", return_value=(True, "fixture Node")))
        self.enterContext(contextlib.redirect_stdout(io.StringIO()))

    def test_setup_yes_start_no_cleanup_yes_defaults(self):
        def setup_answer(prompt, default='n'):
            return default == 'y' if 'Discord' in prompt else False
        with patch.object(setup, 'ask_start_mode', return_value=(True, False)), patch.object(
            setup, 'ask_yes_no', side_effect=setup_answer
        ) as ask:
            self.assertTrue(setup.collect_setup_choices()['discord'])
        self.assertEqual(next(call.kwargs['default'] for call in ask.call_args_list if 'Discord' in call.args[0]), 'y')
        with patch.object(start, 'prompt_choice', side_effect=lambda prompt, default_yes: False if 'Diag' in prompt else default_yes) as ask:
            flags = start.collect_startup_choices()
        # 戻り値は Discord の後に aidiy_task / aidiy_team を加えた14項目。Discord は12番目。
        self.assertEqual(len(flags), 14)
        self.assertFalse(flags[11])
        # Slack は戻り値の並びを変えず、Discord の直後に尋ねる。
        self.assertIn('IDE', ask.call_args_list[-3].args[0])
        self.assertIn('Discord', ask.call_args_list[-2].args[0])
        self.assertIn('Slack', ask.call_args_list[-1].args[0])
        with tempfile.TemporaryDirectory() as folder, patch.object(cleanup, 'ask_start_mode', return_value=(True, False)), patch.object(
            cleanup, 'ask_yes_no', side_effect=setup_answer
        ):
            self.assertTrue(cleanup.collect_cleanup_choices(Path(folder))['discord'])

    def test_unselected_discord_needs_no_configuration(self):
        module = Mock()
        module.check_environment.return_value = (False, '未設定')
        with patch.object(start, 'DISCORD', module), patch.object(start, 'get_npm_command', return_value=None):
            self.assertTrue(start.validate_initial_environment(False, False, False, False, False, False)[0])
            module.check_environment.assert_not_called()
            self.assertFalse(start.validate_initial_environment(False, False, False, False, False, False, True)[0])
        module.check_environment.assert_called_once()

    def test_root_start_only_launches_discord_when_selected_and_requests_autoconnect(self):
        running = {}
        # 起動前の全サービス停止は実プロセスを止めるため、必ずモックする。
        with patch.object(start, 'stop_all_tasks') as stop_all, patch.object(start, 'start_service') as launch, patch.object(start.time, 'sleep'):
            flags = start.start_initial_services(False, False, False, False, False, False, running, {}, None)
        launch.assert_not_called()
        stop_all.assert_not_called()  # 一括停止は main が担当し、個別起動では繰り返さない。
        self.assertFalse(flags[NAME]); self.assertNotIn(NAME, running)
        module = Mock()
        with patch.object(start, 'stop_all_tasks') as stop_all, patch.object(start, 'DISCORD', module), patch.object(start, 'attach_output_thread'), patch.object(
            start, 'cleanup_stop_requested_services', return_value=set()
        ), patch.object(start, 'wait_for_services_quiet'), patch.object(start.time, 'sleep'):
            flags = start.start_initial_services(False, False, False, False, False, False, running, {}, None, discord_enabled=True)
        stop_all.assert_not_called()
        module.start.assert_called_once_with(auto_connect=True)
        self.assertIn(NAME, running)
        self.assertFalse(flags[NAME])  # 手動で閉じた画面を監視ループから再表示しない。

    def test_cleanup_request_disables_restart_and_refuses_fresh_launch(self):
        name = 'フロントエンド(Avatar)'
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'cleanup.json'
            with patch.object(cleanup, 'CLEANUP_STOP_REQUEST_PATH', path), patch.object(
                start, 'CLEANUP_STOP_REQUEST_PATH', path
            ), patch.object(start, '_pid_is_running', return_value=True), patch.object(start, 'stop_processes') as stop:
                flags = {name: True}; proc = Mock(); running = {name: proc}; crash = {name: 123}
                with cleanup.cleanup_stop_request({}):
                    self.assertIn(name, json.loads(path.read_text(encoding='utf-8'))['services'])
                    start.suspend_services_for_cleanup(flags, running, crash)
                    self.assertFalse(flags[name]); self.assertNotIn(name, running); self.assertNotIn(name, crash)
                    stop.assert_called_once_with({name: proc}, keep_standalone=False)
                    self.assertFalse(start.start_service(name, {}, {}, None))
                self.assertFalse(path.exists())
                self.assertFalse(flags[name])
                with cleanup.cleanup_stop_request({}, services=[NAME]):
                    self.assertEqual(start.cleanup_stop_requested_services(), {NAME})
                    stop.reset_mock()
                    discord_proc = Mock()
                    discord_running = {NAME: discord_proc}
                    discord_flags = {NAME: True}
                    start.suspend_services_for_cleanup(discord_flags, discord_running, {})
                    stop.assert_called_once_with({NAME: discord_proc}, keep_standalone=False)
                    self.assertFalse(discord_flags[NAME])
                    self.assertNotIn(NAME, discord_running)
                    self.assertFalse(start.start_service(NAME, {}, {}, None))

    def test_root_cleanup_stops_discord_even_when_deletion_not_selected(self):
        modules = {folder: Mock() for _, folder, _, _ in cleanup.SERVICE_CLEANUP_TARGETS}
        with patch.object(cleanup, '_load_folder_start_module', side_effect=modules.get), patch.object(
            cleanup, '_load_folder_module', return_value=Mock()
        ), patch.object(cleanup.time, 'sleep'):
            cleanup.stop_all_services({'discord': False})
        modules['frontend_channels'].kill_ports.assert_called_once()

    def test_root_cleanup_reports_discord_deletion_failure(self):
        choices = dict.fromkeys(('npm_uninstall', 'backup', 'local', 'tools', 'backend', 'taskteam', 'web', 'avatar', 'hermes', 'vscode'), False)
        choices['discord'] = True
        with tempfile.TemporaryDirectory() as folder, patch.object(cleanup, 'stop_all_services'), patch.object(
            cleanup, '_run_folder_cleanup', return_value=False
        ) as remove, patch.object(cleanup, '_remove_folder_import_cache'), patch.object(
            cleanup, '_remove_root_python_caches'
        ), patch.object(cleanup.time, 'sleep'):
            self.assertFalse(cleanup.execute_cleanup(Path(folder), choices))
        remove.assert_called_once_with('frontend_channels', choices)

    def test_stop_failure_preserves_dependencies(self):
        with patch.object(discord_cleanup, 'stop_discord_processes', return_value=False), patch.object(
            discord_cleanup, 'remove_directory'
        ) as remove:
            self.assertFalse(discord_cleanup.cleanup())
        remove.assert_not_called()
        with patch.object(discord_start, 'stop_discord_processes', return_value=False):
            with self.assertRaises(RuntimeError):
                discord_start.kill_ports()

    def test_cleanup_only_removes_generated_files_inside_component(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder).resolve()
            component = root / 'frontend_channels'; component.mkdir()
            for name in discord_cleanup.TARGETS:
                target = component / name; target.mkdir(); (target / 'dummy').write_text('test', encoding='utf-8')
            source = component / 'src'; source.mkdir(); (source / 'main.ts').write_text('source', encoding='utf-8')
            (component / 'package-lock.json').write_text('{}', encoding='utf-8')
            (root / '_config').mkdir(); key = root / '_config/AiDiy_key.json'; key.write_text('keep', encoding='utf-8')
            with patch.object(discord_cleanup, 'THIS_DIR', component), patch.object(
                discord_cleanup, 'stop_discord_processes', return_value=True
            ), patch.object(discord_cleanup.shutil, 'rmtree', wraps=discord_cleanup.shutil.rmtree) as remove:
                self.assertFalse(discord_cleanup.remove_directory(root / '_config'))
                self.assertFalse(discord_cleanup.remove_directory(component))
                remove.assert_not_called()
                self.assertTrue(discord_cleanup.cleanup())
            self.assertEqual(key.read_text(encoding='utf-8'), 'keep')
            self.assertTrue((source / 'main.ts').exists()); self.assertTrue((component / 'package-lock.json').exists())
            self.assertTrue(all(not (component / name).exists() for name in discord_cleanup.TARGETS))

    def test_discord_cleanup_never_removes_independent_slack_caches(self):
        component = Path('/fixture/frontend_channels')
        own_cache = component / 'scripts/__pycache__'
        slack_caches = [component / 'slack/__pycache__', component / 'slack/checks/__pycache__']
        # Slack は選択済みでも専用 cleanup が担当する。親から再帰削除しない。
        for choices in (None, {'discord': True, 'slack': False}, {'discord': True, 'slack': True}):
            with self.subTest(choices=choices), patch.object(discord_cleanup, 'THIS_DIR', component), patch.object(discord_cleanup, 'stop_discord_processes', return_value=True), patch.object(discord_cleanup, 'remove_launcher', return_value=True), patch.object(discord_cleanup, 'remove_directory', return_value=True) as remove, patch.object(Path, 'rglob', return_value=[own_cache, *slack_caches]):
                self.assertTrue(discord_cleanup.cleanup(choices))
                removed = [call.args[0] for call in remove.call_args_list]
                self.assertIn(own_cache, removed)
                self.assertTrue(all(cache not in removed for cache in slack_caches))

    def test_launch_uses_absolute_entry_and_check_cannot_connect(self):
        with patch.object(discord_start.shutil, 'which', return_value='node'), patch.object(
            discord_start.Path, 'is_file', return_value=True
        ), patch.dict('sys.modules', {'_setup_electron': Mock(electron_binary_ready=Mock(return_value=True))}):
            command = discord_start.launch_command()
            self.assertEqual(command[-1], str(FRONTEND / 'panel/launch.mjs'))
            with patch.object(discord_start.subprocess, 'run', return_value=Mock(returncode=0)) as run:
                self.assertTrue(discord_start.check_environment()[0])
            self.assertEqual(run.call_args.args[0][-1], '--check')
            with patch.object(discord_start.subprocess, 'Popen') as spawn:
                discord_start.start()
            self.assertEqual(spawn.call_args.args[0], command + ['--no-connect'], '起動入口は既定で自動接続するため、未接続は明示する')
            self.assertNotIn('shell', spawn.call_args.kwargs)
            with patch.object(discord_start.subprocess, 'Popen') as spawn:
                discord_start.start(auto_connect=True)
            self.assertEqual(spawn.call_args.args[0], command + ['--connect'])

    def test_start_stop_preserves_discord_and_code_descendants(self):
        for keep_code in (False, True):
            modules = {folder: Mock() for _, folder, _, _ in cleanup.SERVICE_CLEANUP_TARGETS}
            modules['frontend_ide/host'] = Mock()
            modules['frontend_ide/host'].process_tree_pids.return_value = {100, 101}
            modules['frontend_channels'].process_tree_pids.return_value = {200, 201, 202}
            modules['frontend_channels/slack'].process_tree_pids.return_value = set()
            tools = Mock()
            with patch.object(cleanup, '_load_folder_start_module', side_effect=modules.get), patch.object(
                cleanup, '_load_folder_module', return_value=tools
            ), patch.object(cleanup.time, 'sleep'):
                self.assertTrue(cleanup.stop_all_services({}, strict=False, keep_code=keep_code, keep_discord=True))
            modules['frontend_channels'].kill_ports.assert_not_called()
            modules['frontend_channels/slack'].kill_ports.assert_not_called()
            expected = {200, 201, 202} | ({100, 101} if keep_code else set())
            tools.stop_tools_processes.assert_called_once_with(exclude_pids=frozenset(expected))

        modules['frontend_channels'].process_tree_pids.side_effect = OSError('一覧取得失敗')
        tools.stop_tools_processes.reset_mock()
        with patch.object(cleanup, '_load_folder_start_module', side_effect=modules.get), patch.object(
            cleanup, '_load_folder_module', return_value=tools
        ), patch.object(cleanup.time, 'sleep'):
            self.assertFalse(cleanup.stop_all_services({}, strict=False, keep_code=True, keep_discord=True))
        tools.stop_tools_processes.assert_not_called()

    def test_shutdown_preserves_discord_except_explicit_cleanup(self):
        for keep in (True, False):
            module = Mock()
            proc = Mock(pid=123456)
            with patch.object(start, 'DISCORD', module), patch.object(start, 'VSCODE', None), patch.object(
                start.sys, 'platform', 'win32'
            ), patch.object(start.subprocess, 'run') as kill:
                running = {NAME: proc}
                start.stop_processes(running, keep_standalone=keep)
            self.assertEqual(running, {})
            if keep:
                kill.assert_not_called()
                module.kill_ports.assert_not_called()
                proc.wait.assert_not_called()
                proc.kill.assert_not_called()
                proc.terminate.assert_not_called()
            else:
                self.assertEqual(kill.call_args.args[0], ['taskkill', '/F', '/T', '/PID', '123456'])
                module.kill_ports.assert_called_once()
                proc.wait.assert_called_once_with(timeout=5)


class DiscordProcessMatchingTest(unittest.TestCase):
    def owned(self, command, name='node.exe'):
        return processes.is_discord_process(dict(Name=name, CommandLine=command), FRONTEND, True)

    def test_preserved_discord_tree_contains_hermes_and_mcp_only(self):
        records = [
            dict(ProcessId=10, ParentProcessId=1, Name='node.exe', CommandLine=f'node.exe "{FRONTEND / "src/web-server.ts"}"'),
            dict(ProcessId=11, ParentProcessId=10, Name='python.exe', CommandLine='python.exe hermes'),
            dict(ProcessId=12, ParentProcessId=11, Name='python.exe', CommandLine='python.exe mcp_stdio.py'),
            dict(ProcessId=20, ParentProcessId=1, Name='node.exe', CommandLine='node.exe other.js'),
            dict(ProcessId=21, ParentProcessId=20, Name='python.exe', CommandLine='python.exe mcp_stdio.py'),
        ]
        with patch.object(processes, 'list_processes', return_value=records), patch.object(processes.sys, 'platform', 'win32'):
            self.assertEqual(processes.discord_tree_pids(FRONTEND), {10, 11, 12})

    def test_root_launcher_bat_and_npm_entrypoints(self):
        main = FRONTEND / 'src/main.ts'; cli = FRONTEND / 'node_modules/tsx/dist/cli.mjs'; loader = FRONTEND / 'node_modules/tsx/dist/loader.mjs'
        for command in (
            f'node.exe --import "{loader.as_uri()}" "{main}"',
            f'node.exe "{cli}" "{main}"',
            f'node.exe "{cli}" src/main.ts',
            f'node.exe --require "{FRONTEND}/node_modules/tsx/dist/preflight.cjs" --import "{loader.as_uri()}" src/main.ts',
        ):
            self.assertTrue(self.owned(command), command)

    def test_other_node_process_checkouts_and_script_arguments_are_excluded(self):
        main = FRONTEND / 'src/main.ts'; cli = FRONTEND / 'node_modules/tsx/dist/cli.mjs'
        for command in (
            f'node.exe other.js "{main}"', f'node.exe "{main}.other"',
            f'node.exe "{FRONTEND}.other/src/main.ts"', f'node.exe "{cli}" checks/code.test.ts',
            'node.exe src/main.ts', f'node.exe --eval "{main}"',
        ):
            self.assertFalse(self.owned(command), command)
        self.assertFalse(self.owned(f'Code.exe "{main}"', 'Code.exe'))

    def test_unix_entry_with_spaces(self):
        root = Path('/tmp/AiDiy project/frontend_channels')
        command = 'node --import "file:///tmp/AiDiy%20project/frontend_channels/node_modules/tsx/dist/loader.mjs" "/tmp/AiDiy project/frontend_channels/src/main.ts"'
        self.assertTrue(processes.is_discord_process(dict(Name='node', CommandLine=command), root, False))

    def test_panel_worker_and_electron_match_only_this_checkout(self):
        for entry, name in (('panel/launch.mjs', 'node.exe'), ('src/panel-worker.ts', 'node.exe'), ('src/web-server.ts', 'node.exe'), ('panel/desktop.cjs', 'electron.exe')):
            self.assertTrue(self.owned(f'{name} "{FRONTEND / entry}"', name))
            self.assertFalse(self.owned(f'{name} "{FRONTEND}.other/{entry}"', name))
            self.assertFalse(self.owned(f'{name} other.js "{FRONTEND / entry}"', name))


class DiscordLauncherTest(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch.object(discord_setup, "check_project_node_runtime", return_value=(True, "fixture Node")))
        self.enterContext(patch.object(discord_start, "check_project_node_runtime", return_value=(True, "fixture Node")))
        self.enterContext(patch.object(launcher, 'ensure_launcher_path', return_value=True))
        self.enterContext(patch.object(launcher, 'remove_launcher_path', return_value=True))

    def test_new_folder_loads_through_root_entrypoints_without_renaming_discord_modules(self):
        self.assertTrue(FRONTEND.is_dir())
        self.assertEqual(json.loads((FRONTEND / 'package.json').read_text(encoding='utf-8'))['name'], 'aidiy-discord')
        original_load = start._load_folder_module
        with patch.object(start, '_load_folder_module', side_effect=lambda folder: original_load(folder) if folder == 'frontend_channels' else Mock()) as loader, patch.object(start, '_remove_folder_import_cache'):
            start._init_modules()
        self.assertIn(('frontend_channels',), [call.args for call in loader.call_args_list])
        self.assertEqual(start.DISCORD.THIS_DIR, FRONTEND)
        self.assertEqual(setup._load_folder_module('frontend_channels')._launcher.__name__, 'aidiy_frontend_discord_launcher')
        self.assertEqual(cleanup._load_folder_module('frontend_channels')._launcher.__name__, 'aidiy_frontend_discord_launcher')

    def test_launcher_keeps_command_and_new_folder_for_windows_and_linux(self):
        for platform in ('win32', 'linux'):
            with self.subTest(platform=platform), tempfile.TemporaryDirectory() as directory:
                root = Path(directory) / 'project with spaces' / 'frontend_channels'
                (root / 'panel').mkdir(parents=True)
                (root / 'panel/launch.mjs').write_text('// fixture', encoding='utf-8')
                command = Path(directory) / ('aidiy_discord.cmd' if platform == 'win32' else 'aidiy_discord')
                with patch.object(launcher, 'launcher_path', return_value=command), patch.object(launcher.sys, 'platform', platform), patch.object(launcher.shutil, 'which', return_value='node'):
                    launcher.install_launcher(root)
                    content = command.read_text(encoding='utf-8')
                    self.assertIn(str(root / 'panel/launch.mjs'), content)
                    self.assertIn('%*' if platform == 'win32' else '"$@"', content)
                    self.assertTrue(launcher.remove_launcher(root))
                    self.assertFalse(command.exists())

    def test_cleanup_preserves_launcher_for_another_checkout(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'aidiy_discord.cmd'
            file.write_text('node "D:/Other/frontend_channels/panel/launch.mjs"', encoding='utf-8')
            with patch.object(launcher, 'launcher_path', return_value=file):
                self.assertTrue(launcher.remove_launcher(FRONTEND))
                self.assertTrue(file.exists())
                file.write_text(f'node "{FRONTEND / "panel/launch.mjs"}"', encoding='utf-8')
                self.assertTrue(launcher.remove_launcher(FRONTEND))
                self.assertFalse(file.exists())


if __name__ == '__main__':
    unittest.main()
