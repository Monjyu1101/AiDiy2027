# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""Terra改名後のHermes経路を、通信せず検証する。

実行: command_hermes/.venv/bin/python scripts/checks/test_terra_model.py
"""
import sys
import unittest
from pathlib import Path

HERMES = Path(__file__).resolve().parents[2] / "command_hermes"
sys.path[:0] = [str(HERMES / "base"), str(HERMES)]
try:
    import yaml  # noqa: F401  Hermes の依存。ルートの Python には無い。
except ImportError:
    raise unittest.SkipTest('Hermes の依存が無い環境（command_hermes/.venv の Python で実行）')
import core
sys.modules.setdefault("agent", core)
from core.model_metadata import is_codex_900k_base, strip_codex_context_variant_suffix
from core.native_compaction import is_native_compaction_model
from core.reasoning_effort import codex_supported_efforts
from hermes_cli.codex_models import DEFAULT_CODEX_MODELS


class TerraModelTests(unittest.TestCase):
    def test_current_default(self):
        self.assertIn("gpt-6.1-terra", DEFAULT_CODEX_MODELS)
        self.assertEqual([m for m in DEFAULT_CODEX_MODELS if "terra" in m], ["gpt-6.1-terra"])

    def test_family_routes(self):
        for model in ("gpt-6.1-terra", "openai/gpt-6.1-terra", "gpt-6.1-terra-2026-10-27"):
            with self.subTest(model=model):
                self.assertTrue(is_codex_900k_base(model))
                self.assertIn("max", codex_supported_efforts(model))
                self.assertTrue(is_native_compaction_model(model))

    def test_context_alias_is_not_sent_on_wire(self):
        self.assertEqual(strip_codex_context_variant_suffix("gpt-6.1-terra-900k"), "gpt-6.1-terra")

    def test_unsupported_context_variants_stay_excluded(self):
        for model in ("gpt-6.1-terra-pro", "gpt-6.1-terra-mini", "gpt-6.1-terra-foo"):
            with self.subTest(model=model):
                self.assertFalse(is_codex_900k_base(model))


if __name__ == "__main__":
    unittest.main()
