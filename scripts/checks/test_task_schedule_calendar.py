# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""DB・実時計を変更せず、実装の暦計算を固定日時で検証する。"""
import ast
import calendar
from datetime import datetime, timedelta
from pathlib import Path
import unittest

source = Path(__file__).resolve().parents[2] / "backend_taskteam/task_proc/tasks_watcher.py"
tree = ast.parse(source.read_text(encoding="utf-8"))
functions = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in
             {"_時刻適用", "_次回実行日時計算"}]
scope = {"datetime": datetime, "timedelta": timedelta, "calendar": calendar,
         "_曜日番号": dict(zip("月火水木金土日", range(7)))}
exec(compile(ast.Module(body=functions, type_ignores=[]), str(source), "exec"), scope)
calculate = scope["_次回実行日時計算"]


class ScheduleCalendarTests(unittest.TestCase):
    def test_daily_weekly_monthly_boundaries(self):
        cases = [
            ({"定時区分": "毎日"}, "2026-10-25 08:59:59", "2026-10-25 09:00:00"),
            ({"定時区分": "毎日"}, "2026-12-31 09:00:00", "2027-01-01 09:00:00"),
            ({"定時区分": "毎週", "実行曜日": "月"}, "2026-10-25 10:00:00", "2026-10-26 09:00:00"),
            ({"定時区分": "毎週", "実行曜日": "日"}, "2026-10-25 09:00:00", "2026-11-01 09:00:00"),
            ({"定時区分": "毎月", "実行日": 31}, "2026-02-01 00:00:00", "2026-02-28 09:00:00"),
            ({"定時区分": "毎月", "実行日": 31}, "2028-02-01 00:00:00", "2028-02-29 09:00:00"),
            ({"定時区分": "毎月", "実行日": 31}, "2026-12-31 09:00:00", "2027-01-31 09:00:00"),
        ]
        for values, base, expected in cases:
            with self.subTest(values=values, base=base):
                self.assertEqual(calculate({"実行区分": "定時実行", "開始時刻": "09:00", **values}, datetime.fromisoformat(base)), expected)

    def test_invalid_schedule(self):
        for values in ({"定時区分": "毎月", "実行日": 32},
                       {"定時区分": "毎週", "実行曜日": "不正"},
                       {"定時区分": "毎日", "開始時刻": "25:00"}):
            with self.subTest(values=values):
                self.assertEqual(calculate({"実行区分": "定時実行", "開始時刻": "09:00", **values}, datetime(2026, 10, 25)), "")


if __name__ == "__main__":
    unittest.main()
