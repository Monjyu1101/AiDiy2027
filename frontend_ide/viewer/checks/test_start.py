# -*- coding: utf-8 -*-
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

import importlib.util
import contextlib
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock, patch

spec = importlib.util.spec_from_file_location("dev_start", Path(__file__).resolve().parents[1] / "_start.py")
dev = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dev)

def load_root(name):
    spec = importlib.util.spec_from_file_location(f"dev_root{name}", dev.THIS_DIR.parent.parent / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

start = load_root("_start")
cleanup = load_root("_cleanup")


class StartTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch.object(dev, "check_node_environment", return_value=(True, "fixture Node")))
        self.enterContext(contextlib.redirect_stdout(io.StringIO()))

    def test_launch_is_detached_with_file_logs_and_auto_port(self):
        process = MagicMock()
        process.poll.return_value = None
        directory = self.enterContext(tempfile.TemporaryDirectory())
        with patch.object(dev, "THIS_DIR", Path(directory) / "frontend_ide/viewer"), patch.object(dev, "node_command", return_value="node"), patch.object(dev.subprocess, "Popen", return_value=process) as launch:
            dev.start()
            dev.start()
            for call in launch.call_args_list:
                self.assertEqual(call.args[0], ["node", str(dev.THIS_DIR / "launch.mjs"), str(dev.THIS_DIR.parent.parent)])
                self.assertEqual(call.kwargs["stdin"], dev.subprocess.DEVNULL)
                self.assertNotEqual(call.kwargs["stdout"], dev.subprocess.PIPE)
                if dev.sys.platform == "win32":
                    self.assertTrue(call.kwargs["creationflags"] & dev.subprocess.DETACHED_PROCESS)
                else:
                    self.assertTrue(call.kwargs["start_new_session"])
            dev.start(open_window=False)
            self.assertEqual(launch.call_args.args[0][-1], "--no-open")
        dev._processes.clear()

    def test_vue_process_matching_keeps_other_apps_out(self):
        root = dev.THIS_DIR.parent.parent / 'frontend_ide'
        for windows in (True, False):
            for kind in ('console', 'code', 'live', 'ide'):
                record = dict(Name='node', CommandLine=f'node "{root / "launch.mjs"}" --app {kind}')
                self.assertEqual(dev.is_dev_process(record, dev.THIS_DIR, windows), kind == 'ide')
                self.assertEqual(dev.is_dev_process(record, dev.THIS_DIR, windows, 'console'), kind == 'console')

    def test_shared_logs_use_repository_temp_without_moving_existing_data(self):
        directory = self.enterContext(tempfile.TemporaryDirectory(prefix='AiDiy 起動 '))
        root = Path(directory)
        module = root / 'frontend_ide/viewer'
        process = MagicMock()
        process.poll.return_value = None
        try:
            with patch.object(dev, 'THIS_DIR', module), patch.object(dev, 'node_command', return_value='node'), patch.object(dev.subprocess, 'Popen', return_value=process) as launch:
                for kind in ('ide', 'console', 'task', 'team', 'browser', 'cpu'):
                    with self.subTest(kind=kind):
                        previous = module / 'out' / f'aidiy_{kind}' / 'previous.log'
                        previous.parent.mkdir(parents=True)
                        previous.write_text('keep existing log', encoding='utf-8')
                        dev.start(kind=kind)
                        dev.start(kind=kind)
                        logs = root / 'temp' / f'aidiy_{kind}' / 'logs'
                        self.assertEqual(len(list(logs.glob('*.log'))), 2, '起動ごとに別ログを作る')
                        self.assertEqual(Path(launch.call_args.kwargs['stdout'].name).parent, logs)
                        self.assertEqual(launch.call_args.kwargs['cwd'], str(root))
                        self.assertEqual(list(previous.parent.iterdir()), [previous], '旧保存先へ書き戻さない')
                        self.assertEqual(previous.read_text(encoding='utf-8'), 'keep existing log')
        finally:
            dev._processes.clear()

    def test_log_storage_failure_does_not_launch_or_fall_back(self):
        directory = self.enterContext(tempfile.TemporaryDirectory())
        root = Path(directory)
        (root / 'temp').write_text('not a directory', encoding='utf-8')
        with patch.object(dev, 'THIS_DIR', root / 'frontend_ide/viewer'), patch.object(dev, 'node_command', return_value='node'), patch.object(dev.subprocess, 'Popen') as launch:
            with self.assertRaises(OSError):
                dev.start()
            launch.assert_not_called()
            self.assertFalse((root / 'frontend_ide/viewer/out').exists())

    def test_root_launch_order_and_no_dev_restart(self):
        with patch.object(start, "stop_all_tasks"), patch.object(start, "start_service", return_value=True) as launch, patch.object(start, "wait_for_services_quiet"):
            flags = start.start_initial_services(False, False, False, False, False, False, {}, {}, None,
                                                 console_enabled=True, code_enabled=True, live_enabled=True, dev_enabled=True, discord_enabled=True)
        self.assertEqual([c.args[0] for c in launch.call_args_list],
                         [f"フロントエンド({name})" for name in ("console", "code", "live", "IDE", "Discord")])
        self.assertFalse(flags["フロントエンド(console)"])
        self.assertFalse(flags["フロントエンド(IDE)"])

    def test_shutdown_preserves_dev_but_cleanup_stops_it(self):
        for keep in (True, False):
            process = MagicMock(pid=987654)
            module = MagicMock()
            with patch.object(start, "DEV", module), patch.object(start.sys, "platform", "win32"), patch.object(start.subprocess, "run") as kill:
                start.stop_processes({"フロントエンド(IDE)": process}, keep_standalone=keep)
            if keep:
                kill.assert_not_called()
                module.kill_ports.assert_not_called()
                process.wait.assert_not_called()
            else:
                self.assertEqual(kill.call_args.args[0], ["taskkill", "/F", "/T", "/PID", "987654"])
                module.kill_ports.assert_called_once()

    def test_cleanup_keep_dev_also_protects_descendants(self):
        for keep in (True, False):
            modules = {folder: MagicMock() for _, folder, _, _ in cleanup.SERVICE_CLEANUP_TARGETS}
            modules["frontend_ide/host"] = MagicMock()
            modules["frontend_ide/viewer"].process_tree_pids.return_value = {11, 12, 13}
            tools = MagicMock()
            with patch.object(cleanup, "_load_folder_start_module", side_effect=modules.__getitem__), patch.object(cleanup, "_load_folder_module", return_value=tools), patch.object(cleanup.time, "sleep"):
                self.assertTrue(cleanup.stop_all_services({}, keep_dev=keep))
            if keep:
                modules["frontend_ide/viewer"].kill_ports.assert_not_called()
                tools.stop_tools_processes.assert_called_once_with(exclude_pids=frozenset({11, 12, 13}))
            else:
                modules["frontend_ide/viewer"].kill_ports.assert_called_once()

    def test_protected_process_tree_excludes_other_apps(self):
        records = [dict(ProcessId=1, ParentProcessId=0, Name="node", CommandLine=f'node "{dev.THIS_DIR / "launch.mjs"}"'),
                   dict(ProcessId=2, ParentProcessId=1), dict(ProcessId=3, ParentProcessId=2),
                   dict(ProcessId=4, ParentProcessId=0, Name="node", CommandLine="node other.mjs")]
        with patch.object(dev, "list_processes", return_value=records):
            self.assertEqual(dev.process_tree_pids(), {1, 2, 3})

    def test_cleanup_matches_entry_not_project_argument_or_port(self):
        for windows, root in [(True, Path("C:/AiDiy Copy/frontend_ide/viewer")), (False, Path("/work/AiDiy Copy/frontend_ide/viewer"))]:
            def record(command, name="node.exe" if windows else "node"):
                return {"Name": name, "CommandLine": command}
            entry = str(root / "launch.mjs")
            self.assertTrue(dev.is_dev_process(record(f'node "{entry}" --no-open'), root, windows))
            self.assertFalse(dev.is_dev_process(record(f'node other.mjs "{entry}" --port 8097'), root, windows))
            self.assertFalse(dev.is_dev_process(record(f'node -e "{entry}"'), root, windows))
            self.assertFalse(dev.is_dev_process(record('node /other/frontend_ide/viewer/launch.mjs'), root, windows))
            self.assertFalse(dev.is_dev_process(record(f'python "{entry}"', "python"), root, windows))


if __name__ == "__main__":
    unittest.main()
