"""Appsの日誌APIを、一時ホーム・業務DB・署名鍵で検証する。"""
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE for full terms.
import base64
import json
import sqlite3
import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack, closing
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient
from sqlalchemy import URL, create_engine, inspect
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import auth
import database
from apps_crud.utils import create_audit_fields
from apps_router import T日誌
from apps_schema.T日誌 import T日誌保存要求
from auth_keyring import CoreKeyring
from core_models import C利用者

PREFIX = "/apps/T日誌/"
DATE = "2026-11-26"
PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII="


def sample(日付=DATE):
    return {
        "日付": 日付,
        "記録": [
            {
                "記録SEQ": 1,
                "記録タイトル": "  作業メモ  ",
                "明細": [
                    {"行SEQ": 1, "内容": "更新した\n次はレビュー"},
                    {"行SEQ": 2, "内容": "画像", "添付": [{"ファイル名": "画像.png", "base64内容": PNG}]},
                ],
            },
            {"記録SEQ": 2, "記録タイトル": "見出しだけ", "明細": []},
        ],
    }


class 日誌Tests(unittest.TestCase):
    def setUp(self):
        stack = ExitStack()
        self.addCleanup(stack.close)
        self.home = Path(stack.enter_context(tempfile.TemporaryDirectory()))
        self.path = self.home / ".aidiy" / "diary" / "diary_v2.db"
        shared_engine = create_engine(URL.create("sqlite+pysqlite", database=str(self.home / "業務.db")))
        stack.callback(shared_engine.dispose)
        factory = sessionmaker(bind=shared_engine)
        stack.enter_context(patch.object(database, "engine", shared_engine))
        stack.enter_context(patch.object(database, "SessionLocal", factory))
        stack.enter_context(patch.object(Path, "home", return_value=self.home))
        import apps_main

        self.app = apps_main.app
        stack.enter_context(patch.object(apps_main, "__file__", str(self.home / "apps_main.py")))
        stack.enter_context(patch.object(apps_main, "threading", SimpleNamespace(Thread=Mock())))
        stack.enter_context(patch.object(apps_main, "setup_logging"))
        stack.enter_context(patch.object(apps_main.app_conf, "init", return_value=False))
        stack.enter_context(patch.object(apps_main.apps_crud, "init_db_data"))
        keyring = CoreKeyring(self.home)
        keyring.initialize()
        stack.enter_context(patch.object(auth, "_keyring", keyring))
        C利用者.__table__.create(shared_engine)
        with factory.begin() as db:
            for id_, name, active in [("one", "利用者A", True), ("two", "利用者B", True), ("off", "停止中", False)]:
                db.add(C利用者(利用者ID=id_, 利用者名=name, パスワード="fixture", 権限ID="USER", 有効=active, **create_audit_fields()))
        self.tokens = {name: keyring.issue_normal({"sub": name}) for name in ("one", "two", "off")}
        self.tokens["internal"] = json.loads(keyring.token_path.read_text(encoding="utf-8"))["access_token"]
        self.assertFalse(self.path.exists(), "importだけでは日誌DBを作らない")
        self.assertFalse(any(name.startswith("T日誌") for name in inspect(shared_engine).get_table_names()))
        self.lifecycle = stack.enter_context(ExitStack())
        self.client = self.lifecycle.enter_context(TestClient(self.app, raise_server_exceptions=False))
        self.assertTrue(self.path.is_file())
        with closing(sqlite3.connect(self.path)) as db:
            self.assertEqual({r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}, {"T日誌作業", "T日誌明細"})

    def call(self, operation, body=None, user="one"):
        headers = {"Authorization": "Bearer " + self.tokens[user]} if user else {}
        if operation == "変更" and "更新版" not in body:
            current = self.call("取得", {"日付": body["日付"]}, user=user).json().get("data") or {}
            body = {**body, "更新版": current.get("更新版", "0" * 64)}
        return self.client.post(PREFIX + operation, headers=headers, json=body)

    def test_保存と再読込_一覧に添付なし_利用者単位(self):
        payload = sample()
        新規 = self.call("登録", payload).json()["data"]
        self.assertEqual(新規["利用者ID"], "one")
        self.assertEqual(新規["利用者名"], "利用者A")
        self.assertEqual(新規["記録"][0]["記録タイトル"], "作業メモ")
        self.assertEqual(新規["記録"][0]["明細"][1]["添付"][0]["base64内容"], PNG)
        self.assertEqual(self.call("登録", payload).json()["error"]["code"], "DUPLICATE")
        self.assertEqual(self.call("一覧").json()["data"], {
            "items": [{"日付": DATE, "利用者ID": "one", "利用者名": "利用者A", "記録件数": 2}],
            "total": 1,
            "limit": 1000,
        })
        self.assertEqual(self.call("一覧", {"終了日付": "2026-11-25"}).json()["data"]["items"], [])
        self.assertIsNone(self.call("一覧", {"件数制限": False}).json()["data"]["limit"])
        self.assertEqual(self.call("一覧", user="two").json()["data"]["items"], [])
        for op in ("取得", "変更", "削除"):
            body = payload if op == "変更" else {"日付": DATE}
            self.assertEqual(self.call(op, body, user="two").json()["error"]["code"], "NOT_FOUND")
        self.assertEqual(self.call("登録", payload, user="two").json()["data"]["利用者名"], "利用者B")
        self.assertEqual(self.call("取得", {"日付": DATE}).json()["data"], 新規)
        self.lifecycle.close()
        self.client = self.lifecycle.enter_context(TestClient(self.app, raise_server_exceptions=False))
        self.assertEqual(self.call("取得", {"日付": DATE}).json()["data"], 新規)

    def test_変更削除は関連行まで反映(self):
        self.assertEqual(self.call("登録", sample()).json()["status"], "OK")
        small = {"日付": DATE, "記録": [{"記録SEQ": 1, "記録タイトル": "差し替え"}]}
        result = self.call("変更", small).json()
        self.assertEqual(result["data"]["記録"], [{"記録SEQ": 1, "記録タイトル": "差し替え", "新規更新ファイル数": None, "明細": []}])
        with closing(sqlite3.connect(self.path)) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM T日誌明細").fetchone()[0], 0)
        self.assertEqual(self.call("削除", {"日付": DATE}).json()["status"], "OK")
        with closing(sqlite3.connect(self.path)) as db:
            for table in ("T日誌作業", "T日誌明細"):
                self.assertEqual(db.execute(f"SELECT count(*) FROM {table}").fetchone()[0], 0)
        self.assertEqual(self.call("登録", sample()).json()["status"], "OK")

    def test_明細書込失敗で変更を巻き戻す(self):
        original = self.call("登録", sample()).json()["data"]
        with closing(sqlite3.connect(self.path)) as db:
            db.execute("""CREATE TRIGGER fail_fixture BEFORE INSERT ON T日誌明細
                          BEGIN SELECT RAISE(ABORT, 'fixture rollback'); END""")
            db.commit()
        changed = sample()
        changed["記録"][0]["記録タイトル"] = "途中失敗"
        response = self.call("変更", changed)
        self.assertEqual(response.status_code, 500)
        self.assertEqual(self.call("取得", {"日付": DATE}).json()["data"], original)

    def test_認証_無効利用者_内部トークン(self):
        self.assertEqual(self.call("一覧", user=None).status_code, 401)
        self.assertEqual(self.call("一覧", user="off").status_code, 403)
        self.assertEqual(self.call("一覧", user="internal").status_code, 403)

    def test_入力検証とエラーへの内容非表示(self):
        for payload in [
            sample("2026-02-30"),
            {**sample(), "利用者ID": "two"},
            {"日付": DATE, "記録": [{"記録SEQ": 2, "記録タイトル": "順番"}]},
        ]:
            result = self.call("登録", payload)
            self.assertEqual(result.status_code, 422)
            self.assertEqual(result.json()["error"]["code"], "VALIDATION_ERROR")
        payload = sample()
        line = payload["記録"][0]["明細"][1]["添付"][0]
        line["base64内容"] = "do not reflect this %%"
        result = self.call("登録", payload)
        self.assertEqual(result.status_code, 422)
        self.assertNotIn(line["base64内容"], result.text)
        line["base64内容"] = PNG
        line["ファイル名"] = "../画像.png"
        self.assertEqual(self.call("登録", payload).status_code, 422)
        self.assertEqual(self.call("一覧").json()["data"]["total"], 0)
        self.assertEqual(self.call("一覧", {"開始日付": DATE, "終了日付": "2026-11-25"}).status_code, 422)
        with patch.object(T日誌, "日誌本文上限", 100):
            result = self.call("登録", sample())
            self.assertEqual(result.status_code, 413)
            self.assertEqual(result.json()["error"]["code"], "PAYLOAD_TOO_LARGE")

    def test_部分操作_添付維持_連番_所有者境界(self):
        def run(op, **body):
            result = self.call(op, {"日付": DATE, **body}).json()
            self.assertEqual(result["status"], "OK", result)
            return result["data"]

        self.assertEqual(run("作業登録", 記録タイトル="初回")["記録SEQ"], 1)
        self.assertEqual(run("作業登録", 記録タイトル="次回")["記録SEQ"], 2)
        self.assertEqual(run("内容登録", 記録SEQ=2, 内容="先頭")["行SEQ"], 1)
        self.assertEqual(run("内容登録", 記録SEQ=2, 内容="画像", 添付=[{"ファイル名": "進捗.png", "base64内容": PNG}])["行SEQ"], 2)
        run("作業変更", 記録SEQ=2, 記録タイトル="進捗 100%")
        run("内容変更", 記録SEQ=2, 行SEQ=2, 内容="確認済み")
        run("内容削除", 記録SEQ=2, 行SEQ=1)
        run("作業削除", 記録SEQ=1)
        denied = self.call("作業削除", {"日付": DATE, "記録SEQ": 1}, user="two").json()
        self.assertEqual(denied["error"]["code"], "NOT_FOUND")
        entry = run("取得")["記録"][0]
        self.assertEqual(entry, {"記録SEQ": 1, "記録タイトル": "進捗 100%", "新規更新ファイル数": None, "明細": [
            {"行SEQ": 1, "内容": "確認済み",
             "添付": [{"ファイル名": "進捗.png", "base64内容": PNG}]},
        ]})
        run("内容変更", 記録SEQ=1, 行SEQ=1, 添付=[])
        self.assertEqual(run("取得")["記録"][0]["明細"][0]["添付"], [])
        run("作業削除", 記録SEQ=1)
        self.assertEqual(self.call("取得", {"日付": DATE}).json()["error"]["code"], "NOT_FOUND")
        self.assertEqual(run("作業登録", 記録タイトル="再開")["記録SEQ"], 1)

    def test_検索_日付順_キーワード_ページング_添付非公開(self):
        self.assertEqual(self.call("登録", sample()).json()["status"], "OK")
        another = sample("2026-11-25")
        another["記録"][0]["記録タイトル"] = "完了率 100%"
        self.assertEqual(self.call("登録", another).json()["status"], "OK")
        for keyword, total in [("レビュー", 2), ("画像.png", 2), ("100%", 1), ("%", 1), ("_", 0)]:
            r = self.call("検索", {"キーワード": keyword, "limit": 1}).json()
            self.assertEqual(r["data"]["total"], total, keyword)
            self.assertNotIn(PNG, json.dumps(r))
            self.assertNotIn("base64内容", json.dumps(r, ensure_ascii=False))
        self.assertEqual(self.call("検索", {"offset": 1, "limit": 1}).json()["data"]["items"][0]["日付"], "2026-11-25")
        self.assertEqual(self.call("検索", {"開始日付": DATE}).json()["data"]["items"][0]["日付"], DATE)
        self.assertEqual(self.call("検索", {}, user="two").json()["data"]["items"], [])
        self.assertEqual(self.call("検索", {}, user="internal").status_code, 403)

    def test_部分操作_不正添付と空の新規を保存しない(self):
        bad = self.call("作業登録", {"日付": DATE, "記録タイトル": "   "}).json()
        self.assertEqual(bad["error"]["code"], "VALIDATION_ERROR")
        self.assertEqual(self.call("取得", {"日付": DATE}).json()["error"]["code"], "NOT_FOUND")
        original = self.call("登録", sample()).json()["data"]
        bad = self.call("内容変更", {"日付": DATE, "記録SEQ": 1, "行SEQ": 2,
                                    "添付": [{"ファイル名": "new.png", "base64内容": "SECRET!!!"}]})
        self.assertEqual(bad.json()["error"]["code"], "VALIDATION_ERROR")
        self.assertNotIn("SECRET!!!", bad.text)
        self.assertEqual(self.call("取得", {"日付": DATE}).json()["data"], original)

    def test_同時に作業を追加しても一日一件で連番を採番(self):
        def add(number):
            return self.call("作業登録", {"日付": DATE, "記録タイトル": f"作業{number}"}).json()

        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(add, range(8)))
        self.assertEqual(sorted(r["data"]["記録SEQ"] for r in results if r["status"] == "OK"), list(range(1, 9)))
        listing = self.call("一覧").json()["data"]
        self.assertEqual(listing["total"], 1)
        self.assertEqual(listing["items"][0]["記録件数"], 8)

    def test_複数添付と自己申告は並替えと再起動後も維持(self):
        添付 = [{"ファイル名": "画像.png", "base64内容": PNG}, {"ファイル名": "説明.txt", "base64内容": "YWJj"}]
        body = {"日付": DATE, "記録": [
            {"記録SEQ": 1, "記録タイトル": "先頭", "新規更新ファイル数": None},
            {"記録SEQ": 2, "記録タイトル": "測定", "新規更新ファイル数": 0, "明細": [
                {"行SEQ": 1, "内容": "先頭行", "添付": []},
                {"行SEQ": 2, "内容": "", "添付": 添付},
            ]},
        ]}
        self.assertEqual(self.call("登録", body).json()["status"], "OK")
        self.assertEqual(self.call("検索", {"キーワード": "説明.txt"}).json()["data"]["total"], 1)
        self.assertNotIn(PNG, self.call("検索", {}).text)
        keys = {"日付": DATE, "記録SEQ": 2, "行SEQ": 2}
        self.assertEqual(self.call("内容変更", {**keys, "内容": "確認済み"}).json()["status"], "OK")
        self.assertEqual(self.call("内容変更", {**keys, "ファイル名": "", "base64内容": ""}).json()["error"]["code"], "VALIDATION_ERROR")
        self.assertEqual(self.call("内容削除", {**keys, "行SEQ": 1}).json()["status"], "OK")
        self.assertEqual(self.call("作業削除", {"日付": DATE, "記録SEQ": 1}).json()["status"], "OK")
        self.lifecycle.close()
        self.client = self.lifecycle.enter_context(TestClient(self.app, raise_server_exceptions=False))
        data = self.call("取得", {"日付": DATE}).json()["data"]
        self.assertEqual(data["記録"], [
            {"記録SEQ": 1, "記録タイトル": "測定", "新規更新ファイル数": 0,
             "明細": [{"行SEQ": 1, "内容": "確認済み", "添付": 添付}]},
        ])
        self.assertEqual(self.call("作業変更", {"日付": DATE, "記録SEQ": 1, "記録タイトル": "別名"}).json()["status"], "OK")
        self.assertEqual(self.call("取得", {"日付": DATE}).json()["data"]["記録"][0]["新規更新ファイル数"], 0)
        self.assertEqual(self.call("作業変更", {"日付": DATE, "記録SEQ": 1, "記録タイトル": "別名",
                                              "新規更新ファイル数": None}).json()["status"], "OK")
        self.assertIsNone(self.call("取得", {"日付": DATE}).json()["data"]["記録"][0]["新規更新ファイル数"])
        self.assertEqual(self.call("変更", {"日付": DATE, "記録": [
            {"記録SEQ": 1, "記録タイトル": "添付を外した"},
        ]}).json()["status"], "OK")

    def test_旧DBを読まず新DBを使い_旧形式を拒否(self):
        self.lifecycle.close()
        old = self.path.with_name("diary.db")
        sentinel = b"fixture: this file must not be read or modified"
        old.write_bytes(sentinel)
        self.client = self.lifecycle.enter_context(TestClient(self.app, raise_server_exceptions=False))
        self.assertEqual(self.call("一覧").json()["data"]["items"], [])
        self.assertEqual(old.read_bytes(), sentinel)
        body = sample()
        body["記録"][0]["明細"][1] = {"行SEQ": 2, "ファイル名": "旧画像.png", "base64内容": PNG}
        self.assertEqual(self.call("登録", body).status_code, 422)
        for value in [-1, 1.25, True]:
            result = self.call("作業変更", {"日付": DATE, "記録SEQ": 1, "記録タイトル": "作業",
                                         "新規更新ファイル数": value})
            self.assertEqual(result.status_code, 422)

    def test_ツール更新後の古い画面保存を拒否(self):
        body = sample()
        body["記録"][0]["新規更新ファイル数"] = 0
        body["記録"][0]["明細"][1]["添付"].append({"ファイル名": "同じ行.pdf", "base64内容": "YWJj"})
        before = self.call("登録", body).json()["data"]
        keys = {"日付": DATE, "記録SEQ": 1, "行SEQ": 2}
        self.assertEqual(self.call("内容変更", {**keys, "内容": "ツール側で変更"}).json()["status"], "OK")
        stale = self.call("変更", {**body, "更新版": before["更新版"]}).json()
        self.assertEqual(stale["error"]["code"], "CONFLICT")
        now = self.call("取得", {"日付": DATE}).json()["data"]
        work = now["記録"][0]
        self.assertEqual(work["明細"][1]["内容"], "ツール側で変更")
        self.assertEqual(work["明細"][1]["添付"], body["記録"][0]["明細"][1]["添付"])
        self.assertEqual(work["新規更新ファイル数"], 0)
        self.assertIsNone(now["記録"][1]["新規更新ファイル数"])
        self.assertEqual(self.call("変更", {"日付": DATE, "記録": now["記録"],
                                           "更新版": now["更新版"]}).json()["status"], "OK")

    def test_添付容量制限(self):
        for size, count in [(5 * 1024 * 1024 + 1, 1), (4 * 1024 * 1024, 4)]:
            encoded = base64.b64encode(bytes(size)).decode("ascii")
            payload = sample()
            payload["記録"][0]["明細"] = [
                {"行SEQ": i, "添付": [{"ファイル名": f"{i}.bin", "base64内容": encoded}]} for i in range(1, count + 1)
            ]
            with self.assertRaises(ValueError):
                T日誌保存要求.model_validate(payload)


if __name__ == "__main__":
    unittest.main()
