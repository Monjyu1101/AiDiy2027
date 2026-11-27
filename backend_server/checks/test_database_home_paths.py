# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE for full terms.
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from sqlalchemy import inspect

import database
from database_paths import database_dir, database_path
from apps_crud.日誌DB import 日誌DB初期化


class DatabaseHomePathTest(unittest.TestCase):
    def test_first_use_creates_only_the_three_current_home_databases(self):
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory) / "project"
            home = Path(directory) / "home"
            old = project / "_data" / "AiDiy" / "core_v20261101.db"
            old.parent.mkdir(parents=True)
            old.write_bytes(b"keep")
            with patch.object(Path, "home", return_value=home):
                names = {"core": "core_v20261101.db", "apps": "apps_v20261101.db", "diary": "diary_v20261128.db"}
                paths = {kind: database_path(kind) for kind in names}
                self.assertEqual(paths, {kind: home / ".aidiy" / "datas" / name for kind, name in names.items()})
                self.assertFalse(database_dir().exists(), "パス取得だけでは保存先を作らない")
                for kind in ("core", "apps"):
                    engine = database._engine(str(paths[kind]))
                    try:
                        self.assertFalse(paths[kind].exists())
                        self.assertEqual(inspect(engine).get_table_names(), [])
                    finally:
                        engine.dispose()
                diary = 日誌DB初期化()
                try:
                    self.assertEqual(set(inspect(diary).get_table_names()), {"T日誌作業", "T日誌明細"})
                finally:
                    diary.dispose()
                self.assertEqual({path.name for path in database_dir().glob("*.db")}, set(names.values()))
            self.assertEqual(old.read_bytes(), b"keep")
