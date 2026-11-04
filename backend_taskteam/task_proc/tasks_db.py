# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""AIタスクの DB アクセス。

AIタスク要求 / AIタスク明細 テーブルを backend_server の共有 SQLite に作成し、
一覧取得・登録を提供する。Alembic は使わず CREATE TABLE IF NOT EXISTS で管理する。
"""

from __future__ import annotations

import os
import json
import math
import re
import sqlite3
from datetime import datetime, timedelta

_BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_DATABASE_PATH = "../_data/AiDiy/database.db"
DEFAULT_CONFIG_PATH = "../_config/AiDiy_key.json"
DB_PATH = os.path.normpath(os.path.join(_BASE_DIR, DEFAULT_DATABASE_PATH))
DB_DIR = os.path.dirname(DB_PATH)

_初期化済み = False

AIタスク要求テーブル = "Aタスク要求"
AIタスク明細テーブル = "Aタスク明細"
AIタスク実行条件テーブル = "Aタスク実行条件"
AIチーム依頼テーブル = "Aチーム依頼"
AIチーム作業テーブル = "Aチーム作業"
AIチーム要員テーブル = "Aチーム要員"
AIチーム状況テーブル = "Aチーム状況"
AIチーム経験テーブル = "Aチーム経験"
_採番テーブル = "C採番"
_採番ID = "Aタスク要求"
_採番プレフィックス = "TK"
_採番初期値 = 1000
CODE_BASE_PATH既定 = "../"
TASK_AI_NAME既定 = "codex_cli"
TASK_AI_MODEL既定 = "auto"
# AIタスク要求が持つモデルは3種。準備（AIによる明細分解）= plan、各ステップの実行 = do、
# 終了明細の最終確認 = check。明細レコードは do だけを持つ。
AIモデルフェーズ = ("plan", "do", "check")
AIモデルカラム = tuple(f"TASK_AI_MODEL_{フェーズ}" for フェーズ in AIモデルフェーズ)

# 実行条件の区分は文字値で保持する（状態と同じ日本語ファースト方針）
実行区分値 = ("即時", "時間指定", "間隔実行", "定時実行")
間隔区分値 = ("分", "時", "日")
定時区分値 = ("毎日", "毎週", "毎月")
実行曜日値 = ("日", "月", "火", "水", "木", "金", "土")
実行条件値 = ("無し", "フォルダ変化")

# 明細のタイプ。開始行(0)=start、終了行(9999)=end は明細SEQ で確定する。
# その間の明細は do（通常実行）/ if（AI が Y・N を判定する分岐）/ or（合流点）から選ぶ。
開始明細SEQ = 0
終了明細SEQ = 9999
明細タイプ値 = ("start", "do", "if", "or", "end")
明細タイプ指定可能値 = ("do", "if", "or")
分岐条件値 = ("Y", "N")

# 明細の状態。パス は if 分岐で選ばれなかった枝（失敗ではない）。
明細状態値 = ("待機", "実行中", "完了", "エラー", "中止", "パス")
# 後続の判定で「もう動かない」とみなす状態。エラーは復旧余地があるので含めない。
_決着済み状態 = ("完了", "パス", "中止")

# ダイアログから登録する入力カラム（残りはウォッチャーが管理するサーバー項目）
実行条件入力カラム = [
    "実行区分",
    "間隔区分",
    "間隔値",
    "定時区分",
    "実行曜日",
    "実行日",
    "開始時刻",
    "実行条件",
    "監視フォルダ",
]
実行条件既定値: dict[str, object] = {
    "実行区分": "即時",
    "間隔区分": "",
    "間隔値": 0,
    "定時区分": "",
    "実行曜日": "",
    "実行日": 0,
    "開始時刻": "",
    "実行条件": "無し",
    "監視フォルダ": "",
    "フォルダ内ファイル数": -1,
    "フォルダ内最終日時": "",
    "前回実行日時": "",
    "次回実行日時": "",
}


def _タスク規定設定() -> dict:
    """要求・明細レコードの既定値を `AiDiy_key.json` から読む。

    モデルは plan（準備）/ do（各ステップ）/ check（終了時の最終確認）の3種。
    """
    既定 = {
        "プロジェクト": CODE_BASE_PATH既定,
        "TASK_AI_NAME": TASK_AI_NAME既定,
        **{f"TASK_AI_MODEL_{フェーズ}": TASK_AI_MODEL既定 for フェーズ in AIモデルフェーズ},
    }
    path = os.path.normpath(os.path.join(_BASE_DIR, DEFAULT_CONFIG_PATH))
    try:
        with open(path, "r", encoding="utf-8-sig") as f:
            data = json.load(f)
    except Exception:
        return 既定
    設定 = dict(既定)
    設定["プロジェクト"] = str(data.get("CODE_BASE_PATH", CODE_BASE_PATH既定))
    設定["TASK_AI_NAME"] = str(data.get("TASK_AI_NAME", TASK_AI_NAME既定))
    for フェーズ in AIモデルフェーズ:
        キー = f"TASK_AI_MODEL_{フェーズ}"
        設定[キー] = str(data.get(キー, TASK_AI_MODEL既定) or TASK_AI_MODEL既定)
    return 設定


def _識別子(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def 接続取得() -> sqlite3.Connection:
    os.makedirs(DB_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    # database.db は backend_server / backend_taskteam が同時に触る。
    # 既定のジャーナルだと書き込み中に読み取りが弾かれて "database is locked" になるため、
    # 読み書きが並行できる WAL にし、ロック待ちも接続の timeout に合わせて長めに取る。
    conn.execute("PRAGMA busy_timeout = 30000")
    try:
        # WAL への切替は排他ロックが要るので、他プロセスが掴んでいる間は失敗する。
        # 一度でも成功すれば DB ファイルの属性として残るため、失敗しても次の接続に任せる。
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA synchronous = NORMAL")
    except sqlite3.Error:
        pass
    return conn


def _現在日時() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _正整数(値, 既定: int = 0) -> int:
    """0 以上の整数へ変換する（変換できない・負値は既定値）。予測分数などの取り込みに使う。"""
    try:
        n = int(値)
    except (TypeError, ValueError):
        return 既定
    return n if n >= 0 else 既定


def 明細タイプ(明細SEQ, 指定=None) -> str:
    """明細タイプを決める。開始行(0)=start / 終了行(9999)=end は明細SEQ で確定する。

    それ以外は 指定 の do / if / or を採用し、未指定・不正値は do にする。
    登録・更新はこの関数を通し、SEQ とタイプが食い違わないようにする。
    """
    seq = _正整数(明細SEQ, -1)
    if seq == 開始明細SEQ:
        return "start"
    if seq == 終了明細SEQ:
        return "end"
    値 = str(指定 or "").strip().lower()
    return 値 if 値 in 明細タイプ指定可能値 else "do"


# 先行SEQ の 1 要素。`5` は通常のエッジ、`5=Y` `5=N` は if 明細 5 の判定値で選ばれるエッジ。
_先行SEQ要素パターン = re.compile(r"^(\d+)(?:=([YN]))?$")


def 先行SEQ解析(先行SEQ) -> list[tuple[int, str]]:
    """先行SEQ 文字列を [(先行の明細SEQ, 分岐条件)] へ分解する。

    分岐条件は "" / "Y" / "N"。書式が不正なときは ValueError を送出するので、
    入力検証にもそのまま使える。
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


def if判定値(応答内容) -> str:
    """if 明細の応答内容から判定値（Y / N）を取り出す。

    sub_if.py は応答内容を `Y: 理由` の形式で書き込むので、先頭 1 文字が判定値になる。
    取り出せないときは空文字を返す（＝まだどちらの枝も選ばれていない）。
    """
    先頭 = str(応答内容 or "").strip()[:1].upper()
    return 先頭 if 先頭 in 分岐条件値 else ""


