# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""
通知音再生モジュール

scene に応じた通知音（開始・終了・注意）をローカル再生する。

scene:
    "auto" / "plane" — 機内シーン (SeatBeltSign1/2/3)
    "legacy"         — 旧来の効果音 (ready / ok / ng)
    "tts"            — 固定音の代わりに、通知種別に対応する読み上げフレーズを
                       text_to_speech エンジンで合成・再生する
"""

from pathlib import Path

from log_config import get_logger

logger = get_logger(__name__)

# サウンドファイルが格納されているディレクトリ（backend_tools/sounds/）
_SOUNDS_DIR = Path(__file__).resolve().parent.parent / "sounds"

# scene → 通知種別 → ファイル名のマッピング
_SCENE_MAP: dict[str, dict[str, str]] = {
    "plane": {
        "準備": "_sound_SeatBeltSign3.mp3",
        "開始": "_sound_SeatBeltSign1.mp3",
        "終了": "_sound_SeatBeltSign2.mp3",
        "完了": "_sound_SeatBeltSign1.mp3",
        "注意": "_sound_SeatBeltSign2fast.mp3",
        "承認": "_sound_SeatBeltSign1.mp3",
    },
    "legacy": {
        "準備": "_sound_ready.mp3",    # ready   = 準備完了
        "開始": "_sound_up.mp3",       # up      = 開始・上昇
        "終了": "_sound_down.mp3",     # down    = 終了・下降
        "完了": "_sound_ok.mp3",       # ok      = 完了・成功
        "注意": "_sound_ng.mp3",       # ng      = 警告・エラー
        "承認": "_sound_accept.mp3",   # accept  = 承認・受理
    },
}

# scene="tts" のとき、通知種別 → 読み上げフレーズへのマッピング。
# 固定音ファイルの代わりに、このフレーズを text_to_speech エンジンで合成・再生する。
_TTS_PHRASES: dict[str, str] = {
    "準備": "準備ができました",
    "開始": "開始します",
    "終了": "終了しました",
    "完了": "完了しました",
    "注意": "ご注意ください",
    "承認": "承認しました",
}

# "auto" は "plane" にマップ
_SCENE_ALIAS: dict[str, str] = {
    "auto": "plane",
}

# 通知種別の英語エイリアス（legacy 名）→ 日本語キーへの変換
_TYPE_ALIAS: dict[str, str] = {
    "ready":  "準備",   # ready  = 準備完了
    "up":     "開始",   # up     = 開始・上昇
    "down":   "終了",   # down   = 終了・下降
    "ok":     "完了",   # ok     = 完了・成功
    "ng":     "注意",   # ng     = 警告・エラー
    "accept": "承認",   # accept = 承認・受理
}

VALID_SCENES = ["auto", "plane", "legacy", "tts"]
VALID_TYPES_PLANE  = ["準備", "開始", "終了", "完了", "注意", "承認"]
VALID_TYPES_LEGACY = ["準備", "開始", "終了", "完了", "注意", "承認"]
VALID_TYPES        = VALID_TYPES_LEGACY  # 全体の上位集合


class NotificationSoundsError(Exception):
    """通知音エラー"""
    pass


class NotificationSounds:
    """通知音再生クラス"""

    def __init__(self, tts=None) -> None:
        """
        Args:
            tts: scene="tts" のとき使う TextToSpeech インスタンス（任意注入）。
                 未注入のまま tts 再生を要求すると NotificationSoundsError。
        """
        self._tts = tts

    def resolve_scene(self, scene: str) -> str:
        """scene 文字列を正規化して実 scene キーを返す"""
        s = (scene or "auto").strip().lower()
        s = _SCENE_ALIAS.get(s, s)
        if s == "tts":
            return s
        if s not in _SCENE_MAP:
            raise NotificationSoundsError(
                f"未対応の scene です: '{scene}'（auto / plane / legacy / tts）"
            )
        return s

    def resolve_notification_type(self, notification_type: str) -> str:
        """通知種別を正規化（英語エイリアス（ready/up/down/ok/ng/accept）を日本語キーへ変換）"""
        t = (notification_type or "").strip()
        return _TYPE_ALIAS.get(t.lower(), t)

    def resolve_sound_path(self, notification_type: str, scene: str) -> Path:
        """通知種別と scene からサウンドファイルの絶対パスを返す"""
        actual_scene = self.resolve_scene(scene)
        actual_type = self.resolve_notification_type(notification_type)
        scene_sounds = _SCENE_MAP[actual_scene]
        filename = scene_sounds.get(actual_type)
        if filename is None:
            raise NotificationSoundsError(
                f"未対応の通知種別です: '{notification_type}'（開始 / 終了 / 注意）"
            )
        path = _SOUNDS_DIR / filename
        if not path.exists():
            raise NotificationSoundsError(
                f"サウンドファイルが見つかりません: {path}"
            )
        return path

    def play(self, notification_type: str, scene: str = "auto") -> dict:
        """
        通知音を再生する。

        Args:
            notification_type: "開始" / "終了" / "注意"（"up" / "down" / "ng" 等の英語エイリアスも可）
            scene: "auto" / "plane" / "legacy" / "tts"
                   "tts" は固定音の代わりに読み上げフレーズを合成・再生する。
                   notification_type が定義済み（準備/開始/終了/完了/注意/承認）なら
                   対応フレーズを、未定義なら notification_type の文字列をそのまま自由発声する。

        Returns:
            plane/legacy: {"status": "ok", "scene": ..., "notification_type": ..., "file": ...}
            tts:          {"status": "ok", "scene": "tts", "notification_type": ..., "speech_text": ..., "mode": "phrase"|"free"}
        """
        actual_scene = self.resolve_scene(scene)
        actual_type = self.resolve_notification_type(notification_type)

        if actual_scene == "tts":
            if not getattr(self, "tts_available", lambda: True)():
                from tools_proc.tools_management import unavailable
                return unavailable("aidiy_text_to_speech")
            return self._play_tts(actual_type, notification_type)

        path = self.resolve_sound_path(notification_type, scene)

        logger.info(f"通知音再生: type={actual_type} scene={actual_scene} file={path.name}")
        try:
            self._playsound(str(path))
        except Exception as e:
            logger.warning(f"通知音再生スキップ (スピーカー無効等): {e}")

        return {
            "status": "ok",
            "scene": actual_scene,
            "notification_type": actual_type,
            "file": path.name,
        }

    def _play_tts(self, actual_type: str, notification_type: str) -> dict:
        """scene="tts": 読み上げフレーズを TTS で合成・再生する。

        notification_type が _TTS_PHRASES にあれば対応フレーズを、
        無ければ notification_type の文字列をそのまま自由発声する。
        """
        if self._tts is None:
            raise NotificationSoundsError(
                "TTS エンジンが未設定です（NotificationSounds(tts=...) で注入してください）"
            )

        phrase = _TTS_PHRASES.get(actual_type)
        if phrase is not None:
            mode = "phrase"
        else:
            # 辞書に無い → 入力文字列をそのまま自由発声
            phrase = (notification_type or "").strip()
            mode = "free"
            if not phrase:
                raise NotificationSoundsError("発声するテキストが空です")

        logger.info(f"通知音声合成: type={actual_type} scene=tts mode={mode} text='{phrase}'")
        try:
            audio_bytes, _info = self._tts.synthesize(phrase)
            self._tts.play_mp3(audio_bytes)
        except Exception as e:
            logger.warning(f"通知音声再生スキップ (合成失敗・スピーカー無効等): {e}")

        return {
            "status": "ok",
            "scene": "tts",
            "notification_type": actual_type,
            "speech_text": phrase,
            "mode": mode,
        }

    @staticmethod
    def _playsound(path: str) -> None:
        import os
        import platform
        import subprocess

        pf = platform.system()
        if pf == "Windows":
            import ctypes

            alias = "_notification_sounds"
            ext = os.path.splitext(path)[1].lower()
            mci_type = "waveaudio" if ext == ".wav" else "mpegvideo"
            ctypes.windll.winmm.mciSendStringW(f"close {alias}", None, 0, None)
            ctypes.windll.winmm.mciSendStringW(
                f'open "{path}" type {mci_type} alias {alias}', None, 0, None
            )
            try:
                ctypes.windll.winmm.mciSendStringW(f"play {alias} wait", None, 0, None)
            finally:
                ctypes.windll.winmm.mciSendStringW(f"close {alias}", None, 0, None)
        elif pf == "Darwin":
            subprocess.run(["afplay", path], timeout=30, check=False)
        else:
            subprocess.run(
                ["gst-launch-1.0", "playbin", f"uri=file://{path}"],
                timeout=30,
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )

    def list_sounds(self, scene: str = "auto") -> dict:
        """指定 scene のサウンドマッピング一覧を返す"""
        actual_scene = self.resolve_scene(scene)
        if actual_scene == "tts":
            return {
                "scene": "tts",
                "sounds": {
                    ntype: {"speech_text": phrase}
                    for ntype, phrase in _TTS_PHRASES.items()
                },
            }
        result = {}
        for ntype, filename in _SCENE_MAP[actual_scene].items():
            path = _SOUNDS_DIR / filename
            result[ntype] = {
                "file": filename,
                "exists": path.exists(),
                "path": str(path),
            }
        return {
            "scene": actual_scene,
            "sounds": result,
        }
