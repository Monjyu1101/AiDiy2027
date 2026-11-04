# -*- coding: utf-8 -*-
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""実データを使わず、バックアップの非阻塞・二重起動・結果反映を検証する。"""
import ast
import asyncio
import importlib.util
import logging
import os
from pathlib import Path
import sys
import tempfile
import threading
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend_server"


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


logging_stub = ModuleType("log_config")
logging_stub.get_logger = logging.getLogger
with patch.dict(sys.modules, {"log_config": logging_stub}):
    backup = load("thread_backup_base", BACKEND / "AIコア/AIバックアップ.py")
    with patch.dict(sys.modules, {"AIコア.AIバックアップ": backup}):
        runner = load("thread_backup_runner", BACKEND / "AIコア/AIバックアップ実行.py")

RESULT = ("time", [{"パス": "a.txt", "更新日時": "time"}], ["a.txt"], True, "snapshot")


class BackupThreadTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = self.directory.name
        self.release = threading.Event()
        self.started = threading.Event()
        self.calls = []
        self.futures = []

        def backup_work(**kwargs):
            self.calls.append(kwargs["セッション設定"]["CODE_BASE_PATH"])
            self.started.set()
            if not self.release.wait(5):
                raise RuntimeError("test did not release worker")
            return RESULT

        self.patch = patch.object(runner, "バックアップ実行_共通ログ", side_effect=backup_work)
        self.patch.start()

    async def asyncTearDown(self):
        self.release.set()
        for future in self.futures:
            try:
                await asyncio.wait_for(asyncio.shield(asyncio.wrap_future(future)), 3)
            except Exception:
                pass
        self.patch.stop()
        self.assertFalse(runner._実行中)

    def start(self, path=None, **kwargs):
        future = runner.バックアップ開始(セッション設定={"CODE_BASE_PATH": path or self.root}, **kwargs)
        self.futures.append(future)
        return future

    async def wait_started(self):
        for _ in range(100):
            if self.started.is_set():
                return
            await asyncio.sleep(.005)
        self.fail("worker did not start")

    async def test_duplicate_same_normalized_path_is_ignored_not_queued(self):
        first = self.start()
        second = self.start(os.path.join(self.root, "child", ".."))
        self.assertIs(first, second)
        await self.wait_started()
        self.assertEqual(len(self.calls), 1)
        self.release.set()
        self.assertEqual(await asyncio.wrap_future(first), RESULT)
        await asyncio.sleep(.02)
        self.assertEqual(len(self.calls), 1)
        third = self.start()
        self.assertIsNot(first, third)
        await asyncio.wrap_future(third)
        self.assertEqual(len(self.calls), 2)

    async def test_other_project_can_run_and_loop_is_not_blocked(self):
        first = self.start()
        second = self.start(os.path.join(self.root, "other"))
        await self.wait_started()
        await asyncio.wait_for(asyncio.sleep(.01), .2)
        self.assertFalse(first.done())
        self.assertFalse(second.done())
        self.assertIsNot(first, second)

    async def test_cancel_waiter_keeps_worker_and_duplicate_guard(self):
        task = asyncio.create_task(runner.バックアップ完了待機(セッション設定={"CODE_BASE_PATH": self.root}))
        await self.wait_started()
        first = self.start()
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertIs(first, self.start())
        self.assertFalse(first.cancel())
        self.assertFalse(first.done())
        self.release.set()
        self.assertEqual(await asyncio.wrap_future(first), RESULT)
        self.assertEqual(len(self.calls), 1)

    async def test_exception_releases_guard_and_allows_retry(self):
        with patch.object(runner, "バックアップ実行_共通ログ", side_effect=ValueError("fixture")):
            first = self.start()
            with self.assertRaisesRegex(ValueError, "fixture"):
                await asyncio.wrap_future(first)
        self.assertFalse(runner._実行中)
        self.release.set()
        await asyncio.wrap_future(self.start())

    async def test_thread_start_failure_releases_guard(self):
        with patch.object(runner.threading.Thread, "start", side_effect=RuntimeError("cannot start")):
            with self.assertRaisesRegex(RuntimeError, "cannot start"):
                self.start()
        self.assertFalse(runner._実行中)
        self.release.set()
        await asyncio.wrap_future(self.start())

    async def test_request_path_is_snapshotted(self):
        settings = {"CODE_BASE_PATH": self.root}
        future = runner.バックアップ開始(セッション設定=settings)
        self.futures.append(future)
        settings["CODE_BASE_PATH"] = "/changed"
        await self.wait_started()
        self.assertEqual(self.calls, [self.root])

    async def test_session_result_applies_on_loop_without_waiting(self):
        owner = threading.get_ident()
        class Session(SimpleNamespace):
            def __setattr__(self, name, value):
                if name == "全ファイルリスト":
                    self.thread = threading.get_ident()
                super().__setattr__(name, value)
        session = Session(セッションID="s", モデル設定={"CODE_BASE_PATH": self.root})
        manager = SimpleNamespace(get_session=lambda _: session)
        future = runner.セッションバックアップ開始(session, manager)
        self.futures.append(future)
        await self.wait_started()
        self.assertFalse(hasattr(session, "全ファイルリスト"))
        self.release.set()
        await asyncio.wrap_future(future)
        await asyncio.sleep(.01)
        self.assertEqual(session.全ファイルリスト, RESULT[1])
        self.assertEqual(session.thread, owner)

    async def test_removed_session_or_changed_project_does_not_get_stale_result(self):
        session = SimpleNamespace(セッションID="s", モデル設定={"CODE_BASE_PATH": self.root})
        manager = SimpleNamespace(get_session=lambda _: session)
        first = runner.セッションバックアップ開始(session, manager)
        self.futures.append(first)
        session.モデル設定["CODE_BASE_PATH"] = self.root + "/changed"
        removed = SimpleNamespace(セッションID="gone", モデル設定={"CODE_BASE_PATH": self.root})
        second = runner.セッションバックアップ開始(removed, manager)
        self.assertIs(first, second)
        self.release.set()
        await asyncio.wrap_future(first)
        await asyncio.sleep(.01)
        self.assertFalse(hasattr(session, "全ファイルリスト"))
        self.assertFalse(hasattr(removed, "全ファイルリスト"))

    async def test_two_sessions_share_result_without_new_backup(self):
        sessions = {s: SimpleNamespace(セッションID=s, モデル設定={"CODE_BASE_PATH": self.root}) for s in ("a", "b")}
        manager = SimpleNamespace(get_session=sessions.get)
        first, second = [runner.セッションバックアップ開始(s, manager) for s in sessions.values()]
        self.futures.extend([first, second])
        self.assertIs(first, second)
        self.release.set()
        await asyncio.wrap_future(first)
        await asyncio.sleep(.01)
        self.assertEqual(len(self.calls), 1)
        for session in sessions.values():
            self.assertEqual(session.バックアップベースパス, RESULT[4])

    async def test_ordered_session_wait_completes_after_metadata(self):
        session = SimpleNamespace(セッションID="s", モデル設定={"CODE_BASE_PATH": self.root})
        manager = SimpleNamespace(get_session=lambda _: session)
        task = asyncio.create_task(runner.セッションバックアップ完了待機(session, manager))
        await self.wait_started()
        self.assertFalse(task.done())
        self.release.set()
        self.assertEqual(await task, RESULT)
        self.assertEqual(session.全ファイルリスト, RESULT[1])

    async def test_ordered_session_wait_does_not_apply_changed_project(self):
        session = SimpleNamespace(セッションID="s", モデル設定={"CODE_BASE_PATH": self.root})
        manager = SimpleNamespace(get_session=lambda _: session)
        task = asyncio.create_task(runner.セッションバックアップ完了待機(session, manager))
        await self.wait_started()
        session.モデル設定["CODE_BASE_PATH"] = self.root + "/new"
        self.release.set()
        self.assertEqual(await task, RESULT)
        self.assertFalse(hasattr(session, "全ファイルリスト"))

    async def test_completion_is_published_before_next_worker_can_start(self):
        future = self.start()
        publishing, finish_publish = threading.Event(), threading.Event()
        def completed(_):
            publishing.set()
            finish_publish.wait(3)
        future.add_done_callback(completed)
        self.release.set()
        try:
            for _ in range(100):
                if publishing.is_set():
                    break
                await asyncio.sleep(.005)
            self.assertTrue(publishing.is_set())
            self.assertIs(future, self.start())
            self.assertEqual(len(self.calls), 1)
        finally:
            finish_publish.set()
        for _ in range(100):
            if not runner._実行中:
                break
            await asyncio.sleep(.005)

    async def test_real_rest_initialization_returns_while_backup_runs(self):
        # 依存AI/DBを起動せず、実際のREST関数本体を軽量stubで実行する。
        tree = ast.parse((BACKEND / "core_router/AIコア.py").read_text(encoding="utf-8"))
        function = next(n for n in tree.body if isinstance(n, ast.AsyncFunctionDef) and n.name == "初期化")
        function.decorator_list = []
        session = SimpleNamespace(セッションID="s", モデル設定={"CODE_BASE_PATH": self.root})
        manager = SimpleNamespace(セッションID生成=lambda: "s", ensure_session=lambda *a, **k: None,
                                  sessions={"s": session}, get_session=lambda _: session)
        namespace = dict(Request=object, 初期化リクエスト=object, 初期化レスポンス=lambda **k: k,
                         AIセッション管理=manager, セッションバックアップ開始=runner.セッションバックアップ開始,
                         authenticate=lambda *_: (SimpleNamespace(owner=("user", "fixture")), None),
                         require_manager_owner=lambda *_: None, bind_session_owner=lambda *_: None,
                         バックエンドディレクトリ=self.root, logger=logging.getLogger("fixture"))
        exec(compile(ast.Module(body=[function], type_ignores=[]), "initialization-under-test", "exec"), namespace)
        response = await asyncio.wait_for(namespace["初期化"](
            SimpleNamespace(app=SimpleNamespace(conf=None)), SimpleNamespace(セッションID="")), .2)
        self.assertEqual(response["status"], "OK")
        await self.wait_started()
        self.futures.extend(runner._実行中.values())
        self.assertFalse(self.futures[0].done())
        await asyncio.wait_for(asyncio.sleep(.01), .2)


class BackupCallsitesTest(unittest.TestCase):
    def test_core_has_nonwaiting_initialization_and_awaited_ordered_calls(self):
        source = (BACKEND / "core_router/AIコア.py").read_text(encoding="utf-8")
        tree = ast.parse(source)
        calls = [n for n in ast.walk(tree) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)]
        self.assertEqual(sum(n.func.id == "セッションバックアップ開始" for n in calls), 2)
        self.assertFalse(any(n.func.id == "バックアップ実行_共通ログ" for n in calls))
        awaited = [n.value.func.id for n in ast.walk(tree) if isinstance(n, ast.Await)
                   and isinstance(n.value, ast.Call) and isinstance(n.value.func, ast.Name)]
        self.assertEqual(awaited.count("セッションバックアップ完了待機"), 2)
        self.assertLess(source.index("再起動対象パス ="), source.index("await セッションバックアップ完了待機"))
        guard = source.index("!= 再起動対象パス")
        self.assertLess(guard, source.index('"reboot_core.txt"', guard))
        code_source = (BACKEND / "AIコア/AIコード.py").read_text(encoding="utf-8")
        wait = code_source.index("result = await バックアップ完了待機")
        stop = code_source.index("if self.強制停止フラグ:", wait)
        self.assertLess(stop, code_source.index("最終時刻, 全ファイル, 差分ファイル", wait))
        code = ast.parse(code_source)
        self.assertTrue(any(isinstance(n, ast.Await) and isinstance(n.value, ast.Call)
                            and isinstance(n.value.func, ast.Name) and n.value.func.id == "バックアップ完了待機"
                            for n in ast.walk(code)))


if __name__ == "__main__":
    unittest.main()
