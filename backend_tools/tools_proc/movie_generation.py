# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""
動画生成モジュール

Google Gemini Veo API（veo-3.1-generate-preview / veo-2.0-generate-001）を使って
テキストまたは参照画像から動画を生成する。
"""

import json
import os
import time
from datetime import datetime
from pathlib import Path
from typing import Optional


class MovieGenerationError(Exception):
    """動画生成エラー"""
    pass


class MovieGeneration:
    """
    動画生成クラス（Google Gemini Veo）

    provider パラメータ:
        "auto"   — FreeAI を自動選択（デフォルト）
        "gemini" — Google Gemini API（gemini_key_id が必要）
        "freeai" — FreeAI API（freeai_key_id が必要、実装は Gemini 共通）
    """

    auto_provider = "freeai"
    auto_model = "veo-3.1-generate-preview"
    auto_aspect_ratio = "16:9"
    auto_resolution = "auto"

    DEFAULT_OUTPUT_DIR = "backend_server/temp/output"

    # ================================================================== #
    # Gemini Veo モデルカタログ
    # ================================================================== #

    _GEMINI_MODELS = {
        "veo-3.1-generate-preview": {
            "display": "Veo 3.1 (最新プレビュー)",
            "min_duration": 4,
            "max_duration": 8,
        },
        "veo-2.0-generate-001": {
            "display": "Veo 2.0 (安定版)",
            "min_duration": 4,
            "max_duration": 8,
        },
        "veo-2.0-generate-exp": {
            "display": "Veo 2.0 (実験版)",
            "min_duration": 4,
            "max_duration": 8,
        },
    }

    GEMINI_DEFAULT_MODEL = "veo-3.1-generate-preview"
    FREEAI_DEFAULT_MODEL = "veo-3.1-generate-preview"

    _VALID_ASPECT_RATIOS = {"16:9", "9:16"}
    DEFAULT_ASPECT_RATIO = "16:9"

    _POLL_INTERVAL_SEC = 20
    _POLL_MAX_SEC = 600  # 最大 10 分待機

    # ================================================================== #
    # AiDiy_key.json へのパス（backend_tools 起点）
    # ================================================================== #

    _KEY_CONFIG_REL = "../_config/AiDiy_key.json"

    # ------------------------------------------------------------------ #
    # API キー解決（共通）
    # ------------------------------------------------------------------ #

    @staticmethod
    def _is_valid_key(key: str) -> bool:
        return bool(key) and not key.startswith("<")

    def _read_key_from_config(self, key_name: str) -> str:
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

    def _get_gemini_api_key(self) -> str:
        key = self._read_key_from_config("gemini_key_id")
        return key if self._is_valid_key(key) else ""

    def _get_freeai_api_key(self) -> str:
        key = self._read_key_from_config("freeai_key_id")
        return key if self._is_valid_key(key) else ""

    # ------------------------------------------------------------------ #
    # モデル解決
    # ------------------------------------------------------------------ #

    def _resolve_gemini_model(self, model_id: Optional[str] = None):
        mid = (model_id or self.GEMINI_DEFAULT_MODEL).strip()
        if mid in self._GEMINI_MODELS:
            return mid, self._GEMINI_MODELS[mid]
        return self.GEMINI_DEFAULT_MODEL, self._GEMINI_MODELS[self.GEMINI_DEFAULT_MODEL]

    # ------------------------------------------------------------------ #
    # 動画生成（Gemini / FreeAI）
    # ------------------------------------------------------------------ #

    def _generate_gemini(
        self,
        prompt: str,
        model: str,
        duration_seconds: int,
        aspect_ratio: str,
        resolution: Optional[str],
        negative_prompt: Optional[str],
        enhance_prompt: bool,
        reference_image_path: Optional[str],
        provider: str,
    ) -> tuple[bytes, dict]:
        if provider == "freeai":
            api_key = self._get_freeai_api_key()
            provider_label = "freeai"
            default_model = self.FREEAI_DEFAULT_MODEL
        else:
            api_key = self._get_gemini_api_key()
            provider_label = "gemini"
            default_model = self.GEMINI_DEFAULT_MODEL

        if not api_key:
            raise MovieGenerationError(
                f"{provider_label.upper()} API キーが設定されていません。"
                f"AiDiy_key.json の {provider_label}_key_id を設定してください。"
            )

        try:
            from google import genai
            from google.genai import types
        except ImportError:
            raise MovieGenerationError(
                "google-genai パッケージがインストールされていません。"
                "pip install google-genai で導入してください。"
            )

        model_id, model_meta = self._resolve_gemini_model(
            model if model != "auto" else default_model
        )

        # duration_seconds を有効範囲に clamp
        min_dur = model_meta["min_duration"]
        max_dur = model_meta["max_duration"]
        duration_seconds = max(min_dur, min(max_dur, int(duration_seconds)))

        # アスペクト比の検証
        if aspect_ratio not in self._VALID_ASPECT_RATIOS:
            aspect_ratio = self.DEFAULT_ASPECT_RATIO

        # GenerateVideosConfig を構築（Gemini API は output_gcs_uri 非対応）
        config_kwargs: dict = {
            "number_of_videos": 1,
            "duration_seconds": duration_seconds,
            "aspect_ratio": aspect_ratio,
        }
        if negative_prompt:
            config_kwargs["negative_prompt"] = negative_prompt
        if enhance_prompt:
            config_kwargs["enhance_prompt"] = True
        if resolution in ("720p", "1080p"):
            config_kwargs["resolution"] = resolution

        config = types.GenerateVideosConfig(**config_kwargs)

        client = genai.Client(api_key=api_key)

        gen_kwargs: dict = {
            "model": model_id,
            "prompt": prompt.strip(),
            "config": config,
        }
        if reference_image_path:
            gen_kwargs["image"] = types.Image.from_file(location=reference_image_path)

        # Long-Running Operation として開始
        operation = client.models.generate_videos(**gen_kwargs)

        # ポーリング（done になるまで待機）
        elapsed = 0
        while not operation.done:
            if elapsed >= self._POLL_MAX_SEC:
                raise MovieGenerationError(
                    f"動画生成がタイムアウトしました（{self._POLL_MAX_SEC}秒）"
                )
            time.sleep(self._POLL_INTERVAL_SEC)
            elapsed += self._POLL_INTERVAL_SEC
            operation = client.operations.get(operation=operation)

        generated_videos = getattr(operation.result, "generated_videos", None)
        if not generated_videos:
            raise MovieGenerationError("Gemini が動画データを返しませんでした")

        video = generated_videos[0].video

        # Gemini API では files.download() でバイトデータを取得する
        client.files.download(file=video)
        video_bytes = getattr(video, "video_bytes", None)

        if not video_bytes:
            raise MovieGenerationError("Gemini 動画データのダウンロードに失敗しました")

        info = {
            "provider": provider_label,
            "model": model_id,
            "prompt": prompt.strip(),
            "duration_seconds": duration_seconds,
            "aspect_ratio": aspect_ratio,
            "resolution": resolution,
            "reference_image_path": reference_image_path,
            "video_bytes_length": len(video_bytes),
            "engine_note": f"Gemini {model_meta['display']} ({provider_label})",
        }
        return video_bytes, info

    # ------------------------------------------------------------------ #
    # 動画生成（統合入口）
    # ------------------------------------------------------------------ #

    def generate(
        self,
        prompt: str,
        provider: str = "auto",
        model: str = "auto",
        duration_seconds: int = 8,
        aspect_ratio: str = "auto",
        resolution: str = "auto",
        negative_prompt: Optional[str] = None,
        enhance_prompt: bool = False,
        reference_image_path: Optional[str] = None,
    ) -> tuple[bytes, dict]:
        """
        プロンプトから動画を生成する。

        Args:
            prompt: 生成プロンプト（英語推奨）
            provider: "auto" / "gemini" / "freeai"
            model:
              "auto"=veo-3.1-generate-preview /
              "veo-3.1-generate-preview" / "veo-2.0-generate-001" / "veo-2.0-generate-exp"
            duration_seconds: 動画の長さ（4〜8秒）
            aspect_ratio: "auto"=16:9 / "16:9" / "9:16"
            resolution: "auto" / "720p" / "1080p"
            negative_prompt: ネガティブプロンプト（省略可）
            enhance_prompt: プロンプト自動改善（デフォルト False）
            reference_image_path: 参照画像のパス（image-to-video、省略可）

        Returns:
            (video_bytes, info_dict)
            info_dict: provider, model, prompt, duration_seconds, aspect_ratio, engine_note
        """
        if not prompt or not prompt.strip():
            raise MovieGenerationError("prompt は必須です")

        provider = provider.strip().lower()
        if provider not in ("auto", "gemini", "freeai"):
            raise MovieGenerationError(
                f"未対応の provider です: '{provider}'（auto / gemini / freeai のみ）"
            )

        if reference_image_path and not os.path.isfile(reference_image_path):
            raise MovieGenerationError(
                f"参照画像が見つかりません: '{reference_image_path}'"
            )

        # auto → freeai にフォールバック
        if provider == "auto":
            provider = self.auto_provider
        if model == "auto":
            model = self.auto_model
        if resolution == "auto":
            resolution = self.auto_resolution

        # aspect_ratio の正規化
        resolved_aspect = aspect_ratio if aspect_ratio != "auto" else self.auto_aspect_ratio

        # resolution の正規化（"auto" は指定なし = モデルのデフォルト）
        resolved_resolution = resolution if resolution in ("720p", "1080p") else None

        return self._generate_gemini(
            prompt=prompt,
            model=model,
            duration_seconds=duration_seconds,
            aspect_ratio=resolved_aspect,
            resolution=resolved_resolution,
            negative_prompt=negative_prompt or None,
            enhance_prompt=enhance_prompt,
            reference_image_path=reference_image_path,
            provider=provider,
        )

    # ------------------------------------------------------------------ #
    # 出力
    # ------------------------------------------------------------------ #

    def _resolve_default_output_dir(self) -> str:
        """プロジェクトルート起点で DEFAULT_OUTPUT_DIR を絶対パス化する"""
        project_root = Path(__file__).resolve().parent.parent.parent
        return str(project_root / self.DEFAULT_OUTPUT_DIR)

    @staticmethod
    def _is_directory_path(path: str) -> bool:
        """save_path をフォルダ扱いとするか判定する。"""
        if os.path.isdir(path):
            return True
        if path.endswith(("/", "\\")):
            return True
        if not os.path.splitext(path)[1]:
            return True
        return False

    def save(
        self,
        video_bytes: bytes,
        save_path: Optional[str] = None,
    ) -> str:
        """動画バイトをファイルに保存し、保存先の絶対パスを返す。

        Args:
            video_bytes: 動画バイトデータ（MP4）
            save_path: 保存先。
                       フォルダ指定なら yyyymmdd.hhmmss.mp4 で保存。
                       ファイル指定なら指定ファイルに保存。
                       None なら DEFAULT_OUTPUT_DIR に保存。

        Returns:
            保存先の絶対パス文字列
        """
        if save_path is None:
            save_path = self._resolve_default_output_dir()

        if self._is_directory_path(save_path):
            os.makedirs(save_path, exist_ok=True)
            fname = datetime.now().strftime("%Y%m%d.%H%M%S") + ".mp4"
            dest = os.path.join(save_path, fname)
        else:
            dest = save_path
            parent = os.path.dirname(os.path.abspath(dest))
            if parent:
                os.makedirs(parent, exist_ok=True)

        with open(dest, "wb") as f:
            f.write(video_bytes)

        return os.path.abspath(dest)
