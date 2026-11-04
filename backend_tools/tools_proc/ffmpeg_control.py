# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""
ffmpeg / ffprobe / ffplay 制御モジュール

各サブコマンドの引数文字列（args_str）を受け取り、サブプロセスとして実行する。
高水準のラッパーは設けず、引数構築は呼び出し側（AI）に委ねる。
"""

from __future__ import annotations

import array
import asyncio
import json
import math
import shlex
import shutil
import subprocess
from pathlib import Path
from typing import Any, Optional

try:
    import audioop  # type: ignore[import-not-found]
    _HAS_AUDIOOP = True
except ImportError:  # Python 3.13+ で stdlib から削除されている環境向けフォールバック
    audioop = None  # type: ignore[assignment]
    _HAS_AUDIOOP = False

from log_config import get_logger

logger = get_logger(__name__)


class FfmpegControlError(Exception):
    """ffmpeg / ffprobe / ffplay 制御エラー"""


class FfmpegControl:
    """ffmpeg / ffprobe / ffplay の薄いランナー"""

    DEFAULT_FFMPEG_PATH = "ffmpeg"
    DEFAULT_FFPROBE_PATH = "ffprobe"
    DEFAULT_FFPLAY_PATH = "ffplay"
    DEFAULT_TIMEOUT_SEC = 600.0
    DEFAULT_PLAY_TIMEOUT_SEC = 600.0
    DEFAULT_OUTPUT_BYTES = 1024 * 1024  # stdout/stderr の文字列化上限

    # 接続設定ファイル（backend_tools 起点）
    _FFMPEG_CONFIG_REL = "../_config/mcp_ffmpeg_control.json"
    _LEGACY_FFMPEG_CONFIG_REL = "../_config/aidiy_ffmpeg_control.json"

    def __init__(
        self,
        ffmpeg_path: Optional[str] = None,
        ffprobe_path: Optional[str] = None,
        ffplay_path: Optional[str] = None,
        timeout_sec: Optional[float] = None,
    ) -> None:
        config = self._load_or_create_config()

        self.ffmpeg_path = (
            ffmpeg_path
            if ffmpeg_path is not None
            else str(config.get("ffmpeg_path", self.DEFAULT_FFMPEG_PATH))
        )
        self.ffprobe_path = (
            ffprobe_path
            if ffprobe_path is not None
            else str(config.get("ffprobe_path", self.DEFAULT_FFPROBE_PATH))
        )
        self.ffplay_path = (
            ffplay_path
            if ffplay_path is not None
            else str(config.get("ffplay_path", self.DEFAULT_FFPLAY_PATH))
        )
        self.default_timeout_sec = float(
            timeout_sec
            if timeout_sec is not None
            else config.get("default_timeout_sec", self.DEFAULT_TIMEOUT_SEC)
        )
        self.default_play_timeout_sec = float(
            config.get("default_play_timeout_sec", self.DEFAULT_PLAY_TIMEOUT_SEC)
        )

        # 起動時に各実行ファイルの -version を確認する
        self.version_info: dict[str, Any] = self._probe_versions()

    # ------------------------------------------------------------------ #
    # 設定ファイル
    # ------------------------------------------------------------------ #

    def _config_path(self) -> Path:
        return Path(__file__).resolve().parent.parent / self._FFMPEG_CONFIG_REL

    def _legacy_config_path(self) -> Path:
        return Path(__file__).resolve().parent.parent / self._LEGACY_FFMPEG_CONFIG_REL

    def _default_config(self) -> dict[str, Any]:
        return {
            "version": 1,
            "description": (
                "mcp_ffmpeg_control の実行ファイルパス・既定タイムアウト設定。"
                " PATH 上にあれば実行ファイル名のみ、別パスならフルパスを指定する。"
            ),
            "ffmpeg_path": self.DEFAULT_FFMPEG_PATH,
            "ffprobe_path": self.DEFAULT_FFPROBE_PATH,
            "ffplay_path": self.DEFAULT_FFPLAY_PATH,
            "default_timeout_sec": self.DEFAULT_TIMEOUT_SEC,
            "default_play_timeout_sec": self.DEFAULT_PLAY_TIMEOUT_SEC,
        }

    def _write_default_config(self, config_path: Path) -> None:
        config_path.parent.mkdir(parents=True, exist_ok=True)
        with open(config_path, "w", encoding="utf-8", newline="\n") as f:
            json.dump(self._default_config(), f, ensure_ascii=False, indent=2)
            f.write("\n")

    def _migrate_legacy_config(self, config_path: Path) -> bool:
        legacy_path = self._legacy_config_path()
        if config_path.exists() or not legacy_path.exists():
            return False
        try:
            config_path.parent.mkdir(parents=True, exist_ok=True)
            legacy_path.replace(config_path)
            return True
        except OSError:
            return False

    def _load_or_create_config(self) -> dict[str, Any]:
        """設定ファイルがあれば読む。無ければデフォルトを書き出す。"""
        config_path = self._config_path()
        self._migrate_legacy_config(config_path)
        if not config_path.exists():
            try:
                self._write_default_config(config_path)
            except OSError:
                return self._default_config()
            return self._default_config()

        try:
            with open(config_path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except (json.JSONDecodeError, OSError):
            return self._default_config()

        if not isinstance(data, dict):
            return self._default_config()
        return data

    # ------------------------------------------------------------------ #
    # 実行ヘルパー
    # ------------------------------------------------------------------ #

    def _resolve_executable(self, exe_path: str, label: str) -> str:
        """実行ファイルが見つからなければ FfmpegControlError を投げる。"""
        # 区切り文字を含むならフルパス指定。そうでなければ which で解決。
        candidate = Path(exe_path)
        if any(sep in exe_path for sep in ("/", "\\")) or candidate.is_absolute():
            if candidate.is_file():
                return str(candidate)
            raise FfmpegControlError(
                f"{label} が見つかりません: {exe_path}"
            )
        resolved = shutil.which(exe_path)
        if resolved:
            return resolved
        raise FfmpegControlError(
            f"{label} が PATH 上に見つかりません: {exe_path}"
        )

    @staticmethod
    def _split_args(args_str: str) -> list[str]:
        """args_str を shlex で argv リストに変換する（POSIX 風、Windows パスも安全）。"""
        if not isinstance(args_str, str):
            raise FfmpegControlError("args_str は文字列で指定してください")
        try:
            # posix=False で Windows パスのバックスラッシュをエスケープ扱いしない
            tokens = shlex.split(args_str, posix=False)
            # subprocess の argv には区切り用の引用符を含めない。
            # バックスラッシュは維持し、引用されたパス内の空白を1引数に保つ。
            return [
                token[1:-1]
                if len(token) >= 2 and token[0] == token[-1] and token[0] in ('"', "'")
                else token
                for token in tokens
            ]
        except ValueError as e:
            raise FfmpegControlError(f"args_str の解析に失敗しました: {e}") from e

    @staticmethod
    def _decode_bytes(data: bytes, limit: int) -> str:
        if not data:
            return ""
        if len(data) > limit:
            data = data[:limit]
            suffix = b"\n... [truncated]"
            data = data + suffix
        return data.decode("utf-8", errors="replace")

    async def _exec(
        self,
        exe_path: str,
        label: str,
        args_str: str,
        timeout_sec: Optional[float],
        capture_output: bool,
    ) -> dict[str, Any]:
        """汎用サブプロセス実行。capture_output=False の場合は stdout/stderr を捕捉しない。"""
        resolved = self._resolve_executable(exe_path, label)
        argv = [resolved] + self._split_args(args_str)
        effective_timeout = (
            float(timeout_sec) if timeout_sec is not None else self.default_timeout_sec
        )

        try:
            if capture_output:
                proc = await asyncio.create_subprocess_exec(
                    *argv,
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
            else:
                proc = await asyncio.create_subprocess_exec(*argv, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        except FileNotFoundError as e:
            raise FfmpegControlError(f"{label} を起動できません: {e}") from e
        except OSError as e:
            raise FfmpegControlError(f"{label} の起動に失敗しました: {e}") from e

        try:
            stdout_b, stderr_b = await asyncio.wait_for(
                proc.communicate(), timeout=effective_timeout
            )
        except asyncio.TimeoutError:
            try:
                proc.kill()
            except ProcessLookupError:
                pass
            raise FfmpegControlError(
                f"{label} がタイムアウトしました（{effective_timeout:g} 秒）"
            )

        return {
            "command": argv,
            "returncode": proc.returncode,
            "stdout": self._decode_bytes(stdout_b or b"", self.DEFAULT_OUTPUT_BYTES),
            "stderr": self._decode_bytes(stderr_b or b"", self.DEFAULT_OUTPUT_BYTES),
            "timeout_sec": effective_timeout,
        }

    # ------------------------------------------------------------------ #
    # 公開操作
    # ------------------------------------------------------------------ #

    async def run_ffmpeg(
        self,
        args_str: str,
        timeout_sec: Optional[float] = None,
    ) -> dict[str, Any]:
        return await self._exec(
            self.ffmpeg_path, "ffmpeg", args_str, timeout_sec, capture_output=True
        )

    async def run_ffprobe(
        self,
        args_str: str,
        timeout_sec: Optional[float] = None,
    ) -> dict[str, Any]:
        return await self._exec(
            self.ffprobe_path, "ffprobe", args_str, timeout_sec, capture_output=True
        )

    async def run_ffplay(
        self,
        args_str: str,
        timeout_sec: Optional[float] = None,
    ) -> dict[str, Any]:
        effective_timeout = (
            float(timeout_sec)
            if timeout_sec is not None
            else self.default_play_timeout_sec
        )
        # ffplay はウィンドウを開く対話アプリ。タイムアウトで kill されるため、
        # 呼び出し側で `-autoexit -t <秒>` を付けて自然終了させるのが望ましい。
        return await self._exec(
            self.ffplay_path,
            "ffplay",
            args_str,
            effective_timeout,
            capture_output=True,
        )

    # ------------------------------------------------------------------ #
    # 作業ディレクトリ（必要時に backend_server/temp/work/ 配下を確保する）
    # ------------------------------------------------------------------ #

    _WORK_DIR_REL = "../backend_server/temp/work"

    def _allocate_work_dir(self) -> Path:
        """`backend_server/temp/work/YYYYMMDD.HHMMSS.<microsec3>` を作成して返す。"""
        from datetime import datetime
        now = datetime.now()
        slug = now.strftime("%Y%m%d.%H%M%S.") + f"{now.microsecond // 1000:03d}"
        base = (Path(__file__).resolve().parent.parent / self._WORK_DIR_REL).resolve()
        work_dir = base / slug
        work_dir.mkdir(parents=True, exist_ok=True)
        return work_dir

    # ------------------------------------------------------------------ #
    # 音声強度解析（無音区間検出 → トリム秒数推定）
    # ------------------------------------------------------------------ #

    async def _extract_pcm(
        self,
        input_path: str,
        sample_rate: int,
        timeout_sec: float,
    ) -> tuple[bytes, str]:
        """ffmpeg で 16bit mono PCM を抽出して bytes で返す。stderr は文字列で返す。"""
        ffmpeg_exe = self._resolve_executable(self.ffmpeg_path, "ffmpeg")
        argv = [
            ffmpeg_exe,
            "-v", "error",
            "-i", str(input_path),
            "-vn",
            "-ac", "1",
            "-ar", str(int(sample_rate)),
            "-f", "s16le",
            "-",
        ]
        try:
            proc = await asyncio.create_subprocess_exec(
                *argv,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
        except OSError as e:
            raise FfmpegControlError(f"ffmpeg の起動に失敗しました: {e}") from e

        try:
            stdout_b, stderr_b = await asyncio.wait_for(
                proc.communicate(), timeout=timeout_sec
            )
        except asyncio.TimeoutError:
            try:
                proc.kill()
            except ProcessLookupError:
                pass
            raise FfmpegControlError(
                f"ffmpeg (PCM 抽出) がタイムアウトしました（{timeout_sec:g} 秒）"
            )

        stderr_text = self._decode_bytes(stderr_b or b"", self.DEFAULT_OUTPUT_BYTES)
        if proc.returncode != 0:
            raise FfmpegControlError(
                f"ffmpeg PCM 抽出失敗 (rc={proc.returncode}): {stderr_text[:500]}"
            )
        return stdout_b or b"", stderr_text

    @staticmethod
    def _window_rms(pcm: bytes, start_byte: int, end_byte: int, sample_width: int) -> float:
        """1 ウィンドウ分の PCM bytes から RMS（線形値、s16 なら 0〜32767 相当）を返す。"""
        chunk = pcm[start_byte:end_byte]
        if not chunk:
            return 0.0
        if _HAS_AUDIOOP:
            return float(audioop.rms(chunk, sample_width))  # type: ignore[union-attr]
        # フォールバック: int16 として読み出して RMS を計算
        if sample_width != 2:
            raise FfmpegControlError(
                "audioop が利用できない環境では sample_width=2 (s16le) のみ対応"
            )
        samples = array.array("h")
        samples.frombytes(chunk)
        if not samples:
            return 0.0
        ssum = 0
        for v in samples:
            ssum += v * v
        return math.sqrt(ssum / len(samples))

    async def analyze_audio_timerange(
        self,
        input_path: str,
        *,
        threshold_db: float = -40.0,
        window_ms: float = 100.0,
        sample_rate: int = 8000,
        padding_sec: float = 2.0,
        timeout_sec: Optional[float] = None,
    ) -> dict[str, Any]:
        """
        入力ファイルから音声を PCM s16le mono に変換し、RMS 信号強度で
        最初の発話開始位置と最後の発話終了位置を検出する。
        前後余白付きの推奨トリム開始/終了秒（`trim_start_sec` / `trim_end_sec`）も返す。
        返り値の `trim_start_sec` / `trim_end_sec` を `trim()` の引数にそのまま渡せる。

        Args:
            input_path: 解析対象ファイル（動画 or 音声）。
            threshold_db: dBFS 閾値。これを超えるウィンドウを「発話あり」と判定。既定 -40 dB。
            window_ms: 解析ウィンドウ長（ミリ秒）。既定 100 ms。
            sample_rate: 解析用サンプリングレート（Hz）。既定 8000。音声検出には十分。
            padding_sec: 検出位置の前後に付ける余白秒。既定 2.0 秒。
            timeout_sec: ffmpeg のタイムアウト秒。

        Returns:
            duration_sec / audio_start_sec / audio_end_sec /
            trim_start_sec / trim_end_sec / max_rms_db など。
        """
        input_p = Path(input_path)
        if not input_p.is_file():
            raise FfmpegControlError(f"入力ファイルが見つかりません: {input_path}")
        if sample_rate <= 0:
            raise FfmpegControlError("sample_rate は正の整数で指定してください")
        if window_ms <= 0:
            raise FfmpegControlError("window_ms は正の数値で指定してください")
        if padding_sec < 0:
            raise FfmpegControlError("padding_sec は 0 以上で指定してください")

        effective_timeout = (
            float(timeout_sec) if timeout_sec is not None else self.default_timeout_sec
        )

        pcm_bytes, _stderr = await self._extract_pcm(
            str(input_p), sample_rate, effective_timeout
        )

        sample_width = 2  # s16le
        total_samples = len(pcm_bytes) // sample_width
        duration_sec = total_samples / float(sample_rate) if total_samples else 0.0

        window_samples = max(1, int(round(sample_rate * window_ms / 1000.0)))
        window_bytes = window_samples * sample_width
        num_windows = total_samples // window_samples

        if num_windows == 0:
            return {
                "input_path": str(input_p),
                "duration_sec": round(duration_sec, 3),
                "audio_start_sec": None,
                "audio_end_sec": None,
                "trim_start_sec": 0.0,
                "trim_end_sec": round(duration_sec, 3),
                "padding_sec": padding_sec,
                "threshold_db": threshold_db,
                "window_ms": window_ms,
                "sample_rate": sample_rate,
                "samples_analyzed": total_samples,
                "windows": 0,
                "max_rms_db": None,
                "audioop_available": _HAS_AUDIOOP,
            }

        # int16 の dB 基準は 32767（フルスケール）。
        # rms_linear → dB = 20 * log10(rms / 32767)
        full_scale = 32767.0
        threshold_linear = (10 ** (threshold_db / 20.0)) * full_scale

        first_idx: Optional[int] = None
        last_idx: Optional[int] = None
        max_rms = 0.0
        for w in range(num_windows):
            start_b = w * window_bytes
            end_b = start_b + window_bytes
            rms = self._window_rms(pcm_bytes, start_b, end_b, sample_width)
            if rms > max_rms:
                max_rms = rms
            if rms >= threshold_linear:
                if first_idx is None:
                    first_idx = w
                last_idx = w

        if max_rms > 0.0:
            max_rms_db: Optional[float] = round(
                20.0 * math.log10(max_rms / full_scale), 2
            )
        else:
            max_rms_db = None

        if first_idx is None or last_idx is None:
            return {
                "input_path": str(input_p),
                "duration_sec": round(duration_sec, 3),
                "audio_start_sec": None,
                "audio_end_sec": None,
                "trim_start_sec": 0.0,
                "trim_end_sec": round(duration_sec, 3),
                "padding_sec": padding_sec,
                "threshold_db": threshold_db,
                "window_ms": window_ms,
                "sample_rate": sample_rate,
                "samples_analyzed": total_samples,
                "windows": num_windows,
                "max_rms_db": max_rms_db,
                "audioop_available": _HAS_AUDIOOP,
            }

        window_sec = window_ms / 1000.0
        audio_start_sec = first_idx * window_sec
        audio_end_sec = (last_idx + 1) * window_sec  # ウィンドウ終端を採用
        trim_start = max(0.0, audio_start_sec - padding_sec)
        trim_end = min(duration_sec, audio_end_sec + padding_sec)

        return {
            "input_path": str(input_p),
            "duration_sec": round(duration_sec, 3),
            "audio_start_sec": round(audio_start_sec, 3),
            "audio_end_sec": round(audio_end_sec, 3),
            "trim_start_sec": round(trim_start, 3),
            "trim_end_sec": round(trim_end, 3),
            "padding_sec": padding_sec,
            "threshold_db": threshold_db,
            "window_ms": window_ms,
            "sample_rate": sample_rate,
            "samples_analyzed": total_samples,
            "windows": num_windows,
            "max_rms_db": max_rms_db,
            "audioop_available": _HAS_AUDIOOP,
        }

    # ------------------------------------------------------------------ #
    # 動画トリミング（start_sec, end_sec 指定で再エンコード切り出し）
    # ------------------------------------------------------------------ #

    async def video_trimming(
        self,
        input_path: str,
        start_sec: float,
        end_sec: float,
        output_path: str,
        *,
        timeout_sec: Optional[float] = None,
    ) -> dict[str, Any]:
        """
        input_path の [start_sec, end_sec] 区間を output_path に再エンコードで切り出す。
        H.264 (libx264 CRF 20) + AAC 192kbps + +faststart の Web 配信向け既定値を使う。
        `analyze_audio_timerange` の戻り値 `trim_start_sec` / `trim_end_sec` をそのまま渡せる。

        Args:
            input_path: 入力ファイルの絶対パス。
            start_sec: 切り出し開始秒（0 以上）。
            end_sec: 切り出し終了秒（start_sec より大）。
            output_path: 出力ファイルの絶対パス。親ディレクトリは自動作成。
            timeout_sec: ffmpeg のタイムアウト秒。

        Returns:
            input_path / output_path / start_sec / end_sec / duration_sec /
            returncode / command / output_size_bytes。
        """
        input_p = Path(input_path)
        if not input_p.is_file():
            raise FfmpegControlError(f"入力ファイルが見つかりません: {input_path}")
        if start_sec < 0:
            raise FfmpegControlError(f"start_sec は 0 以上で指定してください: {start_sec}")
        if end_sec <= start_sec:
            raise FfmpegControlError(
                f"end_sec は start_sec より大きい値で指定してください: "
                f"start_sec={start_sec}, end_sec={end_sec}"
            )

        output_p = Path(output_path)
        output_p.parent.mkdir(parents=True, exist_ok=True)
        duration = float(end_sec) - float(start_sec)

        ffmpeg_exe = self._resolve_executable(self.ffmpeg_path, "ffmpeg")
        argv = [
            ffmpeg_exe,
            "-y",
            "-ss", f"{float(start_sec):.3f}",
            "-i", str(input_p),
            "-t", f"{duration:.3f}",
            "-c:v", "libx264",
            "-crf", "20",
            "-preset", "medium",
            "-c:a", "aac",
            "-b:a", "192k",
            "-movflags", "+faststart",
            str(output_p),
        ]
        effective_timeout = (
            float(timeout_sec) if timeout_sec is not None else self.default_timeout_sec
        )

        try:
            proc = await asyncio.create_subprocess_exec(
                *argv,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
        except OSError as e:
            raise FfmpegControlError(f"ffmpeg の起動に失敗しました: {e}") from e

        try:
            _stdout_b, stderr_b = await asyncio.wait_for(
                proc.communicate(), timeout=effective_timeout
            )
        except asyncio.TimeoutError:
            try:
                proc.kill()
            except ProcessLookupError:
                pass
            raise FfmpegControlError(
                f"ffmpeg (video_trimming) がタイムアウトしました（{effective_timeout:g} 秒）"
            )

        stderr_text = self._decode_bytes(stderr_b or b"", self.DEFAULT_OUTPUT_BYTES)
        if proc.returncode != 0:
            raise FfmpegControlError(
                f"ffmpeg video_trimming 失敗 (rc={proc.returncode}): {stderr_text[-500:]}"
            )

        output_size = output_p.stat().st_size if output_p.is_file() else 0

        return {
            "input_path": str(input_p),
            "output_path": str(output_p),
            "start_sec": round(float(start_sec), 3),
            "end_sec": round(float(end_sec), 3),
            "duration_sec": round(duration, 3),
            "returncode": proc.returncode,
            "command": argv,
            "output_size_bytes": output_size,
            "timeout_sec": effective_timeout,
        }

    # ------------------------------------------------------------------ #
    # メディア再生時間取得（ffprobe）
    # ------------------------------------------------------------------ #

    async def get_media_duration(
        self,
        input_path: str,
        *,
        timeout_sec: Optional[float] = None,
    ) -> dict[str, Any]:
        """
        ffprobe でメディアファイルの再生時間を取得する。

        Args:
            input_path: 対象ファイルの絶対パス（MP3 / MP4 / WAV など）。
            timeout_sec: ffprobe のタイムアウト秒。

        Returns:
            {"input_path": str, "duration_sec": float, "size_bytes": int}
        """
        input_p = Path(input_path)
        if not input_p.is_file():
            raise FfmpegControlError(f"入力ファイルが見つかりません: {input_path}")

        args_str = (
            f"-v error -show_entries format=duration "
            f"-of default=noprint_wrappers=1:nokey=1 {input_p}"
        )
        result = await self.run_ffprobe(args_str, timeout_sec)

        if result["returncode"] != 0:
            raise FfmpegControlError(
                f"ffprobe 失敗 (rc={result['returncode']}): {result['stderr'][:300]}"
            )

        raw = result["stdout"].strip()
        try:
            duration_sec = float(raw)
        except ValueError:
            raise FfmpegControlError(
                f"ffprobe の出力を数値に変換できませんでした: {repr(raw)}"
            )

        return {
            "input_path": str(input_p),
            "duration_sec": round(duration_sec, 3),
            "size_bytes": input_p.stat().st_size,
        }

    def _probe_versions(self) -> dict[str, Any]:
        """各実行ファイルに -version を投げて使用可能か確認し、結果をログに残す。"""
        results: dict[str, Any] = {}
        for label, exe_attr in (
            ("ffmpeg", "ffmpeg_path"),
            ("ffprobe", "ffprobe_path"),
            ("ffplay", "ffplay_path"),
        ):
            exe_path = getattr(self, exe_attr)
            try:
                resolved = self._resolve_executable(exe_path, label)
            except FfmpegControlError as e:
                results[label] = {"ok": False, "configured": exe_path, "error": str(e)}
                logger.warning(f"{label} を解決できません: {e}")
                continue

            try:
                proc = subprocess.run(
                    [resolved, "-version"],
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    timeout=10,
                    check=False,
                )
            except subprocess.TimeoutExpired:
                results[label] = {
                    "ok": False,
                    "configured": exe_path,
                    "resolved": resolved,
                    "error": "-version 実行がタイムアウトしました",
                }
                logger.warning(f"{label} -version タイムアウト: {resolved}")
                continue
            except OSError as e:
                results[label] = {
                    "ok": False,
                    "configured": exe_path,
                    "resolved": resolved,
                    "error": str(e),
                }
                logger.warning(f"{label} -version 起動失敗: {e}")
                continue

            stdout_text = (proc.stdout or b"").decode("utf-8", errors="replace")
            first_line = stdout_text.splitlines()[0] if stdout_text else ""
            ok = proc.returncode == 0 and bool(first_line)
            entry: dict[str, Any] = {
                "ok": ok,
                "configured": exe_path,
                "resolved": resolved,
                "returncode": proc.returncode,
                "version": first_line,
            }
            results[label] = entry
            if ok:
                logger.info(f"{label} OK: {first_line}")
            else:
                logger.warning(
                    f"{label} -version 失敗 (rc={proc.returncode}): {resolved}"
                )
        return results

    def get_versions(self) -> dict[str, Any]:
        """設定値と起動時の -version 確認結果を返す。"""
        from tools_proc.tool_availability import availability_status

        return {
            **availability_status("FFmpeg", self.version_info),
            "ffmpeg_path": self.ffmpeg_path,
            "ffprobe_path": self.ffprobe_path,
            "ffplay_path": self.ffplay_path,
            "default_timeout_sec": self.default_timeout_sec,
            "default_play_timeout_sec": self.default_play_timeout_sec,
            "checks": self.version_info,
        }
