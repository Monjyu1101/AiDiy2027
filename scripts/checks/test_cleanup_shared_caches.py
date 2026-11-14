# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""全体 cleanup の ~/.aidiy/cache の共有キャッシュ（Electron の ZIP）。利用者のホームには触れない。"""

import contextlib
import importlib.util
import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]


def load(name, relative):
    spec = importlib.util.spec_from_file_location(name, ROOT / relative)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ElectronCacheCleanupTests(unittest.TestCase):
    def setUp(self):
        self.cleanup = load("aidiy_test_root_cleanup_electron", "_cleanup.py")
        self.enterContext(contextlib.redirect_stdout(io.StringIO()))

    def test_cache_dir_comes_from_setup_electron(self):
        setup_electron = load("aidiy_test_setup_electron", "scripts/_setup_electron.py")
        self.assertEqual(self.cleanup._electron_cache_dir(), setup_electron.CACHE_DIR)
        self.assertEqual(setup_electron.CACHE_DIR, Path.home() / ".aidiy" / "cache" / "electron")

    def test_cache_is_removed_and_missing_cache_is_ok(self):
        cache = Path(self.enterContext(tempfile.TemporaryDirectory())) / "electron"
        cache.mkdir()
        (cache / "electron-v44.11.3-win32-x64.zip").write_bytes(b"zip")
        with patch.object(self.cleanup, "_electron_cache_dir", return_value=cache):
            self.assertTrue(self.cleanup.cleanup_electron_cache())
            self.assertFalse(cache.exists())
            self.assertTrue(self.cleanup.cleanup_electron_cache(), "無ければ何もしない")

    def test_unknown_cache_location_is_reported(self):
        with patch.object(self.cleanup, "_electron_cache_dir", return_value=None):
            self.assertFalse(self.cleanup.cleanup_electron_cache())

    def test_choice_is_asked_only_when_cache_exists(self):
        cache = Path(self.enterContext(tempfile.TemporaryDirectory())) / "electron"
        for exists in (True, False):
            with self.subTest(exists=exists):
                if exists:
                    cache.mkdir(exist_ok=True)
                elif cache.exists():
                    cache.rmdir()
                prompts = []

                def ask(prompt, default="n"):
                    prompts.append(prompt)
                    return default == "y"

                with tempfile.TemporaryDirectory() as base, \
                        patch.object(self.cleanup, "ask_start_mode", return_value=(True, False)), \
                        patch.object(self.cleanup, "ask_yes_no", side_effect=ask), \
                        patch.object(self.cleanup, "_codex_target_dir", return_value=None), \
                        patch.object(self.cleanup, "_electron_cache_dir", return_value=cache):
                    choices = self.cleanup.collect_cleanup_choices(Path(base))
                asked = [prompt for prompt in prompts if "Electron の共有キャッシュ" in prompt]
                self.assertEqual(len(asked), 1 if exists else 0)
                self.assertEqual(choices["electron_cache"], True if exists else None)


if __name__ == "__main__":
    unittest.main()
