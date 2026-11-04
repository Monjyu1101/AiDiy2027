# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""aidiy_windows_control MCP ツール登録 + HTTP ルート"""

import asyncio
import json
from typing import Annotated, Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

from log_config import get_logger
from tools_proc.windows_control import WindowsControlError

DESCRIPTION = (
    "Windows環境でComputer Use（computer-use）が利用できない場合の代替機能です。"
    "マウス／キーボード、ウィンドウ、プロセス、クリップボード、"
    "UI AutomationによるWindowsデスクトップ操作を提供します。Windows専用です。"
)

logger = get_logger(__name__)


class WindowsControlRequest(BaseModel):
    # マウス / キーボード
    x: Optional[int] = None
    y: Optional[int] = None
    x1: Optional[int] = None
    y1: Optional[int] = None
    x2: Optional[int] = None
    y2: Optional[int] = None
    button: str = "left"
    clicks: int = 1
    duration: Optional[float] = None
    hold_duration: Annotated[float, Field(ge=0, le=10, allow_inf_nan=False)] = 0.8
    amount: Optional[int] = None
    horizontal: bool = False
    text: Optional[str] = None
    interval: Optional[float] = None
    key: Optional[str] = None
    keys: Optional[list[str]] = None
    # ウィンドウ
    hwnd: Optional[int] = None
    window_title: Optional[str] = None
    width: Optional[int] = None
    height: Optional[int] = None
    state: Optional[str] = None
    # アプリ / プロセス
    path: Optional[str] = None
    args: str = ""
    pid: Optional[int] = None
    name: Optional[str] = None
    # UI Automation
    max_depth: int = 6
    max_elements: int = 150
    element_id: Optional[int] = None
    double: bool = False
    clear: bool = False


