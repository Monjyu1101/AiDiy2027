# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""アバターの二重起動が既存プロセスを停止しないことを確認する。"""
import importlib.util
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "_start.py"
spec = importlib.util.spec_from_file_location("avatar_start_test", SCRIPT)
start = importlib.util.module_from_spec(spec)
spec.loader.exec_module(start)


class AvatarStartTest(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch.object(start, "check_project_node_runtime", return_value=(True, "fixture Node")))

    @unittest.skipUnless(sys.platform == "win32", "Windowsのコンソール非表示")
    def test_child_has_no_console_and_output_is_captured(self):
        process = start.launch_process("非表示試験", [sys.executable, "-c", "import ctypes; print(ctypes.windll.kernel32.GetConsoleWindow())"], SCRIPT.parent)
        output, _ = process.communicate(timeout=10)
        self.assertEqual(process.returncode, 0)
        self.assertEqual(output.strip(), b"0")

    def test_start_uses_detached_launcher(self):
        with patch.object(start.shutil, "which", return_value="node"), patch.object(start, "launch_process") as launch:
            start.start("npm")
            launch.assert_called_once_with("フロントエンド(Avatar)", ["node", str(SCRIPT.parent / "launch.mjs")], start.FRONTEND_AVATAR_DIR)

    def test_cli_delegates_to_launcher_and_returns_its_code(self):
        result = subprocess.CompletedProcess([], 0)
        with patch.object(start.shutil, "which", return_value="node"), patch.object(start.subprocess, "run", return_value=result) as run,                 patch.object(start.sys, "argv", ["aidiy_avatar"]), self.assertRaises(SystemExit) as stop:
            start.main()
        run.assert_called_once_with(["node", str(SCRIPT.parent / "launch.mjs")], cwd=str(start.FRONTEND_AVATAR_DIR))
        self.assertEqual(stop.exception.code, 0)


if __name__ == "__main__":
    unittest.main()
