# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""
PostgreSQL クエリモジュール

AiDiy 本体は SQLite で完結するが、**外部プロジェクトや本番構成で
PostgreSQL を使うとき**に、AIエージェントが自己検証できるよう
read-only 中心のクエリ機能を提供する。

接続先は次の優先順で決定:
  1. 各ツール呼び出しで `dsn` を明示
  2. 環境変数 `AIDIY_PG_DSN`
  3. 環境変数 `AIDIY_PG_HOST` / `AIDIY_PG_PORT` / `AIDIY_PG_USER` /
     `AIDIY_PG_PASSWORD` / `AIDIY_PG_DATABASE` から組み立て

どれも無い場合は「DSN 未設定」として明示エラーを返す。
"""

import os
import re
from typing import Any, Optional


class PgQueryError(Exception):
    """PostgreSQL クエリエラー"""
    pass


# psycopg は任意依存。未インストール時は PgQuery 生成時に明示エラーを出す。
try:
    import psycopg
    from psycopg.rows import dict_row
    _PSYCOPG_AVAILABLE = True
    _PSYCOPG_IMPORT_ERROR: Optional[str] = None
except Exception as e:  # pragma: no cover - 環境依存
    psycopg = None  # type: ignore[assignment]
    dict_row = None  # type: ignore[assignment]
    _PSYCOPG_AVAILABLE = False
    _PSYCOPG_IMPORT_ERROR = f"{type(e).__name__}: {e}"


class PgQuery:
    """外部 PostgreSQL に対する安全なクエリアクセスを提供する"""

    MAX_ROWS_LIMIT = 1000

    WRITE_KEYWORDS = {
        "INSERT", "UPDATE", "DELETE", "MERGE", "TRUNCATE",
        "CREATE", "DROP", "ALTER", "GRANT", "REVOKE",
        "COPY", "VACUUM", "REINDEX", "CLUSTER",
    }

    DEFAULT_STATEMENT_TIMEOUT_MS = 15000  # 1 クエリあたり 15 秒

    def __init__(self, dsn: Optional[str] = None):
        if not _PSYCOPG_AVAILABLE:
            raise PgQueryError(
                "psycopg が未インストールです。"
                "backend_tools で `uv sync --upgrade` を再実行してください。"
                f"（import エラー: {_PSYCOPG_IMPORT_ERROR}）"
            )
        self._default_dsn = dsn or self._env_dsn()

    # ------------------------------------------------------------------ #
    # 接続ヘルパ
    # ------------------------------------------------------------------ #

    @staticmethod
    def _env_dsn() -> Optional[str]:
        """環境変数から DSN を組み立て。無ければ None"""
        dsn = os.environ.get("AIDIY_PG_DSN")
        if dsn:
            return dsn
        host = os.environ.get("AIDIY_PG_HOST")
        user = os.environ.get("AIDIY_PG_USER")
        db   = os.environ.get("AIDIY_PG_DATABASE")
        if not (host and user and db):
            return None
        port = os.environ.get("AIDIY_PG_PORT", "5432")
        pwd  = os.environ.get("AIDIY_PG_PASSWORD", "")
        parts = [
            f"host={host}",
            f"port={port}",
            f"dbname={db}",
            f"user={user}",
        ]
        if pwd:
            parts.append(f"password={pwd}")
        # 接続タイムアウト（秒）
        parts.append("connect_timeout=5")
        return " ".join(parts)

    def _resolve_dsn(self, dsn: Optional[str]) -> str:
        dsn = dsn or self._default_dsn
        if not dsn:
            raise PgQueryError(
                "DSN が未設定です。引数 `dsn` か 環境変数 "
                "`AIDIY_PG_DSN` / `AIDIY_PG_HOST`＋他 を設定してください"
            )
        return dsn

    def _connect(self, dsn: Optional[str], read_only: bool):
        """接続を開く。read_only=True のときは default_transaction_read_only を付与"""
        dsn = self._resolve_dsn(dsn)
        options = f"-c statement_timeout={self.DEFAULT_STATEMENT_TIMEOUT_MS}"
        if read_only:
            options += " -c default_transaction_read_only=on"
        try:
            conn = psycopg.connect(
                dsn,
                row_factory=dict_row,
                autocommit=False,
                options=options,
            )
        except Exception as e:
            raise PgQueryError(f"接続エラー: {e}") from e
        return conn

    # ------------------------------------------------------------------ #
    # ツール実装
    # ------------------------------------------------------------------ #

    def server_info(self, dsn: Optional[str] = None) -> dict:
        """バージョン・現在 DB・ユーザー・read_only 設定を返す"""
        with self._connect(dsn, read_only=True) as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT version() AS version, current_database() AS database, "
                "current_user AS \"user\", inet_server_addr()::text AS host, "
                "inet_server_port() AS port"
            )
            row = cur.fetchone()
        return dict(row) if row else {}

    def list_databases(self, dsn: Optional[str] = None) -> list[dict]:
        """テンプレート以外の DB 一覧"""
        sql = (
            "SELECT datname AS name, pg_get_userbyid(datdba) AS owner, "
            "pg_encoding_to_char(encoding) AS encoding "
            "FROM pg_database "
            "WHERE datistemplate = false "
            "ORDER BY datname"
        )
        with self._connect(dsn, read_only=True) as conn, conn.cursor() as cur:
            cur.execute(sql)
            rows = cur.fetchall()
        return [dict(r) for r in rows]

    def list_schemas(self, dsn: Optional[str] = None) -> list[dict]:
        """ユーザースキーマ一覧（pg_catalog / information_schema は除外）"""
        sql = (
            "SELECT schema_name, schema_owner "
            "FROM information_schema.schemata "
            "WHERE schema_name NOT IN ('pg_catalog','information_schema') "
            "AND schema_name NOT LIKE 'pg_toast%' "
            "AND schema_name NOT LIKE 'pg_temp%' "
            "ORDER BY schema_name"
        )
        with self._connect(dsn, read_only=True) as conn, conn.cursor() as cur:
            cur.execute(sql)
            rows = cur.fetchall()
        return [dict(r) for r in rows]

    def list_tables(
        self,
        schema: str = "public",
        dsn: Optional[str] = None,
    ) -> list[dict]:
        """テーブル・VIEW 一覧"""
        self._assert_identifier(schema)
        sql = (
            "SELECT table_name AS name, table_type AS type "
            "FROM information_schema.tables "
            "WHERE table_schema = %s "
            "ORDER BY table_type, table_name"
        )
        with self._connect(dsn, read_only=True) as conn, conn.cursor() as cur:
            cur.execute(sql, (schema,))
            rows = cur.fetchall()
        return [dict(r) for r in rows]

    def describe_table(
        self,
        table: str,
        schema: str = "public",
        dsn: Optional[str] = None,
    ) -> dict:
        """列情報・PK・FK・件数を返す"""
        self._assert_identifier(schema)
        self._assert_identifier(table)

        col_sql = (
            "SELECT column_name, data_type, is_nullable, column_default, "
            "character_maximum_length, numeric_precision, numeric_scale "
            "FROM information_schema.columns "
            "WHERE table_schema = %s AND table_name = %s "
            "ORDER BY ordinal_position"
        )
        pk_sql = (
            "SELECT kcu.column_name "
            "FROM information_schema.table_constraints tc "
            "JOIN information_schema.key_column_usage kcu "
            "  ON tc.constraint_name = kcu.constraint_name "
            "  AND tc.table_schema = kcu.table_schema "
            "WHERE tc.table_schema = %s AND tc.table_name = %s "
            "  AND tc.constraint_type = 'PRIMARY KEY' "
            "ORDER BY kcu.ordinal_position"
        )
        fk_sql = (
            "SELECT kcu.column_name, "
            "       ccu.table_schema AS ref_schema, "
            "       ccu.table_name   AS ref_table, "
            "       ccu.column_name  AS ref_column "
            "FROM information_schema.table_constraints tc "
            "JOIN information_schema.key_column_usage kcu "
            "  ON tc.constraint_name = kcu.constraint_name "
            " AND tc.table_schema = kcu.table_schema "
            "JOIN information_schema.constraint_column_usage ccu "
            "  ON ccu.constraint_name = tc.constraint_name "
            " AND ccu.table_schema = tc.table_schema "
            "WHERE tc.table_schema = %s AND tc.table_name = %s "
            "  AND tc.constraint_type = 'FOREIGN KEY'"
        )
        # カウントはテーブル名を安全にクォート
        qualified = f'"{schema}"."{table}"'
        count_sql = f"SELECT COUNT(*) AS c FROM {qualified}"

        with self._connect(dsn, read_only=True) as conn, conn.cursor() as cur:
            cur.execute(col_sql, (schema, table))
            cols = cur.fetchall()
            if not cols:
                raise PgQueryError(f"テーブルが存在しません: {schema}.{table}")
            cur.execute(pk_sql, (schema, table))
            pk = [r["column_name"] for r in cur.fetchall()]
            cur.execute(fk_sql, (schema, table))
            fks = [dict(r) for r in cur.fetchall()]
            try:
                cur.execute(count_sql)
                total = cur.fetchone()["c"]
            except Exception as e:
                # 権限がないなどでカウントできないときはメッセージを入れる
                total = None
                count_error: Optional[str] = f"{type(e).__name__}: {e}"
            else:
                count_error = None

        return {
            "schema": schema,
            "table": table,
            "row_count": total,
            "count_error": count_error,
            "primary_key": pk,
            "foreign_keys": fks,
            "columns": [dict(c) for c in cols],
        }

    def count(
        self,
        table: str,
        schema: str = "public",
        where: Optional[str] = None,
        dsn: Optional[str] = None,
    ) -> dict:
        """件数取得。where は `;` 禁止。"""
        self._assert_identifier(schema)
        self._assert_identifier(table)
        qualified = f'"{schema}"."{table}"'
        sql = f"SELECT COUNT(*) AS c FROM {qualified}"
        if where:
            if ";" in where:
                raise PgQueryError("where 句に ';' は使えません")
            sql += f" WHERE {where}"
        with self._connect(dsn, read_only=True) as conn, conn.cursor() as cur:
            cur.execute(sql)
            row = cur.fetchone()
        return {
            "schema": schema,
            "table": table,
            "count": row["c"] if row else 0,
        }

    def query(
        self,
        sql: str,
        params: Optional[list] = None,
        max_rows: int = 200,
        allow_write: bool = False,
        dsn: Optional[str] = None,
    ) -> dict:
        """
        任意 SQL を実行する。

        - 複数ステートメント禁止（`;` 区切り不可）
        - 既定は読み取り専用トランザクション
        - `allow_write=True` のときのみ書き込み系を許可
        """
        if not sql or not sql.strip():
            raise PgQueryError("sql が空です")
        trimmed = sql.strip().rstrip(";")
        if ";" in trimmed:
            raise PgQueryError("複数ステートメントは実行できません")

        first_kw = re.split(r"\s+", trimmed, maxsplit=1)[0].upper()
        # WITH ... 系は第 2 トークンまで見る（WITH foo AS (...) INSERT ...）
        if first_kw == "WITH":
            after = re.search(r"\)\s*([A-Z]+)\b", trimmed, re.IGNORECASE)
            if after:
                first_kw = after.group(1).upper()

        is_write = first_kw in self.WRITE_KEYWORDS
        if is_write and not allow_write:
            raise PgQueryError(
                f"書き込み系 SQL（{first_kw}）は allow_write=True が必要です"
            )

        max_rows = max(1, min(int(max_rows or 200), self.MAX_ROWS_LIMIT))
        params_t = list(params or [])

        conn = self._connect(dsn, read_only=not is_write)
        try:
            with conn.cursor() as cur:
                try:
                    cur.execute(trimmed, params_t)
                except Exception as e:
                    conn.rollback()
                    raise PgQueryError(f"SQL エラー: {e}") from e

                if cur.description is None:
                    rowcount = cur.rowcount
                    conn.commit()
                    return {
                        "rowcount": rowcount,
                        "message": "OK (no rows returned)",
                    }

                cols = [d.name for d in cur.description]
                rows = cur.fetchmany(max_rows)
                truncated = cur.fetchone() is not None
                # read-only でも commit でトランザクションを閉じる
                conn.commit() if not is_write else None
                return {
                    "columns": cols,
                    "rows": [dict(r) for r in rows],
                    "returned": len(rows),
                    "truncated": truncated,
                }
        finally:
            conn.close()

    # ------------------------------------------------------------------ #
    # 内部
    # ------------------------------------------------------------------ #

    @staticmethod
    def _assert_identifier(name: str) -> None:
        """スキーマ／テーブル名が単純識別子か検証（SQL インジェクション対策）"""
        if not isinstance(name, str) or not name:
            raise PgQueryError("スキーマ／テーブル名は空でない文字列を指定してください")
        # PostgreSQL は大文字小文字を quote 無しだと lower に畳む。
        # ここでは英数・アンダースコア・$ のみ許可（引用識別子は非対応）
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_$]*", name):
            raise PgQueryError(
                f"識別子として不正な文字が含まれています: {name}"
            )
