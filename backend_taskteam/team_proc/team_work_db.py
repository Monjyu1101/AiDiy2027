# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""Aチーム依頼の DB アクセス。"""

from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta

from .config import AIモデル, 設定読込
from .team_db import DB_PATH

依頼テーブル = "Aチーム依頼"
状態一覧 = ("準備開始", "準備中", "準備完了", "待機", "実行中", "エラー", "完了", "済", "中止")
状態入力一覧 = 状態一覧
# 進捗が止まってからこの分数でタイムアウトにする（依頼の総実行時間の上限ではない）。
# Task 処理は明細を1つ終えるたびに Aチーム依頼の更新日時を動かすため、
# 進んでいる限り何時間かかってもタイムアウトしない。
無進捗タイムアウト分 = 30
# 状態='準備中'（sub_init.py による担当要員の選択とAIタスク投入）だけは短く見る。
# 準備は担当を決めて投入するだけの短い処理で、長引くのは応答待ちで固まっている場合だから。
準備無進捗タイムアウト分 = 10
一覧最大件数 = 100
一覧対象日数 = 30

_採番テーブル = "C採番"
_採番ID = "Aチーム依頼"
_採番プレフィックス = "TR"
_採番初期値 = 1000

# 依頼が持つモデルは3種ずつ。TEAM 側は作業ループの段（S・P=plan / D=do / C・A=check）、
# TASK 側は投入する Aタスクの内部フェーズ（準備=plan / 各ステップ=do / 最終確認=check）に対応する。
AIモデルフェーズ = ("plan", "do", "check")
AIモデルカラム = tuple(
    f"{接頭辞}_AI_MODEL_{フェーズ}"
    for 接頭辞 in ("TEAM", "TASK")
    for フェーズ in AIモデルフェーズ
)
AI設定カラム = ("TEAM_AI_NAME", "TASK_AI_NAME", *AIモデルカラム)
_AI設定列SQL = ", ".join(AI設定カラム)

# プロセス内でテーブル作成を一度だけ行うためのフラグ
_初期化済み = False


def _現在日時() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def 接続取得() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
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


def 初期化() -> None:
    """テーブル作成を行う。多重呼び出し可。"""
    # CREATE TABLE は IF NOT EXISTS でも書き込みロックを取るため、
    # 起動監視ループのように毎回呼ばれる経路で実行すると "database is locked" を招く。
    # プロセス内で一度成功したら以降は何もしない。
    global _初期化済み
    if _初期化済み:
        return
    conn = 接続取得()
    try:
        conn.execute(f"""
            CREATE TABLE IF NOT EXISTS "{依頼テーブル}" (
                依頼ID TEXT NOT NULL,
                要員ID TEXT NOT NULL,
                プロジェクト TEXT NOT NULL DEFAULT '',
                タイトル TEXT NOT NULL DEFAULT '',
                要求内容 TEXT NOT NULL DEFAULT '',
                TEAM_AI_NAME TEXT NOT NULL DEFAULT 'codex_cli',
                TEAM_AI_MODEL_plan TEXT NOT NULL DEFAULT 'auto',
                TEAM_AI_MODEL_do TEXT NOT NULL DEFAULT 'auto',
                TEAM_AI_MODEL_check TEXT NOT NULL DEFAULT 'auto',
                TASK_AI_NAME TEXT NOT NULL DEFAULT 'codex_cli',
                TASK_AI_MODEL_plan TEXT NOT NULL DEFAULT 'auto',
                TASK_AI_MODEL_do TEXT NOT NULL DEFAULT 'auto',
                TASK_AI_MODEL_check TEXT NOT NULL DEFAULT 'auto',
                タスクID TEXT NOT NULL DEFAULT '',
                実行有効 INTEGER NOT NULL DEFAULT 1,
                状態 TEXT NOT NULL DEFAULT '準備開始',
                PID TEXT NOT NULL DEFAULT '',
                開始日時 TEXT NOT NULL DEFAULT '',
                終了日時 TEXT NOT NULL DEFAULT '',
                実行回数 INTEGER NOT NULL DEFAULT 0,
                応答タイトル TEXT NOT NULL DEFAULT '',
                応答内容 TEXT NOT NULL DEFAULT '',
                まとめ内容 TEXT NOT NULL DEFAULT '',
                登録日時 TEXT NOT NULL,
                登録利用者ID TEXT NOT NULL,
                登録利用者名 TEXT NOT NULL,
                登録端末ID TEXT NOT NULL,
                更新日時 TEXT NOT NULL,
                更新利用者ID TEXT NOT NULL,
                更新利用者名 TEXT NOT NULL,
                更新端末ID TEXT NOT NULL,
                PRIMARY KEY (依頼ID)
            )
        """)
        conn.execute(f"""
            CREATE INDEX IF NOT EXISTS "IX_Aチーム依頼_状態"
            ON "{依頼テーブル}" (要員ID, 状態, 依頼ID)
        """)
        conn.commit()
        _初期化済み = True
    finally:
        conn.close()




