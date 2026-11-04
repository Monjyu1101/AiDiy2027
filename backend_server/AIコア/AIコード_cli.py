#!/usr/bin/env python
# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

from AIコア.AI応答 import 応答正規化, エラー応答
from AIコア.AI実行オプション import 既定実行オプション, 読取専用CLI対応方式
from log_config import get_logger
logger = get_logger(__name__)

import os
import re
import time
import datetime
import asyncio
import base64
import subprocess
import sys
from pathlib import Path
from typing import Optional
from PIL import Image
import io
import json


# これらの CLI は stdout の生出力を進捗ストリームへ送らない。
# Copilot は stdout の JSONL を解析し、他の CLI は stderr を進捗として扱う。
# stdout を output_stream にも流すと、正式回答が途中表示と最終表示で重複する。
_STDERR_STREAM_STDOUT_FINAL_AI = frozenset({
    "copilot_cli",
    "opencode_cli",
    "antigravity_cli",
})


class 予測読取専用利用不可(ValueError):
    """安全な予測CLIを構築できない場合。通常のCode実行には適用しない。"""


# 設定は preflight と exec で同一にする。MCP の空マップは継承設定を消せない。
# https://developers.openai.com/codex/config-reference/
_予測CODEX無効機能 = (
    "hooks", "apps", "multi_agent", "shell_snapshot", "plugins",
    "browser_use", "computer_use", "image_generation",
    "skill_mcp_dependency_install", "memories", "goals",
)


class _CopilotJSON出力:
    """Copilot の JSONL から表示用の進捗と親エージェントの最終回答を取り出す。"""

    def __init__(self):
        self.メッセージ = {}
        self.待機断片 = {}
        self.思考受信済み = set()
        self.ツール名 = {}
        self.エラー = ""

    def _断片出力(self, key, text="", 完了=False):
        # 画面は行単位なので、トークンごとの改行を避けつつ長い思考も途中表示する。
        pending = self.待機断片.pop(key, "") + text
        lines = []
        while pending:
            newline = pending.find("\n")
            if 0 <= newline < 160:
                line, pending = pending[:newline], pending[newline + 1:]
            elif len(pending) >= 160:
                line, pending = pending[:160], pending[160:]
            elif 完了:
                line, pending = pending, ""
            else:
                break
            if line.strip():
                lines.append(f"[Copilot {key[0]}] {line.rstrip()}")
        if pending:
            self.待機断片[key] = pending
        return lines

    def 残りの進捗(self):
        lines = []
        for key in list(self.待機断片):
            lines.extend(self._断片出力(key, 完了=True))
        return lines

    @property
    def 回答(self):
        if self.エラー:
            return f"! Copilot実行エラー: {self.エラー}"
        for message in reversed(list(self.メッセージ.values())):
            if message.get("toolRequests") or message.get("phase") in ("thinking", "analysis", "commentary"):
                continue
            content = message.get("content", "".join(message["断片"]))
            if isinstance(content, str) and content.strip():
                return content.strip()
        return ""

    def 解析(self, line):
        if not line.strip():
            return []
        try:
            event = json.loads(line)
        except json.JSONDecodeError as e:
            logger.warning("Copilot JSONL解析失敗: %s", e)
            return ["[Copilot] JSON出力を解析できませんでした。"]
        if not isinstance(event, dict):
            return []
        kind = event.get("type")
        data = event.get("data", {})
        if not isinstance(data, dict):
            return []

        if kind in ("assistant.reasoning_delta", "assistant.reasoning"):
            key = ("thinking", event.get("agentId"), data.get("reasoningId", ""))
            if kind == "assistant.reasoning_delta":
                self.思考受信済み.add(key)
                text = data.get("deltaContent", "")
                return self._断片出力(key, text if isinstance(text, str) else "")
            # 完成版は差分をすでに表示していれば末尾だけを送る。
            text = data.get("content", "") if key not in self.思考受信済み else ""
            self.思考受信済み.add(key)
            return self._断片出力(key, text if isinstance(text, str) else "", 完了=True)

        if kind in ("assistant.message_start", "assistant.message_delta", "assistant.message"):
            # 子エージェントの回答を親の正式回答へ混ぜない。
            if event.get("agentId") or data.get("parentToolCallId"):
                return []
            message = self.メッセージ.setdefault(data.get("messageId", ""), {"断片": []})
            if isinstance(data.get("phase"), str):
                message["phase"] = data["phase"]
            if kind == "assistant.message_start":
                return ["[Copilot] 回答を生成中…"]
            if kind == "assistant.message_delta":
                if isinstance(data.get("deltaContent"), str):
                    message["断片"].append(data["deltaContent"])
                return []
            message["toolRequests"] = data.get("toolRequests", [])
            if isinstance(data.get("content"), str):
                message["content"] = data["content"]
            content = message.get("content", "")
            if content and (message["toolRequests"] or message.get("phase") in ("thinking", "analysis", "commentary")):
                return [f"[Copilot] {content}"]
            return []

        tool_id = data.get("toolCallId", "")
        if kind == "tool.execution_start":
            name = data.get("toolName") or "tool"
            self.ツール名[tool_id] = name
            arguments = data.get("arguments", {})
            detail = ""
            if isinstance(arguments, dict):
                for field in ("path", "file_path", "command", "pattern", "query"):
                    if isinstance(arguments.get(field), str):
                        detail = " " + " ".join(arguments[field].split())[:160]
                        break
            return [f"[Copilot tool] {name} 開始{detail}"]
        if kind == "tool.execution_progress":
            text = data.get("progressMessage")
            return [f"[Copilot tool] {text}"] if isinstance(text, str) and text else []
        if kind == "tool.shell_output":
            text = data.get("text", "")
            return self._断片出力(("tool", tool_id, data.get("stream", "stdout")), text if isinstance(text, str) else "")
        if kind == "tool.execution_complete":
            lines = []
            for key in list(self.待機断片):
                if key[0] == "tool" and key[1] == tool_id:
                    lines.extend(self._断片出力(key, 完了=True))
            name = self.ツール名.pop(tool_id, "tool")
            status = "失敗" if data.get("success") is False else "完了"
            error = data.get("error", {})
            detail = f": {error['message']}" if isinstance(error, dict) and isinstance(error.get("message"), str) else ""
            lines.append(f"[Copilot tool] {name} {status}{detail}")
            return lines
        if kind == "assistant.intent" and isinstance(data.get("intent"), str):
            return [f"[Copilot] {data['intent']}"]
        if kind == "session.error" and isinstance(data.get("message"), str):
            self.エラー = data["message"]
            return [f"[Copilot error] {self.エラー}"]
        # ユーザー入力、利用量、暗号化された思考、未知のイベントは表示しない。
        return []


_PROCESS_LIFETIME = Path(__file__).resolve().parents[2] / "backend_tools" / "tools_proc" / "process_lifetime.py"


async def _所有プロセス終了(process):
    """監視ラッパーを終了する。ラッパーが当該 CLI の子孫だけを破棄する。"""
    if process.returncode is not None:
        return
    try:
        process.terminate()
    except ProcessLookupError:
        return
    try:
        await asyncio.wait_for(asyncio.shield(process.wait()), timeout=5)
    except asyncio.TimeoutError:
        try:
            process.kill()
        except ProcessLookupError:
            pass
        await asyncio.wait_for(process.wait(), timeout=3)


async def _出力行を順に取得(stream: asyncio.StreamReader, 出力検知=None):
    """stdout/stderr の受信ごとに通知し、出力内容は行単位で返す。"""
    pending: list[bytes] = []
    while chunk := await stream.read(64 * 1024):
        if 出力検知:
            出力検知()
        parts = chunk.split(b"\n")
        if len(parts) == 1:
            pending.append(chunk)
            continue
        pending.append(parts[0])
        yield b"".join(pending) + b"\n"
        for part in parts[1:-1]:
            yield part + b"\n"
        pending = [parts[-1]] if parts[-1] else []
    if pending:
        yield b"".join(pending)


