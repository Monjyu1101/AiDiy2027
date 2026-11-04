# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""aidiy_ffmpeg_control MCP ツール登録 + HTTP ルート"""

import json
from typing import Optional

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from log_config import get_logger
from tools_proc.ffmpeg_control import FfmpegControlError
from tools_proc.tool_availability import availability_status

logger = get_logger(__name__)


class FfmpegRequest(BaseModel):
    args_str: Optional[str] = None
    timeout_sec: Optional[int] = None
    input_path: Optional[str] = None
    threshold_db: float = -40.0
    window_ms: float = 100.0
    sample_rate: int = 8000
    padding_sec: float = 2.0
    start_sec: Optional[float] = None
    end_sec: Optional[float] = None
    output_path: Optional[str] = None


def register_tools(mcp_ff, ffmpeg_c):
    """aidiy_ffmpeg_control MCP ツールを mcp_ff インスタンスに登録する。
    version_info に基づいて条件付きツールを登録し、ログに公開ツール一覧を出力する。"""
    mcp_ff._lowlevel_server.instructions = availability_status("FFmpeg", ffmpeg_c.version_info)["message"]

    @mcp_ff.tool()
    async def ffmpeg_versions() -> str:
        """
        ffmpeg / ffprobe / ffplay の実行ファイルパスと起動時 -version 確認結果を返す。
        PATH 解決やバイナリ未配置の切り分けに使う。常時公開される診断ツール。
        """
        return json.dumps(ffmpeg_c.get_versions(), ensure_ascii=False)

    if ffmpeg_c.version_info.get("ffmpeg", {}).get("ok"):
        @mcp_ff.tool()
        async def ffmpeg_run(args_str: str, timeout_sec: Optional[int] = None) -> str:
            """
            ffmpeg を実行する。args_str に ffmpeg の引数を文字列で渡す。

            Args:
                args_str: 例: '-y -i in.mp4 -c:v libx264 -c:a aac out.mp4'
                          '-i image.png -i narration.mp3 -t 10 -shortest out.mp4'
                          字幕焼き込み: '-i in.mp4 -vf subtitles=subs.srt out.mp4'
                          オーバーレイ: '-i base.mp4 -i logo.png -filter_complex overlay=10:10 out.mp4'
                          リサイズ: '-i in.mp4 -vf scale=1280:720 out.mp4'
                timeout_sec: タイムアウト秒。省略時は設定ファイルの default_timeout_sec を使う。

            Returns:
                {"command": [...], "returncode": int, "stdout": "...", "stderr": "...", "timeout_sec": ...}
            """
            try:
                result = await ffmpeg_c.run_ffmpeg(args_str, timeout_sec)
            except FfmpegControlError as e:
                raise ValueError(str(e)) from e
            return json.dumps(result, ensure_ascii=False)

    if ffmpeg_c.version_info.get("ffprobe", {}).get("ok"):
        @mcp_ff.tool()
        async def ffprobe_run(args_str: str, timeout_sec: Optional[int] = None) -> str:
            """
            ffprobe を実行する。args_str に ffprobe の引数を文字列で渡す。

            Args:
                args_str: 例: '-v error -print_format json -show_format -show_streams in.mp4'
                          '-i in.mp4'  （標準的な情報表示）
                timeout_sec: タイムアウト秒。省略時は設定ファイルの default_timeout_sec を使う。
            """
            try:
                result = await ffmpeg_c.run_ffprobe(args_str, timeout_sec)
            except FfmpegControlError as e:
                raise ValueError(str(e)) from e
            return json.dumps(result, ensure_ascii=False)

        @mcp_ff.tool()
        async def get_media_duration(
            input_path: str,
            timeout_sec: Optional[int] = None,
        ) -> str:
            """
            メディアファイル（MP3 / MP4 / WAV など）の再生時間を ffprobe で取得する。
            ナレーション音声の実尺確認や scenario.js の duration_sec 更新に使う。

            Args:
                input_path: 対象ファイルの絶対パス。
                timeout_sec: ffprobe のタイムアウト秒。省略時は設定ファイルの値を使う。

            Returns:
                {"input_path": str, "duration_sec": float, "size_bytes": int}
            """
            try:
                result = await ffmpeg_c.get_media_duration(input_path, timeout_sec=timeout_sec)
            except FfmpegControlError as e:
                raise ValueError(str(e)) from e
            return json.dumps(result, ensure_ascii=False)

    if ffmpeg_c.version_info.get("ffmpeg", {}).get("ok"):
        @mcp_ff.tool()
        async def ffmpeg_analyze_audio_timerange(
            input_path: str,
            threshold_db: float = -40.0,
            window_ms: float = 100.0,
            sample_rate: int = 8000,
            padding_sec: float = 2.0,
            timeout_sec: Optional[int] = None,
        ) -> str:
            """
            入力ファイル（動画/音声）を 16bit mono PCM (WAV 相当) に変換し、
            RMS 信号強度で「最初の発話開始秒（audio_start_sec）」と
            「最後の発話終了秒（audio_end_sec）」を検出する。
            前後 padding_sec の余白を付けた推奨トリム値（trim_start_sec / trim_end_sec）も返すので、
            その値を ffmpeg_trim にそのまま渡せば自動で余白付きトリムができる。

            Args:
                input_path: 解析対象ファイルの絶対パス。
                threshold_db: dBFS 閾値。これを超えるウィンドウを発話ありと判定（既定 -40 dB）。
                window_ms: RMS 計算のウィンドウ長（既定 100 ms）。
                sample_rate: 解析用サンプリングレート Hz（既定 8000）。
                padding_sec: 検出位置の前後に付ける余白秒（既定 2.0 秒）。
                timeout_sec: ffmpeg のタイムアウト秒。
            """
            try:
                result = await ffmpeg_c.analyze_audio_timerange(
                    input_path,
                    threshold_db=threshold_db,
                    window_ms=window_ms,
                    sample_rate=sample_rate,
                    padding_sec=padding_sec,
                    timeout_sec=timeout_sec,
                )
            except FfmpegControlError as e:
                raise ValueError(str(e)) from e
            return json.dumps(result, ensure_ascii=False)

        @mcp_ff.tool()
        async def video_trimming(
            input_path: str,
            start_sec: float,
            end_sec: float,
            output_path: str,
            timeout_sec: Optional[int] = None,
        ) -> str:
            """
            input_path の [start_sec, end_sec] 区間を output_path に再エンコードで切り出す。
            H.264 (libx264 CRF 20) + AAC 192kbps + +faststart の Web 配信向け既定値を使う。
            ffmpeg_analyze_audio_timerange の戻り値 trim_start_sec / trim_end_sec を
            そのまま渡せば、余白付き自動トリムが完了する。

            Args:
                input_path: 入力ファイルの絶対パス。
                start_sec: 切り出し開始秒（0 以上）。
                end_sec: 切り出し終了秒（start_sec より大）。
                output_path: 出力ファイルの絶対パス。親ディレクトリは自動作成。
                timeout_sec: ffmpeg のタイムアウト秒。
            """
            try:
                result = await ffmpeg_c.video_trimming(
                    input_path, start_sec, end_sec, output_path, timeout_sec=timeout_sec,
                )
            except FfmpegControlError as e:
                raise ValueError(str(e)) from e
            return json.dumps(result, ensure_ascii=False)

    if ffmpeg_c.version_info.get("ffplay", {}).get("ok"):
        @mcp_ff.tool()
        async def ffplay_run(args_str: str, timeout_sec: Optional[int] = None) -> str:
            """
            ffplay を実行する。args_str に ffplay の引数を文字列で渡す。

            プレイモード（プレビュー再生）。ffplay はウィンドウを開く対話アプリのため、
            呼び出し側で `-autoexit` と `-t <秒>` を付けて自然終了させること。

            Args:
                args_str: 例: '-autoexit -t 10 in.mp4'
                          '-autoexit -nodisp narration.mp3'  （音声のみ）
                timeout_sec: タイムアウト秒。省略時は設定ファイルの default_play_timeout_sec を使う。
            """
            try:
                result = await ffmpeg_c.run_ffplay(args_str, timeout_sec)
            except FfmpegControlError as e:
                raise ValueError(str(e)) from e
            return json.dumps(result, ensure_ascii=False)

    # 公開ツール一覧をログに残す
    _ff_exposed = sorted(mcp_ff._tool_manager._tools.keys())
    _ff_skipped = [
        label for label in ("ffmpeg", "ffprobe", "ffplay")
        if not ffmpeg_c.version_info.get(label, {}).get("ok")
    ]
    logger.info(f"aidiy_ffmpeg_control 公開ツール: {_ff_exposed}")
    if _ff_skipped:
        logger.warning(
            f"aidiy_ffmpeg_control 非公開（-version 失敗）: {_ff_skipped} — "
            f"_config/mcp_ffmpeg_control.json のパスを確認してください"
        )


