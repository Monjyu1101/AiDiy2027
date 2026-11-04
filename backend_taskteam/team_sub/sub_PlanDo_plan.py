# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""作業ループ（P → D）の P（計画）を投入するサブプロセス。

PlanDoパターンのPは、SPDCAのように複数名の意見（S）を後段で集約するのではなく、
要員1名がその場で調査し、後続のD（実行）がそのまま着手できる計画を直接まとめる。

team_watcher.py（1分ごとの確認）が temp/pdca/<ファイル名>.json に入力値を書き、
このスクリプトを `python sub_PlanDo_plan.py <入力JSONパス>` で起動する。

処理の流れ:
1. 入力 JSON（プロジェクト / チーム作業 / PDCA区分 / 作業ループ回数）を読み込む
2. 有効な要員のうち admin 以外を候補にして、計画内容に最も適した1名をAIに選ばせる
   （sub_init.py と同じ選択処理。admin以外の候補が1名もいない場合だけ admin にする）
3. Aチーム作業（開始レコード）を作り、aidiy_task_agents（backend_taskteam の Task API）は経由せず
   sub_self_talk.py と同じ経路で aidiy_code_agents を直接呼び出して応答を得る
   （調査モード。読み取り系ツールは使えるがソースの変更はシステム指示で禁止する）
4. 応答内容をそのまま次段への引き継ぎ内容（まとめ内容）として Aチーム作業を「済」にする。
   Aチーム依頼・Aチーム経験の生成を経ないぶん、投入から完了までが同期1回で完結する
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

_TEAM_SUB_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(_TEAM_SUB_DIR.parent))
sys.path.insert(0, str(_TEAM_SUB_DIR))

from log_config import get_logger, setup_logging
from team_proc import team_db, team_pdca_db
from team_proc import team_context

# 前段の取得・要員未確定時の後始末は他のPDCA段と共通の処理を使う
import sub_SPDCA__common
# 担当要員のAI選択は sub_init.py と同じ処理を使う（有効要員 + Aチーム経験で判断させる）
from sub_init import 担当要員を選択, 既定利用者ID


def 計画要員を選ぶ(要求内容: str, ループ: int, プロジェクト: str, logger) -> str:
    """計画内容に最も適した要員をAIに選ばせる（sub_init.py と同じ選択処理）。

    admin は選任専任者ではなく極力避けたいため、有効な要員のうちadmin以外を候補にする。
    admin以外の有効要員が1名もいない場合だけadminへフォールバックする
    （担当要員を選択自体もAI選択に失敗した場合はadminへフォールバックする）。
    """
    候補 = [要員 for 要員 in team_db.要員一覧() if str(要員["要員ID"]) != team_db.管理者要員ID]
    if not 候補:
        logger.warning(f"admin以外の有効な要員がいないため{既定利用者ID}へ投入します")
        return 既定利用者ID
    要員ID = 担当要員を選択(要求内容, f"pdca_P_{ループ}", logger, プロジェクト, 候補=候補)
    if 要員ID == 既定利用者ID:
        logger.info(f"計画担当は既定利用者ID({既定利用者ID})になりました: ループ={ループ}")
    return 要員ID


def 次ループ番号(プロジェクト: str, 作業ループ回数: int) -> int:
    """Pを投入可能なら最大値+1、上限到達済みなら0を返す（99は無制限）。"""
    現在ループ最大値 = team_pdca_db.ループ最大値(プロジェクト)
    if 作業ループ回数 != 99 and 現在ループ最大値 >= 作業ループ回数:
        return 0
    return 現在ループ最大値 + 1


def 前サイクルの実行内容(プロジェクト: str, ループ: int) -> str:
    """1つ前のループのD（実行）でまとめられた内容を返す（初回や未完了なら空文字）。

    2周目以降は、前サイクルのDで実施した内容・確認結果を出発点にして計画を続ける。
    """
    if ループ <= 1:
        return ""
    D一覧 = team_pdca_db.ループ区分一覧(プロジェクト, ループ - 1, "D")
    成功一覧 = [row for row in D一覧 if str(row.get("状況", "")) == "済"]
    if not 成功一覧:
        return ""
    return sub_SPDCA__common.まとめ内容(sub_SPDCA__common.最新の成功記録(成功一覧))


