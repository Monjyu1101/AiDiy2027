# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""
SQLite クエリモジュール

`_data/AiDiy/database.db` に対し、AIエージェントが
**自己検証のため** にスキーマ確認・件数確認・SELECT を行うための
最小限のツール群を提供する。

安全性方針:
- 既定は読み取り専用（URI `?mode=ro` で接続）
- DDL / DML は `allow_write=True` を明示したときのみ、かつ 1 文のみ許可
- 結果は最大 `max_rows` 件まで返す（デフォルト 200）
"""

import os
import re
import sqlite3
from typing import Any, Optional


class SqliteQueryError(Exception):
    """SQLite クエリ実行エラー"""
    pass


class SqliteQuery:
    """AiDiy の SQLite DB に対する安全なクエリアクセスを提供する"""

    DEFAULT_DB_REL = os.path.join("_data", "AiDiy", "database.db")
    MAX_ROWS_LIMIT = 1000

    # 書き込み系 SQL の先頭キーワード
    WRITE_KEYWORDS = {
        "INSERT", "UPDATE", "DELETE", "REPLACE",
        "CREATE", "DROP", "ALTER", "TRUNCATE",
        "ATTACH", "DETACH", "VACUUM", "REINDEX",
    }

    def __init__(self, db_path: Optional[str] = None):
        if db_path:
            self.db_path = db_path
        else:
            # backend_tools/ から親ディレクトリの AiDiy プロジェクトルートを探す
            here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            root = os.path.dirname(here)
            self.db_path = os.path.join(root, self.DEFAULT_DB_REL)

    # ------------------------------------------------------------------ #
    # 接続ヘルパ
    # ------------------------------------------------------------------ #

    def _connect(self, read_only: bool = True) -> sqlite3.Connection:
        if not os.path.isfile(self.db_path):
            raise SqliteQueryError(f"DBファイルが見つかりません: {self.db_path}")
        if read_only:
            uri = f"file:{self.db_path}?mode=ro"
            conn = sqlite3.connect(uri, uri=True, timeout=5.0)
        else:
            conn = sqlite3.connect(self.db_path, timeout=5.0)
        conn.row_factory = sqlite3.Row
        return conn

    # ------------------------------------------------------------------ #
    # ツール実装
    # ------------------------------------------------------------------ #

    def list_tables(self) -> list[dict]:
        """全テーブル・VIEW 一覧を返す"""
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT name, type FROM sqlite_master "
                "WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' "
                "ORDER BY type, name"
            ).fetchall()
        return [{"name": r["name"], "type": r["type"]} for r in rows]

    def describe_table(self, table_name: str) -> dict:
        """PRAGMA table_info + 件数を返す"""
        self._assert_identifier(table_name)
        with self._connect() as conn:
            cols = conn.execute(f"PRAGMA table_info({table_name})").fetchall()
            if not cols:
                raise SqliteQueryError(f"テーブルが存在しません: {table_name}")
            fks = conn.execute(f"PRAGMA foreign_key_list({table_name})").fetchall()
            idxs = conn.execute(f"PRAGMA index_list({table_name})").fetchall()
            total = conn.execute(f"SELECT COUNT(*) AS c FROM {table_name}").fetchone()["c"]
        return {
            "table": table_name,
            "row_count": total,
            "columns": [dict(c) for c in cols],
            "foreign_keys": [dict(f) for f in fks],
            "indexes": [dict(i) for i in idxs],
        }

    def count(self, table_name: str, where: Optional[str] = None) -> dict:
        """件数取得。`where` は列名のみ使う想定で簡易サニタイズ"""
        self._assert_identifier(table_name)
        sql = f"SELECT COUNT(*) AS c FROM {table_name}"
        params: tuple = ()
        if where:
            # 複数ステートメント禁止
            if ";" in where:
                raise SqliteQueryError("where 句に ';' は使えません")
            sql += f" WHERE {where}"
        with self._connect() as conn:
            row = conn.execute(sql, params).fetchone()
        return {"table": table_name, "count": row["c"]}

    def query(
        self,
        sql: str,
        params: Optional[list] = None,
        max_rows: int = 200,
        allow_write: bool = False,
    ) -> dict:
        """
        任意 SQL を実行する。

        - 複数ステートメントは禁止（`;` 区切り不可）
        - 既定は読み取り専用接続
        - `allow_write=True` のときだけ書き込み系を許可し、通常接続で実行
        """
        if not sql or not sql.strip():
            raise SqliteQueryError("sql が空です")
        trimmed = sql.strip().rstrip(";")
        if ";" in trimmed:
            raise SqliteQueryError("複数ステートメントは実行できません")
        first_kw = re.split(r"\s+", trimmed, maxsplit=1)[0].upper()
        is_write = first_kw in self.WRITE_KEYWORDS
        if is_write and not allow_write:
            raise SqliteQueryError(
                f"書き込み系 SQL（{first_kw}）は allow_write=True が必要です"
            )

        max_rows = max(1, min(int(max_rows or 200), self.MAX_ROWS_LIMIT))
        params_t = tuple(params or [])

        with self._connect(read_only=not is_write) as conn:
            try:
                cursor = conn.execute(trimmed, params_t)
            except sqlite3.Error as e:
                raise SqliteQueryError(f"SQL エラー: {e}") from e

            if cursor.description is None:
                # 書き込み系: 行を返さない
                conn.commit()
                return {
                    "rowcount": cursor.rowcount,
                    "message": "OK (no rows returned)",
                }

            cols = [d[0] for d in cursor.description]
            rows = cursor.fetchmany(max_rows)
            truncated = cursor.fetchone() is not None
            return {
                "columns": cols,
                "rows": [dict(zip(cols, r)) for r in rows],
                "returned": len(rows),
                "truncated": truncated,
            }

    def audit_summary(self, table_name: str, limit: int = 5) -> dict:
        """直近の登録／更新を返す（監査フィールドのあるテーブル向け）"""
        self._assert_identifier(table_name)
        limit = max(1, min(int(limit or 5), 100))
        with self._connect() as conn:
            cols = [r["name"] for r in conn.execute(f"PRAGMA table_info({table_name})")]
            has_audit = "更新日時" in cols and "更新利用者名" in cols
            if not has_audit:
                raise SqliteQueryError(
                    f"{table_name} には監査フィールド（更新日時／更新利用者名）がありません"
                )
            order = "更新日時 DESC, 登録日時 DESC" if "登録日時" in cols else "更新日時 DESC"
            rows = conn.execute(
                f"SELECT * FROM {table_name} ORDER BY {order} LIMIT ?", (limit,)
            ).fetchall()
            names = [d[0] for d in conn.execute(f"SELECT * FROM {table_name} LIMIT 0").description]
        return {
            "table": table_name,
            "recent": [dict(zip(names, r)) for r in rows],
        }

    # ------------------------------------------------------------------ #
    # 内部
    # ------------------------------------------------------------------ #

    @staticmethod
    def _assert_identifier(name: str) -> None:
        """テーブル名が単純識別子であることを確認（SQL インジェクション対策）"""
        if not isinstance(name, str):
            raise SqliteQueryError("table_name は文字列で指定してください")
        # 日本語・英数・アンダースコアのみ許容
        if not re.fullmatch(r"[A-Za-z_\u3040-\u30ff\u4e00-\u9fff][A-Za-z0-9_\u3040-\u30ff\u4e00-\u9fff]*", name):
            raise SqliteQueryError(f"テーブル名として不正な文字が含まれています: {name}")
