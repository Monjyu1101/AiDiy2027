# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""自動選択と CLI 入口のみ検証する。実削除・サービス停止は行わない。"""
import contextlib
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


class CleanupAutoTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location(
            "cleanup_auto", Path(__file__).resolve().parents[2] / "_cleanup.py")
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.enterContext(contextlib.redirect_stdout(io.StringIO()))
        self.enterContext(contextlib.redirect_stderr(io.StringIO()))

    def test_auto_matches_interactive_a_and_preserves_database(self):
        root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        database = root / self.module.SQLITE_DB_REL_PATH
        database.parent.mkdir(parents=True)
        database.write_bytes(b"preserved")
        (root / self.module.BACKEND_PATH / ".venv").mkdir(parents=True)
        with patch.object(self.module, "_read_single_key", side_effect=AssertionError("入力待ち")), \
                patch.object(self.module, "ask_start_mode", return_value=(True, True)) as start:
            auto = self.module.collect_cleanup_choices(root, auto=True)
            start.assert_not_called()
            interactive = self.module.collect_cleanup_choices(root)
        self.assertEqual(auto, interactive)
        self.assertFalse(auto["backend_sqlite"])
        self.assertFalse(auto["npm_uninstall"])
        self.assertTrue(auto["backend_envs"][".venv"])
        self.assertEqual(database.read_bytes(), b"preserved")

    def test_main_routes_auto_and_interactive(self):
        for argv, auto in ((["--auto"], True), ([], False)):
            with self.subTest(argv=argv), \
                    patch.object(self.module, "collect_cleanup_choices", return_value={}) as collect, \
                    patch.object(self.module, "cleanup_stop_request", return_value=contextlib.nullcontext()), \
                    patch.object(self.module, "execute_cleanup", return_value=True) as execute:
                self.module.main(argv)
                collect.assert_called_once_with(self.module.BASE_DIR, auto=auto)
                execute.assert_called_once_with(self.module.BASE_DIR, {})

    def test_invalid_option_stops_before_cleanup(self):
        with patch.object(self.module, "collect_cleanup_choices") as collect, self.assertRaises(SystemExit) as result:
            self.module.main(["--aut"] + ["--unknown"])
        self.assertEqual(result.exception.code, 2)
        collect.assert_not_called()


if __name__ == "__main__":
    unittest.main()
