# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
"""CDP例外の分類・再送境界。GUIなしの単体試験と実loopbackブリッジを使う。"""
import asyncio
import json
import logging
from pathlib import Path
import shutil
import sys
import tempfile
import types
import unittest
from unittest.mock import AsyncMock, Mock, patch

try:
    import websockets
    from websockets.exceptions import WebSocketException
except ImportError:
    raise unittest.SkipTest('websockets が無い環境（backend_tools/.venv の Python で実行）')

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'backend_tools'))
capture = types.ModuleType('tools_proc.desktop_capture')
capture.DesktopCapture = object
log = types.ModuleType('log_config')
log.get_logger = logging.getLogger
with patch.dict(sys.modules, {'tools_proc.desktop_capture': capture, 'log_config': log}):
    import tools_proc.chrome_devtools as cdp
    from tools_proc.chrome_sessions import ChromeSessionRegistry

WS = 'ws://127.0.0.1:12345/page/source'
TAB = {'id': 'source', 'webSocketDebuggerUrl': WS}
WAIT = object()


class MissingExceptionAlias:
    """サブモジュールをimport済みでも、package.exceptionsに依存する実装を必ず検出する。"""
    def __init__(self, connect):
        self.connect = connect

    def __getattr__(self, name):
        if name == 'exceptions':
            raise AttributeError("module 'websockets' has no attribute 'exceptions'")
        return getattr(websockets, name)


class Socket:
    def __init__(self, replies=(), send_errors=()):
        self.replies = list(replies)
        self.send_errors = list(send_errors)
        self.sent = []
        self.closed = 0

    async def send(self, payload):
        self.sent.append(json.loads(payload))
        if self.send_errors:
            raise self.send_errors.pop(0)

    async def recv(self):
        value = self.replies.pop(0) if self.replies else WAIT
        if value is WAIT:
            await asyncio.Event().wait()
        if isinstance(value, Exception):
            raise value
        return value if isinstance(value, str) else json.dumps(value)

    async def close(self):
        self.closed += 1

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        await self.close()


class CDPErrorsTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.client = cdp.CDPClient()
        self.client._auto_tab = dict(TAB)
        self.unreachable = Mock()
        self.client._on_unreachable = self.unreachable

    async def asyncTearDown(self):
        await self.client.close_connections()

    def connect(self, *sockets, error=None):
        connect = AsyncMock(side_effect=error if error else list(sockets))
        self.enterContext(patch.object(cdp, 'websockets', MissingExceptionAlias(connect)))
        return connect

    async def test_denial_keeps_original_error_and_reuses_connection(self):
        socket = Socket([{'id': 1, 'error': {'message': 'Browserページ以外のCDP操作は使用できません。'}}, {'id': 2, 'result': {'ok': True}}])
        connect = self.connect(socket)
        with self.assertRaises(cdp.ChromeDevToolsError) as denied:
            await self.client.send_command(WS, 'Browser.close')
        self.assertEqual(str(denied.exception), 'CDP エラー [Browser.close]: Browserページ以外のCDP操作は使用できません。')
        self.assertIs(self.client._ws_connections[WS], socket)
        self.assertEqual(await self.client.send_command(WS, 'Runtime.evaluate'), {'ok': True})
        self.assertEqual(connect.await_count, 1)
        self.assertEqual(socket.closed, 0)
        self.assertEqual(self.client._auto_tab, TAB)
        self.unreachable.assert_not_called()

    async def test_send_failure_retries_once_before_any_receive(self):
        for error in (WebSocketException('send closed'), OSError('send failed')):
            with self.subTest(error=type(error).__name__):
                await self.client.close_connections()
                self.client._command_id = 0
                first = Socket(send_errors=[error])
                second = Socket([{'id': 1, 'result': {'ok': True}}])
                connect = self.connect(first, second)
                self.assertEqual(await self.client.send_command(WS, 'Input.dispatchMouseEvent'), {'ok': True})
                self.assertEqual(connect.await_count, 2)
                self.assertEqual(first.sent, second.sent)
                self.assertEqual(first.closed, 1)
                self.assertEqual(len(second.sent), 1)
                self.unreachable.assert_not_called()

    async def test_second_send_failure_stops_retry_and_invalidates(self):
        for exception in (WebSocketException, OSError):
            with self.subTest(error=exception.__name__):
                self.client._auto_tab = dict(TAB)
                self.unreachable.reset_mock()
                first = Socket(send_errors=[exception('first')])
                second = Socket(send_errors=[exception('second')])
                connect = self.connect(first, second)
                with self.assertRaisesRegex(cdp.ChromeDevToolsError, 'WebSocket 接続エラー: second'):
                    await self.client.send_command(WS, 'Input.dispatchMouseEvent')
                self.assertEqual(connect.await_count, 2)
                self.assertEqual(len(first.sent), 1)
                self.assertEqual(len(second.sent), 1)
                self.assertEqual(first.closed, 1)
                self.assertEqual(second.closed, 1)
                self.assertNotIn(WS, self.client._ws_connections)
                self.assertIsNone(self.client._auto_tab)
                self.unreachable.assert_called_once()

    async def test_receive_failure_never_resends_non_idempotent_command(self):
        for exception in (WebSocketException, OSError):
            with self.subTest(error=exception.__name__):
                self.client._auto_tab = dict(TAB)
                self.unreachable.reset_mock()
                socket = Socket([exception('receive closed')])
                connect = self.connect(socket)
                with self.assertRaisesRegex(cdp.ChromeDevToolsError, 'WebSocket 接続エラー: receive closed'):
                    await self.client.send_command(WS, 'Input.dispatchMouseEvent')
                self.assertEqual(connect.await_count, 1)
                self.assertEqual(len(socket.sent), 1)
                self.assertEqual(socket.closed, 1)
                self.assertIsNone(self.client._auto_tab)
                self.unreachable.assert_called_once()

    async def test_open_failure_is_connection_error_without_send_retry(self):
        for error in (WebSocketException('open closed'), OSError('open closed')):
            with self.subTest(error=type(error).__name__):
                self.unreachable.reset_mock()
                connect = self.connect(error=error)
                with self.assertRaisesRegex(cdp.ChromeDevToolsError, 'WebSocket 接続エラー: open closed'):
                    await self.client.send_command(WS, 'Runtime.evaluate')
                self.assertEqual(connect.await_count, 1)
                self.unreachable.assert_called_once()

    async def test_timeout_keeps_specific_classification_and_does_not_retry(self):
        socket = Socket([WAIT])
        connect = self.connect(socket)
        with self.assertRaises(cdp.ChromeDevToolsTimeoutError) as timeout:
            await self.client.send_command(WS, 'Runtime.evaluate', timeout=0.01)
        self.assertIn('タイムアウトしました (0.01秒)', str(timeout.exception))
        self.assertNotIn('WebSocket 接続エラー', str(timeout.exception))
        self.assertEqual(connect.await_count, 1)
        self.assertEqual(len(socket.sent), 1)
        self.assertEqual(socket.closed, 1)

    async def test_unrelated_decode_error_is_not_replaced_by_attribute_error(self):
        socket = Socket(['not-json'])
        self.connect(socket)
        with self.assertRaises(json.JSONDecodeError):
            await self.client.send_command(WS, 'Runtime.evaluate')

    async def test_dialog_denial_retains_message_and_closes_private_connection(self):
        socket = Socket([{'id': 1, 'result': {}}, {'method': 'Page.javascriptDialogOpening', 'params': {'type': 'confirm'}}, {'id': 2, 'error': {'message': 'dialog denied'}}])
        self.client.resolve_tab_async = AsyncMock(return_value=TAB)
        with patch.object(cdp, 'websockets', MissingExceptionAlias(Mock(return_value=socket))):
            with self.assertRaisesRegex(cdp.ChromeDevToolsError, r'CDP エラー \[Page.handleJavaScriptDialog\]: dialog denied'):
                await self.client.handle_dialog(dialog_wait=0.1)
        self.assertEqual([message['method'] for message in socket.sent], ['Page.enable', 'Page.handleJavaScriptDialog'])
        self.assertEqual(socket.closed, 1)

    async def test_dialog_socket_closure_keeps_connection_error(self):
        socket = Socket([WebSocketException('dialog closed')])
        self.client.resolve_tab_async = AsyncMock(return_value=TAB)
        with patch.object(cdp, 'websockets', MissingExceptionAlias(Mock(return_value=socket))):
            with self.assertRaisesRegex(cdp.ChromeDevToolsError, 'WebSocket 接続エラー: dialog closed'):
                await self.client.handle_dialog(dialog_wait=0.1)
        self.assertEqual(len(socket.sent), 1)
        self.assertEqual(socket.closed, 1)

    async def test_dialog_timeout_is_not_misreported_as_attribute_error(self):
        socket = Socket([{'id': 1, 'result': {}}, WAIT])
        self.client.resolve_tab_async = AsyncMock(return_value=TAB)
        with patch.object(cdp, 'websockets', MissingExceptionAlias(Mock(return_value=socket))):
            with self.assertRaisesRegex(TimeoutError, '表示されませんでした'):
                await self.client.handle_dialog(dialog_wait=0.01)
        self.assertEqual(socket.closed, 1)


