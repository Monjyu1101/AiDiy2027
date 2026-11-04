# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""AIタスクの開始明細を処理するサブプロセス。

開始明細では AI を使わず、HTTP API 経由の疎結合で次の定型処理を行う。
ローカルの temp/input・temp/output JSON には依存せず、タスクID と SEQ だけで完結する。
標準ライブラリのみで動作する。

処理の流れ:
1. /task/タスク要求/取得 で AIタスク要求（要求内容・プロジェクト）を取得する
2. aidiy_backup MCP でプロジェクトフォルダの差分バックアップを実行する
3. 応答内容へ要求内容をコピーして /task/タスク明細/開始完了 を呼ぶ
"""

from __future__ import annotations

import json
import os
import sys

from pathlib import Path as _AuthPath
sys.path.insert(0, str(_AuthPath(__file__).resolve().parent.parent))
from taskteam_proc.internal_client import post_json
import traceback

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TASK_API = "http://127.0.0.1:8093/task"
バックアップURL = "http://127.0.0.1:8095/aidiy_backup/save/run"

ログパス = os.path.join(BASE_DIR, "temp", "task", "sub_start.log")


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


def ログ(メッセージ: str) -> None:
    print(メッセージ, flush=True)
    os.makedirs(os.path.dirname(ログパス), exist_ok=True)
    with open(ログパス, "a", encoding="utf-8") as f:
        f.write(メッセージ + "\n")


def POST送信(url: str, payload: dict, timeout: int = 600) -> dict:
    return post_json(url, payload, timeout=timeout)


def バックアップ実行(プロジェクト: str) -> str:
    """aidiy_backup MCP で差分バックアップを実行し、注記を返す（失敗しても例外にしない）。"""
    try:
        payload = {"project_root": プロジェクト} if プロジェクト else {}
        結果 = POST送信(バックアップURL, payload)
        if 結果.get("error"):
            raise RuntimeError(str(結果["error"]))
        ログ(f"バックアップ完了: {json.dumps(結果, ensure_ascii=False)[:300]}")
        return ""
    except Exception as e:
        ログ(f"バックアップ失敗: {e}")
        return f"\n[注意] バックアップ失敗: {e}"


def main() -> int:
    global ログパス
    try:
        if len(sys.argv) < 3:
            raise ValueError("使い方: python sub_start.py <タスクID> <SEQ>")
        タスクID = str(sys.argv[1]).strip()
        明細SEQ = int(sys.argv[2])
        if not タスクID:
            raise ValueError("タスクIDが指定されていません")
        ログパス = os.path.join(BASE_DIR, "temp", "task", f"{タスクID}.step{明細SEQ}.log")

        ログ(f"=== 開始処理: {タスクID} SEQ={明細SEQ} ===")

        # 1. AIタスク要求 を取得（応答内容へのコピーとバックアップ対象の特定に使う）
        res = POST送信(f"{TASK_API}/タスク要求/取得", {
            "タスクID": タスクID,
        }, timeout=60)
        if res.get("status") != "OK":
            raise RuntimeError(f"AIタスク要求の取得に失敗しました: {res.get('message')}")
        要求 = res.get("data", {}).get("item", {})
        要求内容 = str(要求.get("要求内容", ""))
        プロジェクト = str(要求.get("プロジェクト", "")).strip()

        # 2. aidiy_backup でプロジェクトフォルダの差分バックアップを実行
        バックアップ注記 = バックアップ実行(プロジェクト)

        # 3. 応答内容へ要求内容をコピーして開始明細を完了
        res = POST送信(f"{TASK_API}/タスク明細/開始完了", {
            "タスクID": タスクID,
            "明細SEQ": 明細SEQ,
            "応答内容": 要求内容 + バックアップ注記,
        }, timeout=60)
        if res.get("status") != "OK":
            raise RuntimeError(f"開始完了報告に失敗しました: {res.get('message')}")
        ログ("開始処理 完了")
        return 0
    except Exception as e:
        ログ(f"エラー: {e}\n{traceback.format_exc()}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
