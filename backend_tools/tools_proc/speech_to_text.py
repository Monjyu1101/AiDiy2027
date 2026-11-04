# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""
音声認識モジュール

base64 エンコード or ファイルパス指定の WAV 音声データ（16kHz モノラル）を受け取り、
テキストに変換する。

対応 provider:
    "auto"   — speech_recognition（Google Web Speech API、無料）
    "openai" — OpenAI Whisper API（AiDiy_key.json の openai_key_id が必要）
"""

import base64
import io
import json
import os
import tempfile
import wave
from pathlib import Path
from typing import Optional

try:
    import speech_recognition as sr
except Exception:
    sr = None


class SpeechToTextError(Exception):
    """音声認識エラー"""
    pass


class SpeechToText:
    """
    音声認識クラス

    provider パラメータ:
        "auto"   — speech_recognition（Google Web Speech API、デフォルト・無料）
        "openai" — OpenAI Whisper API

    model パラメータ:
        "auto" — プロバイダー既定モデル（デフォルト）
                 openai の場合は "whisper-1"
    """

    # AiDiy_key.json へのパス（backend_tools 起点）
    _KEY_CONFIG_REL = "../_config/AiDiy_key.json"

    auto_provider = "google"

    DEFAULT_OPENAI_MODEL = "whisper-1"

    # ------------------------------------------------------------------ #
    # API キー解決（text_to_speech 同様、AiDiy_key.json のみ）
    # ------------------------------------------------------------------ #

    @staticmethod
    def _is_valid_key(key: str) -> bool:
        return bool(key) and not key.startswith("<")

    def _read_key_from_config(self, key_name: str) -> str:
        """AiDiy_key.json から指定キーを読み出す"""
        config_path = Path(__file__).resolve().parent.parent / self._KEY_CONFIG_REL
        try:
            if not config_path.exists():
                return ""
            with open(config_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            value = data.get(key_name, "")
            return value.strip() if isinstance(value, str) else ""
        except (json.JSONDecodeError, OSError):
            return ""

    def _get_openai_api_key(self) -> Optional[str]:
        """OpenAI API キーを AiDiy_key.json から取得"""
        key = self._read_key_from_config("openai_key_id")
        if self._is_valid_key(key):
            return key
        return None

    # ------------------------------------------------------------------ #
    # 音声認識
    # ------------------------------------------------------------------ #

    def recognize(
        self,
        base64_wav16k: Optional[str] = None,
        file_path: Optional[str] = None,
        provider: str = "auto",
        model: str = "auto",
    ) -> dict:
        """
        WAV 音声をテキストに変換する（base64 またはファイルパス指定）。

        Args:
            base64_wav16k: 16kHz モノラル WAV の base64 文字列（file_path と排他）
            file_path: WAV ファイルのパス（base64_wav16k と排他）
            provider: "auto" / "openai"（デフォルト "auto"）
            model: "auto" のみ（デフォルト "auto"）

        Returns:
            {
                "recognition_text": str,
                "provider": str,
                "model": str,
                "audio_bytes_length": int,
                "source": str,
                "engine_note": str,
            }
        """
        if base64_wav16k and file_path:
            raise SpeechToTextError(
                "base64_wav16k と file_path は同時に指定できません"
            )

        if file_path:
            if not os.path.isfile(file_path):
                raise SpeechToTextError(f"ファイルが見つかりません: '{file_path}'")
            with open(file_path, "rb") as f:
                audio_bytes = f.read()
            if len(audio_bytes) == 0:
                raise SpeechToTextError("ファイルの音声データが空です")
            source = file_path
        elif base64_wav16k:
            if not base64_wav16k.strip():
                raise SpeechToTextError("base64_wav16k が空です")
            try:
                audio_bytes = base64.b64decode(base64_wav16k.strip())
            except (base64.binascii.Error, ValueError) as e:
                raise SpeechToTextError(f"base64 デコードに失敗しました: {e}") from e
            if len(audio_bytes) == 0:
                raise SpeechToTextError("デコード後の音声データが空です")
            source = "base64"
        else:
            raise SpeechToTextError(
                "base64_wav16k または file_path のいずれかが必要です"
            )

        provider = provider.strip().lower()
        if provider not in ("auto", "google", "openai"):
            raise SpeechToTextError(
                f"未対応の provider です: '{provider}'（auto / google / openai のみ）"
            )

        model = model.strip().lower()
        if model not in ("auto",):
            raise SpeechToTextError(
                f"未対応の model です: '{model}'（auto のみ）"
            )

        engine_note = ""

        if provider == "auto":
            provider = self.auto_provider

        if provider == "google":
            recognition_text = self._認識_auto(audio_bytes)
            resolved_model = "google_default"
            used_provider = "google"
        else:
            resolved_model = self.DEFAULT_OPENAI_MODEL
            if self._事前チェック_音声あり(audio_bytes):
                recognition_text = self._認識_openai(audio_bytes, resolved_model)
                used_provider = "openai"
            else:
                recognition_text = ""
                used_provider = "openai"
                engine_note = "無音判定によりOpenAI呼び出しをスキップ"

        return {
            "recognition_text": recognition_text,
            "provider": used_provider,
            "model": resolved_model,
            "audio_bytes_length": len(audio_bytes),
            "source": source,
            "engine_note": engine_note,
        }

    # ------------------------------------------------------------------ #
    # 事前チェック（openai 課金前の無音判定）
    # ------------------------------------------------------------------ #

    _事前チェック秒数 = 30
    _サンプルレート = 16000
    _サンプル幅 = 2  # 16bit

    def _先頭秒数切り出し(self, audio_data: bytes, 秒数: int) -> bytes:
        """WAV の先頭 N 秒を切り出して返す"""
        try:
            with wave.open(io.BytesIO(audio_data), "rb") as wav_in:
                framerate = wav_in.getframerate()
                sampwidth = wav_in.getsampwidth()
                nchannels = wav_in.getnchannels()
                max_frames = framerate * 秒数
                total_frames = wav_in.getnframes()
                read_frames = min(max_frames, total_frames)
                pcm = wav_in.readframes(read_frames)

            buf = io.BytesIO()
            with wave.open(buf, "wb") as wav_out:
                wav_out.setnchannels(nchannels)
                wav_out.setsampwidth(sampwidth)
                wav_out.setframerate(framerate)
                wav_out.writeframes(pcm)
            return buf.getvalue()
        except Exception:
            # WAV 解析不能なら先頭バイト列を簡易計算で切り出す
            header_size = 44
            max_bytes = 秒数 * self._サンプルレート * self._サンプル幅
            total = len(audio_data) - header_size
            if total <= 0:
                return audio_data
            return audio_data[:header_size + min(max_bytes, total)]

    def _事前チェック_音声あり(self, audio_data: bytes) -> bool:
        """先頭 N 秒を speech_recognition で解析し、音声があれば True"""
        if sr is None:
            return True  # speech_recognition 不在時はスキップ不可のため通す
        try:
            truncated = self._先頭秒数切り出し(audio_data, self._事前チェック秒数)
            text = self._認識_auto(truncated)
            return bool(text)
        except Exception:
            return True  # チェック失敗時は安全側に倒して通す

    # ------------------------------------------------------------------ #
    # auto: speech_recognition
    # ------------------------------------------------------------------ #

    def _認識_auto(self, audio_data: bytes) -> str:
        """speech_recognition + Google Web Speech API"""
        if sr is None:
            raise SpeechToTextError(
                "speech_recognition ライブラリが利用できません。"
                "pip install SpeechRecognition で導入してください。"
            )
        try:
            recognizer = sr.Recognizer()
            audio_io = io.BytesIO(audio_data)
            with sr.AudioFile(audio_io) as source:
                audio = recognizer.record(source)
                text = recognizer.recognize_google(audio, language="ja-JP")
                return text
        except sr.UnknownValueError:
            return ""
        except Exception as e:
            raise SpeechToTextError(f"音声認識エラー: {e}") from e

    # ------------------------------------------------------------------ #
    # openai: OpenAI Whisper API
    # ------------------------------------------------------------------ #

    def _認識_openai(self, audio_data: bytes, model: str) -> str:
        """OpenAI Whisper API"""
        api_key = self._get_openai_api_key()
        if not api_key:
            raise SpeechToTextError(
                "OpenAI API キーが設定されていません。"
                "AiDiy_key.json の openai_key_id を設定してください。"
            )

        try:
            from openai import OpenAI
        except ImportError:
            raise SpeechToTextError(
                "openai パッケージがインストールされていません。pip install openai で導入してください。"
            )

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            tmp.write(audio_data)
            wav_path = tmp.name

        try:
            client = OpenAI(api_key=api_key, timeout=60, max_retries=1)
            try:
                with open(wav_path, "rb") as audio_file:
                    transcription = client.audio.transcriptions.create(
                        model=model,
                        file=audio_file,
                        language="ja",
                        response_format="text",
                    )
                if isinstance(transcription, str):
                    return transcription.strip()
                text = getattr(transcription, "text", "")
                return text.strip() if text else ""
            finally:
                close = getattr(client, "close", None)
                if callable(close):
                    close()
        except Exception as e:
            raise SpeechToTextError(f"OpenAI 音声認識エラー: {e}") from e
        finally:
            try:
                os.remove(wav_path)
            except OSError:
                pass