class CodeAI:
    """
    CLI (subprocess) ベース CodeAI統合クラス
    claude code などのコマンドラインツールをsubprocessで実行
    """
    _バージョンキャッシュ: dict[str, str] = {}
    _バージョン確認ロック: Optional[asyncio.Lock] = None

    def __init__(self, 親=None, セッションID: str = "", チャンネル: int = 0, 絶対パス: str = None,
                 AI_NAME: str = "claude_cli", AI_MODEL: str = "auto", max_turns: int = 999,
                 code_plan: str = "auto", code_verify: str = "auto", code_permissions: str = "auto",
                 system_instruction: str = None, 実行オプション=None):
        """初期化"""

        # 実行オプション（会話継続・履歴保存・ストリーム送信・出力ファイル保存）
        self.実行オプション = 実行オプション or 既定実行オプション

        # セッションID・チャンネル
        self.セッションID = セッションID
        self.チャンネル = チャンネル

        # 親参照（セッションマネージャー）
        self.parent_manager = 親
        self.親 = 親

        # プロバイダー設定
        self.code_ai = AI_NAME
        self.code_model = AI_MODEL
        self.最終実行モデル = ""
        self.予測読取専用利用不可 = False
        self._予測CodexMCP設定 = None
        self._予測Codex検証パス = None
        self.max_turns = max_turns
        self.code_plan = code_plan
        self.code_verify = code_verify
        self.code_permissions = code_permissions if code_permissions in ("auto", "full", "none") else "auto"
        self.system_instruction = system_instruction if isinstance(system_instruction, str) and system_instruction else None

        # 作業ディレクトリ設定
        work_dir_input = 絶対パス if isinstance(絶対パス, str) else None
        if work_dir_input and isinstance(work_dir_input, str):
            work_dir = Path(work_dir_input)
        else:
            work_dir = Path.cwd()

        self.cwd_str = work_dir.resolve().as_posix()  # "/" 区切りに統一
        self.base_abs_path = self.cwd_str

        # システムプロンプトを構築
        self.system_prompt = self._システムプロンプト構築()

        # 履歴管理システム(ローカル保管)
        self.履歴最終番号 = 0
        self.履歴最終時刻 = time.time()
        self.履歴辞書 = {}

        # 生存状態管理
        self.is_alive = True
        self._停止マーカー送信済み = False

        # セッション状態管理（初回判定用）
        self.session_started = False

        # codex専用：セッションID管理
        self.codex_セッションID = None

        # 最終実行のstderr出力（セッションID抽出用）
        self.last_stderr_output = ""

        # 現在実行中のsubprocess（強制終了用）
        self.current_process: Optional[asyncio.subprocess.Process] = None

        # バージョン文字列（開始()時に取得）
        self.バージョン: str = ""

    def _CLI送信用テキスト正規化(self, text: Optional[str]) -> str:
        """CLIへ渡す文字列は改行・連続空白を空白1つへ変換して1行化する"""
        if text is None:
            return ""
        if not isinstance(text, str):
            raise TypeError(f"CLI送信用テキストは文字列である必要があります: {type(text).__name__}")
        return " ".join(text.split())

    def _hermes直接実行コマンド(self) -> Optional[list]:
        """Windows で aidiy_hermes.cmd 経由を避けるため、Python と cli_main.py を直接呼ぶコマンドを返す。
        cmd.exe の 8191 文字制限を回避するために必要。見つからなければ None。"""
        if os.name != 'nt':
            return None
        プロジェクトルート = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        venv_py = os.path.join(プロジェクトルート, 'command_hermes', '.venv', 'Scripts', 'python.exe')
        cli_main = os.path.join(プロジェクトルート, 'command_hermes', 'cli_main.py')
        if os.path.isfile(venv_py) and os.path.isfile(cli_main):
            return [venv_py, cli_main]
        return None

    def _npmシム直接実行に解決(self, cmd_path: str) -> Optional[list]:
        """npm が生成する .cmd シム（claude/copilot/gemini/codex）を解析し、
        cmd.exe を経由しない実行コマンド list を返す。失敗時は None。

        cmd.exe 経由だとコマンドラインが 8191 文字に制限されるが、
        node.exe / .exe を直接 CreateProcess すれば ~32767 文字まで使える。

        対応パターン:
          - `"<...>\\xxx.exe"  %*`              → [xxx.exe]
          - `"%_prog%"  "<...>\\xxx.js" %*`     → [node.exe, xxx.js]
        """
        if os.name != 'nt' or not cmd_path or not cmd_path.lower().endswith('.cmd'):
            return None
        try:
            with open(cmd_path, 'r', encoding='utf-8', errors='replace') as f:
                内容 = f.read()
        except Exception:
            return None

        import re
        dp0 = os.path.dirname(os.path.abspath(cmd_path))

        def 展開(p: str) -> str:
            return os.path.normpath(p.replace('%dp0%', dp0).replace('%~dp0', dp0))

        # パターン2: node 経由 (copilot/gemini/codex/opencode)
        # npm 慣習で末尾が .js のことも、shebang 付き拡張子なしファイルのこともある
        m = re.search(r'"%_prog%"\s+"([^"]+)"\s+%\*', 内容, re.IGNORECASE)
        if m:
            js_path = 展開(m.group(1))
            if os.path.isfile(js_path):
                node_exe = os.path.join(dp0, 'node.exe')
                if not os.path.isfile(node_exe):
                    node_exe = 'node'
                return [node_exe, js_path]

        # パターン1: .exe 直接呼び出し (claude)
        m = re.search(r'"([^"]+\.exe)"\s+%\*', 内容, re.IGNORECASE)
        if m:
            exe_path = 展開(m.group(1))
            if os.path.isfile(exe_path):
                return [exe_path]

        return None

    def _CLI起動コマンド先頭(self, cmd_str: str, custom: bool) -> tuple:
        """CLI の起動コマンド先頭部分を返す。
        Returns: (base_list, cmd.exe 経由フラグ)
        custom=True（環境変数指定）の場合はユーザー指定を尊重して解決しない。"""
        if custom:
            return [cmd_str], cmd_str.lower().endswith('.cmd') if cmd_str else False
        direct = self._npmシム直接実行に解決(cmd_str)
        if direct is not None:
            return direct, False
        return [cmd_str], (cmd_str or '').lower().endswith('.cmd')

    def _コマンドパス取得(self) -> str:
        """code_ai に対応するCLIコマンドパスを返す"""
        custom_cmd = os.environ.get(f'{self.code_ai.upper()}_CLI_PATH')
        if custom_cmd:
            return custom_cmd
        if self.code_ai == "aidiy_hermes":
            if os.name == 'nt':
                userprofile = os.environ.get('USERPROFILE', os.path.expanduser('~'))
                candidates = [
                    os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'aidiy_hermes.cmd'),
                    os.path.join(userprofile, '.local', 'bin', 'aidiy_hermes.cmd'),
                ]
                for candidate in candidates:
                    if os.path.isfile(candidate):
                        return candidate
            return "aidiy_hermes"
        if self.code_ai == "opencode_cli":
            if os.name == 'nt':
                userprofile = os.environ.get('USERPROFILE', os.path.expanduser('~'))
                candidate = os.path.join(userprofile, '.local', 'bin', 'opencode.exe')
                if os.path.isfile(candidate):
                    return candidate
                npm_bin = os.path.join(userprofile, 'AppData', 'Roaming', 'npm')
                candidate2 = os.path.join(npm_bin, 'opencode.cmd')
                if os.path.isfile(candidate2):
                    return candidate2
            return "opencode"
        if self.code_ai == "antigravity_cli":
            if os.name == 'nt':
                userprofile = os.environ.get('USERPROFILE', os.path.expanduser('~'))
                candidate = os.path.join(userprofile, 'AppData', 'Local', 'agy', 'bin', 'agy.exe')
                if os.path.isfile(candidate):
                    return candidate
            return "agy"
        if self.code_ai == "grok_cli":
            # 公式 Grok Build CLI（xai-org/grok-build）。npm ではなく ~/.grok/bin へ入る
            userprofile = os.environ.get('USERPROFILE', os.path.expanduser('~'))
            exe = 'grok.exe' if os.name == 'nt' else 'grok'
            candidate = os.path.join(userprofile, '.grok', 'bin', exe)
            if os.path.isfile(candidate):
                return candidate
            return "grok"
        if self.code_ai in ("claude_ollama", "codex_ollama"):
            return "ollama"
        if os.name == 'nt':
            userprofile = os.environ.get('USERPROFILE', os.path.expanduser('~'))
            npm_bin = os.path.join(userprofile, 'AppData', 'Roaming', 'npm')
            names = {
                "copilot_cli": "copilot.cmd",
                "codex_cli": "codex.cmd",
            }
            return os.path.join(npm_bin, names.get(self.code_ai, "claude.cmd"))
        names = {
            "copilot_cli": "copilot",
            "codex_cli": "codex",
        }
        return names.get(self.code_ai, "claude")

    @staticmethod
    def _ollama_cloud_suffix除去(model: str) -> str:
        """aidiy_hermes/opencode_cli 用: ollama cloud suffix（-cloud/:cloud/:clude）を除去する"""
        if not isinstance(model, str):
            return model
        for suffix in ("-cloud", ":cloud"):
            if model.lower().endswith(suffix):
                return model[: -len(suffix)]
        return model

    @staticmethod
    def _opencode最終選択モデル() -> str:
        """opencode が最後に選んだモデル（TUI の選択、state の model.json の recent 先頭）を provider/model で返す。

        `opencode run` は --model を省くと TUI の選択を使わず別の既定モデルになるため、
        auto / same（AiDiy 側で指定しない）では opencode 自身の選択を明示して渡す。記録が無ければ空文字。
        """
        state_home = os.environ.get("XDG_STATE_HOME") or os.path.join(os.path.expanduser("~"), ".local", "state")
        try:
            with open(os.path.join(state_home, "opencode", "model.json"), encoding="utf-8") as f:
                recent = json.load(f).get("recent") or []
            provider = str(recent[0].get("providerID", "")).strip()
            model = str(recent[0].get("modelID", "")).strip()
        except Exception:
            return ""
        if not provider or not model or any(c.isspace() for c in provider + model):
            return ""
        return f"{provider}/{model}"

    def _ollama起動モデル取得(self, provider_key: str) -> str:
        """claude_ollama/codex_ollama 用のモデルを解決する"""
        if self.code_model and self.code_model.lower() == "same":
            return ""
        model = self.code_model if self.code_model and self.code_model.lower() not in ("auto", "same") else ""
        if not model and self.parent_manager:
            _ms = (getattr(self.parent_manager, 'モデル設定', None)
                   or getattr(getattr(self.parent_manager, '接続', None), 'モデル設定', None)
                   or {})
            model = _ms.get(provider_key, "")
            if not model or model.lower() in ("auto", "same"):
                model = _ms.get("CHAT_OLLAMA_MODEL", "")
        if model and model.lower() in ("auto", "same"):
            return ""
        return model

    async def バージョン確認(self) -> str:
        """CLIツールの --version を実行してバージョン文字列を返す。失敗時は空文字。"""
        if self.code_ai in ("claude_ollama", "codex_ollama"):
            app = "claude" if self.code_ai == "claude_ollama" else "codex"
            provider_key = "CODE_CLAUDE_OLLAMA_MODEL" if self.code_ai == "claude_ollama" else "CODE_CODEX_OLLAMA_MODEL"
            model = self._ollama起動モデル取得(provider_key)
            version_args = ["ollama", "launch", app]
            if model:
                version_args.extend(["--model", model])
            version_args.extend(["--", "--version"])
            cache_key = f"{self.code_ai}:{model}"
            if cache_key in self._バージョンキャッシュ:
                return self._バージョンキャッシュ[cache_key]
            if CodeAI._バージョン確認ロック is None:
                CodeAI._バージョン確認ロック = asyncio.Lock()
            async with CodeAI._バージョン確認ロック:
                if cache_key in self._バージョンキャッシュ:
                    return self._バージョンキャッシュ[cache_key]
                バージョン = await self._バージョン確認実行(version_args)
                if バージョン:
                    self._バージョンキャッシュ[cache_key] = バージョン
                return バージョン

        cmd = self._コマンドパス取得()
        cache_key = f"{self.code_ai}:{cmd}"
        if cache_key in self._バージョンキャッシュ:
            return self._バージョンキャッシュ[cache_key]
        if CodeAI._バージョン確認ロック is None:
            CodeAI._バージョン確認ロック = asyncio.Lock()
        async with CodeAI._バージョン確認ロック:
            if cache_key in self._バージョンキャッシュ:
                return self._バージョンキャッシュ[cache_key]
            バージョン = await self._バージョン確認実行(cmd)
            if バージョン:
                self._バージョンキャッシュ[cache_key] = バージョン
            return バージョン

    async def _バージョン確認実行(self, cmd) -> str:
        """CLIツールの --version を実行する。cmd は str またはリスト。"""
        try:
            if isinstance(cmd, list):
                version_args = cmd
                cmd_label = " ".join(cmd[:3])
                timeout_sec = 60.0
            else:
                version_args = [cmd, "--version"]
                cmd_label = cmd
                timeout_sec = 30.0 if self.code_ai == "aidiy_hermes" else 10.0
            proc = await asyncio.create_subprocess_exec(
                *version_args,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            try:
                stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout_sec)
            except asyncio.TimeoutError:
                proc.kill()
                await proc.communicate()
                logger.warning(f"[CodeAI] --version タイムアウト: {cmd_label}")
                return ""
            output = (stdout or b"").decode("utf-8", errors="replace").strip()
            if not output:
                output = (stderr or b"").decode("utf-8", errors="replace").strip()
            first_line = output.splitlines()[0].strip() if output else ""
            if first_line.startswith("Error:"):
                logger.warning(f"[CodeAI] --version エラー応答: {first_line}")
                return ""
            logger.info(f"[CodeAI] {cmd_label} --version => {first_line}")
            return first_line
        except FileNotFoundError:
            logger.warning(f"[CodeAI] コマンドが見つかりません: {cmd_label if isinstance(cmd, list) else cmd}")
            return ""
        except subprocess.TimeoutExpired:
            logger.warning(f"[CodeAI] --version タイムアウト: {cmd_label if isinstance(cmd, list) else cmd}")
            return ""
        except Exception as e:
            logger.warning(f"[CodeAI] --version 実行エラー: {cmd} {e}")
            return ""

    def _予測CLI確認(self) -> None:
        if self.code_ai not in 読取専用CLI対応方式:
            raise 予測読取専用利用不可(
                f"{self.code_ai} は予測用の読取専用実行に未対応です。"
                "対応する読取専用CLIを選択してください。"
            )

    def _予測Hermesコマンド(self, repo_path: str) -> list:
        # 通常HermesやカスタムCLIへはフォールバックせず、固定の読取専用アダプターだけを使う。
        hermes_dir = Path(__file__).resolve().parents[2] / "command_hermes"
        python_path = hermes_dir / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
        entrypoint = hermes_dir / "prediction_main.py"
        if not python_path.is_file() or not entrypoint.is_file():
            raise 予測読取専用利用不可("Hermes の予測用アダプターまたは実行環境を利用できません。")
        model = self._ollama_cloud_suffix除去(self.code_model or "")
        provider = model.partition("/")[0].lower()
        if provider in {
            "copilot_cli", "copilot-cli", "claude_cli", "claude-code", "codex_cli", "codex-cli",
            "antigravity_cli", "antigravity-cli", "opencode_cli", "opencode", "grok_cli", "grok-cli",
        }:
            raise 予測読取専用利用不可("Hermes の外部CLIモデルは読取専用予測に対応していません。")
        # provider/モデルの最終解決後も、アダプター側で外部CLIと変更ツールを拒否する。
        return [
            str(python_path), str(entrypoint), "--workdir", repo_path or self.cwd_str,
            "--model", model or "auto",
        ]

    def _予測Codex共通引数(self) -> list:
        # --ignore-user-config は exec 専用であり、mcp list と有効設定がずれるので使わない。
        # 個別サーバーを明示的に無効化し、設定検査と推論の双方で同じ制約を適用する。
        args = []
        for value in (
            'approval_policy="never"', 'approvals_reviewer="user"',
            'sandbox_mode="read-only"', 'notify=[]',
            'history.persistence="none"', 'web_search="disabled"',
        ):
            args.extend(["-c", value])
        # WindowsはMXCが使える場合、read-onlyのまま読み取りコマンドを実行できる。
        # 非対応環境ではCodex側の既存sandbox選択に従い、権限を広げない。
        if os.name == "nt":
            args.extend(["-c", "features.prefer_mxc=true"])
        for feature in _予測CODEX無効機能:
            args.extend(["--disable", feature])
        return args

    async def _予測CodexMCP一覧(self, base: list, args: list, repo_path: str) -> list:
        """CLIの有効MCP設定だけを取得。モデルやMCPツールは起動しない。"""
        process = None
        try:
            flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
            spawn = asyncio.create_task(asyncio.create_subprocess_exec(
                sys.executable, str(_PROCESS_LIFETIME),
                "--parent-pid", str(os.getpid()), "--creationflags", str(flags), "--",
                *base, *args, "mcp", "list", "--json",
                stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
                cwd=repo_path, env=os.environ.copy(),
                start_new_session=(os.name != "nt"), creationflags=flags,
            ))
            try:
                process = await asyncio.shield(spawn)
            except asyncio.CancelledError:
                process = await spawn
                raise
            self.current_process = process
            stdout, _ = await asyncio.wait_for(process.communicate(), timeout=10)
            if process.returncode != 0:
                raise ValueError("mcp list failed")
            # transport には環境変数や認証ヘッダーが含まれ得る。生JSONはログに出さない。
            entries = json.loads(stdout.decode("utf-8"))
            if not isinstance(entries, list) or any(
                not isinstance(entry, dict)
                or not isinstance(entry.get("name"), str) or not entry["name"]
                or not isinstance(entry.get("enabled"), bool)
                for entry in entries
            ):
                raise ValueError("invalid mcp list")
            return [(entry["name"], entry["enabled"]) for entry in entries]
        except asyncio.CancelledError:
            raise
        except Exception:
            raise 予測読取専用利用不可(
                "Codex の読取専用設定を検証できませんでした。"
                "必要なCLI機能とMCP設定を確認してください。"
            ) from None
        finally:
            if process is not None:
                if process.returncode is None:
                    await _所有プロセス終了(process)
                if self.current_process is process:
                    self.current_process = None

    async def _予測CLI準備(self, repo_path: str) -> None:
        self._予測CLI確認()
        if self.code_ai != "codex_cli":
            return
        self._予測CodexMCP設定 = None
        self._予測Codex検証パス = None
        custom_cmd = os.environ.get("CODEX_CLI_CLI_PATH")
        base, _ = self._CLI起動コマンド先頭(
            custom_cmd or self._コマンドパス取得(), custom=bool(custom_cmd),
        )
        args = self._予測Codex共通引数()
        entries = await self._予測CodexMCP一覧(base, args, repo_path)
        # 空マップによる上書きは再帰mergeで無効。発見した各サーバーを明示無効化する。
        # サーバー名の '.' 等を階層区切りにしないため、引用付きのinline tableを使う。
        names = sorted({name for name, _ in entries})
        override = "mcp_servers={" + ",".join(
            f"{json.dumps(name, ensure_ascii=False)}={{enabled=false}}" for name in names
        ) + "}" if names else ""
        verify_args = args + (["-c", override] if override else [])
        verified = await self._予測CodexMCP一覧(base, verify_args, repo_path)
        if any(enabled for _, enabled in verified):
            raise 予測読取専用利用不可("Codex のMCPを無効化できないため予測を中止しました。")
        self._予測CodexMCP設定 = override
        self._予測Codex検証パス = repo_path

    def _予測読取専用コマンド構築(self, base: list, プロンプト: str, repo_path: str) -> list:
        self._予測CLI確認()
        if self.code_ai == "codex_cli":
            if self._予測CodexMCP設定 is None or self._予測Codex検証パス != repo_path:
                raise 予測読取専用利用不可("Codex の読取専用設定が未検証です。")
            common = base + self._予測Codex共通引数()
            if self._予測CodexMCP設定:
                common.extend(["-c", self._予測CodexMCP設定])
            common.extend([
                "exec", "--skip-git-repo-check", "--sandbox", "read-only",
                "--ephemeral", "--ignore-rules",
            ])
        elif self.code_ai == "claude_cli":
            # 読取ツールのみ。通常のMCP・プラグイン・フック・セッション継続を無効化する。
            # 古いCLIがこれらの引数を受け付けない場合は通常実行へ戻さず失敗する。
            common = base + ["--restricted", "--safe-mode", "--strict-mcp-config",
                "--tools", "Read,Glob,Grep", "--disallowedTools", "mcp__*",
                "--permission-mode", "dontAsk", "--permission-prompts", "none",
                "--no-session-persistence", "--disable-slash-commands"]
        elif self.code_ai == "grok_cli":
            # 明示された読み取りツールだけを公開。サブエージェントとMCPのメタツールを除外する。
            common = base + ["--tools", "read_file,grep,list_dir", "--disallowed-tools", "search_tool,use_tool,task",
                "--permission-mode", "dontAsk", "--no-subagents", "--disable-web-search", "--sandbox", "read-only"]
        else:
            # available-tools は許可対象のみをモデルへ公開する。MCPや委譲も含めて除外。
            # https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference
            common = base + [
                "--output-format", "json", "--stream", "on",
                "--available-tools=view,grep,glob", "--allow-tool=read",
                "--deny-tool=write", "--deny-tool=shell", "--disable-builtin-mcps",
                "--no-custom-instructions", "--no-ask-user", "--no-auto-update", "--no-bash-env",
            ]
            if repo_path:
                common.extend(["--add-dir", repo_path])
        if self.code_model and self.code_model.lower() not in ("auto", "same"):
            common.extend(["--model", self.code_model])
        # 予測では既存のCLIセッションや許可状態を継続しない。
        return common + ([プロンプト] if self.code_ai == "codex_cli" else ["-p", プロンプト])

    def _コマンド構築(self, プロンプト: str, 初回: bool = False, repo_path: str = None, 読取専用: bool = False) -> list:
        """
        プロバイダー別のコマンドを構築

        Args:
            プロンプト: 送信するプロンプト
            初回: 初回送信かどうか

        Returns:
            コマンド配列
        """
        # 環境変数からカスタムコマンドパスを取得（オプション）
        custom_cmd = os.environ.get(f'{self.code_ai.upper()}_CLI_PATH')

        if self.実行オプション.CLI読取専用:
            self._予測CLI確認()
            if self.code_ai == "aidiy_hermes":
                return self._予測Hermesコマンド(repo_path)
            base, cmd_exe経由 = self._CLI起動コマンド先頭(
                custom_cmd or self._コマンドパス取得(), custom=bool(custom_cmd),
            )
            if cmd_exe経由:
                プロンプト = self._CLI送信用テキスト正規化(プロンプト)
            return self._予測読取専用コマンド構築(base, プロンプト, repo_path)

        if self.code_ai == "aidiy_hermes":
            # 完全プロンプトは argv に載せず、呼び出し側から UTF-8 stdin で渡す。
            # Windows CreateProcess のコマンドライン長制限（約 32,767 文字）を回避する。
            # cmd.exe の 8191 文字制限を避けるため、Windows では .cmd シムを経由せず
            # Python と cli_main.py を直接起動する。
            base = self._hermes直接実行コマンド() if not custom_cmd else None
            if base is None:
                base = [custom_cmd or self._コマンドパス取得()]

            # model="local_chat" のときは backend_local(8096) の OpenAI 互換 API へ
            # 疎結合接続する（hermes 標準の OpenAI 互換 provider に base-url を指定するだけ）。
            # backend_local は req.model を無視し、AiDiy_key.json の CHAT_LOCAL_MODEL を使う。
            if (self.code_model or "").lower() == "local_chat":
                local_args = [
                    "--provider", "lmstudio",
                    "--base-url", "http://127.0.0.1:8096/v1",
                    "--api-key", "local",
                    "--model", "local_chat",
                ]
                return base + ["-Q"] + local_args + ["--oneshot-stdin"]

            # 合成モデル一覧の CLI/model を Hermes の外部 CLI provider に渡す。
            # --model だけでは Hermes が Ollama のモデル名として解釈してしまう。
            cli_providers = {
                "copilot_cli": "copilot-cli", "claude_cli": "claude-code",
                "codex_cli": "codex-cli", "antigravity_cli": "antigravity-cli",
                "opencode_cli": "opencode", "grok_cli": "grok-cli",
            }
            provider, separator, model = (self.code_model or "").partition("/")
            if separator and provider in cli_providers and model:
                model_args = [] if model.lower() in {"auto", "same"} else ["--model", model]
                return base + ["-Q", "--provider", cli_providers[provider]] + model_args + ["--oneshot-stdin"]

            _model = self._ollama_cloud_suffix除去(self.code_model)
            if (_model or "").lower() == "same":
                # Hermes の保存済み provider / モデルを、非対話起動でも復元する。
                model_args = ["--provider", "same", "--model", "same"]
            else:
                model_args = ["--model", _model] if _model and _model.lower() != "auto" else []
            return base + ["-Q"] + model_args + ["--oneshot-stdin"]

        # 以降の CLI（claude/copilot/gemini/codex/opencode）は npm の .cmd シムを直接実行に
        # 解決して cmd.exe を回避する。cmd.exe を経由する場合のみ argv 長制限のため
        # プロンプトを 1 行化する。
        cmd_str = custom_cmd or self._コマンドパス取得()
        base, cmd_exe経由 = self._CLI起動コマンド先頭(cmd_str, custom=bool(custom_cmd))
        if cmd_exe経由:
            プロンプト = self._CLI送信用テキスト正規化(プロンプト)

        if self.code_ai == "opencode_cli":
            _model = self._ollama_cloud_suffix除去(self.code_model)
            if not _model or _model.lower() in ("auto", "same"):
                _model = self._opencode最終選択モデル()
            model_args = ["--model", _model] if _model else []
            cmd_args = base + ["run"]
            cmd_args += model_args + [プロンプト]
            if not 初回:
                cmd_args.append("-c")
            return cmd_args

        if self.code_ai == "grok_cli":
            # Grok Build CLI (grok) — 公式 xai-org/grok-build
            common = list(base)
            if self.code_permissions != "none":
                # --always-approve（別名 --yolo）で全ツール実行を自動承認
                common.append("--always-approve")
            # auto / same（変更無し）はモデル指定を省略
            if self.code_model and self.code_model.lower() not in ("auto", "same"):
                common.extend(["--model", self.code_model])
            if repo_path:
                common.extend(["--cwd", repo_path])
            # 自動更新チェックはヘッドレス実行では不要
            common.append("--no-auto-update")
            if 初回:
                # -p (--single) は単発プロンプト。応答を stdout へ出して終了する
                return common + ["-p", プロンプト]
            else:
                # -c (--continue) で同一 cwd の直近セッションを継続する
                return common + ["-c", "-p", プロンプト]

        if self.code_ai == "copilot_cli":
            # GitHub Copilot CLI
            common = list(base)
            common.extend(["--output-format", "json", "--stream", "on"])
            if self.code_permissions != "none":
                common.append("--allow-all-tools")
            # auto / same（変更無し）はモデル指定を省略
            if self.code_model and self.code_model.lower() not in ("auto", "same"):
                common.extend(["--model", self.code_model])
            if repo_path:
                common.extend(["--add-dir", repo_path])
            if 初回:
                return common + ["-p", プロンプト]
            else:
                return common + ["--continue", "-p", プロンプト]

        elif self.code_ai == "antigravity_cli":
            # Antigravity CLI (agy) — claude 互換インターフェース
            common = list(base)
            if self.code_permissions != "none":
                common.append("--dangerously-skip-permissions")
            # auto / same（変更無し）はモデル指定を省略
            if self.code_model and self.code_model.lower() not in ("auto", "same"):
                common.extend(["--model", self.code_model])
            if repo_path:
                common.extend(["--add-dir", repo_path])
            # CLI 固有の固定上限を無効にし、stdout/stderr の無受信900秒で監視する。
            common.extend(["--print-timeout", "0"])
            if 初回:
                return common + ["-p", プロンプト]
            else:
                # -c (--continue) は -p の後ろに付ける（opencode_cli と同様）
                return common + ["-p", プロンプト, "-c"]

        elif self.code_ai == "codex_cli":
            # OpenAI Codex CLI
            # Codex はサンドボックス無視を常に有効にする。
            base_args = base + ["exec", "--skip-git-repo-check", "--dangerously-bypass-approvals-and-sandbox"]
            # auto / same（変更無し）はCLI側のモデル設定に任せる。
            if self.code_model and self.code_model.lower() not in ("auto", "same"):
                base_args.extend(["--model", self.code_model])

            # 継続の場合は resume <session-id> を追加
            if not 初回 and self.codex_セッションID:
                base_args.extend(["resume", self.codex_セッションID])

            base_args.append(プロンプト)
            return base_args

        elif self.code_ai == "codex_ollama":
            # ollama launch codex --model <model> -- <codex args>
            model = self._ollama起動モデル取得("CODE_CODEX_OLLAMA_MODEL")
            cmd_args = ["ollama", "launch", "codex"]
            if model:
                cmd_args.extend(["--model", model])
            cmd_args.append("--")
            cmd_args.extend(["exec", "--skip-git-repo-check", "--dangerously-bypass-approvals-and-sandbox"])

            # 継続の場合は resume <session-id> を追加
            if not 初回 and self.codex_セッションID:
                cmd_args.extend(["resume", self.codex_セッションID])

            cmd_args.append(プロンプト)
            return cmd_args

        elif self.code_ai == "claude_cli":
            # デフォルト claude_cli
            common = list(base)
            if self.code_permissions != "none":
                common.extend(["--allow-dangerously-skip-permissions", "--permission-mode", "bypassPermissions"])
            common.append("--chrome")
            # auto / same（変更無し）はモデル指定を省略
            if self.code_model and self.code_model.lower() not in ("auto", "same"):
                common.extend(["--model", self.code_model])
            if repo_path:
                common.extend(["--add-dir", repo_path])
            if 初回:
                return common + ["-p", プロンプト]
            else:
                return common + ["--continue", "-p", プロンプト]

        elif self.code_ai == "claude_ollama":
            # ollama launch claude --model <model> -- <claude args>
            model = self._ollama起動モデル取得("CODE_CLAUDE_OLLAMA_MODEL")
            cmd_args = ["ollama", "launch", "claude"]
            if model:
                cmd_args.extend(["--model", model])
            cmd_args.append("--")
            if self.code_permissions != "none":
                cmd_args.extend(["--allow-dangerously-skip-permissions", "--permission-mode", "bypassPermissions"])
            cmd_args.append("--chrome")
            if repo_path:
                cmd_args.extend(["--add-dir", repo_path])
            if 初回:
                cmd_args.extend(["-p", プロンプト])
            else:
                cmd_args.extend(["--continue", "-p", プロンプト])
            return cmd_args

        else:
            # フォールバック
            common = list(base)
            if self.code_permissions != "none":
                common.extend(["--allow-dangerously-skip-permissions", "--permission-mode", "bypassPermissions"])
            common.append("--chrome")
            if self.code_model and self.code_model.lower() not in ("auto", "same"):
                common.extend(["--model", self.code_model])
            if repo_path:
                common.extend(["--add-dir", repo_path])
            if 初回:
                return common + ["-p", プロンプト]
            else:
                return common + ["--continue", "-p", プロンプト]

    def _システムプロンプト構築(self) -> str:
        """
        システムプロンプトを構築（【システム情報】セクション付き）

        Returns:
            システム情報を含む完全なシステムプロンプト
        """
        try:
            if self.system_instruction:
                base_prompt = self.system_instruction.strip()
            else:
                # 上位コンテキスト未定義時（テスト等）は簡素な既定文を使用
                base_prompt = "あなたは、美しい日本語を話す、賢いコードエージェントです。"

            # 実行環境に応じた補足を文末へ自動付加（重複は除去）
            suffix = "Windows環境で動作していることを考慮して、適切なコマンドを使用してください。" if os.name == 'nt' else None

            if suffix:
                normalized = base_prompt.replace(suffix, "").strip()
                base_prompt = f"{normalized}\n{suffix}" if normalized else suffix

            return base_prompt

        except Exception as e:
            logger.error(f"システムプロンプト構築エラー: {e}")
            return base_prompt

    def _aidiy参照プロンプト取得(self, 実行パス: str = None) -> str:
        """_AIDIY/knowledge/_index.md がある場合のみ、知見参照指示を返す"""
        try:
            base_dir = Path(実行パス if 実行パス else self.cwd_str).resolve()
            index_path = base_dir / "_AIDIY" / "knowledge" / "_index.md"
            if not index_path.exists():
                return ""
            display_path = index_path.resolve().as_posix()
            return (
                "\n\n"
                "プロジェクト内のファイル操作するときは、\n"
                "_AIDIY/knowledgeフォルダ並びに_AIDIY/knowledge/_index.mdを確認し、\n"
                "類似の操作の記載があれば知見として利用すること。\n"
                f"参照先: `{display_path}`"
            )
        except Exception as e:
            logger.warning(f"_AIDIY/knowledge 参照プロンプト生成エラー: {e}")
            return ""

    async def 開始(self):
        """CodeAI開始（CLIツールのバージョン確認を含む）"""
        try:
            if self.実行オプション.CLI読取専用:
                # 単発予測では別プロセスの --version を起動しない。
                # 実行時の制約付きpreflight/CLIが機能の有無を検証し、失敗時は閉じる。
                self._予測CLI確認()
                self.is_alive = True
                return True
            self.is_alive = True
            self.バージョン = await self.バージョン確認()
            if not self.バージョン:
                self.is_alive = False
                return False
            return True
        except Exception as e:
            logger.error(f"CodeAI開始:エラー {e}")
            self.is_alive = False
            return False

    async def 終了(self):
        """CodeAI終了"""
        try:
            self.is_alive = False
            # 実行中のsubprocessがあれば終了
            await self.強制終了()
        except Exception as e:
            logger.error(f"CodeAI終了:エラー {e}")
            self.is_alive = False

    async def 強制終了(self):
        """実行中のsubprocessを強制終了"""
        self.is_alive = False  # ストリーム送信を即座に停止
        if self.current_process and self.current_process.returncode is None:
            try:
                await _所有プロセス終了(self.current_process)
                logger.info(f"[CodeAI] subprocess強制終了完了")
            except Exception as e:
                logger.warning(f"[CodeAI] subprocess強制終了エラー: {e}")
            finally:
                self.current_process = None

    def _強制停止要求あり(self) -> bool:
        """親側フラグも含めて強制停止要求を判定"""
        if not self.is_alive:
            return True
        if self.parent_manager and getattr(self.parent_manager, "強制停止フラグ", False):
            return True
        return False

    async def _停止マーカー送信(self) -> None:
        """強制停止を1回だけ記録する。CAN 送信は親の CodeAgent が担当する。"""
        if self._停止マーカー送信済み:
            return
        self._停止マーカー送信済み = True

    def _履歴追加(self, text: str, type: str):
        """履歴に項目を追加"""
        self.履歴最終番号 += 1
        self.履歴最終時刻 = time.time()
        key = str(self.履歴最終番号)

        self.履歴辞書[key] = {
            "seq": str(self.履歴最終番号),
            "time": self.履歴最終時刻,
            "type": type,
            "text": text
        }

    def _履歴取得(self) -> str:
        """過去の会話履歴を取得してフォーマット"""
        if not self.履歴辞書:
            return ""

        履歴テキスト = "【過去の会話履歴】\n"

        # 番号順にソートして履歴を構築
        sorted_keys = sorted(self.履歴辞書.keys(), key=lambda x: int(x))

        for key in sorted_keys:
            item = self.履歴辞書[key]
            if item["type"] == "system":
                履歴テキスト += f"```system\n{item['text']}\n```\n"
            elif item["type"] == "user":
                履歴テキスト += f"```user\n{item['text']}\n```\n"
            elif item["type"] == "agent":
                履歴テキスト += f"```agent\n{item['text']}\n```\n"

        return 履歴テキスト

    def _codex出力抽出(self, full_output: str) -> str:
        """
        codexコマンドの出力から実際の応答部分のみを抽出

        codexの出力形式:
        実際の応答（最初の行）
        OpenAI Codex v0.47.0 (research preview)
        --------
        workdir: ...
        model: ...
        ...
        --------
        user
        質問内容

        thinking
        思考内容
        codex
        実際の応答（繰り返し）
        tokens used
        数値

        Args:
            full_output: codexコマンドの完全な出力

        Returns:
            抽出された応答部分（最初の行から「OpenAI Codex」の直前まで）
        """
        try:
            lines = full_output.split('\n')
            result_lines = []

            for i, line in enumerate(lines):
                # "OpenAI Codex" で始まる行を検出したら終了
                if line.strip().startswith('OpenAI Codex'):
                    break

                # それ以外の行を収集
                result_lines.append(line)

            # 抽出できた場合はそれを返す
            if result_lines:
                result = '\n'.join(result_lines).strip()
                if result:
                    return result

            # 抽出できなかった場合は全出力を返す
            logger.warning("codex出力抽出失敗: 有効な応答が見つかりませんでした")
            return full_output

        except Exception as e:
            logger.error(f"codex出力抽出エラー: {e}")
            return full_output

    def _codexセッションID抽出(self, full_output: str) -> Optional[str]:
        """
        codexコマンドの出力からセッションIDを抽出

        Args:
            full_output: codexコマンドの完全な出力

        Returns:
            セッションID（見つからない場合はNone）
        """
        try:
            import re
            # パターン: session id: <uuid>
            pattern = r'session id:\s*([a-f0-9\-]+)'
            match = re.search(pattern, full_output, re.IGNORECASE)

            if match:
                セッションID = match.group(1)
                logger.debug(f"codexセッションID抽出成功: {セッションID}")
                return セッションID
            else:
                logger.debug("codexセッションID抽出: セッションIDが見つかりませんでした")
                return None

        except Exception as e:
            logger.error(f"codexセッションID抽出エラー: {e}")
            return None

    async def 実行(self, 要求テキスト: str, タイムアウト秒数: int = 900,
                   resume: bool = True, 読取専用: bool = False, 絶対パス: str = None, file_path: str = None, 変更ファイル一覧: list = None, 再プラン要求: bool = False) -> str:
        """
        CLI (subprocess) 実行

        Args:
            要求テキスト: ユーザーからの要求
            タイムアウト秒数: タイムアウト時間
            resume: セッション継続（履歴利用）
            読取専用: 読み取り専用モード
            絶対パス: 実行ディレクトリ
            file_path: 添付ファイルの絶対パス（オプション）
            変更ファイル一覧: 変更されたファイルのリスト（検証用、オプション）
            再プラン要求: 修正内容の再プラン要求フラグ（オプション）

        Returns:
            実行結果テキスト
        """
        # 会話継続が無効な実行オプションでは、呼び出し側の指定に関わらず新しいセッションにする。
        if not self.実行オプション.会話継続 or self.実行オプション.CLI読取専用:
            resume = False
        self.予測読取専用利用不可 = False
        try:
            if self.実行オプション.CLI読取専用:
                self._予測CLI確認()
            self._停止マーカー送信済み = False
            aidiy_prompt = "" if self.実行オプション.CLI読取専用 else self._aidiy参照プロンプト取得(絶対パス)
            if aidiy_prompt:
                要求テキスト += aidiy_prompt
            # 添付ファイル（絶対パス）がある場合は先に付与
            if file_path:
                try:
                    abs_path_str = Path(file_path).resolve().as_posix()
                    要求テキスト += f"\n\n添付ファイル: `{abs_path_str}`"
                except Exception as e:
                    logger.error(f"最終ファイル添付エラー: {e}")

            # 再プラン要求がある場合は追加
            if 再プラン要求:
                try:
                    replan_prompt = """

修正が正しいことを検証するために、
修正概要、修正手順を再プランしてください。
"""
                    要求テキスト += replan_prompt
                    logger.info("CodeAI: 再プラン要求をプロンプトに追加")
                except Exception as e:
                    logger.error(f"CodeAI: 再プラン要求処理エラー: {e}")

            # 変更ファイル一覧がある場合は検証モード（元の依頼は実施済みとして検証のみ）
            if 変更ファイル一覧 and len(変更ファイル一覧) > 0:
                try:
                    ファイル一覧文字列 = '\n'.join([f"- {ファイル名}" for ファイル名 in 変更ファイル一覧])
                    元の要求 = 要求テキスト
                    要求テキスト = f"""前回の依頼「{元の要求}」は実施済みです。

以下のファイルが変更されました：
{ファイル一覧文字列}

これらのファイルの変更内容を検証し、問題があれば追加修正を行ってください。
問題がなければ「検証完了」と報告してください。"""
                    logger.info(f"CodeAI: 検証モード - 変更ファイル {len(変更ファイル一覧)}件")
                except Exception as e:
                    logger.error(f"CodeAI: 変更ファイル一覧処理エラー: {e}")

            # 90秒以内の最終イメージがあれば要求テキストに追加（file_pathがない場合の補完）
            if (not self.実行オプション.CLI読取専用 and self.parent_manager
                    and hasattr(self.parent_manager, 'セッションデータ')):
                last_image_time = self.parent_manager.セッションデータ.get('最終イメージ時刻')
                if last_image_time and (time.time() - last_image_time) <= 90:
                    last_image_base64 = self.parent_manager.セッションデータ.get('最終イメージ')
                    if last_image_base64:
                        try:
                            # 画像をデコード
                            image_data = base64.b64decode(last_image_base64)

                            # Pillowを使って画像を開き、JPEGとして保存
                            image_stream = io.BytesIO(image_data)
                            with Image.open(image_stream) as img:
                                # JPEGはアルファチャンネルをサポートしないため、RGBに変換
                                rgb_img = img.convert('RGB')

                                # 保存先パスを構築
                                base_path = Path(絶対パス if 絶対パス else self.cwd_str)
                                save_dir = base_path / "temp" / "input"
                                save_dir.mkdir(parents=True, exist_ok=True)

                                # ファイル名を生成
                                timestamp = datetime.datetime.now().strftime("%Y%m%d.%H%M%S")
                                file_name = f"{timestamp}.jpg"
                                save_path = save_dir / file_name

                                # 画像をファイルに書き込み
                                rgb_img.save(save_path, format='JPEG')

                                abs_path_str = save_path.resolve().as_posix()
                                image_prompt_addition = f"\n\n添付ファイル: `{abs_path_str}`"
                                要求テキスト += image_prompt_addition
                                logger.info(f"最終イメージを添付: {abs_path_str}")

                        except Exception as e:
                                logger.error(f"最終イメージの処理中にエラーが発生しました: {e}")

            # 送信コンテキスト側で「今回の依頼」を必ず明示（要求テキスト自体は改変しない）
            依頼本文 = (要求テキスト or "").strip()
            if 依頼本文.startswith("【今回の依頼】"):
                送信用要求テキスト = 依頼本文
            else:
                送信用要求テキスト = f"【今回の依頼】\n{依頼本文}\n"

            # 生存状態チェック（停止中なら自動再開始を試行）
            if not self.is_alive:
                logger.warning("CodeAI実行:停止状態を検出。自動再開始を試行します")
                try:
                    開始成功 = await self.開始()
                    if (開始成功 is False) or (not self.is_alive):
                        logger.warning("CodeAI実行:自動再開始に失敗")
                        return "! CodeAIが停止状態です。開始してください。"
                    logger.info("CodeAI実行:自動再開始に成功")
                except Exception as start_error:
                    logger.error(f"CodeAI実行:自動再開始エラー {start_error}")
                    return "! CodeAIが停止状態です。開始してください。"

            # 履歴管理
            if not resume:
                self.履歴辞書 = {}
                self.履歴最終番号 = 0
            if len(self.履歴辞書) == 0:
                self._履歴追加(self.system_prompt, "system")

            # 初回判定（resumeがFalseまたはセッション未開始）
            初回送信 = not resume or not self.session_started
            # 送信文とモデル判断で同じ履歴を使う。生成はターンごとに1回だけ。
            履歴テキスト = self._履歴取得()

            # 完全なプロンプト構築（プロバイダー別）
            if self.code_ai in ["claude_cli", "copilot_cli", "antigravity_cli", "codex_cli", "opencode_cli", "grok_cli"]:
                # 履歴送信不要。初回のみ system_prompt を付与して方針を伝える
                if 初回送信:
                    完全プロンプト = f"{self.system_prompt}\n\n{送信用要求テキスト}"
                    self.session_started = True
                else:
                    完全プロンプト = 送信用要求テキスト
            elif self.code_ai == "claude_ollama":
                # claude_ollama（claude_cli のコピー）
                if 初回送信:
                    完全プロンプト = f"{self.system_prompt}\n\n{送信用要求テキスト}"
                    self.session_started = True
                else:
                    完全プロンプト = 送信用要求テキスト
            elif self.code_ai == "codex_ollama":
                # codex_ollama（codex_cli のコピー）
                if 初回送信:
                    完全プロンプト = f"{self.system_prompt}\n\n{送信用要求テキスト}"
                    self.session_started = True
                else:
                    完全プロンプト = 送信用要求テキスト
            else:
                # 毎回フルコンテキストを送る方式。初回だけ素の system_prompt を先頭に置くと
                # 2回目以降（履歴テキスト先頭）とプレフィックスが一致せずキャッシュが無効になる。
                # 初回から履歴テキスト形式で統一し、先頭を追記のみで伸ばす。
                完全プロンプト = f"{履歴テキスト}\n\n{送信用要求テキスト}"
                if 初回送信:
                    self.session_started = True

            # CLI自身が履歴を持つ継続モードでも、判断には保持中の会話履歴を渡す。
            # 新規会話には以前の会話を混ぜない。選択結果は今回だけ使用する。
            選択モデル = ""
            モデル選択失敗 = False
            実行モデル = self.code_model
            if (self.code_model or "").strip().lower() == "auto":
                実行モデル = "same"
                判断CLI = self.code_ai
                if 判断CLI in ("codex_cli", "claude_cli", "copilot_cli", "opencode_cli", "aidiy_hermes"):
                    from AIコア.AIコードモデル選択 import select_model, model_choices, fallback_model
                    候補 = model_choices(判断CLI)
                    選択モデル = await select_model(
                        判断CLI, "" if 初回送信 else 履歴テキスト, 完全プロンプト, choices=候補,
                    )
                    モデル選択失敗 = not 選択モデル
                    if モデル選択失敗:
                        選択モデル = fallback_model(判断CLI, 候補)
                    実行モデル = 選択モデル
            self.最終実行モデル = "" if (実行モデル or "").lower() in ("", "auto", "same") else 実行モデル
            if self._強制停止要求あり():
                await self._停止マーカー送信()
                return "!"

            # 履歴に今回の要求を追加（完全プロンプト生成後：重複送信を避ける）
            self._履歴追加(要求テキスト, "user")

            # コマンド構築（プロバイダー別・初回判定付き）
            作業ディレクトリ = 絶対パス if 絶対パス else self.cwd_str
            repo_path = Path(作業ディレクトリ).resolve().as_posix()
            if self.実行オプション.CLI読取専用:
                await self._予測CLI準備(repo_path)
            設定モデル = self.code_model
            try:
                # 同期的なコマンド構築だけに適用し、autoを次のターンにも維持する。
                self.code_model = 実行モデル
                command = self._コマンド構築(
                    プロンプト=完全プロンプト,
                    初回=初回送信,
                    repo_path=repo_path,
                    読取専用=読取専用
                )
            finally:
                self.code_model = 設定モデル

            if 選択モデル and self.parent_manager and hasattr(self.parent_manager, '接続'):
                try:
                    await self.parent_manager.接続.send_to_channel(self.チャンネル, {
                        "セッションID": self.セッションID, "チャンネル": self.チャンネル,
                        "メッセージ識別": "output_stream",
                        "メッセージ内容": (f"[モデル選択失敗: {選択モデル} を使用します]\n" if モデル選択失敗
                                           else f"[選択モデル: {選択モデル}]\n"),
                        "ファイル名": None, "サムネイル画像": None,
                    })
                except Exception:
                    logger.warning("Code CLI選択モデル通知を送信できませんでした")
            if self._強制停止要求あり():
                await self._停止マーカー送信()
                return "!"

            # テスト用：送信コンテキスト（完全プロンプト）を標準出力に表示（平文）
            try:
                print("\n" + "=" * 80)
                print("送信コンテキスト（完全プロンプト）")
                print(f"AI={self.code_ai} model={実行モデル} resume={resume} 初回送信={初回送信}")
                print("-" * 80)
                print(完全プロンプト)
                print("=" * 80 + "\n")
            except Exception:
                pass

            # subprocess実行（antigravity_cli も共通の非表示起動を使用）
            if self.code_ai == "antigravity_cli":
                result_text = await self._antigravity実行(
                    command=command,
                    cwd=作業ディレクトリ,
                    timeout=タイムアウト秒数
                )
            else:
                result_text = await self._subprocess実行(
                    command=command,
                    cwd=作業ディレクトリ,
                    timeout=タイムアウト秒数,
                    stdin_text=完全プロンプト if self.code_ai == "aidiy_hermes" else None,
                )
                # 候補一覧は複数の一覧を合成しているため、契約上使えないモデルが含まれる場合がある。
                # auto で選んだモデルを CLI が拒否したときだけ、CLI 既定（same）で1回やり直す。
                if (
                    選択モデル
                    and not self.実行オプション.CLI読取専用
                    and (result_text or "").startswith("!")
                    and re.search(r"(?i)\bmodel\b.*\b(not available|not supported|unknown|invalid)\b", result_text or "")
                    and not self._強制停止要求あり()
                ):
                    logger.warning(f"[CodeAI] 選択モデルが使えないためCLI既定で再実行: ai={self.code_ai} model={選択モデル}")
                    if self.parent_manager and hasattr(self.parent_manager, '接続'):
                        try:
                            await self.parent_manager.接続.send_to_channel(self.チャンネル, {
                                "セッションID": self.セッションID, "チャンネル": self.チャンネル,
                                "メッセージ識別": "output_stream",
                                "メッセージ内容": f"[{選択モデル} は使えないため、CLIの既定モデルで再実行します]\n",
                                "ファイル名": None, "サムネイル画像": None,
                            })
                        except Exception:
                            logger.warning("Code CLI再実行通知を送信できませんでした")
                    try:
                        self.code_model = "same"
                        command = self._コマンド構築(
                            プロンプト=完全プロンプト, 初回=初回送信, repo_path=repo_path, 読取専用=読取専用
                        )
                    finally:
                        self.code_model = 設定モデル
                    self.最終実行モデル = ""
                    result_text = await self._subprocess実行(
                        command=command,
                        cwd=作業ディレクトリ,
                        timeout=タイムアウト秒数,
                        stdin_text=完全プロンプト if self.code_ai == "aidiy_hermes" else None,
                    )

            # codexの場合、セッションIDを抽出して保存（stderr から抽出）
            if self.code_ai == "codex_cli":
                セッションID = self._codexセッションID抽出(self.last_stderr_output)
                if セッションID:
                    self.codex_セッションID = セッションID
                    logger.info(f"codexセッションID保存: {セッションID}")
            elif self.code_ai == "codex_ollama":
                セッションID = self._codexセッションID抽出(self.last_stderr_output)
                if セッションID:
                    self.codex_セッションID = セッションID
                    logger.info(f"codexセッションID保存: {セッションID}")

            # 履歴に結果を追加
            final_result = 応答正規化(result_text)
            self._履歴追加(final_result, "agent")

            return final_result

        except 予測読取専用利用不可 as e:
            self.予測読取専用利用不可 = True
            return f"! {e}"
        except Exception as e:
            # ツールエラーログ（必須）
            logger.error(
                f"CodeAI実行エラー: {e} 要求=[{要求テキスト[:10]}...] AI={self.code_ai} モデル={self.code_model}"
            )
            エラーメッセージ = f"! 実行エラー: {str(e)}"

            return エラーメッセージ

    async def _subprocess実行(
        self,
        command: list,
        cwd: str,
        timeout: int,
        stdin_text: Optional[str] = None,
        creationflags: int = 0,
    ) -> str:
        """
        subprocessでコマンドを実行し、stdoutをリアルタイムで監視
        ストリーム出力のみ行い、開始/終了/中断通知は親側で行う

        Args:
            command: 実行コマンド配列
            cwd: 作業ディレクトリ
            timeout: タイムアウト秒数
            stdin_text: UTF-8 で標準入力へ送る文字列（省略時は stdin を閉じる）

        Returns:
            実行結果の全テキスト
        """
        process = None
        tasks: list[asyncio.Task] = []
        try:
            self._停止マーカー送信済み = False
            # プロセス起動
            if os.name == "nt" and not creationflags:
                creationflags = subprocess.CREATE_NO_WINDOW
            spawn_task = asyncio.create_task(asyncio.create_subprocess_exec(
                sys.executable, str(_PROCESS_LIFETIME),
                "--parent-pid", str(os.getpid()),
                "--creationflags", str(creationflags), "--", *command,
                stdin=(
                    asyncio.subprocess.PIPE
                    if stdin_text is not None
                    else asyncio.subprocess.DEVNULL
                ),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=cwd,
                env=os.environ.copy(),
                start_new_session=(os.name != "nt"),
                creationflags=creationflags,
            ))
            try:
                process = await asyncio.shield(spawn_task)
            except asyncio.CancelledError:
                # 起動直後にキャンセルされても PID を受け取り、finally で回収する。
                process = await spawn_task
                raise
            # 強制終了用に参照を保持
            self.current_process = process

            result_lines = []
            stderr_lines = []
            copilot_output = _CopilotJSON出力() if self.code_ai == "copilot_cli" else None
            stdout_line_count = 0
            last_output_time = time.monotonic()

            def 出力時刻更新():
                nonlocal last_output_time
                last_output_time = time.monotonic()

            async def copilot進捗送信(lines):
                for line in lines:
                    if self._強制停止要求あり():
                        await self._停止マーカー送信()
                        return
                    if self.parent_manager and hasattr(self.parent_manager, '接続'):
                        try:
                            await self.parent_manager.接続.send_to_channel(self.チャンネル, {
                                "セッションID": self.セッションID,
                                "チャンネル": self.チャンネル,
                                "メッセージ識別": "output_stream",
                                "メッセージ内容": line,
                                "ファイル名": None,
                                "サムネイル画像": None,
                            })
                        except Exception as e:
                            logger.error(f"[CodeCli] Copilot進捗送信エラー: {e}")

            # stdin 送信は stdout/stderr の読み取りと並行して行う。
            # 子が先に大量出力する場合でも、双方向のパイプ待ちを起こさない。
            async def stdin_writer():
                if stdin_text is None or process.stdin is None:
                    return
                try:
                    process.stdin.write(stdin_text.encode("utf-8"))
                    await process.stdin.drain()
                except (BrokenPipeError, ConnectionResetError):
                    pass
                finally:
                    # Windows ProactorEventLoop ではキャンセル中の
                    # wait_closed() が InvalidStateError になることがあるため呼ばない。
                    process.stdin.close()

            # stdout監視タスク
            async def stdout_reader():
                nonlocal last_output_time, stdout_line_count
                try:
                    async for line in _出力行を順に取得(process.stdout, 出力時刻更新):
                        # 強制停止チェック（is_aliveがFalseならストリーム中断）
                        if self._強制停止要求あり():
                            logger.info("[CodeAI] 強制停止要求検出、stdout読み取り中断")
                            await self._停止マーカー送信()
                            break

                        last_output_time = time.monotonic()
                        line_text = line.decode('utf-8', errors='replace').rstrip()
                        stdout_line_count += 1
                        if copilot_output is not None:
                            await copilot進捗送信(copilot_output.解析(line_text))
                            continue
                        result_lines.append(line_text)

                        # 強制停止チェック（送信前にも再確認）
                        if self._強制停止要求あり():
                            logger.info("[CodeAI] 強制停止要求検出、stdout送信スキップ")
                            await self._停止マーカー送信()
                            break

                        # opencode は stdout を正式回答専用とし、
                        # codex/claude 等の従来の stdout ストリーム挙動は維持する。
                        stdoutをストリーム送信 = self.code_ai not in _STDERR_STREAM_STDOUT_FINAL_AI
                        if stdoutをストリーム送信 and self.parent_manager and hasattr(self.parent_manager, '接続'):
                            try:
                                await self.parent_manager.接続.send_to_channel(self.チャンネル, {
                                    "セッションID": self.セッションID,
                                    "チャンネル": self.チャンネル,
                                    "メッセージ識別": "output_stream",
                                    "メッセージ内容": line_text,
                                    "ファイル名": None,
                                    "サムネイル画像": None
                                })
                            except Exception as e:
                                logger.error(f"[CodeCli] output_stream送信エラー(stream): {e}")
                    if copilot_output is not None:
                        await copilot進捗送信(copilot_output.残りの進捗())
                except Exception as e:
                    logger.error(f"stdout読み取りエラー: {e}")

            # stderr監視タスク
            async def stderr_reader():
                nonlocal last_output_time
                try:
                    async for line in _出力行を順に取得(process.stderr, 出力時刻更新):
                        # 強制停止チェック（is_aliveがFalseならストリーム中断）
                        if self._強制停止要求あり():
                            logger.info("[CodeAI] 強制停止要求検出、stderr読み取り中断")
                            await self._停止マーカー送信()
                            break

                        last_output_time = time.monotonic()
                        line_text = line.decode('utf-8', errors='replace').rstrip()
                        stderr_lines.append(line_text)

                        # 強制停止チェック（送信前にも再確認）
                        if self._強制停止要求あり():
                            logger.info("[CodeAI] 強制停止要求検出、stderr送信スキップ")
                            await self._停止マーカー送信()
                            break

                        # parent_manager経由でoutput_stream送信（stderr）
                        if self.parent_manager and hasattr(self.parent_manager, '接続'):
                            try:
                                await self.parent_manager.接続.send_to_channel(self.チャンネル, {
                                    "セッションID": self.セッションID,
                                    "チャンネル": self.チャンネル,
                                    "メッセージ識別": "output_stream",
                                    "メッセージ内容": line_text,
                                    "ファイル名": None,
                                    "サムネイル画像": None
                                })
                            except Exception as e:
                                logger.error(f"[CodeCli] output_stream送信エラー(stderr): {e}")
                except Exception as e:
                    logger.error(f"stderr読み取りエラー: {e}")

            # タイムアウト監視タスク
            async def timeout_monitor():
                while True:
                    await asyncio.sleep(1)
                    if self._強制停止要求あり():
                        logger.info("[CodeAI] 強制停止要求検出（monitor）")
                        await self._停止マーカー送信()
                        return
                    if time.monotonic() - last_output_time > timeout:
                        raise asyncio.TimeoutError(f"タイムアウト({timeout}秒)")

            # タスク実行
            stdout_task = asyncio.create_task(stdout_reader())
            stderr_task = asyncio.create_task(stderr_reader())
            monitor_task = asyncio.create_task(timeout_monitor())
            process_task = asyncio.create_task(process.wait())
            stdin_task = (
                asyncio.create_task(stdin_writer())
                if stdin_text is not None
                else None
            )
            tasks = [stdout_task, stderr_task, monitor_task, process_task]
            if stdin_task is not None:
                tasks.append(stdin_task)

            # プロセス・stdout/stderr・stdin がすべて終わるまで受信監視を続ける。
            # 先に一方のパイプが閉じても、もう一方の出力で待機時間を更新する。
            completion_targets = [stdout_task, stderr_task, process_task]
            if stdin_task is not None:
                completion_targets.append(stdin_task)
            completion_task = asyncio.gather(*completion_targets, return_exceptions=True)
            done, _ = await asyncio.wait(
                [completion_task, monitor_task], return_when=asyncio.FIRST_COMPLETED
            )

            monitor_error = None
            if monitor_task in done:
                try:
                    await monitor_task
                except asyncio.TimeoutError as e:
                    monitor_error = e
                completion_task.cancel()
                await asyncio.gather(completion_task, return_exceptions=True)
            else:
                monitor_task.cancel()
                await asyncio.gather(monitor_task, return_exceptions=True)
                await completion_task

            # プロセスが生きていればキル
            if process.returncode is None:
                await _所有プロセス終了(process)

            # 結果を結合
            full_output = copilot_output.回答 if copilot_output is not None else "\n".join(result_lines)
            stderr_output = "\n".join(stderr_lines)

            # stderr を保存（セッションID抽出用）
            self.last_stderr_output = stderr_output

            if monitor_error is not None:
                raise monitor_error

            if self.実行オプション.CLI読取専用 and process.returncode == 2:
                # adapterの未対応transportやCLIの未対応引数を、本文とは別の能力エラーにする。
                # 設定・認証情報を含み得るstdout/stderrをログや戻り値へ出さない。
                self.予測読取専用利用不可 = True
                self.last_stderr_output = ""
                return "! CLIの予測用読取専用モードを利用できません。"

            # stdout/stderr の行数と先頭内容を記録
            logger.info(f"[CodeAI] subprocess完了: stdout={stdout_line_count}行, stderr={len(stderr_lines)}行, ai={self.code_ai}, 終了コード={process.returncode}")
            if result_lines:
                logger.info(f"[CodeAI] stdout先頭: {repr(result_lines[0][:80])}")
                logger.info(f"[CodeAI] stdout末尾: {repr(result_lines[-1][:80])}")
            if stderr_lines:
                logger.info(f"[CodeAI] stderr先頭: {repr(stderr_lines[0][:80])}")

            if self._停止マーカー送信済み:
                return "!"

            result = full_output.strip()
            if self.code_ai == "aidiy_hermes":
                # Hermes の記憶ファイルは項目区切りに「§」を使う。モデルがこれを真似て
                # 回答末尾へ付けることがあるため、末尾に単独で付いた区切りだけを除く。
                result = re.sub(r"\s*§+\s*$", "", result)
            if process.returncode != 0:
                stderr_text = [line.strip() for line in re.sub(r"\x1b\[[0-9;?]*[A-Za-z]", "", stderr_output).splitlines() if line.strip()]
                detail = [line for line in stderr_text if re.match(r"(?i)error\b", line)] or stderr_text[-3:]
                reason = ' / '.join(detail) or result or f'終了コード {process.returncode}'
                return エラー応答(f"実行エラー: {self.code_ai} {reason[:500]}")
            # stdout を正式回答とする CLI では stderr を最終回答へ混ぜない。
            # その他の CLI は、非TTY環境で stderr に回答を出す場合に備えて従来挙動を維持する。
            if (
                not result
                and self.code_ai not in _STDERR_STREAM_STDOUT_FINAL_AI
                and stderr_output.strip()
            ):
                logger.info(f"[CodeAI] stdout空のためstderrを戻り値に使用: ai={self.code_ai}")
                result = stderr_output.strip()
            return 応答正規化(result)

        except asyncio.TimeoutError as e:
            logger.warning(f"subprocess タイムアウト: {e}")
            return f"! 処理タイムアウト({timeout}秒)が発生しました。"

        except Exception as e:
            logger.error(f"subprocess実行エラー (command={command}, cwd={cwd}): {e}")
            return f"! subprocess実行エラー: {str(e)}"

        finally:
            pending_tasks = [task for task in tasks if not task.done()]
            for task in pending_tasks:
                task.cancel()
            if tasks:
                # 完了済みタスクも gather し、stdin_writer 等の例外を
                # "Task exception was never retrieved" に残さない。
                await asyncio.gather(*tasks, return_exceptions=True)
            if process is not None and process.returncode is None:
                await _所有プロセス終了(process)
            if process is not None and self.current_process is process:
                self.current_process = None

    async def _antigravity実行(self, command: list, cwd: str, timeout: int) -> str:
        """子コマンドにも表示コンソールを作らせず、回答・進捗をパイプで受け取る。"""
        # DETACHED_PROCESS では子コマンドが新しいコンソールを作るため、
        # 共通処理の CREATE_NO_WINDOW を使う（両フラグの併用はしない）。
        return await self._subprocess実行(command, cwd, timeout)


