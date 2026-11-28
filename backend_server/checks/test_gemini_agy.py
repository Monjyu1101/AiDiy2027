# -*- coding: utf-8 -*-
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
"""実 agy や Google 認証を使わないプロセス・ルーティング検証。"""
import asyncio
import json
import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "backend_server"), str(ROOT / "backend_tools")]
from AIコア import AIチャット_gemini_agy as agy
from AIコア.agy_oauth import agy_oauthコマンド
from AIコア.AI実行オプション import AI実行オプション
from conf.conf_model import conf_models
from tools_proc.chat_llm import ChatLLM
from tools_proc.prediction_llm import PredictionLLM


_FAKE = r'''
import json, os, sys, time
from pathlib import Path
args = sys.argv[1:]
sys.stdin.reconfigure(encoding="utf-8")
def arg(name):
    return args[args.index(name) + 1]
assert not any(name in os.environ for name in ("GEMINI_API_KEY", "GOOGLE_API_KEY", "AGY_ADC_AUTH", "GOOGLE_APPLICATION_CREDENTIALS"))
assert "--disable-slash-commands" in args and arg("--mode") == "plan"
assert arg("--input-format") == arg("--output-format") == "stream-json"
assert {"read_file(*)", "write_file(*)", "command(*)", "mcp(*)"} <= set(json.loads(arg("--settings"))["permissions"]["deny"])
assert not list(Path.cwd().iterdir())
envelope = json.loads(sys.stdin.readline())
assert envelope["event"] == "user"
request = json.loads(envelope["message"]["content"].split("\n", 1)[1])
assert request["system"]
prompt = request["user"]
assert prompt not in args
assert sys.stdin.read() == ""
if prompt == "ログイン失敗":
    print("authentication required; not-for-display", file=sys.stderr)
    sys.exit(3)
if prompt == "応答不正":
    print("not JSON")
    sys.exit(0)
if prompt == "キャンセル":
    time.sleep(60)
print(json.dumps({"event":"init"}), flush=True)
print(json.dumps({"event":"step_update","text":"not the answer"}), flush=True)
answer = ("履歴あり" if request["history"] else "履歴なし") + ":" + prompt[:12]
print(json.dumps({"event":"result","result":{"status":"SUCCESS","response":answer}},ensure_ascii=True))
'''


class AGYPredictionConfigTests(unittest.TestCase):
    def test_auto_prefers_available_agy_then_freeai_then_gemini_and_explicit_stays(self):
        prediction = PredictionLLM()
        models = {"models": {"gemini-4-hydrogen": "Google", "configured-agy": "AGY"}}
        catalog = dict.fromkeys(("gemini_agy", "freeai_chat", "gemini_chat", "openai_chat"), models)
        with patch.object(prediction, "_catalog", return_value=catalog):
            with patch.object(prediction._chat, "_load_key_json", return_value={}):
                with patch("tools_proc.prediction_llm.agy_oauthコマンド", return_value="/fixture/agy"):
                    self.assertEqual(prediction._resolve("auto", "auto"), ("gemini_agy", "gemini-4-hydrogen"))
                with patch("tools_proc.prediction_llm.agy_oauthコマンド", return_value=None):
                    self.assertEqual(prediction._resolve("auto", "auto"), ("freeai_chat", "gemini-4-hydrogen"))
                    catalog.pop("freeai_chat")
                    self.assertEqual(prediction._resolve("auto", "auto"), ("gemini_chat", "gemini-4-hydrogen"))
                self.assertEqual(prediction._resolve("gemini_agy", "auto"), ("gemini_agy", "gemini-4-hydrogen"))
            with patch.object(prediction._chat, "_load_key_json", return_value={
                "PREDICTION_AI_NAME": "gemini_agy", "PREDICTION_GEMINI_AGY_MODEL": "configured-agy",
            }):
                self.assertEqual(prediction._resolve("auto", "auto"), ("gemini_agy", "configured-agy"))


