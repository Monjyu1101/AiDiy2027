# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""予測内部RESTの会話限定契約を、実サービスなしで確認する。"""
import logging
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import FastAPI

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import log_config
with patch.object(log_config, 'get_logger', side_effect=logging.getLogger):
    from tools_proc import tools_prediction


class PredictionSessionScopeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.run = AsyncMock(return_value={'status': 'OK', 'result': 'suggestion'})
        app = FastAPI()
        tools_prediction.register_prediction_llms(app, SimpleNamespace(run_async=self.run))
        self.client = await self.enterAsyncContext(httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app, client=('127.0.0.1', 12345)),
            base_url='http://127.0.0.1',
            headers={'X-AiDiy-Diag': 'model-trial'},
        ))

    async def send(self, **value):
        return await self.client.post(tools_prediction.INTERNAL_PATH, json={'project_path': '/work', **value})

    async def test_only_explicit_valid_session_is_forwarded(self):
        self.assertEqual((await self.send(session_id='core-session')).status_code, 200)
        self.run.assert_awaited_once_with(project_path='/work', ai_name='auto', ai_model='auto',
                                         timeout_sec=120, session_id='core-session')
        self.run.reset_mock()
        self.assertEqual((await self.send()).status_code, 200)
        self.run.assert_awaited_once_with(project_path='/work', ai_name='auto', ai_model='auto', timeout_sec=120)

    async def test_invalid_explicit_scope_never_calls_runner(self):
        for scope in (None, False, 7, '', ' leading-space', 'body\nline', 'x' * 129):
            with self.subTest(scope=scope):
                result = await self.send(session_id=scope)
                self.assertEqual(result.status_code, 400)
        self.assertEqual((await self.send(channel='0')).status_code, 400)
        self.run.assert_not_awaited()
