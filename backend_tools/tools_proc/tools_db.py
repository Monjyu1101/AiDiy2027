# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""aidiy_sqlite / aidiy_postgres MCP ツール登録 + HTTP ルート"""

import asyncio
import json
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

from log_config import get_logger
from tools_proc.sqlite_query import SqliteQueryError
from tools_proc.postgres_query import PgQueryError

logger = get_logger(__name__)


class SqliteRequest(BaseModel):
    table_name: Optional[str] = None
    where: Optional[str] = None
    sql: Optional[str] = None
    params: Optional[list] = None
    max_rows: int = 200
    allow_write: bool = False
    limit: int = 5


class PostgresRequest(BaseModel):
    table: Optional[str] = None
    schema_name: str = "public"
    where: Optional[str] = None
    sql: Optional[str] = None
    params: Optional[list] = None
    max_rows: int = 200
    allow_write: bool = False
    dsn: Optional[str] = None


# ================================================================== #
# aidiy_sqlite ツール
# ================================================================== #

def register_sqlite_tools(mcp_sq, sqlite_q):
    """aidiy_sqlite MCP ツールを mcp_sq インスタンスに登録する"""

    @mcp_sq.tool()
    async def sqlite_list_tables() -> str:
        """AiDiy DB の全テーブル・VIEW 一覧を返す"""
        try:
            items = await asyncio.to_thread(sqlite_q.list_tables)
        except SqliteQueryError as e:
            raise ValueError(str(e)) from e
        return json.dumps({"tables": items}, ensure_ascii=False)

    @mcp_sq.tool()
    async def sqlite_describe_table(table_name: str) -> str:
        """指定テーブルのスキーマ（列・FK・索引・件数）を返す"""
        try:
            info = await asyncio.to_thread(sqlite_q.describe_table, table_name)
        except SqliteQueryError as e:
            raise ValueError(str(e)) from e
        return json.dumps(info, ensure_ascii=False, default=str)

    @mcp_sq.tool()
    async def sqlite_count(table_name: str, where: Optional[str] = None) -> str:
        """件数を返す。where は必要なら SQL の WHERE 節を文字列で渡す（`;` 禁止）"""
        try:
            info = await asyncio.to_thread(sqlite_q.count, table_name, where)
        except SqliteQueryError as e:
            raise ValueError(str(e)) from e
        return json.dumps(info, ensure_ascii=False)

    @mcp_sq.tool()
    async def sqlite_query(
        sql: str,
        params: Optional[list] = None,
        max_rows: int = 200,
        allow_write: bool = False,
    ) -> str:
        """
        SELECT を実行して行を返す。既定は読み取り専用。
        書き込み系は allow_write=True を明示したときのみ許可。
        複数ステートメント不可。
        """
        try:
            result = await asyncio.to_thread(
                sqlite_q.query, sql, params, max_rows, allow_write
            )
        except SqliteQueryError as e:
            raise ValueError(str(e)) from e
        return json.dumps(result, ensure_ascii=False, default=str)

    @mcp_sq.tool()
    async def sqlite_audit_summary(table_name: str, limit: int = 5) -> str:
        """監査フィールドのあるテーブルの直近 N 件を返す（更新日時 降順）"""
        try:
            info = await asyncio.to_thread(sqlite_q.audit_summary, table_name, limit)
        except SqliteQueryError as e:
            raise ValueError(str(e)) from e
        return json.dumps(info, ensure_ascii=False, default=str)


# ================================================================== #
# aidiy_postgres ツール
# ================================================================== #

