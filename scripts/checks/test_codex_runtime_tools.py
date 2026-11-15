# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under AiDiy 公開利用ライセンス v1.1. See LICENSE.
"""公式ホストの固定版・ハッシュ検証・配置。ネットワークや実 exe は使わない。"""
import base64
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import Mock, patch
import contextlib

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('codex_runtime_test', ROOT / 'command_codex/aidiy/runtime_tools.py')
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        self.cache = self.root / 'cache'
        self.sources = self.root / 'source'
        self.sources.mkdir()
        for name in ('LICENSE', 'NOTICE'):
            (self.sources / name).write_text('original ' + name, encoding='utf-8')
        self.enterContext(contextlib.redirect_stdout(io.StringIO()))

    def fixture(self, link=False, corrupt=False):
        stream = io.BytesIO()
        with tarfile.open(fileobj=stream, mode='w:gz') as tar:
            entry = tarfile.TarInfo('package/vendor/x86_64-pc-windows-msvc/bin/' + runtime.HOST)
            if link:
                entry.type = tarfile.SYMTYPE
                entry.linkname = '../../outside'
                tar.addfile(entry)
            else:
                data = b'new host'
                entry.size = len(data)
                tar.addfile(entry, io.BytesIO(data))
        archive = stream.getvalue()
        tag = '0.169.0-win32-x64'
        metadata = {'name': '@openai/codex', 'version': tag, 'dist': {
            'tarball': runtime.ORIGIN + '@openai/codex/-/codex-' + tag + '.tgz',
            'integrity': 'sha512-' + base64.b64encode(hashlib.sha512(archive).digest()).decode()}}
        opener = Mock()
        opener.open.side_effect = [io.BytesIO(json.dumps(metadata).encode()), io.BytesIO(b'bad' if corrupt else archive)]
        return opener

    def install(self):
        return runtime.install_windows_host(self.bin, self.cache, '0.169.0', 'x86_64-pc-windows-gnullvm', self.sources)

    def test_verified_install_and_repeat_without_network(self):
        with patch.object(runtime.urllib.request, 'build_opener', return_value=self.fixture()):
            output = self.install()
        self.assertEqual(output.read_bytes(), b'new host')
        self.assertEqual((self.bin/'aidiy_codex_runtime_LICENSE').read_text(), 'original LICENSE')
        with patch.object(runtime.urllib.request, 'build_opener', side_effect=AssertionError('network')):
            self.assertEqual(self.install(), output)

    def test_bad_hash_or_link_preserves_existing_host(self):
        output = self.bin / runtime.HOST
        output.write_bytes(b'old host')
        for options in ({'corrupt': True}, {'link': True}):
            with self.subTest(options=options), patch.object(runtime.urllib.request, 'build_opener', return_value=self.fixture(**options)):
                with self.assertRaises(RuntimeError):
                    self.install()
            self.assertEqual(output.read_bytes(), b'old host')
        self.assertFalse((self.bin/'aidiy_codex_runtime.json').exists())

    def test_invalid_target_and_external_redirect_are_rejected(self):
        with self.assertRaises(ValueError):
            runtime.install_windows_host(self.bin, self.cache, '0.169.0', 'unknown', self.sources)
        with self.assertRaises(RuntimeError):
            runtime.OfficialRedirect().redirect_request(None, None, 302, '', {}, 'https://example.com/host')


if __name__ == '__main__':
    unittest.main()
