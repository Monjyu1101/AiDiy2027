# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""BrowserのPATH登録・解除・起動委譲を一時環境とモックだけで確認する。"""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]
BROWSER = ROOT / 'frontend_ide/aidiy_browser'


def load(path):
    spec = importlib.util.spec_from_file_location('browser_test_' + path.stem, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class BrowserLauncherTests(unittest.TestCase):
    def test_registration_and_owned_removal_on_all_platforms(self):
        launcher = load(ROOT / 'frontend_ide/viewer/launcher.py')
        for platform in ('win32', 'linux', 'darwin'):
            with self.subTest(platform=platform), tempfile.TemporaryDirectory() as tmp:
                with patch.object(launcher._path_helper, 'launcher_directory', side_effect=lambda name: Path(tmp) / '_AIDIY' / name / 'bin'), patch.object(launcher.sys, 'platform', platform), patch.object(launcher.shutil, 'which', return_value='/node path/node'), patch.object(launcher, 'ensure_launcher_path', return_value=True), patch.object(launcher, 'remove_launcher_path', return_value=True):
                    launcher.install_launcher(BROWSER, 'browser')
                    target = launcher.launcher_path('browser')
                    content = target.read_text(encoding='utf-8')
                    self.assertIn(str(BROWSER / 'launch.mjs'), content)
                    self.assertIn('%*' if platform == 'win32' else '"$@"', content)
                    self.assertNotIn('--remote-debugging', content)
                    self.assertTrue(launcher.remove_launcher(BROWSER.parent / 'other-copy', 'browser'))
                    self.assertTrue(target.exists(), '別配置先のランチャーは保持する')
                    self.assertTrue(launcher.remove_launcher(BROWSER, 'browser'))
                    self.assertFalse(target.exists())

    def test_start_and_stop_delegate_browser_kind_only(self):
        module = load(BROWSER / '_start.py')
        with patch.object(module.shared, 'start', return_value='process') as start, patch.object(module.shared, 'kill_ports') as kill, patch.object(module.shared, 'process_tree_pids', return_value={42}) as pids:
            self.assertEqual(module.start(True), 'process')
            with self.assertRaises(ValueError):
                module.start(False)
            module.kill_ports()
            self.assertEqual(module.process_tree_pids(), {42})
            start.assert_called_once_with(True, kind='browser')
            kill.assert_called_once_with(kind='browser')
            pids.assert_called_once_with(kind='browser')

    def test_cleanup_does_not_unlink_after_stop_failure(self):
        cleanup = load(BROWSER / '_cleanup.py')
        launcher = Mock()
        with patch.object(cleanup, 'load', side_effect=[Mock(kill_ports=Mock(side_effect=RuntimeError('still running'))), launcher]):
            self.assertFalse(cleanup.cleanup())
        launcher.remove_launcher.assert_not_called()

    def test_browser_processes_are_not_ide_or_other_repository(self):
        start = load(ROOT / 'frontend_ide/viewer/_start.py')
        scope = load(ROOT / 'scripts/_setup_processes.py')
        for entry in ('frontend_ide/launch.mjs', 'frontend_ide/aidiy_browser/launch.mjs'):
            proc = {'Name': 'node', 'CommandLine': f'node "{ROOT / entry}" --app browser'}
            self.assertTrue(start.is_dev_process(proc, ROOT / 'frontend_ide/viewer', False, 'browser'))
            self.assertFalse(start.is_dev_process(proc, ROOT / 'frontend_ide/viewer', False, 'ide'))
            self.assertFalse(start.is_dev_process(proc, ROOT / 'other/frontend_ide/viewer', False, 'browser'))
            # ROOT は実行環境のパス表記なので、Windows ではその規則で照合する。
            self.assertEqual(scope.process_role(proc, ROOT, os.name == 'nt'), 'browser')

    def test_public_commands_and_no_automatic_service(self):
        package = json.loads((ROOT / 'frontend_ide/package.json').read_text())
        self.assertEqual(package['scripts']['browser'], 'node launch.mjs --app browser')
        self.assertIn("launch('browser')", (BROWSER / 'launch.mjs').read_text())
        self.assertIn('aidiy_browser\\launch.mjs', (ROOT / 'frontend_ide/aidiy_browser.cmd').read_text())
        self.assertNotIn('aidiy_browser', (ROOT / 'scripts/起動対象.json').read_text())


if __name__ == '__main__':
    unittest.main()
