# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""Aチーム要員の DB アクセス。"""

from __future__ import annotations

import sqlite3
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATABASE_PATH = "../_data/AiDiy/database.db"
DB_PATH = (PROJECT_ROOT / "backend_server" / DEFAULT_DATABASE_PATH).resolve()
要員テーブル = "Aチーム要員"
管理者要員ID = "admin"

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
    """テーブル作成を行う。多重呼び出し可。"""
    # CREATE TABLE / CREATE TRIGGER は IF NOT EXISTS でも書き込みロックを取るため、
    # 毎回呼ぶと "database is locked" を招く。プロセス内で一度成功したら以降は何もしない。
    global _初期化済み
    if _初期化済み:
        return
    conn = 接続取得()
    try:
        conn.execute(f"""
            CREATE TABLE IF NOT EXISTS "{要員テーブル}" (
                要員ID TEXT NOT NULL PRIMARY KEY,
                要員名 TEXT NOT NULL,
                役割 TEXT NOT NULL DEFAULT '',
                人格情報 TEXT NOT NULL DEFAULT '',
                有効 INTEGER NOT NULL DEFAULT 1,
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
            CREATE TRIGGER IF NOT EXISTS "Aチーム要員_admin削除禁止"
            BEFORE DELETE ON "{要員テーブル}"
            WHEN OLD.要員ID = '{管理者要員ID}'
            BEGIN
                SELECT RAISE(ABORT, 'admin要員は削除できません');
            END
        """)
        conn.execute(f"""
            CREATE TRIGGER IF NOT EXISTS "Aチーム要員_admin無効化禁止"
            BEFORE UPDATE OF 有効 ON "{要員テーブル}"
            WHEN OLD.要員ID = '{管理者要員ID}' AND NEW.有効 = 0
            BEGIN
                SELECT RAISE(ABORT, 'admin要員は無効化できません');
            END
        """)
        conn.commit()
        _初期化済み = True
    finally:
        conn.close()


初期要員ID一覧 = ("admin", "MELCHIOR", "BALTHASAR", "CASPER")


def 初期要員を召喚() -> None:
    """起動時、要員が1名も登録されていなければpersonaの最新値で初期メンバーを召喚登録する。"""
    初期化()
    if 要員一覧(無効も表示=True):
        return
    from . import persona_catalog

    操作者 = {"利用者ID": "system", "利用者名": "システム", "端末ID": "backend_team"}
    for 要員ID in 初期要員ID一覧:
        要員 = persona_catalog.召喚要員取得(要員ID)
        if 要員 is not None:
            要員召喚登録(要員, 操作者)


def 要員一覧(無効も表示: bool = False) -> list[dict]:
    初期化()
    sql = f'SELECT * FROM "{要員テーブル}"'
    params: list = []
    if not 無効も表示:
        sql += " WHERE 有効 = ?"
        params.append(1)
    sql += " ORDER BY CASE WHEN 要員ID = 'admin' THEN 0 ELSE 1 END, 要員ID"
    conn = 接続取得()
    try:
        return [dict(row) for row in conn.execute(sql, params).fetchall()]
    finally:
        conn.close()


