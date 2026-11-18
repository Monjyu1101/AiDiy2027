# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""aidiy_codex の setup（既定 n・独立プロセスでコンパイル）と start（起動せず案内のみ）。"""

import contextlib
import importlib.util
import io
import re
import types
import tempfile
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]


def load(name):
    spec = importlib.util.spec_from_file_location(f"aidiy_test_{name.strip('_').replace('.', '_')}", ROOT / name)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class SetupCodexTests(unittest.TestCase):
    def test_question_defaults_codex_no_and_hermes_pi_yes(self):
        source = (ROOT / "_setup.py").read_text(encoding="utf-8")
        self.assertRegex(source, r'choices\["hermes"\] = ask_yes_no\([^)]*default="y"\)')
        self.assertRegex(source, r'choices\["pi"\] = ask_yes_no\([^)]*default="y"\)')
        self.assertRegex(source, r'choices\["codex"\] = ask_yes_no\([^)]*default="n"\)')
        # 実行順は Hermes → Pi → Codex。
        self.assertLess(source.index('if choices["hermes"]:'), source.index('if choices.get("pi"):'))
        self.assertLess(source.index('if choices.get("pi"):'), source.index('if choices.get("codex"):'))

    def test_setup_codex_question_and_auto_keep_no_default(self):
        setup = load("_setup.py")
        output = io.StringIO()
        # Enter は _read_single_key が受け取る default_key に解決される。
        with patch.object(setup, "ask_start_mode", return_value=(True, False)), \
             patch.object(setup, "_read_single_key", side_effect=lambda allowed, default: default), \
             contextlib.redirect_stdout(output):
            choices = setup.collect_setup_choices()
        self.assertFalse(choices["codex"])
        line = next(line for line in output.getvalue().splitlines() if "aidiy_codex のコンパイル" in line)
        self.assertIn("(y/[n])", line)
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertFalse(setup.collect_setup_choices(auto=True)["codex"])

    def test_setup_codex_starts_detached_and_bootstraps_in_child(self):
        setup = load("_setup.py")
        for code, expected in ((0, True), (2, True), (1, False)):
            calls = []
            stub = types.SimpleNamespace(
                start_detached=lambda release, jobs, c=code: calls.append((release, jobs)) or c)
            with patch.object(setup, "_load_folder_module", return_value=stub), contextlib.redirect_stdout(io.StringIO()) as output:
                self.assertEqual(setup.setup_codex(), expected)
            self.assertEqual(calls, [(True, None)])
            self.assertIn("公式配布元", output.getvalue())

    def test_setup_codex_load_failure_does_not_start(self):
        setup = load("_setup.py")
        with patch.object(setup, "_load_folder_module", side_effect=FileNotFoundError("missing")), contextlib.redirect_stdout(io.StringIO()):
            self.assertFalse(setup.setup_codex())


class CodexLauncherTests(unittest.TestCase):
    def test_launcher_created_without_binary_for_both_platforms(self):
        for windows in (False, True):
            with self.subTest(windows=windows), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                module = load("command_codex/_compile.py")
                helper = module.load_path_helper()
                with patch.object(module, "PROJECT_ROOT", root / "project"), \
                     patch.object(module, "INSTALL_DIR", root / ".aidiy/bin"), \
                     patch.object(module, "IS_WINDOWS", windows), \
                     patch.object(module, "EXE", ".exe" if windows else ""), \
                     patch.object(module, "load_path_helper", return_value=helper), \
                     patch.object(helper, "ensure_launcher_path", return_value=True) as ensure, \
                     patch.object(Path, "home", return_value=root), \
                     contextlib.redirect_stdout(io.StringIO()) as output:
                    self.assertTrue(module.install_standalone_launcher())
                    self.assertIn("本体のコンパイル完了後に利用できます。", output.getvalue())
                    self.assertNotIn("開き直して", output.getvalue())
                    name = "aidiy_codex.cmd" if windows else "aidiy_codex"
                    local = root / "project/_AIDIY/aidiy_codex/bin" / name
                    shared = root / ".local/bin" / name
                    self.assertEqual(local.read_bytes(), shared.read_bytes())
                    self.assertFalse((root / ".aidiy/bin/aidiy_codex.exe").exists())
                    self.assertEqual(ensure.call_count, 2)
                    shared.write_text("old", encoding="utf-8")
                    self.assertTrue(module.install_standalone_launcher())
                    self.assertEqual(local.read_bytes(), shared.read_bytes())
                    if not windows:
                        binary = root / ".aidiy/bin/aidiy_codex"
                        binary.parent.mkdir(parents=True)
                        binary.write_text('#!/bin/sh\npwd\nprintf "%s\\n" "$@"\nexit 7\n', encoding="utf-8")
                        binary.chmod(0o755)
                        result = subprocess.run([str(shared), "resume", "a b", "日本語"], cwd=root,
                                                capture_output=True, text=True)
                        self.assertEqual(result.returncode, 7)
                        self.assertEqual(result.stdout.splitlines(), [str(root), "resume", "a b", "日本語"])

    def test_setup_registers_launcher_before_optional_compile(self):
        source = (ROOT / "_setup.py").read_text(encoding="utf-8")
        self.assertLess(source.index("if not setup_codex_launcher():"), source.index('if choices.get("codex"):'))
        setup = load("_setup.py")
        stub = types.SimpleNamespace(install_standalone_launcher=lambda: True)
        with patch.object(setup, "_load_folder_module", return_value=stub):
            self.assertTrue(setup.setup_codex_launcher())


class StartGuidanceTests(unittest.TestCase):
    def test_command_clis_are_only_guided_not_started(self):
        start = load("_start.py")
        output = io.StringIO()
        with patch.object(start.shutil, "which", return_value=None), patch.object(start.Path, "home", return_value=Path("Z:/none")), \
                patch.object(start, "BASE_DIR", Path("Z:/none")), contextlib.redirect_stdout(output):
            start.print_command_cli_guidance()
        text = re.sub(r"\x1b\[[0-9;]*m", "", output.getvalue())
        self.assertIn("ここでは起動しません", text)
        for name in ("Hermes", "Pi", "Codex"):
            self.assertRegex(text, rf"{name}\s*: 未")
        self.assertIn("command_codex/_compile.py", text)
        source = (ROOT / "_start.py").read_text(encoding="utf-8")
        for command in ("aidiy_hermes", "aidiy_pi", "aidiy_codex"):
            self.assertNotRegex(source, rf"Popen\([^)]*{command}")


if __name__ == "__main__":
    unittest.main()
