# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""
Chrome DevTools Protocol (CDP) クライアント

Chrome を --remote-debugging-port=9222 で起動した状態で使用する。
起動例:
  chrome --remote-debugging-port=9222
  chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-debug
"""

import asyncio
import base64
import io
import json
import logging
import os
import time
import urllib.request
import urllib.error
import urllib.parse
from datetime import datetime
from typing import Any, Optional

from PIL import Image as _PILImage
import websockets
from websockets.exceptions import WebSocketException

from tools_proc.desktop_capture import DesktopCapture


_LOOPBACK_HOST = "127.0.0.1"
_NO_PROXY_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))
logger = logging.getLogger(__name__)


def _normalize_loopback_ws_url(ws_url: str) -> str:
    """Chrome が返す localhost の WebSocket URL を IPv4 loopback へ固定する。"""
    parsed = urllib.parse.urlsplit(ws_url)
    if parsed.hostname != "localhost":
        return ws_url

    port = f":{parsed.port}" if parsed.port is not None else ""
    return urllib.parse.urlunsplit(
        (parsed.scheme, f"{_LOOPBACK_HOST}{port}", parsed.path, parsed.query, parsed.fragment)
    )


class ChromeDevToolsError(Exception):
    """CDP 接続・操作エラー"""
    pass


class ChromeDevToolsTimeoutError(ChromeDevToolsError):
    """CDP コマンドが制限時間内に応答しなかった場合の操作エラー。"""
    pass


class CDPClient:
    """
    Chrome DevTools Protocol (CDP) クライアント

    各メソッドは CDP の HTTP エンドポイントまたは WebSocket を介して
    Chrome を操作する。WebSocket 接続はターゲット URL ごとに再利用し、
    同一ターゲットへのコマンドは順番に処理する。
    """

    def __init__(self, host: str = _LOOPBACK_HOST, port: int = 9222):
        self.host = host
        self.port = port
        self._ws_connections: dict[str, Any] = {}
        self._ws_locks: dict[str, asyncio.Lock] = {}
        self._connection_loop: Optional[asyncio.AbstractEventLoop] = None
        self._command_id = 0
        # tab_id 省略時 (= "auto") に解決したタブをセッション内で使い回すキャッシュ。
        # 呼び出しのたびに /json でタブ一覧を取得し直すコストを避ける。
        self._auto_tab: Optional[dict] = None
        # WebSocket 接続エラー発生時に呼ぶコールバック（ChromeManager.mark_unreachable
        # をセッション登録時に紐付け、疎通確認 TTL を即時失効させて再確認させる）。
        self._on_unreachable: Optional[Any] = None

    # ------------------------------------------------------------------ #
    # 内部ヘルパー
    # ------------------------------------------------------------------ #

    def _http_get(self, path: str, *, parse_json: bool = True) -> Any:
        """Chrome DevTools HTTP エンドポイントに GET リクエスト。"""
        url = f"http://{self.host}:{self.port}{path}"
        try:
            # OS のシステムプロキシは loopback CDP 通信に不要。Windows では
            # 127.0.0.1 が proxy bypass 対象外となり、5秒タイムアウトする場合がある。
            with _NO_PROXY_OPENER.open(url, timeout=5) as resp:
                body = resp.read().decode("utf-8")
                return json.loads(body) if parse_json else body
        except urllib.error.URLError as e:
            raise ChromeDevToolsError(
                f"Chrome に接続できません ({self.host}:{self.port})。\n"
                f"Chrome を次のオプションで起動してください:\n"
                f"  chrome --remote-debugging-port={self.port}\n"
                f"詳細: {e}"
            )

    async def send_command(
        self,
        ws_url: str,
        method: str,
        params: Optional[dict] = None,
        timeout: float = 30.0,
    ) -> dict:
        """
        CDP コマンドを送信してレスポンスを返す

        Args:
            ws_url: タブの webSocketDebuggerUrl
            method: CDP メソッド名 (例: "Page.navigate")
            params: メソッドパラメータ
            timeout: タイムアウト秒数

        Returns:
            CDP レスポンスの result フィールド
        """
        ws_url = _normalize_loopback_ws_url(ws_url)
        loop = asyncio.get_running_loop()
        if self._connection_loop is not loop:
            # テストなどでイベントループが切り替わった場合、前ループに紐づく
            # WebSocket / Lock を再利用しない。
            self._ws_connections = {}
            self._ws_locks = {}
            self._connection_loop = loop

        lock = self._ws_locks.setdefault(ws_url, asyncio.Lock())
        async with lock:
            ws = self._ws_connections.get(ws_url)
            try:
                self._command_id += 1
                command_id = self._command_id
                cmd = {"id": command_id, "method": method, "params": params or {}}
                payload = json.dumps(cmd)

                # Chrome 再起動後など、キャッシュ接続だけが切れている場合は
                # send 失敗を検知して一度だけ再接続する。受信後の再送は
                # 非冪等コマンドの二重実行を避けるため行わない。
                for send_attempt in range(2):
                    if ws is None:
                        ws = await self._open_connection(ws_url)
                    try:
                        await ws.send(payload)
                        break
                    except (WebSocketException, OSError):
                        await self._discard_connection(ws_url, ws)
                        ws = None
                        if send_attempt >= 1:
                            raise

                deadline = loop.time() + timeout

                while True:
                    remaining = deadline - loop.time()
                    if remaining <= 0:
                        raise TimeoutError(
                            f"CDP コマンド '{method}' がタイムアウトしました ({timeout}秒)"
                        )

                    raw = await asyncio.wait_for(ws.recv(), timeout=remaining)
                    msg = json.loads(raw)

                    # イベント (id なし) はスキップしてレスポンスを待つ
                    if msg.get("id") == command_id:
                        if "error" in msg:
                            err = msg["error"]
                            raise ChromeDevToolsError(
                                f"CDP エラー [{method}]: "
                                f"{err.get('message', str(err))}"
                            )
                        return msg.get("result", {})

            # TimeoutError は OSError の派生クラスでもあるため、接続エラーより
            # 先に捕捉する。順序を逆にすると原因が空の「WebSocket 接続エラー」
            # へ誤分類され、ログからタイムアウトと判定できなくなる。
            except TimeoutError as e:
                await self._discard_connection(ws_url, ws)
                raise ChromeDevToolsTimeoutError(
                    f"CDP コマンド '{method}' がタイムアウトしました ({timeout:g}秒)"
                ) from e
            except (WebSocketException, OSError) as e:
                await self._discard_connection(ws_url, ws)
                # 自動解決タブがこの接続先だった場合、タブが閉じられた等で無効に
                # なった可能性がある。次回呼び出しで再解決させるためキャッシュを破棄。
                if self._auto_tab is not None and self._auto_tab.get("webSocketDebuggerUrl") == ws_url:
                    self._auto_tab = None
                # Chrome 自体が落ちている可能性もあるため、疎通確認 TTL を即時失効
                # させ、次回 ensure_running() で TTL 満了を待たず再確認させる。
                if self._on_unreachable is not None:
                    self._on_unreachable()
                raise ChromeDevToolsError(f"WebSocket 接続エラー: {e}") from e

    async def _open_connection(self, ws_url: str) -> Any:
        ws = await websockets.connect(
            ws_url,
            max_size=50 * 1024 * 1024,  # 50MB (スクリーンショット対応)
            open_timeout=10,
            proxy=None,  # loopback CDP をシステムプロキシへ流さない
        )
        self._ws_connections[ws_url] = ws
        return ws

    async def _discard_connection(self, ws_url: str, ws: Any = None) -> None:
        """キャッシュ済み接続を破棄する。呼び出し元で対象 Lock を保持する。"""
        current = self._ws_connections.get(ws_url)
        if current is None or (ws is not None and current is not ws):
            return
        self._ws_connections.pop(ws_url, None)
        try:
            await asyncio.wait_for(current.close(), timeout=1.0)
        except Exception:
            pass

    async def close_connection(self, ws_url: str) -> None:
        """指定ターゲットの再利用接続を閉じる。"""
        ws_url = _normalize_loopback_ws_url(ws_url)
        lock = self._ws_locks.setdefault(ws_url, asyncio.Lock())
        async with lock:
            await self._discard_connection(ws_url)

    async def close_connections(self) -> None:
        """このクライアントが保持するすべての WebSocket 接続を閉じる。"""
        await asyncio.gather(*(
            self.close_connection(ws_url)
            for ws_url in list(self._ws_connections)
        ))

    async def resolve_tab_async(self, tab_id: Optional[str] = None) -> dict:
        """
        タブ情報を返す。自動解決タブがキャッシュ済みならスレッドに逃がさず即座に返す
        （HTTP を伴わないため）。未キャッシュ／明示 tab_id の場合のみ同期 HTTP を
        イベントループ外で実行する。
        """
        if (not tab_id or tab_id == "auto") and self._auto_tab is not None:
            return self._auto_tab
        return await asyncio.to_thread(self.resolve_tab, tab_id)

    def resolve_tab(self, tab_id: Optional[str] = None) -> dict:
        """
        タブ情報を返す

        tab_id が None または "auto" の場合は "自動解決タブ" を使う。
        セッション内で一度解決したタブ情報をキャッシュして使い回すため、
        呼び出しのたびに Chrome へタブ一覧を問い合わせるコストを避けられる。
        tab_id を明示指定した場合は常にタブ一覧から検索する（キャッシュ不使用）。
        """
        is_auto = not tab_id or tab_id == "auto"
        if is_auto and self._auto_tab is not None:
            return self._auto_tab

        tabs = self.list_tabs()
        if not tabs:
            raise ChromeDevToolsError(
                "タブが見つかりません。Chrome でページを開いてください。"
            )

        if not is_auto:
            tab = next((t for t in tabs if t["id"] == tab_id), None)
            if not tab:
                available = [t["id"] for t in tabs]
                raise ValueError(
                    f"タブ ID '{tab_id}' が見つかりません。\n"
                    f"利用可能な ID: {available}"
                )
            return tab

        page_tabs = [t for t in tabs if t.get("type") == "page"]
        tab = page_tabs[0] if page_tabs else tabs[0]
        self._auto_tab = tab
        return tab

    def get_ws_url(self, tab: dict) -> str:
        """タブの webSocketDebuggerUrl を取得"""
        ws_url = tab.get("webSocketDebuggerUrl")
        if not ws_url:
            raise ChromeDevToolsError(
                f"タブ '{tab.get('id')}' に WebSocket URL がありません。\n"
                f"既に別のデバッガが接続している可能性があります。"
            )
        return _normalize_loopback_ws_url(ws_url)

    # ------------------------------------------------------------------ #
    # タブ管理
    # ------------------------------------------------------------------ #

    def list_tabs(self) -> list[dict]:
        """開いているタブ/ページの一覧を取得"""
        raw = self._http_get("/json")
        if not isinstance(raw, list):
            return []
        for tab in raw:
            ws_url = tab.get("webSocketDebuggerUrl")
            if ws_url:
                tab["webSocketDebuggerUrl"] = _normalize_loopback_ws_url(ws_url)
        return raw

    def get_version(self) -> dict:
        """Chrome バージョン情報を取得"""
        return self._http_get("/json/version")

    def get_browser_ws_url(self) -> str:
        """ブラウザレベルの WebSocket URL を取得 (Browser.* / Target.* 等のコマンド用)"""
        version = self._http_get("/json/version")
        ws_url = version.get("webSocketDebuggerUrl")
        if not ws_url:
            raise ChromeDevToolsError(
                "ブラウザレベルの WebSocket URL が取得できません。"
                "Chrome が --remote-debugging-port で起動しているか確認してください。"
            )
        return _normalize_loopback_ws_url(ws_url)

    def new_tab_sync(self, retries: int = 5, retry_delay: float = 1.5) -> dict:
        """新規ブランクタブを開く (同期)。Chrome 起動直後のリトライ対応"""
        last_exc: Exception = ChromeDevToolsError("new_tab_sync: リトライ未実行")
        for attempt in range(retries):
            try:
                return self._http_get("/json/new")
            except ChromeDevToolsError as e:
                last_exc = e
                if attempt < retries - 1:
                    time.sleep(retry_delay)
        raise last_exc

    def close_tab_sync(self, tab_id: str) -> bool:
        """タブを閉じる (同期)"""
        try:
            # /json/close は JSON ではなくプレーンテキストを返す。
            self._http_get(f"/json/close/{tab_id}", parse_json=False)
            return True
        except ChromeDevToolsError:
            return False

    async def close_tab(self, tab_id: str) -> bool:
        """タブを閉じ、対応する再利用 WebSocket も破棄する。"""
        tab = await self.resolve_tab_async(tab_id)
        ws_url = self.get_ws_url(tab)
        if self._auto_tab is not None and self._auto_tab.get("id") == tab_id:
            self._auto_tab = None
        try:
            return await asyncio.to_thread(self.close_tab_sync, tab_id)
        finally:
            await self.close_connection(ws_url)

    def activate_tab_sync(self, tab_id: str) -> bool:
        """タブをアクティブにする (同期)"""
        try:
            # /json/activate もプレーンテキストを返す。
            self._http_get(f"/json/activate/{tab_id}", parse_json=False)
            return True
        except ChromeDevToolsError:
            return False

    # ------------------------------------------------------------------ #
    # ナビゲーション
    # ------------------------------------------------------------------ #

    async def _quick_ready_state(self, ws: str) -> str:
        """
        document.readyState を 1 回だけ確認する（ポーリングしない）。

        ページ遷移直後に「busy かどうか」を即座に呼び出し元へ返すためのヘルパー。
        wait_for_load のような完了待ちループは行わず、その場の状態を返してすぐ戻る。
        """
        try:
            result = await self.send_command(
                ws, "Runtime.evaluate",
                {"expression": "document.readyState", "returnByValue": True},
            )
            return result.get("result", {}).get("value", "") or "unknown"
        except ChromeDevToolsError:
            return "unknown"

    async def navigate(self, url: str, tab_id: Optional[str] = None) -> str:
        """URL に移動する"""
        tab = await self.resolve_tab_async(tab_id)
        ws = self.get_ws_url(tab)
        result = await self.send_command(ws, "Page.navigate", {"url": url})
        frame_id = result.get("frameId", "")
        error = result.get("errorText", "")
        if error:
            return f"移動エラー: {error} → {url}"
        state = await self._quick_ready_state(ws)
        return f"移動完了: {url} (frame: {frame_id[:8]}..., readyState: {state})"

    async def reload(self, tab_id: Optional[str] = None) -> str:
        """ページをリロードする"""
        tab = await self.resolve_tab_async(tab_id)
        ws = self.get_ws_url(tab)
        await self.send_command(ws, "Page.reload", {})
        state = await self._quick_ready_state(ws)
        return f"リロードしました (readyState: {state})"

    async def go_back(self, tab_id: Optional[str] = None) -> str:
        """ブラウザの戻るボタン相当"""
        js = "history.back(); 'back'"
        result = await self.eval_js(js, tab_id)
        return str(result)

    async def go_forward(self, tab_id: Optional[str] = None) -> str:
        """ブラウザの進むボタン相当"""
        js = "history.forward(); 'forward'"
        result = await self.eval_js(js, tab_id)
        return str(result)

    # ------------------------------------------------------------------ #
    # ページ情報取得
    # ------------------------------------------------------------------ #

    async def get_page_info(self, tab_id: Optional[str] = None) -> dict:
        """URL・タイトル・readyState などページ基本情報を取得"""
        tab = await self.resolve_tab_async(tab_id)
        ws = self.get_ws_url(tab)
        result = await self.send_command(
            ws,
            "Runtime.evaluate",
            {
                "expression": (
                    "JSON.stringify({"
                    "url: location.href,"
                    "title: document.title,"
                    "readyState: document.readyState,"
                    "scrollY: window.scrollY,"
                    "scrollHeight: document.body ? document.body.scrollHeight : 0,"
                    "width: window.innerWidth,"
                    "height: window.innerHeight"
                    "})"
                ),
                "returnByValue": True,
            },
        )
        val = result.get("result", {}).get("value", "{}")
        try:
            return json.loads(val)
        except Exception:
            return {"url": tab.get("url", ""), "title": tab.get("title", "")}

    async def get_current_url(self, tab_id: Optional[str] = None) -> str:
        """現在の URL を取得"""
        result = await self.eval_js("location.href", tab_id)
        return str(result or "")

    async def get_title(self, tab_id: Optional[str] = None) -> str:
        """ページタイトルを取得"""
        result = await self.eval_js("document.title", tab_id)
        return str(result or "")

    async def get_html(self, tab_id: Optional[str] = None) -> str:
        """ページ全体の HTML を取得"""
        tab = await self.resolve_tab_async(tab_id)
        ws = self.get_ws_url(tab)
        doc = await self.send_command(ws, "DOM.getDocument", {"depth": -1})
        root_node_id = doc["root"]["nodeId"]
        html = await self.send_command(
            ws, "DOM.getOuterHTML", {"nodeId": root_node_id}
        )
        return html.get("outerHTML", "")

    async def get_text(self, tab_id: Optional[str] = None) -> str:
        """ページのテキストコンテンツ (innerText) を取得"""
        result = await self.eval_js(
            "document.body ? document.body.innerText : document.documentElement.innerText",
            tab_id,
        )
        return str(result or "")

    # ------------------------------------------------------------------ #
    # スクリーンショット
    # ------------------------------------------------------------------ #

    async def screenshot(
        self,
        tab_id: Optional[str] = None,
        fmt: str = "png",
        quality: int = 80,
        full_page: bool = False,
        save_path: Optional[str] = None,
        shutter_sounds: str = "none",
    ) -> tuple[str, str]:
        """
        スクリーンショットを撮る

        Args:
            fmt: "png" または "jpeg"
            quality: JPEG 品質 (1-100)
            full_page: True でページ全体をキャプチャ
            save_path: 保存先。フォルダ指定なら yyyymmdd.hhmmss.png で保存。
                       ファイル指定なら指定ファイルに上書き保存（拡張子に合わせて変換）。
                       省略時は保存しない。
            shutter_sounds: "auto" でシャッター音を再生。デフォルト "none"

        Returns:
            (base64 データ, 保存先パス) のタプル。
            save_path を指定した場合は base64 を返さず ("", 保存先) になる。
            保存したファイルを読めば済むのに同じ中身を base64 でも返すと、
            呼び出し側のコンテキストが二重に膨らむため。
        """
        if shutter_sounds == "auto":
            DesktopCapture._play_shutter_sound()

        tab = await self.resolve_tab_async(tab_id)
        ws = self.get_ws_url(tab)

        params: dict = {"format": fmt}
        if fmt == "jpeg":
            params["quality"] = quality

        if full_page:
            # Emulation.setDeviceMetricsOverride/clear の往復をなくし、
            # captureBeyondViewport + clip でビューポート外までまとめて撮る。
            metrics = await self.send_command(ws, "Page.getLayoutMetrics")
            content = metrics.get("cssContentSize") or metrics.get("contentSize", {})
            w = max(1, int(content.get("width", 1280)))
            h = max(1, int(content.get("height", 800)))
            params["clip"] = {"x": 0, "y": 0, "width": w, "height": h, "scale": 1}
            params["captureBeyondViewport"] = True

        # キャプチャは読み取り専用で再実行してもページ状態を変更しない。
        # Chrome が一時的に描画応答を返さない場合に限り、接続を張り直して
        # 1回だけ再試行する（send_command はタイムアウト時に接続を破棄済み）。
        try:
            result = await self.send_command(ws, "Page.captureScreenshot", params)
        except ChromeDevToolsTimeoutError:
            logger.info("スクリーンショット取得がタイムアウトしたため1回再試行します")
            result = await self.send_command(ws, "Page.captureScreenshot", params)
        data = result.get("data", "")

        saved_path = ""
        if save_path and data:
            saved_path = await asyncio.to_thread(
                self._save_screenshot_file, save_path, data, fmt, quality
            )
            data = ""  # ファイル名指定時は base64 を返さない

        return data, saved_path

    @staticmethod
    def _save_screenshot_file(save_path: str, data: str, fmt: str, quality: int) -> str:
        """Base64 デコード・PIL 変換・ファイル書き込み（ブロッキング I/O）。
        event loop を塞がないよう asyncio.to_thread から呼び出すこと。"""
        raw = base64.b64decode(data)
        if os.path.isdir(save_path) or save_path.endswith(("/", "\\")):
            # フォルダ指定 → yyyymmdd.hhmmss.png で保存
            os.makedirs(save_path, exist_ok=True)
            fname = datetime.now().strftime("%Y%m%d.%H%M%S") + ".png"
            dest = os.path.join(save_path, fname)
            # フォルダ保存は常に PNG
            if fmt == "jpeg":
                img = _PILImage.open(io.BytesIO(raw))
                buf = io.BytesIO()
                img.save(buf, format="PNG", optimize=True)
                save_bytes = buf.getvalue()
            else:
                save_bytes = raw
        else:
            # ファイル指定 → 拡張子に合わせて変換
            dest = save_path
            parent = os.path.dirname(os.path.abspath(dest))
            if parent:
                os.makedirs(parent, exist_ok=True)
            ext = os.path.splitext(save_path)[1].lower()
            if ext in (".jpg", ".jpeg"):
                img = _PILImage.open(io.BytesIO(raw))
                buf = io.BytesIO()
                img.convert("RGB").save(buf, format="JPEG", quality=quality, optimize=True)
                save_bytes = buf.getvalue()
            else:
                # .png その他 → PNG のまま保存
                if fmt == "jpeg":
                    img = _PILImage.open(io.BytesIO(raw))
                    buf = io.BytesIO()
                    img.save(buf, format="PNG", optimize=True)
                    save_bytes = buf.getvalue()
                else:
                    save_bytes = raw
        with open(dest, "wb") as f:
            f.write(save_bytes)
        return dest

    # ------------------------------------------------------------------ #
    # JavaScript 実行
    # ------------------------------------------------------------------ #

    async def eval_js(
        self,
        expression: str,
        tab_id: Optional[str] = None,
        await_promise: bool = False,
    ) -> Any:
        """
        JavaScript を実行して結果を返す

        Args:
            expression: 実行する JS コード
            await_promise: Promise を await する場合 True

        Returns:
            実行結果 (Python オブジェクト)

        Raises:
            ChromeDevToolsError: JS 実行時例外が発生した場合
        """
        tab = await self.resolve_tab_async(tab_id)
        ws = self.get_ws_url(tab)

        result = await self.send_command(
            ws,
            "Runtime.evaluate",
            {
                "expression": expression,
                "returnByValue": True,
                "awaitPromise": await_promise,
            },
        )

        if "exceptionDetails" in result:
            exc = result["exceptionDetails"]
            desc = (
                exc.get("exception", {}).get("description", "")
                or exc.get("text", "")
            )
            raise ChromeDevToolsError(f"JS 実行エラー: {desc}")

        rv = result.get("result", {})
        return rv.get("value")

    # ------------------------------------------------------------------ #
    # DOM 操作
    # ------------------------------------------------------------------ #

    async def click(self, selector: str, tab_id: Optional[str] = None) -> str:
        """CSS セレクターで要素をクリック"""
        sel_js = json.dumps(selector)
        js = f"""
