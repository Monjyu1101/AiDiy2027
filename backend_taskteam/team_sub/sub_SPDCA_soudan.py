# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""作業ループ（S → P → D → C → A）の S（相談）を投入するサブプロセス。

S は計画（P）を立てる前の意見交換で、複数名が並行してそれぞれの意見を出す段です。
ここで出た意見を次の P（計画）で 1 つの計画にまとめます。

team_watcher.py（1分ごとの確認）が temp/pdca/<ファイル名>.json に入力値を書き、
このスクリプトを `python sub_SPDCA_soudan.py <入力JSONパス>` で起動する。

処理の流れ:
1. 入力 JSON（プロジェクト / チーム作業 / PDCA区分 / 作業ループ回数 / 動員要員数）を読み込む
2. 有効な要員のうち admin 以外を候補にして、相談内容に最も適した要員を動員要員数まで
   AIに順に選ばせる（sub_init.py と同じ選択処理。候補が尽きる・選べない場合はそこで打ち切る）
3. 要員ごとに Aチーム作業（開始レコード）を作り、aidiy_task_agents（backend_taskteam の Task API）は
   経由せず sub_self_talk.py と同じ経路で aidiy_code_agents を直接呼び出して応答を得る
   （調査モード。読み取り系ツールは使えるがソースの変更はシステム指示で禁止する）。
   複数名ぶんはスレッドで並列に呼び出し、直列化による待ち時間の積み上がりを避ける
4. 応答内容をそのまま次段への引き継ぎ内容（まとめ内容）として、要員ごとに
   Aチーム作業を「済」にする。失敗した要員は「エラー」にして次のサイクルを止めない
"""

from __future__ import annotations

import json
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
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

既定動員要員数 = 2
# Aチーム目標の動員要員数はここで固定の人数に丸めない。
# 実際に動員できるのは admin 以外の有効要員数までなので、それを上限にする。
動員要員数上限 = 99


def 相談要員を選ぶ(要求内容: str, ループ: int, プロジェクト: str, 動員要員数: int, logger) -> list[str]:
    """相談内容に最も適した要員を、動員要員数を上限にAIへ順に選ばせる（sub_init.py と同じ選択処理）。

    admin は選任専任者ではなく極力避けるため、候補は admin 以外の有効要員に絞り込む。
    候補が1名もいない場合はadmin 1名にフォールバックする。複数名選ぶ場合は、
    既に選ばれた要員を候補から除いて重複なく選び直す。AI選択に失敗した場合は
    そこまでに選べた人数で打ち切り、1名も選べなければadmin 1名にする。
    """
    全候補 = [要員 for 要員 in team_db.要員一覧() if str(要員["要員ID"]) != team_db.管理者要員ID]
    if not 全候補:
        logger.warning(f"admin以外の有効な要員がいないため{既定利用者ID}へ投入します")
        return [既定利用者ID]

    指定人数 = max(1, min(動員要員数上限, len(全候補), int(動員要員数)))
    if 指定人数 < min(動員要員数上限, int(動員要員数)):
        logger.info(
            f"動員要員数({動員要員数})が有効要員数({len(全候補)})を超えるため全員を上限に動員します"
        )

    選出済み: list[str] = []
    残り候補 = list(全候補)
    for 順番 in range(1, 指定人数 + 1):
        要員ID = 担当要員を選択(要求内容, f"pdca_S_{ループ}_{順番}", logger, プロジェクト, 候補=残り候補)
        if 要員ID == 既定利用者ID:
            # 残り候補にadminは含めていないため、返ってきたらAI選択失敗によるフォールバック
            logger.warning(f"相談要員のAI選択に失敗したため{順番}人目以降の動員を打ち切ります")
            break
        選出済み.append(要員ID)
        残り候補 = [要員 for 要員 in 残り候補 if str(要員["要員ID"]) != 要員ID]
        if not 残り候補:
            break

    if not 選出済み:
        logger.warning(f"相談要員を1名も選べなかったため{既定利用者ID}へ投入します")
        return [既定利用者ID]
    return 選出済み


def 次ループ番号(プロジェクト: str, 作業ループ回数: int) -> int:
    """Sを投入可能なら最大値+1、上限到達済みなら0を返す（99は無制限）。"""
    現在ループ最大値 = team_pdca_db.ループ最大値(プロジェクト)
    if 作業ループ回数 != 99 and 現在ループ最大値 >= 作業ループ回数:
        return 0
    return 現在ループ最大値 + 1


def 前サイクルの改善内容(プロジェクト: str, ループ: int) -> str:
    """1つ前のループのA（改善）でまとめられた内容を返す（初回や未完了なら空文字）。

    2周目以降は、前サイクルのAで洗い出した改善点を出発点にして議論を続ける。
    """
    if ループ <= 1:
        return ""
    A一覧 = team_pdca_db.ループ区分一覧(プロジェクト, ループ - 1, "A")
    成功一覧 = [row for row in A一覧 if str(row.get("状況", "")) == "済"]
    if not 成功一覧:
        return ""
    return sub_SPDCA__common.まとめ内容(sub_SPDCA__common.最新の成功記録(成功一覧))


def プロンプト生成_相談(
    要員ID: str,
    プロジェクト: str,
    チーム目標: str,
    チーム作業: str,
    人数: int,
    前サイクル改善: str = "",
) -> str:
    """S（相談）。定型部は _config/AiDiy_team__spdca_context.json から読む。"""
    if 前サイクル改善:
        引き継ぎブロック = team_context.差し込み(
            "spdca", "soudan_carryover_lines", {"前サイクル改善": 前サイクル改善}
        )
    else:
        引き継ぎブロック = team_context.コンテキスト取得("spdca", "carryover_empty_lines")
    今回要求ブロック = team_context.差し込み(
        "spdca", "soudan_request_lines", {"要員ID": 要員ID, "人数": 人数}
    )
    return team_context.差し込み("spdca", "common_instruction_lines", {
        "プロジェクト": プロジェクト,
        "チーム目標": チーム目標,
        "チーム作業": チーム作業,
        "引き継ぎブロック": 引き継ぎブロック,
        "今回要求ブロック": 今回要求ブロック,
    })

    return f"""あなたはAIチームの要員「{要員ID}」です。チーム作業に向けて、いま何に取り組むべきかの意見を出してください。

