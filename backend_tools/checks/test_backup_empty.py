"""対象0件と失敗の区別。専用一時素材のみ、通信・Git起動なし。"""
import logging
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
from types import ModuleType
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tools_proc import backup

class EmptyBackupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="aidiy-empty-backup-")
        self.root = Path(self.temp.name)
        self.saver = backup.BackupSave(str(self.root))
        stub = ModuleType("log_config")
        stub.get_logger = logging.getLogger
        with patch.dict(sys.modules, {"log_config": stub}):
            self.native = self.saver._get_native()
        self.patches = [patch.object(self.native, "_ローカルGit記録"),
                        patch.object(socket.socket, "connect", side_effect=AssertionError("network prohibited")),
                        patch.object(subprocess, "Popen", side_effect=AssertionError("process prohibited"))]
        for p in self.patches: p.start()
    def tearDown(self):
        for p in reversed(self.patches): p.stop()
        self.temp.cleanup()
    def test_empty(self):
        with patch.object(self.native, "_ファイルコピー実行") as copy:
            r = self.saver.run()
            self.assertTrue(r["ok"] and r["対象なし"] and r["差分なし"])
            self.assertEqual(r["バックアップ件数"], 0)
            self.assertEqual(r["バックアップ先"], "")
            copy.assert_not_called()
        self.assertFalse((self.root / ".aidiy_backup").exists())
    def test_excluded_only(self):
        (self.root / "temp").mkdir()
        (self.root / "temp" / "ignored.txt").write_text("fixture", encoding="utf-8")
        (self.root / "package-lock.json").write_text("{}", encoding="utf-8")
        self.assertTrue(self.saver.run()["対象なし"])
    def test_copy_and_no_difference(self):
        p = self.root / "sample.txt"
        p.write_text("公開試験 Hello 731", encoding="utf-8")
        r = self.saver.run()
        self.assertTrue(r["ok"])
        self.assertFalse(r["対象なし"])
        self.assertEqual((Path(r["バックアップ先"]) / p.name).read_bytes(), p.read_bytes())
        r = self.saver.run()
        self.assertTrue(r["ok"] and r["差分なし"])
        self.assertFalse(r["対象なし"])
    def test_copy_failure(self):
        (self.root / "sample.txt").write_text("fixture")
        with patch.object(self.native, "_単一ファイルコピー", return_value=False):
            self.assertFalse(self.saver.run()["ok"])
    def test_limit(self):
        (self.root / "sample.txt").write_text("fixture")
        with patch.object(self.native, "_バックアップキャンセル件数", 1):
            self.assertFalse(self.saver.run()["ok"])
    def test_missing(self):
        self.saver.root = str(self.root / "missing")
        self.assertFalse(self.saver.run()["ok"])
    def test_scan_exception(self):
        with patch.object(self.native, "_全ファイルスキャン", side_effect=PermissionError("fixture")):
            self.assertFalse(self.saver.run()["ok"])
    def test_walk_permission_failure_is_not_empty(self):
        def denied(*args, **kwargs):
            kwargs["onerror"](PermissionError("fixture read denied"))
            return iter(())
        with patch.object(self.native.os, "walk", side_effect=denied):
            self.assertFalse(self.saver.run()["ok"])
    def test_stat_failure_is_not_empty(self):
        (self.root / "sample.txt").write_text("fixture")
        with patch.object(self.native.os.path, "getmtime", side_effect=PermissionError("fixture stat denied")):
            self.assertFalse(self.saver.run()["ok"])
    def test_cancel_result(self):
        self.assertFalse(backup.BackupSave._result(None, False)["ok"])
    def test_empty_common_log_is_completion(self):
        from unittest.mock import Mock
        log = Mock()
        r = self.native.バックアップ実行_共通ログ(呼出しロガー=log, セッション設定={"CODE_BASE_PATH": str(self.root)})
        self.assertIsNotNone(r)
        self.assertIn("バックアップ終了", log.info.call_args.args[0])

if __name__ == "__main__": unittest.main()
