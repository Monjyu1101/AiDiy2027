"""D原文引継ぎのSQLite回帰。実DB・ネットワーク・AIは使用しない。"""
import json
from contextlib import closing
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path[:0] = [str(Path(__file__).resolve().parents[1]),
               str(Path(__file__).resolve().parents[1] / "team_sub")]
from team_proc import team_pdca_db
import sub_SPDCA__common as common
import sub_SPDCA_check as check


class RawHandoffTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.db = str(Path(self.tmp.name) / "fixture.db")
        with closing(sqlite3.connect(self.db)) as c:
            c.executescript("""
                CREATE TABLE Aチーム作業 (作業ID TEXT, 依頼ID TEXT, プロジェクト TEXT, PDCA区分 TEXT);
                CREATE TABLE Aチーム依頼 (依頼ID TEXT, タスクID TEXT, プロジェクト TEXT);
                CREATE TABLE Aタスク明細 (タスクID TEXT, 明細SEQ INTEGER, タイプ TEXT, 状態 TEXT, 応答内容 TEXT);
                INSERT INTO Aチーム作業 VALUES ('work','request','project','D');
                INSERT INTO Aチーム依頼 VALUES ('request','task','project');
            """)
        def connect():
            c = sqlite3.connect(self.db)
            c.row_factory = sqlite3.Row
            return c
        self.patcher = patch.object(team_pdca_db, '接続取得', side_effect=connect)
        self.patcher.start()
        self.addCleanup(self.patcher.stop)
        self.record = {'作業ID': 'work', 'PDCA区分': 'D', 'まとめ内容': '要約', '応答内容': '終了通知'}

    def add(self, seq=1, kind='do', state='完了', answer='おはようございます。', task='task'):
        with closing(sqlite3.connect(self.db)) as c:
            c.execute('INSERT INTO Aタスク明細 VALUES (?,?,?,?,?)', (task, seq, kind, state, answer))
            c.commit()

    def test_single_raw_preserved_separate_from_summary(self):
        raw = '  おはよう。\n二行目\t日本語 "quote" '
        self.add(answer=raw)
        body = common.まとめ内容(self.record)
        self.assertTrue(body.startswith('要約\n'))
        details = json.loads(body.split('（要約とは別の記録）\n', 1)[1])
        self.assertEqual(details[0], {'明細SEQ':1,'タイプ':'do','状態':'完了','応答内容':raw})
        self.assertNotIn('終了通知', body)

    def test_multiple_order_and_states(self):
        self.add(3, state='パス', answer='')
        self.add(2, state='エラー', answer='失敗理由')
        self.add(1)
        rows = team_pdca_db.実施明細取得('work')
        self.assertEqual([r['明細SEQ'] for r in rows], [1,2,3])
        self.assertEqual([r['状態'] for r in rows], ['完了','エラー','パス'])
        self.assertEqual(rows[1]['応答内容'], '失敗理由')
        self.assertEqual(rows[2]['応答内容'], '')

    def test_control_and_end_notifications_excluded(self):
        for seq, kind in enumerate(['start','end','if','or']):
            self.add(seq, kind=kind, answer='通知')
        self.add(5)
        self.assertEqual(len(team_pdca_db.実施明細取得('work')),1)

    def test_other_request_not_mixed(self):
        self.add()
        self.add(answer='別依頼',task='other')
        self.assertNotIn('別依頼', common.まとめ内容(self.record))

    def test_project_mismatch_not_mixed(self):
        self.add()
        with closing(sqlite3.connect(self.db)) as c:
            c.execute("UPDATE Aチーム依頼 SET プロジェクト='other'")
            c.commit()
        self.assertEqual(team_pdca_db.実施明細取得('work'), [])

    def test_non_d_query_has_no_raw(self):
        self.add()
        with closing(sqlite3.connect(self.db)) as c:
            c.execute("UPDATE Aチーム作業 SET PDCA区分='C'")
            c.commit()
        self.assertEqual(team_pdca_db.実施明細取得('work'), [])

    def test_no_raw_is_explicit_not_end_answer(self):
        self.add(9999,kind='end',answer='処理終了')
        body = common.まとめ内容(self.record)
        self.assertIn('原文はありません', body)
        self.assertNotIn('処理終了', body)

    def test_empty_raw_state_kept_without_fabrication(self):
        self.add(answer='')
        self.assertEqual(team_pdca_db.実施明細取得('work')[0]['応答内容'], '')

    def test_non_d_fallback_unchanged_and_no_query(self):
        with patch.object(team_pdca_db,'実施明細取得') as query:
            self.assertEqual(common.まとめ内容({'PDCA区分':'C','まとめ内容':' summary ','応答内容':'reply'}),'summary')
            self.assertEqual(common.まとめ内容({'応答内容':' reply '}),'reply')
            self.assertEqual(common.まとめ内容({}),'')
            query.assert_not_called()

    def test_no_data_d_retains_empty_skip_behavior(self):
        self.assertEqual(common.まとめ内容({'作業ID':'work','PDCA区分':'D'}),'')

    def test_actual_check_prompt_contains_raw_and_plan(self):
        self.add(answer='確認原文731')
        body = common.まとめ内容(self.record)
        def template(section, key, values):
            return values.get('引き継ぎブロック', '評価指示')
        with patch.object(check.team_context,'差し込み',side_effect=template):
            prompt = check.プロンプト生成_評価('member','project','goal','work',{'P':'計画123','D':body})
        self.assertIn('確認原文731',prompt)
        self.assertIn('計画123',prompt)
        self.assertIn('明細SEQ',prompt)
        self.assertNotIn('終了通知',prompt)

if __name__ == '__main__':
    unittest.main()
