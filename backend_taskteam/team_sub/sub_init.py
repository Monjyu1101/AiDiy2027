# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""Aチーム依頼の入力 JSON を aidiy_task_agents へ投入するサブプロセス。

team_watcher.py が temp/team/input/<依頼ID>.json に入力値を書き、
このスクリプトを `python sub_init.py <入力JSONパス>` で起動する。

処理の流れ:
1. 入力 JSON（要員ID / 依頼ID / 要求内容 など）を読み込む
2. 有効な要員一覧と、要員ごとの Aチーム経験（経験値・分類・直近の学び）を取得し、
   要求内容に最も適した要員をAIに選ばせて temp/team/output/<依頼ID>.json へ JSON 形式で書き出させる
   （経験のある要員へ寄せることで、蓄積したナレッジが再利用される）
3. 出力 JSON を検証する（有効な要員一覧に無ければ既定利用者ID='admin'へフォールバック）
4. 決定した利用者IDで aidiy_task_agents へ投入する
"""

from __future__ import annotations

import json
import os
import sys

from pathlib import Path as _AuthPath
sys.path.insert(0, str(_AuthPath(__file__).resolve().parent.parent))
from taskteam_proc.internal_client import post_json
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from log_config import get_logger, setup_logging
from team_proc import team_db, team_exp_db, team_work_db
from team_proc import team_context
from team_proc.config import AIモデル, 設定読込

BASE_DIR = Path(__file__).resolve().parent.parent
AIDIY_ROOT = BASE_DIR.parent
TASK_AGENTS_URL = (
    os.environ.get("AIDIY_TASK_AGENTS_URL")
    or "http://127.0.0.1:8095/aidiy_task_agents/submit"
)
CODE_AGENTS_URL = (
    os.environ.get("AIDIY_CODE_AGENTS_URL")
    or "http://127.0.0.1:8095/aidiy_code_agents/run"
)
既定利用者ID = "admin"
TEAM_AI_NAME既定 = "claude_cli"
TEAM_AI_MODEL既定 = "auto"
利用者選択最大試行回数 = 2
# 担当要員の選択は aidiy_code_agents/run が Code CLI を同期実行するため、応答まで数分かかる。
# POST送信 の既定（30秒）のままだと必ず timed out になり、毎回 既定利用者ID へ
# フォールバックして経験ベースの担当選択がまったく効かなくなる。
# 全試行の合計が team_work_db.準備無進捗タイムアウト分（10分）に収まる値にすること。
# 収まらないと、選択の再試行中に準備プロセスごとタイムアウトで打ち切られる。
利用者選択タイムアウト秒 = 240


def POST送信(url: str, payload: dict, timeout: int = 30) -> dict:
    return post_json(url, payload, timeout=timeout)


def _候補一覧テキスト(候補: list[dict]) -> str:
    行一覧 = []
    for 要員 in 候補:
        役割 = str(要員.get("役割", "")).strip()
        人格行 = str(要員.get("人格情報", "")).strip().splitlines()
        人格概要 = 人格行[0] if 人格行 else ""
        行一覧.append(f"- {要員['要員ID']}: {役割} / {人格概要}")
    return "\n".join(行一覧)


def _経験一覧テキスト(経験概要: list[dict], 候補ID集合: set[str]) -> str:
    """要員ごとの経験値と直近の経験（分類・学び）を、選択の判断材料として並べる。"""
    行一覧: list[str] = []
    for 概要 in 経験概要:
        要員ID = str(概要.get("要員ID", ""))
        if 要員ID not in 候補ID集合:
            continue
        行一覧.append(
            f"- {要員ID}: 経験値合計 {概要.get('経験値合計', 0)} / {概要.get('件数', 0)}件"
            f" / 最終 {概要.get('最終完了日時', '') or '記録なし'}"
        )
        for 経験 in 概要.get("直近", []):
            タイトル = str(経験.get("タスクタイトル", "")).strip() or "（タイトルなし）"
            分類 = str(経験.get("分類", "")).strip() or "未分類"
            学び = str(経験.get("学び", "")).strip()
            行一覧.append(f"    - [{分類}/{経験.get('経験値', 0)}] {タイトル}")
            if 学び:
                行一覧.append(f"      学び: {学び[:160]}")
    if not 行一覧:
        return "（まだ経験の記録がありません。人格情報と役割だけで判断してください）"
    return "\n".join(行一覧)


def プロンプト生成_担当選択(
    要求内容: str,
    候補: list[dict],
    出力JSONパス: str,
    経験概要: list[dict],
) -> str:
    """定型部は _config/AiDiy_team__select_context.json から読む。"""
    候補ID集合 = {str(要員["要員ID"]) for 要員 in 候補}
    return team_context.差し込み("select", "select_instruction_lines", {
        "要求内容": 要求内容,
        "_候補一覧テキスト(候補)": _候補一覧テキスト(候補),
        "_経験一覧テキスト(経験概要, 候補ID集合)": _経験一覧テキスト(経験概要, 候補ID集合),
        "出力JSONパス": 出力JSONパス,
    })


def 担当要員を選択(
    要求内容: str,
    依頼ID: str,
    logger,
    プロジェクト: str = "",
    候補: list[dict] | None = None,
    team_ai_name: str | None = None,
    team_ai_model: str | None = None,
) -> str:
    """要求内容に最も適した要員IDをAIに選ばせる。失敗・不正時は既定利用者IDへフォールバックする。

    判断材料として Aチーム経験（要員ごとの経験値・直近の学び）も渡す。
    候補を省略した場合は有効な要員一覧全員（admin含む）から選ぶ。
    呼び出し側で admin を避けたい等の絞り込みをしたい場合は候補に絞り込み済みの一覧を渡す。
    この選定処理は AiDiy ルートで実行するため TEAM_AI_NAME / TEAM_AI_MODEL_plan を使う。
    要員選定は計画（plan）の一部なので、モデルは共通設定の TEAM_AI_MODEL_plan を既定にする。
    """
    try:
        設定 = 設定読込()
        team_ai_name = (team_ai_name or "").strip() or str(
            getattr(設定, "TEAM_AI_NAME", "") or TEAM_AI_NAME既定
        ).strip()
        team_ai_model = (team_ai_model or "").strip() or AIモデル(
            "TEAM", "plan", TEAM_AI_MODEL既定
        )
    except Exception:
        team_ai_name = (team_ai_name or "").strip() or TEAM_AI_NAME既定
        team_ai_model = (team_ai_model or "").strip() or TEAM_AI_MODEL既定

    候補 = 候補 if 候補 is not None else team_db.要員一覧()
    候補ID集合 = {str(要員["要員ID"]) for 要員 in 候補}
    if not 候補:
        logger.warning("有効な要員が1名もいないため既定利用者IDで投入します")
        return 既定利用者ID

    # 経験の取得に失敗しても担当選択は続ける（経験なしとして扱う）
    try:
        経験概要 = team_exp_db.要員別経験概要(プロジェクト)
        if not any(str(概要.get("要員ID")) in 候補ID集合 for 概要 in 経験概要):
            # そのプロジェクトの経験が無ければ全プロジェクトの経験で判断する
            経験概要 = team_exp_db.要員別経験概要("")
    except Exception as e:
        logger.warning(f"Aチーム経験の取得に失敗したため経験なしで選択します: {e}")
        経験概要 = []

    出力DIR = BASE_DIR / "temp" / "team" / "output"
    出力DIR.mkdir(parents=True, exist_ok=True)
    出力JSONパス = str(出力DIR / f"{依頼ID}.json").replace("\\", "/")

    for 試行 in range(1, 利用者選択最大試行回数 + 1):
        try:
            if os.path.exists(出力JSONパス):
                os.remove(出力JSONパス)
            res = POST送信(
                CODE_AGENTS_URL,
                {
                    "prompt": プロンプト生成_担当選択(要求内容, 候補, 出力JSONパス, 経験概要),
                    "ai_name": team_ai_name,
                    "ai_model": team_ai_model,
                    "project_path": str(AIDIY_ROOT),
                },
                timeout=利用者選択タイムアウト秒,
            )
            if res.get("error") or res.get("status") != "OK":
                raise RuntimeError(str(res.get("error") or res.get("result")))
            if not os.path.isfile(出力JSONパス):
                raise RuntimeError("出力 JSON が生成されませんでした")
            with open(出力JSONパス, "r", encoding="utf-8-sig") as f:
                データ = json.load(f)
            選択ID = str(データ.get("利用者ID", "")).strip()
            if 選択ID not in 候補ID集合:
                raise ValueError(f"選択された要員IDが有効な要員一覧にありません: {選択ID!r}")
            return 選択ID
        except Exception as e:
            logger.warning(f"担当要員の選択 試行{試行}回目 失敗: {e}")
        finally:
            if os.path.exists(出力JSONパス):
                try:
                    os.remove(出力JSONパス)
                except OSError:
                    pass

    logger.warning(f"担当要員の選択に失敗したため既定利用者ID({既定利用者ID})で投入します: {依頼ID}")
    return 既定利用者ID


def _planモデル(項目: dict) -> str:
    """依頼レコードの TEAM_AI_MODEL_plan を返す（`auto` なら共通設定のフェーズ別値）。"""
    値 = str(項目.get("TEAM_AI_MODEL_plan", "") or "").strip()
    return 値 if 値 and 値 != "auto" else AIモデル("TEAM", "plan", TEAM_AI_MODEL既定)


def タスク投入(項目: dict, 利用者ID: str) -> dict:
    return POST送信(
        TASK_AGENTS_URL,
        {
            "prompt": str(項目["要求内容"]),
            "project_path": str(項目.get("プロジェクト", "")),
            "ai_name": str(項目.get("TASK_AI_NAME", "claude_cli")),
            # 依頼が持つ TASK 側3種を、そのまま Aタスク要求の準備 / 各ステップ / 最終確認へ渡す
            "ai_model_plan": str(項目.get("TASK_AI_MODEL_plan", "auto")),
            "ai_model_do": str(項目.get("TASK_AI_MODEL_do", "auto")),
            "ai_model_check": str(項目.get("TASK_AI_MODEL_check", "auto")),
            "user_id": 利用者ID,
            "task_id": str(項目["依頼ID"]),
            "enabled": bool(int(項目.get("実行有効", 1) or 0)),
            "return_task_id": True,
            "request_timeout_sec": 15,
        },
    )


def main() -> int:
    setup_logging("sub_init")
    logger = get_logger("team_sub_init")
    要員ID = ""
    依頼ID = ""
    try:
        if len(sys.argv) < 2:
            raise ValueError("使い方: python sub_init.py <temp/team/input/依頼ID.json>")
        入力パス = Path(sys.argv[1]).resolve()
        with 入力パス.open("r", encoding="utf-8-sig") as f:
            項目 = json.load(f)
        要員ID = str(項目.get("要員ID", "")).strip()
        依頼ID = str(項目.get("依頼ID", "")).strip()
        if not 要員ID or not 依頼ID or not str(項目.get("要求内容", "")).strip():
            raise ValueError("入力JSONに要員ID、依頼ID、要求内容がありません")

        担当利用者ID = 担当要員を選択(
            str(項目["要求内容"]),
            依頼ID,
            logger,
            str(項目.get("プロジェクト", "")).strip(),
            team_ai_name=str(項目.get("TEAM_AI_NAME", TEAM_AI_NAME既定)),
            # 要員選定は計画（plan）。依頼の TEAM_AI_MODEL_plan を使い、auto なら共通設定へ落とす
            team_ai_model=_planモデル(項目),
        )
        logger.info(
            f"aidiy_task_agentsへ投入します: {依頼ID} (要員ID={要員ID} -> 利用者ID={担当利用者ID})"
        )
        結果 = タスク投入(項目, 担当利用者ID)
        if 結果.get("status") != "OK":
            raise RuntimeError(str(結果.get("message") or "AIタスク投入に失敗しました"))
        タスクID = str(結果.get("タスクID") or 結果.get("task_id") or "").strip()
        if not タスクID:
            raise RuntimeError("aidiy_task_agentsの応答にタスクIDがありません")
        team_work_db.投入成功記録(依頼ID, タスクID)
        logger.info(f"AIタスクを投入しました: {依頼ID} -> {タスクID}")
        return 0
    except Exception as exc:
        logger.exception(f"チーム依頼のAIタスク投入に失敗しました: {依頼ID}")
        if 依頼ID:
            try:
                team_work_db.投入失敗記録(依頼ID, str(exc))
            except Exception:
                logger.exception("Aチーム依頼への失敗記録にも失敗しました")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
