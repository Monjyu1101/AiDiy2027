"""Appsの日誌APIを、一時ホーム・業務DB・署名鍵で検証する。"""
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE for full terms.
import base64
import json
import shutil
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
from core_models import C利用者, C採番

PREFIX = "/apps/T日誌/"
DATE = "2026-11-26"
PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII="


def sample(日誌日付=DATE):
    return {
        "日誌日付": 日誌日付,
        "記録": [
            {
                "作業タイトル": "  作業メモ  ",
                "明細": [
                    {"行番号": 1, "作業内容": "更新した\n次はレビュー"},
                    {"行番号": 2, "作業内容": "画像", "添付": [{"ファイル名": "画像.png", "base64内容": PNG}]},
                ],
            },
            {"作業タイトル": "見出しだけ", "明細": []},
        ],
    }


class 日誌Tests(unittest.TestCase):
    def setUp(self):
        stack = ExitStack()
        self.addCleanup(stack.close)
        self.home = Path(stack.enter_context(tempfile.TemporaryDirectory()))
        self.path = self.home / ".aidiy" / "datas" / "diary_v20261128.db"
        self.business_path = self.home / "core_v20261101.db"
        self.apps_path = self.home / "apps_v20261101.db"
        core_engine = create_engine(URL.create("sqlite+pysqlite", database=str(self.business_path)))
        apps_engine = create_engine(URL.create("sqlite+pysqlite", database=str(self.apps_path)))
        stack.callback(core_engine.dispose)
        stack.callback(apps_engine.dispose)
        factory = sessionmaker(bind=core_engine)
        stack.enter_context(patch.object(database, "engine", core_engine))
        stack.enter_context(patch.object(database, "apps_engine", apps_engine))
        stack.enter_context(patch.object(database, "SessionLocal", factory))
        stack.enter_context(patch.object(database, "AppsSessionLocal", sessionmaker(bind=apps_engine)))
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
        database.initialize_core_tables()
        database.AppsBase.metadata.create_all(apps_engine)
        with factory.begin() as db:
            for id_, name, active in [("one", "利用者A", True), ("two", "利用者B", True), ("off", "停止中", False)]:
                db.add(C利用者(利用者ID=id_, 利用者名=name, パスワード="fixture", 権限ID="USER", 有効=active, **create_audit_fields()))
        self.tokens = {name: keyring.issue_normal({"sub": name}) for name in ("one", "two", "off")}
        self.tokens["internal"] = json.loads(keyring.token_path.read_text(encoding="utf-8"))["access_token"]
        self.assertFalse(self.path.exists(), "importだけでは日誌DBを作らない")
        for engine in (core_engine, apps_engine):
            self.assertFalse(any(name.startswith("T日誌") for name in inspect(engine).get_table_names()))
        self.lifecycle = stack.enter_context(ExitStack())
        self.client = self.lifecycle.enter_context(TestClient(self.app, raise_server_exceptions=False))
        self.assertTrue(self.path.is_file())
        with closing(sqlite3.connect(self.path)) as db:
            self.assertEqual({r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}, {"T日誌作業", "T日誌明細"})

    def post_apps(self, path, body):
        response = self.client.post(
            "/apps/" + path, json=body, headers={"Authorization": "Bearer " + self.tokens["one"]},
        )
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        self.assertEqual(result["status"], "OK", result)
        return result["data"]

    def test_業務DBを分離しても配車と生産の予定を移動して読み直せる(self):
        from core_crud.C採番 import init_C採番_data
        with database.SessionLocal() as db:
            init_C採番_data(db)
        for kind, resource, fields in [
            ("配車", "車両ID", {}),
            ("生産", "生産工程ID", {"受入商品ID": "ITEM", "最小ロット数量": 1}),
        ]:
            with self.subTest(予定=kind):
                id_key = kind + "伝票ID"
                item = self.post_apps(f"T{kind}/登録", {
                    resource: "DEMO", **fields,
                    kind + "開始日時": DATE + " 08:00:00", kind + "終了日時": DATE + " 09:00:00",
                })
                key = item[id_key]
                daily_path = f"S{kind}_日表示/{kind}一覧"
                before, = self.post_apps(daily_path, {"対象日付": DATE})[kind + "一覧"]
                self.assertEqual(before[id_key], key)
                self.assertEqual(before[kind + "開始日時"][:10], DATE)
                self.post_apps(f"S{kind}_週表示/ドラッグ更新", {id_key: key, resource: "DEMO", "変更後日付": "2026-11-27"})
                # 日表示APIは前後30日を先読みするため、取得件数では移動を判定できない。
                after, = self.post_apps(daily_path, {"対象日付": DATE})[kind + "一覧"]
                self.assertEqual(after[id_key], key)
                self.assertEqual(after[kind + "開始日時"][:10], "2026-11-27")
                self.assertEqual(after[kind + "終了日時"].replace("T", " ")[:16], "2026-11-27 09:00")
                week = self.post_apps(f"S{kind}_週表示/{kind}一覧", {"開始日付": DATE, "終了日付": "2026-11-27"})
                row, = week[kind + "一覧"]
                self.assertEqual(row[id_key], key)
                self.assertEqual(row[kind + "開始日時"].replace("T", " ")[:16], "2026-11-27 08:00")

    def test_業務DBを分離しても入出庫と棚卸が在庫推移に反映される(self):
        from core_crud.C採番 import init_C採番_data
        with database.SessionLocal() as db:
            init_C採番_data(db)

        self.post_apps("M商品分類/登録", {"商品分類ID": "TEST", "商品分類名": "テスト"})
        self.post_apps("M商品/登録", {"商品ID": "ITEM", "商品名": "在庫品", "単位": "個", "商品分類ID": "TEST"})
        for kind, day, field, quantity in [
            ("入庫", "2026-11-25", "入庫数量", 10),
            ("出庫", "2026-11-26", "出庫数量", 3),
            ("棚卸", "2026-11-27", "実棚数量", 8),
        ]:
            with self.subTest(伝票=kind):
                self.post_apps(f"T商品{kind}/登録", {
                    kind + "日": day, "明細一覧": [{"明細SEQ": 1, "商品ID": "ITEM", field: quantity}],
                })
        result = self.post_apps("V商品推移表/一覧", {
            "開始日付": "2026-11-24", "終了日付": "2026-11-27", "商品分類ID": "TEST",
        })
        product, = result["商品推移データ"]
        self.assertEqual(product["商品ID"], "ITEM")
        days = product["日別データ"]
        self.assertEqual([row["推定在庫"] for row in days], [0, 10, 7, 8])
        self.assertEqual((days[1]["入庫数量"], days[2]["出庫数量"], days[3]["棚卸数量"]), (10, 3, 8))

    def test_業務DBを分離してもCore認証と伝票採番が動く(self):
        from fastapi import FastAPI
        from core_crud.C採番 import init_C採番_data
        from core_router import auth as auth_router, C採番 as numbering_router

        with database.SessionLocal() as db:
            init_C採番_data(db)
        self.assertEqual(set(inspect(database.engine).get_table_names()), {"C利用者", "C権限", "C採番", "A会話履歴"})
        self.assertIn("T配車", inspect(database.apps_engine).get_table_names())
        self.assertNotIn("C採番", inspect(database.apps_engine).get_table_names())
        self.assertNotIn("C利用者", inspect(database.apps_engine).get_table_names())
        old_path = self.home / "database.db"
        old_path.write_bytes(b"legacy: do not read or modify")
        core = FastAPI()
        core.include_router(auth_router.router)
        core.include_router(numbering_router.router)
        with TestClient(core) as client:
            login = client.post("/core/auth/ログイン", json={"利用者ID": "one", "パスワード": "fixture"}).json()
            self.assertEqual(login["status"], "OK", login)
            bearer = {"Authorization": "Bearer " + login["data"]["access_token"]}
        body = {"配車開始日時": DATE + " 08:00:00", "配車終了日時": DATE + " 09:00:00", "車両ID": "CAR01"}
        response = self.client.post("/apps/T配車/登録", json=body, headers=bearer)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["data"]["配車伝票ID"], "HS00010001")
        with closing(sqlite3.connect(self.apps_path)) as db:
            self.assertEqual(db.execute("SELECT 配車伝票ID, 登録利用者ID FROM T配車").fetchone(), ("HS00010001", "one"))
        with closing(sqlite3.connect(self.business_path)) as db:
            self.assertEqual(db.execute("SELECT 最終採番値, 更新利用者ID FROM C採番 WHERE 採番ID='T配車'").fetchone(), (10001, "one"))
        with TestClient(core) as client:
            response = client.post("/core/C採番/採番", json={"採番ID": "T配車"}, headers=bearer)
            self.assertEqual(response.json()["data"]["発番値"], 10002)
        self.assertEqual(old_path.read_bytes(), b"legacy: do not read or modify")

    def test_指定項目名とプロジェクトフォルダ(self):
        with closing(sqlite3.connect(self.path)) as db:
            作業 = list(db.execute("PRAGMA table_info(T日誌作業)"))
            明細 = list(db.execute("PRAGMA table_info(T日誌明細)"))
            self.assertEqual([col[1] for col in 作業 if col[5]], ["作業ID"])
            self.assertEqual([col[1] for col in 明細 if col[5]], ["作業ID", "行番号"])
            self.assertTrue({"プロジェクト", "作業タイトル", "作業時間", "新規更新ファイル数"} <= {col[1] for col in 作業})
            self.assertEqual({col[1] for col in 明細 if not col[5]}, {"作業内容", "添付"})
            for table in ("T日誌作業", "T日誌明細"):
                self.assertEqual(db.execute(f"SELECT count(*) FROM {table}").fetchone()[0], 0)
        project = r"C:\作業場所\テスト_%"
        created = self.call("作業登録", {
            "日誌日付": DATE, "プロジェクト": project, "作業タイトル": "作業", "新規更新ファイル数": 0,
        }).json()
        self.assertEqual(created["status"], "OK")
        self.assertEqual(created["data"]["作業ID"], 10001)
        update = {"日誌日付": DATE, "作業ID": 10001, "作業タイトル": "別名"}
        self.assertEqual(self.call("作業変更", update).json()["status"], "OK")
        result = self.call("検索", {"キーワード": "テスト_%"}).json()["data"]["items"]
        work = result[0]["記録"][0]
        self.assertEqual(work["プロジェクト"], project)
        self.assertEqual(work["新規更新ファイル数"], 0)
        self.assertEqual(self.call("作業変更", {**update, "プロジェクト": "不正\x00"}).status_code, 422)
        self.assertEqual(self.call("作業変更", {**update, "プロジェクト": ""}).json()["status"], "OK")
        data = self.call("取得", {"日誌日付": DATE}).json()["data"]
        self.assertEqual(data["記録"][0]["プロジェクト"], "")
        self.assertEqual(self.call("取得", {"日付": DATE}).status_code, 422)
        self.assertEqual(self.call("作業変更", {"日誌日付": DATE, "作業番号": 1, "作業タイトル": "旧形式"}).status_code, 422)

    def call(self, operation, body=None, user="one"):
        headers = {"Authorization": "Bearer " + self.tokens[user]} if user else {}
        if operation == "変更" and "更新版" not in body:
            current = self.call("取得", {"日誌日付": body["日誌日付"]}, user=user).json().get("data") or {}
            body = {**body, "更新版": current.get("更新版", "0" * 64)}
        return self.client.post(PREFIX + operation, headers=headers, json=body)

    def test_作業時間の保存_一覧_検索_未入力とゼロ_検証(self):
        body = sample()
        body["記録"][0]["作業時間"] = 7.75
        body["記録"][1]["作業時間"] = 0
        for invalid in (-0.01, 100, 7.755, "7.75", True):
            with self.subTest(invalid=invalid):
                request = {**body, "記録": [{**body["記録"][0], "作業時間": invalid}]}
                self.assertEqual(self.call("登録", request).status_code, 422)
        data = self.call("登録", body).json()["data"]
        self.assertEqual([work["作業時間"] for work in data["記録"]], [7.75, 0])
        self.lifecycle.close()
        self.client = self.lifecycle.enter_context(TestClient(self.app, raise_server_exceptions=False))
        self.assertEqual(self.call("一覧検索", {}).json()["data"]["items"][0]["作業一覧"][0]["作業時間"], 7.75)
        key = {"日誌日付": DATE, "作業ID": data["記録"][0]["作業ID"], "作業タイトル": "作業"}
        self.assertEqual(self.call("作業変更", key).json()["status"], "OK")
        self.assertEqual(self.call("検索", {}).json()["data"]["items"][0]["記録"][0]["作業時間"], 7.75)
        self.assertEqual(self.call("作業変更", {**key, "作業時間": None}).json()["status"], "OK")
        self.assertIsNone(self.call("取得", {"日誌日付": DATE}).json()["data"]["記録"][0]["作業時間"])
        self.assertEqual(self.call("作業登録", {"日誌日付": DATE, "作業タイトル": "追加", "作業時間": 99.99}).json()["status"], "OK")
        self.assertEqual(self.call("取得", {"日誌日付": DATE}).json()["data"]["記録"][-1]["作業時間"], 99.99)

    def test_保存と再読込_一覧に添付なし_利用者単位(self):
        payload = sample()
        新規 = self.call("登録", payload).json()["data"]
        self.assertEqual(新規["利用者ID"], "one")
        self.assertEqual(新規["利用者名"], "利用者A")
        self.assertEqual(新規["記録"][0]["作業タイトル"], "作業メモ")
        self.assertEqual(新規["記録"][0]["明細"][1]["添付"][0]["base64内容"], PNG)
        self.assertEqual(self.call("登録", payload).json()["error"]["code"], "DUPLICATE")
        self.assertEqual(self.call("一覧").json()["data"], {
            "items": [{"日誌日付": DATE, "利用者ID": "one", "利用者名": "利用者A", "記録件数": 2}],
            "total": 1,
            "limit": 1000,
        })
        self.assertEqual(self.call("一覧", {"終了日付": "2026-11-25"}).json()["data"]["items"], [])
        self.assertIsNone(self.call("一覧", {"件数制限": False}).json()["data"]["limit"])
        self.assertEqual(self.call("一覧", user="two").json()["data"]["items"], [])
        for op in ("取得", "変更", "削除"):
            body = payload if op == "変更" else {"日誌日付": DATE}
            self.assertEqual(self.call(op, body, user="two").json()["error"]["code"], "NOT_FOUND")
        self.assertEqual(self.call("登録", payload, user="two").json()["data"]["利用者名"], "利用者B")
        self.assertEqual(self.call("取得", {"日誌日付": DATE}).json()["data"], 新規)
        self.lifecycle.close()
        self.client = self.lifecycle.enter_context(TestClient(self.app, raise_server_exceptions=False))
        self.assertEqual(self.call("取得", {"日誌日付": DATE}).json()["data"], 新規)

    def test_変更削除は関連行まで反映(self):
        self.assertEqual(self.call("登録", sample()).json()["status"], "OK")
        small = {"日誌日付": DATE, "記録": [{"作業ID": 10001, "作業タイトル": "差し替え"}]}
        result = self.call("変更", small).json()
        self.assertEqual(result["data"]["記録"], [{"作業ID": 10001, "作業タイトル": "差し替え", "プロジェクト": "", "作業時間": None, "新規更新ファイル数": None, "明細": []}])
        with closing(sqlite3.connect(self.path)) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM T日誌明細").fetchone()[0], 0)
        self.assertEqual(self.call("削除", {"日誌日付": DATE}).json()["status"], "OK")
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
        changed = {"日誌日付": DATE, "記録": [
            {**original["記録"][0], "作業タイトル": "途中失敗"}, *original["記録"][1:],
        ]}
        response = self.call("変更", changed)
        self.assertEqual(response.status_code, 500)
        self.assertEqual(self.call("取得", {"日誌日付": DATE}).json()["data"], original)

    def test_認証_無効利用者_内部トークン(self):
        self.assertEqual(self.call("一覧", user=None).status_code, 401)
        self.assertEqual(self.call("一覧", user="off").status_code, 403)
        self.assertEqual(self.call("一覧", user="internal").status_code, 403)

    def test_Webで他の利用者を選び登録変更削除でき操作者を区別する(self):
        candidates = self.call("利用者候補", {}).json()["data"]
        self.assertEqual([row["利用者ID"] for row in candidates], ["one", "two"])
        self.assertEqual(self.call("登録", {**sample(), "利用者ID": "off"}).status_code, 422)
        self.assertEqual(self.call("登録", {**sample(), "利用者ID": "missing"}).status_code, 404)
        original = self.call("登録", {**sample(), "利用者ID": "two"}).json()["data"]
        self.assertEqual(original["利用者ID"], "two")
        key = {"日誌日付": DATE, "利用者ID": "two"}
        self.assertEqual(self.call("取得", key).json()["data"], original)
        self.assertEqual(self.call("取得", {"日誌日付": DATE}).json()["error"]["code"], "NOT_FOUND")
        changed = {"更新版": original["更新版"], "記録": original["記録"], **key}
        changed["記録"][0]["作業タイトル"] = "代理更新"
        self.assertEqual(self.call("変更", changed).json()["status"], "OK")
        with closing(sqlite3.connect(self.path)) as db:
            row = db.execute('SELECT 利用者ID, 登録利用者ID, 更新利用者ID FROM T日誌作業').fetchone()
            self.assertEqual(row, ("two", "one", "one"))
        self.assertEqual(self.call("削除", key).json()["status"], "OK")

    def test_内部認証は直接Toolsと対象IDのある七操作に限る(self):
        headers = {"Authorization": "Bearer " + self.tokens["internal"], "X-AiDiy-Diary": "tools"}
        local = TestClient(self.app, base_url="http://127.0.0.1:8098", client=("127.0.0.1", 1234))
        key = {"日誌日付": DATE, "利用者ID": "two"}
        # setUp の TestClient が既にアプリを起動済み。
        search = lambda body, h=headers: local.post(PREFIX + "検索", json=body, headers=h)
        self.assertEqual(search(key, {**headers, "X-Forwarded-For": "127.0.0.1"}).status_code, 403)
        self.assertEqual(search({}, headers).status_code, 422)
        self.assertEqual(local.post(PREFIX + "取得", json=key, headers=headers).status_code, 403)
        result = local.post(PREFIX + "作業登録", json={**key, "作業タイトル": "CLI"}, headers=headers)
        self.assertEqual(result.json()["status"], "OK", result.text)
        self.assertEqual(search({"利用者ID": "two"}).json()["data"]["total"], 1)
        with closing(sqlite3.connect(self.path)) as db:
            self.assertEqual(db.execute('SELECT 利用者ID, 登録利用者ID FROM T日誌作業').fetchone(),
                             ("two", "backend_core:code_live"))
        self.addCleanup(local.close)

    def test_入力検証とエラーへの内容非表示(self):
        for payload in [
            sample("2026-02-30"),
            {**sample(), "利用者ID": ""},
            {"日誌日付": DATE, "記録": [{"作業ID": 2, "作業タイトル": "順番"}]},
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
            result = self.call(op, {"日誌日付": DATE, **body}).json()
            self.assertEqual(result["status"], "OK", result)
            return result["data"]

        self.assertEqual(run("作業登録", 作業タイトル="初回")["作業ID"], 10001)
        self.assertEqual(run("作業登録", 作業タイトル="次回")["作業ID"], 10002)
        self.assertEqual(run("内容登録", 作業ID=10002, 作業内容="先頭")["行番号"], 1)
        self.assertEqual(run("内容登録", 作業ID=10002, 作業内容="画像", 添付=[{"ファイル名": "進捗.png", "base64内容": PNG}])["行番号"], 2)
        run("作業変更", 作業ID=10002, 作業タイトル="進捗 100%")
        run("内容変更", 作業ID=10002, 行番号=2, 作業内容="確認済み")
        run("内容削除", 作業ID=10002, 行番号=1)
        run("作業削除", 作業ID=10001)
        denied = self.call("作業削除", {"日誌日付": DATE, "作業ID": 10002}, user="two").json()
        self.assertEqual(denied["error"]["code"], "NOT_FOUND")
        entry = run("取得")["記録"][0]
        self.assertEqual(entry, {"作業ID": 10002, "作業タイトル": "進捗 100%", "プロジェクト": "", "作業時間": None, "新規更新ファイル数": None, "明細": [
            {"行番号": 1, "作業内容": "確認済み",
             "添付": [{"ファイル名": "進捗.png", "base64内容": PNG}]},
        ]})
        run("内容変更", 作業ID=10002, 行番号=1, 添付=[])
        self.assertEqual(run("取得")["記録"][0]["明細"][0]["添付"], [])
        run("作業削除", 作業ID=10002)
        self.assertEqual(self.call("取得", {"日誌日付": DATE}).json()["error"]["code"], "NOT_FOUND")
        self.assertEqual(run("作業登録", 作業タイトル="再開")["作業ID"], 10003)

    def test_検索_日付順_キーワード_ページング_添付非公開(self):
        self.assertEqual(self.call("登録", sample()).json()["status"], "OK")
        another = sample("2026-11-25")
        another["記録"][0]["作業タイトル"] = "完了率 100%"
        self.assertEqual(self.call("登録", another).json()["status"], "OK")
        for keyword, total in [("レビュー", 2), ("画像.png", 2), ("100%", 1), ("%", 1), ("_", 0)]:
            r = self.call("検索", {"キーワード": keyword, "limit": 1}).json()
            self.assertEqual(r["data"]["total"], total, keyword)
            self.assertNotIn(PNG, json.dumps(r))
            self.assertNotIn("base64内容", json.dumps(r, ensure_ascii=False))
        self.assertEqual(self.call("検索", {"offset": 1, "limit": 1}).json()["data"]["items"][0]["日誌日付"], "2026-11-25")
        self.assertEqual(self.call("検索", {"開始日付": DATE}).json()["data"]["items"][0]["日誌日付"], DATE)
        self.assertEqual(self.call("検索", {}, user="two").json()["data"]["items"], [])
        self.assertEqual(self.call("検索", {}, user="internal").status_code, 403)

    def test_Web一覧検索は利用者横断で同じ作業に条件を適用(self):
        one = sample()
        one["記録"][0]["プロジェクト"] = "C:/project-a"
        one["記録"][0]["新規更新ファイル数"] = 0
        one["記録"][1]["プロジェクト"] = "C:/project-b"
        one["記録"][1]["明細"] = [{"行番号": 1, "作業内容": "別の作業の語 %_"}]
        two = sample()
        two["記録"][0]["プロジェクト"] = "D:/project-c"
        self.assertEqual(self.call("登録", one).json()["status"], "OK")
        self.assertEqual(self.call("登録", two, user="two").json()["status"], "OK")

        def items(**conditions):
            result = self.call("一覧検索", {"開始日付": DATE, "終了日付": DATE, **conditions})
            self.assertEqual(result.status_code, 200, result.text)
            self.assertNotIn(PNG, result.text)
            self.assertEqual(result.json()["status"], "OK")
            return result.json()["data"]["items"]

        all_rows = items()
        self.assertEqual([r["利用者ID"] for r in all_rows], ["one", "two"])
        work = all_rows[0]["作業一覧"]
        self.assertEqual([w["プロジェクト"] for w in work], ["C:/project-a", "C:/project-b"])
        self.assertEqual([w["プロジェクト"] for w in all_rows[1]["作業一覧"]], ["D:/project-c", ""])
        self.assertEqual([w["作業タイトル"] for w in work], ["作業メモ", "見出しだけ"])
        self.assertEqual([w["新規更新ファイル数"] for w in work], [0, None])
        self.assertEqual(set(work[0]), {"作業ID", "プロジェクト", "作業タイトル", "作業時間", "新規更新ファイル数"})
        self.assertEqual(items(プロジェクト="C:/project-b")[0]["作業一覧"], work[1:])
        self.assertEqual([r["利用者ID"] for r in items(利用者ID="two")], ["two"])
        self.assertEqual([r["利用者ID"] for r in items(プロジェクト="D:/project-c", キーワード="画像.png")], ["two"])
        self.assertEqual(items(プロジェクト="C:/project-a", キーワード="別の作業"), [])
        self.assertEqual(items(プロジェクト="C:/project-b", キーワード="%_")[0]["記録件数"], 2)
        self.assertEqual(items(キーワード=PNG), [])
        self.assertEqual([r["利用者ID"] for r in self.call("一覧").json()["data"]["items"]], ["one"])
        self.assertEqual(self.call("検索", {"キーワード": "project-c"}).json()["data"]["total"], 0)
        candidates = self.call("一覧候補").json()["data"]
        self.assertEqual([r["利用者ID"] for r in candidates["利用者"]], ["one", "two"])
        self.assertEqual(candidates["プロジェクト"], ["C:/project-a", "C:/project-b", "D:/project-c"])
        for endpoint in ("一覧検索", "一覧候補"):
            self.assertEqual(self.call(endpoint, {}, user=None).status_code, 401)
            self.assertEqual(self.call(endpoint, {}, user="internal").status_code, 403)

    def test_部分操作_不正添付と空の新規を保存しない(self):
        bad = self.call("作業登録", {"日誌日付": DATE, "作業タイトル": "   "}).json()
        self.assertEqual(bad["error"]["code"], "VALIDATION_ERROR")
        self.assertEqual(self.call("取得", {"日誌日付": DATE}).json()["error"]["code"], "NOT_FOUND")
        original = self.call("登録", sample()).json()["data"]
        bad = self.call("内容変更", {"日誌日付": DATE, "作業ID": 10001, "行番号": 2,
                                    "添付": [{"ファイル名": "new.png", "base64内容": "SECRET!!!"}]})
        self.assertEqual(bad.json()["error"]["code"], "VALIDATION_ERROR")
        self.assertNotIn("SECRET!!!", bad.text)
        self.assertEqual(self.call("取得", {"日誌日付": DATE}).json()["data"], original)

    def test_同時に作業を追加しても一日一件で連番を採番(self):
        def add(number):
            return self.call("作業登録", {"日誌日付": DATE, "作業タイトル": f"作業{number}"}).json()

        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(add, range(8)))
        self.assertEqual(sorted(r["data"]["作業ID"] for r in results if r["status"] == "OK"), list(range(10001, 10009)))
        listing = self.call("一覧").json()["data"]
        self.assertEqual(listing["total"], 1)
        self.assertEqual(listing["items"][0]["記録件数"], 8)

    def test_複数添付と自己申告は明細の詰め直しと再起動後も維持(self):
        添付 = [{"ファイル名": "画像.png", "base64内容": PNG}, {"ファイル名": "説明.txt", "base64内容": "YWJj"}]
        body = {"日誌日付": DATE, "記録": [
            {"作業タイトル": "先頭", "新規更新ファイル数": None},
            {"作業タイトル": "測定", "プロジェクト": "", "新規更新ファイル数": 0, "明細": [
                {"行番号": 1, "作業内容": "先頭行", "添付": []},
                {"行番号": 2, "作業内容": "", "添付": 添付},
            ]},
        ]}
        self.assertEqual(self.call("登録", body).json()["status"], "OK")
        self.assertEqual(self.call("検索", {"キーワード": "説明.txt"}).json()["data"]["total"], 1)
        self.assertNotIn(PNG, self.call("検索", {}).text)
        keys = {"日誌日付": DATE, "作業ID": 10002, "行番号": 2}
        self.assertEqual(self.call("内容変更", {**keys, "作業内容": "確認済み"}).json()["status"], "OK")
        self.assertEqual(self.call("内容変更", {**keys, "ファイル名": "", "base64内容": ""}).json()["error"]["code"], "VALIDATION_ERROR")
        self.assertEqual(self.call("内容削除", {**keys, "行番号": 1}).json()["status"], "OK")
        self.assertEqual(self.call("作業削除", {"日誌日付": DATE, "作業ID": 10001}).json()["status"], "OK")
        self.lifecycle.close()
        self.client = self.lifecycle.enter_context(TestClient(self.app, raise_server_exceptions=False))
        data = self.call("取得", {"日誌日付": DATE}).json()["data"]
        self.assertEqual(data["記録"], [
            {"作業ID": 10002, "作業タイトル": "測定", "プロジェクト": "", "作業時間": None, "新規更新ファイル数": 0,
             "明細": [{"行番号": 1, "作業内容": "確認済み", "添付": 添付}]},
        ])
        self.assertEqual(self.call("作業変更", {"日誌日付": DATE, "作業ID": 10002, "作業タイトル": "別名"}).json()["status"], "OK")
        self.assertEqual(self.call("取得", {"日誌日付": DATE}).json()["data"]["記録"][0]["新規更新ファイル数"], 0)
        self.assertEqual(self.call("作業変更", {"日誌日付": DATE, "作業ID": 10002, "作業タイトル": "別名",
                                              "新規更新ファイル数": None}).json()["status"], "OK")
        self.assertIsNone(self.call("取得", {"日誌日付": DATE}).json()["data"]["記録"][0]["新規更新ファイル数"])
        self.assertEqual(self.call("変更", {"日誌日付": DATE, "記録": [
            {"作業ID": 10002, "作業タイトル": "添付を外した"},
        ]}).json()["status"], "OK")

    def test_旧DBを読まず新DBを使い_旧形式を拒否(self):
        self.lifecycle.close()
        old = self.home / ".aidiy" / "diary" / "diary_v4.db"
        old.parent.mkdir()
        sentinel = b"fixture: this file must not be read or modified"
        old.write_bytes(sentinel)
        self.client = self.lifecycle.enter_context(TestClient(self.app, raise_server_exceptions=False))
        self.assertEqual(self.call("一覧").json()["data"]["items"], [])
        self.assertEqual(old.read_bytes(), sentinel)
        body = sample()
        body["記録"][0]["明細"][1] = {"行番号": 2, "ファイル名": "旧画像.png", "base64内容": PNG}
        self.assertEqual(self.call("登録", body).status_code, 422)
        for value in [-1, 1.25, True]:
            result = self.call("作業変更", {"日誌日付": DATE, "作業ID": 1, "作業タイトル": "作業",
                                         "新規更新ファイル数": value})
            self.assertEqual(result.status_code, 422)

    def test_旧版を変更せず_互換性のあるコピーだけ使う(self):
        登録 = self.call("登録", sample()).json()["data"]
        self.lifecycle.close()
        旧パス = self.path.with_name("diary_v20261127.db")
        現行コピー = self.path.read_bytes()
        self.path.unlink()
        with closing(sqlite3.connect(旧パス)) as db, db:
            db.executescript("CREATE TABLE T日誌作業 (作業ID INTEGER PRIMARY KEY);"
                             "INSERT INTO T日誌作業 VALUES (90000); PRAGMA user_version = 4;")
        旧データ = 旧パス.read_bytes()

        self.client = self.lifecycle.enter_context(TestClient(self.app, raise_server_exceptions=False))
        self.assertTrue(self.path.is_file())
        self.assertEqual(self.call("一覧").json()["data"]["items"], [])
        self.assertEqual(旧パス.read_bytes(), 旧データ)
        self.lifecycle.close()

        shutil.copyfile(旧パス, self.path)
        with self.assertRaisesRegex(RuntimeError, "対応していない日誌DB"):
            self.lifecycle.enter_context(TestClient(self.app, raise_server_exceptions=False))
        self.assertEqual(self.path.read_bytes(), 旧データ)
        self.path.write_bytes(現行コピー)
        self.client = self.lifecycle.enter_context(TestClient(self.app, raise_server_exceptions=False))
        self.assertEqual(self.call("取得", {"日誌日付": DATE}).json()["data"]["記録"], 登録["記録"])
        with closing(sqlite3.connect(self.path)) as db:
            self.assertEqual(db.execute("PRAGMA user_version").fetchone(), (5,))
        self.assertEqual(旧パス.read_bytes(), 旧データ)

    def test_ツール更新後の古い画面保存を拒否(self):
        body = sample()
        body["記録"][0]["新規更新ファイル数"] = 0
        body["記録"][0]["明細"][1]["添付"].append({"ファイル名": "同じ行.pdf", "base64内容": "YWJj"})
        before = self.call("登録", body).json()["data"]
        keys = {"日誌日付": DATE, "作業ID": 10001, "行番号": 2}
        self.assertEqual(self.call("内容変更", {**keys, "作業内容": "ツール側で変更"}).json()["status"], "OK")
        stale = self.call("変更", {**body, "更新版": before["更新版"]}).json()
        self.assertEqual(stale["error"]["code"], "CONFLICT")
        now = self.call("取得", {"日誌日付": DATE}).json()["data"]
        work = now["記録"][0]
        self.assertEqual(work["明細"][1]["作業内容"], "ツール側で変更")
        self.assertEqual(work["明細"][1]["添付"], body["記録"][0]["明細"][1]["添付"])
        self.assertEqual(work["新規更新ファイル数"], 0)
        self.assertIsNone(now["記録"][1]["新規更新ファイル数"])
        self.assertEqual(self.call("変更", {"日誌日付": DATE, "記録": now["記録"],
                                           "更新版": now["更新版"]}).json()["status"], "OK")

    def test_C採番の値を使い_別日と別利用者でも一意_変更時は維持(self):
        with closing(sqlite3.connect(self.business_path)) as db:
            db.execute("UPDATE C採番 SET 最終採番値=83000 WHERE 採番ID='T日誌作業'")
            db.commit()

        def add(date, user):
            result = self.call("作業登録", {"日誌日付": date, "作業タイトル": "作業"}, user=user).json()
            self.assertEqual(result["status"], "OK", result)
            return result["data"]["作業ID"]

        first, second, other = add(DATE, "one"), add("2026-11-25", "one"), add(DATE, "two")
        self.assertEqual([first, second, other], [83001, 83002, 83003])
        current = self.call("取得", {"日誌日付": DATE}).json()["data"]
        update = {"日誌日付": DATE, "更新版": current["更新版"], "記録": current["記録"]}
        denied = self.call("変更", {**update, "記録": [{"作業ID": other, "作業タイトル": "別利用者"}]}).json()
        self.assertEqual(denied["error"]["code"], "VALIDATION_ERROR")
        denied_detail = self.call("内容登録", {
            "日誌日付": DATE, "作業ID": other, "作業内容": "別利用者",
        }).json()
        self.assertEqual(denied_detail["error"]["code"], "NOT_FOUND")
        denied_detail = self.call("内容登録", {
            "日誌日付": DATE, "作業ID": second, "作業内容": "別日",
        }).json()
        self.assertEqual(denied_detail["error"]["code"], "NOT_FOUND")
        saved = self.call("変更", {**update, "記録": [*current["記録"], {"作業タイトル": "新規"}]}).json()["data"]
        self.assertEqual([work["作業ID"] for work in saved["記録"]], [first, 83004])
        self.assertEqual(self.call("作業削除", {"日誌日付": DATE, "作業ID": 83004}).json()["status"], "OK")
        self.assertEqual(add(DATE, "one"), 83005)
        with closing(sqlite3.connect(self.business_path)) as db:
            row = db.execute("SELECT 最終採番値, 更新利用者ID FROM C採番 WHERE 採番ID='T日誌作業'").fetchone()
            self.assertEqual(row, (83005, "one"))
            db.execute("UPDATE C採番 SET 有効=0 WHERE 採番ID='T日誌作業'")
            db.commit()
        disabled = self.call("作業登録", {"日誌日付": DATE, "作業タイトル": "採番なし不可"}).json()
        self.assertEqual(disabled["error"]["code"], "NUMBERING_UNAVAILABLE")
        self.assertEqual(self.call("一覧").json()["data"]["items"][0]["記録件数"], 2)

    def test_業務DBの採番再作成時は現行の日誌DBの最大値を引き継ぐ(self):
        def 作業登録(日付, 利用者):
            result = self.call("作業登録", {"日誌日付": 日付, "作業タイトル": "作業"}, user=利用者).json()
            self.assertEqual(result["status"], "OK", result)
            return result["data"]["作業ID"]

        self.assertEqual(作業登録(DATE, "one"), 10001)
        self.assertEqual(作業登録("2026-11-25", "two"), 10002)
        for SQL, 期待値 in (
            ("DELETE FROM C採番 WHERE 採番ID='T日誌作業'", (10002, 1)),
            ("UPDATE C採番 SET 最終採番値=10000 WHERE 採番ID='T日誌作業'", (10002, 1)),
            ("UPDATE C採番 SET 最終採番値=20000, 有効=0 WHERE 採番ID='T日誌作業'", (20000, 0)),
        ):
            self.lifecycle.close()
            with closing(sqlite3.connect(self.business_path)) as db, db:
                db.execute(SQL)
            self.client = self.lifecycle.enter_context(TestClient(self.app, raise_server_exceptions=False))
            with closing(sqlite3.connect(self.business_path)) as db:
                self.assertEqual(db.execute(
                    "SELECT 最終採番値, 有効 FROM C採番 WHERE 採番ID='T日誌作業'"
                ).fetchone(), 期待値)
            if SQL.startswith("UPDATE") and 期待値 == (10002, 1):
                self.assertEqual(作業登録(DATE, "one"), 10003)
        with closing(sqlite3.connect(self.business_path)) as db, db:
            db.execute("UPDATE C採番 SET 有効=1 WHERE 採番ID='T日誌作業'")
        self.assertEqual(作業登録(DATE, "one"), 20001)

    def test_作業を分けても一日の明細合計は100行まで(self):
        body = sample()
        for 作業 in body["記録"]:
            作業["明細"] = [{"行番号": i, "作業内容": f"明細{i}"} for i in range(1, 51)]
        saved = self.call("登録", body).json()
        self.assertEqual(saved["status"], "OK", saved)
        作業ID = saved["data"]["記録"][0]["作業ID"]
        extra = self.call("内容登録", {"日誌日付": DATE, "作業ID": 作業ID, "作業内容": "101行目"}).json()
        self.assertEqual(extra["error"]["code"], "VALIDATION_ERROR")
        records = self.call("取得", {"日誌日付": DATE}).json()["data"]["記録"]
        self.assertEqual([len(item["明細"]) for item in records], [50, 50])

    def test_作業を分けても一日の添付合計に上限を適用する(self):
        body = sample()
        for 作業 in body["記録"]:
            作業["明細"] = [{"行番号": 1, "添付": [{"ファイル名": "確認.txt", "base64内容": "YWJj"}]}]
        # 3バイトのファイルが2件。日誌全体で上限ちょうどと1バイト超過を確かめる。
        with patch("apps_schema.T日誌.日誌添付合計上限", 6):
            self.assertEqual(len(T日誌保存要求.model_validate(body).記録), 2)
        with patch("apps_schema.T日誌.日誌添付合計上限", 5):
            with self.assertRaisesRegex(ValueError, "添付の合計は日誌1件につき"):
                T日誌保存要求.model_validate(body)

    def test_添付容量制限(self):
        for size, count in [(5 * 1024 * 1024 + 1, 1), (4 * 1024 * 1024, 4)]:
            encoded = base64.b64encode(bytes(size)).decode("ascii")
            payload = sample()
            payload["記録"][0]["明細"] = [
                {"行番号": i, "添付": [{"ファイル名": f"{i}.bin", "base64内容": encoded}]} for i in range(1, count + 1)
            ]
            with self.assertRaises(ValueError):
                T日誌保存要求.model_validate(payload)


if __name__ == "__main__":
    unittest.main()
