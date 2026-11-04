# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""隔離DBで予測履歴のユーザー入力専用予算と既存の取得範囲を確認する。"""

from contextlib import closing
from datetime import datetime, timedelta
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend_server"))

from 会話履歴参照 import read_prediction_history


class PredictionHistoryBudgetTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.database = Path(temporary.name) / "history.db"
        self.now = datetime(2026, 10, 21, 12, 0, 0)
        self.project = "/projects/example"
        self.sequence = 0
        with closing(sqlite3.connect(self.database)) as connection:
            connection.execute('''
                CREATE TABLE "A会話履歴" (
                    "セッションID" TEXT, "シーケンス" INTEGER,
                    "チャンネル" TEXT, "メッセージ識別" TEXT,
                    "登録日時" TEXT, "メッセージ内容" TEXT,
                    "プロジェクトパス" TEXT
                )
            ''')
            connection.commit()

    def add(self, content, seconds=0, *, kind="input_text", channel="0",
            session="session", project="/projects/example"):
        self.sequence += 1
        when = (self.now + timedelta(seconds=seconds)).strftime("%Y-%m-%d %H:%M:%S")
        with closing(sqlite3.connect(self.database)) as connection:
            connection.execute(
                'INSERT INTO "A会話履歴" VALUES (?, ?, ?, ?, ?, ?, ?)',
                (session, self.sequence, channel, kind, when, content, project),
            )
            connection.commit()

    def read(self, **kwargs):
        return read_prediction_history(self.database, self.project, now=self.now, **kwargs)

    def test_long_replies_do_not_displace_latest_ten_user_inputs(self):
        for number in range(12):
            seconds = -120 + number * 2
            self.add(f"request {number:02}", seconds)
            self.add("返" * 4000, seconds + 1, kind="output_text")
        before = self.database.read_bytes()

        users = self.read(user_only=True)
        self.assertEqual([item["content"] for item in users],
                         [f"request {number:02}" for number in range(2, 12)])
        self.assertEqual([item["turn_id"] for item in users], list(range(1, 11)))
        self.assertTrue(all(item["role"] == "user" for item in users))

        default = self.read()
        self.assertEqual(default, self.read(user_only=False))
        self.assertEqual(sum(item["role"] == "user" for item in default), 6)
        self.assertTrue(any(item["role"] == "assistant" for item in default))
        self.assertEqual(sum(len(item["content"]) for item in default), 24000)
        self.assertEqual(self.database.read_bytes(), before)

    def test_user_only_preserves_two_hour_bounds_and_project_scope(self):
        self.add("too old", -7201)
        self.add("start boundary", -7200)
        self.add("other project", -2, project="/projects/other")
        self.add("unknown project", -1, project=None)
        self.add("end boundary")
        self.add("future", 1)

        result = self.read(user_only=True)
        self.assertEqual([item["content"] for item in result],
                         ["start boundary", "end boundary"])

    def test_user_only_applies_message_total_and_turn_budgets(self):
        for number in range(3):
            self.add(f"{number}abcdefghij", -10 + number * 2)
            self.add("返" * 4000, -9 + number * 2, kind="output_text")

        result = self.read(user_only=True, max_message_chars=6, max_chars=10)
        self.assertEqual([item["content"] for item in result], ["1abc", "2abcde"])
        self.assertEqual(sum(len(item["content"]) for item in result), 10)
        latest = self.read(user_only=True, max_turns=1)
        self.assertEqual([item["content"] for item in latest], ["2abcdefghij"])

    def test_user_only_deduplicates_mirrors_and_keeps_unanswered_inputs(self):
        self.add("code input", -2, kind="input_request", channel="1")
        self.add("code input", -2, kind="input_text", channel="0")
        self.add("reply", -1, kind="output_text", channel="1")
        self.add("reply", -1, kind="output_request", channel="0")
        self.add("pending input", kind="input_request", channel="2", session="other")

        result = self.read(user_only=True)
        self.assertEqual([item["content"] for item in result], ["code input", "pending input"])

    def test_user_only_requires_a_boolean(self):
        for invalid in (None, 0, 1, "true", "false"):
            with self.subTest(user_only=invalid), self.assertRaises(ValueError):
                self.read(user_only=invalid)


if __name__ == "__main__":
    unittest.main()