# ================================================================== #
# HTTP ルート
# ================================================================== #

def create_router(ffmpeg_c) -> APIRouter:
    """aidiy_ffmpeg_control HTTP APIRouter を作成して返す"""
    router = APIRouter(tags=["aidiy_ffmpeg_control"])

    @router.get("/aidiy_ffmpeg_control/docs", summary="aidiy_ffmpeg_control ドキュメント")
    async def http_ffmpeg_docs() -> dict:
        has_ffmpeg = ffmpeg_c.version_info.get("ffmpeg", {}).get("ok", False)
        has_ffprobe = ffmpeg_c.version_info.get("ffprobe", {}).get("ok", False)
        has_ffplay = ffmpeg_c.version_info.get("ffplay", {}).get("ok", False)
        return {
            **availability_status("FFmpeg", ffmpeg_c.version_info),
            "service": "aidiy_ffmpeg_control",
            "description": "ffmpeg / ffprobe / ffplay を実行する。動画・音声の変換・解析・トリミング・プレビュー再生に対応。バイナリが未検出のメソッドは error を返す。",
            "endpoint": "POST /aidiy_ffmpeg_control/{method_name}",
            "content_type": "application/json",
            "availability": {"ffmpeg": has_ffmpeg, "ffprobe": has_ffprobe, "ffplay": has_ffplay},
            "note": "availability が False のメソッドは呼び出し時に error を返す。事前に versions で確認すること。",
            "methods": {
                "versions": {
                    "summary": "ffmpeg / ffprobe / ffplay バージョン確認",
                    "description": "ffmpeg / ffprobe / ffplay の実行ファイルパスと起動時 -version 確認結果を返す。バイナリの PATH 解決や未配置の切り分けに使う。常時利用可能な診断ツール。",
                    "available": True,
                    "parameters": {},
                    "example_request": {},
                    "response_fields": {
                        "ffmpeg": {"ok": "True=利用可能", "path": "実行ファイルパス", "version": "バージョン文字列"},
                        "ffprobe": {"ok": "True=利用可能", "path": "実行ファイルパス", "version": "バージョン文字列"},
                        "ffplay": {"ok": "True=利用可能", "path": "実行ファイルパス", "version": "バージョン文字列"},
                    },
                },
                "ffmpeg_run": {
                    "summary": "ffmpeg 任意コマンド実行",
                    "description": "ffmpeg を実行する。args_str に ffmpeg の引数を文字列で渡す。動画変換・画像合成・音声合成・字幕焼き込み・リサイズなど汎用的な操作に使う。スペースを含むパスは 8.3 短縮名（例: C:/Progra~1/）で渡すこと。",
                    "available": has_ffmpeg,
                    "parameters": {
                        "args_str": {"type": "string", "required": True, "description": "ffmpeg の引数文字列（-y 等のオプションも含む）。例: '-y -i in.mp4 -c:v libx264 out.mp4' / '-i image.png -i narration.mp3 -t 10 -shortest out.mp4' / '-i in.mp4 -vf scale=1280:720 out.mp4'"},
                        "timeout_sec": {"type": "integer", "required": False, "description": "タイムアウト秒。省略時は設定ファイルの default_timeout_sec を使う"},
                    },
                    "example_request": {"args_str": "-y -i input.mp4 -vf scale=1280:720 -c:v libx264 -c:a aac output.mp4"},
                    "response_fields": {"command": "実行コマンドの配列", "returncode": "終了コード（0=成功）", "stdout": "標準出力", "stderr": "標準エラー出力", "timeout_sec": "適用されたタイムアウト秒"},
                },
                "ffprobe_run": {
                    "summary": "ffprobe 任意コマンド実行",
                    "description": "ffprobe を実行する。args_str に ffprobe の引数を文字列で渡す。メディアファイルのコーデック・ビットレート・フレームレート・ストリーム情報などを取得するのに使う。",
                    "available": has_ffprobe,
                    "parameters": {
                        "args_str": {"type": "string", "required": True, "description": "ffprobe の引数文字列。例: '-v error -print_format json -show_format -show_streams in.mp4' / '-i in.mp4'"},
                        "timeout_sec": {"type": "integer", "required": False, "description": "タイムアウト秒。省略時は設定ファイルの値を使う"},
                    },
                    "example_request": {"args_str": "-v error -print_format json -show_format -show_streams input.mp4"},
                    "response_fields": {"command": "実行コマンドの配列", "returncode": "終了コード", "stdout": "標準出力（JSON 文字列）", "stderr": "標準エラー出力"},
                },
                "media_duration": {
                    "summary": "メディアファイル再生時間取得",
                    "description": "メディアファイル（MP3 / MP4 / WAV など）の再生時間を ffprobe で取得する。ナレーション音声の実尺確認や scenario.js の duration_sec 更新に使う。ffprobe が必要。",
                    "available": has_ffprobe,
                    "parameters": {
                        "input_path": {"type": "string", "required": True, "description": "対象ファイルの絶対パス。例: 'C:/AiDiy/output/narration.mp3'"},
                        "timeout_sec": {"type": "integer", "required": False, "description": "ffprobe のタイムアウト秒。省略時は設定ファイルの値を使う"},
                    },
                    "example_request": {"input_path": "C:/AiDiy/output/narration.mp3"},
                    "response_fields": {"input_path": "入力ファイルパス", "duration_sec": "再生時間（秒・小数あり）", "size_bytes": "ファイルサイズ（バイト）"},
                },
                "analyze_audio": {
                    "summary": "音声発話区間検出（自動トリム用）",
                    "description": "入力ファイル（動画/音声）を 16bit mono PCM に変換し、RMS 信号強度で「最初の発話開始秒」と「最後の発話終了秒」を検出する。前後 padding_sec の余白を付けた推奨トリム値（trim_start_sec / trim_end_sec）も返すので、video_trimming にそのまま渡せば余白付き自動トリムが完了する。ffmpeg が必要。",
                    "available": has_ffmpeg,
                    "parameters": {
                        "input_path": {"type": "string", "required": True, "description": "解析対象ファイルの絶対パス"},
                        "threshold_db": {"type": "number", "required": False, "default": -40.0, "description": "dBFS 閾値。これを超えるウィンドウを発話ありと判定"},
                        "window_ms": {"type": "number", "required": False, "default": 100.0, "description": "RMS 計算のウィンドウ長（ミリ秒）"},
                        "sample_rate": {"type": "integer", "required": False, "default": 8000, "description": "解析用サンプリングレート（Hz）"},
                        "padding_sec": {"type": "number", "required": False, "default": 2.0, "description": "検出位置の前後に付ける余白秒"},
                        "timeout_sec": {"type": "integer", "required": False, "description": "ffmpeg のタイムアウト秒"},
                    },
                    "example_request": {"input_path": "C:/AiDiy/output/recording.mp4", "threshold_db": -40.0, "padding_sec": 2.0},
                    "response_fields": {
                        "audio_start_sec": "最初の発話開始秒",
                        "audio_end_sec": "最後の発話終了秒",
                        "trim_start_sec": "推奨トリム開始秒（余白付き）",
                        "trim_end_sec": "推奨トリム終了秒（余白付き）",
                        "duration_sec": "入力ファイルの総再生時間",
                    },
                },
                "video_trimming": {
                    "summary": "動画トリミング（区間切り出し）",
                    "description": "input_path の [start_sec, end_sec] 区間を output_path に再エンコードで切り出す。H.264 (libx264 CRF 20) + AAC 192kbps + +faststart の Web 配信向け設定を使う。analyze_audio の戻り値 trim_start_sec / trim_end_sec をそのまま渡せば余白付き自動トリムが完了する。ffmpeg が必要。",
                    "available": has_ffmpeg,
                    "parameters": {
                        "input_path": {"type": "string", "required": True, "description": "入力ファイルの絶対パス"},
                        "start_sec": {"type": "number", "required": True, "description": "切り出し開始秒（0 以上）"},
                        "end_sec": {"type": "number", "required": True, "description": "切り出し終了秒（start_sec より大きい値）"},
                        "output_path": {"type": "string", "required": True, "description": "出力ファイルの絶対パス。親ディレクトリは自動作成"},
                        "timeout_sec": {"type": "integer", "required": False, "description": "ffmpeg のタイムアウト秒"},
                    },
                    "example_request": {"input_path": "C:/AiDiy/output/recording.mp4", "start_sec": 2.5, "end_sec": 58.3, "output_path": "C:/AiDiy/output/trimmed.mp4"},
                    "response_fields": {"ok": "True=成功", "output_path": "出力ファイルパス", "start_sec": "切り出し開始秒", "end_sec": "切り出し終了秒", "command": "実行コマンドの配列", "returncode": "終了コード"},
                },
                "ffplay_run": {
                    "summary": "ffplay によるプレビュー再生",
                    "description": "ffplay を実行する。args_str に ffplay の引数を文字列で渡す。ffplay はウィンドウを開く対話アプリのため、-autoexit と -t <秒> を付けて自然終了させること。ffplay が必要。",
                    "available": has_ffplay,
                    "parameters": {
                        "args_str": {"type": "string", "required": True, "description": "ffplay の引数文字列。例: '-autoexit -t 10 in.mp4' / '-autoexit -nodisp narration.mp3'（音声のみ）"},
                        "timeout_sec": {"type": "integer", "required": False, "description": "タイムアウト秒。省略時は設定ファイルの default_play_timeout_sec を使う"},
                    },
                    "example_request": {"args_str": "-autoexit -t 10 C:/AiDiy/output/preview.mp4"},
                    "response_fields": {"command": "実行コマンドの配列", "returncode": "終了コード（0=正常終了）", "stdout": "標準出力", "stderr": "標準エラー出力"},
                },
            },
        }

    @router.post("/aidiy_ffmpeg_control/{method_name}", summary="ffmpeg 制御")
    async def http_ffmpeg(method_name: str, req: FfmpegRequest = FfmpegRequest()) -> dict:
        """
        | method_name | 説明 |
        |---|---|
        | versions | バージョン確認 |
        | ffmpeg_run | ffmpeg 実行 |
        | ffprobe_run | ffprobe 実行 |
        | media_duration | メディア再生時間取得 |
        | analyze_audio | 音声発話区間検出 |
        | video_trimming | 動画トリミング |
        | ffplay_run | ffplay 実行 |
        """
        required = {
            "ffmpeg_run": "ffmpeg", "ffprobe_run": "ffprobe", "media_duration": "ffprobe",
            "analyze_audio": "ffmpeg", "video_trimming": "ffmpeg", "ffplay_run": "ffplay",
        }.get(method_name)
        if required and not ffmpeg_c.version_info.get(required, {}).get("ok"):
            message = f"現在利用不可：{required} の起動チェックに失敗しています。設定を確認して再起動してください。"
            return JSONResponse(status_code=503, content={
                "status": "NG", "available": False, "message": message, "error": message,
                "checks": {required: ffmpeg_c.version_info.get(required, {})},
            })
        try:
            if method_name == "versions":
                return ffmpeg_c.get_versions()
            elif method_name == "ffmpeg_run":
                if not req.args_str:
                    return {"error": "args_str は必須です"}
                result = await ffmpeg_c.run_ffmpeg(req.args_str, req.timeout_sec)
                return result if isinstance(result, dict) else {"result": result}
            elif method_name == "ffprobe_run":
                if not req.args_str:
                    return {"error": "args_str は必須です"}
                result = await ffmpeg_c.run_ffprobe(req.args_str, req.timeout_sec)
                return result if isinstance(result, dict) else {"result": result}
            elif method_name == "media_duration":
                if not req.input_path:
                    return {"error": "input_path は必須です"}
                result = await ffmpeg_c.get_media_duration(req.input_path, timeout_sec=req.timeout_sec)
                return result if isinstance(result, dict) else {"result": result}
            elif method_name == "analyze_audio":
                if not req.input_path:
                    return {"error": "input_path は必須です"}
                result = await ffmpeg_c.analyze_audio_timerange(
                    req.input_path,
                    threshold_db=req.threshold_db,
                    window_ms=req.window_ms,
                    sample_rate=req.sample_rate,
                    padding_sec=req.padding_sec,
                    timeout_sec=req.timeout_sec,
                )
                return result if isinstance(result, dict) else {"result": result}
            elif method_name == "video_trimming":
                if not req.input_path or req.start_sec is None or req.end_sec is None or not req.output_path:
                    return {"error": "input_path / start_sec / end_sec / output_path は必須です"}
                result = await ffmpeg_c.video_trimming(req.input_path, req.start_sec, req.end_sec, req.output_path, timeout_sec=req.timeout_sec)
                return result if isinstance(result, dict) else {"result": result}
            elif method_name == "ffplay_run":
                if not req.args_str:
                    return {"error": "args_str は必須です"}
                result = await ffmpeg_c.run_ffplay(req.args_str, req.timeout_sec)
                return result if isinstance(result, dict) else {"result": result}
            else:
                return {"error": f"未知のメソッド: {method_name}"}
        except FfmpegControlError as e:
            logger.warning(f"http_ffmpeg [{method_name}] error: {e}")
            return {"error": str(e)}

    return router
