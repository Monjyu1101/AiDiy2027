# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""AIタスクの分岐明細（タイプ=if）を処理するサブプロセス。

要求内容を条件文として AI に判定させ、判定と理由を JSON で答えさせる。
判定は応答内容の先頭へ `Y: 理由` の形式で書き込むので、後続明細の
先行SEQ `<SEQ>=Y` / `<SEQ>=N` がどちらの枝を通すか決められる
（読み出しは tasks_db.if判定値）。

判定するだけの明細なので、ファイルの作成・修正は AI に行わせない。
ローカルの temp/input・temp/output JSON には依存せず、タスクID と SEQ だけで完結する。
標準ライブラリのみで動作する。

処理の流れ:
1. /task/タスク要求/取得 でタスク全体（タイトル・プロジェクト）を取得する
2. /task/タスク明細/一覧 から全明細（完了済みの応答内容、対象行の条件文）を取得する
3. aidiy_code_agents MCP へ Y / N 判定を依頼し、応答本文の JSON から判定を取り出す
4. `Y: 理由` を応答内容にして /task/タスク明細/完了 を呼ぶ
"""

from __future__ import annotations

import json
import os
import re
import sys

from pathlib import Path as _AuthPath
sys.path.insert(0, str(_AuthPath(__file__).resolve().parent.parent))
from taskteam_proc.internal_client import post_json, report_instruction
import traceback

_SELF_DIR = os.path.dirname(os.path.abspath(__file__))
if _SELF_DIR not in sys.path:
    sys.path.insert(0, _SELF_DIR)
from sub_context import 差し込み  # noqa: E402  同フォルダの定型コンテキスト読込

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TASK_API = "http://127.0.0.1:8093/task"
MCP_URL = "http://127.0.0.1:8095/aidiy_code_agents/run"
TASK_AI_NAME既定 = "codex_cli"
TASK_AI_MODEL既定 = "auto"
DEFAULT_CONFIG_PATH = "../_config/AiDiy_key.json"
分岐条件値 = ("Y", "N")
# 判定だけの明細なので実行は短い。sub_do.py と同じ計算式で、最低分だけ小さく取る。
CODEタイムアウト倍率 = 2
CODE最低タイムアウト分 = 5
CODE実行マージン秒 = 60
CODE実行HTTP余裕秒 = 300

タスクID = ""
明細SEQ = 0
ログパス = os.path.join(BASE_DIR, "temp", "task", "sub_if.log")


def _標準出力をUTF8化() -> None:
    """AI応答に含まれる — や絵文字で print が落ちないようにする。

    サブプロセスの標準出力は Windows では cp932 になるため、変換できない文字があると
    UnicodeEncodeError で処理全体が失敗してしまう。UTF-8（変換不可は置換）へ切り替える。
    """
    for ストリーム in (sys.stdout, sys.stderr):
        try:
            ストリーム.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


_標準出力をUTF8化()


def CODE実行タイムアウト秒(予測分数) -> int:
    """明細の予測分数（分）から code_agents へ渡すタイムアウト秒を求める（sub_do.py と同じ規則）。"""
    try:
        分 = int(str(予測分数).strip())
    except (TypeError, ValueError):
        分 = 0
    制限分 = max(CODE最低タイムアウト分, 分 * CODEタイムアウト倍率)
    return max(60, 制限分 * 60 - CODE実行マージン秒)


def TASK_AIモデル(フェーズ: str) -> str:
    """`AiDiy_key.json` の `TASK_AI_MODEL_<フェーズ>` を返す。フェーズは plan / do / check。"""
    path = os.path.normpath(os.path.join(BASE_DIR, DEFAULT_CONFIG_PATH))
    try:
        with open(path, "r", encoding="utf-8-sig") as f:
            data = json.load(f)
        値 = data.get(f"TASK_AI_MODEL_{フェーズ}", TASK_AI_MODEL既定)
        return str(値 or TASK_AI_MODEL既定).strip() or TASK_AI_MODEL既定
    except Exception:
        return TASK_AI_MODEL既定


def ログ(メッセージ: str) -> None:
    print(メッセージ, flush=True)
    os.makedirs(os.path.dirname(ログパス), exist_ok=True)
    with open(ログパス, "a", encoding="utf-8") as f:
        f.write(メッセージ + "\n")


def POST送信(url: str, payload: dict, timeout: int = 3600) -> dict:
    return post_json(url, payload, timeout=timeout)


def タスク要求取得() -> dict:
    res = POST送信(f"{TASK_API}/タスク要求/取得", {"タスクID": タスクID}, timeout=60)
    if res.get("status") != "OK":
        raise RuntimeError(f"AIタスク要求の取得に失敗しました: {res.get('message')}")
    return res.get("data", {}).get("item", {})


def 明細一覧取得() -> list[dict]:
    res = POST送信(f"{TASK_API}/タスク明細/一覧", {"タスクID": タスクID}, timeout=60)
    if res.get("status") != "OK":
        raise RuntimeError(f"タスク明細一覧の取得に失敗しました: {res.get('message')}")
    return res.get("data", {}).get("items", [])


def 明細1件取得(全明細: list[dict], 対象SEQ: int) -> dict:
    for 行 in 全明細:
        if int(行.get("明細SEQ", -1)) == 対象SEQ:
            return 行
    return {}


def 実行済ブロック生成(完了明細: list[dict]) -> str:
    """完了済み明細の応答内容を、実行済み記録のブロックへ組み立てる（sub_do.py と同じ形式）。"""
    実行済: list[str] = []
    for 行 in sorted(完了明細, key=lambda 行: int(行["明細SEQ"])):
        seq = int(行["明細SEQ"])
        タイトル = str(行.get("タイトル", "")).strip()
        応答内容 = str(行.get("応答内容", "")).strip()
        見出し = f"ステップ{seq} {タイトル} " + ("処理目標" if seq == 0 else "実行済")
        実行済.append(f"``` {見出し}\n{応答内容}\n```")
    return "\n".join(実行済) if 実行済 else "（実行済ステップはまだありません）"


def 全ステップ生成(全明細: list[dict]) -> str:
    return "\n".join(
        f"  {int(行['明細SEQ'])}. {str(行['タイトル']).strip()}（先行SEQ: {str(行['先行SEQ']).strip() or 'なし'}）"
        for 行 in 全明細
    )


def 分岐先生成(全明細: list[dict]) -> str:
    """この if 明細の Y / N でどの明細へ進むかを、AI へ示すテキストにする。"""
    行数: list[str] = []
    for 判定 in 分岐条件値:
        キー = f"{明細SEQ}={判定}"
        宛先 = [
            f"{int(行['明細SEQ'])} {str(行.get('タイトル', '')).strip()}"
            for 行 in 全明細
            if キー in str(行.get("先行SEQ", "")).upper().replace(" ", "").split(",")
        ]
        行数.append(f"  {判定} のとき: " + ("、".join(宛先) if 宛先 else "（後続なし）"))
    return "\n".join(行数)


def プロンプト生成(タスクタイトル: str, 全明細: list[dict], 対象: dict, 完了明細: list[dict]) -> str:
    """if フェーズ。外枠は do / check と共通、if 固有の指示は [今回要求] 側に入れる。"""
    今回要求ブロック = 差し込み("if_request_lines", {
        "明細SEQ": 対象["明細SEQ"],
        "明細タイトル": 対象["タイトル"],
        "明細要求内容": 対象["要求内容"],
        "分岐先": 分岐先生成(全明細),
    })
    今回要求ブロック += report_instruction()
    return 差し込み("common_instruction_lines", {
        "タスクタイトル": タスクタイトル,
        "全ステップ": 全ステップ生成(全明細),
        "実行済ブロック": 実行済ブロック生成(完了明細),
        "今回要求ブロック": 今回要求ブロック,
    })


def 判定取り出し(応答本文) -> tuple[str, str]:
    """AI の応答本文から判定 JSON を取り出し、(判定, 理由) を返す。

    コードフェンスや前後の説明文が付くことがあるため、本文中の JSON オブジェクトを
    後ろから順に試す。取り出せないときは ("", "") を返す。
    """
    本文 = str(応答本文 or "").strip()
    候補 = re.findall(r"\{[^{}]*\}", 本文, re.S)
    for 断片 in reversed(候補):
        try:
            データ = json.loads(断片)
        except (ValueError, TypeError):
            continue
        if not isinstance(データ, dict):
            continue
        判定 = str(データ.get("判定", "")).strip().upper()[:1]
        if 判定 in 分岐条件値:
            return 判定, str(データ.get("理由", "")).strip()
    return "", ""


def 完了報告(応答内容: str) -> None:
    res = POST送信(f"{TASK_API}/タスク明細/完了", {
        "タスクID": タスクID,
        "明細SEQ": 明細SEQ,
        "応答内容": 応答内容,
    }, timeout=60)
    if res.get("status") != "OK":
        raise RuntimeError(f"完了報告に失敗しました: {res.get('message')}")


def 失敗報告(メッセージ: str) -> None:
    if not タスクID:
        return
    try:
        POST送信(f"{TASK_API}/タスク明細/失敗", {
            "タスクID": タスクID,
            "明細SEQ": 明細SEQ,
            "メッセージ": メッセージ[:500],
        }, timeout=60)
    except Exception as e:
        ログ(f"失敗報告もエラー: {e}")


def main() -> int:
    global タスクID, 明細SEQ, ログパス
    try:
        if len(sys.argv) < 3:
            raise ValueError("使い方: python sub_if.py <タスクID> <SEQ>")
        タスクID = str(sys.argv[1]).strip()
        明細SEQ = int(sys.argv[2])
        if not タスクID:
            raise ValueError("タスクIDが指定されていません")
        ログパス = os.path.join(BASE_DIR, "temp", "task", f"{タスクID}.step{明細SEQ}.log")
        ログ(f"=== 分岐判定 開始: {タスクID} SEQ={明細SEQ} ===")

        # 1. AIタスク要求 からタイトル・プロジェクトを取得
        要求 = タスク要求取得()
        タスクタイトル = str(要求.get("タイトル", "")).strip()
        プロジェクト = str(要求.get("プロジェクト", "")).strip()

        # 2. 全明細を取得し、対象の分岐明細を特定する
        全明細 = 明細一覧取得()
        対象 = 明細1件取得(全明細, 明細SEQ)
        if not 対象:
            raise ValueError(f"タスク明細に SEQ={明細SEQ} がありません")
        完了明細 = [行 for 行 in 全明細 if str(行.get("状態", "")).strip() == "完了"]
        ログ(f"完了明細取得: {len(完了明細)} 件")

        # 3. code_agents へ Y / N 判定を依頼する（判定のみでファイル操作はさせない）
        task_ai_name = 対象.get("TASK_AI_NAME") or TASK_AI_NAME既定
        task_ai_model = 対象.get("TASK_AI_MODEL_do") or TASK_AIモデル("do")
        実行秒 = CODE実行タイムアウト秒(対象.get("予測分数"))
        ログ(
            f"code_agents run 呼び出し (タイトル={対象['タイトル']}, ai={task_ai_name}, "
            f"model={task_ai_model}, timeout={実行秒}秒, project_path={プロジェクト})"
        )
        payload = {
            "prompt": プロンプト生成(タスクタイトル, 全明細, 対象, 完了明細),
            "ai_name": task_ai_name,
            "ai_model": task_ai_model,
            "timeout_sec": 実行秒,
        }
        if プロジェクト:
            payload["project_path"] = プロジェクト
        res = POST送信(MCP_URL, payload, timeout=実行秒 + CODE実行HTTP余裕秒)
        ログ(f"code_agents run 応答: {json.dumps(res, ensure_ascii=False)[:500]}")
        if res.get("error") or res.get("status") != "OK":
            raise RuntimeError(
                f"code_agents の実行に失敗しました: {res.get('error') or res.get('result')}"
            )

        # 4. 応答本文の JSON から判定を取り出し、`Y: 理由` の形式で応答内容に残す
        判定, 理由 = 判定取り出し(res.get("result"))
        if not 判定:
            raise RuntimeError(
                "AI から Y / N の判定を取り出せませんでした"
                f"（応答: {str(res.get('result') or '')[:200]}）"
            )
        応答内容 = f"{判定}: {理由}" if 理由 else 判定
        ログ(f"判定: {判定} 理由: {理由 or '(なし)'}")
        完了報告(応答内容)
        ログ("分岐判定 完了")
        return 0
    except Exception as e:
        ログ(f"エラー: {e}\n{traceback.format_exc()}")
        失敗報告(str(e))
        return 1


if __name__ == "__main__":
    sys.exit(main())
