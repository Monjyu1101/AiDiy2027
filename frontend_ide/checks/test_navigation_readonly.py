# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
import asyncio
import json
import os
import importlib.util
from pathlib import Path
import tempfile
import unittest
import sys
from types import ModuleType
from unittest.mock import patch

ENTRY = Path(__file__).resolve().parents[1] / "ファイル機能" / "navigation_readonly.py"
spec = importlib.util.spec_from_file_location("navigation_readonly", ENTRY)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
# AIコアのパッケージ初期化（ストリーミング機器/SDK）をこの隔離試験では起動しない。
package = ModuleType("AIコア")
package.__path__ = [str(ENTRY.parents[2] / "backend_server" / "AIコア")]
original_run = module.run
async def isolated_run(*args, **kwargs):
    with patch.dict(sys.modules, {"AIコア": package}), patch.object(module, "load_saved_hermes_model", return_value={"provider": "openai_oauth", "model": "test-model"}):
        return await original_run(*args, **kwargs)
module.run = isolated_run


class FakeCode:
    def __init__(self, response):
        self.response, self.calls = response, []

    async def run_async(self, **kwargs):
        self.calls.append(kwargs)
        return self.response


class NavigationReadonlyTest(unittest.TestCase):
    def test_fixed_readonly_boundary_and_no_project_output(self):
        with tempfile.TemporaryDirectory() as folder:
            code = FakeCode({"status": "OK", "result": "{}", "ai_name": "aidiy_hermes", "selected_model": "test"})
            result = asyncio.run(module.run({"project": folder, "prompt": "読むだけ"}, code))
            options = code.calls[0]["実行オプション"]
            self.assertTrue(options.CLI読取専用)
            for name in ["会話継続", "履歴保存", "ストリーム送信", "出力ファイル保存"]:
                self.assertFalse(getattr(options, name))
            self.assertEqual(code.calls[0]["code_permissions"], "none")
            self.assertEqual(code.calls[0]["ai_name"], "aidiy_hermes")
            self.assertEqual(code.calls[0]["ai_model"], "openai_oauth/test-model")
            self.assertEqual(code.calls[0]["self_check_loop"], 0)
            self.assertFalse(code.calls[0]["resume"])
            self.assertEqual(result["content"], "{}")
            self.assertEqual(list(Path(folder).iterdir()), [])

    def test_unavailable_never_retries_normal_execution(self):
        with tempfile.TemporaryDirectory() as folder:
            code = FakeCode({"status": "NG", "prediction_readonly_unavailable": True})
            with self.assertRaises(ValueError):
                asyncio.run(module.run({"project": folder, "prompt": "test"}, code))
            self.assertEqual(len(code.calls), 1)

    def test_all_providers_use_readonly_options_without_custom_system_instruction(self):
        with tempfile.TemporaryDirectory() as folder:
            for provider in ("codex_cli", "copilot_cli", "aidiy_hermes", "claude_cli", "grok_cli"):
                with self.subTest(provider=provider):
                    code = FakeCode({"status": "OK", "result": "{}"})
                    asyncio.run(module.run({"project": folder, "prompt": "調査", "selection": {"provider": provider, "model": "auto"}}, code))
                    self.assertNotIn("system_instruction", code.calls[0])
                    self.assertTrue(code.calls[0]["実行オプション"].CLI読取専用)
                    self.assertEqual(code.calls[0]["code_permissions"], "none")

    def test_failed_response_not_accepted(self):
        with tempfile.TemporaryDirectory() as folder:
            code = FakeCode({"status": "NG", "result": "failure"})
            with self.assertRaises(ValueError):
                asyncio.run(module.run({"project": folder, "prompt": "test"}, code))

    def test_unsupported_provider_before_invocation(self):
        with tempfile.TemporaryDirectory() as folder:
            code = FakeCode({})
            with self.assertRaises(ValueError):
                asyncio.run(module.run({"project": folder, "prompt": "test", "selection": {"provider": "unknown_cli", "model": "same"}}, code))
            self.assertEqual(code.calls, [])

    def test_saved_model_uses_aidiy_cli_default_home(self):
        with tempfile.TemporaryDirectory() as folder:
            home=Path(folder);(home / ".hermes").mkdir()
            (home / ".hermes" / "aidiy_model.json").write_text(json.dumps({"provider":"openai_oauth","model":"test-default"}),encoding="utf-8")
            with patch.dict(os.environ,{"HERMES_HOME":""}), patch.object(module.Path,"home",return_value=home):
                self.assertEqual(module.load_saved_hermes_model()["model"],"test-default")
                self.assertEqual(os.environ["HERMES_HOME"],"")

    def test_saved_model_respects_explicit_home(self):
        with tempfile.TemporaryDirectory() as folder:
            (Path(folder) / "aidiy_model.json").write_text(json.dumps({"provider":"openai_oauth","model":"test-profile"}),encoding="utf-8")
            with patch.dict(os.environ,{"HERMES_HOME":folder}):
                self.assertEqual(module.load_saved_hermes_model()["model"],"test-profile")
                self.assertEqual(os.environ["HERMES_HOME"],folder)

    def test_saved_model_resolution(self):
        for provider in ("openai_oauth", "openai-oauth", "openai-codex"):
            with patch.object(module, "load_saved_hermes_model", return_value={"provider": provider, "model": "test-model"}):
                self.assertEqual(module.resolve_model({"provider": "aidiy_hermes", "model": "same"}), "openai_oauth/test-model")

    def test_unresolved_choice_fails_closed(self):
        for choice in (None, {"provider": "custom", "model": "test"}, {"provider": "openai_oauth", "model": "same"}, {"provider": "openai_oauth", "model": "auto"}, {"provider": "openai_oauth", "model": "other/test"}):
            with patch.object(module, "load_saved_hermes_model", return_value=choice):
                with self.assertRaises(ValueError):
                    module.resolve_model({"provider": "aidiy_hermes", "model": "same"})

    def test_explicit_and_other_cli_models_unchanged(self):
        with patch.object(module, "load_saved_hermes_model", side_effect=AssertionError("must not read preferences")):
            for provider, model in (("aidiy_hermes", "openai_oauth/test"), ("codex_cli", "same"), ("copilot_cli", "auto")):
                self.assertEqual(module.resolve_model({"provider": provider, "model": model}), model)

    def test_missing_project_before_invocation(self):
        with tempfile.TemporaryDirectory() as folder:
            code = FakeCode({})
            with self.assertRaises(ValueError):
                asyncio.run(module.run({"project": str(Path(folder) / "missing"), "prompt": "test"}, code))
            self.assertEqual(code.calls, [])


if __name__ == "__main__":
    unittest.main()
