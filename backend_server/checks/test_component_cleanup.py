# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""Backend / Hermes cleanup の結果を、一時フォルダとモックだけで検証する。"""

import contextlib
import importlib.util
import io
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
COMPONENTS = {
    "backend_local": ("BACKEND_LOCAL_DIR", "local"),
    "backend_server": ("BACKEND_DIR", "backend"),
    "backend_tools": ("BACKEND_TOOLS_DIR", "tools"),
    "backend_taskteam": ("BACKEND_TASKTEAM_DIR", "taskteam"),
    "command_hermes": ("BACKEND_HERMES_DIR", "hermes"),
}


def load_cleanup(folder):
    spec = importlib.util.spec_from_file_location(
        f"cleanup_result_{folder}", ROOT / folder / "_cleanup.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ComponentCleanupTests(unittest.TestCase):
    @contextlib.contextmanager
    def fixture(self, folder, *, mock_global_configs=True):
        with tempfile.TemporaryDirectory() as temporary, contextlib.ExitStack() as stack:
            base = Path(temporary)
            project = base / folder
            project.mkdir()
            home = base / "home"
            home.mkdir()
            module = load_cleanup(folder)
            directory_name, prefix = COMPONENTS[folder]
            stack.enter_context(patch.object(module, directory_name, project))
            stack.enter_context(patch.object(Path, "home", return_value=home))
            stack.enter_context(patch.object(subprocess, "run", side_effect=AssertionError("process forbidden")))
            stack.enter_context(patch.object(subprocess, "Popen", side_effect=AssertionError("process forbidden")))
            stack.enter_context(patch.object(module.shutil, "which", return_value=None))
            output = stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
            if folder == "backend_tools":
                stack.enter_context(patch.object(module, "stop_tools_processes", return_value=True))
                if mock_global_configs:
                    stack.enter_context(patch.object(module, "cleanup_global_mcp_configs", return_value=True))
            if folder == "command_hermes":
                stack.enter_context(patch.object(module, "remove_launcher_path", return_value=True))
                stack.enter_context(patch.object(module, "get_shell_profile_paths", return_value=[]))
            yield module, project, home, prefix, output

    def test_cleanup_needs_no_target_python_uv_node_or_manifest(self):
        for folder in COMPONENTS:
            with self.subTest(folder=folder), self.fixture(folder) as (module, project, _, prefix, _):
                # 起動不能な仮想環境でも cleanup できる。実行可能ファイルは置かない。
                (project / ".venv").mkdir()
                (project / "temp").mkdir()
                (project / "uv.lock").write_text("preserve", encoding="utf-8")
                self.assertTrue(module.cleanup({f"{prefix}_envs": {".venv": True}, f"{prefix}_temp": True}))
                self.assertFalse((project / ".venv").exists())
                self.assertFalse((project / "temp").exists())
                self.assertEqual((project / "uv.lock").read_text(encoding="utf-8"), "preserve")

    def test_declined_environment_and_temp_remain(self):
        for folder in COMPONENTS:
            with self.subTest(folder=folder), self.fixture(folder) as (module, project, _, prefix, _):
                for name in (".venv", "temp"):
                    (project / name).mkdir()
                with patch.object(module, "remove_directory", side_effect=AssertionError("delete forbidden")):
                    self.assertTrue(module.cleanup({f"{prefix}_envs": {".venv": False}, f"{prefix}_temp": False}))
                self.assertTrue((project / ".venv").is_dir())
                self.assertTrue((project / "temp").is_dir())

    def test_environment_failure_returns_false_without_success_summary(self):
        for folder in COMPONENTS:
            with self.subTest(folder=folder), self.fixture(folder) as (module, project, _, prefix, output):
                (project / ".venv").mkdir()
                with patch.object(module, "remove_directory", return_value=False):
                    self.assertFalse(module.cleanup({f"{prefix}_envs": {".venv": True}}))
                self.assertNotIn("クリーンアップ完了", output.getvalue())

    def test_temp_failure_returns_false(self):
        for folder in COMPONENTS:
            with self.subTest(folder=folder), self.fixture(folder) as (module, project, _, prefix, _):
                (project / "temp").mkdir()
                with patch.object(module, "remove_directory", return_value=False):
                    self.assertFalse(module.cleanup({f"{prefix}_temp": True}))

    def test_cache_failure_returns_false(self):
        for folder in COMPONENTS:
            for name in ("__pycache__", ".pytest_cache"):
                with self.subTest(folder=folder, cache=name), self.fixture(folder) as (module, project, _, _, _):
                    (project / name).mkdir()
                    with patch.object(module, "remove_directory", return_value=False):
                        self.assertFalse(module.cleanup({}))

    def test_missing_component_is_successful_noop(self):
        for folder in COMPONENTS:
            with self.subTest(folder=folder), self.fixture(folder) as (module, project, _, _, _):
                project.rmdir()
                self.assertTrue(module.cleanup({}))

    def test_standalone_main_preserves_failure_exit(self):
        for folder in COMPONENTS:
            with self.subTest(folder=folder), self.fixture(folder) as (module, _, _, _, output):
                with patch.object(module, "ask_start_mode", return_value=(True, False)), \
                     patch.object(module, "collect_choices", return_value={}), \
                     patch.object(module, "cleanup", return_value=False):
                    with self.assertRaises(SystemExit) as caught:
                        module.main()
                self.assertEqual(caught.exception.code, 1)
                self.assertNotIn("クリーンアップが完了しました", output.getvalue())

    def test_server_sqlite_is_preserved_unless_explicitly_selected(self):
        with self.fixture("backend_server") as (module, project, _, _, _):
            database = project.parent / "_data" / "AiDiy" / "database.db"
            database.parent.mkdir(parents=True)
            database.write_bytes(b"fixture database")
            with patch.object(module, "remove_file", side_effect=AssertionError("delete forbidden")):
                self.assertTrue(module.cleanup({}))
                self.assertTrue(module.cleanup({"backend_sqlite": False}))
            self.assertEqual(database.read_bytes(), b"fixture database")
            with patch.object(module, "remove_file", return_value=False):
                self.assertFalse(module.cleanup({"backend_sqlite": True}))

    def test_server_logs_failure_returns_false(self):
        with self.fixture("backend_server") as (module, project, _, _, _):
            (project / "logs").mkdir()
            with patch.object(module, "clean_directory_contents", return_value=False):
                self.assertFalse(module.cleanup({"backend_logs": True}))

    def test_hermes_launcher_failure_returns_false(self):
        with self.fixture("command_hermes") as (module, _, home, _, output):
            launcher = home / ".local" / "bin" / "aidiy_hermes"
            launcher.parent.mkdir(parents=True)
            launcher.write_text("fixture", encoding="utf-8")
            with patch.object(module, "remove_file", return_value=False):
                self.assertFalse(module.cleanup({}))
            self.assertNotIn("クリーンアップ完了", output.getvalue())

    def test_hermes_path_failure_returns_false(self):
        with self.fixture("command_hermes") as (module, _, _, _, _):
            with patch.object(module, "remove_launcher_path", return_value=False):
                self.assertFalse(module.cleanup({}))

    def test_hermes_profile_read_failure_returns_false(self):
        for missing_component in (False, True):
            with self.subTest(missing_component=missing_component), self.fixture("command_hermes") as (module, project, home, _, output):
                profile = home / ".profile"
                profile.write_text("# user settings\n", encoding="utf-8")
                if missing_component:
                    project.rmdir()
                with patch.object(module.sys, "platform", "linux"), \
                     patch.object(module, "get_shell_profile_paths", return_value=[profile]), \
                     patch.object(Path, "read_text", side_effect=PermissionError("profile read denied")):
                    self.assertFalse(module.cleanup({}))
                self.assertIn("PATH 設定の解除に失敗", output.getvalue())
                self.assertNotIn("クリーンアップ完了", output.getvalue())
                self.assertEqual(profile.read_text(encoding="utf-8"), "# user settings\n")

    def test_hermes_profile_write_failure_returns_false(self):
        with self.fixture("command_hermes") as (module, _, home, _, output):
            profile = home / ".profile"
            original = f"# user settings\n{module.SHELL_PATH_MARKER_BEGIN}\nfixture PATH\n{module.SHELL_PATH_MARKER_END}\n"
            profile.write_text(original, encoding="utf-8")
            with patch.object(module.sys, "platform", "linux"), \
                 patch.object(module, "get_shell_profile_paths", return_value=[profile]), \
                 patch.object(Path, "write_text", side_effect=PermissionError("profile write denied")):
                self.assertFalse(module.cleanup({}))
            self.assertIn("PATH 設定の解除に失敗", output.getvalue())
            self.assertNotIn("クリーンアップ完了", output.getvalue())
            self.assertEqual(profile.read_text(encoding="utf-8"), original)

    def test_hermes_profile_cleanup_reports_count_and_success(self):
        with self.fixture("command_hermes") as (module, _, home, _, _):
            profile = home / ".profile"
            original = f"# user settings\n{module.SHELL_PATH_MARKER_BEGIN}\nfixture PATH\n{module.SHELL_PATH_MARKER_END}\n"
            profile.write_text(original, encoding="utf-8")
            with patch.object(module.sys, "platform", "linux"), \
                 patch.object(module, "get_shell_profile_paths", return_value=[profile]):
                self.assertEqual(module.cleanup_shell_path_entries("fixture"), (1, True))
                self.assertEqual(module.cleanup_shell_path_entries("fixture"), (0, True))
            self.assertEqual(profile.read_text(encoding="utf-8"), "# user settings\n")

    def test_tools_global_config_failure_does_not_skip_later_targets(self):
        # JSON 6件、Codex、Grok、VS Code chat の対象と順序を増減しない。
        for failure_index in range(9):
            with self.subTest(failure_index=failure_index), self.fixture("backend_tools", mock_global_configs=False) as (module, _, _, _, output):
                results = [index != failure_index for index in range(9)]
                with patch.object(module, "remove_json_mcp_servers_by_prefix", side_effect=results[:6]) as json_configs, \
                     patch.object(module, "remove_codex_mcp_servers_by_prefix", return_value=results[6]) as codex, \
                     patch.object(module, "remove_grok_mcp_servers_by_prefix", return_value=results[7]) as grok, \
                     patch.object(module, "remove_vscode_aidiy_chat_models", return_value=results[8]) as vscode, \
                     patch.object(Path, "read_text", side_effect=AssertionError("read forbidden")), \
                     patch.object(Path, "write_text", side_effect=AssertionError("write forbidden")):
                    self.assertFalse(module.cleanup_global_mcp_configs("aidiy_"))
                self.assertEqual(json_configs.call_count, 6)
                codex.assert_called_once_with("aidiy_")
                grok.assert_called_once_with("aidiy_")
                vscode.assert_called_once()
                self.assertNotIn("解除処理を完了", output.getvalue())

    def test_tools_global_config_missing_files_are_successful_noops(self):
        with self.fixture("backend_tools", mock_global_configs=False) as (module, _, _, _, _):
            with patch.object(Path, "exists", return_value=False), \
                 patch.object(Path, "read_text", side_effect=AssertionError("read forbidden")), \
                 patch.object(Path, "write_text", side_effect=AssertionError("write forbidden")):
                self.assertTrue(module.cleanup_global_mcp_configs("aidiy_"))

    def test_tools_global_config_failure_reaches_cleanup_result_and_summary(self):
        for missing_component in (False, True):
            with self.subTest(missing_component=missing_component), self.fixture("backend_tools") as (module, project, _, _, output):
                if missing_component:
                    project.rmdir()
                else:
                    (project / ".venv").mkdir()
                with patch.object(module, "cleanup_global_mcp_configs", return_value=False) as configs:
                    self.assertFalse(module.cleanup({"tools_envs": {".venv": True}}))
                configs.assert_called_once_with(module.BACKEND_TOOLS_SERVER_PREFIX)
                self.assertNotIn("クリーンアップ完了", output.getvalue())


if __name__ == "__main__":
    unittest.main()
