# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""MCP設定の表示統一を、一時設定とプロセス実行禁止で検証する。"""
import contextlib
import builtins
import importlib.util
import io
from pathlib import Path
import re
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]


def load_setup():
    spec = importlib.util.spec_from_file_location("mcp_message_test", ROOT / "backend_tools/_setup.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class McpMessageTests(unittest.TestCase):
    @contextlib.contextmanager
    def execution(self):
        module = load_setup()
        with tempfile.TemporaryDirectory() as directory, contextlib.ExitStack() as stack:
            home = Path(directory)
            stack.enter_context(patch.object(Path, "home", return_value=home))
            stack.enter_context(patch.object(module, "CONFIG_DIR", home / "project"))
            stack.enter_context(patch.dict(module.os.environ, {"COPILOT_HOME": str(home / "copilot")}))
            for function, relative in (
                ("get_grok_config_path", "grok/config.toml"),
                ("get_antigravity_mcp_config_path", "antigravity.json"),
                ("get_opencode_config_path", "opencode.json"),
                ("get_vscode_mcp_path", "vscode.json"),
                ("get_vscode_chat_models_path", "chat.json"),
            ):
                stack.enter_context(patch.object(module, function, return_value=home / relative))
            stack.enter_context(patch.object(module, "upsert_vscode_chat_completions", return_value=True))
            for name in ("run", "Popen"):
                stack.enter_context(patch.object(module.subprocess, name, side_effect=AssertionError("process forbidden")))
            output = stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
            yield module, home, output

    def summaries(self, output, path):
        clean = re.sub(r"\x1b\[[0-9;]*m", "", output.getvalue())
        prefix = f"[OK] MCP設定を書き込みました: {path} ("
        return [line for line in clean.splitlines() if line.startswith(prefix)]

    def test_success_is_one_ordered_summary_per_client_and_toml_is_unchanged(self):
        with self.execution() as (module, home, output):
            paths = (home / ".codex/config.toml", home / "grok/config.toml")
            original = '# 利用者の設定\nmodel = "fixture"\n\n[mcp_servers.other]\nurl = "https://example.invalid/mcp"\n'
            for path in paths:
                path.parent.mkdir(parents=True)
                path.write_text(original, encoding="utf-8")
            self.assertTrue(module.configure_clients())
            servers = [(module.MODULE["server_name"], module.MODULE["sse_url"])] + [
                (item["server_name"], item["sse_url"]) for item in module.MODULE["extra_servers"]
                if module.sys.platform in item.get("platforms", [module.sys.platform])
            ]
            for client, path in zip(("codex", "grok"), paths):
                selected = [(name, url) for name, url in servers if client != "codex" or name not in module.CODE_CLI_MCP_EXCLUDE]
                names = ", ".join(name for name, _ in selected)
                self.assertEqual(self.summaries(output, path), [f"[OK] MCP設定を書き込みました: {path} ({names})"])
                expected = original
                for name, url in selected:
                    body = (f'url = "{url.removesuffix("/sse")}/mcp"\nstartup_timeout_sec = 60\n' if client == "codex"
                            else f'url = "{url}"\ntype = "sse"\nenabled = true\n')
                    expected = expected.rstrip() + f"\n\n[mcp_servers.{name}]\n" + body
                self.assertEqual(path.read_text(encoding="utf-8"), expected)
            self.assertNotIn("Codex の aidiy_", output.getvalue())
            self.assertNotIn("Grok の aidiy_", output.getvalue())

    def test_partial_failure_only_lists_successes_and_continues(self):
        with self.execution() as (module, home, output):
            original_write = module.upsert_toml_table

            def write(path, header, body):
                if header == "[mcp_servers.aidiy_desktop_capture]":
                    module.print_error(f"TOML設定更新エラー: {path} (fixture)")
                    return False
                return original_write(path, header, body)

            with patch.object(module, "upsert_toml_table", side_effect=write):
                self.assertFalse(module.configure_clients())
            for path in (home / ".codex/config.toml", home / "grok/config.toml"):
                summaries = self.summaries(output, path)
                self.assertEqual(len(summaries), 1)
                self.assertNotIn("aidiy_desktop_capture", summaries[0])
                self.assertIn("aidiy_team_agents", summaries[0])
            self.assertEqual(output.getvalue().count("TOML設定更新エラー:"), 2)
            self.assertIn("一部設定ファイルの書き込みに失敗しました。", output.getvalue())
            self.assertTrue((home / "vscode.json").exists())

    def test_all_toml_writes_fail_without_success_summary(self):
        with self.execution() as (module, home, output):
            with patch.object(module, "upsert_toml_table", return_value=False) as write:
                self.assertFalse(module.configure_clients())
            self.assertGreater(write.call_count, 2)
            for path in (home / ".codex/config.toml", home / "grok/config.toml"):
                self.assertEqual(self.summaries(output, path), [])
            self.assertIn("一部設定ファイルの書き込みに失敗しました。", output.getvalue())

    def status_lines(self, module, output):
        output.seek(0)
        output.truncate(0)
        # 状態表示は読み取り専用。今後の変更でも実書込を許さない。
        with patch.object(Path, "write_text", side_effect=AssertionError("write forbidden")):
            module.show_current_config()
        clean = re.sub(r"\x1b\[[0-9;]*m", "", output.getvalue())
        return [line for line in clean.splitlines() if "[グローバル " in line]

    def test_status_missing_files_has_one_line_per_client(self):
        with self.execution() as (module, _, output):
            lines = self.status_lines(module, output)
            self.assertEqual(len(lines), 7)
            self.assertTrue(all("未設定 (ファイルなし)" in line for line in lines))

    def test_status_missing_sections_and_malformed_files_are_not_repeated(self):
        for invalid in (False, True):
            with self.subTest(invalid=invalid), self.execution() as (module, home, output):
                json_path = home / ".claude.json"
                toml_path = home / ".codex/config.toml"
                toml_path.parent.mkdir(parents=True)
                json_path.write_text("{broken" if invalid else "{}", encoding="utf-8")
                toml_path.write_text("[broken" if invalid else 'model = "fixture"', encoding="utf-8")
                lines = self.status_lines(module, output)
                self.assertEqual(len(lines), 7)
                affected = [line for line in lines if "(Claude Code)" in line or "(Codex CLI)" in line]
                self.assertEqual(len(affected), 2)
                self.assertTrue(all("読み取りエラー" in line if invalid else "なし／形式不正" in line for line in affected))

    def test_status_full_and_partial_respect_client_exclusions(self):
        with self.execution() as (module, home, output):
            self.assertTrue(module.configure_clients())
            lines = self.status_lines(module, output)
            self.assertEqual(len(lines), 7)
            total = 1 + sum(module.sys.platform in item.get("platforms", [module.sys.platform]) for item in module.MODULE["extra_servers"])
            for line in lines:
                excluded = 1 if "(Codex CLI)" in line or "(Antigravity)" in line else 2 if "(VS Code)" in line else 0
                self.assertIn(f"設定済み{total - excluded}件／未設定0件", line)
                self.assertIn("[OK]", line)
            for path, content in (
                (home / ".claude.json", '{"mcpServers": {"aidiy_chrome_devtools": {}, "other": {}}}'),
                (home / ".codex/config.toml", '[mcp_servers.aidiy_chrome_devtools]\nurl = "fixture"'),
            ):
                path.write_text(content, encoding="utf-8")
            lines = self.status_lines(module, output)
            claude = next(line for line in lines if "(Claude Code)" in line)
            codex = next(line for line in lines if "(Codex CLI)" in line)
            self.assertIn(f"設定済み1件／未設定{total - 1}件", claude)
            self.assertIn(f"設定済み1件／未設定{total - 2}件", codex)
            self.assertIn("[WARN]", claude)
            self.assertIn("[WARN]", codex)

    def test_missing_tomllib_keeps_module_import_and_json_status_available(self):
        original_import = builtins.__import__

        def import_without_tomllib(name, *args, **kwargs):
            if name == "tomllib":
                raise ModuleNotFoundError("No module named 'tomllib'", name="tomllib")
            return original_import(name, *args, **kwargs)

        with patch.object(builtins, "__import__", side_effect=import_without_tomllib):
            with self.execution() as (module, home, output):
                self.assertIsNone(module.tomllib)
                # TOML解析不能でも既存の書込処理と全体結果は変えない。
                self.assertTrue(module.configure_clients())
                lines = self.status_lines(module, output)
                self.assertEqual(len(lines), 7)
                toml_lines = [line for line in lines if "(Codex CLI)" in line or "(Grok CLI)" in line]
                self.assertEqual(len(toml_lines), 2)
                self.assertTrue(all("[WARN]" in line and "設定確認をスキップ" in line for line in toml_lines))
                json_lines = [line for line in lines if line not in toml_lines]
                self.assertTrue(all("[OK]" in line and "未設定0件" in line for line in json_lines))

    def test_toml_io_error_keeps_existing_error_and_false_result(self):
        with self.execution() as (module, _, output):
            with patch.object(Path, "write_text", side_effect=OSError("fixture denied")):
                self.assertFalse(module.upsert_codex_backend_tools_config(module.MODULE))
                self.assertFalse(module.upsert_grok_backend_tools_config(module.MODULE))
            self.assertEqual(output.getvalue().count("TOML設定更新エラー:"), 2)
            self.assertNotIn("[OK]", output.getvalue())


if __name__ == "__main__":
    unittest.main()
