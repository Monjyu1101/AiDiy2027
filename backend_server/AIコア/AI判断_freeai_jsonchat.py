# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""FreeAI設定キーを優先し、Geminiと同じJSON判断を実行する。"""
from AIコア.AI判断_gemini_jsonchat import DecisionAI as GeminiDecisionAI


class DecisionAI(GeminiDecisionAI):
    key_fields = ("freeai_key_id", "gemini_key_id")
