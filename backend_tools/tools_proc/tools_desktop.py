# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""aidiy_desktop_capture MCP ツール登録 + HTTP ルート"""

import asyncio
import json
from typing import Optional

from fastapi import APIRouter
from mcp.types import ImageContent, TextContent
from pydantic import BaseModel

from log_config import get_logger
from tools_proc.media_output import base64を返すか, ファイル応答
from tools_proc.desktop_capture import DesktopCaptureError

logger = get_logger(__name__)


class ScreenshotRequest(BaseModel):
    screen_number: str = "auto"
    size: Optional[int] = None
    x: Optional[int] = None
    y: Optional[int] = None
    width: Optional[int] = None
    height: Optional[int] = None
    window_title: Optional[str] = None
    delay: float = 0.0
    format: str = "png"
    quality: int = 85
    crosshair: bool = False
    label: bool = False
    save_path: Optional[str] = None
    shutter_sounds: str = "none"


def register_tools(mcp_dc, capture):
    """aidiy_desktop_capture MCP ツールを mcp_dc インスタンスに登録する"""

    @mcp_dc.tool()
    async def screenshot(
        screen_number: str = "auto",
        size: Optional[int] = None,
        x: Optional[int] = None,
        y: Optional[int] = None,
        width: Optional[int] = None,
        height: Optional[int] = None,
        window_title: Optional[str] = None,
        delay: float = 0.0,
        format: str = "png",
        quality: int = 85,
        crosshair: bool = False,
        label: bool = False,
        save_path: Optional[str] = None,
        shutter_sounds: str = "none",
    ) -> list:
        """
        OS のスクリーンショットを撮る（PNG/JPEG 画像）。

        撮影モードはパラメータの組み合わせで自動判定する（優先順位順）:
          1. window_title 指定あり → ウィンドウキャプチャ（Windows 専用）
          2. x,y,width,height 全指定 → 指定領域キャプチャ
          3. size 指定あり → screen_number モニター上でカーソル中心の矩形切り出し
          4. それ以外 → screen_number モニター全体（デフォルト）

        Args:
            screen_number: モニター指定。"auto"=カーソルのあるモニター, "all"=全画面結合,
                           "0"/"1"/...=モニター番号。デフォルト "auto"
            size: カーソル中心切り出しの一辺 px（例: 600）
            x: region モードの左上 X 座標（絶対座標）
            y: region モードの左上 Y 座標（絶対座標）
            width: region モードの幅 px
            height: region モードの高さ px
            window_title: ウィンドウタイトルの部分一致文字列
            delay: 撮影前の遅延秒数（ツールチップ・メニュー表示待ちに有効）
            format: "png"（デフォルト）または "jpeg"
            quality: JPEG 品質 1-100（デフォルト 85）
            crosshair: True でカーソル位置に赤い十字線を描画（size モード時）
            label: True で座標・サイズのラベルを右下に追記
            save_path: 保存先。フォルダ指定なら yyyymmdd.hhmmss.png で保存。
                       ファイル指定なら指定ファイルに保存。省略時は backend_server/temp/output/ に保存。
            shutter_sounds: "auto" でシャッター音を再生（Windows のみ）。デフォルト "none"
        """
        if delay > 0:
            await asyncio.sleep(delay)

        try:
            img = None
            info = {}
            crosshair_pos = None

            if window_title:
                img, info = await asyncio.to_thread(capture.grab_window, window_title, shutter_sounds)
            elif x is not None and y is not None and width is not None and height is not None:
                img = await asyncio.to_thread(capture.grab_region, x, y, width, height, shutter_sounds)
                info = {"x": x, "y": y, "width": width, "height": height}
            elif size is not None:
                img, info = await asyncio.to_thread(capture.grab_cursor_region, size, screen_number, shutter_sounds)
                if crosshair:
                    cx = info["cursor_x"] - info["x"] - info.get("crop_rel_x", 0)
                    cy = info["cursor_y"] - info["y"] - info.get("crop_rel_y", 0)
                    crosshair_pos = (cx, cy)
            else:
                img, info = await asyncio.to_thread(capture.grab_screen, screen_number, shutter_sounds)

            label_text = None
            if label:
                cx, cy = info.get("cursor_x", 0), info.get("cursor_y", 0)
                label_text = (
                    f"cursor=({cx},{cy})  "
                    f"region=({info.get('x',0)},{info.get('y',0)}"
                    f" {info.get('width', img.width)}x{info.get('height', img.height)})"
                )

            if crosshair_pos or label_text:
                img = await asyncio.to_thread(capture.annotate, img, crosshair_pos, label_text)

            返す = base64を返すか(save_path)
            data, dest = await asyncio.to_thread(
                capture.to_base64, img, format, quality, save_path, 返す
            )
            mime = "image/jpeg" if format.lower() in ("jpeg", "jpg") else "image/png"

            logger.info(
                f"screenshot: mode={'window' if window_title else 'region' if x is not None else 'cursor' if size else 'screen'}"
                f"  size={img.size}  format={format}"
                f"  save_path={save_path or '(default)'}"
            )

            if not 返す:
                # save_path 指定時は base64 を返さない（保存先を読めば済むため）
                return [TextContent(
                    type="text",
                    text=json.dumps(ファイル応答(dest, mime), ensure_ascii=False),
                )]
            return [ImageContent(type="image", data=data, mimeType=mime)]

        except DesktopCaptureError as e:
            raise ValueError(str(e)) from e

    @mcp_dc.tool()
    async def get_cursor_pos() -> str:
        """現在のマウスカーソル座標を返す"""
        x, y = await asyncio.to_thread(capture.cursor_pos)
        return json.dumps({"x": x, "y": y}, ensure_ascii=False)

    @mcp_dc.tool()
    async def get_screen_info() -> str:
        """
        全モニターの解像度・座標・プライマリフラグを返す。

        Returns:
            JSON {"monitors": [{index, x, y, width, height, primary}, ...]}
        """
        mons = await asyncio.to_thread(capture.monitors)
        return json.dumps({"monitors": mons}, ensure_ascii=False)

    @mcp_dc.tool()
    async def list_windows() -> str:
        """
        表示中ウィンドウの一覧を返す（Windows 専用）。

        Returns:
            JSON {"windows": [{hwnd, title, x, y, width, height}, ...]}
        """
        wins = await asyncio.to_thread(capture.list_windows)
        return json.dumps({"windows": wins}, ensure_ascii=False)


