# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""全体セットアップの終了結果を、インストール・通信・設定変更なしで検証する。"""
import contextlib
import importlib.util
import io
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))


def load_setup():
    spec = importlib.util.spec_from_file_location("setup_result_test", ROOT / "_setup.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class SetupResultTests(unittest.TestCase):
    @contextlib.contextmanager
    def execution(self, *, continue_on_error=True, real_common=False):
        module = load_setup()
        choices = dict.fromkeys((
            "common", "local", "mcp", "mcp_config", "backend", "taskteam",
            "web", "avatar", "hermes", "ide", "diag", "discord",
        ), True)
        choices.update(continue_on_error=continue_on_error, local_download="no")
        components = {}

        def component(folder):
            if folder not in components:
                components[folder] = Mock()
                components[folder].launch_model_download.return_value = False
                for name in ("setup", "setup_desktop", "setup_dependencies", "configure_clients"):
                    getattr(components[folder], name).return_value = True
            return components[folder]

        # 遅延 import と同じ参照先を用意し、Git 初期化も遮断する。
        sys.path.insert(0, str(ROOT))
        try:
            from scripts import local_git_setup
            with contextlib.ExitStack() as stack:
                output = stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
                stack.enter_context(patch.object(module.sys, "argv", [str(ROOT / "_setup.py")]))
                stack.enter_context(patch.object(module, "collect_setup_choices", return_value=choices))
                for name in ("stop_setup_apps", "ensure_prerequisites", "remove_folder_import_caches"):
                    stack.enter_context(patch.object(module, name))
                stack.enter_context(patch.object(module.time, "sleep"))
                stack.enter_context(patch.object(module, "_load_folder_module", side_effect=component))
                stack.enter_context(patch.object(local_git_setup, "ensure_local_git", return_value=("skipped", "fixture")))
                if not real_common:
                    stack.enter_context(patch.object(module, "setup_common_global_tools", return_value=[]))
                    stack.enter_context(patch.object(module, "wait_global_cli_tools_install", return_value=[]))
                stack.enter_context(patch.object(module, "run_diag_headless", return_value=True))
                stack.enter_context(patch.object(module, "setup_node_refresh", return_value=[]))
                stack.enter_context(patch.object(module, "setup_launchers_only", return_value=[]))
                # モックの漏れがあれば、実行するのではなくテストを失敗させる。
                for name in ("run", "Popen"):
                    stack.enter_context(patch.object(module.subprocess, name, side_effect=AssertionError("process forbidden")))
                yield module, choices, component, output, local_git_setup
        finally:
            sys.path.remove(str(ROOT))

    def test_success_keeps_zero_exit_and_success_message(self):
        with self.execution() as (module, _, component, output, _git):
            self.assertIsNone(module.main())
            self.assertIn("セットアップは正常終了しました。", output.getvalue())
            component("frontend_channels").setup.assert_called_once()
            module.run_diag_headless.assert_called_once()

    def test_continue_runs_later_stages_but_returns_failure(self):
        for failure in ("Web", "共通", "Git", "Diag: aidiy_diag --headless"):
            with self.subTest(failure=failure), self.execution() as (module, _, component, output, git):
                if failure == "Web":
                    component("frontend_web").setup.return_value = False
                elif failure == "共通":
                    module.setup_common_global_tools.return_value = ["共通: Python"]
                elif failure == "Git":
                    git.ensure_local_git.return_value = ("error", "fixture Git error")
                else:
                    module.run_diag_headless.return_value = False
                with self.assertRaises(SystemExit) as caught:
                    module.main()
                self.assertEqual(caught.exception.code, 1)
                self.assertIn(failure, output.getvalue())
                self.assertIn("セットアップに失敗した項目があります。", output.getvalue())
                self.assertNotIn("セットアップは正常終了しました。", output.getvalue())
                component("frontend_channels").setup.assert_called_once()
                module.run_diag_headless.assert_called_once()

    def test_all_failed_stages_are_preserved_in_summary(self):
        with self.execution() as (module, _, component, output, _git):
            component("frontend_web").setup.return_value = False
            component("frontend_channels").setup.return_value = False
            module.run_diag_headless.return_value = False
            with self.assertRaises(SystemExit) as caught:
                module.main()
            self.assertEqual(caught.exception.code, 1)
            for label in ("  - Web", "  - Discord", "  - Diag: aidiy_diag --headless"):
                self.assertIn(label, output.getvalue())

    def test_fail_fast_stops_before_later_stage(self):
        with self.execution(continue_on_error=False) as (module, _, component, output, _git):
            component("frontend_web").setup.return_value = False
            with self.assertRaises(SystemExit) as caught:
                module.main()
            self.assertEqual(caught.exception.code, 1)
            component("frontend_avatar").setup.assert_not_called()
            module.run_diag_headless.assert_not_called()
            self.assertNotIn("セットアップは正常終了しました。", output.getvalue())

    def test_model_download_launch_failure_is_reported_and_honors_continue(self):
        for continue_on_error in (False, True):
            with self.subTest(continue_on_error=continue_on_error), self.execution(continue_on_error=continue_on_error) as (module, choices, component, output, _git):
                choices["local_download"] = "one"
                component("backend_local").launch_model_download.return_value = False
                with self.assertRaises(SystemExit) as caught:
                    module.main()
                self.assertEqual(caught.exception.code, 1)
                self.assertIn("  - Local: モデルダウンロード投入", output.getvalue())
                self.assertNotIn("別プロセスで継続中", output.getvalue())
                self.assertNotIn("セットアップは正常終了しました。", output.getvalue())
                self.assertEqual(component("command_hermes").setup.call_count, int(continue_on_error))

    def test_failed_local_setup_never_launches_download(self):
        with self.execution() as (module, choices, component, output, _git):
            choices["local_download"] = "all"
            component("backend_local").setup.return_value = False
            with self.assertRaises(SystemExit) as caught:
                module.main()
            self.assertEqual(caught.exception.code, 1)
            component("backend_local").launch_model_download.assert_not_called()
            component("command_hermes").setup.assert_called_once()
            self.assertNotIn("別プロセスで継続中", output.getvalue())

    def test_requested_model_download_success_is_reported(self):
        for mode in ("one", "all", True):
            with self.subTest(mode=mode), self.execution() as (module, choices, component, output, _git):
                choices["local_download"] = mode
                component("backend_local").launch_model_download.return_value = True
                self.assertIsNone(module.main())
                component("backend_local").launch_model_download.assert_called_once_with(choices)
                self.assertIn("モデルダウンロードは別プロセスに投入済み", output.getvalue())

    def test_other_setup_failure_still_allows_requested_local_download(self):
        with self.execution() as (module, choices, component, output, _git):
            choices["local_download"] = "one"
            component("frontend_web").setup.return_value = False
            component("backend_local").launch_model_download.return_value = True
            with self.assertRaises(SystemExit) as caught:
                module.main()
            self.assertEqual(caught.exception.code, 1)
            component("backend_local").launch_model_download.assert_called_once_with(choices)
            self.assertIn("  - Web", output.getvalue())
            self.assertIn("モデルダウンロードは別プロセスに投入済み", output.getvalue())

    def test_unrequested_model_download_is_not_a_failure(self):
        for enabled, mode in ((True, "no"), (True, False), (False, "one")):
            with self.subTest(enabled=enabled, mode=mode), self.execution() as (module, choices, component, output, _git):
                choices.update(local=enabled, local_download=mode)
                component("backend_local").launch_model_download.return_value = False
                self.assertIsNone(module.main())
                self.assertNotIn("モデルダウンロードは別プロセス", output.getvalue())

    def test_common_fail_fast_also_waits_for_already_started_cli(self):
        for failure in ("common", "cli"):
            with self.subTest(failure=failure), self.execution(continue_on_error=False) as (module, _, component, _output, _git):
                module.GLOBAL_CLI_INSTALL_PROCESSES = [object()]
                if failure == "common":
                    module.setup_common_global_tools.return_value = ["共通: Python"]
                else:
                    module.wait_global_cli_tools_install.return_value = ["fixture-cli"]
                with self.assertRaises(SystemExit) as caught:
                    module.main()
                self.assertEqual(caught.exception.code, 1)
                module.wait_global_cli_tools_install.assert_called_once()
                component("backend_diag").setup.assert_not_called()
                module.run_diag_headless.assert_not_called()

    def test_prerequisite_failure_always_stops_and_restores_auto_mode(self):
        for continue_on_error in (False, True):
            with self.subTest(continue_on_error=continue_on_error), self.execution(continue_on_error=continue_on_error) as (module, _, component, output, git):
                module.AUTO_MODE = True
                def prerequisite():
                    self.assertFalse(module.AUTO_MODE)
                    return False
                module.ensure_prerequisites.side_effect = prerequisite
                with self.assertRaises(SystemExit) as caught:
                    module.main()
                self.assertEqual(caught.exception.code, 1)
                self.assertTrue(module.AUTO_MODE)
                git.ensure_local_git.assert_not_called()
                module.setup_common_global_tools.assert_not_called()
                component("backend_diag").setup.assert_not_called()
                self.assertIn("前提条件: Git / Node.js", output.getvalue())
                self.assertNotIn("セットアップは正常終了しました。", output.getvalue())

    def test_cli_preparation_and_spawn_failures_reach_final_summary(self):
        for continue_on_error in (False, True):
            with self.subTest(continue_on_error=continue_on_error), self.execution(continue_on_error=continue_on_error, real_common=True) as (module, choices, component, output, _git):
                choices["common_npm_install"] = True
                with patch.object(module, "check_npm_installed", return_value=True), \
                     patch.object(module, "prepare_antigravity_installer", return_value=(None, None)), \
                     patch.object(module, "prepare_grok_build_installer", return_value=(None, None)), \
                     patch.object(module.subprocess, "Popen", side_effect=OSError("fixture spawn failure")) as spawn:
                    with self.assertRaises(SystemExit) as caught:
                        module.main()
                self.assertEqual(caught.exception.code, 1)
                self.assertEqual(spawn.call_count, 4)
                for package in ("@anthropic-ai/claude-code", "@github/copilot", "@openai/codex", "@opencode/cli", "antigravity", "grok-build"):
                    self.assertIn(f"  - 共通: AI CLI ツール導入 ({package})", output.getvalue())
                self.assertEqual(component("backend_diag").setup.call_count, int(continue_on_error))
                self.assertNotIn("セットアップは正常終了しました。", output.getvalue())

    def test_cli_mixed_failures_wait_for_started_processes_before_stopping(self):
        with self.execution(continue_on_error=False, real_common=True) as (module, choices, component, output, _git):
            choices["common_npm_install"] = True
            success = Mock(returncode=0)
            success.communicate.return_value = ("", "")
            failed = Mock(returncode=2)
            failed.communicate.return_value = ("", "fixture failure")
            opencode = Mock(returncode=0)
            opencode.communicate.return_value = ("", "")
            temp = Mock()
            with patch.object(module, "check_npm_installed", return_value=True), \
                 patch.object(module, "prepare_antigravity_installer", return_value=(["fixture"], temp)), \
                 patch.object(module, "prepare_grok_build_installer", return_value=(None, None)), \
                 patch.object(module.subprocess, "Popen", side_effect=[success, OSError("spawn"), failed, opencode, OSError("spawn")]):
                with self.assertRaises(SystemExit) as caught:
                    module.main()
            self.assertEqual(caught.exception.code, 1)
            success.communicate.assert_called_once_with(timeout=300)
            failed.communicate.assert_called_once_with(timeout=300)
            opencode.communicate.assert_called_once_with(timeout=None)
            temp.unlink.assert_called_once()
            self.assertEqual(module.GLOBAL_CLI_INSTALL_PROCESSES, [])
            for package in ("@github/copilot", "@openai/codex", "antigravity", "grok-build"):
                self.assertIn(f"  - 共通: AI CLI ツール導入 ({package})", output.getvalue())
            self.assertNotIn("  - 共通: AI CLI ツール導入 (@opencode/cli)", output.getvalue())
            component("backend_diag").setup.assert_not_called()

    def test_partial_preparation_and_spawn_failure_with_other_cli_success(self):
        with self.execution(real_common=True) as (module, choices, component, output, _git):
            choices["common_npm_install"] = True
            processes = [Mock(returncode=0) for _ in range(4)]
            for process in processes:
                process.communicate.return_value = ("", "")
            with patch.object(module, "check_npm_installed", return_value=True), \
                 patch.object(module, "prepare_antigravity_installer", return_value=(None, None)), \
                 patch.object(module, "prepare_grok_build_installer", return_value=(["fixture"], None)), \
                 patch.object(module.subprocess, "Popen", side_effect=[OSError("spawn"), *processes]):
                with self.assertRaises(SystemExit) as caught:
                    module.main()
            self.assertEqual(caught.exception.code, 1)
            for process in processes:
                process.communicate.assert_called_once()
            self.assertIn("  - 共通: AI CLI ツール導入 (antigravity)", output.getvalue())
            self.assertIn("  - 共通: AI CLI ツール導入 (@anthropic-ai/claude-code)", output.getvalue())
            self.assertNotIn("  - 共通: AI CLI ツール導入 (grok-build)", output.getvalue())
            self.assertNotIn("セットアップは正常終了しました。", output.getvalue())
            component("frontend_channels").setup.assert_called_once()

    def test_all_cli_success_keeps_success_result(self):
        with self.execution(real_common=True) as (module, choices, _component, output, _git):
            choices["common_npm_install"] = True
            processes = [Mock(returncode=0) for _ in range(6)]
            for process in processes:
                process.communicate.return_value = ("", "")
            with patch.object(module, "check_npm_installed", return_value=True), \
                 patch.object(module, "prepare_antigravity_installer", return_value=(["fixture"], None)), \
                 patch.object(module, "prepare_grok_build_installer", return_value=(["fixture"], None)), \
                 patch.object(module.subprocess, "Popen", side_effect=processes):
                self.assertIsNone(module.main())
            for process in processes:
                process.communicate.assert_called_once()
            self.assertEqual(module.GLOBAL_CLI_INSTALL_PROCESSES, [])
            self.assertIn("セットアップは正常終了しました。", output.getvalue())

    def test_missing_npm_records_all_requested_npm_packages(self):
        module = load_setup()
        with contextlib.redirect_stdout(io.StringIO()), \
             patch.object(module, "check_npm_installed", return_value=False), \
             patch.object(module, "prepare_antigravity_installer", return_value=(None, None)), \
             patch.object(module, "prepare_grok_build_installer", return_value=(None, None)), \
             patch.object(module.subprocess, "Popen", side_effect=AssertionError("process forbidden")) as spawn:
            failures = module.start_global_cli_tools_install()
        self.assertEqual(set(failures), {"@anthropic-ai/claude-code", "@github/copilot", "@openai/codex", "@opencode/cli", "antigravity", "grok-build"})
        spawn.assert_not_called()

    def test_build_and_launcher_modes_keep_failure_exit(self):
        for mode in ("node_refresh", "launchers"):
            for failed in (False, True):
                with self.subTest(mode=mode, failed=failed), self.execution() as (module, choices, _component, output, _git):
                    errors = ["fixture failure"] if failed else []
                    if mode == "node_refresh":
                        choices["node_refresh"] = True
                        module.setup_node_refresh.return_value = errors
                    else:
                        module.sys.argv.append("--launchers-only")
                        module.setup_launchers_only.return_value = errors
                    if failed or mode == "launchers":
                        with self.assertRaises(SystemExit) as caught:
                            module.main()
                        self.assertEqual(caught.exception.code, int(failed))
                    else:
                        self.assertIsNone(module.main())
                    module.run_diag_headless.assert_not_called()
                    if failed:
                        self.assertIn("fixture failure", output.getvalue())
                        self.assertNotIn("セットアップは正常終了しました。", output.getvalue())


if __name__ == "__main__":
    unittest.main()
