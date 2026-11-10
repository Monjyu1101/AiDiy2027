"""最後のAvatar切断だけが所有セッションの実行系を停止する（実サービスなし）。"""
import ast
import asyncio
import logging
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock

SOURCE = Path(__file__).resolve().parents[1] / 'AIコア/AIセッション管理.py'


def extracted_method(class_name, method_name):
    tree = ast.parse(SOURCE.read_text(encoding='utf-8'))
    cls = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == class_name)
    fn = next(node for node in cls.body if isinstance(node, ast.AsyncFunctionDef) and node.name == method_name)
    fn.decorator_list = []
    fn.returns = None
    for arg in fn.args.args:
        arg.annotation = None
    ns = {'asyncio': asyncio, 'logger': logging.getLogger(__name__), '初期化_音声データ': lambda: None}
    exec(compile(ast.Module(body=[fn], type_ignores=[]), str(SOURCE), 'exec'), ns)
    return ns[method_name]


class SessionFixture:
    _cancel_runtime_task = extracted_method('SessionConnection', '_cancel_runtime_task')
    _stop_runtime_processors_locked = extracted_method('SessionConnection', '_stop_runtime_processors_locked')

    def __init__(self, session_id):
        self.セッションID = session_id
        self.初期化ロック = asyncio.Lock()
        self.ボタン状態, self.モデル設定, self.ソース最終更新日時 = {}, {}, ''
        self.voice_enabled = True
        self.audio_data = object()
        self.output_audio_paused = True
        self.streaming_processor = SimpleNamespace(stop=AsyncMock(), task=None)
        self.audio_split_task = None
        self.recognition_processor = SimpleNamespace(終了=AsyncMock(), worker_task=None)
        self.live_processor = SimpleNamespace(終了=AsyncMock())
        self.chat_processor = SimpleNamespace(終了=AsyncMock())
        self.code_agent_processors = [SimpleNamespace(終了=AsyncMock()) for _ in range(6)]
        self.sockets = {}
        for channel in ('input', 'core', '1', '2', '3', '4', '5', '6'):
            self.sockets[channel] = SimpleNamespace(websocket=object(), close=AsyncMock())

    def get_socket(self, channel):
        return self.sockets.get(channel)

    def set_socket(self, channel, connection):
        self.sockets[channel] = connection

    @property
    def is_connected(self):
        return any(self.sockets.values())


class ManagerFixture:
    disconnect = extracted_method('WebSocketManager', 'disconnect')

    def __init__(self, *sessions):
        self.sessions = {s.セッションID: s for s in sessions}
        self.save_session_state = Mock()
        self._fmt_log = lambda **kw: 'fixture disconnect'


class AvatarSessionShutdownTests(unittest.IsolatedAsyncioTestCase):
    async def test_only_last_socket_stops_all_six_workers_chat_live(self):
        owned, other = SessionFixture('owned'), SessionFixture('other')
        manager = ManagerFixture(owned, other)
        streaming, recognition = owned.streaming_processor, owned.recognition_processor
        for channel in ('input', 'core', '1', '2', '3', '4', '5'):
            await manager.disconnect('owned', socket_no=channel, websocket=owned.sockets[channel].websocket)
            owned.live_processor.終了.assert_not_awaited()
            for worker in owned.code_agent_processors:
                worker.終了.assert_not_awaited()
        await manager.disconnect('owned', socket_no='6', websocket=owned.sockets['6'].websocket)
        streaming.stop.assert_awaited_once()
        recognition.終了.assert_awaited_once()
        owned.live_processor.終了.assert_awaited_once()
        owned.chat_processor.終了.assert_awaited_once()
        for worker in owned.code_agent_processors:
            worker.終了.assert_awaited_once()
        self.assertFalse(owned.is_connected)
        self.assertTrue(other.is_connected)
        other.live_processor.終了.assert_not_awaited()
        other.chat_processor.終了.assert_not_awaited()
        for worker in other.code_agent_processors:
            worker.終了.assert_not_awaited()
        self.assertIs(manager.sessions['owned'], owned)  # 会話状態は再接続用に残す。

    async def test_replaced_socket_cleanup_cannot_stop_new_connection(self):
        session = SessionFixture('owned')
        manager = ManagerFixture(session)
        await manager.disconnect('owned', socket_no='input', websocket=object())
        self.assertTrue(session.is_connected)
        session.sockets['input'].close.assert_not_awaited()
        session.live_processor.終了.assert_not_awaited()


def lifecycle_function(filename, name, class_name=None):
    path = SOURCE.parent / filename
    tree = ast.parse(path.read_text(encoding='utf-8'))
    nodes = tree.body
    if class_name:
        nodes = next(node for node in nodes if isinstance(node, ast.ClassDef) and node.name == class_name).body
    fn = next(node for node in nodes if isinstance(node, ast.AsyncFunctionDef) and node.name == name)
    ns = {'asyncio': asyncio, 'logger': logging.getLogger(__name__)}
    exec(compile(ast.Module(body=[fn], type_ignores=[]), str(path), 'exec'), ns)
    return ns[name]


class CodeShutdownTests(unittest.IsolatedAsyncioTestCase):
    async def test_sdk_parent_cancellation_reaps_execution_and_monitor(self):
        wait = lifecycle_function('AIコード_claude.py', '_実行監視待機')
        finished = []
        async def child(name):
            try:
                await asyncio.Event().wait()
            finally:
                finished.append(name)
        execution, monitor = asyncio.create_task(child('execution')), asyncio.create_task(child('monitor'))
        parent = asyncio.create_task(wait(execution, monitor))
        await asyncio.sleep(0)
        parent.cancel()
        with self.assertRaises(asyncio.CancelledError): await parent
        self.assertCountEqual(finished, ['execution', 'monitor'])
        self.assertTrue(execution.done())
        self.assertTrue(monitor.done())

    async def test_sdk_success_still_reaps_monitor(self):
        wait = lifecycle_function('AIコード_claude.py', '_実行監視待機')
        execution = asyncio.create_task(asyncio.sleep(0, result='answer'))
        monitor = asyncio.create_task(asyncio.Event().wait())
        done = await wait(execution, monitor)
        self.assertIn(execution, done)
        self.assertEqual(execution.result(), 'answer')
        self.assertTrue(monitor.cancelled())

    async def test_code_shutdown_closes_ai_without_restart(self):
        shutdown = lifecycle_function('AIコード.py', '終了', 'CodeAgent')
        worker = asyncio.create_task(asyncio.Event().wait())
        ai = SimpleNamespace(終了=AsyncMock(), 開始=AsyncMock())
        agent = SimpleNamespace(is_alive=True, worker_task=worker, AIインスタンス=ai, チャンネル='1')
        await shutdown(agent)
        self.assertFalse(agent.is_alive)
        self.assertTrue(worker.cancelled())
        ai.終了.assert_awaited_once()
        ai.開始.assert_not_awaited()

    async def test_worker_cleanup_error_still_closes_ai(self):
        shutdown = lifecycle_function('AIコード.py', '終了', 'CodeAgent')
        async def worker_body():
            try:
                await asyncio.Event().wait()
            finally:
                raise RuntimeError('synthetic cleanup failure')
        worker = asyncio.create_task(worker_body())
        await asyncio.sleep(0)
        ai = SimpleNamespace(終了=AsyncMock())
        agent = SimpleNamespace(is_alive=True, worker_task=worker, AIインスタンス=ai, チャンネル='1')
        with self.assertRaisesRegex(RuntimeError, 'synthetic'):
            await shutdown(agent)
        ai.終了.assert_awaited_once()


if __name__ == '__main__':
    unittest.main()
