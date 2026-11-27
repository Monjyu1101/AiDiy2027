# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE for full terms.
from contextlib import closing
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from tools_proc import sqlite_query, tools_db


class SqliteDatabaseSelectionTests(unittest.TestCase):
    def test_http_selects_only_current_apps_or_core(self):
        with tempfile.TemporaryDirectory(prefix="AiDiy 日本語 ") as directory:
            root = Path(directory)
            db_dir = root / ".aidiy" / "datas"
            db_dir.mkdir(parents=True)
            old = root / "_data" / "AiDiy" / "core_v20261101.db"
            old.parent.mkdir(parents=True)
            old.write_bytes(b"do not use")
            with patch.object(Path, "home", return_value=root):
                apps = sqlite_query.SqliteQuery()
                core = apps.for_database("core")
                self.assertEqual(Path(apps.db_path), db_dir / "apps_v20261101.db")
                self.assertEqual(Path(core.db_path), db_dir / "core_v20261101.db")
                with self.assertRaisesRegex(sqlite_query.SqliteQueryError, "core_v20261101"):
                    core.list_tables()
                for query, table in ((apps, "T配車"), (core, "C採番")):
                    with closing(sqlite3.connect(query.db_path)) as conn:
                        conn.execute(f"CREATE TABLE {table} (id INTEGER PRIMARY KEY)")
                app = FastAPI()
                app.include_router(tools_db.create_sqlite_router(apps))
                with TestClient(app) as client:
                    url = "/aidiy_sqlite/list_tables"
                    self.assertEqual(client.post(url, json={}).json()["tables"], [{"name": "T配車", "type": "table"}])
                    self.assertEqual(client.post(url, json={"database": "core"}).json()["tables"], [{"name": "C採番", "type": "table"}])
                    self.assertEqual(client.post(url, json={"database": "database.db"}).status_code, 422)
            self.assertEqual(old.read_bytes(), b"do not use")
