# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""作業ループが完了したときに呼び出すPlanDo／SPDCA共通の終了フック。

team_watcher.py の毎分確認が、現行の赤ネオン判定と同じ完了条件を独立させた
`team_pdca_db.作業ループ終了済み()` で作業終了を検知したときに起動する。
ファイル名はPlanDoだがSPDCAでもこのスクリプトを共用し、SPDCA専用版は作らない。

終了時点のDBにある自動作業設定がオンなら、チーム作業とAチーム会話をクリアして次の作業の
協議へ戻す。オフなら作業ループをオフにし、同じ完了作業の再実行を止める。
`python sub_PlanDo_end.py <入力JSONパス>` で起動する。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

_TEAM_SUB_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(_TEAM_SUB_DIR.parent))
sys.path.insert(0, str(_TEAM_SUB_DIR))

from log_config import get_logger, setup_logging
from team_proc import team_goal_db


def main() -> int:
    setup_logging("sub_PlanDo_end")
    logger = get_logger("team_sub_PlanDo_end")
    try:
        if len(sys.argv) < 2:
            raise ValueError("使い方: python sub_PlanDo_end.py <temp/pdca/入力JSON>")
        入力パス = Path(sys.argv[1]).resolve()
        with 入力パス.open("r", encoding="utf-8-sig") as f:
            項目 = json.load(f)

        プロジェクト = str(項目.get("プロジェクト", "")).strip()
        パターン = str(項目.get("パターン", "")).strip()
        チーム作業 = str(項目.get("チーム作業", "")).strip()
        if not プロジェクト or not チーム作業:
            raise ValueError("入力JSONにプロジェクト・チーム作業がありません")
        if パターン not in ("PlanDo", "SPDCA"):
            raise ValueError("パターンはPlanDoまたはSPDCAを指定してください")

        結果 = team_goal_db.作業ループ終了後更新(プロジェクト)
        logger.info(
            f"作業ループの終了処理を反映しました: プロジェクト={プロジェクト} "
            f"パターン={パターン} 処理={結果.get('処理', '')}"
        )
        return 0
    except Exception:
        logger.exception("作業ループの終了処理に失敗しました")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
