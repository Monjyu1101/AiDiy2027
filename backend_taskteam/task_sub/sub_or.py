# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""AIタスクの合流明細（タイプ=or）を処理するサブプロセス。

if 分岐で分かれた枝を 1 本にまとめる合流点。AI は使わず、先行SEQ のいずれか 1 本が
完了していれば機械的に完了させる（起動条件そのものが「いずれか 1 本の完了」なので、
ここでは通った枝を応答内容へ記録するだけ）。

先行が全て通らなかった場合、この明細は起動されず tasks_db.明細パス伝播 が パス にする。
ローカルの temp/input・temp/output JSON には依存せず、タスクID と SEQ だけで完結する。
標準ライブラリのみで動作する。

処理の流れ:
1. /task/タスク明細/一覧 から全明細（先行SEQ と各明細の状態・応答内容）を取得する
2. 先行SEQ のうち通った枝を求める（`<SEQ>=Y` / `<SEQ>=N` は if の判定値と突き合わせる）
3. 通った枝を応答内容に書いて /task/タスク明細/完了 を呼ぶ
"""

from __future__ import annotations

import json
import os
import re
import sys

from pathlib import Path as _AuthPath
sys.path.insert(0, str(_AuthPath(__file__).resolve().parent.parent))
from taskteam_proc.internal_client import post_json
import traceback

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TASK_API = "http://127.0.0.1:8093/task"
分岐条件値 = ("Y", "N")
# 先行SEQ の 1 要素。`5` は通常のエッジ、`5=Y` `5=N` は if 明細 5 の判定値で選ばれるエッジ。
# 同期元: tasks_db._先行SEQ要素パターン。sub_*.py は tasks_db を直接 import しない疎結合方針。
_先行SEQ要素パターン = re.compile(r"^(\d+)(?:=([YN]))?$")

タスクID = ""
明細SEQ = 0
ログパス = os.path.join(BASE_DIR, "temp", "task", "sub_or.log")


def _標準出力をUTF8化() -> None:
    """応答内容に含まれる — や絵文字で print が落ちないようにする。

    サブプロセスの標準出力は Windows では cp932 になるため、変換できない文字があると
    UnicodeEncodeError で処理全体が失敗してしまう。UTF-8（変換不可は置換）へ切り替える。
    """
    for ストリーム in (sys.stdout, sys.stderr):
        try:
            ストリーム.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


_標準出力をUTF8化()


def ログ(メッセージ: str) -> None:
    print(メッセージ, flush=True)
    os.makedirs(os.path.dirname(ログパス), exist_ok=True)
    with open(ログパス, "a", encoding="utf-8") as f:
        f.write(メッセージ + "\n")


def POST送信(url: str, payload: dict, timeout: int = 600) -> dict:
    return post_json(url, payload, timeout=timeout)


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


def 先行SEQ解析(先行SEQ) -> list[tuple[int, str]]:
    """先行SEQ 文字列を [(先行の明細SEQ, 分岐条件)] へ分解する（tasks_db.先行SEQ解析 と同じ規則）。"""
    結果: list[tuple[int, str]] = []
    for 要素 in str(先行SEQ or "").split(","):
        要素 = 要素.strip().upper()
        if not 要素:
            continue
        m = _先行SEQ要素パターン.match(要素)
        if not m:
            raise ValueError(f"先行SEQの書式が不正です: {要素}")
        結果.append((int(m.group(1)), m.group(2) or ""))
    return 結果


def if判定値(応答内容) -> str:
    """if 明細の応答内容から判定値（Y / N）を取り出す（tasks_db.if判定値 と同じ規則）。"""
    先頭 = str(応答内容 or "").strip()[:1].upper()
    return 先頭 if 先頭 in 分岐条件値 else ""


def 通った枝(全明細: list[dict], 対象: dict) -> list[str]:
    """先行SEQ のうち、実際に通ったエッジを表示用の文字列で返す。"""
    明細マップ = {int(行.get("明細SEQ", -1)): 行 for 行 in 全明細}
    結果: list[str] = []
    for p, 条件 in 先行SEQ解析(対象.get("先行SEQ", "")):
        先行行 = 明細マップ.get(p)
        if not 先行行 or str(先行行.get("状態", "")).strip() != "完了":
            continue
        if 条件 and if判定値(先行行.get("応答内容")) != 条件:
            continue
        タイトル = str(先行行.get("タイトル", "")).strip()
        ラベル = f"{p}={条件}" if 条件 else str(p)
        結果.append(f"{ラベル} {タイトル}".strip())
    return 結果


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
            raise ValueError("使い方: python sub_or.py <タスクID> <SEQ>")
        タスクID = str(sys.argv[1]).strip()
        明細SEQ = int(sys.argv[2])
        if not タスクID:
            raise ValueError("タスクIDが指定されていません")
        ログパス = os.path.join(BASE_DIR, "temp", "task", f"{タスクID}.step{明細SEQ}.log")
        ログ(f"=== 合流処理 開始: {タスクID} SEQ={明細SEQ} ===")

        # 1. 全明細を取得し、対象の合流明細を特定する
        全明細 = 明細一覧取得()
        対象 = 明細1件取得(全明細, 明細SEQ)
        if not 対象:
            raise ValueError(f"タスク明細に SEQ={明細SEQ} がありません")

        # 2. 通った枝を求める。起動条件が「いずれか 1 本の完了」なので通常は 1 本以上ある
        枝 = 通った枝(全明細, 対象)
        if not 枝:
            raise RuntimeError("完了した先行明細が見つかりませんでした（合流条件を満たしていません）")

        # 3. どの枝から合流したかを応答内容へ残して完了する
        応答内容 = "先行明細 " + "、".join(枝) + " の完了により合流しました。"
        ログ(応答内容)
        完了報告(応答内容)
        ログ("合流処理 完了")
        return 0
    except Exception as e:
        ログ(f"エラー: {e}\n{traceback.format_exc()}")
        失敗報告(str(e))
        return 1


if __name__ == "__main__":
    sys.exit(main())
