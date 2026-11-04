# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""実サービス・ネットワークを使わず Electron の Mac / Linux 導入を確認する。"""
import importlib.util
import io
import json
import os
from pathlib import Path
import ssl
import stat
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import urllib.error
import zipfile

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('electron_posix_setup', ROOT / 'scripts/_setup_electron.py')
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)
VERSION = '44.9.0'


def payload(platform_name):
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w') as archive:
        def add(name, content, mode=stat.S_IFREG | 0o644):
            entry = zipfile.ZipInfo(name)
            entry.create_system = 3
            entry.external_attr = mode << 16
            archive.writestr(entry, content)
        add('version', VERSION)
        if platform_name == 'darwin':
            add('Electron.app/Contents/MacOS/Electron', b'#!/bin/sh\nprintf main', stat.S_IFREG | 0o755)
            base = 'Electron.app/Contents/Frameworks/Electron Framework.framework/'
            add(base + 'Versions/A/Electron Framework', b'framework')
            add(base + 'Versions/A/Helpers/crashpad_handler', b'#!/bin/sh\nprintf helper', stat.S_IFREG | 0o755)
            add(base + 'Versions/Current', 'A', stat.S_IFLNK | 0o777)
            add(base + 'Electron Framework', 'Versions/Current/Electron Framework', stat.S_IFLNK | 0o777)
            add(base + 'Helpers', 'Versions/Current/Helpers', stat.S_IFLNK | 0o777)
        elif platform_name == 'win32':
            add('electron.exe', b'binary')
        else:
            add('electron', b'#!/bin/sh\nprintf main', stat.S_IFREG | 0o755)
            add('chrome_crashpad_handler', b'#!/bin/sh\nprintf helper', stat.S_IFREG | 0o755)
            add('chrome-sandbox', b'sandbox', stat.S_IFREG | 0o755)
            add('libEGL.so', b'library')
    return output.getvalue()


class ElectronCacheLocationTests(unittest.TestCase):
    def test_cache_is_project_relative_not_working_directory_or_user_cache(self):
        original = Path.cwd()
        with tempfile.TemporaryDirectory(prefix='electron cache ') as other:
            try:
                os.chdir(other)
                # 単体 setup とルート setup のどちらでも同じ絶対パスになる。
                spec = importlib.util.spec_from_file_location(
                    'electron_cache_location', ROOT / 'scripts/_setup_electron.py')
                helper = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(helper)
                self.assertEqual(helper.CACHE_DIR, ROOT / '.aidiy_cache' / 'electron')
                self.assertTrue(helper.CACHE_DIR.is_absolute())
            finally:
                os.chdir(original)