# ===== 使用例とテストコード =====

async def session_test(AI_NAME="openai", AI_MODEL="auto"):
    """
    セッション管理テスト（CLI版）
    - セッション開始
    - 1回目: 近藤の自己紹介
    - 2回目: 名前を覚えているか確認
    - 3回目: Pythonコードの質問
    - 4回目: 続けて質問
    - 履歴表示
    """
    print("=" * 50)
    print("CodeAI セッション管理テスト")
    print("=" * 50)

    # CodeAIインスタンス作成
    codeai = CodeAI(親=None, セッションID="test_session", AI_NAME=AI_NAME, AI_MODEL=AI_MODEL, max_turns=10)

    try:
        # セッション開始
        print("\n[セッション開始]")
        start_result = await codeai.開始()
        print(f"セッション開始結果: {start_result}")

        # 1回目実行
        print("\n[1回目] 自己紹介")
        result1 = await codeai.実行(
            要求テキスト="私の名前は近藤です。覚えておいてください。",
            タイムアウト秒数=30,
            resume=False
        )
        print(f"結果: {result1[:100]}...")
        print(f"履歴件数: {len(codeai.履歴辞書)}件")

        # 2回目実行
        time.sleep(3)
        print("\n[2回目] 名前確認")
        result2 = await codeai.実行(
            要求テキスト="私の名前を教えてください",
            タイムアウト秒数=30,
            resume=True
        )
        print(f"結果: {result2[:100]}...")
        print(f"履歴件数: {len(codeai.履歴辞書)}件")

        # 3回目実行
        time.sleep(3)
        print("\n[3回目] Pythonコード質問")
        result3 = await codeai.実行(
            要求テキスト="if文の使い方を教えて",
            タイムアウト秒数=30,
            resume=True
        )
        print(f"結果: {result3[:100]}...")
        print(f"履歴件数: {len(codeai.履歴辞書)}件")

        # 4回目実行
        time.sleep(3)
        print("\n[4回目] 続けて質問")
        result4 = await codeai.実行(
            要求テキスト="for文との違いは何ですか？",
            タイムアウト秒数=30,
            resume=True
        )
        print(f"結果: {result4[:100]}...")
        print(f"履歴件数: {len(codeai.履歴辞書)}件")

        # 履歴表示
        print("\n[履歴表示]")
        formatted_history = codeai._履歴取得()
        print(formatted_history)

    except Exception as e:
        print(f"エラー: {e}")
        import traceback
        traceback.print_exc()
    finally:
        # セッション終了
        await codeai.終了()

    print("=" * 50)
    print("テスト完了")
    print("=" * 50)