def 要員取得(要員ID: str) -> dict | None:
    初期化()
    conn = 接続取得()
    try:
        row = conn.execute(
            f'SELECT * FROM "{要員テーブル}" WHERE 要員ID = ?', [要員ID]
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def 要員登録(要員データ: dict, 操作者: dict) -> dict:
    初期化()
    監査 = _監査項目(操作者["利用者ID"], 操作者["利用者名"], 操作者["端末ID"])
    conn = 接続取得()
    try:
        try:
            conn.execute(
                f"""
                INSERT INTO "{要員テーブル}" (
                    要員ID, 要員名, 役割, 人格情報, 有効,
                    登録日時, 登録利用者ID, 登録利用者名, 登録端末ID,
                    更新日時, 更新利用者ID, 更新利用者名, 更新端末ID
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    要員データ["要員ID"], 要員データ["要員名"], 要員データ["役割"], 要員データ["人格情報"], int(要員データ["有効"]),
                    監査["登録日時"], 監査["登録利用者ID"], 監査["登録利用者名"], 監査["登録端末ID"],
                    監査["更新日時"], 監査["更新利用者ID"], 監査["更新利用者名"], 監査["更新端末ID"],
                ),
            )
            conn.commit()
        except sqlite3.IntegrityError as exc:
            raise ValueError("同じ要員IDが既に登録されています") from exc
    finally:
        conn.close()
    return 要員取得(要員データ["要員ID"]) or {}


def 要員変更(要員データ: dict, 操作者: dict) -> dict:
    初期化()
    if 要員データ["要員ID"] == 管理者要員ID and not 要員データ["有効"]:
        raise ValueError("admin要員は無効化できません")
    if 要員取得(要員データ["要員ID"]) is None:
        raise KeyError(要員データ["要員ID"])
    now = _現在日時()
    conn = 接続取得()
    try:
        conn.execute(
            f"""
            UPDATE "{要員テーブル}"
               SET 要員名 = ?, 役割 = ?, 人格情報 = ?, 有効 = ?,
                   更新日時 = ?, 更新利用者ID = ?, 更新利用者名 = ?, 更新端末ID = ?
             WHERE 要員ID = ?
            """,
            (
                要員データ["要員名"], 要員データ["役割"], 要員データ["人格情報"], int(要員データ["有効"]),
                now, 操作者["利用者ID"], 操作者["利用者名"], 操作者["端末ID"], 要員データ["要員ID"],
            ),
        )
        conn.commit()
    finally:
        conn.close()
    return 要員取得(要員データ["要員ID"]) or {}


def 要員召喚登録(要員データ: dict, 操作者: dict) -> dict:
    """召喚時にpersonaの現在値で要員を登録または更新し、有効化する。"""
    初期化()
    監査 = _監査項目(操作者["利用者ID"], 操作者["利用者名"], 操作者["端末ID"])
    conn = 接続取得()
    try:
        conn.execute(
            f"""
            INSERT INTO "{要員テーブル}" (
                要員ID, 要員名, 役割, 人格情報, 有効,
                登録日時, 登録利用者ID, 登録利用者名, 登録端末ID,
                更新日時, 更新利用者ID, 更新利用者名, 更新端末ID
            ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(要員ID) DO UPDATE SET
                要員名 = excluded.要員名,
                役割 = excluded.役割,
                人格情報 = excluded.人格情報,
                有効 = 1,
                更新日時 = excluded.更新日時,
                更新利用者ID = excluded.更新利用者ID,
                更新利用者名 = excluded.更新利用者名,
                更新端末ID = excluded.更新端末ID
            """,
            (
                要員データ["要員ID"], 要員データ["要員名"], 要員データ["役割"], 要員データ["人格情報"],
                監査["登録日時"], 監査["登録利用者ID"], 監査["登録利用者名"], 監査["登録端末ID"],
                監査["更新日時"], 監査["更新利用者ID"], 監査["更新利用者名"], 監査["更新端末ID"],
            ),
        )
        conn.commit()
    finally:
        conn.close()
    return 要員取得(要員データ["要員ID"]) or {}


def 要員排除(要員ID: str, 操作者: dict) -> dict:
    """排除時に要員行を残したまま無効化する。"""
    初期化()
    if 要員ID == 管理者要員ID:
        raise ValueError("admin要員は排除できません")
    now = _現在日時()
    conn = 接続取得()
    try:
        cursor = conn.execute(
            f"""
            UPDATE "{要員テーブル}"
               SET 有効 = 0,
                   更新日時 = ?, 更新利用者ID = ?, 更新利用者名 = ?, 更新端末ID = ?
             WHERE 要員ID = ?
            """,
            (
                now,
                操作者["利用者ID"],
                操作者["利用者名"],
                操作者["端末ID"],
                要員ID,
            ),
        )
        if cursor.rowcount == 0:
            raise KeyError(要員ID)
        conn.commit()
    finally:
        conn.close()
    return 要員取得(要員ID) or {}


def 要員削除(要員ID: str) -> None:
    初期化()
    if 要員ID == 管理者要員ID:
        raise ValueError("admin要員は削除できません")
    conn = 接続取得()
    try:
        cursor = conn.execute(f'DELETE FROM "{要員テーブル}" WHERE 要員ID = ?', [要員ID])
        if cursor.rowcount == 0:
            raise KeyError(要員ID)
        conn.commit()
    finally:
        conn.close()
