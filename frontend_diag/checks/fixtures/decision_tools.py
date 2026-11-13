# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""DECISIONだけを実MCPで公開。外部HTTPは公式契約に基づく合成応答。"""
import asyncio
from contextlib import asynccontextmanager
import json
import logging
from pathlib import Path
import socket
import sys
import types
import httpx
import uvicorn
from fastapi import FastAPI
from mcp.server.mcpserver import MCPServer
from starlette.routing import Mount

sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'backend_tools'))
sys.modules['log_config'] = types.SimpleNamespace(get_logger=logging.getLogger)
from tools_proc import tools_decisions
from tools_proc.decisions_check import Decision

# Contract source (2026-10-23):
# https://developers.openai.com/api/reference/resources/decisions/methods/create
# A real Decisions response has top-level model, answers, usage. Refusal has no text field.
def respond(request):
    assert str(request.url) == 'https://api.openai.com/v1/decisions'
    assert request.headers['authorization'] == 'Bearer synthetic-only'
    payload = json.loads(request.content)
    assert set(payload) == {'model', 'input', 'questions'}
    assert payload['model'] == 'gpt-6-luna'
    question = payload['questions'][0]
    assert question['type'] == 'choice' and question['name'] == 'politeness'
    assert [row['value'] for row in question['choices']] == ['high', 'medium', 'low']
    if payload['input'] == 'http-error':
        return httpx.Response(400, json={'error': {'message': 'synthetic-secret-not-for-display'}})
    answer = {'type': 'choice', 'name': 'politeness', 'choice': 'medium', 'confidence': .8,
              'probabilities': [{'value': 'high', 'probability': .1}, {'value': 'medium', 'probability': .8}, {'value': 'low', 'probability': .1}]}
    if payload['input'] == 'refusal':
        answer = {'type': 'refusal', 'name': 'politeness'}
    if payload['input'] == 'malformed':
        answer.pop('probabilities')
    return httpx.Response(200, json={'model': 'gpt-6-luna', 'answers': [answer],
        'usage': {'input_tokens': 20, 'input_tokens_details': {'cached_tokens': 0, 'cache_write_tokens': 0},
                  'output_tokens': 5, 'output_tokens_details': {'reasoning_tokens': 0}, 'total_tokens': 25}})

async def main():
    mcp = MCPServer('aidiy_decisions_check')
    decision = Decision(config={'openai_key_id': 'synthetic-only'}, transport=httpx.MockTransport(respond))
    decision.availability = {'openai_decisions': {'ok': True, 'model': 'gpt-6-luna'}}
    tools_decisions.register_tools(mcp, decision)
    child = mcp.streamable_http_app()
    @asynccontextmanager
    async def lifespan(app):
        async with mcp.session_manager.run():
            yield
    app = FastAPI(routes=[Mount('/aidiy_decisions_check', child)], lifespan=lifespan)
    sock = socket.socket()
    sock.bind(('127.0.0.1', 0))
    server = uvicorn.Server(uvicorn.Config(app, log_level='critical', access_log=False))
    task = asyncio.create_task(server.serve(sockets=[sock]))
    while not server.started:
        if task.done():
            await task
        await asyncio.sleep(.01)
    print(json.dumps({'port': sock.getsockname()[1]}), flush=True)
    await task

if __name__ == '__main__':
    asyncio.run(main())
