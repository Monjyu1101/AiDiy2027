# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""
WebSocket接続管理システム
AIコアのセッション管理とストリーミング処理を担当
"""
from typing import Dict, List, Optional
from datetime import datetime, timedelta
from fastapi import WebSocket
from starlette.websockets import WebSocketState
import asyncio
import json
import os
import secrets
from log_config import get_logger
from AIコア.AIストリーミング処理 import StreamingProcessor
from AIコア.AI音声処理 import 初期化_音声データ
from AIコア.AIバックアップ import コードベース絶対パス取得

# ロガー取得
logger = get_logger(__name__)

# 同じセッション・チャンネルの新しい接続へ置き換えるときの切断コード（クライアントは再接続しない）
REPLACED_CLOSE_CODE = 4000


def _is_disconnect_like_error(e: Exception) -> bool:
    msg = str(e)
    return any([
        "Unexpected ASGI message 'websocket.send', after sending 'websocket.close'" in msg,
        "Cannot call \"receive\" once a disconnect message has been received." in msg,
        "WebSocket is not connected" in msg,
    ])


def 初期モデル設定生成(app_conf) -> dict:
    if not (app_conf and hasattr(app_conf, 'json')):
        return {}
    
    # CODE_BASE_PATHは相対パスのまま保存（絶対パス変換は使用時に行う）
    code_base_path_raw = str(app_conf.json.get("CODE_BASE_PATH", "../")).strip() or "../"

    設定 = {
        # ChatAI設定
        "CHAT_AI_NAME": app_conf.json.get("CHAT_AI_NAME", "freeai_chat"),
        "CHAT_GEMINI_MODEL": app_conf.json.get("CHAT_GEMINI_MODEL", "gemini-3.1-flash-image"),
        "CHAT_FREEAI_MODEL": app_conf.json.get("CHAT_FREEAI_MODEL", "gemini-3.8-flash"),
        "CHAT_OPENRT_MODEL": app_conf.json.get("CHAT_OPENRT_MODEL", "google/gemini-3.1-flash-image"),
        "CHAT_OPENRT_FREE_MODEL": app_conf.json.get("CHAT_OPENRT_FREE_MODEL", "auto"),
        "CHAT_OPENAI_MODEL": app_conf.json.get("CHAT_OPENAI_MODEL", "gpt-6.1-sol"),
        "CHAT_OLLAMA_MODEL": app_conf.json.get("CHAT_OLLAMA_MODEL", "deepseek-v4-flash:cloud"),
        "CHAT_LOCAL_MODEL": app_conf.json.get("CHAT_LOCAL_MODEL", "google/gemma-4-E2B-it"),
        "CHAT_LOCAL_DTYPE": app_conf.json.get("CHAT_LOCAL_DTYPE", "bfloat16"),
        # LiveAI設定
        "LIVE_AI_NAME": app_conf.json.get("LIVE_AI_NAME", "freeai_live"),
        "LIVE_GEMINI_MODEL": app_conf.json.get("LIVE_GEMINI_MODEL", "gemini-2.5-flash-native-audio-preview-12-2025"),
        "LIVE_GEMINI_VOICE": app_conf.json.get("LIVE_GEMINI_VOICE", "Zephyr"),
        "LIVE_FREEAI_MODEL": app_conf.json.get("LIVE_FREEAI_MODEL", "gemini-2.5-flash-native-audio-preview-09-2025"),
        "LIVE_FREEAI_VOICE": app_conf.json.get("LIVE_FREEAI_VOICE", "Zephyr"),
        "LIVE_OPENAI_MODEL": app_conf.json.get("LIVE_OPENAI_MODEL", "gpt-realtime-2.1-mini"),
        "LIVE_OPENAI_VOICE": app_conf.json.get("LIVE_OPENAI_VOICE", "marin"),
        # PredictionAI設定
        "PREDICTION_AI_NAME": app_conf.json.get("PREDICTION_AI_NAME", "auto"),
        "PREDICTION_OPENAI_MODEL": app_conf.json.get("PREDICTION_OPENAI_MODEL", "auto"),
        "PREDICTION_OAUTH_MODEL": app_conf.json.get("PREDICTION_OAUTH_MODEL", "auto"),
        "PREDICTION_GEMINI_MODEL": app_conf.json.get("PREDICTION_GEMINI_MODEL", "auto"),
        "PREDICTION_FREEAI_MODEL": app_conf.json.get("PREDICTION_FREEAI_MODEL", "auto"),
        "PREDICTION_CODEX_CLI_MODEL": app_conf.json.get("PREDICTION_CODEX_CLI_MODEL", "gpt-6-luna"),
        "PREDICTION_COPILOT_CLI_MODEL": app_conf.json.get("PREDICTION_COPILOT_CLI_MODEL", "gpt-6-luna"),
        "PREDICTION_AIDIY_HERMES_MODEL": app_conf.json.get("PREDICTION_AIDIY_HERMES_MODEL", "openai_oauth/gpt-6-luna"),
        # DecisionAI設定
        "DECISION_AI_NAME": app_conf.json.get("DECISION_AI_NAME", "auto"),
        "DECISION_OPENAI_MODEL": app_conf.json.get("DECISION_OPENAI_MODEL", "auto"),
        "DECISION_OAUTH_MODEL": app_conf.json.get("DECISION_OAUTH_MODEL", "auto"),
        "DECISION_GEMINI_MODEL": app_conf.json.get("DECISION_GEMINI_MODEL", "auto"),
        "DECISION_FREEAI_MODEL": app_conf.json.get("DECISION_FREEAI_MODEL", "auto"),
        # CodeAI設定
        "CODE_AI1_NAME": app_conf.json.get("CODE_AI1_NAME", "codex_cli"),
        "CODE_AI1_MODEL": app_conf.json.get("CODE_AI1_MODEL", "auto"),
        "CODE_AI2_NAME": app_conf.json.get("CODE_AI2_NAME", "copilot_cli"),
        "CODE_AI2_MODEL": app_conf.json.get("CODE_AI2_MODEL", "auto"),
        "CODE_AI3_NAME": app_conf.json.get("CODE_AI3_NAME", "claude_cli"),
        "CODE_AI3_MODEL": app_conf.json.get("CODE_AI3_MODEL", "auto"),
        "CODE_AI4_NAME": app_conf.json.get("CODE_AI4_NAME", "antigravity_cli"),
        "CODE_AI4_MODEL": app_conf.json.get("CODE_AI4_MODEL", "same"),
        "CODE_AI5_NAME": app_conf.json.get("CODE_AI5_NAME", "opencode_cli"),
        "CODE_AI5_MODEL": app_conf.json.get("CODE_AI5_MODEL", "same"),
        "CODE_AI6_NAME": app_conf.json.get("CODE_AI6_NAME", "aidiy_hermes"),
        "CODE_AI6_MODEL": app_conf.json.get("CODE_AI6_MODEL", "auto"),
        "CODE_CLAUDE_SDK_MODEL": app_conf.json.get("CODE_CLAUDE_SDK_MODEL", "auto"),
        "CODE_CLAUDE_CLI_MODEL": app_conf.json.get("CODE_CLAUDE_CLI_MODEL", "auto"),
        "CODE_COPILOT_CLI_MODEL": app_conf.json.get("CODE_COPILOT_CLI_MODEL", "auto"),
        "CODE_ANTIGRAVITY_CLI_MODEL": app_conf.json.get("CODE_ANTIGRAVITY_CLI_MODEL", "auto"),
        "CODE_CODEX_CLI_MODEL": app_conf.json.get("CODE_CODEX_CLI_MODEL", "auto"),
        "CODE_GROK_CLI_MODEL": app_conf.json.get("CODE_GROK_CLI_MODEL", "auto"),
        "CODE_AIDIY_HERMES_MODEL": app_conf.json.get("CODE_AIDIY_HERMES_MODEL", "auto"),
        "CODE_OPENCODE_CLI_MODEL": app_conf.json.get("CODE_OPENCODE_CLI_MODEL", "auto"),
        "CODE_CLAUDE_OLLAMA_MODEL": app_conf.json.get("CODE_CLAUDE_OLLAMA_MODEL", "auto"),
        "CODE_CODEX_OLLAMA_MODEL": app_conf.json.get("CODE_CODEX_OLLAMA_MODEL", "auto"),
        "CODE_MAX_TURNS": app_conf.json.get("CODE_MAX_TURNS", 999),
        "CODE_PLAN": app_conf.json.get("CODE_PLAN", "auto"),
        "CODE_VERIFY": app_conf.json.get("CODE_VERIFY", "auto"),
        "CODE_SELF_CHECK_LOOP": app_conf.json.get("CODE_SELF_CHECK_LOOP", 1),
        "CODE_BASE_PATH": code_base_path_raw,
        "CODE_PERMISSIONS": app_conf.json.get("CODE_PERMISSIONS", "auto"),
        # TaskAI設定
        "TASK_AI_NAME": app_conf.json.get("TASK_AI_NAME", "codex_cli"),
        "TASK_AI_MODEL_plan": app_conf.json.get("TASK_AI_MODEL_plan", "auto"),
        "TASK_AI_MODEL_do": app_conf.json.get("TASK_AI_MODEL_do", "auto"),
        "TASK_AI_MODEL_check": app_conf.json.get("TASK_AI_MODEL_check", "auto"),
        # TeamAI設定
        "TEAM_AI_NAME": app_conf.json.get("TEAM_AI_NAME", "codex_cli"),
        "TEAM_AI_MODEL_plan": app_conf.json.get("TEAM_AI_MODEL_plan", "auto"),
        "TEAM_AI_MODEL_do": app_conf.json.get("TEAM_AI_MODEL_do", "auto"),
        "TEAM_AI_MODEL_check": app_conf.json.get("TEAM_AI_MODEL_check", "auto"),
    }
    models = getattr(app_conf, "models", None)
    if models is not None and callable(getattr(models, "normalize_initial_settings", None)):
        設定 = models.normalize_initial_settings(設定)
    return 設定


class WebSocketConnection:
    """
    個別のWebSocket接続を管理するクラス
    セッション内のソケット(input/audio/0-4)単位で保持
    """

    def __init__(self, websocket: WebSocket, セッションID: str, socket_no: str):
        self.websocket = websocket
        self.セッションID = セッションID
        self.socket_no = socket_no
        self.is_connected = False

    async def accept(self):
        """WebSocket接続を受け入れる"""
        await self.websocket.accept()
        self.is_connected = True
        logger.debug(f"接続確立: session={self.セッションID} socket={self.socket_no}")

    async def send_json(self, data: dict):
        """JSONデータを送信"""
        if self.is_connected:
            try:
                await self.websocket.send_json(data)
            except Exception as e:
                if _is_disconnect_like_error(e):
                    logger.info(f"送信スキップ(切断済み) (session={self.セッションID} socket={self.socket_no}): {e}")
                else:
                    logger.error(f"送信エラー (session={self.セッションID} socket={self.socket_no}): {e}")
                self.is_connected = False

    async def receive_json(self) -> Optional[dict]:
        """JSONデータを受信"""
        if self.is_connected:
            try:
                return await self.websocket.receive_json()
            except Exception as e:
                logger.error(f"受信エラー (session={self.セッションID} socket={self.socket_no}): {e}")
                self.is_connected = False
                return None
        return None

    async def close(self, code: int = 1000, reason: str = ""):
        """接続を閉じる"""
        if self.is_connected:
            try:
                await self.websocket.close(code=code, reason=reason)
            except Exception:
                pass
            self.is_connected = False
            logger.debug(f"接続クローズ: session={self.セッションID} socket={self.socket_no}")


class SessionConnection:
    """
    セッション構造体
    ソケット構造体:
    audio: 音声入出力チャンネル
    input: 共通入力チャンネル（テキスト、画像、操作）
    0: チャット出力チャンネル
    1: エージェント1出力チャンネル
    2: エージェント2出力チャンネル
    3: エージェント3出力チャンネル
    4: エージェント4出力チャンネル
    """

    def __init__(self, セッションID: str, voice_enabled: bool = True):
        if not isinstance(voice_enabled, bool):
            raise ValueError("voiceはtrueまたはfalseで指定してください。")
        self.セッションID = セッションID
        self.voice_enabled = voice_enabled
        # セッション内ランタイム初期化の多重実行を防止
        self.初期化ロック = asyncio.Lock()
        self.sockets: Dict[str, Optional[WebSocketConnection]] = {
            "audio": None,
            "input": None,
            "0": None,
            "1": None,
            "2": None,
            "3": None,
            "4": None
        }
        self.output_audio_paused = False
        self.ボタン状態 = {
            "スピーカー": True,
            "マイク": False,
            "イメージ": False
        }
        self.モデル設定 = {}
        self.ソース最終更新日時 = None
        self.全ファイルリスト: List[Dict[str, str]] = []
        self.バックアップベースパス: str = ""
        self.streaming_processor: Optional[StreamingProcessor] = None
        self.recognition_processor = None
        self.audio_split_task: Optional[asyncio.Task] = None
        self.audio_data = 初期化_音声データ() if self.voice_enabled else None

        self.チャンネル別キュー: Dict[str, asyncio.Queue] = {}
        self.チャンネル別処理中: Dict[str, bool] = {}

        self.チャンネル登録状態: Dict[str, bool] = {
            "audio": True,
            "input": True,
            "0": False,
            "1": False,
            "2": False,
            "3": False,
            "4": False
        }

        # チャンネル別ファイルリスト: {チャンネル: [{パス: str, 時刻: datetime}, ...]}
        self.チャンネル別ファイルリスト: Dict[str, List[dict]] = {}
        # welcome_info受信で False、welcome_text受信で True → True の間のみ output_text/recognition_output を core に転送
        self.チャンネル0toCore_並行出力フラグ = False
        # core再接続時の字幕用に、最新の recognition_output だけ保持
        self.最新認識出力: Optional[dict] = None
        # ファイル/フォルダ選択状態
        self.選択パス: str = ""
        self.選択種別: str = ""  # "file" or "folder"
        self.選択パネル: str = ""  # "left" or "right"
        self.選択タイムスタンプ: str = ""

    def ファイル登録(self, チャンネル: str, ファイルパス: str):
        """チャンネルのファイルリストにファイルを追加"""
        if チャンネル not in self.チャンネル別ファイルリスト:
            self.チャンネル別ファイルリスト[チャンネル] = []
        self.チャンネル別ファイルリスト[チャンネル].append({
            "パス": ファイルパス,
            "時刻": datetime.now()
        })
        logger.debug(f"ファイル登録: ch={チャンネル} path={ファイルパス}")

    def 最近のファイル取得(self, チャンネル: str, 秒数: int = 60) -> List[str]:
        """指定チャンネル＋チャンネル0の最近のファイルを絶対パスで取得"""
        基準時刻 = datetime.now() - timedelta(seconds=秒数)
        結果 = []
        対象チャンネル = [チャンネル] if チャンネル == "0" else [チャンネル, "0"]
        for ch in 対象チャンネル:
            for item in self.チャンネル別ファイルリスト.get(ch, []):
                if item["時刻"] >= 基準時刻:
                    パス = item["パス"]
                    if not os.path.isabs(パス):
                        パス = os.path.abspath(パス)
                    if パス not in 結果:
                        結果.append(パス)
        return 結果

    @property
    def is_connected(self) -> bool:
        return any(conn and conn.is_connected for conn in self.sockets.values())

    def set_socket(self, socket_no: str, connection: Optional[WebSocketConnection]):
        self.sockets[socket_no] = connection

    def get_socket(self, socket_no: str) -> Optional[WebSocketConnection]:
        return self.sockets.get(socket_no)

    async def send_json(self, data: dict):
        """チャンネルに応じて送信先ソケットを決定"""
        チャンネル = data.get("チャンネル", None)
        if チャンネル is None:
            チャンネル = "core"
        connection = self.sockets.get(チャンネル)
        if not connection:
            logger.warning(f"送信先ソケット未接続: session={self.セッションID} ch={チャンネル}")
            return
        if not connection.is_connected:
            logger.warning(f"送信先ソケット切断: session={self.セッションID} ch={チャンネル}")
            return
        await connection.send_json(data)

        # チャンネル0の応答系メッセージを core にも転送
        if チャンネル == "0":
            識別 = data.get("メッセージ識別", "")
            if 識別 == "welcome_info":
                self.チャンネル0toCore_並行出力フラグ = False
            elif 識別 == "welcome_text":
                self.チャンネル0toCore_並行出力フラグ = True
            elif 識別 == "recognition_output":
                self.最新認識出力 = {**data}
            if self.チャンネル0toCore_並行出力フラグ and 識別 in ("output_text", "recognition_output", "welcome_text"):
                core_conn = self.sockets.get("core")
                if core_conn and core_conn.is_connected:
                    送信識別 = "output_text" if 識別 == "welcome_text" else 識別
                    await core_conn.send_json({**data, "チャンネル": "core", "メッセージ識別": 送信識別})

    async def send_to_channel(self, チャンネル: str, data: dict):
        # output_fileの自動追跡
        if data.get("メッセージ識別") == "output_file" and data.get("ファイル名"):
            self.ファイル登録(チャンネル, data["ファイル名"])

        既存チャンネル = data.get("チャンネル", None)
        if 既存チャンネル is not None and 既存チャンネル != チャンネル:
            logger.error(
                f"送信チャンネル不一致: send_to_channel={チャンネル}, data.チャンネル={既存チャンネル}"
            )
        data["チャンネル"] = チャンネル
        await self.send_json(data)
        logger.debug(f"チャンネル{チャンネル}に送信: {data.get('メッセージ識別', 'unknown')}")

    def register_channel(self, チャンネル: str):
        logger.info(f"チャンネル{チャンネル}登録通知: {self.セッションID}")

    def unregister_channel(self, チャンネル: str):
        logger.info(f"チャンネル{チャンネル}解除通知: {self.セッションID}")

    def is_channel_registered(self, チャンネル: str) -> bool:
        return True

    def get_or_create_queue(self, チャンネル: str) -> asyncio.Queue:
        if チャンネル not in self.チャンネル別キュー:
            self.チャンネル別キュー[チャンネル] = asyncio.Queue()
            self.チャンネル別処理中[チャンネル] = False
            logger.debug(f"チャンネル{チャンネル}のキューを作成: {self.セッションID}")
        return self.チャンネル別キュー[チャンネル]

    def is_channel_processing(self, チャンネル: str) -> bool:
        return self.チャンネル別処理中.get(チャンネル, False)

    def set_channel_processing(self, チャンネル: str, 処理中: bool):
        self.チャンネル別処理中[チャンネル] = 処理中
        logger.debug(f"チャンネル{チャンネル}の処理状態: {処理中} ({self.セッションID})")

    def update_state(self, ボタン: dict, manager=None):
        if isinstance(ボタン, dict):
            self.ボタン状態.update(ボタン)
        if manager:
            manager.save_session_state(self.セッションID, self.ボタン状態, self.モデル設定, self.ソース最終更新日時)

    def update_model_settings(self, 設定: dict, manager=None):
        self.モデル設定 = {
            **self.モデル設定,
            **(設定 or {}),
        }
        if manager:
            manager.save_session_state(self.セッションID, self.ボタン状態, self.モデル設定, self.ソース最終更新日時)

    async def _cancel_runtime_task(self, task):
        """完了済みの例外も回収し、実行中のタスクは停止を待つ。"""
        if task is None or task is asyncio.current_task():
            return
        if not task.done():
            task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        except Exception:
            logger.exception(f"ランタイムタスク終了時エラー: {self.セッションID}")

    async def _stop_runtime_processors_locked(self):
        """初期化ロック取得済みの呼出元用。会話を保持して実行系だけ停止する。"""
        # ストリーミングからLive/Codeが再開されないよう、最初に停止する。
        if self.streaming_processor:
            try:
                await self.streaming_processor.stop()
            except Exception:
                logger.exception(f"ストリーミング停止エラー: {self.セッションID}")
            await self._cancel_runtime_task(getattr(self.streaming_processor, "task", None))
            self.streaming_processor = None

        await self._cancel_runtime_task(self.audio_split_task)
        self.audio_split_task = None
        if self.recognition_processor:
            try:
                await self.recognition_processor.終了()
            except Exception:
                logger.exception(f"音声認識停止エラー: {self.セッションID}")
            await self._cancel_runtime_task(getattr(self.recognition_processor, "worker_task", None))
            self.recognition_processor = None

        # Chat/Code/Liveのオブジェクトは、会話履歴を再接続へ引き継ぐため保持する。
        if getattr(self, "live_processor", None):
            try:
                await self.live_processor.終了()
            except Exception:
                logger.exception(f"Live停止エラー: {self.セッションID}")
        if getattr(self, "chat_processor", None):
            try:
                await self.chat_processor.終了()
            except Exception:
                logger.exception(f"Chat停止エラー: {self.セッションID}")
        for agent in getattr(self, "code_agent_processors", ()) or ():
            try:
                await agent.終了()
            except Exception:
                logger.exception(f"Code停止エラー: {self.セッションID}")
        self.audio_data = 初期化_音声データ() if self.voice_enabled else None
        self.output_audio_paused = False

    async def stop_runtime_processors(self):
        """WebSocket切断後に残る実行系を、接続・初期化と排他して停止する。"""
        async with self.初期化ロック:
            await self._stop_runtime_processors_locked()

    async def _close_locked(self):
        await self._stop_runtime_processors_locked()
        for キュー in self.チャンネル別キュー.values():
            while not キュー.empty():
                try:
                    キュー.get_nowait()
                except asyncio.QueueEmpty:
                    break
        self.チャンネル別キュー.clear()
        self.チャンネル別処理中.clear()

        for socket_no, connection in self.sockets.items():
            if connection:
                await connection.close()
                self.sockets[socket_no] = None

    async def close(self):
        """セッション全体を、接続・初期化と排他してクローズする。"""
        async with self.初期化ロック:
            await self._close_locked()


class WebSocketManager:
    """WebSocket接続を一元管理するクラス"""

    def __init__(self):
        self.sessions: Dict[str, SessionConnection] = {}
        self.session_states: Dict[str, dict] = {}

    def _short_sid(self, セッションID: Optional[str]) -> str:
        if not セッションID:
            return "-"
        sid = str(セッションID)
        if len(sid) <= 23:
            return sid
        return f"{sid[:10]}...{sid[-10:]}"

    def _fmt_log(self, ch: str, 内容: str, セッションID: Optional[str] = None) -> str:
        sid = self._short_sid(セッションID)
        return f"チャンネル={ch}, {内容}, セッションID={sid}"

    def セッションID生成(self) -> str:
        """新しいセッションIDを生成（10文字程度）"""
        # 10文字（16進）: URL/ログで扱いやすい短いID
        return secrets.token_hex(5)

    def _新規セッション初期モデル設定(self, app_conf, セッションID: str) -> dict:
        """新規セッション用の初期モデル設定を生成（conf値をそのまま使用）"""
        model_settings = 初期モデル設定生成(app_conf=app_conf)
        if model_settings:
            code_base_path = str(model_settings.get("CODE_BASE_PATH", "")).strip()
            logger.info(f"新規セッション初期CODE_BASE_PATH: {code_base_path} (session={セッションID})")
        return model_settings

    async def connect(self, websocket: WebSocket, セッションID: Optional[str] = None, socket_no: str = "input", app_conf=None, accept_in_connect: bool = True, code_base_path: Optional[str] = None, live_model_settings: Optional[dict] = None, voice: Optional[bool] = None, auth_owner=None) -> str:
        """
        WebSocket接続を登録（セッション単位）

        Args:
            websocket: WebSocket接続
            セッションID: 既存のセッションID（リロード時）。Noneの場合は新規生成
            app_conf: アプリケーション設定（新規接続時にコピー）

        Returns:
            セッションID: 使用するセッションID
        """
        if voice is not None and not isinstance(voice, bool):
            raise ValueError("voiceはtrueまたはfalseで指定してください。")

        # クライアント指定は Live のモデル・音声だけを初期設定へ反映する。
        live_settings = {}
        if live_model_settings is not None:
            allowed = {"LIVE_AI_NAME", "LIVE_GEMINI_MODEL", "LIVE_GEMINI_VOICE",
                       "LIVE_FREEAI_MODEL", "LIVE_FREEAI_VOICE", "LIVE_OPENAI_MODEL", "LIVE_OPENAI_VOICE"}
            if not isinstance(live_model_settings, dict) or set(live_model_settings) - allowed:
                raise ValueError("接続時のライブモデル設定が無効です。")
            for key, value in live_model_settings.items():
                if not isinstance(value, str):
                    raise ValueError("ライブモデルと音声は文字列で指定してください。")
                if value.strip():
                    live_settings[key] = value.strip()
            if "LIVE_AI_NAME" in live_settings and live_settings["LIVE_AI_NAME"] not in {"gemini_live", "freeai_live", "openai_live"}:
                raise ValueError("指定されたライブAIに対応していません。")

        # フォルダを初期化通知・AI起動より先に確定する。
        project_path = None
        if code_base_path is not None:
            if not isinstance(code_base_path, str) or not code_base_path.strip() or "\x00" in code_base_path:
                raise ValueError("プロジェクトフォルダが無効です。")
            project_path = コードベース絶対パス取得(セッション設定={"CODE_BASE_PATH": code_base_path})
            if not os.path.isdir(project_path):
                raise ValueError("プロジェクトフォルダをバックエンドから参照できません。フォルダの場所を確認してください。")

        セッションID = セッションID if セッションID else self.セッションID生成()
        session = self.sessions.get(セッションID)
        if auth_owner is not None:
            owners = getattr(self, "_auth_owners", None)
            if owners is None:
                self._auth_owners = owners = {}
            existing_owner = owners.get(セッションID)
            if ((existing_owner is not None and existing_owner != auth_owner)
                    or (session is not None and getattr(session, "_auth_owner", None) != auth_owner)):
                raise ValueError("セッションの認証主体が一致しません。")
        if session is None:
            saved_state = self.session_states.get(セッションID)
            saved_settings = saved_state.get("モデル設定") if saved_state else None
            self._接続設定照合(saved_settings, live_settings, project_path, app_conf)
            voice_enabled = voice if voice is not None else (saved_state or {}).get("voice", True)
            if socket_no == "audio" and not voice_enabled:
                raise ValueError("音声無効のセッションにはaudioソケットを接続できません。")

            # 作成・最初のvoice確定・登録まではawaitしない。同時接続も同じロックを使う。
            session = SessionConnection(セッションID, voice_enabled=voice_enabled)
            if saved_state is not None:
                session.ボタン状態 = saved_state.get("ボタン", session.ボタン状態).copy()
                session.モデル設定 = dict(saved_state.get("モデル設定") or {})
                session.ソース最終更新日時 = saved_state.get("ソース最終更新日時")
            else:
                session.モデル設定 = self._新規セッション初期モデル設定(app_conf, セッションID)
            if live_settings:
                session.モデル設定.update(live_settings)
            if project_path is not None:
                session.モデル設定["CODE_BASE_PATH"] = project_path
            self.sessions[セッションID] = session

        if auth_owner is not None:
            session._auth_owner = auth_owner
            self._auth_owners[セッションID] = auth_owner

        async with session.初期化ロック:
            self._接続設定照合(session.モデル設定, live_settings, project_path, app_conf)
            voice_enabled = session.voice_enabled if voice is None else voice
            if voice_enabled != session.voice_enabled and session.is_connected:
                raise ValueError("接続中のセッションのvoice設定は変更できません。新しい会話で接続してください。")
            if socket_no == "audio" and not voice_enabled:
                raise ValueError("音声無効のセッションにはaudioソケットを接続できません。")
            if voice_enabled != session.voice_enabled:
                # 既存タスクが音声データを参照し終えるまで能力を切り替えない。
                await session._stop_runtime_processors_locked()
                session.voice_enabled = voice_enabled
                session.audio_data = 初期化_音声データ() if voice_enabled else None
                if not voice_enabled and hasattr(session, "live_processor"):
                    session.live_processor = None
            if project_path is not None:
                session.モデル設定["CODE_BASE_PATH"] = project_path
            if live_settings:
                session.モデル設定.update(live_settings)
            self.save_session_state(セッションID, session.ボタン状態, session.モデル設定, session.ソース最終更新日時)

            # 差し替えをロック内で完了し、旧接続のfinallyには所有者照合をさせる。
            old_conn = session.get_socket(socket_no)
            if old_conn:
                # 置き換えであることをクライアントへ伝え、旧接続側が再接続して新接続を閉じ返す
                # 置き換え合いの繰り返しを防ぐ（frontend_avatar の REPLACED_CLOSE_CODE と対応）。
                await old_conn.close(code=REPLACED_CLOSE_CODE, reason="replaced")
            connection = WebSocketConnection(websocket, セッションID, socket_no)
            if accept_in_connect:
                await connection.accept()
            else:
                connection.is_connected = True
            session.set_socket(socket_no, connection)

            init_payload = {
                "セッションID": セッションID,
                "ソケット番号": socket_no,
                "チャンネル": socket_no,
                "メッセージ識別": "init",
                "メッセージ内容": {}
            }
            if socket_no == "core":
                init_payload["メッセージ内容"] = {
                    "ボタン": session.ボタン状態.copy(),
                    "モデル設定": session.モデル設定
                }
            if getattr(websocket, "application_state", None) == WebSocketState.CONNECTED:
                await connection.send_json(init_payload)
            else:
                connection.is_connected = False
                logger.debug(f"初期化メッセージ送信をスキップ(未接続): session={セッションID} socket={socket_no}")

        logger.info(self._fmt_log(ch=socket_no, 内容="接続登録", セッションID=セッションID))
        return セッションID

    def _接続設定照合(self, settings, live_settings, project_path, app_conf):
        if settings is None:
            return
        if any(settings.get(key) != value for key, value in live_settings.items()):
            raise ValueError("セッションのライブモデルが一致しません。新しい会話で接続してください。")
        if project_path is not None:
            current_path = コードベース絶対パス取得(アプリ設定=app_conf, セッション設定=settings)
            if os.path.normcase(current_path) != os.path.normcase(project_path):
                raise ValueError("セッションのプロジェクトフォルダが一致しません。新しい会話で接続してください。")

    def ensure_session(self, セッションID: Optional[str] = None, app_conf=None) -> str:
        """
        セッションを確実に作成（WebSocket未接続でも状態だけ確保）
        """
        if セッションID and セッションID in self.sessions:
            return セッションID

        セッションID = セッションID if セッションID else self.セッションID生成()
        if セッションID in self.sessions:
            return セッションID

        saved_state = self.session_states.get(セッションID, {})
        session = SessionConnection(セッションID, voice_enabled=saved_state.get("voice", True))
        if セッションID in self.session_states:
            saved_state = self.session_states[セッションID]
            session.ボタン状態 = saved_state.get("ボタン", session.ボタン状態).copy()
            session.モデル設定 = dict(saved_state.get("モデル設定") or {})
            session.ソース最終更新日時 = saved_state.get("ソース最終更新日時")
        else:
            session.モデル設定 = self._新規セッション初期モデル設定(app_conf, セッションID)
        self.sessions[セッションID] = session
        self.save_session_state(セッションID, session.ボタン状態, session.モデル設定, session.ソース最終更新日時)
        logger.info(f"セッションを作成(ensure): {セッションID}")
        return セッションID

    def save_session_state(self, セッションID: str, ボタン: dict, モデル設定: dict = None, ソース最終更新日時: Optional[str] = None):
        """セッション状態を保存"""
        state = self.session_states.get(セッションID, {}).copy()
        state["ボタン"] = ボタン.copy()
        session = self.sessions.get(セッションID)
        state["voice"] = session.voice_enabled if session else state.get("voice", True)
        state.setdefault("ソース最終更新日時", None)
        if モデル設定 is not None:
            state["モデル設定"] = dict(モデル設定)
        if ソース最終更新日時 is not None:
            state["ソース最終更新日時"] = ソース最終更新日時

        self.session_states[セッションID] = state
        logger.debug(f"セッション状態保存: {セッションID}")

    async def disconnect(self, セッションID: str, socket_no: Optional[str] = None, keep_session: bool = True, websocket: Optional[WebSocket] = None):
        """
        WebSocket接続を切断（セッション内のソケット単位）

        Args:
            セッションID: セッションID
            keep_session: セッション状態を保持するか（デフォルト: True）
        """
        session = self.sessions.get(セッションID)
        if not session:
            return

        async with session.初期化ロック:
            if socket_no is not None:
                connection = session.get_socket(socket_no)
                if websocket is not None and (connection is None or connection.websocket is not websocket):
                    # 差し替え前のソケットのfinallyで、新しい接続を切断しない。
                    return
            if keep_session:
                self.save_session_state(
                    セッションID, session.ボタン状態, session.モデル設定, session.ソース最終更新日時
                )

            if socket_no is None:
                await session._close_locked()
            else:
                connection = session.get_socket(socket_no)
                if connection:
                    await connection.close()
                    session.set_socket(socket_no, None)
                if not session.is_connected:
                    await session._stop_runtime_processors_locked()

        ch = socket_no if socket_no is not None else "-99"
        logger.info(self._fmt_log(ch=ch, 内容="接続切断", セッションID=セッションID))

    def get_session(self, セッションID: str) -> Optional[SessionConnection]:
        """セッションIDからセッションを取得"""
        return self.sessions.get(セッションID)

    def get_connection(self, セッションID: str, socket_no: str = "input") -> Optional[WebSocketConnection]:
        """セッションIDとソケット番号から接続を取得"""
        session = self.get_session(セッションID)
        if not session:
            return None
        return session.get_socket(socket_no)

    async def send_to_socket(self, セッションID: str, data: dict):
        """特定のソケットにデータを送信"""
        session = self.get_session(セッションID)
        if session:
            await session.send_json(data)
    
    async def send_to_channel(self, セッションID: str, チャンネル: str, data: dict):
        """
        特定のソケットの指定チャンネルにデータを送信
        チャンネルが登録されている場合のみ送信
        """
        session = self.get_session(セッションID)
        if session:
            await session.send_to_channel(チャンネル, data)
    
    def register_channel(self, セッションID: str, チャンネル: str):
        """チャンネルを登録"""
        session = self.get_session(セッションID)
        if session:
            session.register_channel(チャンネル)

    def unregister_channel(self, セッションID: str, チャンネル: str):
        """チャンネルを解除"""
        session = self.get_session(セッションID)
        if session:
            session.unregister_channel(チャンネル)

    async def broadcast(self, data: dict):
        """全ての接続にデータをブロードキャスト"""
        for session in self.sessions.values():
            await session.send_json(data)

    async def handle_message(self, セッションID: str, message: dict):
        """
        クライアントからのメッセージをチャンネル別キューに追加

        Args:
            セッションID: セッションID
            message: 受信メッセージ
        """
        session = self.get_session(セッションID)
        if not session:
            logger.warning(f"メッセージ処理失敗: 接続が見つかりません ({セッションID})")
            return
        
        # チャンネルを取得（デフォルト: "0"）
        チャンネル = str(message.get("チャンネル", "0"))
        
        # チャンネル別キューに追加
        キュー = session.get_or_create_queue(チャンネル)
        await キュー.put(message)
        logger.debug(f"メッセージをキューに追加: チャンネル={チャンネル}, セッションID={セッションID}, キューサイズ={キュー.qsize()}")
        
        # ストリーミングプロセッサに処理を委譲
        if session.streaming_processor:
            await session.streaming_processor.handle_client_message(message)
        else:
            logger.warning(f"メッセージ処理失敗: プロセッサが見つかりません ({セッションID})")

    def get_session_count(self) -> int:
        """アクティブなセッション数を取得"""
        return len(self.sessions)

    def get_session_list(self) -> list:
        """アクティブなセッションのリストを取得"""
        return [
            {
                "セッションID": session.セッションID,
                "is_connected": session.is_connected,
                "ボタン状態": session.ボタン状態,
                "モデル設定": session.モデル設定,
                "ソース最終更新日時": session.ソース最終更新日時,
                "チャンネル登録状態": session.チャンネル登録状態,
                "チャンネル別処理中": session.チャンネル別処理中,
                "チャンネル別キューサイズ": {
                    ch: q.qsize() for ch, q in session.チャンネル別キュー.items()
                },
                "ソケット接続状態": {
                    ch: (conn.is_connected if conn else False) for ch, conn in session.sockets.items()
                }
            }
            for session in self.sessions.values()
        ]


# グローバルなセッションマネージャーインスタンス
AIセッション管理 = WebSocketManager()
