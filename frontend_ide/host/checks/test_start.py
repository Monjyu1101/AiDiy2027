# -*- coding: utf-8 -*-
#
# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""全体起動の Code / Live 選択、接続指定、停止対象を外部接続なしで検証する。"""
import contextlib
import importlib.util
import io
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


start = load('vscode_root_start_tests', ROOT.parent.parent / '_start.py')
standalone = load('vscode_start_tests', ROOT / '_start.py')
cleanup = load('vscode_root_cleanup_start_tests', ROOT.parent.parent / '_cleanup.py')


class StartupTest(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch.object(standalone, "check_project_node_runtime", return_value=(True, "fixture Node")))
        self.enterContext(contextlib.redirect_stdout(io.StringIO()))

    def test_only_selected_windows_launch_and_do_not_reopen(self):
        for code, live in ((False, False), (True, False), (False, True), (True, True)):
            with patch.object(start, 'stop_all_tasks'), patch.object(start, 'start_service', return_value=True) as launch, patch.object(start, 'wait_for_services_quiet'):
                flags = start.start_initial_services(False, False, False, False, False, False, {}, {}, None,
                                                     code_enabled=code, live_enabled=live)
            self.assertEqual([c.args[0] for c in launch.call_args_list],
                             [f'フロントエンド({name})' for name, enabled in (('code', code), ('live', live)) if enabled])
            self.assertFalse(flags['フロントエンド(code)'])
            self.assertFalse(flags['フロントエンド(live)'])

    def test_start_dispatch_and_environment_checks(self):
        module = Mock()
        module.check_environment.return_value = (True, '準備済み')
        with patch.object(start, 'VSCODE', module), patch.object(start, 'cleanup_stop_requested_services', return_value=set()), patch.object(start, 'attach_output_thread'), patch.object(start, 'get_npm_command', return_value=None):
            self.assertTrue(start.validate_initial_environment(False, False, False, False, False, False)[0])
            module.check_environment.assert_not_called()
            self.assertTrue(start.validate_initial_environment(False, False, False, False, False, False, live_enabled=True)[0])
            module.check_environment.assert_called_once_with('live')
            running = {}
            self.assertTrue(start.start_service('フロントエンド(code)', running, {}, None))
            self.assertTrue(start.start_service('フロントエンド(live)', running, {}, None))
            module.start_code.assert_called_once_with()
            module.start_live.assert_called_once_with(auto_connect=True)
            self.assertEqual(len(running), 2)

    def test_launchers_use_same_command_entry_without_shell(self):
        with patch.object(standalone.shutil, 'which', return_value='node'), patch.object(standalone.subprocess, 'Popen') as spawn:
            standalone.start_code()
            self.assertEqual(spawn.call_args.args[0], ['node', str(ROOT / 'aidiy_code/launch.mjs')])
            self.assertEqual(spawn.call_args.kwargs['cwd'], ROOT.parent.parent)
            self.assertNotIn('shell', spawn.call_args.kwargs)
            standalone.start_live(auto_connect=True)
            self.assertEqual(spawn.call_args.args[0], ['node', str(ROOT / 'aidiy_live/launch.mjs'), '--foreground', '--connect'])
            standalone.start_live()
            self.assertNotIn('--connect', spawn.call_args.args[0])

    def test_shutdown_reclaims_only_started_window(self):
        module = Mock()
        process = Mock(pid=123456)
        with patch.object(start, 'VSCODE', module), patch.object(start.sys, 'platform', 'linux'), patch.object(start.os, 'getpgid', return_value=123456, create=True), patch.object(start.os, 'killpg', create=True), patch.object(start.time, 'sleep'):
            running = {'フロントエンド(live)': process}
            start.stop_processes(running)
        self.assertEqual(running, {})
        module.kill_ports.assert_called_once_with('live')

    def test_shutdown_keeps_started_code_running(self):
        module = Mock()
        process = Mock(pid=123456)
        with patch.object(start, 'VSCODE', module), patch.object(start.sys, 'platform', 'win32'), patch.object(
            start.subprocess, 'run'
        ) as run, patch.object(start.time, 'sleep'):
            running = {'フロントエンド(code)': process}
            start.stop_processes(running)
        self.assertEqual(running, {})
        run.assert_not_called()
        process.wait.assert_not_called()
        process.kill.assert_not_called()
        module.kill_ports.assert_not_called()

    def test_main_passes_code_live_selections_to_validation_and_launch(self):
        with patch.object(start, '_init_modules'), patch.object(start, 'collect_startup_choices', return_value=(False, False, False, False, False, False, False, True, True, True, False, False, False, False)), patch.object(start, 'validate_initial_environment', return_value=(True, None)) as validate, patch.object(start, 'start_initial_services', return_value={}) as launch, patch.object(start, 'monitor_and_restart', side_effect=KeyboardInterrupt), patch.object(start, 'stop_processes'), patch.object(start, 'stop_all_tasks'), patch.object(start.time, 'sleep'), patch.object(start.sys, 'platform', 'linux'):
            start.main()
        for invocation in (validate.call_args, launch.call_args):
            self.assertTrue(invocation.kwargs['console_enabled'])
            self.assertTrue(invocation.kwargs['code_enabled'])
            self.assertTrue(invocation.kwargs['live_enabled'])
            self.assertFalse(invocation.kwargs['discord_enabled'])

    def test_per_module_process_matching_excludes_shared_binary_and_other_window(self):
        from standalone_processes import is_standalone
        for windows, executable in ((False, 'electron'), (True, 'electron.exe')):
            for name in ('code', 'live'):
                record = dict(Name=executable, CommandLine=f'{executable} "{ROOT / f"aidiy_{name}/desktop.cjs"}"')
                self.assertTrue(is_standalone(record, ROOT, windows, name))
                self.assertFalse(is_standalone(record, ROOT, windows, 'live' if name == 'code' else 'code'))
            shared = ROOT / f'node_modules/electron/dist/{executable}'
            self.assertFalse(is_standalone(dict(Name=executable, CommandLine=f'"{shared}" --type=gpu-process'), ROOT, windows, 'live'))

    def test_vue_process_matching_separates_code_live_and_dev(self):
        from standalone_processes import is_standalone
        for windows in (True, False):
            executable = 'node.exe' if windows else 'node'
            root = ROOT.parent.parent / 'frontend_ide'
            for kind in ('code', 'live', 'ide'):
                for command in (f'{executable} "{root / "launch.mjs"}" --app {kind}',
                                f'{executable} "{root / f"aidiy_{kind}/launch.mjs"}"'):
                    record = dict(Name=executable, CommandLine=command)
                    for selected in ('code', 'live'):
                        self.assertEqual(is_standalone(record, ROOT, windows, selected), selected == kind)

    def test_cleanup_suspends_windows_before_stopping_dependencies(self):
        self.assertTrue({'フロントエンド(code)', 'フロントエンド(live)'} <= start.MANAGED_SERVICE_NAMES)
        # 全体cleanupが生成する既定停止対象にも両ウィンドウが含まれる。
        import tempfile
        import json
        with tempfile.TemporaryDirectory() as directory, patch.object(cleanup, 'CLEANUP_STOP_REQUEST_PATH', Path(directory) / 'stop.json'):
            with cleanup.cleanup_stop_request({}):
                services = json.loads(cleanup.CLEANUP_STOP_REQUEST_PATH.read_text(encoding='utf-8'))['services']
                self.assertIn('フロントエンド(code)', services)
                self.assertIn('フロントエンド(live)', services)


if __name__ == '__main__':
    unittest.main()
