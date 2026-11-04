# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""AIタスク生成の共通サブプロセス。

backend_taskteam の AI登録 API が task 用 temp/input/<タスクID>.json に入力値を書き、
このスクリプトを `python sub_init.py <入力JSONパス>` で起動する。
標準ライブラリのみで動作する。

処理の流れ:
1. 入力 JSON（利用者ID / タスクID / プロジェクト / 要求内容）を読み込む
2. 第1ステップ: 指定プロジェクトフォルダで指定 AI がタスク分解し、
   そのプロジェクトに最適な内容の JSON 形式文字列を応答本文で返す（ファイル書き込みなし）
3. 第2ステップ: AiDiy ルート（"../"）で指定 AI が分解結果を既定形式で
   temp/output/<タスクID>.json へ書き込む
4. 出力 JSON を検証する
5. 正常時は backend_taskteam へ本登録（仮登録は置き換え）、エラー時は仮登録を『失敗』にする
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

_SELF_DIR = os.path.dirname(os.path.abspath(__file__))
if _SELF_DIR not in sys.path:
    sys.path.insert(0, _SELF_DIR)
from sub_context import 差し込み  # noqa: E402  同フォルダの定型コンテキスト読込

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AIDIYルート = os.path.normpath(os.path.join(BASE_DIR, ".."))
TASK_API = "http://127.0.0.1:8093/task"
MCP_URL = "http://127.0.0.1:8095/aidiy_code_agents/run"
TASK_AI_NAME既定 = "codex_cli"
TASK_AI_MODEL既定 = "auto"
DEFAULT_CONFIG_PATH = "../_config/AiDiy_key.json"

タスクID = ""
利用者ID = ""
ログパス = os.path.join(BASE_DIR, "temp", "task", "sub_init.log")


def 入力モデル(入力: dict, フェーズ: str) -> str:
    """入力 JSON（AIタスク要求レコードの値）から指定フェーズのモデルを取り出す。

    フェーズは plan（準備）/ do（各ステップ）/ check（終了時の最終確認）。
    レコード側に指定が無ければ `AiDiy_key.json` のフェーズ別規定値を使う。
    """
    値 = str(入力.get(f"TASK_AI_MODEL_{フェーズ}", "") or "").strip()
    return 値 or TASK_AIモデル(フェーズ)


def TASK_AIモデル(フェーズ: str) -> str:
    """`AiDiy_key.json` の `TASK_AI_MODEL_<フェーズ>` を返す。

    フェーズは plan / do / check。
    """
    path = os.path.normpath(os.path.join(BASE_DIR, DEFAULT_CONFIG_PATH))
    try:
        with open(path, "r", encoding="utf-8-sig") as f:
            data = json.load(f)
        値 = data.get(f"TASK_AI_MODEL_{フェーズ}", TASK_AI_MODEL既定)
        return str(値 or TASK_AI_MODEL既定).strip() or TASK_AI_MODEL既定
    except Exception:
        return TASK_AI_MODEL既定


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


def POST送信(url: str, payload: dict, timeout: int = 3600) -> dict:
    return post_json(url, payload, timeout=timeout)


