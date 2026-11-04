# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""backend_taskteam の稼働確認 API。"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter

router = APIRouter()


def _now_hms() -> str:
    return datetime.now().strftime("%H:%M:%S")


@router.get("/")
async def root() -> dict[str, object]:
    return {
        "status": "OK",
        "message": "backend_taskteam is running",
        "services": ["task", "team"],
        "time": _now_hms(),
    }


@router.get("/health")
async def health() -> dict[str, object]:
    return {
        "status": "OK",
        "service": "backend_taskteam",
        "services": ["task", "team"],
        "time": _now_hms(),
    }
