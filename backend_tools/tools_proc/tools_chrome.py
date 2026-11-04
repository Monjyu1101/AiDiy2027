# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""aidiy_chrome_devtools MCP ツール登録 + HTTP ルート"""

import asyncio
import json
from typing import Optional

from fastapi import APIRouter
from mcp.types import ImageContent, TextContent
from pydantic import BaseModel

from log_config import get_logger
from tools_proc.media_output import ファイル応答

logger = get_logger(__name__)


# ------------------------------------------------------------------ #
# HTTP リクエストモデル
# ------------------------------------------------------------------ #

class ChromeDevToolsRequest(BaseModel):
    """POST /aidiy_chrome_devtools/{method} 共通リクエストモデル"""
    session: str = "default"
    headless: Optional[bool] = None
    tab_id: Optional[str] = None
    url: Optional[str] = None
    show_automation_banner: bool = True
    full_page: bool = False
    save_path: Optional[str] = None
    shutter_sounds: str = "none"
    expression: Optional[str] = None
    await_promise: bool = False
    selector: Optional[str] = None
    limit: int = 50
    text: Optional[str] = None
    value: Optional[str] = None
    clear_first: bool = True
    delta_x: int = 0
    delta_y: int = 0
    width: Optional[int] = None
    height: Optional[int] = None
    timeout: float = 10.0
    level: Optional[str] = None
    cdp_method: Optional[str] = None
    params: Optional[str] = None
    accept: bool = True
    dialog_wait: float = 0.0


_CHROME_DEVTOOLS_METHODS = [
    {"name": "navigate", "description": "指定 URL へ移動する。戻り値に readyState を含むため、多くの場合 wait_for_load は不要",
     "parameters": {"url": {"type": "string", "required": True}, "tab_id": {"type": "string", "required": False}, "show_automation_banner": {"type": "boolean", "required": False, "default": True}}},
    {"name": "launch_url", "description": "URL を Chrome の起動引数として渡して開く。--autoplay-policy などプロセス単位でしか効かない起動引数を確実に適用したいページ（音声つき自動再生など）で navigate の代わりに使う。起動済みなら同じプロファイルへ新しいタブで開く",
     "parameters": {"url": {"type": "string", "required": True}, "show_automation_banner": {"type": "boolean", "required": False, "default": True}}},
    {"name": "reload", "description": "現在のページをリロードする。戻り値に readyState を含む", "parameters": {"tab_id": {"type": "string", "required": False}}},
    {"name": "go_back", "description": "ブラウザの戻るボタン相当", "parameters": {"tab_id": {"type": "string", "required": False}}},
    {"name": "go_forward", "description": "ブラウザの進むボタン相当", "parameters": {"tab_id": {"type": "string", "required": False}}},
    {"name": "screenshot", "description": "スクリーンショットを撮る。save_path 未指定なら base64 を返し、save_path 指定時は保存だけして base64 は返さない（同じ画像を二重に返して文脈を膨らませないため）",
     "parameters": {"tab_id": {"type": "string", "required": False}, "full_page": {"type": "boolean", "required": False, "default": False}, "save_path": {"type": "string", "required": False}, "shutter_sounds": {"type": "string", "required": False, "default": "none", "values": ["auto", "none"], "description": "'auto' でシャッター音を再生"}}},
    {"name": "get_page_info", "description": "ページの URL・タイトル・readyState などを取得する", "parameters": {"tab_id": {"type": "string", "required": False}}},
    {"name": "get_html", "description": "ページ全体の HTML を取得する", "parameters": {"tab_id": {"type": "string", "required": False}}},
    {"name": "get_text", "description": "ページのテキストコンテンツを取得する", "aliases": ["get_page_content"], "parameters": {"tab_id": {"type": "string", "required": False}}},
    {"name": "eval_js", "description": "JavaScript を実行して結果を返す", "aliases": ["evaluate"],
     "parameters": {"expression": {"type": "string", "required": True}, "tab_id": {"type": "string", "required": False}, "await_promise": {"type": "boolean", "required": False, "default": False}}},
    {"name": "click", "description": "CSS セレクターで要素をクリックする", "aliases": ["click_element"],
     "parameters": {"selector": {"type": "string", "required": True}, "tab_id": {"type": "string", "required": False}}},
    {"name": "type_text", "description": "CSS セレクターで要素にテキストを入力する", "aliases": ["fill"],
     "parameters": {"selector": {"type": "string", "required": True}, "text": {"type": "string", "required": True}, "tab_id": {"type": "string", "required": False}, "clear_first": {"type": "boolean", "required": False, "default": True}}},
    {"name": "scroll", "description": "ページまたは要素をスクロールする",
     "parameters": {"delta_x": {"type": "integer", "required": False, "default": 0}, "delta_y": {"type": "integer", "required": False, "default": 0}, "tab_id": {"type": "string", "required": False}, "selector": {"type": "string", "required": False}}},
    {"name": "scroll_to_element", "description": "要素が見えるようにスクロールする",
     "parameters": {"selector": {"type": "string", "required": True}, "tab_id": {"type": "string", "required": False}}},
    {"name": "find_elements", "description": "CSS セレクターで要素を検索してプロパティ一覧を返す",
     "parameters": {"selector": {"type": "string", "required": True}, "tab_id": {"type": "string", "required": False}, "limit": {"type": "integer", "required": False, "default": 50}}},
    {"name": "list_tabs", "description": "開いているタブ一覧を取得する", "aliases": ["list_pages"], "parameters": {}},
    {"name": "new_tab", "description": "新規タブを開く。Browserでは返却されたsessionとidを次の操作のsessionとtab_idに使う", "aliases": ["new_page"],
     "parameters": {"url": {"type": "string", "required": False, "default": "about:blank"}, "show_automation_banner": {"type": "boolean", "required": False, "default": True}}},
    {"name": "close_tab", "description": "指定タブを閉じる", "aliases": ["close_page"], "parameters": {"tab_id": {"type": "string", "required": True}}},
    {"name": "activate_tab", "description": "指定タブをアクティブにする", "parameters": {"tab_id": {"type": "string", "required": True}}},
    {"name": "set_viewport", "description": "ビューポートサイズを設定する",
     "parameters": {"width": {"type": "integer", "required": True}, "height": {"type": "integer", "required": True}, "tab_id": {"type": "string", "required": False}}},
    {"name": "wait_for_load", "description": "ページのロード完了を待つ。navigate/reload の readyState が complete でない場合のみ使用（多用すると遅くなる）",
     "parameters": {"tab_id": {"type": "string", "required": False}, "timeout": {"type": "number", "required": False, "default": 10.0}}},
    {"name": "install_console_capture", "description": "コンソールログのキャプチャをページに設置する", "parameters": {"tab_id": {"type": "string", "required": False}}},
    {"name": "get_console_logs", "description": "キャプチャされたコンソールログを取得する",
     "parameters": {"tab_id": {"type": "string", "required": False}, "level": {"type": "string", "required": False}, "limit": {"type": "integer", "required": False, "default": 50}}},
    {"name": "clear_console_logs", "description": "キャプチャされたコンソールログをクリアする", "parameters": {"tab_id": {"type": "string", "required": False}}},
    {"name": "install_network_capture", "description": "XHR/fetch リクエストのキャプチャをページに設置する", "parameters": {"tab_id": {"type": "string", "required": False}}},
    {"name": "get_network_logs", "description": "キャプチャされたネットワークリクエストを取得する",
     "parameters": {"tab_id": {"type": "string", "required": False}, "limit": {"type": "integer", "required": False, "default": 50}}},
    {"name": "clear_network_logs", "description": "キャプチャされたネットワークログをクリアする", "parameters": {"tab_id": {"type": "string", "required": False}}},
    {"name": "get_cookies", "description": "ページの Cookie を取得する", "parameters": {"tab_id": {"type": "string", "required": False}}},
    {"name": "get_local_storage", "description": "localStorage の内容を取得する", "parameters": {"tab_id": {"type": "string", "required": False}}},
    {"name": "get_session_storage", "description": "sessionStorage の内容を取得する", "parameters": {"tab_id": {"type": "string", "required": False}}},
    {"name": "get_current_url", "description": "現在の URL を取得する", "parameters": {"tab_id": {"type": "string", "required": False}}},
    {"name": "get_title", "description": "ページタイトルを取得する", "parameters": {"tab_id": {"type": "string", "required": False}}},
    {"name": "get_resource_timing", "description": "Performance API からリソースタイミング情報を取得する",
     "parameters": {"tab_id": {"type": "string", "required": False}, "limit": {"type": "integer", "required": False, "default": 50}}},
    {"name": "get_version", "description": "Chrome のバージョンと UserAgent 情報を取得する", "parameters": {}},
    {"name": "cdp_command", "description": "Chrome DevTools Protocol (CDP) コマンドを直接送信する",
     "parameters": {"cdp_method": {"type": "string", "required": True}, "params": {"type": "string", "required": False}, "tab_id": {"type": "string", "required": False}}},
    {"name": "js_confirm_result", "description": "表示中の confirm ダイアログを CDP 経由で操作する",
     "parameters": {"accept": {"type": "boolean", "required": False, "default": True}, "dialog_wait": {"type": "number", "required": False, "default": 0.0}, "tab_id": {"type": "string", "required": False}}},
    {"name": "js_alert_result", "description": "表示中の alert ダイアログを CDP 経由で閉じる",
     "parameters": {"dialog_wait": {"type": "number", "required": False, "default": 0.0}, "tab_id": {"type": "string", "required": False}}},
    {"name": "js_install_dialog_override", "description": "window.confirm/alert/prompt をオーバーライドする", "parameters": {"tab_id": {"type": "string", "required": False}}},
    {"name": "js_set_confirm_result", "description": "次の confirm() が返す値を事前設定する",
     "parameters": {"accept": {"type": "boolean", "required": False, "default": True}, "tab_id": {"type": "string", "required": False}}},
    {"name": "js_get_dialog_state", "description": "最後に呼ばれたダイアログの情報を取得する", "parameters": {"tab_id": {"type": "string", "required": False}}},
]

