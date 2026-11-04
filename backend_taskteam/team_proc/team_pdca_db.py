# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""Aチーム作業（PDCAサイクル）の DB アクセス。

Aチーム目標の `作業ループ` がオンのプロジェクトについて、空き時間に PDCA を1段ずつ
自動で回す。その実行状況を1レコード1依頼として記録する。

- 1つの PDCA 段（P / D / C / A）で複数名に投入する場合は、要員ごとに1レコード作る。
- 経験生成まで終わって「済」になると終了日時が入り、次の段を投入できる。
- 状況・応答内容・終了日時は Task 処理側（`tasks_db._Aチーム作業反映`）が
  Aタスク要求の進行に合わせて書き込む。状況は対応する Aチーム依頼の状態を写した表示用の値で、
  次の段へ進めるかどうかの判定は終了日時で行う。
"""

from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta

from .team_db import DB_PATH, 接続取得

作業テーブル = "Aチーム作業"
依頼テーブル = "Aチーム依頼"
経験テーブル = "Aチーム経験"
# Aチーム依頼が「完了」（＝経験生成待ち）のまま、この分数を過ぎても「済」にならない作業レコードは
# 経験生成が失敗したものとみなして回収する。team_exp_db.生成タイムアウト分（30分）より
# 十分に長くとり、正常な経験生成を先回りして打ち切らないようにする。
完了滞留回収分 = 90
# 状況は対応する Aチーム依頼の状態を写す（表示用。段の完了判定は終了日時で行う）
状況一覧 = ("準備中", "準備完了", "待機", "実行中", "エラー", "完了", "済", "中止")
初期状況 = "準備中"
# 段として決着した状況。次段へ進めるかを見る sub_SPDCA__common.前段結果を取得 と同じ扱いにする
段終了状況 = ("済", "エラー")
# S（相談）は計画を立てる前の意見交換。n名で並行して意見を出し、その結果を P（計画）で1つにまとめる
# パターンごとの区分の並び。SPDCA=S→P→D→C→Aの5段、PlanDo=P→Dの2段（PとDの文字はSPDCAと共用）
パターン区分一覧 = {
    "SPDCA": ("S", "P", "D", "C", "A"),
    "PlanDo": ("P", "D"),
}
既定パターン = "PlanDo"
PDCA区分一覧 = パターン区分一覧[既定パターン]
PDCA区分名 = {"S": "相談", "P": "計画", "D": "実行", "C": "評価", "A": "改善"}
一覧最大件数 = 100

_採番テーブル = "C採番"
_採番ID = "Aチーム作業"
_採番プレフィックス = "TW"
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
            CREATE TABLE IF NOT EXISTS "{作業テーブル}" (
                作業ID TEXT NOT NULL PRIMARY KEY,
                プロジェクト TEXT NOT NULL DEFAULT '',
                ループ INTEGER NOT NULL DEFAULT 0,
                依頼ID TEXT NOT NULL DEFAULT '',
                チーム作業 TEXT NOT NULL DEFAULT '',
                要員ID TEXT NOT NULL DEFAULT '',
                PDCA区分 TEXT NOT NULL DEFAULT '',
                状況 TEXT NOT NULL DEFAULT '',
                開始日時 TEXT NOT NULL DEFAULT '',
                終了日時 TEXT NOT NULL DEFAULT '',
                応答内容 TEXT NOT NULL DEFAULT '',
                まとめ内容 TEXT NOT NULL DEFAULT '',
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
            CREATE INDEX IF NOT EXISTS "IX_Aチーム作業_プロジェクト"
            ON "{作業テーブル}" (プロジェクト, 作業ID)
        """)
        conn.execute(f"""
            CREATE INDEX IF NOT EXISTS "IX_Aチーム作業_依頼"
            ON "{作業テーブル}" (依頼ID)
        """)
        conn.commit()
    finally:
        conn.close()


def _採番確保(conn: sqlite3.Connection) -> None:
    """C採番（backend_server共有）にAチーム作業用の採番行が無ければ作成する。"""
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
        [_採番ID, _採番初期値, "AIチーム作業の採番（TW）", now, now],
    )


