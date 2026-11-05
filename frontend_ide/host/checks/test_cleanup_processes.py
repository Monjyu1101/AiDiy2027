# -*- coding: utf-8 -*-
#
# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""単独実行の終了対象と、終了確認・ファイル削除の順序を検証する。"""

import contextlib
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('cleanup_process_tests', ROOT / '_cleanup.py')
cleanup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cleanup)
import standalone_processes as processes
import _cleanup_processes as common


class CleanupProcessesTest(unittest.TestCase):
    def setUp(self):
        self.enterContext(contextlib.redirect_stdout(io.StringIO()))
        # 新しい共有サービス停止も実環境へ流さず、呼び出し側だけを検証する。
        self.enterContext(patch('_opencode_service.stop_opencode_service'))
        self.enterContext(patch.object(cleanup, 'remove_launcher_path', return_value=True))

    def owned(self, name, command):
        return processes.is_standalone(dict(Name=name, CommandLine=command), ROOT, True)

    def test_browser_profile_quotes_and_both_modules(self):
        for module in ('aidiy_code', 'aidiy_live'):
            profile = ROOT / 'out' / module / 'browser-profile'
            for arg in (f'--user-data-dir="{profile}"', f'"--user-data-dir={profile}"'):
                self.assertTrue(self.owned('chrome.exe', f'"C:\\Chrome\\chrome.exe" {arg}'))
                self.assertTrue(self.owned('msedge.exe', f'"C:\\Edge\\msedge.exe" {arg}'))

    def test_unrelated_browsers_and_path_prefix_collision_are_excluded(self):
        profile = ROOT / 'out' / 'aidiy_live' / 'browser-profile'
        self.assertFalse(self.owned('chrome.exe', f'chrome.exe --user-data-dir="{profile}-other"'))
        self.assertFalse(self.owned('chrome.exe', 'chrome.exe --user-data-dir=C:\\UserBrowser'))
        self.assertFalse(self.owned('powershell.exe', f'powershell.exe --user-data-dir="{profile}"'))
        self.assertFalse(self.owned('Code.exe', f'Code.exe "{ROOT / "aidiy_live/desktop.cjs"}"'))

    def test_node_entrypoints_and_residual_electron_children(self):
        for module in ('aidiy_code', 'aidiy_live'):
            self.assertTrue(self.owned('node.exe', f'node.exe "{ROOT / module / "launch.mjs"}" --serve'))
            self.assertTrue(self.owned('node.exe', f'node.exe "{ROOT / "dist" / module / "server.cjs"}"'))
            self.assertTrue(self.owned('electron.exe', f'electron.exe "{ROOT / module / "desktop.cjs"}"'))
        executable = ROOT / 'node_modules/electron/dist/electron.exe'
        self.assertTrue(self.owned('electron.exe', f'"{executable}" --type=gpu-process'))
        self.assertFalse(self.owned('node.exe', f'node.exe other.js "{ROOT / "aidiy_live/launch.mjs"}"'))

    def test_unix_entrypoint(self):
        self.assertTrue(processes.is_standalone(
            dict(Name='node', CommandLine='node /tmp/aidiy/aidiy_live/launch.mjs --serve'), Path('/tmp/aidiy'), False))

    def test_force_termination_and_confirmation(self):
        record = dict(ProcessId=123456, ParentProcessId=0, Name='chrome.exe',
                      CommandLine=f'chrome.exe --user-data-dir="{ROOT / "out/aidiy_live/browser-profile"}"')
        with patch.object(processes.sys, 'platform', 'win32'), patch.object(
            common, 'list_processes', side_effect=[[record], [record], []]
        ), patch.object(common.subprocess, 'CREATE_NO_WINDOW', 0x08000000, create=True), patch.object(common.subprocess, 'run') as run:
            self.assertTrue(processes.stop_standalone(ROOT, Mock(), Mock()))
        self.assertEqual(run.call_args.args[0], ['taskkill', '/F', '/T', '/PID', '123456'])
        self.assertEqual(run.call_args.kwargs['creationflags'], 0x08000000)

    def test_reused_pid_is_not_terminated(self):
        record = dict(ProcessId=123456, ParentProcessId=0, Name='chrome.exe',
                      CommandLine=f'chrome.exe --user-data-dir="{ROOT / "out/aidiy_live/browser-profile"}"')
        unrelated = dict(record, CommandLine='chrome.exe --user-data-dir=C:\\Other')
        with patch.object(processes.sys, 'platform', 'win32'), patch.object(
            common, 'list_processes', side_effect=[[record], [unrelated], [unrelated]]
        ), patch.object(common.subprocess, 'run') as run:
            self.assertTrue(processes.stop_standalone(ROOT, Mock(), Mock()))
        run.assert_not_called()

    def test_failed_stop_preserves_files(self):
        with patch.object(cleanup, 'uninstall_extension', return_value=(True, 0)), patch.object(
            cleanup, 'stop_standalone_processes', return_value=False
        ), patch.object(cleanup, 'remove_directory') as directory, patch.object(cleanup, 'remove_file') as file:
            self.assertFalse(cleanup.cleanup())
        directory.assert_not_called()
        file.assert_not_called()

    def test_stop_happens_before_deletion(self):
        calls = []
        with tempfile.TemporaryDirectory() as folder, patch.object(cleanup, 'FRONTEND_VSCODE_DIR', Path(folder)), patch.object(
            cleanup, 'uninstall_extension', return_value=(True, 0)
        ), patch.object(cleanup, 'stop_standalone_processes', side_effect=lambda *args: calls.append('stop') or True), patch.object(
            cleanup, 'remove_directory', side_effect=lambda *args: calls.append('delete') or False
        ), patch.object(cleanup.Path, 'home', return_value=Path(folder)):
            self.assertTrue(cleanup.cleanup())
        self.assertEqual(calls[0], 'stop')
        self.assertIn('delete', calls)

    def test_individual_cleanup_preserves_other_app_and_shared_dependencies(self):
        for module, other in (('code', 'live'), ('live', 'code')):
            with self.subTest(module=module), tempfile.TemporaryDirectory() as folder:
                root = Path(folder).resolve()
                for name in ('node_modules', 'dist/aidiy_code', 'dist/aidiy_live', 'out/aidiy_code', 'out/aidiy_live', 'aidiy_live/dist', '.local/bin'):
                    (root / name).mkdir(parents=True, exist_ok=True)
                for name in ('code', 'live'):
                    (root / '.local/bin' / f'aidiy_{name}.cmd').write_text('test', encoding='utf-8')
                with patch.object(cleanup, 'FRONTEND_VSCODE_DIR', root), patch.object(cleanup.Path, 'home', return_value=root), patch.object(
                    cleanup, 'uninstall_extension', return_value=(True, 1)
                ) as extension, patch.object(cleanup, 'stop_standalone_processes', return_value=True) as stop:
                    self.assertTrue(cleanup.cleanup_app(module))
                extension.assert_called_once_with(module)
                stop.assert_called_once_with(module)
                self.assertFalse((root / '.local/bin' / f'aidiy_{module}.cmd').exists())
                self.assertFalse((root / f'dist/aidiy_{module}').exists())
                self.assertTrue((root / '.local/bin' / f'aidiy_{other}.cmd').exists())
                self.assertTrue((root / f'dist/aidiy_{other}').exists())
                self.assertTrue((root / 'node_modules').exists())

    def test_root_cleanup_forces_stop_before_file_operations(self):
        spec = importlib.util.spec_from_file_location('root_cleanup_process_tests', ROOT.parent.parent / '_cleanup.py')
        root_cleanup = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(root_cleanup)
        start = Mock()
        standalone = Mock()
        standalone.stop_standalone_processes.return_value = True
        with patch.object(root_cleanup, '_load_folder_start_module', return_value=start), patch.object(
            root_cleanup, '_load_folder_module', return_value=standalone
        ) as load, patch.object(root_cleanup.time, 'sleep'):
            root_cleanup.stop_all_services({})
        self.assertEqual(start.kill_ports.call_count, len(root_cleanup.SERVICE_CLEANUP_TARGETS))
        self.assertEqual([call.args[0] for call in load.call_args_list], ['frontend_ide/host', 'backend_tools'])
        standalone.stop_standalone_processes.assert_called_once()

    def test_root_stop_continues_after_failure(self):
        spec = importlib.util.spec_from_file_location('root_cleanup_process_failure_tests', ROOT.parent.parent / '_cleanup.py')
        root_cleanup = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(root_cleanup)
        start = Mock()
        start.kill_ports.side_effect = [RuntimeError('停止失敗')] + [None] * len(root_cleanup.SERVICE_CLEANUP_TARGETS)
        folder = Mock()
        with patch.object(root_cleanup, '_load_folder_start_module', return_value=start), patch.object(
            root_cleanup, '_load_folder_module', return_value=folder
        ), patch.object(root_cleanup.time, 'sleep'):
            # cleanup では残りを止めてから中止し、_start では警告だけで続行する。
            with self.assertRaises(RuntimeError):
                root_cleanup.stop_all_services({})
            self.assertEqual(start.kill_ports.call_count, len(root_cleanup.SERVICE_CLEANUP_TARGETS))
            folder.stop_tools_processes.assert_called_once()
            start.kill_ports.side_effect = None
            folder.stop_standalone_processes.return_value = False
            self.assertFalse(root_cleanup.stop_all_services({}, strict=False))

    def test_start_stop_keeps_standalone_code(self):
        spec = importlib.util.spec_from_file_location('root_cleanup_keep_code_tests', ROOT.parent.parent / '_cleanup.py')
        root_cleanup = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(root_cleanup)
        start = Mock()
        start.process_tree_pids.return_value = {111, 222}
        folder = Mock()
        with patch.object(root_cleanup, '_load_folder_start_module', return_value=start), patch.object(
            root_cleanup, '_load_folder_module', return_value=folder
        ), patch.object(root_cleanup.time, 'sleep'):
            self.assertTrue(root_cleanup.stop_all_services({}, strict=False, keep_code=True))
        # _start.py 用: Live だけ止め、Code を含む一括停止は呼ばない。
        start.kill_ports.assert_any_call('live')
        self.assertNotIn(unittest.mock.call('code'), start.kill_ports.call_args_list)
        folder.stop_standalone_processes.assert_not_called()
        # aidiy_code 配下（hermes の MCP 接続など）は tools の停止対象から外す。
        start.process_tree_pids.assert_called_once_with('code')
        folder.stop_tools_processes.assert_called_once_with(exclude_pids=frozenset({111, 222}))

        # 配下を判別できないときは tools の MCP 接続を止めず、失敗として報告する。
        start.process_tree_pids.side_effect = OSError('一覧取得失敗')
        folder.stop_tools_processes.reset_mock()
        with patch.object(root_cleanup, '_load_folder_start_module', return_value=start), patch.object(
            root_cleanup, '_load_folder_module', return_value=folder
        ), patch.object(root_cleanup.time, 'sleep'):
            self.assertFalse(root_cleanup.stop_all_services({}, strict=False, keep_code=True))
        folder.stop_tools_processes.assert_not_called()

    def test_standalone_tree_includes_descendants_only_of_selected_module(self):
        code = dict(ProcessId=10, ParentProcessId=1, Name='node.exe',
                    CommandLine=f'node.exe "{ROOT / "aidiy_code" / "launch.mjs"}"')
        hermes = dict(ProcessId=11, ParentProcessId=10, Name='python.exe', CommandLine='python.exe hermes')
        mcp = dict(ProcessId=12, ParentProcessId=11, Name='python.exe', CommandLine='python.exe mcp_stdio.py')
        live = dict(ProcessId=20, ParentProcessId=1, Name='node.exe',
                    CommandLine=f'node.exe "{ROOT / "aidiy_live" / "launch.mjs"}"')
        other = dict(ProcessId=30, ParentProcessId=1, Name='python.exe', CommandLine='python.exe mcp_stdio.py')
        with patch.object(processes, 'list_processes', return_value=[code, hermes, mcp, live, other]), patch.object(
            processes.sys, 'platform', 'win32'
        ):
            self.assertEqual(processes.standalone_tree_pids(ROOT, 'code'), {10, 11, 12})

    def test_transient_sharing_violation_is_retried(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            target = root / 'out'
            target.mkdir()
            locked = PermissionError('sharing violation')
            locked.winerror = 32
            with patch.object(cleanup, 'FRONTEND_VSCODE_DIR', root), patch.object(
                cleanup.shutil, 'rmtree', side_effect=[locked, None]
            ) as remove, patch.object(cleanup.time, 'sleep'):
                self.assertTrue(cleanup.remove_directory(target, 'out'))
            self.assertEqual(remove.call_count, 2)

    def test_directory_outside_project_is_not_deleted(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(cleanup.shutil, 'rmtree') as remove:
            self.assertFalse(cleanup.remove_directory(Path(folder), 'outside'))
            remove.assert_not_called()


if __name__ == '__main__':
    unittest.main()
