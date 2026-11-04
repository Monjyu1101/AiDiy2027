# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""
AiDiy MCP サーバー エントリポイント

SSE / Streamable HTTP / HTTP POST を 1 ポート (8095) で提供する。
MCP ツールの実装は tools_proc/tools_*.py に分割してある。
"""

import logging
import os
import sys
import threading
import time
from contextlib import AsyncExitStack, asynccontextmanager
from collections.abc import AsyncIterator
from typing import Optional

# UTF-8出力を強制（Windows文字化け対策）
if sys.platform == "win32":
    os.environ["PYTHONIOENCODING"] = "utf-8"
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.requests import Request
from fastapi import Response
from fastapi.routing import APIRoute
from starlette.applications import Starlette
from starlette.requests import ClientDisconnect
from starlette.routing import Route
import mcp.server.streamable_http_manager as http_manager
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError, UnexpectedToolError
from mcp.server.streamable_http_manager import (
    StreamableHTTPASGIApp,
    StreamableHTTPSessionManager,
)
from mcp.types import LATEST_PROTOCOL_VERSION

from log_config import setup_logging, get_logger
from tools_proc.chrome_sessions import ChromeSessionRegistry
from tools_proc.chrome_devtools import ChromeDevToolsError
from tools_proc.desktop_capture import DesktopCapture
if sys.platform == "win32":
    from tools_proc.windows_control import WindowsControl
from tools_proc.sqlite_query import SqliteQuery
from tools_proc.postgres_query import PgQuery, PgQueryError
from tools_proc.log_tailer import LogTailer
from tools_proc.code_checker import CodeChecker
from tools_proc.backup import BackupCheck, BackupSave
from tools_proc.image_generation import ImageGeneration
from tools_proc.movie_generation import MovieGeneration
from tools_proc.speech_to_text import SpeechToText
from tools_proc.text_to_speech import TextToSpeech
from tools_proc.tools_settings import load_tools_settings
from tools_proc.tools_management import ToolsManagement, ToolsGateMiddleware, register_management

tools_management = ToolsManagement()
from tools_proc.obs_studio_control import ObsStudioControl
from tools_proc.ffmpeg_control import FfmpegControl
from tools_proc.notification_sounds import NotificationSounds
from tools_proc.code_agents import CodeAgents
from tools_proc.chat_llm import ChatLLM
from tools_proc.decisions_check import Decision
from tools_proc.task_agents import TaskAgents
from tools_proc.team_agents import TeamAgents

from tools_proc import tools_chrome, tools_desktop, tools_db, tools_dev
from tools_proc import tools_backup, tools_media, tools_obs, tools_ffmpeg
from tools_proc import tools_notification_sounds, tools_agents, tools_chat
from tools_proc import tools_task_agents, tools_team_agents
from tools_proc import tools_decisions
if sys.platform == "win32":
    from tools_proc import tools_windows_control

setup_logging()
logger = get_logger(__name__)
# MCP SDK の Streamable HTTP 管理ログは、実際に使用するロガー自体を
# 短い名前へ差し替える。表示時だけ別名にする不一致は作らない。
http_manager.logger = get_logger("http_manager")


class _StreamableHTTPLogFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str):
            record.msg = record.msg.replace("StreamableHTTP session", "Streamable HTTP session")
        return True


http_manager.logger.addFilter(_StreamableHTTPLogFilter())

# 呼び出されたツール名をログに出力する（"Processing request of type CallToolRequest" の代替）
_original_mcpserver_call_tool = MCPServer.call_tool


_LOG_PARAM_MAX_LEN = 50


def _summarize_arguments(arguments: dict, max_keys: int = 3) -> str:
    """ログ表示用に主要パラメータのみを短縮して文字列化する。"""
    if not arguments:
        return ""

    parts = []
    for key, value in list(arguments.items())[:max_keys]:
        text = str(value)
        if len(text) > _LOG_PARAM_MAX_LEN:
            text = text[:_LOG_PARAM_MAX_LEN] + "..."
        parts.append(f"{key}={text}")

    omitted = len(arguments) - max_keys
    if omitted > 0:
        parts.append(f"...(他{omitted}件)")

    return ", ".join(parts)


async def _logged_call_tool(self: MCPServer, name: str, arguments: dict, context=None):
    logger.info("ツール呼び出し: %s / %s (%s)", self.name, name, _summarize_arguments(arguments))
    try:
        return await _original_mcpserver_call_tool(self, name, arguments, context)
    except UnexpectedToolError as exc:
        # CDP の接続・操作・JavaScript 実行エラーは、利用状況や入力内容から
        # 起こり得る既知の失敗。MCP SDK のクラッシュ扱い（ERROR + traceback）
        # ではなく ToolError（INFO + 呼び出し側へ具体的理由を返す）に変換する。
        cause = exc.__cause__
        while cause is not None:
            if isinstance(cause, ChromeDevToolsError):
                raise ToolError(str(cause)) from cause
            cause = cause.__cause__
        raise


MCPServer.call_tool = _logged_call_tool

# ------------------------------------------------------------------ #
# 設定
# ------------------------------------------------------------------ #

CHROME_PORT = int(os.environ.get("CHROME_DEBUG_PORT", "9222"))
PORT_TOOLS  = int(os.environ.get("PORT_TOOLS", os.environ.get("MCP_PORT", "8095")))
MOUNT       = os.environ.get("MCP_MOUNT_PATH", "/aidiy_chrome_devtools")
MOUNT_DC    = os.environ.get("MCP_DC_MOUNT_PATH", "/aidiy_desktop_capture")
MOUNT_SQ    = os.environ.get("MCP_SQ_MOUNT_PATH", "/aidiy_sqlite")
MOUNT_PG    = os.environ.get("MCP_PG_MOUNT_PATH", "/aidiy_postgres")
MOUNT_LG    = os.environ.get("MCP_LG_MOUNT_PATH", "/aidiy_logs")
MOUNT_CC    = os.environ.get("MCP_CC_MOUNT_PATH", "/aidiy_code_check")
MOUNT_BK    = os.environ.get("MCP_BK_MOUNT_PATH", "/aidiy_backup")
MOUNT_IG    = os.environ.get("MCP_IG_MOUNT_PATH", "/aidiy_image_generation")
MOUNT_MG    = os.environ.get("MCP_MG_MOUNT_PATH", "/aidiy_movie_generation")
MOUNT_ST    = os.environ.get("MCP_ST_MOUNT_PATH", "/aidiy_speech_to_text")
MOUNT_TS    = os.environ.get("MCP_TS_MOUNT_PATH", "/aidiy_text_to_speech")
MOUNT_OB    = os.environ.get("MCP_OB_MOUNT_PATH", "/aidiy_obs_studio_control")
MOUNT_FF    = os.environ.get("MCP_FF_MOUNT_PATH", "/aidiy_ffmpeg_control")
MOUNT_NS    = os.environ.get("MCP_NS_MOUNT_PATH", "/aidiy_notification_sounds")
MOUNT_CA    = os.environ.get("MCP_CA_MOUNT_PATH", "/aidiy_code_agents")
MOUNT_CL    = os.environ.get("MCP_CL_MOUNT_PATH", "/aidiy_chat_llms")
MOUNT_DJ    = os.environ.get("MCP_DJ_MOUNT_PATH", "/aidiy_decisions_check")
MOUNT_TA    = os.environ.get("MCP_TA_MOUNT_PATH", "/aidiy_task_agents")
MOUNT_TM    = os.environ.get("MCP_TM_MOUNT_PATH", "/aidiy_team_agents")
MOUNT_WC    = os.environ.get("MCP_WC_MOUNT_PATH", "/aidiy_windows_control")

# ------------------------------------------------------------------ #
# サービスインスタンス生成
# ------------------------------------------------------------------ #

chrome_sessions = ChromeSessionRegistry(default_port=CHROME_PORT)
capture     = DesktopCapture()
if sys.platform == "win32":
    winctl = WindowsControl()
sqlite_q    = SqliteQuery()
log_t       = LogTailer()
checker     = CodeChecker()
bchk        = BackupCheck()
bsave       = BackupSave()
ig          = ImageGeneration()
mg          = MovieGeneration()
stt         = SpeechToText()
tts         = TextToSpeech()
obs         = ObsStudioControl()
ffmpeg_c    = FfmpegControl()
ns          = NotificationSounds(tts=tts)
ns.tts_available = lambda: tools_management.active("aidiy_text_to_speech")
code_agents = CodeAgents()
code_agents.version_info = code_agents._check_ai_versions()
chat_llm    = ChatLLM()
chat_llm.version_info = chat_llm._check_ai_versions()
decisions   = Decision()
task_agents = TaskAgents()
team_agents = TeamAgents()

# PostgreSQL は psycopg 未導入環境でもサーバー起動を阻害しないよう遅延初期化
_pg_q: Optional[PgQuery] = None
_pg_init_error: Optional[str] = None
try:
    _pg_q = PgQuery()
except PgQueryError as _e:
    _pg_init_error = str(_e)


def _get_pg() -> PgQuery:
    if _pg_q is None:
        raise ValueError(
            f"aidiy_postgres は初期化されていません: {_pg_init_error or '未知の理由'}"
        )
    return _pg_q

# ------------------------------------------------------------------ #
# 再起動フラグ監視
# ------------------------------------------------------------------ #

def _setup_reboot_watcher():
    temp_dir = os.path.join(os.path.dirname(__file__), "temp")
    os.makedirs(temp_dir, exist_ok=True)
    reboot_path = os.path.join(temp_dir, "reboot_tools.txt")
    if os.path.isfile(reboot_path):
        try:
            os.remove(reboot_path)
        except Exception:
            pass
        raise SystemExit("reboot_tools.txt detected")
    def watcher():
        while True:
            try:
                if os.path.isfile(reboot_path):
                    try:
                        os.remove(reboot_path)
                    except Exception:
                        pass
                    os._exit(0)
            except Exception:
                pass
            time.sleep(1)
    threading.Thread(target=watcher, daemon=True).start()

_setup_reboot_watcher()

# ------------------------------------------------------------------ #
# MCPServer インスタンス生成
# ------------------------------------------------------------------ #

def _make_mcp(name: str, *, instructions: str | None = None) -> MCPServer:
    instance = MCPServer(name, version="1.0.0", description=instructions, instructions=instructions, warn_on_duplicate_tools=False)
    original_tool = instance.tool
    def guarded_tool(*args, **kwargs):
        return tools_management.decorate(name, original_tool(*args, **kwargs))
    instance.tool = guarded_tool
    return instance

mcp    = _make_mcp("aidiy_chrome_devtools")
mcp_dc = _make_mcp("aidiy_desktop_capture")
mcp_sq = _make_mcp("aidiy_sqlite")
mcp_pg = _make_mcp("aidiy_postgres")
mcp_lg = _make_mcp("aidiy_logs")
mcp_cc = _make_mcp("aidiy_code_check")
mcp_bk = _make_mcp("aidiy_backup")
mcp_ig = _make_mcp("aidiy_image_generation")
mcp_mg = _make_mcp("aidiy_movie_generation")
mcp_st = _make_mcp("aidiy_speech_to_text")
mcp_ts = _make_mcp("aidiy_text_to_speech")
mcp_ob = _make_mcp("aidiy_obs_studio_control")
mcp_ff = _make_mcp("aidiy_ffmpeg_control")
mcp_ns = _make_mcp("aidiy_notification_sounds")
mcp_ca = _make_mcp("aidiy_code_agents")
mcp_cl = _make_mcp("aidiy_chat_llms")
mcp_dj = _make_mcp("aidiy_decisions_check")
mcp_ta = _make_mcp("aidiy_task_agents")
mcp_tm = _make_mcp("aidiy_team_agents")
if sys.platform == "win32":
    mcp_wc = _make_mcp("aidiy_windows_control", instructions=tools_windows_control.DESCRIPTION)

# ------------------------------------------------------------------ #
# MCP ツール登録
# ------------------------------------------------------------------ #

_ensure_chrome = tools_chrome.register_tools(mcp, chrome_sessions)
tools_desktop.register_tools(mcp_dc, capture)
tools_db.register_sqlite_tools(mcp_sq, sqlite_q)
tools_db.register_postgres_tools(mcp_pg, _get_pg)
tools_dev.register_logs_tools(mcp_lg, log_t)
tools_dev.register_code_check_tools(mcp_cc, checker)
tools_backup.register_tools(mcp_bk, bsave, bchk)
tools_media.register_image_gen_tools(mcp_ig, ig)
tools_media.register_movie_gen_tools(mcp_mg, mg)
tools_media.register_stt_tools(mcp_st, stt)
tools_media.register_tts_tools(mcp_ts, tts)
tools_obs.register_tools(mcp_ob, obs)
tools_ffmpeg.register_tools(mcp_ff, ffmpeg_c)
tools_notification_sounds.register_tools(mcp_ns, ns)
tools_agents.register_tools(mcp_ca, code_agents)
tools_chat.register_tools(mcp_cl, chat_llm)
# AI判断は lifespan の実行チェック完了後に登録する。
tools_task_agents.register_tools(mcp_ta, task_agents)
tools_team_agents.register_tools(mcp_tm, team_agents)
if sys.platform == "win32":
    tools_windows_control.register_tools(mcp_wc, winctl)

# TTS description を API キー状況に応じて動的設定
mcp_ts._tool_manager._tools["synthesize_speech"].description = tts.get_description()

# ------------------------------------------------------------------ #
# SSE + Streamable HTTP を同一マウントに合成
# GET /sse + POST /messages/ = 従来 SSE（Claude / stdio / Python sse_client）
# POST|DELETE /sse と /mcp    = Streamable HTTP
#   Grok の type=sse は initialize を /sse へ POST する
# ------------------------------------------------------------------ #

def _ensure_session_manager(mcp_instance: MCPServer) -> StreamableHTTPSessionManager:
    try:
        return mcp_instance.session_manager
    except RuntimeError:
        # MCP 2.x は streamable_http_app() の生成時に session manager を初期化する。
        mcp_instance.streamable_http_app(
            streamable_http_path="/mcp",
            host="127.0.0.1",
        )
        return mcp_instance.session_manager


def _mcp_transport_app(mcp_instance: MCPServer) -> Starlette:
    sse_starlette = mcp_instance.sse_app(
        sse_path="/sse",
        message_path="/messages/",
        host="127.0.0.1",
    )
    http_asgi = StreamableHTTPASGIApp(_ensure_session_manager(mcp_instance))
    return Starlette(
        debug=False,
        routes=[
            Route("/sse", endpoint=http_asgi, methods=["POST", "DELETE"]),
            *list(sse_starlette.routes),
            Route("/mcp", endpoint=http_asgi),
        ],
    )


def _dispatch_streamable_http(mcp_name: str, path: str, method: str):
    """REST の {method_name} より先に Streamable HTTP へ渡すパスなら ASGI を返す。"""
    inst = MCP_MAP.get(mcp_name)
    if inst is None:
        return None
    if path in (f"/{mcp_name}/sse", f"/{mcp_name}/sse/") and method in ("POST", "DELETE"):
        return StreamableHTTPASGIApp(_ensure_session_manager(inst))
    if path in (f"/{mcp_name}/mcp", f"/{mcp_name}/mcp/"):
        return StreamableHTTPASGIApp(_ensure_session_manager(inst))
    return None


class _McpTransportMiddleware:
    """POST /{mcp}/sse が REST の {method_name} に吸われないようにする。"""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            path = scope.get("path", "")
            method = scope.get("method", "").upper()
            for mcp_name in MCP_MAP:
                prefix = f"/{mcp_name}/"
                if path == f"/{mcp_name}" or path.startswith(prefix):
                    asgi = _dispatch_streamable_http(mcp_name, path, method)
                    if asgi is not None:
                        await asgi(scope, receive, send)
                        return
                    break
        await self.app(scope, receive, send)


class _ClientDisconnectMiddleware:
    """要求受信中のクライアント切断をサーバー障害として記録しない。"""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        try:
            await self.app(scope, receive, send)
        except ClientDisconnect:
            if scope.get("type") != "http":
                raise
            logger.info(
                "クライアントが要求送信中に切断しました（正常終了扱い）: %s %s",
                scope.get("method", ""),
                scope.get("path", ""),
            )


@asynccontextmanager
async def _mcp_lifespan(_app: FastAPI) -> AsyncIterator[None]:
    settings = load_tools_settings()
    for name, instance in (("text_to_speech", tts), ("speech_to_text", stt),
                           ("image_generation", ig), ("movie_generation", mg)):
        for field, value in settings[name].items():
            setattr(instance, field, value)
    tools_management.initialize({"text_to_speech": tts, "speech_to_text": stt,
                                 "image_generation": ig, "movie_generation": mg})
    await tools_decisions.check_startup(decisions)
    tools_decisions.register_tools(mcp_dj, decisions)
    async with AsyncExitStack() as stack:
        for inst in MCP_MAP.values():
            await stack.enter_async_context(_ensure_session_manager(inst).run())
        logger.info("Streamable HTTP session manager を %d 本起動しました", len(MCP_MAP))
        yield


# ------------------------------------------------------------------ #
# FastAPI アプリ
# ------------------------------------------------------------------ #

def _unique_op_id(route: APIRoute) -> str:
    """タグ + 関数名でユニークな operationId を生成する"""
    tag = route.tags[0] if route.tags else "root"
    return f"{tag}_{route.name}"

app = FastAPI(
    title="AiDiy TOOLs Server",
    description=(
        "AiDiy MCP サーバー — Chrome DevTools / Desktop Capture / SQLite / PostgreSQL / "
        "Logs / Code Check / Backup / Image Generation / Movie Generation / "
        "Speech-to-Text / Text-to-Speech / OBS Studio / FFmpeg / Code Agents / Chat LLM / "
        "Decisions Check / Task Agents / Team Agents / Notification Sounds"
        + (" / Windows Control" if sys.platform == "win32" else "")
        + f" の {20 if sys.platform == 'win32' else 19} MCP ツールを HTTP POST で直接呼び出せます。\n\n"
        + "加えて OpenAI / Ollama 互換の標準チャットインターフェース "
        "`POST /aidiy_chat_completions/v1/chat/completions` を提供します。\n\n"
        "各 MCP のツール一覧と引数仕様は `GET /{mcp_name}/list` を参照してください。"
    ),
    version="1.0.0",
    generate_unique_id_function=_unique_op_id,
    lifespan=_mcp_lifespan,
)
from tools_proc.live_model_check import register_live_model_check
register_live_model_check(app)
from tools_proc.tools_prediction import register_prediction_llms
register_prediction_llms(app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(_McpTransportMiddleware)
# Starlette は後から追加したミドルウェアが外側になる。MCP のマウント先を
# 含む全 HTTP 経路から上がる ClientDisconnect を最外周で処理する。
app.add_middleware(_ClientDisconnectMiddleware)

# ------------------------------------------------------------------ #
# MCP_MAP: initialize / list / ping 共通エンドポイント用
# ------------------------------------------------------------------ #

MCP_MAP: dict = {}  # mcp_name -> MCPServer instance (下部で設定)


@app.get("/")
async def root() -> Response:
    import json
    return Response(
        json.dumps({"mcps": list(MCP_MAP.keys())}, ensure_ascii=False),
        media_type="application/json",
    )


def _register_mcp_http_meta(mcp_name: str, mcp_instance) -> None:
    """initialize / list / ping の3エンドポイントを登録"""

    @app.post(f"/{mcp_name}/initialize", tags=[mcp_name],
              summary=f"{mcp_name} — MCP 初期化",
              operation_id=f"{mcp_name}_initialize")
    async def _initialize():
        return {
            "protocolVersion": LATEST_PROTOCOL_VERSION,
            "serverInfo": {"name": mcp_name, "version": mcp_instance.version},
            "capabilities": {"tools": {}},
            "instructions": mcp_instance.instructions,
        }

    @app.get(f"/{mcp_name}/list", tags=[mcp_name],
             summary=f"{mcp_name} — ツール一覧",
             operation_id=f"{mcp_name}_list")
    async def _list():
        tools = [
            {
                "name": name,
                "description": tool.description or "",
                "inputSchema": tool.parameters if hasattr(tool, "parameters") else {},
            }
            for name, tool in mcp_instance._tool_manager._tools.items()
        ]
        return {"tools": tools}

    @app.get(f"/{mcp_name}/ping", tags=[mcp_name],
             summary=f"{mcp_name} — 疎通確認",
             operation_id=f"{mcp_name}_ping")
    async def _ping():
        return {"status": "ok", "name": mcp_name}


# ------------------------------------------------------------------ #
# MCP_MAP と initialize / list / ping の共通エンドポイントを先に登録
# 汎用の /{method_name} REST ルートより前に置き、静的パスを優先する。
# ------------------------------------------------------------------ #

MCP_MAP.update({
    "aidiy_chrome_devtools":    mcp,
    "aidiy_desktop_capture":    mcp_dc,
    "aidiy_sqlite":             mcp_sq,
    "aidiy_postgres":           mcp_pg,
    "aidiy_logs":               mcp_lg,
    "aidiy_code_check":         mcp_cc,
    "aidiy_backup":             mcp_bk,
    "aidiy_image_generation":   mcp_ig,
    "aidiy_movie_generation":   mcp_mg,
    "aidiy_speech_to_text":     mcp_st,
    "aidiy_text_to_speech":     mcp_ts,
    "aidiy_obs_studio_control": mcp_ob,
    "aidiy_ffmpeg_control":     mcp_ff,
    "aidiy_notification_sounds": mcp_ns,
    "aidiy_code_agents":        mcp_ca,
    "aidiy_chat_llms":          mcp_cl,
    "aidiy_decisions_check":    mcp_dj,
    "aidiy_task_agents":        mcp_ta,
    "aidiy_team_agents":        mcp_tm,
})
if sys.platform == "win32":
    MCP_MAP["aidiy_windows_control"] = mcp_wc
from tools_proc.chrome_manager import ChromeManager
for _name in MCP_MAP:
    tools_management.availability[_name] = lambda: True
tools_management.availability["aidiy_chrome_devtools"] = lambda: bool(ChromeManager().find_chrome())
tools_management.availability["aidiy_ffmpeg_control"] = lambda: bool(ffmpeg_c.version_info.get("ffmpeg", {}).get("ok"))
# OBS is a registered client; startup connection snapshots are not an installation gate.
tools_management.availability["aidiy_postgres"] = lambda: _pg_q is not None
tools_management.availability["aidiy_desktop_capture"] = lambda: sys.platform in ("win32", "darwin") or bool(os.environ.get("DISPLAY"))
register_management(app, tools_management)
app.add_middleware(ToolsGateMiddleware, manager=tools_management)

for _mcp_name, _mcp_instance in MCP_MAP.items():
    _register_mcp_http_meta(_mcp_name, _mcp_instance)

# ------------------------------------------------------------------ #
# HTTP ルート登録
# ------------------------------------------------------------------ #

app.include_router(tools_chrome.create_router(chrome_sessions, _ensure_chrome))
app.include_router(tools_desktop.create_router(capture))
app.include_router(tools_db.create_sqlite_router(sqlite_q))
app.include_router(tools_db.create_postgres_router(_get_pg))
app.include_router(tools_dev.create_logs_router(log_t))
app.include_router(tools_dev.create_code_check_router(checker))
app.include_router(tools_backup.create_router(bsave, bchk))
app.include_router(tools_media.create_router(ig, mg, stt, tts))
app.include_router(tools_obs.create_router(obs))
app.include_router(tools_ffmpeg.create_router(ffmpeg_c))
app.include_router(tools_notification_sounds.create_router(ns))
app.include_router(tools_agents.create_router(code_agents))
app.include_router(tools_chat.create_router(chat_llm))
app.include_router(tools_decisions.create_router(decisions))
app.include_router(tools_task_agents.create_router(task_agents))
app.include_router(tools_team_agents.create_router(team_agents))
if sys.platform == "win32":
    app.include_router(tools_windows_control.create_router(winctl))
app.include_router(tools_chat.create_completions_router(chat_llm))

# ------------------------------------------------------------------ #
# MCP SSE / Streamable HTTP サーバーをサブパスにマウント
# ------------------------------------------------------------------ #

app.mount(MOUNT,    _mcp_transport_app(mcp))
app.mount(MOUNT_DC, _mcp_transport_app(mcp_dc))
app.mount(MOUNT_SQ, _mcp_transport_app(mcp_sq))
app.mount(MOUNT_PG, _mcp_transport_app(mcp_pg))
app.mount(MOUNT_LG, _mcp_transport_app(mcp_lg))
app.mount(MOUNT_CC, _mcp_transport_app(mcp_cc))
app.mount(MOUNT_BK, _mcp_transport_app(mcp_bk))
app.mount(MOUNT_IG, _mcp_transport_app(mcp_ig))
app.mount(MOUNT_MG, _mcp_transport_app(mcp_mg))
app.mount(MOUNT_ST, _mcp_transport_app(mcp_st))
app.mount(MOUNT_TS, _mcp_transport_app(mcp_ts))
app.mount(MOUNT_OB, _mcp_transport_app(mcp_ob))
app.mount(MOUNT_FF, _mcp_transport_app(mcp_ff))
app.mount(MOUNT_NS, _mcp_transport_app(mcp_ns))
app.mount(MOUNT_CA, _mcp_transport_app(mcp_ca))
app.mount(MOUNT_CL, _mcp_transport_app(mcp_cl))
app.mount(MOUNT_DJ, _mcp_transport_app(mcp_dj))
app.mount(MOUNT_TA, _mcp_transport_app(mcp_ta))
app.mount(MOUNT_TM, _mcp_transport_app(mcp_tm))
if sys.platform == "win32":
    app.mount(MOUNT_WC, _mcp_transport_app(mcp_wc))

# ------------------------------------------------------------------ #
# OpenAPI パス順序カスタマイズ
# 各 MCP を docs → initialize → list → ping → {method_name} の順に統一
# ------------------------------------------------------------------ #

def _build_custom_openapi():
    from fastapi.openapi.utils import get_openapi
    if app.openapi_schema:
        return app.openapi_schema

    schema = get_openapi(
        title=app.title,
        version=app.version,
        description=app.description,
        routes=app.routes,
    )

    paths = schema.get("paths", {})
    ordered: dict = {}

    if "/" in paths:
        ordered["/"] = paths["/"]

    _PRIORITY = ["docs", "initialize", "list", "ping"]
    for mcp_name in MCP_MAP:
        for suffix in _PRIORITY:
            key = f"/{mcp_name}/{suffix}"
            if key in paths:
                ordered[key] = paths[key]
        # その他（save/{method_name}, check/{method_name} など）
        for key in paths:
            if key.startswith(f"/{mcp_name}/") and key not in ordered:
                ordered[key] = paths[key]

    for key, val in paths.items():
        if key not in ordered:
            ordered[key] = val

    schema["paths"] = ordered
    app.openapi_schema = schema
    return schema


app.openapi = _build_custom_openapi

# ------------------------------------------------------------------ #
# エントリポイント
# ------------------------------------------------------------------ #

if __name__ == "__main__":
    base = f"http://127.0.0.1:{PORT_TOOLS}"
    logger.info(f"MCP Index            : {base}/")
    logger.info(f"--- initialize[POST] / list[GET] / ping[GET] / {{method}}[POST] ---")
    logger.info(f"Chrome               : {base}/aidiy_chrome_devtools/  SSE:{MOUNT}/sse")
    logger.info(f"DesktopCapture       : {base}/aidiy_desktop_capture/  SSE:{MOUNT_DC}/sse")
    logger.info(f"Sqlite               : {base}/aidiy_sqlite/  SSE:{MOUNT_SQ}/sse")
    logger.info(f"Postgres             : {base}/aidiy_postgres/  SSE:{MOUNT_PG}/sse"
                + (" [psycopg 未導入]" if _pg_init_error else ""))
    logger.info(f"Logs                 : {base}/aidiy_logs/  SSE:{MOUNT_LG}/sse")
    logger.info(f"CodeCheck            : {base}/aidiy_code_check/  SSE:{MOUNT_CC}/sse")
    logger.info(f"Backup               : {base}/aidiy_backup/  SSE:{MOUNT_BK}/sse")
    logger.info(f"ImageGeneration      : {base}/aidiy_image_generation/  SSE:{MOUNT_IG}/sse")
    logger.info(f"MovieGeneration      : {base}/aidiy_movie_generation/  SSE:{MOUNT_MG}/sse")
    logger.info(f"SpeechToText         : {base}/aidiy_speech_to_text/  SSE:{MOUNT_ST}/sse")
    logger.info(f"TextToSpeech         : {base}/aidiy_text_to_speech/  SSE:{MOUNT_TS}/sse")
    logger.info(f"ObsStudioControl     : {base}/aidiy_obs_studio_control/  SSE:{MOUNT_OB}/sse")
    logger.info(f"FfmpegControl        : {base}/aidiy_ffmpeg_control/  SSE:{MOUNT_FF}/sse")
    logger.info(f"NotificationSounds   : {base}/aidiy_notification_sounds/  SSE:{MOUNT_NS}/sse")
    logger.info(f"CodeAgents           : {base}/aidiy_code_agents/  SSE:{MOUNT_CA}/sse")
    logger.info(f"ChatLLM              : {base}/aidiy_chat_llms/  SSE:{MOUNT_CL}/sse")
    logger.info(f"DecisionsCheck       : {base}/aidiy_decisions_check/  SSE:{MOUNT_DJ}/sse")
    logger.info(f"TaskAgents           : {base}/aidiy_task_agents/  SSE:{MOUNT_TA}/sse")
    logger.info(f"TeamAgents           : {base}/aidiy_team_agents/  SSE:{MOUNT_TM}/sse")
    if sys.platform == "win32":
        logger.info(f"WindowsControl       : {base}/aidiy_windows_control/  SSE:{MOUNT_WC}/sse")
    logger.info(f"ChatCompletions      : {base}/aidiy_chat_completions/v1/chat/completions [OpenAI/Ollama 互換]")
    uvicorn.run(app, host="127.0.0.1", port=PORT_TOOLS, log_level="warning", ws_max_size=int(os.environ.get("UVICORN_WS_MAX_SIZE", "20971520")))
