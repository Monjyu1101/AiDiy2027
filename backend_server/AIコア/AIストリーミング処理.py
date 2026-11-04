# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""
ストリーミング処理プロセッサ
各WebSocketセッション専用のストリーミングタスクを管理
"""

import asyncio
from typing import Optional, TYPE_CHECKING
from log_config import get_logger

if TYPE_CHECKING:
    from AIコア.AIセッション管理 import SessionConnection

logger = get_logger(__name__)


class StreamingProcessor:
    """ストリーミング処理を担当するクラス"""

    def __init__(self, セッションID: str, connection: "SessionConnection"):
        """
        初期化

        Args:
            セッションID: セッションID
            connection: WebSocket接続オブジェクト
        """
        self.セッションID = セッションID
        self.connection = connection
        self.is_running = False
        self.task: Optional[asyncio.Task] = None

    async def start(self):
        """ストリーミング処理を開始"""
        if self.is_running:
            logger.warning(f"既にストリーミング処理が実行中です: {self.セッションID}")
            return

        self.is_running = True
        self.task = asyncio.create_task(self._process())
        logger.debug(f"ストリーミング処理開始: {self.セッションID}")

    async def stop(self):
        """ストリーミング処理を停止"""
        self.is_running = False

        if self.task and not self.task.done():
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                pass

        logger.debug(f"ストリーミング処理停止: {self.セッションID}")

    async def _process(self):
        """
        ストリーミング処理のメインループ
        各セッション専用のストリーミングタスクとして動作
        """
        logger.debug(f"ストリーミングタスク起動: {self.セッションID}")

        try:
            # ストリーミング開始通知
            await self.connection.send_json({
                "メッセージ識別": "streaming_started",
                "セッションID": self.セッションID,
                "メッセージ内容": "ストリーミング処理を開始しました"
            })

            # メインループ
            counter = 0
            while self.is_running and self.connection.is_connected:
                await asyncio.sleep(5)  # 5秒ごと
                counter += 1

                # ハートビートメッセージ
                await self.connection.send_json({
                    "メッセージ識別": "heartbeat",
                    "セッションID": self.セッションID,
                    "メッセージ内容": {
                        "カウント": counter,
                        "時刻": asyncio.get_event_loop().time()
                    }
                })

                # ここで実際のAI処理を実装
                # 例: チャットAI応答のストリーミング
                # 例: 画像認識結果の段階的送信
                # 例: エージェント出力のリアルタイム表示
                await self._process_ai_tasks()

        except asyncio.CancelledError:
            logger.debug(f"ストリーミングタスクキャンセル: {self.セッションID}")
            raise
        except Exception as e:
            logger.error(f"ストリーミングエラー ({self.セッションID}): {e}")
            await self.connection.send_json({
                "メッセージ識別": "error",
                "セッションID": self.セッションID,
                "メッセージ内容": str(e)
            })
        finally:
            self.is_running = False
            logger.debug(f"ストリーミングタスク終了: {self.セッションID}")

    async def _process_ai_tasks(self):
        """
        AI処理タスク
        ボタン状態に応じて適切なAI処理を実行
        """
        ボタン状態 = self.connection.ボタン状態

        # チャットAI処理
        if ボタン状態.get("チャット", False):
            await self._process_chat_ai()

        # イメージAI処理
        if ボタン状態.get("イメージ", False):
            await self._process_image_ai()

        # エージェントAI処理
        for i in range(1, 7):
            if ボタン状態.get(f"エージェント{i}", False):
                await self._process_agent_ai(i)

    async def _process_chat_ai(self):
        """チャットAI処理"""
        if self.connection.ボタン状態.get("マイク", False):
            await self._ensure_live_ai("マイク")

    async def _process_image_ai(self):
        """イメージAI処理"""
        if self.connection.ボタン状態.get("イメージ", False):
            await self._ensure_live_ai("イメージ")

    async def _ensure_live_ai(self, ボタン名: str):
        """音声有効かつ接続中の場合だけLiveを起動する。"""
        async with self.connection.初期化ロック:
            音声接続 = self.connection.get_socket("audio")
            if not self.connection.voice_enabled or not 音声接続 or not 音声接続.is_connected:
                return
            live_processor = getattr(self.connection, "live_processor", None)
            if live_processor:
                try:
                    if not getattr(live_processor, "AIインスタンス", None):
                        logger.info(f"{ボタン名}ONのため、LiveAIを開始します。")
                        await live_processor.開始()
                except Exception as e:
                    logger.error(f"LiveAIの開始に失敗しました: {e}")

    async def _process_agent_ai(self, agent_number: int):
        """エージェントAI処理"""
        # 対応するエージェントプロセッサがアクティブであることを確認
        agent_processors = getattr(self.connection, "code_agent_processors", [])
        if 0 <= agent_number - 1 < len(agent_processors):
            agent = agent_processors[agent_number - 1]
            if agent:
                try:
                    # is_aliveがFalse、またはワーカーが停止している場合に再開を試みる
                    if not agent.is_alive or (agent.worker_task and agent.worker_task.done()):
                        logger.info(f"エージェント{agent_number}が非アクティブなため、再開します。")
                        await agent.開始()
                except Exception as e:
                    logger.error(f"エージェント{agent_number}の再開に失敗しました: {e}")

    async def send_message(self, message_type: str, data: dict):
        """
        クライアントにメッセージを送信

        Args:
            message_type: メッセージタイプ
            data: 送信データ
        """
        await self.connection.send_json({
            "メッセージ識別": message_type,
            "セッションID": self.セッションID,
            **data
        })

    async def send_output_audio(self, base64_audio: str, mime_type: str = "audio/pcm", チャンネル: str = "audio"):
        """
        音声出力メッセージを送信

        Args:
            base64_audio: Base64エンコードされた音声データ
            mime_type: MIMEタイプ（デフォルト: audio/pcm）
            チャンネル: 送信先チャンネル（デフォルト: "audio"）
        """
        if not self.connection.voice_enabled:
            return
        # 音声出力が一時停止中（人間の音声入力中）はスキップ
        if self.connection.output_audio_paused:
            logger.debug(f"音声出力スキップ（一時停止中）: {self.セッションID}")
            return

        await self.connection.send_to_channel(チャンネル, {
            "セッションID": self.セッションID,
            "メッセージ識別": "output_audio",
            "メッセージ内容": mime_type,
            "ファイル名": base64_audio,
            "サムネイル画像": None
        })

    async def handle_client_message(self, message: dict):
        """
        クライアントからのメッセージを処理

        Args:
            message: 受信メッセージ
        """
        msg_type = message.get("メッセージ識別")

        if msg_type == "chat_input":
            # チャット入力を処理
            await self._handle_chat_input(message.get("メッセージ内容", ""))
        elif msg_type == "image_input":
            # 画像入力を処理
            await self._handle_image_input(message.get("画像") or message.get("メッセージ内容"))
        elif msg_type == "agent_command":
            # エージェントコマンドを処理
            await self._handle_agent_command(
                message.get("エージェント番号"),
                message.get("コマンド")
            )
        else:
            logger.warning(f"未知のメッセージタイプ: {msg_type}")

    async def _handle_chat_input(self, text: str):
        """チャット入力の処理"""
        logger.info(f"チャット入力処理: {text[:50]}...")
        chat_processor = getattr(self.connection, "chat_processor", None)
        live_processor = getattr(self.connection, "live_processor", None)

        # マイクがONならLiveAI、OFFなら通常のChatAIに処理を渡す
        if self.connection.ボタン状態.get("マイク", False) and live_processor:
            try:
                await live_processor.テキスト送信(text)
            except Exception as e:
                logger.error(f"LiveAIへのテキスト送信に失敗: {e}")
        elif chat_processor:
            try:
                受信データ = {
                    "メッセージ識別": "input_text",
                    "メッセージ内容": text,
                    "チャンネル": "0",
                }
                await chat_processor.チャット要求(受信データ)
            except Exception as e:
                logger.error(f"ChatAIへの要求に失敗: {e}")
        else:
            logger.warning("チャットプロセッサが見つからないため、入力を破棄します。")

    async def _handle_image_input(self, image_data):
        """画像入力の処理"""
        logger.info("画像入力処理...")
        live_processor = getattr(self.connection, "live_processor", None)
        if live_processor:
            try:
                # image_dataが 'data:image/png;base64,xxxx' の形式を想定
                if "base64," in image_data:
                    payload = image_data.split("base64,", 1)[1]
                    await live_processor.画像送信(payload)
                else:
                    logger.warning("無効な画像データ形式です。base64エンコードされた文字列が必要です。")
            except Exception as e:
                logger.error(f"LiveAIへの画像送信に失敗: {e}")
        else:
            logger.warning("Liveプロセッサが見つからないため、画像を破棄します。")

    async def _handle_agent_command(self, agent_number: int, command: str):
        """エージェントコマンドの処理"""
        logger.info(f"エージェント{agent_number}へのコマンド処理: {command[:50]}...")
        agent_processors = getattr(self.connection, "code_agent_processors", [])

        if not (isinstance(agent_number, int) and 1 <= agent_number <= len(agent_processors)):
            logger.warning(f"無効なエージェント番号です: {agent_number}")
            return

        agent = agent_processors[agent_number - 1]
        if agent:
            try:
                受信データ = {
                    "メッセージ識別": "input_text",
                    "メッセージ内容": command,
                    "チャンネル": agent_number,
                }
                await agent.コード要求(受信データ)
            except Exception as e:
                logger.error(f"エージェント{agent_number}へのコマンド要求に失敗: {e}")
        else:
            logger.warning(f"エージェント{agent_number}のプロセッサが見つかりません。")
