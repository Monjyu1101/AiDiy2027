#!/usr/bin/env python

# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

# -*- coding: utf-8 -*-

"""Codex 向け stdio <-> SSE MCP ブリッジ。

Codex からは local stdio MCP server として見せつつ、
実体の MCP サーバーは backend_tools/tools_main.py が提供する
SSE エンドポイントへ接続して中継する。
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from contextlib import AsyncExitStack
from typing import Any

_起動元PID = os.getppid()

import anyio
import httpx2

import mcp.types as types
from mcp import ClientSession
from mcp.client.sse import sse_client
from mcp.server.lowlevel import NotificationOptions, Server
from mcp.server.models import InitializationOptions
from mcp.server.stdio import stdio_server

from log_config import get_logger, setup_logging

DEFAULT_HOST = "127.0.0.1"
PORT_TOOLS = 8095
DEFAULT_MOUNT_PATH = "/aidiy_chrome_devtools/sse"

setup_logging()
logger = get_logger(__name__)


def _mcp_model_to_dict(value: Any) -> dict[str, Any] | None:
    """MCP SDK の params/meta モデルを ClientSession 向けの dict に揃える。"""
    if value is None:
        return None
    if isinstance(value, dict):
        return value or None
    if hasattr(value, "model_dump"):
        dumped = value.model_dump(by_alias=True, exclude_none=True)
        return dumped or None
    if hasattr(value, "dict"):
        dumped = value.dict(by_alias=True, exclude_none=True)
        return dumped or None
    return dict(value)


def build_default_sse_url(host: str, port: int, mount_path: str) -> str:
    normalized_path = mount_path if mount_path.startswith("/") else f"/{mount_path}"
    return f"http://{host}:{port}{normalized_path}"


def create_local_http_client(
    headers: dict[str, str] | None = None,
    timeout: httpx2.Timeout | None = None,
    auth: httpx2.Auth | None = None,
) -> httpx2.AsyncClient:
    """localhost SSE への接続で環境由来の proxy 設定を踏まない。"""
    kwargs: dict[str, Any] = {
        "follow_redirects": True,
        "trust_env": False,
        "timeout": timeout or httpx2.Timeout(30.0, read=300.0),
    }
    if headers is not None:
        kwargs["headers"] = headers
    if auth is not None:
        kwargs["auth"] = auth
    return httpx2.AsyncClient(**kwargs)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Codex 用 stdio <-> backend_tools(SSE) ブリッジ",
    )
    parser.add_argument(
        "--sse-url",
        default=os.environ.get("AIDIY_MCP_SSE_URL"),
        help="接続先の backend_tools SSE URL",
    )
    parser.add_argument(
        "--host",
        default=os.environ.get("AIDIY_MCP_HOST", DEFAULT_HOST),
        help=f"SSE URL 未指定時のホスト名。既定値: {DEFAULT_HOST}",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("AIDIY_MCP_PORT", str(PORT_TOOLS))),
        help=f"SSE URL 未指定時のポート番号。既定値: {PORT_TOOLS}",
    )
    parser.add_argument(
        "--mount-path",
        default=os.environ.get("AIDIY_MCP_MOUNT_PATH", DEFAULT_MOUNT_PATH),
        help=f"SSE URL 未指定時のマウントパス。既定値: {DEFAULT_MOUNT_PATH}",
    )
    parser.add_argument(
        "--http-timeout",
        type=float,
        default=float(os.environ.get("AIDIY_MCP_HTTP_TIMEOUT", "5")),
        help="通常 HTTP 通信のタイムアウト秒",
    )
    parser.add_argument(
        "--sse-read-timeout",
        type=float,
        default=float(os.environ.get("AIDIY_MCP_SSE_READ_TIMEOUT", "300")),
        help="SSE 読み取りタイムアウト秒",
    )
    return parser.parse_args()


class BackendMcpBridge:
    """backend_tools の SSE サーバーへ接続する薄いクライアント。"""

    def __init__(self, sse_url: str, http_timeout: float, sse_read_timeout: float) -> None:
        self.sse_url = sse_url
        self.http_timeout = http_timeout
        self.sse_read_timeout = sse_read_timeout
        self._stack = AsyncExitStack()
        self._session: ClientSession | None = None
        self._server_info: types.Implementation | None = None
        self._lock = anyio.Lock()

    async def aclose(self) -> None:
        async with self._lock:
            await self._close_unlocked()

    async def _close_unlocked(self) -> None:
        self._session = None
        self._server_info = None
        await self._stack.aclose()
        self._stack = AsyncExitStack()

    async def connect(self) -> ClientSession:
        async with self._lock:
            if self._session is not None:
                return self._session

            logger.info("backend_tools へ接続: %s", self.sse_url)
            read_stream, write_stream = await self._stack.enter_async_context(
                sse_client(
                    self.sse_url,
                    timeout=self.http_timeout,
                    sse_read_timeout=self.sse_read_timeout,
                    httpx_client_factory=create_local_http_client,
                )
            )
            session = await self._stack.enter_async_context(ClientSession(read_stream, write_stream))
            init_result = await session.initialize()
            self._session = session
            self._server_info = init_result.server_info
            logger.info(
                "backend_tools 初期化完了: %s %s",
                init_result.server_info.name,
                init_result.server_info.version,
            )
            return session

    async def reconnect(self) -> ClientSession:
        async with self._lock:
            logger.warning("backend_tools へ再接続します")
            await self._close_unlocked()
        return await self.connect()

    @property
    def server_info(self) -> types.Implementation | None:
        return self._server_info

    async def _invoke(self, method_name: str, *args, **kwargs):
        last_error: Exception | None = None
        for attempt in range(2):
            session = await (self.reconnect() if attempt > 0 else self.connect())
            method = getattr(session, method_name)
            try:
                return await method(*args, **kwargs)
            except Exception as exc:
                last_error = exc
                logger.warning(
                    "backend_tools 呼び出し失敗 (%s, attempt=%s): %s",
                    method_name,
                    attempt + 1,
                    exc,
                )
        raise RuntimeError(f"backend_tools との通信に失敗しました: {method_name}") from last_error

    async def list_tools(self, params: types.PaginatedRequestParams | None) -> types.ListToolsResult:
        return await self._invoke("list_tools", params=params)

    async def call_tool(
        self,
        name: str,
        arguments: dict | None,
        meta: dict[str, object] | object | None,
        input_responses=None,
        request_state: str | None = None,
    ):
        return await self._invoke(
            "call_tool",
            name=name,
            arguments=arguments,
            meta=_mcp_model_to_dict(meta),
            input_responses=input_responses,
            request_state=request_state,
            allow_input_required=True,
        )

    async def list_prompts(self, params: types.PaginatedRequestParams | None) -> types.ListPromptsResult:
        return await self._invoke("list_prompts", params=params)

    async def get_prompt(
        self,
        name: str,
        arguments: dict[str, str] | None,
        input_responses=None,
        request_state: str | None = None,
    ):
        return await self._invoke(
            "get_prompt",
            name=name,
            arguments=arguments,
            input_responses=input_responses,
            request_state=request_state,
            allow_input_required=True,
        )

    async def list_resources(self, params: types.PaginatedRequestParams | None) -> types.ListResourcesResult:
        return await self._invoke("list_resources", params=params)

    async def list_resource_templates(
        self,
        params: types.PaginatedRequestParams | None,
    ) -> types.ListResourceTemplatesResult:
        return await self._invoke("list_resource_templates", params=params)

    async def read_resource(self, uri: str, input_responses=None, request_state: str | None = None):
        return await self._invoke(
            "read_resource",
            uri=uri,
            input_responses=input_responses,
            request_state=request_state,
            allow_input_required=True,
        )


def create_proxy_server(bridge: BackendMcpBridge) -> Server:
    async def handle_list_tools(_ctx, params: types.PaginatedRequestParams | None):
        return await bridge.list_tools(params)

    async def handle_call_tool(_ctx, params: types.CallToolRequestParams):
        return await bridge.call_tool(
            name=params.name,
            arguments=params.arguments,
            meta=params.meta,
            input_responses=params.input_responses,
            request_state=params.request_state,
        )

    async def handle_list_prompts(_ctx, params: types.PaginatedRequestParams | None):
        return await bridge.list_prompts(params)

    async def handle_get_prompt(_ctx, params: types.GetPromptRequestParams):
        return await bridge.get_prompt(
            params.name,
            params.arguments,
            input_responses=params.input_responses,
            request_state=params.request_state,
        )

    async def handle_list_resources(_ctx, params: types.PaginatedRequestParams | None):
        return await bridge.list_resources(params)

    async def handle_list_resource_templates(_ctx, params: types.PaginatedRequestParams | None):
        return await bridge.list_resource_templates(params)

    async def handle_read_resource(_ctx, params: types.ReadResourceRequestParams):
        return await bridge.read_resource(
            str(params.uri),
            input_responses=params.input_responses,
            request_state=params.request_state,
        )

    return Server(
        name="aidiy_chrome_devtools_stdio",
        version="0.1.0",
        instructions="Codex 用の stdio ブリッジ。実体のツールは backend_tools(SSE) 側で提供する。",
        on_list_tools=handle_list_tools,
        on_call_tool=handle_call_tool,
        on_list_prompts=handle_list_prompts,
        on_get_prompt=handle_get_prompt,
        on_list_resources=handle_list_resources,
        on_list_resource_templates=handle_list_resource_templates,
        on_read_resource=handle_read_resource,
    )


async def async_main() -> None:
    args = parse_args()
    sse_url = args.sse_url or build_default_sse_url(args.host, args.port, args.mount_path)
    bridge = BackendMcpBridge(
        sse_url=sse_url,
        http_timeout=args.http_timeout,
        sse_read_timeout=args.sse_read_timeout,
    )

    try:
        await bridge.connect()
        upstream_info = bridge.server_info
        server = create_proxy_server(bridge)

        init_options = InitializationOptions(
            server_name=server.name,
            server_version=server.version or "0.1.0",
            capabilities=server.get_capabilities(
                notification_options=NotificationOptions(),
                experimental_capabilities={},
            ),
            instructions=(
                f"Codex 用 stdio ブリッジ。"
                f" 実体は {upstream_info.name if upstream_info else 'backend_tools'}"
                f" {upstream_info.version if upstream_info else ''} を利用。"
            ).strip(),
        )

        async with stdio_server() as (read_stream, write_stream):
            await server.run(read_stream, write_stream, init_options)
    finally:
        await bridge.aclose()


def main() -> None:
    from tools_proc.process_lifetime import guard_parent
    guard_parent(_起動元PID)
    try:
        anyio.run(async_main)
    except KeyboardInterrupt:
        logger.info("mcp_stdio を終了します")
    except Exception as exc:
        logging.getLogger(__name__).exception("mcp_stdio 起動失敗: %s", exc)
        raise


if __name__ == "__main__":
    main()