(function() {{
    const el = document.querySelector({sel_js});
    if (!el) return 'エラー: 要素が見つかりません: ' + {sel_js};
    el.click();
    const tag = el.tagName.toLowerCase();
    const id = el.id ? '#' + el.id : '';
    const cls = el.className ? '.' + el.className.trim().split(' ')[0] : '';
    return '✓ クリック: ' + tag + id + cls;
}})()
"""
        result = await self.eval_js(js, tab_id)
        return str(result)

    async def type_text(
        self,
        selector: str,
        text: str,
        tab_id: Optional[str] = None,
        clear_first: bool = True,
    ) -> str:
        """CSS セレクターで要素にテキストを入力"""
        sel_js = json.dumps(selector)
        txt_js = json.dumps(text)
        clear_code = (
            'el.value = ""; el.dispatchEvent(new Event("input"));'
            if clear_first
            else ""
        )
        js = f"""
(function() {{
    const el = document.querySelector({sel_js});
    if (!el) return 'エラー: 要素が見つかりません: ' + {sel_js};
    el.focus();
    {clear_code}
    el.value = {txt_js};
    el.dispatchEvent(new Event('input', {{ bubbles: true }}));
    el.dispatchEvent(new Event('change', {{ bubbles: true }}));
    return '✓ 入力: ' + el.value.slice(0, 40);
}})()
"""
        result = await self.eval_js(js, tab_id)
        return str(result)

    async def scroll(
        self,
        delta_x: int = 0,
        delta_y: int = 0,
        tab_id: Optional[str] = None,
        selector: Optional[str] = None,
    ) -> str:
        """ページ or 要素をスクロール"""
        if selector:
            sel_js = json.dumps(selector)
            js = f"""
