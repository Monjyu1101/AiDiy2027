# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""
OBS Studio WebSocket 制御モジュール

OBS Studio の標準 obs-websocket v5 に接続し、配信、録画、シーン、
ソース表示、音声ミュートなどを制御する。
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import threading
import uuid
from pathlib import Path
from typing import Any, Optional

import websockets

from log_config import get_logger

logger = get_logger(__name__)


class ObsStudioControlError(Exception):
    """OBS Studio 制御エラー"""


class ObsStudioControl:
    """OBS Studio WebSocket v5 クライアント"""

    DEFAULT_HOST = "127.0.0.1"
    DEFAULT_PORT = 4455
    DEFAULT_PASSWORD = "aidiy4455"
    DEFAULT_TIMEOUT = 10.0

    # OBS 接続設定ファイル（backend_tools 起点）
    _OBS_CONFIG_REL = "../_config/mcp_obs_studio_control.json"
    _LEGACY_OBS_CONFIG_REL = "../_config/aidiy_obs_studio_control.json"

    def __init__(
        self,
        host: Optional[str] = None,
        port: Optional[int] = None,
        password: Optional[str] = None,
        timeout: Optional[float] = None,
    ) -> None:
        config = self._load_or_create_config()

        self.host = host if host is not None else str(config.get("host", self.DEFAULT_HOST))
        self.port = int(port if port is not None else config.get("port", self.DEFAULT_PORT))
        self.password = (
            password
            if password is not None
            else str(config.get("password", self.DEFAULT_PASSWORD))
        )
        self.timeout = float(
            timeout if timeout is not None else config.get("timeout", self.DEFAULT_TIMEOUT)
        )

        # 起動時に WebSocket 接続と認証を試行し、結果をキャッシュする
        self.startup_status: dict[str, Any] = self._check_startup_sync()

    # ------------------------------------------------------------------ #
    # 接続設定ファイル
    # ------------------------------------------------------------------ #

    def _obs_config_path(self) -> Path:
        return Path(__file__).resolve().parent.parent / self._OBS_CONFIG_REL

    def _legacy_obs_config_path(self) -> Path:
        return Path(__file__).resolve().parent.parent / self._LEGACY_OBS_CONFIG_REL

    def _default_obs_config(self) -> dict[str, Any]:
        return {
            "version": 1,
            "description": (
                "mcp_obs_studio_control の OBS Studio WebSocket 接続設定。"
                " OBS Studio 側の obs-websocket（ツール → WebSocket サーバー設定）と一致させる。"
            ),
            "host": self.DEFAULT_HOST,
            "port": self.DEFAULT_PORT,
            "password": self.DEFAULT_PASSWORD,
            "timeout": self.DEFAULT_TIMEOUT,
        }

    def _write_default_obs_config(self, config_path: Path) -> None:
        config_path.parent.mkdir(parents=True, exist_ok=True)
        with open(config_path, "w", encoding="utf-8", newline="\n") as f:
            json.dump(self._default_obs_config(), f, ensure_ascii=False, indent=2)
            f.write("\n")

    def _migrate_legacy_obs_config(self, config_path: Path) -> bool:
        legacy_path = self._legacy_obs_config_path()
        if config_path.exists() or not legacy_path.exists():
            return False
        try:
            config_path.parent.mkdir(parents=True, exist_ok=True)
            legacy_path.replace(config_path)
            return True
        except OSError:
            return False

    def _load_or_create_config(self) -> dict[str, Any]:
        """設定ファイルがあればそれを読む。無ければデフォルトを書き出す。"""
        config_path = self._obs_config_path()
        self._migrate_legacy_obs_config(config_path)
        if not config_path.exists():
            try:
                self._write_default_obs_config(config_path)
            except OSError:
                # 書き込めなくてもデフォルト値で動かす
                return self._default_obs_config()
            return self._default_obs_config()

        try:
            with open(config_path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except (json.JSONDecodeError, OSError):
            return self._default_obs_config()

        if not isinstance(data, dict):
            return self._default_obs_config()
        return data

    # ------------------------------------------------------------------ #
    # 内部ヘルパー
    # ------------------------------------------------------------------ #

    def _resolve(
        self,
        host: Optional[str] = None,
        port: Optional[int] = None,
        password: Optional[str] = None,
    ) -> tuple[str, int, str]:
        resolved_host = host or self.host
        resolved_port = int(port or self.port)
        resolved_password = self.password if password is None else password
        return resolved_host, resolved_port, resolved_password

    def _make_auth(self, password: str, salt: str, challenge: str) -> str:
        secret = base64.b64encode(
            hashlib.sha256((password + salt).encode("utf-8")).digest()
        ).decode("ascii")
        return base64.b64encode(
            hashlib.sha256((secret + challenge).encode("utf-8")).digest()
        ).decode("ascii")

    async def _recv_json(self, ws) -> dict[str, Any]:
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=self.timeout)
        except asyncio.TimeoutError as exc:
            raise ObsStudioControlError("OBS WebSocket の応答がタイムアウトしました") from exc
        except Exception as exc:
            raise ObsStudioControlError(f"OBS WebSocket の受信に失敗しました: {exc}") from exc
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ObsStudioControlError("OBS WebSocket から不正な JSON が返りました") from exc
        if not isinstance(data, dict):
            raise ObsStudioControlError("OBS WebSocket から不正な形式の応答が返りました")
        return data

    async def _identify(self, ws, password: str) -> dict[str, Any]:
        hello = await self._recv_json(ws)
        if hello.get("op") != 0:
            raise ObsStudioControlError(f"OBS WebSocket Hello を受信できません: {hello}")

        hello_data = hello.get("d") or {}
        identify_data: dict[str, Any] = {"rpcVersion": 1}
        auth = hello_data.get("authentication")
        if auth:
            if not password:
                raise ObsStudioControlError("OBS WebSocket のパスワードが必要です")
            identify_data["authentication"] = self._make_auth(
                password,
                str(auth.get("salt", "")),
                str(auth.get("challenge", "")),
            )

        try:
            await ws.send(json.dumps({"op": 1, "d": identify_data}, ensure_ascii=False))
        except Exception as exc:
            raise ObsStudioControlError(f"OBS WebSocket の認証送信に失敗しました: {exc}") from exc
        identified = await self._recv_json(ws)
        if identified.get("op") != 2:
            raise ObsStudioControlError(f"OBS WebSocket 認証に失敗しました: {identified}")
        return identified.get("d") or {}

    async def _connect(self, host: str, port: int, password: str):
        uri = f"ws://{host}:{port}"
        try:
            ws = await websockets.connect(
                uri,
                open_timeout=self.timeout,
                close_timeout=self.timeout,
                max_size=20 * 1024 * 1024,
            )
        except Exception as exc:
            raise ObsStudioControlError(
                f"OBS Studio に接続できません: {uri}"
            ) from exc
        try:
            await self._identify(ws, password)
            return ws
        except Exception:
            await ws.close()
            raise

    async def request(
        self,
        request_type: str,
        request_data: Optional[dict[str, Any]] = None,
        host: Optional[str] = None,
        port: Optional[int] = None,
        password: Optional[str] = None,
    ) -> dict[str, Any]:
        """OBS WebSocket v5 のリクエストを 1 回実行する。"""
        resolved_host, resolved_port, resolved_password = self._resolve(
            host,
            port,
            password,
        )
        ws = await self._connect(resolved_host, resolved_port, resolved_password)
        try:
            request_id = uuid.uuid4().hex
            try:
                await ws.send(json.dumps({
                    "op": 6,
                    "d": {
                        "requestType": request_type,
                        "requestId": request_id,
                        "requestData": request_data or {},
                    },
                }, ensure_ascii=False))
            except Exception as exc:
                raise ObsStudioControlError(
                    f"OBS WebSocket リクエスト送信に失敗しました: {exc}"
                ) from exc

            while True:
                message = await self._recv_json(ws)
                if message.get("op") != 7:
                    continue
                data = message.get("d") or {}
                if data.get("requestId") != request_id:
                    continue
                status = data.get("requestStatus") or {}
                if not status.get("result"):
                    comment = status.get("comment") or "OBS request failed"
                    code = status.get("code")
                    raise ObsStudioControlError(
                        f"{request_type} 失敗: {comment} (code={code})"
                    )
                return data.get("responseData") or {}
        finally:
            await ws.close()

    def parse_request_data(self, value: Optional[str | dict[str, Any]]) -> dict[str, Any]:
        """MCP 引数の JSON 文字列または dict を requestData に変換する。"""
        if value is None:
            return {}
        if isinstance(value, dict):
            return value
        stripped = value.strip()
        if not stripped:
            return {}
        try:
            loaded = json.loads(stripped)
        except json.JSONDecodeError as exc:
            raise ObsStudioControlError(
                "request_data は JSON オブジェクト文字列で指定してください"
            ) from exc
        if not isinstance(loaded, dict):
            raise ObsStudioControlError("request_data は JSON オブジェクトである必要があります")
        return loaded

    # ------------------------------------------------------------------ #
    # 公開操作
    # ------------------------------------------------------------------ #

    async def connection_info(
        self,
        host: Optional[str] = None,
        port: Optional[int] = None,
    ) -> dict[str, Any]:
        resolved_host, resolved_port, _ = self._resolve(host, port, None)
        version = await self.request("GetVersion", host=resolved_host, port=resolved_port)
        return {
            "host": resolved_host,
            "port": resolved_port,
            "connected": True,
            "obs_version": version.get("obsVersion"),
            "obs_websocket_version": version.get("obsWebSocketVersion"),
            "rpc_version": version.get("rpcVersion"),
        }

    async def status(self) -> dict[str, Any]:
        version, stats, stream, record, scene = await asyncio.gather(
            self.request("GetVersion"),
            self.request("GetStats"),
            self.request("GetStreamStatus"),
            self.request("GetRecordStatus"),
            self.request("GetCurrentProgramScene"),
        )
        return {
            "version": version,
            "stats": stats,
            "stream": stream,
            "record": record,
            "current_program_scene": scene.get("currentProgramSceneName"),
        }

    async def scene_list(self) -> dict[str, Any]:
        return await self.request("GetSceneList")

    async def set_current_scene(self, scene_name: str) -> dict[str, Any]:
        await self.request("SetCurrentProgramScene", {"sceneName": scene_name})
        return await self.request("GetCurrentProgramScene")

    async def stream_control(self, action: str) -> dict[str, Any]:
        normalized = action.lower()
        request_type = {
            "start": "StartStream",
            "stop": "StopStream",
            "toggle": "ToggleStream",
        }.get(normalized)
        if request_type is None:
            raise ObsStudioControlError("action は start / stop / toggle のいずれかです")
        await self.request(request_type)
        return await self.request("GetStreamStatus")

    async def record_control(self, action: str) -> dict[str, Any]:
        normalized = action.lower()
        request_type = {
            "start": "StartRecord",
            "stop": "StopRecord",
            "toggle": "ToggleRecord",
            "pause": "PauseRecord",
            "resume": "ResumeRecord",
        }.get(normalized)
        if request_type is None:
            raise ObsStudioControlError(
                "action は start / stop / toggle / pause / resume のいずれかです"
            )
        await self.request(request_type)
        return await self.request("GetRecordStatus")

    async def set_scene_item_enabled(
        self,
        scene_name: str,
        source_name: str,
        enabled: bool,
    ) -> dict[str, Any]:
        item = await self.request(
            "GetSceneItemId",
            {"sceneName": scene_name, "sourceName": source_name},
        )
        scene_item_id = item.get("sceneItemId")
        await self.request(
            "SetSceneItemEnabled",
            {
                "sceneName": scene_name,
                "sceneItemId": scene_item_id,
                "sceneItemEnabled": enabled,
            },
        )
        return {
            "sceneName": scene_name,
            "sourceName": source_name,
            "sceneItemId": scene_item_id,
            "sceneItemEnabled": enabled,
        }

    # ------------------------------------------------------------------ #
    # 起動時接続確認
    # ------------------------------------------------------------------ #

    def _check_startup_sync(self) -> dict[str, Any]:
        """同期コンテキストから接続/認証を確認する。失敗しても例外は出さない。"""
        try:
            try:
                asyncio.get_running_loop()
            except RuntimeError:
                return asyncio.run(self._check_startup_async())

            result: dict[str, Any] = {}
            error: list[BaseException] = []

            def runner() -> None:
                try:
                    result.update(asyncio.run(self._check_startup_async()))
                except BaseException as exc:
                    error.append(exc)

            thread = threading.Thread(target=runner, daemon=True)
            thread.start()
            thread.join()
            if error:
                raise error[0]
            return result
        except Exception as e:
            msg = f"起動時接続確認で予期せぬ例外: {e}"
            logger.warning(f"OBS WebSocket: {msg} ({self.host}:{self.port})")
            return {
                "ok": False,
                "host": self.host,
                "port": self.port,
                "error": msg,
            }

    async def _check_startup_async(self) -> dict[str, Any]:
        try:
            info = await self.connection_info()
            result = {
                "ok": True,
                "host": self.host,
                "port": self.port,
                "obs_version": info.get("obs_version"),
                "obs_websocket_version": info.get("obs_websocket_version"),
                "rpc_version": info.get("rpc_version"),
            }
            logger.info(
                f"OBS WebSocket OK: {self.host}:{self.port} "
                f"(obs={result['obs_version']}, ws={result['obs_websocket_version']})"
            )
            return result
        except ObsStudioControlError as e:
            logger.warning(
                f"OBS WebSocket 接続/認証失敗: {self.host}:{self.port} — {e}"
            )
            return {
                "ok": False,
                "host": self.host,
                "port": self.port,
                "error": str(e),
            }

    def get_startup_status(self) -> dict[str, Any]:
        """起動時に確認した接続/認証状態を返す。"""
        return dict(self.startup_status)

    async def set_input_mute(self, input_name: str, muted: bool) -> dict[str, Any]:
        await self.request("SetInputMute", {"inputName": input_name, "inputMuted": muted})
        result = await self.request("GetInputMute", {"inputName": input_name})
        return {"inputName": input_name, **result}
