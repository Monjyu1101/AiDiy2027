# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""Aチーム経験の DB アクセス。

完了した Aチーム依頼（＋紐づく Aタスク要求も完了）1 件につき経験 1 件を作る。
1) 状態監視ループ（1分ごと）が 開始日時 だけ入れて仮登録する
2) team_sub/sub_exp.py が AI に経験値を JSON 出力させる
3) その結果を本登録として書き戻す
"""

from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta

from .team_db import DB_PATH, 接続取得

経験テーブル = "Aチーム経験"
依頼テーブル = "Aチーム依頼"
タスク要求テーブル = "Aタスク要求"
状態一覧 = ("生成中", "完了", "エラー")
対象時間 = 1  # 完了からこの時間内（時間）の依頼を経験化する
生成タイムアウト分 = 30
一覧最大件数 = 100

_採番テーブル = "C採番"
_採番ID = "Aチーム経験"
_採番プレフィックス = "TE"
_採番初期値 = 1000


def _現在日時() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _監査項目(利用者ID: str, 利用者名: str, 端末ID: str) -> dict[str, str]:
    now = _現在日時()
    return {
        "登録日時": now,
        "登録利用者ID": 利用者ID,
        "登録利用者名": 利用者名,
        "登録端末ID": 端末ID,
        "更新日時": now,
        "更新利用者ID": 利用者ID,
        "更新利用者名": 利用者名,
        "更新端末ID": 端末ID,
    }


def 初期化() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = 接続取得()
    try:
        conn.execute(f"""
            CREATE TABLE IF NOT EXISTS "{経験テーブル}" (
                経験ID TEXT NOT NULL PRIMARY KEY,
                依頼ID TEXT NOT NULL UNIQUE,
                タスクID TEXT NOT NULL DEFAULT '',
                要員ID TEXT NOT NULL DEFAULT '',
                プロジェクト TEXT NOT NULL DEFAULT '',
                タスクタイトル TEXT NOT NULL DEFAULT '',
                要求内容 TEXT NOT NULL DEFAULT '',
                実行応答内容 TEXT NOT NULL DEFAULT '',
                完了日時 TEXT NOT NULL DEFAULT '',
                タイトル TEXT NOT NULL DEFAULT '',
                経験値 INTEGER NOT NULL DEFAULT 0,
                分類 TEXT NOT NULL DEFAULT '',
                まとめ内容 TEXT NOT NULL DEFAULT '',
                学び TEXT NOT NULL DEFAULT '',
                状態 TEXT NOT NULL DEFAULT '生成中',
                PID TEXT NOT NULL DEFAULT '',
                開始日時 TEXT NOT NULL DEFAULT '',
                終了日時 TEXT NOT NULL DEFAULT '',
                エラー内容 TEXT NOT NULL DEFAULT '',
                登録日時 TEXT NOT NULL,
                登録利用者ID TEXT NOT NULL,
                登録利用者名 TEXT NOT NULL,
                登録端末ID TEXT NOT NULL,
                更新日時 TEXT NOT NULL,
                更新利用者ID TEXT NOT NULL,
                更新利用者名 TEXT NOT NULL,
                更新端末ID TEXT NOT NULL
            )
        """)
        conn.execute(f"""
            CREATE INDEX IF NOT EXISTS "IX_Aチーム経験_要員"
            ON "{経験テーブル}" (要員ID, 更新日時)
        """)
        conn.execute(f"""
            CREATE INDEX IF NOT EXISTS "IX_Aチーム経験_プロジェクト"
            ON "{経験テーブル}" (プロジェクト, 完了日時)
        """)
        conn.commit()
    finally:
        conn.close()


def _採番確保(conn: sqlite3.Connection) -> None:
    """C採番（backend_server共有）にAチーム経験用の採番行が無ければ作成する。"""
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
        [_採番ID, _採番初期値, "AIチーム経験の採番（TE）", now, now],
    )


def _新規経験ID(conn: sqlite3.Connection) -> str:
    _採番確保(conn)
    conn.execute(
        f'UPDATE "{_採番テーブル}" SET 最終採番値 = 最終採番値 + 1 WHERE 採番ID = ?',
        [_採番ID],
    )
    行 = conn.execute(
        f'SELECT 最終採番値 FROM "{_採番テーブル}" WHERE 採番ID = ?', [_採番ID]
    ).fetchone()
    return f"{_採番プレフィックス}{行[0]:08d}"


def 経験対象一覧() -> list[dict]:
    """経験化の対象を返す。

    条件は次のすべて。
    - Aチーム依頼が 状態='完了' で、更新日時が 対象時間 以内
    - 紐づく Aタスク要求（タスクID一致）も 状態='完了'
    - Aチーム経験に同じ依頼IDが未登録

    要員IDは「実際に実行した」Aタスク要求の利用者IDを採る。
    Aチーム依頼の要員IDは依頼元で、sub_init が AI に選ばせた担当者とは異なることがあるため。
    """
    初期化()
    conn = 接続取得()
    try:
        閾値 = (datetime.now() - timedelta(hours=対象時間)).strftime("%Y-%m-%d %H:%M:%S")
        rows = conn.execute(
            f"""
            SELECT w.依頼ID, w.タスクID, w.プロジェクト, w.要求内容,
                   w.TEAM_AI_NAME, w.TASK_AI_NAME, w.更新日時,
                   w.要員ID AS 依頼元要員ID,
                   r.利用者ID AS 要員ID,
                   r.タイトル AS タスクタイトル,
                   r.応答内容 AS 実行応答内容,
                   r.終了日時 AS 完了日時
              FROM "{依頼テーブル}" w
              JOIN "{タスク要求テーブル}" r ON r.タスクID = w.タスクID
             WHERE w.状態 = '完了'
               AND w.更新日時 >= ?
               AND w.タスクID != ''
               AND r.状態 = '完了'
               AND NOT EXISTS (SELECT 1 FROM "{経験テーブル}" e WHERE e.依頼ID = w.依頼ID)
             ORDER BY w.更新日時
            """,
            [閾値],
        ).fetchall()
        return [dict(row) for row in rows]
    except sqlite3.OperationalError as exc:
        # Aタスク要求テーブルが未作成（Task 処理の初期化前）のときだけ対象なし扱いにする。
        # 列不足などのスキーマ不整合は黙って隠さず、呼び出し側のログへ出す。
        if "no such table" in str(exc):
            return []
        raise
    finally:
        conn.close()


def 経験取得(経験ID: str) -> dict | None:
    初期化()
    conn = 接続取得()
    try:
        row = conn.execute(
            f'SELECT * FROM "{経験テーブル}" WHERE 経験ID = ?', [経験ID]
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def _絞り込み条件(プロジェクト: str, 要員ID: str) -> tuple[str, list]:
    条件: list[str] = []
    params: list = []
    if プロジェクト:
        条件.append("プロジェクト = ?")
        params.append(プロジェクト)
    if 要員ID:
        条件.append("要員ID = ?")
        params.append(要員ID)
    return (" WHERE " + " AND ".join(条件) if 条件 else ""), params


def 経験一覧(プロジェクト: str = "", 要員ID: str = "", 件数: int = 一覧最大件数) -> list[dict]:
    """経験の一覧を完了日時の新しい順で返す。

    プロジェクト（CODE_BASE_PATH）や要員IDを指定した分だけに絞る。
    画面表示に必要な値はこのテーブルの列だけで足りる（他テーブル参照なし）。
    """
    初期化()
    conn = 接続取得()
    try:
        条件, params = _絞り込み条件(プロジェクト, 要員ID)
        sql = f"""
            SELECT 経験ID, 依頼ID, タスクID, 要員ID, プロジェクト,
                   タスクタイトル, 要求内容, 実行応答内容, 完了日時,
                   タイトル, 経験値, 分類, まとめ内容, 学び,
                   状態, 開始日時, 終了日時, エラー内容, 更新日時
              FROM "{経験テーブル}"{条件}
             ORDER BY CASE WHEN 完了日時 = '' THEN 1 ELSE 0 END,
                      完了日時 DESC, 更新日時 DESC, 経験ID DESC
             LIMIT ?
        """
        params.append(max(1, int(件数)))
        return [dict(row) for row in conn.execute(sql, params).fetchall()]
    finally:
        conn.close()


def 経験最大更新日時(プロジェクト: str = "", 要員ID: str = "") -> str:
    """一覧の再取得判定に使う最大更新日時を返す。"""
    初期化()
    conn = 接続取得()
    try:
        条件, params = _絞り込み条件(プロジェクト, 要員ID)
        row = conn.execute(
            f'SELECT MAX(更新日時) AS 最大更新日時 FROM "{経験テーブル}"{条件}', params
        ).fetchone()
        return str(row["最大更新日時"] or "") if row else ""
    finally:
        conn.close()


def 経験合計(プロジェクト: str = "", 要員ID: str = "") -> int:
    """完了した経験値の合計を返す（プロジェクト・要員で絞り込み可）。"""
    初期化()
    conn = 接続取得()
    try:
        条件, params = _絞り込み条件(プロジェクト, 要員ID)
        接続詞 = " AND " if 条件 else " WHERE "
        row = conn.execute(
            f'SELECT IFNULL(SUM(経験値), 0) AS 合計 FROM "{経験テーブル}"{条件}{接続詞}状態 = ?',
            [*params, "完了"],
        ).fetchone()
        return int(row["合計"]) if row else 0
    finally:
        conn.close()


def 要員別経験概要(プロジェクト: str = "", 要員件数: int = 5) -> list[dict]:
    """要員ごとの経験値合計と直近の経験を返す（担当要員の選択に渡す用）。

    プロジェクトを指定すると、そのプロジェクトの経験だけで集計する。
    """
    初期化()
    conn = 接続取得()
    try:
        条件, params = _絞り込み条件(プロジェクト, "")
        接続詞 = " AND " if 条件 else " WHERE "
        集計 = conn.execute(
            f"""
            SELECT 要員ID, SUM(経験値) AS 経験値合計, COUNT(*) AS 件数, MAX(完了日時) AS 最終完了日時
              FROM "{経験テーブル}"{条件}{接続詞}状態 = '完了' AND 要員ID != ''
             GROUP BY 要員ID
             ORDER BY 経験値合計 DESC
            """,
            [*params],
        ).fetchall()
        概要: list[dict] = []
        for 行 in 集計:
            要員ID = str(行["要員ID"])
            直近 = conn.execute(
                f"""
                SELECT タスクタイトル, 分類, 経験値, 学び, 完了日時
                  FROM "{経験テーブル}"
                 WHERE 要員ID = ? AND 状態 = '完了'
                   {"AND プロジェクト = ?" if プロジェクト else ""}
                 ORDER BY 完了日時 DESC, 経験ID DESC
                 LIMIT ?
                """,
                [要員ID, *( [プロジェクト] if プロジェクト else [] ), max(1, int(要員件数))],
            ).fetchall()
            概要.append({
                "要員ID": 要員ID,
                "経験値合計": int(行["経験値合計"] or 0),
                "件数": int(行["件数"] or 0),
                "最終完了日時": str(行["最終完了日時"] or ""),
                "直近": [dict(r) for r in 直近],
            })
        return 概要
    finally:
        conn.close()


def 経験仮登録(対象: dict) -> dict:
    """開始日時だけ入れて経験レコードを作る（状態=生成中）。

    同じ依頼IDが既にあれば None ではなく空 dict を返す（UNIQUE 制約で二重登録を防ぐ）。
    """
    初期化()
    now = _現在日時()
    監査 = _監査項目("system", "システム", "backend_team")
    conn = 接続取得()
    try:
        経験ID = _新規経験ID(conn)
        conn.execute(
            f"""
            INSERT INTO "{経験テーブル}" (
                経験ID, 依頼ID, タスクID, 要員ID, プロジェクト,
                タスクタイトル, 要求内容, 実行応答内容, 完了日時,
                状態, PID, 開始日時,
                登録日時, 登録利用者ID, 登録利用者名, 登録端末ID,
                更新日時, 更新利用者ID, 更新利用者名, 更新端末ID
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '生成中', 'CLAIM', ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                経験ID,
                str(対象["依頼ID"]),
                str(対象.get("タスクID", "")),
                str(対象.get("要員ID", "")),
                str(対象.get("プロジェクト", "")),
                str(対象.get("タスクタイトル", "")),
                str(対象.get("要求内容", "")),
                str(対象.get("実行応答内容", "")),
                str(対象.get("完了日時", "")),
                now,
                監査["登録日時"], 監査["登録利用者ID"], 監査["登録利用者名"], 監査["登録端末ID"],
                監査["更新日時"], 監査["更新利用者ID"], 監査["更新利用者名"], 監査["更新端末ID"],
            ),
        )
        conn.commit()
    except sqlite3.IntegrityError:
        # 既に他プロセスが登録済み
        return {}
    finally:
        conn.close()
    return 経験取得(経験ID) or {}


