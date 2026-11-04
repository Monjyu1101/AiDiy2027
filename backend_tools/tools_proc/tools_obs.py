# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""aidiy_obs_studio_control MCP ツール登録 + HTTP ルート"""

import json
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

from log_config import get_logger
from tools_proc.obs_studio_control import ObsStudioControlError

logger = get_logger(__name__)


class ObsRequest(BaseModel):
    host: Optional[str] = None
    port: Optional[int] = None
    request_type: Optional[str] = None
    request_data: Optional[str] = None
    scene_name: Optional[str] = None
    source_name: Optional[str] = None
    visible: Optional[bool] = None
    input_name: Optional[str] = None
    muted: Optional[bool] = None
    action: str = "toggle"


def register_tools(mcp_ob, obs):
    """aidiy_obs_studio_control MCP ツールを mcp_ob インスタンスに登録する"""

    @mcp_ob.tool()
    async def obs_startup_status() -> str:
        """
        MCP 起動時に確認した OBS WebSocket 接続/認証の結果（スナップショット）を返す。
        実際の接続可否は呼び出し時に判定されるため、現在の状態を見たい場合は
        obs_connection_info を使うこと。
        """
        return json.dumps(obs.get_startup_status(), ensure_ascii=False)

    @mcp_ob.tool()
    async def obs_connection_info(
        host: Optional[str] = None,
        port: Optional[int] = None,
    ) -> str:
        """
        OBS Studio WebSocket へ接続し、バージョン情報を返す。

        省略時は _config/aidiy_obs_studio_control.json の値を使う。
        """
        try:
            info = await obs.connection_info(host, port)
        except ObsStudioControlError as e:
            raise ValueError(str(e)) from e
        return json.dumps(info, ensure_ascii=False)

    @mcp_ob.tool()
    async def obs_status() -> str:
        """OBS Studio のバージョン、統計、配信、録画、現在シーンを返す。"""
        try:
            info = await obs.status()
        except ObsStudioControlError as e:
            raise ValueError(str(e)) from e
        return json.dumps(info, ensure_ascii=False)

    @mcp_ob.tool()
    async def obs_request(
        request_type: str,
        request_data: Optional[str] = None,
    ) -> str:
        """
        OBS WebSocket v5 の任意リクエストを実行する。

        Args:
            request_type: 例: GetVersion, GetSceneList, SetCurrentProgramScene
            request_data: JSON オブジェクト文字列。例: {"sceneName":"Scene"}
        """
        try:
            data = obs.parse_request_data(request_data)
            result = await obs.request(request_type, data)
        except ObsStudioControlError as e:
            raise ValueError(str(e)) from e
        return json.dumps(result, ensure_ascii=False)

    @mcp_ob.tool()
    async def obs_list_scenes() -> str:
        """OBS Studio のシーン一覧と現在シーンを返す。"""
        try:
            result = await obs.scene_list()
        except ObsStudioControlError as e:
            raise ValueError(str(e)) from e
        return json.dumps(result, ensure_ascii=False)

    @mcp_ob.tool()
    async def obs_set_current_scene(scene_name: str) -> str:
        """OBS Studio の現在シーンを切り替える。"""
        try:
            result = await obs.set_current_scene(scene_name)
        except ObsStudioControlError as e:
            raise ValueError(str(e)) from e
        return json.dumps(result, ensure_ascii=False)

    @mcp_ob.tool()
    async def obs_stream(action: str = "toggle") -> str:
        """配信を制御する。action: start / stop / toggle"""
        try:
            result = await obs.stream_control(action)
        except ObsStudioControlError as e:
            raise ValueError(str(e)) from e
        return json.dumps(result, ensure_ascii=False)

    @mcp_ob.tool()
    async def obs_record(action: str = "toggle") -> str:
        """録画を制御する。action: start / stop / toggle / pause / resume"""
        try:
            result = await obs.record_control(action)
        except ObsStudioControlError as e:
            raise ValueError(str(e)) from e
        return json.dumps(result, ensure_ascii=False)

    @mcp_ob.tool()
    async def obs_set_source_visible(
        scene_name: str,
        source_name: str,
        visible: bool,
    ) -> str:
        """指定シーン内のソース表示/非表示を切り替える。"""
        try:
            result = await obs.set_scene_item_enabled(scene_name, source_name, visible)
        except ObsStudioControlError as e:
            raise ValueError(str(e)) from e
        return json.dumps(result, ensure_ascii=False)

    @mcp_ob.tool()
    async def obs_set_input_mute(input_name: str, muted: bool) -> str:
        """音声入力をミュート/ミュート解除する。"""
        try:
            result = await obs.set_input_mute(input_name, muted)
        except ObsStudioControlError as e:
            raise ValueError(str(e)) from e
        return json.dumps(result, ensure_ascii=False)