(function() {{
    const el = document.querySelector({sel_js});
    if (!el) return 'エラー: 要素が見つかりません: ' + {sel_js};
    el.scrollBy({delta_x}, {delta_y});
    return '✓ スクロール (要素): ' + el.tagName.toLowerCase();
}})()
"""
        else:
            js = (
                f"window.scrollBy({delta_x}, {delta_y}); "
                f"'✓ スクロール: dx={delta_x}, dy={delta_y}'"
            )
        result = await self.eval_js(js, tab_id)
        return str(result)

    async def scroll_to_element(
        self, selector: str, tab_id: Optional[str] = None
    ) -> str:
        """要素が見えるようにスクロール"""
        sel_js = json.dumps(selector)
        js = f"""
(function() {{
    const el = document.querySelector({sel_js});
    if (!el) return 'エラー: 要素が見つかりません: ' + {sel_js};
    el.scrollIntoView({{ behavior: 'smooth', block: 'center' }});
    return '✓ 要素へスクロール: ' + el.tagName.toLowerCase();
}})()
"""
        result = await self.eval_js(js, tab_id)
        return str(result)

    async def find_elements(
        self,
        selector: str,
        tab_id: Optional[str] = None,
        limit: int = 20,
    ) -> list[dict]:
        """
        CSS セレクターで要素を検索してプロパティ一覧を返す

        Returns:
            各要素の tag / id / classes / text / href / value / visible など
        """
        sel_js = json.dumps(selector)
        js = f"""
