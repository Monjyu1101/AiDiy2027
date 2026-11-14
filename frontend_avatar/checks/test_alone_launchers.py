# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE for full terms.
"""Avatar ランチャーの登録・解除を一時領域だけで確認する。"""
import contextlib
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


def load(name):
    spec = importlib.util.spec_from_file_location('avatar_launcher_' + name, ROOT / ('_' + name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class AvatarLauncherTests(unittest.TestCase):
    def setUp(self):
        # 共有ランチャー（~/.local/bin）の最新化を実ホームへ書かない。
        home = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.enterContext(patch.object(Path, 'home', return_value=home))

    def test_registration_and_owned_cleanup(self):
        setup, cleanup = load('setup'), load('cleanup')
        with tempfile.TemporaryDirectory() as directory, contextlib.redirect_stdout(io.StringIO()):
            target = Path(directory)
            with patch.object(setup, 'ensure_launcher_path', return_value=True):
                self.assertTrue(setup.install_standalone_launcher(target))
            suffix = '.cmd' if setup.sys.platform == 'win32' else ''
            standalone = target / ('aidiy_avatar' + suffix)
            text = standalone.read_text(encoding='utf-8')
            self.assertNotIn('--alone', text)
            self.assertNotIn('--internal-auth', text)
            self.assertIn(str(ROOT / 'launch.mjs'), text)
            with patch.object(cleanup, 'launcher_directory', return_value=target), patch.object(cleanup, 'remove_launcher_path', return_value=True):
                self.assertTrue(cleanup.remove_standalone_launcher())
            self.assertFalse(standalone.exists())

    def test_windows_launcher_has_owner_comment(self):
        setup = load('setup')
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)
            with patch.object(setup.sys, 'platform', 'win32'), patch.object(setup.shutil, 'which', return_value='node'), patch.object(setup, 'ensure_launcher_path', return_value=True):
                self.assertTrue(setup.install_standalone_launcher(target))
            current = (target / 'aidiy_avatar.cmd').read_text(encoding='utf-8')
            self.assertIn(setup.launcher_owner_comment(ROOT / 'launch.mjs'), current)

    def test_cleanup_preserves_another_installation(self):
        cleanup = load('cleanup')
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)
            launcher = target / 'aidiy_avatar'
            launcher.write_text('#!/bin/sh\nexec node /another/frontend_avatar/launch.mjs "$@"\n', encoding='utf-8')
            with patch.object(cleanup, 'launcher_directory', return_value=target), patch.object(cleanup, 'remove_launcher_path', return_value=True):
                self.assertTrue(cleanup.remove_standalone_launcher())
            self.assertTrue(launcher.exists())


if __name__ == '__main__':
    unittest.main()
