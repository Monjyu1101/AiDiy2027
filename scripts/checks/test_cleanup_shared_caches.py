# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""全体 cleanup の ~/.aidiy/cache の共有キャッシュ（Electron / Rust）保持。利用者のホームには触れない。"""

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


class SharedCachePreservationTests(unittest.TestCase):
    def setUp(self):
        self.cleanup = load("aidiy_test_root_cleanup_caches", "_cleanup.py")
        self.enterContext(contextlib.redirect_stdout(io.StringIO()))

    def test_shared_caches_have_no_choice_in_interactive_or_auto(self):
        for auto in (False, True):
            with self.subTest(auto=auto), tempfile.TemporaryDirectory() as base:
                prompts = []
                def ask(prompt, default="n"):
                    prompts.append(prompt)
                    return default == "y"
                with patch.object(self.cleanup, "ask_start_mode", return_value=(True, False)), \
                        patch.object(self.cleanup, "ask_yes_no", side_effect=ask):
                    choices = self.cleanup.collect_cleanup_choices(Path(base), auto=auto)
                self.assertNotIn("electron_cache", choices)
                self.assertNotIn("codex_intermediate", choices)
                self.assertFalse(any("共有キャッシュ" in p or "コンパイル中間" in p for p in prompts))

    def test_execution_preserves_cache_even_with_old_choice_keys(self):
        base = Path(self.enterContext(tempfile.TemporaryDirectory()))
        home = Path(self.enterContext(tempfile.TemporaryDirectory()))
        files = [home / ".aidiy/cache/electron/test.zip",
                 home / ".aidiy/cache/codex/target/release/codex",
                 home / ".aidiy/cache/rust/test.cache"]
        for path in files:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"keep")
        with patch.object(self.cleanup, "ask_start_mode", return_value=(True, True)):
            choices = self.cleanup.collect_cleanup_choices(base, auto=True)
        choices.update(electron_cache=True, codex_intermediate=True)
        for method in ("stop_all_services", "cleanup_backup", "_run_folder_cleanup",
                       "remove_launcher_path", "cleanup_temp_directories",
                       "_remove_folder_import_cache", "_remove_root_python_caches"):
            self.enterContext(patch.object(self.cleanup, method, return_value=True))
        self.enterContext(patch.object(self.cleanup, "cleanup_channels", return_value=[]))
        self.enterContext(patch.object(self.cleanup.time, "sleep"))
        self.enterContext(patch.object(Path, "home", return_value=home))
        with patch.object(self.cleanup, "remove_directory") as remove:
            self.assertTrue(self.cleanup.execute_cleanup(base, choices))
            remove.assert_not_called()
        for path in files:
            self.assertEqual(path.read_bytes(), b"keep")


if __name__ == "__main__":
    unittest.main()
