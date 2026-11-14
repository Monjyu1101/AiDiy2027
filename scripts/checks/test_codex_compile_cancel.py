# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""aidiy_codex のコンパイル中止（_compile.py --cancel / 全体 cleanup）。実プロセスは操作しない。"""

import contextlib
import importlib.util
import io
import json
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]


def load(name, relative):
    spec = importlib.util.spec_from_file_location(name, ROOT / relative)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


compile_module = load("aidiy_test_codex_compile", "command_codex/_compile.py")


class CancelCompileTests(unittest.TestCase):
    def setUp(self):
        folder = Path(self.enterContext(tempfile.TemporaryDirectory()))
        # 利用者のホームの状態ファイルには触れない。
        self.enterContext(patch.object(compile_module, "BUILD_DIR", folder))
        self.enterContext(patch.object(compile_module, "STATUS_FILE", folder / "aidiy_codex_compile.json"))
        self.enterContext(contextlib.redirect_stdout(io.StringIO()))
        self.status_file = folder / "aidiy_codex_compile.json"

    def write(self, **values):
        self.status_file.write_text(json.dumps(values, ensure_ascii=False), encoding="utf-8")

    def read(self):
        return json.loads(self.status_file.read_text(encoding="utf-8"))

    def test_nothing_running_returns_true_without_touching_processes(self):
        for status in ({}, {"状態": "完了", "pid": 4321}, {"状態": "コンパイル中", "pid": 4321}):
            with self.subTest(status=status):
                self.write(**status)
                with patch.object(compile_module, "pid_alive", return_value=False), \
                        patch.object(compile_module, "load_process_helper", side_effect=AssertionError("must not stop")):
                    self.assertTrue(compile_module.cancel_compile())
                self.assertEqual(self.read(), status)

    def test_running_compile_is_stopped_and_marked_interrupted(self):
        self.write(状態="コンパイル中", pid=4321, 種類="release", 開始日時="2026-11-14T03:00:00+00:00")
        seen = {}

        def stop_matching(matches, info, error, label):
            seen["own"] = matches({"ProcessId": 4321, "CommandLine": 'python.exe "C:/p/command_codex/_compile.py" --yes'})
            # PID が再利用された別プロセスや、配下の cargo そのものは照合しない（ツリーごと終了する）。
            seen["reused"] = matches({"ProcessId": 4321, "CommandLine": "notepad.exe"})
            seen["other"] = matches({"ProcessId": 999, "CommandLine": "python _compile.py"})
            return True

        helper = types.SimpleNamespace(stop_matching=stop_matching)
        with patch.object(compile_module, "pid_alive", return_value=True), \
                patch.object(compile_module, "load_process_helper", return_value=helper):
            self.assertTrue(compile_module.cancel_compile())
        self.assertEqual(seen, {"own": True, "reused": False, "other": False})
        status = self.read()
        self.assertEqual(status["状態"], "中断")
        self.assertEqual(status["pid"], 4321)
        self.assertEqual(status["種類"], "release")
        self.assertIn("終了日時", status)
        self.assertIn("クリーンアップ", status["メッセージ"])

    def test_failed_stop_keeps_running_status(self):
        self.write(状態="コンパイル中", pid=4321)
        for helper in (types.SimpleNamespace(stop_matching=lambda *args: False), None):
            with self.subTest(helper=helper):
                loader = {"return_value": helper} if helper else {"side_effect": OSError("missing helper")}
                with patch.object(compile_module, "pid_alive", return_value=True), \
                        patch.object(compile_module, "load_process_helper", **loader):
                    self.assertFalse(compile_module.cancel_compile())
                self.assertEqual(self.read(), {"状態": "コンパイル中", "pid": 4321})

    def test_status_written_by_a_finished_compile_is_not_overwritten(self):
        self.write(状態="コンパイル中", pid=4321)

        def stop_matching(*args):
            # 中止処理の間に、ビルドが自分で完了を書いた場合。
            self.write(状態="完了", pid=4321)
            return True

        with patch.object(compile_module, "pid_alive", return_value=True), \
                patch.object(compile_module, "load_process_helper", return_value=types.SimpleNamespace(stop_matching=stop_matching)):
            self.assertTrue(compile_module.cancel_compile())
        self.assertEqual(self.read(), {"状態": "完了", "pid": 4321})

    def test_cancel_option_exits_with_result(self):
        for result, code in ((True, 0), (False, 1)):
            with self.subTest(result=result), patch.object(compile_module, "cancel_compile", return_value=result) as cancel, \
                    patch("sys.argv", ["_compile.py", "--cancel"]), self.assertRaises(SystemExit) as raised:
                compile_module.main()
            self.assertEqual(raised.exception.code, code)
            cancel.assert_called_once()


