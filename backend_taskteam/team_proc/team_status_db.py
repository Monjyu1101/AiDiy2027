# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""Aチーム状況の読取専用アクセス。

Aチーム状況は Task 処理側（状態監視ループ、10秒間隔）が
有効なAチーム要員×実行有効なAタスク要求（24時間以内更新）を要員IDで集計して
作り直しているテーブル。Team 処理はここでは読み取るだけで、書き込みは行わない。
"""

from __future__ import annotations

import sqlite3

from .team_db import DB_PATH

状況テーブル = "Aチーム状況"
状況元テーブル = ("Aチーム要員", "Aチーム依頼", "Aチーム経験", "Aチーム作業")


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


def _テーブル確保(conn: sqlite3.Connection) -> None:
    """Task 処理がまだ一度も更新していない場合に備え、空テーブルとして用意する。"""
    conn.execute(f"""
        CREATE TABLE IF NOT EXISTS "{状況テーブル}" (
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
    conn.commit()


def 実行中要員数() -> int:
    """実行数（準備中・実行中のAタスク要求）が1件以上ある要員の人数を返す。

    0 ならチーム全体が空き時間と判断できる（作業ループの投入条件）。
    """
    conn = 接続取得()
    try:
        _テーブル確保(conn)
        row = conn.execute(
            f'SELECT COUNT(*) AS 人数 FROM "{状況テーブル}" WHERE 実行数 > 0'
        ).fetchone()
        return int(row["人数"]) if row else 0
    finally:
        conn.close()

def 状況一覧() -> list[dict]:
    conn = 接続取得()
    try:
        _テーブル確保(conn)
        rows = conn.execute(
            f'SELECT 要員ID, 要員名, 最終更新日時, 経験最終更新日時, '
            f'待機数, 実行数, まとめ中数, 完了数, エラー数, 更新日時 '
            f'FROM "{状況テーブル}" ORDER BY 要員ID'
        ).fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()


def _テーブル最大更新日時(conn: sqlite3.Connection, テーブル名: str) -> str:
    """存在するテーブルの最大更新日時を返す。未作成なら空文字を返す。"""
    exists = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
        [テーブル名],
    ).fetchone()
    if not exists:
        return ""
    row = conn.execute(
        f'SELECT MAX(更新日時) AS 最大更新日時 FROM "{テーブル名}"'
    ).fetchone()
    return str(row["最大更新日時"] or "") if row else ""


def 状況最大更新日時() -> str:
    """状況一覧の変更判定に使う、元データ4テーブルの最大更新日時を返す。

    Aチーム状況は Task 処理が10秒ごとに全件再生成するため、その更新日時を
    変更判定に使うと元データが不変でも毎回変化してしまう。
    """
    conn = 接続取得()
    try:
        return max(
            (_テーブル最大更新日時(conn, テーブル名) for テーブル名 in 状況元テーブル),
            default="",
        )
    finally:
        conn.close()