class AGYProcessTests(unittest.IsolatedAsyncioTestCase):
    async def test_prediction_reuses_isolated_agy_text_path(self):
        prediction = PredictionLLM()
        answer = await prediction._run_chat("gemini_agy", "gemini-4-hydrogen", "昨日の作業を確認", 5)
        self.assertEqual(answer, "履歴なし:昨日の作業を確認")

    async def asyncSetUp(self):
        directory = TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        path = Path(directory.name) / ("agy.exe" if os.name == "nt" else "agy")
        path.write_text(f"#!{sys.executable}\n" + _FAKE, encoding="utf-8")
        if os.name == "nt":
            # 公式の実行ファイル探索・親の監視・標準入出力はそのまま使う。
            # Windowsはshebangを実行しないので、試験用ファイルだけをPythonで起動する。
            spawn = asyncio.create_subprocess_exec

            async def start_fixture(*argv, **options):
                child = argv.index("--") + 1
                self.assertEqual(Path(argv[child]), path)
                return await spawn(*argv[:child], sys.executable, *argv[child:], **options)

            self.enterContext(patch.object(asyncio, "create_subprocess_exec", start_fixture))
        else:
            path.chmod(0o700)
        self.enterContext(patch.dict(os.environ, {
            "PATH": f"{directory.name}{os.pathsep}{os.environ.get('PATH','')}",
            "GEMINI_API_KEY":"fake", "GOOGLE_API_KEY":"fake", "AGY_ADC_AUTH":"true",
            "GOOGLE_APPLICATION_CREDENTIALS":"fake",
        }))
        self.ai = agy.ChatAI(api_key="config-key-is-not-used")
        self.assertTrue(await self.ai.開始())

    async def test_japanese_long_prompt_history_and_reset(self):
        self.assertEqual(await self.ai.実行("おはよう" * 12000), "履歴なし:おはようおはようおはよう")
        self.assertEqual(await self.ai.実行("続けて"), "履歴あり:続けて")
        self.ai.履歴クリア()
        self.assertEqual(await self.ai.実行("おはよう"), "履歴なし:おはよう")
        self.assertEqual(os.environ["GEMINI_API_KEY"], "fake")

    async def test_failures_and_unsupported_requests(self):
        with self.assertRaisesRegex(RuntimeError, "未認証") as ctx:
            await self.ai.実行("ログイン失敗")
        self.assertNotIn("not-for-display", str(ctx.exception))
        with self.assertRaisesRegex(RuntimeError, "有効な会話応答"):
            await self.ai.実行("応答不正")
        for kwargs in ({"file_path":"image.png"}, {"completions_tools":{"tools":[{}]}}):
            with self.subTest(kwargs=kwargs), self.assertRaisesRegex(ValueError, "テキスト専用"):
                await self.ai.実行("ignored", **kwargs)
        self.assertEqual(await self.ai.実行("おはよう"), "履歴なし:おはよう")

    async def test_cancel_and_reuse(self):
        task = asyncio.create_task(self.ai.実行("キャンセル"))
        await asyncio.sleep(.3)
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await asyncio.wait_for(task, 8)
        self.assertEqual(await self.ai.実行("おはよう"), "履歴なし:おはよう")

    async def test_tools_entry_points(self):
        llm = ChatLLM(str(ROOT))
        with patch.object(llm, "_load_key_json", return_value={"CHAT_AI_NAME":"gemini_agy","CHAT_GEMINI_AGY_MODEL":"auto"}):
            first = await llm.run_async("最初", session_id="one", project_path=str(ROOT))
            second = await llm.run_async("次", session_id="one", project_path=str(ROOT))
            third = await llm.run_async("別セッション", session_id="two", project_path=str(ROOT))
            self.assertEqual([first["result"],second["result"],third["result"]],
                             ["履歴なし:最初","履歴あり:次","履歴なし:別セッション"])
            res = await llm.complete_async([{"role":"user","content":"前"}, {"role":"user","content":"今"}],
                                           model="gemini_agy/example-model", project_path=str(ROOT))
            self.assertEqual((res["status"], res["content"]), ("OK", "履歴あり:今"))
            no_tools = await llm.complete_async([{"role":"user","content":"今"}], model="gemini_agy", tools=[{}])
            self.assertEqual(no_tools["status"], "NG")

    async def test_core_channel_uses_agy_without_keys(self):
        from AIコア import AIチャット as chat_module
        from unittest.mock import AsyncMock
        connection = AsyncMock()
        with patch.object(chat_module, "_load_or_create_chat_context", return_value="会話を行う"):
            chat = chat_module.Chat(AI_NAME="gemini_agy", AI_MODEL="auto", 接続=connection)
        await chat._AI実行と応答送信({"メッセージ内容":"おはよう"})
        connection.send_to_channel.assert_awaited_once()
        channel, payload = connection.send_to_channel.await_args.args
        self.assertEqual(channel, "0")
        self.assertEqual((payload["メッセージ識別"], payload["メッセージ内容"]), ("output_text", "履歴なし:おはよう"))

    async def test_single_turn(self):
        ai = agy.ChatAI(実行オプション=AI実行オプション.単発())
        await ai.開始()
        self.assertEqual(await ai.実行("最初"), "履歴なし:最初")
        self.assertEqual(await ai.実行("次"), "履歴なし:次")


