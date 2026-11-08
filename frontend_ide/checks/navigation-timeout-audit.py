# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
"""step-9: 実AIなし。製品のCLI監視・所有プロセス終了を短い待機時間で観測。"""
import asyncio
import contextlib
from datetime import datetime,timezone
import json
from pathlib import Path
import sys
import tempfile
import time
import psutil

ROOT=Path(__file__).resolve().parents[2]
sys.path[:0]=[str(ROOT/'backend_tools'),str(ROOT/'backend_server')]

async def main():
    from AIコア.AIコード_cli import CodeAI
    from AIコア.AI実行オプション import AI実行オプション
    folder=tempfile.mkdtemp(prefix='aidiy-nav-timeout-audit-')
    original=asyncio.create_subprocess_exec
    records=[]
    for name,program,timeout in [
        ('silent-timeout','import time;time.sleep(20)',0.2),
        ('continuous-output','import time\nfor i in range(16):\n print("fixture-progress",flush=True);time.sleep(.15)',0.6),
    ]:
        owned=set()
        async def spawn(*args,**kwargs):
            child=await original(*args,**kwargs);owned.add(child.pid)
            await asyncio.sleep(.1)
            try: owned.update(p.pid for p in psutil.Process(child.pid).children(recursive=True))
            except psutil.NoSuchProcess: pass
            return child
        asyncio.create_subprocess_exec=spawn
        ai=CodeAI(AI_NAME='aidiy_hermes',AI_MODEL='same',絶対パス=folder,実行オプション=AI実行オプション.読取専用予測())
        started=time.monotonic()
        result=await ai._subprocess実行([sys.executable,'-u','-c',program],folder,timeout)
        elapsed=time.monotonic()-started
        await ai.終了()
        await asyncio.sleep(.2)
        alive=[pid for pid in owned if psutil.pid_exists(pid)]
        is_timeout='処理タイムアウト' in result
        assert not alive and ai.current_process is None
        assert is_timeout if name=='silent-timeout' else (not is_timeout and elapsed>timeout*2)
        records.append({'case':name,'timeoutSec':timeout,'elapsedSec':round(elapsed,3),'timeoutResult':is_timeout,'ownedPids':sorted(owned),'ownedProcessesAliveAfter':alive,'currentProcessCleared':ai.current_process is None,'externalAIRequests':0})
    asyncio.create_subprocess_exec=original
    return {'at':datetime.now(timezone.utc).isoformat(),'scope':'280秒は変更せず、同じ製品メソッドに短い試験値を渡した隔離検証。過去失敗の再現ではない。','cases':records}

if __name__=='__main__':
    from tools_proc.prediction_privacy import prediction_private_logs
    with contextlib.redirect_stdout(sys.stderr),prediction_private_logs():
        result=asyncio.run(main())
    path=Path(sys.argv[1]);path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(result,ensure_ascii=False))
