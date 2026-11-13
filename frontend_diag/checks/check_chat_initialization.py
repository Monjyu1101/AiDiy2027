# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""実AIを呼ばず、初回SDK読込中もToolsのイベントループが動くことを確認する。"""
import asyncio
import importlib.util
from pathlib import Path
import sys
import threading
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('diag_chat_initialization', ROOT / 'backend_tools/tools_proc/chat_llm.py')
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class InitializationTests(unittest.IsolatedAsyncioTestCase):
    async def test_first_import_keeps_event_loop_responsive(self):
        entered, release = threading.Event(), threading.Event()

        class Chat:
            is_alive = True
            temperature = 0

            def __init__(self, **kwargs):
                self.options = kwargs

            async def 開始(self):
                return True

        def load_class(name):
            self.assertEqual(name, 'synthetic')
            entered.set()
            release.wait(1)
            return Chat

        service = MODULE.ChatLLM.__new__(MODULE.ChatLLM)
        service._load_key_json = lambda: {}
        service._api_key_for = lambda *args: ''
        service._select_chat_class = load_class
        task = asyncio.create_task(service._build_instance('synthetic', 'test-model', '挨拶だけ', str(ROOT), 0.2))
        try:
            async with asyncio.timeout(2):
                while not entered.is_set():
                    await asyncio.sleep(0.001)
            self.assertFalse(task.done(), '同期importがイベントループを停止しました。')
            release.set()
            instance = await asyncio.wait_for(task, 2)
            self.assertTrue(instance.is_alive)
            self.assertEqual(instance.temperature, 0.2)
            self.assertEqual(instance.options['AI_MODEL'], 'test-model')
        finally:
            release.set()
            if not task.done():
                task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    async def test_gemini_client_initialization_keeps_event_loop_responsive(self):
        sys.path.insert(0, str(ROOT / 'backend_server'))
        module = importlib.import_module('AIコア.AIチャット_gemini')
        entered, release = threading.Event(), threading.Event()

        def client(**kwargs):
            entered.set()
            release.wait(1)
            return object()

        instance = module.ChatAI(AI_NAME='freeai_chat', AI_MODEL='synthetic', api_key='synthetic-only')
        with patch.object(module.genai, 'Client', client):
            task = asyncio.create_task(instance.開始())
            try:
                async with asyncio.timeout(2):
                    while not entered.is_set():
                        await asyncio.sleep(0.001)
                self.assertFalse(task.done(), 'Client生成がイベントループを停止しました。')
                release.set()
                self.assertTrue(await asyncio.wait_for(task, 2))
            finally:
                release.set()
                if not task.done():
                    task.cancel()
                await asyncio.gather(task, return_exceptions=True)
                await instance.終了()

    def test_live_diagnostic_defers_client_initialization(self):
        sys.path.insert(0, str(ROOT / 'backend_server'))
        module = importlib.import_module('AIコア.AIライブ_gemini')
        with patch.object(module.genai, 'Client') as client:
            instance = module.LiveAI('synthetic', api_key='synthetic-only', diagnostic=True)
            client.assert_not_called()
            self.assertIsNone(instance.client)


if __name__ == '__main__':
    unittest.main()
