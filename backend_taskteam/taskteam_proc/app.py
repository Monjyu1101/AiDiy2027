# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""backend_taskteam の FastAPI アプリ生成。"""

from __future__ import annotations

from fastapi import Depends, FastAPI

from .api_auth import require_auth

from log_config import get_logger
from task_proc.tasks_api import check_router
from task_proc.tasks_api import router as tasks_router
from team_proc.team_api import router as team_router

from .routes import router
from .runtime import build_lifespan, setup_reboot_watcher


def create_app() -> FastAPI:
    logger = get_logger("taskteam_main")
    taskteam_app = FastAPI(
        title="AiDiy Backend TaskTeam",
        version="0.1.0",
        openapi_tags=[
            {"name": "default", "description": "backend_taskteam の稼働確認 API"},
            {"name": "タスク要求", "description": "AIタスク要求の一覧、登録、更新 API"},
            {"name": "タスク明細", "description": "AIタスク明細の一覧、更新、実行結果登録 API"},
            {"name": "AIチーム", "description": "エージェントの状態、召喚、活動履歴 API"},
            {"name": "チーム要員", "description": "Aチーム要員の保守 API"},
            {"name": "チーム依頼", "description": "Aチーム依頼の保守 API"},
        ],
        lifespan=build_lifespan(logger),
    )
    taskteam_app.include_router(router)
    taskteam_app.include_router(tasks_router, dependencies=[Depends(require_auth)])
    taskteam_app.include_router(check_router, dependencies=[Depends(require_auth)])
    taskteam_app.include_router(team_router, dependencies=[Depends(require_auth)])
    setup_reboot_watcher(logger)
    return taskteam_app
