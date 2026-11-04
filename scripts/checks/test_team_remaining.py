# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""準備中止と遅延投入の順序、自動会話入力の実呼出しを隔離検証。"""
import ast, importlib.util, json, sys, tempfile, unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'backend_taskteam'))
from task_proc import tasks_db
from team_proc import team_work_db

def functions(path,names,ns):
 tree=ast.parse((ROOT/path).read_text(encoding='utf-8'))
 exec(compile(ast.Module(body=[n for n in tree.body if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef)) and n.name in names],type_ignores=[]),str(path),'exec'),ns)
 return ns

class RemainingTests(unittest.TestCase):
 def test_stop_before_submit_rejects_late_insert_and_preserves_cancel(self):
  with tempfile.TemporaryDirectory() as temp, patch.object(tasks_db,'DB_PATH',str(Path(temp)/'test.db')), patch.object(tasks_db,'DB_DIR',temp), patch.object(tasks_db,'_初期化済み',False), patch.object(team_work_db,'DB_PATH',Path(temp)/'test.db'), patch.object(team_work_db,'_初期化済み',False):
   tasks_db.初期化();team_work_db.初期化()
   actor=dict(利用者ID='test',利用者名='test',端末ID='test')
   data=dict(要員ID='admin',プロジェクト=temp,要求内容='試験',状態='準備開始',実行有効=True,TEAM_AI_NAME='codex_cli',TASK_AI_NAME='codex_cli',**{k:'auto' for k in team_work_db.AIモデルカラム})
   row=team_work_db.依頼登録(data,actor);key=row['依頼ID'];self.assertTrue(team_work_db.依頼確保(key))
   self.assertTrue(team_work_db.準備停止確保(key))
   with self.assertRaisesRegex(ValueError,'準備中ではない'):tasks_db.仮タスク登録(key,'試験','試験','admin')
   self.assertFalse(tasks_db.タスク要求取得(key))
   team_work_db.投入失敗記録(key,'遅れた失敗通知')
   row=team_work_db.依頼取得('admin',key);self.assertEqual(row['状態'],'中止');self.assertEqual(row['PID'],'');self.assertFalse(row['実行有効'])
   # 逆の順序：投入が先なら要求は残り、制御層がIDで停止できる。
   row=team_work_db.依頼登録(data,actor);key=row['依頼ID'];team_work_db.依頼確保(key)
   tasks_db.仮タスク登録(key,'試験','試験','admin');team_work_db.準備停止確保(key)
   self.assertIsNotNone(tasks_db.タスク要求取得(key))
 def test_task_cancel_survives_late_plan_and_failure(self):
  with tempfile.TemporaryDirectory() as temp, patch.object(tasks_db,'DB_PATH',str(Path(temp)/'test.db')), patch.object(tasks_db,'DB_DIR',temp), patch.object(tasks_db,'_初期化済み',False):
   tasks_db.仮タスク登録('late-plan','original','original request','admin')
   conn=tasks_db.接続取得();conn.execute("UPDATE Aタスク要求 SET 状態='中止', 実行有効=0 WHERE タスクID='late-plan'");conn.commit();conn.close()
   row=tasks_db.タスク本登録('admin','late-plan','late','late request','TD',[])
   self.assertEqual(row['状態'],'中止');self.assertEqual(row['タイトル'],'original')
   row=tasks_db.タスク失敗('late-plan','late error');self.assertEqual(row['状態'],'中止')
 def test_talk_main_passes_named_goal_project_and_history(self):
  with tempfile.TemporaryDirectory() as temp:
   input=Path(temp)/'input.json';input.write_text(json.dumps(dict(プロジェクト=temp,要員ID='CASPER',チーム目標='青い鳥',他者意見=[{'要員ID':'B','発言内容':'他者'}],自身の1回前の発言='前回')),encoding='utf-8')
   def context(kind,key,values):return json.dumps(values,ensure_ascii=False)
   chat=Mock(return_value={'応答内容':'青い鳥を確認'})
   ns=dict(Path=Path,sys=SimpleNamespace(argv=['test',str(input)]),json=json,setup_logging=Mock(),get_logger=Mock(return_value=Mock()),team_context=SimpleNamespace(差し込み=context),team_chat=SimpleNamespace(会話実行=chat),team_talk_db=Mock())
   functions('backend_taskteam/team_sub/sub_self_talk.py',{'依頼内容を作る','main'},ns)
   self.assertEqual(ns['main'](),0)
   args=chat.call_args.args;self.assertEqual(args[0],'CASPER');self.assertEqual(args[1],temp)
   prompt=json.loads(args[4]);self.assertEqual(prompt['チーム目標'],'青い鳥');self.assertEqual(prompt['プロジェクト'],temp);self.assertIn('他者',prompt['他者意見']);self.assertIn('前回',prompt['自身の前回発言欄'])
 def test_owned_preparation_process_is_stopped_but_completed_one_is_not(self):
  for alive in [True,False]:
   proc=Mock();proc.poll.return_value=None if alive else 0;proc.pid=123
   ns=dict(_依頼プロセス={'own':proc},_プロセス強制停止=Mock(),logging=SimpleNamespace(Logger=object))
   functions('backend_taskteam/team_proc/team_watcher.py',{'準備プロセス停止'},ns)
   ns['準備プロセス停止']('other',Mock());ns['_プロセス強制停止'].assert_not_called()
   ns['準備プロセス停止']('own',Mock());self.assertEqual(ns['_プロセス強制停止'].call_count,int(alive));self.assertEqual(proc.wait.call_count,int(alive))
if __name__=='__main__':unittest.main()

