# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
"""Pi JSONL の進捗と正式回答を分離する。生JSON・ツール結果は回答へ混ぜない。"""
import json


class PiJSON出力:
    def __init__(self):
        self.本文 = ""
        self.エラー = ""
        self.完了 = False
        self.思考断片 = ""

    @property
    def 回答(self):
        if self.エラー:
            return f"! Pi実行エラー: {self.エラー}"
        if not self.完了 or not self.本文.strip():
            return "! Piの最終回答を確認できませんでした。"
        return self.本文.strip()

    def 残りの進捗(self):
        text, self.思考断片 = self.思考断片, ""
        return [f"[Pi thinking] {text}"] if text.strip() else []

    def 解析(self, line):
        if not line.strip():
            return []
        try:
            event = json.loads(line)
        except (ValueError, TypeError):
            self.エラー = "JSON出力を解析できませんでした。"
            return []
        if not isinstance(event, dict):
            return []
        kind = event.get("type")
        if kind == "agent_start":
            self.完了 = False
        elif kind == "agent_end":
            self.完了 = True
        elif kind == "message_start":
            message = event.get("message")
            if isinstance(message, dict) and message.get("role") == "assistant":
                self.本文 = ""
                return ["[Pi] 回答を生成中…"]
        elif kind == "message_update":
            update = event.get("assistantMessageEvent")
            if not isinstance(update, dict):
                return []
            if update.get("type") == "thinking_delta" and isinstance(update.get("delta"), str):
                self.思考断片 += update["delta"]
                if "\n" in self.思考断片 or len(self.思考断片) >= 160:
                    return self.残りの進捗()
            elif update.get("type") == "thinking_end":
                return self.残りの進捗()
        elif kind == "message_end":
            message = event.get("message")
            if not isinstance(message, dict) or message.get("role") != "assistant":
                return []
            reason = message.get("stopReason")
            if reason in ("error", "aborted", "length"):
                self.エラー = str(message.get("errorMessage") or reason)[:1000]
            elif reason == "stop":
                # 自動リトライ後の成功は、先行したAPIエラーを置き換える。
                self.エラー = ""
                content = message.get("content", [])
                if isinstance(content, list):
                    self.本文 = "\n".join(part["text"] for part in content
                        if isinstance(part, dict) and part.get("type") == "text" and isinstance(part.get("text"), str))
        elif kind in ("tool_execution_start", "tool_execution_update", "tool_execution_end"):
            name = event.get("toolName", "tool")
            status = {"tool_execution_start": "開始", "tool_execution_update": "実行中", "tool_execution_end": "完了"}[kind]
            if event.get("isError"):
                status = "失敗"
            return [f"[Pi tool] {name} {status}"]
        elif kind == "auto_retry_start":
            return ["[Pi] API接続を再試行中…"]
        return []