def _新規作業ID(conn: sqlite3.Connection) -> str:
    _採番確保(conn)
    conn.execute(
        f'UPDATE "{_採番テーブル}" SET 最終採番値 = 最終採番値 + 1 WHERE 採番ID = ?',
        [_採番ID],
    )
    行 = conn.execute(
        f'SELECT 最終採番値 FROM "{_採番テーブル}" WHERE 採番ID = ?', [_採番ID]
    ).fetchone()
    return f"{_採番プレフィックス}{行[0]:08d}"


def 作業一覧(プロジェクト: str = "", 件数: int = 一覧最大件数) -> list[dict]:
    """作業の実行状況を新しい順で返す。"""
    初期化()
    conn = 接続取得()
    try:
        条件 = " WHERE プロジェクト = ?" if プロジェクト else ""
        params: list = [プロジェクト] if プロジェクト else []
        params.append(max(1, int(件数)))
        rows = conn.execute(
            f"""
            SELECT 作業ID, プロジェクト, ループ, 依頼ID, チーム作業, 要員ID, PDCA区分, 状況,
                   開始日時, 終了日時, 応答内容, まとめ内容, 更新日時
              FROM "{作業テーブル}"{条件}
             ORDER BY 作業ID DESC
             LIMIT ?
            """,
            params,
        ).fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()


def 作業最大更新日時(プロジェクト: str = "") -> str:
    """一覧の再取得判定に使う最大更新日時を返す。"""
    初期化()
    conn = 接続取得()
    try:
        条件 = " WHERE プロジェクト = ?" if プロジェクト else ""
        row = conn.execute(
            f'SELECT MAX(更新日時) AS 最大更新日時 FROM "{作業テーブル}"{条件}',
            [プロジェクト] if プロジェクト else [],
        ).fetchone()
        return str(row["最大更新日時"] or "") if row else ""
    finally:
        conn.close()


def 未終了一覧(プロジェクト: str = "") -> list[dict]:
    """終了日時が入っていない（まだ実行中の）作業レコードを返す。"""
    初期化()
    conn = 接続取得()
    try:
        条件 = " AND プロジェクト = ?" if プロジェクト else ""
        rows = conn.execute(
            f"""
            SELECT 作業ID, プロジェクト, ループ, 依頼ID, 要員ID, PDCA区分, 状況, 開始日時
              FROM "{作業テーブル}"
             WHERE 終了日時 = ''{条件}
             ORDER BY 作業ID
            """,
            [プロジェクト] if プロジェクト else [],
        ).fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()


def 最終区分(プロジェクト: str) -> str:
    """そのプロジェクトで最後に投入された PDCA区分を返す（レコードが無ければ空文字）。"""
    初期化()
    conn = 接続取得()
    try:
        row = conn.execute(
            f"""
            SELECT PDCA区分 FROM "{作業テーブル}"
             WHERE プロジェクト = ?
             ORDER BY 作業ID DESC
             LIMIT 1
            """,
            [プロジェクト],
        ).fetchone()
        return str(row["PDCA区分"] or "") if row else ""
    finally:
        conn.close()


def 最終段一覧(プロジェクト: str) -> list[dict]:
    """最後に投入された同一区分の連続レコードを、新しい順で返す。"""
    初期化()
    conn = 接続取得()
    try:
        rows = conn.execute(
            f"""
            SELECT 作業ID, プロジェクト, ループ, 依頼ID, チーム作業, 要員ID, PDCA区分,
                   状況, 開始日時, 終了日時, 応答内容, まとめ内容, 更新日時
              FROM "{作業テーブル}"
             WHERE プロジェクト = ?
             ORDER BY 作業ID DESC
            """,
            [プロジェクト],
        ).fetchall()
        if not rows:
            return []
        最終区分値 = str(rows[0]["PDCA区分"] or "")
        結果: list[dict] = []
        for row in rows:
            if str(row["PDCA区分"] or "") != 最終区分値:
                break
            結果.append(dict(row))
        return 結果
    finally:
        conn.close()


