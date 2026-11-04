"""実DB/AIを使わず、即時経路とフォルダ監視の境界を検証する。"""
import logging
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend_taskteam"))
from task_proc import tasks_db, tasks_watcher as watcher


class WatchInitialFireTests(unittest.TestCase):
    def test_immediate_query_excludes_folder_and_scheduled_conditions(self):
        with tempfile.TemporaryDirectory() as directory:
            database = str(Path(directory) / "test.db")
            def connect():
                c = sqlite3.connect(database)
                c.row_factory = sqlite3.Row
                return c
            with connect() as c:
                c.execute("CREATE TABLE Aタスク要求 (利用者ID TEXT, タスクID TEXT, 実行有効 INTEGER, 状態 TEXT)")
                c.execute("CREATE TABLE Aタスク実行条件 (タスクID TEXT, 実行区分 TEXT, 実行条件 TEXT)")
                cases = [
                    ("normal", "即時", "無し", 1, "準備完了"),
                    ("missing", None, None, 1, "準備完了"),
                    ("folder", "即時", "フォルダ変化", 1, "準備完了"),
                    ("time", "時間指定", "無し", 1, "準備完了"),
                    ("disabled", "即時", "無し", 0, "準備完了"),
                    ("running", "即時", "無し", 1, "実行中"),
                ]
                for key, kind, condition, enabled, state in cases:
                    c.execute("INSERT INTO Aタスク要求 VALUES ('test',?,?,?)", (key, enabled, state))
                    if key != "missing":
                        c.execute("INSERT INTO Aタスク実行条件 VALUES (?,?,?)", (key, kind, condition))
            c.close()
            with patch.object(tasks_db, "初期化"), patch.object(tasks_db, "接続取得", side_effect=connect):
                self.assertEqual([r["タスクID"] for r in tasks_db.即時発火対象一覧()], ["missing", "normal"])

    def condition(self, folder):
        return {"利用者ID": "test", "タスクID": "WATCH", "実行区分": "即時",
                "実行条件": "フォルダ変化", "監視フォルダ": str(folder),
                "フォルダ内ファイル数": -1, "フォルダ内最終日時": "",
                "要求状態": "準備完了", "要求実行有効": 1}

    def test_baseline_change_once_and_two_unchanged_cycles(self):
        with tempfile.TemporaryDirectory() as folder:
            condition = self.condition(folder)
            def snapshot(key, count, timestamp):
                condition.update(フォルダ内ファイル数=count, フォルダ内最終日時=timestamp)
            with patch.object(tasks_db, "実行条件監視一覧", return_value=[condition]), \
                 patch.object(tasks_db, "フォルダ状態記録", side_effect=snapshot), \
                 patch.object(tasks_db, "次回実行日時更新"), \
                 patch.object(watcher, "_前周期の処理が残る", return_value=False), \
                 patch.object(tasks_db, "タスク発火", return_value=True) as fire:
                check = lambda: watcher._実行条件確認(logging.getLogger("watch-test"))
                check()  # 空フォルダの初回基準化
                self.assertEqual(condition["フォルダ内ファイル数"], 0)
                check()  # 変更なし
                fire.assert_not_called()
                Path(folder, "greeting.txt").write_text("おはよう", encoding="utf-8")
                check()
                fire.assert_called_once_with("WATCH", エラー再開=False)
                condition["要求状態"] = "完了"
                check()
                check()
                self.assertEqual(fire.call_count, 1)

    def test_future_time_does_not_fire_and_due_time_fires_once(self):
        condition = self.condition("")
        condition.update(実行区分="時間指定", 実行条件="無し", 次回実行日時="2999-01-01 00:00:00")
        with patch.object(tasks_db, "実行条件監視一覧", return_value=[condition]), \
             patch.object(tasks_db, "次回実行日時更新") as update, \
             patch.object(watcher, "_前周期の処理が残る", return_value=False), \
             patch.object(tasks_db, "タスク発火", return_value=True) as fire:
            watcher._実行条件確認(logging.getLogger("watch-test"))
            fire.assert_not_called()
            condition["次回実行日時"] = "2000-01-01 00:00:00"
            watcher._実行条件確認(logging.getLogger("watch-test"))
            fire.assert_called_once_with("WATCH", エラー再開=False)
            self.assertEqual(update.call_args.args, ("WATCH", ""))


if __name__ == "__main__":
    unittest.main()
