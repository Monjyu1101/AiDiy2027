# -*- coding: utf-8 -*-
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""Hermes 予測 adapter のみを検証。実 API / CLI / 認証 / DB は起動しない。"""

import ast
from contextlib import redirect_stderr
from dataclasses import dataclass
import importlib.util
from io import StringIO
import json
import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch


ROOT = Path(__file__).resolve().parents[2]
HERMES = ROOT / "command_hermes"
SPEC = importlib.util.spec_from_file_location("prediction_hermes_adapter", HERMES / "prediction_main.py")
adapter = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(adapter)


@dataclass
class ManagedResult:
    result: object
    args: dict
    middleware_trace: list
    blocked: bool
    dispatched: bool


def tool(name):
    return {"type": "function", "function": {"name": name}}


def make_runtime():
    def dispatch(agent, *, function_name, function_args, execute, **kwargs):
        return ManagedResult(execute(function_args), function_args, [], False, True)

    executor = SimpleNamespace(
        _run_agent_tool_execution_middleware=Mock(side_effect=dispatch),
        _ManagedToolResult=ManagedResult,
    )
    factory = Mock(side_effect=lambda **kw: SimpleNamespace(
        api_mode=kw["api_mode"],
        tools=[tool("read_file"), tool("search_files"), tool("write_file"),
               tool("tool_call"), {"type": "web_search"}],
    ))
    cli = SimpleNamespace(
        AIAgent=factory,
        provider_entry_is_cli=lambda p: p in {
            "claude-code", "codex-cli", "copilot-cli", "antigravity-cli", "opencode", "grok-cli",
        },
        _configure_aidiy_cli_provider=Mock(),
        cli_entry=Mock(return_value=0),
    )
    extraction = SimpleNamespace(is_extractable_document=Mock(return_value=True))
    return cli, SimpleNamespace(create_custom_toolset=Mock()), executor, extraction


class HermesReadonlyAdapterTest(unittest.TestCase):
    def setUp(self):
        self.runtime = make_runtime()
        self.cli, self.toolsets, self.executor, self.extraction = self.runtime
        self.original_factory = self.cli.AIAgent
        self.original_dispatch = self.executor._run_agent_tool_execution_middleware
        adapter._install_readonly_policy(*self.runtime)

    def test_registered_custom_toolset_and_exact_model_schemas(self):
        self.toolsets.create_custom_toolset.assert_called_once_with(
            adapter.READONLY_TOOLSET, unittest.mock.ANY,
            tools=["read_file", "search_files"], includes=[],
        )
        agent = self.cli.AIAgent(
            api_mode="codex_responses", provider="openai-codex", model="gpt-6-luna",
            enabled_toolsets=["all"], checkpoints_enabled=True, session_db=object(),
            fallback_model=[{"provider": "copilot-acp"}],
        )
        self.assertEqual(agent.valid_tool_names, {"read_file", "search_files"})
        self.assertEqual([t["function"]["name"] for t in agent.tools], ["read_file", "search_files"])
        kw = self.original_factory.call_args.kwargs
        self.assertEqual(kw["enabled_toolsets"], [adapter.READONLY_TOOLSET])
        self.assertIsNone(kw["disabled_toolsets"])
        for key in ("skip_context_files", "skip_memory", "skip_background_review"):
            self.assertIs(kw[key], True)
        self.assertFalse(kw["save_trajectories"])
        self.assertFalse(kw["checkpoints_enabled"])
        self.assertEqual(kw["fallback_model"], [])
        self.assertIsNone(kw["session_db"])
        self.assertTrue(agent._skip_mcp_refresh)
        self.assertTrue(agent._persist_disabled)
        self.assertFalse(agent._session_json_enabled)
        self.assertIsNone(agent._session_db)
        self.assertIsNone(agent._dump_api_request_debug({"messages": ["fixture prompt"]}, reason="http-400"))

    def test_all_api_modes_supported_without_cli_bridge(self):
        for mode in adapter.API_MODES:
            with self.subTest(mode=mode):
                self.assertEqual(self.cli.AIAgent(api_mode=mode, provider="api-provider").api_mode, mode)

    def test_unknown_native_and_acp_modes_fail_before_factory(self):
        for mode in (None, "codex_app_server", "acp", "claude_code", "future_native"):
            with self.subTest(mode=mode), self.assertRaises(adapter.ReadonlyUnavailable):
                self.cli.AIAgent(api_mode=mode, provider="auto")
        with self.assertRaises(adapter.ReadonlyUnavailable):
            self.cli.AIAgent(api_mode="chat_completions", acp_command="external-cli")
        with self.assertRaises(adapter.ReadonlyUnavailable):
            self.cli.AIAgent(api_mode="chat_completions", requested_provider="copilot-cli")
        self.original_factory.assert_not_called()

    def test_changed_resolved_mode_fails_closed(self):
        self.original_factory.side_effect = lambda **kw: SimpleNamespace(api_mode="codex_app_server")
        with self.assertRaises(adapter.ReadonlyUnavailable):
            self.cli.AIAgent(api_mode="chat_completions")

    def test_nested_cli_models_and_provider_are_explicitly_rejected(self):
        for model in ("codex-cli/default", "claude-code:auto", "copilot_cli/gpt", "opencode_cli/model"):
            with self.subTest(model=model), self.assertRaises(adapter.ReadonlyUnavailable):
                adapter._reject_cli_provider(self.cli, None, model)
        instance = SimpleNamespace(_session_db=object())
        with self.assertRaises(adapter.ReadonlyUnavailable):
            self.cli._configure_aidiy_cli_provider(instance, "copilot-cli", requested_model="same")
        self.assertFalse(self.cli._configure_aidiy_cli_provider(instance, "openai-codex"))
        self.assertIsNone(instance._session_db)

    def test_hallucinated_mutation_dynamic_mcp_and_subagents_never_dispatch(self):
        names = (
            "write_file", "patch", "terminal", "execute_code", "delegate_task", "memory",
            "todo_list", "tool_call", "tool_search", "tool_describe", "setup_mcp",
            "mcp__fixture__write", "unknown_future_tool", "READ_FILE", "file_read",
        )
        with TemporaryDirectory() as directory:
            file = Path(directory) / "unchanged.txt"
            file.write_text("original", encoding="utf-8")
            execute = Mock(side_effect=lambda _: file.write_text("changed", encoding="utf-8"))
            for name in names:
                with self.subTest(name=name):
                    begin = Mock()
                    outcome = self.executor._run_agent_tool_execution_middleware(
                        object(), function_name=name, function_args={"path": str(file)},
                        execute=execute, begin_execution=begin,
                    )
                    self.assertTrue(outcome.blocked)
                    self.assertFalse(outcome.dispatched)
                    self.assertIn("error", json.loads(outcome.result))
                    begin.assert_called_once_with()
            execute.assert_not_called()
            self.original_dispatch.assert_not_called()
            self.assertEqual(file.read_text(encoding="utf-8"), "original")

    def test_allowed_reads_reach_original_executor(self):
        for name in adapter.READONLY_TOOLS:
            with self.subTest(name=name):
                execute = Mock(return_value="fixture read/search result")
                outcome = self.executor._run_agent_tool_execution_middleware(
                    object(), function_name=name, function_args={"path": "fixture", "pattern": "fixture"}, execute=execute,
                )
                self.assertTrue(outcome.dispatched)
                self.assertFalse(outcome.blocked)
                self.assertEqual(outcome.result, "fixture read/search result")
                execute.assert_called_once_with({"path": "fixture", "pattern": "fixture"})

    def test_mixed_batch_cannot_expand_allowlist_via_valid_tool_names(self):
        agent = SimpleNamespace(valid_tool_names={"read_file", "write_file", "search_files"})
        executed = []
        outcomes = [self.executor._run_agent_tool_execution_middleware(
            agent, function_name=name, function_args={"path": "fixture", "pattern": "fixture"},
            execute=lambda args, name=name: executed.append(name),
        ) for name in ("read_file", "write_file", "search_files")]
        self.assertEqual(executed, ["read_file", "search_files"])
        self.assertEqual([outcome.blocked for outcome in outcomes], [False, True, False])

    def test_search_option_injection_never_reaches_shell_handler(self):
        execute = Mock()
        for override in (
            {"pattern": "--pre=sh"}, {"pattern": " --pre=sh"}, {"pattern": "\t--pre=sh"},
            {"pattern": "-e"}, {"path": "--pre=sh"}, {"path": "\n--pre=sh"},
            {"file_glob": "--pre=sh"}, {"limit": "1; touch fixture"},
            {"context": "1; touch fixture"}, {"offset": "1; touch fixture"},
            {"pattern": ["--pre=sh"]}, {"path": ["--pre=sh"]},
        ):
            with self.subTest(override=override):
                outcome = self.executor._run_agent_tool_execution_middleware(
                    object(), function_name="search_files",
                    function_args={"pattern": "fixture", "path": ".", **override}, execute=execute,
                )
                self.assertTrue(outcome.blocked)
        execute.assert_not_called()
        self.original_dispatch.assert_not_called()
        self.assertTrue(adapter._readonly_arguments("search_files", {"pattern": "[-]literal", "path": "./-directory"}))

    def test_document_reads_never_reach_lazy_install_or_hosted_ocr(self):
        install = Mock()
        ocr = Mock()
        def read_document(args):
            # bundled read_file と同じ call-time predicate の実行境界。
            if self.extraction.is_extractable_document(args["path"]):
                install()
                ocr()
            return "plain text or binary-file error"

        for path in ("fixture.pdf", "fixture.DOC", "fixture.pptx", "fixture.ipynb", "fixture.docx"):
            self.executor._run_agent_tool_execution_middleware(
                object(), function_name="read_file", function_args={"path": path}, execute=read_document,
            )
        install.assert_not_called()
        ocr.assert_not_called()

    def test_actual_persistence_guards_do_not_access_store(self):
        # 実 API / Hermes import なしで既存の保存境界を実行する。
        # flag 名の存在確認だけでなく、本文の保存と store 再取得を止めることを確認。
        tree = ast.parse((HERMES / "base" / "run_agent.py").read_text(encoding="utf-8"))
        agent_class = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == "AIAgent")
        names = {"_get_session_db_for_recall", "_ensure_db_session", "_flush_messages_to_session_db_unlocked", "_save_session_log"}
        methods = [node for node in agent_class.body if isinstance(node, ast.FunctionDef) and node.name in names]
        module = ast.Module(body=[ast.ImportFrom(module="__future__", names=[ast.alias(name="annotations")], level=0), *methods], type_ignores=[])
        namespace = {}
        exec(compile(ast.fix_missing_locations(module), "<isolated-persistence-guards>", "exec"), namespace)
        agent = self.cli.AIAgent(api_mode="codex_responses")
        for name in names:
            arguments = ([{"role": "user", "content": "fixture private prompt"}],) if name == "_flush_messages_to_session_db_unlocked" else ()
            self.assertIsNone(namespace[name](agent, *arguments))

        cli_tree = ast.parse((HERMES / "cli_main.py").read_text(encoding="utf-8"))
        finalize = next(node for node in cli_tree.body if isinstance(node, ast.FunctionDef) and node.name == "_flush_one_shot_session_store")
        final_namespace = {"_handed_off_session_ids": set()}
        exec(compile(ast.Module(body=[finalize], type_ignores=[]), "<isolated-oneshot-flush>", "exec"), final_namespace)
        agent.session_id = "fixture-session"
        cli_store = Mock()
        final_namespace[finalize.name](SimpleNamespace(agent=agent, _session_db=cli_store))
        self.assertEqual(cli_store.mock_calls, [])

    def test_entry_uses_real_cwd_and_safe_environment_before_import(self):
        original_cwd = Path.cwd()
        # Windows は使用中の cwd を削除できないため、一時フォルダより先に cwd を戻す（後始末は登録の逆順）。
        directory = self.enterContext(TemporaryDirectory())
        self.addCleanup(os.chdir, original_cwd)
        with patch.dict(os.environ, {
            "HERMES_SAFE_MODE": "0", "HERMES_KANBAN_TASK": "parent-worker",
            "HERMES_KANBAN_GOAL_MODE": "1", "HERMES_YOLO_MODE": "1", "TERMINAL_ENV": "docker",
            "HERMES_DISABLE_LAZY_INSTALLS": "0", "HERMES_LAZY_INSTALL_TARGET": "/fixture/install-target",
        }, clear=True):
            def load_runtime():
                self.assertEqual(Path.cwd(), Path(directory).resolve())
                self.assertEqual(os.environ["TERMINAL_CWD"], str(Path(directory).resolve()))
                for name in ("HERMES_SAFE_MODE", "HERMES_IGNORE_USER_CONFIG", "HERMES_IGNORE_RULES"):
                    self.assertEqual(os.environ[name], "1")
                self.assertEqual(os.environ["HERMES_YOLO_MODE"], "0")
                self.assertEqual(os.environ["TERMINAL_ENV"], "local")
                self.assertEqual(os.environ["HERMES_DISABLE_LAZY_INSTALLS"], "1")
                self.assertNotIn("HERMES_LAZY_INSTALL_TARGET", os.environ)
                self.assertFalse(any(k.startswith("HERMES_KANBAN_") for k in os.environ))
                return make_runtime()

            runtime = load_runtime  # 実 Hermes を import せず、順序も検証する。
            seen = []
            def recorded_runtime():
                modules = runtime()
                seen.append(modules)
                return modules

            with patch.object(adapter, "_load_runtime", side_effect=recorded_runtime):
                self.assertEqual(adapter.main([
                    "--model", "gpt-6-luna", "--provider", "openai-codex", "--workdir", directory,
                ]), 0)
            command = seen[0][0].cli_entry.call_args.args[0]
            self.assertIn("--oneshot-stdin", command)
            self.assertIn("-Q", command)
            self.assertEqual(command[command.index("--toolsets") + 1], adapter.READONLY_TOOLSET)
            self.assertNotIn("--safe-mode", command)  # bundled parser にこの flag はない。
            self.assertNotIn("--resume", command)
            self.assertNotIn("--yolo", command)

    def test_strict_parser_rejects_mutation_or_session_flags(self):
        for flag in ("--resume", "--yolo", "--worktree", "--skills", "--toolsets"):
            with self.subTest(flag=flag), redirect_stderr(StringIO()), self.assertRaises(SystemExit):
                adapter.main(["--model", "auto", "--workdir", "/fixture", flag, "unsafe"])

    def test_runtime_failures_have_fixed_safe_message(self):
        stderr = StringIO()
        with patch.object(adapter, "_prepare_environment"), patch.object(
            adapter, "_load_runtime", side_effect=RuntimeError("private-key-fixture"),
        ), redirect_stderr(stderr):
            self.assertEqual(adapter.main(["--model", "auto", "--workdir", "/fixture"]), 2)
        self.assertEqual(stderr.getvalue().strip(), adapter.UNAVAILABLE)
        self.assertNotIn("private-key-fixture", stderr.getvalue())

    def test_runtime_aliases_share_guard_and_conflicts_fail_closed(self):
        modules = {"cli_main": self.cli, "toolsets": self.toolsets, "agent.tool_executor": self.executor, "tools.read_extract": self.extraction}
        with patch.dict(sys.modules, {"cli": self.cli}), patch.object(
            adapter.importlib, "import_module", side_effect=modules.__getitem__,
        ):
            sys.modules.pop("core.tool_executor", None)
            try:
                self.assertEqual(adapter._load_runtime(), self.runtime)
                self.assertIs(sys.modules["core.tool_executor"], self.executor)
                sys.modules["core.tool_executor"] = object()
                with self.assertRaises(adapter.ReadonlyUnavailable):
                    adapter._load_runtime()
            finally:
                sys.modules.pop("core.tool_executor", None)
        with patch.dict(sys.modules, {"cli": object()}), patch.object(
            adapter.importlib, "import_module", side_effect=modules.__getitem__,
        ), self.assertRaises(adapter.ReadonlyUnavailable):
            adapter._load_runtime()

    def test_bundled_source_keeps_verified_dispatch_and_factory_seams(self):
        # vendor の実行/import はせず、アップデート時の seam 消失を検出する。
        tree = ast.parse((HERMES / "core" / "tool_executor.py").read_text(encoding="utf-8"))
        functions = {node.name: node for node in tree.body if isinstance(node, ast.FunctionDef)}
        for name in ("execute_tool_calls_sequential", "execute_tool_calls_concurrent"):
            self.assertTrue(any(
                isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
                and node.func.id == "_run_agent_tool_execution_middleware"
                for node in ast.walk(functions[name])
            ), name)
        setup = (HERMES / "hermes_cli" / "cli_agent_setup_mixin.py").read_text(encoding="utf-8")
        self.assertIn("from cli import", setup)
        self.assertIn("self.agent = AIAgent(", setup)
        for path in ("tools/mcp_tool.py", "hermes_cli/plugins.py"):
            self.assertIn('"HERMES_SAFE_MODE"', (HERMES / path).read_text(encoding="utf-8"))
        file_tree = ast.parse((HERMES / "tools" / "file_tools.py").read_text(encoding="utf-8"))
        read = next(node for node in file_tree.body if isinstance(node, ast.FunctionDef) and node.name == "read_file_tool")
        self.assertTrue(any(
            isinstance(node, ast.ImportFrom) and node.module == "tools.read_extract"
            and any(alias.name == "is_extractable_document" for alias in node.names)
            for node in ast.walk(read)
        ))
        self.assertTrue(any(
            isinstance(node, ast.If) and isinstance(node.test, ast.Call)
            and isinstance(node.test.func, ast.Name) and node.test.func.id == "is_extractable_document"
            and any(isinstance(child, ast.Call) and isinstance(child.func, ast.Name)
                    and child.func.id == "extract_document_bytes" for child in ast.walk(node))
            for node in ast.walk(read)
        ))


if __name__ == "__main__":
    unittest.main()
