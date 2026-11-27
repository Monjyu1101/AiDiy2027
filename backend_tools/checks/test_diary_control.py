# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE for full terms.
"""日誌の REST / HTTP / SSE を検証。実日誌・外部通信を使わない。"""
import asyncio
import json
import socket
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch

import httpx
import httpx2
import uvicorn
from fastapi import FastAPI
from mcp import ClientSession
from mcp.client.sse import sse_client
from mcp.server.mcpserver import MCPServer
from mcp.server.streamable_http_manager import StreamableHTTPASGIApp

from tools_proc import tools_diary_control as diary


class DiaryControlTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.calls = []
        self.upstream_status = 200
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        isolated_token = patch.object(diary, "_TOKEN_FILE", Path(temporary.name) / "internal_auth.json")
        isolated_token.start()
        self.addCleanup(isolated_token.stop)
        client_class = httpx.AsyncClient

        def client(**kwargs):
            self.assertFalse(kwargs["trust_env"])
            self.assertFalse(kwargs["follow_redirects"])
            return client_class(transport=httpx.MockTransport(self.apps), **kwargs)

        self.factory = client
        self.app = FastAPI()
        self.app.include_router(diary.create_router())

    def apps(self, request):
        self.calls.append(request)
        self.assertEqual(request.url.host, "127.0.0.1")
        self.assertEqual(request.url.port, 8098)
        self.assertTrue(request.url.path.startswith("/apps/T日誌/"))
        if self.upstream_status is None:
            raise httpx.ConnectError("fixture", request=request)
        if self.upstream_status == 302:
            return httpx.Response(302, headers={"Location": "https://fixture.invalid/"})
        return httpx.Response(self.upstream_status, json={"status": "OK", "data": {"path": request.url.path}})

    async def test_rest_bearer_only(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app), base_url="http://test") as client:
            with patch.object(diary.httpx, "AsyncClient", side_effect=self.factory):
                path = f"/{diary.NAME}/diary_work_create"
                request = {"日誌日付": "2026-11-26", "作業タイトル": "作業"}
                response = await client.post(path, json=request)
                self.assertEqual(response.status_code, 401)
                response = await client.post(path, json=request, headers=[
                    ("Authorization", "Bearer aaa.bbb.ccc"), ("Authorization", "Bearer ddd.eee.fff"),
                ])
                self.assertEqual(response.status_code, 401)
                self.assertEqual(self.calls, [])
                auth = {"Authorization": "Bearer aaa.bbb.ccc"}
                self.assertEqual((await client.post(path, json=request, headers=auth)).status_code, 200)
                self.assertEqual(self.calls[0].headers["authorization"], auth["Authorization"])
                self.assertEqual(json.loads(self.calls[0].content), {**request, "利用者ID": "admin"})
                self.upstream_status = 302
                self.assertEqual((await client.post(path, json=request, headers=auth)).status_code, 503)
                self.assertEqual(len(self.calls), 2)

    async def test_missing_credential_apps_rejection_and_connection_failure_are_distinct(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app), base_url="http://test") as client:
            with patch.object(diary.httpx, "AsyncClient", side_effect=self.factory):
                path = f"/{diary.NAME}/diary_search"
                response = await client.post(path, json={})
                self.assertEqual((response.status_code, response.json()["error"]["code"]), (401, "AUTH_REQUIRED"))
                self.assertEqual(self.calls, [])
                headers = {"Authorization": "Bearer aaa.bbb.ccc"}
                for attempt, (upstream, expected) in enumerate([
                    (401, (401, "APPS_AUTH_REJECTED")),
                    (403, (403, "APPS_AUTH_REJECTED")),
                    (None, (503, "APPS_UNAVAILABLE")),
                ], 1):
                    self.upstream_status = upstream
                    response = await client.post(path, json={"利用者ID": "other"}, headers=headers)
                    self.assertEqual((response.status_code, response.json()["error"]["code"]), expected)
                    self.assertEqual(len(self.calls), attempt)
                    self.assertEqual(self.calls[-1].headers["authorization"], headers["Authorization"])
                    self.assertNotIn("aaa.bbb.ccc", response.text)

    async def test_loopback_sse_lists_tools_without_auth_but_calls_need_bearer(self):
        mcp = MCPServer(diary.NAME)
        diary.register_tools(mcp)
        self.app.mount(f"/{diary.NAME}", mcp.sse_app(sse_path="/sse", message_path="/messages/", host="127.0.0.1"))
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
            server = uvicorn.Server(uvicorn.Config(self.app, log_config=None, access_log=False))
            serving = asyncio.create_task(server.serve(sockets=[sock]))
            try:
                async with asyncio.timeout(10):
                    while not server.started:
                        if serving.done():
                            await serving
                            self.fail("SSE test server exited early")
                        await asyncio.sleep(0.01)
                    with tempfile.TemporaryDirectory() as temporary, patch.object(diary.httpx, "AsyncClient", side_effect=self.factory):
                        file = Path(temporary) / "internal_auth.json"
                        file.write_text('{"access_token":"internal.fixture.token"}', encoding="utf-8")
                        file_patch = patch.object(diary, "_TOKEN_FILE", file)
                        self.addCleanup(file_patch.stop)
                        file_patch.start()
                        url = f"http://127.0.0.1:{port}/{diary.NAME}/sse"
                        def local_client(**kwargs):
                            return httpx2.AsyncClient(trust_env=False, follow_redirects=False, **kwargs)

                        for token in (None, "Bearer aaa.bbb.ccc"):
                            headers = {"Authorization": token} if token else {}
                            async with sse_client(url, headers=headers, httpx_client_factory=local_client) as (read, write):
                                async with ClientSession(read, write) as client:
                                    await client.initialize()
                                    tools = await client.list_tools()
                                    self.assertEqual({tool.name for tool in tools.tools}, set(diary._OPERATIONS))
                                    result = await client.call_tool("diary_search", {"利用者ID": "other"})
                                    response = result.structured_content or json.loads(result.content[0].text)
                                    self.assertEqual(response["status"], "OK")
                                    if not token:
                                        await client.call_tool("diary_work_create", {"日誌日付": "2026-11-26", "作業タイトル": "既定"})
                        self.assertEqual([r.headers["authorization"] for r in self.calls],
                                         ["Bearer internal.fixture.token", "Bearer internal.fixture.token", "Bearer aaa.bbb.ccc"])
                        self.assertEqual(json.loads(self.calls[1].content)["利用者ID"], "admin")
                        self.assertEqual(self.calls[0].headers["x-aidiy-diary"], "tools")
                        self.assertNotIn("x-aidiy-diary", self.calls[-1].headers)
            finally:
                server.should_exit = True
                await asyncio.wait_for(serving, timeout=5)

    async def test_internal_credential_not_used_for_proxy_browser_or_invalid_explicit_auth(self):
        transport = httpx.ASGITransport(app=self.app, client=("127.0.0.1", 1234))
        async with httpx.AsyncClient(transport=transport, base_url="http://127.0.0.1:8095") as client:
            with patch.object(diary, "_内部Bearer", return_value="") as token:
                path = f"/{diary.NAME}/diary_search"
                for headers in ({"Origin": "https://fixture.invalid"}, {"X-Forwarded-For": "127.0.0.1"},
                                {"Sec-Fetch-Site": "same-origin"}, {"Authorization": "Bearer invalid"}):
                    denied = await client.post(path, json={"利用者ID": "other"}, headers=headers)
                    self.assertEqual(denied.status_code, 401)
                self.assertEqual((await client.post(path, json={})).json()["error"]["code"], "USER_ID_REQUIRED")
                token.assert_not_called()
                self.assertEqual((await client.post(path, json={"利用者ID": "other"})).json()["error"]["code"],
                                 "INTERNAL_AUTH_UNAVAILABLE")
                token.assert_called_once()
                self.assertEqual(self.calls, [])

    async def test_streamable_http_schema_and_per_request_bearer(self):
        server = MCPServer(diary.NAME)
        diary.register_tools(server)
        server.streamable_http_app(streamable_http_path="/mcp", json_response=True, host="127.0.0.1")
        manager = server.session_manager
        transport = httpx.ASGITransport(app=StreamableHTTPASGIApp(manager))
        async with manager.run(), httpx.AsyncClient(transport=transport, base_url="http://127.0.0.1:8095") as client:
            with patch.object(diary.httpx, "AsyncClient", side_effect=self.factory):
                headers = {"Accept": "application/json, text/event-stream"}
                initialized = await client.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
                    "protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "fixture", "version": "1"},
                }}, headers=headers)
                self.assertEqual(initialized.status_code, 200, initialized.text)
                headers["Mcp-Session-Id"] = initialized.headers["mcp-session-id"]
                headers["MCP-Protocol-Version"] = initialized.json()["result"]["protocolVersion"]
                await client.post("/mcp", json={"jsonrpc": "2.0", "method": "notifications/initialized"}, headers=headers)
                result = await client.post("/mcp", json={"jsonrpc": "2.0", "id": 2, "method": "tools/list"}, headers=headers)
                tools = result.json()["result"]["tools"]
                self.assertEqual({tool["name"] for tool in tools}, set(diary._OPERATIONS))
                for tool in tools:
                    self.assertNotIn("ctx", tool["inputSchema"]["properties"])
                    self.assertNotIn("Authorization", tool["inputSchema"]["properties"])
                for i, token in enumerate([None, "aaa.bbb.ccc", "ddd.eee.fff", None], 3):
                    auth = {"Authorization": f"Bearer {token}"} if token else {}
                    result = await client.post("/mcp", json={"jsonrpc": "2.0", "id": i, "method": "tools/call",
                        "params": {"name": "diary_search", "arguments": {"利用者ID": "other"}},
                    }, headers={**headers, **auth})
                    self.assertEqual(result.status_code, 200, result.text)
                    wire = result.json()["result"]
                    self.assertFalse(wire.get("isError", False), wire)
                    content = wire.get("structuredContent") or json.loads(wire["content"][0]["text"])
                    self.assertEqual(content["status"], "OK" if token else "NG")
                self.assertEqual([r.headers["authorization"] for r in self.calls], ["Bearer aaa.bbb.ccc", "Bearer ddd.eee.fff"])
                auth = {"Authorization": "Bearer aaa.bbb.ccc"}
                添付 = [{"ファイル名": "a.txt", "base64内容": "YQ=="}, {"ファイル名": "b.txt", "base64内容": "Yg=="}]
                result = await client.post("/mcp", json={"jsonrpc": "2.0", "id": 7, "method": "tools/call",
                    "params": {"name": "diary_content_create", "arguments": {"日誌日付": "2026-11-26", "作業ID": 1, "添付": 添付, "利用者ID": "other"}},
                }, headers={**headers, **auth})
                self.assertFalse(result.json()["result"].get("isError", False), result.text)
                self.assertEqual(json.loads(self.calls[-1].content)["添付"], 添付)

                create = {"利用者ID": "other", "日誌日付": "2026-11-26", "作業タイトル": "作業", "プロジェクト": r"C:\作業場所\工程", "作業時間": 7.75, "新規更新ファイル数": 0}
                for i, (name, arguments) in enumerate([
                    ("diary_work_create", create),
                    ("diary_work_update", {"利用者ID": "other", "日誌日付": create["日誌日付"], "作業ID": 1, "作業タイトル": "別名"}),
                    ("diary_work_update", {"利用者ID": "other", "日誌日付": create["日誌日付"], "作業ID": 1, "作業タイトル": "別名", "プロジェクト": ""}),
                ], 8):
                    result = await client.post("/mcp", json={"jsonrpc": "2.0", "id": i, "method": "tools/call",
                        "params": {"name": name, "arguments": arguments},
                    }, headers={**headers, **auth})
                    self.assertFalse(result.json()["result"].get("isError", False), result.text)
                    self.assertEqual(json.loads(self.calls[-1].content), arguments)
                update = {"利用者ID": "other", "日誌日付": create["日誌日付"], "作業ID": 1, "作業タイトル": "別名"}
                result = await client.post("/mcp", json={"jsonrpc": "2.0", "id": 11, "method": "tools/call",
                    "params": {"name": "diary_work_update", "arguments": {**update, "作業時間を解除": True}},
                }, headers={**headers, **auth})
                self.assertFalse(result.json()["result"].get("isError", False), result.text)
                self.assertEqual(json.loads(self.calls[-1].content), {**update, "作業時間": None})
