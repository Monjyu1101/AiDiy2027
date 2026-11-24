# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
# https://github.com/Monjyu1101/AiDiy2027
"""Verify the documented Hydrogen Standard rates through the pricing lookup."""

from decimal import Decimal
from pathlib import Path
import importlib
import sys
import unittest
from unittest.mock import patch


class GeminiHydrogenPricingTest(unittest.TestCase):
    def test_direct_gemini_uses_hydrogen_snapshot(self):
        root = Path(__file__).resolve().parents[1]
        with patch.object(sys, "path", [str(root / "base"), str(root), *sys.path]):
            with patch.dict(sys.modules, {"agent": importlib.import_module("core")}):
                pricing = importlib.import_module("agent.usage_pricing")
                with patch.object(pricing, "fetch_endpoint_model_metadata",
                                  side_effect=AssertionError("unexpected network path")):
                    entry = pricing.get_pricing_entry(
                        "gemini-4-hydrogen", provider="gemini",
                        base_url="https://generativelanguage.googleapis.com/v1beta",
                    )
        self.assertEqual(entry.source, "official_docs_snapshot")
        self.assertEqual(entry.source_url, "https://aistudio.google.com/docs/pricing#gemini-4-hydrogen")
        self.assertEqual(
            (entry.input_cost_per_million, entry.output_cost_per_million, entry.cache_read_cost_per_million),
            (Decimal("1.50"), Decimal("7.50"), Decimal("0.075")),
        )
        self.assertIsNone(entry.cache_write_cost_per_million)


if __name__ == "__main__":
    unittest.main()