class AGYRoutingTests(unittest.TestCase):
    def test_configured_oauth_is_not_replaced_or_implicitly_selected(self):
        core = conf_models()
        with patch.object(core, "_get_diag_models", side_effect=lambda kind: {"freeai_chat":{"f":"F"}} if kind == "chat" else {}):
            actual = core.normalize_initial_settings({"CHAT_AI_NAME":"gemini_agy","CHAT_GEMINI_AGY_MODEL":"custom"})
            self.assertEqual((actual["CHAT_AI_NAME"], actual["CHAT_GEMINI_AGY_MODEL"]), ("gemini_agy","custom"))
        with patch.object(core, "_get_diag_models", side_effect=lambda kind: {"gemini_agy":{"auto":"Auto"}} if kind == "chat" else {}):
            self.assertEqual(core.normalize_initial_settings({"CHAT_AI_NAME":"freeai_chat"})["CHAT_AI_NAME"], "freeai_chat")

    def test_chat_picker_needs_executable_and_report_and_orders_only_gemini_family(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            config = root / "_config"
            config.mkdir()
            diag = root / "_AIDIY" / "aidiy_diag"
            diag.mkdir(parents=True)
            (diag / "chat_models_info.json").write_text(json.dumps({
                name:{"models":{"auto":name}} for name in (
                    "openai_chat", "freeai_chat", "local_chat", "gemini_chat", "gemini_agy")
            }), encoding="utf-8")
            listing = diag / "gemini_agy_models_info.json"
            absent = ["openai_chat", "gemini_chat", "freeai_chat", "local_chat"]
            core = conf_models()
            with patch.object(core, "_config_dir_path", return_value=str(config)), patch(
                "AIコア.agy_oauth.agy_oauthコマンド", return_value="fixture-agy"
            ) as resolve:
                self.assertEqual(list(core.get_chat_models()), absent)
                listing.write_text(json.dumps({"プロバイダ":"gemini_agy","状態":"未取得","models":{}}), encoding="utf-8")
                self.assertEqual(list(core.get_chat_models()), ["openai_chat","gemini_agy","gemini_chat","freeai_chat","local_chat"])
                resolve.return_value = None
                self.assertEqual(list(core.get_chat_models()), absent)

    def test_windows_vscode_install_path_without_path_registration(self):
        with TemporaryDirectory() as directory:
            candidate = Path(directory) / ".gemini" / "bin" / "agy.exe"
            candidate.parent.mkdir(parents=True)
            candidate.touch()
            self.assertEqual(agy_oauthコマンド({"USERPROFILE": directory, "PATH": ""}, platform="nt"), str(candidate))

    def test_tools_auto_does_not_change_explicit_google_login(self):
        llm = ChatLLM(str(ROOT))
        llm.version_info = {"gemini_agy":{"ok":False},"gemini_chat":{"ok":True}}
        with patch.object(llm, "_load_key_json", return_value={"CHAT_AI_NAME":"gemini_agy"}):
            self.assertEqual(llm._resolve_ai_params("auto", "auto"), ("gemini_agy","auto"))
