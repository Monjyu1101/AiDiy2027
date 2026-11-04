# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""
Team Agents モジュール

backend_taskteam の HTTP API に疎結合で接続し、Aチーム依頼レコードを追加する。
DB 直書きや backend_taskteam の import は行わない。
登録された依頼は backend_taskteam の起動監視ループが拾い、AIタスク要求へ投入する。
"""

from __future__ import annotations

import os
from typing import Optional

import requests

from .taskteam_auth import post_taskteam


class TeamAgents:
    """backend_taskteam API へ Aチーム依頼を投入する薄いクライアント"""

    def __init__(self, team_api_base: Optional[str] = None):
        self.team_api_base = (team_api_base or os.environ.get("AIDIY_TEAM_API_BASE") or "http://127.0.0.1:8093").rstrip("/")

    def get_config(self) -> dict:
        """接続先と疎通状態を返す。backend_taskteam 未起動でも例外にしない。"""
        health_url = f"{self.team_api_base}/health"
        info = {
            "team_api_base": self.team_api_base,
            "submit_endpoint": f"{self.team_api_base}/team/依頼/登録",
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

    def _post_team_api(self, path: str, payload: dict, request_timeout_sec: int) -> dict:
        """backend_taskteam の API を POST で呼び出す。接続不能時も dict で返す。"""
        url = f"{self.team_api_base}{path}"
        try:
            res = post_taskteam(url, payload, timeout=max(1, int(request_timeout_sec)))
            return res.json()
        except requests.RequestException as e:
            return {
                "status": "NG",
                "message": (
                    f"backend_taskteam ({self.team_api_base}) に接続できません。"
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
        member_id: str = "admin",
        team_ai_name: Optional[str] = None,
        task_ai_name: Optional[str] = None,
        enabled: bool = True,
        return_work_id: bool = True,
        request_timeout_sec: int = 15,
        team_ai_model_plan: Optional[str] = None,
        team_ai_model_do: Optional[str] = None,
        team_ai_model_check: Optional[str] = None,
        task_ai_model_plan: Optional[str] = None,
        task_ai_model_do: Optional[str] = None,
        task_ai_model_check: Optional[str] = None,
    ) -> dict:
        """Aチーム依頼を「準備開始」で登録する。依頼IDは backend_taskteam が自動採番する。

        project_path / team_ai_name / task_ai_name / *_ai_model_* が None（未指定）のときは
        payload に載せず、backend_taskteam 側が AIチーム_依頼編集の新規時と同じ条件
        （要員IDの更新最終レコードの値、無ければ規定値）で補完する。
        空文字は明示指定として送る（プロジェクトは空欄のまま登録される）。

        モデルは plan / do / check の3種ずつ指定する。TEAM 側は作業ループの段
        （相談・計画 / 実施 / 評価・改善）、TASK 側は投入する Aタスクの内部フェーズ
        （準備 / 各ステップ / 最終確認）に対応する。
        """
        prompt = (prompt or "").strip()
        member_id = (member_id or "").strip() or "admin"
        if not prompt:
            return {"status": "NG", "message": "prompt を指定してください。"}

        payload = {
            "要員ID": member_id,
            "要求内容": prompt,
            "実行有効": bool(enabled),
            "状態": "準備開始",
            "操作利用者ID": member_id,
            "操作利用者名": member_id,
            "操作端末ID": "aidiy_team_agents",
        }
        # None は送らない（backend_taskteam が更新最終レコード → 規定値で補完する）
        if project_path is not None:
            payload["プロジェクト"] = str(project_path).strip()
        if team_ai_name is not None:
            payload["TEAM_AI_NAME"] = str(team_ai_name).strip()
        if task_ai_name is not None:
            payload["TASK_AI_NAME"] = str(task_ai_name).strip()
        for 接頭辞, 値一覧 in (
            ("TEAM", (team_ai_model_plan, team_ai_model_do, team_ai_model_check)),
            ("TASK", (task_ai_model_plan, task_ai_model_do, task_ai_model_check)),
        ):
            for フェーズ, 値 in zip(("plan", "do", "check"), 値一覧):
                if 値 is not None:
                    payload[f"{接頭辞}_AI_MODEL_{フェーズ}"] = str(値).strip()
        data = self._post_team_api("/team/依頼/登録", payload, request_timeout_sec)

        if data.get("status") != "OK":
            return {
                "status": "NG",
                "message": str(data.get("message") or "backend_taskteam への依頼投入に失敗しました。"),
                "要員ID": member_id,
            }

        item = data.get("data", {}).get("item", {})
        work_id = str(item.get("依頼ID", ""))
        result = {
            "status": "OK",
            "message": "チーム依頼を投入しました。",
            "要員ID": str(item.get("要員ID") or member_id),
            "依頼ID": work_id,
            # 未指定時に backend_taskteam が補完した値を確認できるよう、登録結果を返す
            "プロジェクト": str(item.get("プロジェクト") or ""),
            "TEAM_AI_NAME": str(item.get("TEAM_AI_NAME") or ""),
            "TASK_AI_NAME": str(item.get("TASK_AI_NAME") or ""),
            **{
                f"{接頭辞}_AI_MODEL_{フェーズ}": str(item.get(f"{接頭辞}_AI_MODEL_{フェーズ}") or "")
                for 接頭辞 in ("TEAM", "TASK")
                for フェーズ in ("plan", "do", "check")
            },
            "状態": str(item.get("状態") or ""),
        }
        if return_work_id:
            result["work_id"] = work_id
        return result

    def get_work_status(self, member_id: str, work_id: str, request_timeout_sec: int = 15) -> dict:
        """Aチーム依頼 1 件の状態を backend_taskteam API から取得する。"""
        member_id = (member_id or "").strip()
        work_id = (work_id or "").strip()
        if not member_id or not work_id:
            return {"status": "NG", "message": "要員IDと依頼IDを指定してください。"}
        data = self._post_team_api(
            "/team/依頼/取得",
            {"要員ID": member_id, "依頼ID": work_id},
            request_timeout_sec,
        )
        if data.get("status") != "OK":
            return {
                "status": "NG",
                "message": str(data.get("message") or "チーム依頼の取得に失敗しました。"),
                "要員ID": member_id,
                "依頼ID": work_id,
            }
        return {
            "status": "OK",
            "message": str(data.get("message") or ""),
            "要員ID": member_id,
            "依頼ID": work_id,
            "item": data.get("data", {}).get("item", {}),
        }

    def get_work_list(self, member_id: str, request_timeout_sec: int = 15) -> dict:
        """要員のAチーム依頼一覧を backend_taskteam API から取得する。"""
        member_id = (member_id or "").strip()
        if not member_id:
            return {"status": "NG", "message": "要員IDを指定してください。"}
        data = self._post_team_api(
            "/team/依頼/一覧",
            {"要員ID": member_id},
            request_timeout_sec,
        )
        if data.get("status") != "OK":
            return {
                "status": "NG",
                "message": str(data.get("message") or "チーム依頼一覧の取得に失敗しました。"),
                "要員ID": member_id,
            }
        body = data.get("data", {})
        items = body.get("items", [])
        return {
            "status": "OK",
            "message": str(data.get("message") or ""),
            "要員ID": member_id,
            "items": items,
            "total": body.get("total", len(items) if isinstance(items, list) else 0),
        }

    def get_member_list(self, include_disabled: bool = False, request_timeout_sec: int = 15) -> dict:
        """Aチーム要員の一覧を backend_taskteam API から取得する（要員IDの確認用）。"""
        data = self._post_team_api(
            "/team/要員/一覧",
            {"無効も表示": bool(include_disabled)},
            request_timeout_sec,
        )
        if data.get("status") != "OK":
            return {
                "status": "NG",
                "message": str(data.get("message") or "チーム要員一覧の取得に失敗しました。"),
            }
        body = data.get("data", {})
        items = body.get("items", [])
        return {
            "status": "OK",
            "message": str(data.get("message") or ""),
            "items": items,
            "total": body.get("total", len(items) if isinstance(items, list) else 0),
        }
