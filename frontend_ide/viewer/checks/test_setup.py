# -*- coding: utf-8 -*-
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""IDE の Windows セットアップが共通 Electron 資産を再利用することを確認する。"""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location('viewer_setup_test', ROOT / 'frontend_ide/viewer/_setup.py')
viewer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(viewer)
import _setup_electron as common


class ViewerSetupTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch.object(viewer, "check_project_node_runtime", return_value=(True, "fixture Node")))
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.project = Path(temporary.name)
        self.target = self.project / 'frontend_ide/viewer'
        self.electron = self.target / 'node_modules/electron'
        self.electron.mkdir(parents=True)
        (self.electron / 'package.json').write_text(json.dumps({'version': '44.7.0'}), encoding='utf-8')
        (self.target / 'package.json').write_text(json.dumps({'engines': {'node': '>=22.13'}}), encoding='utf-8')
        (self.target / 'package-lock.json').write_text('{}', encoding='utf-8')
        for name in ('vue', '@xterm/xterm', '@xterm/addon-fit', 'node-pty', 'ws'):
            (self.target.parent / 'node_modules' / name).mkdir(parents=True)
        self.cache = self.project / '.aidiy_cache/electron'
        self.enterContext(patch.object(viewer, 'THIS_DIR', self.target))
        self.enterContext(patch.object(common, 'CACHE_DIR', self.cache))
        self.enterContext(patch.object(viewer.sys, 'platform', 'win32'))
        self.enterContext(patch.object(common.platform, 'machine', return_value='AMD64'))
        self.enterContext(patch.dict(os.environ, {}, clear=True))
        self.enterContext(patch.object(viewer.shutil, 'which', return_value='npm.cmd'))
        self.guard = self.enterContext(patch.object(viewer, 'frontend_dependency_guard', return_value=None))
        self.enterContext(patch.object(common, '_runtime_in_use', return_value=False))
        self.run = self.enterContext(patch.object(viewer.subprocess, 'run'))
        self.launcher = self.enterContext(patch.object(viewer, 'install_launcher'))
        self.download = self.enterContext(patch.object(common.urllib.request, 'urlopen', side_effect=OSError('network unavailable')))
        self.output = self.enterContext(contextlib.redirect_stdout(io.StringIO()))

    def make_cached_zip(self, version='44.7.0', *, name=None, contents_version=None):
        self.cache.mkdir(parents=True, exist_ok=True)
        path = self.cache / (name or f'electron-v{version}-win32-x64.zip')
        with zipfile.ZipFile(path, 'w') as archive:
            archive.writestr('electron.exe', version.encode())
            archive.writestr('version', contents_version or version)
        return path

    def fail_update_after_ci(self, *, update_version=None):
        def npm_run(command, **kwargs):
            if command[1] == 'ci':
                # npm ci removes dist/path.txt along with the rest of node_modules.
                shutil.rmtree(self.target / 'node_modules')
                self.electron.mkdir(parents=True)
                (self.electron / 'package.json').write_text(json.dumps({'version': '44.7.0'}), encoding='utf-8')
            elif command[1:3] == ['update', 'electron']:
                if update_version:
                    (self.electron / 'package.json').write_text(json.dumps({'version': update_version}), encoding='utf-8')
                raise subprocess.CalledProcessError(1, command, stderr='ENOTCACHED')

        self.run.side_effect = npm_run

    def assert_recovery_failed(self):
        self.assertFalse(viewer.setup())
        self.assertEqual(self.run.call_count, 2)
        self.download.assert_not_called()
        self.launcher.assert_not_called()
        self.assertFalse(common.electron_binary_ready(self.target))

    def assert_installed(self):
        self.assertTrue(viewer.setup())
        npm = self.run.call_args_list[0]
        self.assertEqual(npm.args[0][1], 'ci')
        update = self.run.call_args_list[1]
        self.assertEqual(update.args[0], ['npm.cmd', 'update', 'electron', '--include=dev', '--no-fund', '--no-audit'])
        for call in (npm, update):
            self.assertEqual(call.kwargs['env']['ELECTRON_SKIP_BINARY_DOWNLOAD'], '1')
        self.assertEqual(self.run.call_args_list[-1].args[0], ['npm.cmd', 'run', 'build'])
        self.launcher.assert_called_once_with(self.target)
        self.download.assert_not_called()
        self.assertTrue(common.electron_binary_ready(self.target))

    def test_windows_reuses_host_binary_without_node_or_python_download(self):
        dist = self.project / 'frontend_ide/host/node_modules/electron/dist'
        dist.mkdir(parents=True)
        (dist / 'electron.exe').write_bytes(b'binary')
        (dist / 'version').write_text('44.7.0', encoding='utf-8')
        self.assert_installed()
        self.assertEqual((self.electron / 'dist/electron.exe').read_bytes(), b'binary')

    def test_windows_reuses_cached_zip_without_network(self):
        self.cache.mkdir(parents=True)
        with patch.object(common.platform, 'machine', return_value='AMD64'):
            with zipfile.ZipFile(self.cache / 'electron-v44.7.0-win32-x64.zip', 'w') as archive:
                archive.writestr('electron.exe', b'binary')
                archive.writestr('version', '44.7.0')
            self.assert_installed()

    def test_binary_failure_stops_before_build_and_launcher(self):
        with patch.object(viewer, 'prepare_electron_binary', return_value=False):
            self.assertFalse(viewer.setup())
        self.assertEqual(self.run.call_count, 2)
        self.launcher.assert_not_called()

    def test_locked_old_version_updates_before_reusing_newer_cache(self):
        self.cache.mkdir(parents=True)
        with patch.object(common.platform, 'machine', return_value='AMD64'):
            for version in ('44.7.0', '44.7.2'):
                with zipfile.ZipFile(self.cache / f'electron-v{version}-win32-x64.zip', 'w') as archive:
                    archive.writestr('electron.exe', version.encode())
                    archive.writestr('version', version)
            before = {path.name: path.read_bytes() for path in self.cache.iterdir()}

            def npm_run(command, **kwargs):
                if command[1] == 'ci':
                    version = '44.7.0'
                elif command[1:3] == ['update', 'electron']:
                    version = '44.7.2'
                else:
                    return
                (self.electron / 'package.json').write_text(json.dumps({'version': version}), encoding='utf-8')

            self.run.side_effect = npm_run
            self.assert_installed()
            self.assertEqual((self.electron / 'dist/version').read_text(encoding='utf-8'), '44.7.2')
            self.assertEqual({path.name: path.read_bytes() for path in self.cache.iterdir()}, before)

    def test_update_failure_does_not_download_locked_old_binary(self):
        self.fail_update_after_ci()
        self.assert_recovery_failed()

    def test_update_failure_restores_cached_binary_removed_by_ci(self):
        archive = self.make_cached_zip()
        before = archive.read_bytes()
        dist = self.electron / 'dist'
        dist.mkdir()
        (dist / 'electron.exe').write_bytes(b'previous binary')
        (dist / 'version').write_text('44.7.0', encoding='utf-8')
        (self.electron / 'path.txt').write_text('electron.exe', encoding='utf-8')
        self.assertTrue(common.electron_binary_ready(self.target))
        self.fail_update_after_ci()
        self.assert_installed()
        self.assertEqual((dist / 'electron.exe').read_bytes(), b'44.7.0')
        self.assertEqual(archive.read_bytes(), before)
        self.assertIn('更新', self.output.getvalue())
        self.assertIn('失敗', self.output.getvalue())

    def test_update_failure_reuses_matching_peer_binary(self):
        dist = self.project / 'frontend_ide/host/node_modules/electron/dist'
        dist.mkdir(parents=True)
        (dist / 'electron.exe').write_bytes(b'peer binary')
        (dist / 'version').write_text('44.7.0', encoding='utf-8')
        self.fail_update_after_ci()
        self.assert_installed()
        self.assertEqual((self.electron / 'dist/electron.exe').read_bytes(), b'peer binary')

    def test_update_failure_requires_current_installed_package_version(self):
        old = self.make_cached_zip()
        current = self.make_cached_zip('44.7.2')
        before = {path.name: path.read_bytes() for path in (old, current)}
        self.fail_update_after_ci(update_version='44.7.2')
        self.assert_installed()
        self.assertEqual((self.electron / 'dist/version').read_text(encoding='utf-8'), '44.7.2')
        self.assertEqual({path.name: path.read_bytes() for path in self.cache.iterdir()}, before)

    def test_partial_update_does_not_restore_previous_package_version(self):
        archive = self.make_cached_zip()
        before = archive.read_bytes()
        self.fail_update_after_ci(update_version='44.7.2')
        self.assert_recovery_failed()
        self.assertEqual(archive.read_bytes(), before)

    def test_update_failure_rejects_other_versions_platforms_and_architectures(self):
        for name in ('electron-v44.7.2-win32-x64.zip', 'electron-v44.7.0-linux-x64.zip',
                     'electron-v44.7.0-win32-arm64.zip', 'unrelated.zip'):
            self.make_cached_zip(name=name)
        dist = self.project / 'frontend_ide/host/node_modules/electron/dist'
        dist.mkdir(parents=True)
        (dist / 'electron.exe').write_bytes(b'wrong version')
        (dist / 'version').write_text('44.7.2', encoding='utf-8')
        before = {path.name: path.read_bytes() for path in self.cache.iterdir()}
        self.fail_update_after_ci()
        self.assert_recovery_failed()
        self.assertEqual({path.name: path.read_bytes() for path in self.cache.iterdir()}, before)

    def test_update_failure_rejects_corrupt_or_mislabeled_cache_without_replacing_it(self):
        for contents in (b'broken ZIP', None):
            with self.subTest(contents=contents):
                archive = self.make_cached_zip(contents_version='44.7.2')
                if contents is not None:
                    archive.write_bytes(contents)
                before = archive.read_bytes()
                self.run.reset_mock()
                self.fail_update_after_ci()
                self.assert_recovery_failed()
                self.assertEqual(archive.read_bytes(), before)

    def test_update_failure_rejects_corrupt_binary_payload_before_installing(self):
        archive = self.make_cached_zip()
        # Keep the ZIP directory/version readable but invalidate the executable CRC.
        corrupted = archive.read_bytes().replace(b'44.7.0', b'broken', 1)
        archive.write_bytes(corrupted)
        self.assertTrue(common._archive_ready(archive, '44.7.0'))
        self.fail_update_after_ci()
        self.assert_recovery_failed()
        self.assertFalse((self.electron / 'dist').exists())
        self.assertEqual(archive.read_bytes(), corrupted)

    def test_update_failure_without_package_metadata_fails_without_download(self):
        self.make_cached_zip()

        def npm_run(command, **kwargs):
            if command[1:3] == ['update', 'electron']:
                (self.electron / 'package.json').unlink()
                raise subprocess.CalledProcessError(1, command)

        self.run.side_effect = npm_run
        self.assert_recovery_failed()

    def test_web_and_explicit_skip_continue_after_update_failure_without_binary(self):
        for env in ({'CODESPACES': 'true'}, {'ELECTRON_SKIP_BINARY_DOWNLOAD': '1'}):
            with self.subTest(env=env), patch.dict(os.environ, env, clear=True), patch.object(viewer, 'prepare_electron_binary') as prepare:
                self.fail_update_after_ci()
                self.assertTrue(viewer.setup())
                prepare.assert_not_called()
        self.download.assert_not_called()

    def test_cache_only_preparation_and_path_repair_on_each_platform(self):
        for platform_name in ('win32', 'linux', 'darwin'):
            with self.subTest(platform=platform_name), patch.object(common.sys, 'platform', platform_name), patch.object(
                common.shutil, 'which', return_value=None
            ):
                target = self.project / platform_name / 'frontend_ide/viewer'
                electron = target / 'node_modules/electron'
                electron.mkdir(parents=True)
                (electron / 'package.json').write_text(json.dumps({'version': '44.7.0'}), encoding='utf-8')
                self.assertFalse(common.prepare_electron_binary(target, 'test', allow_download=False))
                executable = common.electron_executable_name()
                archive = self.cache / f'electron-v44.7.0-{platform_name}-x64.zip'
                with zipfile.ZipFile(archive, 'w') as zipped:
                    zipped.writestr(executable, b'binary')
                    zipped.writestr('version', '44.7.0')
                before = archive.read_bytes()
                self.assertTrue(common.prepare_electron_binary(target, 'test', allow_download=False))
                self.assertTrue(common.electron_binary_ready(target))
                (electron / 'path.txt').unlink()
                self.assertTrue(common.prepare_electron_binary(target, 'test', allow_download=False))
                self.assertTrue(common.electron_binary_ready(target))
                self.assertEqual(archive.read_bytes(), before)
                # sys.platform の模擬だけでは、Windows のファイル権限は POSIX にならない。
                if platform_name != 'win32' and os.name != 'nt':
                    self.assertEqual((electron / 'dist' / executable).stat().st_mode & 0o777, 0o755)
        self.download.assert_not_called()

    def test_web_and_explicit_skip_do_not_prepare_binary(self):
        for env in ({'CODESPACES': 'true'}, {'ELECTRON_SKIP_BINARY_DOWNLOAD': '1'}):
            with self.subTest(env=env), patch.dict(os.environ, env, clear=True), patch.object(viewer, 'prepare_electron_binary') as prepare:
                self.assertTrue(viewer.setup())
                self.assertEqual(self.run.call_args_list[-2].kwargs['env']['ELECTRON_SKIP_BINARY_DOWNLOAD'], '1')
                prepare.assert_not_called()
        self.download.assert_not_called()

    def test_in_use_matching_dependencies_only_build_and_register(self):
        self.guard.return_value = True
        with patch.object(viewer, 'prepare_electron_binary') as prepare:
            self.assertTrue(viewer.setup())
        self.run.assert_called_once_with(['npm.cmd', 'run', 'build'], cwd=self.target.parent, check=True)
        prepare.assert_not_called()
        self.launcher.assert_called_once_with(self.target)
        self.guard.assert_called_once()
        self.assertEqual(self.guard.call_args.args, (self.target, 'IDE'))

    def test_in_use_mismatch_aborts_before_any_npm_or_launcher(self):
        self.guard.return_value = False
        with patch.object(viewer, 'prepare_electron_binary') as prepare:
            self.assertFalse(viewer.setup())
        self.run.assert_not_called()
        prepare.assert_not_called()
        self.launcher.assert_not_called()

    def test_missing_shared_dependencies_are_guarded_before_ci(self):
        (self.target.parent / 'node_modules/node-pty').rmdir()
        self.guard.side_effect = [True, False]
        self.assertFalse(viewer.setup())
        self.run.assert_not_called()
        self.launcher.assert_not_called()
        self.assertEqual(self.guard.call_args.args[0], self.target.parent)
        self.assertFalse(self.guard.call_args.kwargs['desktop'])

    def test_missing_shared_dependencies_install_when_not_in_use(self):
        (self.target.parent / 'node_modules/node-pty').rmdir()
        self.guard.side_effect = [True, None]
        self.assertTrue(viewer.setup())
        self.assertEqual([call.args[0][1] for call in self.run.call_args_list], ['ci', 'run'])
        self.assertTrue(all(call.kwargs['cwd'] == self.target.parent for call in self.run.call_args_list))

    def test_npm_failure_stops_before_binary_and_launcher(self):
        self.run.side_effect = subprocess.CalledProcessError(1, 'npm ci')
        with patch.object(viewer, 'prepare_electron_binary') as prepare:
            self.assertFalse(viewer.setup())
            prepare.assert_not_called()
        self.launcher.assert_not_called()


class SharedUiSetupTests(unittest.TestCase):
    def test_prepare_respects_guard_without_mutating_active_dependencies(self):
        spec = importlib.util.spec_from_file_location('shared_ui_setup_test', ROOT / 'frontend_ide/_setup.py')
        shared = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(shared)
        for guard_result in (True, False, None):
            with self.subTest(guard_result=guard_result), \
                    patch.object(shared, 'check_project_node_runtime', return_value=(True, 'fixture Node')), patch.object(shared.shutil, 'which', return_value='npm'), \
                    patch.object(shared, 'frontend_dependency_guard', return_value=guard_result) as guard, \
                    patch.object(shared.subprocess, 'run') as run:
                self.assertEqual(shared.prepare(), guard_result is not False)
                guard.assert_called_once_with(shared.ROOT, 'Console / Code / Live / IDE / Task / Team / Browser 共通UI', desktop=False)
                if guard_result is None:
                    run.assert_called_once()
                else:
                    run.assert_not_called()


if __name__ == '__main__':
    unittest.main()
