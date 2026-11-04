# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""完了報告後のHTTP後処理と次周期の競合を再現する。実DBは使わない。"""
import logging
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend_taskteam"))
from task_proc import tasks_watcher as watcher


class CycleLifetimeTests(unittest.TestCase):
    def setUp(self):
        self.registry = patch.dict(watcher._所有明細プロセス, {}, clear=True)
        self.registry.start()
        self.addCleanup(self.registry.stop)
        self.log = logging.getLogger("cycle-test")

    def test_scheduled_cycle_waits_for_real_exit_after_completion_report(self):
        condition = {"利用者ID": "test", "タスクID": "TEST-CYCLE",
                     "実行区分": "間隔実行", "間隔区分": "分", "間隔値": 2,
                     "要求状態": "完了", "要求実行有効": 1,
                     "次回実行日時": "2000-01-01 00:00:00", "実行条件": "無し"}
        proc = Mock()
        proc.poll.return_value = None
        watcher._所有明細プロセス["TEST-CYCLE"] = [proc]
        with patch.object(watcher.tasks_db, "実行条件監視一覧", return_value=[condition]), \
             patch.object(watcher.tasks_db, "タスク発火", return_value=True) as fire, \
             patch.object(watcher.tasks_db, "次回実行日時更新") as update:
            watcher._実行条件確認(self.log)
            fire.assert_not_called()
            update.assert_not_called()
            proc.poll.return_value = 0
            watcher._実行条件確認(self.log)
            fire.assert_called_once_with("TEST-CYCLE", エラー再開=False)
            self.assertNotIn("TEST-CYCLE", watcher._所有明細プロセス)

    def test_immediate_cycle_does_not_block_other_task(self):
        proc = Mock()
        proc.poll.return_value = None
        watcher._所有明細プロセス["OLD"] = [proc]
        rows = [{"利用者ID": "test", "タスクID": key} for key in ("OLD", "OTHER")]
        with patch.object(watcher.tasks_db, "即時発火対象一覧", return_value=rows), \
             patch.object(watcher.tasks_db, "タスク発火", return_value=True) as fire:
            watcher._即時実行条件確認(self.log)
            fire.assert_called_once_with("OTHER")


if __name__ == "__main__":
    unittest.main()
