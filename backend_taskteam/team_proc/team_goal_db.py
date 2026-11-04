# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""Aチーム目標の DB アクセス。

CODE_BASE_PATH（プロジェクトのパス）ごとにチーム作業を 1 件保持する。
画面（AIチーム空間の掲示板）は更新日時が最新の 1 件を表示する。
"""

from __future__ import annotations

import sqlite3
from datetime import datetime

from .config import AIモデル, 設定読込
from .team_db import DB_PATH, 接続取得

目標テーブル = "Aチーム目標"
既定CODE_BASE_PATH = "../"
既定チーム作業 = "斬新なアイデアで、未踏のフロンティアを切り開け！"
既定チーム目標 = "成功と失敗を学習し、今よりも優れたソフトウェアを創る。"
既定作業ループ回数 = 1
既定動員要員数 = 2
# 動員要員数の保存上限。実際に動員できる人数は投入時に有効要員数（admin除く）で頭打ちにする。
動員要員数上限 = 99
# 作業ループのパターン。SPDCA=S→P→D→C→Aの5段、PlanDo=P→Dの2段
許可パターン = ("SPDCA", "PlanDo")
既定パターン = "PlanDo"
# 作業ループの各段で使うAI。目標ごとに持ち、Aチーム依頼・Aタスクの投入時に使う。
# モデルは段に応じて plan（相談・計画）/ do（実施）/ check（評価・改善）を使い分ける。
AIモデルフェーズ = ("plan", "do", "check")
AIモデルカラム = tuple(
    f"{接頭辞}_AI_MODEL_{フェーズ}"
    for 接頭辞 in ("TEAM", "TASK")
    for フェーズ in AIモデルフェーズ
)
AI設定キー = ("TEAM_AI_NAME", "TASK_AI_NAME", *AIモデルカラム)
_AI設定列 = ("TEAM_AI_NAME", "TASK_AI_NAME", *AIモデルカラム)
_AI設定列SQL = ", ".join(_AI設定列)
既定TEAM_AI_NAME = "codex_cli"
既定TASK_AI_NAME = "codex_cli"
# モデルは TEAM / TASK・フェーズを問わず auto（CLI 既定に任せる）を初期値にする
既定AI_MODEL = "auto"


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


def _次の更新連番(conn: sqlite3.Connection) -> int:
    """更新日時は秒単位のため、同じ秒に複数保存されても順序が決まるよう連番を採る。"""
    row = conn.execute(f'SELECT IFNULL(MAX(更新連番), 0) + 1 AS 次 FROM "{目標テーブル}"').fetchone()
    return int(row["次"]) if row else 1


def 作業履歴クリア必要(変更前: dict | None, チーム作業: str, 作業ループ: bool, パターン: str = 既定パターン) -> bool:
    """既存目標・作業ループON/OFF・パターンのいずれかが変わった場合だけ作業履歴をクリアする。

    パターンが変わると PDCA区分の並びや意味（S/P/D/C/A ⇔ P/D）が変わり、
    ループ番号や直前段の判定に不整合が起きるため、目標変更と同様にクリア対象にする。
    """
    if 変更前 is None:
        return False
    return (
        str(変更前.get("チーム作業", "")) != チーム作業
        or bool(変更前.get("作業ループ", 0)) != bool(作業ループ)
        or str(変更前.get("パターン", 既定パターン)) != パターン
    )


def 会話クリア必要(変更前: dict | None, チーム目標: str, 自動作業設定: bool) -> bool:
    """チーム目標または自動作業設定が変わった場合だけ、そのプロジェクトの会話をクリアする。"""
    if 変更前 is None:
        return False
    return (
        str(変更前.get("チーム目標", "")) != チーム目標
        or bool(変更前.get("自動作業設定", 0)) != bool(自動作業設定)
    )


def 初期化() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = 接続取得()
    try:
        conn.execute(f"""
            CREATE TABLE IF NOT EXISTS "{目標テーブル}" (
                CODE_BASE_PATH TEXT NOT NULL PRIMARY KEY,
                チーム目標 TEXT NOT NULL DEFAULT '',
                自動作業設定 INTEGER NOT NULL DEFAULT 0,
                チーム作業 TEXT NOT NULL DEFAULT '',
                作業ループ INTEGER NOT NULL DEFAULT 0,
                作業ループ回数 INTEGER NOT NULL DEFAULT 1,
                動員要員数 INTEGER NOT NULL DEFAULT 2,
                パターン TEXT NOT NULL DEFAULT '{既定パターン}',
                TEAM_AI_NAME TEXT NOT NULL DEFAULT '{既定TEAM_AI_NAME}',
                TEAM_AI_MODEL_plan TEXT NOT NULL DEFAULT '{既定AI_MODEL}',
                TEAM_AI_MODEL_do TEXT NOT NULL DEFAULT '{既定AI_MODEL}',
                TEAM_AI_MODEL_check TEXT NOT NULL DEFAULT '{既定AI_MODEL}',
                TASK_AI_NAME TEXT NOT NULL DEFAULT '{既定TASK_AI_NAME}',
                TASK_AI_MODEL_plan TEXT NOT NULL DEFAULT '{既定AI_MODEL}',
                TASK_AI_MODEL_do TEXT NOT NULL DEFAULT '{既定AI_MODEL}',
                TASK_AI_MODEL_check TEXT NOT NULL DEFAULT '{既定AI_MODEL}',
                更新連番 INTEGER NOT NULL DEFAULT 0,
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
        conn.commit()
    finally:
        conn.close()




def 初期目標を投入() -> None:
    """起動時、1 件も無ければ既定のパスと目標をconfのAI設定で投入する。"""
    初期化()
    設定 = 設定読込()
    # モデルは段ごとに使い分けるため、共通設定のフェーズ別値をそのまま初期値にする
    AI設定 = {
        "TEAM_AI_NAME": str(設定.TEAM_AI_NAME).strip() or 既定TEAM_AI_NAME,
        "TASK_AI_NAME": str(設定.TASK_AI_NAME).strip() or 既定TASK_AI_NAME,
        **{
            f"{接頭辞}_AI_MODEL_{フェーズ}": AIモデル(接頭辞, フェーズ, 既定AI_MODEL)
            for 接頭辞 in ("TEAM", "TASK")
            for フェーズ in AIモデルフェーズ
        },
    }
    conn = 接続取得()
    try:
        監査 = _監査項目("system", "システム", "backend_team")
        conn.execute(
            f"""
            INSERT OR IGNORE INTO "{目標テーブル}" (
                CODE_BASE_PATH, チーム目標, 自動作業設定, チーム作業, 作業ループ, 作業ループ回数, 動員要員数, パターン,
                {_AI設定列SQL}, 更新連番,
                登録日時, 登録利用者ID, 登録利用者名, 登録端末ID,
                更新日時, 更新利用者ID, 更新利用者名, 更新端末ID
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, {', '.join('?' * len(_AI設定列))}, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                既定CODE_BASE_PATH, 既定チーム目標, 0, 既定チーム作業, 0, 既定作業ループ回数,
                既定動員要員数, 既定パターン,
                *[AI設定[列] for 列 in _AI設定列],
                _次の更新連番(conn),
                監査["登録日時"], 監査["登録利用者ID"], 監査["登録利用者名"], 監査["登録端末ID"],
                監査["更新日時"], 監査["更新利用者ID"], 監査["更新利用者名"], 監査["更新端末ID"],
            ),
        )
        conn.commit()
    finally:
        conn.close()


def 起動時自動作業設定をオフ() -> int:
    """backend_taskteam 起動時、オンの自動作業設定をすべてオフへ戻す。

    これは人による目標編集ではなく起動時の安全解除なので、更新日時・更新連番・監査項目は
    変更しない。これにより、掲示板の最終目標の表示順も起動だけでは変化しない。
    """
    初期化()
    conn = 接続取得()
    try:
        cursor = conn.execute(
            f'UPDATE "{目標テーブル}" SET 自動作業設定 = 0 WHERE 自動作業設定 != 0'
        )
        conn.commit()
        return max(0, int(cursor.rowcount))
    finally:
        conn.close()


def 起動時作業ループをオフ() -> int:
    """backend_taskteam 起動時、オンの作業ループをすべてオフへ戻す。

    これは人による目標編集ではなく起動時の安全解除なので、更新日時・更新連番・監査項目は
    変更しない。これにより、掲示板の最終目標の表示順も起動だけでは変化しない。
    """
    初期化()
    conn = 接続取得()
    try:
        cursor = conn.execute(
            f'UPDATE "{目標テーブル}" SET 作業ループ = 0 WHERE 作業ループ != 0'
        )
        conn.commit()
        return max(0, int(cursor.rowcount))
    finally:
        conn.close()


def 目標一覧() -> list[dict]:
    """登録済みのパスと目標を、更新日時の新しい順で返す。"""
    初期化()
    conn = 接続取得()
    try:
        rows = conn.execute(
            f"""
            SELECT CODE_BASE_PATH, チーム目標, 自動作業設定, チーム作業, 作業ループ, 作業ループ回数, 動員要員数, パターン,
                   {_AI設定列SQL},
                   更新日時, 更新利用者ID, 更新利用者名
              FROM "{目標テーブル}"
             ORDER BY 更新日時 DESC, 更新連番 DESC, CODE_BASE_PATH
            """
        ).fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()


def 作業ループ対象一覧() -> list[dict]:
    """作業ループがオンかつチーム作業入力済みの目標を、PDCAの自動投入対象として返す。"""
    初期化()
    conn = 接続取得()
    try:
        rows = conn.execute(
            f"""
            SELECT CODE_BASE_PATH, チーム目標, 自動作業設定, チーム作業, 作業ループ, 作業ループ回数, 動員要員数, パターン,
                   {_AI設定列SQL}, 更新日時
              FROM "{目標テーブル}"
             WHERE 作業ループ = 1 AND TRIM(CODE_BASE_PATH) != '' AND TRIM(チーム作業) != ''
             ORDER BY 更新日時 DESC, 更新連番 DESC, CODE_BASE_PATH
            """
        ).fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()


def 目標取得(code_base_path: str) -> dict | None:
    初期化()
    conn = 接続取得()
    try:
        row = conn.execute(
            f"""
            SELECT CODE_BASE_PATH, チーム目標, 自動作業設定, チーム作業, 作業ループ, 作業ループ回数, 動員要員数, パターン,
                   {_AI設定列SQL},
                   更新日時, 更新利用者ID, 更新利用者名
              FROM "{目標テーブル}" WHERE CODE_BASE_PATH = ?
            """,
            [code_base_path],
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def 最終目標取得() -> dict | None:
    """更新日時が最新の 1 件を返す（掲示板に出す値）。"""
    初期化()
    conn = 接続取得()
    try:
        row = conn.execute(
            f"""
            SELECT CODE_BASE_PATH, チーム目標, 自動作業設定, チーム作業, 作業ループ, 作業ループ回数, 動員要員数, パターン,
                   {_AI設定列SQL},
                   更新日時, 更新利用者ID, 更新利用者名
              FROM "{目標テーブル}"
             ORDER BY 更新日時 DESC, 更新連番 DESC, CODE_BASE_PATH
             LIMIT 1
            """
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def 目標保存(
    code_base_path: str,
    チーム作業: str,
    チーム目標: str,
    操作者: dict,
    自動作業設定: bool = False,
    作業ループ: bool = False,
    作業ループ回数: int = 既定作業ループ回数,
    動員要員数: int = 既定動員要員数,
    パターン: str = 既定パターン,
    TEAM_AI_NAME: str = 既定TEAM_AI_NAME,
    TASK_AI_NAME: str = 既定TASK_AI_NAME,
    **AIモデル指定: str,
) -> dict:
    """パス単位のupsert。既存があれば目標・テーマ・自動作業設定・作業ループ設定と更新監査を書き換える。

    モデルは `TEAM_AI_MODEL_plan` などフェーズ別のキーワード引数で受け取る。
    """
    初期化()
    if パターン not in 許可パターン:
        raise ValueError(f"パターンは {'/'.join(許可パターン)} のいずれかを指定してください")
    想定外 = set(AIモデル指定) - set(AIモデルカラム)
    if 想定外:
        raise TypeError(f"目標保存が受け取れない引数です: {sorted(想定外)}")
    # AI設定は選択肢が環境で変わるため値の妥当性までは見ず、空のときだけ既定へ寄せる
    AI設定 = {
        "TEAM_AI_NAME": str(TEAM_AI_NAME or "").strip() or 既定TEAM_AI_NAME,
        "TASK_AI_NAME": str(TASK_AI_NAME or "").strip() or 既定TASK_AI_NAME,
    }
    for カラム in AIモデルカラム:
        AI設定[カラム] = str(AIモデル指定.get(カラム, "") or "").strip() or 既定AI_MODEL
    監査 = _監査項目(操作者["利用者ID"], 操作者["利用者名"], 操作者["端末ID"])
    conn = 接続取得()
    try:
        conn.execute(
            f"""
            INSERT INTO "{目標テーブル}" (
                CODE_BASE_PATH, チーム目標, 自動作業設定, チーム作業, 作業ループ, 作業ループ回数, 動員要員数, パターン,
                {_AI設定列SQL}, 更新連番,
                登録日時, 登録利用者ID, 登録利用者名, 登録端末ID,
                更新日時, 更新利用者ID, 更新利用者名, 更新端末ID
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, {', '.join('?' * len(_AI設定列))}, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(CODE_BASE_PATH) DO UPDATE SET
                チーム目標 = excluded.チーム目標,
                自動作業設定 = excluded.自動作業設定,
                チーム作業 = excluded.チーム作業,
                作業ループ = excluded.作業ループ,
                作業ループ回数 = excluded.作業ループ回数,
                動員要員数 = excluded.動員要員数,
                パターン = excluded.パターン,
                {', '.join(f'{列} = excluded.{列}' for 列 in _AI設定列)},
                更新連番 = excluded.更新連番,
                更新日時 = excluded.更新日時,
                更新利用者ID = excluded.更新利用者ID,
                更新利用者名 = excluded.更新利用者名,
                更新端末ID = excluded.更新端末ID
            """,
            (
                code_base_path, チーム目標, int(bool(自動作業設定)), チーム作業, int(bool(作業ループ)),
                max(1, min(99, int(作業ループ回数))),
                max(1, min(動員要員数上限, int(動員要員数))), パターン,
                *[AI設定[列] for 列 in _AI設定列],
                _次の更新連番(conn),
                監査["登録日時"], 監査["登録利用者ID"], 監査["登録利用者名"], 監査["登録端末ID"],
                監査["更新日時"], 監査["更新利用者ID"], 監査["更新利用者名"], 監査["更新端末ID"],
            ),
        )
        conn.commit()
    except sqlite3.Error as exc:
        raise ValueError(f"チーム作業の保存に失敗しました: {exc}") from exc
    finally:
        conn.close()
    return 目標取得(code_base_path) or {}


def 取りまとめ反映(
    code_base_path: str,
    要求内容: str,
    取りまとめ内容: str,
    要員ID: str = "admin",
) -> dict:
    """AIの取りまとめをチーム作業へ設定し、会話をadminの取りまとめ1件へ置き換える。

    AI処理中に利用者がチーム作業を入力した場合は上書きしない。目標更新・会話置換は
    同じトランザクションで行い、どちらかだけが反映される状態を防ぐ。
    """
    from . import team_pdca_db, team_talk_db

    初期化()
    team_talk_db.初期化()
    team_pdca_db.初期化()
    内容 = str(取りまとめ内容).strip()
    if not 内容:
        raise ValueError("取りまとめ内容が空です")
    監査 = _監査項目("system", "システム", "backend_team")
    conn = 接続取得()
    try:
        cursor = conn.execute(
            f"""
            UPDATE "{目標テーブル}"
               SET チーム作業 = ?, 更新連番 = ?,
                   更新日時 = ?, 更新利用者ID = ?, 更新利用者名 = ?, 更新端末ID = ?
             WHERE CODE_BASE_PATH = ? AND TRIM(チーム作業) = ''
            """,
            [
                内容,
                _次の更新連番(conn),
                監査["更新日時"],
                監査["更新利用者ID"],
                監査["更新利用者名"],
                監査["更新端末ID"],
                code_base_path,
            ],
        )
        if int(cursor.rowcount) != 1:
            raise ValueError("対象のチーム目標が無いか、チーム作業が既に入力されています")

        conn.execute(
            f'DELETE FROM "{team_talk_db.会話テーブル}" WHERE プロジェクト = ?',
            [code_base_path],
        )
        conn.execute(
            f'DELETE FROM "{team_pdca_db.作業テーブル}" WHERE プロジェクト = ?',
            [code_base_path],
        )
        conn.execute(
            f"""
            INSERT INTO "{team_talk_db.会話テーブル}" (
                プロジェクト, 要員ID, 要求内容, 発言内容,
                登録日時, 登録利用者ID, 登録利用者名, 登録端末ID,
                更新日時, 更新利用者ID, 更新利用者名, 更新端末ID
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                code_base_path,
                要員ID,
                要求内容,
                内容,
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
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    return 目標取得(code_base_path) or {}


def 作業ループ終了後更新(code_base_path: str) -> dict:
    """作業ループ完了後、自動作業設定に応じて再協議または停止へ切り替える。

    自動作業設定がオンならチーム作業を空欄にして対象プロジェクトの会話をクリアし、
    次の作業を協議できる状態へ戻す。オフなら作業ループをオフにして再投入を止める。
    AI終了判定後に利用者が設定を変えた場合へ配慮し、DBの現在値で分岐する。
    """
    from . import team_talk_db

    初期化()
    team_talk_db.初期化()
    監査 = _監査項目("system", "システム", "backend_team")
    conn = 接続取得()
    処理 = "変更なし"
    try:
        row = conn.execute(
            f"""
            SELECT 自動作業設定, 作業ループ, チーム作業
              FROM "{目標テーブル}"
             WHERE CODE_BASE_PATH = ?
            """,
            [code_base_path],
        ).fetchone()
        if not row:
            raise ValueError("対象のチーム目標が見つかりません")

        # 起動後に利用者が停止または作業内容変更を行った場合は、その現在値を上書きしない。
        if not bool(row["作業ループ"]) or not str(row["チーム作業"] or "").strip():
            conn.rollback()
        elif bool(row["自動作業設定"]):
            conn.execute(
                f"""
                UPDATE "{目標テーブル}"
                   SET チーム作業 = '', 更新連番 = ?,
                       更新日時 = ?, 更新利用者ID = ?, 更新利用者名 = ?, 更新端末ID = ?
                 WHERE CODE_BASE_PATH = ?
                """,
                [
                    _次の更新連番(conn),
                    監査["更新日時"],
                    監査["更新利用者ID"],
                    監査["更新利用者名"],
                    監査["更新端末ID"],
                    code_base_path,
                ],
            )
            conn.execute(
                f'DELETE FROM "{team_talk_db.会話テーブル}" WHERE プロジェクト = ?',
                [code_base_path],
            )
            conn.commit()
            処理 = "再協議"
        else:
            conn.execute(
                f"""
                UPDATE "{目標テーブル}"
                   SET 作業ループ = 0, 更新連番 = ?,
                       更新日時 = ?, 更新利用者ID = ?, 更新利用者名 = ?, 更新端末ID = ?
                 WHERE CODE_BASE_PATH = ?
                """,
                [
                    _次の更新連番(conn),
                    監査["更新日時"],
                    監査["更新利用者ID"],
                    監査["更新利用者名"],
                    監査["更新端末ID"],
                    code_base_path,
                ],
            )
            conn.commit()
            処理 = "停止"
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    return {"処理": 処理, "item": 目標取得(code_base_path) or {}}


def 目標削除(code_base_path: str) -> None:
    """既定パス（../）は残す。削除対象が無ければ KeyError。"""
    初期化()
    if code_base_path == 既定CODE_BASE_PATH:
        raise ValueError(f"{既定CODE_BASE_PATH} のチーム作業は削除できません")
    conn = 接続取得()
    try:
        cursor = conn.execute(
            f'DELETE FROM "{目標テーブル}" WHERE CODE_BASE_PATH = ?', [code_base_path]
        )
        if cursor.rowcount == 0:
            raise KeyError(code_base_path)
        conn.commit()
    finally:
        conn.close()
