# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""チーム画面の有効切替・中止が関連タスクの制御経路へ届くことを検証。"""
import importlib.util
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

path = Path(__file__).resolve().parents[2] / "backend_taskteam/team_proc/team_task_control.py"
spec = importlib.util.spec_from_file_location("team_task_control_test", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class TeamControlTests(unittest.TestCase):
    def run_case(self, state="準備完了", enabled=True, task_enabled=False, task_id="TR-test", fail=False):
        task = dict(実行有効=task_enabled, プロジェクト="test", 要求内容="試験",
                    TASK_AI_NAME="codex_cli", TASK_AI_MODEL_plan="auto",
                    TASK_AI_MODEL_do="auto", TASK_AI_MODEL_check="auto")
        calls = []
        async def stop(request):
            calls.append(("stop", request))
            return {"status": "NG" if fail else "OK", "message": "停止失敗"}
        async def toggle(request):
            calls.append(("toggle", request))
            return {"status": "OK"}
        api = SimpleNamespace(タスク要求更新登録=stop, タスク要求実行有効切替=toggle,
            タスク要求更新登録リクエスト=SimpleNamespace,
            タスク実行有効切替リクエスト=SimpleNamespace)
        update = dict(状態=state, 実行有効=enabled)
        package = SimpleNamespace(tasks_api=api, tasks_db=SimpleNamespace(タスク要求取得=Mock(return_value=task)))
        with patch.dict(sys.modules, {"task_proc": package}):
            coroutine = module.依頼操作反映({"タスクID": task_id}, update)
            try:
                coroutine.send(None)
            except StopIteration:
                pass
            finally:
                coroutine.close()
        return calls, update

    def test_enable_reaches_related_task(self):
        calls, _ = self.run_case()
        self.assertEqual(calls[0][0], "toggle")
        self.assertEqual(calls[0][1].タスクID, "TR-test")
        self.assertTrue(calls[0][1].実行有効)

    def test_cancel_uses_process_stop_and_forces_off(self):
        calls, update = self.run_case(state="中止", task_enabled=True)
        self.assertEqual(calls[0][0], "stop")
        self.assertEqual(calls[0][1].状況, "中止")
        self.assertFalse(update["実行有効"])

    def test_reprepare_stops_old_task_before_replacing_link(self):
        calls, update = self.run_case(state="準備開始", task_enabled=True)
        self.assertEqual(calls[0][0], "stop")
        self.assertTrue(update["実行有効"])

    def test_unchanged_flag_does_not_reset_details(self):
        self.assertEqual(self.run_case(task_enabled=True)[0], [])

    def test_unlinked_request_has_no_task_side_effect(self):
        self.assertEqual(self.run_case(task_id="")[0], [])

    def test_stop_failure_is_not_reported_as_success(self):
        with self.assertRaisesRegex(ValueError, "停止失敗"):
            self.run_case(state="中止", fail=True)


if __name__ == "__main__":
    unittest.main()
