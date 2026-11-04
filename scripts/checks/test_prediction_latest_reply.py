# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""隔離DBで、最後の正常なAI応答と元入力を予測履歴に確保する。"""

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


class PredictionLatestReplyTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.database = Path(temporary.name) / "history.db"
        self.now = datetime(2026, 10, 22, 12, 0, 0)
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
        options = {"user_only": True, "include_latest_reply": True, **kwargs}
        return read_prediction_history(self.database, self.project, now=self.now, **options)

    def test_latest_ten_inputs_and_one_reply_with_unchanged_database(self):
        for number in range(12):
            self.add(f"request {number:02}", -60 + number * 2)
            self.add(f"reply {number:02} " + "返" * 5000, -59 + number * 2, kind="output_text")
        before = self.database.read_bytes()

        result = self.read()
        self.assertEqual([item["content"] for item in result if item["role"] == "user"],
                         [f"request {number:02}" for number in range(2, 12)])
        replies = [item for item in result if item["role"] == "assistant"]
        self.assertEqual(len(replies), 1)
        self.assertEqual(replies[0]["content"], ("reply 11 " + "返" * 5000)[:4000])
        self.assertEqual(replies[0]["turn_id"], 10)
        self.assertEqual(self.database.read_bytes(), before)

    def test_latest_reply_uses_actual_order_and_original_lane_turn(self):
        self.add("A request", -10, channel="1", session="A")
        self.add("B request", -9, channel="2", session="B")
        self.add("B done", -8, kind="output_text", channel="2", session="B")
        self.add("A verified", -7, kind="output_text", channel="1", session="A")
        self.add("B follow-up", -6, channel="2", session="B")
        self.add("wrong channel", -5, kind="output_text", channel="3", session="A")
        self.add("wrong session", -4, kind="output_text", channel="1", session="B")

        result = self.read()
        self.assertEqual([item["content"] for item in result],
                         ["A request", "B request", "A verified", "B follow-up"])
        self.assertEqual([item["turn_id"] for item in result], [1, 2, 1, 3])

    def test_repeated_input_in_same_lane_starts_a_new_turn(self):
        self.add("first request", -5)
        self.add("first done", -4, kind="output_text")
        self.add("second request", -3)
        self.add("second done", -2, kind="output_text")
        result = self.read()
        self.assertEqual([item["content"] for item in result],
                         ["first request", "second request", "second done"])
        self.assertEqual(result[-1]["turn_id"], 2)

    def test_delayed_mirror_does_not_override_verification_result(self):
        self.add("unrelated chat request", -12)
        self.add("検証して", -11, kind="input_request", channel="1")
        self.add("検証して", -11)
        self.add("変更しました", -10, kind="output_text", channel="1")
        self.add("検証完了", -5, kind="output_text", channel="1")
        self.add("変更しました", -1, kind="output_request")

        result = self.read()
        self.assertEqual([item["content"] for item in result],
                         ["unrelated chat request", "検証して", "検証完了"])
        self.assertEqual(result[-1]["turn_id"], 2)

    def test_latest_reply_and_original_input_receive_budget_first(self):
        self.add("aaa", -5)
        self.add("old", -4, kind="output_text")
        self.add("bbb", -3)
        self.add("newest response", -2, kind="output_text")

        partial = self.read(max_chars=8, max_message_chars=8)
        self.assertEqual([item["content"] for item in partial], ["bbb", "newes"])
        self.assertEqual([item["content"] for item in self.read(max_chars=6)], ["bbb", "new"])
        for budget in (1, 2, 3, 4):
            with self.subTest(budget=budget):
                result = self.read(max_chars=budget)
                self.assertEqual(sum(len(item["content"]) for item in result), budget)
                self.assertTrue(all(item["content"] for item in result))
                self.assertEqual(result[0]["role"], "user")
                if budget > 1:
                    self.assertEqual(result[-1]["role"], "assistant")
                    self.assertEqual(result[0]["turn_id"], result[-1]["turn_id"])

    def test_long_inputs_keep_complete_reply_and_drop_oldest_inputs(self):
        for number in range(10):
            self.add(str(number) * 5000, -30 + number)
        self.add("検証完了" + "返" * 5000, -1, kind="output_text")
        before = self.database.read_bytes()
        result = self.read()
        self.assertEqual([item["content"][0] for item in result if item["role"] == "user"],
                         ["5", "6", "7", "8", "9"])
        self.assertEqual(result[-1]["content"], ("検証完了" + "返" * 5000)[:4000])
        self.assertEqual(result[-1]["turn_id"], result[-2]["turn_id"])
        self.assertEqual(sum(len(item["content"]) for item in result), 24000)
        self.assertTrue(all(len(item["content"]) <= 4000 for item in result))
        self.assertEqual(self.database.read_bytes(), before)

    def test_delayed_reply_reserves_older_original_input_under_pressure(self):
        self.add("A" * 4000, -30, session="A")
        for number in range(9):
            self.add(str(number) * 4000, -29 + number, session="B")
        self.add("A検証完了" + "返" * 4000, -1, kind="output_text", session="A")
        result = self.read()
        self.assertEqual([item["content"][0] for item in result if item["role"] == "user"],
                         ["A", "5", "6", "7", "8"])
        self.assertEqual(result[-1]["turn_id"], result[0]["turn_id"])
        self.assertNotEqual(result[-1]["turn_id"], result[-2]["turn_id"])
        self.assertEqual(sum(len(item["content"]) for item in result), 24000)

    def test_partial_oldest_input_uses_only_budget_left_after_pair(self):
        self.add("abcdef", -5)
        self.add("latest", -3)
        self.add("done", -2, kind="output_text")
        result = self.read(max_chars=12)
        self.assertEqual([item["content"] for item in result], ["ab", "latest", "done"])

    def test_error_progress_and_tool_identifiers_never_replace_valid_reply(self):
        self.add("検証して", -20)
        self.add("検証完了", -19, kind="output_text")
        for seconds, kind in enumerate(("error", "output_stream", "tool_call", "tool_result",
                                        "output_file", "progress", "update_info"), start=-18):
            self.add("not a final answer", seconds, kind=kind)
        self.assertEqual([item["content"] for item in self.read()], ["検証して", "検証完了"])

    def test_failed_or_empty_final_invalidates_same_turn_success(self):
        invalid_finals = ("!", "! failed", "！失敗", "（応答なし）", "(応答なし)",
                          "プロジェクトが変更されたため要求を実行しませんでした。再送してください。",
                          "", "   ")
        for number, content in enumerate(invalid_finals):
            with self.subTest(content=content):
                self.add(f"request {number}", -30 + number * 3)
                self.add("検証完了", -29 + number * 3, kind="output_text")
                self.add(content, -28 + number * 3, kind="output_text")
                self.assertTrue(all(item["role"] == "user" for item in self.read()))

    def test_failed_final_does_not_invalidate_different_turn(self):
        self.add("A request", -10, session="A")
        self.add("A done", -9, kind="output_text", session="A")
        self.add("B request", -8, session="B")
        self.add("B done", -7, kind="output_text", session="B")
        self.add("! B failed", -6, kind="output_text", session="B")
        result = self.read()
        self.assertEqual([item["content"] for item in result], ["A request", "A done", "B request"])
        self.assertEqual(result[1]["turn_id"], 1)

    def test_response_failure_classification_precedes_message_truncation(self):
        self.add("A", -5)
        self.add("done", -4, kind="output_text")
        self.add(" \t（応答なし）\n", -3, kind="output_text")
        self.assertEqual([item["content"] for item in self.read(max_message_chars=4)], ["A"])

    def test_no_valid_original_reply_returns_only_inputs(self):
        self.add("request", -5)
        self.add("! failed", -4, kind="output_text")
        self.add("mirrored answer", -3, kind="output_request")
        self.add("tool result", -2, kind="tool_result")
        self.assertEqual([item["content"] for item in self.read()], ["request"])

    def test_reply_scope_requires_same_project_and_in_window_original_input(self):
        self.add("out of window request", -7201, session="old")
        self.add("start boundary request", -7200)
        self.add("valid final", kind="output_text")
        self.add("orphan final", kind="output_text", session="old")
        self.add("other project", kind="output_text", project="/projects/other")
        self.add("unknown project", kind="output_text", project=None)
        self.add("future reply", 1, kind="output_text")

        self.assertEqual([item["content"] for item in self.read()],
                         ["start boundary request", "valid final"])

    def test_reply_from_evicted_turn_is_not_reassigned(self):
        for number in range(11):
            self.add(f"request {number}", -30 + number, session=f"session {number}")
        self.add("evicted turn final", kind="output_text", session="session 0")

        self.assertEqual([item["content"] for item in self.read()],
                         [f"request {number}" for number in range(1, 11)])

    def test_default_modes_stay_unchanged(self):
        self.add("request", -5)
        self.add("first final", -4, kind="output_text")
        self.add("last final", -3, kind="output_text")
        default = read_prediction_history(self.database, self.project, now=self.now)
        self.assertEqual([item["content"] for item in default],
                         ["request", "first final", "last final"])
        self.assertEqual(default, self.read(user_only=False, include_latest_reply=False))
        self.assertEqual([item["content"] for item in self.read(include_latest_reply=False)], ["request"])
        self.assertEqual(self.read(user_only=False), self.read())

    def test_latest_reply_option_requires_a_boolean(self):
        for invalid in (None, 0, 1, "true", "false"):
            with self.subTest(include_latest_reply=invalid), self.assertRaises(ValueError):
                self.read(include_latest_reply=invalid)


if __name__ == "__main__":
    unittest.main()
