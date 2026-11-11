# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""
画像生成モジュール

OpenAI API（DALL-E 3 / GPT Image 1 / 2 / 2.5）、Gemini / FreeAI（Google Gemini API）、
Codex CLI / Antigravity CLI / Grok CLI を使って画像を生成する。
"""

import base64
import io
import json
import os
import re
import shutil
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Optional

from PIL import Image


class ImageGenerationError(Exception):
    """画像生成エラー"""
    pass


class ImageGeneration:
    """
    画像生成クラス

    provider パラメータ:
        "auto"   — codex → antigravity → openai → freeai → gemini
        "gemini" — Google Gemini API（gemini_key_id が必要）
        "freeai" — FreeAI API（freeai_key_id が必要、実装は Gemini 共通）
        "openai" — OpenAI DALL-E / GPT Image API
        "codex"  — Codex CLI（model は無視。antigravity → openai → freeai → gemini にフォールバック）
        "antigravity" — Antigravity CLI（model は無視。codex → freeai → gemini にフォールバック）
        "grok"   — Grok CLI（model は無視。codex → antigravity → openai → freeai → gemini にフォールバック）
    """

    auto_provider = "codex"

    DEFAULT_OUTPUT_DIR = "backend_server/temp/output"
    CODEX_TIMEOUT_SECONDS = int(os.environ.get("AIDIY_IMAGE_CODEX_TIMEOUT", "1200"))
    ANTIGRAVITY_TIMEOUT_SECONDS = int(os.environ.get("AIDIY_IMAGE_ANTIGRAVITY_TIMEOUT", "1200"))
    GROK_TIMEOUT_SECONDS = int(os.environ.get("AIDIY_IMAGE_GROK_TIMEOUT", "1200"))
    # CLI 系（codex / antigravity / grok）は model を無視して CLI 側の既定に任せる。
    # grok は明示指定のときだけ使う（auto の既定順は従来どおり変えない）。
    _FALLBACK_CHAINS = {
        "auto": ["codex", "antigravity", "openai", "freeai", "gemini"],
        "codex": ["codex", "antigravity", "openai", "freeai", "gemini"],
        "openai": ["openai", "freeai", "gemini"],
        "freeai": ["freeai", "gemini"],
        "gemini": ["gemini", "openai"],
        "antigravity": ["antigravity", "codex", "freeai", "gemini"],
        "grok": ["grok", "codex", "antigravity", "openai", "freeai", "gemini"],
    }
    # model 指定を無視して CLI に任せるプロバイダ
    _CLI_PROVIDERS = ("codex", "antigravity", "grok")

    # ================================================================== #
    # OpenAI モデルカタログ
    # ================================================================== #

    _MODELS = {
        "gpt-image-2.6-sunburst": {
            "display": "GPT Image 2.5 Sunburst",
            "api_model": "gpt-image-2.6-sunburst",
            "qualities": ["low", "medium", "high"],
            "default_quality": "medium",
            "valid_sizes": {"1024x1024", "1536x1024", "1024x1536"},
        },
        "gpt-image-2.6-flare": {
            "display": "GPT Image 2.5 Flare",
            "api_model": "gpt-image-2.6-flare",
            "qualities": ["low", "medium", "high"],
            "default_quality": "medium",
            "valid_sizes": {"1024x1024", "1536x1024", "1024x1536"},
        },
        "gpt-image-2": {
            "display": "GPT Image 2",
            "api_model": "gpt-image-2",
            "qualities": ["low", "medium", "high"],
            "default_quality": "medium",
            "valid_sizes": {"1024x1024", "1536x1024", "1024x1536"},
        },
        "gpt-image-1": {
            "display": "GPT Image 1",
            "api_model": "gpt-image-1",
            "qualities": ["low", "medium", "high"],
            "default_quality": "medium",
            "valid_sizes": {"1024x1024", "1536x1024", "1024x1536"},
        },
        "dall-e-3": {
            "display": "DALL-E 3",
            "api_model": "dall-e-3",
            "qualities": ["standard", "hd"],
            "default_quality": "standard",
            "valid_sizes": {"1024x1024", "1792x1024", "1024x1792"},
        },
    }

    OPENAI_DEFAULT_MODEL = "gpt-image-2.6-sunburst"
    OPENAI_DEFAULT_SIZE = "1024x1024"

    # ================================================================== #
    # Gemini モデルカタログ
    # ================================================================== #

    _GEMINI_MODELS = {
        "gemini-nano-banana-2.1": {
            "display": "Gemini Nano Banana 2.1",
        },
        "gemini-3.1-flash-lite-image": {
            "display": "Gemini 3.1 Flash Lite Image",
        },
        "gemini-3-pro-image": {
            "display": "Gemini 3 Pro Image (Nano Banana Pro)",
        },
        "gemini-3.1-flash-image-preview": {
            "display": "Gemini 3.1 Flash Image (Nano Banana 2)",
            "supports_512": True,
        },
        "gemini-3-pro-image-preview": {
            "display": "Gemini 3 Pro Image Preview (Nano Banana Pro)",
        },
        "gemini-2.5-flash-image": {
            "display": "Gemini 2.5 Flash Image (Nano Banana)",
        },
    }

    GEMINI_DEFAULT_MODEL = "gemini-nano-banana-2.1"
    GEMINI_DEFAULT_SIZE = "1024x1024"
    FREEAI_DEFAULT_SIZE = "512x512"

    # Gemini サイズ → aspect_ratio / image_size マッピング
    _GEMINI_SIZE_MAP = {
        "512x512":   {"aspect_ratio": "1:1",  "image_size": "512"},
        "1024x1024": {"aspect_ratio": "1:1",  "image_size": "1K"},
        "1920x1080": {"aspect_ratio": "16:9", "image_size": "2K"},
        "1080x1920": {"aspect_ratio": "9:16", "image_size": "2K"},
    }

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

    def _get_openai_api_key(self) -> str:
        key = self._read_key_from_config("openai_key_id")
        return key if self._is_valid_key(key) else ""

    def _get_gemini_api_key(self) -> str:
        key = self._read_key_from_config("gemini_key_id")
        return key if self._is_valid_key(key) else ""

    def _get_freeai_api_key(self) -> str:
        key = self._read_key_from_config("freeai_key_id")
        return key if self._is_valid_key(key) else ""

    # ------------------------------------------------------------------ #
    # モデル解決
    # ------------------------------------------------------------------ #

    def _resolve_openai_model(self, model_id: Optional[str] = None):
        mid = (model_id or self.OPENAI_DEFAULT_MODEL).strip()
        if mid in self._MODELS:
            return mid, self._MODELS[mid]
        return self.OPENAI_DEFAULT_MODEL, self._MODELS[self.OPENAI_DEFAULT_MODEL]

    def _resolve_gemini_model(self, model_id: Optional[str] = None):
        mid = (model_id or self.GEMINI_DEFAULT_MODEL).strip()
        if mid in self._GEMINI_MODELS:
            return mid, self._GEMINI_MODELS[mid]
        return self.GEMINI_DEFAULT_MODEL, self._GEMINI_MODELS[self.GEMINI_DEFAULT_MODEL]

    def _resolve_gemini_size(self, size: str):
        size = size.strip()
        if size in self._GEMINI_SIZE_MAP:
            return self._GEMINI_SIZE_MAP[size]
        return self._GEMINI_SIZE_MAP[self.GEMINI_DEFAULT_SIZE]

    # ------------------------------------------------------------------ #
    # Code CLI 起動
    # ------------------------------------------------------------------ #

    def _npm_shim_to_direct_command(self, cmd_path: str) -> Optional[list[str]]:
        """npm の .cmd シムを node.exe 直接起動へ解決する。"""
        if os.name != "nt" or not cmd_path or not cmd_path.lower().endswith(".cmd"):
            return None
        try:
            with open(cmd_path, "r", encoding="utf-8", errors="replace") as f:
                body = f.read()
        except OSError:
            return None

        dp0 = os.path.dirname(os.path.abspath(cmd_path))

        def expand(path: str) -> str:
            return os.path.normpath(path.replace("%dp0%", dp0).replace("%~dp0", dp0))

        match = re.search(r'"%_prog%"\s+"([^"]+)"\s+%\*', body, re.IGNORECASE)
        if match:
            js_path = expand(match.group(1))
            if os.path.isfile(js_path):
                node_exe = os.path.join(dp0, "node.exe")
                if not os.path.isfile(node_exe):
                    node_exe = "node"
                return [node_exe, js_path]

        match = re.search(r'"([^"]+\.exe)"\s+%\*', body, re.IGNORECASE)
        if match:
            exe_path = expand(match.group(1))
            if os.path.isfile(exe_path):
                return [exe_path]

        return None

    def _codex_command_base(self) -> list[str]:
        custom_cmd = (
            os.environ.get("CODEX_CLI_PATH")
            or os.environ.get("CODEX_CLI_CLI_PATH")
            or os.environ.get("AIDIY_CODEX_CLI_PATH")
        )
        if custom_cmd:
            direct = self._npm_shim_to_direct_command(custom_cmd)
            return direct if direct is not None else [custom_cmd]

        if os.name == "nt":
            userprofile = os.environ.get("USERPROFILE", os.path.expanduser("~"))
            candidate = os.path.join(userprofile, "AppData", "Roaming", "npm", "codex.cmd")
            if os.path.isfile(candidate):
                direct = self._npm_shim_to_direct_command(candidate)
                return direct if direct is not None else [candidate]

        return ["codex"]

    def _antigravity_command_base(self) -> list[str]:
        custom_cmd = (
            os.environ.get("ANTIGRAVITY_CLI_PATH")
            or os.environ.get("ANTIGRAVITY_CLI_CLI_PATH")
            or os.environ.get("AIDIY_ANTIGRAVITY_CLI_PATH")
        )
        if custom_cmd:
            return [custom_cmd]

        if os.name == "nt":
            userprofile = os.environ.get("USERPROFILE", os.path.expanduser("~"))
            candidate = os.path.join(userprofile, "AppData", "Local", "agy", "bin", "agy.exe")
            if os.path.isfile(candidate):
                return [candidate]

        return ["agy"]

    def _grok_command_base(self) -> list[str]:
        """Grok CLI（xai-org/grok-build）の実行コマンドを返す。

        npm ではなく ~/.grok/bin へ入るため、AIコード_cli.py と同じ探索順にする。
        """
        custom_cmd = (
            os.environ.get("GROK_CLI_PATH")
            or os.environ.get("GROK_CLI_CLI_PATH")
            or os.environ.get("AIDIY_GROK_CLI_PATH")
        )
        if custom_cmd:
            direct = self._npm_shim_to_direct_command(custom_cmd)
            return direct if direct is not None else [custom_cmd]

        userprofile = os.environ.get("USERPROFILE", os.path.expanduser("~"))
        exe = "grok.exe" if os.name == "nt" else "grok"
        candidate = os.path.join(userprofile, ".grok", "bin", exe)
        if os.path.isfile(candidate):
            return [candidate]

        return ["grok"]

    def _codex_output_path(self) -> Path:
        out_dir = Path(self._resolve_default_output_dir())
        out_dir.mkdir(parents=True, exist_ok=True)
        return out_dir / (datetime.now().strftime("%Y%m%d.%H%M%S") + ".png")

    @staticmethod
    def _save_png_file(img: Image.Image, output_path: Path) -> None:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        img.save(output_path, format="PNG", optimize=True)

    def copy_generated_file(self, generated_path: str, save_path: str) -> str:
        """生成済み PNG をユーザー指定先へコピーし、実際のコピー先を返す。"""
        src = Path(generated_path)
        if not src.is_file():
            raise ImageGenerationError(f"生成済み画像が見つかりません: {generated_path}")

        if self._is_directory_path(save_path):
            dest = Path(save_path) / src.name
        else:
            dest = Path(save_path)
        dest.parent.mkdir(parents=True, exist_ok=True)

        if src.resolve() != dest.resolve():
            shutil.copyfile(src, dest)
        return str(dest)

    @staticmethod
    def file_to_base64(path: str) -> str:
        with open(path, "rb") as f:
            return base64.b64encode(f.read()).decode("ascii")

    def _build_cli_image_prompt(
        self,
        cli_label: str,
        prompt: str,
        output_path: Path,
        original_path: Optional[str],
        size: str,
        quality: str,
    ) -> str:
        size_note = "" if not size or size == "auto" else f"\n- 希望サイズ: {size}"
        quality_note = "" if not quality or quality == "auto" else f"\n- 希望品質: {quality}"
        original_note = ""
        if original_path:
            original_abs_path = Path(original_path).resolve().as_posix()
            original_note = (
                f"\n- 参照画像: {original_abs_path}"
                f"\n\n添付ファイル: `{original_abs_path}`"
            )

        return (
            f"あなたは AiDiy の画像生成担当です。{cli_label} で以下の内容の画像を1枚生成し、"
            "必ず指定された PNG ファイルだけを成果物として保存してください。\n\n"
            f"- 保存先: {output_path.resolve().as_posix()}\n"
            f"- 画像プロンプト: {prompt.strip()}"
            f"{original_note}"
            f"{size_note}"
            f"{quality_note}\n\n"
            "重要:\n"
            "- 保存先ディレクトリがなければ作成してください。\n"
            "- ファイル形式は PNG とし、指定パスとファイル名を変更しないでください。\n"
            "- モデル指定は無視してください。\n"
            "- 完了後は短く報告してください。"
        )

    def _build_codex_prompt(
        self,
        prompt: str,
        output_path: Path,
        original_path: Optional[str],
        size: str,
        quality: str,
    ) -> str:
        return self._build_cli_image_prompt("Codex CLI", prompt, output_path, original_path, size, quality)

    def _build_antigravity_prompt(
        self,
        prompt: str,
        output_path: Path,
        original_path: Optional[str],
        size: str,
        quality: str,
    ) -> str:
        return self._build_cli_image_prompt("Antigravity CLI", prompt, output_path, original_path, size, quality)

    def _build_grok_prompt(
        self,
        prompt: str,
        output_path: Path,
        original_path: Optional[str],
        size: str,
        quality: str,
    ) -> str:
        return self._build_cli_image_prompt("Grok CLI", prompt, output_path, original_path, size, quality)

    def _generate_codex(
        self,
        prompt: str,
        original_path: Optional[str],
        size: str,
        quality: str,
    ) -> tuple[Image.Image, dict]:
        output_path = self._codex_output_path()
        if output_path.exists():
            output_path.unlink()

        command = self._codex_command_base() + [
            "exec",
            "--skip-git-repo-check",
            "--dangerously-bypass-approvals-and-sandbox",
            self._build_codex_prompt(prompt, output_path, original_path, size, quality),
        ]
        cwd = Path(__file__).resolve().parent.parent.parent

        try:
            proc = subprocess.run(
                command,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), cwd=str(cwd),
                env=os.environ.copy(),
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=self.CODEX_TIMEOUT_SECONDS,
                check=False,
            )
        except FileNotFoundError as e:
            raise ImageGenerationError("codex CLI が見つかりません") from e
        except subprocess.TimeoutExpired as e:
            raise ImageGenerationError(
                f"codex CLI がタイムアウトしました({self.CODEX_TIMEOUT_SECONDS}秒)"
            ) from e

        if proc.returncode != 0:
            stderr = (proc.stderr or b"").decode("utf-8", errors="replace").strip()
            stdout = (proc.stdout or b"").decode("utf-8", errors="replace").strip()
            detail = stderr or stdout or f"returncode={proc.returncode}"
            raise ImageGenerationError(f"codex CLI 実行に失敗しました: {detail[:500]}")

        if not output_path.is_file():
            raise ImageGenerationError(f"codex CLI が画像ファイルを作成しませんでした: {output_path}")

        try:
            with Image.open(output_path) as src:
                img = src.copy()
        except Exception as e:
            raise ImageGenerationError(f"codex CLI の出力を画像として読めません: {output_path}") from e

        info = {
            "provider": "codex",
            "model": "ignored",
            "prompt": prompt.strip(),
            "original_path": original_path,
            "width": img.width,
            "height": img.height,
            "size": size,
            "quality": quality,
            "generated_path": str(output_path),
            "engine_note": "Codex CLI",
        }
        return img, info

    def _generate_antigravity(
        self,
        prompt: str,
        original_path: Optional[str],
        size: str,
        quality: str,
    ) -> tuple[Image.Image, dict]:
        output_path = self._codex_output_path()
        if output_path.exists():
            output_path.unlink()

        command = self._antigravity_command_base() + [
            "--dangerously-skip-permissions",
            "--print-timeout",
            "20m",
            "-p",
            self._build_antigravity_prompt(prompt, output_path, original_path, size, quality),
        ]
        cwd = Path(__file__).resolve().parent.parent.parent
        creationflags = (
            subprocess.DETACHED_PROCESS
            if os.name == "nt" and hasattr(subprocess, "DETACHED_PROCESS")
            else 0
        )

        try:
            proc = subprocess.run(
                command,
                cwd=str(cwd),
                env=os.environ.copy(),
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=self.ANTIGRAVITY_TIMEOUT_SECONDS,
                check=False,
                creationflags=creationflags,
            )
        except FileNotFoundError as e:
            raise ImageGenerationError("antigravity CLI (agy) が見つかりません") from e
        except subprocess.TimeoutExpired as e:
            raise ImageGenerationError(
                f"antigravity CLI がタイムアウトしました({self.ANTIGRAVITY_TIMEOUT_SECONDS}秒)"
            ) from e

        if proc.returncode != 0:
            stderr = (proc.stderr or b"").decode("utf-8", errors="replace").strip()
            stdout = (proc.stdout or b"").decode("utf-8", errors="replace").strip()
            detail = stderr or stdout or f"returncode={proc.returncode}"
            raise ImageGenerationError(f"antigravity CLI 実行に失敗しました: {detail[:500]}")

        if not output_path.is_file():
            raise ImageGenerationError(f"antigravity CLI が画像ファイルを作成しませんでした: {output_path}")

        try:
            with Image.open(output_path) as src:
                img = src.copy()
        except Exception as e:
            raise ImageGenerationError(f"antigravity CLI の出力を画像として読めません: {output_path}") from e

        info = {
            "provider": "antigravity",
            "model": "ignored",
            "prompt": prompt.strip(),
            "original_path": original_path,
            "width": img.width,
            "height": img.height,
            "size": size,
            "quality": quality,
            "generated_path": str(output_path),
            "engine_note": "Antigravity CLI",
        }
        return img, info

    def _generate_grok(
        self,
        prompt: str,
        original_path: Optional[str],
        size: str,
        quality: str,
    ) -> tuple[Image.Image, dict]:
        output_path = self._codex_output_path()
        if output_path.exists():
            output_path.unlink()

        cwd = Path(__file__).resolve().parent.parent.parent
        # --always-approve: 全ツール実行を自動承認（ヘッドレス実行に必須）
        # --no-auto-update: 自動更新チェックを止める
        # -p: 単発プロンプト（応答を stdout に出して終了）
        command = self._grok_command_base() + [
            "--always-approve",
            "--no-auto-update",
            "--cwd",
            str(cwd),
            "-p",
            self._build_grok_prompt(prompt, output_path, original_path, size, quality),
        ]

        try:
            proc = subprocess.run(
                command,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), cwd=str(cwd),
                env=os.environ.copy(),
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=self.GROK_TIMEOUT_SECONDS,
                check=False,
            )
        except FileNotFoundError as e:
            raise ImageGenerationError("grok CLI が見つかりません") from e
        except subprocess.TimeoutExpired as e:
            raise ImageGenerationError(
                f"grok CLI がタイムアウトしました({self.GROK_TIMEOUT_SECONDS}秒)"
            ) from e

        if proc.returncode != 0:
            stderr = (proc.stderr or b"").decode("utf-8", errors="replace").strip()
            stdout = (proc.stdout or b"").decode("utf-8", errors="replace").strip()
            detail = stderr or stdout or f"returncode={proc.returncode}"
            raise ImageGenerationError(f"grok CLI 実行に失敗しました: {detail[:500]}")

        if not output_path.is_file():
            raise ImageGenerationError(f"grok CLI が画像ファイルを作成しませんでした: {output_path}")

        try:
            with Image.open(output_path) as src:
                img = src.copy()
        except Exception as e:
            raise ImageGenerationError(f"grok CLI の出力を画像として読めません: {output_path}") from e

        info = {
            "provider": "grok",
            "model": "ignored",
            "prompt": prompt.strip(),
            "original_path": original_path,
            "width": img.width,
            "height": img.height,
            "size": size,
            "quality": quality,
            "generated_path": str(output_path),
            "engine_note": "Grok CLI",
        }
        return img, info

    # ------------------------------------------------------------------ #
    # 画像生成（OpenAI）
    # ------------------------------------------------------------------ #

    def _generate_openai(
        self,
        prompt: str,
        original_path: Optional[str],
        model: str,
        size: str,
        quality: str,
    ) -> tuple[Image.Image, dict]:
        api_key = self._get_openai_api_key()
        if not api_key:
            raise ImageGenerationError(
                "OpenAI API キーが設定されていません。"
                "AiDiy_key.json の openai_key_id を設定してください。"
            )

        try:
            from openai import OpenAI
        except ImportError:
            raise ImageGenerationError(
                "openai パッケージがインストールされていません。"
                "pip install openai で導入してください。"
            )

        model_id, model_meta = self._resolve_openai_model(
            model if model != "auto" else None
        )

        if size == "auto":
            size = self.OPENAI_DEFAULT_SIZE
        elif size not in model_meta["valid_sizes"]:
            size = self.OPENAI_DEFAULT_SIZE

        if quality == "auto":
            quality = model_meta["default_quality"]

        client = OpenAI(api_key=api_key)
        try:
            payload = {
                "model": model_meta["api_model"],
                "prompt": prompt.strip(),
                "size": size,
                "quality": quality,
                "n": 1,
            }
            if original_path:
                with open(original_path, "rb") as f:
                    response = client.images.edit(image=f, **payload)
            else:
                if model_id == "dall-e-3":
                    payload["response_format"] = "b64_json"
                response = client.images.generate(**payload)
        finally:
            close = getattr(client, "close", None)
            if callable(close):
                close()

        data = getattr(response, "data", None) or []
        if not data:
            raise ImageGenerationError("OpenAI が画像データを返しませんでした")

        first = data[0]
        b64 = getattr(first, "b64_json", None)
        url = getattr(first, "url", None)

        if b64:
            raw = base64.b64decode(b64)
        elif url:
            import requests as _r
            raw = _r.get(url, timeout=60).content
        else:
            raise ImageGenerationError("OpenAI が画像データを返しませんでした")

        img = Image.open(io.BytesIO(raw))

        info = {
            "provider": "openai",
            "model": model_id,
            "prompt": prompt.strip(),
            "original_path": original_path,
            "width": img.width,
            "height": img.height,
            "size": size,
            "quality": quality,
            "engine_note": f"OpenAI {model_meta['display']}",
        }
        return img, info

    # ------------------------------------------------------------------ #
    # 画像生成（Gemini / FreeAI）
    # ------------------------------------------------------------------ #

    def _generate_gemini(
        self,
        prompt: str,
        original_path: Optional[str],
        model: str,
        size: str,
        provider: str,
    ) -> tuple[Image.Image, dict]:
        if provider == "freeai":
            api_key = self._get_freeai_api_key()
            provider_label = "freeai"
            default_size = self.FREEAI_DEFAULT_SIZE
        else:
            api_key = self._get_gemini_api_key()
            provider_label = "gemini"
            default_size = self.GEMINI_DEFAULT_SIZE

        if not api_key:
            raise ImageGenerationError(
                f"{provider_label.upper()} API キーが設定されていません。"
                f"AiDiy_key.json の {provider_label}_key_id を設定してください。"
            )

        try:
            from google import genai
            from google.genai import types
        except ImportError:
            raise ImageGenerationError(
                "google-genai パッケージがインストールされていません。"
                "pip install google-genai で導入してください。"
            )

        model_id, model_meta = self._resolve_gemini_model(
            model if model != "auto" else None
        )
        size_conf = self._resolve_gemini_size(size if size != "auto" else default_size)
        if size_conf["image_size"] == "512" and not model_meta.get("supports_512"):
            # 512 は一部モデルのみ対応（それ以外は 400 になる）ため 1K に引き上げる
            size_conf = {**size_conf, "image_size": "1K"}

        client = genai.Client(api_key=api_key)

        contents = [prompt.strip()]
        if original_path:
            contents.append(Image.open(original_path))

        image_config = types.ImageConfig(
            aspect_ratio=size_conf["aspect_ratio"],
            image_size=size_conf["image_size"],
        )

        config = types.GenerateContentConfig(
            response_modalities=["TEXT", "IMAGE"],
            image_config=image_config,
        )

        response = client.models.generate_content(
            model=model_id,
            contents=contents,
            config=config,
        )

        img = None
        for part in response.parts:
            if part.inline_data is not None:
                img = part.as_image()._pil_image
                break

        if img is None:
            raise ImageGenerationError("Gemini が画像データを返しませんでした")

        info = {
            "provider": provider_label,
            "model": model_id,
            "prompt": prompt.strip(),
            "original_path": original_path,
            "width": img.width,
            "height": img.height,
            "size": size,
            "aspect_ratio": size_conf["aspect_ratio"],
            "image_size": size_conf["image_size"],
            "engine_note": f"Gemini {model_meta['display']} ({provider_label})",
        }
        return img, info

    def _generate_provider(
        self,
        provider: str,
        prompt: str,
        original_path: Optional[str],
        model: str,
        size: str,
        quality: str,
    ) -> tuple[Image.Image, dict]:
        if provider == "codex":
            return self._generate_codex(prompt, original_path, size, quality)
        if provider == "antigravity":
            return self._generate_antigravity(prompt, original_path, size, quality)
        if provider == "grok":
            return self._generate_grok(prompt, original_path, size, quality)
        if provider == "openai":
            return self._generate_openai(prompt, original_path, model, size, quality)
        if provider in ("freeai", "gemini"):
            return self._generate_gemini(prompt, original_path, model, size, provider)
        raise ImageGenerationError(f"未対応の provider です: '{provider}'")

    # ------------------------------------------------------------------ #
    # 画像生成（統合入口）
    # ------------------------------------------------------------------ #

    def generate(
        self,
        prompt: str,
        provider: str = "auto",
        original_path: Optional[str] = None,
        model: str = "auto",
        size: str = "auto",
        quality: str = "auto",
    ) -> tuple[Image.Image, dict]:
        """
        プロンプトから画像を生成する。

        Args:
            prompt: 生成プロンプト
            provider: "auto" / "openai" / "gemini" / "freeai" / "codex" / "antigravity" / "grok"
            original_path: 参照画像のパス（省略可）
            model:
              OpenAI: "auto"=gpt-image-2.6-sunburst / "gpt-image-2.6-sunburst" / "gpt-image-2.6-flare" / "gpt-image-2" / "gpt-image-1" / "dall-e-3"
              Gemini/FreeAI: "auto"=gemini-nano-banana-2.1 / "gemini-3.1-flash-lite-image" / "gemini-3-pro-image" / ...
              Auto/Codex/Antigravity/Grok: 指定値は無視
            size:
              OpenAI: "auto"=1024x1024 / "1024x1024" / "1536x1024" / "1024x1536" / ...
              Gemini/FreeAI: "auto"=1024x1024 / "512x512" / "1024x1024" / "1920x1080" / "1080x1920"
            quality:
              OpenAI only: "auto"（モデル既定値） / gpt-image-2.6-* / gpt-image-2: "low","medium","high" / dall-e-3: "standard","hd"

        Returns:
            (image, info_dict)
            info_dict: provider, model, prompt, width, height, engine_note
        """
        if not prompt or not prompt.strip():
            raise ImageGenerationError("prompt は必須です")

        provider = provider.strip().lower()
        if provider not in self._FALLBACK_CHAINS:
            valid = " / ".join(self._FALLBACK_CHAINS.keys())
            raise ImageGenerationError(
                f"未対応の provider です: '{provider}'（{valid} のみ）"
            )

        if original_path and not os.path.isfile(original_path):
            raise ImageGenerationError(f"参照画像が見つかりません: '{original_path}'")

        chain = self._FALLBACK_CHAINS[self.auto_provider if provider == "auto" else provider]
        effective_model = "auto" if provider in ("auto", *self._CLI_PROVIDERS) else model
        errors: list[str] = []
        for index, candidate in enumerate(chain):
            try:
                img, info = self._generate_provider(
                    candidate, prompt, original_path, effective_model, size, quality
                )
            except ImageGenerationError as e:
                errors.append(f"{candidate}: {e}")
                continue

            info = dict(info)
            info["requested_provider"] = provider
            info["fallback_chain"] = chain
            if index > 0:
                info["fallback_from"] = provider
                info["fallback_errors"] = errors
                info["engine_note"] = f"{info.get('engine_note', candidate)} ({provider} fallback)"

            if provider in ("auto", *self._CLI_PROVIDERS) and not info.get("generated_path"):
                output_path = self._codex_output_path()
                try:
                    self._save_png_file(img, output_path)
                except Exception as e:
                    raise ImageGenerationError(
                        f"{candidate} フォールバック画像を保存できませんでした: {output_path}"
                    ) from e
                info["generated_path"] = str(output_path)

            return img, info

        raise ImageGenerationError("画像生成に失敗しました: " + " / ".join(errors))

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
        img: Image.Image,
        fmt: str = "png",
        quality: int = 85,
        save_path: Optional[str] = None,
        return_base64: bool = True,
    ) -> tuple[str, str]:
        """PIL Image を保存し、(base64, 保存先パス) を返す。

        return_base64=False なら base64 は空文字にする。呼び出し側が保存先を
        知っているのに同じ画像を base64 でも返すと、文脈が二重に膨らむため。

        Args:
            fmt: "png" または "jpeg"
            quality: JPEG 品質 (1-100)
            save_path: 保存先。
                       フォルダ指定（既存ディレクトリ / 末尾 / または \\ / 拡張子なし）なら
                       そのフォルダに yyyymmdd.hhmmss.png で保存。
                       ファイル指定（拡張子あり）なら指定ファイルに上書き保存（拡張子に合わせて変換）。
                       None なら DEFAULT_OUTPUT_DIR にデフォルト保存。
        """
        buf = io.BytesIO()
        fmt_upper = fmt.upper()
        if fmt_upper in ("JPEG", "JPG"):
            img = img.convert("RGB")
            img.save(buf, format="JPEG", quality=quality, optimize=True)
        else:
            img.save(buf, format="PNG", optimize=True)
        data = buf.getvalue()

        if save_path is None:
            save_path = self._resolve_default_output_dir()

        if self._is_directory_path(save_path):
            os.makedirs(save_path, exist_ok=True)
            fname = datetime.now().strftime("%Y%m%d.%H%M%S") + ".png"
            dest = os.path.join(save_path, fname)
            file_buf = io.BytesIO()
            img.save(file_buf, format="PNG", optimize=True)
            file_data = file_buf.getvalue()
        else:
            dest = save_path
            parent = os.path.dirname(os.path.abspath(dest))
            if parent:
                os.makedirs(parent, exist_ok=True)
            ext = os.path.splitext(save_path)[1].lower()
            if ext in (".jpg", ".jpeg"):
                file_buf = io.BytesIO()
                img.convert("RGB").save(file_buf, format="JPEG", quality=quality, optimize=True)
                file_data = file_buf.getvalue()
            else:
                file_buf = io.BytesIO()
                img.save(file_buf, format="PNG", optimize=True)
                file_data = file_buf.getvalue()
        with open(dest, "wb") as f:
            f.write(file_data)

        if not return_base64:
            return "", dest
        return base64.b64encode(data).decode("ascii"), dest