class RootCleanupTests(unittest.TestCase):
    def setUp(self):
        self.cleanup = load("aidiy_test_root_cleanup_codex", "_cleanup.py")
        module = Mock()
        module.process_tree_pids.return_value = set()
        for target, value in (("_load_folder_module", module), ("_load_folder_start_module", module)):
            self.enterContext(patch.object(self.cleanup, target, return_value=value))
        self.enterContext(patch.object(self.cleanup.time, "sleep"))
        self.enterContext(patch.object(self.cleanup._opencode_service, "stop_opencode_service"))
        self.enterContext(contextlib.redirect_stdout(io.StringIO()))

    def test_cleanup_cancels_running_compile_before_other_stops(self):
        codex = Mock()
        codex.cancel_compile.return_value = True
        with patch.object(self.cleanup, "_load_codex_compile_module", return_value=codex):
            self.assertTrue(self.cleanup.stop_all_services(keep_diag=False))
        codex.cancel_compile.assert_called_once_with()

    def test_cleanup_stops_when_compile_cannot_be_cancelled(self):
        codex = Mock()
        codex.cancel_compile.return_value = False
        with patch.object(self.cleanup, "_load_codex_compile_module", return_value=codex):
            with self.assertRaises(RuntimeError) as raised:
                self.cleanup.stop_all_services(keep_diag=False)
            self.assertIn("aidiy_codex のコンパイル", str(raised.exception))
            self.assertFalse(self.cleanup.stop_all_services(keep_diag=False, strict=False))

    def test_cleanup_removes_compile_intermediate_files_only(self):
        home = Path(self.enterContext(tempfile.TemporaryDirectory()))
        target = home / "cache" / "codex" / "target"
        (target / "release").mkdir(parents=True)
        (target / "release" / "codex.exe").write_bytes(b"x")
        status = target.parent / "aidiy_codex_compile.json"
        status.write_text("{}", encoding="utf-8")
        codex = Mock(TARGET_DIR=target)
        codex.cancel_compile.return_value = True
        with patch.object(self.cleanup, "_load_codex_compile_module", return_value=codex):
            self.assertEqual(self.cleanup._codex_target_dir(), target)
            self.assertTrue(self.cleanup.cleanup_codex_intermediate())
            self.assertFalse(target.exists())
            self.assertTrue(status.exists(), "状態・ログは残す")
            self.assertTrue(self.cleanup.cleanup_codex_intermediate(), "無ければ何もしない")

    def test_cleanup_keeps_intermediate_files_when_compile_cannot_be_cancelled(self):
        target = Path(self.enterContext(tempfile.TemporaryDirectory())) / "target"
        target.mkdir()
        codex = Mock(TARGET_DIR=target)
        codex.cancel_compile.return_value = False
        with patch.object(self.cleanup, "_load_codex_compile_module", return_value=codex):
            self.assertFalse(self.cleanup.cleanup_codex_intermediate())
        self.assertTrue(target.exists())


if __name__ == "__main__":
    unittest.main()
