# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
"""OAuth AGY は既存 Antigravity と別のモデル・認証・継続経路を持つ。"""
import contextlib
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

from test_code_aidiy_codex import CORE, MODULES, cli, load_module, options

FIRST = "ec59ab1b-a729-4e86-b240-210cb7a8d646"
NEXT = "e7292028-39de-403c-a92a-438abad22e65"
FAKE = r'''
import json
import os
import sys
from pathlib import Path
args = sys.argv[1:]
if "--version" in args:
    print("agy fixture")
    raise SystemExit(0)
# AGY の標準入力は UTF-8。模擬 CLI も Windows の既定コードページに依存させない。
sys.stdin.reconfigure(encoding="utf-8")
event = json.loads(sys.stdin.readline())
assert not sys.stdin.read()
if event["message"]["content"].find("接続失敗") >= 0:
    print("fake-credential-do-not-surface", file=sys.stderr)
    raise SystemExit(1)
case = "other" if "別会話" in event["message"]["content"] else "normal"
resume = args[args.index("--conversation") + 1] if "--conversation" in args else None
session = SECOND if case == "other" else (resume or FIRST)
with Path("child-input.jsonl").open("a", encoding="utf-8") as output:
    print(json.dumps([args, event, [key for key in os.environ if key.upper() in BAD], os.environ.get("AGY_TEST_KEEP")]), file=output)
print(json.dumps({"event": "init", "conversation_id": session}))
print(json.dumps({"event": "step_update", "step_update": {"text_delta": "not-final"}}))
print(json.dumps({"event": "result", "result": {"status":"SUCCESS", "response":"模擬応答", "conversation_id":session}}))
'''
BAD = {"GEMINI_API_KEY", "GOOGLE_API_KEY", "AGY_ADC_AUTH", "GOOGLE_APPLICATION_CREDENTIALS", "GOOGLE_GEMINI_BASE_URL"}


