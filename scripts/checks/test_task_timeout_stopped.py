# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""停止後の明細をタイムアウト扱いしないことを隔離SQLiteで確認。"""
import ast
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path
import unittest


class TimeoutStoppedTests(unittest.TestCase):
    def test_only_running_enabled_requests_and_details_are_candidates(self):
        source = Path(__file__).resolve().parents[2] / "backend_taskteam/task_proc/tasks_db.py"
        tree = ast.parse(source.read_text(encoding="utf-8-sig"))
        names = {"タイムアウト対象一覧", "明細タイムアウト分", "_正整数"}
        funcs = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names]
        conn = sqlite3.connect(":memory:")
        conn.row_factory = sqlite3.Row
        # 関数のfinally.closeを抑え、実SQLの結果を検証する。
        class Connection:
            execute = conn.execute
            def close(self):
                pass
        conn.execute("CREATE TABLE req (利用者ID TEXT, タスクID TEXT, 状態 TEXT, PID TEXT, 開始日時 TEXT, 更新日時 TEXT, 終了日時 TEXT, 実行有効 INTEGER)")
        conn.execute("CREATE TABLE detail (タスクID TEXT, 明細SEQ INTEGER, 状態 TEXT, PID TEXT, 開始日時 TEXT, 終了日時 TEXT, 実行有効 INTEGER, 予測分数 INTEGER)")
        old = (datetime.now() - timedelta(hours=2)).strftime("%Y-%m-%d %H:%M:%S")
        for key, state, enabled, detail_state in (
            ("running", "実行中", 1, "実行中"),
            ("stopped", "中止", 0, "待機"),
            ("disabled", "実行中", 0, "実行中"),
            ("waiting", "待機", 1, "待機"),
        ):
            conn.execute("INSERT INTO req VALUES ('test', ?, ?, '', ?, ?, '', ?)", (key, state, old, old, enabled))
            conn.execute("INSERT INTO detail VALUES (?, 1, ?, '', ?, '', 1, 2)", (key, detail_state, old))
        ns = dict(datetime=datetime, timedelta=timedelta, 初期化=lambda:None,
                  接続取得=Connection, AIタスク要求テーブル="req", AIタスク明細テーブル="detail")
        exec(compile(ast.Module(body=funcs, type_ignores=[]), str(source), "exec"), ns)
        rows = ns["タイムアウト対象一覧"]()
        detail_ids = {r["タスクID"] for r in rows if r["テーブル"] == "detail"}
        self.assertEqual(detail_ids, {"running"})
        self.assertFalse({"stopped", "disabled"} & {r["タスクID"] for r in rows})
        conn.close()


if __name__ == "__main__":
    unittest.main()