def 次のPDCA区分(プロジェクト: str, パターン: str = 既定パターン) -> str:
    """次に投入すべき PDCA区分を返す。投入できない場合は空文字を返す。

    - 未終了（終了日時が空）のレコードが1件でもあれば空文字（前の段がまだ終わっていない）
    - レコードが無ければ区分一覧の先頭（SPDCAは'S'、PlanDoは'P'）から始める
    - 直前の段が終わっていれば、その次の区分（区分一覧の末尾の次は先頭に戻る）
    - 直前の区分が指定パターンの区分一覧に無い（パターン変更直後など）場合も先頭から始め直す

    段が終わったかどうかは終了日時だけで判断する。状況は対応する Aチーム依頼の状態を
    写した表示用の値で、「中止」「完了」など「済 / エラー」以外も入り得るため、
    ここで状況を条件にすると作業ループが永久に進めなくなる。
    """
    区分一覧 = パターン区分一覧.get(パターン, パターン区分一覧[既定パターン])
    最終段 = 最終段一覧(プロジェクト)
    if not 最終段:
        return 区分一覧[0]
    if 未終了一覧(プロジェクト):
        return ""
    直前 = str(最終段[0].get("PDCA区分", ""))
    if 直前 not in 区分一覧:
        return 区分一覧[0]
    次位置 = (区分一覧.index(直前) + 1) % len(区分一覧)
    return 区分一覧[次位置]


def ループ最大値(プロジェクト: str) -> int:
    """プロジェクトに登録済みの最大ループ番号を返す。未登録なら0。"""
    初期化()
    conn = 接続取得()
    try:
        row = conn.execute(
            f'SELECT IFNULL(MAX(ループ), 0) AS 最大値 FROM "{作業テーブル}" WHERE プロジェクト = ?',
            [プロジェクト],
        ).fetchone()
        return int(row["最大値"] or 0) if row else 0
    finally:
        conn.close()


def 作業ループ終了済み(プロジェクト: str, パターン: str, 作業ループ回数: int) -> bool:
    """最大ループの最終段が決着し、終了フックを起動できる状態ならTrueを返す。

    作業ループ回数まで回り、その最終ループの最終段（SPDCA=A / PlanDo=D）が
    済またはエラーで決着したかを判定する。毎分の終了確認が使うため、掲示板の
    ネオン判定を今後簡素化しても、この終了条件は変わらない。

    判定に件数は使わない。途中のループがエラーで終わっていても後続ループが済に
    なることがあり、件数の突き合わせでは今どこまで進んだかを取り違えるため、
    最終段のレコードがある最大ループの状況だけを見る。
    99（無制限）は終了しないので常にFalseを返す。
    """
    初期化()
    if 作業ループ回数 == 99:
        return False
    区分一覧 = パターン区分一覧.get(パターン, パターン区分一覧[既定パターン])
    最終段区分 = 区分一覧[-1]
    conn = 接続取得()
    try:
        ループ行 = conn.execute(
            f'SELECT IFNULL(MAX(ループ), 0) AS ループ数 FROM "{作業テーブル}" WHERE プロジェクト = ?',
            [プロジェクト],
        ).fetchone()
        # 最終段は1ループ1件だが、再投入で複数ある場合に備えて同ループ内の最新を採る
        最新 = conn.execute(
            f"""
            SELECT ループ, 状況
              FROM "{作業テーブル}"
             WHERE プロジェクト = ? AND PDCA区分 = ?
             ORDER BY ループ DESC, 作業ID DESC
             LIMIT 1
            """,
            [プロジェクト, 最終段区分],
        ).fetchone()
    finally:
        conn.close()
    ループ数 = int(ループ行["ループ数"] or 0) if ループ行 else 0
    if ループ数 < 作業ループ回数:
        return False
    if not 最新 or int(最新["ループ"] or 0) < ループ数:
        return False
    return str(最新["状況"] or "") in 段終了状況


