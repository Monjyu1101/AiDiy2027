# -*- coding: utf-8 -*-
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
"""IDE所有のBrowserへ接続する。Chromeの新規起動・IDEプロセス停止は行わない。"""
import json
import asyncio
import re
import time
import urllib.parse
import urllib.request
from tools_proc.chrome_devtools import CDPClient

_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))

def is_reserved_browser_session(name):
    # 新しい空白付き名は接続専用。誤記・古い通常Chrome登録でも別Chromeへ退避しない。
    return isinstance(name, str) and name.startswith(("aidiy_ide ", "aidiy_browser "))


def is_ide_session(name):
    if not isinstance(name, str):
        return False
    return bool(re.fullmatch(
        r"aidiy_ide [1-9][0-9]*|"
        r"aidiy_browser [a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}|"
        r"aidiy_(?:ide|browser)(?:-[2-9][0-9]*|-1[0-9]+)?", name))

def read_ide_session(directory, name):
    if not is_ide_session(name):
        return None
    try:
        value = json.loads((directory / (name + ".json")).read_text(encoding="utf-8"))
        if not isinstance(value, dict) or value.get("name") != name or type(value.get("port")) is not int or not 1 <= value["port"] <= 65535:
            return None
        if not re.fullmatch(r"[a-f0-9-]{36}", value.get("token", "")):
            return None
        return value
    except (OSError, ValueError, TypeError):
        return None

class IDEBrowserClient(CDPClient):
    def __init__(self, entry):
        super().__init__(port=entry["port"])
        self.token = entry["token"]

    def resolve_tab(self, tab_id=None):
        """Browser連携は session 内の明示IDだけを解決し、暗黙の対象変更を防ぐ。"""
        if not isinstance(tab_id, str) or not tab_id.strip() or tab_id == "auto":
            raise ValueError(
                "AiDiy Browser のページ操作には session と tab_id を明示してください。"
                "list_tabs(session=...) の id、または連携で渡された tab_id を使ってください。"
            )
        # 毎回このセッションの現在の一覧と照合。閉鎖済み・他sessionのIDを拒否する。
        return super().resolve_tab(tab_id)

    async def resolve_tab_async(self, tab_id=None):
        # 基底のautoキャッシュ経由で検証が省略されないよう、常に上の契約を通す。
        return await asyncio.to_thread(self.resolve_tab, tab_id)

    def _http_get(self, path, *, parse_json=True):
        return super()._http_get("/" + self.token + path, parse_json=parse_json)

    def get_browser_ws_url(self):
        # Electron本体のBrowser/Targetは公開しない。新規タブだけ所有IDEへ依頼する。
        return "aidiy-ide://browser"

    async def send_command(self, ws_url, method, params=None, timeout=30.0):
        if ws_url != "aidiy-ide://browser":
            return await super().send_command(ws_url, method, params, timeout)
        if method != "Target.createTarget":
            raise RuntimeError("IDE本体のCDP操作は公開していません。")
        url = (params or {}).get("url", "https://www.google.com/")
        result = await asyncio.to_thread(self._http_get, "/json/new?url=" + urllib.parse.quote(url, safe=""))
        response = {"targetId": result["id"]}
        # IDEの新しいBrowserは別session。元clientは切り替えず、呼出元へ接続先を返す。
        if isinstance(result.get("session"), str) and result["session"]:
            response["session"] = result["session"]
        return response

class IDEBrowserManager:
    def __init__(self, entry):
        self.entry = entry
        self.debug_port = entry["port"]
        self.headless = False
        self._verified_until = 0

    def request(self, path):
        url = f"http://127.0.0.1:{self.debug_port}/{self.entry['token']}{path}"
        with _OPENER.open(url, timeout=5) as response:
            return json.loads(response.read().decode("utf-8"))

    def is_running(self):
        try:
            version = self.request("/json/version")
            return version.get("AiDiy-Owner") == self.entry["token"] and version.get("AiDiy-Session") == self.entry["name"]
        except Exception:
            return False

    def is_verified(self):
        return time.monotonic() < self._verified_until

    def mark_unreachable(self):
        self._verified_until = 0

    def ensure_running(self, show_automation_banner=None, url=None):
        if not self.is_running():
            self.mark_unreachable()
            raise RuntimeError('aidiy_browserを起動するか、IDEをtoolsへ接続し「＋ Browser」を開いてください。')
        self._verified_until = time.monotonic() + 2
        if url:
            self.request("/json/new?url=" + urllib.parse.quote(url if url != "about:blank" else "https://www.google.com/", safe=""))

    def close(self):
        try:
            self.request("/close")
            self.mark_unreachable()
            return True
        except Exception:
            return False
