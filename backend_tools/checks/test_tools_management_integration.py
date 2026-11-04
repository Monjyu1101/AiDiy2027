# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
"""実管理認証・REST・MCPの結合回帰。socket/実AI/既存設定は使用しない。"""
import ast
import json
import os
import sys
from functools import wraps
from collections.abc import AsyncIterator
from contextlib import AsyncExitStack, asynccontextmanager
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock, patch

import httpx
from fastapi import FastAPI
from mcp.server.mcpserver import MCPServer
from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
import test_tools_settings_integration as media_fixture
from tools_proc import tools_management, tools_media, tools_settings


def running(function):
    @wraps(function)
    async def run(self):
        async with self.runtime():
            await function(self)
    return run


class ManagementIntegrationTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.fixture = media_fixture.IntegrationTests(methodName='runTest')
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.path = self.fixture.path
        self.path.parent.mkdir()
        (self.path.parent / 'AiDiy_key.json').write_text('{"PORT_CORE":8091}', encoding='utf-8')
        self.manager = tools_management.ToolsManagement(self.path)
        names = ('text_to_speech', 'speech_to_text', 'image_generation', 'movie_generation')
        self.manager.availability = {'aidiy_' + name: lambda: True for name in names}
        source = Path(__file__).resolve().parents[1] / 'tools_main.py'
        functions = [node for node in ast.parse(source.read_text(encoding='utf-8')).body
                     if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
                     and node.name in {'_make_mcp', '_ensure_session_manager', '_mcp_lifespan'}]
        self.assertEqual(len(functions), 3)
        env = dict(asynccontextmanager=asynccontextmanager, AsyncIterator=AsyncIterator,
                   AsyncExitStack=AsyncExitStack, FastAPI=FastAPI, MCPServer=MCPServer,
                   StreamableHTTPSessionManager=StreamableHTTPSessionManager,
                   tools_management=self.manager, MCP_MAP={},
                   tools_decisions=SimpleNamespace(check_startup=AsyncMock(), register_tools=Mock()),
                   decisions=object(), mcp_dj=object(), logger=Mock(),
                   load_tools_settings=lambda: tools_settings.load_tools_settings(self.path),
                   ig=self.fixture.ig, mg=self.fixture.mg, stt=self.fixture.stt, tts=self.fixture.tts)
        exec(compile(ast.Module(body=functions, type_ignores=[]), str(source), 'exec'), env)
        self.make_mcp = env['_make_mcp']
        self.servers = env['MCP_MAP']
        registrations = [('text_to_speech', tools_media.register_tts_tools, self.fixture.tts),
                         ('speech_to_text', tools_media.register_stt_tools, self.fixture.stt),
                         ('image_generation', tools_media.register_image_gen_tools, self.fixture.ig),
                         ('movie_generation', tools_media.register_movie_gen_tools, self.fixture.mg)]
        for name, register, service in registrations:
            server = env['_make_mcp']('aidiy_' + name)
            register(server, service)
            self.servers[name] = server
        self.app = FastAPI(lifespan=env['_mcp_lifespan'])
        self.app.include_router(tools_media.create_router(self.fixture.ig, self.fixture.mg,
                                                        self.fixture.stt, self.fixture.tts))
        tools_management.register_management(self.app, self.manager)
        self.app.add_middleware(tools_management.ToolsGateMiddleware, manager=self.manager)
        self.auth_calls = []
        self.auth_status = 200
        self.auth_body = {'status': 'OK', 'data': {'private_fixture': 'not-for-response'}}
        self.client_class = httpx.AsyncClient

    @asynccontextmanager
    async def runtime(self):
        # anyioのsession managerは入場/終了を同じtaskで行う。
        async with AsyncExitStack() as stack:
            self.client = await stack.enter_async_context(self.client_class(
                transport=httpx.ASGITransport(app=self.app), base_url='http://tools.test'))
            await stack.enter_async_context(self.app.router.lifespan_context(self.app))
            stack.enter_context(patch.object(tools_management, 'CONFIG_PATH', self.path))
            stack.enter_context(patch.object(tools_management.httpx, 'AsyncClient', self.auth_client))
            yield

    def auth_client(self, **kwargs):
        self.assertFalse(kwargs['trust_env'])
        self.assertFalse(kwargs['follow_redirects'])
        self.assertEqual(kwargs['timeout'], 5)
        def respond(request):
            self.auth_calls.append(request)
            self.assertEqual(str(request.url), 'http://127.0.0.1:8091/core/auth/%E7%8F%BE%E5%9C%A8%E5%88%A9%E7%94%A8%E8%80%85')
            self.assertEqual(request.headers['authorization'], 'Bearer fixture-token')
            self.assertEqual(json.loads(request.content), {})
            return httpx.Response(self.auth_status, json=self.auth_body)
        return self.client_class(transport=httpx.MockTransport(respond), **kwargs)

    async def manage(self, action='enabled', body=None, **kwargs):
        return await self.client.post('/management/' + action, json={} if body is None else body,
                                      headers={'authorization': 'Bearer fixture-token', **kwargs})

    async def speech(self):
        return await self.client.post('/aidiy_text_to_speech/synthesize', json={
            'speech_text': 'synthetic', 'provider': 'auto', 'voice': 'auto',
            'save_path': str(self.fixture.root / 'speech.mp3')})

    @running
    async def test_core_auth_every_read_write_and_failure_cannot_mutate(self):
        for status, payload, expected in [(401, {}, 401), (403, {}, 401),
                                          (500, {}, 403), (200, {'status': 'NG'}, 403)]:
            with self.subTest(status=status, payload=payload):
                self.auth_status, self.auth_body = status, payload
                response = await self.manage(body={'enabled': {'aidiy_text_to_speech': False}, 'write': True})
                self.assertEqual(response.status_code, expected)
                self.assertTrue(self.manager.active('aidiy_text_to_speech'))
                self.assertNotIn('enabled', json.loads(self.path.read_text()))
        self.auth_status, self.auth_body = 200, {'status': 'OK'}
        self.assertEqual((await self.manage()).status_code, 200)
        self.assertEqual(len(self.auth_calls), 5)
        denied = await self.client.post('/management/defaults', json={})
        self.assertEqual(denied.status_code, 401)
        self.assertEqual(len(self.auth_calls), 5)

    @running
    async def test_same_origin_and_fetch_metadata_guard_before_any_mutation(self):
        before = self.path.read_bytes()
        for headers in [{'origin': 'https://evil.invalid'}, {'sec-fetch-site': 'cross-site'},
                        {'origin': 'null'}, {'origin': 'http://['}]:
            with self.subTest(headers=headers):
                response = await self.manage(body={'enabled': {'aidiy_text_to_speech': False}, 'write': True}, **headers)
                self.assertEqual(response.status_code, 403)
        self.assertEqual(self.path.read_bytes(), before)
        response = await self.manage(origin='http://tools.test')
        self.assertEqual(response.status_code, 200)
        self.assertNotIn('private_fixture', response.text)

    @running
    async def test_disabled_and_unavailable_gate_real_rest_and_mcp_without_removing_schema(self):
        server = self.servers['text_to_speech']
        before = [tool.model_dump() for tool in await server.list_tools()]
        for enabled, available in [(False, True), (True, False)]:
            with self.subTest(enabled=enabled, available=available):
                self.manager.enabled['aidiy_text_to_speech'] = enabled
                self.manager.availability['aidiy_text_to_speech'] = lambda: available
                response = await self.speech()
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()['service_status'], 'out_of_service')
                result = await server.call_tool('synthesize_speech', {'speech_text': 'synthetic'})
                self.assertFalse(result.is_error)
                self.assertIn('out_of_service', str(result.content))
                self.assertEqual([tool.model_dump() for tool in await server.list_tools()], before)
                self.fixture.synth.assert_not_called()
        self.manager.availability['aidiy_text_to_speech'] = lambda: True
        self.assertEqual((await self.speech()).json()['used_provider'], 'edge')
        self.fixture.synth.assert_called_once()

    @running
    async def test_management_auto_changes_reach_real_media_and_only_write_true_persists(self):
        before = self.path.read_bytes()
        patch_body = {'defaults': {'text_to_speech': {'auto_provider': 'openai', 'auto_voice': 'male'}}, 'write': False}
        response = await self.manage('defaults', patch_body)
        self.assertFalse(response.json()['data']['saved'])
        self.assertEqual(self.path.read_bytes(), before)
        self.assertEqual((await self.speech()).json()['used_provider'], 'openai')
        self.assertEqual(self.fixture.synth.call_args.args[2], self.fixture.tts._resolve_voice('male', 'openai', 'ja'))
        response = await self.manage('defaults', {**patch_body, 'write': True})
        self.assertTrue(response.json()['data']['saved'])
        await self.manage(body={'enabled': {'aidiy_text_to_speech': False}, 'write': True})
        reloaded = tools_management.ToolsManagement(self.path)
        reloaded.availability = dict(self.manager.availability)
        reloaded.initialize({'text_to_speech': SimpleNamespace()})
        self.assertEqual(reloaded.defaults['text_to_speech']['auto_provider'], 'openai')
        self.assertFalse(reloaded.active('aidiy_text_to_speech'))

    @running
    async def test_obs_started_after_tools_is_not_blocked_by_old_connection_snapshot(self):
        from tools_proc import tools_obs
        source = Path(__file__).resolve().parents[1] / 'tools_main.py'
        tree = ast.parse(source.read_text(encoding='utf-8'))
        # 本番の利用可否配線を実行。外部実行体検出はfixture、接続はAsyncMockのみ。
        wiring = []
        for node in tree.body:
            if isinstance(node, ast.For) and isinstance(node.target, ast.Name) and node.target.id == '_name':
                wiring.append(node)
            elif isinstance(node, ast.Assign) and any(isinstance(target, ast.Subscript)
                    and isinstance(target.value, ast.Attribute) and target.value.attr == 'availability'
                    for target in node.targets):
                wiring.append(node)
        obs = SimpleNamespace(startup_status={'ok': False}, connection_info=AsyncMock(return_value={'obs_version': 'fixture'}))
        env = dict(tools_management=self.manager, MCP_MAP={'aidiy_obs_studio_control': object()},
                   obs=obs, ChromeManager=lambda: SimpleNamespace(find_chrome=lambda: 'fixture'),
                   ffmpeg_c=SimpleNamespace(version_info={'ffmpeg': {'ok': True}}), _pg_q=object(), sys=sys, os=os)
        exec(compile(ast.Module(body=wiring, type_ignores=[]), str(source), 'exec'), env)
        server = self.make_mcp('aidiy_obs_studio_control')
        tools_obs.register_tools(server, obs)
        self.app.include_router(tools_obs.create_router(obs))
        self.assertTrue(self.manager.available('aidiy_obs_studio_control'))
        result = await server.call_tool('obs_connection_info', {})
        self.assertFalse(result.is_error)
        self.assertIn('fixture', str(result.content))
        response = await self.client.post('/aidiy_obs_studio_control/connection_info', json={})
        self.assertEqual(response.status_code, 200)
        self.assertIn('fixture', response.text)
        self.assertEqual(obs.connection_info.await_count, 2)
        self.manager.enabled['aidiy_obs_studio_control'] = False
        self.assertEqual((await self.client.post('/aidiy_obs_studio_control/connection_info', json={})).json()['service_status'], 'out_of_service')
        self.assertEqual(obs.connection_info.await_count, 2)

    @running
    async def test_failed_replace_preserves_disk_and_runtime_and_allows_retry(self):
        before = self.path.read_bytes()
        body = {'defaults': {'text_to_speech': {'auto_voice': 'male'}}, 'write': True}
        with patch.object(tools_management.os, 'replace', side_effect=PermissionError):
            response = await self.manage('defaults', body)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(self.path.read_bytes(), before)
        self.assertEqual(self.fixture.tts.auto_voice, 'female')
        self.assertEqual(sorted(p.name for p in self.path.parent.iterdir()), ['AiDiy_key.json', 'AiDiy_tools.json'])
        self.assertEqual((await self.manage('defaults', body)).status_code, 200)
        self.assertEqual(self.fixture.tts.auto_voice, 'male')


if __name__ == '__main__':
    unittest.main()
