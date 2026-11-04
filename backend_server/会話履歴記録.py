# -*- coding: utf-8 -*-
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""MCP から現行の共通会話履歴へ記録する。DB・テーブルは作成しない。"""

from contextlib import closing
from datetime import datetime
from pathlib import Path
import sqlite3

from 会話履歴パス import normalize_project_path


def write_history_message(database_path, *, session_id, sequence, channel,
                          message_type, content, project_path, actor,
                          file_path=None):
    """1行を確定する。接続を呼出し内に閉じ、旧構造・再試行には逃げない。

    呼出し側が専用の一意セッションと連番を持つ。mode=rw によりDB不在時の
    空ファイル作成も防ぐ。失敗は呼出し側へ通知し、保存成功とは扱わない。
    """
    project_path = normalize_project_path(project_path)
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    uri = Path(database_path).absolute().as_uri() + "?mode=rw"
    with closing(sqlite3.connect(uri, uri=True, timeout=1.0)) as connection:
        with connection:
            connection.execute(
                """INSERT INTO "A会話履歴" (
                    "セッションID", "シーケンス", "チャンネル", "プロジェクトパス",
                    "メッセージ識別", "メッセージ内容", "ファイル名",
                    "登録日時", "登録利用者ID", "登録利用者名", "登録端末ID",
                    "更新日時", "更新利用者ID", "更新利用者名", "更新端末ID"
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (session_id, sequence, channel, project_path, message_type, content, file_path,
                 now, actor, actor, "localhost", now, actor, actor, "localhost"),
            )
