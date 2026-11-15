# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
"""現在のセッション状態が委譲先へ伝わることを実メソッドで確認する。"""
import ast
import os
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
tree = ast.parse((ROOT / "cli_main.py").read_text(encoding="utf-8"))
cls = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == "HermesCLI")
method = next(node for node in cls.body if isinstance(node, ast.FunctionDef) and node.name == "_dispatch_aidiy_cli_subprocess")
namespace = {"Optional": __import__("typing").Optional, "os": os, "_PROJECT_ROOT": ROOT,
             "_cprint": Mock(), "_DIM": "", "_RST": ""}
exec(compile(ast.Module(body=[method], type_ignores=[]), str(ROOT / "cli_main.py"), "exec"), namespace)


class ModeTest(unittest.TestCase):
    def test_mode_is_read_for_each_turn_and_readonly_wins(self):
        for readonly, yolo, expected in [(False, False, "normal"), (False, True, "yolo"), (True, True, "read-only"), (True, False, "read-only")]:
            with self.subTest(readonly=readonly, yolo=yolo):
                bridge = Mock(return_value="fixture answer")
                instance = SimpleNamespace(_aidiy_provider_slug="opencode", model="openai/gpt-6-luna",
                    conversation_history=[{"role":"assistant", "content":"previous answer"}],
                    _is_session_yolo_active=lambda: yolo)
                with patch.dict(os.environ, {"AIDIY_HERMES_READ_ONLY":"1" if readonly else "0"}), \
                     patch.dict(sys.modules, {"hermes_cli.aidiy_cli_bridge": SimpleNamespace(run_cli=bridge)}):
                    answer = namespace[method.name](instance, "follow up", quiet_output=True)
                self.assertEqual(answer, "fixture answer")
                self.assertEqual(bridge.call_args.args[5], expected)
                self.assertIn("previous answer", bridge.call_args.args[3])
                self.assertIn("follow up", bridge.call_args.args[3])
                self.assertEqual(instance._aidiy_cli_last_exit_code, 0)


if __name__ == "__main__":
    unittest.main()