def register_postgres_tools(mcp_pg, get_pg):
    """aidiy_postgres MCP ツールを mcp_pg インスタンスに登録する"""

    @mcp_pg.tool()
    async def postgres_server_info(dsn: Optional[str] = None) -> str:
        """接続先 PostgreSQL のバージョン・現在 DB・ユーザー等を返す"""
        try:
            info = await asyncio.to_thread(get_pg().server_info, dsn)
        except PgQueryError as e:
            raise ValueError(str(e)) from e
        return json.dumps(info, ensure_ascii=False, default=str)

    @mcp_pg.tool()
    async def postgres_list_databases(dsn: Optional[str] = None) -> str:
        """テンプレート以外の DB 一覧"""
        try:
            items = await asyncio.to_thread(get_pg().list_databases, dsn)
        except PgQueryError as e:
            raise ValueError(str(e)) from e
        return json.dumps({"databases": items}, ensure_ascii=False)

    @mcp_pg.tool()
    async def postgres_list_schemas(dsn: Optional[str] = None) -> str:
        """ユーザースキーマ一覧（pg_catalog / information_schema は除外）"""
        try:
            items = await asyncio.to_thread(get_pg().list_schemas, dsn)
        except PgQueryError as e:
            raise ValueError(str(e)) from e
        return json.dumps({"schemas": items}, ensure_ascii=False)

    @mcp_pg.tool()
    async def postgres_list_tables(
        schema: str = "public",
        dsn: Optional[str] = None,
    ) -> str:
        """指定スキーマのテーブル・VIEW 一覧"""
        try:
            items = await asyncio.to_thread(get_pg().list_tables, schema, dsn)
        except PgQueryError as e:
            raise ValueError(str(e)) from e
        return json.dumps({"tables": items}, ensure_ascii=False)

    @mcp_pg.tool()
    async def postgres_describe_table(
        table: str,
        schema: str = "public",
        dsn: Optional[str] = None,
    ) -> str:
        """列情報・PK・FK・件数を返す"""
        try:
            info = await asyncio.to_thread(get_pg().describe_table, table, schema, dsn)
        except PgQueryError as e:
            raise ValueError(str(e)) from e
        return json.dumps(info, ensure_ascii=False, default=str)

    @mcp_pg.tool()
    async def postgres_count(
        table: str,
        schema: str = "public",
        where: Optional[str] = None,
        dsn: Optional[str] = None,
    ) -> str:
        """件数取得（`where` 内の `;` は禁止）"""
        try:
            info = await asyncio.to_thread(get_pg().count, table, schema, where, dsn)
        except PgQueryError as e:
            raise ValueError(str(e)) from e
        return json.dumps(info, ensure_ascii=False, default=str)

    @mcp_pg.tool()
    async def postgres_query(
        sql: str,
        params: Optional[list] = None,
        max_rows: int = 200,
        allow_write: bool = False,
        dsn: Optional[str] = None,
    ) -> str:
        """
        任意 SQL を実行。既定は読み取り専用トランザクション。
        複数ステートメント不可。書き込みは allow_write=True が必要。
        """
        try:
            result = await asyncio.to_thread(
                get_pg().query, sql, params, max_rows, allow_write, dsn
            )
        except PgQueryError as e:
            raise ValueError(str(e)) from e
        return json.dumps(result, ensure_ascii=False, default=str)


# ================================================================== #
# HTTP ルート
# ================================================================== #