# ================================================================== #
# HTTP ルート
# ================================================================== #

def create_router(capture) -> APIRouter:
    """aidiy_desktop_capture HTTP APIRouter を作成して返す"""
    router = APIRouter(tags=["aidiy_desktop_capture"])

    @router.get("/aidiy_desktop_capture/docs", summary="aidiy_desktop_capture ドキュメント")
    async def http_desktop_docs() -> dict:
        """aidiy_desktop_capture の詳細 API ドキュメント（AI 向け）"""
        return {
            "service": "aidiy_desktop_capture",
            "description": "デスクトップのスクリーンショット取得・カーソル位置・モニター情報・ウィンドウ一覧を提供する。撮影モードはパラメータの組み合わせで自動判定する。",
            "endpoint": "POST /aidiy_desktop_capture/{method_name}",
            "content_type": "application/json",
            "capture_mode_priority": [
                "1. window_title 指定あり → ウィンドウキャプチャ（Windows 専用）",
                "2. x/y/width/height 全指定 → 指定領域キャプチャ",
                "3. size 指定あり → カーソル中心の矩形切り出し",
                "4. それ以外 → screen_number モニター全体",
            ],
            "methods": {
                "screenshot": {
                    "summary": "スクリーンショット撮影",
                    "description": "モニター全体・指定領域・カーソル周辺・ウィンドウを撮影し PNG/JPEG の base64 文字列を返す。save_path を省略すると temp/output/ に自動保存される。",
                    "parameters": {
                        "screen_number": {"type": "string", "required": False, "default": "auto", "values": ["auto", "all", "0", "1", "2"], "description": "'auto'=カーソルのあるモニター / 'all'=全モニター結合 / '0'/'1'/... =モニター番号"},
                        "size": {"type": "integer", "required": False, "description": "カーソル中心切り出しの一辺 px。指定するとモード 3 になる（例: 600）"},
                        "x": {"type": "integer", "required": False, "description": "region モードの左上 X 座標（絶対座標）。y/width/height と併用"},
                        "y": {"type": "integer", "required": False, "description": "region モードの左上 Y 座標（絶対座標）"},
                        "width": {"type": "integer", "required": False, "description": "region モードの幅 px"},
                        "height": {"type": "integer", "required": False, "description": "region モードの高さ px"},
                        "window_title": {"type": "string", "required": False, "description": "ウィンドウタイトルの部分一致文字列（Windows 専用）。例: 'Chrome' / 'メモ帳'"},
                        "delay": {"type": "number", "required": False, "default": 0.0, "description": "撮影前の遅延秒数。ツールチップ・メニュー表示待ちに有効"},
                        "format": {"type": "string", "required": False, "default": "png", "values": ["png", "jpeg"], "description": "出力フォーマット"},
                        "quality": {"type": "integer", "required": False, "default": 85, "description": "JPEG 品質 1〜100（format='jpeg' 時のみ有効）"},
                        "crosshair": {"type": "boolean", "required": False, "default": False, "description": "True でカーソル位置に赤い十字線を描画（size モード時）"},
                        "label": {"type": "boolean", "required": False, "default": False, "description": "True で座標・サイズのラベルを右下に追記"},
                        "save_path": {"type": "string", "required": False, "description": "保存先パス。省略時は temp/output/ に yyyymmdd.HHMMSS.png で自動保存"},
                        "shutter_sounds": {"type": "string", "required": False, "default": "none", "values": ["auto", "none"], "description": "'auto' でシャッター音を再生（Windows のみ）"},
                    },
                    "example_request": {"screen_number": "auto", "format": "png"},
                    "example_request_window": {"window_title": "Chrome", "format": "jpeg", "quality": 80},
                    "example_request_region": {"x": 100, "y": 200, "width": 800, "height": 600},
                    "response_fields": {"type": "image", "data": "PNG/JPEG の base64 文字列", "mimeType": "image/png または image/jpeg"},
                },
                "cursor_pos": {
                    "summary": "カーソル座標取得",
                    "description": "現在のマウスカーソルの絶対座標を返す。screenshot の region モードや UI 操作の位置確認に使う。",
                    "parameters": {},
                    "example_request": {},
                    "response_fields": {"x": "X 座標（ピクセル）", "y": "Y 座標（ピクセル）"},
                },
                "screen_info": {
                    "summary": "モニター情報取得",
                    "description": "接続中の全モニターの解像度・位置・プライマリフラグを返す。screenshot の screen_number 指定やマルチモニター判定に使う。",
                    "parameters": {},
                    "example_request": {},
                    "response_fields": {"monitors": "配列 [{index, x, y, width, height, primary}, ...]"},
                },
                "list_windows": {
                    "summary": "ウィンドウ一覧取得（Windows 専用）",
                    "description": "表示中の全ウィンドウのハンドル・タイトル・位置・サイズを返す。screenshot の window_title 指定前に候補を確認するために使う。",
                    "parameters": {},
                    "example_request": {},
                    "response_fields": {"windows": "配列 [{hwnd, title, x, y, width, height}, ...]"},
                },
            },
        }

    @router.post("/aidiy_desktop_capture/{method_name}", summary="デスクトップキャプチャ")
    async def http_desktop(
        method_name: str,
        req: ScreenshotRequest = ScreenshotRequest(),
    ) -> dict:
        """
        | method_name | 説明 |
        |---|---|
        | screenshot | スクリーンショット（base64 返却） |
        | cursor_pos | カーソル座標 |
        | screen_info | モニター情報 |
        | list_windows | ウィンドウ一覧 |
        """
        try:
            if method_name == "screenshot":
                if req.delay > 0:
                    await asyncio.sleep(req.delay)
                img = None
                info = {}
                crosshair_pos = None
                if req.window_title:
                    img, info = await asyncio.to_thread(capture.grab_window, req.window_title, req.shutter_sounds)
                elif req.x is not None and req.y is not None and req.width is not None and req.height is not None:
                    img = await asyncio.to_thread(capture.grab_region, req.x, req.y, req.width, req.height, req.shutter_sounds)
                    info = {"x": req.x, "y": req.y, "width": req.width, "height": req.height}
                elif req.size is not None:
                    img, info = await asyncio.to_thread(capture.grab_cursor_region, req.size, req.screen_number, req.shutter_sounds)
                    if req.crosshair:
                        cx = info["cursor_x"] - info["x"] - info.get("crop_rel_x", 0)
                        cy = info["cursor_y"] - info["y"] - info.get("crop_rel_y", 0)
                        crosshair_pos = (cx, cy)
                else:
                    img, info = await asyncio.to_thread(capture.grab_screen, req.screen_number, req.shutter_sounds)
                label_text = None
                if req.label:
                    cx, cy = info.get("cursor_x", 0), info.get("cursor_y", 0)
                    label_text = (
                        f"cursor=({cx},{cy})  "
                        f"region=({info.get('x',0)},{info.get('y',0)}"
                        f" {info.get('width', img.width)}x{info.get('height', img.height)})"
                    )
                if crosshair_pos or label_text:
                    img = await asyncio.to_thread(capture.annotate, img, crosshair_pos, label_text)
                mime = "image/jpeg" if req.format.lower() in ("jpeg", "jpg") else "image/png"
                返す = base64を返すか(req.save_path)
                data, dest = await asyncio.to_thread(
                    capture.to_base64, img, req.format, req.quality, req.save_path, 返す
                )
                if not 返す:
                    # save_path 指定時は base64 を返さない（保存先を読めば済むため）
                    return ファイル応答(dest, mime)
                return {"type": "image", "data": data, "mimeType": mime}

            elif method_name == "cursor_pos":
                x, y = await asyncio.to_thread(capture.cursor_pos)
                return {"x": x, "y": y}

            elif method_name == "screen_info":
                mons = await asyncio.to_thread(capture.monitors)
                return {"monitors": mons}

            elif method_name == "list_windows":
                wins = await asyncio.to_thread(capture.list_windows)
                return {"windows": wins}

            else:
                return {"error": f"未知のメソッド: {method_name}"}

        except DesktopCaptureError as e:
            logger.warning(f"http_desktop [{method_name}] error: {e}")
            return {"error": str(e)}

    return router
