# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""作業ループ（S → P → D → C → A）の C（評価）を投入するサブプロセス。

直前のD（実行）が全件「済」または「エラー」になった後、Dの「済」レコードに保存された
まとめ内容（実施報告）を受け取り、実施内容が正しいかを実物に当たって検査させる。
実施報告だけでは何を狙った変更か分からないため、同ループのP（計画）のまとめも一緒に渡す。
検査のための読み取り・確認コマンドは実行してよいが、ソースの修正は行わせない。

team_watcher.py（1分ごとの確認）が temp/pdca/<ファイル名>.json に入力値を書き、
このスクリプトを `python sub_SPDCA_check.py <入力JSONパス>` で起動する。

前段の確認・担当要員のAI選択は `sub_SPDCA__common.py`（D・C・A 共通）が行う。
ここではAIへ渡すプロンプトだけを定義する。C は調査・検査だけでソースを変更しないため、
aidiy_task_agents（backend_taskteam の Task API）は経由せず、sub_self_talk.py と同じ経路で
aidiy_code_agents を直接呼び出してその場で完了させる（段を実行 の 直接実行=True）。
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import sub_SPDCA__common
from team_proc import team_context


def プロンプト生成_評価(
    要員ID: str,
    プロジェクト: str,
    チーム目標: str,
    チーム作業: str,
    まとめ一覧: dict,
) -> str:
    """C（評価）。定型部は _config/AiDiy_team__spdca_context.json から読む。"""
    引き継ぎブロック = (
        sub_SPDCA__common.参照節("P（計画）で決まった実行計画", まとめ一覧.get("P", ""))
        + sub_SPDCA__common.参照節("D（実行）の実施報告", まとめ一覧.get("D", ""))
    )
    return team_context.差し込み("spdca", "common_instruction_lines", {
        "プロジェクト": プロジェクト,
        "チーム目標": チーム目標,
        "チーム作業": チーム作業,
        "引き継ぎブロック": 引き継ぎブロック,
        "今回要求ブロック": team_context.差し込み(
            "spdca", "check_request_lines", {"要員ID": 要員ID}
        ),
    })


def main() -> int:
    return sub_SPDCA__common.段を実行(
        "C", "D", プロンプト生成_評価, "sub_SPDCA_check", 参照区分=("P",), 直接実行=True
    )


if __name__ == "__main__":
    raise SystemExit(main())
