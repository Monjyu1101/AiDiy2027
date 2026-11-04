import datetime,json,re
from pathlib import Path
root=Path(__file__).resolve().parents[2]
log=root/'backend_tools/temp/logs/20261103.120000.mcp_main.log'
ids=[]
for line in log.read_text(encoding='utf-8').splitlines():
    m=re.search(r'^(\d\d:\d\d:\d\d).*codexセッションID保存: ([a-z0-9-]+)',line)
    if m and m[1]>='12:12:11':ids.append((m[1],m[2]))
rows=[]
for completed,sid in ids:
    files=list((Path.home()/'.codex/sessions/2026/11/03').glob('*'+sid+'*'))
    row={'completed':completed,'session_id':sid,'metadata_found':bool(files),'models':[],'model_responses':0,'raw_block_in_user_input':False}
    models=set();response_ids=set()
    if files:
        for line in files[0].read_text(encoding='utf-8').splitlines():
            try:d=json.loads(line)
            except ValueError:continue
            p=d.get('payload',{})
            if d.get('type')=='turn_context' and p.get('model'):models.add(p['model'])
            if d.get('type')=='token_usage_record' and p.get('response_id'):response_ids.add(p['response_id'])
            if d.get('type')=='response_item' and p.get('role')=='user':
                text='\n'.join(c.get('text','') for c in p.get('content',[]) if isinstance(c,dict))
                mark='## Dの実施明細原文（要約とは別の記録）'
                if mark in text:
                    row['raw_block_in_user_input']=True
                    raw=text.split(mark,1)[1].lstrip()
                    try:row['raw_details']=json.JSONDecoder().raw_decode(raw)[0]
                    except ValueError:row['raw_parse_error']=True
                    row['check_prompt']='C（評価）' in text or '評価' in text
    row['models']=sorted(models);row['model_responses']=len(response_ids);rows.append(row)
out={'observed':datetime.datetime.now().isoformat(),'user_cycle_starts':1,'cli_calls':len(rows),'model_responses':sum(r['model_responses'] for r in rows),'calls':rows}
(root/'_work_records/selftest-20261102/team-raw-ai-calls.json').write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(out,ensure_ascii=False))