def create_sqlite_router(sqlite_q) -> APIRouter:
    """aidiy_sqlite HTTP APIRouter を作成して返す"""
    router = APIRouter(tags=["aidiy_sqlite"])

    @router.get("/aidiy_sqlite/docs", summary="aidiy_sqlite ドキュメント")
    async def http_sqlite_docs() -> dict:
        return {
            "service": "aidiy_sqlite",
            "description": "AiDiy SQLite DB を操作する。テーブル探索・スキーマ確認・件数取得・任意 SQL 実行を提供する。日本語テーブル名・カラム名に対応。",
            "endpoint": "POST /aidiy_sqlite/{method_name}",
            "content_type": "application/json",
            "methods": {
                "list_tables": {
                    "summary": "テーブル・VIEW 一覧取得",
                    "description": "AiDiy DB に存在する全テーブルと VIEW の一覧を返す。どんなテーブルがあるか把握するための第一歩。",
                    "parameters": {},
                    "example_request": {},
                    "response_fields": {"tables": "配列 [{name, type}, ...]"},
                },
                "describe_table": {
                    "summary": "テーブルスキーマ詳細取得",
                    "description": "指定テーブルの列定義・PRIMARY KEY・FOREIGN KEY・インデックス・現在の件数を返す。INSERT/SELECT の前にスキーマを確認するために使う。",
                    "parameters": {
                        "table_name": {"type": "string", "required": True, "description": "テーブル名（日本語可。例: 'C利用者' / 'T配車'）"},
                    },
                    "example_request": {"table_name": "C利用者"},
                    "response_fields": {"columns": "列定義配列", "primary_keys": "PK 列名リスト", "foreign_keys": "FK 定義", "indexes": "インデックス", "count": "現在の件数"},
                },
                "count": {
                    "summary": "件数取得",
                    "description": "指定テーブルの行数を返す。WHERE 句を指定すれば条件付き件数も取得できる。`;` を含む WHERE 句は拒否される。",
                    "parameters": {
                        "table_name": {"type": "string", "required": True, "description": "テーブル名"},
                        "where": {"type": "string", "required": False, "description": "SQL WHERE 節（例: '利用者ID = 1'）。`;` 禁止"},
                    },
                    "example_request": {"table_name": "T配車", "where": "配車日付 >= '2026-01-01'"},
                    "response_fields": {"count": "件数", "table_name": "テーブル名"},
                },
                "query": {
                    "summary": "任意 SQL 実行",
                    "description": "SELECT を実行して行を返す。デフォルトは読み取り専用。INSERT/UPDATE/DELETE は allow_write=true を明示する必要がある。複数ステートメント不可。",
                    "parameters": {
                        "sql": {"type": "string", "required": True, "description": "SQL 文（単一ステートメント）。例: 'SELECT * FROM C利用者 WHERE 利用者ID = ?'"},
                        "params": {"type": "array", "required": False, "description": "バインドパラメータ配列。例: [1]"},
                        "max_rows": {"type": "integer", "required": False, "default": 200, "description": "最大取得行数（上限 200）"},
                        "allow_write": {"type": "boolean", "required": False, "default": False, "description": "True で INSERT/UPDATE/DELETE を許可"},
                    },
                    "example_request": {"sql": "SELECT 利用者ID, 利用者名 FROM C利用者 ORDER BY 利用者ID LIMIT 10"},
                    "response_fields": {"rows": "行データ配列", "columns": "列名リスト", "row_count": "取得行数"},
                },
                "audit_summary": {
                    "summary": "監査フィールド直近 N 件取得",
                    "description": "登録日時・更新日時などの監査フィールドを持つテーブルの直近 N 件を更新日時降順で返す。誰がいつ操作したか確認するために使う。",
                    "parameters": {
                        "table_name": {"type": "string", "required": True, "description": "テーブル名"},
                        "limit": {"type": "integer", "required": False, "default": 5, "description": "取得件数（デフォルト 5）"},
                    },
                    "example_request": {"table_name": "T配車", "limit": 10},
                    "response_fields": {"rows": "直近 N 件の行データ", "table_name": "テーブル名"},
                },
            },
        }

    @router.post("/aidiy_sqlite/{method_name}", summary="SQLite 操作")
    async def http_sqlite(method_name: str, req: SqliteRequest = SqliteRequest()) -> dict:
        """
        | method_name | 説明 |
        |---|---|
        | list_tables | テーブル一覧 |
        | describe_table | テーブルスキーマ |
        | count | 件数取得 |
        | query | SQL 実行 |
        | audit_summary | 監査フィールド直近 N 件 |
        """
        try:
            if method_name == "list_tables":
                result = await asyncio.to_thread(sqlite_q.list_tables)
                return {"tables": result}
            elif method_name == "describe_table":
                if not req.table_name:
                    return {"error": "table_name は必須です"}
                result = await asyncio.to_thread(sqlite_q.describe_table, req.table_name)
                return result if isinstance(result, dict) else {"result": result}
            elif method_name == "count":
                if not req.table_name:
                    return {"error": "table_name は必須です"}
                result = await asyncio.to_thread(sqlite_q.count, req.table_name, req.where)
                return result if isinstance(result, dict) else {"result": result}
            elif method_name == "query":
                if not req.sql:
                    return {"error": "sql は必須です"}
                result = await asyncio.to_thread(sqlite_q.query, req.sql, req.params, req.max_rows, req.allow_write)
                return result if isinstance(result, dict) else {"result": result}
            elif method_name == "audit_summary":
                if not req.table_name:
                    return {"error": "table_name は必須です"}
                result = await asyncio.to_thread(sqlite_q.audit_summary, req.table_name, req.limit)
                return result if isinstance(result, dict) else {"result": result}
            else:
                return {"error": f"未知のメソッド: {method_name}"}
        except SqliteQueryError as e:
            logger.warning(f"http_sqlite [{method_name}] error: {e}")
            return {"error": str(e)}

    return router