def JSON形式サンプル(利用者ID: str, タスクID: str, プロジェクト: str, task_ai_name: str, task_ai_model: str) -> str:
    return f"""{{
  "利用者ID": "{利用者ID}",
  "タスクID": "{タスクID}",
  "プロジェクト": "{プロジェクト}",
  "タイトル": "タスク全体を一言で表すタイトル（40文字以内）",
  "要求内容": "入力された要求内容を整理した文章",
  "マーメイド記号": "TD",
  "明細": [
    {{"利用者ID": "{利用者ID}", "タスクID": "{タスクID}", "明細SEQ": 0, "タイプ": "start", "タイトル": "開始", "要求内容": "", "先行SEQ": "", "TASK_AI_NAME": "{task_ai_name}", "TASK_AI_MODEL_do": "{task_ai_model}", "操作検証": false, "予測分数": 5}},
    {{"利用者ID": "{利用者ID}", "タスクID": "{タスクID}", "明細SEQ": 1, "タイプ": "do", "タイトル": "明細タイトル", "要求内容": "明細要求内容", "先行SEQ": "0", "TASK_AI_NAME": "{task_ai_name}", "TASK_AI_MODEL_do": "{task_ai_model}", "操作検証": false, "予測分数": 5}},
    {{"利用者ID": "{利用者ID}", "タスクID": "{タスクID}", "明細SEQ": 2, "タイプ": "if", "タイトル": "分岐条件のタイトル", "要求内容": "Y か N で判定させたい条件", "先行SEQ": "1", "TASK_AI_NAME": "{task_ai_name}", "TASK_AI_MODEL_do": "{task_ai_model}", "操作検証": false, "予測分数": 5}},
    {{"利用者ID": "{利用者ID}", "タスクID": "{タスクID}", "明細SEQ": 3, "タイプ": "do", "タイトル": "Yのときの明細タイトル", "要求内容": "Yのときの明細要求内容", "先行SEQ": "2=Y", "TASK_AI_NAME": "{task_ai_name}", "TASK_AI_MODEL_do": "{task_ai_model}", "操作検証": true, "予測分数": 10}},
    {{"利用者ID": "{利用者ID}", "タスクID": "{タスクID}", "明細SEQ": 4, "タイプ": "do", "タイトル": "Nのときの明細タイトル", "要求内容": "Nのときの明細要求内容", "先行SEQ": "2=N", "TASK_AI_NAME": "{task_ai_name}", "TASK_AI_MODEL_do": "{task_ai_model}", "操作検証": false, "予測分数": 5}},
    {{"利用者ID": "{利用者ID}", "タスクID": "{タスクID}", "明細SEQ": 5, "タイプ": "or", "タイトル": "合流", "要求内容": "", "先行SEQ": "3,4", "TASK_AI_NAME": "{task_ai_name}", "TASK_AI_MODEL_do": "{task_ai_model}", "操作検証": false, "予測分数": 1}},
    {{"利用者ID": "{利用者ID}", "タスクID": "{タスクID}", "明細SEQ": 9999, "タイプ": "end", "タイトル": "終了", "要求内容": "", "先行SEQ": "5", "TASK_AI_NAME": "{task_ai_name}", "TASK_AI_MODEL_do": "{task_ai_model}", "操作検証": true, "予測分数": 10}}
  ]
}}"""


def プロンプト生成_タスク分解(利用者ID: str, タスクID: str, プロジェクト: str, 要求内容: str, task_ai_name: str, task_ai_model: str) -> str:
    """plan フェーズ第1ステップ。定型部は _config/AiDiy_task__context.json から読む。"""
    return 差し込み("plan_instruction_lines", {
        "要求内容": 要求内容,
        "JSON形式サンプル": JSON形式サンプル(利用者ID, タスクID, プロジェクト, task_ai_name, task_ai_model),
    }) + (
        "\n要求に明示された作業範囲と回数の上限を優先してください。3〜10件は目安であり、単純な要求を件数合わせで増やしてはいけません。\n"
        "保存・照合などを1回と指定された場合、その作業を複数明細へ重複して分解しないでください。\n"
        "終了行の内部検証は実行記録から判断するため、照合済みの成果物を再読込する別の確認明細を追加しないでください。\n"
    )


JSON保存最大試行回数 = 2


def プロンプト生成_JSON保存(分解結果: str, 出力JSONパス: str, 利用者ID: str, タスクID: str, プロジェクト: str, task_ai_name: str, task_ai_model: str) -> str:
    """plan フェーズ第2ステップ。定型部は _config/AiDiy_task__context.json から読む。"""
    return 差し込み("plan_save_instruction_lines", {
        "出力JSONパス": 出力JSONパス,
        "JSON形式サンプル": JSON形式サンプル(利用者ID, タスクID, プロジェクト, task_ai_name, task_ai_model),
        "分解結果": 分解結果,
    })


