# -*- coding: utf-8 -*-
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""全体 setup / cleanup で IDE と Discord のランチャーを取り違えない。"""
import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3]


def load(folder, name):
    spec = importlib.util.spec_from_file_location(f'test_{folder}_{name}', ROOT / folder / f'{name}.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class LauncherTests(unittest.TestCase):
    def test_setup_and_cleanup_keep_commands_separate_in_both_orders(self):
        for order in [('frontend_ide/viewer', 'frontend_channels'), ('frontend_channels', 'frontend_ide/viewer')]:
            with self.subTest(order=order), tempfile.TemporaryDirectory() as temp:
                # 先に別フォルダの launcher が import 済みでも影響しない。
                cached = load(order[0], 'launcher')
                with patch.dict(sys.modules, {'launcher': cached}), patch.object(Path, 'home', return_value=Path(temp)), patch.object(sys, 'path', sys.path.copy()):
                    modules = {folder: load(folder, '_setup') for folder in order}
                    paths = {}
                    for folder, module in modules.items():
                        with patch.object(module._launcher, 'ensure_launcher_path', return_value=True):
                            module.install_launcher(ROOT / folder)
                        paths[folder] = module._launcher.launcher_path()
                    self.assertNotEqual(*paths.values())
                    for folder, path in paths.items():
                        entry = ROOT / folder / ('panel/launch.mjs' if folder == 'frontend_channels' else 'launch.mjs')
                        self.assertIn(str(entry), path.read_text(encoding='utf-8'))
                    first, second = order
                    self.assertTrue(load(first, '_cleanup').remove_launcher(ROOT / first))
                    self.assertFalse(paths[first].exists())
                    self.assertTrue(paths[second].is_file())
                    self.assertTrue(load(second, '_cleanup').remove_launcher(ROOT / second))
                    self.assertFalse(paths[second].exists())

    def test_console_replaces_only_this_checkout_legacy_launcher(self):
        for platform in ('win32', 'linux', 'darwin'):
            for owned in (True, False):
                with self.subTest(platform=platform, owned=owned), tempfile.TemporaryDirectory() as temp:
                    launcher = load('frontend_ide/viewer', 'launcher')
                    home = Path(temp)
                    root = home / 'repo' / 'frontend_ide' / 'aidiy_console'
                    root.mkdir(parents=True)
                    (root / 'launch.mjs').write_text('// fixture', encoding='utf-8')
                    old_script = root.parent / 'aidiy_term' / 'launch.mjs' if owned else home / 'other' / 'aidiy_term' / 'launch.mjs'
                    with patch.object(Path, 'home', return_value=home), patch.object(launcher.sys, 'platform', platform), patch.object(launcher.shutil, 'which', return_value='/fixture/node'), patch.object(launcher, 'ensure_launcher_path', return_value=True):
                        old = launcher.launcher_path('term')
                        old.parent.mkdir(parents=True)
                        old.write_text(launcher.launcher_owner_comment(old_script), encoding='utf-8')
                        launcher.install_launcher(root, 'console')
                        self.assertTrue(launcher.launcher_path('console').is_file())
                        self.assertEqual(old.exists(), not owned)

    def test_missing_entry_does_not_overwrite_registered_command(self):
        for folder in ('frontend_ide/viewer', 'frontend_channels'):
            with self.subTest(folder=folder), tempfile.TemporaryDirectory() as temp:
                launcher = load(folder, 'launcher')
                path = Path(temp) / 'command'
                path.write_text('existing command', encoding='utf-8')
                with patch.object(launcher, 'launcher_path', return_value=path):
                    with self.assertRaises(OSError):
                        launcher.install_launcher(Path(temp) / 'missing')
                self.assertEqual(path.read_text(encoding='utf-8'), 'existing command')


if __name__ == '__main__':
    unittest.main()
