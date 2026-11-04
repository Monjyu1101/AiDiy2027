# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""チーム依頼の操作を、投入済みのAIタスクへ伝える。"""
from __future__ import annotations


async def 依頼操作反映(現行: dict, 更新: dict) -> None:
    from task_proc import tasks_api, tasks_db

    if 更新["状態"] == "中止":
        更新["実行有効"] = False
    準備停止 = 更新["状態"] in ("中止", "準備開始") and 現行.get("状態") in ("準備開始", "準備中")
    if 準備停止:
        from . import team_work_db, team_watcher
        from log_config import get_logger
        team_work_db.準備停止確保(現行["依頼ID"])
        team_watcher.準備プロセス停止(現行["依頼ID"], get_logger("team_control"))
    タスクID = str(現行.get("タスクID") or (現行.get("依頼ID") if 準備停止 else "") or "")
    if not タスクID:
        return
    タスク = tasks_db.タスク要求取得(タスクID)
    if not タスク and 準備停止:
        return
    if not タスク:
        raise ValueError(f"関連タスク {タスクID} が見つかりません")
    if 更新["状態"] in ("中止", "準備開始"):
        # タスク画面と同じ停止経路で、実プロセスと明細も停止する。
        if 更新["状態"] == "中止":
            更新["実行有効"] = False
        応答 = await tasks_api.タスク要求更新登録(
            tasks_api.タスク要求更新登録リクエスト(
                タスクID=タスクID,
                **{key: タスク[key] for key in (
                    "プロジェクト", "要求内容", "TASK_AI_NAME",
                    "TASK_AI_MODEL_plan", "TASK_AI_MODEL_do", "TASK_AI_MODEL_check",
                )},
                状況="中止", 実行有効=False,
            )
        )
    elif bool(タスク.get("実行有効")) != bool(更新["実行有効"]):
        応答 = await tasks_api.タスク要求実行有効切替(
            tasks_api.タスク実行有効切替リクエスト(
                タスクID=タスクID, 実行有効=更新["実行有効"],
            )
        )
    else:
        return
    if 応答.get("status") != "OK":
        raise ValueError(応答.get("message") or "関連タスクの更新に失敗しました")