# 全メソッド共通: session パラメータ（セッションごとに独立した Chrome を使う）
_SESSION_PARAM = {
    "type": "string", "required": False, "default": "default",
    "description": "Chrome セッション名（自由な文字列）。セッションごとに独立した Chrome（ポート・プロファイル）を使う。標準は 'default' で通常は指定不要。指定時は Chrome が複数メモリ常駐となるため、使用後は close_session で破棄を忘れずに行うこと",
}
for _m in _CHROME_DEVTOOLS_METHODS:
    _m["parameters"] = {"session": _SESSION_PARAM, **_m["parameters"]}

# セッション管理メソッド
_CHROME_DEVTOOLS_METHODS += [
    {"name": "open_session", "description": "セッションの Chrome を起動する（未登録なら新規割り当て。headless 指定可）",
     "parameters": {"session": _SESSION_PARAM, "headless": {"type": "boolean", "required": False, "default": False, "description": "True で画面なし起動（--headless=new, 1920x1080）。稼働中の Chrome には次回起動から反映"}, "show_automation_banner": {"type": "boolean", "required": False, "default": True}}},
    {"name": "list_sessions", "description": "登録済み Chrome セッションの一覧（稼働状態付き）を取得する", "parameters": {}},
    {"name": "close_session", "description": "セッションの Chrome を停止する（対応表・プロファイルは残るため同名で再開できる）",
     "parameters": {"session": _SESSION_PARAM}},
    {"name": "delete_session", "description": "セッションを削除する（Chrome 停止 + 対応表から除去。プロファイルは残る）",
     "parameters": {"session": {"type": "string", "required": True, "description": "削除するセッション名"}}},
]


# ------------------------------------------------------------------ #
# MCP ツール登録
# ------------------------------------------------------------------ #

def _new_tab_response(result, url):
    """通常Chromeの応答を維持し、Browserブリッジが返した接続先だけを追加する。"""
    result = result if isinstance(result, dict) else {}
    response = {"id": result.get("targetId", ""), "url": url}
    if isinstance(result.get("session"), str) and result["session"]:
        response["session"] = result["session"]
    return response


