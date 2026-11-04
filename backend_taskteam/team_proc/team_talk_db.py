# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""Aチーム会話の DB アクセス。

雑談エリアの要員から選んだ1名の発言を、team_watcher.py の1分ごとの確認（雑談確認）から
sub_self_talk.py 経由で書き込む。登録経路はこれのみで、フロントエンドからの直接登録は無い。
"""

from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta

from .team_db import DB_PATH, 接続取得

会話テーブル = "Aチーム会話"
一覧最大件数 = 100


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


def _テーブル作成(conn: sqlite3.Connection) -> None:
    conn.execute(f"""
        CREATE TABLE IF NOT EXISTS "{会話テーブル}" (
            プロジェクト TEXT NOT NULL,
            要員ID TEXT NOT NULL,
            要求内容 TEXT NOT NULL DEFAULT '',
            発言内容 TEXT NOT NULL DEFAULT '',
            登録日時 TEXT NOT NULL,
            登録利用者ID TEXT NOT NULL,
            登録利用者名 TEXT NOT NULL,
            登録端末ID TEXT NOT NULL,
            更新日時 TEXT NOT NULL,
            更新利用者ID TEXT NOT NULL,
            更新利用者名 TEXT NOT NULL,
            更新端末ID TEXT NOT NULL,
            PRIMARY KEY (プロジェクト, 要員ID)
        )
    """)


def _次更新日時(conn: sqlite3.Connection, プロジェクト: str, 要員ID: str) -> str:
    """同じ秒の連続更新でもポーリングが検知できるよう、更新日時を必ず増加させる。"""
    now = datetime.now().replace(microsecond=0)
    row = conn.execute(
        f'SELECT 更新日時 FROM "{会話テーブル}" WHERE プロジェクト = ? AND 要員ID = ?',
        [プロジェクト, 要員ID],
    ).fetchone()
    if row and row["更新日時"]:
        try:
            前回 = datetime.fromisoformat(str(row["更新日時"]))
            if now <= 前回:
                now = 前回 + timedelta(seconds=1)
        except ValueError:
            pass
    return now.strftime("%Y-%m-%d %H:%M:%S")


def 初期化() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = 接続取得()
    try:
        _テーブル作成(conn)
        conn.execute(f"""
            CREATE INDEX IF NOT EXISTS "IX_Aチーム会話_プロジェクト"
            ON "{会話テーブル}" (プロジェクト, 更新日時)
        """)
        conn.commit()
    finally:
        conn.close()


def 会話クリア(プロジェクト: str = "") -> int:
    """指定プロジェクトの会話を削除する。プロジェクトが空なら全件削除する。"""
    初期化()
    conn = 接続取得()
    try:
        if プロジェクト:
            cursor = conn.execute(
                f'DELETE FROM "{会話テーブル}" WHERE プロジェクト = ?',
                [プロジェクト],
            )
        else:
            cursor = conn.execute(f'DELETE FROM "{会話テーブル}"')
        conn.commit()
        return max(0, int(cursor.rowcount))
    finally:
        conn.close()


def 起動時クリア() -> int:
    """backend_taskteam 起動時、Aチーム会話を全件削除する（会話はその場限りの表示用のため引き継がない）。"""
    return 会話クリア()


def 会話一覧(プロジェクト: str = "", 件数: int = 一覧最大件数) -> list[dict]:
    """要員ごとの最終発言を新しい順で返す。"""
    初期化()
    conn = 接続取得()
    try:
        条件 = " WHERE プロジェクト = ?" if プロジェクト else ""
        params: list = [プロジェクト] if プロジェクト else []
        params.append(max(1, int(件数)))
        rows = conn.execute(
            f"""
            SELECT プロジェクト, 要員ID, 要求内容, 発言内容, 登録日時, 更新日時
              FROM "{会話テーブル}"{条件}
             ORDER BY 更新日時 DESC, 要員ID
             LIMIT ?
            """,
            params,
        ).fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()


def 会話取得(プロジェクト: str, 要員ID: str) -> dict | None:
    初期化()
    conn = 接続取得()
    try:
        row = conn.execute(
            f'SELECT * FROM "{会話テーブル}" WHERE プロジェクト = ? AND 要員ID = ?',
            [プロジェクト, 要員ID],
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def 発言状況一覧(プロジェクト: str) -> dict[str, str]:
    """要員IDごとの最終発言日時（発言内容が入っている行の更新日時）を返す。

    team_watcher.py の雑談確認が、次の発言者（未発言優先、全員発言済みなら最古の発言者）を
    選ぶために使う。空の発言（発言シーケンスに入っただけの行）は対象にしない。
    """
    初期化()
    conn = 接続取得()
    try:
        rows = conn.execute(
            f"""
            SELECT 要員ID, 更新日時 AS 最終発言日時
              FROM "{会話テーブル}"
             WHERE プロジェクト = ? AND 発言内容 != ''
            """,
            [プロジェクト],
        ).fetchall()
        return {str(row["要員ID"]): str(row["最終発言日時"]) for row in rows}
    finally:
        conn.close()


def 発言中あり(プロジェクト: str = "") -> bool:
    """発言内容が空の行（sub_self_talk.py の応答待ち）が1件でもあれば True を返す。"""
    初期化()
    conn = 接続取得()
    try:
        条件 = " AND プロジェクト = ?" if プロジェクト else ""
        row = conn.execute(
            f"""
            SELECT 1
              FROM "{会話テーブル}"
             WHERE 発言内容 = ''{条件}
             LIMIT 1
            """,
            [プロジェクト] if プロジェクト else [],
        ).fetchone()
        return row is not None
    finally:
        conn.close()


def 最新発言一覧(プロジェクト: str) -> list[dict]:
    """要員ごとの最終発言を返す。「他者意見」として次の発言者へ渡す。"""
    初期化()
    conn = 接続取得()
    try:
        rows = conn.execute(
            f"""
            SELECT プロジェクト, 要員ID, 要求内容, 発言内容, 登録日時, 更新日時
              FROM "{会話テーブル}"
             WHERE プロジェクト = ? AND 発言内容 != ''
             ORDER BY 更新日時 DESC, 要員ID
            """,
            [プロジェクト],
        ).fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()


def 発言登録(プロジェクト: str, 要員ID: str, 操作者: dict) -> dict:
    """対象要員の1行を空にして発言中とし、完了後に発言更新で最終発言を書き戻す。"""
    初期化()
    監査 = _監査項目(操作者["利用者ID"], 操作者["利用者名"], 操作者["端末ID"])
    conn = 接続取得()
    try:
        conn.execute(
            f"""
            INSERT INTO "{会話テーブル}" (
                プロジェクト, 要員ID, 要求内容, 発言内容,
                登録日時, 登録利用者ID, 登録利用者名, 登録端末ID,
                更新日時, 更新利用者ID, 更新利用者名, 更新端末ID
            ) VALUES (?, ?, '', '', ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(プロジェクト, 要員ID) DO UPDATE SET
                要求内容 = '', 発言内容 = '',
                更新日時 = excluded.更新日時,
                更新利用者ID = excluded.更新利用者ID,
                更新利用者名 = excluded.更新利用者名,
                更新端末ID = excluded.更新端末ID
            """,
            (
                プロジェクト, 要員ID,
                監査["登録日時"], 監査["登録利用者ID"], 監査["登録利用者名"], 監査["登録端末ID"],
                監査["更新日時"], 監査["更新利用者ID"], 監査["更新利用者名"], 監査["更新端末ID"],
            ),
        )
        conn.commit()
    finally:
        conn.close()
    return 会話取得(プロジェクト, 要員ID) or {}


def 要求内容更新(プロジェクト: str, 要員ID: str, 要求内容: str) -> None:
    """AI起動前に要求内容だけを書き込み、発言内容が空の処理中状態は維持する。"""
    初期化()
    conn = 接続取得()
    try:
        now = _次更新日時(conn, プロジェクト, 要員ID)
        conn.execute(
            f"""
            UPDATE "{会話テーブル}"
               SET 要求内容 = ?,
                   更新日時 = ?, 更新利用者ID = 'system',
                   更新利用者名 = 'システム', 更新端末ID = 'backend_team'
             WHERE プロジェクト = ? AND 要員ID = ?
            """,
            [要求内容, now, プロジェクト, 要員ID],
        )
        conn.commit()
    finally:
        conn.close()


def 発言更新(プロジェクト: str, 要員ID: str, 要求内容: str, 発言内容: str) -> None:
    """プロジェクト・要員IDの行へ、実際に送った依頼内容と最終発言を書き戻す。"""
    初期化()
    conn = 接続取得()
    try:
        now = _次更新日時(conn, プロジェクト, 要員ID)
        conn.execute(
            f"""
            UPDATE "{会話テーブル}"
               SET 要求内容 = ?, 発言内容 = ?,
                   更新日時 = ?, 更新利用者ID = 'system',
                   更新利用者名 = 'システム', 更新端末ID = 'backend_team'
             WHERE プロジェクト = ? AND 要員ID = ?
            """,
            [要求内容, 発言内容, now, プロジェクト, 要員ID],
        )
        conn.commit()
    finally:
        conn.close()


def 会話最大更新日時(プロジェクト: str = "") -> str:
    """一覧の再取得判定に使う最大更新日時を返す。"""
    初期化()
    conn = 接続取得()
    try:
        条件 = " WHERE プロジェクト = ?" if プロジェクト else ""
        row = conn.execute(
            f'SELECT MAX(更新日時) AS 最大更新日時 FROM "{会話テーブル}"{条件}',
            [プロジェクト] if プロジェクト else [],
        ).fetchone()
        return str(row["最大更新日時"] or "") if row else ""
    finally:
        conn.close()
