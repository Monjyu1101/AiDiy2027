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

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("gemini_defaults_fixture", ROOT / "backend_server/conf/conf_json.py")
module = importlib.util.module_from_spec(spec)
with patch.dict(sys.modules, {"log_config": SimpleNamespace(get_logger=logging.getLogger)}):
    spec.loader.exec_module(module)


class GeminiChatDefaultsTests(unittest.TestCase):
    def test_new_and_missing_settings_use_carbon_but_existing_settings_survive(self):
        for model in [None, "gemini-3.8-flash", "gemini-4-argon", "custom-model"]:
            with self.subTest(model=model), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "AiDiy_key.json"
                if model is not None:
                    path.write_text(json.dumps({"CHAT_FREEAI_MODEL": model, "CHAT_GEMINI_MODEL": "custom-image"}), encoding="utf-8")
                config = module.conf_json(str(path))
                expected = model or "gemini-4-carbon"
                self.assertEqual(config.get("CHAT_FREEAI_MODEL"), expected)
                self.assertEqual(module.conf_json(str(path)).get("CHAT_FREEAI_MODEL"), expected)
                if model is not None:
                    self.assertEqual(config.get("CHAT_GEMINI_MODEL"), "custom-image")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "AiDiy_key.json"
            path.write_text('{"CHAT_AI_NAME":"openai_oauth"}', encoding="utf-8")
            config = module.conf_json(str(path))
            self.assertEqual(config.get("CHAT_FREEAI_MODEL"), "gemini-4-carbon")
            self.assertEqual(config.get("CHAT_AI_NAME"), "openai_oauth")

    def test_session_and_avatar_fallbacks_match_config(self):
        path = ROOT / "backend_server/AIコア/AIセッション管理.py"
        tree = ast.parse(path.read_text(encoding="utf-8"))
        function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "初期モデル設定生成")
        namespace = {}
        exec(compile(ast.Module(body=[function], type_ignores=[]), str(path), "exec"), namespace)
        create = namespace["初期モデル設定生成"]
        self.assertEqual(create(SimpleNamespace(json={}))['CHAT_FREEAI_MODEL'], 'gemini-4-carbon')
        for model in ['gemini-3.8-flash', 'gemini-4-argon', 'custom-model']:
            self.assertEqual(create(SimpleNamespace(json={'CHAT_FREEAI_MODEL': model}))['CHAT_FREEAI_MODEL'], model)
        avatar = (ROOT / 'frontend_avatar/src/api/config.ts').read_text(encoding='utf-8')
        defaults = module.conf_json.DEFAULT_CONFIG
        for key in ['CHAT_FREEAI_MODEL', 'CHAT_GEMINI_MODEL', 'CHAT_OPENRT_MODEL', 'LIVE_GEMINI_MODEL', 'LIVE_FREEAI_MODEL']:
            match = re.search(rf"\b{key}: '([^']+)'", avatar)
            self.assertIsNotNone(match, key)
            self.assertEqual(match[1], defaults[key], key)
        self.assertEqual(defaults['CHAT_GEMINI_MODEL'], 'gemini-3.1-flash-image')
        self.assertEqual(defaults['CHAT_OPENRT_MODEL'], 'google/gemini-3.1-flash-image')
        self.assertEqual(defaults['DECISION_FREEAI_MODEL'], 'auto')
        self.assertEqual(defaults['PREDICTION_FREEAI_MODEL'], 'auto')

    def test_gemini_chat_constructor_default_matches_carbon(self):
        path = ROOT / 'backend_server/AIコア/AIチャット_gemini.py'
        tree = ast.parse(path.read_text(encoding='utf-8'))
        cls = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == 'ChatAI')
        init = next(node for node in cls.body if isinstance(node, ast.FunctionDef) and node.name == '__init__')
        defaults = dict(zip([arg.arg for arg in init.args.args][-len(init.args.defaults):], init.args.defaults))
        self.assertEqual(ast.literal_eval(defaults['AI_MODEL']), 'gemini-4-carbon')


if __name__ == '__main__':
    unittest.main()
