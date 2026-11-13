# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""セットアップの技術名表示と重要な確認・結果を、実処理なしで検証する。"""
import contextlib
import importlib.util
import io
import re
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))


def load(folder):
    path = ROOT / folder / "_setup.py"
    spec = importlib.util.spec_from_file_location("message_test_" + folder.replace("/", "_"), path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class InventoryCaptured(Exception):
    pass


class SetupMessageTests(unittest.TestCase):
    def test_skipped_ai_cli_has_section_header_and_blank_before_manual_commands(self):
        module = load("")
        # 手動コマンドの既存出力を基準にし、コマンド文字列自体は変えない。
        with patch.object(module, "check_npm_installed", return_value=True), patch.object(module, "npm_command", return_value="npm"), patch.object(module.subprocess, "Popen") as popen:
            with contextlib.redirect_stdout(io.StringIO()) as manual:
                module.print_ai_cli_manual_setup()
            with contextlib.redirect_stdout(io.StringIO()) as output:
                result = module.setup_common_global_tools({"common_python_upgrade": False, "common_npm_install": False})
        clean = re.sub(r"\x1b\[[0-9;]*m", "", output.getvalue())
        header = "=" * 60 + "\nAI CLI ツール セットアップ\n" + "=" * 60
        self.assertIn(header, clean)
        self.assertEqual(clean.count("AI CLI ツール セットアップ"), 1)
        self.assertIn("[WARN] 共通: AI CLI ツールのインストールをスキップしました。\n\n[INFO] AI CLI: 手動導入コマンド", clean)
        self.assertTrue(output.getvalue().endswith(manual.getvalue()))
        self.assertEqual(result, [])
        popen.assert_not_called()

    def test_install_path_keeps_one_existing_header_without_skip_section(self):
        module = load("")
        with patch.object(module, "check_npm_installed", return_value=True), patch.object(module, "npm_command", return_value="npm"), patch.object(module, "prepare_antigravity_installer", return_value=(None, None)), patch.object(module, "prepare_grok_build_installer", return_value=(None, None)), patch.object(module.subprocess, "Popen") as popen, contextlib.redirect_stdout(io.StringIO()) as output:
            module.setup_common_global_tools({"common_python_upgrade": False, "common_npm_install": True})
        clean = re.sub(r"\x1b\[[0-9;]*m", "", output.getvalue())
        self.assertEqual(clean.count("AI CLI: 導入開始"), 1)
        self.assertNotIn("AI CLI ツール セットアップ", clean)
        self.assertNotIn("AI CLI: 手動導入コマンド", clean)
        self.assertEqual(popen.call_count, 4)
        self.assertEqual(popen.call_args_list[0].args[0], ["npm", "install", "-g", "@anthropic-ai/claude-code"])

    def test_component_inventories_list_technologies_without_role_descriptions(self):
        inventories = {
            "frontend_diag": ("Diag", "Node.js / Electron / Vue 3"),
            "backend_local": ("Local", "Python / uv / FastAPI / PyTorch / Transformers / Gemma"),
            "backend_tools": ("Tools", "Python / uv / FastAPI / MCP"),
            "backend_server": ("Core / Apps", "Python / uv / FastAPI / SQLAlchemy / SQLite"),
            "backend_taskteam": ("Task / Team", "Python / uv / FastAPI / SQLite"),
            "frontend_web": ("Web", "Node.js / Vue 3 / Vite / TypeScript"),
            "frontend_avatar": ("Avatar", "Node.js / Vue 3 / Vite / TypeScript / Electron"),
            "command_hermes": ("Hermes", "Python / uv / Hermes CLI"),
            "command_pi": ("Pi", "Node.js / npm / Pi CLI"),
            "frontend_ide/host": ("Code / Live", "Node.js / Vue 3 / TypeScript / Electron / VS Code / VSIX"),
            "frontend_ide/viewer": ("IDE", "Node.js / Electron / Monaco Editor / docx-preview / SheetJS / PptxViewJS / PDF.js"),
            "frontend_channels/discord": ("Discord", "Discord / Node.js / Vue 3 / TypeScript / Electron"),
        }
        for folder, (label, technologies) in inventories.items():
            with self.subTest(folder=folder), contextlib.ExitStack() as stack:
                module = load(folder)
                output = stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
                original = module.print_info

                def capture(message):
                    original(message)
                    if message.startswith("対象:"):
                        raise InventoryCaptured(message)

                stack.enter_context(patch.object(module, "print_info", side_effect=capture))
                # 表示より先に処理が移動しても、実環境の変更を許さない。
                for name in ("run", "Popen"):
                    stack.enter_context(patch.object(subprocess, name, side_effect=AssertionError("process forbidden")))
                for name in ("mkdir", "write_text", "write_bytes", "unlink"):
                    stack.enter_context(patch.object(Path, name, side_effect=AssertionError("write forbidden")))
                with self.assertRaises(InventoryCaptured) as caught:
                    module.setup()
                self.assertEqual(str(caught.exception), "対象: " + technologies)
                self.assertIn(label + " セットアップ", output.getvalue())
                self.assertNotIn("単独起動ランチャー", output.getvalue())

    def test_choices_keep_confirmation_scope_defaults_and_download_warning(self):
        module = load("")
        prompts = []

        def yes_no(prompt, default="n"):
            prompts.append((prompt, default))
            return default == "y"

        with patch.object(module, "ask_start_mode", return_value=(True, False)), \
                patch.object(module, "ask_yes_no", side_effect=yes_no), \
                patch.object(module, "ask_download_mode", return_value="no") as download, \
                contextlib.redirect_stdout(io.StringIO()) as output:
            choices = module.collect_setup_choices()
        self.assertTrue(choices["diag"])
        self.assertTrue(choices["mcp_config"])
        self.assertFalse(choices["common_npm_install"])
        self.assertIn(("Tools: MCP 設定を各クライアントのグローバル設定へ書き込みますか？", "y"), prompts)
        self.assertTrue(any("グローバル環境" in prompt and "インストール/アップデート" in prompt for prompt, _ in prompts))
        self.assertIn(("エラーが発生しても続行しますか？", "y"), prompts)
        self.assertIn("劇遅注意", download.call_args.args[0])
        self.assertEqual(download.call_args.kwargs["default"], "n")
        self.assertIn("Diag / Electron: セットアップ [y]", output.getvalue())
        self.assertNotIn("最初に実行項目をまとめて選択", output.getvalue())

    def test_summary_preserves_error_locations_and_result_markers(self):
        module = load("")
        with contextlib.redirect_stdout(io.StringIO()) as output:
            module.print_setup_summary(["Code / Live: fixture"])
            module.print_error("fixture failure")
        self.assertIn("[WARN]", output.getvalue())
        self.assertIn("Code / Live: fixture", output.getvalue())
        self.assertIn("[NG] fixture failure", output.getvalue())
        with contextlib.redirect_stdout(io.StringIO()) as output:
            module.print_setup_summary([])
        self.assertIn("[OK]", output.getvalue())


if __name__ == "__main__":
    unittest.main()
