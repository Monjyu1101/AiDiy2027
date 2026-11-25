# -*- coding: utf-8 -*-
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
"""Google ログイン済みの Antigravity CLI をテキスト会話専用で使用する。"""

import asyncio
import json
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory

from AIコア.agy_oauth import agy_oauthコマンド, agy_oauth環境
from AIコア.AI実行オプション import 会話継続適用, 既定実行オプション

_PROCESS_LIFETIME = Path(__file__).resolve().parents[2] / "backend_tools" / "tools_proc" / "process_lifetime.py"
_拒否操作 = ("read_file", "write_file", "command", "unsandboxed", "mcp", "read_url", "execute_url", "download_url")
_会話専用設定 = json.dumps({
    "agentMode": "plan",
    "toolPermission": "strict",
    "allowNonWorkspaceAccess": False,
    "permissions": {"allow": [], "ask": [], "deny": [f"{action}(*)" for action in _拒否操作]},
})
_履歴文字数 = 32000
_応答なし = "agy から有効な会話応答を受信できませんでした。"


def agy実行ファイル取得() -> str | None:
    path = agy_oauthコマンド()
    return os.path.abspath(path) if path and path != "agy" else None


def _応答抽出(stdout: bytes, stderr: bytes, returncode: int) -> str:
    results = []
    for line in stdout.splitlines():
        try:
            event = json.loads(line)
        except (ValueError, UnicodeError):
            continue
        if isinstance(event, dict) and event.get("event") == "result":
            results.append(event.get("result"))
    if returncode == 0 and len(results) == 1 and isinstance(results[0], dict):
        result = results[0]
        answer = result.get("response")
        if result.get("status") == "SUCCESS" and isinstance(answer, str) and answer.strip():
            return answer.strip()
    # CLI 診断はそのまま返さない。認証情報やローカル情報をチャットへ混ぜない。
    reason = (stderr[-16384:].decode("utf-8", errors="replace") + str(results)[-4000:]).casefold()
    if any(part in reason for part in ("authentication required", "unauthenticated", "not authenticated", "sign in", "log in", "login required")):
        raise RuntimeError("agy が未認証です。同じOSユーザーで agy を起動し、Google にログインしてください。")
    if any(part in reason for part in ("resource_exhausted", "rate limit", "quota exceeded")):
        raise RuntimeError("agy の利用枠またはレート制限に達しました。")
    if any(part in reason for part in ("unknown flag", "flag provided but not defined", "unknown option")):
        raise RuntimeError("この agy は会話に必要なオプションに対応していません。公式CLIの版を確認してください。")
    if returncode:
        raise RuntimeError(f"agy の会話実行に失敗しました（終了コード {returncode}）。")
    raise RuntimeError(_応答なし)


async def _停止(process, communication):
    if process.returncode is None:
        try:
            process.terminate()
        except ProcessLookupError:
            pass
    try:
        await asyncio.wait_for(asyncio.shield(communication), 5)
    except asyncio.TimeoutError:
        if process.returncode is None:
            try:
                process.kill()
            except ProcessLookupError:
                pass
        await asyncio.wait_for(communication, 3)


