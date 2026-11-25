# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
"""Googleログイン済みAGYを、履歴なしのテキスト判断に使う。"""

import json
import re

import httpx

from AIコア.AIチャット_gemini_agy import ChatAI
from AIコア.AI実行オプション import AI実行オプション
from AIコア.AI判断共通 import DecisionError, DecisionRequest, answer_json_schema, json_instructions, parse_json_answers


class DecisionAI:
    method = "gemini_agy_jsonchat"

    async def 実行(self, request: DecisionRequest, model: str, config: dict, client: httpx.AsyncClient) -> dict:
        evidence = request.model_dump(include={"input"})["input"]
        if isinstance(evidence, list):
            texts = []
            for message in evidence:
                content = message["content"]
                if isinstance(content, str):
                    texts.append(content)
                else:
                    for part in content:
                        if part["type"] != "input_text":
                            raise DecisionError("gemini_agy の判断はテキスト専用です。画像は他の方式を選んでください。")
                        texts.append(part["text"])
            evidence = json.dumps(texts, ensure_ascii=False)
        instruction = json_instructions(request.questions) + "\nJSON Schema:\n" + json.dumps(
            answer_json_schema(request.questions), ensure_ascii=False
        )
        chat = ChatAI(AI_MODEL=model, system_instruction=instruction, 実行オプション=AI実行オプション.単発())
        try:
            if not await chat.開始():
                raise DecisionError("Antigravity CLI (agy) が見つかりません。")
            try:
                answer = await chat.実行(evidence, タイムアウト秒数=max(1, int(request.timeout_sec)))
            except (OSError, RuntimeError) as exc:
                raise DecisionError("agy の判断を実行できません。Googleログインと利用モデルを確認してください。") from exc
        finally:
            await chat.終了()
        # CLI は JSON Schema 強制モードを持たない。全体を囲う単一のフェンスだけ許容し、
        # 前後の文章・壊れた JSON・回答の不足は補修せず共通検証で拒否する。
        wrapped = re.fullmatch(r"```(?:json)?[ \t]*\r?\n(.*?)\r?\n```", answer.strip(), re.S | re.I)
        return parse_json_answers(wrapped[1] if wrapped else answer)