# 明細タイプ。開始行(0)=start / 終了行(9999)=end は SEQ で確定し、その間は do / if / or から選ぶ。
# 同期元: tasks_db.py。sub_*.py は tasks_db を直接 import しない疎結合方針のため実装を持つ。
明細タイプ指定可能値 = ("do", "if", "or")
分岐条件値 = ("Y", "N")
# 先行SEQ の 1 要素。`5` は通常のエッジ、`5=Y` `5=N` は if 明細 5 の判定値で選ばれるエッジ。
_先行SEQ要素パターン = re.compile(r"^(\d+)(?:=([YN]))?$")


def 明細タイプ(明細SEQ: int, 指定=None) -> str:
    """明細タイプを決める（0=start / 9999=end / それ以外は指定の do・if・or、既定 do）。

    tasks_db.明細タイプ() と同じ規則。
    """
    if 明細SEQ == 0:
        return "start"
    if 明細SEQ == 9999:
        return "end"
    値 = str(指定 or "").strip().lower()
    return 値 if 値 in 明細タイプ指定可能値 else "do"


def 先行SEQ解析(先行SEQ) -> list[tuple[int, str]]:
    """先行SEQ 文字列を [(先行の明細SEQ, 分岐条件)] へ分解する（tasks_db.先行SEQ解析 と同じ規則）。

    分岐条件は "" / "Y" / "N"。書式が不正なときは ValueError を送出する。
    """
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


def _真偽値(値) -> bool:
    if isinstance(値, bool):
        return 値
    if isinstance(値, str):
        return 値.strip().lower() in ("true", "1")
    return bool(値)


def _正整数(値, 既定: int = 0) -> int:
    """0 以上の整数へ変換する（変換できない・負値は既定値）。予測分数の取り込みに使う。"""
    try:
        n = int(str(値).strip())
    except (TypeError, ValueError):
        return 既定
    return n if n >= 0 else 既定