def register_tools(mcp_wc, wc):
    """aidiy_windows_control MCP ツールを mcp_wc インスタンスに登録する"""

    # ---------------------------------------------------------------- #
    # マウス / キーボード
    # ---------------------------------------------------------------- #

    @mcp_wc.tool()
    async def mouse_click(x: int, y: int, button: str = "left", clicks: int = 1) -> str:
        """指定座標でマウスクリックする（button: left/right/middle、clicks: 連打回数）"""
        try:
            result = await asyncio.to_thread(wc.mouse_click, x, y, button, clicks)
        except WindowsControlError as e:
            raise ValueError(str(e)) from e
        return json.dumps(result, ensure_ascii=False)

    @mcp_wc.tool()
    async def mouse_move(x: int, y: int, duration: float = 0.0) -> str:
        """マウスカーソルを指定座標へ移動する"""
        try:
            result = await asyncio.to_thread(wc.mouse_move, x, y, duration)
        except WindowsControlError as e:
            raise ValueError(str(e)) from e
        return json.dumps(result, ensure_ascii=False)

    @mcp_wc.tool()
    async def mouse_drag(x1: int, y1: int, x2: int, y2: int, button: str = "left", duration: float = 0.2) -> str:
        """(x1,y1) から (x2,y2) へドラッグする"""
        try:
            result = await asyncio.to_thread(wc.mouse_drag, x1, y1, x2, y2, button, duration)
        except WindowsControlError as e:
            raise ValueError(str(e)) from e
        return json.dumps(result, ensure_ascii=False)

    @mcp_wc.tool()
    async def mouse_long_press_drag(x1: int, y1: int, x2: int, y2: int, button: str = "left", duration: Annotated[float, Field(ge=0, le=60, allow_inf_nan=False)] = 0.2, hold_duration: Annotated[float, Field(ge=0, le=10, allow_inf_nan=False)] = 0.8) -> str:
        """押下→保持→移動→解放。hold_durationは移動前の保持秒数(0〜10、既定0.8)、durationは移動秒数(0〜60、既定0.2)。"""
        try:
            result = await asyncio.to_thread(wc.mouse_long_press_drag, x1, y1, x2, y2, button, duration, hold_duration)
        except WindowsControlError as e:
            raise ValueError(str(e)) from e
        return json.dumps(result, ensure_ascii=False)

    @mcp_wc.tool()
    async def mouse_scroll(amount: int, x: Optional[int] = None, y: Optional[int] = None, horizontal: bool = False) -> str:
        """マウスホイールでスクロールする（amount: 正=上/左、負=下/右、horizontal: 水平スクロール）"""
        try:
            result = await asyncio.to_thread(wc.mouse_scroll, amount, x, y, horizontal)
        except WindowsControlError as e:
            raise ValueError(str(e)) from e
        return json.dumps(result, ensure_ascii=False)

    @mcp_wc.tool()
    async def keyboard_type(text: str, interval: float = 0.02) -> str:
        """
        フォーカス中の要素へ文字列をキー入力する（英数字向け）。

        注意: IME（日本語など）が有効な環境ではローマ字変換される場合がある。
        日本語や特殊文字を確実に入力したい場合は、代わりに
        set_clipboard_text で文字列をクリップボードへ設定してから
        keyboard_shortcut(["ctrl","v"]) で貼り付けること。
        """
        try:
            result = await asyncio.to_thread(wc.keyboard_type, text, interval)
        except WindowsControlError as e:
            raise ValueError(str(e)) from e
        return json.dumps(result, ensure_ascii=False)

    @mcp_wc.tool()
    async def keyboard_key(key: str) -> str:
        """単一キーを押す（例: "enter", "esc", "tab", "up", "backspace"）"""
        try:
            result = await asyncio.to_thread(wc.keyboard_key, key)
        except WindowsControlError as e:
            raise ValueError(str(e)) from e
        return json.dumps(result, ensure_ascii=False)

    @mcp_wc.tool()
    async def keyboard_shortcut(keys: list[str]) -> str:
        """複数キーを同時押しする（例: ["ctrl","c"], ["alt","tab"]）"""
        try:
            result = await asyncio.to_thread(wc.keyboard_shortcut, keys)
        except WindowsControlError as e:
            raise ValueError(str(e)) from e
        return json.dumps(result, ensure_ascii=False)

    # ---------------------------------------------------------------- #
    # ウィンドウ制御
    # ---------------------------------------------------------------- #

    @mcp_wc.tool()
    async def list_windows() -> str:
        """表示中ウィンドウの一覧を返す（hwnd/title/rect/pid/最小化・最大化状態）"""
        result = await asyncio.to_thread(wc.list_windows)
        return json.dumps({"windows": result}, ensure_ascii=False)

    @mcp_wc.tool()
    async def focus_window(hwnd: Optional[int] = None, window_title: Optional[str] = None) -> str:
        """ウィンドウを最前面へ移動しフォーカスする（hwnd または window_title の部分一致で指定）"""
        try:
            result = await asyncio.to_thread(wc.focus_window, hwnd, window_title)
        except WindowsControlError as e:
            raise ValueError(str(e)) from e
        return json.dumps(result, ensure_ascii=False)

    @mcp_wc.tool()
    async def move_window(x: int, y: int, hwnd: Optional[int] = None, window_title: Optional[str] = None) -> str:
        """ウィンドウを指定座標へ移動する"""
        try:
            result = await asyncio.to_thread(wc.move_window, x, y, hwnd, window_title)
        except WindowsControlError as e:
            raise ValueError(str(e)) from e
        return json.dumps(result, ensure_ascii=False)

    @mcp_wc.tool()
    async def resize_window(width: int, height: int, hwnd: Optional[int] = None, window_title: Optional[str] = None) -> str:
        """ウィンドウサイズを変更する"""
        try:
            result = await asyncio.to_thread(wc.resize_window, width, height, hwnd, window_title)
        except WindowsControlError as e:
            raise ValueError(str(e)) from e
        return json.dumps(result, ensure_ascii=False)

    @mcp_wc.tool()
    async def set_window_state(state: str, hwnd: Optional[int] = None, window_title: Optional[str] = None) -> str:
        """ウィンドウ状態を変更する（state: minimize/maximize/restore/hide/show/close）"""
        try:
            result = await asyncio.to_thread(wc.set_window_state, state, hwnd, window_title)
        except WindowsControlError as e:
            raise ValueError(str(e)) from e
        return json.dumps(result, ensure_ascii=False)

    # ---------------------------------------------------------------- #
    # アプリ起動 / プロセス
    # ---------------------------------------------------------------- #

    @mcp_wc.tool()
    async def launch_app(path: str, args: str = "") -> str:
        """実行ファイル・ドキュメント・URI を既定の関連付けで開く（ShellExecute 相当）"""
        try:
            result = await asyncio.to_thread(wc.launch_app, path, args)
        except WindowsControlError as e:
            raise ValueError(str(e)) from e
        return json.dumps(result, ensure_ascii=False)

    @mcp_wc.tool()
    async def list_processes() -> str:
        """実行中プロセスの一覧を返す（pid/ppid/name/threads）"""
        try:
            result = await asyncio.to_thread(wc.list_processes)
        except WindowsControlError as e:
            raise ValueError(str(e)) from e
        return json.dumps({"processes": result}, ensure_ascii=False)

    @mcp_wc.tool()
    async def kill_process(pid: Optional[int] = None, name: Optional[str] = None) -> str:
        """プロセスを終了する（pid 指定で単一、name 指定で同名プロセス全て）"""
        try:
            result = await asyncio.to_thread(wc.kill_process, pid, name)
        except WindowsControlError as e:
            raise ValueError(str(e)) from e
        return json.dumps(result, ensure_ascii=False)

    # ---------------------------------------------------------------- #
    # クリップボード
    # ---------------------------------------------------------------- #

    @mcp_wc.tool()
    async def get_clipboard_text() -> str:
        """クリップボードのテキストを取得する"""
        try:
            result = await asyncio.to_thread(wc.get_clipboard_text)
        except WindowsControlError as e:
            raise ValueError(str(e)) from e
        return json.dumps({"text": result}, ensure_ascii=False)

    @mcp_wc.tool()
    async def set_clipboard_text(text: str) -> str:
        """クリップボードにテキストを設定する（IME 変換を避けた確実な文字入力にも活用可能）"""
        try:
            result = await asyncio.to_thread(wc.set_clipboard_text, text)
        except WindowsControlError as e:
            raise ValueError(str(e)) from e
        return json.dumps(result, ensure_ascii=False)

    # ---------------------------------------------------------------- #
    # UI Automation（要素 ID ベースのクリック・入力）
    # ---------------------------------------------------------------- #

    @mcp_wc.tool()
    async def ui_snapshot(window_title: Optional[str] = None, max_depth: int = 6, max_elements: int = 150) -> str:
        """
        UI Automation でウィンドウの要素ツリーを走査し、要素 ID 付きの一覧を返す。

        window_title 省略時はフォアグラウンドウィンドウを対象にする。
        element_id はこの呼び出し直後のみ有効。ui_click / ui_type の前には
        必ず ui_snapshot を再実行すること。
        """
        try:
            result = await asyncio.to_thread(wc.ui_snapshot, window_title, max_depth, max_elements)
        except WindowsControlError as e:
            raise ValueError(str(e)) from e
        return json.dumps(result, ensure_ascii=False)

    @mcp_wc.tool()
    async def ui_click(element_id: int, double: bool = False) -> str:
        """直近の ui_snapshot で取得した要素 ID をクリックする"""
        try:
            result = await asyncio.to_thread(wc.ui_click, element_id, double)
        except WindowsControlError as e:
            raise ValueError(str(e)) from e
        return json.dumps(result, ensure_ascii=False)

    @mcp_wc.tool()
    async def ui_set_focus(element_id: int) -> str:
        """直近の ui_snapshot で取得した要素 ID にフォーカスを移す"""
        try:
            result = await asyncio.to_thread(wc.ui_set_focus, element_id)
        except WindowsControlError as e:
            raise ValueError(str(e)) from e
        return json.dumps(result, ensure_ascii=False)

    @mcp_wc.tool()
    async def ui_type(element_id: int, text: str, clear: bool = False) -> str:
        """直近の ui_snapshot で取得した要素 ID にフォーカスし文字列を送る（clear=True で既存文字を消してから入力）"""
        try:
            result = await asyncio.to_thread(wc.ui_type, element_id, text, clear)
        except WindowsControlError as e:
            raise ValueError(str(e)) from e
        return json.dumps(result, ensure_ascii=False)


