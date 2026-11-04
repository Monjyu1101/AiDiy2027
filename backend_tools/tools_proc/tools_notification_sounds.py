# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""aidiy_notification_sounds MCP ツール登録 + HTTP ルート"""

import asyncio
import json

from fastapi import APIRouter
from pydantic import BaseModel

from log_config import get_logger
from tools_proc.notification_sounds import NotificationSoundsError

logger = get_logger(__name__)


class PlayRequest(BaseModel):
    notification_type: str = "開始"
    scene: str = "auto"


class ListRequest(BaseModel):
    scene: str = "auto"


# ================================================================== #
# MCP ツール登録
# ================================================================== #

def register_tools(mcp_ns, ns):
    """aidiy_notification_sounds MCP ツールを登録する"""

    @mcp_ns.tool()
    async def play_notification_sound(
        notification_type: str,
        scene: str = "auto",
    ) -> str:
        """
        通知音をローカル再生する。

        Args:
            notification_type: "準備/開始/終了/完了/注意/承認"（plane・legacy 共通。
                "ready/up/down/ok/ng/accept" の英語エイリアスも可）。
                scene="tts" のときは、定義済み種別なら対応フレーズを、未定義なら
                この文字列をそのまま自由発声する（任意のテキストを渡してよい）。
            scene: "auto"（= "plane"）/ "plane"（機内 SeatBeltSign）/ "legacy"（旧来の効果音）/
                "tts"（読み上げフレーズ／任意テキストを text_to_speech エンジンで合成・再生）
        """
        try:
            result = await asyncio.to_thread(ns.play, notification_type, scene)
        except NotificationSoundsError as e:
            raise ValueError(str(e)) from e
        return json.dumps(result, ensure_ascii=False)

    @mcp_ns.tool()
    async def list_notification_sounds(scene: str = "auto") -> str:
        """
        指定 scene のサウンドマッピング一覧を返す。

        Args:
            scene: "auto" / "plane" / "legacy" / "tts"
        """
        try:
            result = await asyncio.to_thread(ns.list_sounds, scene)
        except NotificationSoundsError as e:
            raise ValueError(str(e)) from e
        return json.dumps(result, ensure_ascii=False)


# ================================================================== #
# HTTP ルート
# ================================================================== #

def create_router(ns) -> APIRouter:
    """aidiy_notification_sounds HTTP APIRouter を作成して返す"""
    router = APIRouter(tags=["aidiy_notification_sounds"])

    @router.get("/aidiy_notification_sounds/docs", summary="aidiy_notification_sounds ドキュメント")
    async def http_ns_docs() -> dict:
        return {
            "service": "aidiy_notification_sounds",
            "description": (
                "scene に応じた通知音（開始・終了・注意）をローカル再生する。 "
                "scene=auto/plane は機内 SeatBeltSign 音、legacy は旧来の効果音、 "
                "tts は通知種別の読み上げフレーズを text_to_speech エンジンで合成・再生する。"
            ),
            "content_type": "application/json",
            "endpoints": {
                "play": "POST /aidiy_notification_sounds/play",
                "list": "POST /aidiy_notification_sounds/list",
            },
            "notification_scene": "auto,plane,legacy,tts",
            "notification_play": [
                ["ready", "準備"],
                ["up", "開始"],
                ["down", "終了"],
                ["ok", "完了"],
                ["ng", "注意"],
                ["accept", "承認"],
            ],
        }

    @router.post("/aidiy_notification_sounds/play", summary="通知音再生")
    async def http_ns_play(req: PlayRequest) -> dict:
        """
        通知音を再生する。

        | notification_type | scene=plane (auto) | scene=legacy | scene=tts（読み上げ） |
        |---|---|---|---|
        | 準備 | SeatBeltSign3.mp3 | ready.mp3 | 準備ができました |
        | 開始 | SeatBeltSign1.mp3 | up.mp3 | 開始します |
        | 終了 | SeatBeltSign2.mp3 | down.mp3 | 終了しました |
        | 完了 | SeatBeltSign1.mp3 | ok.mp3 | 完了しました |
        | 注意 | SeatBeltSign2.mp3 | ng.mp3 | ご注意ください |
        | 承認 | SeatBeltSign1.mp3 | accept.mp3 | 承認しました |
        """
        try:
            result = await asyncio.to_thread(ns.play, req.notification_type, req.scene)
            logger.info(f"http_ns play: {result}")
            return result
        except NotificationSoundsError as e:
            logger.warning(f"http_ns play error: {e}")
            return {"error": str(e)}

    @router.post("/aidiy_notification_sounds/list", summary="サウンド一覧")
    async def http_ns_list(req: ListRequest) -> dict:
        """指定 scene のサウンドマッピング一覧を返す"""
        try:
            result = await asyncio.to_thread(ns.list_sounds, req.scene)
            return result
        except NotificationSoundsError as e:
            logger.warning(f"http_ns list error: {e}")
            return {"error": str(e)}

    return router
