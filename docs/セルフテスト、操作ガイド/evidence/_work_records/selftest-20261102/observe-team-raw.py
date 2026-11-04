import datetime,json,sqlite3
from pathlib import Path
root=Path(__file__).resolve().parents[2]
project=(root/'temp/selftest-finite-20261103/team').as_posix()
c=sqlite3.connect('file:'+str(root/'_data/AiDiy/database.db')+'?mode=ro',uri=True);c.row_factory=sqlite3.Row
out={'observed':datetime.datetime.now().isoformat()}
out['work']=[dict(r) for r in c.execute('select * from Aチーム作業 where プロジェクト=? order by 作業ID',[project])]
out['goal']=dict(c.execute('select * from Aチーム目標 where CODE_BASE_PATH=?',[project]).fetchone())
out['details']=[dict(r) for r in c.execute("select d.* from Aタスク明細 d join Aチーム依頼 r on r.タスクID=d.タスクID join Aチーム作業 w on w.依頼ID=r.依頼ID and w.プロジェクト=r.プロジェクト where w.プロジェクト=? order by d.タスクID,d.明細SEQ",[project])]
c.close()
with (root/'_work_records/selftest-20261102/team-raw-observations.jsonl').open('a',encoding='utf-8') as f:f.write(json.dumps(out,ensure_ascii=False)+'\n')
print(json.dumps({'observed':out['observed'],'loop':out['goal']['作業ループ'],'work':[{k:r[k] for k in ['作業ID','PDCA区分','状況','開始日時','終了日時']} for r in out['work']],'details':[{k:r[k] for k in ['タスクID','明細SEQ','タイプ','状態']} for r in out['details']]},ensure_ascii=False))
