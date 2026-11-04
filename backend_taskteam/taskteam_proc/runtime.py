# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""backend_taskteam の初期化、定期処理、再起動監視。"""

from __future__ import annotations

import asyncio
import logging
import os
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator, Callable

from fastapi import FastAPI

from .internal_auth import InternalTokenAuthority, PersistentTokenRotator, internal_post_endpoints

from task_proc import tasks_db, tasks_watcher
from team_proc import team_db, team_exp_db, team_goal_db, team_pdca_db, team_talk_db, team_work_db
from team_proc.store import シミュレーションループ
from team_proc import team_watcher

BASE_DIR = Path(__file__).resolve().parents[1]
REBOOT_FILENAMES = ("reboot_taskteam.txt", "reboot_task.txt", "reboot_team.txt")


def setup_reboot_watcher(logger: logging.Logger) -> None:
    """統合プロセスを1本のスレッドで監視する。

    `reboot_task.txt` と `reboot_team.txt` は移行期間の互換入力として受け付ける。
    """
    temp_dir = BASE_DIR / "temp"
    temp_dir.mkdir(parents=True, exist_ok=True)
    reboot_paths = tuple(temp_dir / name for name in REBOOT_FILENAMES)

    def consume_reboot_file() -> str | None:
        detected: str | None = None
        for reboot_path in reboot_paths:
            if not reboot_path.is_file():
                continue
            detected = reboot_path.name
            try:
                reboot_path.unlink()
            except FileNotFoundError:
                pass
            except Exception:
                logger.exception("%s の削除に失敗しました", reboot_path.name)
        return detected

    detected = consume_reboot_file()
    if detected:
        logger.info("%s を検知したため終了します", detected)
        raise SystemExit(f"{detected} detected")

    def watch_loop() -> None:
        while True:
            time.sleep(1)
            detected_name = consume_reboot_file()
            if detected_name:
                logger.info("%s を検知したため終了します", detected_name)
                os._exit(0)

    threading.Thread(
        target=watch_loop,
        daemon=True,
        name="backend_taskteam_reboot_watcher",
    ).start()


async def _team_initialize(logger: logging.Logger) -> None:
    team_work_db.初期化()
    team_exp_db.初期化()
    team_pdca_db.初期化()
    await asyncio.to_thread(team_db.初期要員を召喚)
    await asyncio.to_thread(team_goal_db.初期目標を投入)

    会話クリア件数 = await asyncio.to_thread(team_talk_db.起動時クリア)
    if 会話クリア件数:
        logger.info("起動時にAチーム会話をクリアしました: %d件", 会話クリア件数)

    自動作業設定解除件数 = await asyncio.to_thread(team_goal_db.起動時自動作業設定をオフ)
    if 自動作業設定解除件数:
        logger.info(
            "起動時にAチーム目標の自動作業設定をオフへ戻しました: %d件",
            自動作業設定解除件数,
        )

    作業ループ解除件数 = await asyncio.to_thread(team_goal_db.起動時作業ループをオフ)
    if 作業ループ解除件数:
        logger.info(
            "起動時にAチーム目標の作業ループをオフへ戻しました: %d件",
            作業ループ解除件数,
        )


def build_lifespan(logger: logging.Logger) -> Callable[[FastAPI], AsyncIterator[None]]:
    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        endpoints = internal_post_endpoints(app)
        authority = InternalTokenAuthority(endpoints=endpoints)
        rotator = PersistentTokenRotator(
            authority, BASE_DIR.parent,
            on_error=lambda: logger.error("TaskTeam内部認証の更新に失敗しました。"))
        rotator.start()
        app.state.internal_token_authority = authority
        try:
            async with _worker_lifespan(logger):
                yield
        finally:
            rotator.stop()
            app.state.internal_token_authority = None

    return lifespan


@asynccontextmanager
async def _worker_lifespan(logger):

    # Teamテーブルを先に揃え、Task側の連携クリーンアップから同じDBを参照できるようにする。
    await _team_initialize(logger)
    await asyncio.to_thread(tasks_db.初期化)
    初期タスクID = await asyncio.to_thread(tasks_db.初期タスクを投入)
    if 初期タスクID:
        logger.info(
            "AIタスクが空だったため実行監視のひな形を投入しました: %s"
            "（実行有効=0。監視対象タスクIDを書き換えて有効化すると動きます）",
            初期タスクID,
        )
    await asyncio.to_thread(tasks_watcher.起動時クリーンアップ, logger)
    await asyncio.to_thread(tasks_watcher.起動時実行条件初期化, logger)
    await asyncio.to_thread(team_watcher.起動時クリーンアップ, logger)

    tasks = [
        asyncio.create_task(
            tasks_watcher.起動監視ループ(logger),
            name="backend_taskteam_task_launch_watcher",
        ),
        asyncio.create_task(
            tasks_watcher.状態監視ループ(logger),
            name="backend_taskteam_task_status_watcher",
        ),
        asyncio.create_task(
            シミュレーションループ(logger),
            name="backend_taskteam_team_simulation",
        ),
        asyncio.create_task(
            team_watcher.起動監視ループ(logger),
            name="backend_taskteam_team_launch_watcher",
        ),
        asyncio.create_task(
            team_watcher.状態監視ループ(logger),
            name="backend_taskteam_team_status_watcher",
        ),
    ]
    logger.info(
        "backend_taskteam を開始しました "
        "(task起動監視=%ss, task状態監視=%ss, team起動監視=%ss, team状態監視=%ss)",
        tasks_watcher.起動監視間隔秒,
        tasks_watcher.状態監視間隔秒,
        team_watcher.起動監視間隔秒,
        team_watcher.状態監視間隔秒,
    )
    try:
        yield
    finally:
        for task in tasks:
            task.cancel()
        for task in tasks:
            try:
                await task
            except asyncio.CancelledError:
                pass
        logger.info("backend_taskteam を停止しました")
