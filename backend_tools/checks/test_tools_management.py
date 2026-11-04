"""管理API/登録維持gateの隔離検証。認証・外部実行はmock。"""
import asyncio
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import httpx
from fastapi import FastAPI, HTTPException
from mcp.server.mcpserver import MCPServer
from tools_proc.tools_management import ToolsManagement, ToolsGateMiddleware, register_management, authenticate, MAX_BODY_BYTES


class ManagementTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'AiDiy_tools.json'
        self.manager = ToolsManagement(self.path)
        self.manager.availability = {'aidiy_text_to_speech': lambda: True, 'aidiy_chrome_devtools': lambda: False}
        self.tts = SimpleNamespace()
        self.manager.initialize({'text_to_speech': self.tts})
        self.app = FastAPI()
        self.auth = AsyncMock()
        register_management(self.app, self.manager, self.auth)
        self.app.add_middleware(ToolsGateMiddleware, manager=self.manager)
        self.calls = []
        @self.app.post('/aidiy_text_to_speech/synthesize')
        async def synth():
            self.calls.append(1)
            return {'status': 'OK'}
        @self.app.get('/aidiy_text_to_speech/list')
        async def listing():
            return {'tools': ['synthesize']}

    async def request(self, path, body=None, headers=None):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app), base_url='http://test') as client:
            return await client.post(path, json=body if body is not None else {}, headers=headers)

    async def test_read_runtime_then_save(self):
        before = self.path.read_bytes()
        result = await self.request('/management/defaults', {'defaults': {'text_to_speech': {'auto_voice': 'male'}}})
        self.assertEqual(result.status_code, 200)
        self.assertFalse(result.json()['data']['saved'])
        self.assertEqual(self.tts.auto_voice, 'male')
        self.assertEqual(self.path.read_bytes(), before)
        result = await self.request('/management/defaults', {'defaults': {'text_to_speech': {'auto_voice': 'male'}}, 'write': True})
        self.assertTrue(result.json()['data']['saved'])
        self.assertEqual(json.loads(self.path.read_text())['text_to_speech']['auto_voice'], 'male')
        self.assertEqual(self.auth.await_count, 2)

    async def test_disabled_rest_and_metadata_retained(self):
        result = await self.request('/management/enabled', {'enabled': {'aidiy_text_to_speech': False}, 'write': True})
        self.assertEqual(result.status_code, 200)
        reply = await self.request('/aidiy_text_to_speech/synthesize')
        self.assertEqual(reply.status_code, 200)
        self.assertEqual(reply.json()['service_status'], 'out_of_service')
        self.assertNotIn('error', reply.json())
        self.assertEqual(self.calls, [])
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app), base_url='http://test') as client:
            self.assertEqual((await client.get('/aidiy_text_to_speech/list')).json()['tools'], ['synthesize'])
        self.manager.initialize({'text_to_speech': self.tts})
        self.assertFalse(self.manager.active('aidiy_text_to_speech'))

    async def test_mcp_definition_retained_non_error(self):
        server = MCPServer('test')
        @self.manager.decorate('aidiy_text_to_speech', server.tool())
        async def sample(text: str) -> str:
            self.calls.append(text)
            return 'done'
        self.manager.enabled['aidiy_text_to_speech'] = False
        self.assertEqual((await server.list_tools())[0].name, 'sample')
        result = await server.call_tool('sample', {'text': 'x'})
        self.assertFalse(result.is_error)
        self.assertIn('out_of_service', str(result.content))
        self.assertEqual(self.calls, [])

    async def test_invalid_unknown_and_unavailable(self):
        for body in ({'enabled': {'unknown': False}}, {'enabled': {'aidiy_text_to_speech': 'false'}}, {'write': 1}, {'path': '/tmp'}):
            self.assertEqual((await self.request('/management/enabled', body)).status_code, 400)
        self.assertEqual((await self.request('/management/enabled', {'enabled': {'aidiy_chrome_devtools': True}})).status_code, 409)
        self.assertEqual((await self.request('/management/defaults', {'defaults': {'text_to_speech': {'auto_provider': 'unknown'}}})).status_code, 400)

    async def test_auth_csrf_and_oversize(self):
        self.auth.side_effect = HTTPException(401, 'login')
        self.assertEqual((await self.request('/management/enabled')).status_code, 401)
        self.auth.side_effect = None
        self.assertEqual((await self.request('/management/enabled', headers={'origin': 'https://evil.test'})).status_code, 403)
        self.assertEqual((await self.request('/management/enabled', headers={'origin': 'http://['})).status_code, 403)
        self.assertEqual((await self.request('/management/enabled', {'enabled': 'x' * 33000})).status_code, 400)
        self.assertEqual((await self.request('/management/enabled', {'enabled': 'x' * MAX_BODY_BYTES})).status_code, 413)

    async def test_write_failure_no_runtime_change(self):
        with patch('tools_proc.tools_management.os.replace', side_effect=PermissionError):
            result = await self.request('/management/defaults', {'defaults': {'text_to_speech': {'auto_voice': 'male'}}, 'write': True})
        self.assertEqual(result.status_code, 503)
        self.assertEqual(self.tts.auto_voice, 'female')
        self.assertFalse(self.path.with_suffix('.json.lock').exists())

    async def test_lock_contention_and_preserve_unknown(self):
        current = json.loads(self.path.read_text())
        current['future'] = {'preserve': True}
        self.path.write_text(json.dumps(current))
        self.path.with_suffix('.json.lock').mkdir()
        reply = await self.request('/management/enabled', {'enabled': {'aidiy_text_to_speech': False}, 'write': True})
        self.assertEqual(reply.status_code, 409)
        self.path.with_suffix('.json.lock').rmdir()
        await self.request('/management/enabled', {'enabled': {'aidiy_text_to_speech': False}, 'write': True})
        self.assertTrue(json.loads(self.path.read_text())['future']['preserve'])

    async def test_cleanup_failure_after_save_keeps_runtime_consistent(self):
        original = Path.rmdir
        def fail_lock(path):
            if path.name.endswith('.json.lock'):
                raise PermissionError()
            return original(path)
        with patch.object(Path, 'rmdir', fail_lock):
            result = await self.request('/management/enabled', {'enabled': {'aidiy_text_to_speech': False}, 'write': True})
        self.assertEqual(result.status_code, 200)
        self.assertFalse(self.manager.active('aidiy_text_to_speech'))
        self.assertFalse(json.loads(self.path.read_text())['enabled']['aidiy_text_to_speech'])

    async def test_notification_tts_dependency_honors_disabled(self):
        from tools_proc.notification_sounds import NotificationSounds
        ns = NotificationSounds.__new__(NotificationSounds)
        ns.tts_available = lambda: False
        with patch.object(ns, '_play_tts') as play:
            result = ns.play('開始', 'tts')
        self.assertEqual(result['service_status'], 'out_of_service')
        play.assert_not_called()

    async def test_obs_not_gated_by_stale_startup_connection(self):
        # 本番配線が起動時OBS接続スナップショットをhard gateにしないこと。
        source = (Path(__file__).resolve().parents[1] / 'tools_main.py').read_text()
        self.assertNotIn('lambda: bool(obs.startup_status.get("ok"))', source)
        self.assertIn('tools_management.availability[_name] = lambda: True', source)

    async def test_real_auth_rejects_missing_and_remote_failure(self):
        with self.assertRaises(HTTPException) as error:
            await authenticate(SimpleNamespace(headers={}))
        self.assertEqual(error.exception.status_code, 401)
        key_path = self.path.parent / 'AiDiy_key.json'
        key_path.write_text('{"PORT_CORE":8091}')
        response = SimpleNamespace(status_code=200, json=lambda: {'status': 'OK', 'data': {'secret': 'never-return'}})
        client = AsyncMock()
        client.__aenter__.return_value.post.return_value = response
        with patch('tools_proc.tools_management.CONFIG_PATH', self.path), patch('tools_proc.tools_management.httpx.AsyncClient', return_value=client):
            self.assertIsNone(await authenticate(SimpleNamespace(headers={'authorization': 'Bearer test'})))
        args = client.__aenter__.return_value.post.call_args
        self.assertEqual(args.args[0], 'http://127.0.0.1:8091/core/auth/現在利用者')


if __name__ == '__main__':
    unittest.main()
