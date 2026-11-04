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
from AIコア.AI実行オプション import 既定実行オプション, 会話継続適用
from log_config import get_logger
logger = get_logger(__name__)

import os
import time
import json
import asyncio
import queue
import base64
import mimetypes
from typing import Optional
from pathlib import Path

# api ライブラリ
import openai

_DEFAULT_OLLAMA_HOST = "http://127.0.0.1:11434"
_OLLAMA_CLOUD_BASE_URL = "https://ollama.com/v1"
_OLLAMA_CLOUD_SUFFIXES = (":cloud", ":clude")


def _is_cloud_key(api_key: str) -> bool:
    """Ollama Cloud用APIキーが設定されているか判定する。"""
    if not isinstance(api_key, str):
        return False
    s = api_key.strip()
    return bool(s) and not s.startswith("<") and s.lower() != "ollama"


def _strip_cloud_suffix(model: str) -> str:
    """Ollama Cloud直叩き時はローカル転送用サフィックスを外す。"""
    if not isinstance(model, str):
        return model
    model_name = model.strip()
    lower_name = model_name.lower()
    for suffix in _OLLAMA_CLOUD_SUFFIXES:
        if lower_name.endswith(suffix):
            return model_name[: -len(suffix)]
    return model_name


class ChatAI:
    """
    Ollama Chat api統合クラス（OpenAI互換API使用・APIキー不要）
    """

    def __init__(self, 親=None, セッションID: str = "", チャンネル: int = 0, 絶対パス: str = None,
                 AI_NAME: str = "ollama", AI_MODEL: str = "mistral-large-3:675b:cloud",
                 api_key: str = None, system_instruction: str = None, 実行オプション=None):
        """初期化"""

        # 実行オプション（会話継続・履歴保存・ストリーム送信・出力ファイル保存）
        self.実行オプション = 実行オプション or 既定実行オプション

        # セッションID・チャンネル
        self.セッションID = セッションID
        self.チャンネル = チャンネル

        # 親参照（セッションマネージャー）
        self.parent_manager = 親
        self.親 = 親

        # Ollama ホスト・APIキー取得
        self.ollama_host = _DEFAULT_OLLAMA_HOST
        self.ollama_key_id = "ollama"  # デフォルト（ダミーキー）
        self.ollama_cloud_enabled = False
        try:
            key = api_key or ""
            if 親 and hasattr(親, "conf") and 親.conf and hasattr(親.conf, "json"):
                host = 親.conf.json.get("ollama_host", "")
                if host and isinstance(host, str) and not host.startswith("<"):
                    self.ollama_host = host.rstrip("/")
                key = 親.conf.json.get("ollama_key_id", "") or key
            if _is_cloud_key(key):
                self.ollama_key_id = key.strip()
                self.ollama_cloud_enabled = True
        except Exception:
            pass

        # モデル設定
        self.chat_ai = AI_NAME
        self.chat_model = _strip_cloud_suffix(AI_MODEL) if self.ollama_cloud_enabled else AI_MODEL
        self.system_instruction = (
            system_instruction.strip()
            if isinstance(system_instruction, str) and system_instruction.strip()
            else None
        )

        # 作業ディレクトリ設定
        if 絶対パス and isinstance(絶対パス, str):
            work_dir = Path(絶対パス)
        else:
            work_dir = Path.cwd()

        self.cwd_str = str(work_dir.resolve())

        # apiクライアント
        self.client = None

        # 生成パラメータ
        self.temperature = 0.8
        self.max_wait_sec = 120

        # 履歴管理システム(ローカル保管)
        self.履歴最終番号 = 0
        self.履歴最終時刻 = time.time()
        self.履歴辞書 = {}
        self.last_output_files = []
        self.last_tool_calls = []

        # 生存状態管理
        self.is_alive = False

    async def 開始(self):
        """ChatAI開始（apiクライアント初期化）"""
        try:
            base_url = _OLLAMA_CLOUD_BASE_URL if self.ollama_cloud_enabled else f"{self.ollama_host}/v1"
            api_key = self.ollama_key_id if self.ollama_cloud_enabled else "ollama"
            try:
                self.client = openai.OpenAI(
                    api_key=api_key,
                    base_url=base_url,
                )
                self.is_alive = True
                mode = "cloud" if self.ollama_cloud_enabled else "local"
                logger.info(f"ChatAI(Ollama): 初期化完了 mode={mode} base_url={base_url} model={self.chat_model}")
                return True
            except Exception as e:
                logger.error(f"ChatAI(Ollama): apiクライアント初期化エラー: {e}")
                return False

        except Exception as e:
            logger.error(f"ChatAI(Ollama)開始エラー: {e}")
            self.is_alive = False
            return False

    async def 終了(self):
        """ChatAI終了"""
        try:
            self.is_alive = False
            self.client = None
            return True
        except Exception as e:
            logger.error(f"ChatAI(Ollama)終了エラー: {e}")
            return False

    async def 実行(self, 要求テキスト: str, テキスト受信処理Ｑ=None, タイムアウト秒数: int = 120,
                   システムプロンプト: str = None, file_path: str = None,
                   completions_tools: dict = None, 自己ループ: bool = False,
                   max_turns: int = 8) -> str:
        """
        ChatAI実行（Ollama経由でテキスト生成）

        completions_tools: OpenAI completions の追加パラメータ（例: {"tools": [...], "tool_choice": "auto"}）。
                           空 or None のときは何も付与せず、従来挙動と完全に同一。
        """
        # 会話継続が無効なら、前回の実行で残った履歴を引き継がない。
        会話継続適用(self, completions_tools)
        try:
            if not self.is_alive:
                logger.warning("ChatAI(Ollama)実行: ChatAIが開始されていません")
                return "! Ollama ChatAIが停止状態です。Ollamaが起動しているか確認してください。"

            # 自己ループ（aidiy_chat_llms）: 自前 MCP 群をツールとして使い、
            # tool_calls をサーバー側で実行しながら応答が確定するまで回す。
            # completions（自己ループ=False）はここを通らずシングルアクションのまま。
            if 自己ループ:
                try:
                    from AIコア.AI内部ツール import MCPツールブリッジ, 自己ループ実行
                except ImportError:
                    from AI内部ツール import MCPツールブリッジ, 自己ループ実行
                ブリッジ = MCPツールブリッジ()
                tools, name_map = ブリッジ.collect_tools()
                if tools:
                    # 会話履歴を引き継いだ上で自己ループへ渡す。
                    # 先頭（system + 過去履歴）が毎ターン同一になり、プロンプトキャッシュが効く。
                    self._履歴追加(role="user", text=要求テキスト)
                    msgs = self._メッセージ履歴構築(システムプロンプト=システムプロンプト)
                    結果 = await 自己ループ実行(
                        self, msgs, ブリッジ, tools, name_map, max_turns, タイムアウト秒数
                    )
                    self.last_tool_trace = 結果["tool_trace"]
                    self.last_tool_turns = 結果["turns"]
                    self.last_tool_stopped = 結果["stopped"]
                    self._履歴追加(role="assistant", text=結果["content"] or "!")
                    return 応答正規化(結果["content"])
                # tools 無し（8095 未起動等）→ 通常処理にフォールバック

            # ファイル添付処理（画像のみ対応、Ollamaのvision対応モデルの場合）
            image_data = None
            if file_path:
                try:
                    if os.path.isfile(file_path):
                        mime_type, _ = mimetypes.guess_type(file_path)
                        if mime_type and mime_type.startswith("image/"):
                            with open(file_path, "rb") as f:
                                image_bytes = f.read()
                                image_base64 = base64.b64encode(image_bytes).decode("utf-8")
                                image_data = {"mime_type": mime_type, "data": image_base64}
                            logger.info(f"ChatAI(Ollama): 画像ファイルを添付 {file_path}")
                except Exception as e:
                    logger.error(f"ChatAI(Ollama): ファイル添付エラー {e}")

            output_files = []
            self.last_output_files = output_files
            self.last_tool_calls = []

            タイムアウトフラグ = asyncio.Event()

            async def タイムアウト監視():
                try:
                    await asyncio.sleep(タイムアウト秒数)
                    タイムアウトフラグ.set()
                    logger.warning(f"ChatAI(Ollama)実行タイムアウト: {タイムアウト秒数}秒")
                except asyncio.CancelledError:
                    pass

            タイムアウトタスク = asyncio.create_task(タイムアウト監視())

            # 自己ループから completions_tools["messages"] を渡された呼び出しは
            # そちらが会話の実体。ここで履歴を触ると空 user が溜まり先頭が崩れる。
            外部メッセージ = bool(completions_tools and completions_tools.get("messages"))

            try:
                if 外部メッセージ:
                    メッセージ履歴 = completions_tools["messages"]
                else:
                    self._履歴追加(role="user", text=要求テキスト, image_data=image_data)
                    メッセージ履歴 = self._メッセージ履歴構築(システムプロンプト=システムプロンプト)

                応答テキスト = await asyncio.get_event_loop().run_in_executor(
                    None,
                    lambda: self._同期実行(
                        メッセージ履歴=メッセージ履歴,
                        テキスト受信処理Ｑ=テキスト受信処理Ｑ,
                        タイムアウトフラグ=タイムアウトフラグ,
                        output_files=output_files,
                        completions_tools=completions_tools,
                    ),
                )

                タイムアウトタスク.cancel()
                if タイムアウトフラグ.is_set():
                    応答テキスト = エラー応答(f"処理タイムアウト({タイムアウト秒数}秒)が発生しました。")
                final_result = 応答正規化(応答テキスト)
                # 自己ループ中は呼び出し元がまとめて記録する
                if not 外部メッセージ:
                    self._履歴追加(role="assistant", text=final_result)

                if final_result == "!" and テキスト受信処理Ｑ:
                    try:
                        data = {"type": "stream", "content": "!", "timestamp": time.time()}
                        テキスト受信処理Ｑ.put_nowait({"text": "!", "json": json.dumps(data, ensure_ascii=False)})
                    except Exception:
                        pass

                return final_result

            except asyncio.CancelledError:
                logger.warning("ChatAI(Ollama)実行がキャンセルされました")
                return "! 処理がキャンセルされました。"
            except Exception as e:
                logger.error(f"ChatAI(Ollama)実行エラー: {e}")
                エラーメッセージ = f"! 実行エラー: {str(e)}"
                if テキスト受信処理Ｑ:
                    data = {"type": "error", "content": "!!! 処理エラー !!!", "timestamp": time.time()}
                    テキスト受信処理Ｑ.put_nowait({"text": "!!! 処理エラー !!!", "json": json.dumps(data, ensure_ascii=False)})
                return エラーメッセージ
            finally:
                タイムアウトタスク.cancel()

        except Exception as e:
            セッションID_str = self.セッションID[:10] + "..." if self.セッションID else "不明"
            logger.error(f"ChatAI(Ollama)実行エラー: {e} 要求=[{要求テキスト[:10]}...] セッション={セッションID_str}")
            エラーメッセージ = f"! 実行エラー: {str(e)}"
            if テキスト受信処理Ｑ:
                data = {"type": "error", "content": "!!! 処理エラー !!!", "timestamp": time.time()}
                テキスト受信処理Ｑ.put_nowait({"text": "!!! 処理エラー !!!", "json": json.dumps(data, ensure_ascii=False)})
            return エラーメッセージ

    def _同期実行(self, メッセージ履歴: list,
                   テキスト受信処理Ｑ: queue.Queue = None,
                   タイムアウトフラグ: asyncio.Event = None,
                   output_files: list = None,
                   completions_tools: dict = None) -> str:
        """同期API実行（スレッドプールで実行）"""
        try:
            parm_kwargs = {
                "model": self.chat_model,
                "messages": メッセージ履歴,
                "temperature": float(self.temperature),
                "timeout": self.max_wait_sec,
                "stream": False,
            }

            # tools が実際に指定（非空）されているときのみ tools などの追加パラメータをマージ。
            # tools=[] / {} / None は「渡されていない」扱いで通常生成（従来挙動と同一・gemini と整合）。
            if completions_tools and completions_tools.get("tools"):
                parm_kwargs.update(completions_tools)

            response = self.client.chat.completions.create(**parm_kwargs)

            応答テキスト = ""
            if response and response.choices:
                message = response.choices[0].message
                # tool_calls を捕捉（completions_tools 指定時のみ発生。空なら従来通り）
                tc = getattr(message, "tool_calls", None)
                if tc:
                    self.last_tool_calls = [
                        {
                            "id": getattr(c, "id", None),
                            "type": getattr(c, "type", "function") or "function",
                            "function": {
                                "name": c.function.name,
                                "arguments": c.function.arguments,
                            },
                        }
                        for c in tc
                    ]
                message_content = message.content
                if isinstance(message_content, list):
                    for part in message_content:
                        if hasattr(part, "type") and part.type == "text":
                            応答テキスト += part.text
                else:
                    応答テキスト = str(message_content) if message_content else ""

            if テキスト受信処理Ｑ and 応答テキスト:
                try:
                    data = {"type": "stream", "content": 応答テキスト, "timestamp": time.time()}
                    テキスト受信処理Ｑ.put_nowait({"text": 応答テキスト, "json": json.dumps(data, ensure_ascii=False)})
                except Exception:
                    pass

            return 応答テキスト

        except Exception as e:
            logger.error(f"ChatAI(Ollama)同期実行エラー: {e}")
            return エラー応答(e)

    def _メッセージ履歴構築(self, システムプロンプト: str = None) -> list:
        """Ollama/OpenAI形式のメッセージ履歴を構築"""
        メッセージ = []
        system_prompt_text = None
        if isinstance(システムプロンプト, str) and システムプロンプト.strip():
            system_prompt_text = システムプロンプト.strip()
        elif self.system_instruction:
            system_prompt_text = self.system_instruction
        else:
            system_prompt_text = "あなたは、美しい日本語を話す、賢いAIアシスタントです。"

        メッセージ.append({
            "role": "system",
            "content": [{"type": "text", "text": system_prompt_text}],
        })

        履歴 = self._履歴取得()
        for item in 履歴:
            if item.get("image_data"):
                image_data = item["image_data"]
                メッセージ.append({
                    "role": item["role"],
                    "content": [
                        {"type": "text", "text": item["text"]},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:{image_data['mime_type']};base64,{image_data['data']}"
                            },
                        },
                    ],
                })
            else:
                メッセージ.append({
                    "role": item["role"],
                    "content": [{"type": "text", "text": item["text"]}],
                })

        return メッセージ

    def _履歴追加(self, role: str, text: str, image_data: dict = None):
        """履歴にメッセージを追加"""
        self.履歴最終番号 += 1
        self.履歴最終時刻 = time.time()
        self.履歴辞書[self.履歴最終番号] = {
            "role": role,
            "text": text,
            "image_data": image_data,
            "time": self.履歴最終時刻,
        }

    def _履歴取得(self) -> list:
        """履歴を時系列順に取得"""
        return [
            {
                "role": self.履歴辞書[番号]["role"],
                "text": self.履歴辞書[番号]["text"],
                "image_data": self.履歴辞書[番号].get("image_data"),
            }
            for 番号 in sorted(self.履歴辞書.keys())
        ]

    def 履歴クリア(self):
        """履歴をクリア"""
        self.履歴辞書 = {}
        self.履歴最終番号 = 0
        self.履歴最終時刻 = time.time()
