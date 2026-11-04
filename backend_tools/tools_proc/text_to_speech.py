# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""
テキスト音声合成モジュール

テキストを受け取り、MP3 音声データを合成する。
対応 provider: edge, openai, gemini, freeai
"""

import asyncio
import base64
import json
import os
import re
import shutil
import struct
import subprocess
import tempfile
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from log_config import get_logger

logger = get_logger(__name__)


class TextToSpeechError(Exception):
    """テキスト音声合成エラー"""
    pass


class TextToSpeech:
    """
    テキスト音声合成クラス

    provider:
        "auto"   — まず edge を使い、失敗時は freeai へフォールバック
        "edge"   — Microsoft Edge ニューラル TTS
        "gemini" — Google Gemini TTS（GEMINI_API_KEY が必要）
        "freeai" — FreeAI TTS（FREEAI_API_KEY が必要、実体は Gemini）
        "openai" — OpenAI TTS（OPENAI_API_KEY が必要）

    自動フォールバックチェーン（FALLBACK_CHAIN）:
        auto   → edge → freeai
        edge   → edge → freeai
        freeai → gemini → edge
        gemini → freeai → edge
        openai → edge

    キー無効の候補は事前にスキップし、合成失敗時もチェーンに沿って次の候補へ進む。
    """

    # 自動フォールバック順（左から順に試す）。
    FALLBACK_CHAIN: dict[str, list[str]] = {
        "auto":   ["edge", "freeai"],
        "edge":   ["edge", "freeai"],
        "openai": ["openai", "edge"],
        "gemini": ["gemini", "freeai", "edge"],
        "freeai": ["freeai", "gemini", "edge"],
    }

    auto_provider = "edge"
    auto_voice = "female"

    DEFAULT_OUTPUT_DIR = "backend_server/temp/output"

    # デフォルト音声（provider 別）
    DEFAULT_VOICES = {
        "edge":   "ja-JP-NanamiNeural",
        "openai": "marin",
        "gemini": "Zephyr",
        "freeai": "Zephyr",
    }

    # Edge: voice="female" / "male" を実音声名へ変換するためのエイリアス。
    # full locale（例: en-us）→ base language（例: en）の順で引く。
    # 未登録言語は "ja" にフォールバック。
    EDGE_GENDER_VOICES = {
        "ja":    {"female": "ja-JP-NanamiNeural",   "male": "ja-JP-KeitaNeural"},
        "ja-jp": {"female": "ja-JP-NanamiNeural",   "male": "ja-JP-KeitaNeural"},
        "en":    {"female": "en-US-AvaNeural",      "male": "en-US-AndrewNeural"},
        "en-us": {"female": "en-US-AvaNeural",      "male": "en-US-AndrewNeural"},
        "fr":    {"female": "fr-FR-DeniseNeural",   "male": "fr-FR-HenriNeural"},
        "fr-fr": {"female": "fr-FR-DeniseNeural",   "male": "fr-FR-HenriNeural"},
        "de":    {"female": "de-DE-KatjaNeural",    "male": "de-DE-ConradNeural"},
        "de-de": {"female": "de-DE-KatjaNeural",    "male": "de-DE-ConradNeural"},
        "es":    {"female": "es-ES-XimenaNeural",   "male": "es-ES-AlvaroNeural"},
        "es-es": {"female": "es-ES-XimenaNeural",   "male": "es-ES-AlvaroNeural"},
        "pt":    {"female": "pt-BR-FranciscaNeural","male": "pt-BR-AntonioNeural"},
        "pt-br": {"female": "pt-BR-FranciscaNeural","male": "pt-BR-AntonioNeural"},
        "it":    {"female": "it-IT-IsabellaNeural", "male": "it-IT-DiegoNeural"},
        "it-it": {"female": "it-IT-IsabellaNeural", "male": "it-IT-DiegoNeural"},
        "ru":    {"female": "ru-RU-SvetlanaNeural", "male": "ru-RU-DmitryNeural"},
        "ru-ru": {"female": "ru-RU-SvetlanaNeural", "male": "ru-RU-DmitryNeural"},
        "nl":    {"female": "nl-NL-ColetteNeural",  "male": "nl-NL-MaartenNeural"},
        "nl-nl": {"female": "nl-NL-ColetteNeural",  "male": "nl-NL-MaartenNeural"},
        "zh":    {"female": "zh-CN-XiaoxiaoNeural", "male": "zh-CN-YunxiNeural"},
        "zh-cn": {"female": "zh-CN-XiaoxiaoNeural", "male": "zh-CN-YunxiNeural"},
        "ko":    {"female": "ko-KR-SunHiNeural",    "male": "ko-KR-InJoonNeural"},
        "ko-kr": {"female": "ko-KR-SunHiNeural",    "male": "ko-KR-InJoonNeural"},
        "ar":    {"female": "ar-EG-SalmaNeural",    "male": "ar-EG-ShakirNeural"},
        "ar-eg": {"female": "ar-EG-SalmaNeural",    "male": "ar-EG-ShakirNeural"},
    }
    EDGE_SUPPORTED_LANGUAGE_CODES = ("en", "fr", "de", "es", "pt", "it", "ru", "nl", "zh", "ko", "ar", "ja")

    # OpenAI: voice="female" / "male" の実音声名（言語非依存）
    OPENAI_GENDER_VOICES = {
        "female": "marin",
        "male":   "echo",
    }

    # Gemini / FreeAI: voice="female" / "male" の実音声名（言語非依存）
    # 出典: https://docs.cloud.google.com/text-to-speech/docs/gemini-tts
    GEMINI_GENDER_VOICES = {
        "female": "Zephyr",
        "male":   "Charon",
    }

    # Gemini 利用可能 voice 一覧（参考用）
    GEMINI_FEMALE_VOICES = [
        "Achernar", "Aoede", "Autonoe", "Callirrhoe", "Despina", "Erinome",
        "Gacrux", "Kore", "Laomedeia", "Leda", "Pulcherrima", "Sulafat",
        "Vindemiatrix", "Zephyr",
    ]
    GEMINI_MALE_VOICES = [
        "Achird", "Algenib", "Algieba", "Alnilam", "Charon", "Enceladus",
        "Fenrir", "Iapetus", "Orus", "Puck", "Rasalgethi", "Sadachbia",
        "Sadaltager", "Schedar", "Umbriel", "Zubenelgenubi",
    ]

    # OpenAI デフォルト
    DEFAULT_OPENAI_MODEL = "gpt-4o-mini-tts"
    DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1"

    # Gemini デフォルト
    DEFAULT_GEMINI_MODEL = "gemini-2.5-flash-preview-tts"
    DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"
    GEMINI_SAMPLE_RATE = 24000
    GEMINI_CHANNELS = 1
    GEMINI_SAMPLE_WIDTH = 2  # 16-bit PCM

    # JSON の空文字列（speech_text == ""）は、1秒の無音音声として扱う。
    # 本文中のダブルクォートには特別な意味を持たせない。
    PAUSE_SECONDS = 1.0

    PROVIDER_KEYS = {
        "openai": "openai_key_id",
        "gemini": "gemini_key_id",
        "freeai": "freeai_key_id",
    }

    # AiDiy_key.json へのパス（backend_tools 起点）
    _KEY_CONFIG_REL = "../_config/AiDiy_key.json"
    _TTS_CONFIG_REL = "../_config/mcp_text_to_speech.json"
    _LEGACY_TTS_CONFIG_REL = "../_config/aidiy_text_to_speech.json"

    # ------------------------------------------------------------------ #
    # 起動時 ffmpeg プローブ
    # ------------------------------------------------------------------ #

    def __init__(self) -> None:
        # 起動時に ffmpeg -version で利用可否を確認し、結果をキャッシュする。
        # 不在時は self.ffmpeg_path = None となり、mp3↔wav 変換 / atempo は黙ってスキップされる。
        self.ffmpeg_info: dict[str, Any] = self._probe_ffmpeg()
        self.ffmpeg_path: Optional[str] = (
            self.ffmpeg_info.get("resolved") if self.ffmpeg_info.get("ok") else None
        )
        # 発音辞書 JSON が削除されていたら起動時に再生成する。
        config_path = self._tts_config_path()
        if not config_path.exists():
            try:
                self._write_default_tts_config(config_path)
                logger.info(f"TTS 発音辞書が見つからなかったので既定値で再生成: {config_path}")
            except OSError as e:
                logger.warning(f"TTS 発音辞書の再生成に失敗: {config_path} ({e})")

    @staticmethod
    def _probe_ffmpeg() -> dict[str, Any]:
        """ffmpeg -version を起動時に確認する（ffmpeg_control._probe_versions と同手順）"""
        exe = "ffmpeg"
        resolved = shutil.which(exe)
        if not resolved:
            logger.warning(f"{exe} を解決できません: PATH 上に見つかりません。mp3↔wav 変換は無効化されます")
            return {"ok": False, "configured": exe, "error": "not found in PATH"}
        try:
            proc = subprocess.run(
                [resolved, "-version"],
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                timeout=10,
                check=False,
            )
        except subprocess.TimeoutExpired:
            logger.warning(f"{exe} -version タイムアウト: {resolved}")
            return {"ok": False, "configured": exe, "resolved": resolved, "error": "timeout"}
        except OSError as e:
            logger.warning(f"{exe} -version 起動失敗: {e}")
            return {"ok": False, "configured": exe, "resolved": resolved, "error": str(e)}

        stdout_text = (proc.stdout or b"").decode("utf-8", errors="replace")
        first_line = stdout_text.splitlines()[0] if stdout_text else ""
        ok = proc.returncode == 0 and bool(first_line)
        if ok:
            logger.info(f"{exe} OK: {first_line}")
        else:
            logger.warning(
                f"{exe} -version 失敗 (rc={proc.returncode}): {resolved}"
            )
        return {
            "ok": ok,
            "configured": exe,
            "resolved": resolved,
            "returncode": proc.returncode,
            "version": first_line,
        }

    # 読み上げ用の用語変換辞書。
    # 入力テキスト自体は変えず、音声合成へ渡す直前だけ適用する。
    # from には文字列、または同じ読みを共有する複数表記をリストで渡せる
    # （例: (["AiDiy", "aidiy", "AIDIY"], "アイディ")）。ロード時に flatten する。
    # "_" / "-" のような区切り記号は先頭に置き、識別子分解の前処理として効かせる。
    DEFAULT_PRONUNCIATION_DICTIONARY = [
        ("_", " "),
        ("-", " "),
        ("本須麗乃", "もとすうらの"),
        ("幼馴染", "おさななじみ"),
        ("束の間", "つかのま"),
        ("側仕え", "そばづかえ"),
        ("労い", "ねぎらい"),
        ("神具", "かみぐ"),
        ("王城", "おうじょう"),
        (["AiDiy", "aidiy", "AIDIY"], "アイディ"),
        ("subprocess", "サブプロセス"),
        ("横展開", "よこてんかい"),
        ("FastAPI", "ファスト エーピーアイ"),
        ("PostgreSQL", "ポストグレス キューエル"),
        ("OpenAI", "オープン エーアイ"),
        ("OpenCode", "オープンコード"),
        ("Code CLI", "コード シーエルアイ"),
        ("WebSocket", "ウェブソケット"),
        ("GitHub", "ギットハブ"),
        (["Knowledge", "knowledge"], "ナレッジ"),
        ("SQLite", "エスキューライト"),
        ("Claude", "クロード"),
        (["Mythos", "mythos", "MYTHOS"], "ミソス"),
        (["Fable", "fable", "FABLE"], "フェーブル"),
        ("Copilot", "コパイロット"),
        ("Codex", "コーデックス"),
        ("Gemini", "ジェミニ"),
        (["Hermes", "hermes", "HERMES"], "エルメス"),
        ("Electron", "エレクトロン"),
        ("backend", "バックエンド"),
        ("frontend", "フロントエンド"),
        ("Vite", "ヴィート"),
        ("Vue", "ビュー"),
        ("JWT", "ジェイ ダブリュー ティー"),
        ("JSON", "ジェイソン"),
        ("HTML", "エイチティーエムエル"),
        ("HTTP", "エイチティーティーピー"),
        ("URL", "ユーアールエル"),
        ("API", "エーピーアイ"),
        ("CLI", "シーエルアイ"),
        ("MCP", "エムシーピー"),
        ("TTS", "ティーティーエス"),
        ("STT", "エスティーティー"),
        ("MP3", "エムピースリー"),
        ("DB", "データベース"),
        ("UI", "ユーアイ"),
        ("AI", "エーアイ"),
        ("VRMA", "ブイアールエムエー"),
        ("VRM", "ブイアールエム"),
    ]

    # ------------------------------------------------------------------ #
    # API キー解決
    # ------------------------------------------------------------------ #

    @staticmethod
    def _is_valid_key(key: str) -> bool:
        """キーが有効か判定（空文字列 / '<' 始まりは無効）"""
        return bool(key) and not key.startswith("<")

    def _get_api_key(self, provider: str) -> Optional[str]:
        """AiDiy_key.json から API キーを取得する。
        無効なキーの場合は None を返す。
        """
        json_key = self.PROVIDER_KEYS.get(provider, "")
        key = self._read_key_from_config(json_key)
        if self._is_valid_key(key):
            return key
        return None

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

    # ------------------------------------------------------------------ #
    # TTS 設定ファイル
    # ------------------------------------------------------------------ #

    def _tts_config_path(self) -> Path:
        return Path(__file__).resolve().parent.parent / self._TTS_CONFIG_REL

    def _legacy_tts_config_path(self) -> Path:
        return Path(__file__).resolve().parent.parent / self._LEGACY_TTS_CONFIG_REL

    def _default_pronunciation_config(self) -> dict:
        return {
            "version": 1,
            "description": (
                "mcp_text_to_speech の読み上げ用変換辞書。"
                " speech_text の原文は変えず、音声合成へ渡す直前だけ from を to に変換する。"
            ),
            "pronunciation_dictionary": [
                {"from": source, "to": target}
                for source, target in self.DEFAULT_PRONUNCIATION_DICTIONARY
            ],
        }

    def _write_default_tts_config(self, config_path: Path) -> None:
        config_path.parent.mkdir(parents=True, exist_ok=True)
        with open(config_path, "w", encoding="utf-8", newline="\n") as f:
            json.dump(self._default_pronunciation_config(), f, ensure_ascii=False, indent=2)
            f.write("\n")

    def _migrate_legacy_tts_config(self, config_path: Path) -> bool:
        legacy_path = self._legacy_tts_config_path()
        if config_path.exists() or not legacy_path.exists():
            return False
        try:
            config_path.parent.mkdir(parents=True, exist_ok=True)
            legacy_path.replace(config_path)
            logger.info(f"TTS 発音辞書を旧ファイル名から移行: {legacy_path} -> {config_path}")
            return True
        except OSError as e:
            logger.warning(f"TTS 発音辞書の移行に失敗: {legacy_path} -> {config_path} ({e})")
            return False

    @staticmethod
    def _expand_entry(sources, target) -> list[tuple[str, str]]:
        """from が単一文字列でもリストでも、(source, target) のリストへ展開する。
           target は空白も意味を持つ（"_" → " " など）。改行・タブのみ除去する。"""
        if isinstance(sources, str):
            sources_list = [sources]
        elif isinstance(sources, (list, tuple)):
            sources_list = list(sources)
        else:
            raise TextToSpeechError(
                "from は文字列または文字列リストで指定してください"
            )

        if not isinstance(target, str):
            raise TextToSpeechError("to は文字列で指定してください")

        target = target.strip("\r\n\t")
        pairs: list[tuple[str, str]] = []
        for s in sources_list:
            if not isinstance(s, str):
                raise TextToSpeechError("from の要素は文字列で指定してください")
            s = s.strip()
            if s and target:
                pairs.append((s, target))
        return pairs

    def _flatten_default_dictionary(self) -> list[tuple[str, str]]:
        """DEFAULT_PRONUNCIATION_DICTIONARY を flat な (source, target) リストへ展開する。"""
        flat: list[tuple[str, str]] = []
        for sources, target in self.DEFAULT_PRONUNCIATION_DICTIONARY:
            flat.extend(self._expand_entry(sources, target))
        return flat

    def _load_pronunciation_dictionary(self) -> list[tuple[str, str]]:
        """設定ファイルがあればそれを使い、なければデフォルトを書き出して使う"""
        config_path = self._tts_config_path()
        self._migrate_legacy_tts_config(config_path)
        if not config_path.exists():
            self._write_default_tts_config(config_path)
            return self._flatten_default_dictionary()

        try:
            with open(config_path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except (json.JSONDecodeError, OSError) as e:
            raise TextToSpeechError(
                f"TTS 設定ファイルの読み込みに失敗しました: {config_path} ({e})"
            ) from e

        raw_items = data.get("pronunciation_dictionary", [])
        if not isinstance(raw_items, list):
            raise TextToSpeechError(
                f"TTS 設定ファイルの pronunciation_dictionary は配列で指定してください: {config_path}"
            )

        dictionary: list[tuple[str, str]] = []
        for index, item in enumerate(raw_items, 1):
            if isinstance(item, dict):
                sources = item.get("from", "")
                target = item.get("to", "")
            elif isinstance(item, (list, tuple)) and len(item) == 2:
                sources, target = item
            else:
                raise TextToSpeechError(
                    f"TTS 変換辞書の {index} 件目は {{\"from\": ..., \"to\": ...}} 形式で指定してください"
                )

            try:
                dictionary.extend(self._expand_entry(sources, target))
            except TextToSpeechError as e:
                raise TextToSpeechError(
                    f"TTS 変換辞書の {index} 件目: {e}"
                ) from e

        return dictionary

    # ------------------------------------------------------------------ #
    # description 動的生成
    # ------------------------------------------------------------------ #

    PROVIDER_LIST = ["edge", "gemini", "freeai", "openai"]

    def get_description(self) -> str:
        available = []
        unavailable = []
        for p in self.PROVIDER_LIST:
            if p == "edge" or self._get_api_key(p) is not None:
                available.append(p)
            else:
                unavailable.append(p)
        desc = f"テキストを音声（MP3）に変換する。利用可能: {', '.join(available)}。"
        if unavailable:
            desc += f" 利用不可: {', '.join(unavailable)}（API キー未設定）。"
        desc += (
            f" Edge の female/male 自動解決は {', '.join(self.EDGE_SUPPORTED_LANGUAGE_CODES)} "
            "に対応。language=ja の場合、AiDiy、DB、API、MCP などのシステム用語は "
            "_config/mcp_text_to_speech.json の読み上げ用辞書で自動変換する。"
            " speech_text にJSONの空文字列を指定すると、1秒の無音音声を生成する。"
        )
        return desc

    # ------------------------------------------------------------------ #
    # 読み上げテキスト正規化
    # ------------------------------------------------------------------ #

    def normalize_for_speech(self, text: str, language: str = "ja") -> tuple[str, list[dict]]:
        """TTS に渡す直前の読み上げ用テキストへ変換する。

        現在の読み上げ辞書は日本語音声向けなので、英語など他言語では適用しない。
        """
        lang_key = (language or "ja").split("-")[0].lower() or "ja"
        if lang_key != "ja":
            return text, []

        normalized = text
        applied: list[dict] = []

        for source, target in self._load_pronunciation_dictionary():
            ascii_like = bool(re.search(r"^[A-Za-z0-9 +._-]+$", source))
            has_alnum = bool(re.search(r"[A-Za-z0-9]", source))
            if ascii_like and has_alnum:
                pattern = re.compile(
                    rf"(?<![A-Za-z0-9_]){re.escape(source)}(?![A-Za-z0-9_])"
                )
                normalized, count = pattern.subn(target, normalized)
            else:
                count = normalized.count(source)
                if count:
                    normalized = normalized.replace(source, target)

            if count:
                applied.append({
                    "from": source,
                    "to": target,
                    "count": count,
                })

        return normalized, applied
    # ------------------------------------------------------------------ #
    # 音声合成（dispatch）
    # ------------------------------------------------------------------ #

    # ratio の None / 0 / "auto" は入口では確定せず、実際に使用する
    # provider ごとの既定値として解釈する。
    DEFAULT_RATIO_AUTO_BY_PROVIDER = {
        "edge": 1.2,
        "openai": 1.2,
        "gemini": 1.1,
        "freeai": 1.1,
    }
    RATIO_MIN = 0.5
    RATIO_MAX = 2.0

    @classmethod
    def _resolve_ratio_for_provider(cls, ratio: Any, provider: str) -> float:
        """ratio を provider ごとの意味で解釈する。

           - None / 0 / "auto" は provider ごとの既定値
             edge/openai=1.2、gemini/freeai=1.1
           - 1 は速度調整なし
           - それ以外は RATIO_MIN..RATIO_MAX（0.5..2.0）に clamp
        """
        if ratio is None:
            return cls.DEFAULT_RATIO_AUTO_BY_PROVIDER.get(provider, 1.0)
        if isinstance(ratio, str):
            raw = ratio.strip().lower()
            if raw in ("", "auto"):
                return cls.DEFAULT_RATIO_AUTO_BY_PROVIDER.get(provider, 1.0)
            ratio = raw
        try:
            value = float(ratio)
        except (TypeError, ValueError):
            return cls.DEFAULT_RATIO_AUTO_BY_PROVIDER.get(provider, 1.0)
        if value == 0:
            return cls.DEFAULT_RATIO_AUTO_BY_PROVIDER.get(provider, 1.0)
        if value == 1:
            return 1.0
        if value < cls.RATIO_MIN:
            return cls.RATIO_MIN
        if value > cls.RATIO_MAX:
            return cls.RATIO_MAX
        return value

    @staticmethod
    def _edge_rate_str(ratio: float) -> str:
        """edge_tts の rate 文字列（例: 1.2 → '+20%'、0.8 → '-20%'）"""
        pct = int(round((ratio - 1.0) * 100))
        sign = "+" if pct >= 0 else ""
        return f"{sign}{pct}%"

    @staticmethod
    def _detect_audio_format(audio_bytes: bytes) -> str:
        """先頭バイトから wav / mp3 を判定する"""
        if len(audio_bytes) >= 12 and audio_bytes[:4] == b"RIFF" and audio_bytes[8:12] == b"WAVE":
            return "wav"
        return "mp3"

    def _synthesize_provider(
        self,
        provider: str,
        text: str,
        voice: str,
        model: str,
        ratio: float,
    ) -> bytes:
        """指定 provider で、1件の通常テキストを音声合成する。"""
        if provider == "edge":
            return self._synthesize_edge(text, voice, ratio)
        if provider == "openai":
            return self._synthesize_openai(text, voice, model, ratio)
        if provider in ("gemini", "freeai"):
            return self._synthesize_gemini(text, voice, model, provider, ratio)
        raise TextToSpeechError(f"未対応の provider です: '{provider}'")

    def _generate_silence_mp3(self, seconds: float = PAUSE_SECONDS) -> bytes:
        """指定秒数のモノラル無音 MP3 を生成する。"""
        duration = max(0.001, float(seconds))
        if self.ffmpeg_path:
            with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
                out_path = tmp.name
            try:
                result = subprocess.run(
                    [
                        self.ffmpeg_path,
                        "-f", "lavfi",
                        "-i", "anullsrc=r=24000:cl=mono",
                        "-t", f"{duration:.3f}",
                        "-c:a", "libmp3lame",
                        "-b:a", "128k",
                        "-y", "-loglevel", "error",
                        out_path,
                    ],
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), timeout=30,
                    check=False,
                )
                if result.returncode == 0 and os.path.getsize(out_path) > 0:
                    with open(out_path, "rb") as f:
                        return f.read()
                raise TextToSpeechError("ffmpeg による無音音声の生成に失敗しました")
            finally:
                try:
                    os.remove(out_path)
                except OSError:
                    pass

        # ffmpeg がない環境でも、既存依存の lameenc で無音 MP3 を作れるようにする。
        try:
            import lameenc
            sample_rate = 24000
            pcm = b"\x00\x00" * int(sample_rate * duration)
            encoder = lameenc.Encoder()
            encoder.set_bit_rate(128)
            encoder.set_in_sample_rate(sample_rate)
            encoder.set_channels(1)
            encoder.set_quality(2)
            return bytes(encoder.encode(pcm) + encoder.flush())
        except Exception as exc:
            raise TextToSpeechError(
                f"1秒無音を生成できません。ffmpeg または lameenc が必要です: {exc}"
            ) from exc

    def _concat_audio_parts(self, audio_parts: list[bytes]) -> bytes:
        """音声区間と無音区間を順番どおり1本の MP3 に連結する。"""
        if not audio_parts:
            raise TextToSpeechError("連結する音声区間がありません")
        if len(audio_parts) == 1:
            return audio_parts[0]

        if not self.ffmpeg_path:
            if all(self._detect_audio_format(part) == "mp3" for part in audio_parts):
                # MP3 フレーム列は連結再生できる。ffmpeg 不在時だけのフォールバック。
                return b"".join(audio_parts)
            raise TextToSpeechError("WAV を含む音声連結には ffmpeg が必要です")

        temp_dir = tempfile.mkdtemp(prefix="aidiy_tts_pause_")
        output_path = os.path.join(temp_dir, "joined.mp3")
        try:
            input_args: list[str] = []
            filter_parts: list[str] = []
            concat_inputs: list[str] = []
            for index, part in enumerate(audio_parts):
                ext = self._detect_audio_format(part)
                part_path = os.path.join(temp_dir, f"part_{index:04d}.{ext}")
                with open(part_path, "wb") as f:
                    f.write(part)
                input_args.extend(["-i", part_path])
                label = f"a{index}"
                filter_parts.append(
                    f"[{index}:a]aresample=24000,"
                    f"aformat=sample_fmts=s16:channel_layouts=mono[{label}]"
                )
                concat_inputs.append(f"[{label}]")
            filter_parts.append(
                "".join(concat_inputs)
                + f"concat=n={len(audio_parts)}:v=0:a=1[out]"
            )
            command = [
                self.ffmpeg_path,
                *input_args,
                "-filter_complex", ";".join(filter_parts),
                "-map", "[out]",
                "-c:a", "libmp3lame",
                "-b:a", "128k",
                "-y", "-loglevel", "error",
                output_path,
            ]
            result = subprocess.run(command, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), timeout=120, check=False)
            if result.returncode != 0 or not os.path.isfile(output_path):
                raise TextToSpeechError("ffmpeg による音声と無音の連結に失敗しました")
            with open(output_path, "rb") as f:
                return f.read()
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    def synthesize(
        self,
        speech_text: str,
        language: str = "ja",
        provider: str = "auto",
        model: str = "auto",
        voice: str = "auto",
        ratio: Any = None,
    ) -> tuple[bytes, dict]:
        """
        テキストから音声を合成する。

        フォールバックは FALLBACK_CHAIN（クラス定数）に従う:
            auto   → edge → freeai
            edge   → edge → freeai
            freeai → gemini → edge
            gemini → freeai → edge
            openai → edge
        キー無効の候補は事前にスキップし、合成例外発生時も次の候補へ進む。

        Args:
            ratio: 話速倍率。None / 0 / "auto" は provider ごとの既定値として扱う。
                   edge/openai は 1.2、gemini/freeai は 1.1。1 は速度調整なし。
                   有効レンジは 0.5..2.0 に clamp。範囲外は端で丸める。
                   edge は rate 文字列、openai は speed 引数、gemini/freeai は ffmpeg atempo で適用。

        Returns:
            (audio_bytes, info_dict)
        """
        if speech_text is None:
            raise TextToSpeechError("speech_text は必須です")
        if not isinstance(speech_text, str):
            raise TextToSpeechError("speech_text は文字列で指定してください")

        requested = self._normalize_provider(provider)
        model = model.strip().lower()
        language = language.strip().lower()

        # JSON の "" はゼロバイト文字列であり、本文中の記号ではない。
        # 空文字列を1件の音声生成要求として受けた場合、その1件を1秒無音にする。
        if speech_text == "":
            audio_bytes = self._generate_silence_mp3(self.PAUSE_SECONDS)
            audio_format = self._detect_audio_format(audio_bytes)
            info = {
                "requested_provider": requested,
                "used_provider": "silence",
                "model": "silence",
                "voice": "",
                "language": language,
                "ratio": 1.0,
                "requested_ratio": ratio,
                "speech_text": "",
                "original_speech_text": "",
                "pronunciation_replacements": [],
                "is_silence": True,
                "silence_duration_sec": self.PAUSE_SECONDS,
                "pause_count": 1,
                "pause_seconds_each": self.PAUSE_SECONDS,
                "pause_duration_sec": self.PAUSE_SECONDS,
                "audio_format": audio_format,
                "audio_bytes_length": len(audio_bytes),
                "mp3_bytes_length": len(audio_bytes),
            }
            return audio_bytes, info

        if not speech_text.strip():
            raise TextToSpeechError(
                "speech_text は空文字列（1秒無音）または読み上げる文字列で指定してください"
            )

        normalized_text, replacements = self.normalize_for_speech(speech_text, language)
        voice_input = self.auto_voice if voice.strip().lower() == "auto" else voice

        # FALLBACK_CHAIN に沿って候補を順に試す。
        # キー無効はスキップ、合成例外は次の候補へ、最終候補で失敗したら raise。
        chain = self.FALLBACK_CHAIN[self.auto_provider if requested == "auto" else requested]
        used: Optional[str] = None
        used_voice: Optional[str] = None
        audio_bytes: Optional[bytes] = None
        last_error: Optional[Exception] = None

        for candidate in chain:
            # キーが必要な候補で、キーが無ければスキップして次へ
            if candidate in ("openai", "gemini", "freeai"):
                if self._get_api_key(candidate) is None:
                    logger.info(f"{candidate} は API キー未設定のためスキップ")
                    continue

            # 候補ごとに voice を解決し直す（provider 別に female/male マッピングが違うため）
            resolved_voice = self._resolve_voice(voice_input, candidate, language)
            effective_ratio = self._resolve_ratio_for_provider(ratio, candidate)
            try:
                audio_bytes = self._synthesize_provider(
                    candidate, normalized_text, resolved_voice, model, effective_ratio
                )
                used = candidate
                used_voice = resolved_voice
                if candidate != requested:
                    logger.info(f"{requested} → {candidate} にフォールバックしました")
                break
            except Exception as e:
                last_error = e
                logger.info(f"{candidate} 合成失敗: {e}")
                continue

        if audio_bytes is None or used is None:
            # チェーン全滅。最後のエラーを添えて raise（基本起こり得ない：edge は鍵不要）
            raise TextToSpeechError(
                f"全フォールバック候補で合成に失敗しました（requested={requested}, chain={chain}）: {last_error}"
            )

        voice = used_voice or voice_input
        audio_format = self._detect_audio_format(audio_bytes)

        info = {
            "requested_provider": requested,
            "used_provider": used,
            "model": model if model != "auto" else self._default_model(used),
            "voice": voice,
            "language": language,
            "ratio": self._resolve_ratio_for_provider(ratio, used),
            "requested_ratio": ratio,
            "speech_text": normalized_text,
            "original_speech_text": speech_text,
            "pronunciation_replacements": replacements,
            "is_silence": False,
            "silence_duration_sec": 0.0,
            "pause_count": 0,
            "pause_seconds_each": self.PAUSE_SECONDS,
            "pause_duration_sec": 0.0,
            "audio_format": audio_format,
            "audio_bytes_length": len(audio_bytes),
            "mp3_bytes_length": len(audio_bytes),  # backward compat
        }
        return audio_bytes, info

    # ------------------------------------------------------------------ #
    # Edge TTS
    # ------------------------------------------------------------------ #

    def _synthesize_edge(self, text: str, voice: str, ratio: float = 1.0) -> bytes:
        import edge_tts
        rate_str = self._edge_rate_str(ratio)
        communicate = edge_tts.Communicate(text, voice, rate=rate_str)
        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
            tmp_path = tmp.name
        try:
            asyncio.run(communicate.save(tmp_path))
            with open(tmp_path, "rb") as f:
                return f.read()
        finally:
            try:
                os.remove(tmp_path)
            except OSError:
                pass

    # ------------------------------------------------------------------ #
    # OpenAI TTS
    # ------------------------------------------------------------------ #

    def _synthesize_openai(self, text: str, voice: str, model: str, ratio: float = 1.0) -> bytes:
        try:
            from openai import OpenAI
        except ImportError:
            raise TextToSpeechError(
                "openai パッケージがインストールされていません。pip install openai で導入してください。"
            )
        api_key = self._get_api_key("openai") or ""

        if model == "auto":
            model = self.DEFAULT_OPENAI_MODEL

        client = OpenAI(api_key=api_key)
        try:
            with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
                tmp_path = tmp.name
            response = client.audio.speech.create(
                model=model,
                voice=voice,
                input=text,
                response_format="mp3",
                speed=ratio,
                extra_headers={"x-idempotency-key": str(uuid.uuid4())},
            )
            response.stream_to_file(tmp_path)
            with open(tmp_path, "rb") as f:
                return f.read()
        finally:
            close = getattr(client, "close", None)
            if callable(close):
                close()
            try:
                os.remove(tmp_path)
            except OSError:
                pass

    # ------------------------------------------------------------------ #
    # Gemini / FreeAI TTS
    # ------------------------------------------------------------------ #

    def _synthesize_gemini(self, text: str, voice: str, model: str, provider: str, ratio: float = 1.0) -> bytes:
        import requests
        api_key = self._get_api_key(provider) or ""

        if model == "auto":
            model = self.DEFAULT_GEMINI_MODEL

        # Gemini の場合は GEMINI_BASE_URL、FreeAI は別途環境変数 or デフォルト
        if provider == "freeai":
            base_url = os.environ.get("FREEAI_BASE_URL", self.DEFAULT_GEMINI_BASE_URL)
        else:
            base_url = os.environ.get("GEMINI_BASE_URL", self.DEFAULT_GEMINI_BASE_URL)
        base_url = base_url.strip().rstrip("/")

        # Gemini TTS は音声生成用の指示が必要
        tts_prompt = (
            f"Generate spoken audio of the following text exactly as written. "
            f"Do not add any commentary, explanations, or extra words. "
            f"Just speak this text naturally: {text}"
        )

        base_gen_config = {
            "responseModalities": ["AUDIO"],
            "speechConfig": {
                "voiceConfig": {
                    "prebuiltVoiceConfig": {"voiceName": voice},
                },
            },
        }
        endpoint = f"{base_url}/models/{model}:generateContent"

        # MP3 直接出力を試みる。API が非対応なら audioConfig なしで再試行
        # 5xx エラーや接続失敗は最大 3 回まで指数バックオフでリトライ
        RETRYABLE_STATUS = {429, 500, 502, 503, 504}
        MAX_RETRIES = 3
        for attempt_mp3 in (True, False):
            gen_config = dict(base_gen_config)
            if attempt_mp3:
                gen_config["audioConfig"] = {"audioEncoding": "MP3"}
            payload = {
                "contents": [{"parts": [{"text": tts_prompt}]}],
                "generationConfig": gen_config,
            }
            resp = None
            for retry in range(MAX_RETRIES):
                try:
                    resp = requests.post(
                        endpoint,
                        params={"key": api_key},
                        headers={"Content-Type": "application/json"},
                        json=payload,
                        timeout=60,
                    )
                    if resp.status_code in RETRYABLE_STATUS and retry < MAX_RETRIES - 1:
                        wait_sec = 1.5 * (2 ** retry)
                        logger.info(
                            f"Gemini TTS: HTTP {resp.status_code}、{wait_sec:.1f}s 後にリトライ "
                            f"({retry + 1}/{MAX_RETRIES - 1})"
                        )
                        time.sleep(wait_sec)
                        continue
                    break
                except requests.RequestException as e:
                    if retry < MAX_RETRIES - 1:
                        wait_sec = 1.5 * (2 ** retry)
                        logger.info(
                            f"Gemini TTS: 接続失敗 ({e})、{wait_sec:.1f}s 後にリトライ "
                            f"({retry + 1}/{MAX_RETRIES - 1})"
                        )
                        time.sleep(wait_sec)
                        continue
                    raise
            if resp is not None and resp.status_code == 400 and attempt_mp3:
                # audioConfig 非対応 → PCM モードで再試行
                logger.info("Gemini TTS: audioConfig 非対応、PCM モードで再試行")
                continue
            break

        if resp.status_code != 200:
            try:
                err = resp.json().get("error", {})
                detail = err.get("message", resp.text[:300])
            except Exception:
                detail = resp.text[:300]
            raise TextToSpeechError(
                f"Gemini API エラー (HTTP {resp.status_code}): {detail}"
            )

        try:
            data = resp.json()
            parts = data["candidates"][0]["content"]["parts"]
            audio_part = next(
                (p for p in parts if "inlineData" in p or "inline_data" in p), None
            )
            if audio_part is None:
                raise TextToSpeechError("Gemini レスポンスに音声データが含まれていません")
            inline = audio_part.get("inlineData") or audio_part.get("inline_data") or {}
            audio_b64 = inline.get("data", "")
            mime_type = inline.get("mimeType", "")
        except (KeyError, IndexError, TypeError) as e:
            raise TextToSpeechError(f"Gemini レスポンスの解析に失敗: {e}")

        if not audio_b64:
            raise TextToSpeechError("Gemini が空の音声データを返しました")

        raw_bytes = base64.b64decode(audio_b64)

        # mimeType が MP3 系なら変換不要、それ以外は PCM→WAV→MP3 変換
        if mime_type.lower() in ("audio/mp3", "audio/mpeg", "audio/mpeg3"):
            logger.info(f"Gemini TTS: MP3 直接出力 ({mime_type})")
            audio_bytes = raw_bytes
        else:
            wav_bytes = self._pcm_to_wav(raw_bytes)
            audio_bytes = self._wav_to_mp3(wav_bytes)

        if ratio != 1.0:
            audio_bytes = self._apply_atempo(audio_bytes, ratio)
        return audio_bytes

    # ------------------------------------------------------------------ #
    # PCM / WAV / MP3 変換
    # ------------------------------------------------------------------ #

    def _pcm_to_wav(self, pcm_bytes: bytes) -> bytes:
        """16kHz 16bit モノラル PCM を WAV に変換"""
        sample_rate = self.GEMINI_SAMPLE_RATE
        channels = self.GEMINI_CHANNELS
        sample_width = self.GEMINI_SAMPLE_WIDTH
        byte_rate = sample_rate * channels * sample_width
        block_align = channels * sample_width
        data_size = len(pcm_bytes)

        fmt_chunk = struct.pack(
            "<4sIHHIIHH",
            b"fmt ",
            16,
            1,
            channels,
            sample_rate,
            byte_rate,
            block_align,
            sample_width * 8,
        )
        data_header = struct.pack("<4sI", b"data", data_size)
        riff_size = 4 + len(fmt_chunk) + len(data_header) + data_size
        riff_header = struct.pack("<4sI4s", b"RIFF", riff_size, b"WAVE")
        return riff_header + fmt_chunk + data_header + pcm_bytes

    def _wav_to_mp3(self, wav_bytes: bytes) -> bytes:
        """WAV → MP3 変換。ffmpeg 優先、不在時は lameenc にフォールバック。"""
        if not self.ffmpeg_path:
            return self._wav_to_mp3_lameenc(wav_bytes)
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            tmp.write(wav_bytes)
            wav_path = tmp.name
        mp3_path = wav_path.rsplit(".", 1)[0] + ".mp3"
        try:
            subprocess.run(
                [self.ffmpeg_path, "-i", wav_path, "-y", "-loglevel", "error", mp3_path],
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), check=True, timeout=30,
            )
            if os.path.exists(mp3_path) and os.path.getsize(mp3_path) > 0:
                with open(mp3_path, "rb") as f:
                    return f.read()
            return wav_bytes
        except Exception:
            return self._wav_to_mp3_lameenc(wav_bytes)
        finally:
            for p in (wav_path, mp3_path):
                try:
                    os.remove(p)
                except OSError:
                    pass

    @staticmethod
    def _wav_to_mp3_lameenc(wav_bytes: bytes) -> bytes:
        """lameenc を使った純 Python WAV → MP3 変換（ffmpeg 不在時のフォールバック）。"""
        try:
            import lameenc
            import wave
            import io
            with wave.open(io.BytesIO(wav_bytes)) as wf:
                channels = wf.getnchannels()
                sample_rate = wf.getframerate()
                sample_width = wf.getsampwidth()
                n_frames = wf.getnframes()
                pcm_data = wf.readframes(n_frames)
            if sample_width != 2:
                return wav_bytes
            encoder = lameenc.Encoder()
            encoder.set_bit_rate(128)
            encoder.set_in_sample_rate(sample_rate)
            encoder.set_channels(channels)
            encoder.set_quality(2)
            mp3_bytes = encoder.encode(pcm_data)
            mp3_bytes += encoder.flush()
            mp3_bytes = bytes(mp3_bytes) if not isinstance(mp3_bytes, bytes) else mp3_bytes
            return mp3_bytes if mp3_bytes else wav_bytes
        except Exception:
            return wav_bytes

    def _apply_atempo(self, audio_bytes: bytes, ratio: float) -> bytes:
        """ffmpeg atempo で速度調整。ffmpeg 不在/失敗時は元のバイトを返す"""
        if not self.ffmpeg_path:
            return audio_bytes
        ext = "." + self._detect_audio_format(audio_bytes)
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp_in:
            tmp_in.write(audio_bytes)
            in_path = tmp_in.name
        out_path = in_path.rsplit(".", 1)[0] + "_t" + ext
        try:
            result = subprocess.run(
                [self.ffmpeg_path, "-i", in_path, "-af", f"atempo={ratio}",
                 "-y", "-loglevel", "error", out_path],
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), timeout=30,
            )
            if result.returncode == 0 and os.path.exists(out_path) and os.path.getsize(out_path) > 0:
                with open(out_path, "rb") as f:
                    return f.read()
            return audio_bytes
        except (subprocess.SubprocessError, OSError):
            return audio_bytes
        finally:
            for p in (in_path, out_path):
                try:
                    os.remove(p)
                except OSError:
                    pass

    def _convert_audio(self, audio_bytes: bytes, src: str, dst: str) -> Optional[bytes]:
        """mp3 ↔ wav 変換を試みる。同形式ならそのまま、ffmpeg 不在/失敗/未対応拡張子なら None"""
        if src == dst:
            return audio_bytes
        if {src, dst} != {"mp3", "wav"}:
            return None
        if not self.ffmpeg_path:
            return None
        with tempfile.NamedTemporaryFile(suffix=f".{src}", delete=False) as tmp_in:
            tmp_in.write(audio_bytes)
            in_path = tmp_in.name
        out_path = in_path.rsplit(".", 1)[0] + f".{dst}"
        try:
            result = subprocess.run(
                [self.ffmpeg_path, "-i", in_path, "-y", "-loglevel", "error", out_path],
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), timeout=30,
            )
            if result.returncode == 0 and os.path.exists(out_path) and os.path.getsize(out_path) > 0:
                with open(out_path, "rb") as f:
                    return f.read()
            return None
        except (subprocess.SubprocessError, OSError):
            return None
        finally:
            for p in (in_path, out_path):
                try:
                    os.remove(p)
                except OSError:
                    pass

    # ------------------------------------------------------------------ #
    # ローカル再生
    # ------------------------------------------------------------------ #

    def play_mp3(self, audio_bytes: bytes) -> bool:
        """合成済みバイトをそのままローカル再生する（速度補正なし）"""
        if not audio_bytes:
            return False
        ext = "." + self._detect_audio_format(audio_bytes)
        tmp_path = None
        try:
            fd, tmp_path = tempfile.mkstemp(suffix=ext)
            os.write(fd, audio_bytes)
            os.close(fd)
            self._playsound(tmp_path)
            return True
        except Exception:
            return False
        finally:
            if tmp_path:
                try:
                    os.remove(tmp_path)
                except OSError:
                    pass

    @staticmethod
    def _playsound(path: str) -> None:
        """playsound 風の最小実装。Windows: winmm, macOS: afplay, Linux: gst"""
        import platform
        pf = platform.system()
        if pf == "Windows":
            import ctypes
            ext = os.path.splitext(path)[1].lower()
            mci_type = "waveaudio" if ext == ".wav" else "mpegvideo"
            ctypes.windll.winmm.mciSendStringW(
                f'open "{path}" type {mci_type} alias _tts', None, 0, None)
            ctypes.windll.winmm.mciSendStringW(
                'play _tts wait', None, 0, None)
            ctypes.windll.winmm.mciSendStringW(
                'close _tts', None, 0, None)
        elif pf == "Darwin":
            subprocess.run(["afplay", path], creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), timeout=120)
        else:
            subprocess.run(["gst-launch-1.0", "playbin", f"uri=file://{path}"],
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), timeout=60, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    # ------------------------------------------------------------------ #
    # 出力
    # ------------------------------------------------------------------ #

    def _resolve_default_output_dir(self) -> str:
        """プロジェクトルート起点で DEFAULT_OUTPUT_DIR を絶対パス化する"""
        project_root = Path(__file__).resolve().parent.parent.parent
        return str(project_root / self.DEFAULT_OUTPUT_DIR)

    @staticmethod
    def _is_directory_path(path: str) -> bool:
        """save_path をフォルダ扱いとするか判定する。
           - 既存ディレクトリ
           - 末尾が / または \\
           - 拡張子なし
        """
        if os.path.isdir(path):
            return True
        if path.endswith(("/", "\\")):
            return True
        if not os.path.splitext(path)[1]:
            return True
        return False

    def to_base64(
        self,
        audio_bytes: bytes,
        save_path: Optional[str] = None,
        return_base64: bool = True,
    ) -> tuple[str, str]:
        """音声バイト列を保存し、(base64, 保存先パス) を返す。

        return_base64=False なら base64 は空文字にする。呼び出し側が保存先を
        知っているのに同じ音声を base64 でも返すと、文脈が二重に膨らむため。

        Args:
            audio_bytes: 音声バイナリ（MP3 / WAV）
            save_path: 保存先。
                       フォルダ指定（既存ディレクトリ / 末尾 / または \\ / 拡張子なし）なら
                       そのフォルダに yyyymmdd.hhmmss.<実フォーマット> で保存。
                       ファイル指定（拡張子あり）なら可能な限り指定拡張子の形式で出力。
                       mp3 ↔ wav 変換は ffmpeg があれば自動。
                       変換できない場合は実データの拡張子に差し替えて保存。
                       None なら DEFAULT_OUTPUT_DIR にデフォルト保存。
        """
        source_format = self._detect_audio_format(audio_bytes)

        if save_path is None:
            save_path = self._resolve_default_output_dir()

        if self._is_directory_path(save_path):
            os.makedirs(save_path, exist_ok=True)
            fname = datetime.now().strftime("%Y%m%d.%H%M%S") + f".{source_format}"
            dest = os.path.join(save_path, fname)
            out_bytes = audio_bytes
        else:
            parent = os.path.dirname(os.path.abspath(save_path))
            if parent:
                os.makedirs(parent, exist_ok=True)

            requested = os.path.splitext(save_path)[1].lower().lstrip(".")
            if requested == source_format:
                dest = save_path
                out_bytes = audio_bytes
            else:
                converted = self._convert_audio(audio_bytes, source_format, requested)
                if converted is not None:
                    dest = save_path
                    out_bytes = converted
                else:
                    # 変換できない → 拡張子だけ差し替え
                    base, _ = os.path.splitext(save_path)
                    dest = f"{base}.{source_format}"
                    out_bytes = audio_bytes

        with open(dest, "wb") as f:
            f.write(out_bytes)

        if not return_base64:
            return "", dest
        return base64.b64encode(out_bytes).decode("ascii"), dest

    # ------------------------------------------------------------------ #
    # 内部ヘルパー
    # ------------------------------------------------------------------ #

    def _normalize_provider(self, provider: str) -> str:
        """provider 文字列を正規化する。'auto' はそのまま 'auto' で返し、
        FALLBACK_CHAIN によって実際の試行順を決める。"""
        p = provider.strip().lower()
        if p in self.FALLBACK_CHAIN:
            return p
        raise TextToSpeechError(
            f"未対応の provider です: '{provider}'（auto / edge / openai / gemini / freeai）"
        )

    def _resolve_voice(self, voice: str, provider: str, language: str = "ja") -> str:
        v = voice.strip()
        v_lower = v.lower()
        # "auto" は "female" 既定として扱う（provider 別の female マッピングへ）
        if v_lower == "auto":
            v_lower = "female"
        # "female" / "male" を provider 別の実音声名に変換
        if v_lower in ("female", "male"):
            if provider == "edge":
                raw_language = (language or "ja").strip().lower().replace("_", "-")
                base_language = raw_language.split("-", 1)[0] or "ja"
                mapping = (
                    self.EDGE_GENDER_VOICES.get(raw_language)
                    or self.EDGE_GENDER_VOICES.get(base_language)
                    or self.EDGE_GENDER_VOICES["ja"]
                )
                return mapping[v_lower]
            if provider == "openai":
                return self.OPENAI_GENDER_VOICES[v_lower]
            if provider in ("gemini", "freeai"):
                return self.GEMINI_GENDER_VOICES[v_lower]
            # 未対応 provider のフォールバック
            return self.DEFAULT_VOICES.get(provider, self.DEFAULT_VOICES["edge"])
        return v

    def _default_model(self, provider: str) -> str:
        if provider == "openai":
            return self.DEFAULT_OPENAI_MODEL
        elif provider in ("gemini", "freeai"):
            return self.DEFAULT_GEMINI_MODEL
        return "auto"