def JSON検証(データ: dict, default_task_ai_name: str, default_task_ai_model: str) -> list[dict]:
    """出力 JSON を検証し、タスク明細の行リストへ変換する。不正なら ValueError。"""
    if not isinstance(データ, dict):
        raise ValueError("JSON のルートがオブジェクトではありません")
    for キー in ("利用者ID", "タスクID", "プロジェクト", "タイトル", "要求内容", "マーメイド記号", "明細"):
        if キー not in データ:
            raise ValueError(f"キー '{キー}' がありません")
    if str(データ["利用者ID"]).strip() != 利用者ID:
        raise ValueError("利用者IDが入力 JSON と一致していません")
    if str(データ["タスクID"]).strip() != タスクID:
        raise ValueError("タスクIDが入力 JSON と一致していません")
    if not str(データ["タイトル"]).strip():
        raise ValueError("タイトルが空です")
    明細 = データ["明細"]
    if not isinstance(明細, list) or len(明細) == 0:
        raise ValueError("明細が空です")
    行リスト: list[dict] = []
    for 行 in 明細:
        if not isinstance(行, dict):
            raise ValueError(f"明細行の形式が不正です: {行!r}")
        for キー in ("利用者ID", "タスクID", "明細SEQ", "タイトル", "要求内容", "先行SEQ"):
            if キー not in 行:
                raise ValueError(f"明細行にキー '{キー}' がありません: {行!r}")
        if str(行["利用者ID"]).strip() != 利用者ID:
            raise ValueError(f"明細行の利用者IDが一致していません: {行!r}")
        if str(行["タスクID"]).strip() != タスクID:
            raise ValueError(f"明細行のタスクIDが一致していません: {行!r}")
        n = int(行["明細SEQ"])
        行リスト.append({
            "明細SEQ": n,
            # 開始行・終了行は SEQ で確定し、その間は AI 指定の do / if / or を採用する
            "タイプ": 明細タイプ(n, 行.get("タイプ")),
            "タイトル": str(行["タイトル"]).strip(),
            "要求内容": str(行["要求内容"]).strip(),
            "先行SEQ": str(行["先行SEQ"]).strip(),
            "TASK_AI_NAME": str(行.get("TASK_AI_NAME", default_task_ai_name) or default_task_ai_name).strip(),
            # 明細は各ステップの実行なので do 用モデルだけを持つ
            "TASK_AI_MODEL_do": str(
                行.get("TASK_AI_MODEL_do", default_task_ai_model) or default_task_ai_model
            ).strip(),
            "操作検証": _真偽値(行.get("操作検証", False)),
            # AI が見積もった実行時間（分）。落とすと DB の予測分数が 0 のままになる
            "予測分数": _正整数(行.get("予測分数")),
        })
    明細SEQ集合 = {行["明細SEQ"] for 行 in 行リスト}
    if len(明細SEQ集合) != len(行リスト):
        raise ValueError("明細SEQが重複しています")
    if 0 not in 明細SEQ集合:
        raise ValueError("開始行（明細SEQ=0）がありません")
    if 9999 not in 明細SEQ集合:
        raise ValueError("終了行（明細SEQ=9999）がありません")
    タイプ表 = {行["明細SEQ"]: 行["タイプ"] for 行 in 行リスト}
    for 行 in 行リスト:
        if 行["明細SEQ"] == 0:
            if 行["タイトル"] != "開始" or 行["先行SEQ"]:
                raise ValueError("開始行（明細SEQ=0）は タイトル='開始'、先行SEQ='' にしてください")
        elif 行["明細SEQ"] == 9999:
            if 行["タイトル"] != "終了" or not 行["先行SEQ"]:
                raise ValueError("終了行（明細SEQ=9999）は タイトル='終了'、先行SEQに終端明細を指定してください")
        elif 行["明細SEQ"] < 1:
            raise ValueError(f"明細SEQが不正です: {行['明細SEQ']}")
        elif not 行["タイトル"]:
            raise ValueError(f"明細タイトルが空です: {行!r}")
        elif not 行["先行SEQ"]:
            raise ValueError(f"実作業明細の先行SEQが空です: {行!r}")
        for p, 条件 in 先行SEQ解析(行["先行SEQ"]):
            if p not in 明細SEQ集合:
                raise ValueError(f"先行SEQ '{行['先行SEQ']}' が明細SEQと対応していません")
            if p == 行["明細SEQ"]:
                raise ValueError(f"先行SEQに自分自身が含まれています: {行!r}")
            # 判定値を付けてよいのは先行が if 明細のときだけ。逆に if の後続は必ず付ける
            先行タイプ = タイプ表.get(p, "do")
            if 条件 and 先行タイプ != "if":
                raise ValueError(
                    f"先行SEQ '{p}={条件}' の明細SEQ={p} はタイプ if ではありません: {行!r}"
                )
            if 先行タイプ == "if" and not 条件:
                raise ValueError(
                    f"if 明細SEQ={p} を先行に持つ明細は '{p}=Y' か '{p}=N' で指定してください: {行!r}"
                )

    # if 明細は Y・N の両方に後続が要る（片方しか無いと、その判定になった時点で先が続かない）
    for 行 in 行リスト:
        if 行["タイプ"] != "if":
            continue
        for 判定 in 分岐条件値:
            if not any(
                (行["明細SEQ"], 判定) in 先行SEQ解析(他["先行SEQ"])
                for 他 in 行リスト
            ):
                raise ValueError(
                    f"if 明細SEQ={行['明細SEQ']} の {判定} 側の後続明細がありません"
                    f"（先行SEQ に '{行['明細SEQ']}={判定}' を持つ明細が必要です）"
                )

    # 操作検証: 開始行(0)は固定でfalse、終了行(9999)は実作業明細に1件でもtrueがあればtrue
    終了操作検証 = any(行["操作検証"] for 行 in 行リスト if 行["明細SEQ"] not in (0, 9999))
    for 行 in 行リスト:
        if 行["明細SEQ"] == 0:
            行["操作検証"] = False
        elif 行["明細SEQ"] == 9999:
            行["操作検証"] = 終了操作検証
    return 行リスト


