# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""各要員の意見をadmin人格でチーム作業へ取りまとめるサブプロセス。

team_watcher.py が分の下一桁0の回に起動条件を確認し、有効要員数の50%以上の意見が
集まっていれば、このスクリプトを起動する。admin人格で具体的なチーム作業を取りまとめ、
成功時はAチーム会話をadminの取りまとめ1件へ置き換え、Aチーム目標のチーム作業へ反映する。
同時に、対象プロジェクトの既存Aチーム作業をクリアする。
`python sub_self_work.py <入力JSONパス>` で起動する。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

_TEAM_SUB_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(_TEAM_SUB_DIR.parent))
sys.path.insert(0, str(_TEAM_SUB_DIR))

from log_config import get_logger, setup_logging
from team_proc import team_chat, team_db, team_goal_db
from team_proc import team_context


def 依頼内容を作る(
    チーム目標: str,
    意見一覧: list[dict],
) -> str:
    """admin の作業取りまとめ。定型部は _config/AiDiy_team__talk_context.json から読む。"""
    if 意見一覧:
        各人の意見 = "\n\n".join(
            f"### {行.get('要員ID', '')} の意見\n{str(行.get('発言内容', '')).strip()}"
            for 行 in 意見一覧
        )
    else:
        各人の意見 = "意見はありません。"

    return team_context.差し込み("talk", "work_instruction_lines", {
        "チーム目標": チーム目標,
        "各人の意見": 各人の意見,
    })


def main() -> int:
    setup_logging("sub_self_work")
    logger = get_logger("team_sub_self_work")
    プロジェクト = ""
    try:
        if len(sys.argv) < 2:
            raise ValueError("使い方: python sub_self_work.py <temp/talk/入力JSON>")
        入力パス = Path(sys.argv[1]).resolve()
        with 入力パス.open("r", encoding="utf-8-sig") as f:
            項目 = json.load(f)
        プロジェクト = str(項目.get("プロジェクト", "")).strip()
        チーム目標 = str(項目.get("チーム目標", "")).strip()
        TASK_AI_NAME = str(項目.get("TASK_AI_NAME", "claude_cli")).strip() or "claude_cli"
        # 自己作業はソースを変更する実施なので do 用モデルを使う
        TASK_AI_MODEL_do = str(項目.get("TASK_AI_MODEL_do", "auto")).strip() or "auto"
        意見一覧 = 項目.get("意見一覧", []) or []
        if not プロジェクト or not チーム目標:
            raise ValueError("入力JSONにプロジェクト・チーム目標がありません")
        if not 意見一覧:
            raise ValueError("入力JSONに取りまとめ対象の意見がありません")

        依頼内容 = 依頼内容を作る(チーム目標, 意見一覧)
        logger.info(f"チーム作業の取りまとめを開始します: 要員ID={team_db.管理者要員ID} プロジェクト={プロジェクト}")
        結果 = team_chat.会話実行(
            team_db.管理者要員ID,
            プロジェクト,
            TASK_AI_NAME,
            TASK_AI_MODEL_do,
            依頼内容,
        )
        取りまとめ内容 = str(結果.get("応答内容", "")).strip()
        team_goal_db.取りまとめ反映(
            プロジェクト,
            依頼内容,
            取りまとめ内容,
            team_db.管理者要員ID,
        )
        logger.info(f"チーム作業の取りまとめを反映しました: 要員ID={team_db.管理者要員ID} プロジェクト={プロジェクト}")
        return 0
    except Exception:
        logger.exception(f"チーム作業の取りまとめに失敗しました: プロジェクト={プロジェクト}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
