# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""CPUのPATH登録・解除・起動委譲を一時環境とモックだけで確認する。"""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]
CPU = ROOT / 'frontend_ide/aidiy_cpu'


def load(path):
    spec = importlib.util.spec_from_file_location('cpu_test_' + path.stem, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class CPULauncherTests(unittest.TestCase):
    def test_registration_and_owned_removal_on_all_platforms(self):
        launcher = load(ROOT / 'frontend_ide/viewer/launcher.py')
        for platform in ('win32', 'linux', 'darwin'):
            with self.subTest(platform=platform), tempfile.TemporaryDirectory() as tmp:
                with patch.object(launcher._path_helper, 'launcher_directory', side_effect=lambda name: Path(tmp) / '_AIDIY' / name / 'bin'), patch.object(launcher.sys, 'platform', platform), patch.object(launcher.shutil, 'which', return_value='/node path/node'), patch.object(launcher, 'ensure_launcher_path', return_value=True), patch.object(launcher, 'remove_launcher_path', return_value=True):
                    launcher.install_launcher(CPU, 'cpu')
                    target = launcher.launcher_path('cpu')
                    content = target.read_text(encoding='utf-8')
                    self.assertIn(str(CPU / 'launch.mjs'), content)
                    self.assertIn('%*' if platform == 'win32' else '"$@"', content)
                    self.assertNotIn('--remote-debugging', content)
                    self.assertTrue(launcher.remove_launcher(CPU.parent / 'other-copy', 'cpu'))
                    self.assertTrue(target.exists(), '別配置先のランチャーは保持する')
                    self.assertTrue(launcher.remove_launcher(CPU, 'cpu'))
                    self.assertFalse(target.exists())

    def test_start_and_stop_delegate_cpu_kind_only(self):
        module = load(CPU / '_start.py')
        with patch.object(module.shared, 'start', return_value='process') as start, patch.object(module.shared, 'kill_ports') as kill, patch.object(module.shared, 'process_tree_pids', return_value={42}) as pids:
            self.assertEqual(module.start(True), 'process')
            module.kill_ports()
            self.assertEqual(module.process_tree_pids(), {42})
            start.assert_called_once_with(True, kind='cpu')
            kill.assert_called_once_with(kind='cpu')
            pids.assert_called_once_with(kind='cpu')

    def test_cleanup_does_not_unlink_after_stop_failure(self):
        cleanup = load(CPU / '_cleanup.py')
        launcher = Mock()
        with patch.object(cleanup, 'load', side_effect=[Mock(kill_ports=Mock(side_effect=RuntimeError('still running'))), launcher]):
            self.assertFalse(cleanup.cleanup())
        launcher.remove_launcher.assert_not_called()

    def test_cpu_processes_are_not_ide_or_other_repository(self):
        start = load(ROOT / 'frontend_ide/viewer/_start.py')
        scope = load(ROOT / 'scripts/_setup_processes.py')
        for entry in ('frontend_ide/launch.mjs', 'frontend_ide/aidiy_cpu/launch.mjs'):
            proc = {'Name': 'node', 'CommandLine': f'node "{ROOT / entry}" --app cpu'}
            self.assertTrue(start.is_dev_process(proc, ROOT / 'frontend_ide/viewer', False, 'cpu'))
            self.assertFalse(start.is_dev_process(proc, ROOT / 'frontend_ide/viewer', False, 'ide'))
            self.assertFalse(start.is_dev_process(proc, ROOT / 'other/frontend_ide/viewer', False, 'cpu'))
            # ROOT は実行環境のパス表記なので、Windows ではその規則で照合する。
            self.assertEqual(scope.process_role(proc, ROOT, os.name == 'nt'), 'cpu')

    def test_public_commands_and_no_automatic_service(self):
        package = json.loads((ROOT / 'frontend_ide/package.json').read_text())
        self.assertEqual(package['scripts']['cpu'], 'node launch.mjs --app cpu')
        self.assertIn("launch('cpu')", (CPU / 'launch.mjs').read_text())
        self.assertIn('aidiy_cpu\\launch.mjs', (ROOT / 'frontend_ide/aidiy_cpu.cmd').read_text())
        entry = next(item for item in json.loads((ROOT / 'scripts/起動対象.json').read_text()) if item['id'] == 'cpu')
        self.assertFalse(entry['初期設定']['起動対象'])
        self.assertFalse(entry['起動管理'])


class CPUStartTests(unittest.TestCase):
    def test_cpu_opt_in_has_no_backend_requirement_and_no_reopen(self):
        module = load(ROOT / '_start.py')
        with patch.object(module, 'prompt_choice', side_effect=lambda label, default_yes: 'CPU' in label):
            choices = module.collect_startup_choices()
        self.assertTrue(module.CPU_ENABLED)
        self.assertEqual(len(choices), 14)
        with patch.object(module, 'start_service', return_value=True) as start, patch.object(module, 'wait_for_services_quiet'):
            flags = module.start_initial_services(False, False, False, False, False, False, {}, {}, None, cpu_enabled=True)
        start.assert_called_once_with('フロントエンド(cpu)', {}, {}, None)
        self.assertFalse(flags['フロントエンド(cpu)'])
        cpu = Mock()
        cpu.check_environment.return_value = (True, 'ready')
        with patch.object(module, 'CPU', cpu), patch.object(module, 'get_npm_command', return_value=None):
            self.assertTrue(module.validate_initial_environment(False, False, False, False, False, False, cpu_enabled=True)[0])
        cpu.check_environment.assert_called_once_with()
        with patch.object(module, 'CPU', cpu), patch.object(module, 'cleanup_stop_requested_services', return_value=set()), patch.object(module, 'attach_output_thread'):
            self.assertTrue(module.start_service('フロントエンド(cpu)', {}, {}, None))
        cpu.start.assert_called_once_with()

    def test_setup_defers_and_cpu_cleanup_preserves_shared_dependencies(self):
        setup = load(CPU / '_setup.py')
        with patch.object(setup.importlib.util, 'spec_from_file_location') as loader:
            self.assertTrue(setup.setup({'_defer_ide_launchers': True}))
            loader.assert_not_called()
        cleanup = load(CPU / '_cleanup.py')
        starter, launcher = Mock(), Mock()
        launcher.remove_launcher.return_value = True
        with patch.object(cleanup, 'load', side_effect=[starter, launcher]):
            self.assertTrue(cleanup.cleanup())
        starter.kill_ports.assert_called_once_with()
        launcher.remove_launcher.assert_called_once_with(CPU, 'cpu')

if __name__ == '__main__':
    unittest.main()