@unittest.skipUnless(shutil.which('node'), 'Node.js is required for the loopback bridge test')
class CDPBridgeErrorsTest(unittest.IsolatedAsyncioTestCase):
    async def test_real_bridge_denial_recovery_and_socket_close(self):
        with tempfile.TemporaryDirectory(prefix='aidiy-cdp-errors-') as directory:
            process = await asyncio.create_subprocess_exec(
                shutil.which('node'), str(Path(__file__).with_name('browser-cdp-errors-fixture.cjs')), directory,
                stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            )
            client = None
            try:
                line = await asyncio.wait_for(process.stdout.readline(), timeout=10)
                if not line:
                    self.fail((await process.stderr.read()).decode())
                ready = json.loads(line)
                registry = ChromeSessionRegistry(sessions_file=Path(directory) / '_chrome_sessions.json')
                manager, client = registry.get(ready['session'])
                self.assertTrue(manager.is_running())
                tab = client.resolve_tab(ready['tab_id'])
                ws_url = client.get_ws_url(tab)
                with patch.object(cdp, 'websockets', MissingExceptionAlias(websockets.connect)):
                    self.assertEqual(await client.eval_js('normal', ready['tab_id']), 'normal')
                    connection = client._ws_connections[ws_url]
                    for method in ('Browser.close', 'Target.getTargets'):
                        with self.assertRaises(cdp.ChromeDevToolsError) as denied:
                            await client.send_command(ws_url, method)
                        self.assertEqual(str(denied.exception), f'CDP エラー [{method}]: Browserページ以外のCDP操作は使用できません。')
                        self.assertIs(client._ws_connections[ws_url], connection)
                        self.assertEqual(await client.eval_js('after-denial', ready['tab_id']), 'after-denial')
                    self.assertEqual(await client.eval_js('commands', ready['tab_id']), ['Runtime.evaluate'] * 4)
                    self.assertEqual(await client.eval_js('max-listeners', ready['tab_id']), 1)
                    client._auto_tab = dict(tab)
                    manager.ensure_running()
                    with self.assertRaisesRegex(cdp.ChromeDevToolsError, 'WebSocket 接続エラー:'):
                        await client.eval_js('close-before-response', ready['tab_id'])
                    self.assertNotIn(ws_url, client._ws_connections)
                    self.assertIsNone(client._auto_tab)
                    self.assertFalse(manager.is_verified())
                    process.stdin.write(b'stats\n')
                    await process.stdin.drain()
                    stats = json.loads(await asyncio.wait_for(process.stdout.readline(), timeout=5))
                    self.assertEqual(stats['commands'].count('close-before-response'), 1, '受信切断後に命令を再送しない')
            finally:
                if client is not None:
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
