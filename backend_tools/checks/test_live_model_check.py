# -*- coding: utf-8 -*-
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
"""Live診断の接続先と失敗結果を、SDKや実設定を使わずに確認する。"""
import pathlib
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'backend_tools'))
from tools_proc import live_model_check as module


class LiveModelCheckTests(unittest.IsolatedAsyncioTestCase):
    def make(self):
        self.adapter = SimpleNamespace(live_session=None, エラーフラグ=False, 終了=AsyncMock())
        async def start(音声受信処理Ｑ, テキスト受信処理Ｑ):
            self.adapter.live_session = object()
            self.output = テキスト受信処理Ｑ
            return True
        async def send(_text):
            await self.output.put({'error': 'credential-must-not-leak', 'code': 'live_connection_failed'})
            return True
        self.adapter.開始 = AsyncMock(side_effect=start)
        self.adapter.テキスト送信 = AsyncMock(side_effect=send)
        self.factory = Mock(return_value=self.adapter)
        return module.LiveModelCheck(factory=self.factory, timeout=.4, sleep=AsyncMock())

    async def test_missing_selected_key_does_not_use_other_key(self):
        for section in ('gemini', 'freeai'):
            checker = self.make()
            other = 'freeai' if section == 'gemini' else 'gemini'
            config = {'LIVE_AI_NAME': f'{section}_live', f'LIVE_{section.upper()}_MODEL': 'gemini-3.8-live',
                      f'{other}_key_id': 'must-not-use', f'{section}_key_id': '< missing >'}
            with patch.object(module, 'read_config', return_value=config):
                result = await checker.run()
            self.assertEqual(result['reason'], 'key_not_configured')
            self.factory.assert_not_called()

    async def test_saved_default_migration_but_manual_model_preserved(self):
        previous = 'gemini-2.5-flash-native-audio-preview-09-2025'
        config = {'LIVE_AI_NAME': 'freeai_live', 'LIVE_FREEAI_MODEL': previous,
                  'LIVE_FREEAI_VOICE': 'Aoede', 'freeai_key_id': 'chosen-fixture', 'gemini_key_id': 'not-used'}
        for manual in (None, {'ai_name': 'freeai_live', 'ai_model': previous, 'voice': 'Aoede', 'prompt': 'fixture'}):
            checker = self.make()
            with patch.object(module, 'read_config', return_value=config):
                result = await checker.run(manual)
            model = previous if manual else 'gemini-3.8-live'
            self.assertEqual(result['model'], model)
            self.assertEqual(self.factory.call_args.kwargs['live_model'], model)
            self.assertEqual(self.factory.call_args.kwargs['api_key'], 'chosen-fixture')
            self.assertEqual(self.factory.call_args.kwargs['live_voice'], 'Aoede')
            self.assertEqual(result['reason'], 'connection_failed')
            self.assertNotIn('credential-must-not-leak', str(result))
            self.adapter.終了.assert_awaited_once()