def プロンプト生成_計画(
    要員ID: str,
    プロジェクト: str,
    チーム目標: str,
    チーム作業: str,
    前サイクル進捗: str = "",
) -> str:
    """P（計画）。定型部は _config/AiDiy_team__plando_context.json から読む。"""
    if 前サイクル進捗:
        引き継ぎブロック = team_context.差し込み(
            "plando", "plan_carryover_lines", {"前サイクル進捗": 前サイクル進捗}
        )
    else:
        引き継ぎブロック = team_context.コンテキスト取得("plando", "carryover_empty_lines")
    return team_context.差し込み("plando", "common_instruction_lines", {
        "プロジェクト": プロジェクト,
        "チーム目標": チーム目標,
        "チーム作業": チーム作業,
        "引き継ぎブロック": 引き継ぎブロック,
        "今回要求ブロック": team_context.差し込み(
            "plando", "plan_request_lines", {"要員ID": 要員ID}
        ),
    })

    return f"""あなたはAIチームの要員「{要員ID}」です。チーム作業に向けて、次に実行する計画を立ててください。

プロジェクト: {プロジェクト}
チーム目標: {チーム目標}
チーム作業: {チーム作業}
{引き継ぎ}
進め方:
- 対象プロジェクトの現状（コード・ドキュメント・設定）を調べる
- 目標に近づくうえで効果が高いと考える取り組みを選び、実施順序を決める
- 各ステップについて「目的」「対象」「具体的な依頼」「完了条件」「注意点」を明記する
- 後続のD（実行）がそのまま着手できる具体性を持たせる

## 厳守事項: この段階ではソースを変更しないこと

ここは計画（P）の段で、実行（D）は次の段です。計画の裏付けを取るための
ファイル読み取り、検索、ログ確認、ビルドやテストの実行などの**調査は自由に行ってよい**が、
次の操作は理由を問わず**一切行わないこと**。

- ソースコード・設定ファイル・ドキュメントの作成、編集、削除、リネーム

「小さな修正だから」「ついでに直せるから」という判断も不可です。
実施すべき変更は、着手せずに計画のステップとして文章で書いてください。
"""


def 計画を実行(
    要員ID: str,
    プロジェクト: str,
    チーム目標: str,
    チーム作業: str,
    区分: str,
    ループ: int,
    logger,
    前サイクル進捗: str = "",
) -> bool:
    """プロンプトを組み立て、sub_SPDCA__common.段を直接実行 で aidiy_code_agents を直接呼ぶ。"""
    要求内容 = プロンプト生成_計画(要員ID, プロジェクト, チーム目標, チーム作業, 前サイクル進捗)
    return sub_SPDCA__common.段を直接実行(区分, 要員ID, プロジェクト, チーム作業, ループ, 要求内容, logger)


def main() -> int:
    setup_logging("sub_PlanDo_plan")
    logger = get_logger("team_sub_PlanDo_plan")
    プロジェクト = ""
    チーム作業 = ""
    区分 = "P"
    try:
        if len(sys.argv) < 2:
            raise ValueError("使い方: python sub_PlanDo_plan.py <temp/pdca/入力JSON>")
        入力パス = Path(sys.argv[1]).resolve()
        with 入力パス.open("r", encoding="utf-8-sig") as f:
            項目 = json.load(f)
        プロジェクト = str(項目.get("プロジェクト", "")).strip()
        チーム目標 = str(項目.get("チーム目標", "")).strip()
        チーム作業 = str(項目.get("チーム作業", "")).strip()
        区分 = str(項目.get("PDCA区分", "")).strip() or "P"
        作業ループ回数 = max(1, min(99, int(項目.get("作業ループ回数", 1) or 1)))
        if not プロジェクト or not チーム作業:
            raise ValueError("入力JSONにプロジェクトとチーム作業がありません")

        ループ = 次ループ番号(プロジェクト, 作業ループ回数)
        if not ループ:
            logger.info(
                f"作業ループ(P)は最大回数到達のため投入しません: プロジェクト={プロジェクト} "
                f"現在={team_pdca_db.ループ最大値(プロジェクト)} 設定={作業ループ回数}"
            )
            return 0

        # 2周目以降は前サイクルのDの実施内容を引き継いで計画を続ける
        前サイクル進捗 = 前サイクルの実行内容(プロジェクト, ループ)
        選択用要求内容 = f"チーム作業「{チーム作業}」に向けた次の実行計画を立案する（プロジェクト: {プロジェクト}）。"
        if 前サイクル進捗:
            選択用要求内容 += f"\n\n前サイクルのD（実行）の実施内容:\n{前サイクル進捗}"
        要員ID = 計画要員を選ぶ(選択用要求内容, ループ, プロジェクト, logger)
        logger.info(
            f"作業ループ({区分})を開始します: プロジェクト={プロジェクト} "
            f"ループ={ループ} 要員={要員ID} "
            f"前サイクル進捗={'あり' if 前サイクル進捗 else 'なし'}"
        )
        成功 = False
        try:
            成功 = 計画を実行(要員ID, プロジェクト, チーム目標, チーム作業, 区分, ループ, logger, 前サイクル進捗)
        except Exception:
            logger.exception(f"作業ループ({区分})の作成に失敗しました: 要員ID={要員ID}")
        if not 成功 and not team_pdca_db.ループ区分一覧(プロジェクト, ループ, 区分):
            # 1件もレコードを作れていないと、次の分にまた同じ段が投入されて堂々巡りになる
            sub_SPDCA__common.実行不能を記録(
                区分, プロジェクト, チーム作業, ループ,
                f"要員{要員ID}の投入に失敗しました", logger,
            )
        return 0 if 成功 else 1
    except Exception as exc:
        logger.exception("作業ループの投入処理に失敗しました")
        sub_SPDCA__common.投入失敗を記録(
            区分, プロジェクト, チーム作業, f"投入処理エラー: {exc}", logger
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
