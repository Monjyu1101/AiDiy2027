# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""Codex OAuth Responses + strict JSON SchemaによるDecisions互換判断。"""
import asyncio
import base64
import json

import httpx

from AIコア.AI判断共通 import DecisionError, DecisionRequest, answer_json_schema, json_instructions, parse_json_answers


def oauth_headers() -> dict:
    # 既存チャットと同じ認証更新・排他制御を共用する。
    from AIコア.AIチャット_openai import _oauth_access_token

    try:
        token = _oauth_access_token(refresh_if_expiring=True)
        if not token:
            raise ValueError("missing token")
        segment = token.split(".")[1]
        claims = json.loads(base64.urlsafe_b64decode(segment + "=" * (-len(segment) % 4)))
        account = claims.get("https://api.openai.com/auth", {}).get("chatgpt_account_id")
    except Exception:
        raise DecisionError("Codex OAuth認証が必要です。codex login または aidiy_hermes でログインしてください") from None
    headers = {"Authorization": f"Bearer {token}", "Accept": "text/event-stream"}
    if account:
        headers["ChatGPT-Account-Id"] = account
    return headers


class DecisionAI:
    method = "responses_json_schema"

    async def 実行(self, request: DecisionRequest, model: str, config: dict, client: httpx.AsyncClient) -> dict:
        headers = await asyncio.to_thread(oauth_headers)
        raw = request.model_dump(include={"input", "questions"})
        messages = raw["input"]
        if isinstance(messages, str):
            messages = [{"role": "user", "content": [{"type": "input_text", "text": messages}]}]
        instructions = json_instructions(request.questions)
        payload = {
            "model": model, "instructions": instructions, "input": messages,
            "store": False, "stream": True,
            "text": {"format": {"type": "json_schema", "name": "aidiy_decisions", "strict": True, "schema": answer_json_schema(request.questions)}},
        }
        async with client.stream("POST", "https://chatgpt.com/backend-api/codex/responses", headers=headers, json=payload) as response:
            if response.is_error:
                raise DecisionError(f"OAuth Responses HTTP {response.status_code}（認証・モデル・JSON Schema対応を確認）")
            text_deltas = []
            # Content-Type が省略される場合もあるため、要求したSSE形式として読む。
            async for line in response.aiter_lines():
                if not line.startswith("data:"):
                    continue
                body = line[5:].strip()
                if not body or body == "[DONE]":
                    continue
                event = json.loads(body)
                kind = event.get("type")
                if kind == "response.output_text.delta":
                    text_deltas.append(event.get("delta", ""))
                if kind in ("error", "response.failed", "response.incomplete"):
                    raise DecisionError("OAuth Responses が失敗または未完了で終了しました")
                if kind == "response.completed":
                    completed = event.get("response", {})
                    if completed.get("status") != "completed":
                        raise DecisionError("OAuth Responses の完了状態が不正です")
                    content = [part for item in completed.get("output", []) if item.get("type") == "message" for part in item.get("content", [])]
                    if any(part.get("type") == "refusal" for part in content):
                        return {"answers": [{"type": "refusal", "name": q.name, "refusal": "モデルが回答を拒否しました"} for q in request.questions]}
                    text = "".join(part.get("text", "") for part in content if part.get("type") == "output_text")
                    # Codex OAuthは完了イベントで本文を再掲しない場合がある。
                    # 完了が確認できた場合だけ受信済みdeltaを採用する。
                    if not text:
                        text = "".join(text_deltas)
                    data = parse_json_answers(text)
                    data["usage"] = completed.get("usage")
                    return data
        raise DecisionError("OAuth Responses のストリームが完了前に切断されました")