def register_tools(mcp, registry):
    """aidiy_chrome_devtools MCP ツールを mcp インスタンスに登録する。
    HTTP ルートでも使える _ensure_chrome コルーチンを返す。"""

    startup_locks: dict[str, asyncio.Lock] = {}

    async def _ensure_chrome(
        show_automation_banner: Optional[bool] = None,
        session: str = "default",
        headless: Optional[bool] = None,
        launch_url: Optional[str] = None,
    ):
        """セッションの Chrome を確保して CDPClient を返す（未起動なら起動）

        launch_url を渡すと、Chrome の起動引数として URL を指定する。
        --autoplay-policy などの起動引数はプロセス単位でしか効かないため、
        音声つき自動再生を確実にしたいページはこちらで開く。
        """
        session = session or "default"

        # ウォームパス: 疎通確認 TTL が有効な間はロック・スレッド往復を使わず
        # 即座に返す（peek/is_verified はどちらも HTTP を伴わない軽量チェック）。
        # launch_url 指定時は URL を開く必要があるため、ウォームパスは使わない。
        if headless is None and launch_url is None:
            cached = registry.peek(session)
            if cached is not None and cached[0].is_verified():
                return cached[1]

        lock = startup_locks.setdefault(session, asyncio.Lock())
        async with lock:
            # セッション表の確認には CDP の同期 HTTP 疎通が含まれる場合がある。
            # FastAPI / MCP のイベントループを止めないよう全体をスレッドへ逃がす。
            chrome, cdp = await asyncio.to_thread(
                registry.get,
                session,
                headless,
            )
            await asyncio.to_thread(
                chrome.ensure_running,
                show_automation_banner=show_automation_banner,
                url=launch_url,
            )
        return cdp

    # ナビゲーション

    @mcp.tool()
    async def navigate(
        session: str = "default",
        *,
        url: str,
        tab_id: Optional[str] = None,
        show_automation_banner: bool = True,
    ) -> str:
        """
        指定URLへ移動する。戻り値に readyState を含むため、続けて操作してよいか
        その場で判断できる（多くの場合 wait_for_load の呼び出しは不要）。

        Args:
            show_automation_banner: Chrome 未起動時の自動起動で「自動操作中」の帯を表示する。
                                    省略時は True。
        """
        cdp = await _ensure_chrome(show_automation_banner=show_automation_banner, session=session)
        result = await cdp.navigate(url, tab_id)
        return json.dumps({"result": result}, ensure_ascii=False)

    @mcp.tool()
    async def launch_url(
        session: str = "default",
        *,
        url: str,
        show_automation_banner: bool = True,
    ) -> str:
        """
        URL を Chrome の起動引数として渡して開く。

        navigate は起動済み Chrome の既存タブを遷移させるだけなので、
        --autoplay-policy=no-user-gesture-required のようなプロセス単位の
        起動引数が効いていない Chrome に当たると音声つき自動再生が始まらない。
        音声つきで再生させたいページはこちらで開く。

        Chrome が未起動なら起動引数として URL を渡して起動し、
        起動済みなら同じプロファイルへ新しいタブとして開く。
        """
        await _ensure_chrome(
            show_automation_banner=show_automation_banner,
            session=session,
            launch_url=url,
        )
        return json.dumps({"result": f"起動引数で開きました: {url}"}, ensure_ascii=False)

    @mcp.tool()
    async def reload(session: str = "default", tab_id: Optional[str] = None) -> str:
        """現在のページをリロードする（戻り値に readyState を含む）"""
        cdp = await _ensure_chrome(session=session)
        result = await cdp.reload(tab_id)
        return json.dumps({"result": result}, ensure_ascii=False)

    @mcp.tool()
    async def go_back(session: str = "default", tab_id: Optional[str] = None) -> str:
        """ブラウザの戻るボタン相当"""
        cdp = await _ensure_chrome(session=session)
        result = await cdp.go_back(tab_id)
        return json.dumps({"result": result}, ensure_ascii=False)

    @mcp.tool()
    async def go_forward(session: str = "default", tab_id: Optional[str] = None) -> str:
        """ブラウザの進むボタン相当"""
        cdp = await _ensure_chrome(session=session)
        result = await cdp.go_forward(tab_id)
        return json.dumps({"result": result}, ensure_ascii=False)

    # ページ情報取得

    @mcp.tool()
    async def screenshot(
        session: str = "default",
        tab_id: Optional[str] = None,
        full_page: bool = False,
        save_path: Optional[str] = None,
        shutter_sounds: str = "none",
    ) -> list:
        """
        スクリーンショットを撮る（PNG画像）。

        Args:
            save_path: 保存先。フォルダ指定なら yyyymmdd.hhmmss.png で保存。
                       ファイル指定なら指定ファイルに保存。省略時は保存しない。
            shutter_sounds: "auto" でシャッター音を再生（Windows のみ）。デフォルト "none"
        """
        cdp = await _ensure_chrome(session=session)
        data, saved_path = await cdp.screenshot(
            tab_id=tab_id, full_page=full_page, save_path=save_path, shutter_sounds=shutter_sounds
        )
        if saved_path:
            # save_path 指定時は base64 を返さない。保存先を読めば済むのに
            # 同じ画像を base64 でも返すと、呼び出し側の文脈が二重に膨らむため。
            logger.info(f"screenshot saved: {saved_path}")
            return [TextContent(
                type="text",
                text=json.dumps(ファイル応答(saved_path, "image/png"), ensure_ascii=False),
            )]
        return [ImageContent(type="image", data=data, mimeType="image/png")]

    @mcp.tool()
    async def get_page_info(session: str = "default", tab_id: Optional[str] = None) -> str:
        """ページのURL・タイトル・readyState などを取得する"""
        cdp = await _ensure_chrome(session=session)
        info = await cdp.get_page_info(tab_id)
        return json.dumps(info, ensure_ascii=False)

    @mcp.tool()
    async def get_html(session: str = "default", tab_id: Optional[str] = None) -> str:
        """ページ全体のHTMLを取得する"""
        cdp = await _ensure_chrome(session=session)
        result = await cdp.get_html(tab_id)
        return json.dumps({"result": result}, ensure_ascii=False)

    @mcp.tool()
    async def get_text(session: str = "default", tab_id: Optional[str] = None) -> str:
        """ページのテキストコンテンツを取得する"""
        cdp = await _ensure_chrome(session=session)
        result = await cdp.get_text(tab_id)
        return json.dumps({"result": result}, ensure_ascii=False)

    # JavaScript・DOM操作

    @mcp.tool()
    async def eval_js(session: str = "default", *, expression: str, tab_id: Optional[str] = None, await_promise: bool = False) -> str:
        """JavaScriptを実行して結果を返す"""
        cdp = await _ensure_chrome(session=session)
        result = await cdp.eval_js(expression, tab_id, await_promise)
        if isinstance(result, dict):
            return json.dumps(result, ensure_ascii=False)
        return json.dumps({"result": result}, ensure_ascii=False)

    @mcp.tool()
    async def click(session: str = "default", *, selector: str, tab_id: Optional[str] = None) -> str:
        """CSSセレクターで要素をクリックする"""
        cdp = await _ensure_chrome(session=session)
        result = await cdp.click(selector, tab_id)
        return json.dumps({"result": result}, ensure_ascii=False)

    @mcp.tool()
    async def type_text(session: str = "default", *, selector: str, text: str, tab_id: Optional[str] = None, clear_first: bool = True) -> str:
        """CSSセレクターで要素にテキストを入力する"""
        cdp = await _ensure_chrome(session=session)
        result = await cdp.type_text(selector, text, tab_id, clear_first)
        return json.dumps({"result": result}, ensure_ascii=False)

    @mcp.tool()
    async def scroll(session: str = "default", delta_x: int = 0, delta_y: int = 0, tab_id: Optional[str] = None, selector: Optional[str] = None) -> str:
        """ページまたは要素をスクロールする"""
        cdp = await _ensure_chrome(session=session)
        result = await cdp.scroll(delta_x, delta_y, tab_id, selector)
        return json.dumps({"result": result}, ensure_ascii=False)

    @mcp.tool()
    async def find_elements(session: str = "default", *, selector: str, tab_id: Optional[str] = None, limit: int = 20) -> str:
        """CSSセレクターで要素を検索してプロパティ一覧を返す"""
        cdp = await _ensure_chrome(session=session)
        result = await cdp.find_elements(selector, tab_id, limit)
        if isinstance(result, list):
            return json.dumps({"elements": result}, ensure_ascii=False)
        return json.dumps(result, ensure_ascii=False)

    # タブ管理

    @mcp.tool()
    async def list_tabs(session: str = "default") -> str:
        """開いているタブ一覧を取得する"""
        cdp = await _ensure_chrome(session=session)
        tabs = await asyncio.to_thread(cdp.list_tabs)
        return json.dumps({"tabs": tabs}, ensure_ascii=False)

    @mcp.tool()
    async def new_tab(
        session: str = "default",
        url: str = "about:blank",
        show_automation_banner: bool = True,
    ) -> str:
        """
        新規タブを開く。Browserでは応答のsessionとidを次の操作のsessionとtab_idに使う。

        Args:
            show_automation_banner: Chrome 未起動時の自動起動で「自動操作中」の帯を表示する。
                                    省略時は True。
        """
        cdp = await _ensure_chrome(show_automation_banner=show_automation_banner, session=session)
        browser_ws = await asyncio.to_thread(cdp.get_browser_ws_url)
        result = await cdp.send_command(browser_ws, "Target.createTarget", {"url": url})
        return json.dumps(_new_tab_response(result, url), ensure_ascii=False)

    @mcp.tool()
    async def close_tab(session: str = "default", *, tab_id: str) -> str:
        """指定タブを閉じる"""
        cdp = await _ensure_chrome(session=session)
        ok = await cdp.close_tab(tab_id)
        return json.dumps({"result": "閉じました" if ok else "失敗しました"}, ensure_ascii=False)

    @mcp.tool()
    async def activate_tab(session: str = "default", *, tab_id: str) -> str:
        """指定タブをアクティブにする"""
        cdp = await _ensure_chrome(session=session)
        ok = await asyncio.to_thread(cdp.activate_tab_sync, tab_id)
        return json.dumps({"result": "アクティブにしました" if ok else "失敗しました"}, ensure_ascii=False)

    # ビューポート・ロード待機

    @mcp.tool()
    async def set_viewport(session: str = "default", *, width: int, height: int, tab_id: Optional[str] = None) -> str:
        """ビューポートサイズを設定する"""
        cdp = await _ensure_chrome(session=session)
        result = await cdp.set_viewport(width, height, tab_id)
        return json.dumps({"result": result}, ensure_ascii=False)

    @mcp.tool()
    async def wait_for_load(session: str = "default", tab_id: Optional[str] = None, timeout: float = 10.0) -> str:
        """
        ページのロード完了を待つ（最大timeout秒）。
        navigate/reload の戻り値の readyState が 'complete' でない場合のみ使う。
        毎回呼ぶと遅くなるため多用しないこと。
        """
        cdp = await _ensure_chrome(session=session)
        result = await cdp.wait_for_load(tab_id, timeout)
        return json.dumps({"result": result}, ensure_ascii=False)

    # コンソール・ネットワークキャプチャ

    @mcp.tool()
    async def install_console_capture(session: str = "default", tab_id: Optional[str] = None) -> str:
        """コンソールログのキャプチャをページに設置する"""
        cdp = await _ensure_chrome(session=session)
        result = await cdp.install_console_capture(tab_id)
        return json.dumps({"result": result}, ensure_ascii=False)

    @mcp.tool()
    async def get_console_logs(session: str = "default", tab_id: Optional[str] = None, level: Optional[str] = None, limit: int = 50) -> str:
        """キャプチャされたコンソールログを取得する（事前にinstall_console_captureが必要）"""
        cdp = await _ensure_chrome(session=session)
        logs = await cdp.get_console_logs(tab_id, level, limit)
        return json.dumps({"logs": logs}, ensure_ascii=False)

    @mcp.tool()
    async def install_network_capture(session: str = "default", tab_id: Optional[str] = None) -> str:
        """XHR/fetchリクエストのキャプチャをページに設置する"""
        cdp = await _ensure_chrome(session=session)
        result = await cdp.install_network_capture(tab_id)
        return json.dumps({"result": result}, ensure_ascii=False)

    @mcp.tool()
    async def get_network_logs(session: str = "default", tab_id: Optional[str] = None, limit: int = 50) -> str:
        """キャプチャされたネットワークリクエストを取得する（事前にinstall_network_captureが必要）"""
        cdp = await _ensure_chrome(session=session)
        logs = await cdp.get_network_logs(tab_id, limit)
        return json.dumps({"logs": logs}, ensure_ascii=False)

    # ストレージ・Cookie

    @mcp.tool()
    async def get_cookies(session: str = "default", tab_id: Optional[str] = None) -> str:
        """ページのCookieを取得する"""
        cdp = await _ensure_chrome(session=session)
        cookies = await cdp.get_cookies(tab_id)
        return json.dumps({"cookies": cookies}, ensure_ascii=False)

    @mcp.tool()
    async def get_local_storage(session: str = "default", tab_id: Optional[str] = None) -> str:
        """localStorageの内容を取得する"""
        cdp = await _ensure_chrome(session=session)
        data = await cdp.get_local_storage(tab_id)
        return json.dumps(data, ensure_ascii=False)

    @mcp.tool()
    async def get_session_storage(session: str = "default", tab_id: Optional[str] = None) -> str:
        """sessionStorageの内容を取得する"""
        cdp = await _ensure_chrome(session=session)
        data = await cdp.get_session_storage(tab_id)
        return json.dumps(data, ensure_ascii=False)

    @mcp.tool()
    async def get_current_url(session: str = "default", tab_id: Optional[str] = None) -> str:
        """現在のURLを取得する"""
        cdp = await _ensure_chrome(session=session)
        url = await cdp.get_current_url(tab_id)
        return json.dumps({"url": url}, ensure_ascii=False)

    @mcp.tool()
    async def get_title(session: str = "default", tab_id: Optional[str] = None) -> str:
        """ページタイトルを取得する"""
        cdp = await _ensure_chrome(session=session)
        title = await cdp.get_title(tab_id)
        return json.dumps({"title": title}, ensure_ascii=False)

    @mcp.tool()
    async def scroll_to_element(session: str = "default", *, selector: str, tab_id: Optional[str] = None) -> str:
        """要素が見えるようにスクロールする"""
        cdp = await _ensure_chrome(session=session)
        result = await cdp.scroll_to_element(selector, tab_id)
        return json.dumps({"result": result}, ensure_ascii=False)

    @mcp.tool()
    async def clear_console_logs(session: str = "default", tab_id: Optional[str] = None) -> str:
        """キャプチャされたコンソールログをクリアする"""
        cdp = await _ensure_chrome(session=session)
        result = await cdp.clear_console_logs(tab_id)
        return json.dumps({"result": result}, ensure_ascii=False)

    @mcp.tool()
    async def clear_network_logs(session: str = "default", tab_id: Optional[str] = None) -> str:
        """キャプチャされたネットワークログをクリアする"""
        cdp = await _ensure_chrome(session=session)
        result = await cdp.clear_network_logs(tab_id)
        return json.dumps({"result": result}, ensure_ascii=False)

    @mcp.tool()
    async def get_resource_timing(session: str = "default", tab_id: Optional[str] = None, limit: int = 30) -> str:
        """Performance APIからリソースタイミング情報を取得する"""
        cdp = await _ensure_chrome(session=session)
        data = await cdp.get_resource_timing(tab_id, limit)
        return json.dumps({"timing": data}, ensure_ascii=False)

    @mcp.tool()
    async def get_version(session: str = "default") -> str:
        """ChromeのバージョンとUserAgent情報を取得する"""
        cdp = await _ensure_chrome(session=session)
        data = await asyncio.to_thread(cdp.get_version)
        return json.dumps(data, ensure_ascii=False)

    @mcp.tool()
    async def cdp_command(session: str = "default", *, method: str, params: Optional[str] = None, tab_id: Optional[str] = None) -> str:
        """
        Chrome DevTools Protocol (CDP) コマンドを直接送信する。
        既存ツールでカバーされない高度な操作に使用する。

        Args:
            method: CDP メソッド名 (例: "Page.printToPDF", "Network.setExtraHTTPHeaders")
            params: JSON 文字列形式のパラメータ (例: '{"landscape": true}')
            tab_id: 対象タブID (省略時は最初のタブ)。
                    "browser" を指定するとブラウザレベルの WebSocket を使用する
                    (Browser.* / Target.* / SystemInfo.* 等のコマンドに必要)。
        """
        cdp = await _ensure_chrome(session=session)
        parsed_params: dict = {}
        if params:
            if isinstance(params, dict):
                parsed_params = params
            else:
                stripped = params.strip()
                if stripped:
                    loaded = json.loads(stripped)
                    if not isinstance(loaded, dict):
                        raise ValueError(
                            "params は JSON オブジェクトである必要があります (例: '{\"accept\": true}')"
                        )
                    parsed_params = loaded
        if tab_id == "browser":
            ws_url = await asyncio.to_thread(cdp.get_browser_ws_url)
        else:
            tab = await asyncio.to_thread(cdp.resolve_tab, tab_id)
            ws_url = cdp.get_ws_url(tab)
        result = await cdp.send_command(ws_url, method, parsed_params)
        return json.dumps(result, ensure_ascii=False)

    # ダイアログ操作

    @mcp.tool()
    async def js_confirm_result(
        session: str = "default",
        accept: bool = True,
        dialog_wait: float = 0.0,
        tab_id: Optional[str] = None,
    ) -> str:
        """
        現在表示中の confirm ダイアログを CDP 経由で操作する。

        Args:
            accept: True=OK（確認）、False=キャンセル
            dialog_wait: ダイアログが表示されるまで待機する最大秒数（デフォルト0=即時応答）。
            tab_id: 対象タブID（省略時は最初のタブ）
        """
        cdp = await _ensure_chrome(session=session)
        result = await cdp.handle_dialog(accept, "", tab_id, dialog_wait)
        return json.dumps({"result": result}, ensure_ascii=False)

    @mcp.tool()
    async def js_alert_result(
        session: str = "default",
        dialog_wait: float = 0.0,
        tab_id: Optional[str] = None,
    ) -> str:
        """
        現在表示中の alert ダイアログを CDP 経由で閉じる。

        Args:
            dialog_wait: ダイアログが表示されるまで待機する最大秒数（デフォルト0=即時応答）。
            tab_id: 対象タブID（省略時は最初のタブ）
        """
        cdp = await _ensure_chrome(session=session)
        result = await cdp.handle_dialog(True, "", tab_id, dialog_wait)
        return json.dumps({"result": result}, ensure_ascii=False)

    @mcp.tool()
    async def js_install_dialog_override(session: str = "default", tab_id: Optional[str] = None) -> str:
        """
        window.confirm/alert/prompt をオーバーライドし、ネイティブダイアログの表示をブロックしない形に変更する。

        Args:
            tab_id: 対象タブID（省略時は最初のタブ）
        """
        cdp = await _ensure_chrome(session=session)
        result = await cdp.install_dialog_override(tab_id)
        return json.dumps({"result": result}, ensure_ascii=False)

    @mcp.tool()
    async def js_set_confirm_result(session: str = "default", accept: bool = True, tab_id: Optional[str] = None) -> str:
        """
        次の confirm() 呼び出しが返す値を設定する（js_install_dialog_override が必要）。

        Args:
            accept: True=OK（確認）、False=キャンセル
            tab_id: 対象タブID（省略時は最初のタブ）
        """
        cdp = await _ensure_chrome(session=session)
        result = await cdp.set_confirm_result(accept, tab_id)
        return json.dumps({"result": result}, ensure_ascii=False)

    @mcp.tool()
    async def js_get_dialog_state(session: str = "default", tab_id: Optional[str] = None) -> str:
        """
        最後に呼ばれたダイアログの情報を取得する（js_install_dialog_override が必要）。

        Args:
            tab_id: 対象タブID（省略時は最初のタブ）
        """
        cdp = await _ensure_chrome(session=session)
        state = await cdp.get_dialog_state(tab_id)
        return json.dumps(state, ensure_ascii=False)

    # セッション管理

    @mcp.tool()
    async def open_session(
        session: str = "default",
        headless: bool = False,
        show_automation_banner: bool = True,
    ) -> str:
        """
        セッションの Chrome を起動する（未登録なら新規割り当て）。

        Args:
            session: セッション名（自由な文字列。プロジェクト名・プログラム名など）
            headless: True で画面なし起動（--headless=new, 1920x1080）。
                      稼働中の Chrome には次回起動から反映。
            show_automation_banner: 「自動操作中」の帯を表示する。省略時は True。
        """
        await _ensure_chrome(
            show_automation_banner=show_automation_banner,
            session=session,
            headless=headless,
        )
        sessions = await asyncio.to_thread(registry.list)
        info = next((s for s in sessions if s["session"] == session), None)
        return json.dumps({"result": "起動しました", "session": info}, ensure_ascii=False)

    @mcp.tool()
    async def list_sessions() -> str:
        """登録済み Chrome セッションの一覧（稼働状態付き）を取得する"""
        sessions = await asyncio.to_thread(registry.list)
        return json.dumps({"sessions": sessions}, ensure_ascii=False)

    @mcp.tool()
    async def close_session(session: str = "default") -> str:
        """セッションの Chrome を停止する（対応表・プロファイルは残るため同名で再開できる）"""
        ok = await asyncio.to_thread(registry.close, session)
        return json.dumps({"result": "停止しました" if ok else "稼働していません"}, ensure_ascii=False)

    @mcp.tool()
    async def delete_session(session: str) -> str:
        """セッションを削除する（Chrome 停止 + 対応表から除去。プロファイルは残る）"""
        ok = await asyncio.to_thread(registry.delete, session)
        return json.dumps({"result": "削除しました" if ok else "見つかりません"}, ensure_ascii=False)

    # 旧 chrome-devtools-mcp (Node.js版) との互換エイリアス

    @mcp.tool()
    async def new_page(session: str = "default", url: str = "about:blank", show_automation_banner: bool = True) -> str:
        """新規タブを開く（new_tab の別名）。Browserでは応答のsessionとidを次の操作のsessionとtab_idに使う。"""
        return await new_tab(session=session, url=url, show_automation_banner=show_automation_banner)

    @mcp.tool()
    async def close_page(session: str = "default", *, tab_id: str) -> str:
        """指定タブを閉じる（close_tab の別名）"""
        return await close_tab(session=session, tab_id=tab_id)

    @mcp.tool()
    async def list_pages(session: str = "default") -> str:
        """開いているタブ一覧を取得する（list_tabs の別名）"""
        return await list_tabs(session)

    @mcp.tool()
    async def click_element(session: str = "default", *, selector: str, tab_id: Optional[str] = None) -> str:
        """CSSセレクターで要素をクリックする（click の別名）"""
        return await click(session=session, selector=selector, tab_id=tab_id)

    @mcp.tool()
    async def fill(session: str = "default", *, selector: str, value: str, tab_id: Optional[str] = None) -> str:
        """CSSセレクターで要素にテキストを入力する（type_text の別名）"""
        return await type_text(session=session, selector=selector, text=value, tab_id=tab_id)

    @mcp.tool()
    async def evaluate(session: str = "default", *, expression: str, tab_id: Optional[str] = None) -> str:
        """JavaScriptを実行して結果を返す（eval_js の別名）"""
        return await eval_js(session=session, expression=expression, tab_id=tab_id)

    @mcp.tool()
    async def get_page_content(session: str = "default", tab_id: Optional[str] = None) -> str:
        """ページのテキストコンテンツを取得する（get_text の別名）"""
        return await get_text(session=session, tab_id=tab_id)

    return _ensure_chrome


