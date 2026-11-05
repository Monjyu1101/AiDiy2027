# -*- coding: utf-8 -*-
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
"""無料OpenRouterの設定・候補・公開キーを、実設定やAPIに触れずに検証する。"""
import ast
import importlib.util
import json
import logging
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import mock_open, patch


ROOT = Path(__file__).resolve().parents[2]


def load_module(name, relative):
    spec = importlib.util.spec_from_file_location(name, ROOT / relative)
    module = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, {"log_config": SimpleNamespace(get_logger=logging.getLogger)}):
        spec.loader.exec_module(module)
    return module


config_module = load_module("openrt_free_config", "backend_server/conf/conf_json.py")
models_module = load_module("openrt_free_models", "backend_server/conf/conf_model.py")


class OpenRouterFreeSettingsTest(unittest.TestCase):
    def setUp(self):
        self.models = object.__new__(models_module.conf_models)
        self.settings = {"CHAT_AI_NAME": "openrt_free", "CHAT_OPENRT_MODEL": "vendor/paid", "CHAT_OPENRT_FREE_MODEL": "auto"}

    def test_missing_key_is_auto_and_existing_paid_config_is_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / "AiDiy_key.json"
            file.write_text(json.dumps({"CHAT_AI_NAME": "openrt_chat", "CHAT_OPENRT_MODEL": "vendor/paid"}), encoding="utf-8")
            config = config_module.conf_json(str(file))
            self.assertEqual(config.get("CHAT_OPENRT_FREE_MODEL"), "auto")
            self.assertEqual(config.get("CHAT_OPENRT_MODEL"), "vendor/paid")
            self.assertEqual(config.get("CHAT_AI_NAME"), "openrt_chat")
            config.update({"CHAT_AI_NAME": "openrt_free", "CHAT_OPENRT_FREE_MODEL": "vendor/new:free"})
            reloaded = config_module.conf_json(str(file))
            self.assertEqual(reloaded.get("CHAT_OPENRT_FREE_MODEL"), "vendor/new:free")
            self.assertEqual(reloaded.get("CHAT_OPENRT_MODEL"), "vendor/paid")
            self.assertNotIn("openrt_free_key_id", config_module.conf_json.DEFAULT_CONFIG)

    def test_chat_catalog_exposes_exact_free_provider_name(self):
        payload = {"openrt_chat": {"models": {"vendor/paid": "Paid"}}, "openrt_free": {"models": {"vendor/new:free": "Free"}}}
        source = mock_open(read_data=json.dumps(payload))
        with patch("builtins.open", source):
            result = self.models.get_chat_models()
        self.assertEqual(result["openrt_free"], {"vendor/new:free": "Free"})
        self.assertEqual(result["openrt_chat"], {"vendor/paid": "Paid"})
        self.assertEqual(Path(source.call_args.args[0]).name, "chat_models_info.json")
        source().write.assert_not_called()

    def test_initial_auto_uses_only_free_catalog_and_never_mutates_input(self):
        catalogs = {"chat": {"openrt_chat": {"vendor/paid": "Paid"}, "openrt_free": {"vendor/new:free": "Free"}}}
        with patch.object(self.models, "_get_diag_models", side_effect=lambda kind: catalogs.get(kind)):
            result = self.models.normalize_initial_settings(self.settings)
        self.assertEqual(result["CHAT_AI_NAME"], "openrt_free")
        self.assertEqual(result["CHAT_OPENRT_FREE_MODEL"], "vendor/new:free")
        self.assertEqual(result["CHAT_OPENRT_MODEL"], "vendor/paid")
        self.assertEqual(self.settings["CHAT_OPENRT_FREE_MODEL"], "auto")

    def test_missing_or_empty_free_catalog_uses_normal_provider_selection(self):
        for catalog, expected in [
            (None, "openrt_free"), ({}, "openrt_free"),
            ({"openrt_chat": {"vendor/paid": "Paid"}}, "openrt_chat"),
            ({"openrt_chat": {"vendor/paid": "Paid"}, "openrt_free": {}}, "openrt_chat"),
        ]:
            with self.subTest(catalog=catalog), patch.object(self.models, "_get_diag_models", side_effect=lambda kind: catalog if kind == "chat" else None):
                result = self.models.normalize_initial_settings(self.settings)
            self.assertEqual(result["CHAT_AI_NAME"], expected)
            self.assertEqual(result["CHAT_OPENRT_FREE_MODEL"], "auto")

    def test_initial_session_includes_free_setting_and_default(self):
        source = ROOT / "backend_server/AIコア/AIセッション管理.py"
        tree = ast.parse(source.read_text(encoding="utf-8"))
        function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "初期モデル設定生成")
        namespace = {}
        exec(compile(ast.Module(body=[function], type_ignores=[]), str(source), "exec"), namespace)
        create = namespace["初期モデル設定生成"]
        config = SimpleNamespace(json={"CHAT_AI_NAME": "openrt_free", "CHAT_OPENRT_MODEL": "vendor/paid"})
        self.assertEqual(create(config)["CHAT_OPENRT_FREE_MODEL"], "auto")
        config.json["CHAT_OPENRT_FREE_MODEL"] = "vendor/new:free"
        self.assertEqual(create(config)["CHAT_OPENRT_FREE_MODEL"], "vendor/new:free")

    def test_core_whitelist_allows_free_model_but_no_api_key(self):
        source = ROOT / "backend_server/core_router/AIコア.py"
        tree = ast.parse(source.read_text(encoding="utf-8"))
        allowed = next(node.value for node in ast.walk(tree) if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == "許可キー" for target in node.targets))
        keys = ast.literal_eval(allowed)
        self.assertIn("CHAT_OPENRT_FREE_MODEL", keys)
        self.assertIn("CHAT_OPENRT_MODEL", keys)
        self.assertNotIn("openrt_key_id", keys)
        self.assertNotIn("openrt_free_key_id", keys)
        # セッション開始時と設定適用時の両分岐が有料設定を読まないこと。
        branches = [node for node in ast.walk(tree) if isinstance(node, ast.If) and isinstance(node.test, ast.Compare)
                    and isinstance(node.test.left, ast.Name) and node.test.left.id == "chat_ai"
                    and any(isinstance(value, ast.Constant) and value.value == "openrt_free" for value in node.test.comparators)]
        self.assertEqual(len(branches), 2)
        for branch in branches:
            self.assertEqual(branch.body[0].value.args[0].value, "CHAT_OPENRT_FREE_MODEL")

    def test_vscode_setup_exposes_free_provider(self):
        tree = ast.parse((ROOT / "backend_tools/_setup.py").read_text(encoding="utf-8"))
        models = next(node.value for node in tree.body if isinstance(node, ast.Assign)
                      and any(isinstance(target, ast.Name) and target.id == "CHAT_COMPLETIONS_MODEL_IDS" for target in node.targets))
        self.assertIn("openrt_free", ast.literal_eval(models))


if __name__ == "__main__":
    unittest.main()
