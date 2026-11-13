# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""git pull後の再ビルドを、インストール・設定変更・OS窓起動なしで検証する。"""
import contextlib
import importlib.util
import io
import os
from pathlib import Path
import subprocess
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


setup = load("node_refresh_root", "_setup.py")
common = load("node_refresh_electron", "scripts/_setup_electron.py")
host = load("node_refresh_host", "frontend_ide/host/_setup.py")


class NodeRefreshTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(contextlib.redirect_stdout(io.StringIO()))
        self.enterContext(patch.object(setup, "AUTO_MODE", False))

    def test_existing_keys_and_new_key_are_case_insensitive(self):
        for key, expected in [(b"y", (True, False)), (b"n", (False, False)),
                              (b"a", (True, True)), (b"b", ("node", False))]:
            for value in (key, key.upper()):
                with self.subTest(key=value), patch.object(setup, "_read_single_key", return_value=value) as read:
                    self.assertEqual(setup.ask_start_mode("test"), expected)
                    self.assertIn(value, read.call_args.args[0])
                    self.assertEqual(read.call_args.args[1], b"n")

    def test_start_prompt_describes_build_and_removes_old_key(self):
        for default in ("n", "y"):
            with self.subTest(default=default), contextlib.redirect_stdout(io.StringIO()) as output, patch.object(setup, "_read_single_key", return_value=b"b") as read:
                self.assertEqual(setup.ask_start_mode("test", default=default), ("node", False))
                self.assertIn("b=build（Node.js系の再ビルド）", output.getvalue())
                self.assertNotIn("r=", output.getvalue())
                self.assertEqual(set(read.call_args.args[0]), {b"y", b"Y", b"n", b"N", b"a", b"A", b"b", b"B"})
                self.assertEqual(read.call_args.args[1], default.encode("ascii"))

    def test_enter_keeps_default_and_old_key_does_not_start_build(self):
        with patch.object(setup.sys, "platform", "linux"):
            for response in ("", "r", "R"):
                with self.subTest(response=response), patch("builtins.input", return_value=response):
                    self.assertEqual(setup.ask_start_mode("test"), (False, False))
            with patch("builtins.input", return_value=""):
                self.assertEqual(setup.ask_start_mode("test", default="y"), (True, False))

    def test_cancel_and_auto_keep_existing_choices(self):
        with patch.object(setup, "_read_single_key", return_value=b"n"), patch.object(setup, "ask_yes_no") as ask:
            self.assertIsNone(setup.collect_setup_choices())
            ask.assert_not_called()
        with patch.object(setup, "_read_single_key", return_value=b"a") as read:
            choices = setup.collect_setup_choices()
            read.assert_called_once()
            self.assertTrue(choices["common_python_upgrade"])
            self.assertTrue(choices["local"])
            self.assertEqual(choices["local_download"], "no")
            self.assertTrue(choices["mcp_config"])
            self.assertNotIn("node_refresh", choices)
        with patch.object(setup, "_read_single_key", return_value=b"y"), patch.object(setup, "ask_yes_no", return_value=False) as ask:
            choices = setup.collect_setup_choices()
            self.assertGreater(ask.call_count, 0)
            self.assertTrue(choices["diag"])
            self.assertFalse(choices["common"])
            self.assertFalse(setup.AUTO_MODE)

    def test_refresh_bypasses_full_setup_and_reports_failure_exit(self):
        for failures in ([], ["Web: ビルド"]):
            with self.subTest(failures=failures), contextlib.ExitStack() as stack:
                stack.enter_context(patch.object(setup, "_read_single_key", return_value=b"b"))
                output = stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
                refresh = stack.enter_context(patch.object(setup, "setup_node_refresh", return_value=failures))
                # main の起動前整理も模擬し、実プロセスの列挙・停止へ入らない。
                stack.enter_context(patch.object(setup, "stop_setup_apps"))
                for name in ("ask_yes_no", "ensure_prerequisites", "setup_common_global_tools", "run_diag_headless", "_load_folder_module"):
                    stack.enter_context(patch.object(setup, name, side_effect=AssertionError("full setup forbidden")))
                if failures:
                    with self.assertRaises(SystemExit) as result:
                        setup.main()
                    self.assertEqual(result.exception.code, 1)
                else:
                    setup.main()
                refresh.assert_called_once()
                self.assertIn("b=build（Node.js系の再ビルド）", output.getvalue())

    def fixture(self, *, desktop=True):
        self.enterContext(patch.object(setup, "get_node_version", return_value="v24.0.0"))
        self.enterContext(patch.object(setup, "get_npm_version", return_value="11"))
        self.enterContext(patch.object(setup, "npm_command", return_value="npm"))
        self.enterContext(patch.dict(os.environ, {"CODESPACES": "false" if desktop else "true", "ELECTRON_SKIP_BINARY_DOWNLOAD": "", "DISPLAY": ":fixture"}))
        prepare = self.enterContext(patch.object(common, "prepare_electron_binary", return_value=True))
        # 実機で Discord / Slack 等のパネルが起動中でも、使用中保護で手順が省かれないよう固定する。
        self.enterContext(patch.object(common, "frontend_dependency_guard", return_value=None))
        self.enterContext(patch.object(setup.importlib.util, "spec_from_file_location", return_value=SimpleNamespace(loader=SimpleNamespace(exec_module=lambda module: None))))
        self.enterContext(patch.object(setup.importlib.util, "module_from_spec", return_value=common))
        run = self.enterContext(patch.object(setup, "run_command", return_value=True))
        modules = {
            "frontend_diag": SimpleNamespace(setup=Mock(return_value=True)),
            "frontend_avatar": SimpleNamespace(install_standalone_launcher=Mock(return_value=True)),
            "frontend_ide/host": SimpleNamespace(setup_assets=Mock(return_value=True), install_standalone_launcher=Mock(return_value=True)),
            "frontend_ide/viewer": SimpleNamespace(install_launcher=Mock(return_value=None)),
            "frontend_ide/aidiy_navi": SimpleNamespace(setup=Mock(return_value=True)),
            "frontend_ide/aidiy_console": SimpleNamespace(setup=Mock(return_value=True)),
            "frontend_ide/aidiy_task": SimpleNamespace(setup=Mock(return_value=True)),
            "frontend_ide/aidiy_team": SimpleNamespace(setup=Mock(return_value=True)),
            "frontend_ide/aidiy_browser": SimpleNamespace(setup=Mock(return_value=True)),
            "frontend_ide/aidiy_cpu": SimpleNamespace(setup=Mock(return_value=True)),
            # setup()やconf_jsonは用意しない。設定補完経路へ入れば失敗する。
            "frontend_channels/discord": SimpleNamespace(install_launcher=Mock(return_value=None)),
            "frontend_channels/slack": SimpleNamespace(install_launcher=Mock(return_value=None)),
        }
        self.enterContext(patch.object(setup, "_load_folder_module", side_effect=modules.__getitem__))
        return run, prepare, modules

    def test_refresh_warns_and_continues_for_old_or_unparseable_node(self):
        run, _prepare, _modules = self.fixture()
        for version in ('v20.18.0', 'unknown'):
            with self.subTest(version=version), patch.object(setup, 'get_node_version', return_value=version), contextlib.redirect_stdout(io.StringIO()) as output:
                self.assertEqual(setup.setup_node_refresh(), [])
                self.assertIn('[WARN]', output.getvalue())
        self.assertGreater(run.call_count, 0)

    def test_refresh_syncs_all_dependencies_and_always_builds_then_reinstalls_launchers(self):
        run, prepare, modules = self.fixture()
        # 2回目（依存導入済み）もsource変更を反映するため全ビルドを呼ぶ。
        for _ in range(2):
            self.assertEqual(setup.setup_node_refresh(), [])
        commands = [call.args[0] for call in run.call_args_list]
        self.assertEqual(sum(command[1] == "install" for command in commands), 16)
        self.assertTrue(all(command[1] in ("install", "ci", "run") for command in commands))
        self.assertTrue(all("--include=dev" in command for command in commands if command[1] in ("install", "ci")))
        clean_installs = [call.kwargs["cwd"].relative_to(ROOT).as_posix()
                          for call in run.call_args_list if call.args[0][1] == "ci"]
        self.assertEqual(clean_installs, ["frontend_channels/discord"] * 2)
        builds = [(call.kwargs["cwd"].relative_to(ROOT).as_posix(), call.args[0][-1])
                  for call in run.call_args_list if call.args[0][1] == "run"]
        self.assertEqual(builds, [("frontend_diag/ui", "build"), ("frontend_web", "build"),
                                 ("frontend_avatar", "build"), ("frontend_channels/discord", "build:panel"),
                                 ("frontend_channels/slack", "build:panel")] * 2)
        self.assertEqual(prepare.call_count, 12)
        modules["frontend_diag"].setup.assert_called_with(desktop=False)
        self.assertEqual(modules["frontend_ide/host"].setup_assets.call_count, 2)
        modules["frontend_ide/host"].setup_assets.assert_called_with("npm", choices={"_defer_ide_launchers": True})
        self.assertEqual(modules["frontend_channels/discord"].install_launcher.call_count, 2)
        self.assertEqual(modules["frontend_channels/slack"].install_launcher.call_count, 2)

    def test_refresh_registers_apps_in_canonical_order_after_assets(self):
        _, _, modules = self.fixture()
        events = []
        host = modules['frontend_ide/host']
        host.setup_assets.side_effect = lambda *args, **kwargs: events.append('assets') or True
        host.install_standalone_launcher.side_effect = lambda: events.extend(['code', 'live']) or True
        modules['frontend_ide/viewer'].install_launcher.side_effect = lambda *args: events.append('ide') or True
        for kind in ('console', 'browser', 'navi', 'task', 'team', 'cpu'):
            modules['frontend_ide/aidiy_' + kind].setup.side_effect = lambda kind=kind: events.append(kind) or True
        self.assertEqual(setup.setup_node_refresh(), [])
        self.assertEqual(events, ['assets', 'ide', 'console', 'browser', 'navi', 'code', 'live', 'task', 'team', 'cpu'])

    def test_browser_environment_skips_electron_binary_but_builds(self):
        run, prepare, _ = self.fixture(desktop=False)
        self.assertEqual(setup.setup_node_refresh(), [])
        prepare.assert_not_called()
        self.assertTrue(any(call.args[0][1] == "run" for call in run.call_args_list))

    def test_failure_stops_before_later_builds_and_launchers(self):
        run, _, modules = self.fixture()
        run.side_effect = lambda command, **kwargs: not (command[1] == "run" and kwargs["cwd"].name == "frontend_web")
        self.assertEqual(setup.setup_node_refresh(), ["Web: ビルド"])
        modules["frontend_avatar"].install_standalone_launcher.assert_not_called()
        modules["frontend_ide/host"].setup_assets.assert_not_called()

    def test_launcher_exception_is_not_reported_as_success(self):
        _, _, modules = self.fixture()
        modules["frontend_channels/discord"].install_launcher.side_effect = OSError("fixture")
        self.assertEqual(setup.setup_node_refresh(), ["Discord: aidiy_discord"])

    def test_missing_node_stops_without_installation(self):
        with patch.object(setup, "get_node_version", return_value=None), patch.object(setup, "run_command") as run, contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(setup.setup_node_refresh(), ["Node.js / npm の確認"])
            run.assert_not_called()
            self.assertIn("Node.js系の再ビルド", output.getvalue())
            self.assertIn("導入後に b（build）を再実行", output.getvalue())

    def test_dependency_recovery_keeps_refresh_flags_and_rebuilds(self):
        run = Mock(side_effect=[False, True, True])
        with patch.object(common, "frontend_dependency_guard", return_value=None), patch.object(common, "prepare_electron_binary", return_value=True), patch.object(common, "electron_binary_ready", return_value=True):
            self.assertTrue(common.setup_dependencies(ROOT, "npm", "fixture", run, update=False))
        self.assertEqual([call.args[0] for call in run.call_args_list], [
            ["npm", "install", "--include=dev", "--no-fund", "--no-audit"],
            ["npm", "install", "--include=dev", "--no-fund", "--no-audit", "--ignore-scripts"],
            ["npm", "rebuild"],
        ])

    def test_locked_refresh_keeps_ci_on_recovery_and_failure(self):
        for continued in (False, True):
            run = Mock(side_effect=[False, True, True] if not continued else [False])
            with patch.object(common, "frontend_dependency_guard", return_value=None):
                self.assertEqual(common.setup_dependencies(ROOT, "npm", "Discord", run,
                    update=False, locked=True, desktop=False, continue_on_error=continued), not continued)
            commands = [call.args[0] for call in run.call_args_list]
            self.assertEqual(commands[0], ["npm", "ci", "--include=dev", "--no-fund", "--no-audit"])
            self.assertFalse(any(command[1] == "install" for command in commands))
            if not continued:
                self.assertEqual(commands[1], [*commands[0], "--ignore-scripts"])
                self.assertEqual(commands[2], ["npm", "rebuild"])

    def test_locked_refresh_respects_running_app_guard(self):
        run = Mock()
        with patch.object(common, "frontend_dependency_guard", return_value=False):
            self.assertFalse(common.setup_dependencies(ROOT, "npm", "Discord", run,
                update=False, locked=True))
        run.assert_not_called()

    def test_host_assets_use_existing_compile_or_package_and_stop_on_failure(self):
        for cli, success in [(None, True), ("code", True), (None, False)]:
            with self.subTest(cli=cli, success=success), patch.object(host, "find_vscode_cli", return_value=cli), patch.object(host, "run_command", return_value=success) as run, patch.object(host, "install_extensions", return_value=True) as extensions, patch.object(host, "install_standalone_launcher", return_value=True) as launcher, patch.object(host, "setup_dependencies", side_effect=AssertionError("dependencies already synced")):
                self.assertEqual(host.setup_assets("npm"), success)
                self.assertEqual(run.call_args.args[0], ["npm", "run", "package" if cli else "compile"])
                self.assertEqual(launcher.call_count, int(success))
                self.assertEqual(extensions.call_count, int(success and cli is not None))
        # 共通UIのビルドを省略しない既存compile経路を維持する。
        self.assertIn("../../scripts/build.mjs", (ROOT / "frontend_ide/host/scripts/build.mjs").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
