# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE for full terms.
"""旧共有binの安全な更新。実ホーム/PATH/登録サービスは変更しない。"""
import base64
import importlib.util
import os
from pathlib import Path
import shlex
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('shared_launcher_test', ROOT / 'scripts/_setup_path.py')
helper = importlib.util.module_from_spec(spec); spec.loader.exec_module(helper)


def windows(script, runtime='node.exe', flags=()):
    return ('@echo off\nsetlocal EnableExtensions DisableDelayedExpansion\n'
            + helper.launcher_owner_comment(script) + '\n'
            + helper.windows_launcher_command([runtime, *flags, str(script)]) + '\nexit /b %ERRORLEVEL%\n')


class SharedLauncherTests(unittest.TestCase):
    def setUp(self):
        self.temp = self.enterContext(tempfile.TemporaryDirectory())
        self.home = Path(self.temp) / 'home'; self.home.mkdir()
        self.enterContext(patch.object(Path, 'home', return_value=self.home))
        self.enterContext(patch('builtins.print'))
        self.root = Path(self.temp) / '日本語 project%test!&'
        self.script = self.root / 'frontend_avatar' / 'launch.mjs'
        self.canonical = self.root / '_AIDIY/aidiy_avatar/bin/aidiy_avatar.cmd'
        self.canonical.parent.mkdir(parents=True)
        self.content = windows(self.script, 'C:\\new node\\node.exe')
        self.canonical.write_text(self.content, encoding='utf-8')
        self.shared = self.home / '.local/bin/aidiy_avatar.cmd'
        self.shared.parent.mkdir(parents=True)

    def test_updates_existing_same_checkout_and_repeats_without_path_change(self):
        self.shared.write_text(windows(self.script, 'C:\\old node\\node.exe'), encoding='utf-8')
        previous_path = os.environ.get('PATH')
        for _ in range(2):
            helper.sync_shared_launcher(self.canonical, self.script)
            self.assertEqual(self.shared.read_bytes(), self.canonical.read_bytes())
        self.assertEqual(os.environ.get('PATH'), previous_path)
        self.assertEqual(list(self.shared.parent.iterdir()), [self.shared])

    def test_no_new_home_launcher(self):
        helper.sync_shared_launcher(self.canonical, self.script)
        self.assertFalse(self.shared.exists())

    def test_migrates_previous_avatar_python_entry_and_diag_path(self):
        old = self.script.with_name('_start.py')
        self.shared.write_text(windows(old, 'C:\\python.exe', ('-X', 'utf8')), encoding='utf-8')
        helper.sync_shared_launcher(self.canonical, self.script, legacy_scripts=(old,))
        self.assertEqual(self.shared.read_bytes(), self.canonical.read_bytes())

    def test_preserves_foreign_modified_and_invalid_encoding(self):
        foreign = self.root.parent / 'other/frontend_avatar/launch.mjs'
        for bad in (windows(foreign).encode(), (windows(self.script)+'echo injected\n').encode(), b'\xff\xfe'):
            self.shared.write_bytes(bad)
            with self.assertRaises(OSError):
                helper.sync_shared_launcher(self.canonical, self.script)
            self.assertEqual(self.shared.read_bytes(), bad)

    def test_preserves_linked_launcher_and_parent(self):
        target = self.home / 'other'; target.write_text('untouched')
        self.shared.symlink_to(target)
        with self.assertRaises(OSError): helper.sync_shared_launcher(self.canonical, self.script)
        self.assertEqual(target.read_text(), 'untouched')
        self.shared.unlink(); self.shared.parent.rmdir()
        directory = self.home / 'other-bin'; directory.mkdir()
        self.shared.parent.symlink_to(directory, target_is_directory=True)
        (directory / self.shared.name).write_text(self.content)
        with self.assertRaises(OSError): helper.sync_shared_launcher(self.canonical, self.script)
        self.assertEqual((directory / self.shared.name).read_text(), self.content)

    def test_posix_argument_quoting_changes_are_preserved(self):
        self.canonical = self.canonical.with_name('aidiy_avatar')
        self.shared = self.shared.with_name('aidiy_avatar')
        content = '#!/usr/bin/env sh\nexec /new/node '+shlex.quote(str(self.script))+' "$@"\n'
        self.canonical.write_text(content)
        for changed in (content.replace('"$@"', "'$@'"), content.replace('"$@"', '$@')):
            self.shared.write_text(changed)
            with self.assertRaises(OSError): helper.sync_shared_launcher(self.canonical, self.script)
            self.assertEqual(self.shared.read_text(), changed)

    def test_posix_runtime_change_and_previous_avatar_flags(self):
        self.canonical = self.canonical.with_name('aidiy_avatar')
        self.shared = self.shared.with_name('aidiy_avatar')
        self.canonical.write_text('#!/usr/bin/env sh\nexec /new/node '+shlex.quote(str(self.script))+' "$@"\n')
        old = self.script.with_name('_start.py')
        self.shared.write_text('#!/usr/bin/env sh\nexec /old/python -X utf8 '+shlex.quote(str(old))+' "$@"\n')
        helper.sync_shared_launcher(self.canonical, self.script, legacy_scripts=(old,))
        self.assertEqual(self.shared.read_bytes(), self.canonical.read_bytes())
        self.assertTrue(self.shared.stat().st_mode & 0o111)

if __name__ == '__main__': unittest.main()