def JSON保存と検証(
    分解結果: str,
    出力JSONパス: str,
    プロジェクト: str,
    task_ai_name: str,
    task_ai_model: str,
    plan_ai_model: str,
) -> tuple[dict, list[dict]]:
    """第2ステップ（JSON保存）と第3ステップ（検証）を実行する。失敗時は例外を送出する。

    `task_ai_model` は生成する明細へ書き込む値（明細実行 = do 用）、
    `plan_ai_model` はこの分解処理自体を動かすモデル（plan 用）。
    """
    if os.path.exists(出力JSONパス):
        os.remove(出力JSONパス)

    ログ(f"第2ステップ: JSON保存 (ai={task_ai_name}, model={plan_ai_model}, project_path={AIDIYルート})")
    res = POST送信(MCP_URL, {
        "prompt": プロンプト生成_JSON保存(分解結果, 出力JSONパス, 利用者ID, タスクID, プロジェクト, task_ai_name, task_ai_model),
        "ai_name": task_ai_name,
        "ai_model": plan_ai_model,
        "project_path": AIDIYルート,
    })
    ログ(f"第2ステップ応答: {json.dumps(res, ensure_ascii=False)[:300]}")
    if res.get("error") or res.get("status") != "OK":
        raise RuntimeError(f"第2ステップ（JSON保存）に失敗しました: {res.get('error') or res.get('result')}")

    # 第3ステップ: 出力 JSON の確認と検証
    if not os.path.isfile(出力JSONパス):
        raise RuntimeError(f"出力 JSON が生成されませんでした: {出力JSONパス}")
    with open(出力JSONパス, "r", encoding="utf-8-sig") as f:
        データ = json.load(f)
    行リスト = JSON検証(データ, task_ai_name, task_ai_model)
    ログ(f"JSON 検証 OK: 明細 {len(行リスト)} 件")
    return データ, 行リスト


def 本登録(データ: dict, 行リスト: list[dict], 元要求内容: str) -> None:
    # 要求内容は仮登録時の人間の入力をそのまま残し、AI がタスク分解のために整理した
    # 文章（データ["要求内容"]）は応答内容へ送る（人間の元の要求が消えないようにするため）
    res = POST送信(f"{TASK_API}/タスク要求/本登録", {
        "利用者ID": 利用者ID,
        "タスクID": タスクID,
        "タイトル": str(データ["タイトル"]).strip(),
        "要求内容": 元要求内容,
        "マーメイド記号": str(データ["マーメイド記号"]).strip(),
        "明細": 行リスト,
        "応答内容": str(データ["要求内容"]).strip(),
    }, timeout=60)
    if res.get("status") != "OK":
        raise RuntimeError(f"本登録に失敗しました: {res.get('message')}")


def 失敗登録(メッセージ: str) -> None:
    if not タスクID:
        return
    try:
        POST送信(f"{TASK_API}/タスク要求/AI失敗", {
            "利用者ID": 利用者ID,
            "タスクID": タスクID,
            "メッセージ": メッセージ[:500],
        }, timeout=60)
    except Exception as e:
        ログ(f"失敗登録もエラー: {e}")