def _経過分数(開始日時: str, 終了日時: str) -> int:
    """開始〜終了の経過分を返す（切り上げ、最低 1 分）。求められないときは 0。

    明細の実績分数に使う。1 分未満で終わったステップも「0 分」ではなく 1 分として残し、
    実行されたことが分かるようにする。
    """
    開始 = str(開始日時 or "").strip()
    終了 = str(終了日時 or "").strip()
    if not 開始 or not 終了:
        return 0
    try:
        s = datetime.strptime(開始, "%Y-%m-%d %H:%M:%S")
        e = datetime.strptime(終了, "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return 0
    秒 = (e - s).total_seconds()
    if 秒 < 0:
        return 0
    return max(1, int((秒 + 59) // 60))


def _採番確保(conn: sqlite3.Connection) -> None:
    """C採番（backend_server共有）にAタスク要求用の採番行が無ければ作成する。"""
    conn.execute(f"""
        CREATE TABLE IF NOT EXISTS {_識別子(_採番テーブル)} (
            採番ID TEXT NOT NULL PRIMARY KEY,
            最終採番値 INTEGER NOT NULL,
            採番備考 TEXT,
            有効 INTEGER NOT NULL DEFAULT 1,
            登録日時 TEXT NOT NULL,
            登録利用者ID TEXT NOT NULL,
            登録利用者名 TEXT,
            登録端末ID TEXT NOT NULL,
            更新日時 TEXT NOT NULL,
            更新利用者ID TEXT NOT NULL,
            更新利用者名 TEXT,
            更新端末ID TEXT NOT NULL
        )
    """)
    now = _現在日時()
    conn.execute(
        f"""
        INSERT OR IGNORE INTO {_識別子(_採番テーブル)} (
            採番ID, 最終採番値, 採番備考, 有効,
            登録日時, 登録利用者ID, 登録利用者名, 登録端末ID,
            更新日時, 更新利用者ID, 更新利用者名, 更新端末ID
        ) VALUES (?, ?, ?, 1, ?, 'system', 'システム', 'backend_task', ?, 'system', 'システム', 'backend_task')
        """,
        [_採番ID, _採番初期値, "AIタスク要求の採番（TK）", now, now],
    )


def 新規タスクID() -> str:
    conn = 接続取得()
    try:
        _採番確保(conn)
        conn.execute(
            f"UPDATE {_識別子(_採番テーブル)} SET 最終採番値 = 最終採番値 + 1 WHERE 採番ID = ?",
            [_採番ID],
        )
        行 = conn.execute(
            f"SELECT 最終採番値 FROM {_識別子(_採番テーブル)} WHERE 採番ID = ?",
            [_採番ID],
        ).fetchone()
        conn.commit()
        return f"{_採番プレフィックス}{行[0]:08d}"
    finally:
        conn.close()


def _監査項目(利用者ID: str = "system", 利用者名: str = "システム") -> dict[str, str]:
    now = _現在日時()
    return {
        "登録日時": now,
        "登録利用者ID": 利用者ID,
        "登録利用者名": 利用者名,
        "登録端末ID": "backend_task",
        "更新日時": now,
        "更新利用者ID": 利用者ID,
        "更新利用者名": 利用者名,
        "更新端末ID": "backend_task",
    }


_監査カラムDDL = """
    登録日時 TEXT NOT NULL,
    登録利用者ID TEXT NOT NULL,
    登録利用者名 TEXT NOT NULL,
    登録端末ID TEXT NOT NULL,
    更新日時 TEXT NOT NULL,
    更新利用者ID TEXT NOT NULL,
    更新利用者名 TEXT NOT NULL,
    更新端末ID TEXT NOT NULL
"""


def _AIタスク要求テーブル作成(conn: sqlite3.Connection) -> None:
    conn.execute(f"""
        CREATE TABLE IF NOT EXISTS {AIタスク要求テーブル} (
            タスクID TEXT NOT NULL,
            利用者ID TEXT NOT NULL,
            プロジェクト TEXT NOT NULL DEFAULT '',
            タイトル TEXT NOT NULL,
            要求内容 TEXT NOT NULL DEFAULT '',
            TASK_AI_NAME TEXT NOT NULL DEFAULT 'codex_cli',
            TASK_AI_MODEL_plan TEXT NOT NULL DEFAULT 'auto',
            TASK_AI_MODEL_do TEXT NOT NULL DEFAULT 'auto',
            TASK_AI_MODEL_check TEXT NOT NULL DEFAULT 'auto',
            実行有効 INTEGER NOT NULL DEFAULT 1,
            状態 TEXT NOT NULL DEFAULT '準備完了',
            マーメイド記号 TEXT NOT NULL DEFAULT '',
            PID TEXT NOT NULL DEFAULT '',
            開始日時 TEXT NOT NULL DEFAULT '',
            終了日時 TEXT NOT NULL DEFAULT '',
            実行回数 INTEGER NOT NULL DEFAULT 0,
            応答タイトル TEXT NOT NULL DEFAULT '',
            応答内容 TEXT NOT NULL DEFAULT '',
            {_監査カラムDDL},
            PRIMARY KEY (タスクID)
        )
    """)






_明細カラムDDL = f"""
    タスクID TEXT NOT NULL,
    明細SEQ INTEGER NOT NULL,
    タイプ TEXT NOT NULL DEFAULT 'do',
    タイトル TEXT NOT NULL,
    要求内容 TEXT NOT NULL DEFAULT '',
    先行SEQ TEXT NOT NULL DEFAULT '',
    TASK_AI_NAME TEXT NOT NULL DEFAULT 'codex_cli',
    TASK_AI_MODEL_do TEXT NOT NULL DEFAULT 'auto',
    操作検証 INTEGER NOT NULL DEFAULT 0,
    実行有効 INTEGER NOT NULL DEFAULT 1,
    状態 TEXT NOT NULL DEFAULT '待機',
    PID TEXT NOT NULL DEFAULT '',
    開始日時 TEXT NOT NULL DEFAULT '',
    終了日時 TEXT NOT NULL DEFAULT '',
    実行回数 INTEGER NOT NULL DEFAULT 0,
    予測分数 INTEGER NOT NULL DEFAULT 0,
    実績分数 INTEGER NOT NULL DEFAULT 0,
    応答内容 TEXT NOT NULL DEFAULT '',
    {_監査カラムDDL},
    PRIMARY KEY (タスクID, 明細SEQ)
"""


def _AIタスク明細テーブル作成(conn: sqlite3.Connection) -> None:
    conn.execute(f"""
        CREATE TABLE IF NOT EXISTS {AIタスク明細テーブル} (
            {_明細カラムDDL}
        )
    """)


_実行条件カラムDDL = f"""
    利用者ID TEXT NOT NULL,
    タスクID TEXT NOT NULL,
    実行区分 TEXT NOT NULL DEFAULT '即時',
    間隔区分 TEXT NOT NULL DEFAULT '',
    間隔値 INTEGER NOT NULL DEFAULT 0,
    定時区分 TEXT NOT NULL DEFAULT '',
    実行曜日 TEXT NOT NULL DEFAULT '',
    実行日 INTEGER NOT NULL DEFAULT 0,
    開始時刻 TEXT NOT NULL DEFAULT '',
    実行条件 TEXT NOT NULL DEFAULT '無し',
    監視フォルダ TEXT NOT NULL DEFAULT '',
    フォルダ内ファイル数 INTEGER NOT NULL DEFAULT -1,
    フォルダ内最終日時 TEXT NOT NULL DEFAULT '',
    前回実行日時 TEXT NOT NULL DEFAULT '',
    次回実行日時 TEXT NOT NULL DEFAULT '',
    {_監査カラムDDL},
    PRIMARY KEY (タスクID)
"""


def _AIタスク実行条件テーブル作成(conn: sqlite3.Connection) -> None:
    conn.execute(f"""
        CREATE TABLE IF NOT EXISTS {AIタスク実行条件テーブル} (
            {_実行条件カラムDDL}
        )
    """)


# 手動登録 API 用の標準明細テンプレート（明細SEQ, タイトル, 先行SEQ）
_標準明細テンプレート: list[tuple[int, str, str]] = [
    (0, "開始", ""),
    (1, "要求分析", "0"),
    (2, "設計", "1"),
    (3, "実装A", "2"),
    (4, "実装B", "2"),
    (5, "テスト", "3,4"),
    (6, "リリース", "5"),
    (9999, "終了", "6"),
]

def 初期化() -> None:
    """テーブル作成を行う。多重呼び出し可。"""
    global _初期化済み
    if _初期化済み:
        return
    conn = 接続取得()
    try:
        _AIタスク要求テーブル作成(conn)
        _AIタスク明細テーブル作成(conn)
        _AIタスク実行条件テーブル作成(conn)
        conn.commit()
        _初期化済み = True
    finally:
        conn.close()


初期タスク利用者ID = "admin"


def 初期タスクを投入() -> str:
    """DB 再作成時、AIタスク要求が 1 件も無ければ実行監視のひな形を 1 件目に書き込む。

    中身は tasks_seed.py の汎用テンプレート（他タスクを監視し、エラーなら原因確認 →
    ロジック対策 → 再始動まで行う実行監視）で、監視対象を書き換えるだけで
    どのタスクにも自己改善を付けられる。

    実行有効=0・状態='完了'・明細も全件完了で入れるので、置いただけでは動き出さない。
    使うときは 監視対象タスクID を書き換えて実行有効を ON にする。状態='完了' かつ
    明細が全件完了なので、タスク発火() の条件を満たして実行開始条件の間隔で回り始める。
    明細側の実行有効は 1 のまま入れる（要求側の 0 だけで止まるため。
    明細まで 0 にすると、要求を ON に戻しても明細が起動しない）。

    投入したタスクIDを返す。既にタスクがあるときは何もせず空文字を返す。
    """
    初期化()
    conn = 接続取得()
    try:
        if conn.execute(f"SELECT 1 FROM {AIタスク要求テーブル} LIMIT 1").fetchone():
            return ""
    finally:
        conn.close()

    from . import tasks_seed

    タスクID = 新規タスクID()
    規定 = _タスク規定設定()
    now = _現在日時()
    監査 = _監査項目(初期タスク利用者ID, 初期タスク利用者ID)
    監査カラム = ", ".join(監査.keys())
    監査値 = list(監査.values())
    conn = 接続取得()
    try:
        conn.execute(
            "INSERT INTO {テーブル} (利用者ID, タスクID, プロジェクト, タイトル, 要求内容, TASK_AI_NAME, "
            "{モデルカラム}, 実行有効, 状態, マーメイド記号, 応答タイトル, 応答内容, {監査カラム}) "
            "VALUES (?, ?, ?, ?, ?, ?, {モデルプレース}, ?, ?, ?, ?, ?, {監査値プレース})".format(
                テーブル=AIタスク要求テーブル,
                モデルカラム=", ".join(AIモデルカラム),
                モデルプレース=", ".join("?" * len(AIモデルカラム)),
                監査カラム=監査カラム,
                監査値プレース=", ".join("?" * len(監査値)),
            ),
            [
                初期タスク利用者ID, タスクID, str(規定["プロジェクト"]),
                tasks_seed.タイトル, tasks_seed.要求内容, str(規定["TASK_AI_NAME"]),
                *[str(規定[カラム]) for カラム in AIモデルカラム],
                0, "完了", "TD",
                tasks_seed.応答タイトル, tasks_seed.応答内容,
                *監査値,
            ],
        )
        for 行 in tasks_seed.明細:
            明細SEQ = int(行["明細SEQ"])
            conn.execute(
                f"INSERT INTO {AIタスク明細テーブル} (タスクID, 明細SEQ, タイプ, タイトル, 要求内容, 先行SEQ, "
                f"TASK_AI_NAME, TASK_AI_MODEL_do, 操作検証, 実行有効, 状態, 予測分数, 応答内容, {監査カラム}) "
                f"VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, {', '.join('?' * len(監査値))})",
                [
                    タスクID, 明細SEQ, 明細タイプ(明細SEQ, 行.get("タイプ")),
                    str(行.get("タイトル", "")), str(行.get("要求内容", "")),
                    str(行.get("先行SEQ", "")),
                    str(規定["TASK_AI_NAME"]), str(規定["TASK_AI_MODEL_do"]),
                    1 if 行.get("操作検証") else 0,
                    1, "完了", _正整数(行.get("予測分数")),
                    tasks_seed.明細応答内容,
                    *監査値,
                ],
            )
        conn.commit()
    finally:
        conn.close()
    # 実行有効=0 の間は発火しないので、次回実行日時は空のまま登録される
    実行条件登録(タスクID, tasks_seed.実行条件, 初期タスク利用者ID)
    return タスクID


def _タスク登録(
    conn: sqlite3.Connection,
    利用者ID: str,
    タイトル: str,
    要求内容: str,
    状態: str,
    明細: list[tuple[int, str, str]],
) -> str:
    タスクID = 新規タスクID()
    監査 = _監査項目(利用者ID, 利用者ID)
    監査カラム = ", ".join(監査.keys())
    監査値 = list(監査.values())
    conn.execute(
        f"INSERT INTO {AIタスク要求テーブル} (利用者ID, タスクID, タイトル, 要求内容, 状態, {監査カラム}) "
        f"VALUES (?, ?, ?, ?, ?, {', '.join('?' * len(監査値))})",
        [利用者ID, タスクID, タイトル, 要求内容, 状態, *監査値],
    )
    for 明細SEQ, タイトル, 先行SEQ in 明細:
        規定 = _タスク規定設定()
        task_ai_name = 規定["TASK_AI_NAME"]
        # 明細は各ステップの実行なので do のモデルを使う
        task_ai_model = 規定["TASK_AI_MODEL_do"]
        conn.execute(
            f"INSERT INTO {AIタスク明細テーブル} (タスクID, 明細SEQ, タイプ, タイトル, 先行SEQ, TASK_AI_NAME, TASK_AI_MODEL_do, 状態, {監査カラム}) "
            f"VALUES (?, ?, ?, ?, ?, ?, ?, ?, {', '.join('?' * len(監査値))})",
            [タスクID, 明細SEQ, 明細タイプ(明細SEQ), タイトル, 先行SEQ, task_ai_name, task_ai_model, "待機", *監査値],
        )
    return タスクID


def 管理者判定(利用者ID: str) -> bool:
    """C利用者（backend_server共有）の権限IDが管理者(1)かどうかを判定する。"""
    conn = 接続取得()
    try:
        row = conn.execute(
            "SELECT 権限ID FROM C利用者 WHERE 利用者ID = ?",
            [利用者ID],
        ).fetchone()
        return bool(row) and str(row["権限ID"]) == "1"
    except sqlite3.OperationalError:
        return False
    finally:
        conn.close()


def タスク要求一覧(利用者ID: str, 全ユーザー: bool = False) -> list[dict]:
    初期化()
    conn = 接続取得()
    try:
        # 一覧は更新日時の降順。直近1か月分・最大1000件までに絞る
        期間閾値 = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d %H:%M:%S")
        条件 = "r.更新日時 >= ?"
        params: list = [期間閾値]
        if not 全ユーザー:
            条件 = "r.利用者ID = ? AND " + 条件
            params = [利用者ID, 期間閾値]
        rows = conn.execute(
            "SELECT r.利用者ID, r.タスクID, r.プロジェクト, r.タイトル, r.要求内容, r.TASK_AI_NAME, "
            f"{', '.join('r.' + カラム for カラム in AIモデルカラム)}, r.実行有効, r.状態, r.マーメイド記号, "
            "r.PID, r.開始日時, r.終了日時, r.実行回数, r.応答タイトル, r.応答内容, r.更新日時, "
            "COALESCE(j.次回実行日時, '') AS 次回実行日時, "
            "CASE WHEN r.状態 IN ('完了', 'エラー', '中止') AND COALESCE(j.次回実行日時, '') = '' THEN 9 ELSE 1 END AS 表示優先順位 "
            f"FROM {AIタスク要求テーブル} r "
            f"LEFT JOIN {AIタスク実行条件テーブル} j ON j.タスクID = r.タスクID "
            f"WHERE {条件} "
            "ORDER BY 表示優先順位 ASC, r.更新日時 DESC "
            "LIMIT 1000",
            params,
        ).fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()


def タスク要求最大更新日時(利用者ID: str, 全ユーザー: bool = False) -> str:
    初期化()
    conn = 接続取得()
    try:
        # 実行条件（次回実行日時など）の更新も一覧の再取得対象にする
        if 全ユーザー:
            row = conn.execute(
                "SELECT MAX(m) AS 最大更新日時 FROM ("
                f"SELECT MAX(更新日時) AS m FROM {AIタスク要求テーブル} "
                f"UNION ALL SELECT MAX(更新日時) FROM {AIタスク実行条件テーブル})"
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT MAX(m) AS 最大更新日時 FROM ("
                f"SELECT MAX(更新日時) AS m FROM {AIタスク要求テーブル} WHERE 利用者ID = ? "
                f"UNION ALL SELECT MAX(更新日時) FROM {AIタスク実行条件テーブル} WHERE 利用者ID = ?)",
                [利用者ID, 利用者ID],
            ).fetchone()
        return str(row["最大更新日時"] or "") if row else ""
    finally:
        conn.close()


def タスク要求新規既定値(利用者ID: str) -> dict:
    """新規登録時の既定値（プロジェクト / TASK_AI_NAME / TASK_AI_MODEL_plan・_do・_check）を返す。

    AIタスク_要求編集ダイアログの新規時と同じ条件で決める。
    利用者IDの更新最終レコードの値を引き継ぎ、レコードが無ければ規定値（AiDiy_key.json）を使う。
    プロジェクトは空文字もそのまま引き継ぐ（ダイアログが空欄を初期表示するのと同じ）。
    """
    初期化()
    規定 = _タスク規定設定()
    既定 = {
        "プロジェクト": 規定["プロジェクト"] or CODE_BASE_PATH既定,
        "TASK_AI_NAME": 規定["TASK_AI_NAME"] or TASK_AI_NAME既定,
        **{カラム: 規定[カラム] or TASK_AI_MODEL既定 for カラム in AIモデルカラム},
        "参照タスクID": "",
    }
    利用者ID = (利用者ID or "").strip()
    if not 利用者ID:
        return 既定
    conn = 接続取得()
    try:
        row = conn.execute(
            f"SELECT タスクID, プロジェクト, TASK_AI_NAME, {', '.join(AIモデルカラム)} "
            f"FROM {AIタスク要求テーブル} WHERE 利用者ID = ? ORDER BY 更新日時 DESC, タスクID DESC LIMIT 1",
            [利用者ID],
        ).fetchone()
    finally:
        conn.close()
    if not row:
        return 既定
    return {
        "プロジェクト": str(row["プロジェクト"] or ""),
        "TASK_AI_NAME": str(row["TASK_AI_NAME"] or "").strip() or 既定["TASK_AI_NAME"],
        **{
            カラム: str(row[カラム] or "").strip() or 既定[カラム]
            for カラム in AIモデルカラム
        },
        "参照タスクID": str(row["タスクID"] or ""),
    }


def タスク明細一覧(タスクID: str) -> list[dict]:
    初期化()
    conn = 接続取得()
    try:
        rows = conn.execute(
            "SELECT タスクID, 明細SEQ, タイプ, タイトル, 要求内容, 先行SEQ, TASK_AI_NAME, TASK_AI_MODEL_do, 操作検証, 実行有効, 状態, "
            f"PID, 開始日時, 終了日時, 実行回数, 予測分数, 実績分数, 応答内容, 更新日時 FROM {AIタスク明細テーブル} "
            "WHERE タスクID = ? ORDER BY 明細SEQ",
            [タスクID],
        ).fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()


def タスク明細取得(タスクID: str, 明細SEQ: int) -> dict:
    初期化()
    conn = 接続取得()
    try:
        row = conn.execute(
            "SELECT タスクID, 明細SEQ, タイプ, タイトル, 要求内容, 先行SEQ, TASK_AI_NAME, TASK_AI_MODEL_do, 操作検証, 実行有効, 状態, "
            f"PID, 開始日時, 終了日時, 実行回数, 応答内容 FROM {AIタスク明細テーブル} "
            "WHERE タスクID = ? AND 明細SEQ = ?",
            [タスクID, 明細SEQ],
        ).fetchone()
        return dict(row) if row else {}
    finally:
        conn.close()


def タスク明細最大更新日時(タスクID: str) -> str:
    初期化()
    conn = 接続取得()
    try:
        row = conn.execute(
            f"SELECT MAX(更新日時) AS 最大更新日時 FROM {AIタスク明細テーブル} "
            "WHERE タスクID = ?",
            [タスクID],
        ).fetchone()
        return str(row["最大更新日時"] or "") if row else ""
    finally:
        conn.close()


def タスク要求登録(利用者ID: str, タイトル: str, 要求内容: str) -> dict:
    """タスク要求を登録し、標準工程明細を自動生成する。"""
    初期化()
    conn = 接続取得()
    try:
        タスクID = _タスク登録(conn, 利用者ID, タイトル, 要求内容, "待機", _標準明細テンプレート)
        conn.commit()
        return _タスク要求取得(conn, タスクID)
    finally:
        conn.close()


def _タスク要求取得(conn: sqlite3.Connection, タスクID: str) -> dict:
    """CRUDのキーはタスクID単独。利用者IDは所有者を表す属性で、キーには使わない。"""
    row = conn.execute(
        "SELECT 利用者ID, タスクID, プロジェクト, タイトル, 要求内容, TASK_AI_NAME, "
        f"{', '.join(AIモデルカラム)}, 実行有効, 状態, マーメイド記号, "
        f"PID, 開始日時, 終了日時, 実行回数, 応答タイトル, 応答内容, 更新日時 FROM {AIタスク要求テーブル} "
        "WHERE タスクID = ?",
        [タスクID],
    ).fetchone()
    return dict(row) if row else {}


def _Aチーム依頼反映(
    conn: sqlite3.Connection,
    タスクID: str,
    状態: str | None = None,
    応答タイトル: str | None = None,
    応答内容: str | None = None,
    終了日時: str | None = None,
    guard: str = "状態 != 'エラー'",
) -> None:
    """タスクIDがAチーム依頼から投入されたものであれば、状態・応答内容をチーム側にも反映する。

    Aチーム依頼とAタスク要求は同一SQLiteを共有しているため、同一トランザクションで直接UPDATEする
    （タスクIDが一致しなければ何も更新されない）。guardはAチーム依頼側の現在状態に対する条件で、
    通常は既にエラーの項目を上書きしない。エラー化や再試行（エラーからの復帰）は呼び出し側で指定する。
    終了日時は完了時に必ず渡すこと。渡さないと Aチーム依頼側の終了日時が空のまま残り、
    team_work_db の依頼タイムアウト対象一覧（終了日時=''）に誤って引っかかりエラー化されてしまう。
    """
    項目: dict[str, str] = {}
    if 状態 is not None:
        項目["状態"] = 状態
    if 応答タイトル is not None:
        項目["応答タイトル"] = 応答タイトル
    if 応答内容 is not None:
        項目["応答内容"] = 応答内容
    if 終了日時 is not None:
        項目["終了日時"] = 終了日時
    if 項目:
        now = _現在日時()
        設定 = ", ".join(f"{列} = ?" for 列 in 項目)
        条件 = f"WHERE タスクID = ? AND {guard}" if guard else "WHERE タスクID = ?"
        conn.execute(
            f"UPDATE {AIチーム依頼テーブル} SET {設定}, 更新日時 = ? {条件}",
            [*項目.values(), now, タスクID],
        )
    _Aチーム作業反映(conn, タスクID, 状態=状態, 応答内容=応答内容, 終了日時=終了日時)


def _Aチーム作業反映(
    conn: sqlite3.Connection,
    タスクID: str,
    状態: str | None = None,
    応答内容: str | None = None,
    終了日時: str | None = None,
) -> None:
    """タスクIDが作業ループ（PDCA）から投入されたものであれば、Aチーム作業にも反映する。

    Aチーム作業の 状況 はAチーム依頼の状態を写した表示用の値で、「その段が終わったか」は
    終了日時が入っているかどうかで判断する（Team 処理はそれを見て次の段を投入する）。そのため
    - 完了: 状況・応答内容を書き込む（経験生成を待つため終了日時は空のまま）
    - エラー: 状況・終了日時・応答内容を書き込む
    - 実行中へ戻る（再試行）: 状況を実行中にし、終了日時を空へ戻す
    とする。Aチーム作業は Team 処理が作成するテーブルのため、未作成なら何もしない。
    """
    項目: dict[str, str] = {}
    if 状態 is not None:
        項目["状況"] = 状態
    if 応答内容 is not None:
        項目["応答内容"] = 応答内容
    if 状態 == "完了":
        項目["終了日時"] = ""
    elif 終了日時 is not None:
        項目["終了日時"] = 終了日時
    elif 状態 == "エラー":
        項目["終了日時"] = _現在日時()
    elif 状態 == "実行中":
        項目["終了日時"] = ""
    if not 項目:
        return
    now = _現在日時()
    設定 = ", ".join(f"{列} = ?" for 列 in 項目)
    try:
        conn.execute(
            f"UPDATE {AIチーム作業テーブル} SET {設定}, 更新日時 = ? "
            f"WHERE 依頼ID IN (SELECT 依頼ID FROM {AIチーム依頼テーブル} WHERE タスクID = ?)",
            [*項目.values(), now, タスクID],
        )
    except sqlite3.OperationalError as exc:
        # Team 処理の初期化前でテーブルが未作成の場合だけ何もしない。
        # 列不足などのスキーマ不整合は隠さず、呼び出し側へ伝える。
        if "no such table" not in str(exc):
            raise


def タスク要求取得(タスクID: str) -> dict:
    """AIタスク要求 1 件をタスクID（単独主キー）で取得する。"""
    初期化()
    conn = 接続取得()
    try:
        return _タスク要求取得(conn, タスクID)
    finally:
        conn.close()


def _実行条件取得(conn: sqlite3.Connection, タスクID: str) -> dict:
    row = conn.execute(
        "SELECT 利用者ID, タスクID, 実行区分, 間隔区分, 間隔値, 定時区分, 実行曜日, 実行日, 開始時刻, "
        "実行条件, 監視フォルダ, フォルダ内ファイル数, フォルダ内最終日時, 前回実行日時, 次回実行日時, 更新日時 "
        f"FROM {AIタスク実行条件テーブル} WHERE タスクID = ?",
        [タスクID],
    ).fetchone()
    return dict(row) if row else {}


def 実行条件取得(タスクID: str) -> dict:
    """AIタスク実行条件 1 件を取得する。行が無ければ空 dict（即時扱い）。"""
    初期化()
    conn = 接続取得()
    try:
        return _実行条件取得(conn, タスクID)
    finally:
        conn.close()


def 実行条件監視一覧() -> list[dict]:
    """毎分の発火確認対象（時間駆動またはフォルダ変化条件）を親要求の状態つきで返す。"""
    初期化()
    conn = 接続取得()
    try:
        rows = conn.execute(
            "SELECT j.利用者ID, j.タスクID, j.実行区分, j.間隔区分, j.間隔値, j.定時区分, j.実行曜日, j.実行日, j.開始時刻, "
            "j.実行条件, j.監視フォルダ, j.フォルダ内ファイル数, j.フォルダ内最終日時, j.前回実行日時, j.次回実行日時, "
            "r.状態 AS 要求状態, r.実行有効 AS 要求実行有効, "
            # 明細が 1 件も動いていなければ「未実行」。準備完了へ戻した直後も 0 になる
            "(SELECT COUNT(*) FROM " + AIタスク明細テーブル + " d "
            " WHERE d.タスクID = j.タスクID AND d.実行回数 > 0) AS 実行済明細数 "
            f"FROM {AIタスク実行条件テーブル} j JOIN {AIタスク要求テーブル} r "
            "ON r.タスクID = j.タスクID "
            "WHERE j.実行区分 IN ('時間指定', '間隔実行', '定時実行') OR j.実行条件 = 'フォルダ変化' "
            "ORDER BY j.タスクID"
        ).fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()


def 即時発火対象一覧() -> list[dict]:
    """即時実行かつ実行有効・準備完了の要求を返す（実行条件行が無い場合も即時扱い）。

    実行条件が無しの即時実行だけを対象とする。フォルダ変化は毎分の条件監視で扱う。
    条件無しの即時実行（実行区分='即時'）は 実行条件監視一覧() の対象外であり、
    放置すると準備完了のまま次回実行が発火しない。10 秒ループの先頭でこの一覧を確認し、
    タスク発火() で待機に戻すことで、条件監視より前に毎回（1 分ゲート無しで）再実行させる。
    """
    初期化()
    conn = 接続取得()
    try:
        rows = conn.execute(
            f"SELECT r.利用者ID, r.タスクID FROM {AIタスク要求テーブル} r "
            f"LEFT JOIN {AIタスク実行条件テーブル} j ON j.タスクID = r.タスクID "
            "WHERE r.実行有効 = 1 AND r.状態 = '準備完了' "
            "AND (j.実行区分 IS NULL OR j.実行区分 = '即時') "
            "AND (j.実行条件 IS NULL OR j.実行条件 = '無し') "
            "ORDER BY r.タスクID"
        ).fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()


def 実行条件監視取得(タスクID: str) -> dict | None:
    """発火確認と同じ形（親要求の状態つき）で実行条件 1 件を返す（無ければ None）。"""
    初期化()
    conn = 接続取得()
    try:
        row = conn.execute(
            "SELECT j.利用者ID, j.タスクID, j.実行区分, j.間隔区分, j.間隔値, j.定時区分, j.実行曜日, j.実行日, j.開始時刻, "
            "j.実行条件, j.監視フォルダ, j.フォルダ内ファイル数, j.フォルダ内最終日時, j.前回実行日時, j.次回実行日時, "
            "r.状態 AS 要求状態, r.実行有効 AS 要求実行有効, "
            # 明細が 1 件も動いていなければ「未実行」。準備完了へ戻した直後も 0 になる
            "(SELECT COUNT(*) FROM " + AIタスク明細テーブル + " d "
            " WHERE d.タスクID = j.タスクID AND d.実行回数 > 0) AS 実行済明細数 "
            f"FROM {AIタスク実行条件テーブル} j JOIN {AIタスク要求テーブル} r "
            "ON r.タスクID = j.タスクID "
            "WHERE j.タスクID = ?",
            [タスクID],
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def 次回実行日時更新(タスクID: str, 次回実行日時: str, 前回実行日時: str | None = None) -> None:
    """実行条件の次回実行日時（発火時は前回実行日時も）を更新する。"""
    初期化()
    conn = 接続取得()
    try:
        now = _現在日時()
        if 前回実行日時 is None:
            conn.execute(
                f"UPDATE {AIタスク実行条件テーブル} SET 次回実行日時 = ?, 更新日時 = ? "
                "WHERE タスクID = ?",
                [次回実行日時, now, タスクID],
            )
        else:
            conn.execute(
                f"UPDATE {AIタスク実行条件テーブル} SET 次回実行日時 = ?, 前回実行日時 = ?, 更新日時 = ? "
                "WHERE タスクID = ?",
                [次回実行日時, 前回実行日時, now, タスクID],
            )
        conn.commit()
    finally:
        conn.close()


def 発火対象外次回実行日時クリア() -> int:
    """発火対象外の実行条件の次回実行日時を一括で空にして件数を返す。

    対象外 = 時間駆動（時間指定/間隔実行/定時実行）でない、または保持可能状態
    （実行有効 かつ 要求が 待機/実行中/準備完了/完了）でないもの。状態監視ループの
    対象にならない行（即時など）も含めて漏れなくクリアする。

    繰り返し実行（間隔実行/定時実行）がエラーで終わった行だけは例外で、次回実行日時を残す。
    これが tasks_watcher の自動復旧の目印になり、1 周期の失敗でループが終わらなくなる
    （日時を消してしまうと、次の周期が来ないまま止まる）。
    """
    初期化()
    conn = 接続取得()
    try:
        cur = conn.execute(
            f"UPDATE {AIタスク実行条件テーブル} SET 次回実行日時 = '', 更新日時 = ? "
            "WHERE 次回実行日時 != '' AND ("
            "実行区分 NOT IN ('時間指定', '間隔実行', '定時実行') "
            f"OR NOT EXISTS (SELECT 1 FROM {AIタスク要求テーブル} r "
            f"WHERE r.タスクID = {AIタスク実行条件テーブル}.タスクID "
            "AND ((r.実行有効 = 1 AND r.状態 IN ('待機', '実行中', '準備完了', '完了')) "
            "OR (r.状態 = 'エラー' "
            f"AND {AIタスク実行条件テーブル}.実行区分 IN ('間隔実行', '定時実行')))))",
            [_現在日時()],
        )
        conn.commit()
        return cur.rowcount
    finally:
        conn.close()


def フォルダ状態記録(タスクID: str, ファイル数: int, 最終日時: str) -> None:
    """フォルダ変化判定用のスナップショット（ファイル数・最終更新日時）を保存する。"""
    初期化()
    conn = 接続取得()
    try:
        conn.execute(
            f"UPDATE {AIタスク実行条件テーブル} SET フォルダ内ファイル数 = ?, フォルダ内最終日時 = ?, 更新日時 = ? "
            "WHERE タスクID = ?",
            [ファイル数, 最終日時, _現在日時(), タスクID],
        )
        conn.commit()
    finally:
        conn.close()


def 明細全件有効待機化(タスクID: str) -> int:
    """準備完了への戻し時: 全明細を 実行有効=1・状態=待機 に戻して再実行可能にする。

    PID・開始日時・終了日時・実行回数もリセットする（タスク発火と同じ初期化）。
    """
    初期化()
    conn = 接続取得()
    try:
        cur = conn.execute(
            f"UPDATE {AIタスク明細テーブル} SET 実行有効 = 1, 状態 = '待機', PID = '', "
            "開始日時 = '', 終了日時 = '', 実行回数 = 0, 実績分数 = 0, 更新日時 = ? "
            "WHERE タスクID = ?",
            [_現在日時(), タスクID],
        )
        conn.commit()
        return cur.rowcount
    finally:
        conn.close()


def タスク発火(タスクID: str, エラー再開: bool = False) -> bool:
    """実行開始条件の成立時: 明細 → 要求の順で 待機 に戻し、再実行対象にする。

    要求が 準備完了 / 完了 かつ実行有効で、明細が全件待機（未実行）または
    全件が 完了 / パス（1 周を終えた状態）のときだけ発火する
    （実行途中・エラー・中止のタスクは開始させない）。
    パス を含めるのは、if 分岐のあるタスクが通らなかった枝を パス で残すため。
    完了だけを許すと、分岐を持つタスクが 2 周目から発火しなくなる。
    明細は PID・開始日時・終了日時・実行回数もリセットする（応答内容は次回実行で上書き）。

    エラー再開=True は、繰り返し実行（間隔実行 / 定時実行）の 1 周期がエラーで終わった
    ときに次の周期を始めるための緩和で、tasks_watcher の自動復旧だけが使う。
    エラーの要求と、エラー・パスを含む明細をまとめて 待機 へ戻し、明細失敗 / タスク失敗 が
    落とした 実行有効 も 1 に戻す（1 度のエラーで監視ループが永久に止まらないようにする）。
    実行中・準備中の明細が残っているときは、生きているプロセスを横取りしないよう再開しない。
    """
    初期化()
    conn = 接続取得()
    try:
        req = conn.execute(
            f"SELECT 状態, 実行有効 FROM {AIタスク要求テーブル} WHERE タスクID = ?",
            [タスクID],
        ).fetchone()
        if req is None:
            return False
        許可状態 = ("準備完了", "完了", "エラー") if エラー再開 else ("準備完了", "完了")
        if str(req["状態"]) not in 許可状態:
            return False
        # エラー時は 実行有効=0 が必ず付くので、エラー再開ではこの条件を見ない
        if not エラー再開 and int(req["実行有効"] or 0) != 1:
            return False
        明細状態 = {
            str(row[0])
            for row in conn.execute(
                f"SELECT DISTINCT 状態 FROM {AIタスク明細テーブル} WHERE タスクID = ?",
                [タスクID],
            )
        }
        if エラー再開:
            if not 明細状態 or 明細状態 & {"実行中", "準備中"}:
                return False
        elif not 明細状態 or (明細状態 != {"待機"} and not 明細状態 <= {"完了", "パス"}):
            # 1 周を終えた状態（全件完了、または if 分岐を含むタスクの 完了 + パス 混在）と、
            # まだ 1 度も動いていない状態（全件待機）だけを発火の対象にする。
            # パス を許さないと、分岐のあるタスクが 2 周目から一切発火しなくなる
            # （通らなかった枝は パス で残るので、完了だけになることがない）。
            return False
        now = _現在日時()
        # 実行有効と要求の終了日時はエラー再開のときだけ戻す。通常の発火で書き換えると、
        # 利用者が個別に外した明細の実行有効まで勝手に 1 へ戻してしまう。
        要求追加 = "実行有効 = 1, 終了日時 = '', " if エラー再開 else ""
        明細追加 = "実行有効 = 1, " if エラー再開 else ""
        conn.execute(
            f"UPDATE {AIタスク明細テーブル} SET 状態 = '待機', {明細追加}PID = '', 開始日時 = '', 終了日時 = '', "
            "実行回数 = 0, 実績分数 = 0, 更新日時 = ? WHERE タスクID = ?",
            [now, タスクID],
        )
        conn.execute(
            f"UPDATE {AIタスク要求テーブル} SET 状態 = '待機', {要求追加}PID = '', 更新日時 = ? "
            "WHERE タスクID = ?",
            [now, タスクID],
        )
        conn.commit()
        return True
    finally:
        conn.close()


def 実行条件登録(タスクID: str, 条件: dict, 利用者ID: str = "") -> dict:
    """ダイアログ入力の実行条件を UPSERT する。

    キーはタスクID。利用者IDは新規行に記録する所有者（列値・監査項目）で、
    省略時はタスク要求の所有者を使う。
    入力カラムだけを書き込み、ウォッチャー管理のサーバー項目
    （フォルダスナップショット・前回/次回実行日時）は既存値を保持する。
    """
    初期化()
    conn = 接続取得()
    try:
        値: dict[str, object] = {k: 実行条件既定値[k] for k in 実行条件入力カラム}
        for k in 実行条件入力カラム:
            if k in 条件 and 条件[k] is not None:
                値[k] = 条件[k]
        if not 利用者ID:
            利用者ID = str(_タスク要求取得(conn, タスクID).get("利用者ID", ""))
        now = _現在日時()
        既存 = conn.execute(
            f"SELECT 1 FROM {AIタスク実行条件テーブル} WHERE タスクID = ?",
            [タスクID],
        ).fetchone()
        if 既存:
            conn.execute(
                f"UPDATE {AIタスク実行条件テーブル} SET "
                + ", ".join(f"{_識別子(k)} = ?" for k in 実行条件入力カラム)
                + ", 更新日時 = ?, 更新利用者ID = ?, 更新利用者名 = ?, 更新端末ID = ? "
                "WHERE タスクID = ?",
                [*[値[k] for k in 実行条件入力カラム], now, 利用者ID, 利用者ID, "backend_task", タスクID],
            )
        else:
            監査 = _監査項目(利用者ID, 利用者ID)
            conn.execute(
                f"INSERT INTO {AIタスク実行条件テーブル} (利用者ID, タスクID, "
                + ", ".join(_識別子(k) for k in 実行条件入力カラム)
                + f", {', '.join(監査.keys())}) "
                f"VALUES (?, ?, {', '.join('?' * len(実行条件入力カラム))}, {', '.join('?' * len(監査))})",
                [利用者ID, タスクID, *[値[k] for k in 実行条件入力カラム], *監査.values()],
            )
        conn.commit()
        return _実行条件取得(conn, タスクID)
    finally:
        conn.close()


def 仮タスク登録(
    タスクID: str,
    タイトル: str,
    要求内容: str,
    利用者ID: str,
    プロジェクト: str = "",
    TASK_AI_NAME: str = TASK_AI_NAME既定,
    TASK_AI_MODEL_plan: str = TASK_AI_MODEL既定,
    TASK_AI_MODEL_do: str = TASK_AI_MODEL既定,
    TASK_AI_MODEL_check: str = TASK_AI_MODEL既定,
    実行有効: bool = True,
) -> dict:
    """AI生成待ちの仮タスクを「準備開始」で登録する（実行は起動監視ループに任せる）。"""
    初期化()
    conn = 接続取得()
    try:
        # チームの準備中止と同じSQLite書込ロックで投入可否を決める。
        conn.execute("BEGIN IMMEDIATE")
        if conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='Aチーム依頼'").fetchone():
            依頼 = conn.execute('SELECT 状態 FROM "Aチーム依頼" WHERE 依頼ID=?', [タスクID]).fetchone()
            if 依頼 and 依頼["状態"] != "準備中":
                raise ValueError("チーム依頼は準備中ではないため、タスク投入を中止しました")
        監査 = _監査項目(利用者ID, 利用者ID)
        監査カラム = ", ".join(監査.keys())
        監査値 = list(監査.values())
        conn.execute(
            "INSERT INTO {テーブル} (利用者ID, タスクID, プロジェクト, タイトル, 要求内容, TASK_AI_NAME, "
            "{モデルカラム}, 実行有効, 状態, {監査カラム}) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, {監査値プレース})".format(
                テーブル=AIタスク要求テーブル,
                モデルカラム=", ".join(AIモデルカラム),
                監査カラム=監査カラム,
                監査値プレース=", ".join("?" * len(監査値)),
            ),
            [
                利用者ID, タスクID, プロジェクト, タイトル, 要求内容, TASK_AI_NAME,
                TASK_AI_MODEL_plan, TASK_AI_MODEL_do, TASK_AI_MODEL_check,
                1 if 実行有効 else 0, "準備開始", *監査値,
            ],
        )
        conn.commit()
        return _タスク要求取得(conn, タスクID)
    finally:
        conn.close()


def 実行待ち一覧() -> list[dict]:
    """PID未設定の仮登録（準備開始）を返す。起動監視ループが5秒間隔で確認する。"""
    初期化()
    conn = 接続取得()
    try:
        rows = conn.execute(
            "SELECT 利用者ID, タスクID, プロジェクト, タイトル, 要求内容, TASK_AI_NAME, "
            f"{', '.join(AIモデルカラム)}, 実行回数, 登録利用者ID "
            f"FROM {AIタスク要求テーブル} WHERE 状態 = '準備開始' AND PID = '' ORDER BY タスクID"
        ).fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()


def 実行開始記録(タスクID: str, pid: int) -> None:
    """sub_init起動時に準備中へ進め、PID・開始日時・実行回数を記録する。"""
    初期化()
    conn = 接続取得()
    try:
        now = _現在日時()
        conn.execute(
            f"UPDATE {AIタスク要求テーブル} SET 状態 = '準備中', PID = ?, 開始日時 = ?, "
            "終了日時 = '', 実行回数 = 実行回数 + 1, 更新日時 = ? "
            "WHERE タスクID = ? AND 状態 = '準備開始' AND PID = ''",
            [str(pid), now, now, タスクID],
        )
        conn.commit()
    finally:
        conn.close()


def _エッジ成立(先行SEQ: int, 条件: str, 状態表: dict[int, str], 応答表: dict[int, str]) -> bool:
    """先行エッジ 1 本が通ったか。条件付きは先行 if の判定値が一致したときだけ通る。"""
    if 状態表.get(先行SEQ) != "完了":
        return False
    if not 条件:
        return True
    return if判定値(応答表.get(先行SEQ, "")) == 条件


def _エッジ不成立確定(先行SEQ: int, 条件: str, 状態表: dict[int, str], 応答表: dict[int, str]) -> bool:
    """先行エッジ 1 本がもう通らないと確定したか。

    先行が パス・中止 で終わった場合と、先行 if が反対の判定値で完了した場合。
    エラーは再試行で完了になり得るので確定扱いにしない。
    """
    状態 = 状態表.get(先行SEQ)
    if 状態 in ("パス", "中止"):
        return True
    if 条件 and 状態 == "完了":
        判定 = if判定値(応答表.get(先行SEQ, ""))
        return bool(判定) and 判定 != 条件
    return False


def _先行充足(行: dict, 状態表: dict[int, str], 応答表: dict[int, str]) -> bool:
    """明細の先行SEQ を満たしたか。or 明細はいずれか 1 本、それ以外は全本が条件。"""
    try:
        先行 = 先行SEQ解析(行.get("先行SEQ", ""))
    except ValueError:
        return False  # 書式不正の明細は起動対象にしない（停止検査で DAG 不整合として出る）
    if not 先行:
        return True
    判定 = [_エッジ成立(p, 条件, 状態表, 応答表) for p, 条件 in 先行]
    if str(行.get("タイプ", "")) == "or":
        return any(判定)
    return all(判定)


def _先行不成立確定(行: dict, 状態表: dict[int, str], 応答表: dict[int, str]) -> bool:
    """明細がもう実行され得ないか。or 明細は全本、それ以外は 1 本でも確定すれば通らない。"""
    try:
        先行 = 先行SEQ解析(行.get("先行SEQ", ""))
    except ValueError:
        return False
    if not 先行:
        return False
    判定 = [_エッジ不成立確定(p, 条件, 状態表, 応答表) for p, 条件 in 先行]
    if str(行.get("タイプ", "")) == "or":
        return all(判定)
    return any(判定)


def 明細パス伝播(タスクID: str = "") -> int:
    """if 分岐で選ばれなかった枝の待機明細を パス にし、その下流へ連鎖させる。

    パス は「条件で通らなかった」ことを表す状態で、失敗ではないため要求の完了を妨げない。
    連鎖は変化が止まるまで繰り返す（1 回の呼び出しで枝の末端まで到達する）。
    対象タスクを省略すると、実行中・待機中の全タスクを見る。
    """
    初期化()
    conn = 接続取得()
    try:
        if タスクID:
            対象 = [タスクID]
        else:
            対象 = [
                str(r[0])
                for r in conn.execute(
                    f"SELECT タスクID FROM {AIタスク要求テーブル} "
                    "WHERE 実行有効 = 1 AND 状態 IN ('待機', '実行中')"
                )
            ]
        now = _現在日時()
        件数 = 0
        for tid in 対象:
            明細 = [
                dict(r)
                for r in conn.execute(
                    f"SELECT 明細SEQ, タイプ, 先行SEQ, 状態, 応答内容 FROM {AIタスク明細テーブル} "
                    "WHERE タスクID = ?",
                    [tid],
                )
            ]
            状態表 = {int(行["明細SEQ"]): str(行["状態"]) for 行 in 明細}
            応答表 = {int(行["明細SEQ"]): str(行["応答内容"] or "") for 行 in 明細}
            while True:
                今回 = [
                    int(行["明細SEQ"])
                    for 行 in 明細
                    if 状態表.get(int(行["明細SEQ"])) == "待機"
                    and _先行不成立確定(行, 状態表, 応答表)
                ]
                if not 今回:
                    break
                for seq in 今回:
                    状態表[seq] = "パス"
                conn.executemany(
                    f"UPDATE {AIタスク明細テーブル} SET 状態 = 'パス', 終了日時 = ?, PID = '', "
                    "応答内容 = '分岐条件により実行しませんでした。', 更新日時 = ? "
                    "WHERE タスクID = ? AND 明細SEQ = ? AND 状態 = '待機'",
                    [(now, now, tid, seq) for seq in 今回],
                )
                件数 += len(今回)
        if 件数:
            conn.commit()
        return 件数
    finally:
        conn.close()


def 実行待ち明細一覧() -> list[dict]:
    """実行可能な AIタスク明細（実行有効・待機・PID なし・先行 SEQ が全て完了）を返す。

    親の AIタスク要求が 待機 / 実行中 のものだけを対象とする
    （準備開始・準備中・準備完了・失敗・完了のタスクは実行しない。準備完了は実行開始条件の充足待ちに使う）。
    明細の 実行有効 = 0 は実行対象にしない（明細作成は実行有効フラグに関係なく行う）。
    戻り値には 定義済明細数（要求内容が入った明細の件数）を含める。0 なら AI 分解を
    通っていない（標準テンプレートのままの）タスクで、自動実行の対象外にする。
    要求の 実行有効 = 0 も実行対象にしない。エラーからの復旧で明細だけ有効に戻したとき、
    要求が無効のまま実行が始まってしまうため（要求も有効に戻した時点で再開する）。
    """
    初期化()
    conn = 接続取得()
    try:
        rows = conn.execute(
            "SELECT m.タスクID, m.明細SEQ, m.タイプ, m.タイトル, m.先行SEQ, m.TASK_AI_NAME, m.TASK_AI_MODEL_do, m.実行回数, "
            # AI が分解した明細は 要求内容 が入る。標準テンプレートで作っただけの
            # 明細は全て空なので、これで「定義済みのタスクか」を DB だけで判定できる
            "(SELECT COUNT(*) FROM " + AIタスク明細テーブル + " d "
            " WHERE d.タスクID = m.タスクID "
            " AND TRIM(COALESCE(d.要求内容, '')) <> '') AS 定義済明細数 "
            f"FROM {AIタスク明細テーブル} m JOIN {AIタスク要求テーブル} r "
            "ON r.タスクID = m.タスクID "
            "WHERE m.実行有効 = 1 AND m.状態 = '待機' AND m.PID = '' "
            "AND r.実行有効 = 1 AND r.状態 IN ('待機', '実行中') "
            "ORDER BY m.タスクID, m.明細SEQ"
        ).fetchall()
        候補 = [dict(row) for row in rows]
        if not 候補:
            return []

        # タスクごとの明細状態マップで先行 SEQ の充足を確認する
        # （if 分岐の判定値を見るため 応答内容 も持つ）
        状態マップ: dict[str, dict[int, str]] = {}
        応答マップ: dict[str, dict[int, str]] = {}
        for タスクID in {行["タスクID"] for 行 in 候補}:
            明細行 = conn.execute(
                f"SELECT 明細SEQ, 状態, 応答内容 FROM {AIタスク明細テーブル} "
                "WHERE タスクID = ?",
                [タスクID],
            ).fetchall()
            状態マップ[タスクID] = {int(r[0]): str(r[1]) for r in 明細行}
            応答マップ[タスクID] = {int(r[0]): str(r[2] or "") for r in 明細行}

        実行可能 = [
            行
            for 行 in 候補
            if _先行充足(行, 状態マップ[行["タスクID"]], 応答マップ[行["タスクID"]])
        ]
        return 実行可能
    finally:
        conn.close()


def 実行中明細数() -> int:
    """PID が設定されている（実行中の）AIタスク明細の件数を返す。"""
    初期化()
    conn = 接続取得()
    try:
        return conn.execute(f"SELECT COUNT(*) FROM {AIタスク明細テーブル} WHERE PID != ''").fetchone()[0]
    finally:
        conn.close()


def 実行中明細一覧() -> list[dict]:
    """PID が設定されている（実行中の）AIタスク明細を返す。"""
    初期化()
    conn = 接続取得()
    try:
        rows = conn.execute(
            "SELECT タスクID, 明細SEQ, タイトル, PID "
            f"FROM {AIタスク明細テーブル} WHERE PID != '' ORDER BY タスクID, 明細SEQ"
        ).fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()


def 明細実行開始記録(タスクID: str, 明細SEQ: int, pid: int) -> None:
    """明細実行の開始: 状態=実行中・PID・開始日時・実行回数+1。"""
    初期化()
    conn = 接続取得()
    try:
        now = _現在日時()
        conn.execute(
            f"UPDATE {AIタスク明細テーブル} SET 状態 = '実行中', PID = ?, 開始日時 = ?, "
            "実行回数 = 実行回数 + 1, 更新日時 = ? "
            "WHERE タスクID = ? AND 明細SEQ = ?",
            [str(pid), now, now, タスクID, 明細SEQ],
        )
        conn.execute(
            f"UPDATE {AIタスク要求テーブル} SET 状態 = CASE WHEN 状態 = '待機' THEN '実行中' ELSE 状態 END, "
            "更新日時 = ? WHERE タスクID = ?",
            [now, タスクID],
        )
        conn.commit()
    finally:
        conn.close()


def _明細開始日時(conn: sqlite3.Connection, タスクID: str, 明細SEQ: int) -> str:
    """実績分数の計算に使う明細の開始日時を返す（無ければ空文字）。"""
    row = conn.execute(
        f"SELECT 開始日時 FROM {AIタスク明細テーブル} WHERE タスクID = ? AND 明細SEQ = ?",
        [タスクID, 明細SEQ],
    ).fetchone()
    return str(row["開始日時"]) if row else ""


def 明細PID解放(タスクID: str, 明細SEQ: int) -> bool:
    """プロセスが消えた実行中明細を 待機・PID空 に戻す。戻せたら True。

    対象は 状態='実行中' かつ PID あり の行だけ（完了・エラー・中止には触らない）。
    開始日時も空に戻す（タイムアウト判定の対象から外し、起動監視で素直に再実行させるため）。
    実行回数は戻さない。無限リトライを避けるため、実行回数上限の判定はそのまま活かす。
    """
    初期化()
    conn = 接続取得()
    try:
        cur = conn.execute(
            f"UPDATE {AIタスク明細テーブル} SET 状態 = '待機', PID = '', 開始日時 = '', 実績分数 = 0, 更新日時 = ? "
            "WHERE タスクID = ? AND 明細SEQ = ? AND 状態 = '実行中' AND PID != ''",
            [_現在日時(), タスクID, 明細SEQ],
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def 明細1件取得(タスクID: str, 明細SEQ: int) -> dict | None:
    """AIタスク明細 1 行を返す（無ければ None）。"""
    初期化()
    conn = 接続取得()
    try:
        row = conn.execute(
            "SELECT タスクID, 明細SEQ, タイプ, タイトル, 要求内容, 先行SEQ, TASK_AI_NAME, TASK_AI_MODEL_do, "
            "操作検証, 実行有効, 状態, PID, 開始日時, 終了日時, 実行回数, 予測分数, 実績分数, 応答内容 "
            f"FROM {AIタスク明細テーブル} WHERE タスクID = ? AND 明細SEQ = ?",
            [タスクID, 明細SEQ],
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def 明細完了(タスクID: str, 明細SEQ: int, 応答内容: str = "") -> dict:
    """明細を完了にする。全明細が完了したら AIタスク要求も完了にする。

    完了した明細のタイトルと応答内容は AIタスク要求の 応答タイトル・応答内容 へ
    反映する（最新ステップの結果表示用）。
    実績分数は 開始日時〜終了日時 から求めて記録する（予測分数との突き合わせに使う）。
    """
    初期化()
    conn = 接続取得()
    try:
        now = _現在日時()
        実績 = _経過分数(_明細開始日時(conn, タスクID, 明細SEQ), now)
        cur = conn.execute(
            f"UPDATE {AIタスク明細テーブル} SET 状態 = '完了', 終了日時 = ?, PID = '', "
            "実績分数 = ?, 応答内容 = ?, 更新日時 = ? "
            "WHERE タスクID = ? AND 明細SEQ = ? AND 状態 != 'エラー'",
            [now, 実績, 応答内容, now, タスクID, 明細SEQ],
        )
        if cur.rowcount <= 0:
            conn.commit()
            return _タスク要求取得(conn, タスクID)
        行 = conn.execute(
            f"SELECT タイトル FROM {AIタスク明細テーブル} "
            "WHERE タスクID = ? AND 明細SEQ = ?",
            [タスクID, 明細SEQ],
        ).fetchone()
        応答タイトル = str(行["タイトル"]) if 行 else ""
        残 = conn.execute(
            f"SELECT COUNT(*) FROM {AIタスク明細テーブル} "
            "WHERE タスクID = ? AND 状態 NOT IN ('完了', 'パス')",
            [タスクID],
        ).fetchone()[0]
        if 残 == 0:
            conn.execute(
                f"UPDATE {AIタスク要求テーブル} SET 状態 = '完了', 終了日時 = ?, 応答タイトル = ?, 応答内容 = ?, 更新日時 = ? "
                "WHERE タスクID = ? AND 状態 != 'エラー'",
                [now, 応答タイトル, 応答内容, now, タスクID],
            )
            _Aチーム依頼反映(conn, タスクID, 状態="完了", 応答タイトル=応答タイトル, 応答内容=応答内容, 終了日時=now)
        else:
            conn.execute(
                f"UPDATE {AIタスク要求テーブル} SET 応答タイトル = ?, 応答内容 = ?, 更新日時 = ? "
                "WHERE タスクID = ? AND 状態 != 'エラー'",
                [応答タイトル, 応答内容, now, タスクID],
            )
            _Aチーム依頼反映(conn, タスクID, 応答タイトル=応答タイトル, 応答内容=応答内容)
        conn.commit()
        return _タスク要求取得(conn, タスクID)
    finally:
        conn.close()


def 開始明細完了(タスクID: str, 明細SEQ: int, 応答内容: str = "開始処理を完了しました。") -> dict:
    """開始明細を完了し、AIタスク要求を実行中にする。

    実行中への切り替え時に AIタスク要求の 応答タイトル・応答内容 はクリアする
    （前回実行分の結果を残さない）。
    """
    初期化()
    conn = 接続取得()
    try:
        now = _現在日時()
        cur = conn.execute(
            f"UPDATE {AIタスク明細テーブル} SET 状態 = '完了', 終了日時 = ?, PID = '', 応答内容 = ?, 更新日時 = ? "
            "WHERE タスクID = ? AND 明細SEQ = ? AND 状態 != 'エラー'",
            [now, 応答内容, now, タスクID, 明細SEQ],
        )
        if cur.rowcount <= 0:
            conn.commit()
            return _タスク要求取得(conn, タスクID)
        conn.execute(
            f"UPDATE {AIタスク要求テーブル} SET 状態 = '実行中', 開始日時 = ?, 終了日時 = '', 実行回数 = 1, PID = '', "
            "応答タイトル = '', 応答内容 = '', 更新日時 = ? "
            "WHERE タスクID = ? AND 状態 != 'エラー'",
            [now, now, タスクID],
        )
        _Aチーム依頼反映(conn, タスクID, 状態="実行中", 応答タイトル="", 応答内容="")
        conn.commit()
        return _タスク要求取得(conn, タスクID)
    finally:
        conn.close()


def 終了明細完了(タスクID: str, 明細SEQ: int, 応答内容: str = "終了処理を完了しました。") -> dict:
    """終了明細を完了し、AIタスク要求を完了にする。

    AIタスク要求の 応答タイトル には終了明細のタイトル（通常「終了」）、
    応答内容 には検証の結論を反映する。
    """
    初期化()
    conn = 接続取得()
    try:
        now = _現在日時()
        cur = conn.execute(
            f"UPDATE {AIタスク明細テーブル} SET 状態 = '完了', 終了日時 = ?, PID = '', 応答内容 = ?, 更新日時 = ? "
            "WHERE タスクID = ? AND 明細SEQ = ? AND 状態 != 'エラー'",
            [now, 応答内容, now, タスクID, 明細SEQ],
        )
        if cur.rowcount <= 0:
            conn.commit()
            return _タスク要求取得(conn, タスクID)
        行 = conn.execute(
            f"SELECT タイトル FROM {AIタスク明細テーブル} "
            "WHERE タスクID = ? AND 明細SEQ = ?",
            [タスクID, 明細SEQ],
        ).fetchone()
        応答タイトル = str(行["タイトル"]) if 行 else "終了"
        conn.execute(
            f"UPDATE {AIタスク要求テーブル} SET 状態 = '完了', 終了日時 = ?, PID = '', 応答タイトル = ?, 応答内容 = ?, 更新日時 = ? "
            "WHERE タスクID = ? AND 状態 != 'エラー'",
            [now, 応答タイトル, 応答内容, now, タスクID],
        )
        _Aチーム依頼反映(conn, タスクID, 状態="完了", 応答タイトル=応答タイトル, 応答内容=応答内容, 終了日時=now)
        conn.commit()
        return _タスク要求取得(conn, タスクID)
    finally:
        conn.close()


def _明細予測分数(conn: sqlite3.Connection, タスクID: str, 明細SEQ: int) -> int:
    """明細に記録されている予測分数を返す（無ければ 0 = 未見積り）。"""
    row = conn.execute(
        f"SELECT 予測分数 FROM {AIタスク明細テーブル} WHERE タスクID = ? AND 明細SEQ = ?",
        [タスクID, 明細SEQ],
    ).fetchone()
    return _正整数(row["予測分数"]) if row else 0


def 再試行予測分数(予測分数, 未見積り分: int = 8, 倍率: float = 1.5, 上限分: int = 30) -> int:
    """再試行に入るときへ書き換える予測分数（分）を返す。

    タイムアウトや操作検証NGで打ち切られた明細は、見積りが短すぎることが多い。
    同じ見積りのまま再試行しても同じところで切れるため、予測分数そのものを引き上げて記録する。

    - 予測分数が 0 / 未設定（未見積り）: 未見積り分を使う
    - 予測分数がある: 予測分数 × 倍率 を切り上げて整数化し、上限分までに収める
    - ただし元の予測分数より小さくはしない

    上限分は「引き上げをどこで止めるか」であって、見積りの上限ではない。最後の max が
    無いと、もともと上限分より長い見積り（例 40 分）が再試行のたびに上限分へ縮められ、
    打ち切り時間まで短くなってしまう。上限分を超える見積りは 1.5 倍せず据え置きにする。

    例（未見積り8 / 倍率1.5 / 上限30）:
      未見積り→8分、5分→8分、10分→15分、20分→30分、25分→30分、30分→30分、40分→40分
    """
    分 = _正整数(予測分数)
    if 分 <= 0:
        return min(未見積り分, 上限分)
    return max(分, min(上限分, math.ceil(分 * 倍率)))


def 明細再試行(タスクID: str, 明細SEQ: int, pid: int = 0) -> dict:
    """自動リカバリーの再試行前に、明細とタスク要求の状態を実行中へ戻す（sub_do.py 用）。

    操作検証NG・未報告により明細とタスク要求がエラーになっていても、再試行のため実行中に戻す。
    明細失敗() は実行有効と PID をクリアするため、ここでは両方を必ず復元する。
    復元しないと、この試行が成功しても要求の実行有効=0が残り、後続明細が起動せず停止する。

    あわせて予測分数を 再試行予測分数 で引き上げて書き換える。書き換えた値は
    sub_do.py が code_agents へ渡す実行タイムアウトと、監視側の打ち切り判定
    （明細タイムアウト分）の両方にそのまま効くため、再試行は前回より長い時間で走る。

    開始日時も現在時刻へ入れ直す。監視側の打ち切りは 現在時刻 - 開始日時 で見るため、
    据え置きにすると前回の試行で使った時間が残ったままになり、引き上げた予測分数の
    時間を待たずに再試行が打ち切られてしまう（1 試行 = 1 プロセスの実行として数え直す）。
    これに伴い明細の実績分数は最後の試行の所要時間になる（予測分数も最後の試行の値なので
    突き合わせの単位はそろう）。

    戻り値は {"item": タスク要求, "予測分数": 書き換え後の予測分数}。
    """
    初期化()
    conn = 接続取得()
    try:
        now = _現在日時()
        新予測分数 = 再試行予測分数(_明細予測分数(conn, タスクID, 明細SEQ))
        PID = str(pid) if int(pid or 0) > 0 else ""
        conn.execute(
            f"UPDATE {AIタスク明細テーブル} SET 状態 = '実行中', 実行有効 = 1, PID = ?, "
            "開始日時 = ?, 終了日時 = '', 応答内容 = '', 予測分数 = ?, 更新日時 = ? "
            "WHERE タスクID = ? AND 明細SEQ = ?",
            [PID, now, 新予測分数, now, タスクID, 明細SEQ],
        )
        conn.execute(
            f"UPDATE {AIタスク要求テーブル} SET 状態 = '実行中', 実行有効 = 1, "
            "終了日時 = '', 更新日時 = ? WHERE タスクID = ? AND 状態 = 'エラー'",
            [now, タスクID],
        )
        _Aチーム依頼反映(
            conn,
            タスクID,
            状態="実行中",
            終了日時="",
            guard="状態 = 'エラー'",
        )
        conn.commit()
        return {"item": _タスク要求取得(conn, タスクID), "予測分数": 新予測分数}
    finally:
        conn.close()


def 明細失敗(タスクID: str, 明細SEQ: int, メッセージ: str) -> dict:
    """明細をエラーにし、AIタスク要求もエラーにする（後続の実行を止める）。

    明細・要求とも 実行有効 = 0 にする（タイムアウト対象エラー化・PID全クリア と同じ扱い）。
    実行有効を残すと画面のトグルが ON のままで「有効に戻す」操作ができず、
    エラーからの復旧（実行有効の切替で 待機 へ戻す）が始められないため。

    エラー内容は要求の 応答タイトル・応答内容 へ書く。要求内容（人が書いた依頼文）には
    絶対に追記しない。追記すると人の文章がエラー履歴で汚れ、再実行時にその汚れた文章が
    そのまま AI へ渡ってしまう。
    """
    初期化()
    conn = 接続取得()
    try:
        now = _現在日時()
        実績 = _経過分数(_明細開始日時(conn, タスクID, 明細SEQ), now)
        conn.execute(
            f"UPDATE {AIタスク明細テーブル} SET 状態 = 'エラー', 実行有効 = 0, "
            "終了日時 = ?, PID = '', 実績分数 = ?, 応答内容 = ?, 更新日時 = ? "
            "WHERE タスクID = ? AND 明細SEQ = ?",
            [now, 実績, メッセージ, now, タスクID, 明細SEQ],
        )
        conn.execute(
            f"UPDATE {AIタスク要求テーブル} SET 状態 = 'エラー', 実行有効 = 0, "
            "応答タイトル = ?, 応答内容 = ?, 更新日時 = ? "
            "WHERE タスクID = ?",
            [f"エラー SEQ{明細SEQ}", f"[エラー] SEQ{明細SEQ}: {メッセージ}", now, タスクID],
        )
        _Aチーム依頼反映(conn, タスクID, 状態="エラー", 応答内容=f"[エラー] SEQ{明細SEQ}: {メッセージ}", guard="")
        conn.commit()
        return _タスク要求取得(conn, タスクID)
    finally:
        conn.close()


def タスクPID一覧(タスクID: str) -> list[int]:
    """指定タスクの AIタスク要求・AIタスク明細に残っている PID を返す。"""
    初期化()
    conn = 接続取得()
    try:
        結果: list[int] = []
        rows = conn.execute(
            f"SELECT PID FROM {AIタスク要求テーブル} WHERE タスクID = ? AND PID != ''",
            [タスクID],
        ).fetchall()
        結果.extend(int(row[0]) for row in rows if str(row[0]).strip().isdigit())
        rows = conn.execute(
            f"SELECT PID FROM {AIタスク明細テーブル} WHERE タスクID = ? AND PID != ''",
            [タスクID],
        ).fetchall()
        結果.extend(int(row[0]) for row in rows if str(row[0]).strip().isdigit())
        return 結果
    finally:
        conn.close()


def タスクPIDクリア(タスクID: str) -> None:
    """指定タスクの PID をすべてクリアする。実行中のまま残った明細は待機に戻す。"""
    初期化()
    conn = 接続取得()
    try:
        now = _現在日時()
        conn.execute(
            f"UPDATE {AIタスク明細テーブル} SET 状態 = '待機' "
            "WHERE タスクID = ? AND PID != '' AND 状態 = '実行中'",
            [タスクID],
        )
        conn.execute(
            f"UPDATE {AIタスク要求テーブル} SET PID = '', 更新日時 = ? "
            "WHERE タスクID = ? AND PID != ''",
            [now, タスクID],
        )
        conn.execute(
            f"UPDATE {AIタスク明細テーブル} SET PID = '', 更新日時 = ? "
            "WHERE タスクID = ? AND PID != ''",
            [now, タスクID],
        )
        conn.commit()
    finally:
        conn.close()


def タスク要求更新登録(
    タスクID: str,
    プロジェクト: str,
    要求内容: str,
    TASK_AI_NAME: str,
    TASK_AI_MODEL_plan: str,
    TASK_AI_MODEL_do: str,
    TASK_AI_MODEL_check: str,
    実行有効: bool,
    状態: str,
) -> dict:
    """修正ダイアログの内容で AIタスク要求を更新する（PID クリア済み前提）。

    準備開始（再準備）は開始日時・終了日時・実行回数をリセットし、起動監視ループに再分解させる。

    画面からの状態変更も Aチーム依頼・Aチーム作業へ反映する。反映しないと、作業ループ（PDCA）
    から投入されたタスクを画面で中止したときに Aチーム依頼が実行中のまま残り、Aチーム作業が
    未終了のまま次の段へ進めなくなる（無進捗タイムアウトで回収されるまで最大30分止まる）。
    """
    初期化()
    conn = 接続取得()
    try:
        now = _現在日時()
        タイトル = 要求内容.splitlines()[0][:40] if 要求内容 else ""
        更新列 = (
            "プロジェクト = ?, タイトル = ?, 要求内容 = ?, TASK_AI_NAME = ?, "
            + ", ".join(f"{カラム} = ?" for カラム in AIモデルカラム)
            + ", 実行有効 = ?, 状態 = ?, "
        )
        更新値 = [
            プロジェクト, タイトル, 要求内容, TASK_AI_NAME,
            TASK_AI_MODEL_plan, TASK_AI_MODEL_do, TASK_AI_MODEL_check,
            1 if 実行有効 else 0, 状態,
        ]
        if 状態 == "準備開始":
            conn.execute(
                f"UPDATE {AIタスク要求テーブル} SET {更新列}"
                "PID = '', 開始日時 = '', 終了日時 = '', 実行回数 = 0, 更新日時 = ? "
                "WHERE タスクID = ?",
                [*更新値, now, タスクID],
            )
        elif 状態 == "中止":
            conn.execute(
                f"UPDATE {AIタスク要求テーブル} SET {更新列}"
                "PID = '', 終了日時 = ?, 更新日時 = ? "
                "WHERE タスクID = ?",
                [*更新値, now, now, タスクID],
            )
        else:
            # 更新前の状態を保持する更新: 終了日時は打刻しない
            conn.execute(
                f"UPDATE {AIタスク要求テーブル} SET {更新列}"
                "PID = '', 更新日時 = ? "
                "WHERE タスクID = ?",
                [*更新値, now, タスクID],
            )
        # 画面の操作は「エラーを上書きしない」通常ガードの対象外にする（人の判断を優先する）。
        # 終了日時は必ず渡す。渡さないと Aチーム依頼側が空のまま残り、まだ実行中と見なされる。
        if 状態 == "準備開始":
            # 再準備は最初からやり直すので、チーム側も未終了へ戻す
            _Aチーム依頼反映(conn, タスクID, 状態="準備中", 応答内容="", 終了日時="", guard="")
        elif 状態 in ("完了", "済", "エラー", "中止"):
            _Aチーム依頼反映(conn, タスクID, 状態=状態, 終了日時=now, guard="")
        else:
            _Aチーム依頼反映(conn, タスクID, 状態=状態, 終了日時="", guard="")
        conn.commit()
        return _タスク要求取得(conn, タスクID)
    finally:
        conn.close()


def タスク実行有効更新(タスクID: str, 実行有効: bool) -> dict:
    """タスク要求と全タスク明細の実行有効フラグをまとめて更新する。

    無効 → 有効 への切替時は、エラーで止まっている要求・明細を 待機 に戻して再実行できるようにする。
    画面のチェック操作は人の判断なので、エラーを上書きしない通常ガードの対象外にする。
    明細は PID・開始日時・終了日時・実行回数もリセットする（タスク発火と同じ初期化）。
    実行回数を残すと tasks_watcher の実行回数上限に即座に引っかかり、そのままエラーへ戻ってしまう。
    """
    初期化()
    conn = 接続取得()
    try:
        now = _現在日時()
        実行有効値 = 1 if 実行有効 else 0
        要求エラー = False
        if 実行有効値 == 1:
            req = conn.execute(
                f"SELECT 状態 FROM {AIタスク要求テーブル} WHERE タスクID = ?",
                [タスクID],
            ).fetchone()
            要求エラー = req is not None and str(req["状態"]) == "エラー"
        conn.execute(
            f"UPDATE {AIタスク要求テーブル} SET 実行有効 = ?, 更新日時 = ? WHERE タスクID = ?",
            [実行有効値, now, タスクID],
        )
        conn.execute(
            f"UPDATE {AIタスク明細テーブル} SET 実行有効 = ?, 更新日時 = ? WHERE タスクID = ?",
            [実行有効値, now, タスクID],
        )
        if 実行有効値 == 1:
            conn.execute(
                f"UPDATE {AIタスク要求テーブル} SET 状態 = '待機', PID = '', 更新日時 = ? "
                "WHERE タスクID = ? AND 状態 = 'エラー'",
                [now, タスクID],
            )
            conn.execute(
                f"UPDATE {AIタスク明細テーブル} SET 状態 = '待機', PID = '', 開始日時 = '', "
                "終了日時 = '', 実行回数 = 0, 実績分数 = 0, 更新日時 = ? "
                "WHERE タスクID = ? AND 状態 = 'エラー'",
                [now, タスクID],
            )
            if 要求エラー:
                # 終了日時を空へ戻さないと Aチーム依頼側が終了済みのまま残る（明細再試行と同じ扱い）
                _Aチーム依頼反映(conn, タスクID, 状態="待機", 終了日時="", guard="状態 = 'エラー'")
        conn.commit()
        return _タスク要求取得(conn, タスクID)
    finally:
        conn.close()


_未完了状態 = ("待機", "実行中", "準備中", "準備完了")


def _停止診断1件(conn: sqlite3.Connection, req: sqlite3.Row, now: datetime) -> dict:
    """1タスクの停止理由と、AI が選べる復旧方法を構造化して返す。"""
    tid = str(req["タスクID"])
    rows = [
        dict(r)
        for r in conn.execute(
            "SELECT 明細SEQ, タイプ, タイトル, 要求内容, 先行SEQ, 状態, 実行有効, 実行回数, "
            "予測分数, 実績分数, PID, 開始日時, 応答内容 "
            f"FROM {AIタスク明細テーブル} WHERE タスクID = ? ORDER BY 明細SEQ",
            [tid],
        ).fetchall()
    ]

    進捗: dict[str, int] = {"全件": len(rows)}
    for row in rows:
        key = str(row["状態"]) or "不明"
        進捗[key] = 進捗.get(key, 0) + 1

    未完了 = [row for row in rows if str(row["状態"]) in _未完了状態]
    エラー明細 = [row for row in rows if str(row["状態"]) == "エラー"]
    無効明細 = [row for row in 未完了 if not int(row["実行有効"] or 0)]
    実行中明細 = [row for row in rows if str(row["状態"]) == "実行中"]
    定義済明細数 = sum(1 for row in rows if str(row.get("要求内容") or "").strip())

    超過明細: list[dict] = []
    for row in 実行中明細:
        開始 = str(row["開始日時"] or "").strip()
        if not 開始:
            continue
        try:
            t0 = datetime.strptime(開始, "%Y-%m-%d %H:%M:%S")
        except ValueError:
            continue
        経過分 = int((now - t0).total_seconds() // 60)
        制限分 = 明細タイムアウト分(row["予測分数"])
        if 経過分 >= 制限分:
            超過明細.append({**row, "経過分": 経過分, "制限分": 制限分})

    # 待機明細のうち、全先行SEQが完了したものを求める。これが1件も無く、
    # 実行中も無い場合は、循環・欠番などのDAG不整合で自然復旧しない。
    状態表 = {int(row["明細SEQ"]): str(row["状態"]) for row in rows}
    応答表 = {int(row["明細SEQ"]): str(row.get("応答内容") or "") for row in rows}
    実行可能明細: list[int] = []
    for row in 未完了:
        if str(row["状態"]) != "待機" or not int(row["実行有効"] or 0) or str(row["PID"] or ""):
            continue
        if _先行充足(row, 状態表, 応答表):
            実行可能明細.append(int(row["明細SEQ"]))

    状態コード: list[str] = []
    停止理由: list[str] = []

    def add(code: str, message: str) -> None:
        状態コード.append(code)
        停止理由.append(message)

    要求状態 = str(req["状態"])
    要求有効 = int(req["実行有効"] or 0)
    要求タイムアウト情報: dict = {}
    if 要求状態 in ("準備中", "実行中") and not str(req["終了日時"] or ""):
        基準文字 = max(str(req["開始日時"] or ""), str(req["更新日時"] or ""))
        try:
            基準日時 = datetime.strptime(基準文字, "%Y-%m-%d %H:%M:%S")
        except ValueError:
            基準日時 = None
        if 基準日時 is not None:
            経過分 = int((now - 基準日時).total_seconds() // 60)
            制限分 = 10 if 要求状態 == "準備中" else 60
            if 経過分 >= 制限分:
                要求タイムアウト情報 = {
                    "状態": 要求状態,
                    "PID": str(req["PID"] or ""),
                    "開始日時": str(req["開始日時"] or ""),
                    "経過分": 経過分,
                    "制限分": 制限分,
                }
    if 要求状態 == "エラー":
        add("REQUEST_ERROR", "要求がエラー")
    if 要求タイムアウト情報:
        add(
            "REQUEST_TIMEOUT",
            f"要求が無進捗のまま打ち切り時間を超えています（{要求タイムアウト情報['経過分']}分）",
        )
    if not 要求有効 and 未完了:
        add("REQUEST_DISABLED", f"要求の実行有効が外れている（未完了明細 {len(未完了)} 件）")
    if エラー明細:
        add("DETAIL_ERROR", f"エラーの明細が {len(エラー明細)} 件")
    if 無効明細:
        add("DETAIL_DISABLED", f"未完了なのに実行有効が外れた明細が {len(無効明細)} 件")
    if 超過明細:
        add("DETAIL_TIMEOUT", f"打ち切り時間を超えた実行中明細が {len(超過明細)} 件")

    停止判定対象状態 = (
        要求状態 in ("待機", "実行中", "準備完了", "エラー")
        or bool(要求タイムアウト情報)
    )
    実行対象状態 = 要求状態 in ("待機", "実行中")
    if 停止判定対象状態 and not rows:
        add("NO_DETAILS", "実行対象の要求に明細がありません")
    elif 停止判定対象状態 and rows and 未完了 and 定義済明細数 == 0:
        add("UNDEFINED_DETAILS", "AI分解済みの明細がありません（全明細の要求内容が空です）")
    elif (
        実行対象状態
        and 要求有効
        and 未完了
        and not 実行中明細
        and not 実行可能明細
        and not エラー明細
        and not 無効明細
    ):
        add("DAG_BLOCKED", "実行可能な明細がありません（先行SEQの循環または欠番の可能性があります）")

    # 優先度は、プロセス停止が必要なタイムアウト > 再分解 > 手動修正 > 通常再開。
    if "REQUEST_TIMEOUT" in 状態コード or "DETAIL_TIMEOUT" in 状態コード:
        推奨操作 = "強制再開"
    elif "NO_DETAILS" in 状態コード or "UNDEFINED_DETAILS" in 状態コード:
        推奨操作 = "再分解"
    elif "DAG_BLOCKED" in 状態コード:
        推奨操作 = "手動修正"
    elif 状態コード:
        推奨操作 = "再開"
    else:
        推奨操作 = "なし"

    復旧対象 = (
        [row["明細SEQ"] for row in エラー明細]
        + [row["明細SEQ"] for row in 無効明細]
        + [row["明細SEQ"] for row in 超過明細]
    )
    if not 要求有効:
        復旧対象.extend(row["明細SEQ"] for row in 未完了)
    return {
        "タスクID": tid,
        "利用者ID": str(req["利用者ID"] or ""),
        "タイトル": str(req["タイトル"] or ""),
        "要求状態": 要求状態,
        "要求実行有効": 要求有効,
        "停止": bool(状態コード),
        "状態コード": 状態コード,
        "停止理由": 停止理由,
        "推奨操作": 推奨操作,
        "復旧可能": 推奨操作 in ("再開", "再分解", "強制再開"),
        "通常復旧可能": 推奨操作 in ("再開", "再分解"),
        "強制復旧必要": 推奨操作 == "強制再開",
        "進捗": 進捗,
        "定義済明細数": 定義済明細数,
        "実行可能SEQ": 実行可能明細,
        "エラー明細": エラー明細,
        "実行有効オフ明細": 無効明細,
        "タイムアウト超過明細": 超過明細,
        "タイムアウト超過要求": 要求タイムアウト情報,
        "再開SEQ": min(復旧対象) if 復旧対象 else None,
        "最終更新日時": str(req["更新日時"] or ""),
    }


def タスク停止検査(タスクID: str = "", 停止のみ: bool = False) -> list[dict]:
    """タスクが止まっていないかを読み取り専用で判定する。

    「止まっている」は、放っておいても先へ進まない状態を指す。次のどれかに当たる場合。

      1. 要求が エラー
      2. 要求の 実行有効 が外れていて、未完了の明細が残っている
      3. エラーの明細がある
      4. 未完了なのに 実行有効 が外れている明細がある
      5. 実行中のまま打ち切り時間（明細タイムアウト分）を超えている明細がある
      6. 準備中・実行中の要求が無進捗で打ち切り時間を超えている
      7. 実行対象なのにAI分解済み明細が無い
      8. 先行SEQの循環・欠番で実行可能な明細が無い

    エラー・無効化は通常の再開、明細なし・未定義は再分解で復旧できる。
    タイムアウトは実行プロセスを止めるため 強制=True が必要。DAG不整合は
    依存関係を自動書換えせず、推奨操作=手動修正として返す。

    Args:
        タスクID: 指定するとその 1 件だけ。空なら全タスク。
        停止のみ: True なら 停止=True のものだけ返す。

    Returns:
        タスクごとの判定結果のリスト（タスクID 昇順）。
    """
    初期化()
    conn = 接続取得()
    try:
        if タスクID:
            reqs = conn.execute(
                f"SELECT タスクID, 利用者ID, タイトル, 状態, 実行有効, PID, 開始日時, 終了日時, 更新日時 "
                f"FROM {AIタスク要求テーブル} WHERE タスクID = ?",
                [タスクID],
            ).fetchall()
        else:
            reqs = conn.execute(
                f"SELECT タスクID, 利用者ID, タイトル, 状態, 実行有効, PID, 開始日時, 終了日時, 更新日時 "
                f"FROM {AIタスク要求テーブル} ORDER BY タスクID"
            ).fetchall()

        now = datetime.now()
        結果: list[dict] = []
        for req in reqs:
            項目 = _停止診断1件(conn, req, now)
            if 停止のみ and not 項目["停止"]:
                continue
            結果.append(項目)
        return 結果
    finally:
        conn.close()


def タスク停止復旧(タスクID: str, 強制: bool = False, 復旧モード: str = "auto") -> dict:
    """途中停止したタスクを、止まった明細から再開できる状態へ戻す。

    タスク実行有効更新(タスクID, True) と同じ復旧をしたうえで、監視タスクが
    そのまま原因分析と結果検証に使えるよう、復旧前後の状態を構造化して返す。

    復旧の中身:
      - 要求・全明細の 実行有効 を 1 にする
      - 状態='エラー' の要求を 待機 へ戻し、PID を空にする
      - 状態='エラー' の明細を 待機 へ戻し、PID・開始日時・終了日時を空、
        実行回数・実績分数を 0 にする（実行回数を残すと実行回数上限で即エラーに戻るため）
      - 完了済みの明細には触れない。だから「途中から」再開できる

    復旧モード=auto は停止検査の 推奨操作 に従い、エラー・無効化は「再開」、
    明細なし・未定義明細は「再分解」にする。タイムアウト中は強制=Trueが無ければ
    何もしない。DAG循環・欠番は自動修復で依存関係を書き換えず、手動修正を求める。

    戻り値:
      {"タスクID", "復旧実施", "理由", "復旧前": {...}, "復旧後": {...}, "再開SEQ"}
      復旧前.エラー明細 には応答内容まで入れる（監視タスクの原因分析用）。
      再開SEQ は復旧対象のうち最小の明細SEQ（対象なしは None）。
    """
    初期化()
    診断一覧 = タスク停止検査(タスクID)
    if not 診断一覧:
        return {
            "タスクID": タスクID, "復旧実施": False, "理由": "タスクIDが見つかりません",
            "復旧前": {}, "復旧後": {}, "再開SEQ": None, "適用モード": "",
        }
    診断 = 診断一覧[0]
    推奨操作 = str(診断["推奨操作"])
    if 復旧モード == "auto":
        if (
            推奨操作 == "再分解"
            or "NO_DETAILS" in 診断["状態コード"]
            or "UNDEFINED_DETAILS" in 診断["状態コード"]
            or (
                "REQUEST_TIMEOUT" in 診断["状態コード"]
                and 診断["要求状態"] == "準備中"
            )
        ):
            適用モード = "再分解"
        else:
            適用モード = "再開"
    else:
        適用モード = 復旧モード

    if not 診断["停止"]:
        return {
            "タスクID": タスクID, "復旧実施": False, "理由": "停止状態ではないため復旧不要",
            "復旧前": 診断, "復旧後": 診断, "再開SEQ": None, "適用モード": 適用モード,
        }
    if 推奨操作 == "手動修正":
        return {
            "タスクID": タスクID, "復旧実施": False,
            "理由": "先行SEQの循環または欠番は自動修復できません",
            "復旧前": 診断, "復旧後": 診断, "再開SEQ": 診断["再開SEQ"], "適用モード": 適用モード,
        }
    if 適用モード == "再開" and (
        "NO_DETAILS" in 診断["状態コード"]
        or "UNDEFINED_DETAILS" in 診断["状態コード"]
    ):
        return {
            "タスクID": タスクID, "復旧実施": False,
            "理由": "実行可能な明細がないため再開できません。復旧モード=再分解を指定してください",
            "復旧前": 診断, "復旧後": 診断, "再開SEQ": None, "適用モード": 適用モード,
        }
    if 推奨操作 == "強制再開" and not 強制:
        return {
            "タスクID": タスクID, "復旧実施": False,
            "理由": "実行中プロセスの打ち切りが必要です。強制=trueで再実行してください",
            "復旧前": 診断, "復旧後": 診断, "再開SEQ": 診断["再開SEQ"], "適用モード": 適用モード,
        }
    if 適用モード == "再分解" and 診断["進捗"].get("実行中", 0) and not 強制:
        return {
            "タスクID": タスクID, "復旧実施": False,
            "理由": "実行中明細を止めて再分解するには強制=trueが必要です",
            "復旧前": 診断, "復旧後": 診断, "再開SEQ": 診断["再開SEQ"], "適用モード": 適用モード,
        }

    conn = 接続取得()
    try:
        now = _現在日時()
        req = conn.execute(
            f"SELECT 状態, 実行有効 FROM {AIタスク要求テーブル} WHERE タスクID = ?",
            [タスクID],
        ).fetchone()
        エラー明細 = [
            dict(row)
            for row in conn.execute(
                "SELECT 明細SEQ, タイトル, 状態, 実行有効, 実行回数, 予測分数, 実績分数, 応答内容 "
                f"FROM {AIタスク明細テーブル} WHERE タスクID = ? AND 状態 = 'エラー' ORDER BY 明細SEQ",
                [タスクID],
            ).fetchall()
        ]
        要求エラー = str(req["状態"]) == "エラー"
        復旧前 = {**診断, "エラー明細件数": len(エラー明細)}

        if 適用モード == "再分解":
            conn.execute(
                f"UPDATE {AIタスク要求テーブル} SET 状態 = '準備開始', 実行有効 = 1, PID = '', "
                "開始日時 = '', 終了日時 = '', 実行回数 = 0, 更新日時 = ? WHERE タスクID = ?",
                [now, タスクID],
            )
            conn.execute(
                f"UPDATE {AIタスク明細テーブル} SET 実行有効 = 1, PID = '', 更新日時 = ? WHERE タスクID = ?",
                [now, タスクID],
            )
            _Aチーム依頼反映(conn, タスクID, 状態="準備中", 終了日時="", guard="")
        else:
            # 完了済みの状態・応答は保持し、未完了だけを再実行可能にする。
            conn.execute(
                f"UPDATE {AIタスク要求テーブル} SET 実行有効 = 1, 更新日時 = ? WHERE タスクID = ?",
                [now, タスクID],
            )
            conn.execute(
                f"UPDATE {AIタスク明細テーブル} SET 実行有効 = 1, 更新日時 = ? WHERE タスクID = ?",
                [now, タスクID],
            )
            # パス は分岐で通らなかっただけなので、復旧時は常に待機へ戻して選び直せるようにする
            対象状態 = ("エラー", "パス", "実行中", "準備中") if 強制 else ("エラー", "パス")
            placeholders = ", ".join("?" for _ in 対象状態)
            conn.execute(
                f"UPDATE {AIタスク明細テーブル} SET 状態 = '待機', PID = '', 開始日時 = '', "
                "終了日時 = '', 実行回数 = 0, 実績分数 = 0, 更新日時 = ? "
                f"WHERE タスクID = ? AND 状態 IN ({placeholders})",
                [now, タスクID, *対象状態],
            )
            未完了件数 = conn.execute(
                f"SELECT COUNT(*) FROM {AIタスク明細テーブル} WHERE タスクID = ? "
                "AND 状態 NOT IN ('完了', 'パス')",
                [タスクID],
            ).fetchone()[0]
            if 未完了件数:
                if 強制 or 要求エラー or str(req["状態"]) in ("完了", "中止"):
                    conn.execute(
                        f"UPDATE {AIタスク要求テーブル} SET 状態 = '待機', PID = '', 終了日時 = '', 更新日時 = ? "
                        "WHERE タスクID = ?",
                        [now, タスクID],
                    )
                _Aチーム依頼反映(conn, タスクID, 状態="待機", 終了日時="", guard="")
            elif 要求エラー:
                # 全明細が完了しているのに要求だけエラー、という不整合は完了へ収束させる。
                # 完了済み明細を再実行すると副作用が二重になるため、状態だけを整える。
                conn.execute(
                    f"UPDATE {AIタスク要求テーブル} SET 状態 = '完了', PID = '', 終了日時 = ?, 更新日時 = ? "
                    "WHERE タスクID = ?",
                    [now, now, タスクID],
                )
                _Aチーム依頼反映(conn, タスクID, 状態="完了", 終了日時=now, guard="")
        conn.commit()
        復旧後一覧 = タスク停止検査(タスクID)
        復旧後 = 復旧後一覧[0] if 復旧後一覧 else {}
        復旧後["エラー明細件数"] = len(復旧後.get("エラー明細", []))
        return {
            "タスクID": タスクID,
            "復旧実施": True,
            "理由": "",
            "復旧前": 復旧前,
            "復旧後": 復旧後,
            "再開SEQ": 診断["再開SEQ"],
            "適用モード": 適用モード,
        }
    finally:
        conn.close()


def 明細実行有効更新(タスクID: str, 明細SEQ: int, 実行有効: bool) -> bool:
    """タスク明細 1 行の実行有効フラグを更新する。更新できたら True。

    無効 → 有効 への切替時、その明細が エラー / 完了 / パス なら 待機 に戻して再実行できるようにする
    （PID・開始日時・終了日時・実行回数もリセットする。理由は タスク実行有効更新 と同じ）。
    完了も戻すのは、仕上がりが気に入らないステップだけを選んで実行し直せるようにするため。
    先行SEQ の明細は完了のまま残るので、そのステップだけが再実行される。
    親のタスク要求も エラー / 完了 なら 待機（終了日時は空）へ戻す。要求がその状態のままだと
    実行待ち明細一覧 の対象にならず、明細だけ待機にしても実行が始まらないため（明細再試行 と同じ扱い）。
    """
    初期化()
    conn = 接続取得()
    try:
        now = _現在日時()
        cur = conn.execute(
            f"UPDATE {AIタスク明細テーブル} SET 実行有効 = ?, 更新日時 = ? "
            "WHERE タスクID = ? AND 明細SEQ = ?",
            [1 if 実行有効 else 0, now, タスクID, 明細SEQ],
        )
        更新済み = cur.rowcount > 0
        if 更新済み and 実行有効:
            戻し = conn.execute(
                f"UPDATE {AIタスク明細テーブル} SET 状態 = '待機', PID = '', 開始日時 = '', "
                "終了日時 = '', 実行回数 = 0, 実績分数 = 0, 更新日時 = ? "
                "WHERE タスクID = ? AND 明細SEQ = ? AND 状態 IN ('エラー', '完了', 'パス')",
                [now, タスクID, 明細SEQ],
            )
            if 戻し.rowcount > 0:
                # 要求が完了のままだと後続が起動しないので、終了日時も空へ戻して実行中へ戻せるようにする
                要求戻し = conn.execute(
                    f"UPDATE {AIタスク要求テーブル} SET 状態 = '待機', PID = '', 終了日時 = '', 更新日時 = ? "
                    "WHERE タスクID = ? AND 状態 IN ('エラー', '完了')",
                    [now, タスクID],
                )
                if 要求戻し.rowcount > 0:
                    _Aチーム依頼反映(
                        conn, タスクID, 状態="待機", 終了日時="",
                        guard="状態 IN ('エラー', '完了')",
                    )
        conn.commit()
        return 更新済み
    finally:
        conn.close()


def 明細更新登録(
    タスクID: str,
    明細SEQ: int,
    タイトル: str,
    要求内容: str,
    先行SEQ: str,
    TASK_AI_NAME: str,
    TASK_AI_MODEL_do: str,
    操作検証: bool,
    実行有効: bool,
    状態: str,
    タイプ: str = "",
) -> dict:
    """明細編集ダイアログの内容で AIタスク明細 1 行を更新する。

    タイプは 明細タイプ() を通すので、開始行(0)・終了行(9999) は指定によらず start / end のまま。
    """
    初期化()
    conn = 接続取得()
    try:
        now = _現在日時()
        タイプ値 = 明細タイプ(明細SEQ, タイプ)
        if 状態 == "待機":
            cur = conn.execute(
                f"UPDATE {AIタスク明細テーブル} SET タイプ = ?, タイトル = ?, 要求内容 = ?, 先行SEQ = ?, TASK_AI_NAME = ?, TASK_AI_MODEL_do = ?, 操作検証 = ?, 実行有効 = ?, 状態 = ?, "
                "PID = '', 開始日時 = '', 終了日時 = '', 実行回数 = 0, 実績分数 = 0, 応答内容 = '', 更新日時 = ? "
                "WHERE タスクID = ? AND 明細SEQ = ?",
                [タイプ値, タイトル, 要求内容, 先行SEQ, TASK_AI_NAME, TASK_AI_MODEL_do, 1 if 操作検証 else 0, 1 if 実行有効 else 0, 状態, now, タスクID, 明細SEQ],
            )
        else:
            cur = conn.execute(
                f"UPDATE {AIタスク明細テーブル} SET タイプ = ?, タイトル = ?, 要求内容 = ?, 先行SEQ = ?, TASK_AI_NAME = ?, TASK_AI_MODEL_do = ?, 操作検証 = ?, 実行有効 = ?, 状態 = ?, "
                "PID = '', 更新日時 = ? WHERE タスクID = ? AND 明細SEQ = ?",
                [タイプ値, タイトル, 要求内容, 先行SEQ, TASK_AI_NAME, TASK_AI_MODEL_do, 1 if 操作検証 else 0, 1 if 実行有効 else 0, 状態, now, タスクID, 明細SEQ],
            )
        conn.execute(
            f"UPDATE {AIタスク要求テーブル} SET 更新日時 = ? WHERE タスクID = ?",
            [now, タスクID],
        )
        conn.commit()
        if cur.rowcount <= 0:
            return {}
        return タスク明細取得(タスクID, 明細SEQ)
    finally:
        conn.close()


def タスク明細全削除(タスクID: str) -> int:
    """指定タスクの AIタスク明細を全削除する（sub_init の再生成前クリア用）。"""
    初期化()
    conn = 接続取得()
    try:
        cur = conn.execute(
            f"DELETE FROM {AIタスク明細テーブル} WHERE タスクID = ?",
            [タスクID],
        )
        conn.commit()
        return cur.rowcount
    finally:
        conn.close()


def 残存PID一覧() -> list[dict]:
    """AIタスク要求・AIタスク明細に残っている PID を返す（システム開始時のクリーンアップ用）。"""
    初期化()
    conn = 接続取得()
    try:
        結果: list[dict] = []
        rows = conn.execute(
            f"SELECT 利用者ID, タスクID, PID FROM {AIタスク要求テーブル} WHERE PID != ''"
        ).fetchall()
        結果.extend({"テーブル": AIタスク要求テーブル, **dict(row)} for row in rows)
        rows = conn.execute(
            f"SELECT タスクID, PID FROM {AIタスク明細テーブル} WHERE PID != ''"
        ).fetchall()
        結果.extend({"テーブル": AIタスク明細テーブル, **dict(row)} for row in rows)
        return 結果
    finally:
        conn.close()


def PID全クリア() -> None:
    """システム開始時: AIタスク要求・AIタスク明細に残った PID をエラーとして記録しクリアする。

    再起動時点でプロセスが生きているか判断できず、PID は OS に再利用され得るため
    強制停止はしない（別プロセスを誤って停止する恐れがあるため）。自動再実行はせずエラー化のみ行う。

    PID が残るのは要求側とは限らない。明細を実行している間は PID を持つのは明細だけで、
    要求は 状態='実行中'・PID='' になっている。その要求を残すと、明細だけがエラーになって
    要求は実行中のまま動かなくなり、`Aチーム状況` の実行数も 1 のままになるため、
    作業ループ（PDCA）の空き時間判定がタイムアウトまで通らない。そこで明細に PID が
    あったタスクの要求も、未終了ならここでまとめて終わらせる。

    Aチーム依頼から投入されたタスクは、チーム側にもエラーを反映する。反映しないと
    Aチーム依頼が実行中のまま、Aチーム作業が未終了のまま残り、作業ループ（PDCA）が
    次の段へ進めなくなる。
    """
    初期化()
    メッセージ = "システム再起動のため中断しました"
    conn = 接続取得()
    try:
        now = _現在日時()
        対象タスクID = sorted(
            {
                str(row["タスクID"])
                for row in conn.execute(
                    f"SELECT タスクID FROM {AIタスク要求テーブル} WHERE PID != '' "
                    f"UNION SELECT タスクID FROM {AIタスク明細テーブル} WHERE PID != ''"
                ).fetchall()
            }
        )
        for テーブル in (AIタスク要求テーブル, AIタスク明細テーブル):
            conn.execute(
                f"UPDATE {_識別子(テーブル)} SET 状態 = 'エラー', 実行有効 = 0, "
                "終了日時 = ?, PID = '', 応答内容 = ?, 更新日時 = ? "
                "WHERE PID != ''",
                [now, メッセージ, now],
            )
        for タスクID in 対象タスクID:
            # 明細だけが実行中だった要求（PID が空）はまだ残っているので、ここで終わらせる
            conn.execute(
                f"UPDATE {AIタスク要求テーブル} SET 状態 = 'エラー', 実行有効 = 0, "
                "終了日時 = ?, PID = '', 応答内容 = ?, 更新日時 = ? "
                "WHERE タスクID = ? AND 状態 NOT IN ('完了', 'エラー', '中止')",
                [now, メッセージ, now, タスクID],
            )
            _Aチーム依頼反映(
                conn, タスクID, 状態="エラー", 応答内容=メッセージ, 終了日時=now, guard=""
            )
        conn.commit()
    finally:
        conn.close()


def 明細タイムアウト分(予測分数, 最低分: int = 10, 倍率: int = 2) -> int:
    """明細 1 件の打ち切り時間（分）を返す。

    - 予測分数がある: 予測分数 × 倍率。短い見積りで即打ち切りにならないよう最低分は必ず確保する
    - 予測分数が 0 / 未設定（未見積り）: 最低分で見る

    未見積りを最低分にしているのは、再試行で時間が縮まないようにするため。未見積りに
    長い既定値を与えると、初回だけ長く待って再試行（予測分数=未見積り分から開始）が
    それより短くなる。再試行の書き換え規則は 再試行予測分数 を参照。

    例（最低10 / 倍率2）: 未見積り→10分、1分→10分、5分→10分、8分→16分、20分→40分
    """
    分 = _正整数(予測分数)
    if 分 <= 0:
        return 最低分
    return max(最低分, 分 * 倍率)


def タイムアウト対象一覧(
    制限分: int = 30,
    準備制限分: int = 10,
    明細最低分: int = 10,
    明細倍率: int = 2,
) -> list[dict]:
    """制限分以上まったく進捗が無い行を、適用した制限分つきで返す。

    AIタスク要求・AIタスク明細の両方が対象。判定の起点はテーブルごとに変える。

    - AIタスク明細: 開始日時。1 ステップは 1 プロセスの実行なので、開始からの経過でよい。
      打ち切り時間は明細ごとに変わる（明細タイムアウト分 参照）。予測分数が入っていれば
      その 2 倍まで待ち、未見積りなら最低分で見る。行ごとに閾値が違うため SQL では絞らず
      候補を取り出して Python 側で判定する。
    - AIタスク要求: 開始日時と更新日時の新しい方。要求の開始日時は最初の明細が終わった
      時点で入ったきり更新されないため、開始日時だけで見ると「全ステップの合計時間」に
      制限をかけることになり、正常に進んでいる長いタスクまで打ち切ってしまう。
      更新日時は明細を 1 つ終えるたびに動く（明細完了）ので、進捗が続く限り対象にならない。

    制限分は状態で使い分ける。AIタスク要求が 状態='準備中'（sub_init.py がAIタスクを明細へ
    分解している最中）のときだけ準備制限分を使い、それ以外は制限分を使う。分解は明細を
    作るだけの短い処理で、長引くのは応答待ちで固まっている場合だから。

    PID は残すと実行中扱いのまま後続明細が起動できないため、呼び出し側で PID の
    プロセスを停止してから タイムアウト対象エラー化() でエラー化する。
    """
    初期化()
    conn = 接続取得()
    try:
        now = datetime.now()
        閾値 = (now - timedelta(minutes=制限分)).strftime("%Y-%m-%d %H:%M:%S")
        準備閾値 = (now - timedelta(minutes=準備制限分)).strftime("%Y-%m-%d %H:%M:%S")
        共通条件 = "開始日時 != '' AND 終了日時 = '' AND 実行有効 = 1 AND 状態 NOT IN ('エラー', '中止', '完了', '済')"
        結果: list[dict] = []
        rows = conn.execute(
            f"SELECT 利用者ID, タスクID, '' AS 明細SEQ, 状態, PID, 開始日時 "
            f"FROM {AIタスク要求テーブル} "
            f"WHERE {共通条件} "
            f"AND MAX(開始日時, 更新日時) <= (CASE WHEN 状態 = '準備中' THEN ? ELSE ? END)",
            [準備閾値, 閾値],
        ).fetchall()
        for row in rows:
            適用 = 準備制限分 if str(row["状態"]) == "準備中" else 制限分
            結果.append({"テーブル": AIタスク要求テーブル, "制限分": 適用, **dict(row)})
        rows = conn.execute(
            f"SELECT タスクID, 明細SEQ, 状態, PID, 開始日時, 予測分数 "
            f"FROM {AIタスク明細テーブル} WHERE {共通条件} AND 状態 = '実行中' "
            f"AND EXISTS (SELECT 1 FROM {AIタスク要求テーブル} r "
            f"WHERE r.タスクID = {AIタスク明細テーブル}.タスクID "
            "AND r.実行有効 = 1 AND r.状態 NOT IN ('中止', '完了', '済', 'エラー'))",
        ).fetchall()
        for row in rows:
            適用 = 明細タイムアウト分(row["予測分数"], 明細最低分, 明細倍率)
            try:
                開始 = datetime.strptime(str(row["開始日時"]), "%Y-%m-%d %H:%M:%S")
            except ValueError:
                continue  # 日時が壊れている行は打ち切り対象にしない
            if (now - 開始).total_seconds() >= 適用 * 60:
                結果.append({"テーブル": AIタスク明細テーブル, "制限分": 適用, **dict(row)})
        return 結果
    finally:
        conn.close()


def タイムアウト対象エラー化(対象一覧: list[dict]) -> int:
    """タイムアウト対象を 状態='エラー'・実行有効=0・PID='' にする。

    Aチーム依頼から投入されたタスクは、チーム側にもエラーを反映する（PID全クリア と同じ理由。
    反映しないと Aチーム作業が未終了のまま残り、作業ループが次の段へ進めなくなる）。
    """
    if not 対象一覧:
        return 0
    初期化()
    メッセージ = "実行タイムアウトのため中断しました"
    conn = 接続取得()
    try:
        now = _現在日時()
        更新件数 = 0
        for 行 in 対象一覧:
            テーブル = str(行.get("テーブル", ""))
            タスクID = str(行.get("タスクID", ""))
            PID = str(行.get("PID", ""))
            開始日時 = str(行.get("開始日時", ""))
            if テーブル not in (AIタスク要求テーブル, AIタスク明細テーブル) or not タスクID:
                continue
            if テーブル == AIタスク明細テーブル:
                # 打ち切りまでにかかった時間も実績として残す（終了日時は入れず監視対象のまま扱う既存仕様は維持）
                cur = conn.execute(
                    f"UPDATE {AIタスク明細テーブル} SET 状態 = 'エラー', 実行有効 = 0, PID = '', "
                    "実績分数 = ?, 更新日時 = ? "
                    "WHERE タスクID = ? AND 明細SEQ = ? "
                    "AND 状態 != 'エラー' AND 終了日時 = '' AND PID = ? AND 開始日時 = ?",
                    [_経過分数(開始日時, now), now, タスクID, int(行.get("明細SEQ", 0) or 0), PID, 開始日時],
                )
            else:
                # 要求側の終了日時は 明細失敗 と同じく空のままにする（明細再試行 で
                # 実行中へ戻したときにタイムアウト監視の対象から外れてしまうため）
                cur = conn.execute(
                    f"UPDATE {AIタスク要求テーブル} SET 状態 = 'エラー', 実行有効 = 0, PID = '', 更新日時 = ? "
                    "WHERE タスクID = ? "
                    "AND 状態 != 'エラー' AND 終了日時 = '' AND PID = ? AND 開始日時 = ?",
                    [now, タスクID, PID, 開始日時],
                )
                if cur.rowcount:
                    _Aチーム依頼反映(
                        conn, タスクID, 状態="エラー", 応答内容=メッセージ, 終了日時=now, guard=""
                    )
            更新件数 += cur.rowcount
        conn.commit()
        return 更新件数
    finally:
        conn.close()


def タイムアウトエラー化(制限分: int = 30) -> list[dict]:
    """互換用: タイムアウト対象を取得して、そのままエラー化する。"""
    対象一覧 = タイムアウト対象一覧(制限分)
    タイムアウト対象エラー化(対象一覧)
    return 対象一覧


def タスク本登録(
    利用者ID: str,
    タスクID: str,
    タイトル: str,
    要求内容: str,
    マーメイド記号: str,
    明細: list[dict],
    応答内容: str = "",
) -> dict:
    """AI 生成結果で AIタスク要求・AIタスク明細を書き込む。仮登録は削除（同タスクIDで置き換え）。

    仮登録の プロジェクト・実行有効・開始日時・実行回数 は引き継ぎ、終了日時を記録して PID をクリアする。
    実行有効フラグは各 AIタスク明細にもコピーする（明細実行の可否判定に使う）。
    要求の状態は常に 準備完了（実行開始条件の充足待ち）で書き込む。即時実行の場合は
    状態監視ループが 10 秒ごとに 準備完了 を 待機 へ戻して即座に実行を開始する。
    要求内容には仮登録時の人間の入力をそのまま引き継ぎ、AI がタスク分解のために整理した文章は
    応答内容へ書き込む（人間の元の要求が上書きされて消えないようにするため）。
    """
    初期化()
    conn = 接続取得()
    try:
        conn.execute("BEGIN IMMEDIATE")
        仮 = _タスク要求取得(conn, タスクID)
        if str(仮.get("状態", "")) in ("エラー", "中止"):
            return 仮
        # 所有者は仮登録の値を引き継ぐ（置き換え後も利用者IDが変わらないようにする）
        利用者ID = str(仮.get("利用者ID", "")) or 利用者ID
        実行有効値 = int(仮.get("実行有効", 1)) if 仮 else 1
        要求TASK_AI_NAME = str(仮.get("TASK_AI_NAME", TASK_AI_NAME既定) or TASK_AI_NAME既定)
        要求モデル = {
            カラム: str(仮.get(カラム, TASK_AI_MODEL既定) or TASK_AI_MODEL既定)
            for カラム in AIモデルカラム
        }
        初期状態 = "準備完了"
        conn.execute(f"DELETE FROM {AIタスク要求テーブル} WHERE タスクID = ?", [タスクID])
        conn.execute(f"DELETE FROM {AIタスク明細テーブル} WHERE タスクID = ?", [タスクID])
        監査 = _監査項目(利用者ID, 利用者ID)
        監査カラム = ", ".join(監査.keys())
        監査値 = list(監査.values())
        conn.execute(
            "INSERT INTO {テーブル} (利用者ID, タスクID, プロジェクト, タイトル, 要求内容, TASK_AI_NAME, "
            "{モデルカラム}, 実行有効, 状態, マーメイド記号, "
            "PID, 開始日時, 終了日時, 実行回数, 応答内容, {監査カラム}) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, {監査値プレース})".format(
                テーブル=AIタスク要求テーブル,
                モデルカラム=", ".join(AIモデルカラム),
                監査カラム=監査カラム,
                監査値プレース=", ".join("?" * len(監査値)),
            ),
            [
                利用者ID, タスクID, str(仮.get("プロジェクト", "")), タイトル, 要求内容,
                要求TASK_AI_NAME, *[要求モデル[カラム] for カラム in AIモデルカラム],
                実行有効値, 初期状態, マーメイド記号,
                "",
                str(仮.get("開始日時", "")),
                _現在日時(),
                int(仮.get("実行回数", 0) or 0),
                応答内容,
                *監査値,
            ],
        )
        for 行 in 明細:
            明細SEQ = int(行["明細SEQ"])
            conn.execute(
                f"INSERT INTO {AIタスク明細テーブル} (タスクID, 明細SEQ, タイプ, タイトル, 要求内容, 先行SEQ, TASK_AI_NAME, TASK_AI_MODEL_do, 操作検証, 実行有効, 状態, 予測分数, {監査カラム}) "
                f"VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, {', '.join('?' * len(監査値))})",
                [
                    タスクID,
                    明細SEQ,
                    # 開始行・終了行は SEQ で確定し、その間は AI 指定の do / if / or を採用する
                    明細タイプ(明細SEQ, 行.get("タイプ")),
                    str(行.get("タイトル", "")),
                    str(行.get("要求内容", "")),
                    str(行.get("先行SEQ", "")),
                    要求TASK_AI_NAME,
                    # 明細は各ステップの実行なので do のモデルを引き継ぐ
                    要求モデル["TASK_AI_MODEL_do"],
                    1 if 行.get("操作検証") else 0,
                    実行有効値,
                    "待機",
                    # 予測分数は AI がタスク分解時に見積もる。未指定・不正値は 0（未見積り）とする
                    _正整数(行.get("予測分数")),
                    *監査値,
                ],
            )
        conn.commit()
        return _タスク要求取得(conn, タスクID)
    finally:
        conn.close()


def タスク失敗(タスクID: str, メッセージ: str) -> dict:
    """AI 生成に失敗した仮タスクを『エラー』の完了タスクにする（終了日時を記録し PID をクリア）。

    実行有効 = 0 にするのは 明細失敗 と同じ理由（実行有効の切替でエラーから復旧させるため）。
    エラー内容は 応答タイトル・応答内容 へ書く（要求内容＝人が書いた依頼文は書き換えない）。
    """
    初期化()
    conn = 接続取得()
    try:
        now = _現在日時()
        cursor = conn.execute(
            f"UPDATE {AIタスク要求テーブル} SET 状態 = 'エラー', 実行有効 = 0, "
            "応答タイトル = ?, 応答内容 = ?, "
            "PID = '', 終了日時 = ?, 更新日時 = ? WHERE タスクID = ? AND 状態 != '中止'",
            ["エラー", f"[エラー] {メッセージ}", now, now, タスクID],
        )
        if cursor.rowcount:
            _Aチーム依頼反映(
                conn, タスクID, 状態="エラー", 応答タイトル="エラー",
                応答内容=f"[エラー] {メッセージ}", 終了日時=now, guard="",
            )
        conn.commit()
        return _タスク要求取得(conn, タスクID)
    finally:
        conn.close()


def _チーム状況テーブル作成(conn: sqlite3.Connection) -> None:
    conn.execute(f"""
        CREATE TABLE IF NOT EXISTS {AIチーム状況テーブル} (
            要員ID TEXT NOT NULL PRIMARY KEY,
            要員名 TEXT NOT NULL DEFAULT '',
            最終更新日時 TEXT NOT NULL DEFAULT '',
            経験最終更新日時 TEXT NOT NULL DEFAULT '',
            待機数 INTEGER NOT NULL DEFAULT 0,
            実行数 INTEGER NOT NULL DEFAULT 0,
            まとめ中数 INTEGER NOT NULL DEFAULT 0,
            完了数 INTEGER NOT NULL DEFAULT 0,
            エラー数 INTEGER NOT NULL DEFAULT 0,
            更新日時 TEXT NOT NULL DEFAULT ''
        )
    """)


def チーム状況更新() -> int:
    """有効なAチーム要員ごとにAIタスクと生成中の経験を集計し、Aチーム状況を作り直す。

    状態監視ループ（10秒間隔）の最後に毎回呼ばれる。
    Aチーム要員は Team 処理が作成するテーブルのため、初期化前などで存在しない場合は何もしない。
    """
    初期化()
    conn = 接続取得()
    try:
        now = _現在日時()
        閾値 = (datetime.now() - timedelta(hours=24)).strftime("%Y-%m-%d %H:%M:%S")
        _チーム状況テーブル作成(conn)
        try:
            conn.execute(f"DELETE FROM {AIチーム状況テーブル}")
            conn.execute(
                f"""
                INSERT INTO {AIチーム状況テーブル}
                    (要員ID, 要員名, 最終更新日時, 経験最終更新日時,
                     待機数, 実行数, まとめ中数, 完了数, エラー数, 更新日時)
                SELECT
                    c.要員ID,
                    c.要員名,
                    IFNULL(MAX(t.更新日時), ''),
                    IFNULL((SELECT MAX(e.更新日時)
                              FROM {AIチーム経験テーブル} e
                             WHERE e.要員ID = c.要員ID), ''),
                    SUM(CASE WHEN t.実行有効 = 1 AND t.状態 IN ('準備完了', '待機') THEN 1 ELSE 0 END),
                    SUM(CASE WHEN t.実行有効 = 1 AND t.状態 IN ('準備中', '実行中') THEN 1 ELSE 0 END),
                    (SELECT COUNT(*)
                       FROM {AIチーム経験テーブル} e
                      WHERE e.要員ID = c.要員ID
                        AND e.開始日時 != ''
                        AND e.終了日時 = ''),
                    SUM(CASE WHEN t.状態 = '完了' THEN 1 ELSE 0 END),
                    SUM(CASE WHEN t.状態 = 'エラー' THEN 1 ELSE 0 END),
                    ?
                  FROM {AIチーム要員テーブル} c
             LEFT JOIN {AIタスク要求テーブル} t
                    ON t.利用者ID = c.要員ID
                   AND t.更新日時 >= ?
                 WHERE c.有効 = 1
                 GROUP BY c.要員ID, c.要員名
                """,
                [now, 閾値],
            )
        except sqlite3.OperationalError:
            conn.rollback()
            return 0
        件数 = conn.execute(f"SELECT COUNT(*) FROM {AIチーム状況テーブル}").fetchone()[0]
        conn.commit()
        return 件数
    finally:
        conn.close()
