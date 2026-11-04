# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""作業ループ（S → P → D → C → A）の D（実行）を投入するサブプロセス。

直前のP（計画）が全件「済」または「エラー」になった後、Pの「済」レコードに保存された
まとめ内容（実行計画）を実際に実施させる。S・P・C・Aと違い、この段はソースやドキュメントを
変更してよい唯一の段。担当は新たにAIへ選ばせず、計画を立てた本人（Pの担当要員）が
そのまま実施する（要員継続）。

team_watcher.py（1分ごとの確認）が temp/pdca/<ファイル名>.json に入力値を書き、
このスクリプトを `python sub_SPDCA_do.py <入力JSONパス>` で起動する。

前段の確認・担当要員の引き継ぎ・依頼/作業レコードの作成・タスク投入は
`sub_SPDCA__common.py`（D・C・A 共通）が行う。ここではAIへ渡すプロンプトだけを定義する。
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import sub_SPDCA__common
from team_proc import team_context


def プロンプト生成_実行(
    要員ID: str,
    プロジェクト: str,
    チーム目標: str,
    チーム作業: str,
    まとめ一覧: dict,
) -> str:
    """D（実行）。定型部は _config/AiDiy_team__spdca_context.json から読む。"""
    return team_context.差し込み("spdca", "common_instruction_lines", {
        "プロジェクト": プロジェクト,
        "チーム目標": チーム目標,
        "チーム作業": チーム作業,
        "引き継ぎブロック": sub_SPDCA__common.参照節(
            "P（計画）で決まった実行計画", まとめ一覧.get("P", "")
        ),
        "今回要求ブロック": team_context.差し込み(
            "spdca", "do_request_lines", {"要員ID": 要員ID}
        ),
    })


def main() -> int:
    return sub_SPDCA__common.段を実行("D", "P", プロンプト生成_実行, "sub_SPDCA_do", 要員継続=True)


if __name__ == "__main__":
    raise SystemExit(main())