def 作業ループ実行中(プロジェクト: str, パターン: str, 作業ループ回数: int) -> bool:
    """作業ループがまだ動いているかを返す（掲示板のネオン点灯の切り替え用）。"""
    return not 作業ループ終了済み(プロジェクト, パターン, 作業ループ回数)


def ループ区分一覧(プロジェクト: str, ループ: int, PDCA区分: str) -> list[dict]:
    """指定したプロジェクト・ループ・PDCA区分の作業レコードを返す。"""
    初期化()
    conn = 接続取得()
    try:
        rows = conn.execute(
            f"""
            SELECT 作業ID, プロジェクト, ループ, 依頼ID, チーム作業, 要員ID, PDCA区分,
                   状況, 開始日時, 終了日時, 応答内容, まとめ内容, 更新日時
              FROM "{作業テーブル}"
             WHERE プロジェクト = ? AND ループ = ? AND PDCA区分 = ?
             ORDER BY 作業ID
            """,
            [プロジェクト, int(ループ), PDCA区分],
        ).fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()


def 作業登録(データ: dict) -> dict:
    """PDCA 1段・1要員分の開始レコードを追加する（終了日時は空のまま）。"""
    初期化()
    now = _現在日時()
    監査 = _監査項目("system", "システム", "backend_team")
    conn = 接続取得()
    try:
        作業ID = _新規作業ID(conn)
        conn.execute(
            f"""
            INSERT INTO "{作業テーブル}" (
                作業ID, プロジェクト, ループ, 依頼ID, チーム作業, 要員ID, PDCA区分, 状況,
                開始日時, 終了日時, 応答内容,
                登録日時, 登録利用者ID, 登録利用者名, 登録端末ID,
                更新日時, 更新利用者ID, 更新利用者名, 更新端末ID
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                作業ID,
                str(データ.get("プロジェクト", "")),
                max(0, int(データ.get("ループ", 0) or 0)),
                str(データ.get("依頼ID", "")),
                str(データ.get("チーム作業", "")),
                str(データ.get("要員ID", "")),
                str(データ.get("PDCA区分", "")),
                str(データ.get("状況", "") or 初期状況),
                str(データ.get("開始日時", "") or now),
                監査["登録日時"], 監査["登録利用者ID"], 監査["登録利用者名"], 監査["登録端末ID"],
                監査["更新日時"], 監査["更新利用者ID"], 監査["更新利用者名"], 監査["更新端末ID"],
            ),
        )
        conn.commit()
    finally:
        conn.close()
    return 作業取得(作業ID) or {}


def 単一計画upsert(Sレコード: dict) -> dict:
    """成功したSが1件だけのとき、AIを起動せず同じループの完了済みPを作成・更新する。"""
    初期化()
    now = _現在日時()
    監査 = _監査項目("system", "システム", "backend_team")
    プロジェクト = str(Sレコード.get("プロジェクト", ""))
    ループ = max(1, int(Sレコード.get("ループ", 0) or 0))
    conn = 接続取得()
    try:
        既存 = conn.execute(
            f"""
            SELECT 作業ID FROM "{作業テーブル}"
             WHERE プロジェクト = ? AND ループ = ? AND PDCA区分 = 'P'
             ORDER BY 作業ID DESC LIMIT 1
            """,
            [プロジェクト, ループ],
        ).fetchone()
        if 既存:
            作業ID = str(既存["作業ID"])
            conn.execute(
                f"""
                UPDATE "{作業テーブル}"
                   SET 依頼ID = '', チーム作業 = ?, 要員ID = ?, 状況 = '済',
                       開始日時 = ?, 終了日時 = ?, 応答内容 = ?, まとめ内容 = ?,
                       更新日時 = ?, 更新利用者ID = 'system',
                       更新利用者名 = 'システム', 更新端末ID = 'backend_team'
                 WHERE 作業ID = ?
                """,
                [
                    str(Sレコード.get("チーム作業", "")),
                    str(Sレコード.get("要員ID", "")),
                    now,
                    now,
                    str(Sレコード.get("応答内容", "")),
                    str(Sレコード.get("まとめ内容", "")),
                    now,
                    作業ID,
                ],
            )
        else:
            作業ID = _新規作業ID(conn)
            conn.execute(
                f"""
                INSERT INTO "{作業テーブル}" (
                    作業ID, プロジェクト, ループ, 依頼ID, チーム作業, 要員ID,
                    PDCA区分, 状況, 開始日時, 終了日時, 応答内容, まとめ内容,
                    登録日時, 登録利用者ID, 登録利用者名, 登録端末ID,
                    更新日時, 更新利用者ID, 更新利用者名, 更新端末ID
                ) VALUES (?, ?, ?, '', ?, ?, 'P', '済', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    作業ID,
                    プロジェクト,
                    ループ,
                    str(Sレコード.get("チーム作業", "")),
                    str(Sレコード.get("要員ID", "")),
                    now,
                    now,
                    str(Sレコード.get("応答内容", "")),
                    str(Sレコード.get("まとめ内容", "")),
                    監査["登録日時"],
                    監査["登録利用者ID"],
                    監査["登録利用者名"],
                    監査["登録端末ID"],
                    監査["更新日時"],
                    監査["更新利用者ID"],
                    監査["更新利用者名"],
                    監査["更新端末ID"],
                ],
            )
        conn.commit()
    finally:
        conn.close()
    return 作業取得(作業ID) or {}


