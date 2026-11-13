# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""Actual MCP SDK + Tools registrations; only the paid model execution is synthetic."""
import asyncio
from contextlib import AsyncExitStack, asynccontextmanager
import json
import logging
from pathlib import Path
import socket
import sys
import types
from unittest.mock import patch

import httpx
import uvicorn
from fastapi import FastAPI
from mcp.server.mcpserver import MCPServer
from starlette.routing import Mount

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "backend_tools"))
# Import the production registrations without creating real service logs.
sys.modules["log_config"] = types.SimpleNamespace(get_logger=logging.getLogger)
from tools_proc import tools_agents, tools_chat, tools_decisions, conversation_history

# SDK契約試験は利用者のDBに書き込まず、履歴境界の呼出しだけ記録する。
history_records = []
def record_history(*args, **kwargs):
    history_records.append(kwargs)
conversation_history.write_history_message = record_history
from tools_proc.decisions_check import Decision
from tools_proc.live_model_check import LiveModelCheck, register_live_model_check


class Model:
    version_info = {"synthetic": {"ok": True, "version": "test"}}

    def get_description(self):
        return "Offline contract test"

    async def run_async(self, *args, **kwargs):
        prompt = args[0] if args else kwargs["prompt"]
        assert prompt in ("おはよう", "手動SDK入力")
        if args:
            assert args[6] is False and args[10] is False
        else:
            assert kwargs["resume"] is False
            if kwargs["ai_name"] == "codex_cli":
                assert kwargs["self_check_loop"] == 0
            else:
                assert kwargs["use_tools"] is False
        return {"status": "OK", "history_saved": True, "result": "おはようございます", "ai_model": "chat-test", "selected_model": "code-test", "ai_name": "freeai_chat"}


class Live:
    def __init__(self, **kwargs):
        assert kwargs["live_ai"] == "freeai" and kwargs["live_model"] == "live-test"
        assert kwargs["live_voice"] == "Zephyr" and kwargs["diagnostic"] is True
        self.live_session = None

    async def 開始(self, **kwargs):
        # Python のキーワード識別子は NFKC 正規化され、全角Ｑも ASCII Q になる。
        self.queue = kwargs["テキスト受信処理Q"]
        assert self.queue is kwargs["音声受信処理Q"]
        self.live_session = object()
        return True

    async def テキスト送信(self, text):
        assert text in ("おはよう", "手動SDK入力")
        await self.queue.put({"text": "おはようございます"})
        await self.queue.put({"bytes_data": b"\x00\x00"*24000, "mime_type": "audio/pcm;rate=24000"})
        await self.queue.put({"diagnostic_turn_complete": True})
        return True

    async def 終了(self):
        self.live_session = None


async def skip_sleep(seconds):
    assert seconds == 15


async def main():
    chat, code = MCPServer("aidiy_chat_llms"), MCPServer("aidiy_code_agents")
    tools_chat.register_tools(chat, Model())
    tools_agents.register_tools(code, Model())
    decision = MCPServer("aidiy_decisions_check")
    def judgment(req):
        assert req.url.host == "generativelanguage.googleapis.com"
        assert req.url.path.endswith("/gemini-3.5-flash-lite:generateContent")
        value = {"answers": [{"type": "choice", "name": "politeness", "choice": "medium", "confidence": 1,
            "probabilities": [{"value": "high", "probability": 0}, {"value": "medium", "probability": 1}, {"value": "low", "probability": 0}]}]}
        return httpx.Response(200, json={"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": json.dumps(value)}]}}]})
    service = Decision(config={"DECISION_AI_NAME": "freeai_chat", "freeai_key_id": "synthetic-only"}, transport=httpx.MockTransport(judgment))
    service.availability = {"freeai_chat": {"ok": True, "model": "gemini-3.5-flash-lite"}}
    tools_decisions.register_tools(decision, service)
    decision_app = decision.streamable_http_app()
    chat_app, code_app = chat.streamable_http_app(), code.streamable_http_app()

    @asynccontextmanager
    async def lifespan(app):
        async with AsyncExitStack() as stack:
            await stack.enter_async_context(chat.session_manager.run())
            await stack.enter_async_context(code.session_manager.run())
            await stack.enter_async_context(decision.session_manager.run())
            yield

    app = FastAPI(routes=[Mount("/aidiy_chat_llms", chat_app), Mount("/aidiy_code_agents", code_app), Mount("/aidiy_decisions_check", decision_app)], lifespan=lifespan)
    register_live_model_check(app, LiveModelCheck(factory=Live, sleep=skip_sleep))
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    server = uvicorn.Server(uvicorn.Config(app, log_level="critical", access_log=False))
    task = asyncio.create_task(server.serve(sockets=[sock]))
    while not server.started:
        if task.done():
            await task
        await asyncio.sleep(.01)
    print(json.dumps({"port": sock.getsockname()[1]}), flush=True)
    await task


if __name__ == "__main__":
    with patch("tools_proc.live_model_check.read_config", return_value={"LIVE_AI_NAME":"freeai_live", "LIVE_FREEAI_MODEL":"live-test", "LIVE_FREEAI_VOICE":"Zephyr", "freeai_key_id":"synthetic-only"}):
        asyncio.run(main())