(function() {{
    const els = Array.from(document.querySelectorAll({sel_js})).slice(0, {limit});
    return els.map(function(el) {{
        return {{
            tag: el.tagName.toLowerCase(),
            id: el.id || null,
            classes: el.className || null,
            text: (el.innerText || el.textContent || '').trim().slice(0, 120),
            href: el.href || null,
            value: el.value !== undefined ? String(el.value) : null,
            type: el.type || null,
            disabled: el.disabled || false,
            visible: !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
        }};
    }});
}})()
"""
        result = await self.eval_js(js, tab_id)
        return result if isinstance(result, list) else []

    # ------------------------------------------------------------------ #
    # ビューポート / レイアウト
    # ------------------------------------------------------------------ #

    async def set_viewport(
        self, width: int, height: int, tab_id: Optional[str] = None
    ) -> str:
        """ビューポートサイズを設定"""
        tab = await self.resolve_tab_async(tab_id)
        ws = self.get_ws_url(tab)
        await self.send_command(
            ws,
            "Emulation.setDeviceMetricsOverride",
            {"width": width, "height": height, "deviceScaleFactor": 1, "mobile": False},
        )
        return f"ビューポート設定: {width}×{height}"

    async def wait_for_load(
        self, tab_id: Optional[str] = None, timeout: float = 10.0
    ) -> str:
        """
        document.readyState が 'complete' になるまでポーリング (最大 timeout 秒)

        navigate/reload は戻り値に readyState を含めて即座に返るため、
        「まだ complete になっていない」ことが分かっている場合のみ、
        本メソッドで完了を待つ用途に限定して使うこと（多用すると遅くなる）。
        """
        tab = await self.resolve_tab_async(tab_id)
        ws = self.get_ws_url(tab)
        loop = asyncio.get_running_loop()
        start = loop.time()

        while True:
            elapsed = loop.time() - start
            if elapsed > timeout:
                return f"タイムアウト ({timeout:.0f}秒)"

            result = await self.send_command(
                ws,
                "Runtime.evaluate",
                {"expression": "document.readyState", "returnByValue": True},
            )
            state = result.get("result", {}).get("value", "")
            if state == "complete":
                return f"ロード完了 ({elapsed:.1f}秒)"

            await asyncio.sleep(0.2)

    # ------------------------------------------------------------------ #
    # コンソールログ (JS 注入キャプチャ)
    # ------------------------------------------------------------------ #

    async def install_console_capture(self, tab_id: Optional[str] = None) -> str:
        """
        コンソールログのキャプチャスクリプトをページに注入する。
        注入後の console.log/info/warn/error が window.__mcp_console_logs に蓄積される。
        """
        js = r"""