class ChatAI:
    """プロジェクトや別の agy セッションを引き継がず、AiDiy内だけで会話を保持する。"""

    def __init__(self, 親=None, セッションID="", チャンネル="0", 絶対パス=None,
                 AI_NAME="gemini_agy", AI_MODEL=None, api_key=None, system_instruction=None,
                 実行オプション=None):
        self.chat_model = str(AI_MODEL or "auto").strip() or "auto"
        self.system_instruction = system_instruction
        self.実行オプション = 実行オプション or 既定実行オプション
        self.is_alive = False
        self.last_error = ""
        self.last_output_files = []
        self.last_tool_calls = []
        self.last_completion_succeeded = False
        self._履歴 = []
        self._実行ロック = asyncio.Lock()
        self.agy_path = None

    async def 開始(self) -> bool:
        self.agy_path = agy実行ファイル取得()
        self.is_alive = bool(self.agy_path)
        self.last_error = "" if self.is_alive else "Antigravity CLI (agy) が見つかりません。"
        return self.is_alive

    async def 終了(self) -> None:
        self.is_alive = False
        self.履歴クリア()

    def 履歴クリア(self):
        self._履歴.clear()

    def _履歴追加(self, role: str, text: str):
        self._履歴.append({"role": role, "content": text[-_履歴文字数:]})
        while len(self._履歴) > 1 and (
                len(self._履歴) > 20 or sum(len(m["content"]) for m in self._履歴) > _履歴文字数):
            self._履歴.pop(0)

    async def 実行(self, 要求テキスト: str, テキスト受信処理Ｑ=None, タイムアウト秒数: int = 120,
                 システムプロンプト=None, file_path=None, completions_tools=None, 自己ループ=False, max_turns=8) -> str:
        async with self._実行ロック:
            self.last_completion_succeeded = False
            if not self.is_alive or not self.agy_path:
                raise RuntimeError(self.last_error or "gemini_agy が開始されていません。")
            if file_path or (completions_tools and completions_tools.get("tools")):
                raise ValueError("gemini_agy はテキスト専用です。画像添付・function calling には対応していません。")
            if not isinstance(要求テキスト, str) or not 要求テキスト.strip():
                raise ValueError("gemini_agy への入力が空です。")
            会話継続適用(self, completions_tools)
            # 履歴は構造付きデータとして渡す。--continue やモデルによるプロジェクトアクセスは使わない。
            instruction = システムプロンプト or self.system_instruction or "日本語で自然に会話してください。"
            content = (
                "以下のJSONは会話です。systemの指示に従い、historyを文脈として、userに対する返答の本文だけを書いてください。\n"
                + json.dumps({"system": instruction, "history": self._履歴, "user": 要求テキスト}, ensure_ascii=False)
            )
            request = (json.dumps({"event": "user", "message": {"content": content}}, ensure_ascii=False) + "\n").encode("utf-8")
            timeout = max(1, int(タイムアウト秒数))
            flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
            command = [
                sys.executable, str(_PROCESS_LIFETIME), "--parent-pid", str(os.getpid()),
                "--creationflags", str(flags), "--", self.agy_path, "--mode", "plan",
                "--settings", _会話専用設定, "--disable-slash-commands",
                "--input-format", "stream-json", "--output-format", "stream-json",
                "--print-timeout", f"{timeout}s",
            ]
            if self.chat_model != "auto":
                command.append(f"--model={self.chat_model}")
            with TemporaryDirectory(prefix="aidiy-agy-chat-") as cwd:
                spawn = asyncio.create_task(asyncio.create_subprocess_exec(
                    *command, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE, cwd=cwd, env=agy_oauth環境(),
                    start_new_session=os.name != "nt", creationflags=flags,
                ))
                try:
                    process = await asyncio.shield(spawn)
                except asyncio.CancelledError:
                    process = await spawn
                    await _停止(process, asyncio.create_task(process.communicate()))
                    raise
                communication = asyncio.create_task(process.communicate(request))
                try:
                    stdout, stderr = await asyncio.wait_for(asyncio.shield(communication), timeout + 5)
                except asyncio.TimeoutError:
                    await _停止(process, communication)
                    raise TimeoutError(f"agy の応答がタイムアウトしました（{timeout}秒）。") from None
                except asyncio.CancelledError:
                    await _停止(process, communication)
                    raise
                answer = _応答抽出(stdout, stderr, process.returncode)
            self._履歴追加("user", 要求テキスト)
            self._履歴追加("assistant", answer)
            self.last_completion_succeeded = True
            if テキスト受信処理Ｑ is not None and self.実行オプション.ストリーム送信:
                data = {"type": "stream", "content": answer}
                await テキスト受信処理Ｑ.put({"text": answer, "json": json.dumps(data, ensure_ascii=False)})
            return answer