def 生成開始記録(経験ID: str, pid: int) -> None:
    """CLAIM 中の経験へ sub_exp の PID を記録する。"""
    now = _現在日時()
    conn = 接続取得()
    try:
        conn.execute(
            f"""
            UPDATE "{経験テーブル}"
               SET PID = ?, 更新日時 = ?
             WHERE 経験ID = ? AND 状態 = '生成中' AND PID = 'CLAIM'
            """,
            [str(pid), now, 経験ID],
        )
        conn.commit()
    finally:
        conn.close()


def 経験本登録(経験ID: str, データ: dict) -> dict:
    """AI が出力した経験値を書き戻し、元の依頼・作業を「済」にする。"""
    初期化()
    now = _現在日時()
    まとめ内容 = str(データ.get("まとめ内容", ""))
    conn = 接続取得()
    try:
        対象 = conn.execute(
            f'SELECT 依頼ID FROM "{経験テーブル}" WHERE 経験ID = ?',
            [経験ID],
        ).fetchone()
        if 対象 is None:
            raise KeyError(経験ID)
        依頼ID = str(対象["依頼ID"] or "")
        conn.execute(
            f"""
            UPDATE "{経験テーブル}"
               SET タイトル = ?, 経験値 = ?, 分類 = ?, まとめ内容 = ?, 学び = ?,
                   状態 = '完了', PID = '', 終了日時 = ?, エラー内容 = '',
                   更新日時 = ?, 更新利用者ID = 'system', 更新利用者名 = 'システム',
                   更新端末ID = 'backend_team'
             WHERE 経験ID = ?
            """,
            (
                str(データ.get("タイトル", ""))[:120],
                int(データ.get("経験値", 0) or 0),
                str(データ.get("分類", ""))[:40],
                まとめ内容,
                str(データ.get("学び", "")),
                now,
                now,
                経験ID,
            ),
        )
        conn.execute(
            f"""
            UPDATE "{依頼テーブル}"
               SET 状態 = '済', PID = '', まとめ内容 = ?,
                   更新日時 = ?, 更新利用者ID = 'system', 更新利用者名 = 'システム',
                   更新端末ID = 'backend_team'
             WHERE 依頼ID = ? AND 状態 = '完了'
            """,
            [まとめ内容, now, 依頼ID],
        )
        conn.execute(
            """
            UPDATE "Aチーム作業"
               SET 状況 = '済', 終了日時 = ?, まとめ内容 = ?,
                   更新日時 = ?, 更新利用者ID = 'system', 更新利用者名 = 'システム',
                   更新端末ID = 'backend_team'
             WHERE 依頼ID = ? AND 状況 = '完了'
            """,
            [now, まとめ内容, now, 依頼ID],
        )
        conn.commit()
    finally:
        conn.close()
    return 経験取得(経験ID) or {}