# ================================================================== #
# HTTP ルート
# ================================================================== #

def create_router(wc) -> APIRouter:
    """aidiy_windows_control HTTP APIRouter を作成して返す"""
    router = APIRouter(tags=["aidiy_windows_control"])

    @router.get("/aidiy_windows_control/docs", summary="aidiy_windows_control ドキュメント")
    async def http_wc_docs() -> dict:
        return {
            "service": "aidiy_windows_control",
            "description": (
DESCRIPTION + "参考: https://github.com/CursorTouch/Windows-MCP"
            ),
            "endpoint": "POST /aidiy_windows_control/{method_name}",
            "content_type": "application/json",
            "notes": [
                "IME が有効な環境では keyboard_type がローマ字変換される場合がある。"
                "確実な文字入力には set_clipboard_text + keyboard_shortcut(['ctrl','v']) を使う。",
                "ui_snapshot の element_id は直後の ui_click/ui_set_focus/ui_type でのみ有効。",
                "mouse_long_press_drag: hold_durationは移動前の保持秒数(0〜10、既定0.8)、durationは移動秒数(0〜60、既定0.2)。mouse_dragは従来通り。",
            ],
            "methods": [
                "mouse_click", "mouse_move", "mouse_drag", "mouse_long_press_drag", "mouse_scroll",
                "keyboard_type", "keyboard_key", "keyboard_shortcut",
                "list_windows", "focus_window", "move_window", "resize_window", "set_window_state",
                "launch_app", "list_processes", "kill_process",
                "get_clipboard_text", "set_clipboard_text",
                "ui_snapshot", "ui_click", "ui_set_focus", "ui_type",
            ],
        }

    @router.post("/aidiy_windows_control/{method_name}", summary="Windows 操作制御")
    async def http_wc(method_name: str, req: WindowsControlRequest = WindowsControlRequest()) -> dict:
        try:
            if method_name == "mouse_click":
                return await asyncio.to_thread(wc.mouse_click, req.x, req.y, req.button, req.clicks)
            elif method_name == "mouse_move":
                return await asyncio.to_thread(wc.mouse_move, req.x, req.y, req.duration or 0.0)
            elif method_name == "mouse_drag":
                return await asyncio.to_thread(wc.mouse_drag, req.x1, req.y1, req.x2, req.y2, req.button, req.duration or 0.2)
            elif method_name == "mouse_long_press_drag":
                return await asyncio.to_thread(wc.mouse_long_press_drag, req.x1, req.y1, req.x2, req.y2, req.button, 0.2 if req.duration is None else req.duration, req.hold_duration)
            elif method_name == "mouse_scroll":
                return await asyncio.to_thread(wc.mouse_scroll, req.amount, req.x, req.y, req.horizontal)
            elif method_name == "keyboard_type":
                return await asyncio.to_thread(wc.keyboard_type, req.text, req.interval or 0.02)
            elif method_name == "keyboard_key":
                return await asyncio.to_thread(wc.keyboard_key, req.key)
            elif method_name == "keyboard_shortcut":
                return await asyncio.to_thread(wc.keyboard_shortcut, req.keys or [])
            elif method_name == "list_windows":
                return {"windows": await asyncio.to_thread(wc.list_windows)}
            elif method_name == "focus_window":
                return await asyncio.to_thread(wc.focus_window, req.hwnd, req.window_title)
            elif method_name == "move_window":
                return await asyncio.to_thread(wc.move_window, req.x, req.y, req.hwnd, req.window_title)
            elif method_name == "resize_window":
                return await asyncio.to_thread(wc.resize_window, req.width, req.height, req.hwnd, req.window_title)
            elif method_name == "set_window_state":
                return await asyncio.to_thread(wc.set_window_state, req.state, req.hwnd, req.window_title)
            elif method_name == "launch_app":
                return await asyncio.to_thread(wc.launch_app, req.path, req.args)
            elif method_name == "list_processes":
                return {"processes": await asyncio.to_thread(wc.list_processes)}
            elif method_name == "kill_process":
                return await asyncio.to_thread(wc.kill_process, req.pid, req.name)
            elif method_name == "get_clipboard_text":
                return {"text": await asyncio.to_thread(wc.get_clipboard_text)}
            elif method_name == "set_clipboard_text":
                return await asyncio.to_thread(wc.set_clipboard_text, req.text)
            elif method_name == "ui_snapshot":
                return await asyncio.to_thread(wc.ui_snapshot, req.window_title, req.max_depth, req.max_elements)
            elif method_name == "ui_click":
                return await asyncio.to_thread(wc.ui_click, req.element_id, req.double)
            elif method_name == "ui_set_focus":
                return await asyncio.to_thread(wc.ui_set_focus, req.element_id)
            elif method_name == "ui_type":
                return await asyncio.to_thread(wc.ui_type, req.element_id, req.text, req.clear)
            else:
                return {"error": f"未知のメソッド: {method_name}"}
        except WindowsControlError as e:
            logger.warning(f"http_wc [{method_name}] error: {e}")
            return {"error": str(e)}
        except Exception as e:
            # 必須パラメータ未指定 (None) や pyautogui 例外で 500 にしない
            logger.warning(f"http_wc [{method_name}] unexpected error: {e}")
            return {"error": f"{type(e).__name__}: {e}"}

    return router
