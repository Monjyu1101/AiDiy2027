"""Current curated IDs; historical metadata is intentionally not rewritten."""
import ast
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]

class CurrentModelDefaultsTests(unittest.TestCase):
    def test_initial_model_and_oauth_fallback(self):
        tree = ast.parse((ROOT / "cli_main.py").read_text(encoding="utf-8"))
        values = {n.targets[0].id: ast.literal_eval(n.value) for n in tree.body
                  if isinstance(n, ast.Assign) and isinstance(n.targets[0], ast.Name)
                  and n.targets[0].id in {"_AIDIY_INITIAL_MODEL", "_OPENAI_OAUTH_FALLBACK_MODEL"}}
        self.assertEqual(values["_AIDIY_INITIAL_MODEL"], "openai_oauth/gpt-6.2-sol")
        self.assertEqual(values["_OPENAI_OAUTH_FALLBACK_MODEL"], "gpt-6.2-sol")

    def test_curated_and_forward_compat_models(self):
        spec = importlib.util.spec_from_file_location("codex_models", ROOT / "hermes_cli/codex_models.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.assertEqual(module.DEFAULT_CODEX_MODELS[:2], ["gpt-6.2-astra", "gpt-6.2-sol"])
        models = module._add_forward_compat_models(["gpt-6.1-sol", "gpt-6-astra"])
        for model in ["gpt-6.2-sol", "gpt-6.2-astra", "gpt-6.1-sol", "gpt-6-astra"]:
            self.assertIn(model, models)

if __name__ == "__main__":
    unittest.main()