# ------------------------------------------------------------------ #
# HTTP ルート
# ------------------------------------------------------------------ #

def create_router(registry, _ensure_chrome) -> APIRouter:
    """Chrome DevTools HTTP APIRouter を作成して返す"""
    router = APIRouter(tags=["aidiy_chrome_devtools"])

    @router.get("/aidiy_chrome_devtools/docs", summary="aidiy_chrome_devtools ドキュメント")
    async def http_chrome_devtools_docs() -> dict:
        """aidiy_chrome_devtools の詳細 API ドキュメント（AI 向け）"""
        return {
            "service": "aidiy_chrome_devtools",
            "description": "Chrome DevTools Protocol (CDP) を使い Chrome ブラウザを遠隔操作する。Chrome 未起動時は自動起動する。",
            "endpoint": "POST /aidiy_chrome_devtools/{method_name}",
            "content_type": "application/json",
            "how_to_call": "method_name を URL パスに指定し、JSON body に各メソッドのパラメータをフラットに渡す。tab_id を省略すると最初のタブを使用する。session を省略すると 'default' セッション（従来の Chrome）を使用する。",
            "tab_id": {
                "description": "省略または 'auto' 指定で、セッション内で一度解決したタブ（自動解決タブ）を再利用する。毎回タブ一覧を取得し直さないため高速。タブを閉じる/切り替える操作をした場合は次回呼び出しで自動的に再解決される。複数タブを明示的に使い分けたい場合のみ list_tabs で取得した id を指定する。",
            },
            "sessions": {
                "description": "session パラメータ（自由な文字列）ごとに独立した Chrome（ポート・プロファイル）を起動・管理する。並行実行（自動テスト等）は session を分けることで互いに干渉しない。",
                "default": "標準は 'default' で通常は指定不要（省略時はポート 9222 + 従来プロファイルで後方互換）",
                "caution": "session を指定すると Chrome セッションが複数メモリ常駐となる。使い終わったら close_session で破棄を忘れずに行うこと。",
                "management": "open_session（headless 指定可）/ list_sessions / close_session / delete_session",
            },
            "aliases": {
                "new_page": "new_tab と同義",
                "close_page": "close_tab と同義",
                "list_pages": "list_tabs と同義",
                "click_element": "click と同義",
                "fill": "type_text と同義",
                "evaluate": "eval_js と同義",
                "get_page_content": "get_text と同義",
            },
            "methods": {
                m["name"]: {k: v for k, v in m.items() if k != "name"}
                for m in _CHROME_DEVTOOLS_METHODS
            },
            "example_requests": {
                "list_tabs": {},
                "navigate": {"url": "http://127.0.0.1:8090"},
                "navigate (別セッション)": {"url": "http://127.0.0.1:8090", "session": "自動テストA"},
                "open_session": {"session": "自動テストA", "headless": True},
                "list_sessions": {},
                "close_session": {"session": "自動テストA"},
                "delete_session": {"session": "自動テストA"},
                "reload": {},
                "go_back": {},
                "screenshot": {"full_page": False, "shutter_sounds": "none"},
                "get_page_info": {},
                "get_html": {},
                "get_text": {},
                "get_current_url": {},
                "get_title": {},
                "eval_js": {"expression": "document.title"},
                "click": {"selector": "#submit-btn"},
                "type_text": {"selector": "#username", "text": "admin", "clear_first": True},
                "scroll": {"delta_x": 0, "delta_y": 500},
                "scroll_to_element": {"selector": ".footer"},
                "find_elements": {"selector": "button", "limit": 20},
                "set_viewport": {"width": 1280, "height": 720},
                "wait_for_load": {"timeout": 10.0},
                "new_tab": {"url": "https://example.com"},
                "close_tab": {"tab_id": "<list_tabs で取得した id>"},
                "activate_tab": {"tab_id": "<list_tabs で取得した id>"},
                "install_console_capture": {},
                "get_console_logs": {"level": "error", "limit": 50},
                "clear_console_logs": {},
                "install_network_capture": {},
                "get_network_logs": {"limit": 50},
                "clear_network_logs": {},
                "get_cookies": {},
                "get_local_storage": {},
                "get_session_storage": {},
                "get_resource_timing": {"limit": 30},
                "get_version": {},
                "cdp_command": {"cdp_method": "Page.printToPDF", "params": "{\"landscape\": false}", "tab_id": None},
                "js_confirm_result": {"accept": True, "dialog_wait": 3.0},
                "js_alert_result": {"dialog_wait": 3.0},
                "js_install_dialog_override": {},
                "js_set_confirm_result": {"accept": True},
                "js_get_dialog_state": {},
            },
            "response_fields": {
                "navigate / reload": {"result": "完了メッセージ（readyState を含む。'complete' でなければ必要な場合のみ wait_for_load を使う）"},
                "go_back / go_forward": {"result": "成功=True または完了メッセージ"},
                "screenshot": {"type": "image", "data": "PNG の base64 文字列", "mimeType": "image/png", "（save_path 指定時）": {"type": "file", "save_path": "保存先パス", "mimeType": "image/png"}},
                "get_page_info": {"url": "現在の URL", "title": "ページタイトル", "readyState": "complete / loading / interactive"},
                "get_html": {"result": "ページ HTML 全文"},
                "get_text / get_page_content": {"result": "ページ内テキスト"},
                "get_current_url": {"url": "現在の URL 文字列"},
                "get_title": {"title": "ページタイトル文字列"},
                "get_version": {"Browser": "Chrome バージョン文字列", "User-Agent": "UserAgent 文字列"},
                "eval_js / evaluate": {"result": "JS の実行結果（型は JS の戻り値に依存）"},
                "click / click_element": {"result": "成功メッセージ"},
                "type_text / fill": {"result": "成功メッセージ"},
                "scroll / scroll_to_element": {"result": "成功メッセージ"},
                "find_elements": {"elements": "配列 [{tag, id, class, text, selector, ...}, ...]"},
                "set_viewport / wait_for_load": {"result": "成功メッセージ"},
                "list_tabs / list_pages": {"tabs": "配列 [{id, url, title, webSocketDebuggerUrl}, ...]"},
                "new_tab / new_page": {"id": "新しいタブの targetId（次の操作の tab_id）", "url": "開いた URL", "session（Browserのみ）": "新しいタブの接続先。次の操作に指定する。元のsessionは切り替わらない"},
                "close_tab / activate_tab": {"result": "成功メッセージ"},
                "install_console_capture / install_network_capture": {"result": "成功メッセージ"},
                "get_console_logs": {"logs": "配列 [{level, message, timestamp}, ...]"},
                "get_network_logs": {"logs": "配列 [{method, url, status, timing, ...}, ...]"},
                "clear_console_logs / clear_network_logs": {"result": "成功メッセージ"},
                "get_resource_timing": {"timing": "配列 [{name, duration, initiatorType, ...}, ...]"},
                "get_cookies": {"cookies": "配列 [{name, value, domain, path, expires, ...}, ...]"},
                "get_local_storage / get_session_storage": "キー=値 の dict（localStorage / sessionStorage の全エントリ）",
                "js_confirm_result / js_alert_result / js_install_dialog_override / js_set_confirm_result": {"result": "成功メッセージ"},
                "js_get_dialog_state": {"type": "alert / confirm / prompt / none", "message": "ダイアログメッセージ"},
                "cdp_command": "CDP から返ってくる JSON dict（コマンドにより異なる）",
                "open_session": {"result": "成功メッセージ", "session": "{session, key, port, headless, running, profile_dir}"},
                "list_sessions": {"sessions": "配列 [{session, key, port, headless, running, profile_dir}, ...]"},
                "close_session / delete_session": {"result": "成功メッセージ"},
            },
        }

    @router.post("/aidiy_chrome_devtools/{method_name}", summary="Chrome DevTools 全機能 HTTP API")
    async def http_chrome_devtools(method_name: str, req: ChromeDevToolsRequest = ChromeDevToolsRequest()) -> dict:
        """aidiy_chrome_devtools の全機能を HTTP POST で呼び出す。"""
        try:
            # セッション管理メソッドは Chrome を起動せずに処理する
            if method_name == "list_sessions":
                sessions = await asyncio.to_thread(registry.list)
                return {"sessions": sessions}
            elif method_name == "close_session":
                ok = await asyncio.to_thread(registry.close, req.session)
                return {"result": "停止しました" if ok else "稼働していません"}
            elif method_name == "delete_session":
                ok = await asyncio.to_thread(registry.delete, req.session)
                return {"result": "削除しました" if ok else "見つかりません"}

            if method_name == "launch_url":
                # URL を起動引数として渡す。navigate と違い既存タブの遷移ではないため、
                # --autoplay-policy などプロセス単位の起動引数が確実に効く。
                await _ensure_chrome(
                    show_automation_banner=req.show_automation_banner,
                    session=req.session,
                    headless=req.headless,
                    launch_url=req.url or "about:blank",
                )
                return {"result": f"起動引数で開きました: {req.url or 'about:blank'}"}

            if method_name in ("navigate", "new_tab", "new_page", "open_session"):
                cdp = await _ensure_chrome(
                    show_automation_banner=req.show_automation_banner,
                    session=req.session,
                    headless=req.headless,
                )
            else:
                cdp = await _ensure_chrome(session=req.session)

            if method_name == "open_session":
                sessions = await asyncio.to_thread(registry.list)
                info = next((s for s in sessions if s["session"] == req.session), None)
                return {"result": "起動しました", "session": info}
            elif method_name == "navigate":
                result = await cdp.navigate(req.url or "about:blank", req.tab_id)
                return {"result": result}
            elif method_name == "reload":
                result = await cdp.reload(req.tab_id)
                return {"result": result}
            elif method_name == "go_back":
                result = await cdp.go_back(req.tab_id)
                return {"result": result}
            elif method_name == "go_forward":
                result = await cdp.go_forward(req.tab_id)
                return {"result": result}
            elif method_name == "screenshot":
                data, saved_path = await cdp.screenshot(tab_id=req.tab_id, full_page=req.full_page, save_path=req.save_path, shutter_sounds=req.shutter_sounds)
                if saved_path:
                    return ファイル応答(saved_path, "image/png")
                return {"type": "image", "data": data, "mimeType": "image/png"}
            elif method_name == "get_page_info":
                info = await cdp.get_page_info(req.tab_id)
                return info if isinstance(info, dict) else {"result": info}
            elif method_name == "get_html":
                result = await cdp.get_html(req.tab_id)
                return {"result": result}
            elif method_name in ("get_text", "get_page_content"):
                result = await cdp.get_text(req.tab_id)
                return {"result": result}
            elif method_name in ("eval_js", "evaluate"):
                result = await cdp.eval_js(req.expression or "", req.tab_id, req.await_promise)
                return result if isinstance(result, dict) else {"result": result}
            elif method_name in ("click", "click_element"):
                result = await cdp.click(req.selector or "", req.tab_id)
                return {"result": result}
            elif method_name in ("type_text", "fill"):
                result = await cdp.type_text(req.selector or "", req.text or req.value or "", req.tab_id, req.clear_first)
                return {"result": result}
            elif method_name == "scroll":
                result = await cdp.scroll(req.delta_x, req.delta_y, req.tab_id, req.selector)
                return {"result": result}
            elif method_name == "scroll_to_element":
                result = await cdp.scroll_to_element(req.selector or "", req.tab_id)
                return {"result": result}
            elif method_name == "find_elements":
                result = await cdp.find_elements(req.selector or "", req.tab_id, req.limit)
                return {"elements": result} if isinstance(result, list) else (result if isinstance(result, dict) else {"result": result})
            elif method_name in ("list_tabs", "list_pages"):
                tabs = await asyncio.to_thread(cdp.list_tabs)
                return {"tabs": tabs}
            elif method_name in ("new_tab", "new_page"):
                browser_ws = await asyncio.to_thread(cdp.get_browser_ws_url)
                result = await cdp.send_command(browser_ws, "Target.createTarget", {"url": req.url or "about:blank"})
                return _new_tab_response(result, req.url or "about:blank")
            elif method_name in ("close_tab", "close_page"):
                ok = await cdp.close_tab(req.tab_id or "")
                return {"result": "閉じました" if ok else "失敗しました"}
            elif method_name == "activate_tab":
                ok = await asyncio.to_thread(cdp.activate_tab_sync, req.tab_id or "")
                return {"result": "アクティブにしました" if ok else "失敗しました"}
            elif method_name == "set_viewport":
                result = await cdp.set_viewport(req.width or 1280, req.height or 720, req.tab_id)
                return {"result": result}
            elif method_name == "wait_for_load":
                result = await cdp.wait_for_load(req.tab_id, req.timeout)
                return {"result": result}
            elif method_name == "install_console_capture":
                result = await cdp.install_console_capture(req.tab_id)
                return {"result": result}
            elif method_name == "get_console_logs":
                logs = await cdp.get_console_logs(req.tab_id, req.level, req.limit)
                return {"logs": logs}
            elif method_name == "clear_console_logs":
                result = await cdp.clear_console_logs(req.tab_id)
                return {"result": result}
            elif method_name == "install_network_capture":
                result = await cdp.install_network_capture(req.tab_id)
                return {"result": result}
            elif method_name == "get_network_logs":
                logs = await cdp.get_network_logs(req.tab_id, req.limit)
                return {"logs": logs}
            elif method_name == "clear_network_logs":
                result = await cdp.clear_network_logs(req.tab_id)
                return {"result": result}
            elif method_name == "get_cookies":
                cookies = await cdp.get_cookies(req.tab_id)
                return {"cookies": cookies}
            elif method_name == "get_local_storage":
                data = await cdp.get_local_storage(req.tab_id)
                return data if isinstance(data, dict) else {"result": data}
            elif method_name == "get_session_storage":
                data = await cdp.get_session_storage(req.tab_id)
                return data if isinstance(data, dict) else {"result": data}
            elif method_name == "get_current_url":
                result = await cdp.get_current_url(req.tab_id)
                return {"url": result}
            elif method_name == "get_title":
                result = await cdp.get_title(req.tab_id)
                return {"title": result}
            elif method_name == "get_resource_timing":
                data = await cdp.get_resource_timing(req.tab_id, req.limit)
                return {"timing": data}
            elif method_name == "get_version":
                data = await asyncio.to_thread(cdp.get_version)
                return data if isinstance(data, dict) else {"result": data}
            elif method_name == "cdp_command":
                cdp_method_name = req.cdp_method or ""
                parsed_params: dict = {}
                if req.params:
                    stripped = req.params.strip()
                    if stripped:
                        loaded = json.loads(stripped)
                        if isinstance(loaded, dict):
                            parsed_params = loaded
                if req.tab_id == "browser":
                    ws_url = await asyncio.to_thread(cdp.get_browser_ws_url)
                else:
                    tab = await asyncio.to_thread(cdp.resolve_tab, req.tab_id)
                    ws_url = cdp.get_ws_url(tab)
                result = await cdp.send_command(ws_url, cdp_method_name, parsed_params)
                return result if isinstance(result, dict) else {"result": result}
            elif method_name == "js_confirm_result":
                result = await cdp.handle_dialog(req.accept, "", req.tab_id, req.dialog_wait)
                return {"result": result}
            elif method_name == "js_alert_result":
                result = await cdp.handle_dialog(True, "", req.tab_id, req.dialog_wait)
                return {"result": result}
            elif method_name == "js_install_dialog_override":
                result = await cdp.install_dialog_override(req.tab_id)
                return {"result": result}
            elif method_name == "js_set_confirm_result":
                result = await cdp.set_confirm_result(req.accept, req.tab_id)
                return {"result": result}
            elif method_name == "js_get_dialog_state":
                state = await cdp.get_dialog_state(req.tab_id)
                return state if isinstance(state, dict) else {"result": state}
            else:
                return {"error": f"未知のメソッド: {method_name}"}

        except Exception as e:
            logger.warning(f"http_chrome_devtools [{method_name}] error: {e}")
            return {"error": str(e)}

    return router
