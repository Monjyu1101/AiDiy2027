# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""Web / Avatar cleanup の結果を一時フォルダだけで確認する。"""
import contextlib
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]


def load(kind):
    spec = importlib.util.spec_from_file_location('frontend_cleanup_' + kind, ROOT / f'frontend_{kind}/_cleanup.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FrontendCleanupTests(unittest.TestCase):
    def scenario(self, kind):
        module = load(kind)
        root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.enterContext(patch.object(module, f'FRONTEND_{kind.upper()}_DIR', root))
        if kind == 'avatar':
            self.enterContext(patch.object(module, 'remove_standalone_launcher', return_value=True))
        self.output = self.enterContext(contextlib.redirect_stdout(io.StringIO()))
        return module, root

    def test_missing_runtimes_do_not_block_cleanup_or_remove_locks(self):
        for kind in ('web', 'avatar'):
            with self.subTest(kind=kind):
                module, root = self.scenario(kind)
                for name in ('node_modules', 'dist', 'src/__pycache__', 'src/.pytest_cache'):
                    (root / name).mkdir(parents=True)
                (root / 'package-lock.json').write_text('lock', encoding='utf-8')
                with patch.object(module.shutil, 'which', return_value=None):
                    self.assertTrue(module.cleanup())
                self.assertEqual((root / 'package-lock.json').read_text(encoding='utf-8'), 'lock')
                self.assertTrue((root / 'src').exists())
                self.assertTrue(module.cleanup())  # already clean is also success

    def test_failed_generated_directory_is_not_reported_success(self):
        for kind in ('web', 'avatar'):
            for name in ('node_modules', 'dist', *(['dist-electron'] if kind == 'avatar' else [])):
                with self.subTest(kind=kind, name=name):
                    module, root = self.scenario(kind)
                    (root / name).mkdir()
                    with patch.object(module, 'remove_directory', return_value=False):
                        self.assertFalse(module.cleanup())
                    self.assertNotIn('クリーンアップ完了', self.output.getvalue())

    def test_failed_nested_cache_is_propagated(self):
        for kind in ('web', 'avatar'):
            for name in ('__pycache__', '.pytest_cache'):
                with self.subTest(kind=kind, name=name):
                    module, root = self.scenario(kind)
                    (root / 'src' / name).mkdir(parents=True)
                    with patch.object(module, 'remove_directory', return_value=False):
                        self.assertFalse(module.cleanup())
                    self.assertNotIn('クリーンアップ完了', self.output.getvalue())

    def test_cli_exits_nonzero_when_cleanup_fails(self):
        for kind in ('web', 'avatar'):
            with self.subTest(kind=kind):
                module, _ = self.scenario(kind)
                with patch.object(module, 'ask_start_mode', return_value=(True, False)), patch.object(
                    module, 'cleanup', return_value=False
                ), self.assertRaises(SystemExit) as stop:
                    module.main()
                self.assertEqual(stop.exception.code, 1)
                self.assertNotIn('クリーンアップが完了しました', self.output.getvalue())


if __name__ == '__main__':
    unittest.main()
