# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""aidiy_image_generation / aidiy_movie_generation / aidiy_speech_to_text / aidiy_text_to_speech
MCP ツール登録 + HTTP ルート"""

import asyncio
import json
import os
from datetime import datetime
from typing import Optional, Union

from fastapi import APIRouter
from mcp.types import ImageContent, TextContent
from pydantic import BaseModel

from log_config import get_logger
from tools_proc.media_output import base64を返すか, ファイル応答
from tools_proc.image_generation import ImageGenerationError
from tools_proc.movie_generation import MovieGenerationError
from tools_proc.speech_to_text import SpeechToTextError
from tools_proc.text_to_speech import TextToSpeechError

logger = get_logger(__name__)


def _image_base64_and_paths(ig, img, info: dict, save_path: Optional[str]) -> tuple[str, str, Optional[str]]:
    """画像返却用 base64 と保存パスを作る。

    CLI 系は generated_path の PNG を正とし、ユーザー指定 save_path があればそこへコピーする。

    save_path を明示された場合は base64 を作らない（空文字を返す）。呼び出し側は
    保存先を知っていてファイルを読めるので、同じ画像を base64 でも返すと文脈が二重に膨らむ。
    """
    返す = base64を返すか(save_path)
    generated_path = info.get("generated_path")
    if generated_path and os.path.isfile(generated_path):
        copied_path = ig.copy_generated_file(generated_path, save_path) if save_path else None
        data = ig.file_to_base64(generated_path) if 返す else ""
        return data, copied_path or generated_path, generated_path

    output_path = save_path or ig._resolve_default_output_dir()
    data, dest = ig.to_base64(img, "png", 85, output_path, 返す)
    return data, dest or output_path, None


# ------------------------------------------------------------------ #
# HTTP リクエストモデル
# ------------------------------------------------------------------ #

class ImgGenRequest(BaseModel):
    prompt: str
    provider: str = "auto"
    model: str = "auto"
    size: str = "auto"
    quality: str = "auto"
    original_path: Optional[str] = None
    save_path: Optional[str] = None


class MovieGenRequest(BaseModel):
    prompt: str
    provider: str = "auto"
    model: str = "auto"
    duration_seconds: int = 8
    aspect_ratio: str = "auto"
    resolution: str = "auto"
    negative_prompt: Optional[str] = None
    enhance_prompt: bool = False
    reference_image_path: Optional[str] = None
    save_path: Optional[str] = None


class SttRequest(BaseModel):
    base64_wav16k: Optional[str] = None
    file_path: Optional[str] = None
    provider: str = "auto"
    model: str = "auto"


class TtsRequest(BaseModel):
    speech_text: str
    language: str = "ja"
    provider: str = "edge"
    model: str = "auto"
    voice: str = "female"
    ratio: Optional[Union[float, str]] = None
    save_path: Optional[str] = None
    local_play: bool = False
    play: bool = False


_IMAGE_GEN_METHODS = [
    {
        "name": "generate",
        "description": "AI 画像を生成する。レスポンスの data フィールドに PNG の base64 文字列が入る",
        "parameters": {
            "prompt": {"type": "string", "required": True, "description": "生成プロンプト"},
            "provider": {"type": "string", "required": False, "default": "auto", "description": "auto / codex / antigravity / openai / freeai / gemini"},
            "model": {"type": "string", "required": False, "default": "auto", "description": "auto / codex / antigravity 指定時は無視"},
            "size": {"type": "string", "required": False, "default": "auto", "description": "例: 1024x1024"},
            "quality": {"type": "string", "required": False, "default": "auto", "description": "standard / hd / auto"},
            "original_path": {"type": "string", "required": False, "description": "編集元画像パス"},
            "save_path": {"type": "string", "required": False, "description": "保存先パス（省略時は temp/output/ に自動保存）"},
        },
    },
]

_MOVIE_GEN_METHODS = [
    {
        "name": "generate",
        "description": "AI 動画を生成して MP4 として保存する（base64 返却なし）",
        "parameters": {
            "prompt": {"type": "string", "required": True, "description": "生成プロンプト"},
            "provider": {"type": "string", "required": False, "default": "auto", "description": "gemini / auto"},
            "model": {"type": "string", "required": False, "default": "auto"},
            "duration_seconds": {"type": "integer", "required": False, "default": 8, "description": "動画長さ（秒）"},
            "aspect_ratio": {"type": "string", "required": False, "default": "auto", "description": "16:9 / 9:16 / 1:1 / auto"},
            "resolution": {"type": "string", "required": False, "default": "auto"},
            "negative_prompt": {"type": "string", "required": False},
            "enhance_prompt": {"type": "boolean", "required": False, "default": False},
            "reference_image_path": {"type": "string", "required": False, "description": "参照画像パス"},
            "save_path": {"type": "string", "required": False, "description": "保存先パス（省略時は temp/output/ に自動保存）"},
        },
    },
]

_TTS_METHODS = [
    {
        "name": "synthesize",
        "description": "テキストを音声合成する。レスポンスの base64_audio フィールドに MP3 の base64 文字列が入る",
        "parameters": {
            "speech_text": {"type": "string", "required": True, "description": "読み上げテキスト。JSONの空文字列を指定すると1秒の無音音声を生成"},
            "language": {"type": "string", "required": False, "default": "ja", "description": "言語コード（Edge の female/male 自動解決: en / fr / de / es / pt / it / ru / nl / zh / ko / ar / ja）"},
            "provider": {"type": "string", "required": False, "default": "edge", "description": "auto（AiDiy_tools.json） / edge / openai / gemini / freeai"},
            "model": {"type": "string", "required": False, "default": "auto"},
            "voice": {"type": "string", "required": False, "default": "female", "description": "auto（AiDiy_tools.json） / female / male またはプロバイダ固有の音声名"},
            "ratio": {"type": "number|string", "required": False, "description": "読み上げ速度倍率。0 / auto は provider ごとの既定値"},
            "save_path": {"type": "string", "required": False, "description": "保存先パス（省略時は temp/output/ に自動保存）"},
            "local_play": {"type": "boolean", "required": False, "default": False, "description": "サーバー側でローカル再生する"},
            "play": {"type": "boolean", "required": False, "default": False, "description": "local_play の別名"},
        },
    },
]


# ================================================================== #
# aidiy_image_generation MCP ツール
# ================================================================== #

def register_image_gen_tools(mcp_ig, ig):
    """aidiy_image_generation MCP ツールを mcp_ig インスタンスに登録する"""

    @mcp_ig.tool()
    async def generate_image(
        prompt: str,
        provider: str = "auto",
        model: str = "auto",
        size: str = "auto",
        quality: str = "auto",
        original_path: Optional[str] = None,
        save_path: Optional[str] = None,
    ) -> list:
        """
        AI で画像を生成する。

        Args:
            prompt: 生成プロンプト（例: "かわいい猫の画像"）
            provider: "auto"=AiDiy_tools.json（初期値codex→antigravity→openai→freeai→gemini） /
                      "gemini"（gemini_key_id が必要） /
                      "freeai"（freeai_key_id が必要） / "openai" / "codex" / "antigravity" /
                      "grok"=grok→codex→antigravity→openai→freeai→gemini
            model:
              OpenAI: "auto"=gpt-image-2.5-sunburst / "gpt-image-2.5-sunburst"（高精度） / "gpt-image-2.5-flare"（高速） / "gpt-image-2" / "gpt-image-1" / "dall-e-3"
              Gemini/FreeAI: "auto"=gemini-nano-banana-2.1 /
                             "gemini-nano-banana-2.1" / "gemini-3.1-flash-lite-image" /
                             "gemini-3-pro-image" / "gemini-3.1-flash-image-preview" /
                             "gemini-3-pro-image-preview" / "gemini-2.5-flash-image"
              Auto/Codex/Antigravity/Grok: 指定値は無視
            size:
              OpenAI: "auto"=1024x1024 / "1024x1024" / "1536x1024" / "1024x1536" / ...
              Gemini/FreeAI: "auto"=1024x1024 / "512x512" / "1024x1024" / "1920x1080" / "1080x1920"
            quality: OpenAI only — "auto"（モデル既定値） /
                     gpt-image-2.5-* / gpt-image-2: "low" / "medium" / "high" /
                     dall-e-3: "standard" / "hd"
            original_path: 参照画像のパス（省略可）
            save_path: 保存先。フォルダ指定なら yyyymmdd.hhmmss.png で保存。
                       ファイル指定なら指定ファイルに保存。省略時は backend_server/temp/output/ に保存。
                       Auto/Codex/Antigravity/Grok は backend_server/temp/output/yyyymmdd.hhmmss.png を必ず残し、
                       指定がある場合はその PNG を save_path にもコピーする。
        """
        try:
            img, info = await asyncio.to_thread(
                ig.generate, prompt, provider, original_path,
                model=model, size=size, quality=quality,
            )
            data, output_path, generated_path = await asyncio.to_thread(
                _image_base64_and_paths, ig, img, info, save_path
            )
            mime = "image/png"

            logger.info(
                f"generate_image: provider={info['provider']}  "
                f"model={info.get('model', '?')}  "
                f"size={img.size}  prompt={info['prompt'][:60]}  "
                f"save_path={output_path}  generated_path={generated_path or '-'}"
            )

            if not data:
                # save_path 指定時は base64 を返さない（保存先を読めば済むため）
                return [TextContent(
                    type="text",
                    text=json.dumps(ファイル応答(output_path, mime), ensure_ascii=False),
                )]
            return [ImageContent(type="image", data=data, mimeType=mime)]

        except ImageGenerationError as e:
            raise ValueError(str(e)) from e


# ================================================================== #
# aidiy_movie_generation MCP ツール
# ================================================================== #

def register_movie_gen_tools(mcp_mg, mg):
    """aidiy_movie_generation MCP ツールを mcp_mg インスタンスに登録する"""

    @mcp_mg.tool()
    async def generate_movie(
        prompt: str,
        provider: str = "auto",
        model: str = "auto",
        duration_seconds: int = 8,
        aspect_ratio: str = "auto",
        resolution: str = "auto",
        negative_prompt: Optional[str] = None,
        enhance_prompt: bool = False,
        reference_image_path: Optional[str] = None,
        save_path: Optional[str] = None,
    ) -> str:
        """
        AI で動画を生成する（Google Gemini Veo）。

        動画生成は数分かかる場合があります（ポーリング最大 10 分）。

        Args:
            prompt: 生成プロンプト（英語推奨。例: "A cat walking in a sunny park"）
            provider: "auto"=AiDiy_tools.json（初期値freeai） / "gemini"（gemini_key_id が必要） / "freeai"（freeai_key_id が必要）
            model:
              "auto"=AiDiy_tools.json（初期値veo-3.1-generate-preview） /
              "veo-3.1-generate-preview"（最新） /
              "veo-2.0-generate-001"（安定版） /
              "veo-2.0-generate-exp"（実験版）
            duration_seconds: 動画の長さ（4〜8秒、デフォルト 8）
            aspect_ratio: "auto"=AiDiy_tools.json（初期値16:9） / "16:9"（横） / "9:16"（縦）
            resolution: "auto"=AiDiy_tools.json（初期値モデル任せ） / "720p" / "1080p"
            negative_prompt: 含めたくない要素（省略可）
            enhance_prompt: True でプロンプトを自動改善（デフォルト False）
            reference_image_path: 参照画像のパス（image-to-video、省略可）
            save_path: 保存先。フォルダ指定なら yyyymmdd.hhmmss.mp4 で保存。
                       ファイル指定なら指定ファイルに保存。省略時は backend_server/temp/output/ に保存。
        """
        try:
            video_bytes, info = await asyncio.to_thread(
                mg.generate, prompt, provider, model, duration_seconds, aspect_ratio,
                resolution, negative_prompt, enhance_prompt, reference_image_path,
            )
            saved = await asyncio.to_thread(mg.save, video_bytes, save_path)

            logger.info(
                f"generate_movie: provider={info['provider']}  "
                f"model={info.get('model', '?')}  "
                f"duration={info['duration_seconds']}s  "
                f"bytes={info['video_bytes_length']}  "
                f"prompt={info['prompt'][:60]}  "
                f"saved={saved}"
            )

            return json.dumps({
                "type": "video",
                "mimeType": "video/mp4",
                "save_path": saved,
                "info": info,
            }, ensure_ascii=False)

        except MovieGenerationError as e:
            raise ValueError(str(e)) from e


# ================================================================== #
# aidiy_speech_to_text MCP ツール
# ================================================================== #

def register_stt_tools(mcp_st, stt):
    """aidiy_speech_to_text MCP ツールを mcp_st インスタンスに登録する"""

    @mcp_st.tool()
    async def recognize_speech(
        base64_wav16k: Optional[str] = None,
        file_path: Optional[str] = None,
        provider: str = "auto",
        model: str = "auto",
    ) -> str:
        """
        音声データ（base64 WAV またはファイルパス）をテキストに変換する。

        Args:
            base64_wav16k: 16kHz モノラル WAV の base64 文字列（file_path と排他）
            file_path: WAV ファイルのパス（base64_wav16k と排他）
            provider: "auto"（AiDiy_tools.json、初期値google） / "google" /
                      "openai"（AiDiy_key.json の openai_key_id が必要）
            model: "auto" のみ（デフォルト、openai 時は whisper-1）
        """
        try:
            result = await asyncio.to_thread(
                stt.recognize, base64_wav16k, file_path, provider, model
            )
            logger.info(
                f"recognize_speech: provider={result['provider']}  "
                f"model={result['model']}  "
                f"source={result.get('source', '?')}  "
                f"bytes={result['audio_bytes_length']}"
            )
            return json.dumps(result, ensure_ascii=False)

        except SpeechToTextError as e:
            raise ValueError(str(e)) from e


# ================================================================== #
# aidiy_text_to_speech MCP ツール
# ================================================================== #

def register_tts_tools(mcp_ts, tts):
    """aidiy_text_to_speech MCP ツールを mcp_ts インスタンスに登録する。
    description は呼び出し元で tts.get_description() を使って動的に設定すること。"""

    @mcp_ts.tool()
    async def synthesize_speech(
        speech_text: str,
        language: str = "ja",
        provider: str = "auto",
        model: str = "auto",
        voice: str = "auto",
        ratio: Optional[Union[float, str]] = None,
        save_path: Optional[str] = None,
        local_play: bool = False,
    ) -> str:
        """
        テキストを音声（MP3/WAV）に変換する。

        Args:
            speech_text: 合成するテキスト。JSONの空文字列なら1秒の無音音声を生成する
            language: 言語コード（デフォルト "ja"）。Edge の female/male 自動解決は
                      en / fr / de / es / pt / it / ru / nl / zh / ko / ar / ja に対応
            provider: "auto"=AiDiy_tools.json（初期値edge→freeai） /
                      "edge"（無料） / "gemini"（GEMINI_API_KEY） /
                      "freeai"（FREEAI_API_KEY） / "openai"（OPENAI_API_KEY）
            model: "auto"（自動選択、デフォルト）
            voice: "auto"（AiDiy_tools.json、初期値female）。"female" / "male" の指定も可。
            ratio: 話速倍率。None / 0 / "auto" は provider ごとの既定値。
                   edge/openai は 1.2、gemini/freeai は 1.1。1 は速度調整なし。
            save_path: 保存先。省略時は backend_server/temp/output/ に保存。
            local_play: True でローカル再生を試行（デフォルト False）
        """
        try:
            audio_bytes, info = await asyncio.to_thread(
                tts.synthesize, speech_text, language, provider, model, voice, ratio
            )
            auto_path = save_path
            if not auto_path:
                out_dir = os.path.join(os.path.dirname(__file__), "..", "..", "temp", "output")
                os.makedirs(out_dir, exist_ok=True)
                auto_path = os.path.join(out_dir, datetime.now().strftime("%Y%m%d.%H%M%S") + ".mp3")
            # save_path を明示されたら base64 は返さない（保存先を読めば済むため）
            返す = base64を返すか(save_path)
            base64_audio, auto_path = await asyncio.to_thread(
                tts.to_base64, audio_bytes, auto_path, 返す
            )

            if local_play and audio_bytes:
                play_ok = await asyncio.to_thread(tts.play_mp3, audio_bytes)
                info["local_play_executed"] = play_ok

            logger.info(
                f"synthesize_speech: requested={info['requested_provider']}  "
                f"used={info['used_provider']}  "
                f"language={info['language']}  "
                f"ratio={info['ratio']}  "
                f"text_length={len(speech_text)}  "
                f"audio_format={info['audio_format']}  "
                f"audio_bytes={info['audio_bytes_length']}  "
                f"save_path={auto_path}"
            )

            return json.dumps({
                **info,
                "base64_audio": base64_audio,
                "save_path": auto_path,
                "local_play": local_play,
                "play": local_play,
            }, ensure_ascii=False)

        except TextToSpeechError as e:
            raise ValueError(str(e)) from e


# ================================================================== #
# HTTP ルート（Image Gen + Movie Gen + TTS）
# ================================================================== #

def create_router(ig, mg, stt, tts) -> APIRouter:
    """Image Gen / Movie Gen / STT / TTS の HTTP APIRouter を作成して返す"""
    router = APIRouter()

    # ---- Image Generation ----------------------------------------

    @router.get("/aidiy_image_generation/docs", tags=["aidiy_image_generation"], summary="aidiy_image_generation ドキュメント")
    async def http_image_gen_docs() -> dict:
        """aidiy_image_generation の詳細 API ドキュメント（AI 向け）"""
        return {
            "service": "aidiy_image_generation",
            "description": "AI で画像を生成し PNG として保存する。レスポンスに base64 画像データを含む。",
            "endpoint": "POST /aidiy_image_generation/{method_name}",
            "content_type": "application/json",
            "methods": {
                "generate": {
                    "summary": "AI 画像生成",
                    "description": "プロンプトから画像を生成して base64 PNG で返す。auto/codex/antigravity/grok は backend_server/temp/output/yyyymmdd.hhmmss.png を必ず残し、save_path 指定時は同じ PNG を追加コピーする。",
                    "parameters": {
                        "prompt": {"type": "string", "required": True, "description": "生成プロンプト（例: 'かわいい猫の画像'）"},
                        "provider": {"type": "string", "required": False, "default": "auto", "values": ["auto", "openai", "gemini", "freeai", "codex", "antigravity", "grok"], "description": "画像生成プロバイダ。auto=AiDiy_tools.json（初期値codex→antigravity→openai→freeai→gemini）。codex=codex→antigravity→openai→freeai→gemini。openai=openai→freeai→gemini。freeai=freeai→gemini。gemini=gemini→openai。antigravity=antigravity→codex→freeai→gemini。grok=grok→codex→antigravity→openai→freeai→gemini"},
                        "model": {"type": "string", "required": False, "default": "auto", "description": "OpenAI: gpt-image-2.5-sunburst（既定・高精度） / gpt-image-2.5-flare（高速） / gpt-image-2 / dall-e-3。Gemini/FreeAI: gemini-nano-banana-2.1（既定） / gemini-3.1-flash-lite-image / gemini-3-pro-image など。auto / codex / antigravity / grok では無視"},
                        "size": {"type": "string", "required": False, "default": "auto", "description": "解像度。例: '1024x1024' / '1920x1080' / '1080x1920'"},
                        "quality": {"type": "string", "required": False, "default": "auto", "description": "OpenAI only: low / medium / high / standard / hd"},
                        "original_path": {"type": "string", "required": False, "description": "編集元画像の絶対パス（image-to-image 時）"},
                        "save_path": {"type": "string", "required": False, "description": "保存先。省略時は temp/output/ に yyyymmdd.hhmmss.png で自動保存。auto / codex / antigravity / grok では timestamp PNG からコピー"},
                    },
                    "example_request": {"prompt": "富士山と桜の夕景、写実的", "provider": "auto", "size": "1920x1080"},
                    "response_fields": {"type": "image", "data": "PNG base64 文字列", "save_path": "保存先パス", "generated_path": "CLI 系の timestamp PNG パス", "mimeType": "image/png"},
                },
            },
        }

    @router.post("/aidiy_image_generation/{method_name}", tags=["aidiy_image_generation"], summary="画像生成")
    async def http_img_gen(method_name: str, req: ImgGenRequest) -> dict:
        """
        | method_name | 説明 |
        |---|---|
        | generate | AI 画像生成（base64 返却） |
        """
        if method_name != "generate":
            return {"error": f"未知のメソッド: {method_name}"}
        prompt = req.prompt.strip()
        if not prompt:
            return {"error": "prompt is required"}
        try:
            img, info = await asyncio.to_thread(
                ig.generate, prompt, req.provider, req.original_path,
                model=req.model, size=req.size, quality=req.quality,
            )
            base64_data, auto_path, generated_path = await asyncio.to_thread(
                _image_base64_and_paths, ig, img, info, req.save_path
            )
            logger.info(
                f"http_img_gen: provider={info['provider']} model={info.get('model','?')} "
                f"size={img.size} prompt={info['prompt'][:60]} "
                f"save_path={auto_path} generated_path={generated_path or '-'}"
            )
            if not base64_data:
                # save_path 指定時は base64 を返さない（保存先を読めば済むため）
                return {
                    **ファイル応答(auto_path, "image/png"),
                    "generated_path": generated_path,
                }
            return {
                "type": "image",
                "data": base64_data,
                "save_path": auto_path,
                "generated_path": generated_path,
                "mimeType": "image/png",
            }
        except Exception as e:
            logger.warning(f"http_img_gen error: {e}")
            return {"error": str(e)}

    # ---- Movie Generation ----------------------------------------

    @router.get("/aidiy_movie_generation/docs", tags=["aidiy_movie_generation"], summary="aidiy_movie_generation ドキュメント")
    async def http_movie_gen_docs() -> dict:
        """aidiy_movie_generation の詳細 API ドキュメント（AI 向け）"""
        return {
            "service": "aidiy_movie_generation",
            "description": "AI で動画を生成し MP4 として保存する（Google Gemini Veo）。生成には数分かかることがある。",
            "endpoint": "POST /aidiy_movie_generation/{method_name}",
            "content_type": "application/json",
            "methods": {
                "generate": {
                    "summary": "AI 動画生成",
                    "description": "プロンプトから動画を生成して MP4 として保存する。ポーリング最大 10 分。base64 は返さず save_path を返す。",
                    "parameters": {
                        "prompt": {"type": "string", "required": True, "description": "生成プロンプト（英語推奨。例: 'A cat walking in a sunny park'）"},
                        "provider": {"type": "string", "required": False, "default": "auto", "values": ["auto", "gemini", "freeai"], "description": "動画生成プロバイダ。auto=AiDiy_tools.json（初期値freeai）"},
                        "model": {"type": "string", "required": False, "default": "auto", "values": ["auto", "veo-3.1-generate-preview", "veo-2.0-generate-001", "veo-2.0-generate-exp"]},
                        "duration_seconds": {"type": "integer", "required": False, "default": 8, "description": "動画の長さ（4〜8秒）"},
                        "aspect_ratio": {"type": "string", "required": False, "default": "auto", "values": ["auto", "16:9", "9:16"], "description": "アスペクト比"},
                        "resolution": {"type": "string", "required": False, "default": "auto", "values": ["auto", "720p", "1080p"]},
                        "negative_prompt": {"type": "string", "required": False, "description": "含めたくない要素"},
                        "enhance_prompt": {"type": "boolean", "required": False, "default": False, "description": "True でプロンプトを自動改善"},
                        "reference_image_path": {"type": "string", "required": False, "description": "参照画像の絶対パス（image-to-video 時）"},
                        "save_path": {"type": "string", "required": False, "description": "保存先。省略時は temp/output/ に yyyymmdd.HHMMSS.mp4 で自動保存"},
                    },
                    "example_request": {"prompt": "A serene Japanese garden with cherry blossoms falling", "duration_seconds": 8, "aspect_ratio": "16:9"},
                    "response_fields": {"type": "video", "save_path": "保存先 MP4 パス", "mimeType": "video/mp4", "info": "生成メタ情報"},
                },
            },
        }

    @router.post("/aidiy_movie_generation/{method_name}", tags=["aidiy_movie_generation"], summary="動画生成")
    async def http_movie_gen(method_name: str, req: MovieGenRequest) -> dict:
        """
        | method_name | 説明 |
        |---|---|
        | generate | AI 動画生成（MP4 保存） |
        """
        if method_name != "generate":
            return {"error": f"未知のメソッド: {method_name}"}
        prompt = req.prompt.strip()
        if not prompt:
            return {"error": "prompt is required"}
        try:
            video_bytes, info = await asyncio.to_thread(
                mg.generate, prompt, req.provider, req.model, req.duration_seconds,
                req.aspect_ratio, req.resolution, req.negative_prompt,
                req.enhance_prompt, req.reference_image_path,
            )
            saved = await asyncio.to_thread(mg.save, video_bytes, req.save_path)
            logger.info(
                f"http_movie_gen: provider={info['provider']} model={info.get('model','?')} "
                f"duration={info['duration_seconds']}s bytes={info['video_bytes_length']} "
                f"prompt={info['prompt'][:60]} saved={saved}"
            )
            return {"type": "video", "save_path": saved, "mimeType": "video/mp4", "info": info}
        except Exception as e:
            logger.warning(f"http_movie_gen error: {e}")
            return {"error": str(e)}

    # ---- Speech to Text ------------------------------------------

    @router.get("/aidiy_speech_to_text/docs", tags=["aidiy_speech_to_text"], summary="aidiy_speech_to_text ドキュメント")
    async def http_stt_docs() -> dict:
        """aidiy_speech_to_text の詳細 API ドキュメント（AI 向け）"""
        return {
            "service": "aidiy_speech_to_text",
            "description": "音声データ（base64 WAV またはファイルパス）をテキストに変換する。",
            "endpoint": "POST /aidiy_speech_to_text/{method_name}",
            "content_type": "application/json",
            "methods": {
                "recognize": {
                    "summary": "音声認識",
                    "description": "base64_wav16k または file_path を指定してテキストに変換する",
                    "parameters": {
                        "base64_wav16k": {"type": "string", "required": False, "description": "16kHz モノラル WAV の base64 文字列（file_path と排他）"},
                        "file_path": {"type": "string", "required": False, "description": "WAV ファイルのパス（base64_wav16k と排他）"},
                        "provider": {"type": "string", "required": False, "default": "auto", "values": ["auto", "google", "openai"], "description": "auto=AiDiy_tools.json / google=speech_recognition / openai=whisper-1"},
                        "model": {"type": "string", "required": False, "default": "auto"},
                    },
                    "example_request": {"file_path": "D:/path/to/audio.wav", "provider": "auto"},
                    "response_fields": {"text": "認識テキスト", "provider": "使用プロバイダ", "model": "使用モデル"},
                },
            },
        }

    @router.post("/aidiy_speech_to_text/{method_name}", tags=["aidiy_speech_to_text"], summary="音声認識（STT）")
    async def http_stt(method_name: str, req: SttRequest = SttRequest()) -> dict:
        """
        | method_name | 説明 |
        |---|---|
        | recognize | 音声認識（テキスト返却） |
        """
        if method_name != "recognize":
            return {"error": f"未知のメソッド: {method_name}"}
        if not req.base64_wav16k and not req.file_path:
            return {"error": "base64_wav16k または file_path のいずれかが必要です"}
        try:
            result = await asyncio.to_thread(stt.recognize, req.base64_wav16k, req.file_path, req.provider, req.model)
            logger.info(
                f"http_stt: provider={result.get('provider')} model={result.get('model')} "
                f"bytes={result.get('audio_bytes_length')}"
            )
            return result if isinstance(result, dict) else {"result": result}
        except Exception as e:
            logger.warning(f"http_stt error: {e}")
            return {"error": str(e)}

    # ---- Text to Speech ------------------------------------------

    @router.get("/aidiy_text_to_speech/docs", tags=["aidiy_text_to_speech"], summary="aidiy_text_to_speech ドキュメント")
    async def http_tts_docs() -> dict:
        """aidiy_text_to_speech の詳細 API ドキュメント（AI 向け）"""
        return {
            "service": "aidiy_text_to_speech",
            "description": "テキストを音声（MP3/WAV）に合成して保存する。複数プロバイダ対応。base64 音声データをレスポンスに含む。",
            "endpoint": "POST /aidiy_text_to_speech/{method_name}",
            "content_type": "application/json",
            "methods": {
                "synthesize": {
                    "summary": "テキスト音声合成",
                    "description": "speech_text を音声合成して base64_audio（MP3）で返す。同時に save_path へ自動保存。",
                    "parameters": {
                        "speech_text": {"type": "string", "required": True, "description": "読み上げるテキスト。JSONの空文字列なら1秒の無音音声を生成"},
                        "language": {"type": "string", "required": False, "default": "ja", "description": "言語コード（Edge の female/male 自動解決: en / fr / de / es / pt / it / ru / nl / zh / ko / ar / ja）"},
                        "provider": {"type": "string", "required": False, "default": "edge", "values": ["auto", "edge", "gemini", "freeai", "openai"], "description": "auto=AiDiy_tools.json。省略時edge（無料・高速）"},
                        "model": {"type": "string", "required": False, "default": "auto", "description": "モデル名。auto でプロバイダ既定値"},
                        "voice": {"type": "string", "required": False, "default": "female", "description": "auto（AiDiy_tools.json） / 'female' / 'male' またはプロバイダ固有音声名（例: ja-JP-NanamiNeural, Zephyr）"},
                        "ratio": {"type": "number|string", "required": False, "default": 0, "description": "話速倍率（0.5〜2.0）。None / 0 / 'auto' は provider ごとの既定値。edge/openai は 1.2、gemini/freeai は 1.1。1 は速度調整なし"},
                        "save_path": {"type": "string", "required": False, "description": "保存先。省略時は temp/output/ に yyyymmdd.HHMMSS.mp3 で自動保存"},
                        "local_play": {"type": "boolean", "required": False, "default": False, "description": "True でサーバー側スピーカーから即時再生"},
                        "play": {"type": "boolean", "required": False, "default": False, "description": "local_play の別名"},
                    },
                    "example_request": {"speech_text": "AiDiy のデモ動画へようこそ。", "provider": "freeai", "voice": "female", "ratio": 0},
                    "silence_example_request": {"speech_text": "", "save_path": "audio/pause.mp3"},
                    "response_fields": {
                        "used_provider": "実際に使用したプロバイダ",
                        "audio_format": "mp3 または wav",
                        "audio_bytes_length": "音声データのバイト数",
                        "is_silence": "空文字列要求による無音音声なら true",
                        "silence_duration_sec": "生成した無音の秒数。通常の読み上げでは0",
                        "pause_count": "空文字列要求なら1、通常の読み上げなら0",
                        "pause_duration_sec": "空文字列要求なら1秒、通常の読み上げなら0秒",
                        "base64_audio": "base64 エンコードされた音声データ（常に返される）",
                        "save_path": "保存先パス（省略時は temp/output/ に自動生成）",
                        "local_play": "ローカル再生を要求したか",
                        "play": "local_play の別名",
                    },
                },
            },
        }

    @router.post("/aidiy_text_to_speech/{method_name}", tags=["aidiy_text_to_speech"], summary="音声合成（TTS）")
    async def http_tts(method_name: str, req: TtsRequest) -> dict:
        """
        | method_name | 説明 |
        |---|---|
        | synthesize | テキスト音声合成（base64_audio 返却） |
        """
        if method_name != "synthesize":
            return {"error": f"未知のメソッド: {method_name}"}
        try:
            audio_bytes, info = await asyncio.to_thread(
                tts.synthesize, req.speech_text, req.language, req.provider, req.model, req.voice, req.ratio
            )
            auto_path = req.save_path
            if not auto_path:
                out_dir = os.path.join(os.path.dirname(__file__), "..", "..", "temp", "output")
                os.makedirs(out_dir, exist_ok=True)
                auto_path = os.path.join(out_dir, datetime.now().strftime("%Y%m%d.%H%M%S") + ".mp3")
            # save_path を明示されたら base64 は返さない（保存先を読めば済むため）
            返す = base64を返すか(req.save_path)
            base64_audio, auto_path = await asyncio.to_thread(
                tts.to_base64, audio_bytes, auto_path, 返す
            )
            logger.info(
                f"http_tts: provider={info.get('used_provider')} voice={info.get('voice')} "
                f"bytes={info.get('audio_bytes_length')} text_len={len(req.speech_text)} "
                f"save_path={auto_path}"
            )
            play_requested = req.local_play or req.play
            if play_requested and audio_bytes:
                play_ok = await asyncio.to_thread(tts.play_mp3, audio_bytes)
                info["local_play_executed"] = play_ok
            return {
                **info,
                "local_play": play_requested,
                "play": play_requested,
                "base64_audio": base64_audio,
                "save_path": auto_path,
            }
        except Exception as e:
            logger.warning(f"http_tts error: {e}")
            return {"error": str(e)}

    return router
