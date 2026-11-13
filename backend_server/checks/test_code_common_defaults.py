"""Code共通設定の初期値と既存選択保持を一時JSONだけで検証する。"""
import ast
import importlib.util
import json
import logging
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
with patch.dict(sys.modules, {'log_config': SimpleNamespace(get_logger=logging.getLogger)}):
    spec = importlib.util.spec_from_file_location('code_defaults_fixture', ROOT / 'backend_server/conf/conf_json.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

# セッション生成関数のみを実行し、音声・WebSocket・外部SDKを起動しない。
source = ROOT / 'backend_server/AIコア/AIセッション管理.py'
tree = ast.parse(source.read_text(encoding='utf-8'))
function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == '初期モデル設定生成')
namespace = {}
exec(compile(ast.Module(body=[function], type_ignores=[]), str(source), 'exec'), namespace)
create_settings = namespace['初期モデル設定生成']


class CodeCommonDefaultsTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.path = Path(tmp.name) / 'AiDiy_key.json'

    def write(self, data):
        self.path.write_text(json.dumps(data), encoding='utf-8')

    def load(self):
        return module.conf_json(str(self.path))

    def saved(self):
        return json.loads(self.path.read_text(encoding='utf-8-sig'))

    def test_new_file_uses_hermes_auto(self):
        conf = self.load()
        for settings in (self.saved(), create_settings(SimpleNamespace(json=conf))):
            self.assertEqual(settings['CODE_AI1_NAME'], 'aidiy_hermes')
            self.assertEqual(settings['CODE_AI1_MODEL'], 'auto')
            self.assertEqual(settings['CODE_AIDIY_HERMES_MODEL'], 'auto')

    def test_existing_choices_are_not_migrated(self):
        for provider, model in [('codex_cli', 'auto'), ('copilot_cli', 'saved-model'), ('aidiy_hermes', 'saved/model'), ('future-provider', 'future-model'), ('', '')]:
            with self.subTest(provider=provider, model=model):
                original = dict(module.conf_json.DEFAULT_CONFIG, CODE_AI1_NAME=provider, CODE_AI1_MODEL=model)
                self.write(original)
                before = self.path.read_bytes()
                with patch.object(module.os, 'replace', side_effect=AssertionError('unexpected rewrite')):
                    conf = self.load()
                self.assertEqual(self.path.read_bytes(), before)
                settings = create_settings(SimpleNamespace(json=conf))
                self.assertEqual(settings['CODE_AI1_NAME'], provider)
                self.assertEqual(settings['CODE_AI1_MODEL'], model)

    def test_missing_keys_only_are_completed(self):
        self.write({'CODE_AI1_NAME': 'codex_cli', 'custom': 'keep'})
        self.load()
        self.assertEqual(self.saved()['CODE_AI1_NAME'], 'codex_cli')
        self.assertEqual(self.saved()['CODE_AI1_MODEL'], 'auto')
        self.assertEqual(self.saved()['custom'], 'keep')
        self.write({'CODE_AI1_MODEL': 'saved-model'})
        self.load()
        self.assertEqual(self.saved()['CODE_AI1_NAME'], 'aidiy_hermes')
        self.assertEqual(self.saved()['CODE_AI1_MODEL'], 'saved-model')

    def test_other_slots_and_task_team_defaults_unchanged(self):
        self.load()
        for index, provider, model in [(2, 'copilot_cli', 'auto'), (3, 'claude_cli', 'auto'), (4, 'antigravity_cli', 'same'), (5, 'opencode_cli', 'auto'), (6, 'aidiy_hermes', 'auto')]:
            self.assertEqual(self.saved()[f'CODE_AI{index}_NAME'], provider)
            self.assertEqual(self.saved()[f'CODE_AI{index}_MODEL'], model)
        for key in ('TASK_AI_NAME', 'TEAM_AI_NAME'):
            self.assertEqual(self.saved()[key], 'codex_cli')

    def test_session_missing_key_fallback_matches_common_defaults(self):
        settings = create_settings(SimpleNamespace(json={}))
        for key in ('CODE_AI1_NAME', 'CODE_AI1_MODEL', 'CODE_AIDIY_HERMES_MODEL', 'CODE_AIDIY_PI_MODEL'):
            self.assertEqual(settings[key], module.conf_json.DEFAULT_CONFIG[key])

    def test_pi_model_is_kept_before_catalog_normalization(self):
        expected = 'openai_oauth/pi-saved-model'
        def normalize(settings):
            self.assertEqual(settings['CODE_AIDIY_PI_MODEL'], expected)
            return settings
        settings = create_settings(SimpleNamespace(
            json={'CODE_AIDIY_PI_MODEL': expected},
            models=SimpleNamespace(normalize_initial_settings=normalize)))
        self.assertEqual(settings['CODE_AIDIY_PI_MODEL'], expected)

    def test_reloading_new_file_does_not_rewrite(self):
        self.load()
        before = self.path.read_bytes()
        with patch.object(module.os, 'replace', side_effect=AssertionError('unexpected rewrite')):
            self.load()
        self.assertEqual(self.path.read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
