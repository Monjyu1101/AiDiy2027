# -*- coding: utf-8 -*-
#
# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""VS Code 拡張の外部 CLI モデル候補取得を確認する。"""

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "model-catalog.py"
SPEC = importlib.util.spec_from_file_location("model_catalog", SCRIPT)
catalog = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(catalog)


class ModelCatalogTest(unittest.TestCase):
    def test_diag_candidates_win_and_no_hermes_import_is_needed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / "_AIDIY" / "aidiy_diag"
            output.mkdir(parents=True)
            (output / "code_models_info.json").write_text(json.dumps({"copilot_cli": {"models": {"claude-haiku-5.5": "2026/10/07 - claude-haiku-5.5"}}}), encoding="utf-8")
            (output / "chat_models_info.json").write_text(json.dumps({"freeai_chat": {"models": {"gemini-new": "New Gemini"}}}), encoding="utf-8")
            self.assertEqual(catalog.catalog(str(root / "command_hermes" / "cli_main.py"), "copilot-cli"), {"models": [{"id": "same", "label": "same (変更なし)"}, {"id": "claude-haiku-5.5", "label": "2026/10/07 - claude-haiku-5.5"}]})
            self.assertEqual(catalog.catalog(str(root / "command_hermes" / "cli_main.py"), "freeai"), {"models": [{"id": "gemini-new", "label": "New Gemini"}]})

    def test_openrouter_paid_and_free_are_separate_providers(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / "_AIDIY" / "aidiy_diag"
            output.mkdir(parents=True)
            (output / "code_models_info.json").write_text("{}", encoding="utf-8")
            (output / "chat_models_info.json").write_text(json.dumps({
                "openrt_chat": {"models": {"vendor/paid": "Paid"}},
                "openrt_free": {"models": {"vendor/new:free": "Free"}},
            }), encoding="utf-8")
            cli = str(root / "command_hermes" / "cli_main.py")
            self.assertEqual(catalog.catalog(cli, "openrt_chat"), {"models": [{"id": "vendor/paid", "label": "Paid"}]})
            self.assertEqual(catalog.catalog(cli, "openrt_free"), {"models": [{"id": "vendor/new:free", "label": "Free"}]})
            self.assertEqual(catalog.catalog(cli, "openrt"), {"models": []})
            self.assertEqual(catalog.catalog(cli)["providers"], [{"id": "openrt_chat", "label": "OpenRouter"}, {"id": "openrt_free", "label": "OpenRouter Free"}])
            (output / "chat_models_info.json").write_text(json.dumps({"ollama_chat": {"models": {"gpt-oss:20b": "Small"}}}), encoding="utf-8")
            self.assertEqual(catalog.catalog(cli, "ollama_chat"), {"models": [{"id": "gpt-oss:20b", "label": "Small"}]})
            self.assertEqual(catalog.catalog(cli, "ollama"), {"models": []})

    def test_old_config_models_are_ignored(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config_dir = root / "_config"
            config_dir.mkdir()
            (config_dir / "AiDiy_code_codex_cli.json").write_text(
                json.dumps({"models": {"auto": "自動", "gpt-6.1-sol": "GPT 6.1 Sol"}}),
                encoding="utf-8",
            )
            models = catalog._cli_models(root, "codex-cli")

        self.assertEqual(
            [{"label": "same (変更なし)", "id": "same"}],
            models,
        )

    def test_missing_catalog_does_not_fall_back_to_bat(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config_dir = root / "_config"
            config_dir.mkdir()
            (config_dir / "AiDiy_code_grok_cli.json").write_text(
                json.dumps({"models": {"auto": "自動"}}), encoding="utf-8"
            )
            bat_dir = root / "scripts" / "cli_bat"
            bat_dir.mkdir(parents=True)
            (bat_dir / "_grok_cli.bat").write_text(
                'if "%MODEL_NUMBER%"=="1" set "MODEL=grok-4.7"\n', encoding="utf-8"
            )
            models = catalog._cli_models(root, "grok-cli")

        self.assertEqual(
            [{"label": "same (変更なし)", "id": "same"}],
            models,
        )


if __name__ == "__main__":
    unittest.main()
