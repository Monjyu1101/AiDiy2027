# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
"""step-9用の観測入口。製品のrunとCLIを使い、本文・認証・環境値はログに出さない。"""
import asyncio
import contextlib
from datetime import datetime, timezone
import importlib.util
import json
import os
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / 'backend_tools'), str(ROOT / 'backend_server')]
TRACE = Path(os.environ['AIDIY_NAV_AUDIT_LOG'])

def event(kind, **data):
    with TRACE.open('a', encoding='utf-8') as stream:
        stream.write(json.dumps({'at': datetime.now(timezone.utc).isoformat(), 'kind': kind, **data}, ensure_ascii=False)+'\n')

async def observed(request):
    from tools_proc.code_agents import CodeAgents
    from AIコア.AIコード_cli import CodeAI
    from AIコア import AIコードモデル選択 as models
    entry = ROOT / 'frontend_ide/ファイル機能/navigation_readonly.py'
    spec = importlib.util.spec_from_file_location('step9_navigation_readonly', entry)
    navigation = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(navigation)
    event('navigation-readonly-imported')
    original_select = models.select_model
    async def select(*args, **kwargs):
        event('auto-model-selection-start')
        value = await original_select(*args, **kwargs)
        event('auto-model-selection-return', selected=bool(value))
        return value
    models.select_model = select
    original_spawn = asyncio.create_subprocess_exec
    exits = []
    async def spawn(*args, **kwargs):
        role = 'hermes-readonly-cli' if any(str(arg).endswith('prediction_main.py') for arg in args) else 'other-owned-child'
        event('cli-spawn-start', role=role)
        child = await original_spawn(*args, **kwargs)
        event('cli-spawned', role=role, pid=child.pid)
        async def wait():
            code = await child.wait()
            event('cli-exit', role=role, pid=child.pid, code=code)
        exits.append(asyncio.create_task(wait()))
        return child
    asyncio.create_subprocess_exec = spawn
    original_subprocess = CodeAI._subprocess実行
    async def subprocess_run(self, *args, **kwargs):
        event('cli-stream-start', idleTimeoutSec=kwargs.get('timeout'))
        value = await original_subprocess(self, *args, **kwargs)
        event('cli-stream-return', hasResult=bool(value), errorMarker=value.startswith('!'), timeoutMarker='処理タイムアウト' in value)
        return value
    CodeAI._subprocess実行 = subprocess_run
    class ObservedCode(CodeAgents):
        async def run_async(self, **kwargs):
            event('codeagents-start', provider=kwargs.get('ai_name'), model=kwargs.get('ai_model'), timeoutSec=kwargs.get('timeout_sec'), readonly=bool(kwargs.get('実行オプション').CLI読取専用))
            response = await super().run_async(**kwargs)
            event('codeagents-return', status=response.get('status'), resultLength=len(response.get('result') or ''), selectedModel=response.get('selected_model'))
            return response
    try:
        value = await navigation.run(request, code=ObservedCode(str(ROOT)))
        event('navigation-readonly-return', contentLength=len(value['content']))
        return value
    finally:
        if exits:
            await asyncio.gather(*exits)

if __name__ == '__main__':
    started = time.monotonic()
    event('python-entry', pid=os.getpid())
    try:
        request = json.loads(sys.stdin.buffer.read(1048577).decode('utf-8'))
        with contextlib.redirect_stdout(sys.stderr):
            from tools_proc.prediction_privacy import prediction_private_logs
            with prediction_private_logs():
                answer = asyncio.run(observed(request))
        print(json.dumps(answer, ensure_ascii=False))
        event('python-success', elapsedSec=round(time.monotonic()-started,3))
    except Exception as exc:
        event('python-error', exceptionType=type(exc).__name__, elapsedSec=round(time.monotonic()-started,3))
        print(json.dumps({'error':'step-9の読取専用AI呼出しで失敗しました。詳細な本文・設定値は非記録。'},ensure_ascii=False))
        sys.exit(1)
