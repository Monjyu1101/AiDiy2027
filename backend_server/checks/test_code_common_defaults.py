"""Code共通設定の初期値と既存選択保持を一時JSONだけで検証する。"""
import ast
import asyncio
import re
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
    model_spec = importlib.util.spec_from_file_location('code_catalog_fixture', ROOT / 'backend_server/conf/conf_model.py')
    model_module = importlib.util.module_from_spec(model_spec)
    model_spec.loader.exec_module(model_module)

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

    def test_agy_is_opt_in_and_its_saved_models_never_fall_back(self):
        self.write({'CODE_AI1_NAME': 'agy_cli', 'CODE_AI1_MODEL': 'user-previous',
                    'CODE_AGY_CLI_MODEL': 'custom-family', 'CODE_AI4_NAME': 'antigravity_cli'})
        conf = self.load()
        self.assertEqual(self.saved()['CODE_AI4_NAME'], 'antigravity_cli')
        catalog = model_module.conf_models.__new__(model_module.conf_models)
        candidates = {'agy_cli': {'remote': 'OAuth'}, 'codex_cli': {'codex-test': 'Codex'}}
        with patch.object(catalog, '_get_diag_models', side_effect=lambda kind: candidates if kind == 'code' else {}):
            settings = create_settings(SimpleNamespace(json=conf, models=catalog))
            self.assertEqual(settings['CODE_AI1_NAME'], 'agy_cli')
            self.assertEqual(settings['CODE_AI1_MODEL'], 'user-previous')
            self.assertEqual(settings['CODE_AGY_CLI_MODEL'], 'custom-family')
            self.assertEqual(settings['CODE_AI4_NAME'], 'codex_cli')
        candidates.pop('codex_cli')
        with patch.object(catalog, '_get_diag_models', side_effect=lambda kind: candidates if kind == 'code' else {}):
            settings = create_settings(SimpleNamespace(json=conf, models=catalog))
            self.assertEqual(settings['CODE_AI4_NAME'], 'antigravity_cli')

    def test_agy_keys_are_completed_and_raw_settings_keep_api_and_cli_separate(self):
        existing = {'CHAT_AI_NAME': 'gemini_chat', 'CHAT_GEMINI_MODEL': 'api-custom',
                    'CODE_ANTIGRAVITY_CLI_MODEL': 'legacy-custom', 'custom': 'keep'}
        self.write(existing)
        config = self.load()
        self.assertEqual(self.saved()['CHAT_GEMINI_AGY_MODEL'], 'auto')
        self.assertEqual(self.saved()['CODE_AGY_CLI_MODEL'], 'auto')
        self.assertTrue(config.update({'CHAT_AI_NAME': 'gemini_agy', 'CHAT_GEMINI_AGY_MODEL': 'chat-custom',
                                       'CODE_AGY_CLI_MODEL': 'code-custom'}))
        config = self.load()
        catalog = SimpleNamespace(normalize_initial_settings=lambda _: self.fail('saved settings must not be normalized'))
        raw = create_settings(SimpleNamespace(json=config, models=catalog), 候補に正規化=False)
        for key, value in {**existing, 'CHAT_AI_NAME': 'gemini_agy', 'CHAT_GEMINI_AGY_MODEL': 'chat-custom',
                           'CODE_AGY_CLI_MODEL': 'code-custom'}.items():
            self.assertEqual(self.saved()[key], value)
            if key != 'custom':
                self.assertEqual(raw[key], value)
        self.assertNotIn('openai_key_id', raw)

    def test_settings_routes_save_and_read_agy_without_replacing_the_running_session(self):
        self.write({'CHAT_AI_NAME': 'gemini_chat', 'gemini_key_id': 'fixture-key',
                    'CODE_ANTIGRAVITY_CLI_MODEL': 'legacy-custom'})
        config = self.load()
        session_state = {'CHAT_AI_NAME': 'gemini_chat', 'CHAT_GEMINI_AGY_MODEL': 'stale'}
        session = SimpleNamespace(モデル設定=session_state)
        context = SimpleNamespace(app=SimpleNamespace(conf=SimpleNamespace(json=config, models=None)))
        routes = ROOT / 'backend_server/core_router/AIコア.py'
        env = {**namespace, 'Request': object, 'モデル情報取得リクエスト': object, 'モデル設定リクエスト': object,
               'authenticate': lambda *_: (object(), None), 'require_session_settings': lambda *_: None,
               'require_session_owner': lambda *_: None, 'AIセッション管理': SimpleNamespace(get_session=lambda _: session),
               '取得_コードベース選択肢': lambda _: {}, 'logger': logging.getLogger(__name__), 're': re}
        for node in ast.parse(routes.read_text(encoding='utf-8')).body:
            if isinstance(node, ast.AsyncFunctionDef) and node.name in ('モデル情報取得', 'モデル情報設定'):
                node.decorator_list = []
                exec(compile(ast.Module(body=[node], type_ignores=[]), str(routes), 'exec'), env)

        settings = {'CHAT_AI_NAME': 'gemini_agy', 'CHAT_GEMINI_AGY_MODEL': 'chat-custom',
                    'CODE_AI4_NAME': 'agy_cli', 'CODE_AI4_MODEL': 'slot-custom', 'CODE_AGY_CLI_MODEL': 'code-custom'}
        request = SimpleNamespace(セッションID='fixture', モデル設定=settings, 再起動要求={}, save=True, リセット=False)
        self.assertEqual(asyncio.run(env['モデル情報設定'](context, request))['status'], 'OK')
        self.assertEqual(session_state['CHAT_GEMINI_AGY_MODEL'], 'stale')
        self.assertEqual(self.saved()['gemini_key_id'], 'fixture-key')
        fake_decision = SimpleNamespace(Decision=SimpleNamespace(model_options=lambda _: {}))
        with patch.dict(sys.modules, {'AIコア.AI判断': fake_decision}):
            result = asyncio.run(env['モデル情報取得'](context, SimpleNamespace(セッションID='fixture', 保存済み=True)))
        self.assertEqual(result['status'], 'OK')
        values = result['data']['モデル設定']
        self.assertEqual({key: values[key] for key in settings}, settings)
        self.assertEqual(values['CODE_ANTIGRAVITY_CLI_MODEL'], 'legacy-custom')
        self.assertNotIn('gemini_key_id', values)

    def test_reloading_new_file_does_not_rewrite(self):
        self.load()
        before = self.path.read_bytes()
        with patch.object(module.os, 'replace', side_effect=AssertionError('unexpected rewrite')):
            self.load()
        self.assertEqual(self.path.read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
