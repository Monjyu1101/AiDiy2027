# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE for full terms.
"""単独版ランチャーを一時領域のみで登録・解除する。"""
import contextlib
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


def load(name):
    spec = importlib.util.spec_from_file_location('avatar_alone_' + name, ROOT / ('_' + name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class AloneLaunchersTests(unittest.TestCase):
    def test_registration_and_owned_cleanup(self):
        setup, cleanup = load('setup'), load('cleanup')
        with tempfile.TemporaryDirectory() as directory, contextlib.redirect_stdout(io.StringIO()) as output:
            target = Path(directory)
            with patch.object(setup, 'ensure_launcher_path', return_value=True):
                self.assertTrue(setup.install_standalone_launcher(target))
            suffix = '.cmd' if setup.sys.platform == 'win32' else ''
            standalone = target / ('aidiy_avatar_alone' + suffix)
            text = standalone.read_text(encoding='utf-8')
            self.assertIn('--alone', text)
            self.assertIn(str(ROOT / 'launch.mjs'), text)
            self.assertNotIn('aidiy_avatar_alone', output.getvalue())
            with patch.object(cleanup, 'launcher_directory', return_value=target), patch.object(cleanup, 'remove_launcher_path', return_value=True):
                self.assertTrue(cleanup.remove_standalone_launcher())
            self.assertFalse(standalone.exists())
            self.assertFalse((target / ('aidiy_avatar' + suffix)).exists())

    def test_cleanup_preserves_another_installation(self):
        cleanup = load('cleanup')
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)
            launcher = target / 'aidiy_avatar_alone'
            launcher.write_text('#!/bin/sh\nexec node /another/frontend_avatar/launch.mjs --alone "$@"\n', encoding='utf-8')
            with patch.object(cleanup, 'launcher_directory', return_value=target), patch.object(cleanup, 'remove_launcher_path', return_value=True):
                self.assertTrue(cleanup.remove_standalone_launcher())
            self.assertTrue(launcher.exists())


if __name__ == '__main__':
    unittest.main()
