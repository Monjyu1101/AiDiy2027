# -*- coding: utf-8 -*-
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""予測専用CLIの引数・MCP制約・取消しを合成fixtureだけで確認する。"""

import asyncio
import importlib.util
import json
from pathlib import Path
import sys
import tomllib
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock, patch


ROOT = Path(__file__).resolve().parents[2]
CORE = ROOT / "backend_server" / "AIコア"


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, {name: module}):
        spec.loader.exec_module(module)
    return module


options = load_module("prediction_readonly_options_under_test", CORE / "AI実行オプション.py")
response = load_module("prediction_readonly_response_under_test", CORE / "AI応答.py")
logging_stub = ModuleType("log_config")
logging_stub.get_logger = Mock(return_value=Mock())
pil_stub = ModuleType("PIL")
pil_stub.Image = Mock()
MODULES = {
    "AIコア": ModuleType("AIコア"),
    "AIコア.AI実行オプション": options,
    "AIコア.AI応答": response,
    "AIコア.AIコードPi出力": load_module("prediction_pi_output_under_test", CORE / "AIコードPi出力.py"),
    "log_config": logging_stub,
    "PIL": pil_stub,
}
with patch.dict(sys.modules, MODULES):
    cli = load_module("prediction_readonly_cli_under_test", CORE / "AIコード_cli.py")
    agents = load_module("prediction_readonly_agents_under_test", ROOT / "backend_tools" / "tools_proc" / "code_agents.py")


class PredictionReadonlyCommandTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.env = patch.dict(cli.os.environ, {}, clear=True)
        self.env.start()
        self.addCleanup(self.env.stop)

    def make_cli(self, provider="codex_cli", readonly=True, permissions="auto"):
        option = options.AI実行オプション.読取専用予測() if readonly else options.AI実行オプション()
        ai = cli.CodeAI(
            AI_NAME=provider, AI_MODEL="fixture-model", 絶対パス="/fixture/project",
            実行オプション=option, code_permissions=permissions,
        )
        ai._コマンドパス取得 = Mock(return_value="fixture-cli")
        ai._CLI起動コマンド先頭 = Mock(return_value=(["fixture-cli"], False))
        ai.codex_セッションID = "must-not-resume"
        return ai

    def build(self, ai):
        return ai._コマンド構築("fixture prompt", 初回=False, repo_path="/fixture/project")

    def test_readonly_factory_does_not_change_default_or_oneshot(self):
        self.assertFalse(options.AI実行オプション().CLI読取専用)
        self.assertFalse(options.AI実行オプション.単発().CLI読取専用)
        option = options.AI実行オプション.読取専用予測()
        self.assertTrue(option.CLI読取専用)
        for name in ("会話継続", "履歴保存", "ストリーム送信", "出力ファイル保存"):
            self.assertFalse(getattr(option, name))

    async def test_readonly_start_does_not_spawn_version_process(self):
        for provider in ("codex_cli", "copilot_cli", "aidiy_hermes", "aidiy_pi"):
            with self.subTest(provider=provider):
                ai = self.make_cli(provider)
                ai.バージョン確認 = AsyncMock()
                with patch.object(cli.asyncio, "create_subprocess_exec", AsyncMock()) as spawn:
                    self.assertTrue(await ai.開始())
                self.assertTrue(ai.is_alive)
                ai.バージョン確認.assert_not_awaited()
                spawn.assert_not_awaited()

    async def test_normal_start_still_checks_version(self):
        ai = self.make_cli(readonly=False)
        ai.バージョン確認 = AsyncMock(return_value="fixture-version")
        self.assertTrue(await ai.開始())
        ai.バージョン確認.assert_awaited_once()
        self.assertEqual(ai.バージョン, "fixture-version")

    def test_pi_readonly_uses_fixed_entry_and_json_without_custom_cli(self):
        ai = self.make_cli("aidiy_pi")
        ai._pi直接実行コマンド = Mock(return_value=["node", "fixture/aidiy_pi.ts"])
        with patch.dict(cli.os.environ, {"AIDIY_PI_CLI_PATH": "unsafe-custom-cli"}):
            command = self.build(ai)
        self.assertEqual(command[:2], ["node", "fixture/aidiy_pi.ts"])
        self.assertIn("--read-only", command)
        self.assertIn("--no-session", command)
        self.assertEqual(command[command.index("--mode") + 1], "json")
        self.assertNotIn("unsafe-custom-cli", command)
        ai.code_model = "codex_cli/same"
        with self.assertRaises(cli.予測読取専用利用不可):
            self.build(ai)
        ai._pi直接実行コマンド.return_value = None
        with self.assertRaises(cli.予測読取専用利用不可):
            self.build(ai)

    async def test_codex_uses_verified_readonly_config_and_no_resume(self):
        ai = self.make_cli()
        ai._予測CodexMCP一覧 = AsyncMock(side_effect=[[("server.one/@team", True)], [("server.one/@team", False)]])
        await ai._予測CLI準備("/fixture/project")
        cmd = self.build(ai)
        self.assertNotIn("--dangerously-bypass-approvals-and-sandbox", cmd)
        self.assertNotIn("resume", cmd)
        self.assertNotIn("--ignore-user-config", cmd)
        self.assertEqual(cmd[cmd.index("--sandbox") + 1], "read-only")
        self.assertIn("--ephemeral", cmd)
        self.assertIn("--ignore-rules", cmd)
        self.assertIn('approval_policy="never"', cmd)
        self.assertIn('approvals_reviewer="user"', cmd)
        self.assertIn('web_search="disabled"', cmd)
        self.assertIn('history.persistence="none"', cmd)
        self.assertIn('notify=[]', cmd)
        for feature in cli._予測CODEX無効機能:
            self.assertIn(["--disable", feature], [cmd[i:i + 2] for i in range(len(cmd) - 1)])
        override = next(value for value in cmd if value.startswith("mcp_servers="))
        self.assertEqual(tomllib.loads(override), {"mcp_servers": {"server.one/@team": {"enabled": False}}})
        self.assertEqual(cmd[-1], "fixture prompt")
        first, second = ai._予測CodexMCP一覧.await_args_list
        self.assertEqual(first.args[2], "/fixture/project")
        self.assertEqual(second.args[2], "/fixture/project")
        self.assertEqual(second.args[1], first.args[1] + ["-c", override])
        self.assertEqual(cmd[1:cmd.index("exec")], second.args[1])

    async def test_preflight_cannot_be_reused_for_another_project(self):
        ai = self.make_cli()
        ai._予測CodexMCP一覧 = AsyncMock(side_effect=[[], []])
        await ai._予測CLI準備("/fixture/other-project")
        with self.assertRaises(cli.予測読取専用利用不可):
            self.build(ai)

    def test_windows_prefers_mxc_without_relaxing_readonly(self):
        ai = self.make_cli()
        with patch.object(cli.os, "name", "nt"):
            args = ai._予測Codex共通引数()
        self.assertIn(["-c", "features.prefer_mxc=true"], [args[i:i + 2] for i in range(len(args) - 1)])
        self.assertIn('sandbox_mode="read-only"', args)
        self.assertIn('approval_policy="never"', args)

    async def test_empty_mcp_config_is_verified_not_assumed_cleared(self):
        ai = self.make_cli()
        ai._予測CodexMCP一覧 = AsyncMock(side_effect=[[], []])
        await ai._予測CLI準備("/fixture/project")
        self.assertEqual(ai._予測CodexMCP一覧.await_count, 2)
        self.assertNotIn("mcp_servers={}", self.build(ai))

    async def test_mcp_verification_rejects_any_enabled_server(self):
        ai = self.make_cli()
        ai._予測CodexMCP一覧 = AsyncMock(side_effect=[[('known', True)], [('new', True)]])
        with self.assertRaises(cli.予測読取専用利用不可):
            await ai._予測CLI準備("/fixture/project")
        with self.assertRaises(cli.予測読取専用利用不可):
            self.build(ai)

    def test_codex_cannot_build_without_preflight(self):
        with self.assertRaises(cli.予測読取専用利用不可):
            self.build(self.make_cli())

    def test_copilot_only_exposes_read_tools(self):
        cmd = self.build(self.make_cli("copilot_cli"))
        for expected in (
            "--available-tools=view,grep,glob", "--allow-tool=read", "--deny-tool=write", "--deny-tool=shell",
            "--disable-builtin-mcps", "--no-custom-instructions", "--no-ask-user",
            "--no-auto-update", "--no-bash-env",
        ):
            self.assertIn(expected, cmd)
        for forbidden in ("--allow-all-tools", "--allow-all-paths", "--continue", "--yolo"):
            self.assertNotIn(forbidden, cmd)
        self.assertEqual(cmd[cmd.index("--add-dir") + 1], "/fixture/project")
        self.assertEqual(cmd[-2:], ["-p", "fixture prompt"])

    def test_unsupported_provider_never_uses_normal_builder(self):
        for provider in ("claude_sdk", "unknown_cli"):
            with self.subTest(provider=provider), self.assertRaises(cli.予測読取専用利用不可):
                self.build(self.make_cli(provider))

    def test_claude_readonly_uses_only_read_tools_and_disables_customizations(self):
        cmd = self.build(self.make_cli('claude_cli'))
        for flag in ('--restricted', '--safe-mode', '--strict-mcp-config', '--no-session-persistence', '--disable-slash-commands'):
            self.assertIn(flag, cmd)
        self.assertEqual(cmd[cmd.index('--tools') + 1], 'Read,Glob,Grep')
        self.assertEqual(cmd[cmd.index('--disallowedTools') + 1], 'mcp__*')
        self.assertEqual(cmd[cmd.index('--permission-mode') + 1], 'dontAsk')
        self.assertNotIn('--dangerously-skip-permissions', cmd)
        self.assertNotIn('--continue', cmd)
        self.assertEqual(cmd[-2:], ['-p', 'fixture prompt'])

    def test_grok_readonly_allows_only_read_tools(self):
        cmd = self.build(self.make_cli('grok_cli'))
        self.assertEqual(cmd[cmd.index('--tools') + 1], 'read_file,grep,list_dir')
        self.assertEqual(cmd[cmd.index('--disallowed-tools') + 1], 'search_tool,use_tool,task')
        self.assertEqual(cmd[cmd.index('--permission-mode') + 1], 'dontAsk')
        self.assertEqual(cmd[cmd.index('--sandbox') + 1], 'read-only')
        self.assertIn('--no-subagents', cmd)
        self.assertNotIn('--always-approve', cmd)
        self.assertEqual(cmd[-2:], ['-p', 'fixture prompt'])

    def test_hermes_uses_only_bundled_adapter_and_stdin(self):
        ai = self.make_cli("aidiy_hermes")
        ai.code_model = "openai_oauth/fixture-model"
        with patch.object(cli.Path, "is_file", return_value=True):
            cmd = self.build(ai)
        expected_python = Path("command_hermes") / ".venv" / ("Scripts/python.exe" if cli.os.name == "nt" else "bin/python")
        self.assertTrue(cmd[0].endswith(str(expected_python)))
        self.assertTrue(cmd[1].endswith(str(Path("command_hermes") / "prediction_main.py")))
        self.assertEqual(cmd[cmd.index("--workdir") + 1], "/fixture/project")
        self.assertEqual(cmd[cmd.index("--model") + 1], "openai_oauth/fixture-model")
        self.assertNotIn("fixture prompt", cmd)
        ai._コマンドパス取得.assert_not_called()

    def test_hermes_blank_model_still_supplies_required_adapter_argument(self):
        ai = self.make_cli("aidiy_hermes")
        ai.code_model = ""
        with patch.object(cli.Path, "is_file", return_value=True):
            cmd = self.build(ai)
        self.assertEqual(cmd[cmd.index("--model") + 1], "auto")

    def test_hermes_no_fallback_if_adapter_environment_unavailable(self):
        ai = self.make_cli("aidiy_hermes")
        with patch.object(cli.Path, "is_file", return_value=False):
            with self.assertRaises(cli.予測読取専用利用不可):
                self.build(ai)
        ai._コマンドパス取得.assert_not_called()

    def test_hermes_nested_cli_models_are_rejected(self):
        ai = self.make_cli("aidiy_hermes")
        with patch.object(cli.Path, "is_file", return_value=True):
            for model in ("codex_cli/fixture", "copilot-cli/fixture", "opencode/fixture", "claude-code/fixture"):
                with self.subTest(model=model), self.assertRaises(cli.予測読取専用利用不可):
                    ai.code_model = model
                    self.build(ai)

    def test_normal_code_permissions_none_is_unchanged(self):
        codex = self.build(self.make_cli(readonly=False, permissions="none"))
        self.assertIn("--dangerously-bypass-approvals-and-sandbox", codex)
        self.assertIn("resume", codex)
        copilot = self.build(self.make_cli("copilot_cli", readonly=False, permissions="none"))
        self.assertIn("--continue", copilot)
        self.assertNotIn("--allow-all-tools", copilot)
        self.assertNotIn("--available-tools=view,grep,glob", copilot)
        copilot_full = self.build(self.make_cli("copilot_cli", readonly=False))
        self.assertIn("--allow-all-tools", copilot_full)

    async def test_readonly_exit_two_is_capability_failure_without_raw_stderr(self):
        for provider in ("aidiy_hermes", "codex_cli", "copilot_cli"):
            with self.subTest(provider=provider):
                ai = self.make_cli(provider)
                stdout, stderr = asyncio.StreamReader(), asyncio.StreamReader()
                stdout.feed_eof()
                stderr.feed_data(b"fixture-sensitive-error\n")
                stderr.feed_eof()
                process = SimpleNamespace(returncode=2, stdout=stdout, stderr=stderr, wait=AsyncMock())
                with patch.object(cli.asyncio, "create_subprocess_exec", AsyncMock(return_value=process)):
                    with patch.object(cli, "logger", Mock()) as logger:
                        result = await ai._subprocess実行(["fixture-cli"], "/fixture/project", 5)
                self.assertTrue(ai.予測読取専用利用不可)
                self.assertEqual(result, "! CLIの予測用読取専用モードを利用できません。")
                self.assertEqual(ai.last_stderr_output, "")
                self.assertNotIn("fixture-sensitive-error", str(logger.mock_calls))
                self.assertIsNone(ai.current_process)

    async def test_mcp_listing_uses_same_project_and_drops_sensitive_fields(self):
        ai = self.make_cli()
        process = SimpleNamespace(returncode=0, communicate=AsyncMock(return_value=(json.dumps([
            {"name": "fixture", "enabled": True, "transport": {"headers": {"secret": "fixture-only"}}},
        ]).encode(), b"ignored stderr")))
        with patch.object(cli.asyncio, "create_subprocess_exec", AsyncMock(return_value=process)) as spawn:
            result = await ai._予測CodexMCP一覧(["fixture-cli"], ["-c", 'sandbox_mode="read-only"'], "/fixture/project")
        self.assertEqual(result, [("fixture", True)])
        self.assertEqual(spawn.call_args.kwargs["cwd"], "/fixture/project")
        self.assertEqual(spawn.call_args.args[-3:], ("mcp", "list", "--json"))
        self.assertIsNone(ai.current_process)

    async def test_invalid_or_failed_preflight_fails_closed_without_payload(self):
        cases = [(0, b"invalid-json"), (0, b'[{"name":"fixture"}]'), (1, b"fixture-secret")]
        for code, output in cases:
            with self.subTest(code=code, output=output):
                ai = self.make_cli()
                process = SimpleNamespace(returncode=code, communicate=AsyncMock(return_value=(output, b"fixture-secret")))
                with patch.object(cli.asyncio, "create_subprocess_exec", AsyncMock(return_value=process)):
                    with self.assertRaises(cli.予測読取専用利用不可) as error:
                        await ai._予測CodexMCP一覧(["fixture-cli"], [], "/fixture/project")
                self.assertNotIn("fixture-secret", str(error.exception))

    async def test_cancelled_preflight_terminates_owned_process(self):
        ai = self.make_cli()
        process = SimpleNamespace(returncode=None, communicate=AsyncMock(side_effect=asyncio.CancelledError), wait=AsyncMock())
        process.terminate = Mock(side_effect=lambda: setattr(process, "returncode", -15))
        process.kill = Mock()
        with patch.object(cli.asyncio, "create_subprocess_exec", AsyncMock(return_value=process)):
            with self.assertRaises(asyncio.CancelledError):
                await ai._予測CodexMCP一覧(["fixture-cli"], [], "/fixture/project")
        process.terminate.assert_called_once()
        self.assertIsNone(ai.current_process)

    async def test_cancel_during_spawn_still_cleans_up_process(self):
        ai = self.make_cli()
        started, release = asyncio.Event(), asyncio.Event()
        process = SimpleNamespace(returncode=None, communicate=AsyncMock(), wait=AsyncMock())
        process.terminate = Mock(side_effect=lambda: setattr(process, "returncode", -15))
        process.kill = Mock()

        async def spawn(*args, **kwargs):
            started.set()
            await release.wait()
            return process

        with patch.object(cli.asyncio, "create_subprocess_exec", spawn):
            task = asyncio.create_task(ai._予測CodexMCP一覧(["fixture-cli"], [], "/fixture/project"))
            await started.wait()
            task.cancel()
            release.set()
            with self.assertRaises(asyncio.CancelledError):
                await task
        process.terminate.assert_called_once()
        self.assertIsNone(ai.current_process)

    async def test_preflight_timeout_terminates_owned_process(self):
        ai = self.make_cli()
        process = SimpleNamespace(returncode=None, communicate=AsyncMock(side_effect=TimeoutError), wait=AsyncMock())
        process.terminate = Mock(side_effect=lambda: setattr(process, "returncode", -15))
        process.kill = Mock()
        with patch.object(cli.asyncio, "create_subprocess_exec", AsyncMock(return_value=process)):
            with self.assertRaises(cli.予測読取専用利用不可):
                await ai._予測CodexMCP一覧(["fixture-cli"], [], "/fixture/project")
        process.terminate.assert_called_once()
        self.assertIsNone(ai.current_process)

    async def test_codeagents_rejects_unsupported_provider_and_self_check_before_init(self):
        service = agents.CodeAgents(str(ROOT))
        service._setup_sys_path = Mock()
        service._resolve_project_path = Mock(return_value="/fixture/project")
        service._resolve_ai_params = Mock(side_effect=lambda name, model: (name, model))
        for provider, loops in [("claude_sdk", 0), ("codex_cli", 1)]:
            result = await service.run_async(
                "fixture prompt", ai_name=provider, self_check_loop=loops,
                実行オプション=options.AI実行オプション.読取専用予測(),
            )
            self.assertEqual(result["status"], "NG")
            self.assertTrue(result["prediction_readonly_unavailable"])

    async def test_codeagents_forwards_option_and_capability_failure(self):
        service = agents.CodeAgents(str(ROOT))
        service._setup_sys_path = Mock()
        service._resolve_project_path = Mock(return_value="/fixture/project")
        service._resolve_ai_params = Mock(side_effect=lambda name, model: (name, model))
        option = options.AI実行オプション.読取専用予測()
        ai = SimpleNamespace(実行=AsyncMock(return_value="! capability unavailable"), 終了=AsyncMock(), 予測読取専用利用不可=True)
        agent = SimpleNamespace(_ensure_ai_instance=AsyncMock(return_value=ai))
        code_stub = ModuleType("AIコア.AIコード")
        code_stub.CodeAgent = Mock(return_value=agent)
        with patch.dict(sys.modules, {**MODULES, "AIコア.AIコード": code_stub}):
            result = await service.run_async("fixture prompt", ai_name="codex_cli", 実行オプション=option)
        self.assertEqual(result["status"], "NG")
        self.assertTrue(result["prediction_readonly_unavailable"])
        self.assertIs(code_stub.CodeAgent.call_args.kwargs["実行オプション"], option)
        ai.終了.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()
