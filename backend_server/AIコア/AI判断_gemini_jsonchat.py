# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""Gemini generateContent + JSON Schemaによる判断。会話履歴・再送は持たない。"""
from urllib.parse import quote

import httpx

from AIコア.AI判断共通 import (
    DecisionError, DecisionRequest, answer_json_schema, first_configured_api_key,
    json_instructions, parse_json_answers,
)


class DecisionAI:
    method = "gemini_json_schema"
    key_fields = ("gemini_key_id", "freeai_key_id")

    async def 実行(self, request: DecisionRequest, model: str, config: dict, client: httpx.AsyncClient) -> dict:
        key = first_configured_api_key(config, *self.key_fields)
        if not key:
            raise DecisionError(f"{' / '.join(self.key_fields)} が未設定です")
        raw = request.model_dump(include={"input"})["input"]
        if isinstance(raw, str):
            raw = [{"content": raw}]
        contents = []
        for message in raw:
            content = message["content"]
            parts = []
            if isinstance(content, str):
                parts.append({"text": content})
            else:
                for part in content:
                    if part["type"] == "input_text":
                        parts.append({"text": part["text"]})
                    else:
                        media, data = part["image_url"].split(";base64,", 1)
                        parts.append({"inlineData": {"mimeType": media.removeprefix("data:"), "data": data}})
            contents.append({"role": "user", "parts": parts})
        payload = {
            "systemInstruction": {"parts": [{"text": json_instructions(request.questions)}]},
            "contents": contents,
            "generationConfig": {
                "candidateCount": 1, "responseMimeType": "application/json",
                "responseJsonSchema": answer_json_schema(request.questions),
            },
        }
        # 既存Chatと同じGoogle API。共有httpx clientの環境proxy/TLS設定を利用する。
        endpoint = "https://generativelanguage.googleapis.com/v1beta/models/" + quote(model.removeprefix("models/"), safe="") + ":generateContent"
        response = await client.post(endpoint, headers={"x-goog-api-key": key}, json=payload)
        if response.is_error:
            raise DecisionError(f"Gemini JSON判断 HTTP {response.status_code}（APIキー・モデル・JSON対応・利用制限を確認）")
        body = response.json()
        candidates = body.get("candidates")
        if body.get("promptFeedback", {}).get("blockReason"):
            raise DecisionError("Gemini JSON判断は入力を拒否しました")
        if not isinstance(candidates, list) or len(candidates) != 1:
            raise DecisionError("Gemini JSON判断の回答候補が不正です")
        candidate = candidates[0]
        if candidate.get("finishReason") != "STOP":
            raise DecisionError("Gemini JSON判断が拒否・未完了・異常終了しました")
        parts = candidate.get("content", {}).get("parts")
        if not isinstance(parts, list) or not parts:
            raise DecisionError("Gemini JSON判断の本文がありません")
        texts = []
        for part in parts:
            if part.get("thought") is True:
                continue
            if not isinstance(part.get("text"), str):
                raise DecisionError("Gemini JSON判断の本文形式が不正です")
            texts.append(part["text"])
        data = parse_json_answers("".join(texts))
        data["usage"] = body.get("usageMetadata")
        return data
