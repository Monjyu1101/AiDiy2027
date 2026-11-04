# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""実プロバイダを呼ばず、Liveの終了・受信待ち・送受信を検証する。"""
import asyncio
import importlib
from contextlib import asynccontextmanager
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
MODULE = importlib.import_module('AIコア.AIライブ_gemini')


class LiveLifecycleTests(unittest.IsolatedAsyncioTestCase):
    def make_live(self):
        live = MODULE.LiveAI('test-session', api_key='synthetic-only', diagnostic=True)
        live._logger = Mock()
        live.テキスト受信Ｑ = asyncio.Queue()
        live.音声受信Ｑ = asyncio.Queue()
        return live

    def messages(self, live, level='info'):
        return '\n'.join(str(c.args[0]) for c in getattr(live._logger, level).call_args_list)

    async def test_cancel_during_receive_preserves_cancelled_error(self):
        live = self.make_live()
        entered = asyncio.Event()

        async def receive():
            entered.set()
            await asyncio.Future()
            yield None

        live.live_session = SimpleNamespace(receive=receive)
        task = asyncio.create_task(live._受信ワーカー())
        await asyncio.wait_for(entered.wait(), 1)
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        live._logger.error.assert_not_called()
        self.assertIn('受信ワーカー:終了', self.messages(live))

    async def test_stop_before_receive_is_clean(self):
        live = self.make_live()
        live.中断停止フラグ = True
        await live._受信ワーカー()
        live._logger.error.assert_not_called()

    async def test_receive_failure_keeps_original_error(self):
        live = self.make_live()

        async def receive():
            raise RuntimeError('synthetic receive failure')
            yield None

        live.live_session = SimpleNamespace(receive=receive)
        await live._受信ワーカー()
        self.assertTrue(live.エラーフラグ)
        self.assertIn('synthetic receive failure', self.messages(live, 'error'))
        self.assertNotIn('NameError', self.messages(live, 'error'))
        self.assertIn('受信ワーカー:終了', self.messages(live))

    async def test_receive_and_turn_completion_reach_queue(self):
        live = self.make_live()
        response = MODULE.types.LiveServerMessage(server_content=MODULE.types.LiveServerContent(
            model_turn=MODULE.types.Content(parts=[MODULE.types.Part(text='private reply')]),
            turn_complete=True,
        ))

        async def receive():
            live.中断停止フラグ = True
            yield response

        live.live_session = SimpleNamespace(receive=receive)
        await live._受信ワーカー()
        self.assertEqual((await live.テキスト受信Ｑ.get())['text'], 'private reply')
        log = self.messages(live)
        self.assertNotIn('private reply', log)
        live._logger.error.assert_not_called()

    async def test_audio_and_transcription_reach_queues_without_thought(self):
        live = self.make_live()
        response = MODULE.types.LiveServerMessage(server_content=MODULE.types.LiveServerContent(
            model_turn=MODULE.types.Content(parts=[
                MODULE.types.Part(text='private thought', thought=True),
                MODULE.types.Part(inline_data=MODULE.types.Blob(data=b'private audio', mime_type='audio/pcm')),
            ]),
            output_transcription=MODULE.types.Transcription(text='private caption'),
            turn_complete=True,
        ))
        async def receive():
            live.中断停止フラグ = True
            yield response
        live.live_session = SimpleNamespace(receive=receive)
        await live._受信ワーカー()
        self.assertEqual((await live.音声受信Ｑ.get())['bytes_data'], b'private audio')
        self.assertEqual((await live.テキスト受信Ｑ.get())['text'], 'private caption')
        log = self.messages(live)
        self.assertNotIn('private', log)
        live._logger.error.assert_not_called()

    async def test_timeout_keeps_receiver_alive(self):
        live = self.make_live()
        async def receive():
            await asyncio.Future()
            yield None
        async def keepalive():
            live.中断停止フラグ = True
        live.live_session = SimpleNamespace(receive=receive)
        live._キープアライブ確認 = AsyncMock(side_effect=keepalive)
        with patch.object(MODULE, 'LIVEAI_TIMEOUT', 0.01):
            await live._受信ワーカー()
        self.assertFalse(live.エラーフラグ)
        live._キープアライブ確認.assert_awaited_once()
        live._logger.error.assert_not_called()

    async def test_send_awaits_sdk_without_progress_logging(self):
        live = self.make_live()
        live.live_session = SimpleNamespace(send_client_content=AsyncMock())
        self.assertTrue(await live.テキスト送信('private input'))
        call = live.live_session.send_client_content
        call.assert_awaited_once()
        self.assertTrue(call.call_args.kwargs['turn_complete'])
        self.assertEqual(call.call_args.kwargs['turns'].parts[0].text, 'private input')
        live._logger.info.assert_not_called()

    async def test_full_session_shutdown_cancels_receive_without_error(self):
        live = self.make_live()
        entered, closed = asyncio.Event(), asyncio.Event()
        async def receive():
            entered.set()
            await asyncio.Future()
            yield None
        session = SimpleNamespace(receive=receive)
        @asynccontextmanager
        async def connect(**kwargs):
            try:
                yield session
            finally:
                closed.set()
        live.client = SimpleNamespace(aio=SimpleNamespace(live=SimpleNamespace(connect=connect)))
        live._設定構成作成 = AsyncMock(return_value={})
        self.assertTrue(await live.開始(live.音声受信Ｑ, live.テキスト受信Ｑ))
        await asyncio.wait_for(entered.wait(), 1)
        self.assertTrue(await asyncio.wait_for(live.終了(), 1))
        self.assertTrue(closed.is_set())
        self.assertIsNone(live.live_session)
        self.assertFalse(live.is_alive)
        live._logger.error.assert_not_called()


if __name__ == '__main__':
    unittest.main()
