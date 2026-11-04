# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""雑談エリアの要員1名に「今やるべきこと」を発言させるサブプロセス。

team_watcher.py（1分ごとの雑談確認）が、雑談エリア（状態=雑談中）の要員から1名を選び、
Aチーム会話の対象要員行を空にして（発言シーケンスに入ったことのマーク）
temp/talk/<ファイル名>.json に入力値を書き、このスクリプトを
`python sub_self_talk.py <入力JSONパス>` で起動する。

チーム目標、他の要員の最新の発言、対象要員自身の1回前の発言（あれば）を並べて、対象要員の人格で
aidiy_code_agents（team_chat.py の単発会話と同じ経路）へ「今やるべきこと」を尋ね、
その応答をAチーム会話の該当行へ書き戻す。ここでは意見を集めるだけで、実行はしない。

発言は調査モード（team_chat.会話実行 の 調査モード=True）で依頼する。task_sub/sub_do.py
と同様にツール利用が有効な状態で動き、AI は対象プロジェクトのソース・設定・
ドキュメントを実際に読み取ってから発言する。書き込み・実行系の操作はシステム指示で禁止する。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

_TEAM_SUB_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(_TEAM_SUB_DIR.parent))
sys.path.insert(0, str(_TEAM_SUB_DIR))

from log_config import get_logger, setup_logging
from team_proc import team_chat, team_talk_db
from team_proc import team_context


def 依頼内容を作る(
    要員ID: str,
    チーム目標: str,
    他者意見一覧: list[dict],
    自身の前回発言: str = "",
    プロジェクト: str = "",
) -> str:
    """要員の自律発言。定型部は _config/AiDiy_team__talk_context.json から読む。"""
    if 他者意見一覧:
        他者意見 = "\n\n".join(
            f"### {行.get('要員ID', '')} の直近の発言\n{str(行.get('発言内容', '')).strip()}"
            for 行 in 他者意見一覧
        )
    else:
        他者意見 = "まだ他の要員の発言はありません。"

    自身の前回発言欄 = ""
    if 自身の前回発言.strip():
        自身の前回発言欄 = team_context.差し込み(
            "talk", "talk_self_previous_lines", {"自身の前回発言.strip()": 自身の前回発言.strip()}
        )

    return team_context.差し込み("talk", "talk_instruction_lines", {
        "チーム目標": チーム目標,
        "プロジェクト": プロジェクト.strip() or "（未指定）",
        "他者意見": 他者意見,
        "自身の前回発言欄": 自身の前回発言欄,
    })


def main() -> int:
    setup_logging("sub_self_talk")
    logger = get_logger("team_sub_self_talk")
    プロジェクト = ""
    要員ID = ""
    依頼内容 = ""
    try:
        if len(sys.argv) < 2:
            raise ValueError("使い方: python sub_self_talk.py <temp/talk/入力JSON>")
        入力パス = Path(sys.argv[1]).resolve()
        with 入力パス.open("r", encoding="utf-8-sig") as f:
            項目 = json.load(f)
        プロジェクト = str(項目.get("プロジェクト", "")).strip()
        要員ID = str(項目.get("要員ID", "")).strip()
        チーム目標 = str(項目.get("チーム目標", "")).strip()
        TASK_AI_NAME = str(項目.get("TASK_AI_NAME", "claude_cli")).strip() or "claude_cli"
        # 雑談は意見出し（相談）なので plan 用モデルを使う
        TASK_AI_MODEL_plan = str(項目.get("TASK_AI_MODEL_plan", "auto")).strip() or "auto"
        他者意見一覧 = 項目.get("他者意見", []) or []
        自身の前回発言 = str(項目.get("自身の1回前の発言", "")).strip()
        if not プロジェクト or not 要員ID:
            raise ValueError("入力JSONにプロジェクト・要員IDがありません")

        依頼内容 = 依頼内容を作る(
            要員ID=要員ID, チーム目標=チーム目標, 他者意見一覧=他者意見一覧,
            自身の前回発言=自身の前回発言, プロジェクト=プロジェクト,
        )
        team_talk_db.要求内容更新(プロジェクト, 要員ID, 依頼内容)
        logger.info(f"雑談の発言を開始します: 要員ID={要員ID} プロジェクト={プロジェクト}")
        結果 = team_chat.会話実行(
            要員ID,
            プロジェクト,
            TASK_AI_NAME,
            TASK_AI_MODEL_plan,
            依頼内容,
            調査モード=True,
        )
        team_talk_db.発言更新(プロジェクト, 要員ID, 依頼内容, str(結果.get("応答内容", "")))
        logger.info(f"雑談の発言を記録しました: 要員ID={要員ID} プロジェクト={プロジェクト}")
        return 0
    except Exception as exc:
        logger.exception("雑談の発言処理に失敗しました")
        if プロジェクト and 要員ID:
            try:
                team_talk_db.発言更新(プロジェクト, 要員ID, 依頼内容, f"(発言できませんでした: {exc})")
            except Exception:
                logger.exception(f"Aチーム会話への失敗記録にも失敗しました: 要員ID={要員ID} プロジェクト={プロジェクト}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
