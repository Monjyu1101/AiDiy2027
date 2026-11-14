# -*- coding: utf-8 -*-
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""全体 setup / cleanup で IDE と Discord のランチャーを取り違えない。"""
from contextlib import contextmanager
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


@contextmanager
def isolated_launcher(module, project):
    """動的importごとの保存先とPATH操作、旧共有ランチャー（~/.local/bin）を一時プロジェクトへ隔離する。"""
    launcher = getattr(module, '_launcher', module)
    directory = launcher._path_helper.launcher_directory
    with patch.object(launcher._path_helper, 'launcher_directory', side_effect=lambda program: directory(program, project=project)), \
            patch.object(Path, 'home', return_value=Path(project) / 'home'), \
            patch.object(launcher, 'ensure_launcher_path', return_value=True), \
            patch.object(launcher, 'remove_launcher_path', return_value=True), \
            patch.object(launcher.shutil, 'which', return_value='/fixture/node'):
        yield launcher


class LauncherTests(unittest.TestCase):
    def test_setup_and_cleanup_keep_commands_separate_in_both_orders(self):
        for order in [('frontend_ide/viewer', 'frontend_channels/discord'), ('frontend_channels/discord', 'frontend_ide/viewer')]:
            with self.subTest(order=order), tempfile.TemporaryDirectory() as temp:
                # 先に別フォルダの launcher が import 済みでも影響しない。
                cached = load(order[0], 'launcher')
                with patch.dict(sys.modules, {'launcher': cached}), patch.object(sys, 'path', sys.path.copy()):
                    modules = {folder: load(folder, '_setup') for folder in order}
                    paths = {}
                    for folder, module in modules.items():
                        with isolated_launcher(module, Path(temp)) as launcher:
                            paths[folder] = launcher.launcher_path()
                            self.assertTrue(paths[folder].is_relative_to(Path(temp)))
                            module.install_launcher(ROOT / folder)
                    self.assertNotEqual(*paths.values())
                    for folder, path in paths.items():
                        entry = ROOT / folder / ('panel/launch.mjs' if folder == 'frontend_channels/discord' else 'launch.mjs')
                        self.assertIn(str(entry), path.read_text(encoding='utf-8'))
                    first, second = order
                    cleanup = load(first, '_cleanup')
                    with isolated_launcher(cleanup, Path(temp)) as launcher:
                        self.assertEqual(launcher.launcher_path(), paths[first])
                        self.assertTrue(cleanup.remove_launcher(ROOT / first))
                    self.assertFalse(paths[first].exists())
                    self.assertTrue(paths[second].is_file())
                    cleanup = load(second, '_cleanup')
                    with isolated_launcher(cleanup, Path(temp)) as launcher:
                        self.assertEqual(launcher.launcher_path(), paths[second])
                        self.assertTrue(cleanup.remove_launcher(ROOT / second))
                    self.assertFalse(paths[second].exists())

    def test_missing_entry_does_not_overwrite_registered_command(self):
        for folder in ('frontend_ide/viewer', 'frontend_channels/discord'):
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
