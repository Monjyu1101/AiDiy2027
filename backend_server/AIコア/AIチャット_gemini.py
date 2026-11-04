#!/usr/bin/env python
# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

from AIコア.AI応答 import 応答正規化
from AIコア.AI実行オプション import 既定実行オプション, 実行オプション取得, 会話継続適用
from log_config import get_logger
logger = get_logger(__name__)

import os
import time
import datetime
import threading
import json
import base64
import asyncio
import queue
from typing import Optional, Dict, Any
from pathlib import Path

# api ライブラリ
from google import genai
from google.genai import types


class ChatAI:
    """
    Gemini Chat api統合クラス（履歴管理 + テキストチャット実装）
    """

    def __init__(self, 親=None, セッションID: str = "", チャンネル: int = 0, 絶対パス: str = None,
                 AI_NAME: str = "gemini", AI_MODEL: str = "gemini-2.5-flash",
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

        # apiキー設定（gemini/freeai相互補完）
        self.api_key = api_key
        if not self.api_key or self.api_key[:1] == '<':
            # 親マネージャーからキーを取得
            if 親 and hasattr(親, 'conf') and 親.conf:
                gemini_key = 親.conf.json.gemini_key_id
                freeai_key = 親.conf.json.freeai_key_id

                # 相互補完ロジック
                if AI_NAME.lower() == "gemini_chat":
                    # gemini選択時: gemini_key → freeai_key
                    if gemini_key and not gemini_key.startswith('<'):
                        self.api_key = gemini_key
                    elif freeai_key and not freeai_key.startswith('<'):
                        self.api_key = freeai_key
                        logger.info("ChatAI(gemini): gemini_keyが未設定のため、freeai_keyを使用します")
                    else:
                        logger.warning("ChatAI(gemini): gemini_key・freeai_keyともに未設定です")
                elif AI_NAME.lower() == "freeai_chat":
                    # freeai選択時: freeai_key → gemini_key
                    if freeai_key and not freeai_key.startswith('<'):
                        self.api_key = freeai_key
                    elif gemini_key and not gemini_key.startswith('<'):
                        self.api_key = gemini_key
                        logger.info("ChatAI(freeai): freeai_keyが未設定のため、gemini_keyを使用します")
                    else:
                        logger.warning("ChatAI(freeai): freeai_key・gemini_keyともに未設定です")

            # APIキー未設定チェック
            if not self.api_key or self.api_key[:1] == '<':
                self.api_key = None
                logger.error("ChatAI: apiキーが未設定です")

        # モデル設定
        self.chat_ai = AI_NAME
        self.chat_model = AI_MODEL
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
        # logger.info(f"作業ディレクトリ設定: {self.cwd_str}")
        pass

        # apiクライアント
        self.client = None

        # 生成パラメータ
        self.temperature = 0.8

        # セーフティ設定
        self.safety_settings = [
            {"category": "HARM_CATEGORY_DANGEROUS", "threshold": "BLOCK_NONE"},
            {"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE"},
            {"category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE"},
            {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE"},
            {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE"},
        ]

        # 履歴管理システム(ローカル保管)
        self.履歴最終番号 = 0
        self.履歴最終時刻 = time.time()
        self.履歴辞書 = {}
        self.last_output_files = []
        self.last_tool_calls = []

        # 生存状態管理
        self.is_alive = False

        # logger.info(f"初期化:完了 (Gemini Chat api設定済み, 履歴管理有効)")
        pass

    async def 開始(self):
        """ChatAI開始（apiクライアント初期化）"""
        try:
            # パラメータで渡されたapiキー・モデル名を優先使用（親からの再取得は不要）
            # 初期化時にすでに設定済み

            # apiクライアント初期化
            if not self.api_key or self.api_key[:1] == '<':
                logger.error("ChatAI: apiキーが設定されていません")
                return False

            try:
                # SSL・HTTPクライアントの初期化中も ping・中止を処理できるようにする。
                self.client = await asyncio.to_thread(genai.Client, api_key=self.api_key)
                self.is_alive = True
                # logger.info("ChatAI: apiクライアント初期化完了")
                pass
                return True
            except Exception as e:
                logger.error(f"ChatAI: apiクライアント初期化エラー: {e}")
                return False

        except Exception as e:
            logger.error(f"ChatAI開始:エラー {e}")
            self.is_alive = False
            return False

    async def 終了(self):
        """ChatAI終了"""
        try:
            self.is_alive = False
            self.client = None
            # logger.info(f"ChatAI: 終了完了 セッションID={self.セッションID[:8]}")
            pass
        except Exception as e:
            logger.error(f"ChatAI終了:エラー {e}")
            self.is_alive = False

    def 履歴クリア(self):
        """履歴をクリア"""
        self.履歴辞書 = {}
        self.履歴最終番号 = 0
        self.履歴最終時刻 = time.time()

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

        # logger.debug(f"履歴追加: {key} ({type}) - {text[:50]}...")
        pass

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
            elif item["type"] == "assistant":
                履歴テキスト += f"```assistant\n{item['text']}\n```\n"

        return 履歴テキスト

    def _メッセージ履歴構築(self) -> str:
        """Gemini api用のメッセージ履歴を構築"""
        if not self.履歴辞書:
            return ""

        # 番号順にソートして履歴を構築
        sorted_keys = sorted(self.履歴辞書.keys(), key=lambda x: int(x))

        messages = []
        for key in sorted_keys:
            item = self.履歴辞書[key]
            if item["type"] == "system":
                # システムメッセージは最初に追加
                messages.insert(0, f"[System]: {item['text']}")
            elif item["type"] == "user":
                messages.append(f"[User]: {item['text']}")
            elif item["type"] == "assistant":
                messages.append(f"[Assistant]: {item['text']}")

        return "\n\n".join(messages)

    def _自己ループメッセージ構築(self) -> list:
        """自己ループ用に履歴辞書を OpenAI messages 形式へ変換する（system が先頭）"""
        messages = []
        for key in sorted(self.履歴辞書.keys(), key=lambda x: int(x)):
            item = self.履歴辞書[key]
            role = item["type"]
            if role not in ("system", "user", "assistant"):
                continue
            messages.append({"role": role, "content": item["text"]})
        return messages

    def _画像生成モデル(self) -> bool:
        """画像生成モデルは function calling に対応しない。"""
        モデル名 = str(self.chat_model).lower()
        return "-image" in モデル名 or "nano-banana" in モデル名

    async def 実行(self, 要求テキスト: str, テキスト受信処理Ｑ=None, タイムアウト秒数: int = 120,
                   システムプロンプト: str = None, file_path: str = None,
                   completions_tools: dict = None, 自己ループ: bool = False,
                   max_turns: int = 8) -> str:
        """
        Gemini Chat api実行

        Args:
            要求テキスト: ユーザーの要求テキスト
            テキスト受信処理Ｑ: ストリーミング用キュー
            タイムアウト秒数: タイムアウト時間
            システムプロンプト: システムプロンプト
            file_path: 添付ファイルの絶対パス（オプション）
            completions_tools: OpenAI completions 形式の tools 追加パラメータ
                               （例: {"tools": [...], "tool_choice": ..., "messages": [...]}）。
                               tools を含む場合は Gemini function calling に変換して実行する。
                               空 or None のときは従来のテキスト生成（挙動は不変）。
        """
        # 会話継続が無効なら、前回の実行で残った履歴を引き継がない。
        会話継続適用(self, completions_tools)
        self.last_completion_succeeded = False
        completion_succeeded = False
        try:
            # 生存状態チェック
            if not self.is_alive:
                logger.warning("ChatAI実行:ChatAIが開始されていません")
                return "! ChatAIが停止状態です。APIキーの設定を確認、再起動してください。"

            # 自己ループ（aidiy_chat_llms）: 自前 MCP 群をツールとして使い、
            # tool_calls をサーバー側で実行しながら応答が確定するまで回す。
            # completions（自己ループ=False）はここを通らずシングルアクションのまま。
            if 自己ループ and not self._画像生成モデル():
                try:
                    from AIコア.AI内部ツール import MCPツールブリッジ, 自己ループ実行
                except ImportError:
                    from AI内部ツール import MCPツールブリッジ, 自己ループ実行
                ブリッジ = MCPツールブリッジ()
                tools, name_map = ブリッジ.collect_tools()
                if tools:
                    # 会話履歴を引き継いだ上で自己ループへ渡す。
                    # 先頭（system + 過去履歴）が毎ターン同一になり、暗黙キャッシュが効く。
                    sys_text = システムプロンプト or getattr(self, "system_instruction", None)
                    if len(self.履歴辞書) == 0 and sys_text:
                        self._履歴追加(sys_text, "system")
                    self._履歴追加(要求テキスト, "user")
                    msgs = self._自己ループメッセージ構築()
                    結果 = await 自己ループ実行(
                        self, msgs, ブリッジ, tools, name_map, max_turns, タイムアウト秒数
                    )
                    self.last_tool_trace = 結果["tool_trace"]
                    self.last_tool_turns = 結果["turns"]
                    self.last_tool_stopped = 結果["stopped"]
                    self._履歴追加(結果["content"] or "!", "assistant")
                    return 応答正規化(結果["content"])
                # tools 無し（8095 未起動等）→ 通常処理にフォールバック

            # tools 指定時は function calling 経路へ（従来のテキスト生成には影響しない）
            self.last_tool_calls = []
            if completions_tools and completions_tools.get("tools"):
                return await self._実行_function_calling(completions_tools, タイムアウト秒数)

            # デフォルトシステムプロンプト
            if not システムプロンプト:
                if self.system_instruction:
                    システムプロンプト = self.system_instruction
                else:
                    システムプロンプト = "あなたは、美しい日本語を話す、賢いAIアシスタントです。"

            # 履歴管理
            if len(self.履歴辞書) == 0:
                self._履歴追加(システムプロンプト, "system")
            self._履歴追加(要求テキスト, "user")

            result_text = ""
            output_files = []  # 出力ファイルリスト
            self.last_output_files = output_files
            last_stream_time = time.time()

            # メッセージ履歴を構築
            msg_text = self._メッセージ履歴構築()

            # パラメータ設定
            generation_config = types.GenerateContentConfig(
                temperature=float(self.temperature),
                top_p=0.95,
                top_k=32,
                max_output_tokens=8192,
                **(
                    {"response_modalities": ["TEXT", "IMAGE"]}
                    if self._画像生成モデル()
                    else {"response_mime_type": "text/plain"}
                ),
            )

            # リクエスト作成
            request = []
            parts = []
            parts.append(types.Part.from_text(text=msg_text))

            # ファイル添付がある場合
            if file_path:
                try:
                    import os
                    import mimetypes
                    from pathlib import Path

                    if os.path.exists(file_path):
                        # mime_typeを判定
                        mime_type, _ = mimetypes.guess_type(file_path)

                        # 画像ファイルの場合
                        if mime_type and mime_type.startswith('image/'):
                            with open(file_path, 'rb') as f:
                                image_bytes = f.read()

                            # 画像をpartsに追加
                            parts.append(types.Part.from_bytes(
                                data=image_bytes,
                                mime_type=mime_type
                            ))
                            logger.info(f"ChatAI: 画像ファイルを添付 {file_path} ({mime_type})")
                        else:
                            # 画像以外のファイル（将来対応）
                            logger.warning(f"ChatAI: 画像以外のファイル形式は未対応 {file_path} ({mime_type})")
                    else:
                        logger.warning(f"ChatAI: 添付ファイルが見つかりません {file_path}")
                except Exception as e:
                    logger.error(f"ChatAI: ファイル添付エラー {e}")

            request.append(types.Content(role="user", parts=parts))

            # api実行（タイムアウト監視付き）
            try:
                async def _chat_execution():
                    nonlocal result_text, output_files, last_stream_time

                    # api実行（ストリーミングなし）
                    response = await asyncio.to_thread(
                        self.client.models.generate_content,
                        model=self.chat_model,
                        contents=request,
                        config=generation_config,
                    )

                    last_stream_time = time.time()

                    # レスポンス処理
                    content_text = ''
                    for p in range(len(response.candidates[0].content.parts)):
                        # テキスト部分
                        chunk_text = response.candidates[0].content.parts[p].text
                        if chunk_text is not None:
                            if chunk_text.strip() != '':
                                if テキスト受信処理Ｑ:
                                    data = {"type": "stream", "content": chunk_text, "timestamp": time.time()}
                                    テキスト受信処理Ｑ.put_nowait({"text": chunk_text, "json": json.dumps(data, ensure_ascii=False)})

                                if content_text != '':
                                    content_text += '\n'
                                content_text += chunk_text
                        # インラインデータ（画像など）
                        else:
                            inline_data = response.candidates[0].content.parts[p].inline_data
                            if inline_data is not None and 実行オプション取得(self).出力ファイル保存:
                                data_bytes = inline_data.data
                                mime_type = inline_data.mime_type
                                try:
                                    # 出力ディレクトリ作成
                                    import os
                                    from pathlib import Path
                                    base_path = Path(self.cwd_str)
                                    output_dir = base_path / "temp" / "output"
                                    output_dir.mkdir(parents=True, exist_ok=True)

                                    # ファイル名生成（タイムスタンプ付き）
                                    nowTime = datetime.datetime.now()
                                    # 拡張子をMIMEタイプから判定
                                    ext = 'png'
                                    if 'jpeg' in mime_type or 'jpg' in mime_type:
                                        ext = 'jpg'
                                    elif 'gif' in mime_type:
                                        ext = 'gif'
                                    elif 'webp' in mime_type:
                                        ext = 'webp'

                                    file_name = nowTime.strftime('%Y%m%d.%H%M%S') + f'.image.{ext}'
                                    output_path = output_dir / file_name

                                    # ファイルに書き込み
                                    with open(output_path, 'wb') as f:
                                        f.write(data_bytes)

                                    output_files.append(str(output_path))
                                    logger.info(f"ChatAI: 出力ファイルを保存 {output_path} ({mime_type})")

                                    # テキストにファイルパス情報を追加
                                    if content_text != '':
                                        content_text += '\n'
                                    表示パス = None
                                    try:
                                        base_path = Path(self.cwd_str).resolve()
                                        表示パス = str(Path(output_path).resolve().relative_to(base_path))
                                    except Exception:
                                        表示パス = str(output_path)
                                    content_text += f"[画像ファイル: {表示パス}]"

                                except Exception as e:
                                    logger.error(f"ChatAI: 出力ファイル保存エラー {e}")

                    result_text = content_text

                # タイムアウト監視
                async def _timeout_monitor():
                    while True:
                        await asyncio.sleep(1)
                        if time.time() - last_stream_time > タイムアウト秒数:
                            raise asyncio.TimeoutError(f"タイムアウト({タイムアウト秒数}秒)")

                # 実行とタイムアウト監視を並行実行
                monitor_task = asyncio.create_task(_timeout_monitor())
                execution_task = asyncio.create_task(_chat_execution())

                try:
                    done, _ = await asyncio.wait([execution_task, monitor_task], return_when=asyncio.FIRST_COMPLETED)
                    if execution_task in done:
                        execution_task.result()
                        completion_succeeded = True
                    else:
                        raise asyncio.TimeoutError(f"タイムアウト({タイムアウト秒数}秒)")
                finally:
                    # 外側のキャンセル時も子タスクを残さず、例外を呼出し元のログ文脈内で回収する。
                    for task in (execution_task, monitor_task):
                        if not task.done():
                            task.cancel()
                    await asyncio.gather(execution_task, monitor_task, return_exceptions=True)

            except asyncio.TimeoutError:
                logger.warning(f"api タイムアウト ({タイムアウト秒数}秒)")
                result_text = f"! 処理タイムアウト({タイムアウト秒数}秒)が発生しました。"

                if テキスト受信処理Ｑ:
                    data = {"type": "timeout", "content": "!!! 処理タイムアウト !!!", "timestamp": time.time()}
                    テキスト受信処理Ｑ.put_nowait({"text": "!!! 処理タイムアウト !!!", "json": json.dumps(data, ensure_ascii=False)})

            except Exception as api_error:
                logger.exception(f"ChatAI api エラー: {api_error}")
                result_text = f"! api実行エラー: {str(api_error)}"

                if テキスト受信処理Ｑ:
                    data = {"type": "error", "content": "!!! 処理エラー !!!", "timestamp": time.time()}
                    テキスト受信処理Ｑ.put_nowait({"text": "!!! 処理エラー !!!", "json": json.dumps(data, ensure_ascii=False)})

            # 履歴に結果を追加
            final_result = 応答正規化(result_text)
            self._履歴追加(final_result, "assistant")

            # 返却文字が"!"の場合はクライアントにもエラーマーカーを送る
            if final_result == "!" and テキスト受信処理Ｑ:
                try:
                    data = {"type": "stream", "content": "!", "timestamp": time.time()}
                    テキスト受信処理Ｑ.put_nowait({"text": "!", "json": json.dumps(data, ensure_ascii=False)})
                except Exception:
                    pass

            # 出力ファイルログ
            if output_files:
                logger.info(f"出力ファイル: {len(output_files)}件")
                for output_file in output_files:
                    logger.info(f"  - {output_file}")

            self.last_completion_succeeded = completion_succeeded and bool(result_text.strip()) and (final_result != "!" or result_text.strip() == "!")
            return final_result

        except Exception as e:
            # ツールエラーログ（必須）
            セッションID_str = self.セッションID[:10] + '...' if self.セッションID else '不明'
            logger.exception(
                f"ChatAI実行エラー: {e} 要求=[{要求テキスト[:10]}...] AI={self.chat_ai} モデル={self.chat_model} セッション={セッションID_str}"
            )
            エラーメッセージ = f"! 実行エラー: {str(e)}"

            if テキスト受信処理Ｑ:
                data = {"type": "error", "content": "!!! 処理エラー !!!", "timestamp": time.time()}
                テキスト受信処理Ｑ.put_nowait({"text": "!!! 処理エラー !!!", "json": json.dumps(data, ensure_ascii=False)})

            return エラーメッセージ

    # ------------------------------------------------------------------ #
    # Function calling（OpenAI completions tools → Gemini 変換）
    # ------------------------------------------------------------------ #

    @staticmethod
    def _content_text_images(content) -> tuple:
        """OpenAI content（文字列 or パーツ配列）から (テキスト, [画像URL]) を抽出する"""
        if content is None:
            return "", []
        if isinstance(content, str):
            return content, []
        if not isinstance(content, list):
            return str(content), []
        texts, images = [], []
        for part in content:
            if isinstance(part, dict):
                ptype = part.get("type")
                if ptype in (None, "text") and "text" in part:
                    texts.append(str(part.get("text", "")))
                elif ptype == "image_url":
                    iu = part.get("image_url")
                    url = iu.get("url") if isinstance(iu, dict) else iu
                    if url:
                        images.append(str(url))
            else:
                texts.append(str(part))
        return "\n".join(t for t in texts if t), images

    @staticmethod
    def _decode_image_bytes(url: str):
        """data: URL を (bytes, mime_type) に変換する。data: 以外は None。"""
        import base64  # noqa: PLC0415
        try:
            if isinstance(url, str) and url.startswith("data:"):
                header, b64 = url.split(",", 1)
                mime = header[5:].split(";")[0].strip() or "image/png"
                return base64.b64decode(b64), mime
        except Exception:
            return None
        return None

    @staticmethod
    def _as_response_dict(text: str) -> dict:
        """tool 結果テキストを Gemini function_response 用の dict に整える"""
        try:
            v = json.loads(text)
            return v if isinstance(v, dict) else {"result": v}
        except Exception:
            return {"result": text}

    def _tool_choice_to_config(self, tool_choice):
        """OpenAI tool_choice を Gemini ToolConfig に変換する"""
        Mode = types.FunctionCallingConfigMode
        mode, allowed = Mode.AUTO, None
        if tool_choice in (None, "auto"):
            mode = Mode.AUTO
        elif tool_choice == "required":
            mode = Mode.ANY
        elif tool_choice == "none":
            mode = Mode.NONE
        elif isinstance(tool_choice, dict):
            name = (tool_choice.get("function") or {}).get("name")
            mode = Mode.ANY
            allowed = [name] if name else None
        fcc = types.FunctionCallingConfig(mode=mode, allowed_function_names=allowed)
        return types.ToolConfig(function_calling_config=fcc)

    @staticmethod
    def _thought_signature_to_text(signature) -> Optional[str]:
        """Gemini の opaque な thought_signature を JSON 安全な文字列へ変換する。"""
        if not signature:
            return None
        if isinstance(signature, str):
            return signature
        try:
            return base64.b64encode(bytes(signature)).decode("ascii")
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _thought_signature_from_text(signature) -> Optional[bytes]:
        """tool_calls に保持した thought_signature を Gemini SDK の bytes へ戻す。"""
        if not signature:
            return None
        if isinstance(signature, bytes):
            return signature
        if not isinstance(signature, str):
            return None
        try:
            return base64.b64decode(signature, validate=True)
        except (ValueError, TypeError):
            return None

    def _function_call_part_to_tool_call(self, part, call_id: str) -> Optional[dict]:
        """Gemini の function_call Part を署名ごと OpenAI 互換形式へ変換する。"""
        fc = getattr(part, "function_call", None)
        if fc is None:
            return None
        args = dict(getattr(fc, "args", None) or {})
        tool_call = {
            "id": getattr(fc, "id", None) or call_id,
            "type": "function",
            "function": {
                "name": getattr(fc, "name", ""),
                "arguments": json.dumps(args, ensure_ascii=False),
            },
        }
        signature = self._thought_signature_to_text(getattr(part, "thought_signature", None))
        if signature:
            # AiDiy 拡張。Gemini の次ターンで同じ functionCall Part に復元する。
            tool_call["thought_signature"] = signature
        return tool_call

    def _messages_to_gemini_contents(self, msgs: list) -> tuple:
        """OpenAI messages を (system_instruction, [types.Content]) に変換する。
        assistant.tool_calls / tool 結果（function_response）のリンクを保持する。"""
        # tool_call_id -> function name の対応表（tool 結果に名前を与えるため）
        id2name = {}
        for m in msgs:
            if isinstance(m, dict) and m.get("role") == "assistant":
                for tc in (m.get("tool_calls") or []):
                    fn = tc.get("function") or {}
                    if tc.get("id") and fn.get("name"):
                        id2name[tc["id"]] = fn["name"]

        system_parts = []
        contents = []
        for m in msgs:
            if not isinstance(m, dict):
                continue
            role = m.get("role", "user")
            content = m.get("content")

            if role == "system":
                txt, _ = self._content_text_images(content)
                if txt:
                    system_parts.append(txt)
                continue

            if role == "tool":
                name = id2name.get(m.get("tool_call_id")) or m.get("name") or "tool"
                txt, _ = self._content_text_images(content)
                contents.append(types.Content(
                    role="user",
                    parts=[types.Part.from_function_response(name=name, response=self._as_response_dict(txt))],
                ))
                continue

            gemini_role = "model" if role in ("assistant", "model") else "user"
            parts = []
            txt, images = self._content_text_images(content)
            if txt:
                parts.append(types.Part.from_text(text=txt))
            for img in images:
                decoded = self._decode_image_bytes(img)
                if decoded:
                    parts.append(types.Part.from_bytes(data=decoded[0], mime_type=decoded[1]))
            if role in ("assistant", "model"):
                for tc in (m.get("tool_calls") or []):
                    fn = tc.get("function") or {}
                    try:
                        args = json.loads(fn.get("arguments") or "{}")
                    except Exception:
                        args = {}
                    if not isinstance(args, dict):
                        args = {}
                    function_call_part = types.Part.from_function_call(
                        name=fn.get("name", ""),
                        args=args,
                    )
                    signature = self._thought_signature_from_text(tc.get("thought_signature"))
                    if signature:
                        function_call_part.thought_signature = signature
                    parts.append(function_call_part)
            if parts:
                contents.append(types.Content(role=gemini_role, parts=parts))

        return "\n".join(system_parts), contents

    async def _実行_function_calling(self, completions_tools: dict, タイムアウト秒数: int) -> str:
        """OpenAI tools を Gemini function calling に変換して実行し、tool_calls を捕捉する"""
        import uuid  # noqa: PLC0415

        openai_tools = completions_tools.get("tools") or []
        tool_choice = completions_tools.get("tool_choice")
        msgs = completions_tools.get("messages") or []

        # 1) tools 変換（OpenAI function → Gemini FunctionDeclaration）
        decls = []
        for t in openai_tools:
            fn = t.get("function") if isinstance(t, dict) else None
            if not fn or not fn.get("name"):
                continue
            decls.append(types.FunctionDeclaration(
                name=fn["name"],
                description=fn.get("description", ""),
                parameters_json_schema=fn.get("parameters") or {"type": "object", "properties": {}},
            ))
        gemini_tools = [types.Tool(function_declarations=decls)] if decls else None

        # 2) messages → contents + system_instruction
        system_text, contents = self._messages_to_gemini_contents(msgs)

        # 3) config（tools / tool_config / 自動実行は無効化して function_call を受け取る）
        config = types.GenerateContentConfig(
            temperature=float(self.temperature),
            max_output_tokens=8192,
            tools=gemini_tools,
            tool_config=self._tool_choice_to_config(tool_choice),
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
            system_instruction=system_text or None,
        )

        # 4) 実行（スレッドプール + タイムアウト）
        def _sync():
            return self.client.models.generate_content(
                model=self.chat_model,
                contents=contents,
                config=config,
            )

        try:
            response = await asyncio.wait_for(
                asyncio.get_event_loop().run_in_executor(None, _sync),
                timeout=タイムアウト秒数,
            )
        except asyncio.TimeoutError:
            logger.warning(f"ChatAI(gemini) function calling タイムアウト ({タイムアウト秒数}秒)")
            return f"! 処理タイムアウト({タイムアウト秒数}秒)が発生しました。"
        except Exception as e:
            logger.exception(f"ChatAI(gemini) function calling エラー: {e}")
            return f"! api実行エラー: {str(e)}"

        # 5) レスポンス解析（text と function_call を分離）
        result_text = ""
        tool_calls = []
        candidates = getattr(response, "candidates", None) or []
        if candidates:
            content = getattr(candidates[0], "content", None)
            parts = getattr(content, "parts", None) or [] if content else []
            for part in parts:
                text = getattr(part, "text", None)
                if text:
                    result_text += text
                tool_call = self._function_call_part_to_tool_call(
                    part,
                    "call_" + uuid.uuid4().hex[:24],
                )
                if tool_call is not None:
                    tool_calls.append(tool_call)

        self.last_tool_calls = tool_calls
        result_text = result_text.strip()
        if tool_calls:
            return result_text  # tool_calls のみのときは空文字（ChatLLM 側で正規化）
        return result_text if result_text else "!"


if __name__ == "__main__":

    print("画像生成テスト実行 (Gemini 画像生成モデル)")

    # 参考: GEMINI_API_KEY の一時値
    # gemini_key_id = "< your gemini api key >"

    async def _main(api_key: str, AI_MODEL: str):
        AI_NAME = "gemini"
        chatai = ChatAI(親=None, セッションID="image_test", AI_NAME=AI_NAME, AI_MODEL=AI_MODEL, api_key=api_key)

        try:
            print(f"モデル: {AI_MODEL}")
            await chatai.開始()

            temp_output_dir = Path(chatai.cwd_str) / "temp" / "output"
            existing_images = set(temp_output_dir.glob("*.image.*")) if temp_output_dir.exists() else set()

            # 1回目: 挨拶
            prompt1 = "おはよう"
            print(f"プロンプト1: {prompt1}")
            result1 = await chatai.実行(prompt1)
            print(f"\n実行結果1: {result1}")

            # 2回目: 猫の画像生成依頼
            prompt2 = "かわいい猫の画像を作って"
            print(f"\nプロンプト2: {prompt2}")
            result2 = await chatai.実行(prompt2)
            print(f"\n実行結果2: {result2}")

            # 生成画像の最新ファイルを取得（新規生成されたもののみ採用）
            latest_image = None
            if temp_output_dir.exists():
                new_images = sorted(
                    [p for p in temp_output_dir.glob("*.image.*") if p not in existing_images],
                    key=lambda p: p.stat().st_mtime,
                    reverse=True
                )
                if new_images:
                    latest_image = new_images[0]

            # 3回目: 添付画像の説明（直前に生成した画像を使用）
            prompt3 = "この画像を説明してください"
            print(f"\nプロンプト3: {prompt3}")
            if latest_image and latest_image.exists():
                print(f"添付画像: {latest_image}")
                result3 = await chatai.実行(prompt3, file_path=str(latest_image))
                print(f"\n実行結果3: {result3}")
            else:
                print("生成画像が見つかりませんでした（temp/output/*.image.* を確認してください）")

        except Exception as e:
            print(f"画像生成テストエラー: {e}")
            import traceback
            traceback.print_exc()
        finally:
            await chatai.終了()

    def _load_config():
        try:
            base_dir = Path(__file__).resolve().parents[2]
            config_path = base_dir / "_config" / "AiDiy_key.json"
            if not config_path.exists():
                print(f"configが見つかりません: {config_path}")
                return {}
            with open(config_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"config読込エラー: {e}")
            return {}

    conf = _load_config()
    AI_MODEL = conf.get("CHAT_GEMINI_MODEL", "gemini-nano-banana-2.1")
    api_key = conf.get("gemini_key_id")

    if not api_key or str(api_key).startswith("<"):
        print("APIキーが設定されていません。_config/AiDiy_key.json を確認してください。")
    else:
        asyncio.run(_main(api_key=api_key, AI_MODEL=AI_MODEL))

