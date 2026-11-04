# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""
Task Agents モジュール

backend_taskteam の HTTP API に疎結合で接続し、AIタスク要求を非同期投入する。
DB 直書きや backend_taskteam の import は行わない。
"""

from __future__ import annotations

import os
from typing import Optional

import requests

from .taskteam_auth import post_taskteam


class TaskAgents:
    """backend_taskteam API へ AIタスク要求を投入する薄いクライアント"""

    def __init__(self, task_api_base: Optional[str] = None):
        self.task_api_base = (task_api_base or os.environ.get("AIDIY_TASK_API_BASE") or "http://127.0.0.1:8093").rstrip("/")

    def get_config(self) -> dict:
        """接続先と疎通状態を返す。backend_taskteam 未起動でも例外にしない。"""
        health_url = f"{self.task_api_base}/health"
        info = {
            "task_api_base": self.task_api_base,
            "submit_endpoint": f"{self.task_api_base}/task/タスク要求/AI登録",
            "health": {"ok": False, "url": health_url, "message": ""},
        }
        try:
            res = requests.get(health_url, timeout=3)
            info["health"] = {
                "ok": res.ok,
                "url": health_url,
                "status_code": res.status_code,
                "message": res.text[:300],
            }
        except requests.RequestException as e:
            info["health"]["message"] = f"backend_taskteam に接続できません: {e}"
        return info

    def _post_task_api(self, path: str, payload: dict, request_timeout_sec: int) -> dict:
        """backend_taskteam の API を POST で呼び出す。接続不能時も dict で返す。"""
        url = f"{self.task_api_base}{path}"
        try:
            res = post_taskteam(url, payload, timeout=max(1, int(request_timeout_sec)))
            return res.json()
        except requests.RequestException as e:
            return {
                "status": "NG",
                "message": (
                    f"backend_taskteam ({self.task_api_base}) に接続できません。"
                    f"backend_taskteam を起動してから再実行してください。"
                ),
                "error": str(e),
            }
        except ValueError as e:
            return {
                "status": "NG",
                "message": "backend_taskteam から JSON ではない応答が返りました。",
                "error": str(e),
            }

    def submit(
        self,
        prompt: str,
        project_path: Optional[str] = None,
        ai_name: Optional[str] = None,
        user_id: str = "admin",
        enabled: bool = True,
        return_task_id: bool = True,
        request_timeout_sec: int = 15,
        task_id: Optional[str] = None,
        ai_model_plan: Optional[str] = None,
        ai_model_do: Optional[str] = None,
        ai_model_check: Optional[str] = None,
    ) -> dict:
        """AIタスク要求を登録する。task_idは通常省略し、外部IDを引き継ぐ場合だけ指定する。

        project_path / ai_name / ai_model_* が None（未指定）のときは payload に載せず、
        backend_taskteam 側が AIタスク_要求編集の新規時と同じ条件
        （利用者IDの更新最終レコードの値、無ければ規定値）で補完する。
        空文字は明示指定として送る（プロジェクトは空欄のまま登録される）。

        モデルはフェーズごとに指定する。ai_model_plan（準備＝明細分解）/ ai_model_do
        （各ステップの実行）/ ai_model_check（終了時の最終確認）。
        """
        prompt = (prompt or "").strip()
        user_id = (user_id or "").strip() or "admin"
        task_id = (task_id or "").strip()
        if not prompt:
            return {"status": "NG", "message": "prompt を指定してください。"}

        payload = {
            "利用者ID": user_id,
            "要求内容": prompt,
            "実行有効": bool(enabled),
        }
        # None は送らない（backend_taskteam が更新最終レコード → 規定値で補完する）
        if project_path is not None:
            payload["プロジェクト"] = str(project_path).strip()
        if ai_name is not None:
            payload["TASK_AI_NAME"] = str(ai_name).strip()
        for フェーズ, 値 in (
            ("plan", ai_model_plan), ("do", ai_model_do), ("check", ai_model_check)
        ):
            if 値 is not None:
                payload[f"TASK_AI_MODEL_{フェーズ}"] = str(値).strip()
        if task_id:
            payload["タスクID"] = task_id
        data = self._post_task_api("/task/タスク要求/AI登録", payload, request_timeout_sec)

        if data.get("status") != "OK":
            return {
                "status": "NG",
                "message": str(data.get("message") or "backend_taskteam へのタスク投入に失敗しました。"),
                "利用者ID": user_id,
            }

        item = data.get("data", {}).get("item", {})
        task_id = str(item.get("タスクID", ""))
        result = {
            "status": "OK",
            "message": "タスクを投入しました。",
            "利用者ID": str(item.get("利用者ID") or user_id),
            "タスクID": task_id,
            # 未指定時に backend_taskteam が補完した値を確認できるよう、登録結果を返す
            "プロジェクト": str(item.get("プロジェクト") or ""),
            "TASK_AI_NAME": str(item.get("TASK_AI_NAME") or ""),
            "TASK_AI_MODEL_plan": str(item.get("TASK_AI_MODEL_plan") or ""),
            "TASK_AI_MODEL_do": str(item.get("TASK_AI_MODEL_do") or ""),
            "TASK_AI_MODEL_check": str(item.get("TASK_AI_MODEL_check") or ""),
        }
        if return_task_id:
            result["task_id"] = task_id
        return result

    def get_request_status(self, user_id: str, task_id: str, request_timeout_sec: int = 15) -> dict:
        """AIタスク要求 1 件の状態を backend_taskteam API から取得する。"""
        user_id = (user_id or "").strip()
        task_id = (task_id or "").strip()
        if not user_id or not task_id:
            return {"status": "NG", "message": "利用者IDとタスクIDを指定してください。"}
        data = self._post_task_api(
            "/task/タスク要求/取得",
            {"利用者ID": user_id, "タスクID": task_id},
            request_timeout_sec,
        )
        if data.get("status") != "OK":
            return {
                "status": "NG",
                "message": str(data.get("message") or "タスク要求の取得に失敗しました。"),
                "利用者ID": user_id,
                "タスクID": task_id,
            }
        return {
            "status": "OK",
            "message": str(data.get("message") or ""),
            "利用者ID": user_id,
            "タスクID": task_id,
            "item": data.get("data", {}).get("item", {}),
        }

    def get_detail_status(self, user_id: str, task_id: str, request_timeout_sec: int = 15) -> dict:
        """AIタスク明細一覧の状態を backend_taskteam API から取得する。"""
        user_id = (user_id or "").strip()
        task_id = (task_id or "").strip()
        if not user_id or not task_id:
            return {"status": "NG", "message": "利用者IDとタスクIDを指定してください。"}
        data = self._post_task_api(
            "/task/タスク明細/一覧",
            {"利用者ID": user_id, "タスクID": task_id},
            request_timeout_sec,
        )
        if data.get("status") != "OK":
            return {
                "status": "NG",
                "message": str(data.get("message") or "タスク明細の取得に失敗しました。"),
                "利用者ID": user_id,
                "タスクID": task_id,
            }
        body = data.get("data", {})
        items = body.get("items", [])
        return {
            "status": "OK",
            "message": str(data.get("message") or ""),
            "利用者ID": user_id,
            "タスクID": task_id,
            "items": items,
            "total": body.get("total", len(items) if isinstance(items, list) else 0),
        }
