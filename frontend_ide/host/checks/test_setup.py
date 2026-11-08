# -*- coding: utf-8 -*-
#
# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""Avatar / VS Code / Discord 共通セットアップの再利用と取得回数を確認する。"""

import contextlib
import importlib.util
import io
import json
from pathlib import Path
import shutil
import tempfile
import unittest
import warnings
from unittest.mock import Mock, patch
import zipfile


ROOT = Path(__file__).resolve().parents[3]


def load_setup(name):
    spec = importlib.util.spec_from_file_location(name + '_setup', ROOT / name / '_setup.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


vscode = load_setup('frontend_ide/host')
avatar = load_setup('frontend_avatar')
import _setup_electron as common
import _cleanup_processes as processes


class ElectronSetupTest(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch.object(vscode, "check_project_node_runtime", return_value=(True, "fixture Node")))
        self.enterContext(patch.object(avatar, "check_project_node_runtime", return_value=(True, "fixture Node")))
        self.enterContext(patch.object(vscode, "check_vscode_runtime", return_value=(True, "fixture VS Code")))
        # 一時コピーの配布物試験。模擬Windowsでも実OSのPowerShell/プロセス一覧へ触れない。
        self.enterContext(patch.object(processes, 'list_processes', return_value=[]))
        self.enterContext(patch.object(vscode, 'ensure_launcher_path', return_value=True))
        self.enterContext(patch.object(avatar, 'ensure_launcher_path', return_value=True))
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.project = Path(temporary.name)
        self.cache = self.project / '_cache' / 'electron'
        self.enterContext(patch.object(common, 'CACHE_DIR', self.cache))
        self.enterContext(contextlib.redirect_stdout(io.StringIO()))
        self.root = self.make_app('frontend_ide/host')
        self.electron = self.root / 'node_modules' / 'electron'

    def make_app(self, name, version='44.5.1', parent=None):
        root = (parent or self.project) / name
        electron = root / 'node_modules' / 'electron'
        electron.mkdir(parents=True, exist_ok=True)
        (electron / 'package.json').write_text(json.dumps({'version': version}), encoding='utf-8')
        (root / 'package.json').write_text('{}', encoding='utf-8')
        return root

    def make_ready(self, root=None, version='44.5.1'):
        electron = (root or self.root) / 'node_modules' / 'electron'
        executable = common.electron_executable_name()
        binary = electron / 'dist' / executable
        binary.parent.mkdir(parents=True, exist_ok=True)
        binary.write_bytes(b'binary')
        (electron / 'dist' / 'version').write_text(version, encoding='utf-8')
        (electron / 'path.txt').write_text(executable, encoding='utf-8')

    def zip_bytes(self, version='44.5.1'):
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, 'w') as zipped:
            zipped.writestr(common.electron_executable_name(), b'binary')
            zipped.writestr('version', version)
        return archive.getvalue()

    def response(self, version='44.5.1'):
        data = self.zip_bytes(version)
        response = io.BytesIO(data)
        response.headers = {'Content-Length': str(len(data))}
        return response

    def make_cached_zip(self, version):
        plat, arch = common._electron_platform_arch()
        self.cache.mkdir(parents=True, exist_ok=True)
        archive = self.cache / f'electron-v{version}-{plat}-{arch}.zip'
        archive.write_bytes(self.zip_bytes(version))
        return archive

    def test_both_frontends_use_the_same_setup_function(self):
        self.assertIs(vscode.setup_dependencies, common.setup_dependencies)
        self.assertIs(avatar.setup_dependencies, common.setup_dependencies)

    def test_existing_binary_requires_matching_version_and_path(self):
        self.make_ready()
        self.assertTrue(common.electron_binary_ready(self.root))
        (self.electron / 'dist' / 'version').write_text('44.5.0', encoding='utf-8')
        self.assertFalse(common.electron_binary_ready(self.root))
        (self.electron / 'dist' / 'version').write_text('44.5.1', encoding='utf-8')
        (self.electron / 'path.txt').unlink()
        self.assertFalse(common.electron_binary_ready(self.root))

    def test_prepared_binary_needs_no_network(self):
        self.make_ready()
        with patch.object(common.urllib.request, 'urlopen') as download:
            self.assertTrue(common.prepare_electron_binary(self.root, 'test'))
            download.assert_not_called()

    def test_missing_path_is_repaired_without_download(self):
        self.make_ready()
        (self.electron / 'path.txt').unlink()
        with patch.object(common.urllib.request, 'urlopen') as download:
            self.assertTrue(common.prepare_electron_binary(self.root, 'test'))
            download.assert_not_called()
        self.assertTrue(common.electron_binary_ready(self.root))

    def test_peer_binary_is_copied_without_network(self):
        peer = self.make_app('frontend_avatar')
        self.make_ready(peer)
        with patch.object(common.urllib.request, 'urlopen') as download:
            self.assertTrue(common.prepare_electron_binary(self.root, 'test'))
            download.assert_not_called()
        shutil.rmtree(peer / 'node_modules' / 'electron' / 'dist')
        self.assertTrue(common.electron_binary_ready(self.root))

    def test_discord_binary_is_reused_without_network(self):
        peer = self.make_app('frontend_channels/discord')
        self.make_ready(peer)
        with patch.object(common.urllib.request, 'urlopen') as download:
            self.assertTrue(common.prepare_electron_binary(self.root, 'test'))
            download.assert_not_called()
        self.assertTrue(common.electron_binary_ready(self.root))

    def test_channel_siblings_reuse_root_peer_without_network(self):
        self.make_ready(self.root)
        for folder in ('frontend_channels/discord', 'frontend_channels/slack'):
            with self.subTest(folder=folder):
                target = self.make_app(folder)
                with patch.object(common.urllib.request, 'urlopen') as download:
                    self.assertTrue(common.prepare_electron_binary(target, 'test'))
                    download.assert_not_called()
                self.assertTrue(common.electron_binary_ready(target))

    def test_different_peer_version_is_not_reused(self):
        peer = self.make_app('frontend_avatar', '44.5.0')
        self.make_ready(peer, '44.5.0')
        with patch.object(common.urllib.request, 'urlopen', return_value=self.response()) as download:
            self.assertTrue(common.prepare_electron_binary(self.root, 'test'))
            download.assert_called_once()
        self.assertTrue(common.electron_binary_ready(self.root))

    def test_download_is_shared_and_zip_survives_reinstall(self):
        with patch.object(common.urllib.request, 'urlopen', return_value=self.response()) as download:
            self.assertTrue(common.prepare_electron_binary(self.root, 'test'))
            peer = self.make_app('frontend_avatar')
            self.assertTrue(common.prepare_electron_binary(peer, 'test'))
            shutil.rmtree(self.electron / 'dist')
            (self.electron / 'path.txt').unlink()
            shutil.rmtree(peer / 'node_modules' / 'electron' / 'dist')
            self.assertTrue(common.prepare_electron_binary(self.root, 'test'))
            download.assert_called_once()
        self.assertEqual(len(list(self.cache.glob('*.zip'))), 1)

    def test_python_download_prepares_each_platform(self):
        for platform_name in ('win32', 'linux', 'darwin'):
            with self.subTest(platform=platform_name), patch.object(common.sys, 'platform', platform_name), patch.object(
                common.platform, 'machine', return_value='AMD64'
            ), patch.object(common.shutil, 'which', return_value=None):
                root = self.make_app('frontend_ide/host', parent=self.project / platform_name)
                with patch.object(common.urllib.request, 'urlopen', return_value=self.response()) as download:
                    self.assertTrue(common.prepare_electron_binary(root, 'test'))
                    self.assertTrue(common.electron_binary_ready(root))
                    self.assertIn(f'electron-v44.5.1-{platform_name}-x64.zip', download.call_args.args[0])

    def test_latest_download_keeps_old_cache_on_each_platform(self):
        for plat in ('win32', 'linux', 'darwin'):
            with self.subTest(platform=plat), patch.object(common.sys, 'platform', plat), patch.object(
                common.platform, 'machine', return_value='AMD64'
            ), patch.object(common.shutil, 'which', return_value=None):
                root = self.make_app('frontend_ide/host', '44.7.0', parent=self.project / plat)
                old = self.make_cached_zip('44.5.1')
                with patch.object(common.urllib.request, 'urlopen', return_value=self.response('44.7.0')):
                    self.assertTrue(common.prepare_electron_binary(root, 'test'))
                self.assertTrue(old.exists())
                self.assertTrue((self.cache / f'electron-v44.7.0-{plat}-x64.zip').exists())
                self.assertTrue(common.electron_binary_ready(root))

    def test_existing_and_repaired_binary_keep_all_caches_without_network(self):
        self.make_ready()
        for repair in (False, True):
            with self.subTest(repair=repair):
                if repair:
                    (self.electron / 'path.txt').unlink()
                old = self.make_cached_zip('44.5.1')
                middle = self.make_cached_zip('44.7.0')
                latest = self.make_cached_zip('44.10.0')
                with patch.object(common.urllib.request, 'urlopen') as download:
                    self.assertTrue(common.prepare_electron_binary(self.root, 'test'))
                    download.assert_not_called()
                self.assertTrue(old.exists())
                self.assertTrue(middle.exists())
                self.assertTrue(latest.exists())

    def test_peer_reuse_keeps_old_cache(self):
        peer = self.make_app('frontend_avatar')
        self.make_ready(peer)
        old = self.make_cached_zip('44.5.0')
        latest = self.make_cached_zip('44.5.1')
        with patch.object(common.urllib.request, 'urlopen') as download:
            self.assertTrue(common.prepare_electron_binary(self.root, 'test'))
            download.assert_not_called()
        self.assertTrue(old.exists())
        self.assertTrue(latest.exists())

    def test_cached_latest_is_reused_and_old_cache_is_kept(self):
        old = self.make_cached_zip('44.5.0')
        latest = self.make_cached_zip('44.5.1')
        with patch.object(common.urllib.request, 'urlopen') as download:
            self.assertTrue(common.prepare_electron_binary(self.root, 'test'))
            download.assert_not_called()
        self.assertTrue(old.exists())
        self.assertTrue(latest.exists())

    def test_setup_preserves_other_platform_arch_and_unrelated_files(self):
        with patch.object(common.sys, 'platform', 'win32'), patch.object(common.platform, 'machine', return_value='AMD64'):
            self.make_ready()
            old = self.make_cached_zip('44.5.0')
            latest = self.make_cached_zip('44.5.1')
            preserved = [self.cache / name for name in (
                'electron-v44.5.0-linux-x64.zip', 'electron-v44.5.0-win32-arm64.zip',
                'electron-v44.5.0-win32-ia32.zip', 'electron-v45.0.0-beta.1-win32-x64.zip',
                'notes.zip',
            )]
            for path in preserved:
                path.write_bytes(b'other cache')
            self.assertTrue(common.prepare_electron_binary(self.root, 'test'))
            self.assertTrue(old.exists())
            self.assertTrue(latest.exists())
            self.assertTrue(all(path.exists() for path in preserved))

    def test_failed_update_keeps_previous_cache(self):
        self.make_app('frontend_ide/host', '44.7.0')
        old = self.make_cached_zip('44.5.1')
        with patch.object(common.urllib.request, 'urlopen', side_effect=OSError('offline')):
            self.assertFalse(common.prepare_electron_binary(self.root, 'test'))
        self.assertEqual(list(self.cache.iterdir()), [old])

    def test_broken_latest_cache_does_not_remove_valid_old_cache(self):
        self.make_ready()
        old = self.make_cached_zip('44.5.1')
        latest = self.make_cached_zip('44.7.0')
        latest.write_bytes(b'broken ZIP')
        self.assertTrue(common.prepare_electron_binary(self.root, 'test'))
        self.assertTrue(common._archive_ready(old, '44.5.1'))

    def test_setup_does_not_attempt_to_delete_cache(self):
        self.make_ready()
        self.make_cached_zip('44.5.0')
        self.make_cached_zip('44.5.1')
        info = Mock()
        with patch.object(Path, 'unlink', side_effect=AssertionError('cache must be retained')) as unlink:
            self.assertTrue(common.prepare_electron_binary(self.root, 'test', info=info))
        unlink.assert_not_called()
        self.assertTrue(common.electron_binary_ready(self.root))

    def test_corrupt_cached_zip_is_replaced(self):
        self.cache.mkdir(parents=True)
        with patch.object(common.sys, 'platform', 'win32'), patch.object(common.platform, 'machine', return_value='AMD64'):
            archive = self.cache / 'electron-v44.5.1-win32-x64.zip'
            archive.write_bytes(b'broken ZIP')
            with patch.object(common.urllib.request, 'urlopen', return_value=self.response()) as download:
                self.assertTrue(common.prepare_electron_binary(self.root, 'test'))
                download.assert_called_once()
            self.assertTrue(common._archive_ready(archive, '44.5.1'))

    def test_failed_replacement_keeps_existing_zip(self):
        archive = self.make_cached_zip('44.5.1')
        archive.write_bytes(b'broken ZIP')
        with patch.object(common.urllib.request, 'urlopen', side_effect=OSError('offline')):
            self.assertFalse(common.prepare_electron_binary(self.root, 'test'))
        self.assertEqual(archive.read_bytes(), b'broken ZIP')

    def test_old_version_setup_keeps_newer_cached_zip(self):
        old = self.make_cached_zip('44.5.1')
        newer = self.make_cached_zip('44.7.2')
        before = {path.name: path.read_bytes() for path in (old, newer)}
        with patch.object(common.urllib.request, 'urlopen') as download:
            self.assertTrue(common.prepare_electron_binary(self.root, 'test'))
            download.assert_not_called()
        self.assertEqual({path.name: path.read_bytes() for path in self.cache.iterdir()}, before)

    def test_failed_download_is_not_retried_or_cached(self):
        with patch.object(common.urllib.request, 'urlopen', side_effect=OSError('offline')) as download:
            self.assertFalse(common.prepare_electron_binary(self.root, 'test'))
            download.assert_called_once()
            self.assertEqual(download.call_args.kwargs['timeout'], 30)
        self.assertEqual(list(self.cache.iterdir()), [])

    def test_incomplete_download_is_not_cached(self):
        response = self.response()
        response.headers['Content-Length'] = str(int(response.headers['Content-Length']) + 1)
        with patch.object(common.urllib.request, 'urlopen', return_value=response):
            self.assertFalse(common.prepare_electron_binary(self.root, 'test'))
        self.assertEqual(list(self.cache.iterdir()), [])

    def test_npm_skips_electron_download(self):
        self.make_ready()
        command = Mock(return_value=True)
        self.assertTrue(common.setup_dependencies(self.root, 'npm', 'test', command))
        self.assertEqual([call.args[0] for call in command.call_args_list], [['npm', 'install'], ['npm', 'update']])
        for call in command.call_args_list:
            self.assertEqual(call.kwargs['env']['ELECTRON_SKIP_BINARY_DOWNLOAD'], '1')

    def test_npm_recovery_rebuilds_before_compiling(self):
        self.make_ready()
        with patch.object(vscode, 'FRONTEND_VSCODE_DIR', self.root), patch.object(
            vscode, 'find_vscode_cli', return_value=None
        ), patch.object(vscode.shutil, 'which', return_value='npm'), patch.object(
            vscode, 'run_command', side_effect=[False, True, True, True, True, True]
        ) as command, patch.object(vscode, 'install_standalone_launcher', return_value=True):
            self.assertTrue(vscode.setup())
            self.assertEqual(
                [['npm', 'install'], ['npm', 'install', '--ignore-scripts'], ['npm', 'update'],
                 ['npm', 'rebuild'], ['npm', 'run', 'compile']],
                [call.args[0] for call in command.call_args_list if call.args[0][0] == 'npm'],
            )
            self.assertIn('prepare', command.call_args_list[-2].args[0][-1])

    def test_avatar_completes_with_shared_dependency_setup(self):
        peer = self.make_app('frontend_avatar')
        self.make_ready(peer)
        with patch.object(avatar, 'FRONTEND_AVATAR_DIR', peer), patch.object(
            avatar, 'check_npm_installed', return_value=True
        ), patch.object(avatar, 'run_command', return_value=True) as command:
            with patch.object(avatar, 'install_standalone_launcher', return_value=True):
                self.assertTrue(avatar.setup())
            self.assertEqual([call.args[0][1] for call in command.call_args_list], ['install', 'update'])

    def test_electron_failure_does_not_publish_launcher(self):
        with patch.object(vscode, 'FRONTEND_VSCODE_DIR', self.root), patch.object(
            vscode, 'find_vscode_cli', return_value=None
        ), patch.object(vscode.shutil, 'which', return_value='npm'), patch.object(
            vscode, 'run_command', return_value=True
        ), patch.object(common, 'prepare_electron_binary', return_value=False), patch.object(
            vscode, 'install_standalone_launcher'
        ) as launcher:
            self.assertFalse(vscode.setup())
            launcher.assert_not_called()

    def test_launcher_rename_installs_code_and_live_and_removes_owned_old_name(self):
        for platform_name in ('win32', 'linux'):
            with self.subTest(platform=platform_name):
                home = self.project / platform_name
                launchers = home / '.local' / 'bin'
                launchers.mkdir(parents=True)
                for name in ('aidiy_code', 'aidiy_live'):
                    script = self.root / name / 'launch.mjs'
                    script.parent.mkdir(exist_ok=True)
                    script.write_text('', encoding='utf-8')
                legacy = launchers / ('aidiy_vscode.cmd' if platform_name == 'win32' else 'aidiy_vscode')
                legacy.write_text(str(self.root / 'scripts' / 'launch-standalone.mjs'), encoding='utf-8')
                with patch.object(vscode, 'FRONTEND_VSCODE_DIR', self.root), patch.object(
                    vscode, 'launcher_directory', side_effect=lambda name: home / '_AIDIY' / name / 'bin'
                ), patch.object(vscode.sys, 'platform', platform_name):
                    self.assertTrue(vscode.install_standalone_launcher())
                self.assertTrue(legacy.exists())
                for name in ('aidiy_code', 'aidiy_live'):
                    launcher = home / '_AIDIY' / name / 'bin' / (f'{name}.cmd' if platform_name == 'win32' else name)
                    self.assertIn(str(self.root / name / 'launch.mjs'), launcher.read_text(encoding='utf-8'))
                    if platform_name == 'win32':
                        content = launcher.read_bytes()
                        # 呼出元のコードページを変えないため chcp は使わない（scripts/_setup_path.py）。
                        self.assertTrue(content.startswith(b'@echo off\r\nsetlocal EnableExtensions DisableDelayedExpansion\r\n'))
                        self.assertNotIn(b'chcp', content)
                        self.assertNotIn(b'\n', content.replace(b'\r\n', b''))

    def test_launcher_rename_preserves_other_checkout_old_name(self):
        home = self.project / 'other-home'
        launchers = home / '.local' / 'bin'
        launchers.mkdir(parents=True)
        for name in ('aidiy_code', 'aidiy_live'):
            script = self.root / name / 'launch.mjs'
            script.parent.mkdir(exist_ok=True)
            script.write_text('', encoding='utf-8')
        legacy = launchers / 'aidiy_vscode.cmd'
        legacy.write_text('node other-checkout/launch-standalone.mjs', encoding='utf-8')
        with patch.object(vscode, 'FRONTEND_VSCODE_DIR', self.root), patch.object(
            vscode, 'launcher_directory', side_effect=lambda name: home / '_AIDIY' / name / 'bin'
        ), patch.object(vscode.sys, 'platform', 'win32'):
            self.assertTrue(vscode.install_standalone_launcher())
        self.assertEqual(legacy.read_text(encoding='utf-8'), 'node other-checkout/launch-standalone.mjs')

    def make_extension_packages(self):
        for folder, name in ((self.root, 'aidiy-code'), (self.root / 'aidiy_live', 'aidiy-live')):
            folder.mkdir(exist_ok=True)
            (folder / 'package.json').write_text(json.dumps({'publisher': 'aidiy', 'name': name, 'version': '0.1.0'}), encoding='utf-8')
            (self.root / 'dist').mkdir(exist_ok=True)
            with zipfile.ZipFile(self.root / 'dist' / f'{name}-0.1.0.vsix', 'w') as archive:
                archive.comment = b'fixture archive comment'
                archive.writestr('[Content_Types].xml', '<Types/>')
                archive.writestr('extension.vsixmanifest', '<PackageManifest/>')
                archive.writestr('extension/package.json', (folder / 'package.json').read_bytes())
                info = zipfile.ZipInfo('extension/dist/extension.js', (2025, 1, 2, 3, 4, 6))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o100644 << 16
                info.internal_attr = 1
                info.comment = b'fixture entry comment'
                info.extra = b'\xfe\xca\x02\x00ok'
                archive.writestr(info, name.encode('utf-8'))

    def test_staging_preserves_packages_and_records_both_origins(self):
        self.make_extension_packages()
        originals = {path: path.read_bytes() for path in (self.root / 'dist').glob('*.vsix')}
        staged_paths = []

        def install(command, **kwargs):
            self.assertEqual(command[1], '--install-extension')
            staged = Path(command[2])
            staged_paths.append(staged)
            source = self.root / 'dist' / staged.name
            self.assertNotEqual(staged, source)
            with zipfile.ZipFile(source) as original, zipfile.ZipFile(staged) as result:
                self.assertEqual(result.comment, original.comment)
                self.assertEqual(set(result.namelist()), set(original.namelist()) | {'extension/aidiy-installation.json'})
                self.assertEqual(json.loads(result.read('extension/aidiy-installation.json')),
                                 {'version': 1, 'root': str(self.root.parent.parent.resolve())})
                for entry in original.infolist():
                    self.assertEqual(result.read(entry.filename), original.read(entry))
                    actual = result.getinfo(entry.filename)
                    for field in ('date_time', 'compress_type', 'external_attr', 'internal_attr',
                                  'comment', 'extra', 'create_system', 'create_version', 'extract_version'):
                        self.assertEqual(getattr(actual, field), getattr(entry, field), field)
            return True

        with patch.object(vscode, 'FRONTEND_VSCODE_DIR', self.root), patch.object(
            vscode, 'run_command', side_effect=install
        ), patch.object(vscode, 'get_installed_extensions', side_effect=[set(), {'aidiy.aidiy-code@0.1.0', 'aidiy.aidiy-live@0.1.0'}]):
            self.assertTrue(vscode.install_extensions('code'))
        self.assertEqual(len(staged_paths), 2)
        self.assertTrue(all(not path.parent.exists() for path in staged_paths))
        for source, content in originals.items():
            self.assertEqual(source.read_bytes(), content)

    def test_staging_replaces_existing_origin_and_uses_each_checkout(self):
        self.make_extension_packages()
        source = self.root / 'dist' / 'aidiy-code-0.1.0.vsix'
        with zipfile.ZipFile(source, 'a') as archive, warnings.catch_warnings():
            warnings.simplefilter('ignore', UserWarning)
            archive.writestr('extension/aidiy-installation.json', '{"root":"old"}')
            archive.writestr('extension/aidiy-installation.json', '{"root":"older"}')
        original = source.read_bytes()
        for index, root in enumerate((self.project / '配置元 A', self.project / '配置元 B')):
            target = self.project / f'staged-{index}.vsix'
            vscode.stage_extension_package(source, target, root)
            with zipfile.ZipFile(target) as archive:
                self.assertEqual(archive.namelist().count('extension/aidiy-installation.json'), 1)
                self.assertEqual(json.loads(archive.read('extension/aidiy-installation.json')),
                                 {'version': 1, 'root': str(root.resolve())})
        self.assertEqual(source.read_bytes(), original)

    def test_invalid_live_archive_never_removes_existing_extensions(self):
        self.make_extension_packages()
        live = self.root / 'dist' / 'aidiy-live-0.1.0.vsix'
        for content in (b'not a zip', b''):
            live.write_bytes(content)
            with patch.object(vscode, 'FRONTEND_VSCODE_DIR', self.root), patch.object(
                vscode, 'uninstall_aidiy_extensions'
            ) as remove, patch.object(vscode, 'run_command') as command:
                self.assertFalse(vscode.install_extensions('code'))
            remove.assert_not_called()
            command.assert_not_called()
        with zipfile.ZipFile(live, 'w') as archive:
            archive.writestr('extension/package.json', '{}')
        with patch.object(vscode, 'FRONTEND_VSCODE_DIR', self.root), patch.object(vscode, 'uninstall_aidiy_extensions') as remove:
            self.assertFalse(vscode.install_extensions('code'))
        remove.assert_not_called()

    def test_staging_failure_cleans_temp_without_removal(self):
        self.make_extension_packages()
        paths = []
        real_stage = vscode.stage_extension_package

        def stage(source, target, root):
            paths.append(target)
            if len(paths) == 2:
                raise OSError('fixture write failure')
            real_stage(source, target, root)

        with patch.object(vscode, 'FRONTEND_VSCODE_DIR', self.root), patch.object(
            vscode, 'stage_extension_package', side_effect=stage
        ), patch.object(vscode, 'uninstall_aidiy_extensions') as remove:
            self.assertFalse(vscode.install_extensions('code'))
        remove.assert_not_called()
        self.assertEqual(len(paths), 2)
        self.assertTrue(all(not path.parent.exists() for path in paths))

    def test_invalid_archive_entries_are_rejected_before_removal(self):
        for invalid in ('../outside', '/absolute', 'extension\\bad', 'extension/package.json'):
            with self.subTest(entry=invalid):
                self.make_extension_packages()
                live = self.root / 'dist' / 'aidiy-live-0.1.0.vsix'
                with zipfile.ZipFile(live, 'a') as archive, warnings.catch_warnings():
                    warnings.simplefilter('ignore', UserWarning)
                    archive.writestr(invalid, b'fixture')
                with patch.object(vscode, 'FRONTEND_VSCODE_DIR', self.root), patch.object(vscode, 'uninstall_aidiy_extensions') as remove:
                    self.assertFalse(vscode.install_extensions('code'))
                remove.assert_not_called()

    def test_failed_install_cleans_staging(self):
        self.make_extension_packages()
        paths = []

        def fail_install(command, **kwargs):
            paths.append(Path(command[2]))
            self.assertTrue(paths[-1].is_file())
            return False

        with patch.object(vscode, 'FRONTEND_VSCODE_DIR', self.root), patch.object(
            vscode, 'run_command', side_effect=fail_install
        ), patch.object(vscode, 'get_installed_extensions', return_value=set()):
            self.assertFalse(vscode.install_extensions('code'))
        self.assertEqual(len(paths), 1)
        self.assertFalse(paths[0].parent.exists())

    def test_aidiy_prefix_extensions_are_removed_before_both_are_installed(self):
        self.make_extension_packages()
        with patch.object(vscode, 'FRONTEND_VSCODE_DIR', self.root), patch.object(
            vscode, 'run_command', return_value=True
        ) as command, patch.object(vscode, 'get_installed_extensions', side_effect=[
            {'aidiy.aidiy-code', 'aidiy.aidiy-live', 'aidiy.aidiy-vscode', 'other.aidiy-old', 'other.tool'},
            {'other.tool'},
            {'aidiy.aidiy-code@0.1.0', 'aidiy.aidiy-live@0.1.0', 'other.tool'},
        ]):
            self.assertTrue(vscode.install_extensions('code'))
        calls = [call.args[0] for call in command.call_args_list]
        self.assertEqual([call[2] for call in calls[:4]], ['aidiy.aidiy-code', 'aidiy.aidiy-live', 'aidiy.aidiy-vscode', 'other.aidiy-old'])
        self.assertTrue(all(call[1] == '--uninstall-extension' for call in calls[:4]))
        self.assertIn('aidiy-code-0.1.0.vsix', calls[4][2])
        self.assertIn('aidiy-live-0.1.0.vsix', calls[5][2])

    def test_live_install_failure_is_reported_after_removal(self):
        self.make_extension_packages()
        with patch.object(vscode, 'FRONTEND_VSCODE_DIR', self.root), patch.object(
            vscode, 'run_command', side_effect=[True, False]
        ) as command, patch.object(vscode, 'get_installed_extensions', return_value=set()):
            self.assertFalse(vscode.install_extensions('code'))
        self.assertEqual(len(command.call_args_list), 2)

    def test_missing_live_in_installed_list_fails_verification(self):
        self.make_extension_packages()
        with patch.object(vscode, 'FRONTEND_VSCODE_DIR', self.root), patch.object(
            vscode, 'run_command', return_value=True
        ) as command, patch.object(vscode, 'get_installed_extensions', side_effect=[set(), {'aidiy.aidiy-code@0.1.0'}]):
            self.assertFalse(vscode.install_extensions('code'))
        self.assertEqual(len(command.call_args_list), 2)

    def test_missing_vsix_does_not_remove_existing_extensions(self):
        self.make_extension_packages()
        (self.root / 'dist' / 'aidiy-live-0.1.0.vsix').unlink()
        with patch.object(vscode, 'FRONTEND_VSCODE_DIR', self.root), patch.object(vscode, 'run_command') as command:
            self.assertFalse(vscode.install_extensions('code'))
        command.assert_not_called()

    def test_uninstall_failure_stops_setup_before_install(self):
        self.make_extension_packages()
        with patch.object(vscode, 'FRONTEND_VSCODE_DIR', self.root), patch.object(
            vscode, 'run_command', return_value=False
        ) as command, patch.object(vscode, 'get_installed_extensions', return_value={'aidiy.aidiy-code'}):
            self.assertFalse(vscode.install_extensions('code'))
        self.assertEqual([call.args[0] for call in command.call_args_list], [['code', '--uninstall-extension', 'aidiy.aidiy-code']])

    def test_remaining_aidiy_extension_stops_setup_before_install(self):
        self.make_extension_packages()
        with patch.object(vscode, 'FRONTEND_VSCODE_DIR', self.root), patch.object(
            vscode, 'run_command', return_value=True
        ) as command, patch.object(vscode, 'get_installed_extensions', return_value={'other.aidiy-old'}):
            self.assertFalse(vscode.install_extensions('code'))
        self.assertEqual([call.args[0] for call in command.call_args_list], [['code', '--uninstall-extension', 'other.aidiy-old']])


if __name__ == '__main__':
    unittest.main()
