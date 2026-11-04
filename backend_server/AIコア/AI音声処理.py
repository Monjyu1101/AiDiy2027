# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""
AIコア 音声処理（旧実装寄せ）
入力音声のバッファリング、音声レベル解析、認識投入を担当
"""

import asyncio
import base64
import json
import time
from typing import Tuple

import numpy as np

from AIコア.AI履歴コンテキスト import セッション履歴パス
from log_config import get_logger

logger = get_logger(__name__)

# 音声処理定数
LIVE_VOICE_LEVEL = 2500

# 音声バッファオーバーフロー防止定数
VOICE_BUFFER_FAILSAFE_SECONDS = 60
VOICE_BUFFER_FAILSAFE_COUNT = 2000

# 音声認識遅延時間定数
VOICE_INPUT_RECOGNITION_DELAY_SECONDS = 2.0
VOICE_OUTPUT_RECOGNITION_DELAY_SECONDS = 3.0

# 1秒相当の最小バイト数（16kHz, 16bit, mono）
MIN_AUDIO_BYTES = 32000


def 初期化_音声データ():
    """接続ごとの音声バッファ初期化"""
    return {
        "音声入力データ": {
            "音声レベルバッファ": [0] * 50,
            "音声入力開始時刻": None,
            "音声入力最終時刻": None,
            "音声入力バッファ": [],
            "音声認識遅延": VOICE_INPUT_RECOGNITION_DELAY_SECONDS,
            "音声入力中": False,
        },
        "音声出力データ": {
            "音声出力開始時刻": None,
            "音声出力最終時刻": None,
            "音声出力バッファ": [],
            "音声認識遅延": VOICE_OUTPUT_RECOGNITION_DELAY_SECONDS,
        }
    }


def _音声レベル分析(音声データ: bytes, 音声レベルバッファ: list) -> Tuple[float, bool]:
    """音声レベル分析（旧実装同等）"""
    try:
        input_data = np.abs(np.frombuffer(音声データ, dtype=np.int16))
        if len(input_data) == 0:
            return 0.0, False

        voice_level = float(np.max(input_data))
        音声レベルバッファ.pop(0)
        音声レベルバッファ.append(voice_level)
        avg_voice_level = sum(音声レベルバッファ) / len(音声レベルバッファ)
        dynamic_threshold = avg_voice_level + LIVE_VOICE_LEVEL
        is_voice = voice_level > dynamic_threshold
        return voice_level, is_voice
    except Exception as e:
        logger.error(f"音声レベル分析エラー: {e}")
        return 0.0, False


async def _send_cancel_audio_user(接続):
    """人間音声検出時に音声出力停止を通知（旧実装寄せ）"""
    try:
        if 接続:
            # クライアント側の再生停止（音声ソケットへ送信）
            await 接続.send_to_channel("audio", {
                "セッションID": 接続.セッションID,
                "メッセージ識別": "cancel_audio",
                "メッセージ内容": "人間の音声を検出しました。AI音声再生を停止します。",
                "ファイル名": None,
                "サムネイル画像": None
            })
    except Exception as e:
        logger.error(f"cancel_audio送信エラー: {e}")


async def 音声入力データ処理(接続, 音声データ: bytes):
    """音声入力データの処理（旧実装寄せ）"""
    if not getattr(接続, "voice_enabled", True) or not getattr(接続, "audio_data", None):
        return
    try:
        current_time = time.time()
        data = 接続.audio_data["音声入力データ"]
        入力プロジェクトパス = セッション履歴パス(接続)

        _, is_voice = _音声レベル分析(音声データ, data["音声レベルバッファ"])
        if is_voice:
            data["音声入力最終時刻"] = current_time
            if len(data["音声入力バッファ"]) == 0:
                if not data.get("音声入力中"):
                    data["音声入力中"] = True
                await _send_cancel_audio_user(接続)

        # Provider の VAD には小声・発話途中・末尾の無音も含めて連続PCMを渡す。
        # 独自音量判定は音声認識バッファと再生割り込みにだけ使い、転送を止めない。
        try:
            live = getattr(接続, "live_processor", None)
            ai = getattr(live, "AIインスタンス", None)
            if ai and hasattr(ai, "音声送信"):
                await ai.音声送信(音声データ)
        except Exception as e:
            logger.warning(f"LiveAI音声送信エラー: {e}")

        if data.get("音声入力最終時刻") and (
            current_time - data["音声入力最終時刻"] <= data["音声認識遅延"]
        ):
            if len(data["音声入力バッファ"]) == 0:
                data["音声入力開始時刻"] = current_time
                data["プロジェクトパス"] = 入力プロジェクトパス
            elif data.get("プロジェクトパス") != 入力プロジェクトパス:
                # 切替をまたいだ音声を、現在のプロジェクトへ推測で割り当てない。
                data["プロジェクトパス"] = None
            data["音声入力バッファ"].append(音声データ)

    except Exception as e:
        logger.error(f"音声入力データ処理エラー: {e}")


async def 統合音声分離ワーカー(接続):
    """入力/出力のバッファ監視（旧実装寄せ）"""
    try:
        while 接続 and getattr(接続, "voice_enabled", True) and 接続.is_connected:
            try:
                current_time = time.time()

                input_data = 接続.audio_data["音声入力データ"]
                input_buffer_ready = (
                    input_data["音声入力バッファ"]
                    and input_data.get("音声入力最終時刻")
                    and current_time - input_data["音声入力最終時刻"] > input_data["音声認識遅延"]
                )
                input_buffer_overflow = (
                    input_data["音声入力バッファ"]
                    and (
                        (
                            input_data.get("音声入力開始時刻")
                            and current_time - input_data["音声入力開始時刻"] > VOICE_BUFFER_FAILSAFE_SECONDS
                        )
                        or len(input_data["音声入力バッファ"]) > VOICE_BUFFER_FAILSAFE_COUNT
                    )
                )

                if input_buffer_ready or input_buffer_overflow:
                    audio_buffer = input_data["音声入力バッファ"].copy()
                    プロジェクトパス = input_data.pop("プロジェクトパス", None)
                    input_data["音声入力開始時刻"] = None
                    input_data["音声入力最終時刻"] = None
                    input_data["音声入力バッファ"] = []
                    if input_data.get("音声入力中"):
                        input_data["音声入力中"] = False

                    combined_audio = b"".join(audio_buffer)
                    if len(combined_audio) >= MIN_AUDIO_BYTES and 接続.recognition_processor:
                        await 接続.recognition_processor.音声認識要求("input", combined_audio, プロジェクトパス=プロジェクトパス)

                    # 音声入力バッファクリア完了 → 音声出力再開
                    if 接続.output_audio_paused:
                        接続.output_audio_paused = False
                        logger.info("音声出力再開")

                output_data = 接続.audio_data["音声出力データ"]
                output_buffer_ready = (
                    output_data["音声出力バッファ"]
                    and output_data.get("音声出力最終時刻")
                    and current_time - output_data["音声出力最終時刻"] > output_data["音声認識遅延"]
                )
                output_buffer_overflow = (
                    output_data["音声出力バッファ"]
                    and (
                        (
                            output_data.get("音声出力開始時刻")
                            and current_time - output_data["音声出力開始時刻"] > VOICE_BUFFER_FAILSAFE_SECONDS
                        )
                        or len(output_data["音声出力バッファ"]) > VOICE_BUFFER_FAILSAFE_COUNT
                    )
                )

                if output_buffer_ready or output_buffer_overflow:
                    audio_buffer = output_data["音声出力バッファ"].copy()
                    output_data["音声出力開始時刻"] = None
                    output_data["音声出力最終時刻"] = None
                    output_data["音声出力バッファ"] = []

                    # 1秒のゼロ値（無音）パケットをフロントに送信してビジュアライザーをクリア
                    # 16kHz, 16bit, mono = 32000 bytes/sec
                    silence_duration_bytes = 32000  # 1秒分
                    silence_packet = b'\x00' * silence_duration_bytes
                    silence_base64 = base64.b64encode(silence_packet).decode("utf-8")
                    
                    try:
                        await 接続.send_to_channel("audio", {
                            "セッションID": 接続.セッションID,
                            "メッセージ識別": "output_audio",
                            "メッセージ内容": "audio/pcm",
                            "ファイル名": silence_base64,
                            "サムネイル画像": None
                        })
                        logger.debug(f"無音パケット送信（ビジュアライザークリア用）")
                    except Exception as e:
                        logger.warning(f"無音パケット送信エラー: {e}")

                    combined_audio = b"".join(audio_buffer)
                    if len(combined_audio) >= MIN_AUDIO_BYTES and 接続.recognition_processor:
                        # LiveAI自身が音声字幕を返す場合は、二重表示を避ける。
                        live = getattr(接続, "live_processor", None)
                        live_ai = None
                        if live and getattr(live, "AIインスタンス", None):
                            live_ai = getattr(live.AIインスタンス, "LIVE_AI", None)
                        字幕対応 = getattr(getattr(live, "AIインスタンス", None), "音声出力字幕対応", False)
                        if live_ai != "openai_live" and not 字幕対応:
                            await 接続.recognition_processor.音声認識要求("output", combined_audio)
                await asyncio.sleep(0.25 if _音声バッファあり(接続) else 0.50)

            except Exception as e:
                logger.error(f"統合音声分離ワーカー処理エラー: {e}")
                await asyncio.sleep(1.0)
    except asyncio.CancelledError:
        raise
    except Exception as e:
        logger.error(f"統合音声分離ワーカー:エラー({e})")


def _音声バッファあり(接続) -> bool:
    try:
        input_buf = 接続.audio_data["音声入力データ"]["音声入力バッファ"]
        output_buf = 接続.audio_data["音声出力データ"]["音声出力バッファ"]
        return bool(input_buf or output_buf)
    except Exception:
        return False
