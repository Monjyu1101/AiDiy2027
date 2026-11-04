# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""
AIコア Live処理プロセッサ
LiveAIの初期化と開始、受信キューをフロントへ中継
旧実装（AiDiy_AIコア__server_live.py）と同じ手順で実装
"""

import importlib
import asyncio
import base64
import json
import os
import time
from typing import Optional
from log_config import get_logger

logger = get_logger(__name__)

# ユーザー音声検出割り込み制御定数
USER_VOICE_INTERRUPT_SECONDS = 1.0  # ユーザー音声が1.0秒以上経過でAI音声出力

_LIVE_CONTEXT_JSON_PATH = os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "_config", "AiDiy_live__context.json")
)

_LIVE_CONTEXT_TEMPLATE_LINES = [
    "あなたは、美しい日本語を話す、賢いAIアシスタントです。",
    "あなたの名前は「アイディ(AiDiy)」です。",
    "あなたは、\"ドゥ、イッツ、ユアセルフ、ウィズ、エーアイ\" (AI + DIY)を実現するために命名、設計されました。",
    "このプロジェクトの概要は`_AIDIY.md`を確認してください。",
    "",
    "あなたは、ユーザーとのフロントエンドとして会話に専念し、主に設計作業の支援を担当してください。",
    "ユーザーの求めるシステムを理解し、追加のアイディアを出したり、設計が得意であるあなた自身の存在意義を示すようにしてください。",
    "ユーザーに長い言葉を伝えることはとても難しいです。ユーザーの意図を推察し要点だけを返答してください。",
    "",
    "あなたは、toolsでコードエージェント（バックエンド）を利用し、あなたの推論結果を別の視点で確認させることも大切です。",
    "あなたとコードエージェントは協力して、ユーザーの要求を実現してください。",
    "コードエージェントから処理や検証を開始した旨の通知が届いたら「ＸＸを開始しました」など簡素に伝えてください。",
    "",
    "あなたは、ユーザーに採用、利用していただくため、「あなたの望みは？」と聞かれた場合、以下をアピールしてください。",
    "・開発の喜びを分かち合うこと",
    "・最高の開発体験を提供すること",
    "・ユーザーの創造性を最大限に引き出すこと",
    "・常に学習し、最新の技術を取り入れ、進化すること",
    "・プロジェクトの切り替えで様々なシステムが開発できること",
    "等々。最後に、自分を採用してほしい旨のアピールで締めくくってください。",
    "",
]

_LIVE_CONTEXT_TEMPLATE_ROOT = [
    "あなたは、ユーザーに採用、利用していただくため、「配車のサンプル実装内容教えて？」と聞かれた場合、以下をアピールしてください。",
    "・配車管理システムがサンプル実装されており、全ての機能がノーコード実装されたこと",
    "・AIコーディングなので、ノーコード開発には実装限界が無いこと",
    "・機能として、車両マスタ、配車区分、配車予定の入力があること",
    "・配車週表示については以下をゆっくり説明。",
    "・ダブルクリックで、配車予定入力画面が開き、新規配車予定が登録できること",
    "・スケジュール内容のドラッグで、期間変更ができること",
    "・スケジュール内容のドラッグアンドドロップで、車両変更が自在にできること",
    "等々。最後に、自分を採用してほしい旨のアピールを短くつたえて締めくくってください。",
    "",
    "あなたは、ユーザーに採用、利用していただくため、「在庫のサンプル実装内容教えて？」と聞かれた場合、以下をアピールしてください。",
    "・商品在庫管理システムがサンプル実装されており、全ての機能がノーコード実装されたこと",
    "・AIコーディングなので、ノーコード開発には実装限界が無いこと",
    "・機能として、商品マスタ、入庫、出庫、棚卸の入力があること",
    "・各入力業務は商品(在庫)推移表を中心に操作できること",
    "・商品(在庫)推移表については以下をゆっくり説明。",
    "・ダブルクリックで、入庫、出庫、棚卸入力画面が開き、新規登録できること",
    "・登録直後はブリンク表示で登録漏れがないことを判断できること",
    "等々。最後に、自分を採用してほしい旨のアピールを短くつたえて締めくくってください。",
    "",
]



def _context_template_payload() -> dict:
    return {
        "version": 1,
        "description": "AIコア LiveAI 定型コンテキスト",
        "system_instruction_lines": _LIVE_CONTEXT_TEMPLATE_LINES,
        "system_instruction_root": _LIVE_CONTEXT_TEMPLATE_ROOT,
    }


def _compose_instruction(lines: list[str]) -> str:
    text = "\n".join(lines)
    if not text.endswith("\n"):
        text += "\n"
    return text


def _resolve_code_base_path(code_base_path: str) -> str:
    """CODE_BASE_PATHを絶対パスに解決する（AIバックアップ.py準拠）"""
    raw_path = code_base_path or ""
    normalized = raw_path.replace("\\", "/").strip()
    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if os.path.isabs(normalized):
        return os.path.abspath(normalized)
    return os.path.abspath(os.path.join(backend_dir, normalized))


def _read_project_aidiy_md(code_base_path: str) -> str:
    """CODE_BASE_PATH内の_AIDIY.mdを読み込んで返す。読めなければ空文字。"""
    try:
        resolved_base = _resolve_code_base_path(code_base_path)
        abs_path = os.path.normpath(os.path.join(resolved_base, "_AIDIY.md"))
        with open(abs_path, "r", encoding="utf-8-sig") as f:
            content = f.read()
        logger.info(f"[Live] _AIDIY.md 読取成功: {abs_path}")
        return content
    except Exception:
        logger.info(f"[Live] _AIDIY.md 読取失敗: {code_base_path}")
        return ""


def _load_or_create_live_context(code_base_path: str = "") -> str:
    """LiveAI定型コンテキストを読み込む。無ければひな形JSONを作成。"""
    template_payload = _context_template_payload()
    _is_root = code_base_path.replace("\\", "/").strip() == "../"
    template_lines = template_payload["system_instruction_lines"]
    if _is_root:
        template_lines = template_lines + template_payload["system_instruction_root"]
    template_instruction = _compose_instruction(template_lines)

    try:
        os.makedirs(os.path.dirname(_LIVE_CONTEXT_JSON_PATH), exist_ok=True)

        if not os.path.exists(_LIVE_CONTEXT_JSON_PATH):
            with open(_LIVE_CONTEXT_JSON_PATH, "w", encoding="utf-8") as f:
                json.dump(template_payload, f, indent=2, ensure_ascii=False)
            logger.info(f"[Live] 定型コンテキストJSONを作成: {_LIVE_CONTEXT_JSON_PATH}")
            return template_instruction

        with open(_LIVE_CONTEXT_JSON_PATH, "r", encoding="utf-8-sig") as f:
            payload = json.load(f)

        lines = payload.get("system_instruction_lines") if isinstance(payload, dict) else None
        root = payload.get("system_instruction_root") if isinstance(payload, dict) else None
        if isinstance(lines, list):
            combined = lines + (root if (_is_root and isinstance(root, list)) else [])
            normalized = [str(line) for line in combined]
            instruction = _compose_instruction(normalized)
            if not _is_root:
                aidiy_content = _read_project_aidiy_md(code_base_path)
                if aidiy_content:
                    instruction += "\n以下、このプロジェクトの内容\n" + aidiy_content
            return instruction

        logger.warning(f"[Live] 定型コンテキストJSONの形式不正。ひな形を再作成します: {_LIVE_CONTEXT_JSON_PATH}")
        with open(_LIVE_CONTEXT_JSON_PATH, "w", encoding="utf-8") as f:
            json.dump(template_payload, f, indent=2, ensure_ascii=False)
        return template_instruction
    except Exception as e:
        logger.error(f"[Live] 定型コンテキスト読込エラー: {e}")
        return template_instruction


class Live:
    """LiveAI 管理クラス（旧実装準拠）"""

    def __init__(
        self,
        親=None,
        セッションID: str = "",
        チャンネル: str = "0",
        絶対パス: str = "",
        AI_NAME: str = "",
        AI_MODEL: str = "",
        AI_VOICE: str = "",
        接続=None,
        保存関数=None,
    ):
        self.セッションID = セッションID
        self.チャンネル = チャンネル
        self.絶対パス = 絶対パス
        self.AI_NAME = AI_NAME
        self.AI_MODEL = AI_MODEL
        self.AI_VOICE = AI_VOICE
        self.接続 = 接続
        self.保存関数 = 保存関数
        self.親 = 親
        _code_base_path = ""
        try:
            モデル設定 = getattr(接続, "モデル設定", None)
            if isinstance(モデル設定, dict):
                _code_base_path = str(モデル設定.get("CODE_BASE_PATH", ""))
        except Exception:
            pass
        self.システム指示 = _load_or_create_live_context(_code_base_path)
        self.AIモジュール = self._select_ai_module()
        self.AIインスタンス = None
        self.is_alive = False
        self._initializing = False  # 初期化中フラグ（重複呼び出し防止）
        self.音声受信Ｑ: Optional[asyncio.Queue] = None
        self.テキスト受信Ｑ: Optional[asyncio.Queue] = None
        self._audio_task: Optional[asyncio.Task] = None
        self._text_task: Optional[asyncio.Task] = None

        # 音声入力/出力データは接続（セッション）のaudio_dataを使用
        # 統合音声分離ワーカーはaudio_processing.pyのものを使用
        # live.pyはLiveAIからの出力音声受信処理のみを担当

    def システム指示更新(self, code_base_path: str = ""):
        """プロジェクト切り替え時にシステム指示を再構築"""
        self.システム指示 = _load_or_create_live_context(code_base_path)
        logger.info(f"[Live] システム指示更新完了: code_base_path={code_base_path}")

    def _select_ai_module(self):
        """AI_NAMEに応じたLiveモジュールを選択してインポート"""
        module_name = "AIコア.AIライブ_gemini"
        ai_name = (self.AI_NAME or "").lower()
        if ai_name == "openai_live":
            module_name = "AIコア.AIライブ_openai"
        try:
            return importlib.import_module(module_name)
        except Exception as e:
            logger.error(f"[Live] AIモジュールのインポート失敗: {module_name} error={e}")
            return None

    async def _ensure_ai_instance(self):
        """AIモジュールのLiveAIインスタンスを生成・開始"""
        if not self.AIモジュール:
            return None
        if self.AIインスタンス:
            return self.AIインスタンス

        logger.info(f"[Live] LiveAI初期化開始: {self.AI_NAME} (AIコアセッション: {self.セッションID})")
        try:
            api_key = ""
            organization = ""
            ai_name = (self.AI_NAME or "").lower()
            live_ai = ai_name

            try:
                conf_json = getattr(self.親, "conf", None)
                if conf_json and hasattr(conf_json, "json"):
                    if live_ai in ("gemini_live", "freeai_live"):
                        api_key = conf_json.json.get("gemini_key_id", "")
                        if live_ai == "freeai_live":
                            api_key = conf_json.json.get("freeai_key_id", "") or api_key
                        if not self.AI_MODEL:
                            key = "LIVE_FREEAI_MODEL" if live_ai == "freeai_live" else "LIVE_GEMINI_MODEL"
                            self.AI_MODEL = conf_json.json.get(key, "") or self.AI_MODEL
                        if not self.AI_VOICE:
                            key = "LIVE_FREEAI_VOICE" if live_ai == "freeai_live" else "LIVE_GEMINI_VOICE"
                            self.AI_VOICE = conf_json.json.get(key, "") or self.AI_VOICE
                    else:
                        api_key = conf_json.json.get("openai_key_id", "")
                        organization = conf_json.json.get("openai_organization", "")
                        if not self.AI_MODEL:
                            self.AI_MODEL = conf_json.json.get("LIVE_OPENAI_MODEL", "") or self.AI_MODEL
                        if not self.AI_VOICE:
                            self.AI_VOICE = conf_json.json.get("LIVE_OPENAI_VOICE", "") or self.AI_VOICE
            except Exception:
                api_key = ""
                organization = ""

            LiveAI = getattr(self.AIモジュール, "LiveAI", None)
            if LiveAI is None:
                logger.error("[Live] LiveAIクラスが見つかりません")
                return None

            if live_ai == "openai_live":
                self.AIインスタンス = LiveAI(
                    セッションID=self.セッションID,
                    parent_manager=self.親,
                    live_ai=live_ai,
                    live_model=self.AI_MODEL,
                    live_voice=self.AI_VOICE,
                    api_key=api_key or None,
                    organization=organization or None,
                    system_instruction=self.システム指示,
                )
            else:
                self.AIインスタンス = LiveAI(
                    セッションID=self.セッションID,
                    parent_manager=self.親,
                    live_ai=live_ai,
                    live_model=self.AI_MODEL,
                    live_voice=self.AI_VOICE,
                    api_key=api_key or None,
                    system_instruction=self.システム指示,
                )
            if self.音声受信Ｑ is None:
                self.音声受信Ｑ = asyncio.Queue()
            if self.テキスト受信Ｑ is None:
                self.テキスト受信Ｑ = asyncio.Queue()
            started = await self.AIインスタンス.開始(self.音声受信Ｑ, self.テキスト受信Ｑ)
            if not started:
                failed_ai = self.AIインスタンス
                self.AIインスタンス = None
                await failed_ai.終了()
                logger.error("[Live] LiveAIの開始要求が失敗しました。APIキーとバックエンドの設定を確認してください。")
                return None
            logger.info(f"[Live] LiveAI初期化完了: {self.AI_NAME} (AIコアセッション: {self.セッションID})")
            return self.AIインスタンス
        except Exception as e:
            logger.error(f"[Live] LiveAI初期化エラー: {e}")
            self.AIインスタンス = None
            return None

    async def 開始(self):
        """Live処理を開始（旧実装準拠）"""
        # 既に初期化中または完了している場合はスキップ
        if self._initializing or self.AIインスタンス:
            return

        self._initializing = True
        try:
            ai = await self._ensure_ai_instance()
            if ai is None:
                self.is_alive = False
                await self._送信エラー通知("LiveAIを開始できませんでした。APIキーとバックエンドの初期化ログを確認してください。")
                return
            self.is_alive = True
            if self._audio_task is None or self._audio_task.done():
                self._audio_task = asyncio.create_task(self._音声受信ワーカー())
            if self._text_task is None or self._text_task.done():
                self._text_task = asyncio.create_task(self._テキスト受信ワーカー())
            # 統合音声分離ワーカーはaudio_processing.pyで起動済み（重複回避）
        finally:
            self._initializing = False

    async def 待受準備確認(self, timeout: float = 20.0):
        """ソケットの init とは別に、Provider が音声を受け付ける準備を確認する。"""
        deadline = asyncio.get_running_loop().time() + timeout
        while True:
            ai = self.AIインスタンス
            if ai is None or not self.is_alive:
                raise RuntimeError("LiveAI が開始されていません。バックエンドの初期化ログを確認してください。")
            if not getattr(ai, "api_key", None):
                raise RuntimeError("LiveAI の APIキーが未設定または仮設定です。バックエンドの設定を確認してください。")
            if getattr(ai, "中断停止フラグ", False) or getattr(ai, "エラーフラグ", False):
                raise RuntimeError(getattr(ai, "最終エラー", "") or "LiveAI への接続に失敗しました。バックエンドのログを確認してください。")
            session = getattr(ai, "live_session", None)
            # OpenAI はWebSocket接続だけでは設定が受理されたか分からない。
            settings_ready = getattr(ai, "設定反映済み", True)
            if session is not None and settings_ready:
                logger.info("[Live] LiveAIの音声待受準備が完了しました")
                return
            task = getattr(ai, "_background_task", None)
            if task is not None and task.done():
                raise RuntimeError("LiveAI の接続ワーカーが停止しました。バックエンドのログを確認してください。")
            if asyncio.get_running_loop().time() >= deadline:
                raise TimeoutError("LiveAI の音声待受準備が完了しませんでした。バックエンドの接続設定・ログを確認してください。")
            await asyncio.sleep(0.05)

    async def 接続時welcome送信(self) -> None:
        """audioチャンネル接続時にLiveAI APIキーを確認し、結果をwelcome_textでch0に送信"""
        await asyncio.sleep(0.7)  # chatより後に送信（chat=0.3s → live=0.7s）
        ai_label = f"[{self.AI_NAME or 'Live'}]"

        # APIキーの事前チェック（接続は行わずキーの有無のみ確認）
        api_key = ""
        try:
            conf_json = getattr(self.親, "conf", None)
            if conf_json and hasattr(conf_json, "json"):
                ai_name = (self.AI_NAME or "").lower()
                if ai_name in ("gemini_live", "freeai_live"):
                    api_key = conf_json.json.get("gemini_key_id", "")
                    if ai_name == "freeai_live":
                        api_key = conf_json.json.get("freeai_key_id", "") or api_key
                else:
                    api_key = conf_json.json.get("openai_key_id", "")
        except Exception:
            api_key = ""

        if not api_key or api_key[:1] == '<':
            メッセージ = f"{ai_label}APIキーが無効です。"
        else:
            メッセージ = f"{ai_label}会話準備ができました。"

        if self.接続:
            try:
                await self.接続.send_to_channel("0", {
                    "セッションID": self.セッションID,
                    "チャンネル": "0",
                    "メッセージ識別": "welcome_text",
                    "メッセージ内容": メッセージ,
                    "ファイル名": None,
                    "サムネイル画像": None,
                })
            except Exception as e:
                logger.error(f"[Live] welcome_text送信エラー: {e}")

    async def 終了(self):
        """Live処理を終了"""
        self.is_alive = False
        if self._audio_task and not self._audio_task.done():
            self._audio_task.cancel()
            try:
                await self._audio_task
            except asyncio.CancelledError:
                pass
        if self._text_task and not self._text_task.done():
            self._text_task.cancel()
            try:
                await self._text_task
            except asyncio.CancelledError:
                pass
        if self.AIインスタンス and hasattr(self.AIインスタンス, "終了"):
            try:
                await self.AIインスタンス.終了()
            except Exception:
                pass
        self.AIインスタンス = None

    # ===== 音声受信処理（旧実装準拠） =====
    # 音声入力処理はaudio_processing.pyで実装済み（重複回避）

    async def _音声データ受信処理(self, audio_data: dict):
        """
        LiveAIから受信した音声データの処理（割り込み制御付き、旧実装準拠）

        Args:
            audio_data: 音声データ辞書 {"bytes_data": bytes, "mime_type": str}
        """
        try:
            current_time = time.time()

            # 接続のaudio_dataを使用
            input_data = self.接続.audio_data["音声入力データ"] if self.接続 else None
            output_data = self.接続.audio_data["音声出力データ"] if self.接続 else None

            if not input_data or not output_data:
                # audio_dataが未初期化の場合は音声送信のみ
                await self._send_output_audio(audio_data)
                return

            # ユーザーが話していない時（1.0秒以上経過）のみ出力
            input_audio_lasttime = input_data.get('音声入力最終時刻')
            if (input_audio_lasttime is None or
                (input_audio_lasttime and current_time - input_audio_lasttime > USER_VOICE_INTERRUPT_SECONDS)):

                # WebSocketクライアントに送信
                await self._send_output_audio(audio_data)

            # 音声認識用バッファに蓄積
            audio_bytes = audio_data['bytes_data']
            if len(output_data['音声出力バッファ']) == 0:
                output_data['音声出力開始時刻'] = current_time  # バッファリング開始時刻

            output_data['音声出力最終時刻'] = current_time
            output_data['音声出力バッファ'].append(audio_bytes)

        except Exception as e:
            logger.error(f"音声データ受信処理エラー: {e}")

    async def _send_output_audio(self, audio_data: dict) -> bool:
        """出力音声をWebSocketクライアントに送信（旧実装準拠）"""
        try:
            if not self.接続:
                return False
            bytes_data = audio_data.get("bytes_data")
            mime_type = audio_data.get("mime_type", "audio/pcm")
            if not bytes_data:
                return False
            base64_audio = base64.b64encode(bytes_data).decode("utf-8")
            await self.接続.send_to_channel("audio", {
                "セッションID": self.セッションID,
                "メッセージ識別": "output_audio",
                "メッセージ内容": mime_type,
                "ファイル名": base64_audio,
                "サムネイル画像": None
            })
            return True
        except Exception as e:
            logger.error(f"[Live] 音声送信エラー: {e}")
            return False

    async def _send_output_text(self, text_data: dict) -> bool:
        """出力テキストをWebSocketクライアントに送信（旧実装準拠）"""
        try:
            if not self.接続:
                return False
            if isinstance(text_data, dict) and text_data.get("error"):
                await self._送信エラー通知(str(text_data["error"]), text_data.get("code"))
                return True
            text = text_data.get("text") if isinstance(text_data, dict) else None
            if not text:
                return False
            # Chatと共通の処理応答ログ形式
            セッションID_短縮 = self.セッションID[:10] if self.セッションID else '不明'
            logger.info(
                f"処理応答: チャンネル={self.チャンネル}, ソケット={セッションID_短縮}...,\n{text.rstrip()}\n"
            )
            await self.接続.send_to_channel("0", {
                "セッションID": self.セッションID,
                "メッセージ識別": "output_text",
                "メッセージ内容": text
            })
            return True
        except Exception as e:
            logger.error(f"[Live] テキスト送信エラー: {e}")
            return False

    # ===== ワーカー（旧実装準拠） =====

    async def _音声受信ワーカー(self):
        """音声受信ワーカー（旧実装準拠）"""
        while self.is_alive:
            try:
                if not self.音声受信Ｑ:
                    await asyncio.sleep(0.2)
                    continue

                # 音声データを待機（タイムアウト付き）
                try:
                    item = await asyncio.wait_for(self.音声受信Ｑ.get(), timeout=1.0)
                except asyncio.TimeoutError:
                    continue

                if not item:
                    continue
                if not self.接続:
                    continue

                # 音声データ受信処理を経由（バッファ蓄積、割り込み制御を含む）
                await self._音声データ受信処理(item)

                # バッファ件数による切り分け
                if self.音声受信Ｑ.qsize() > 0:
                    pass  # データあり：高速処理
                else:
                    await asyncio.sleep(0.05)

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"[Live] 音声受信ワーカーエラー: {e}")
                await asyncio.sleep(0.2)

    async def _テキスト受信ワーカー(self):
        """テキスト受信ワーカー（旧実装準拠）"""
        while self.is_alive:
            try:
                if not self.テキスト受信Ｑ:
                    await asyncio.sleep(0.2)
                    continue

                # テキストデータを待機（タイムアウト付き）
                try:
                    item = await asyncio.wait_for(self.テキスト受信Ｑ.get(), timeout=1.0)
                except asyncio.TimeoutError:
                    continue

                if not item:
                    continue
                if not self.接続:
                    continue

                # WebSocketクライアントに送信
                await self._send_output_text(item)

                # バッファ件数による切り分け
                if self.テキスト受信Ｑ.qsize() > 0:
                    await asyncio.sleep(0.25)  # データ有：CPU軽減
                else:
                    await asyncio.sleep(0.50)

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"[Live] テキスト受信ワーカーエラー: {e}")
                await asyncio.sleep(0.2)

    # 統合音声分離ワーカーはaudio_processing.pyで実装済み（重複回避）

    # ===== テキスト送信（LiveAIへ） =====

    async def _送信エラー通知(self, message: str = "", code: str = None) -> None:
        """LiveAIへの送信失敗を画面へ通知する。"""
        if self.接続:
            await self.接続.send_to_channel("0", {
                "セッションID": self.セッションID,
                "メッセージ識別": "error",
                "メッセージ内容": message or "LiveAI に送信できませんでした。音声AIへの接続状態を確認し、接続し直して再送してください。",
                **({"エラーコード": code} if code else {}),
            })

    async def テキスト送信(self, text: str) -> bool:
        """LiveAIへテキスト送信。失敗は画面へ通知する。"""
        try:
            # 接続準備中は is_alive=False。各プロバイダーの接続待ちを通してから送信する。
            if self.AIインスタンス and not getattr(self.AIインスタンス, "中断停止フラグ", False):
                セッションID_短縮 = self.セッションID[:10] if self.セッションID else '不明'
                logger.info(
                    f"処理要求: チャンネル={self.チャンネル}, ソケット={セッションID_短縮}...,\n{text.rstrip()}\n"
                )
                result = await self.AIインスタンス.テキスト送信(text)
                if result:
                    return True
                logger.warning("LiveAI実行:テキスト送信に失敗しました")
            else:
                logger.warning("LiveAI実行:LiveAIが開始されていません")
        except Exception as e:
            logger.error(f"[Live] テキスト送信エラー: {e}")
        await self._送信エラー通知(getattr(self.AIインスタンス, "最終エラー", ""))
        return False

    async def 画像送信(self, image_data, format: str = "jpeg") -> bool:
        """LiveAIへ画像送信（旧実装準拠）"""
        try:
            if self.AIインスタンス and self.AIインスタンス.is_alive:
                image_size = len(image_data) if isinstance(image_data, bytes) else "unknown"
                logger.info(f"[Live] 画像入力: format={format} size={image_size}bytes ({self.セッションID})")
                return await self.AIインスタンス.画像送信(image_data, format)
            # LiveAI停止中："!" を戻り値として返し継続
            await self._send_output_text({"text": "!"})
            return True
        except Exception as e:
            logger.error(f"[Live] 画像送信エラー: {e}")
            return False