def 作業取得(作業ID: str) -> dict | None:
    初期化()
    conn = 接続取得()
    try:
        row = conn.execute(
            f'SELECT * FROM "{作業テーブル}" WHERE 作業ID = ?', [作業ID]
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def 作業状況記録(作業ID: str, 状況: str) -> None:
    """未終了の作業レコードの状況だけを更新する（投入成功時など）。"""
    初期化()
    now = _現在日時()
    conn = 接続取得()
    try:
        conn.execute(
            f"""
            UPDATE "{作業テーブル}"
               SET 状況 = ?,
                   更新日時 = ?, 更新利用者ID = 'system',
                   更新利用者名 = 'システム', 更新端末ID = 'backend_team'
             WHERE 作業ID = ? AND 終了日時 = ''
            """,
            [状況, now, 作業ID],
        )
        conn.commit()
    finally:
        conn.close()


def 作業終了記録(作業ID: str, 応答内容: str, 状況: str = "エラー") -> None:
    """未終了の作業レコードを終了させる（Team 処理側の後始末用）。"""
    初期化()
    now = _現在日時()
    conn = 接続取得()
    try:
        conn.execute(
            f"""
            UPDATE "{作業テーブル}"
               SET 状況 = ?, 終了日時 = ?, 応答内容 = ?,
                   更新日時 = ?, 更新利用者ID = 'system',
                   更新利用者名 = 'システム', 更新端末ID = 'backend_team'
             WHERE 作業ID = ? AND 終了日時 = ''
            """,
            [状況, now, 応答内容[:4000], now, 作業ID],
        )
        conn.commit()
    finally:
        conn.close()


def 作業完了記録(作業ID: str, 応答内容: str, まとめ内容: str = "", 状況: str = "済") -> None:
    """Task API を介さず、その場で得た応答を「済」として書き込む（同期実行用）。

    aidiy_task_agents ヘの投入・Aチーム経験の生成を経ないぶん、次段へ渡すまとめ内容は
    別途AIに要約させず、応答内容をそのまま使う（まとめ内容省略時）。
    """
    初期化()
    now = _現在日時()
    conn = 接続取得()
    try:
        conn.execute(
            f"""
            UPDATE "{作業テーブル}"
               SET 状況 = ?, 終了日時 = ?, 応答内容 = ?, まとめ内容 = ?,
                   更新日時 = ?, 更新利用者ID = 'system',
                   更新利用者名 = 'システム', 更新端末ID = 'backend_team'
             WHERE 作業ID = ? AND 終了日時 = ''
            """,
            [状況, now, 応答内容[:4000], (まとめ内容 or 応答内容)[:4000], now, 作業ID],
        )
        conn.commit()
    finally:
        conn.close()


def 取り残し終了(プロジェクト: str = "") -> int:
    """Aチーム依頼が既に終わっているのに未終了のままの作業レコードを閉じる。

    投入エラーやタイムアウトで Aチーム依頼だけがエラー化された場合、作業レコードが
    未終了のまま残って次の段へ進めなくなる。それを毎分の確認で回収する。

    回収する対象は 2 種類ある。

    1. Aチーム依頼が 済 / エラー / 中止 になっているもの
    2. Aチーム依頼が「完了」のまま滞留しているもの
       完了は経験生成の待ち状態で、経験生成が終われば「済」へ進む（team_exp_db.経験本登録）。
       だが経験生成が失敗すると Aチーム経験だけがエラーになり、依頼は完了、作業は
       終了日時が空のまま誰も閉じない。経験の再生成も走らない（経験対象一覧は
       経験レコードが無いものだけを拾うため）ので、ここで回収しないと作業ループが
       完全に止まる。経験がエラーで確定したもの、または完了滞留回収分を過ぎても
       済にならないものを対象にする。
    """
    初期化()
    now = _現在日時()
    滞留閾値 = (datetime.now() - timedelta(minutes=完了滞留回収分)).strftime("%Y-%m-%d %H:%M:%S")
    conn = 接続取得()
    try:
        条件 = " AND p.プロジェクト = ?" if プロジェクト else ""
        cursor = conn.execute(
            f"""
            UPDATE "{作業テーブル}"
               SET 状況 = IFNULL((
                       SELECT w.状態 FROM "{依頼テーブル}" w
                        WHERE w.依頼ID = "{作業テーブル}".依頼ID
                   ), 状況),
                   終了日時 = ?,
                   応答内容 = CASE WHEN 応答内容 = '' THEN 'Aチーム依頼が終了したため回収しました' ELSE 応答内容 END,
                   更新日時 = ?, 更新利用者ID = 'system',
                   更新利用者名 = 'システム', 更新端末ID = 'backend_team'
             WHERE 作業ID IN (
                   SELECT p.作業ID
                     FROM "{作業テーブル}" p
                     JOIN "{依頼テーブル}" w ON w.依頼ID = p.依頼ID
                    WHERE p.終了日時 = ''
                      AND (
                          w.状態 IN ('済', 'エラー', '中止')
                          OR (
                              w.状態 = '完了'
                              AND (
                                  EXISTS (
                                      SELECT 1 FROM "{経験テーブル}" e
                                       WHERE e.依頼ID = w.依頼ID AND e.状態 = 'エラー'
                                  )
                                  OR w.更新日時 <= ?
                              )
                          )
                      ){条件}
             )
            """,
            [now, now, 滞留閾値, *([プロジェクト] if プロジェクト else [])],
        )
        conn.commit()
        return cursor.rowcount
    finally:
        conn.close()


def 作業クリア(プロジェクト: str) -> int:
    """そのプロジェクトの作業記録をすべて削除する（作業ループのオン更新時）。"""
    初期化()
    conn = 接続取得()
    try:
        cursor = conn.execute(
            f'DELETE FROM "{作業テーブル}" WHERE プロジェクト = ?', [プロジェクト]
        )
        conn.commit()
        return cursor.rowcount
    finally:
        conn.close()


def 実施明細取得(作業ID: str) -> list[dict]:
    """同じプロジェクトのD作業に紐づく実施原文。開始・終了通知は含めない。"""
    conn = 接続取得()
    try:
        rows = conn.execute(
            "SELECT d.明細SEQ, d.タイプ, d.状態, d.応答内容 "
            "FROM Aチーム作業 w JOIN Aチーム依頼 r ON r.依頼ID = w.依頼ID "
            "AND r.プロジェクト = w.プロジェクト "
            "JOIN Aタスク明細 d ON d.タスクID = r.タスクID "
            "WHERE w.作業ID = ? AND w.PDCA区分 = 'D' "
            "AND d.タイプ = 'do' ORDER BY d.明細SEQ",
            [作業ID],
        ).fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()