async def simple_test(AI_NAME="openai", AI_MODEL="auto"):
    """キューなしのシンプルテスト"""
    print("\n" + "=" * 30)
    print("シンプルテスト開始")
    print("=" * 30)

    # CodeAIインスタンス作成
    codeai = CodeAI(親=None, セッションID="simple_test", AI_NAME=AI_NAME, AI_MODEL=AI_MODEL, max_turns=10)

    try:
        # セッション開始
        await codeai.開始()

        # キューなしでの実行
        time.sleep(3)
        result = await codeai.実行("こんにちは、現在の時刻を教えてください。")
        print(f"シンプル実行結果: {result}")

        # 追加プロンプト：AI に作業をやらせる
        time.sleep(3)
        result2 = await codeai.実行("temp/hello.txt というファイルを作成して、Hello World と書いて。")
        print(f"作業実行結果: {result2}")

    except Exception as e:
        print(f"シンプルテストエラー: {e}")
        import traceback
        traceback.print_exc()
    finally:
        await codeai.終了()

    print("=" * 30)
    print("シンプルテスト完了")
    print("=" * 30)


if __name__ == "__main__":

    # プロバイダーとモデルの設定
    #AI_NAME, AI_MODEL = "claude_cli", "auto"
    #AI_NAME, AI_MODEL = "copilot_cli", "auto"
    #AI_NAME, AI_MODEL = "antigravity_cli", "auto"
    AI_NAME, AI_MODEL = "codex_cli", "auto"

    print("履歴テスト")
    asyncio.run(session_test(AI_NAME=AI_NAME, AI_MODEL=AI_MODEL))

    print("\nシンプルテスト")
    asyncio.run(simple_test(AI_NAME=AI_NAME, AI_MODEL=AI_MODEL))
