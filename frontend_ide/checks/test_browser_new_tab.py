# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
"""Browser新規窓の接続先をMCP/HTTPへ返す。通常Chromeの既存応答は維持する。"""
import asyncio
import json
import logging
import shutil
import tempfile
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import AsyncMock, Mock, patch
from urllib.parse import quote

try:
    import httpx
except ImportError:
    raise unittest.SkipTest('httpx が無い環境（backend_tools/.venv の Python で実行）')
from fastapi import FastAPI

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'backend_tools'))
capture = types.ModuleType('tools_proc.desktop_capture')
capture.DesktopCapture = object
log = types.ModuleType('log_config')
log.get_logger = logging.getLogger
with patch.dict(sys.modules, {'tools_proc.desktop_capture': capture, 'log_config': log}):
    from tools_proc.ide_browser_session import IDEBrowserClient
    from tools_proc import tools_chrome
    from tools_proc.chrome_sessions import ChromeSessionRegistry
    from tools_proc.chrome_devtools import ChromeDevToolsError

URL = 'https://example.test/資料?a=1&b=2'
TOKEN = '12345678-1234-1234-1234-123456789abc'


class MCP:
    def __init__(self):
        self.tools = {}

    def tool(self):
        def register(function):
            self.tools[function.__name__] = function
            return function
        return register


def adapter(name='aidiy_ide 1'):
    return IDEBrowserClient({'name': name, 'port': 12345, 'token': TOKEN})


def api(clients):
    manager = Mock()
    manager.is_verified.return_value = True
    registry = Mock()
    registry.peek.side_effect = lambda name: (manager, clients[name])
    registry.get.side_effect = lambda name, *_: (manager, clients[name])
    mcp = MCP()
    ensure = tools_chrome.register_tools(mcp, registry)
    app = FastAPI()
    app.include_router(tools_chrome.create_router(registry, ensure))
    return mcp, app


class NewTabResponseTest(unittest.IsolatedAsyncioTestCase):
    async def test_adapter_preserves_new_session_without_switching_source(self):
        source = adapter()
        original = (source.port, source.token)
        source._auto_tab = {'id': 'source-tab'}
        with patch.object(source, '_http_get', return_value={'id': 'new-tab', 'session': 'aidiy_ide 2'}) as request:
            result = await source.send_command(source.get_browser_ws_url(), 'Target.createTarget', {'url': URL})
        self.assertEqual(result, {'targetId': 'new-tab', 'session': 'aidiy_ide 2'})
        request.assert_called_once_with('/json/new?url=' + quote(URL, safe=''))
        self.assertEqual((source.port, source.token), original)
        self.assertEqual(source._auto_tab, {'id': 'source-tab'})

    async def test_old_bridge_response_without_session_remains_compatible(self):
        source = adapter('aidiy_ide')
        with patch.object(source, '_http_get', return_value={'id': 'old-tab'}):
            self.assertEqual(await source.send_command(source.get_browser_ws_url(), 'Target.createTarget'), {'targetId': 'old-tab'})

    async def test_mcp_and_http_new_tab_aliases_preserve_optional_session(self):
        standalone = 'aidiy_browser 5ea6a3a0-21b2-4c31-80ab-123456789abc'
        for source_name, target_name in [('aidiy_ide 1', 'aidiy_ide 2'), (standalone, standalone), ('default', None)]:
            with self.subTest(source=source_name):
                response = {'targetId': 'new-tab'}
                if target_name:
                    response['session'] = target_name
                client = Mock()
                client.get_browser_ws_url.return_value = 'ws://mock-browser'
                client.send_command = AsyncMock(return_value=response)
                mcp, app = api({source_name: client})
                expected = {'id': 'new-tab', 'url': URL, **({'session': target_name} if target_name else {})}
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as http:
                    for method in ('new_tab', 'new_page'):
                        self.assertEqual(json.loads(await mcp.tools[method](session=source_name, url=URL)), expected)
                        result = await http.post('/aidiy_chrome_devtools/' + method, json={'session': source_name, 'url': URL})
                        self.assertEqual(result.status_code, 200)
                        self.assertEqual(result.json(), expected)
                self.assertEqual(client.send_command.await_count, 4)
                for call in client.send_command.await_args_list:
                    self.assertEqual(call.args, ('ws://mock-browser', 'Target.createTarget', {'url': URL}))

    async def test_response_session_and_tab_route_only_to_new_page(self):
        source, target = adapter(), adapter('aidiy_ide 2')
        source_tab = {'id': 'source-tab', 'webSocketDebuggerUrl': 'ws://mock/source'}
        target_tab = {'id': 'new-tab', 'webSocketDebuggerUrl': 'ws://mock/new'}
        source._http_get = Mock(side_effect=lambda path: {'id': 'new-tab', 'session': 'aidiy_ide 2'} if path.startswith('/json/new?') else [source_tab])
        target._http_get = Mock(return_value=[target_tab])
        mcp, app = api({'aidiy_ide 1': source, 'aidiy_ide 2': target})
        result = json.loads(await mcp.tools['new_tab'](session='aidiy_ide 1', url=URL))
        self.assertEqual(result['session'], 'aidiy_ide 2')
        self.assertEqual(source.resolve_tab('source-tab'), source_tab)
        with self.assertRaises(ValueError):
            source.resolve_tab(result['id'])
        with self.assertRaises(ValueError):
            target.resolve_tab('source-tab')
        target.send_command = AsyncMock(return_value={'result': {'value': 'new-page'}})
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as http:
            response = await http.post('/aidiy_chrome_devtools/eval_js', json={'session': result['session'], 'tab_id': result['id'], 'expression': 'marker'})
            self.assertEqual(response.json(), {'result': 'new-page'})
        target.send_command.assert_awaited_once_with('ws://mock/new', 'Runtime.evaluate', {'expression': 'marker', 'returnByValue': True, 'awaitPromise': False})
        self.assertEqual(source.resolve_tab('source-tab'), source_tab)


