# -*- coding: utf-8 -*-
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
"""Gemini Chatの初期値だけを隔離確認。実設定・API・SDKを使わない。"""
import ast
import importlib.util
import json
import logging
from pathlib import Path
import re
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

HYDROGEN = "gemini-4-hydrogen"
MODEL_KEYS = [f"{family}_{vendor}_MODEL" for family in ("CHAT", "PREDICTION", "DECISION")
              for vendor in ("GEMINI_AGY", "GEMINI", "FREEAI")]
ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("gemini_defaults_fixture", ROOT / "backend_server/conf/conf_json.py")
module = importlib.util.module_from_spec(spec)
with patch.dict(sys.modules, {"log_config": SimpleNamespace(get_logger=logging.getLogger)}):
    spec.loader.exec_module(module)


class GeminiChatDefaultsTests(unittest.TestCase):
    def test_new_and_missing_settings_use_hydrogen_but_existing_settings_survive(self):
        for existing in ({}, {"CHAT_FREEAI_MODEL": "gemini-4-carbon", "CHAT_GEMINI_MODEL": "custom-image",
                             "PREDICTION_GEMINI_MODEL": "old-prediction", "DECISION_GEMINI_MODEL": "old-decision",
                             "PREDICTION_GEMINI_AGY_MODEL": "custom-agy", "DECISION_GEMINI_AGY_MODEL": "custom-decision"},
                         {key: "auto" for key in MODEL_KEYS}, {"CHAT_AI_NAME": "openai_oauth"}):
            with self.subTest(existing=existing), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "AiDiy_key.json"
                if existing:
                    path.write_text(json.dumps(existing), encoding="utf-8")
                config = module.conf_json(str(path))
                persisted = json.loads(path.read_text(encoding="utf-8"))
                keys = list(persisted)
                for family in ("PREDICTION", "DECISION"):
                    self.assertEqual(keys.index(f"{family}_GEMINI_AGY_MODEL") + 1, keys.index(f"{family}_GEMINI_MODEL"))
                for key in MODEL_KEYS:
                    self.assertEqual(config.get(key), existing.get(key, HYDROGEN), key)
                    self.assertEqual(persisted[key], existing.get(key, HYDROGEN), key)
                for key, default in (("CHAT_AI_NAME", "freeai_chat"), ("PREDICTION_AI_NAME", "auto"),
                                     ("DECISION_AI_NAME", "auto"), ("PREDICTION_OPENAI_MODEL", "auto"),
                                     ("PREDICTION_OPENAI_OAUTH_MODEL", "auto"), ("DECISION_OPENAI_MODEL", "auto"),
                                     ("DECISION_OPENAI_OAUTH_MODEL", "auto")):
                    self.assertEqual(config.get(key), existing.get(key, default))

    def test_legacy_oauth_keys_do_not_supply_new_defaults(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "AiDiy_key.json"
            legacy = {f"{family}_OAUTH" + "_MODEL": "old-value" for family in ("PREDICTION", "DECISION")}
            path.write_text(json.dumps(legacy), encoding="utf-8")
            values = module.conf_json(str(path))
            for family in ("PREDICTION", "DECISION"):
                self.assertEqual(values.get(f"{family}_OPENAI_OAUTH_MODEL"), "auto")
            persisted = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual({key: persisted[key] for key in legacy}, legacy)

    def test_live_migrates_only_generated_model_defaults(self):
        for key, previous in module.旧Liveモデル既定値.items():
            with self.subTest(key=key), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "AiDiy_key.json"
                other = "LIVE_FREEAI_MODEL" if key == "LIVE_GEMINI_MODEL" else "LIVE_GEMINI_MODEL"
                path.write_text(json.dumps({key: previous, other: "custom-live"}), encoding="utf-8")
                config = module.conf_json(str(path))
                self.assertEqual(config.get(key), "gemini-3.8-live")
                self.assertEqual(config.get(other), "custom-live")
                self.assertEqual(json.loads(path.read_text(encoding="utf-8"))[key], "gemini-3.8-live")
                self.assertEqual(module.GeminiLive設定モデル(other, previous), previous)
                self.assertEqual(module.GeminiLive設定モデル(key, f"models/{previous}"), "gemini-3.8-live")
                self.assertEqual(module.GeminiLive設定モデル(other, f"models/{previous}"), f"models/{previous}")

    def test_session_and_avatar_fallbacks_match_config(self):
        path = ROOT / "backend_server/AIコア/AIセッション管理.py"
        tree = ast.parse(path.read_text(encoding="utf-8"))
        function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "初期モデル設定生成")
        namespace = {}
        exec(compile(ast.Module(body=[function], type_ignores=[]), str(path), "exec"), namespace)
        create = namespace["初期モデル設定生成"]
        self.assertEqual({key: create(SimpleNamespace(json={}))[key] for key in MODEL_KEYS}, dict.fromkeys(MODEL_KEYS, HYDROGEN))
        for model in ['gemini-3.8-flash', 'gemini-4-neon', 'custom-model']:
            self.assertEqual(create(SimpleNamespace(json={'CHAT_FREEAI_MODEL': model}))['CHAT_FREEAI_MODEL'], model)
        avatar = (ROOT / 'frontend_avatar/src/api/config.ts').read_text(encoding='utf-8')
        defaults = module.conf_json.DEFAULT_CONFIG
        for key in [*MODEL_KEYS, 'CHAT_OPENRT_MODEL', 'LIVE_GEMINI_MODEL', 'LIVE_FREEAI_MODEL']:
            match = re.search(rf"\b{key}: '([^']+)'", avatar)
            self.assertIsNotNone(match, key)
            self.assertEqual(match[1], defaults[key], key)
        self.assertEqual(defaults['CHAT_OPENRT_MODEL'], 'google/gemini-3.1-flash-image')

    def test_gemini_chat_constructor_default_matches_hydrogen(self):
        path = ROOT / 'backend_server/AIコア/AIチャット_gemini.py'
        tree = ast.parse(path.read_text(encoding='utf-8'))
        cls = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == 'ChatAI')
        init = next(node for node in cls.body if isinstance(node, ast.FunctionDef) and node.name == '__init__')
        defaults = dict(zip([arg.arg for arg in init.args.args][-len(init.args.defaults):], init.args.defaults))
        self.assertEqual(ast.literal_eval(defaults['AI_MODEL']), HYDROGEN)


if __name__ == '__main__':
    unittest.main()