def create_postgres_router(get_pg) -> APIRouter:
    """aidiy_postgres HTTP APIRouter を作成して返す"""
    router = APIRouter(tags=["aidiy_postgres"])

    @router.get("/aidiy_postgres/docs", summary="aidiy_postgres ドキュメント")
    async def http_postgres_docs() -> dict:
        return {
            "service": "aidiy_postgres",
            "description": "PostgreSQL DB を操作する。デフォルト接続先は AiDiy_key.json の postgres 設定。dsn を指定すれば別の DB にも接続できる。",
            "endpoint": "POST /aidiy_postgres/{method_name}",
            "content_type": "application/json",
            "dsn_format": "postgresql://user:password@host:port/dbname",
            "methods": {
                "server_info": {
                    "summary": "PostgreSQL サーバー情報取得",
                    "description": "接続先 PostgreSQL のバージョン・現在 DB・ユーザー・接続パラメータを返す。接続確認の第一歩として使う。",
                    "parameters": {
                        "dsn": {"type": "string", "required": False, "description": "接続文字列（省略時は AiDiy_key.json の設定を使用）"},
                    },
                    "example_request": {},
                    "response_fields": {"version": "PostgreSQL バージョン", "database": "現在の DB 名", "user": "接続ユーザー"},
                },
                "list_databases": {
                    "summary": "DB 一覧取得",
                    "description": "テンプレート DB を除くデータベース一覧を返す。",
                    "parameters": {
                        "dsn": {"type": "string", "required": False, "description": "接続文字列（省略時はデフォルト接続）"},
                    },
                    "example_request": {},
                    "response_fields": {"databases": "配列 [{name, owner, encoding}, ...]"},
                },
                "list_schemas": {
                    "summary": "スキーマ一覧取得",
                    "description": "ユーザー定義スキーマ一覧を返す（pg_catalog / information_schema は除外）。",
                    "parameters": {
                        "dsn": {"type": "string", "required": False},
                    },
                    "example_request": {},
                    "response_fields": {"schemas": "配列 [{name, owner}, ...]"},
                },
                "list_tables": {
                    "summary": "テーブル・VIEW 一覧取得",
                    "description": "指定スキーマのテーブルと VIEW の一覧を返す。",
                    "parameters": {
                        "schema_name": {"type": "string", "required": False, "default": "public", "description": "スキーマ名"},
                        "dsn": {"type": "string", "required": False},
                    },
                    "example_request": {"schema_name": "public"},
                    "response_fields": {"tables": "配列 [{name, type, schema}, ...]"},
                },
                "describe_table": {
                    "summary": "テーブルスキーマ詳細取得",
                    "description": "列情報・PK・FK・件数を返す。INSERT/SELECT の前のスキーマ確認に使う。",
                    "parameters": {
                        "table": {"type": "string", "required": True, "description": "テーブル名"},
                        "schema_name": {"type": "string", "required": False, "default": "public"},
                        "dsn": {"type": "string", "required": False},
                    },
                    "example_request": {"table": "users", "schema_name": "public"},
                    "response_fields": {"columns": "列定義配列", "primary_keys": "PK 列名", "foreign_keys": "FK 定義", "count": "件数"},
                },
                "count": {
                    "summary": "件数取得",
                    "description": "指定テーブルの行数を返す。WHERE 句で絞り込みも可能。`;` を含む WHERE 句は拒否される。",
                    "parameters": {
                        "table": {"type": "string", "required": True, "description": "テーブル名"},
                        "schema_name": {"type": "string", "required": False, "default": "public"},
                        "where": {"type": "string", "required": False, "description": "SQL WHERE 節（例: 'status = 1'）。`;` 禁止"},
                        "dsn": {"type": "string", "required": False},
                    },
                    "example_request": {"table": "orders", "where": "created_at >= '2026-01-01'"},
                    "response_fields": {"count": "件数", "table": "テーブル名"},
                },
                "query": {
                    "summary": "任意 SQL 実行",
                    "description": "SELECT を実行して行を返す。デフォルトは読み取り専用トランザクション。INSERT/UPDATE/DELETE は allow_write=true が必要。複数ステートメント不可。",
                    "parameters": {
                        "sql": {"type": "string", "required": True, "description": "SQL 文（単一ステートメント）"},
                        "params": {"type": "array", "required": False, "description": "バインドパラメータ配列。例: [1, 'active']"},
                        "max_rows": {"type": "integer", "required": False, "default": 200, "description": "最大取得行数"},
                        "allow_write": {"type": "boolean", "required": False, "default": False, "description": "True で INSERT/UPDATE/DELETE を許可"},
                        "dsn": {"type": "string", "required": False},
                    },
                    "example_request": {"sql": "SELECT id, name FROM users WHERE active = $1 LIMIT 10", "params": [True]},
                    "response_fields": {"rows": "行データ配列", "columns": "列名リスト", "row_count": "取得行数"},
                },
            },
        }

    @router.post("/aidiy_postgres/{method_name}", summary="PostgreSQL 操作")
    async def http_postgres(method_name: str, req: PostgresRequest = PostgresRequest()) -> dict:
        """
        | method_name | 説明 |
        |---|---|
        | server_info | サーバー情報 |
        | list_databases | DB 一覧 |
        | list_schemas | スキーマ一覧 |
        | list_tables | テーブル一覧 |
        | describe_table | テーブルスキーマ |
        | count | 件数取得 |
        | query | SQL 実行 |
        """
        try:
            pg = get_pg()
            if method_name == "server_info":
                result = await asyncio.to_thread(pg.server_info, req.dsn)
                return result if isinstance(result, dict) else {"result": result}
            elif method_name == "list_databases":
                result = await asyncio.to_thread(pg.list_databases, req.dsn)
                return {"databases": result}
            elif method_name == "list_schemas":
                result = await asyncio.to_thread(pg.list_schemas, req.dsn)
                return {"schemas": result}
            elif method_name == "list_tables":
                result = await asyncio.to_thread(pg.list_tables, req.schema_name, req.dsn)
                return {"tables": result}
            elif method_name == "describe_table":
                if not req.table:
                    return {"error": "table は必須です"}
                result = await asyncio.to_thread(pg.describe_table, req.table, req.schema_name, req.dsn)
                return result if isinstance(result, dict) else {"result": result}
            elif method_name == "count":
                if not req.table:
                    return {"error": "table は必須です"}
                result = await asyncio.to_thread(pg.count, req.table, req.schema_name, req.where, req.dsn)
                return result if isinstance(result, dict) else {"result": result}
            elif method_name == "query":
                if not req.sql:
                    return {"error": "sql は必須です"}
                result = await asyncio.to_thread(pg.query, req.sql, req.params, req.max_rows, req.allow_write, req.dsn)
                return result if isinstance(result, dict) else {"result": result}
            else:
                return {"error": f"未知のメソッド: {method_name}"}
        except Exception as e:
            logger.warning(f"http_postgres [{method_name}] error: {e}")
            return {"error": str(e)}

    return router
