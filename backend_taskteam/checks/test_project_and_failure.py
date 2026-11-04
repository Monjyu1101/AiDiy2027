"""実サービス・実DB・AIを使わない、プロジェクト受渡しと失敗反映の回帰。"""
import io
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from contextlib import closing
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from taskteam_proc import internal_client as client
from task_proc import tasks_db


class ProjectTests(unittest.TestCase):
    def test_tools_project_resolution_without_mutating_request(self):
        for endpoint in ('aidiy_code_agents/run', 'aidiy_task_agents/submit'):
            for value in ('../', '../frontend_ide', str(client.PROJECT_ROOT), ''):
                payload = {'project_path': value, 'prompt': 'fixture'}
                with patch.object(client._HTTP, 'open', return_value=io.BytesIO(b'{}')) as send:
                    client.post_json('http://127.0.0.1:8095/' + endpoint, payload)
                actual = json.loads(send.call_args.args[0].data)['project_path']
                expected = str((client.PROJECT_ROOT / '_config' / value).resolve()) if value else ''
                self.assertEqual(actual, expected)
                self.assertEqual(payload['project_path'], value)

    def test_other_endpoint_is_not_rewritten(self):
        with patch.object(client._HTTP, 'open', return_value=io.BytesIO(b'{}')) as send:
            client.post_json('http://127.0.0.1:8095/other', {'project_path': '../'})
        self.assertEqual(json.loads(send.call_args.args[0].data)['project_path'], '../')


class FailureTests(unittest.TestCase):
    def test_failure_propagates_but_cancelled_task_is_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            db = str(Path(directory) / 'fixture.db')
            conn = sqlite3.connect(db)
            conn.executescript('''
                CREATE TABLE Aタスク要求 (タスクID TEXT, 状態 TEXT, 実行有効 INTEGER,
                    応答タイトル TEXT, 応答内容 TEXT, PID TEXT, 終了日時 TEXT, 更新日時 TEXT);
                CREATE TABLE Aチーム依頼 (依頼ID TEXT, タスクID TEXT, 状態 TEXT,
                    応答タイトル TEXT, 応答内容 TEXT, 終了日時 TEXT, 更新日時 TEXT);
                CREATE TABLE Aチーム作業 (依頼ID TEXT, 状況 TEXT, 応答内容 TEXT,
                    終了日時 TEXT, 更新日時 TEXT);
                INSERT INTO Aタスク要求 VALUES ('failed','準備中',1,'','','pid','','');
                INSERT INTO Aタスク要求 VALUES ('cancel','中止',0,'','','','','');
                INSERT INTO Aチーム依頼 VALUES ('request1','failed','準備完了','','','','');
                INSERT INTO Aチーム依頼 VALUES ('request2','cancel','中止','','','','');
                INSERT INTO Aチーム作業 VALUES ('request1','準備完了','','','');
            ''')
            conn.commit()
            conn.close()
            with patch.object(tasks_db, '初期化'), patch.object(tasks_db, '接続取得', side_effect=lambda: sqlite3.connect(db)), patch.object(tasks_db, '_タスク要求取得', return_value={}):
                tasks_db.タスク失敗('failed', 'fixture failure')
                tasks_db.タスク失敗('cancel', 'must not propagate')
            with closing(sqlite3.connect(db)) as conn:
                row = conn.execute("SELECT 状態,応答内容,終了日時 FROM Aチーム依頼 WHERE タスクID='failed'").fetchone()
                self.assertEqual(row[:2], ('エラー', '[エラー] fixture failure'))
                self.assertTrue(row[2])
                self.assertEqual(conn.execute('SELECT 状況 FROM Aチーム作業').fetchone()[0], 'エラー')
                self.assertEqual(conn.execute("SELECT 状態,応答内容 FROM Aチーム依頼 WHERE タスクID='cancel'").fetchone(), ('中止', ''))


if __name__ == '__main__':
    unittest.main()
