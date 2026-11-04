# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""作業ループ（S → P → D → C → A）の A（改善）を投入するサブプロセス。

直前のC（評価）が全件「済」または「エラー」になった後、Cの「済」レコードに保存された
まとめ内容（検査結果）を受け取り、実際に動かして改善点が無いかを確認させる。
ここは1周の締めくくりで、次サイクルへの申し送りを作る段のため、同ループの
P（計画）とD（実行）のまとめも一緒に渡し、1周ぶんの経緯を見て判断させる。
動作確認のための実行は行ってよいが、ソースの修正は行わせない。
ここでまとめた改善点は、次サイクルのS（相談）へ引き継がれて改善が続いていく。
担当は新たにAIへ選ばせず、検査を行った本人（Cの担当要員）がそのまま実施する（要員継続）。

team_watcher.py（1分ごとの確認）が temp/pdca/<ファイル名>.json に入力値を書き、
このスクリプトを `python sub_SPDCA_action.py <入力JSONパス>` で起動する。

前段の確認・担当要員の引き継ぎは `sub_SPDCA__common.py`（D・C・A 共通）が行う。
ここではAIへ渡すプロンプトだけを定義する。A は動作確認と改善点の洗い出しだけで
ソースを変更しないため、aidiy_task_agents（backend_taskteam の Task API）は経由せず、sub_self_talk.py
と同じ経路で aidiy_code_agents を直接呼び出してその場で完了させる（段を実行 の 直接実行=True）。
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import sub_SPDCA__common
from team_proc import team_context


def プロンプト生成_改善(
    要員ID: str,
    プロジェクト: str,
    チーム目標: str,
    チーム作業: str,
    まとめ一覧: dict,
) -> str:
    """A（改善）。定型部は _config/AiDiy_team__spdca_context.json から読む。"""
    引き継ぎブロック = (
        sub_SPDCA__common.参照節("P（計画）で決まった実行計画", まとめ一覧.get("P", ""))
        + sub_SPDCA__common.参照節("D（実行）の実施報告", まとめ一覧.get("D", ""))
        + sub_SPDCA__common.参照節("C（評価）の検査結果", まとめ一覧.get("C", ""))
    )
    return team_context.差し込み("spdca", "common_instruction_lines", {
        "プロジェクト": プロジェクト,
        "チーム目標": チーム目標,
        "チーム作業": チーム作業,
        "引き継ぎブロック": 引き継ぎブロック,
        "今回要求ブロック": team_context.差し込み(
            "spdca", "action_request_lines", {"要員ID": 要員ID}
        ),
    })


def main() -> int:
    return sub_SPDCA__common.段を実行(
        "A", "C", プロンプト生成_改善, "sub_SPDCA_action", 要員継続=True, 参照区分=("P", "D"),
        直接実行=True,
    )


if __name__ == "__main__":
    raise SystemExit(main())
