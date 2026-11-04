# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""OpenAI Decisions API（APIキー認証）。SDKバージョンに依存しないHTTP実装。"""
import httpx

from AIコア.AI判断共通 import DecisionError, DecisionRequest, configured_api_key


class DecisionAI:
    method = "decisions_api"

    async def 実行(self, request: DecisionRequest, model: str, config: dict, client: httpx.AsyncClient) -> dict:
        key = configured_api_key(config.get("openai_key_id"))
        if not key:
            raise DecisionError("openai_key_id が未設定です")
        headers = {"Authorization": f"Bearer {key}"}
        organization = str(config.get("openai_organization") or "").strip()
        if organization and not organization.startswith("<"):
            headers["OpenAI-Organization"] = organization
        payload = request.model_dump(include={"input", "questions"})
        payload["model"] = model
        response = await client.post("https://api.openai.com/v1/decisions", headers=headers, json=payload)
        if response.is_error:
            # レスポンス本文には認証情報が含まれ得るので外へ転記しない。
            raise DecisionError(f"Decisions API HTTP {response.status_code}（APIキー・利用権限・課金・入力を確認）")
        return response.json()
