"""認証付きTools管理と、登録を維持したサービス外応答。"""
import asyncio
from contextlib import contextmanager
from copy import deepcopy
from functools import wraps
import inspect
import json
import logging
import os
from pathlib import Path
import tempfile
from threading import RLock

import httpx
from fastapi import HTTPException, Request
from starlette.responses import JSONResponse
from tools_proc.tools_settings import CONFIG_PATH, CHOICES, load_tools_settings

logger = logging.getLogger(__name__)

MAX_BODY_BYTES = 20 * 1024 * 1024  # Node / FastAPI 共通の transport 基準 (20 MiB)


def unavailable(tool_id):
    return {"status": "NG", "available": False, "service_status": "out_of_service",
            "tool": tool_id, "message": "サービス外です。Tools設定と導入状態を確認してください。"}


class ToolsManagement:
    def __init__(self, path=CONFIG_PATH):
        self.path = Path(path)
        self.defaults = None
        self.enabled = {}
        self.instances = {}
        self.availability = {}
        self.lock = RLock()

    def initialize(self, instances):
        with self.lock:
            self.instances = instances
            self.defaults = load_tools_settings(self.path)
            try:
                data = json.loads(self.path.read_text(encoding="utf-8-sig"))
                enabled = data.get("enabled", {}) if isinstance(data, dict) else {}
                self.enabled = {k: v for k, v in enabled.items() if k in self.availability and type(v) is bool} if isinstance(enabled, dict) else {}
            except (OSError, ValueError):
                self.enabled = {}
            self.apply()

    def apply(self):
        for name, instance in self.instances.items():
            for field, value in (self.defaults or {}).get(name, {}).items():
                setattr(instance, field, value)

    def available(self, name):
        try:
            return bool(self.availability[name]())
        except Exception:
            return False

    def active(self, name):
        return self.enabled.get(name, True) and self.available(name)

    def snapshot(self):
        return {"tools": [{"id": name, "label": name.removeprefix("aidiy_"),
                           "enabled": self.enabled.get(name, True), "available": self.available(name),
                           "status": "OK" if self.active(name) else "サービス外",
                           "defaultsKey": name.removeprefix("aidiy_") if name.removeprefix("aidiy_") in CHOICES else None}
                          for name in self.availability],
                "defaults": deepcopy(self.defaults),
                "schema": {name: {field: sorted(values) for field, values in fields.items()} for name, fields in CHOICES.items()}}

    def decorate(self, name, decorator):
        def register(fn):
            @wraps(fn)
            async def guarded(*args, **kwargs):
                if not self.active(name):
                    return json.dumps(unavailable(name), ensure_ascii=False)
                if inspect.iscoroutinefunction(fn):
                    return await fn(*args, **kwargs)
                return await asyncio.to_thread(fn, *args, **kwargs)
            return decorator(guarded)
        return register

    @contextmanager
    def disk_lock(self):
        lock = self.path.with_suffix(".json.lock")
        try:
            lock.mkdir()
        except FileExistsError:
            raise HTTPException(409, "設定保存中です。再試行してください。") from None
        try:
            yield
        finally:
            try:
                lock.rmdir()
            except OSError:
                logger.warning("設定保存lockを削除できません。停止確認後に復旧してください。")

    def persist(self, action, patch):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.disk_lock():
            try:
                current = json.loads(self.path.read_text(encoding="utf-8-sig")) if self.path.exists() else {}
                if not isinstance(current, dict):
                    raise ValueError()
            except (OSError, ValueError):
                raise HTTPException(409, "既存設定を読めません。修復後に保存してください。") from None
            if action == "enabled":
                old = current.get("enabled", {})
                current["enabled"] = {**(old if isinstance(old, dict) else {}), **patch}
            else:
                for name, fields in patch.items():
                    old = current.get(name, {})
                    current[name] = {**(old if isinstance(old, dict) else {}), **fields}
            temporary = None
            try:
                with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=self.path.parent, delete=False) as out:
                    temporary = out.name
                    json.dump(current, out, ensure_ascii=False, indent=2)
                    out.write("\n")
                    out.flush()
                    os.fsync(out.fileno())
                os.replace(temporary, self.path)
            finally:
                if temporary and os.path.exists(temporary):
                    try:
                        os.unlink(temporary)
                    except OSError:
                        logger.warning("設定一時ファイルを削除できません。")

    def update(self, action, body):
        if not isinstance(body, dict) or set(body) - {action, "write"} or type(body.get("write", False)) is not bool:
            raise HTTPException(400, "入力が不正です。")
        patch = body.get(action, {})
        if not isinstance(patch, dict):
            raise HTTPException(400, "設定はobjectで指定してください。")
        with self.lock:
            if action == "enabled":
                if any(name not in self.availability or type(value) is not bool for name, value in patch.items()):
                    raise HTTPException(400, "ツールまたはenabledが不正です。")
                if any(value and not self.available(name) for name, value in patch.items()):
                    raise HTTPException(409, "未導入・利用不可のツールは有効化できません。")
            else:
                for name, fields in patch.items():
                    if name not in CHOICES or not isinstance(fields, dict) or any(field not in CHOICES[name] or not isinstance(value, str) or value not in CHOICES[name][field] for field, value in fields.items()):
                        raise HTTPException(400, "既定値が不正です。")
            if body.get("write") and patch:
                try:
                    self.persist(action, patch)
                except OSError:
                    raise HTTPException(503, "設定を保存できません。実行時設定も変更していません。") from None
            if action == "enabled":
                self.enabled.update(patch)
            else:
                for name, fields in patch.items():
                    self.defaults[name].update(fields)
                self.apply()
            return {"status": "OK", "data": {**self.snapshot(), "saved": bool(body.get("write") and patch)}}