def 経験失敗記録(経験ID: str, メッセージ: str) -> None:
    now = _現在日時()
    conn = 接続取得()
    try:
        conn.execute(
            f"""
            UPDATE "{経験テーブル}"
               SET 状態 = 'エラー', PID = '', 終了日時 = ?, エラー内容 = ?,
                   更新日時 = ?, 更新利用者ID = 'system', 更新利用者名 = 'システム',
                   更新端末ID = 'backend_team'
             WHERE 経験ID = ?
            """,
            [now, メッセージ[:2000], now, 経験ID],
        )
        conn.commit()
    finally:
        conn.close()


def 生成中一覧() -> list[dict]:
    """PID が入ったままの生成中レコードを返す（再起動時の整理用）。"""
    初期化()
    conn = 接続取得()
    try:
        rows = conn.execute(
            f'SELECT 経験ID, 依頼ID, PID FROM "{経験テーブル}" WHERE 状態 = \'生成中\' AND PID != \'\''
        ).fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()


def 生成中をエラー化(メッセージ: str) -> int:
    """システム開始時: 生成途中で残ったレコードをエラーにする。"""
    初期化()
    now = _現在日時()
    conn = 接続取得()
    try:
        cursor = conn.execute(
            f"""
            UPDATE "{経験テーブル}"
               SET 状態 = 'エラー', PID = '', 終了日時 = ?, エラー内容 = ?,
                   更新日時 = ?, 更新利用者ID = 'system', 更新利用者名 = 'システム',
                   更新端末ID = 'backend_team'
             WHERE 状態 = '生成中'
            """,
            [now, メッセージ[:2000], now],
        )
        conn.commit()
        return cursor.rowcount
    finally:
        conn.close()


def 生成タイムアウト対象一覧(制限分: int = 生成タイムアウト分) -> list[dict]:
    """開始から制限分以上たっても生成中のままのレコードを返す。"""
    初期化()
    conn = 接続取得()
    try:
        閾値 = (datetime.now() - timedelta(minutes=制限分)).strftime("%Y-%m-%d %H:%M:%S")
        rows = conn.execute(
            f"""
            SELECT 経験ID, 依頼ID, PID, 開始日時
              FROM "{経験テーブル}"
             WHERE 状態 = '生成中' AND 開始日時 != '' AND 開始日時 <= ?
            """,
            [閾値],
        ).fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()
