# -*- coding: utf-8 -*-
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""aidiy_codex（command_codex をコンパイルした Codex）の Code 実行経路を合成fixtureだけで確認する。"""

import importlib.util
from pathlib import Path
import sys
from types import ModuleType
import unittest
from unittest.mock import Mock, patch


ROOT = Path(__file__).resolve().parents[2]
CORE = ROOT / "backend_server" / "AIコア"


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, {name: module}):
        spec.loader.exec_module(module)
    return module


options = load_module("aidiy_codex_options_under_test", CORE / "AI実行オプション.py")
response = load_module("aidiy_codex_response_under_test", CORE / "AI応答.py")
logging_stub = ModuleType("log_config")
logging_stub.get_logger = Mock(return_value=Mock())
pil_stub = ModuleType("PIL")
pil_stub.Image = Mock()
MODULES = {
    "AIコア": ModuleType("AIコア"),
    "AIコア.AI実行オプション": options,
    "AIコア.AI応答": response,
    "AIコア.AIコードPi出力": load_module("aidiy_codex_pi_output_under_test", CORE / "AIコードPi出力.py"),
    "log_config": logging_stub,
    "PIL": pil_stub,
}
with patch.dict(sys.modules, MODULES):
    cli = load_module("aidiy_codex_cli_under_test", CORE / "AIコード_cli.py")
    agents = load_module("aidiy_codex_agents_under_test", ROOT / "backend_tools" / "tools_proc" / "code_agents.py")
with patch.dict(sys.modules, {"httpx": ModuleType("httpx"), "log_config": logging_stub}):
    selection = load_module("aidiy_codex_selection_under_test", CORE / "AIコードモデル選択.py")


class AiDiyCodexCommandTest(unittest.TestCase):
    def setUp(self):
        # ホーム（~/.aidiy/bin）の解決に必要な環境変数は残し、上書き用の指定だけ外す。
        self.enterContext(patch.dict(cli.os.environ, {}))
        cli.os.environ.pop("AIDIY_CODEX_CLI_PATH", None)

    def make(self, model="openai_oauth/gpt-6-luna", readonly=False):
        option = options.AI実行オプション.読取専用予測() if readonly else options.AI実行オプション()
        ai = cli.CodeAI(AI_NAME="aidiy_codex", AI_MODEL=model, 絶対パス="/fixture/project", 実行オプション=option)
        ai._CLI起動コマンド先頭 = Mock(return_value=(["fixture-aidiy-codex"], False))
        return ai

    def test_executable_is_the_compiled_binary_in_home(self):
        ai = cli.CodeAI(AI_NAME="aidiy_codex", AI_MODEL="auto")
        expected = Path.home() / ".aidiy" / "bin" / ("aidiy_codex.exe" if cli.os.name == "nt" else "aidiy_codex")
        self.assertEqual(Path(ai._コマンドパス取得()), expected)
        with patch.dict(cli.os.environ, {"AIDIY_CODEX_CLI_PATH": "custom-codex"}):
            self.assertEqual(ai._コマンドパス取得(), "custom-codex")

    def test_openai_oauth_model_is_passed_to_codex_exec(self):
        ai = self.make()
        command = ai._コマンド構築("fixture prompt", 初回=True, repo_path="/fixture/project")
        self.assertEqual(command, [
            "fixture-aidiy-codex", "exec", "--skip-git-repo-check", "--dangerously-bypass-approvals-and-sandbox",
            "--model", "openai_oauth/gpt-6-luna", "fixture prompt",
        ])

    def test_resume_and_auto_follow_codex_cli(self):
        ai = self.make(model="same")
        ai.codex_セッションID = "session-1"
        command = ai._コマンド構築("next", 初回=False, repo_path="/fixture/project")
        self.assertNotIn("--model", command)
        self.assertEqual(command[-3:], ["resume", "session-1", "next"])

    def test_readonly_prediction_uses_codex_restrictions(self):
        ai = self.make(readonly=True)
        ai._予測CodexMCP設定 = ""
        ai._予測Codex検証パス = "/fixture/project"
        command = ai._コマンド構築("fixture prompt", 初回=True, repo_path="/fixture/project")
        self.assertIn("aidiy_codex", options.読取専用CLI対応方式)
        self.assertEqual(command[0], "fixture-aidiy-codex")
        self.assertIn('sandbox_mode="read-only"', command)
        self.assertEqual(command[command.index("exec"):command.index("exec") + 4],
                         ["exec", "--skip-git-repo-check", "--sandbox", "read-only"])
        self.assertEqual(command[-3:], ["--model", "openai_oauth/gpt-6-luna", "fixture prompt"])

    def test_model_choices_keep_openai_oauth_prefix(self):
        catalog = {"aidiy_codex": {
            "openai_oauth/gpt-6.1-sol": "sol", "openai_oauth/gpt-6-luna": "luna",
            "openai_oauth/gpt-6-terra": "old terra", "openai_oauth/gpt-6.1-terra": "terra",
            "gpt-6-luna": "no prefix", "gemini_chat/gemini-3-pro": "other section",
        }}
        values = {item["value"] for item in selection.model_choices("aidiy_codex", catalog)}
        self.assertEqual(values, {"openai_oauth/gpt-6.1-sol", "openai_oauth/gpt-6.1-terra", "openai_oauth/gpt-6-luna"})
        self.assertIn("aidiy_codex", selection.MODEL_INSTRUCTIONS)


class AiDiyCodexAvailabilityTest(unittest.TestCase):
    def test_uncompiled_binary_is_reported_unavailable_without_running(self):
        # 初期化（設定読込・バージョン確認）は行わず、確認処理だけを呼ぶ。
        target = agents.CodeAgents.__new__(agents.CodeAgents)
        with patch.dict(sys.modules, MODULES | {"AIコア.AIコード_cli": cli}), \
                patch.object(cli.CodeAI, "_コマンドパス取得", return_value="/missing/aidiy_codex.exe"), \
                patch.object(agents.subprocess, "run", side_effect=AssertionError("must not run")):
            info = target._probe_ai_version("aidiy_codex", {})
        self.assertFalse(info["ok"])
        self.assertIn("未コンパイル", info["version"])


if __name__ == "__main__":
    unittest.main()