(function() {
    if (window.__mcp_console_capture) return '既にインストール済み';
    window.__mcp_console_capture = true;
    window.__mcp_console_logs = [];

    ['log', 'info', 'warn', 'error', 'debug'].forEach(function(level) {
        var orig = console[level].bind(console);
        console[level] = function() {
            var args = Array.from(arguments).map(function(a) {
                if (a === null) return 'null';
                if (a === undefined) return 'undefined';
                if (typeof a === 'object') {
                    try { return JSON.stringify(a); } catch(e) { return String(a); }
                }
                return String(a);
            });
            window.__mcp_console_logs.push({
                level: level,
                message: args.join(' '),
                timestamp: new Date().toISOString()
            });
            if (window.__mcp_console_logs.length > 500) {
                window.__mcp_console_logs.shift();
            }
            orig.apply(console, arguments);
        };
    });
    return 'コンソールキャプチャをインストールしました';
})()
"""
        result = await self.eval_js(js, tab_id)
        return str(result)

    async def get_console_logs(
        self,
        tab_id: Optional[str] = None,
        level: Optional[str] = None,
        limit: int = 50,
    ) -> list[dict]:
        """
        キャプチャされたコンソールログを取得する。
        install_console_capture() を先に呼ぶ必要がある。

        Args:
            level: "log" / "info" / "warn" / "error" / "debug" でフィルタ (None = 全て)
            limit: 取得する最大件数 (末尾から)
        """
        level_filter = (
            f".filter(function(l) {{ return l.level === {json.dumps(level)}; }})"
            if level
            else ""
        )
        js = f"""