# ================================================================== #
# HTTP ルート
# ================================================================== #

def create_router(obs) -> APIRouter:
    """aidiy_obs_studio_control HTTP APIRouter を作成して返す"""
    router = APIRouter(tags=["aidiy_obs_studio_control"])

    @router.get("/aidiy_obs_studio_control/docs", summary="aidiy_obs_studio_control ドキュメント")
    async def http_obs_docs() -> dict:
        return {
            "service": "aidiy_obs_studio_control",
            "description": "OBS Studio WebSocket v5 を制御する。接続先は _config/aidiy_obs_studio_control.json で設定。配信・録画・シーン切替・ソース制御に対応。",
            "endpoint": "POST /aidiy_obs_studio_control/{method_name}",
            "content_type": "application/json",
            "prerequisite": "OBS Studio が起動し WebSocket サーバーが有効になっている必要がある",
            "methods": {
                "startup_status": {
                    "summary": "起動時接続状態取得（スナップショット）",
                    "description": "MCP サーバー起動時に確認した OBS WebSocket 接続・認証の結果を返す。現在の接続状態ではなく起動時のスナップショット。現在の状態を確認するには connection_info を使う。",
                    "parameters": {},
                    "example_request": {},
                    "response_fields": {"connected": "True=起動時に接続成功", "obs_version": "OBS バージョン", "websocket_version": "WebSocket プロトコルバージョン"},
                },
                "connection_info": {
                    "summary": "現在の OBS 接続情報取得",
                    "description": "OBS Studio WebSocket に接続してバージョン情報を返す。OBS が起動しているか・WebSocket が有効かリアルタイムに確認できる。",
                    "parameters": {
                        "host": {"type": "string", "required": False, "description": "WebSocket ホスト（省略時は設定ファイルの値）"},
                        "port": {"type": "integer", "required": False, "description": "WebSocket ポート（省略時は設定ファイルの値）"},
                    },
                    "example_request": {},
                    "response_fields": {"connected": "接続成否", "obs_version": "OBS バージョン", "platform": "OS プラットフォーム"},
                },
                "status": {
                    "summary": "OBS 総合ステータス取得",
                    "description": "OBS のバージョン・CPU/メモリ統計・配信状態・録画状態・現在のシーン名を一括取得する。",
                    "parameters": {},
                    "example_request": {},
                    "response_fields": {"obs_version": "OBS バージョン", "streaming": "配信中か", "recording": "録画中か", "current_scene": "現在のシーン名", "stats": "CPU/メモリ/FPS 統計"},
                },
                "request": {
                    "summary": "OBS WebSocket v5 任意リクエスト実行",
                    "description": "OBS WebSocket v5 の任意のリクエストタイプを実行する。list_scenes / set_current_scene などのラッパーで対応していない操作に使う。",
                    "parameters": {
                        "request_type": {"type": "string", "required": True, "description": "OBS WebSocket リクエストタイプ名。例: 'GetVersion' / 'GetSceneList' / 'SetCurrentProgramScene' / 'GetInputList'"},
                        "request_data": {"type": "string", "required": False, "description": "リクエストデータの JSON 文字列。例: '{\"sceneName\": \"Scene 2\"}'"},
                    },
                    "example_request": {"request_type": "GetSceneList"},
                    "example_request_with_data": {"request_type": "SetCurrentProgramScene", "request_data": "{\"sceneName\": \"Scene 2\"}"},
                    "response_fields": {"requestType": "リクエストタイプ", "responseData": "OBS からの応答データ"},
                },
                "list_scenes": {
                    "summary": "シーン一覧取得",
                    "description": "OBS の全シーン名と現在のアクティブシーン名を返す。set_current_scene の scene_name 候補確認に使う。",
                    "parameters": {},
                    "example_request": {},
                    "response_fields": {"scenes": "シーン名の配列", "current_scene": "現在のシーン名"},
                },
                "set_current_scene": {
                    "summary": "シーン切り替え",
                    "description": "OBS Studio のプログラムシーンを指定シーンに切り替える。配信・録画中でも即時反映される。",
                    "parameters": {
                        "scene_name": {"type": "string", "required": True, "description": "切り替え先のシーン名（list_scenes で確認可能）"},
                    },
                    "example_request": {"scene_name": "Scene 2"},
                    "response_fields": {"ok": "True=切り替え成功", "scene_name": "切り替え後のシーン名"},
                },
                "stream": {
                    "summary": "配信制御（開始 / 停止 / トグル）",
                    "description": "OBS Studio の配信を制御する。toggle は配信中なら停止、停止中なら開始する。",
                    "parameters": {
                        "action": {"type": "string", "required": False, "default": "toggle", "values": ["start", "stop", "toggle"], "description": "実行するアクション"},
                    },
                    "example_request": {"action": "start"},
                    "response_fields": {"ok": "True=成功", "streaming": "操作後の配信状態"},
                },
                "record": {
                    "summary": "録画制御（開始 / 停止 / トグル / 一時停止 / 再開）",
                    "description": "OBS Studio の録画を制御する。pause/resume は録画中のみ有効。",
                    "parameters": {
                        "action": {"type": "string", "required": False, "default": "toggle", "values": ["start", "stop", "toggle", "pause", "resume"], "description": "実行するアクション"},
                    },
                    "example_request": {"action": "stop"},
                    "response_fields": {"ok": "True=成功", "recording": "操作後の録画状態"},
                },
                "set_source_visible": {
                    "summary": "シーン内ソースの表示・非表示切り替え",
                    "description": "指定シーン内の指定ソースの表示・非表示を切り替える。カメラ・テキスト・画像ソースの動的制御に使う。",
                    "parameters": {
                        "scene_name": {"type": "string", "required": True, "description": "対象シーン名"},
                        "source_name": {"type": "string", "required": True, "description": "対象ソース名（シーン内のアイテム名）"},
                        "visible": {"type": "boolean", "required": True, "description": "True=表示 / False=非表示"},
                    },
                    "example_request": {"scene_name": "Scene 1", "source_name": "Camera", "visible": True},
                    "response_fields": {"ok": "True=成功", "scene_name": "シーン名", "source_name": "ソース名", "visible": "設定後の表示状態"},
                },
                "set_input_mute": {
                    "summary": "音声入力のミュート・ミュート解除",
                    "description": "マイクなどの音声入力ソースをミュート・解除する。",
                    "parameters": {
                        "input_name": {"type": "string", "required": True, "description": "音声入力ソース名。例: 'Mic/Aux' / 'Desktop Audio'"},
                        "muted": {"type": "boolean", "required": True, "description": "True=ミュート / False=ミュート解除"},
                    },
                    "example_request": {"input_name": "Mic/Aux", "muted": True},
                    "response_fields": {"ok": "True=成功", "input_name": "入力名", "muted": "設定後のミュート状態"},
                },
            },
        }

    @router.post("/aidiy_obs_studio_control/{method_name}", summary="OBS Studio 制御")
    async def http_obs(method_name: str, req: ObsRequest = ObsRequest()) -> dict:
        """
        | method_name | 説明 |
        |---|---|
        | startup_status | 起動時接続状態 |
        | connection_info | 現在接続情報 |
        | status | OBS 状態 |
        | request | 任意 WS リクエスト |
        | list_scenes | シーン一覧 |
        | set_current_scene | シーン切り替え |
        | stream | 配信制御 |
        | record | 録画制御 |
        | set_source_visible | ソース表示切替 |
        | set_input_mute | 音声ミュート切替 |
        """
        try:
            if method_name == "startup_status":
                return obs.get_startup_status()
            elif method_name == "connection_info":
                result = await obs.connection_info(req.host, req.port)
                return result if isinstance(result, dict) else {"result": result}
            elif method_name == "status":
                result = await obs.status()
                return result if isinstance(result, dict) else {"result": result}
            elif method_name == "request":
                if not req.request_type:
                    return {"error": "request_type は必須です"}
                data = obs.parse_request_data(req.request_data)
                result = await obs.request(req.request_type, data)
                return result if isinstance(result, dict) else {"result": result}
            elif method_name == "list_scenes":
                result = await obs.scene_list()
                return result if isinstance(result, dict) else {"result": result}
            elif method_name == "set_current_scene":
                if not req.scene_name:
                    return {"error": "scene_name は必須です"}
                result = await obs.set_current_scene(req.scene_name)
                return result if isinstance(result, dict) else {"result": result}
            elif method_name == "stream":
                result = await obs.stream_control(req.action)
                return result if isinstance(result, dict) else {"result": result}
            elif method_name == "record":
                result = await obs.record_control(req.action)
                return result if isinstance(result, dict) else {"result": result}
            elif method_name == "set_source_visible":
                if not req.scene_name or not req.source_name or req.visible is None:
                    return {"error": "scene_name / source_name / visible は必須です"}
                result = await obs.set_scene_item_enabled(req.scene_name, req.source_name, req.visible)
                return result if isinstance(result, dict) else {"result": result}
            elif method_name == "set_input_mute":
                if not req.input_name or req.muted is None:
                    return {"error": "input_name / muted は必須です"}
                result = await obs.set_input_mute(req.input_name, req.muted)
                return result if isinstance(result, dict) else {"result": result}
            else:
                return {"error": f"未知のメソッド: {method_name}"}
        except ObsStudioControlError as e:
            logger.warning(f"http_obs [{method_name}] error: {e}")
            return {"error": str(e)}

    return router