プロジェクト: {プロジェクト}
チーム目標: {チーム目標}
チーム作業: {チーム作業}

これは計画を立てる前の意見交換（相談）です。{人数}名がそれぞれ別の観点から意見を出し、
この後の「計画」でそれらを1つの計画にまとめます。結論を1つに決めるのはあなたの役割ではありません。
{引き継ぎ}
進め方:
- 対象プロジェクトの現状（コード・ドキュメント・設定）を調べる
- 目標に近づくうえで効果が高いと考える取り組みを 1〜3 件挙げる
- それぞれ「対象」「現状の課題」「取り組み案」「想定効果」「気になる点・懸念」を簡潔にまとめて回答する

## 厳守事項: この段階では調査と意見出しだけを行うこと

計画（P）を立てる前の事前相談です。実行（D）は後の段になります。
ファイルの読み取り、検索、ログ確認などの**調査は自由に行ってよい**が、
次の操作は理由を問わず**一切行わないこと**。

- ソースコード・設定ファイル・ドキュメントの作成、編集、削除、リネーム
- ビルド、テスト実行、インストール、デプロイ、サーバーの起動や停止
- git のコミット、ブランチ操作、その他リポジトリの状態を変える操作
- 環境やデータベースを変更するコマンドの実行

「小さな修正だから」「ついでに直せるから」という判断も不可です。
直すべきと考えた内容は、実施せずに意見として文章で書いてください。

