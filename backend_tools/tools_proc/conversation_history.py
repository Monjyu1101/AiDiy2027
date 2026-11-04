# -*- coding: utf-8 -*-
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""通常の Chat / Code MCP・REST 実行だけを共通DBへ記録する境界。"""

import asyncio
from pathlib import Path
import sys
import uuid

_ROOT = Path(__file__).resolve().parents[2]
_BACKEND = str(_ROOT / "backend_server")
if _BACKEND not in sys.path:
    sys.path.append(_BACKEND)

from 会話履歴パス import normalize_project_path
from 会話履歴記録 import write_history_message

_DATABASE_PATH = _ROOT / "_data" / "AiDiy" / "database.db"
_HISTORY_ERROR = "会話履歴を保存できませんでした。DBの初期化状態を確認してください。"


class _Turn:
    def __init__(self, source, project_path):
        if source not in ("chat", "code"):
            raise ValueError("履歴の呼出し元が不正です")
        self.session_id = f"mcp_{source}_{uuid.uuid4().hex}"
        self.project_path = normalize_project_path(project_path)
        self.channel = "0" if source == "chat" else "1"
        self.actor = "aidiy_chat_llms" if source == "chat" else "aidiy_code_agents"
        self.input_saved = False
        self.final_saved = False
        self.final_attempted = False

    def write(self, message_type, content, file_path=None):
        sequence = 1 if message_type == "input_text" else 2
        if sequence == 2:
            # commit失敗の結果が不確かな場合も、同じ連番をerrorで再試行しない。
            self.final_attempted = True
        write_history_message(
            _DATABASE_PATH, session_id=self.session_id, sequence=sequence,
            channel=self.channel, message_type=message_type, content=content,
            project_path=self.project_path, actor=self.actor, file_path=file_path,
        )
        if sequence == 1:
            self.input_saved = True
        else:
            self.final_saved = True


async def _save(turn, *args):
    # SQLite待機でMCPのイベントループを止めない。中止時にも進行中のcommitが
    # 確定するまで待ち、遅延書込と同じseqへのエラー追記が競合しないようにする。
    task = asyncio.create_task(asyncio.to_thread(turn.write, *args))
    cancelled = False
    while not task.done():
        try:
            await asyncio.shield(task)
        except asyncio.CancelledError:
            cancelled = True
        except Exception:
            break
    if cancelled:
        # 例外も回収する。保存可否はcommit後にTurnへ反映済み。
        if not task.cancelled():
            task.exception()
        raise asyncio.CancelledError
    return task.result()


async def run_with_history(runner, source, *, prompt, project_path=None, **kwargs):
    """入力と最終応答を1回だけ保存。予測・complete_async・AIコアは通さない。

    DBセッションは呼出し単位。Chatのsession_idは従来のモデル文脈継続用で、
    DBのhistory_session_idとは別。並行応答や同一session_idの別projectが交差
    しても入力と応答を取り違えない。未指定projectは推測せずNULLで保存する。
    """
    try:
        turn = _Turn(source, project_path)
    except ValueError:
        return {"status": "NG", "result": "! プロジェクトパスは絶対パスで指定してください。",
                "history_saved": False, "execution_status": "NOT_STARTED"}

    def response(result, saved=False, history_error=None, execution_status=None):
        value = dict(result)
        value.update(history_saved=saved, history_session_id=turn.session_id,
                     history_project_path=turn.project_path,
                     history_input_saved=turn.input_saved)
        if history_error:
            value.update(status="NG", history_error=history_error,
                         execution_status=execution_status)
        return value

    try:
        try:
            await _save(turn, "input_text", prompt, kwargs.get("file_path"))
        except Exception:
            return response({"status": "NG", "result": "! " + _HISTORY_ERROR},
                            history_error=_HISTORY_ERROR, execution_status="NOT_STARTED")

        try:
            result = await runner(prompt=prompt, project_path=project_path, **kwargs)
        except Exception:
            result = {"status": "NG", "result": "! AI実行中にエラーが発生しました。"}
        if not isinstance(result, dict):
            result = {"status": "NG", "result": "! AIの応答形式が不正です。"}
        text = result.get("result")
        succeeded = result.get("status") == "OK" and isinstance(text, str) and bool(text.strip())
        if not succeeded and result.get("status") == "OK":
            result = {**result, "status": "NG", "result": "! AIの応答本文がありません。"}
            text = result["result"]
        try:
            await _save(turn, "output_text" if succeeded else "error",
                        text if isinstance(text, str) else "AI実行失敗")
        except Exception:
            # Codeは既にファイル変更を完了した可能性がある。本文と実行結果は
            # 消さず、保存失敗と区別し、呼出し側に自動再実行を促さない。
            return response(result, history_error=_HISTORY_ERROR,
                            execution_status=result.get("status", "NG"))
        return response(result, saved=succeeded)
    except asyncio.CancelledError:
        if turn.input_saved and not turn.final_attempted:
            try:
                await _save(turn, "error", "実行がキャンセルされました。")
            except (Exception, asyncio.CancelledError):
                pass
        raise
