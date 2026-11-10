# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE for full terms.
"""共通ランチャー登録と旧コマンド除去を一時領域だけで確認する。"""
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
            standalone = target / ('aidiy_avatar' + suffix)
            text = standalone.read_text(encoding='utf-8')
            self.assertNotIn('--alone', text)
            self.assertNotIn('--internal-auth', text)
            self.assertFalse((target / ('aidiy_avatar_alone' + suffix)).exists())
            self.assertIn(str(ROOT / 'launch.mjs'), text)
            self.assertNotIn('aidiy_avatar_alone', output.getvalue())
            with patch.object(cleanup, 'launcher_directory', return_value=target), patch.object(cleanup, 'remove_launcher_path', return_value=True):
                self.assertTrue(cleanup.remove_standalone_launcher())
            self.assertFalse(standalone.exists())
            self.assertFalse((target / ('aidiy_avatar' + suffix)).exists())

    def test_setup_removes_only_owned_legacy_launchers(self):
        setup = load('setup')
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)
            owned = target / 'aidiy_avatar_alone'
            other = target / 'aidiy_avatar_alone.cmd'
            owned.write_text(f'#!/bin/sh\nexec node "{ROOT / "launch.mjs"}" --alone "$@"\n', encoding='utf-8')
            other.write_text('@echo off\nnode C:\\another\\frontend_avatar\\launch.mjs --alone %*\n', encoding='utf-8')
            with patch.object(setup, 'ensure_launcher_path', return_value=True):
                self.assertTrue(setup.install_standalone_launcher(target))
                self.assertTrue(setup.install_standalone_launcher(target))
            self.assertFalse(owned.exists())
            self.assertTrue(other.exists())

    def test_setup_removes_windows_legacy_and_preserves_unknown_owner(self):
        setup = load('setup')
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)
            owned = target / 'aidiy_avatar_alone.cmd'
            other = target / 'aidiy_avatar_alone'
            owned.write_text('@echo off\n' + setup.launcher_owner_comment(ROOT / 'launch.mjs') + '\n', encoding='utf-8')
            other.write_text('# unknown launcher\n', encoding='utf-8')
            with patch.object(setup.sys, 'platform', 'win32'), patch.object(setup.shutil, 'which', return_value='node'), patch.object(setup, 'ensure_launcher_path', return_value=True):
                self.assertTrue(setup.install_standalone_launcher(target))
            self.assertFalse(owned.exists())
            self.assertTrue(other.exists())
            current = (target / 'aidiy_avatar.cmd').read_text(encoding='utf-8')
            self.assertIn(setup.launcher_owner_comment(ROOT / 'launch.mjs'), current)
            self.assertNotIn('--alone', current)

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