class ElectronPosixTests(unittest.TestCase):
    def setUp(self):
        self.folder = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.cache = self.folder / '.aidiy_cache/electron'
        self.cache.mkdir(parents=True)
        self.enterContext(patch.object(setup, 'CACHE_DIR', self.cache))
        self.enterContext(patch('sys.stdout', new=io.StringIO()))

    def project(self, name):
        project = self.folder / name
        directory = project / 'node_modules/electron'
        directory.mkdir(parents=True)
        (directory / 'package.json').write_text(json.dumps({'version': VERSION}), encoding='utf-8')
        return project

    def test_all_component_paths_reuse_new_cache_on_windows_and_posix(self):
        for platform_name in ('win32', 'darwin', 'linux'):
            for name in ('backend_diag', 'frontend_avatar', 'frontend_ide/host',
                         'frontend_ide/viewer', 'frontend_channels'):
                with self.subTest(platform=platform_name, component=name), \
                        patch.object(setup.sys, 'platform', platform_name), \
                        patch.object(setup.platform, 'machine', return_value='x86_64'), \
                        patch.object(setup, '_runtime_in_use', return_value=False), \
                        patch.object(setup.urllib.request, 'urlopen') as download:
                    # 別プロジェクトにして peer dist の流用ではなく ZIP 読込を確認する。
                    if os.name == 'nt' and platform_name == 'darwin':
                        self.skipTest('Mac frameworkのシンボリックリンク展開はPOSIX実環境で確認')
                    target = self.project(f'{platform_name}/{name.replace("/", "-")}/{name}')
                    archive = self.cache / f'electron-v{VERSION}-{platform_name}-x64.zip'
                    archive.write_bytes(payload(platform_name))
                    self.assertTrue(setup.prepare_electron_binary(target, 'fixture', allow_download=False))
                    self.assertTrue(setup.electron_binary_ready(target))
                    self.assertTrue(archive.is_file())
                    self.assertFalse((self.folder / '_cache').exists())
                    download.assert_not_called()

    @unittest.skipIf(os.name == 'nt', 'Mac のリンクと POSIX 権限は POSIX 実環境で確認')
    def test_cached_zip_and_peer_preserve_framework_links_and_helper_permissions_without_unzip(self):
        for platform_name, machine in (('darwin', 'arm64'), ('darwin', 'x86_64'), ('linux', 'aarch64'), ('linux', 'x86_64')):
            with self.subTest(platform=platform_name, machine=machine), patch.object(setup.sys, 'platform', platform_name), patch.object(setup.platform, 'machine', return_value=machine), patch.object(setup.shutil, 'which', return_value=None), patch.object(setup.urllib.request, 'urlopen') as download:
                source = self.project(platform_name + machine + '/backend_diag')
                platform_id, arch = setup._electron_platform_arch()
                archive = self.cache / f'electron-v{VERSION}-{platform_id}-{arch}.zip'
                archive.write_bytes(payload(platform_name))
                self.assertTrue(setup.prepare_electron_binary(source, 'fixture', allow_download=False))
                peer = self.project(platform_name + machine + '/frontend_ide/host')
                self.assertTrue(setup.prepare_electron_binary(peer, 'fixture', allow_download=False))
                for project in (source, peer):
                    dist = project / 'node_modules/electron/dist'
                    if platform_name == 'darwin':
                        framework = dist / 'Electron.app/Contents/Frameworks/Electron Framework.framework'
                        self.assertTrue((framework / 'Versions/Current').is_symlink())
                        self.assertTrue((framework / 'Electron Framework').is_symlink())
                        self.assertEqual((framework / 'Electron Framework').read_bytes(), b'framework')
                        helper = framework / 'Helpers/crashpad_handler'
                    else:
                        helper = dist / 'chrome_crashpad_handler'
                        self.assertTrue(os.access(dist / 'chrome-sandbox', os.X_OK))
                        self.assertFalse(os.access(dist / 'libEGL.so', os.X_OK))
                    self.assertTrue(os.access(helper, os.X_OK))
                    self.assertEqual(subprocess.check_output([str(helper)]), b'helper')
                    self.assertTrue(setup.electron_binary_ready(project))
                self.assertTrue(archive.is_file())
                download.assert_not_called()

    def test_certificate_error_uses_verified_curl_and_reuses_download(self):
        for platform_name, machine in (('darwin', 'arm64'), ('linux', 'x86_64')):
            with self.subTest(platform=platform_name), patch.object(setup.sys, 'platform', platform_name), patch.object(setup.platform, 'machine', return_value=machine), patch.object(setup.shutil, 'which', return_value='/usr/bin/curl'):
                archive = self.cache / f'electron-v{VERSION}-{platform_name}-test.zip'
                def fetch(command, **kwargs):
                    self.assertEqual(command[:2], ['/usr/bin/curl', '--disable'])
                    self.assertNotIn('--insecure', command)
                    self.assertNotIn('-k', command)
                    self.assertIn('=https', command)
                    self.assertTrue(kwargs['check'])
                    Path(command[command.index('--output') + 1]).write_bytes(payload(platform_name))
                error = urllib.error.URLError(ssl.SSLCertVerificationError(1, 'certificate verify failed'))
                with patch.object(setup.urllib.request, 'urlopen', side_effect=error), patch.object(setup.subprocess, 'run', side_effect=fetch) as execute:
                    setup._download_archive(archive, VERSION, 'fixture', lambda *_: None)
                execute.assert_called_once()
                self.assertTrue(setup._archive_ready(archive, VERSION))

    def test_download_failure_keeps_existing_cache(self):
        archive = self.cache / 'previous.zip'
        archive.write_bytes(b'previous cache')
        cases = (ssl.SSLCertVerificationError(1, 'certificate verify failed'), OSError('offline'))
        for error in cases:
            with self.subTest(error=error), patch.object(setup.urllib.request, 'urlopen', side_effect=urllib.error.URLError(error)), patch.object(setup.shutil, 'which', return_value='/usr/bin/curl'), patch.object(setup.subprocess, 'run', side_effect=subprocess.CalledProcessError(60, 'curl')) as execute:
                with self.assertRaises((OSError, subprocess.SubprocessError)):
                    setup._download_archive(archive, VERSION, 'fixture', lambda *_: None)
                self.assertEqual(archive.read_bytes(), b'previous cache')
                self.assertEqual(execute.call_count, int(isinstance(error, ssl.SSLCertVerificationError)))
        self.assertEqual(list(self.cache.iterdir()), [archive])

    def test_archive_cannot_write_outside_extraction_directory(self):
        for name, link in (('../outside', None), ('/absolute', None), ('link', '../../outside')):
            with self.subTest(name=name):
                archive = self.folder / 'unsafe.zip'
                with zipfile.ZipFile(archive, 'w') as output:
                    entry = zipfile.ZipInfo(name)
                    entry.external_attr = (stat.S_IFLNK | 0o777) << 16 if link else (stat.S_IFREG | 0o644) << 16
                    output.writestr(entry, link or 'outside')
                with self.assertRaises(ValueError):
                    setup._extract_archive(archive, self.folder / 'dist')
        self.assertFalse((self.folder / 'outside').exists())

    def test_platform_and_cpu_are_explicit(self):
        for platform_name, machine, expected in (('darwin', 'arm64', ('darwin', 'arm64')), ('darwin', 'x86_64', ('darwin', 'x64')), ('linux', 'aarch64', ('linux', 'arm64')), ('linux', 'x86_64', ('linux', 'x64'))):
            with self.subTest(platform=platform_name, machine=machine), patch.object(setup.sys, 'platform', platform_name), patch.object(setup.platform, 'machine', return_value=machine):
                self.assertEqual(setup._electron_platform_arch(), expected)
        with patch.object(setup.platform, 'machine', return_value='riscv64'), self.assertRaisesRegex(ValueError, 'CPU'):
            setup._electron_platform_arch()


if __name__ == '__main__':
    unittest.main()
