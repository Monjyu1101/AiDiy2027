# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""OpenAI正常項目通知と応答・エラー通知を、通信なしで検証する。"""
import asyncio
import base64
import importlib
import json
from pathlib import Path
import sys
import time
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
MODULE = importlib.import_module('AIコア.AIライブ_openai')


class ItemEventTests(unittest.IsolatedAsyncioTestCase):
    async def receive(self, events):
        live = MODULE.LiveAI('fixture', api_key='synthetic-only')
        live._logger = Mock()
        live.テキスト受信Ｑ = asyncio.Queue()
        live.音声受信Ｑ = asyncio.Queue()
        live.session_start_time = time.time()
        packets = iter(events)

        def recv():
            try:
                return json.dumps(next(packets))
            except StopIteration:
                raise RuntimeError('going away')

        live.ws_session = Mock(recv=recv)
        async def immediate_recv(func):
            return func()
        # 実WebSocketやスレッドプールを作らず、同じ受信分岐へfixtureを渡す。
        with patch.object(MODULE.asyncio, 'to_thread', side_effect=immediate_recv):
            await asyncio.wait_for(live._受信ワーカー(), timeout=3)
        return live

    async def test_normal_item_notifications_do_not_warn_or_emit_reply(self):
        live = await self.receive([
            {'type': kind, 'item': {'role': 'assistant', 'content': [{'text': '重複させない'}]}}
            for kind in ['conversation.item.created', 'conversation.item.added', 'conversation.item.done']
        ])
        live._logger.warning.assert_not_called()
        self.assertTrue(live.テキスト受信Ｑ.empty())
        self.assertFalse(live.エラーフラグ)

    async def test_text_reply_delivered_once_with_item_events(self):
        live = await self.receive([
            {'type': 'conversation.item.added'},
            {'type': 'response.output_text.delta', 'delta': 'こんにちは'},
            {'type': 'response.output_text.done'},
            {'type': 'conversation.item.done'},
            {'type': 'response.done', 'response': {'status': 'completed', 'output': []}},
        ])
        self.assertEqual(live.テキスト受信Ｑ.get_nowait(), {'text': 'こんにちは'})
        self.assertTrue(live.テキスト受信Ｑ.empty())
        live._logger.warning.assert_not_called()

    async def test_audio_and_transcript_unchanged(self):
        live = await self.receive([
            {'type': 'response.output_audio.delta', 'delta': base64.b64encode(b'pcm').decode()},
            {'type': 'response.output_audio_transcript.done', 'transcript': 'こんにちは'},
            {'type': 'conversation.item.done'},
        ])
        self.assertEqual(live.音声受信Ｑ.get_nowait()['bytes_data'], b'pcm')
        self.assertEqual(live.テキスト受信Ｑ.get_nowait(), {'text': 'こんにちは'})
        self.assertTrue(live.テキスト受信Ｑ.empty())

    async def test_actual_error_still_reaches_queue(self):
        live = await self.receive([{'type': 'error', 'error': {'code': 'rate_limit_exceeded', 'message': 'synthetic limit'}}])
        packet = live.テキスト受信Ｑ.get_nowait()
        self.assertEqual(packet['code'], 'rate_limit_exceeded')
        self.assertTrue(live.エラーフラグ)

    async def test_unknown_event_still_warns(self):
        live = await self.receive([{'type': 'fixture.unknown'}])
        live._logger.warning.assert_called_once_with('未知の応答タイプ: fixture.unknown')


if __name__ == '__main__':
    unittest.main()