async def authenticate(request):
    credential = request.headers.get("authorization", "")
    if not credential.startswith("Bearer ") or len(credential) > 8192 or any(c in credential for c in "\r\n"):
        raise HTTPException(401, "ログインが必要です。")
    # Configと同じCore現在利用者検証を毎回利用。JWT秘密やAPIキーは共有/公開しない。
    try:
        config = json.loads((CONFIG_PATH.parent / "AiDiy_key.json").read_text(encoding="utf-8-sig"))
        port = config.get("PORT_CORE", 8091)
        if isinstance(port, bool) or not str(port).isdigit() or not 1 <= int(port) <= 65535:
            raise ValueError()
        async with httpx.AsyncClient(timeout=5, trust_env=False, follow_redirects=False) as client:
            response = await client.post(f"http://127.0.0.1:{port}/core/auth/現在利用者", json={}, headers={"Authorization": credential})
        if response.status_code in (401, 403):
            raise HTTPException(401, "再ログインしてください。")
        if response.status_code != 200 or response.json().get("status") != "OK":
            raise HTTPException(403, "利用者認証を確認してください。")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(503, "Core認証を確認できません。") from None


def register_management(app, manager, auth=authenticate):
    for action in ("enabled", "defaults"):
        def make_endpoint(selected):
            async def endpoint(request: Request):
                await auth(request)
                # Cookie認証なし。Origin付き要求も同一originだけ受け付ける。
                from urllib.parse import urlsplit
                origin = request.headers.get("origin")
                try:
                    origin_host = urlsplit(origin).netloc if origin else None
                except ValueError:
                    raise HTTPException(403, "送信元が不正です。") from None
                if request.headers.get("sec-fetch-site") == "cross-site" or (origin and origin_host != request.headers.get("host")):
                    raise HTTPException(403, "同じ画面から操作してください。")
                if request.headers.get("content-type", "").split(";")[0] != "application/json":
                    raise HTTPException(400, "JSONが必要です。")
                data = bytearray()
                async for chunk in request.stream():
                    if len(data) + len(chunk) > MAX_BODY_BYTES:
                        raise HTTPException(413, "入力が大きすぎます。")
                    data.extend(chunk)
                try:
                    body = json.loads(data)
                except ValueError:
                    raise HTTPException(400, "JSONが不正です。") from None
                return manager.update(selected, body)
            return endpoint
        app.add_api_route(f"/management/{action}", make_endpoint(action), methods=["POST"])


class ToolsGateMiddleware:
    def __init__(self, app, manager):
        self.app, self.manager = app, manager

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            parts = scope.get("path", "").strip("/").split("/")
            if parts[0] == "aidiy_chat_completions":
                parts[0] = "aidiy_chat_llms"
            if len(parts) >= 2 and parts[0] in self.manager.availability:
                # MCP transport/metaは登録・発見・sessionを維持。tool実行はdecoratorで遮断。
                if parts[1] not in {"sse", "mcp", "messages", "list", "ping", "initialize", "docs"}:
                    if not self.manager.active(parts[0]):
                        return await JSONResponse(unavailable(parts[0]))(scope, receive, send)
        return await self.app(scope, receive, send)
