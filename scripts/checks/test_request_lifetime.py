# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""HTTP 切断と正常完了を区別し、取消時の後処理を確認する。"""

import asyncio
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend_tools"))
from tools_proc.request_lifetime import ClientDisconnected, run_until_disconnect


class Request:
    disconnected = False

    async def is_disconnected(self):
        return self.disconnected


class RequestLifetimeTests(unittest.IsolatedAsyncioTestCase):
    async def test_normal_result(self):
        async def work():
            return {"status": "OK"}
        self.assertEqual(await run_until_disconnect(Request(), work()), {"status": "OK"})

    async def test_failure_preserved(self):
        async def work():
            raise ValueError("failure")
        with self.assertRaisesRegex(ValueError, "failure"):
            await run_until_disconnect(Request(), work())

    async def test_disconnect_waits_for_cleanup_and_leaves_other_request_running(self):
        request = Request()
        started = asyncio.Event()
        cleaned = asyncio.Event()
        other = asyncio.create_task(asyncio.sleep(10))

        async def work():
            try:
                started.set()
                await asyncio.sleep(10)
            finally:
                await asyncio.sleep(0.02)
                cleaned.set()

        task = asyncio.create_task(run_until_disconnect(request, work()))
        await started.wait()
        request.disconnected = True
        try:
            with self.assertRaises(ClientDisconnected):
                await asyncio.wait_for(task, 2)
            self.assertTrue(cleaned.is_set())
            self.assertFalse(other.done())
        finally:
            other.cancel()
            await asyncio.gather(other, return_exceptions=True)

    async def test_handler_cancellation_waits_for_cleanup(self):
        started = asyncio.Event()
        cleaned = asyncio.Event()

        async def work():
            try:
                started.set()
                await asyncio.sleep(10)
            finally:
                await asyncio.sleep(0.02)
                cleaned.set()

        task = asyncio.create_task(run_until_disconnect(Request(), work()))
        await started.wait()
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertTrue(cleaned.is_set())


if __name__ == "__main__":
    unittest.main()
