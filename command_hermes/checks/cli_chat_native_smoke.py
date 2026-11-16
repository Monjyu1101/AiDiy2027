"""Offline integration smoke test: real Hermes tool loop, deterministic CLI replies.
Run explicitly using the Hermes dependency environment. No live model is called.
"""
import os,sys,tempfile,json,shlex
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
home=tempfile.TemporaryDirectory(); os.environ.update(HOME=home.name,HERMES_HOME=home.name+'/hermes',USERPROFILE=home.name,HERMES_NO_BROWSER='1')
root=Path(__file__).resolve().parents[1]; sys.path.insert(0,str(root))
import cli_main
from hermes_cli import aidiy_cli_bridge as bridge
fixture=Path(home.name)/'today.txt'; fixture.write_text('今日の変更: CLI chat engine を実装')
stat_code = 'from pathlib import Path; from datetime import datetime; p=Path(' + repr(str(fixture)) + '); print(datetime.fromtimestamp(p.stat().st_mtime).isoformat()); print(p.read_text())'
stat_command = shlex.quote(sys.executable) + ' -c ' + shlex.quote(stat_code)
cli=SimpleNamespace(_aidiy_provider_slug='copilot-cli',model='same',_is_session_yolo_active=lambda:False)
# Block network globally: the test must exercise only the native loop and local tools.
import httpx
calls=[]
def fake(*args, **kwargs):
    calls.append(kwargs)
    messages=kwargs['messages']
    results=[m for m in messages if m.get('role')=='tool']
    if results:
        assert 'CLI chat engine' in str(results), results
        return {'role':'assistant','content':'今日の作業はCLI chat engineの実装です。'}
    if 'おはよう' in str(messages):
        return {'role':'assistant','content':'おはようございます。'}
    return {'role':'assistant','content':None,'tool_calls':[{'id':'read-1','type':'function','function':{'name':'terminal','arguments':json.dumps({'command':stat_command})}}]}
with patch.object(httpx.Client,'send',side_effect=AssertionError('unexpected network')), patch.object(bridge,'run_cli',side_effect=fake):
    agent=cli_main.AIAgent(model='same',provider='custom',requested_provider='custom',api_key='no-api',base_url='aidiy-cli://engine',api_mode='chat_completions',enabled_toolsets=['file', 'terminal'],max_iterations=3,quiet_mode=True,skip_context_files=True,skip_memory=True,ephemeral_system_prompt='Knowledge: AiDiy uses Japanese. Skills: inspect files before reporting.')
    bridge.install_chat_engine(agent,cli,root.parent)
    greeting=agent.run_conversation('おはよう')
    assert greeting['completed'] and greeting['final_response']=='おはようございます。'
    report=agent.run_conversation('今日更新したファイルを読んで作業報告してください')
    assert report['completed'] and report['api_calls']==2
    assert 'CLI chat engine' in report['final_response']
    assert len(calls)>=3
    assert any('Knowledge: AiDiy' in str(x['messages']) for x in calls)
    assert any(x.get('tools') for x in calls)
    agent.close()
print('NATIVE LOOP OK',len(calls))