class AgyCliTest(unittest.IsolatedAsyncioTestCase):
    def test_finds_vscode_binary_without_altering_legacy_executable_resolution(self):
        with tempfile.TemporaryDirectory() as d:
            binary = Path(d) / ".gemini" / "bin" / "agy.exe"
            binary.parent.mkdir(parents=True)
            binary.touch()
            self.assertEqual(cli.agy_oauthコマンド({"USERPROFILE": d, "PATH": ""}, platform="nt"), str(binary))
            system = Path(d) / "standard" / "agy" / "bin" / "agy.exe"
            system.parent.mkdir(parents=True)
            system.touch()
            pathbin = Path(d) / "envpath" / "agy.exe"
            pathbin.parent.mkdir()
            pathbin.touch()
            env = {"USERPROFILE": d, "LOCALAPPDATA": str(Path(d) / "standard"), "PATH": str(pathbin.parent)}
            self.assertEqual(cli.agy_oauthコマンド(env, platform="nt"), str(pathbin))
            pathbin.unlink()
            self.assertEqual(cli.agy_oauthコマンド(env, platform="nt"), str(system))
            self.assertIsNone(cli.agy_oauthコマンド({"PATH": ""}, platform="nt"))

    def test_agy_and_antigravity_use_the_same_approval_modes(self):
        for provider in ("agy_cli", "antigravity_cli"):
            for permissions, skip in (("auto", True), ("none", False), ("full", True)):
                with self.subTest(provider=provider, permissions=permissions):
                    cli_agent = cli.CodeAI(AI_NAME=provider, code_permissions=permissions)
                    with patch.object(cli_agent, "_コマンドパス取得", return_value="/fixture/agy"):
                        command = cli_agent._コマンド構築("fixed", 初回=True)
                    self.assertEqual("--dangerously-skip-permissions" in command, skip)

    async def test_readonly_subprocess_uses_plan_deny_rules_and_oauth_stdin(self):
        with tempfile.TemporaryDirectory() as d:
            project = Path(d)
            fake = project / "fake_agy.py"
            fake.write_text(f"FIRST={FIRST!r}\nSECOND={NEXT!r}\nBAD={BAD!r}\n" + FAKE, encoding="utf-8")
            oauth = cli.CodeAI(AI_NAME="agy_cli", AI_MODEL="gemini-fixture-low", code_permissions="full",
                               絶対パス=d, 実行オプション=options.AI実行オプション.読取専用予測())
            fake_argv = lambda *_args, **_kwargs: ([sys.executable, str(fake)], False)
            policy = load_module("agy_cli_policy_under_test", CORE / "AIコードCLI権限.py")
            with (
                patch.dict(sys.modules, {**MODULES, "AIコア.AIコードCLI権限": policy}),
                patch.object(oauth, "_CLI起動コマンド先頭", side_effect=fake_argv),
                patch.object(oauth, "_コマンドパス取得", return_value=sys.executable),
                patch.dict(os.environ, {"GOOGLE_API_KEY": "fixture"}),
                contextlib.redirect_stdout(io.StringIO()),
            ):
                self.assertEqual(await oauth.実行("長い入力" * 7000), "模擬応答")
                failure = await oauth.実行("接続失敗")
                self.assertIn("Google OAuth", failure)
            [line] = (project / "child-input.jsonl").read_text().splitlines()
            args, event, credentials, _ = json.loads(line)
            self.assertEqual(args[args.index("--mode") + 1], "plan")
            self.assertEqual(args[args.index("--model") + 1], "gemini-fixture-low")
            self.assertIn("--disable-slash-commands", args)
            for flag in ("--dangerously-skip-permissions", "--continue", "--conversation", "-p"):
                self.assertNotIn(flag, args)
            settings = json.loads(args[args.index("--settings") + 1])
            self.assertFalse(settings["allowNonWorkspaceAccess"])
            self.assertEqual(settings["permissions"]["allow"], ["read_file(*)"])
            self.assertTrue({"write_file(*)", "command(*)", "unsandboxed(*)", "mcp(*)", "read_url(*)", "execute_url(*)", "download_url(*)"} <= set(settings["permissions"]["deny"]))
            self.assertEqual(credentials, [])
            self.assertIn("長い入力" * 7000, event["message"]["content"])

    async def test_real_subprocess_boundary_stdin_fresh_explicit_resume_error_and_isolation(self):
        with tempfile.TemporaryDirectory() as d:
            project = Path(d)
            fake = project / "fake_agy.py"
            fake.write_text(f"FIRST={FIRST!r}\nSECOND={NEXT!r}\nBAD={BAD!r}\n" + FAKE, encoding="utf-8")
            oauth = cli.CodeAI(AI_NAME="agy_cli", AI_MODEL="gemini-fixture-low", code_permissions="none", 絶対パス=d)
            legacy = cli.CodeAI(AI_NAME="antigravity_cli", AI_MODEL="old-fixture", code_permissions="none", 絶対パス=d)
            fake_argv = lambda *_args, **_kwargs: ([sys.executable, str(fake)], False)
            env = {key.lower() if key == "GOOGLE_API_KEY" else key:"not-a-real-credential" for key in BAD}
            env["AGY_TEST_KEEP"] = "kept"
            with patch.object(oauth, "_CLI起動コマンド先頭", side_effect=fake_argv), patch.object(oauth, "_コマンドパス取得", return_value=sys.executable), patch.dict(os.environ, env), contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(await oauth.実行("初回 日本語\n二行目"), "模擬応答")
                self.assertEqual(await oauth.実行("継続"), "模擬応答")
                bad = await oauth.実行("別会話")
                self.assertIn("会話を継続できません", bad)
                auth = await oauth.実行("接続失敗")
                self.assertIn("Google OAuth", auth)
                self.assertNotIn("fake-credential", auth)
                self.assertEqual(await oauth.実行("新規", resume=False), "模擬応答")
                self.assertEqual(os.environ["GEMINI_API_KEY"], env["GEMINI_API_KEY"])
            commands = [json.loads(line) for line in (project / "child-input.jsonl").read_text().splitlines()]
            self.assertEqual(len(commands), 4)
            for args, event, credentials, keep in commands:
                self.assertEqual(args[:4], ["--input-format", "stream-json", "--output-format", "stream-json"])
                self.assertNotIn("--dangerously-skip-permissions", args)
                self.assertNotIn("-c", args)
                self.assertNotIn("-p", args)
                self.assertEqual(args[args.index("--model") + 1], "gemini-fixture-low")
                self.assertEqual(event["event"], "user")
                self.assertEqual(credentials, [])
                self.assertEqual(keep, "kept")
            self.assertIn("初回 日本語\n二行目", commands[0][1]["message"]["content"])
            self.assertNotIn("--conversation", commands[0][0])
            self.assertEqual(commands[1][0][-2:], ["--conversation", FIRST])
            self.assertEqual(commands[2][0][-2:], ["--conversation", FIRST])
            self.assertNotIn("--conversation", commands[3][0])
            legacy_command = legacy._コマンド構築("legacy prompt", 初回=False, repo_path=d)
            self.assertEqual(legacy_command[-3:], ["-p", "legacy prompt", "-c"])
            self.assertEqual(legacy_command[legacy_command.index("--model") + 1], "old-fixture")


if __name__ == "__main__":
    unittest.main()
