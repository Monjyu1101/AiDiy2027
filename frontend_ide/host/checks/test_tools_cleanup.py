# -*- coding: utf-8 -*-
#
# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""tools の MCP 残留プロセスと、削除失敗の伝播を検証する。"""

import contextlib
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

PROJECT = Path(__file__).resolve().parents[3]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


tools = load('tools_cleanup_tests', PROJECT / 'backend_tools/_cleanup.py')
root_cleanup = load('root_tools_cleanup_tests', PROJECT / '_cleanup.py')
import _cleanup_processes as processes


class ToolsCleanupTest(unittest.TestCase):
    def setUp(self):
        self.enterContext(contextlib.redirect_stdout(io.StringIO()))

    def test_venv_launcher_and_base_python_child_are_matched(self):
        root = PROJECT / 'backend_tools'
        interpreter = root / '.venv/Scripts/python.exe'
        command = f'"{interpreter}" "{root / "mcp_stdio.py"}" --sse-url http://127.0.0.1:8095/aidiy_logs/sse'
        for executable in (str(interpreter), 'C:\\Python3\\python.exe'):
            self.assertTrue(tools.is_tools_process(dict(Name='python.exe', ExecutablePath=executable,
                                                       CommandLine=command), root, True))

    def test_exact_stdio_entrypoint_matches_other_interpreter(self):
        root = PROJECT / 'backend_tools'
        self.assertTrue(tools.is_tools_process(dict(Name='python.exe',
            CommandLine=f'python.exe -u "{root / "mcp_stdio.py"}"'), root, True))

    def test_other_checkout_and_parent_client_are_excluded(self):
        root = PROJECT / 'backend_tools'
        for record in (
            dict(Name='Code.exe', CommandLine=f'Code.exe "{root / "mcp_stdio.py"}"'),
            dict(Name='python.exe', CommandLine=f'python.exe other.py "{root / "mcp_stdio.py"}"'),
            dict(Name='python.exe', CommandLine=f'"{root}.other\\.venv\\Scripts\\python.exe" mcp_stdio.py'),
        ):
            self.assertFalse(tools.is_tools_process(record, root, True))

    def test_inventory_failure_aborts_stop(self):
        with patch.object(processes, 'list_processes', side_effect=OSError('access denied')):
            self.assertFalse(processes.stop_matching(lambda _: True, Mock(), Mock(), 'tools'))

    def test_cleanup_cannot_kill_itself_or_its_venv_parent(self):
        own = processes.os.getpid()
        records = [dict(ProcessId=own, ParentProcessId=123456, Name='python.exe'),
                   dict(ProcessId=123456, ParentProcessId=0, Name='python.exe')]
        with patch.object(processes, 'list_processes', return_value=records), patch.object(
            processes.subprocess, 'run'
        ) as run:
            self.assertFalse(processes.stop_matching(lambda p: p['ProcessId'] == 123456, Mock(), Mock(), 'tools'))
        run.assert_not_called()

    def test_remaining_process_does_not_report_success(self):
        record = dict(ProcessId=123456, ParentProcessId=0, Name='python.exe')
        with patch.object(processes.sys, 'platform', 'win32'), patch.object(
            processes, 'list_processes', return_value=[record]
        ), patch.object(processes.subprocess, 'CREATE_NO_WINDOW', 0x08000000, create=True), patch.object(processes.subprocess, 'run'), patch.object(processes.time, 'monotonic', side_effect=[0, 6]):
            self.assertFalse(processes.stop_matching(lambda _: True, Mock(), Mock(), 'tools'))

    def test_excluded_pids_are_not_stopped(self):
        # _start.py は aidiy_code 配下の MCP 接続を除外して停止する。
        root = PROJECT / 'backend_tools'
        command = f'"{root / ".venv/Scripts/python.exe"}" "{root / "mcp_stdio.py"}"'
        record = lambda pid: dict(ProcessId=pid, Name='python.exe', ExecutablePath='', CommandLine=command)
        with patch.object(tools, 'stop_matching', return_value=True) as stop, patch.object(tools.sys, 'platform', 'win32'):
            self.assertTrue(tools.stop_tools_processes(exclude_pids=frozenset({11})))
        matches = stop.call_args.args[0]
        self.assertFalse(matches(record(11)))
        self.assertTrue(matches(record(12)))

    def test_failed_stop_preserves_tools_files(self):
        with patch.object(tools, 'stop_tools_processes', return_value=False), patch.object(
            tools, 'remove_directory'
        ) as remove, patch.object(tools, 'cleanup_global_mcp_configs') as configs:
            self.assertFalse(tools.cleanup({'tools_temp': True}))
        remove.assert_not_called()
        configs.assert_not_called()

    def test_failed_deletion_is_reported_as_failure(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / '.venv').mkdir()
            (root / 'temp').mkdir()
            with patch.object(tools, 'BACKEND_TOOLS_DIR', root), patch.object(
                tools, 'stop_tools_processes', return_value=True
            ), patch.object(tools, 'cleanup_common_python_caches', return_value=(1, True)), patch.object(
                tools, 'remove_directory', return_value=False
            ), patch.object(tools, 'cleanup_global_mcp_configs'):
                self.assertFalse(tools.cleanup({'tools_envs': {'.venv': True}, 'tools_temp': True}))

    def test_root_propagates_tools_cleanup_failure(self):
        choices = dict.fromkeys(('local', 'tools', 'backend', 'taskteam', 'web', 'avatar', 'hermes',
                                 'vscode', 'npm_uninstall', 'backup'), False)
        choices['tools'] = True
        with tempfile.TemporaryDirectory() as folder, patch.object(root_cleanup, 'stop_all_services'), patch.object(
            root_cleanup, '_run_folder_cleanup', return_value=False
        ), patch.object(root_cleanup, '_remove_folder_import_cache'), patch.object(
            root_cleanup, '_remove_root_python_caches'
        ), patch.object(root_cleanup.time, 'sleep'):
            self.assertFalse(root_cleanup.execute_cleanup(Path(folder), choices))


if __name__ == '__main__':
    unittest.main()
