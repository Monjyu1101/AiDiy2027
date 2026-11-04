"""Navigator停止の所属判定と事前停止を模擬検証。実プロセスは操作しない。"""
import importlib.util
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
import _setup_processes as scope

def load(name, relative):
    spec = importlib.util.spec_from_file_location(name, ROOT / relative)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

class NaviLifecycle(unittest.TestCase):
    def test_cleanup_order_and_failure_preserve_shared_files(self):
        cleanup = load('navi_shared_cleanup_order', 'frontend_ide/_cleanup.py')
        for success in (True, False):
            calls = []
            def child(name):
                def run(*args, **kwargs):
                    calls.append(name)
                    return success if name == 'aidiy_navi' else True
                return SimpleNamespace(cleanup=run, cleanup_app=lambda *a, **k: True, cleanup_shared=lambda **k: True)
            with patch.object(cleanup, '_load_cleanup', side_effect=child), patch.object(Path, 'exists', return_value=True), patch.object(cleanup.shutil, 'rmtree') as remove:
                self.assertEqual(cleanup.cleanup({'ide': True}), success)
            self.assertEqual(calls[:2], ['aidiy_navi', 'aidiy_console'])
            self.assertEqual(calls.count('aidiy_navi'), 1)
            self.assertEqual(remove.call_count, 3 if success else 0)

    def test_setup_registers_navi_before_console_without_launching(self):
        setup = load('navi_shared_setup', 'frontend_ide/_setup.py')
        launcher = SimpleNamespace(install_launcher=Mock(return_value=True), ensure_launcher_path=Mock(return_value=True), launcher_path=Mock(return_value=ROOT / 'fixture/bin'))
        host = SimpleNamespace(install_standalone_launcher=Mock(return_value=True))
        with patch.object(setup, 'load_setup_module', return_value=launcher), patch.object(setup.subprocess, 'run', side_effect=AssertionError('no installation')), patch.object(setup.subprocess, 'Popen', side_effect=AssertionError('no launch')):
            self.assertTrue(setup.register_launchers(host))
        kinds = [call.args[1] for call in launcher.install_launcher.call_args_list]
        self.assertEqual(kinds[:2], ['navi', 'console'])
        self.assertEqual(kinds.count('navi'), 1)
        self.assertNotIn('aidiy_navi', (ROOT / 'scripts/起動対象.json').read_text(encoding='utf-8'))
        for icon in ('frontend_ide/public/AiDiy_navi.png', 'backend_diag/static/AiDiy_navi.png'):
            self.assertTrue((ROOT / icon).is_file())

    def test_navi_entries_and_children_but_not_ide_code_other_checkout(self):
        for windows, root in ((False, '/repo/AiDiy'), (True, 'C:/repo/AiDiy')):
            for entry in ('launch.mjs --app navi', 'desktop.cjs --app navi', 'aidiy_navi/launch.mjs'):
                records = [dict(ProcessId=10, ParentProcessId=1, Name='node', CommandLine=f'node {root}/frontend_ide/launch.mjs --app ide'),
                           dict(ProcessId=11, ParentProcessId=10, Name='node', CommandLine=f'node {root}/frontend_ide/{entry}'),
                           dict(ProcessId=12, ParentProcessId=11, Name='python', CommandLine='python agent.py'),
                           dict(ProcessId=13, ParentProcessId=10, Name='electron', CommandLine='electron --type=renderer'),
                           dict(ProcessId=14, ParentProcessId=1, Name='node', CommandLine=f'node {root}/frontend_ide/launch.mjs --app code'),
                           dict(ProcessId=15, ParentProcessId=1, Name='node', CommandLine=f'node {root}-other/frontend_ide/launch.mjs --app navi')]
                with self.subTest(windows=windows, entry=entry):
                    self.assertEqual(set(scope.select_targets(records, root, windows, 999)), {11, 12})

    def test_orphan_navi_profile_requires_owned_electron(self):
        root = 'C:/repo/AiDiy'
        exe = root + '/frontend_ide/node_modules/electron/dist/electron.exe'
        p = dict(Name='electron.exe', ExecutablePath=exe, CommandLine=f'"{exe}" --type=renderer --user-data-dir=C:/profiles/aidiy_navi_vue')
        self.assertEqual(scope.process_role(p, root, True), 'navi')
        self.assertIsNone(scope.process_role(p, root + '-other', True))

    def test_cleanup_stops_navi_even_when_ide_cleanup_unselected(self):
        cleanup = load('navi_cleanup_root', '_cleanup.py')
        starts = {}
        def start(folder):
            return starts.setdefault(folder, SimpleNamespace(kill_ports=Mock(return_value=True)))
        modules = SimpleNamespace(stop_standalone_processes=Mock(return_value=True), stop_tools_processes=Mock(return_value=True))
        with patch.object(cleanup, '_load_folder_start_module', side_effect=start), patch.object(cleanup, '_load_folder_module', return_value=modules), patch.object(cleanup.time, 'sleep'), patch.object(cleanup.subprocess, 'run', side_effect=AssertionError('real process forbidden')):
            self.assertTrue(cleanup.stop_all_services({'ide': False}))
            starts['frontend_ide/aidiy_navi'].kill_ports.assert_called_once_with()
            starts['frontend_ide/viewer'].kill_ports.assert_called_once_with()
            order = list(starts)
            self.assertEqual(order.index('frontend_ide/aidiy_navi') + 1, order.index('frontend_ide/aidiy_console'))
            starts['frontend_ide/aidiy_navi'].kill_ports.return_value = False
            with self.assertRaises(RuntimeError):
                cleanup.stop_all_services({'ide': False})

    def test_official_cleanup_matcher_is_kind_and_checkout_scoped(self):
        start = load('navi_start_matcher', 'frontend_ide/viewer/_start.py')
        root = ROOT / 'frontend_ide/viewer'
        for kind in ('navi', 'ide', 'code'):
            p = dict(Name='node', CommandLine=f'node "{ROOT}/frontend_ide/launch.mjs" --app {kind}')
            self.assertEqual(start.is_dev_process(p, root, True, 'navi'), kind == 'navi')
        p = dict(Name='electron.exe', CommandLine='electron.exe C:/other/frontend_ide/desktop.cjs --app navi')
        self.assertFalse(start.is_dev_process(p, root, True, 'navi'))

if __name__ == '__main__':
    unittest.main()
