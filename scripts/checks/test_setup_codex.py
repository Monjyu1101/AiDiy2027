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

    def test_setup_codex_starts_detached_only_when_prerequisites_exist(self):
        setup = load("_setup.py")
        for env_ok, code, expected in ((False, 0, False), (True, 0, True), (True, 2, True), (True, 1, False)):
            calls = []
            stub = types.SimpleNamespace(check_prerequisites=lambda ok=env_ok: ({} if ok else None, "target"),
                                         start_detached=lambda release, jobs, c=code: calls.append((release, jobs)) or c)
            with patch.object(setup, "_load_folder_module", lambda folder, entry, s=stub: s), contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(setup.setup_codex(), expected, (env_ok, code))
            self.assertEqual(calls, [(True, None)] if env_ok else [])


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
