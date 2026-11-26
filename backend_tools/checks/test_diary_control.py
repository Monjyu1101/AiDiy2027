# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE for full terms.
"""日誌MCPとRESTの認証ヘッダー・固定接続先を検証。実日誌・外部通信を使わない。"""
import json
import unittest
from unittest.mock import patch

import httpx
from fastapi import FastAPI
from mcp.server.mcpserver import MCPServer
from mcp.server.streamable_http_manager import StreamableHTTPASGIApp

from tools_proc import tools_diary_control as diary


class DiaryControlTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.calls = []
        self.upstream_status = 200
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
                self.assertEqual(json.loads(self.calls[0].content), request)
                self.upstream_status = 302
                self.assertEqual((await client.post(path, json=request, headers=auth)).status_code, 503)
                self.assertEqual(len(self.calls), 2)

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
                        "params": {"name": "diary_search", "arguments": {}},
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
                    "params": {"name": "diary_content_create", "arguments": {"日誌日付": "2026-11-26", "作業ID": 1, "添付": 添付}},
                }, headers={**headers, **auth})
                self.assertFalse(result.json()["result"].get("isError", False), result.text)
                self.assertEqual(json.loads(self.calls[-1].content)["添付"], 添付)

                create = {"日誌日付": "2026-11-26", "作業タイトル": "作業", "プロジェクト": r"C:\作業場所\工程", "新規更新ファイル数": 0}
                for i, (name, arguments) in enumerate([
                    ("diary_work_create", create),
                    ("diary_work_update", {"日誌日付": create["日誌日付"], "作業ID": 1, "作業タイトル": "別名"}),
                    ("diary_work_update", {"日誌日付": create["日誌日付"], "作業ID": 1, "作業タイトル": "別名", "プロジェクト": ""}),
                ], 8):
                    result = await client.post("/mcp", json={"jsonrpc": "2.0", "id": i, "method": "tools/call",
                        "params": {"name": name, "arguments": arguments},
                    }, headers={**headers, **auth})
                    self.assertFalse(result.json()["result"].get("isError", False), result.text)
                    self.assertEqual(json.loads(self.calls[-1].content), arguments)
