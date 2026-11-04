# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""編集APIの実行有効変更が一覧切替と同じ明細更新へ到達することを確認。"""
import ast
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock


class EditEnabledTests(unittest.TestCase):
    def execute(self, before, after, details, state="完了", requested_state="完了"):
        path = Path(__file__).resolve().parents[2] / "backend_taskteam/task_proc/tasks_api.py"
        tree = ast.parse(path.read_text(encoding="utf-8-sig"))
        fn = next(n for n in tree.body if isinstance(n, ast.AsyncFunctionDef) and n.name == "タスク要求更新登録")
        # このAPIは同期DB操作のみ。イベントループや実DBを起動せず本体を実行する。
        fn.returns = None
        fn.decorator_list = []
        for arg in fn.args.args:
            arg.annotation = None
        current = {"実行有効": before, "状態": state}
        flags = list(details)
        db = Mock()
        db.TASK_AI_NAME既定 = "codex_cli"
        db.タスク要求取得.side_effect = lambda *_: dict(current)
        db.タスク明細一覧.return_value = [{"実行有効": v} for v in flags]
        db.タスクPID一覧.return_value = []
        def save(*args):
            current.update(実行有効=args[-2], 状態=args[-1])
            return dict(current)
        def toggle(_, enabled):
            current["実行有効"] = enabled
            flags[:] = [enabled for _ in flags]
            if enabled and current["状態"] == "エラー":
                current["状態"] = "待機"
            return dict(current)
        db.タスク要求更新登録.side_effect = save
        db.タスク実行有効更新.side_effect = toggle
        db.明細全件有効待機化.side_effect = lambda *_: flags.__setitem__(slice(None), [True for _ in flags])
        db.実行条件監視取得.return_value = None
        watcher = Mock()
        watcher.実行条件再計算.return_value = ""
        ns = {"tasks_db": db, "tasks_watcher": watcher, "logger": Mock(),
              "_モデル3種": lambda *_: {"TASK_AI_MODEL_"+p: "auto" for p in ("plan", "do", "check")},
              "_OK": lambda *a: ("OK", a), "_NG": lambda *a: ("NG", a)}
        exec(compile(ast.Module(body=[fn], type_ignores=[]), str(path), "exec"), ns)
        request = SimpleNamespace(タスクID="TEST", 要求内容="試験", 実行条件=None,
                                  状況=requested_state, プロジェクト="test", TASK_AI_NAME="codex_cli", 実行有効=after)
        coroutine = ns[fn.name](request)
        try:
            coroutine.send(None)
        except StopIteration as result:
            self.assertEqual(result.value[0], "OK", result.value)
        else:
            self.fail("APIに非同期待機が追加されたため試験方法の更新が必要")
        finally:
            coroutine.close()
        return flags, current, db

    def test_reenable_after_bulk_disable_enables_details(self):
        flags, _, db = self.execute(False, True, [False, False])
        self.assertEqual(flags, [True, True])
        db.タスク実行有効更新.assert_called_once_with("TEST", True)

    def test_disable_propagates_to_details(self):
        flags, _, _ = self.execute(True, False, [True, False])
        self.assertEqual(flags, [False, False])

    def test_reenable_error_uses_existing_retry_path(self):
        flags, current, _ = self.execute(False, True, [False], state="エラー", requested_state="エラー")
        self.assertEqual(flags, [True])
        self.assertEqual(current["状態"], "待機")

    def test_unchanged_flag_preserves_individually_disabled_detail(self):
        flags, _, db = self.execute(True, True, [True, False])
        self.assertEqual(flags, [True, False])
        db.タスク実行有効更新.assert_not_called()

    def test_explicit_ready_still_resets_details_while_request_stays_off(self):
        flags, current, _ = self.execute(True, False, [False, True], requested_state="準備完了")
        self.assertEqual(flags, [True, True])
        self.assertFalse(current["実行有効"])
        self.assertEqual(current["状態"], "準備完了")


if __name__ == "__main__":
    unittest.main()
