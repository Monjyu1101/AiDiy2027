# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
"""Hermes のCLI選択は親の推論経路を通らず、CLIへ直接委譲する。"""
import ast
from contextlib import redirect_stderr
import importlib.util
import io
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
ENTRY = ROOT / "cli_main.py"
tree = ast.parse(ENTRY.read_text(encoding="utf-8"))
cls = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == "HermesCLI")
spec = importlib.util.spec_from_file_location("aidiy_cli_bridge_fixture", ROOT / "hermes_cli/aidiy_cli_bridge.py")
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


def load_ast(nodes, namespace=None):
    namespace = namespace if namespace is not None else {}
    exec(compile(ast.fix_missing_locations(ast.Module(body=nodes, type_ignores=[])), str(ENTRY), "exec"), namespace)
    return namespace


class RecordedInput(io.BytesIO):
    def close(self):
        if not self.closed:
            self.payload = self.getvalue()
        super().close()


class PassthroughTests(unittest.TestCase):
    def test_direct_dispatch_precedes_normal_credentials(self):
        method = next(node for node in cls.body if isinstance(node, ast.FunctionDef) and node.name == "chat")
        # Use the real prelude and stop at API routing, before requiring a full agent.
        end = next(i for i, node in enumerate(method.body)
                   if isinstance(node, ast.If) and "_ensure_runtime_credentials" in ast.unparse(node.test))
        probe = ast.FunctionDef(name="route", args=ast.parse("def route(self, message, images=None): pass").body[0].args,
                                body=method.body[:end + 1], decorator_list=[])
        definitions = [node for node in tree.body
                       if (isinstance(node, ast.FunctionDef) and node.name == "provider_entry_is_cli")
                       or (isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "_AIDIY_CLI_PROVIDERS" for t in node.targets))]
        route = load_ast([*definitions, probe], {"set_secret_capture_callback": Mock()})["route"]
        cli = SimpleNamespace(_aidiy_provider_slug="copilot-cli", _secret_capture_callback=Mock(),
                              _dispatch_aidiy_cli_subprocess=Mock(return_value="delegate"),
                              _ensure_runtime_credentials=Mock(return_value=False))
        self.assertEqual(route(cli, "こんにちは"), "delegate")
        cli._dispatch_aidiy_cli_subprocess.assert_called_once_with("こんにちは", images=None)
        cli._ensure_runtime_credentials.assert_not_called()
        for provider in ("openai_chat", "openai_oauth"):
            cli._aidiy_provider_slug = provider
            self.assertIsNone(route(cli, "こんにちは"))
        self.assertEqual(cli._ensure_runtime_credentials.call_count, 2)
        self.assertEqual(cli._dispatch_aidiy_cli_subprocess.call_count, 1)

    def test_cli_parameter_removed_but_flags_remain(self):
        parser_func = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "_build_arg_parser")
        parser = load_ast([parser_func])["_build_arg_parser"]()
        self.assertNotIn("--cli", parser.format_help())
        with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as rejected:
            parser.parse_args(["--cli", "chat"])
        self.assertEqual(rejected.exception.code, 2)
        args = parser.parse_args(["--read-only", "--model", "copilot_cli/same", "-z", "確認して"])
        self.assertTrue(args.read_only)
        self.assertEqual(args.model, "copilot_cli/same")
        self.assertEqual(args.oneshot, "確認して")
        self.assertTrue(parser.parse_args(["--oneshot-stdin", "-Q"]).oneshot_stdin)

    def test_bridge_keeps_reply_plain_and_emits_progress(self):
        answer = "説明 {{JSONでない}}\n以下が結果です。"
        data = b"\n".join(json.dumps(x, ensure_ascii=False).encode() for x in (
            {"type": "progress", "text": "進行中"}, {"type": "result", "ok": True, "text": answer},
        ))
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            executable = root / "backend_tools/.venv" / ("Scripts/python.exe" if bridge.os.name == "nt" else "bin/python")
            executable.parent.mkdir(parents=True)
            executable.touch()
            process = SimpleNamespace(stdin=RecordedInput(), stdout=io.BytesIO(data), wait=Mock(return_value=0),
                                      poll=Mock(return_value=0))
            progress = Mock()
            with patch.object(bridge.subprocess, "Popen", return_value=process) as spawn:
                self.assertEqual(bridge.run_cli(root, "copilot-cli", "same", "確認して", temp, "read-only", progress), answer)
                spawn.assert_called_once()
            self.assertEqual(json.loads(process.stdin.payload), {
                "provider": "copilot_cli", "model": "same", "prompt": "確認して", "project": temp, "mode": "read-only",
            })
            progress.assert_called_once_with("進行中")


if __name__ == "__main__":
    unittest.main()