(function() {{
    var logs = (window.__mcp_console_logs || []){level_filter};
    return logs.slice(-{limit});
}})()
"""
        result = await self.eval_js(js, tab_id)
        return result if isinstance(result, list) else []

    async def clear_console_logs(self, tab_id: Optional[str] = None) -> str:
        """キャプチャされたコンソールログをクリア"""
        await self.eval_js(
            "window.__mcp_console_logs = []; window.__mcp_console_logs.length",
            tab_id,
        )
        return "クリアしました (0件)"

    # ------------------------------------------------------------------ #
    # ネットワーク監視 (JS 注入キャプチャ)
    # ------------------------------------------------------------------ #

    async def install_network_capture(self, tab_id: Optional[str] = None) -> str:
        """
        XHR/fetch リクエストのキャプチャスクリプトをページに注入する。
        注入後のリクエストが window.__mcp_network_logs に蓄積される。
        """
        js = r"""
(function() {
    if (window.__mcp_network_capture) return '既にインストール済み';
    window.__mcp_network_capture = true;
    window.__mcp_network_logs = [];

    function addLog(entry) {
        window.__mcp_network_logs.push(entry);
        if (window.__mcp_network_logs.length > 200) {
            window.__mcp_network_logs.shift();
        }
    }

    // fetch をラップ
    var origFetch = window.fetch.bind(window);
    window.fetch = function(input, init) {
        var url = typeof input === 'string' ? input : (input.url || String(input));
        var method = (init && init.method) || 'GET';
        var start = Date.now();
        return origFetch(input, init).then(function(resp) {
            addLog({
                type: 'fetch', method: method, url: url,
                status: resp.status, ok: resp.ok,
                duration: Date.now() - start,
                timestamp: new Date().toISOString()
            });
            return resp;
        }).catch(function(err) {
            addLog({
                type: 'fetch', method: method, url: url,
                error: err.message, duration: Date.now() - start,
                timestamp: new Date().toISOString()
            });
            throw err;
        });
    };

    // XHR をラップ
    var origOpen = XMLHttpRequest.prototype.open;
    var origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url) {
        this._mcpMethod = method;
        this._mcpUrl = url;
        this._mcpStart = Date.now();
        return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function() {
        var xhr = this;
        xhr.addEventListener('loadend', function() {
            addLog({
                type: 'xhr',
                method: xhr._mcpMethod || 'GET',
                url: xhr._mcpUrl || '',
                status: xhr.status,
                ok: xhr.status >= 200 && xhr.status < 300,
                duration: Date.now() - (xhr._mcpStart || Date.now()),
                timestamp: new Date().toISOString()
            });
        });
        return origSend.apply(this, arguments);
    };

    return 'ネットワークキャプチャをインストールしました';
})()
"""
        result = await self.eval_js(js, tab_id)
        return str(result)

    async def get_network_logs(
        self, tab_id: Optional[str] = None, limit: int = 50
    ) -> list[dict]:
        """
        キャプチャされたネットワークリクエストを取得する。
        install_network_capture() を先に呼ぶ必要がある。
        """
        js = f"(window.__mcp_network_logs || []).slice(-{limit})"
        result = await self.eval_js(js, tab_id)
        return result if isinstance(result, list) else []

    async def clear_network_logs(self, tab_id: Optional[str] = None) -> str:
        """キャプチャされたネットワークログをクリア"""
        await self.eval_js("window.__mcp_network_logs = []", tab_id)
        return "クリアしました"

    async def get_resource_timing(
        self, tab_id: Optional[str] = None, limit: int = 30
    ) -> list[dict]:
        """
        Performance API からリソースタイミング情報を取得する。
        ページ読み込み時の静的リソースが対象 (JS 注入不要)。
        """
        js = f"""
