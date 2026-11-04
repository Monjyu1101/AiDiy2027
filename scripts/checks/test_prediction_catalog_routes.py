# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""古い予測カタログも実設定・SDK・APIなしで安全に絞る。"""
import ast
import json
from pathlib import Path
import tempfile
import types
import unittest

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'backend_tools/tools_proc/prediction_llm.py'
CASES = json.loads(Path(__file__).with_name('prediction_route_cases.json').read_text())


def runtime(root, catalog, config=None):
    names = {'CLI_PROVIDERS', 'PROVIDERS', 'AUTO_PROVIDERS', 'MODEL_KEYS', 'HERMES_UNSUPPORTED_PREDICTION_ROUTES'}
    tree = ast.parse(SOURCE.read_text())
    nodes = [n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == 'PredictionLLM'
             or isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id in names for t in n.targets)]
    env = dict(Path=Path, json=json)
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(SOURCE), 'exec'), env)
    obj = object.__new__(env['PredictionLLM'])
    obj.root = Path(root)
    obj._chat = types.SimpleNamespace(_load_key_json=lambda: config or {})
    path = obj.root / '_AIDIY/aidiy_diag/prediction_models_info.json'
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps(catalog))
    return obj


class CatalogTests(unittest.TestCase):
    def test_stale_catalog_filters_known_unsupported_only(self):
        with tempfile.TemporaryDirectory() as root:
            models = {model: model for model in CASES['rejected'] + CASES['allowed']}
            obj = runtime(root, {'aidiy_hermes': {'models': models}})
            self.assertEqual(list(obj._catalog()['aidiy_hermes']['models']), CASES['allowed'])
            self.assertEqual(obj._resolve('aidiy_hermes', 'auto'), ('aidiy_hermes', CASES['allowed'][0]))
            for model in CASES['rejected']:
                with self.subTest(model=model), self.assertRaises(ValueError):
                    obj._resolve('aidiy_hermes', model)

    def test_auto_skips_empty_hermes_but_explicit_choice_does_not_fallback(self):
        with tempfile.TemporaryDirectory() as root:
            obj = runtime(root, {'aidiy_hermes': {'models': {'copilot_cli/same': 'x'}},
                                 'openai_chat': {'models': {'safe': 'safe'}}})
            self.assertEqual(obj._resolve('auto', 'auto'), ('openai_chat', 'safe'))
            with self.assertRaises(ValueError):
                obj._resolve('aidiy_hermes', 'auto')

    def test_stale_explicit_config_is_rejected_not_silently_changed(self):
        with tempfile.TemporaryDirectory() as root:
            obj = runtime(root, {'aidiy_hermes': {'models': {'copilot_cli/same': 'x', 'openai_oauth/gpt': 'y'}}},
                          {'PREDICTION_AI_NAME': 'aidiy_hermes', 'PREDICTION_AIDIY_HERMES_MODEL': 'copilot_cli/same'})
            with self.assertRaises(ValueError):
                obj._resolve('auto', 'auto')

    def test_supported_direct_cli_priority_unchanged(self):
        with tempfile.TemporaryDirectory() as root:
            obj = runtime(root, {'codex_cli': {'models': {'gpt': 'gpt'}},
                                 'aidiy_hermes': {'models': {'openai_oauth/gpt': 'y'}}})
            self.assertEqual(obj._resolve('auto', 'auto'), ('codex_cli', 'gpt'))


if __name__ == '__main__':
    unittest.main()