def _採番確保(conn: sqlite3.Connection) -> None:
    """C採番（backend_server共有）にAチーム依頼用の採番行が無ければ作成する。"""
    conn.execute(f"""
        CREATE TABLE IF NOT EXISTS "{_採番テーブル}" (
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
        INSERT OR IGNORE INTO "{_採番テーブル}" (
            採番ID, 最終採番値, 採番備考, 有効,
            登録日時, 登録利用者ID, 登録利用者名, 登録端末ID,
            更新日時, 更新利用者ID, 更新利用者名, 更新端末ID
        ) VALUES (?, ?, ?, 1, ?, 'system', 'システム', 'backend_team', ?, 'system', 'システム', 'backend_team')
        """,
        [_採番ID, _採番初期値, "AIチーム依頼の採番（TR）", now, now],
    )


def _新規依頼ID(conn: sqlite3.Connection, 要員ID: str) -> str:
    del 要員ID  # 依頼ID は単独PKのためグローバルに一意（引数は呼び出し互換のため保持）
    _採番確保(conn)
    conn.execute(
        f'UPDATE "{_採番テーブル}" SET 最終採番値 = 最終採番値 + 1 WHERE 採番ID = ?',
        [_採番ID],
    )
    行 = conn.execute(
        f'SELECT 最終採番値 FROM "{_採番テーブル}" WHERE 採番ID = ?',
        [_採番ID],
    ).fetchone()
    return f"{_採番プレフィックス}{行[0]:08d}"


def _タイトル(要求内容: str) -> str:
    return 要求内容.splitlines()[0][:40] if 要求内容 else ""


def 依頼一覧(要員ID: str) -> list[dict]:
    初期化()
    conn = 接続取得()
    try:
        # 一覧は表示優先順位（完了/済/エラー/中止=9、それ以外=1）昇順・更新日時降順。
        # 直近 一覧対象日数 分・最大 一覧最大件数 までに絞る
        期間閾値 = (datetime.now() - timedelta(days=一覧対象日数)).strftime("%Y-%m-%d %H:%M:%S")
        rows = conn.execute(
            f"""
            SELECT 依頼ID, 要員ID, プロジェクト, タイトル, 要求内容,
                   {_AI設定列SQL}, タスクID,
                   実行有効, 状態, PID,
                   開始日時, 終了日時, 実行回数, 応答タイトル, 応答内容, まとめ内容, 更新日時,
                   CASE WHEN 状態 IN ('完了', '済', 'エラー', '中止') THEN 9 ELSE 1 END AS 表示優先順位
              FROM "{依頼テーブル}"
             WHERE 要員ID = ? AND 更新日時 >= ?
             ORDER BY 表示優先順位 ASC, 更新日時 DESC
             LIMIT ?
            """,
            [要員ID, 期間閾値, 一覧最大件数],
        ).fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()


def 依頼最大更新日時(要員ID: str) -> str:
    初期化()
    conn = 接続取得()
    try:
        row = conn.execute(
            f'SELECT MAX(更新日時) AS 最大更新日時 FROM "{依頼テーブル}" WHERE 要員ID = ?',
            [要員ID],
        ).fetchone()
        return str(row["最大更新日時"] or "") if row else ""
    finally:
        conn.close()


