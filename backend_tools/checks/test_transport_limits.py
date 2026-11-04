# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""20 MiB の transport 境界。ASGI/模擬WSだけで、設定・通信・サービスを動かさない。"""
import json
import io
import logging
from pathlib import Path
import sys
import unittest
from unittest.mock import AsyncMock, Mock, patch

import httpx
from fastapi import FastAPI, HTTPException
from starlette.requests import Request
from websockets.exceptions import PayloadTooBig
from websockets.frames import Frame, Opcode

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import log_config
with patch.object(log_config, 'get_logger', side_effect=logging.getLogger):
    from tools_proc import tools_management, tools_prediction, live_model_check, obs_studio_control

LIMIT = 20 * 1024 * 1024


def payload(data, size):
    encoded = json.dumps(data, ensure_ascii=False).encode('utf-8')
    return encoded + b' ' * (size - len(encoded))


def diagnostic_request(data):
    chunks = iter((data[:17], data[17:65537], data[65537:]))
    async def receive():
        chunk = next(chunks, None)
        return {'type': 'http.request', 'body': chunk or b'', 'more_body': chunk is not None}
    return Request({'type': 'http', 'method': 'POST', 'path': '/internal/fixture',
                    'query_string': b'', 'client': ('127.0.0.1', 12345),
                    'headers': [(b'host', b'127.0.0.1'), (b'content-type', b'application/json'),
                                (b'x-aidiy-diag', b'model-trial')]}, receive)


class TransportLimitTests(unittest.IsolatedAsyncioTestCase):
    def test_explicit_limits_share_twenty_mib(self):
        for module in (tools_management, tools_prediction, live_model_check):
            self.assertEqual(module.MAX_BODY_BYTES, LIMIT)

    async def test_management_exact_boundary_and_chunked_overflow(self):
        manager = Mock()
        manager.update.return_value = {'status': 'OK'}
        auth = AsyncMock()
        app = FastAPI()
        tools_management.register_management(app, manager, auth)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            for action in ('enabled', 'defaults'):
                for delta in (-1, 0, 1):
                    with self.subTest(action=action, delta=delta):
                        manager.update.reset_mock()
                        data = payload({}, LIMIT + delta)
                        async def chunks():
                            yield data[:65537]
                            yield data[65537:]
                        response = await client.post('/management/' + action, content=chunks(), headers={'content-type': 'application/json'})
                        self.assertEqual(response.status_code, 413 if delta > 0 else 200)
                        if delta > 0:
                            manager.update.assert_not_called()
                        else:
                            manager.update.assert_called_once_with(action, {})
        self.assertEqual(auth.await_count, 6)

    async def test_prediction_utf8_body_exact_boundary(self):
        for delta in (-1, 0, 1):
            with self.subTest(delta=delta):
                request = diagnostic_request(payload({'project_path': '/fixture/日本語'}, LIMIT + delta))
                if delta > 0:
                    with self.assertRaises(HTTPException) as error:
                        await tools_prediction.validate_request(request)
                    self.assertEqual(error.exception.status_code, 413)
                else:
                    result = await tools_prediction.validate_request(request)
                    self.assertEqual(result.project_path, '/fixture/日本語')

    async def test_live_utf8_body_exact_boundary(self):
        body = dict(ai_name='openai_live', ai_model='fixture-model', voice='fixture-voice', prompt='日本語')
        for delta in (-1, 0, 1):
            with self.subTest(delta=delta):
                request = diagnostic_request(payload(body, LIMIT + delta))
                if delta > 0:
                    with self.assertRaises(HTTPException) as error:
                        await live_model_check.validate_request(request)
                    self.assertEqual(error.exception.status_code, 413)
                else:
                    self.assertEqual(await live_model_check.validate_request(request), body)

    async def test_semantic_fields_and_direct_loopback_rules_unchanged(self):
        cases = [(tools_prediction, {'project_path': '/' + 'x' * 4096}),
                 (live_model_check, dict(ai_name='openai_live', ai_model='model', voice='voice', prompt='x' * 16001))]
        for module, body in cases:
            with self.subTest(module=module.__name__):
                with self.assertRaises(HTTPException) as error:
                    await module.validate_request(diagnostic_request(json.dumps(body).encode()))
                self.assertEqual(error.exception.status_code, 400)
                request = diagnostic_request(b'{}')
                request.scope['client'] = ('203.0.113.1', 12345)
                with self.assertRaises(HTTPException) as error:
                    await module.validate_request(request)
                self.assertEqual(error.exception.status_code, 403)

    async def test_obs_connection_uses_twenty_mib_without_real_socket(self):
        subject = obs_studio_control.ObsStudioControl.__new__(obs_studio_control.ObsStudioControl)
        subject.timeout = 1
        subject._identify = AsyncMock()
        websocket = Mock()
        with patch.object(obs_studio_control.websockets, 'connect', new=AsyncMock(return_value=websocket)) as connect:
            self.assertIs(await subject._connect('127.0.0.1', 4455, 'fixture'), websocket)
        self.assertEqual(connect.call_args.kwargs['max_size'], LIMIT)
        subject._identify.assert_awaited_once_with(websocket, 'fixture')

    def test_websocket_frame_boundary_without_socket(self):
        for delta in (-1, 0, 1):
            with self.subTest(delta=delta):
                stream = io.BytesIO(Frame(Opcode.TEXT, b'x' * (LIMIT + delta)).serialize(mask=False))
                def read_exact(size):
                    if False:
                        yield
                    return stream.read(size)
                parser = Frame.parse(read_exact, mask=False, max_size=LIMIT)
                if delta > 0:
                    with self.assertRaises(PayloadTooBig):
                        next(parser)
                else:
                    with self.assertRaises(StopIteration) as complete:
                        next(parser)
                    self.assertEqual(len(complete.exception.value.data), LIMIT + delta)


if __name__ == '__main__':
    unittest.main()
