# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""AI判断の実アダプターを合成HTTPで検証。キー・外部AIへは接続しない。"""
import importlib
import json
import logging
from pathlib import Path
import sys
import unittest
import types
from unittest.mock import AsyncMock, patch

try:
    import httpx
except ImportError:  # backend_tools / backend_server の Python で実行する。
    raise unittest.SkipTest('httpx が無い環境（backend_tools/.venv の Python で実行）')

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend_server'))
# アダプターの間接importで実運用ログを作らない。
sys.modules.setdefault('log_config', types.SimpleNamespace(get_logger=logging.getLogger))
from AIコア.AI判断 import Decision, PROVIDERS
from AIコア.AI判断共通 import DecisionError, DecisionRequest

ANSWERS = {'answers': [{'type': 'predicate', 'name': 'greeting', 'probability': 0.9}]}
QUESTION = [{'type': 'predicate', 'name': 'greeting', 'instructions': 'Is this a greeting?'}]


class DecisionRoutes(unittest.IsolatedAsyncioTestCase):
    def service(self, transport):
        return Decision(config={'DECISION_AI_NAME': 'auto', 'openai_key_id': 'synthetic-openai',
                                'gemini_key_id': 'synthetic-gemini', 'freeai_key_id': 'synthetic-freeai'},
                        transport=httpx.MockTransport(transport))

    async def test_all_registered_adapters_import(self):
        for provider in PROVIDERS.values():
            self.assertTrue(callable(importlib.import_module(provider.module).DecisionAI))

    async def test_explicit_routes_and_auto_oauth(self):
        requests = []
        def transport(request):
            payload = json.loads(request.content)
            requests.append((request.url.host, request.url.path, payload['model'] if 'model' in payload else None))
            if request.url.host == 'chatgpt.com':
                self.assertEqual(payload['model'], 'gpt-6-luna')
                event = {'type': 'response.completed', 'response': {'status': 'completed', 'output': [
                    {'type': 'message', 'content': [{'type': 'output_text', 'text': json.dumps(ANSWERS)}]}]}}
                return httpx.Response(200, text='data: ' + json.dumps(event) + '\n\n')
            if request.url.host == 'api.openai.com':
                self.assertEqual(request.url.path, '/v1/decisions')
                self.assertEqual(request.headers['Authorization'], 'Bearer synthetic-openai')
                self.assertEqual(payload['questions'][0]['name'], 'greeting')
                return httpx.Response(200, json=ANSWERS)
            self.assertEqual(request.url.host, 'generativelanguage.googleapis.com')
            self.assertIn(request.headers['x-goog-api-key'], ('synthetic-freeai', 'synthetic-gemini'))
            self.assertIn('responseJsonSchema', payload['generationConfig'])
            return httpx.Response(200, json={'candidates': [{'finishReason': 'STOP', 'content': {
                'parts': [{'text': json.dumps(ANSWERS)}]}}]})
        service = self.service(transport)
        service.availability = {name: {'ok': True, 'model': provider.default_model} for name, provider in PROVIDERS.items()}
        with patch('AIコア.AI判断_openai_jsonchat.oauth_headers', return_value={'Authorization': 'Bearer synthetic'}):
            for name, model in [('auto', 'auto'), ('openai_oauth', 'gpt-6-luna'),
                                ('openai_decisions', 'gpt-6-luna'), ('freeai_chat', 'auto'), ('gemini_chat', 'auto')]:
                result = await service.実行(DecisionRequest(input='hello', questions=QUESTION, ai_name=name, ai_model=model))
                self.assertEqual(result['status'], 'OK')
                self.assertEqual(result['data']['ai_name'], 'openai_oauth' if name == 'auto' else name)
        self.assertEqual(requests[0], requests[1])
        self.assertEqual(len(requests), 5)

    async def test_google_auto_default_and_explicit_models_preserved(self):
        for name, field in [('freeai_chat', 'DECISION_FREEAI_MODEL'), ('gemini_chat', 'DECISION_GEMINI_MODEL')]:
            requests = []
            def transport(request):
                requests.append((request.url.path, request.headers["x-goog-api-key"]))
                return httpx.Response(200, json={'candidates': [{'finishReason': 'STOP', 'content': {
                    'parts': [{'text': json.dumps(ANSWERS)}]}}]})
            service = self.service(transport)
            for model in ['auto', 'gemini-flash-lite-latest']:
                result = await service.実行(DecisionRequest(input='hello', questions=QUESTION, ai_name=name, ai_model=model))
                expected = 'gemini-4-hydrogen' if model == 'auto' else model
                self.assertEqual(result['data']['model'], name + '/' + expected)
                path, api_key = requests[-1]
                self.assertTrue(path.endswith('/' + expected + ':generateContent'))
                self.assertEqual(api_key, 'synthetic-freeai' if name == 'freeai_chat' else 'synthetic-gemini')
            req = DecisionRequest(input='hello', questions=QUESTION, ai_name=name)
            self.assertEqual(service.resolve(req, {field: 'gemini-flash-lite-latest'}),
                             (name, 'gemini-flash-lite-latest'))
            self.assertEqual(service.resolve(req, {field: 'auto'}), (name, 'gemini-4-hydrogen'))

    async def test_google_login_decision_priority_and_validates_json(self):
        service = Decision(config={"DECISION_AI_NAME": "gemini_agy"}, transport=httpx.MockTransport(
            lambda request: self.fail(f"must not use an API: {request.url}")
        ))
        request = DecisionRequest(input="おはよう", questions=QUESTION)
        with patch("AIコア.AI判断_gemini_agy.ChatAI") as launch:
            chat = launch.return_value
            chat.開始 = AsyncMock(return_value=True)
            chat.実行 = AsyncMock(return_value="```json\n" + json.dumps(ANSWERS) + "\n```")
            chat.終了 = AsyncMock()
            actual = await service.実行(request)
            self.assertEqual(actual["data"]["model"], "gemini_agy/gemini-4-hydrogen")
            self.assertEqual(actual["data"]["answers"], ANSWERS["answers"])
            self.assertEqual(launch.call_args.kwargs["AI_MODEL"], "gemini-4-hydrogen")
            self.assertNotIn("api_key", launch.call_args.kwargs)
            self.assertIn("JSON Schema", launch.call_args.kwargs["system_instruction"])
            chat.終了.assert_awaited_once()
            chat.実行.return_value = "not JSON"
            with self.assertRaises(DecisionError):
                await service.実行(request)
            launch.reset_mock()
            with self.assertRaisesRegex(DecisionError, "テキスト専用"):
                await service.実行({"input": [{"content": [{"type": "input_image",
                    "image_url": "data:image/png;base64,AAAA"}]}], "questions": QUESTION})
            launch.assert_not_called()
        service.availability = {name: {"ok": True} for name in ("gemini_agy", "freeai_chat", "gemini_chat", "openai_decisions")}
        self.assertEqual(service.resolve(request, {})[0], "gemini_agy")
        image = DecisionRequest(input=[{"content": [{"type": "input_image",
            "image_url": "data:image/png;base64,AAAA"}]}], questions=QUESTION)
        self.assertEqual(service.resolve(image, {})[0], "freeai_chat")
        service.availability["gemini_agy"]["ok"] = False
        self.assertEqual(service.resolve(request, {})[0], "freeai_chat")
        service.availability["freeai_chat"]["ok"] = False
        self.assertEqual(service.resolve(request, {})[0], "gemini_chat")

    async def test_api_http_failure_is_not_import_error_and_hides_body(self):
        for name, expected in [('openai_decisions', 'Decisions API HTTP 403'),
                               ('gemini_chat', 'Gemini JSON判断 HTTP 403'),
                               ('freeai_chat', 'Gemini JSON判断 HTTP 403')]:
            service = self.service(lambda request: httpx.Response(403, text='synthetic-secret-do-not-expose'))
            with self.assertRaises(DecisionError) as caught:
                await service.実行(DecisionRequest(input='hello', questions=QUESTION, ai_name=name))
            self.assertIn(expected, str(caught.exception))
            self.assertNotIn('synthetic-secret', str(caught.exception))

    async def test_auto_uses_startup_snapshot_and_explicit_keeps_provider(self):
        service = self.service(lambda request: httpx.Response(500))
        service.availability = {'openai_oauth': {'ok': False, 'model': 'gpt-6-luna'},
                                'freeai_chat': {'ok': True, 'model': 'gemini-4-hydrogen'}}
        default = DecisionRequest(input='hello', questions=QUESTION)
        self.assertEqual(service.resolve(default, service._load_config())[0], 'freeai_chat')
        explicit = DecisionRequest(input='hello', questions=QUESTION, model='openai_oauth/gpt-6-luna')
        self.assertEqual(service.resolve(explicit, service._load_config()), ('openai_oauth', 'gpt-6-luna'))

    async def test_configured_provider_and_model_win_over_auto_priority(self):
        service = self.service(lambda request: httpx.Response(500))
        service.availability = {'openai_oauth': {'ok': True, 'model': 'gpt-6-luna'}}
        request = DecisionRequest(input='hello', questions=QUESTION)
        self.assertEqual(service.resolve(request, {'DECISION_AI_NAME': 'gemini_chat', 'DECISION_GEMINI_MODEL': 'custom'}),
                         ('gemini_chat', 'custom'))


if __name__ == '__main__':
    unittest.main()