def main() -> int:
    global タスクID, 利用者ID, ログパス
    try:
        if len(sys.argv) < 2:
            raise ValueError("使い方: python sub_init.py <temp/input/タスクID.json>")
        入力パス = os.path.abspath(sys.argv[1])
        with open(入力パス, "r", encoding="utf-8-sig") as f:
            入力 = json.load(f)
        利用者ID = str(入力.get("利用者ID", "")).strip()
        タスクID = str(入力.get("タスクID", "")).strip()
        プロジェクト = str(入力.get("プロジェクト", "")).strip()
        要求内容 = str(入力.get("要求内容", "")).strip()
        task_ai_name = str(入力.get("TASK_AI_NAME", TASK_AI_NAME既定) or TASK_AI_NAME既定).strip()
        # 生成する明細へ引き継ぐのは do のモデル（各ステップの実行に使う）
        task_ai_model = 入力モデル(入力, "do")
        # タスク分解（準備）そのものは plan のモデルで動かす
        plan_ai_model = 入力モデル(入力, "plan")
        if not 利用者ID or not タスクID or not 要求内容:
            raise ValueError("入力 JSON に 利用者ID、タスクID または 要求内容 がありません")

        ファイルステム = os.path.splitext(os.path.basename(入力パス))[0]
        ログパス = os.path.join(BASE_DIR, "temp", "task", f"{ファイルステム}.log")
        ログ(f"=== AIタスク生成 開始: {利用者ID}/{タスクID} ===")
        ログ(f"入力: {入力パス}")

        出力DIR = os.path.join(BASE_DIR, "temp", "output")
        os.makedirs(出力DIR, exist_ok=True)
        出力JSONパス = os.path.join(出力DIR, f"{ファイルステム}.json").replace("\\", "/")
        # 既存の出力 JSON は、新しい分解結果の生成・検証が完了するまで残す。
        # 同じディレクトリ内の一意な作業ファイルを使い、検証後に os.replace で置換する。
        作業JSONパス = os.path.join(
            出力DIR, f".{ファイルステム}.{os.getpid()}.pending.json"
        ).replace("\\", "/")

        # 1. 第1ステップ: 指定プロジェクトフォルダで AI がタスク分解（ファイル書き込みなし）
        ログ(f"第1ステップ: タスク分解 (ai={task_ai_name}, model={plan_ai_model}, project_path={プロジェクト or '既定'})")
        payload = {
            "prompt": プロンプト生成_タスク分解(利用者ID, タスクID, プロジェクト, 要求内容, task_ai_name, task_ai_model),
            "ai_name": task_ai_name,
            "ai_model": plan_ai_model,
        }
        if プロジェクト:
            payload["project_path"] = プロジェクト
        res = POST送信(MCP_URL, payload)
        ログ(f"第1ステップ応答: {json.dumps(res, ensure_ascii=False)[:300]}")
        if res.get("error") or res.get("status") != "OK":
            raise RuntimeError(f"第1ステップ（タスク分解）に失敗しました: {res.get('error') or res.get('result')}")
        分解結果 = str(res.get("result") or "").strip()
        if not 分解結果 or 分解結果 == "（応答なし）":
            raise RuntimeError("第1ステップ（タスク分解）の応答が空です")

        # 2. 第2ステップ: AiDiy ルート（"../"）で AI が既定形式の JSON を temp/output へ書き込む
        # 3. 第3ステップ: 出力 JSON の確認と検証
        # JSON保存・検証は AI 応答の揺れで失敗することがあるため、1回だけ自動リトライする
        for 試行 in range(1, JSON保存最大試行回数 + 1):
            try:
                データ, 行リスト = JSON保存と検証(
                    分解結果, 作業JSONパス, プロジェクト, task_ai_name, task_ai_model, plan_ai_model
                )
                break
            except Exception as e:
                ログ(f"第2/第3ステップ 試行{試行}回目 失敗: {e}")
                if 試行 >= JSON保存最大試行回数:
                    raise
                ログ("自動リカバリー: 第2ステップ（JSON保存）を再試行します")

        # 4. 検証済み出力と DB を本登録時に置き換える。
        #    DB 側の本登録は要求・明細を単一トランザクションで置換するため、事前全消去は不要。
        os.replace(作業JSONパス, 出力JSONパス)
        本登録(データ, 行リスト, 要求内容)
        ログ("本登録 完了")
        return 0

    except Exception as e:
        if "作業JSONパス" in locals() and os.path.exists(作業JSONパス):
            try:
                os.remove(作業JSONパス)
            except OSError as cleanup_error:
                ログ(f"作業 JSON の後片付けに失敗しました: {cleanup_error}")
        ログ(f"エラー: {e}\n{traceback.format_exc()}")
        失敗登録(str(e))
        return 1


if __name__ == "__main__":
    sys.exit(main())