def 依頼取得(要員ID: str, 依頼ID: str) -> dict | None:
    初期化()
    conn = 接続取得()
    try:
        row = conn.execute(
            f"""
            SELECT 依頼ID, 要員ID, プロジェクト, タイトル, 要求内容,
                   {_AI設定列SQL}, タスクID,
                   実行有効, 状態, PID,
                   開始日時, 終了日時, 実行回数, 応答タイトル, 応答内容, まとめ内容, 更新日時
              FROM "{依頼テーブル}"
             WHERE 要員ID = ? AND 依頼ID = ?
            """,
            [要員ID, 依頼ID],
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def 依頼新規既定値(要員ID: str) -> dict:
    """新規登録時の既定値（プロジェクト / TEAM_AI / TASK_AI）を返す。

    AIチーム_依頼編集ダイアログの新規時と同じ条件で決める。
    要員IDの更新最終レコードの値を引き継ぎ、レコードが無ければ規定値
    （`AiDiy_key.json` の `CODE_BASE_PATH` / `TEAM_AI_*` / `TASK_AI_*`）を使う。

    モデルは plan / do / check の3種ずつで、規定値も共通設定のフェーズ別値から取る。
    """
    try:
        設定 = 設定読込()
        規定 = {
            "プロジェクト": str(getattr(設定, "CODE_BASE_PATH", "") or "../"),
            "TEAM_AI_NAME": str(getattr(設定, "TEAM_AI_NAME", "") or "codex_cli"),
            "TASK_AI_NAME": str(getattr(設定, "TASK_AI_NAME", "") or "codex_cli"),
            **{
                f"{接頭辞}_AI_MODEL_{フェーズ}": AIモデル(接頭辞, フェーズ)
                for 接頭辞 in ("TEAM", "TASK")
                for フェーズ in AIモデルフェーズ
            },
            "参照依頼ID": "",
        }
    except Exception:
        規定 = {
            "プロジェクト": "../",
            "TEAM_AI_NAME": "codex_cli",
            "TASK_AI_NAME": "codex_cli",
            **{カラム: "auto" for カラム in AIモデルカラム},
            "参照依頼ID": "",
        }

    要員ID = (要員ID or "").strip()
    if not 要員ID:
        return 規定
    初期化()
    conn = 接続取得()
    try:
        row = conn.execute(
            f"""
            SELECT 依頼ID, プロジェクト, {_AI設定列SQL}
              FROM "{依頼テーブル}"
             WHERE 要員ID = ?
             ORDER BY 更新日時 DESC, 依頼ID DESC
             LIMIT 1
            """,
            [要員ID],
        ).fetchone()
    finally:
        conn.close()
    if not row:
        return 規定
    既定 = dict(規定)
    既定["参照依頼ID"] = str(row["依頼ID"] or "")
    # プロジェクトは空文字もそのまま引き継ぐ（ダイアログが最終依頼の値を初期表示するのと同じ）
    既定["プロジェクト"] = str(row["プロジェクト"] or "")
    for キー in AI設定カラム:
        値 = str(row[キー] or "").strip()
        if 値:
            既定[キー] = 値
    return 既定


def 依頼登録(依頼データ: dict, 操作者: dict) -> dict:
    初期化()
    now = _現在日時()
    conn = 接続取得()
    try:
        依頼ID = _新規依頼ID(conn, 依頼データ["要員ID"])
        conn.execute(
            f"""
            INSERT INTO "{依頼テーブル}" (
                依頼ID, 要員ID, プロジェクト, タイトル, 要求内容,
                {_AI設定列SQL}, タスクID,
                実行有効, 状態,
                PID, 開始日時, 終了日時, 実行回数, 応答タイトル, 応答内容,
                登録日時, 登録利用者ID, 登録利用者名, 登録端末ID,
                更新日時, 更新利用者ID, 更新利用者名, 更新端末ID
            ) VALUES (
                ?, ?, ?, ?, ?, {', '.join('?' * len(AI設定カラム))}, '', ?, ?,
                '', '', '', 0, '', '',
                ?, ?, ?, ?, ?, ?, ?, ?
            )
            """,
            (
                依頼ID,
                依頼データ["要員ID"],
                依頼データ["プロジェクト"],
                _タイトル(依頼データ["要求内容"]),
                依頼データ["要求内容"],
                *[依頼データ[カラム] for カラム in AI設定カラム],
                int(依頼データ["実行有効"]),
                依頼データ["状態"],
                now,
                操作者["利用者ID"],
                操作者["利用者名"],
                操作者["端末ID"],
                now,
                操作者["利用者ID"],
                操作者["利用者名"],
                操作者["端末ID"],
            ),
        )
        conn.commit()
    finally:
        conn.close()
    return 依頼取得(依頼データ["要員ID"], 依頼ID) or {}


def 依頼変更(依頼データ: dict, 操作者: dict) -> dict:
    初期化()
    if 依頼データ["状態"] not in 状態一覧:
        raise ValueError("状態が正しくありません")
    現行 = 依頼取得(依頼データ["要員ID"], 依頼データ["依頼ID"])
    if 現行 is None:
        raise KeyError(依頼データ["依頼ID"])
    now = _現在日時()
    タスクID = str(現行["タスクID"] or "")
    PID = str(現行["PID"] or "")
    開始日時 = str(現行["開始日時"] or "")
    終了日時 = str(現行["終了日時"] or "")
    実行回数 = int(現行["実行回数"] or 0)
    応答タイトル = str(現行["応答タイトル"] or "")
    応答内容 = str(現行["応答内容"] or "")
    まとめ内容 = str(現行["まとめ内容"] or "")
    if 依頼データ["状態"] == "準備開始":
        タスクID = ""
        PID = ""
        開始日時 = ""
        終了日時 = ""
        実行回数 = 0
        応答タイトル = ""
        応答内容 = ""
        まとめ内容 = ""
    if 依頼データ["状態"] == "実行中" and not 開始日時:
        開始日時 = now
    if 依頼データ["状態"] in ("完了", "済", "中止"):
        終了日時 = now
    elif 依頼データ["状態"] == "待機":
        終了日時 = ""
    conn = 接続取得()
    try:
        conn.execute(
            f"""
            UPDATE "{依頼テーブル}"
               SET プロジェクト = ?, タイトル = ?, 要求内容 = ?,
                   {', '.join(f'{カラム} = ?' for カラム in AI設定カラム)},
                   実行有効 = ?, 状態 = ?,
                   タスクID = ?, PID = ?, 開始日時 = ?, 終了日時 = ?,
                   実行回数 = ?, 応答タイトル = ?, 応答内容 = ?, まとめ内容 = ?,
                   更新日時 = ?, 更新利用者ID = ?, 更新利用者名 = ?, 更新端末ID = ?
             WHERE 要員ID = ? AND 依頼ID = ?
            """,
            (
                依頼データ["プロジェクト"],
                _タイトル(依頼データ["要求内容"]),
                依頼データ["要求内容"],
                *[依頼データ[カラム] for カラム in AI設定カラム],
                int(依頼データ["実行有効"]),
                依頼データ["状態"],
                タスクID,
                PID,
                開始日時,
                終了日時,
                実行回数,
                応答タイトル,
                応答内容,
                まとめ内容,
                now,
                操作者["利用者ID"],
                操作者["利用者名"],
                操作者["端末ID"],
                依頼データ["要員ID"],
                依頼データ["依頼ID"],
            ),
        )
        conn.commit()
    finally:
        conn.close()
    return 依頼取得(依頼データ["要員ID"], 依頼データ["依頼ID"]) or {}


def 直接投入登録(依頼データ: dict, 操作者: dict) -> dict:
    """担当要員が決まっている依頼を、sub_init を経由せず投入するために登録する。

    作業ループ（PDCA）のように要員が確定している場合に使う。状態='準備中'・開始日時=now・
    実行回数=1 で作り、呼び出し側が 投入成功記録() / 投入失敗記録() で確定させる。
    投入待ち一覧（状態='準備開始'）には出ないため sub_init による二重投入は起きず、
    開始日時が入るので無進捗タイムアウト監視の対象にもなる。
    """
    データ = dict(依頼データ)
    データ["状態"] = "準備中"
    項目 = 依頼登録(データ, 操作者)
    依頼ID = str(項目.get("依頼ID", ""))
    if not 依頼ID:
        return 項目
    now = _現在日時()
    conn = 接続取得()
    try:
        conn.execute(
            f"""
            UPDATE "{依頼テーブル}"
               SET 開始日時 = ?, 実行回数 = 1, 更新日時 = ?
             WHERE 依頼ID = ? AND 状態 = '準備中'
            """,
            [now, now, 依頼ID],
        )
        conn.commit()
    finally:
        conn.close()
    return 依頼取得(str(データ["要員ID"]), 依頼ID) or 項目


def 投入待ち一覧() -> list[dict]:
    """準備開始かつ未投入で、sub_initによるAIタスク登録を待つ依頼を返す。"""
    初期化()
    conn = 接続取得()
    try:
        rows = conn.execute(
            f"""
            SELECT 依頼ID, 要員ID, プロジェクト, タイトル, 要求内容,
                   {_AI設定列SQL},
                   実行有効, 状態, PID, 実行回数
              FROM "{依頼テーブル}"
             WHERE 状態 = '準備開始'
               AND PID = ''
               AND タスクID = ''
             ORDER BY 依頼ID
            """
        ).fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()


def 依頼確保(依頼ID: str) -> bool:
    """準備開始の1件を準備中へ進めて確保し、sub_initの二重起動を防ぐ。"""
    初期化()
    now = _現在日時()
    conn = 接続取得()
    try:
        cursor = conn.execute(
            f"""
            UPDATE "{依頼テーブル}"
               SET 状態 = '準備中', PID = 'CLAIM',
                   開始日時 = ?, 終了日時 = '', 実行回数 = 実行回数 + 1,
                   応答タイトル = '', 応答内容 = '',
                   更新日時 = ?, 更新利用者ID = 'system',
                   更新利用者名 = 'システム', 更新端末ID = 'backend_team'
             WHERE 依頼ID = ?
               AND 状態 = '準備開始'
               AND PID = ''
               AND タスクID = ''
            """,
            [now, now, 依頼ID],
        )
        conn.commit()
        return cursor.rowcount == 1
    finally:
        conn.close()


def 実行開始記録(依頼ID: str, pid: int) -> None:
    """CLAIM中の依頼へsub_initのPIDを記録する。先に完了した場合は上書きしない。"""
    now = _現在日時()
    conn = 接続取得()
    try:
        conn.execute(
            f"""
            UPDATE "{依頼テーブル}"
               SET PID = ?, 更新日時 = ?
             WHERE 依頼ID = ?
               AND 状態 = '準備中' AND PID = 'CLAIM'
            """,
            [str(pid), now, 依頼ID],
        )
        conn.commit()
    finally:
        conn.close()


def 準備停止確保(依頼ID: str) -> bool:
    """遅れて届くタスク投入より先に停止を確定する。"""
    conn = 接続取得()
    try:
        cursor = conn.execute(
            f"UPDATE {依頼テーブル} SET 状態='中止', 実行有効=0, PID='', 終了日時=?, 更新日時=? "
            "WHERE 依頼ID=? AND 状態 IN ('準備開始','準備中')",
            [_現在日時(), _現在日時(), 依頼ID],
        )
        conn.commit()
        return cursor.rowcount == 1
    finally:
        conn.close()


def 投入成功記録(依頼ID: str, タスクID: str) -> None:
    """aidiy_task_agentsへの投入成功を依頼行へ反映する。"""
    now = _現在日時()
    conn = 接続取得()
    try:
        cursor = conn.execute(
            f"""
            UPDATE "{依頼テーブル}"
               SET タスクID = ?, 状態 = '準備完了', PID = '',
                   応答タイトル = 'AIタスク投入済み',
                   更新日時 = ?, 更新利用者ID = 'system',
                   更新利用者名 = 'システム', 更新端末ID = 'backend_team'
             WHERE 依頼ID = ? AND 状態 = '準備中'
            """,
            [タスクID, now, 依頼ID],
        )
        if cursor.rowcount != 1:
            raise KeyError(依頼ID)
        conn.commit()
    finally:
        conn.close()


def 投入失敗記録(依頼ID: str, メッセージ: str) -> None:
    """sub_initの起動またはタスク投入失敗をエラーとして記録する。"""
    now = _現在日時()
    conn = 接続取得()
    try:
        conn.execute(
            f"""
            UPDATE "{依頼テーブル}"
               SET 状態 = 'エラー', PID = '', 終了日時 = ?,
                   応答タイトル = 'AIタスク投入エラー', 応答内容 = ?,
                   更新日時 = ?, 更新利用者ID = 'system',
                   更新利用者名 = 'システム', 更新端末ID = 'backend_team'
             WHERE 依頼ID = ?
               AND 状態 = '準備中'
            """,
            [now, メッセージ[:2000], now, 依頼ID],
        )
        conn.commit()
    finally:
        conn.close()


def 残存PID一覧() -> list[dict]:
    """再起動時に整理するsub_init PIDを返す。"""
    初期化()
    conn = 接続取得()
    try:
        rows = conn.execute(
            f"""
            SELECT 依頼ID, 要員ID, PID
              FROM "{依頼テーブル}"
             WHERE PID != ''
            """
        ).fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()


def PID全クリア() -> int:
    """システム開始時: 未投入のまま残った依頼をエラーとして記録しクリアする。

    再起動時点でプロセスが生きているか判断できず、PID は OS に再利用され得るため
    強制停止はしない（別プロセスを誤って停止する恐れがあるため）。自動再実行はせずエラー化のみ行う。
    """
    now = _現在日時()
    conn = 接続取得()
    try:
        cursor = conn.execute(
            f"""
            UPDATE "{依頼テーブル}"
               SET 状態 = 'エラー', 実行有効 = 0, PID = '', 終了日時 = ?,
                   応答タイトル = 'システム再起動エラー', 応答内容 = 'システム再起動のため中断しました',
                   更新日時 = ?, 更新利用者ID = 'system',
                   更新利用者名 = 'システム', 更新端末ID = 'backend_team'
             WHERE PID != '' AND タスクID = ''
            """,
            [now, now],
        )
        conn.commit()
        return cursor.rowcount
    finally:
        conn.close()


def 依頼タイムアウト対象一覧(
    制限分: int = 無進捗タイムアウト分,
    準備制限分: int = 準備無進捗タイムアウト分,
) -> list[dict]:
    """開始してから制限分以上ひとつも進捗が無い依頼を返す。

    経過の起点は開始日時ではなく「開始日時と更新日時の新しい方」にする。開始日時だけを見ると
    AIタスク全体（明細生成 + 全ステップ実行 + 経験生成）の合計に制限をかけることになり、
    正常に進んでいる長時間の依頼まで打ち切ってしまうため。Task 処理は明細を1つ
    終えるたびに Aチーム依頼を更新する（tasks_db._Aチーム依頼反映）ので、
    進捗が続く限りここには載らない。

    制限分は状態で使い分ける。状態='準備中'（sub_init.py が担当要員を選んでAIタスクを
    投入している最中）は準備制限分、それ以外は制限分を使う。

    呼び出し側で PID のプロセスを停止してから 依頼タイムアウト対象エラー化() でエラー化する。
    """
    初期化()
    conn = 接続取得()
    try:
        閾値 = (datetime.now() - timedelta(minutes=制限分)).strftime("%Y-%m-%d %H:%M:%S")
        準備閾値 = (datetime.now() - timedelta(minutes=準備制限分)).strftime("%Y-%m-%d %H:%M:%S")
        rows = conn.execute(
            f"""
            SELECT 依頼ID, 要員ID, 状態, PID, 開始日時, 更新日時,
                   MAX(開始日時, 更新日時) AS 最終進捗日時
              FROM "{依頼テーブル}"
             WHERE 開始日時 != '' AND 終了日時 = '' AND 状態 != 'エラー'
               AND MAX(開始日時, 更新日時) <= (CASE WHEN 状態 = '準備中' THEN ? ELSE ? END)
            """,
            [準備閾値, 閾値],
        ).fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()


def 依頼タイムアウト対象エラー化(対象一覧: list[dict]) -> int:
    """タイムアウト対象を 状態='エラー'・実行有効=0・PID='' にする。"""
    if not 対象一覧:
        return 0
    初期化()
    now = _現在日時()
    conn = 接続取得()
    try:
        更新件数 = 0
        for 行 in 対象一覧:
            依頼ID = str(行.get("依頼ID", ""))
            PID = str(行.get("PID", ""))
            開始日時 = str(行.get("開始日時", ""))
            更新日時 = str(行.get("更新日時", ""))
            if not 依頼ID:
                continue
            # 一覧を取ってからここまでの間に進捗（更新日時の変化）があれば打ち切らない
            cursor = conn.execute(
                f"""
                UPDATE "{依頼テーブル}"
                   SET 状態 = 'エラー', 実行有効 = 0, PID = '', 終了日時 = ?,
                       応答タイトル = '無進捗タイムアウト', 更新日時 = ?
                 WHERE 依頼ID = ?
                   AND 状態 != 'エラー' AND 終了日時 = '' AND PID = ?
                   AND 開始日時 = ? AND 更新日時 = ?
                """,
                [now, now, 依頼ID, PID, 開始日時, 更新日時],
            )
            更新件数 += cursor.rowcount
        conn.commit()
        return 更新件数
    finally:
        conn.close()