(function() {{
    return performance.getEntriesByType('resource').slice(0, {limit}).map(function(e) {{
        return {{
            name: e.name.split('?')[0],
            type: e.initiatorType,
            duration: Math.round(e.duration),
            size: e.transferSize || 0,
            start: Math.round(e.startTime)
        }};
    }});
}})()
"""
        result = await self.eval_js(js, tab_id)
        return result if isinstance(result, list) else []

    # ------------------------------------------------------------------ #
    # ストレージ / クッキー
    # ------------------------------------------------------------------ #

    async def get_cookies(self, tab_id: Optional[str] = None) -> list[dict]:
        """ページのクッキーを取得"""
        tab = await self.resolve_tab_async(tab_id)
        ws = self.get_ws_url(tab)
        result = await self.send_command(ws, "Network.getAllCookies")
        return result.get("cookies", [])

    async def get_local_storage(self, tab_id: Optional[str] = None) -> dict:
        """localStorage の内容を取得"""
        js = r"""
(function() {
    var result = {};
    for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        result[key] = localStorage.getItem(key);
    }
    return result;
})()
"""
        result = await self.eval_js(js, tab_id)
        return result if isinstance(result, dict) else {}

    async def get_session_storage(self, tab_id: Optional[str] = None) -> dict:
        """sessionStorage の内容を取得"""
        js = r"""
