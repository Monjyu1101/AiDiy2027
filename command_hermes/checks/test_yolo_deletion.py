"""YOLO の削除承認を、一時ファイルと外部通信なしで検証する。"""

from __future__ import annotations

import os
import json
import logging
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
# CLI/config の import も利用者の設定・認証ストアから切り離す。
_home = tempfile.TemporaryDirectory(prefix="aidiy-yolo-check-")
_env = patch.dict(os.environ, {
    "HOME": _home.name,
    "USERPROFILE": _home.name,
    "HERMES_HOME": str(Path(_home.name) / ".hermes"),
    "HERMES_YOLO_MODE": "0",
    "HERMES_INTERACTIVE": "1",
    "HERMES_GATEWAY_SESSION": "",
    "HERMES_CRON_SESSION": "",
    "HERMES_SINGLE_QUERY": "",
    "HERMES_SESSION_PLATFORM": "",
    "HERMES_EXEC_ASK": "",
    "HERMES_TERMINAL_SECURITY_MODE": "auto",
})
_env.start()
import cli_main
from agent import codex_runtime
from agent.transports import codex_app_server_session as codex_transport
from tools import approval, terminal_tool


def tearDownModule():
    _env.stop()
    # Windows は開いたままのログ（.__agent.lock）を削除できないため、先にハンドラーを閉じる。
    logging.shutdown()
    _home.cleanup()


class YoloDeletionTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="aidiy-delete-fixture-")
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "delete-me.txt"
        self.path.write_text("disposable fixture", encoding="utf-8")
        # Unix/Windows の両削除コマンドを判定だけ検証し、実行は fixture.unlink に限定。
        self.command = f'rm -rf "{self.path.as_posix()}"'
        self.session = f"yolo-fixture-{id(self)}"
        self.prompt = Mock(return_value="deny")
        for target, value in (
            ("_YOLO_MODE_FROZEN", False),
            ("_get_approval_config", Mock(return_value={"mode": "manual"})),
            ("_release_permission_mode_dependents", Mock()),
            ("_fire_approval_hook", Mock()),
        ):
            patcher = patch.object(approval, target, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        security = patch("tools.tirith_security.check_command_security", return_value={"action": "allow"})
        security.start()
        self.addCleanup(security.stop)
        token = approval.set_current_session_key("")
        self.addCleanup(approval.reset_current_session_key, token)
        terminal_tool.set_approval_callback(self.prompt)
        self.addCleanup(terminal_tool.set_approval_callback, None)
        self.addCleanup(approval.disable_session_yolo, self.session)
        self.cli = SimpleNamespace(session_id=self.session, _console_print=Mock())

    def _bang(self):
        def delete_fixture(command, **kwargs):
            self.assertEqual(command, self.command)
            self.path.unlink()
            return 0
        with patch("hermes_cli.bang_shell.run_bang_command", side_effect=delete_fixture) as run:
            self.assertTrue(cli_main.HermesCLI.handle_bang_shell(self.cli, "!" + self.command))
            return run.call_count

    def test_default_cli_is_not_yolo(self):
        self.assertFalse(cli_main._build_arg_parser().parse_args([]).yolo)
        self.assertTrue(cli_main._build_arg_parser().parse_args(["--yolo"]).yolo)

    def test_normal_bang_deletion_requires_confirmation(self):
        self.assertEqual(self._bang(), 0)
        self.assertTrue(self.path.exists())
        self.prompt.assert_called_once()

    def test_normal_bang_deletion_runs_only_after_confirmation(self):
        self.prompt.return_value = "once"
        self.assertEqual(self._bang(), 1)
        self.assertFalse(self.path.exists())
        self.prompt.assert_called_once()

    def test_session_yolo_bang_deletion_is_allowed_without_prompt(self):
        approval.enable_session_yolo(self.session)
        self.assertEqual(self._bang(), 1)
        self.assertFalse(self.path.exists())
        self.prompt.assert_not_called()
        self.assertEqual(approval.get_current_session_key(default=""), "")

    def test_yolo_off_restores_bang_confirmation(self):
        approval.enable_session_yolo(self.session)
        approval.disable_session_yolo(self.session)
        self.assertEqual(self._bang(), 0)
        self.assertTrue(self.path.exists())
        self.prompt.assert_called_once()

    def test_other_sessions_yolo_does_not_allow_bang_deletion(self):
        approval.enable_session_yolo(self.session)
        self.cli.session_id = "other-session"
        self.assertEqual(self._bang(), 0)
        self.assertTrue(self.path.exists())

    def test_bang_restores_context_when_guard_fails(self):
        from hermes_cli.bang_shell import check_bang_approval
        with patch.object(terminal_tool, "_check_all_guards", side_effect=RuntimeError("fixture")):
            with self.assertRaisesRegex(RuntimeError, "fixture"):
                check_bang_approval(self.command, session_key=self.session)
        self.assertEqual(approval.get_current_session_key(default=""), "")

    def test_normal_terminal_delete_and_windows_delete_follow_yolo(self):
        token = approval.set_current_session_key(self.session)
        self.addCleanup(approval.reset_current_session_key, token)
        for command in (self.command, r'powershell -Command "Remove-Item fixture.txt -Force"'):
            with self.subTest(command=command):
                self.assertFalse(approval.check_all_command_guards(command, "local")["approved"])
                approval.enable_session_yolo(self.session)
                self.prompt.reset_mock()
                self.assertTrue(approval.check_all_command_guards(command, "local")["approved"])
                self.prompt.assert_not_called()
                approval.disable_session_yolo(self.session)
        self.assertTrue(self.path.exists())

    def test_yolo_keeps_hardline_and_explicit_deny(self):
        token = approval.set_current_session_key(self.session)
        self.addCleanup(approval.reset_current_session_key, token)
        approval.enable_session_yolo(self.session)
        # 判定のみ。シェルには一切渡さない。
        self.assertFalse(approval.check_all_command_guards("rm -rf /", "local")["approved"])
        with patch.object(approval, "_get_approval_config", return_value={"deny": ["rm *"]}):
            self.assertFalse(approval.check_all_command_guards(self.command, "local")["approved"])
        self.assertTrue(self.path.exists())

    def test_yolo_keeps_protected_files_and_write_roots(self):
        from agent.file_safety import get_write_denied_error
        from tools.file_tools import _check_protected_instruction_write, _check_sensitive_path
        token = approval.set_current_session_key(self.session)
        self.addCleanup(approval.reset_current_session_key, token)
        approval.enable_session_yolo(self.session)
        self.assertIn("protected", get_write_denied_error(str(Path(_home.name) / ".ssh" / "id_rsa")))
        self.assertIsNotNone(_check_sensitive_path(str(Path(os.environ["HERMES_HOME"]) / "config.yaml")))
        self.assertIsNotNone(_check_protected_instruction_write([str(Path(self.directory.name) / "AGENTS.md")]))
        self.prompt.assert_called_once()
        with patch.dict(os.environ, {"HERMES_WRITE_SAFE_ROOT": self.directory.name}):
            self.assertIn("outside HERMES_WRITE_SAFE_ROOT", get_write_denied_error(str(Path(_home.name) / "outside.txt")))
        self.assertTrue(self.path.exists())

    def test_reused_codex_session_tracks_yolo_on_and_off(self):
        token = approval.set_current_session_key(self.session)
        self.addCleanup(approval.reset_current_session_key, token)
        decisions = []

        class FakeCodexSession(codex_transport.CodexAppServerSession):
            def run_turn(inner, *, user_input):
                decisions.append((
                    inner._decide_exec_approval({"command": self.command}),
                    inner._decide_apply_patch_approval({"reason": "Delete disposable fixture"}),
                ))
                return codex_transport.TurnResult(final_text="fixture result")

        agent = SimpleNamespace(session_cwd=self.directory.name, _skill_nudge_interval=0)
        with patch.object(codex_transport, "CodexAppServerSession", wraps=FakeCodexSession) as factory, \
                patch.object(codex_runtime, "_record_codex_app_server_compaction"), \
                patch.object(codex_runtime, "_record_codex_app_server_usage", return_value={}):
            for enabled in (False, True, False):
                if enabled:
                    approval.enable_session_yolo(self.session)
                else:
                    approval.disable_session_yolo(self.session)
                result = codex_runtime.run_codex_app_server_turn(
                    agent, user_message="fixture", original_user_message="fixture",
                    messages=[], effective_task_id="fixture",
                )
                self.assertTrue(result["completed"])
            factory.assert_called_once()
        self.assertEqual(decisions, [("decline", "decline"), ("accept", "accept"), ("decline", "decline")])
        self.assertTrue(self.path.exists())

    def test_codex_live_policy_is_checked_for_every_request(self):
        token = approval.set_current_session_key(self.session)
        self.addCleanup(approval.reset_current_session_key, token)
        session = codex_transport.CodexAppServerSession(
            cwd=self.directory.name, approval_callback=self.prompt,
            approval_bypass_callback=approval.is_approval_bypass_active,
        )
        for enabled in (False, True, False):
            if enabled:
                approval.enable_session_yolo(self.session)
            else:
                approval.disable_session_yolo(self.session)
            self.prompt.reset_mock()
            expected = "accept" if enabled else "decline"
            self.assertEqual(session._decide_exec_approval({"command": self.command}), expected)
            self.assertEqual(session._decide_apply_patch_approval({"reason": "fixture delete"}), expected)
            self.assertEqual(self.prompt.call_count, 0 if enabled else 2)
        self.assertEqual(session._permission_profile, "workspace-write")
        approval.enable_session_yolo(self.session)
        other = approval.set_current_session_key("other-session")
        try:
            self.assertEqual(session._decide_apply_patch_approval({}), "decline")
        finally:
            approval.reset_current_session_key(other)

    def test_codex_policy_failure_never_revives_static_yolo(self):
        session = codex_transport.CodexAppServerSession(
            cwd=self.directory.name,
            request_routing=codex_transport._ServerRequestRouting(True, True),
            approval_bypass_callback=Mock(side_effect=RuntimeError("fixture lookup failed")),
        )
        self.assertEqual(session._decide_exec_approval({}), "decline")
        self.assertEqual(session._decide_apply_patch_approval({}), "decline")

    def test_explicit_startup_yolo_reaches_guard_before_first_import(self):
        code = r'''
import json, sys
from types import SimpleNamespace
from unittest.mock import patch
import cli_main
sys.modules["tools_proc.process_lifetime"] = SimpleNamespace(guard_parent=lambda pid: None)
def fake_main(**kwargs):
    from tools import approval
    from tools.terminal_tool import set_approval_callback
    set_approval_callback(lambda *a, **kw: "deny")
    with patch.object(approval, "_get_approval_config", return_value={"mode": "manual"}), \
         patch.object(approval, "_fire_approval_hook"), \
         patch("tools.tirith_security.check_command_security", return_value={"action": "allow"}):
        # 判定のみ。ファイル操作・Codex・LLM 起動はしない。
        result = approval.check_all_command_guards("rm -rf fixture.txt", "local")
        print(json.dumps({"frozen": approval._YOLO_MODE_FROZEN, "approved": result["approved"]}))
cli_main.main = fake_main
cli_main.cli_entry(sys.argv[1:] + ["--ignore-user-config", "-Q", "-z", "fixture"])
'''
        for flags, expected in (([], False), (["--yolo"], True)):
            with self.subTest(flags=flags):
                result = subprocess.run(
                    [sys.executable, "-c", code, *flags], cwd=ROOT,
                    env=dict(os.environ, HERMES_YOLO_MODE="0"),
                    capture_output=True, text=True, timeout=30, check=True,
                )
                self.assertEqual(json.loads(result.stdout.strip()), {"frozen": expected, "approved": expected})


if __name__ == "__main__":
    unittest.main()
