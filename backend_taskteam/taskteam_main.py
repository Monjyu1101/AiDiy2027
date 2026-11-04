# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""バックエンド(task,team) FastAPI エントリポイント。"""

from __future__ import annotations

import os

from log_config import setup_logging
from taskteam_proc.app import create_app

setup_logging("taskteam_main")

PORT_TASKTEAM = 8093

app = create_app()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("taskteam_main:app", host="0.0.0.0", port=PORT_TASKTEAM, ws_max_size=int(os.environ.get("UVICORN_WS_MAX_SIZE", "20971520")))
