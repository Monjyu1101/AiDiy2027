# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""
AIコア 音声認識サブ
非同期キューで音声を受け取り、認識結果をWebSocketへ返す
"""

import asyncio
import io
import wave
from typing import Optional

from log_config import get_logger

logger = get_logger(__name__)

# 音声処理定数
SAMPLE_RATE = 16000
CHANNELS = 1

try:
    import speech_recognition as sr
except Exception:
    sr = None


class Recognition:
    """音声認識処理クラス（キュー処理）"""

    def __init__(self, セッションID: str, 接続=None, 保存関数=None):
        self.セッションID = セッションID
        self.接続 = 接続
        self.保存関数 = 保存関数
        self.is_alive = False
        self.音声認識処理Ｑ = asyncio.Queue()
        self.worker_task: Optional[asyncio.Task] = None
        self.言語 = "ja-JP"

    async def 開始(self):
        if sr is None:
            logger.warning("speech_recognition が利用できません。音声認識を無効化します。")
            return
        self.is_alive = True
        if self.worker_task is None or self.worker_task.done():
            self.worker_task = asyncio.create_task(self._音声認識ワーカー())

    async def 終了(self):
        self.is_alive = False
        if self.worker_task and not self.worker_task.done():
            self.worker_task.cancel()
            try:
                await self.worker_task
            except asyncio.CancelledError:
                pass

    async def 音声認識要求(self, message_type: str, audio_bytes: bytes, プロジェクトパス=None):
        if not audio_bytes:
            return
        await self.音声認識処理Ｑ.put({
            "audio_bytes": audio_bytes,
            "message_type": message_type,
            "プロジェクトパス": プロジェクトパス
        })

    async def _音声認識ワーカー(self):
        while self.is_alive:
            try:
                try:
                    item = await asyncio.wait_for(self.音声認識処理Ｑ.get(), timeout=1.0)
                except asyncio.TimeoutError:
                    await asyncio.sleep(0.2)
                    continue

                audio_bytes = item.get("audio_bytes") if isinstance(item, dict) else None
                message_type = item.get("message_type") if isinstance(item, dict) else "input"
                if audio_bytes:
                    text = await self._音声をテキストに変換(audio_bytes)
                    if text:
                        await self._結果送信(text, message_type, プロジェクトパス=item.get("プロジェクトパス"))
                self.音声認識処理Ｑ.task_done()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"音声認識ワーカー処理エラー: {e}")
                await asyncio.sleep(0.2)

    async def _音声をテキストに変換(self, audio_data: bytes) -> str:
        if sr is None:
            return ""
        try:
            recognizer = sr.Recognizer()
            audio_io = io.BytesIO()
            with wave.open(audio_io, "wb") as wav_file:
                wav_file.setnchannels(CHANNELS)
                wav_file.setsampwidth(2)  # 16bit
                wav_file.setframerate(SAMPLE_RATE)
                wav_file.writeframes(audio_data)
            audio_io.seek(0)

            with sr.AudioFile(audio_io) as source:
                audio = recognizer.record(source)
                text = recognizer.recognize_google(audio, language=self.言語)
                return text
        except sr.UnknownValueError:
            return ""
        except Exception as e:
            logger.warning(f"音声認識エラー: {e}")
            return ""

    async def _結果送信(self, text: str, message_type: str, プロジェクトパス=None):
        if not self.接続 or not text:
            return
        if callable(self.保存関数):
            try:
                self.保存関数(
                    プロジェクトパス=プロジェクトパス,
                    セッションID=self.セッションID,
                    チャンネル="0",
                    メッセージ識別=f"recognition_{message_type}",
                    メッセージ内容=text,
                    ファイル名=None,
                    サムネイル画像=None
                )
            except Exception:
                pass
        await self.接続.send_json({
            "プロジェクトパス": プロジェクトパス,
            "セッションID": self.セッションID,
            "チャンネル": "0",
            "メッセージ識別": f"recognition_{message_type}",
            "メッセージ内容": text,
            "ファイル名": None,
            "サムネイル画像": None
        })
