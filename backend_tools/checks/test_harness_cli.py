# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
"""親モードから CodeAI への委譲を、モデル・認証・DB なしで検証する。"""
import importlib.util
import io
import json
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock, patch

ROOT = Path(__file__).resolve().parents[2]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, {name: module}):
        spec.loader.exec_module(module)
    return module


adapter = load("harness_adapter", "backend_tools/tools_proc/harness_cli.py")
options = load("harness_options", "backend_server/AIコア/AI実行オプション.py")
permissions = load("harness_permissions", "backend_server/AIコア/AIコードCLI権限.py")


class HarnessTest(unittest.IsolatedAsyncioTestCase):
    async def test_all_providers_inherit_each_mode_without_resume(self):
        self.assertIn("agy_cli", adapter.CLI_PROVIDERS)
        for provider, cli_mode in [(provider, cli_mode) for provider in sorted(adapter.CLI_PROVIDERS)
                                   for cli_mode in (None, "passthrough")]:
            for mode in ("yolo", "normal", "read-only"):
                with self.subTest(provider=provider, mode=mode, cli_mode=cli_mode):
                    code = SimpleNamespace(実行=AsyncMock(return_value="fixture answer"))
                    factory = Mock(return_value=code)
                    output = io.StringIO()
                    modules = {"AIコア": ModuleType("AIコア"),
                        "AIコア.AIコード_cli": SimpleNamespace(CodeAI=factory),
                        "AIコア.AI実行オプション": options,
                        "AIコア.AI応答": SimpleNamespace(エラー応答判定=lambda _: False)}
                    with patch.dict(sys.modules, modules), patch.object(adapter, "OUTPUT", output):
                        await adapter.run({"provider": provider, "model": "same", "project": str(ROOT),
                                           "prompt": "[user]\nfixture", "mode": mode,
                                           **({"cli_mode": cli_mode} if cli_mode else {})})
                        await factory.call_args.kwargs["親"].接続.send_to_channel("code", {
                            "メッセージ識別": "output_stream", "メッセージ内容": "progress"})
                    kw = factory.call_args.kwargs
                    self.assertEqual(kw["code_permissions"], "full" if mode == "yolo" else "none")
                    self.assertEqual(kw["実行オプション"].CLI読取専用, mode == "read-only")
                    self.assertFalse(kw["実行オプション"].会話継続)
                    self.assertFalse(kw["実行オプション"].履歴保存)
                    self.assertFalse(code.実行.call_args.kwargs["resume"])
                    events = [json.loads(line) for line in output.getvalue().splitlines()]
                    self.assertEqual(events[0], {"type": "result", "ok": True, "text": "fixture answer"})
                    self.assertEqual(events[1]["text"], "progress")

    async def test_retired_chat_payloads_fail_before_delegation(self):
        request = {"provider": "codex_cli", "model": "same", "project": str(ROOT),
                   "prompt": "old payload", "mode": "yolo"}
        for extra in ({"cli_mode": "chat"}, {"cli_mode": "validate_chat"},
                      {"cli_mode": "unknown"}, {"engine_prompt": "untrusted"}):
            with self.subTest(extra=extra), self.assertRaisesRegex(ValueError, "廃止"):
                await adapter.run({**request, **extra})

    async def test_invalid_mode_cannot_default_to_yolo(self):
        for mode in (None, "full", True):
            with self.assertRaises(ValueError):
                await adapter.run({"provider": "codex_cli", "model": "same", "project": str(ROOT), "prompt": "x", "mode": mode})

    def test_antigravity_denies_changes_even_with_prior_allow(self):
        cfg = json.loads(permissions.antigravity読取専用設定())
        self.assertEqual(cfg["agentMode"], "plan")
        self.assertIn("write_file(*)", cfg["permissions"]["deny"])
        self.assertIn("command(*)", cfg["permissions"]["deny"])
        self.assertIn("mcp(*)", cfg["permissions"]["deny"])

    def test_opencode_policy_denies_all_but_reads_and_does_not_mutate_environment(self):
        env = {"OPENCODE_CONFIG_CONTENT": json.dumps({"permissions": [{"action":"*", "resource":"*", "effect":"allow"}]})}
        original = dict(env)
        result = permissions.CLI実行環境(env, "opencode_cli", True)
        config = json.loads(result["OPENCODE_CONFIG_CONTENT"])
        for action in ("edit", "shell", "subagent", "mcp_mutate", "experimental_image_generate"):
            matching = [r for r in config["policies"] if r["action"] == "tool.use" and r["resource"] == "*"]
            self.assertEqual(matching[-1]["effect"], "deny", action)
        self.assertEqual(config["subagent_depth"], 0)
        self.assertEqual(env, original)
        self.assertEqual(permissions.CLI実行環境(env, "opencode_cli", False), env)


if __name__ == "__main__":
    unittest.main()