@unittest.skipUnless(shutil.which('node'), 'Node.js is required for the loopback bridge test')
class NewTabBridgeTest(unittest.IsolatedAsyncioTestCase):
    async def test_real_new_tab_session_routing_reuse_and_standalone(self):
        with tempfile.TemporaryDirectory(prefix='aidiy-new-tab-') as directory:
            process = await asyncio.create_subprocess_exec(shutil.which('node'), str(Path(__file__).with_name('browser-new-tab-fixture.cjs')), directory,
                stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
            registry = ChromeSessionRegistry(sessions_file=Path(directory) / '_chrome_sessions.json')
            clients = []
            try:
                line = await asyncio.wait_for(process.stdout.readline(), timeout=10)
                if not line:
                    self.fail((await process.stderr.read()).decode())
                ready = json.loads(line)
                self.assertEqual(ready['session'], 'aidiy_ide 1')
                mcp = MCP()
                ensure = tools_chrome.register_tools(mcp, registry)
                app = FastAPI()
                app.include_router(tools_chrome.create_router(registry, ensure))
                manager, source = registry.get(ready['session'])
                clients.append(source)
                self.assertTrue(manager.is_running())
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as http:
                    second = json.loads(await mcp.tools['new_tab'](session=ready['session'], url='https://example.test/second'))
                    self.assertEqual(second['session'], 'aidiy_ide 2')
                    third = (await http.post('/aidiy_chrome_devtools/new_page', json={'session': ready['session'], 'url': 'https://example.test/third'})).json()
                    self.assertEqual(third['session'], 'aidiy_ide 3')
                    for value, url in [(second, 'https://example.test/second'), (third, 'https://example.test/third')]:
                        _, target = registry.get(value['session'])
                        clients.append(target)
                        self.assertEqual(target.resolve_tab(value['id'])['url'], url)
                        with self.assertRaises(ValueError):
                            source.resolve_tab(value['id'])
                        for method in ('Browser.close', 'Target.getTargets'):
                            with self.assertRaisesRegex(ChromeDevToolsError, 'Browserページ以外のCDP操作は使用できません'):
                                await target.send_command(target.get_ws_url(target.resolve_tab(value['id'])), method)
                        actual = (await http.post('/aidiy_chrome_devtools/eval_js', json={'session': value['session'], 'tab_id': value['id'], 'expression': 'marker'})).json()
                        self.assertEqual(actual, {'result': url})
                    self.assertEqual([tab['id'] for tab in source.list_tabs()], [ready['tab_id']])
                    self.assertEqual((await http.post('/aidiy_chrome_devtools/close_session', json={'session': second['session']})).json(), {'result': '停止しました'})
                    self.assertEqual(source.resolve_tab(ready['tab_id'])['url'], 'https://example.test/source')
                    self.assertEqual(registry.get(third['session'])[1].resolve_tab(third['id'])['url'], 'https://example.test/third')
                    replacement = json.loads(await mcp.tools['new_tab'](session=ready['session'], url='https://example.test/replacement'))
                    self.assertEqual(replacement['session'], 'aidiy_ide 2')
                    self.assertNotEqual(replacement['id'], second['id'])
                    _, target = registry.get(replacement['session'])
                    clients.append(target)
                    self.assertEqual(target.resolve_tab(replacement['id'])['url'], 'https://example.test/replacement')
                    with self.assertRaises(ValueError):
                        target.resolve_tab(second['id'])
                    self.assertEqual(source.resolve_tab(ready['tab_id'])['url'], 'https://example.test/source')
                    standalone = (await http.post('/aidiy_chrome_devtools/new_tab', json={'session': ready['standalone'], 'url': 'https://example.test/standalone-new'})).json()
                    self.assertEqual(standalone['session'], ready['standalone'])
                    _, target = registry.get(standalone['session'])
                    clients.append(target)
                    self.assertEqual(len(target.list_tabs()), 2)
                    self.assertEqual(await target.eval_js('marker', standalone['id']), 'https://example.test/standalone-new')
                self.assertFalse(registry.sessions_file.exists(), '通常Chromeレジストリを作成しない')
            finally:
                for client in clients:
                    await client.close_connections()
                if process.returncode is None:
                    process.stdin.write(b'quit\n')
                    await process.stdin.drain()
                    try:
                        await asyncio.wait_for(process.wait(), timeout=5)
                    except TimeoutError:
                        process.terminate()
                        await process.wait()
                self.assertEqual(process.returncode, 0, (await process.stderr.read()).decode())
                self.assertEqual(list((Path(directory) / '_ide_browser_sessions').glob('*.json')), [])


if __name__ == '__main__':
    unittest.main()
