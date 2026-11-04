# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""Task / Team の PATH 登録と停止対象を一時環境だけで確認する。"""
import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
ROOT = Path(__file__).resolve().parents[2]
def load(path):
    spec = importlib.util.spec_from_file_location('test_task_team_' + path.stem, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
class Launchers(unittest.TestCase):
    def test_path_launchers_windows_and_posix(self):
        launcher = load(ROOT / 'frontend_ide/viewer/launcher.py')
        for platform in ('win32', 'linux', 'darwin'):
            for kind in ('task', 'team'):
                with self.subTest(platform=platform, kind=kind), tempfile.TemporaryDirectory() as home:
                    with patch.object(Path, 'home', return_value=Path(home)), patch.object(launcher.sys, 'platform', platform), patch.object(launcher.shutil, 'which', return_value='/usr/bin/node'), patch.object(launcher, 'ensure_launcher_path', return_value=True), patch.object(Path, 'chmod', autospec=True) as chmod:
                        launcher.install_launcher(ROOT / 'frontend_ide' / ('aidiy_' + kind), kind)
                        path=launcher.launcher_path(kind)
                        self.assertIn('aidiy_' + kind, path.read_text())
                        self.assertNotIn('aidiy_avatar', path.read_text())
                        # WindowsのstatはPOSIX実行ビットを再現しない。chmodの要求を照合する。
                        if platform != 'win32': chmod.assert_called_once_with(path, 0o755)
                        else: chmod.assert_not_called()
    def test_process_scope_keeps_other_apps_safe(self):
        start=load(ROOT / 'frontend_ide/viewer/_start.py')
        scope=load(ROOT / 'scripts/_setup_processes.py')
        for kind in ('task', 'team'):
            # POSIX引数解析へWindowsのバックスラッシュを裸で渡さない。
            proc={'Name':'node','CommandLine':f'node "{(ROOT / "frontend_ide/launch.mjs").as_posix()}" --app {kind}'}
            self.assertTrue(start.is_dev_process(proc, ROOT / 'frontend_ide/viewer', False, kind))
            self.assertFalse(start.is_dev_process(proc, ROOT / 'frontend_ide/viewer', False, 'ide'))
            fixture_root = '/repo/AiDiy'
            fixture = {'Name': 'node', 'CommandLine': f'node {fixture_root}/frontend_ide/launch.mjs --app {kind}'}
            self.assertEqual(scope.process_role(fixture, fixture_root, False), kind)
        self.assertEqual(scope.KEEP, frozenset(('code','ide','frontend_channels')))
if __name__ == '__main__': unittest.main()