その他:
- 他の要員も同時に意見を出しています。あなたの役割と経験を活かした観点で、重複しにくい意見を出すこと
"""


def 相談を実行(
    要員ID: str,
    プロジェクト: str,
    チーム目標: str,
    チーム作業: str,
    区分: str,
    ループ: int,
    人数: int,
    logger,
    前サイクル改善: str = "",
) -> bool:
    """プロンプトを組み立て、sub_SPDCA__common.段を直接実行 で aidiy_code_agents を直接呼ぶ。

    複数名ぶんは呼び出し側（main）がスレッドで並列に呼び出す。
    """
    要求内容 = プロンプト生成_相談(要員ID, プロジェクト, チーム目標, チーム作業, 人数, 前サイクル改善)
    return sub_SPDCA__common.段を直接実行(区分, 要員ID, プロジェクト, チーム作業, ループ, 要求内容, logger)


def main() -> int:
    setup_logging("sub_SPDCA_soudan")
    logger = get_logger("team_sub_SPDCA_soudan")
    プロジェクト = ""
    チーム作業 = ""
    区分 = "S"
    try:
        if len(sys.argv) < 2:
            raise ValueError("使い方: python sub_SPDCA_soudan.py <temp/pdca/入力JSON>")
        入力パス = Path(sys.argv[1]).resolve()
        with 入力パス.open("r", encoding="utf-8-sig") as f:
            項目 = json.load(f)
        プロジェクト = str(項目.get("プロジェクト", "")).strip()
        チーム目標 = str(項目.get("チーム目標", "")).strip()
        チーム作業 = str(項目.get("チーム作業", "")).strip()
        区分 = str(項目.get("PDCA区分", "")).strip() or "S"
        作業ループ回数 = max(1, min(99, int(項目.get("作業ループ回数", 1) or 1)))
        動員要員数 = max(
            1,
            min(動員要員数上限, int(項目.get("動員要員数", 既定動員要員数) or 既定動員要員数)),
        )
        if not プロジェクト or not チーム作業:
            raise ValueError("入力JSONにプロジェクトとチーム作業がありません")

        ループ = 次ループ番号(プロジェクト, 作業ループ回数)
        if not ループ:
            logger.info(
                f"作業ループ(S)は最大回数到達のため投入しません: プロジェクト={プロジェクト} "
                f"現在={team_pdca_db.ループ最大値(プロジェクト)} 設定={作業ループ回数}"
            )
            return 0

        # 2周目以降は前サイクルのAで洗い出した改善点を引き継いで議論を続ける
        前サイクル改善 = 前サイクルの改善内容(プロジェクト, ループ)
        選択用要求内容 = f"チーム作業「{チーム作業}」に向けた意見交換（相談）に参加する（プロジェクト: {プロジェクト}）。"
        if 前サイクル改善:
            選択用要求内容 += f"\n\n前サイクルのA（改善）で洗い出された改善点:\n{前サイクル改善}"
        要員一覧 = 相談要員を選ぶ(選択用要求内容, ループ, プロジェクト, 動員要員数, logger)
        logger.info(
            f"作業ループ({区分})を開始します: プロジェクト={プロジェクト} "
            f"ループ={ループ} 要員={','.join(要員一覧)} "
            f"前サイクル改善={'あり' if 前サイクル改善 else 'なし'}"
        )
        # 要員ごとの応答はスレッドで並列に呼び出す（HTTP待ちのI/Oが主体でGILの影響を受けにくい）。
        成功数 = 0
        with ThreadPoolExecutor(max_workers=len(要員一覧)) as executor:
            future一覧 = {
                executor.submit(
                    相談を実行, 要員ID, プロジェクト, チーム目標, チーム作業, 区分, ループ,
                    len(要員一覧), logger, 前サイクル改善,
                ): 要員ID
                for 要員ID in 要員一覧
            }
            for future in as_completed(future一覧):
                要員ID = future一覧[future]
                try:
                    if future.result():
                        成功数 += 1
                except Exception:
                    logger.exception(f"作業ループ({区分})の実行に失敗しました: 要員ID={要員ID}")
        logger.info(f"作業ループ({区分})の投入を終えました: 成功 {成功数}/{len(要員一覧)} 件")
        if not 成功数 and not team_pdca_db.ループ区分一覧(プロジェクト, ループ, 区分):
            # 1件もレコードを作れていないと、次の分にまた同じ段が投入されて堂々巡りになる
            sub_SPDCA__common.実行不能を記録(
                区分, プロジェクト, チーム作業, ループ,
                f"{len(要員一覧)}名すべての投入に失敗しました", logger,
            )
        return 0 if 成功数 else 1
    except Exception as exc:
        logger.exception("作業ループの投入処理に失敗しました")
        sub_SPDCA__common.投入失敗を記録(
            区分, プロジェクト, チーム作業, f"投入処理エラー: {exc}", logger
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
