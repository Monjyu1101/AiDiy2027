# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""HTTP 呼び出し元の切断に合わせて、所有する処理を終了する。"""

import asyncio


class ClientDisconnected(Exception):
    """呼び出し元の切断。実行処理の障害とは区別する。"""


async def run_until_disconnect(request, operation):
    """本文読取後に使用し、切断・取消時は処理の finally 完了まで待つ。"""
    async def watch_disconnect():
        while True:
            if await request.is_disconnected():
                return
            await asyncio.sleep(0.25)

    worker = asyncio.create_task(operation)
    watcher = asyncio.create_task(watch_disconnect())
    try:
        done, _ = await asyncio.wait(
            (worker, watcher), return_when=asyncio.FIRST_COMPLETED
        )
        if worker in done:
            return await worker
        await watcher
        raise ClientDisconnected("HTTP 呼び出し元が切断されました")
    finally:
        for task in (worker, watcher):
            if not task.done():
                task.cancel()
        await asyncio.gather(worker, watcher, return_exceptions=True)
