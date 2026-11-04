# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""AIチーム要員との単発会話。

backend_tools への依存は持たず、aidiy_code_agents の HTTP API を毎回呼び出す。
会話履歴や CodeAgent インスタンスは Team 処理側に保持しない。

会話には2つのモードがある。
- 調査モード: プロジェクトの実物を確認したうえで答えてほしい用途。
  利用者画面の会話（`/team/エージェント/会話`）と雑談の発言（sub_self_talk.py）が使う。
  task_sub/sub_do.py と同じく権限を既定（auto）に戻してツールを使えるようにし、
  タイムアウトも延長する。ただしシステム指示で「読み取り調査のみ・変更禁止」を明示する。
- 通常モード（既定）: ツール利用を禁止（code_permissions="none"）し、170秒で打ち切る。
  AI の知識と与えられた文章だけで応答する。意見の取りまとめ（sub_self_work.py）のように、
  入力が全て渡っていて追加調査が要らない用途で使う。
"""

from __future__ import annotations

import json
import os
from urllib.error import HTTPError, URLError
from urllib.request import ProxyHandler, Request, build_opener

from . import persona_catalog, team_context, team_db


CODE_AGENTS_URL = (
    os.environ.get("AIDIY_CODE_AGENTS_URL")
    or "http://127.0.0.1:8095/aidiy_code_agents/run"
)
_LOCAL_HTTP_OPENER = build_opener(ProxyHandler({}))
# 利用者画面の待機上限（3分）より先に backend_taskteam が結果を確定できるよう、
# CodeAgent 自体は170秒、HTTP接続は180秒で打ち切る。
CODE_AGENT_TIMEOUT秒 = 170
HTTP_TIMEOUT秒 = 180
# 調査モードはソースの読み取りを伴うため長めに取る。
# 雑談は team_watcher が「前回プロセスが動いている間は次を投入しない」で直列化しているので、
# 長くしすぎると発言頻度がそのまま落ちる。5分を上限とする。
調査CODE_AGENT_TIMEOUT秒 = 300
# HTTP 側は code_agents のタイムアウトが先に効くよう少し長く取る
# （HTTP が先に切れると、AI からの結果もエラー理由も受け取れないため）
調査HTTP_TIMEOUT秒 = 調査CODE_AGENT_TIMEOUT秒 + 60


def _POST送信(payload: dict, http_timeout秒: int = HTTP_TIMEOUT秒) -> dict:
    request = Request(
        CODE_AGENTS_URL,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    try:
        with _LOCAL_HTTP_OPENER.open(request, timeout=http_timeout秒) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"aidiy_code_agents HTTP {exc.code}: {body[:500]}") from exc
    except URLError as exc:
        raise RuntimeError(f"aidiy_code_agentsへ接続できません: {exc.reason}") from exc
    except TimeoutError as exc:
        raise TimeoutError(
            f"AIエージェントの応答が{http_timeout秒}秒以内に完了しませんでした"
        ) from exc
    except json.JSONDecodeError as exc:
        raise RuntimeError("aidiy_code_agentsからJSON以外の応答が返りました") from exc


def _ペルソナ指示(要員ID: str, 調査モード: bool = False) -> str:
    """personaファイルと要員マスタの現在値から、単発会話用のシステム指示を作る。

    調査モードでは、読み取り系ツールでプロジェクトの実物を確認するよう指示し、
    どこから読み始めるか（`_AIDIY.md` / `AGENTS.md` / `_AIDIY/knowledge/_index.md` / `docs/`）も示す。
    書き込み・実行系は引き続き禁止する（意見を述べるための調査であり、作業の実施ではないため）。
    """
    要員 = team_db.要員取得(要員ID)
    if not 要員 or not bool(要員.get("有効")):
        raise ValueError("対象エージェントが見つからないか、現在は無効です")

    try:
        persona = persona_catalog.召喚要員取得(要員ID) or {}
    except ValueError:
        # 手動登録された要員はpersonaフォルダを持たないことがあるため、要員マスタだけで会話する。
        persona = {}

    人物名 = str(persona.get("人物名") or 要員.get("要員名") or 要員ID).strip()
    ニックネーム = str(persona.get("ニックネーム") or 要員.get("要員名") or 要員ID).strip()
    役割 = str(要員.get("役割") or persona.get("役割") or "AIエージェント").strip()
    人格情報 = str(要員.get("人格情報") or persona.get("人格情報") or "").strip()
    行動指示 = team_context.コンテキスト取得(
        "chat", "behavior_survey_lines" if 調査モード else "behavior_chat_lines"
    )
    return team_context.差し込み("chat", "persona_instruction_lines", {
        "行動指示": 行動指示,
        "要員ID": 要員ID,
        "人物名": 人物名,
        "ニックネーム": ニックネーム,
        "役割": 役割,
        "人格情報": 人格情報 or team_context.コンテキスト取得("chat", "persona_default_lines").strip(),
    })


def 会話実行(
    要員ID: str,
    プロジェクト: str,
    task_ai_name: str,
    task_ai_model: str,
    要求内容: str,
    調査モード: bool = False,
) -> dict:
    """ペルソナを設定した CodeAgent へ単発会話を依頼し、応答内容を返す。

    調査モード=True のときは、task_sub/sub_do.py と同じく
    code_permissions を既定（auto）に戻してツールを使えるようにし、タイムアウトも延長する。
    False のときは従来どおりツール禁止・170秒の会話専用で動く。
    """
    payload = {
        "prompt": 要求内容,
        "project_path": プロジェクト,
        "ai_name": task_ai_name,
        "ai_model": task_ai_model,
        # 調査モードでは権限指定を外し、CLI に bypassPermissions を付けさせる。
        # "none" のままだと非対話実行でツール利用が拒否され、ソースを一切読めない。
        "code_permissions": "auto" if 調査モード else "none",
        "system_instruction": _ペルソナ指示(要員ID, 調査モード),
        "resume": False,
        "timeout_sec": 調査CODE_AGENT_TIMEOUT秒 if 調査モード else CODE_AGENT_TIMEOUT秒,
        "self_check_loop": 0,
    }
    response = _POST送信(
        payload,
        調査HTTP_TIMEOUT秒 if 調査モード else HTTP_TIMEOUT秒,
    )
    if response.get("error"):
        raise RuntimeError(str(response["error"]))
    if response.get("status") != "OK":
        raise RuntimeError(str(response.get("result") or "AIエージェントの応答に失敗しました"))
    応答内容 = str(response.get("result") or "").strip()
    if not 応答内容 or 応答内容 == "（応答なし）":
        raise RuntimeError("AIエージェントから応答がありませんでした")
    return {
        "要員ID": 要員ID,
        "プロジェクト": str(response.get("project_path") or プロジェクト),
        "TASK_AI_NAME": str(response.get("ai_name") or task_ai_name),
        "TASK_AI_MODEL_plan": str(response.get("ai_model") or task_ai_model),
        "応答内容": 応答内容,
    }
