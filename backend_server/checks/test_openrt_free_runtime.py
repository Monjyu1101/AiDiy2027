# -*- coding: utf-8 -*-
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""無料候補区分も既存OpenRouterと同じ実行経路を使用。実API・実設定は使わない。"""
import asyncio
import importlib
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import Mock, patch


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend_server"))
sys.path.insert(0, str(ROOT / "backend_tools"))
logger_stub = ModuleType("log_config")
logger_stub.get_logger = Mock(return_value=Mock())
sdk_stub = ModuleType("openai")
sdk_stub.OpenAI = Mock()
with patch.dict(sys.modules, {"log_config": logger_stub, "openai": sdk_stub}):
    openrt = importlib.import_module("AIコア.AIチャット_openrt")
    chat = importlib.import_module("AIコア.AIチャット")
    importlib.import_module("AIコア.AI内部ツール")
    ISOLATED_MODULES = {name: module for name, module in sys.modules.items() if name == "AIコア" or name.startswith("AIコア.")}
from tools_proc.chat_llm import ChatLLM


MODEL = "qwen/qwen-new:free"
TOOLS = [{"type": "function", "function": {"name": "fixture_read", "parameters": {"type": "object"}}}]


def response():
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="fixture response", tool_calls=None))])


class OpenRouterFreeRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.addCleanup(patch.stopall)
        patch.dict(sys.modules, {**ISOLATED_MODULES, "openai": sdk_stub, "log_config": logger_stub}).start()
        patch("socket.create_connection", side_effect=AssertionError("Network forbidden")).start()
        self.create = Mock(return_value=response())
        self.client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=self.create)))
        self.factory = patch.object(openrt.openai, "OpenAI", return_value=self.client).start()

    def ai(self, provider="openrt_free", model=MODEL):
        instance = openrt.ChatAI(AI_NAME=provider, AI_MODEL=model, api_key="fixture-openrouter-key", 絶対パス=str(self.root))
        self.assertTrue(asyncio.run(instance.開始()))
        return instance

    def wrapper(self):
        wrapper = ChatLLM(project_root=str(self.root))
        wrapper._load_key_json = Mock(return_value={
            "CHAT_AI_NAME": "openrt_free", "CHAT_OPENRT_MODEL": "ordinary/model",
            "CHAT_OPENRT_FREE_MODEL": MODEL, "openrt_key_id": "fixture-openrouter-key",
        })
        return wrapper

    def test_same_sdk_client_endpoint_key_and_request_kwargs(self):
        requests = []
        for provider in ("openrt_chat", "openrt_free"):
            self.factory.reset_mock()
            instance = self.ai(provider)
            self.factory.assert_called_once_with(api_key="fixture-openrouter-key", base_url="https://openrouter.ai/api/v1")
            self.assertEqual(instance._同期実行([{"role": "user", "content": "fixture"}]), "fixture response")
            requests.append(self.create.call_args.kwargs)
        self.assertEqual(requests[0], requests[1])
        self.assertEqual(requests[1]["model"], MODEL)
        self.assertNotIn("extra_body", requests[1])

    def test_no_catalog_guard_or_manual_model_restriction_at_execution(self):
        with patch("builtins.open", side_effect=AssertionError("No catalog reads expected")):
            instance = self.ai(model="vendor/manual-model")
            self.assertEqual(instance._同期実行([]), "fixture response")
        self.assertEqual(self.create.call_args.kwargs["model"], "vendor/manual-model")

    def test_tool_options_are_identical_without_free_specific_restrictions(self):
        options = {"tools": [{"type": "web_search"}], "tool_choice": "auto", "messages": [],
                   "extra_body": {"plugins": [{"id": "web"}], "modalities": ["text", "audio"]}}
        requests = []
        for provider in ("openrt_chat", "openrt_free"):
            self.ai(provider)._同期実行([], completions_tools=options)
            requests.append(self.create.call_args.kwargs)
        self.assertEqual(requests[0], requests[1])
        self.assertEqual(requests[1]["extra_body"], options["extra_body"])
        self.assertEqual(requests[1]["tools"], options["tools"])

    def test_existing_tool_retry_behavior_is_preserved(self):
        instance = self.ai()
        self.create.side_effect = [RuntimeError("tools unsupported"), response()]
        self.assertEqual(instance._同期実行([], completions_tools={"tools": TOOLS}), "fixture response")
        self.assertEqual(self.create.call_count, 2)
        for call in self.create.call_args_list:
            self.assertEqual(call.kwargs["model"], MODEL)
            self.assertNotIn("extra_body", call.kwargs)
        self.assertNotIn("tools", self.create.call_args.kwargs)

    def test_chat_facade_uses_same_module_and_existing_key(self):
        parent = SimpleNamespace(conf=SimpleNamespace(json={"openrt_key_id": "fixture-openrouter-key", "openrt_free_key_id": "unused"}))
        with patch.object(chat, "_load_or_create_chat_context", return_value="fixture"):
            facade = chat.Chat(親=parent, AI_NAME="openrt_free", AI_MODEL=MODEL)
        instance = asyncio.run(facade._ensure_ai_instance())
        self.assertIsInstance(instance, openrt.ChatAI)
        self.assertEqual(instance.api_key, "fixture-openrouter-key")

    def test_tools_provider_mapping_and_nested_model_id(self):
        wrapper = self.wrapper()
        self.assertEqual(wrapper._parse_model_field("openrt_free/" + MODEL, "auto", "auto"), ("openrt_free", MODEL))
        self.assertEqual(wrapper._resolve_ai_params("openrt_free", "auto"), ("openrt_free", MODEL))
        self.assertEqual(wrapper._api_key_for("openrt_free", wrapper._load_key_json()), "fixture-openrouter-key")
        self.assertIs(wrapper._select_chat_class("openrt_free"), openrt.ChatAI)

    def test_tools_model_resolution_matches_other_providers(self):
        wrapper = self.wrapper()
        wrapper.version_info = {"openrt_chat": {"ok": True}, "openrt_free": {"ok": False}}
        self.assertEqual(wrapper._resolve_ai_params("auto", "auto"), ("openrt_chat", "ordinary/model"))
        self.assertEqual(wrapper._resolve_ai_params("openrt_free", "vendor/manual-model"), ("openrt_free", "vendor/manual-model"))
        del wrapper._load_key_json.return_value["CHAT_OPENRT_FREE_MODEL"]
        self.assertEqual(wrapper._resolve_ai_params("openrt_free", "auto"), ("openrt_free", "auto"))

    def test_tools_run_and_completions_use_shared_openrouter(self):
        wrapper = self.wrapper()
        result = asyncio.run(wrapper.run_async("fixture", ai_name="openrt_free", use_tools=False, resume=False))
        self.assertEqual(result["status"], "OK")
        self.assertEqual(result["ai_model"], MODEL)
        result = asyncio.run(wrapper.complete_async([{"role": "user", "content": "fixture"}], model="openrt_free/" + MODEL, tools=TOOLS))
        self.assertEqual(result["status"], "OK")
        self.assertEqual(result["ai_model"], MODEL)
        self.assertEqual(self.create.call_count, 2)
        for call in self.create.call_args_list:
            self.assertEqual(call.kwargs["model"], MODEL)
            self.assertNotIn("extra_body", call.kwargs)


if __name__ == "__main__":
    unittest.main()