(function() {
    var result = {};
    for (var i = 0; i < sessionStorage.length; i++) {
        var key = sessionStorage.key(i);
        result[key] = sessionStorage.getItem(key);
    }
    return result;
})()
"""
        result = await self.eval_js(js, tab_id)
        return result if isinstance(result, dict) else {}

# [DIALOG_PATCH_APPLIED]

    # ------------------------------------------------------------------ #
    # ダイアログ操作 (confirm / alert / prompt)
    # ------------------------------------------------------------------ #

    async def handle_dialog(
        self,
        accept: bool = True,
        prompt_text: str = "",
        tab_id: Optional[str] = None,
        dialog_wait: float = 0.0,
    ) -> str:
        """
        CDP Page.handleJavaScriptDialog で現在表示中のダイアログを操作する。
        confirm/alert/prompt が表示されてブロック中の場合に使用する。

        Args:
            accept: True=OK/確認、False=キャンセル/閉じる
            prompt_text: prompt ダイアログへの入力テキスト（任意）
            tab_id: 対象タブID（省略時は最初のタブ）
            dialog_wait: ダイアログが表示されるまで待機する最大秒数（0=即時応答）。
                         eval_js で setTimeout を使いボタンをクリックする場合は
                         クリック遅延より大きな値を指定する（例: 30）。
        """
        tab = await self.resolve_tab_async(tab_id)
        ws_url = self.get_ws_url(tab)
        handle_params: dict = {"accept": accept}
        if prompt_text:
            handle_params["promptText"] = prompt_text

        if dialog_wait <= 0:
            # 即時応答（従来の動作）
            result = await self.send_command(ws_url, "Page.handleJavaScriptDialog", handle_params)
            return json.dumps(result, ensure_ascii=False)

        # イベント駆動: 同一 WebSocket 上で Page.javascriptDialogOpening を待機してから応答
        # 通常コマンド用の再利用接続と同じターゲットへ二重接続しない。
        await self.close_connection(ws_url)
        try:
            async with websockets.connect(
                ws_url,
                max_size=50 * 1024 * 1024,
                open_timeout=10,
                proxy=None,
            ) as ws:
                loop = asyncio.get_running_loop()

                # Page.enable でダイアログイベント購読を有効化
                await ws.send(json.dumps({"id": 1, "method": "Page.enable", "params": {}}))
                deadline = loop.time() + 10.0
                while True:
                    remaining = deadline - loop.time()
                    if remaining <= 0:
                        raise TimeoutError("Page.enable タイムアウト")
                    raw = await asyncio.wait_for(ws.recv(), timeout=remaining)
                    if json.loads(raw).get("id") == 1:
                        break

                # Page.javascriptDialogOpening イベントを待機
                deadline = loop.time() + dialog_wait
                dialog_info: dict = {}
                while True:
                    remaining = deadline - loop.time()
                    if remaining <= 0:
                        raise TimeoutError(
                            f"ダイアログが {dialog_wait:.0f}秒以内に表示されませんでした"
                        )
                    try:
                        raw = await asyncio.wait_for(ws.recv(), timeout=min(remaining, 1.0))
                        msg = json.loads(raw)
                        if msg.get("method") == "Page.javascriptDialogOpening":
                            dialog_info = msg.get("params", {})
                            break
                    except asyncio.TimeoutError:
                        continue

                # ダイアログに応答
                await ws.send(json.dumps({"id": 2, "method": "Page.handleJavaScriptDialog", "params": handle_params}))
                deadline = loop.time() + 10.0
                while True:
                    remaining = deadline - loop.time()
                    if remaining <= 0:
                        raise TimeoutError("handleJavaScriptDialog タイムアウト")
                    raw = await asyncio.wait_for(ws.recv(), timeout=remaining)
                    msg = json.loads(raw)
                    if msg.get("id") == 2:
                        if "error" in msg:
                            err = msg["error"]
                            raise ChromeDevToolsError(
                                f"CDP エラー [Page.handleJavaScriptDialog]: "
                                f"{err.get('message', str(err))}"
                            )
                        result = msg.get("result", {})
                        result["_dialog"] = dialog_info
                        return json.dumps(result, ensure_ascii=False)

        except WebSocketException as e:
            raise ChromeDevToolsError(f"WebSocket 接続エラー: {e}")

    async def install_dialog_override(self, tab_id: Optional[str] = None) -> str:
        """
        window.confirm/alert/prompt をオーバーライドし、ブロッキングを防ぐ。
        インストール後は set_confirm_result() で confirm の戻り値を事前設定できる。
        """
        js = r"""
(function() {
    if (window.__mcp_dialog_override) return 'already installed';
    window.__mcp_dialog_state = {
        last_type: null,
        last_message: null,
        last_result: null,
        next_confirm_result: true,
        next_prompt_result: ''
    };
    window.confirm = function(message) {
        var result = window.__mcp_dialog_state.next_confirm_result;
        window.__mcp_dialog_state.last_type = 'confirm';
        window.__mcp_dialog_state.last_message = message;
        window.__mcp_dialog_state.last_result = result;
        return result;
    };
    window.alert = function(message) {
        window.__mcp_dialog_state.last_type = 'alert';
        window.__mcp_dialog_state.last_message = message;
        window.__mcp_dialog_state.last_result = undefined;
        return undefined;
    };
    window.prompt = function(message, defaultValue) {
        var result = window.__mcp_dialog_state.next_prompt_result;
        window.__mcp_dialog_state.last_type = 'prompt';
        window.__mcp_dialog_state.last_message = message;
        window.__mcp_dialog_state.last_result = result;
        return result;
    };
    window.__mcp_dialog_override = true;
    return 'installed';
})()
"""
        result = await self.eval_js(js, tab_id)
        return str(result)

    async def get_dialog_state(self, tab_id: Optional[str] = None) -> dict:
        """インストール済みダイアログオーバーライドの最終状態を取得する"""
        js = """
(function() {
    if (!window.__mcp_dialog_state) return null;
    return {
        last_type: window.__mcp_dialog_state.last_type,
        last_message: window.__mcp_dialog_state.last_message,
        last_result: window.__mcp_dialog_state.last_result,
        next_confirm_result: window.__mcp_dialog_state.next_confirm_result
    };
})()
"""
        result = await self.eval_js(js, tab_id)
        return result if isinstance(result, dict) else {}

    async def set_confirm_result(self, accept: bool = True, tab_id: Optional[str] = None) -> str:
        """次の confirm() 呼び出しが返す値を設定する（install_dialog_override が必要）"""
        value = "true" if accept else "false"
        js = f"window.__mcp_dialog_state.next_confirm_result = {value}; \"OK\""
        result = await self.eval_js(js, tab_id)
        return str(result)
