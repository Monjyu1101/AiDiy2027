# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
"""Diag → /model のオフライン回帰。SDK・実キー・外部通信を使わない。"""
from __future__ import annotations
import ast
import importlib.util
import io
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("aidiy_model_catalog", ROOT / "hermes_cli/aidiy_model_catalog.py")
catalog = importlib.util.module_from_spec(spec)
spec.loader.exec_module(catalog)
TREE = ast.parse((ROOT / "cli_main.py").read_text(encoding="utf-8"))


def load_picker(directory):
    names = {"_AIDIY_CODE_CATALOG_PROVIDERS", "_AIDIY_CLI_PROVIDERS",
             "_DEFAULT_OLLAMA_HOST", "_OLLAMA_CLOUD_BASE_URL", "_OLLAMA_CLOUD_SUFFIXES", "_OPENAI_BASE_URL",
             "_OPENROUTER_BASE_URL", "_GEMINI_OPENAI_BASE_URL", "_CLAUDE_BASE_URL",
             "_FREEAI_DEFAULT_MODEL", "_OPENAI_OAUTH_SLUG", "_OPENAI_OAUTH_RUNTIME_PROVIDER",
             "_OPENAI_OAUTH_FALLBACK_MODEL", "_XAI_OAUTH_SLUG", "_XAI_OAUTH_DEFAULT_MODEL"}
    functions = {"_aidiy_hermes_catalog_path", "_aidiy_code_model_labels", "_normalize_aidiy_freeai_model",
                 "_is_valid_key", "provider_entry_is_cli", "_load_aidiy_config", "_load_freeai_defaults",
                 "_load_aidiy_hermes_provider_defaults", "_model_from_display_label", "_strip_cloud_suffix", "cli_entry",
                 "_load_aidiy_hermes_defaults", "_openai_oauth_model_from_value", "_xai_oauth_model_from_value",
                 "_local_chat_model_from_value", "_freeai_model_from_value"}
    methods = {"_aidiy_provider_slugs", "_aidiy_runtime_provider", "_current_aidiy_provider_slug",
               "_aidiy_provider_default_model", "_get_aidiy_provider_entry", "_list_aidiy_provider_entries",
               "_apply_aidiy_provider_model", "_handle_aidiy_model_command", "_parse_aidiy_model_args"}
    nodes = [n for n in TREE.body if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id in names for t in n.targets)
             or isinstance(n, ast.FunctionDef) and n.name in functions]
    source_class = next(n for n in TREE.body if isinstance(n, ast.ClassDef) and n.name == "HermesCLI")
    nodes.append(ast.ClassDef(name="HermesCLI", bases=[], keywords=[], decorator_list=[],
                             body=[n for n in source_class.body if isinstance(n, ast.FunctionDef) and n.name in methods]))
    ns = {"Path": Path, "json": json, "re": re,
          "_AIDIY_CONFIG_DIR": directory / "_config", "_AIDIY_KEY_JSON": directory / "_config/AiDiy_key.json",
          "_AIDIY_CHAT_PROVIDERS": catalog.CHAT_PROVIDERS,
          "_normalize_aidiy_chat_provider": catalog.normalize_chat_provider,
          "_read_aidiy_model_labels": catalog.read_model_labels,
          "_cprint": lambda *a: None, "save_model_choice": lambda *a: None}
    module = ast.Module(body=[ast.ImportFrom(module="__future__", names=[ast.alias(name="annotations")], level=0), *nodes], type_ignores=[])
    exec(compile(ast.fix_missing_locations(module), str(ROOT / "cli_main.py"), "exec"), ns)
    cls = ns["HermesCLI"]
    picker = cls()
    picker._aidiy_config = {name: "fake-" + name for name in ["gemini_key_id", "freeai_key_id", "openrt_key_id", "openai_key_id", "claude_key_id"]}
    picker._aidiy_provider_slug = "freeai"
    picker.provider = picker.requested_provider = "custom"
    picker.api_key = picker._aidiy_config["freeai_key_id"]
    picker.base_url = ns["_GEMINI_OPENAI_BASE_URL"]
    picker.model = "gemini-3.8-flash"
    picker._app = None
    return ns, picker


class HermesModelCatalogTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.ns, self.picker = load_picker(self.directory)
        self.path = self.ns["_aidiy_hermes_catalog_path"]()
        self.path.parent.mkdir(parents=True)
        self.ns["_AIDIY_KEY_JSON"].parent.mkdir()
        self.ns["_AIDIY_KEY_JSON"].write_text(json.dumps(self.picker._aidiy_config), encoding="utf-8-sig")

    def write(self, sections):
        self.path.write_text(json.dumps({catalog.catalog_key(key): {"models": value} for key, value in sections.items()}), encoding="utf-8-sig")

    def test_all_api_providers_read_exact_ids_and_labels_without_network(self):
        sections = {key: {f"model-{i}": f"2020/01/01 - model-{i}" for i in range(75)} for key in catalog.CHAT_PROVIDERS}
        self.write(sections)
        for key in sections:
            entry = self.picker._get_aidiy_provider_entry(key, include_models=True)
            self.assertEqual(entry["models"], [(label, model) for model, label in sections[key].items()])
            self.assertEqual(entry["total_models"], 75)

    def test_slugs_read_the_chat_and_code_section_names_used_by_the_catalog_file(self):
        pairs = {"gemini": "gemini_chat", "freeai": "freeai_chat", "claude-code": "claude_cli", "antigravity-cli": "antigravity_cli",
                 "codex-cli": "codex_cli", "copilot-cli": "copilot_cli", "opencode": "opencode_cli", "grok-cli": "grok_cli",
                 "openrt_chat": "openrt_chat", "openrt_free": "openrt_free", "openai_chat": "openai_chat", "openai_oauth": "openai_oauth", "claude_chat": "claude_chat",
                 "xai-oauth": "xai_oauth"}
        for slug, key in pairs.items():
            self.assertEqual(catalog.catalog_key(slug), key)
        # 別名は同じ区分へ。旧スラッグ名のキー（gemini / claude-code など）はファイルにあっても読まない。
        self.assertEqual(catalog.catalog_key("openrouter"), "openrt_chat")
        self.assertEqual(catalog.catalog_key("gemini_chat"), "gemini_chat")
        self.path.write_text(json.dumps({"claude-code": {"models": {"old": "Old"}}, "claude_cli": {"models": {"same": "same", "haiku": "Haiku"}}}), encoding="utf-8-sig")
        rows = self.ns["_aidiy_code_model_labels"]("claude-code")
        self.assertEqual(rows, [("Haiku", "haiku")])
        entry = self.picker._get_aidiy_provider_entry("claude-code", True)
        self.assertEqual([model for _, model in entry["models"]], ["same", "haiku"], "same は先頭に1つだけ")

    def test_xai_oauth_lists_the_diag_grok_candidates_not_the_upstream_fixed_list(self):
        self.path.write_text(json.dumps({"xai_oauth": {"models": {"grok-4.7": "yyyy/mm/dd - grok-4.7", "grok-4.6": "yyyy/mm/dd - grok-4.6"}}}), encoding="utf-8-sig")
        rows = self.ns["_aidiy_code_model_labels"]("xai-oauth")
        self.assertEqual([model for _, model in rows], ["grok-4.7", "grok-4.6"])

    def test_generations_and_generator_approved_vision_model_preserved(self):
        ids = ["gemini-3.8-flash", "gemini-4-pro", "gemma-3", "gemma-4", "gemini-flash-latest", "image-understanding"]
        self.write({"gemini": {m: m for m in ids}})
        entry = self.picker._get_aidiy_provider_entry("gemini", True)
        self.assertEqual([m for _, m in entry["models"]], ids)

    def test_aliases_use_one_canonical_provider_and_right_protocol(self):
        for alias, canonical in [("openai", "openai_chat"), ("anthropic", "claude_chat"), ("anthropic_chat", "claude_chat"), ("openrouter", "openrt_chat"), ("openrt_chat", "openrt_chat")]:
            entry = self.picker._get_aidiy_provider_entry(alias)
            self.assertEqual(entry["slug"], canonical)
        claude = self.picker._get_aidiy_provider_entry("claude_chat")
        self.assertEqual((claude["runtime_provider"], claude["api_mode"], claude["api_key"]), ("anthropic", "anthropic_messages", "fake-claude_key_id"))
        slugs = [e["slug"] for e in self.picker._list_aidiy_provider_entries()]
        self.assertEqual(len(slugs), len(set(slugs)))
        self.assertIn("openai_chat", slugs)
        self.assertIn("claude_chat", slugs)
        self.assertNotIn("openai", slugs)
        self.assertNotIn("anthropic", slugs)

    def test_missing_empty_malformed_do_not_invent_default(self):
        for payload in [None, "{}", '{"freeai_chat":{"models":{}}}', '{"freeai_chat":{"models":[]}}', "not json", '{"freeai_chat":{"models":{"bad\\nmodel":"label"}}}']:
            if payload is None:
                self.path.unlink(missing_ok=True)
            else:
                self.path.write_text(payload)
            entry = self.picker._get_aidiy_provider_entry("freeai", True)
            self.assertEqual(entry["models"], [])
            self.assertTrue(entry["model_list_notice"])

    def test_independent_keys_and_reloaded_catalog(self):
        self.write({"freeai": {"free-only": "Free label"}, "gemini": {"paid-only": "Paid label"}})
        free = self.picker._get_aidiy_provider_entry("freeai", True)
        gemini = self.picker._get_aidiy_provider_entry("gemini", True)
        self.assertNotEqual(free["api_key"], gemini["api_key"])
        self.assertEqual(free["models"], [("Free label", "free-only")])
        self.write({"freeai": {"new-model": "New label"}})
        self.assertEqual(self.picker._get_aidiy_provider_entry("freeai", True)["models"], [("New label", "new-model")])
        self.picker._aidiy_config.pop("freeai_key_id")
        self.assertIsNone(self.picker._get_aidiy_provider_entry("freeai", True))

    def test_freeai_default_is_carbon_but_explicit_lower_tiers_are_preserved(self):
        load = self.ns["_load_freeai_defaults"]
        self.assertEqual(load({})["model"], "gemini-4-carbon")
        self.assertEqual(load({"CHAT_FREEAI_MODEL": "gemini-3.5-flash"})["model"], "gemini-4-carbon")
        for model in ["gemini-3.8-flash", "gemini-4-argon", "gemini-4-carbon", "custom-model"]:
            with self.subTest(model=model):
                self.assertEqual(load({"CHAT_FREEAI_MODEL": model})["model"], model)
                self.assertEqual(load({"CHAT_FREEAI_MODEL": "gemini-4-carbon"}, model)["model"], model)
        ids = ["gemini-4-carbon", "gemini-4-argon", "gemini-3.8-flash"]
        self.write({provider: {model: model for model in ids} for provider in ["gemini", "freeai"]})
        for provider in ["gemini", "freeai"]:
            self.assertEqual([model for _, model in self.picker._get_aidiy_provider_entry(provider, True)["models"]], ids)

    def test_startup_identity_survives_custom_and_bare_model_change(self):
        defaults = self.ns["_load_aidiy_hermes_provider_defaults"]("freeai")
        self.assertEqual(defaults["provider"], "custom")
        self.assertEqual(defaults["aidiy_provider_slug"], "freeai")
        self.picker._aidiy_provider_slug = defaults["aidiy_provider_slug"]
        self.assertTrue(self.picker._handle_aidiy_model_command("/model gemini-4-pro"))
        self.assertEqual(self.picker._aidiy_provider_slug, "freeai")
        self.assertEqual(self.picker._explicit_api_key, "fake-freeai_key_id")
        self.assertEqual(self.picker.model, "gemini-4-pro")
        self.picker._aidiy_provider_slug = None
        self.assertEqual(self.picker._current_aidiy_provider_slug(), "freeai")

    def test_startup_explicit_keys_and_api_aliases(self):
        for provider, canonical in [("openai", "openai_chat"), ("anthropic", "claude_chat"), ("freeai", "freeai")]:
            defaults = self.ns["_load_aidiy_hermes_provider_defaults"](provider, "fake-override")
            self.assertEqual(defaults["api_key"], "fake-override")
            self.assertEqual(defaults["aidiy_provider_slug"], canonical)
        defaults = self.ns["_load_freeai_defaults"]({"freeai_key_id": "fake-free"})
        self.assertEqual(defaults["aidiy_provider_slug"], "freeai")
        main = next(n for n in TREE.body if isinstance(n, ast.FunctionDef) and n.name == "main")
        self.assertIn("aidiy_provider_slug", [a.arg for a in main.args.args])
        self.assertTrue(any(isinstance(n, ast.Assign) and any(isinstance(t, ast.Attribute) and t.attr == "_aidiy_provider_slug" for t in n.targets) for n in ast.walk(main)))
        entry = next(n for n in TREE.body if isinstance(n, ast.FunctionDef) and n.name == "cli_entry")
        main_call = next(n for n in ast.walk(entry) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == "main")
        self.assertIn("aidiy_provider_slug", [k.arg for k in main_call.keywords])

    def test_cli_and_oauth_keep_code_ids_labels_and_same_semantics(self):
        self.write({"claude-code": {"sonnet": "Claude label", "same": "same", "auto": "auto"},
                    "opencode": {"openai/gpt-6.1-sol": "OpenCode label"},
                    "openai_oauth": {"gpt-6.1-sol": "yyyy/mm/dd - openai_oauth/gpt-6.1-sol"}})
        entry = self.picker._get_aidiy_provider_entry("claude-code", True)
        self.assertEqual(entry["models"], [("same (変更なし)", "same"), ("Claude label", "sonnet")])
        self.assertEqual(self.ns["_aidiy_code_model_labels"]("opencode"), [("OpenCode label", "openai/gpt-6.1-sol")])
        self.assertEqual(self.ns["_aidiy_code_model_labels"]("openai_oauth")[0][1], "gpt-6.1-sol")
        self.picker._apply_aidiy_provider_model(entry, "auto")
        self.assertEqual(self.picker.model, "same")
        self.assertEqual(self.picker._explicit_api_key, None)

    def test_no_legacy_fallback_to_code_models_info(self):
        # 一覧は hermes_models_info.json だけから出す。ファイルが無いとき Code 一覧へは退避しない。
        (self.path.parent / "code_models_info.json").write_text(json.dumps({"claude_cli": {"models": {"sonnet": "Existing"}}}))
        self.assertEqual(self.ns["_aidiy_code_model_labels"]("claude-code"), [])
        self.write({})
        self.assertEqual(self.ns["_aidiy_code_model_labels"]("claude-code"), [])

    def test_every_listed_provider_reads_only_the_file_including_ollama_local_and_oauth(self):
        self.write({"ollama_chat": {"mistral-large-3:675b": "L", "gpt-oss:20b": "S"}, "local_chat": {"google/gemma-4-E2B-it": "Local"},
                    "openai_oauth": {"gpt-6.1-sol": "O"}, "xai-oauth": {"grok-4.7": "X"}})
        self.picker._aidiy_config["ollama_host"] = "http://localhost:11434"
        for slug, expected in [("ollama_chat", ["mistral-large-3:675b", "gpt-oss:20b"]), ("local_chat", ["google/gemma-4-E2B-it"]),
                               ("openai_oauth", ["gpt-6.1-sol"]), ("xai-oauth", ["grok-4.7"])]:
            entry = self.picker._get_aidiy_provider_entry(slug, include_models=True)
            self.assertEqual([model for _, model in entry["models"]], expected, slug)
        # 候補が無いプロバイダは API を呼ばず、取得・保存の案内を出す。
        self.write({})
        entry = self.picker._get_aidiy_provider_entry("ollama_chat", include_models=True)
        self.assertEqual(entry["models"], [])
        self.assertIn("ollama_chat", entry["model_list_notice"])
        # 旧スラッグ ollama は受け付けない。
        self.assertNotIn("ollama", self.ns["_aidiy_provider_slugs"]() if callable(self.ns.get("_aidiy_provider_slugs")) else self.picker._aidiy_provider_slugs())

    def run_entry(self, provider, model="chosen-model", previous=None, *, ignore_user_config=False):
        args = SimpleNamespace(**dict.fromkeys("image toolsets skills reasoning max_turns run_budget verbose gateway worktree checkpoints pass_session_id resume base_url api_key".split()))
        args.version = args.yolo = args.oneshot_stdin = args.compact = args.list_tools = args.list_toolsets = args.ignore_user_config = args.ignore_rules = False
        args.ignore_user_config = ignore_user_config
        args.quiet = True
        args.oneshot = "test"
        args.query = args.prompt = None
        args.provider, args.model = provider, model
        calls = []
        self.ns.update({"_build_arg_parser": lambda: SimpleNamespace(parse_args=lambda _: args),
                        "_PROJECT_ROOT": ROOT, "_AIDIY_PARENT_PID": 123,
                        "sys": SimpleNamespace(argv=[], path=[], stdin=io.StringIO(), stderr=io.StringIO()),
                        "_flatten_skills": lambda _: None, "main": lambda **kw: calls.append(kw),
                        "load_model_choice": lambda: previous})
        with patch.dict(sys.modules, {"tools_proc.process_lifetime": SimpleNamespace(guard_parent=lambda _: None)}):
            result = self.ns["cli_entry"]([])
        return result, calls

    def test_cli_entry_forwards_original_freeai_identity_and_independent_key(self):
        code, calls = self.run_entry("freeai")
        self.assertEqual(code, 0)
        self.assertEqual(calls[0]["provider"], "custom")
        self.assertEqual(calls[0]["aidiy_provider_slug"], "freeai")
        self.assertEqual(calls[0]["api_key"], "fake-freeai_key_id")
        cfg = {"gemini_key_id": "fake-paid-key"}
        self.ns["_AIDIY_KEY_JSON"].write_text(json.dumps(cfg))
        code, calls = self.run_entry("freeai")
        self.assertEqual((code, calls), (2, []))
        original_key = self.picker.api_key
        self.assertTrue(self.picker._handle_aidiy_model_command("/model new-model"))
        self.assertEqual(self.picker.api_key, original_key)
        self.assertNotEqual(self.picker.model, "new-model")

    def test_prefixed_freeai_and_saved_alias_startup(self):
        code, calls = self.run_entry(None, "freeai/gemini-4-pro")
        self.assertEqual(code, 0)
        self.assertEqual(calls[0]["model"], "gemini-4-pro")
        self.assertEqual(calls[0]["aidiy_provider_slug"], "freeai")
        self.assertEqual(calls[0]["api_key"], "fake-freeai_key_id")
        for old, canonical in [("anthropic", "claude_chat"), ("openai", "openai_chat"), ("freeai", "freeai")]:
            code, calls = self.run_entry("same", "same", {"provider": old, "model": "saved-model"})
            self.assertEqual(code, 0)
            self.assertEqual(calls[0]["aidiy_provider_slug"], canonical)
            self.assertEqual(calls[0]["model"], "saved-model")

    def test_saved_legacy_openrt_and_ollama_use_current_provider_routes(self):
        for old, current, runtime, key in [
            ("openrt", "openrt_chat", "openrouter", "fake-openrt_key_id"),
            ("ollama", "ollama_chat", "custom", "no-key-required"),
        ]:
            with self.subTest(provider=old):
                previous = {"provider": old, "model": "saved-model"}
                code, calls = self.run_entry("same", "same", previous)
                self.assertEqual(code, 0)
                self.assertEqual(calls[0]["provider"], runtime)
                self.assertEqual(calls[0]["model"], "saved-model")
                self.assertEqual(calls[0]["api_key"], key)
                expected = self.ns["_load_aidiy_hermes_provider_defaults"](current)
                self.assertEqual(calls[0]["base_url"], expected["base_url"])
                self.assertEqual(previous["provider"], old, "保存データを書き換えない")
        self.assertNotIn("ollama", self.picker._aidiy_provider_slugs())
        self.assertNotIn("openrt", self.picker._aidiy_provider_slugs())

    def test_legacy_restore_does_not_override_auto_or_ignored_settings(self):
        previous = {"provider": "openrt", "model": "saved-model"}
        for provider, model, ignore in [("auto", "auto", False),
                                         (None, None, False), ("same", "same", True)]:
            with self.subTest(provider=provider, ignore=ignore):
                code, calls = self.run_entry(provider, model, previous, ignore_user_config=ignore)
                self.assertEqual(code, 0)
                for field in ["provider", "model", "api_key", "base_url"]:
                    self.assertIsNone(calls[0][field])

    def test_saved_legacy_ollama_reloads_current_cloud_credentials(self):
        self.picker._aidiy_config["ollama_key_id"] = "fake-current-cloud-key"
        self.ns["_AIDIY_KEY_JSON"].write_text(json.dumps(self.picker._aidiy_config))
        code, calls = self.run_entry("same", "same", {"provider": "ollama", "model": "saved-model"})
        self.assertEqual(code, 0)
        self.assertEqual(calls[0]["base_url"], self.ns["_OLLAMA_CLOUD_BASE_URL"])
        self.assertEqual(calls[0]["api_key"], "fake-current-cloud-key")
        self.assertEqual(calls[0]["model"], "saved-model")

    def test_anthropic_environment_or_stored_api_key_resolution_remains_available(self):
        self.ns["_AIDIY_KEY_JSON"].write_text("{}")
        for provider in ["anthropic", "claude_chat"]:
            code, calls = self.run_entry(provider)
            self.assertEqual(code, 0)
            self.assertEqual(calls[0]["provider"], "anthropic")
            self.assertEqual(calls[0]["base_url"], "https://api.anthropic.com")
            self.assertIsNone(calls[0]["api_key"])
            self.assertEqual(calls[0]["aidiy_provider_slug"], "claude_chat")

    @unittest.skipUnless(shutil.which("node"), "Node.js required for Diag integration")
    def test_generated_javascript_catalog_round_trip(self):
        module = (ROOT.parent / "backend_diag/モデル情報/hermes_info.mjs").as_uri()
        script = f'''import {{hermesModelsInfo}} from {json.dumps(module)};
const models = {{'image-understanding':'Vision', 'image-output':'Not chat', 'gemini-3.8-flash':'Older', 'gemini-4-pro':'Newer'}};
const metadata = [{{model_id:'image-understanding', モダリティ:'text+image->text'}}, {{model_id:'image-output', モダリティ:'text->image'}}];
console.log(JSON.stringify(hermesModelsInfo({{chatModels:{{gemini_chat:{{models}}}}, providerInfos:[{{プロバイダ:'gemini', chat:{{モデル:metadata}}}}]}})));'''
        result = subprocess.run(["node", "--input-type=module", "-e", script], capture_output=True, text=True, check=True)
        self.path.write_text(result.stdout)
        rows = self.picker._get_aidiy_provider_entry("gemini", True)["models"]
        self.assertEqual(rows, [("Vision", "image-understanding"), ("Older", "gemini-3.8-flash"), ("Newer", "gemini-4-pro")])

    def test_custom_runtime_does_not_replace_explicit_google_keys_from_pool(self):
        tree = ast.parse((ROOT / "hermes_cli/runtime_provider.py").read_text())
        node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "_resolve_named_custom_runtime")
        pool_calls = []
        def pool(*args):
            pool_calls.append(args)
            return {"provider": "custom", "api_key": "fake-shared-pool", "base_url": args[0]}
        ns = {"_try_resolve_from_custom_pool": pool, "has_usable_secret": lambda value: bool(value),
              "base_url_host_matches": lambda *args: False, "_getenv": lambda *args: "",
              "_host_derived_api_key": lambda _: "", "_detect_api_mode_for_url": lambda _: None}
        module = ast.Module(body=[ast.ImportFrom(module="__future__", names=[ast.alias(name="annotations")], level=0), node], type_ignores=[])
        exec(compile(ast.fix_missing_locations(module), "runtime_provider.py", "exec"), ns)
        resolve = ns["_resolve_named_custom_runtime"]
        url = self.ns["_GEMINI_OPENAI_BASE_URL"]
        for provider in ["freeai", "gemini"]:
            entry = self.picker._get_aidiy_provider_entry(provider)
            runtime = resolve(requested_provider=entry["runtime_provider"], explicit_base_url=entry["base_url"], explicit_api_key=entry["api_key"])
            self.assertEqual(runtime["api_key"], entry["api_key"])
            self.assertEqual(runtime["api_mode"], "chat_completions")
            self.assertNotIn("credential_pool", runtime)
        self.assertEqual(pool_calls, [])
        self.assertEqual(resolve(requested_provider="custom", explicit_base_url=url)["api_key"], "fake-shared-pool")
        self.assertEqual(len(pool_calls), 1)

    def test_openrt_free_is_normal_openrouter_with_a_separate_model_list(self):
        self.write({"openrt_free": {"vendor/model:free": "Free model"}})
        entry = self.picker._get_aidiy_provider_entry("openrt_free", True)
        normal = self.picker._get_aidiy_provider_entry("openrt_chat")
        for key in ["api_key", "base_url", "runtime_provider", "api_mode"]:
            self.assertEqual(entry[key], normal[key])
        self.assertEqual(entry["models"], [("Free model", "vendor/model:free")])
        # 選択後は通常モデル。同じIDを渡し、料金証拠や無料専用の送信制限を要求しない。
        self.picker._apply_aidiy_provider_model(entry, "vendor/model:free")
        self.assertEqual(self.picker.model, "vendor/model:free")
        self.assertEqual(self.picker.provider, "openrouter")
        self.assertEqual(self.picker.api_key, "fake-openrt_key_id")
        self.picker._apply_aidiy_provider_model(entry, "vendor/manual-model")
        self.assertEqual(self.picker.model, "vendor/manual-model")
        code, calls = self.run_entry("openrt_free", "vendor/model:free")
        self.assertEqual(code, 0)
        self.assertEqual(calls[0]["provider"], "openrouter")
        self.assertEqual(calls[0]["model"], "vendor/model:free")
        self.assertEqual(calls[0]["api_key"], "fake-openrt_key_id")
        self.ns["_AIDIY_KEY_JSON"].write_text("{}")
        code, calls = self.run_entry("openrt_free", "vendor/model:free")
        self.assertEqual(code, 0)
        self.assertEqual(calls[0]["provider"], "openrouter")
        self.assertIsNone(calls[0]["api_key"], "通常OpenRouterの環境/設定キー解決へ渡す")
        for filename in ["core/chat_completion_helpers.py", "hermes_cli/cli_agent_setup_mixin.py"]:
            self.assertNotIn("openrt_free", (ROOT / filename).read_text())


if __name__ == "__main__":
    unittest.main()
