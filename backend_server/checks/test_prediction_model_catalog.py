# -*- coding: utf-8 -*-
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""予測モデル候補の公開を、実設定・API・DBに触れずに確認する。"""

import importlib.util
import json
from pathlib import Path
import sys
from types import ModuleType
import unittest
from unittest.mock import Mock, mock_open, patch


SOURCE = Path(__file__).resolve().parents[1] / "conf" / "conf_model.py"
SPEC = importlib.util.spec_from_file_location("prediction_catalog_under_test", SOURCE)
catalog = importlib.util.module_from_spec(SPEC)
logging_stub = ModuleType("log_config")
logging_stub.get_logger = Mock(return_value=Mock())
with patch.dict(sys.modules, {"log_config": logging_stub}):
    SPEC.loader.exec_module(catalog)

CLI_MODELS = {
    "codex_cli": {"codex-test": "Codex test"},
    "copilot_cli": {"copilot-test": "Copilot test"},
    "aidiy_hermes": {"openai_oauth/hermes-test": "Hermes test"},
}
CHAT_MODELS = {
    "openai_oauth": {"oauth-test": "OAuth test"},
    "freeai_chat": {"freeai-test": "FreeAI test"},
    "openai_chat": {"openai-test": "OpenAI test"},
    "gemini_chat": {"gemini-test": "Gemini test"},
}


class PredictionModelCatalogTest(unittest.TestCase):
    def setUp(self):
        # __init__ のMCP設定読込も避け、合成JSONだけをモックする。
        self.models = object.__new__(catalog.conf_models)

    def read_catalog(self, payload):
        source = mock_open(read_data=json.dumps(payload, ensure_ascii=False))
        with patch("builtins.open", source):
            result = self.models.get_prediction_models()
        source.assert_called_once()
        self.assertEqual(Path(source.call_args.args[0]).name, "prediction_models_info.json")
        self.assertEqual(source.call_args.kwargs, {"encoding": "utf-8-sig"})
        return result

    def test_cli_only_catalogs_are_exposed(self):
        for provider, models in CLI_MODELS.items():
            with self.subTest(provider=provider):
                self.assertEqual(
                    self.read_catalog({provider: {"models": models}}),
                    {provider: models},
                )

    def test_mixed_catalog_preserves_all_seven_providers(self):
        expected = {**CHAT_MODELS, **CLI_MODELS}
        payload = {provider: {"models": models} for provider, models in expected.items()}
        self.assertEqual(self.read_catalog(payload), expected)

    def test_model_validation_is_unchanged_for_cli_and_chat(self):
        invalid = {
            "": "Empty", "auto": "Auto", "same": "Same", " padded ": "Padded",
            "bad\nmodel": "Control", "bad\x7fmodel": "Delete", "x" * 201: "Long",
            "bad-label": 123,
        }
        expected = {**CHAT_MODELS, **CLI_MODELS}
        payload = {
            provider: {"models": {**invalid, **models}}
            for provider, models in expected.items()
        }
        payload["unknown_cli"] = {"models": {"unknown-test": "Unknown"}}
        self.assertEqual(self.read_catalog(payload), expected)

    def test_empty_or_malformed_provider_is_not_filled_in(self):
        self.assertEqual(self.read_catalog({
            "codex_cli": {"models": {}},
            "copilot_cli": {"models": []},
            "aidiy_hermes": None,
            "openai_chat": {"models": {"auto": "Auto"}},
        }), {})


if __name__ == "__main__":
    unittest.main()
