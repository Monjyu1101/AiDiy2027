# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""使用中Electronの依存更新をモックで確認。実プロセスは操作しない。"""
import json
import sys
import tempfile
import unittest
from pathlib import Path, PureWindowsPath
from unittest.mock import patch, Mock
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import _setup_electron as subject
import _cleanup_processes

class WindowsPathFixture(PureWindowsPath):
    """実ファイルに触れず、Windows の絶対パスを任意のホスト OS で使う。"""
    def resolve(self):
        return self


class InUseTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        package = {'dependencies': {'example':'1.0.0'}}
        (self.root/'package.json').write_text(json.dumps(package))
        (self.root/'package-lock.json').write_text(json.dumps({'packages':{'':package,'node_modules/example':{'version':'1.0.0'}}}))
        dep=self.root/'node_modules/example';dep.mkdir(parents=True)
        (dep/'package.json').write_text(json.dumps({'version':'1.0.0'}))

    def test_healthy_runtime_reused_without_npm_or_binary_replacement(self):
        dist = self.root / 'node_modules/electron/dist'
        dist.mkdir(parents=True)
        for name in ('dxcompiler.dll', 'ffmpeg.dll', 'icudtl.dat', 'resources.pak'):
            (dist / name).write_bytes(b'fixture')
        run=Mock();warning=Mock()
        with patch.object(subject,'_runtime_in_use',return_value=True),patch.object(subject,'electron_binary_ready',return_value=True),patch.object(subject,'prepare_electron_binary') as prepare:
            self.assertTrue(subject.setup_dependencies(self.root,'npm','IDE',run,warning=warning))
        run.assert_not_called();prepare.assert_not_called()
        self.assertIn('保留',warning.call_args.args[0])

    def test_in_use_missing_or_mismatched_dependency_fails_before_npm(self):
        for version in ('2.0.0', None):
            target=self.root/'node_modules/example/package.json'
            if version: target.write_text(json.dumps({'version':version}))
            else: target.unlink()
            run=Mock();error=Mock()
            with patch.object(subject,'_runtime_in_use',return_value=True),patch.object(subject,'electron_binary_ready',return_value=True):
                self.assertFalse(subject.setup_dependencies(self.root,'npm','IDE',run,error=error))
            run.assert_not_called();self.assertIn('閉じて',error.call_args.args[0])

    def test_changed_manifest_or_missing_binary_not_reused(self):
        with patch.object(subject,'_runtime_in_use',return_value=True),patch.object(subject,'electron_binary_ready',return_value=False):
            self.assertFalse(subject.frontend_dependency_guard(self.root,'IDE',error=lambda _:None))
        (self.root/'package.json').write_text('{}')
        self.assertFalse(subject._locked_dependencies_ready(self.root))

    def test_fresh_install_without_running_runtime_uses_normal_path(self):
        run=Mock(return_value=True)
        with patch.object(subject,'_runtime_in_use',return_value=False),patch.object(subject,'prepare_electron_binary',return_value=True):
            self.assertTrue(subject.setup_dependencies(self.root,'npm','IDE',run))
        self.assertEqual([c.args[0][1] for c in run.call_args_list],['install','update'])

    def test_process_enumeration_failure_does_not_mutate(self):
        run=Mock()
        with patch.object(subject,'_runtime_in_use',side_effect=OSError('unavailable')):
            self.assertFalse(subject.setup_dependencies(self.root,'npm','IDE',run,error=lambda _:None))
        run.assert_not_called()

    def test_windows_matches_exact_runtime_and_shared_parent(self):
        root=WindowsPathFixture(r'C:\fixture\frontend_ide')
        exe=str(root/'viewer/node_modules/electron/dist/electron.exe')
        with patch.object(subject.sys,'platform','win32'),patch.object(_cleanup_processes,'list_processes',return_value=[{'ExecutablePath':exe,'Name':'electron.exe'}]):
            self.assertTrue(subject._runtime_in_use(root))
            self.assertTrue(subject._runtime_in_use(root/'viewer'))
            self.assertFalse(subject._runtime_in_use(root.parent/'other/frontend_ide/viewer'))

    def test_shared_node_pty_protected_for_browser_or_worker(self):
        root=WindowsPathFixture(r'C:\fixture\frontend_ide')
        for entry in ('launch.mjs --app navi --browser','launch.mjs --app code --browser','aidiy_console/console-worker.mjs'):
            records=[{'Name':'node.exe','CommandLine':f'node "{root}/{entry.split()[0]}" '+ ' '.join(entry.split()[1:])}]
            with patch.object(subject.sys,'platform','win32'),patch.object(_cleanup_processes,'list_processes',return_value=records):
                self.assertTrue(subject._runtime_in_use(root))

    def test_only_platform_excluded_optional_dependencies_can_be_missing(self):
        lock=json.loads((self.root/'package-lock.json').read_text())
        lock['packages']['node_modules/native']={'version':'1','optional':True,'os':['darwin']}
        (self.root/'package-lock.json').write_text(json.dumps(lock))
        with patch.object(subject,'_electron_platform_arch',return_value=('win32','x64')):
            self.assertTrue(subject._locked_dependencies_ready(self.root))
            lock['packages']['node_modules/native']['os']=['win32']
            (self.root/'package-lock.json').write_text(json.dumps(lock))
            self.assertFalse(subject._locked_dependencies_ready(self.root))

    def test_missing_windows_dll_is_not_healthy(self):
        with patch.object(subject.sys,'platform','win32'),patch.object(subject,'_runtime_in_use',return_value=True),patch.object(subject,'electron_binary_ready',return_value=True):
            self.assertFalse(subject.frontend_dependency_guard(self.root,'IDE',error=lambda _:None))
            dist=self.root/'node_modules/electron/dist';dist.mkdir(parents=True)
            for name in ('dxcompiler.dll','ffmpeg.dll','icudtl.dat','resources.pak'):
                (dist/name).write_bytes(b'fixture')
            self.assertTrue(subject.frontend_dependency_guard(self.root,'IDE',warning=lambda _:None))

    def test_active_broken_binary_never_replaced(self):
        with patch.object(subject,'get_electron_version',return_value='44.7.0'),patch.object(subject,'electron_binary_ready',return_value=False),patch.object(subject,'_runtime_in_use',return_value=True),patch.object(subject,'_place_dist') as place:
            self.assertFalse(subject.prepare_electron_binary(self.root,'IDE',error=lambda _:None))
        place.assert_not_called()

if __name__=='__main__': unittest.main()
