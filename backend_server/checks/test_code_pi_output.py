# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
"""Pi JSONLの完了・異常終了・ツール混在を、外部プロセスなしで確認する。"""
import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location(
    "pi_output_under_test", Path(__file__).resolve().parents[1] / "AIコア" / "AIコードPi出力.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PiOutputTest(unittest.TestCase):
    def feed(self, output, **event):
        return output.解析(json.dumps(event, ensure_ascii=False))

    def finish(self, output, reason="stop", text="回答"):
        self.feed(output, type="message_end", message={
            "role": "assistant", "stopReason": reason, "content": [{"type": "text", "text": text}]})
        self.feed(output, type="agent_end")

    def test_tools_and_thinking_are_progress_only(self):
        output = module.PiJSON出力()
        self.feed(output, type="agent_start")
        self.feed(output, type="message_update", assistantMessageEvent={"type": "thinking_delta", "delta": "調査中\n"})
        self.feed(output, type="message_end", message={"role": "assistant", "stopReason": "toolUse", "content": [{"type": "text", "text": "中間回答"}]})
        self.assertIn("read", self.feed(output, type="tool_execution_start", toolName="read")[0])
        self.feed(output, type="message_end", message={"role": "toolResult", "content": [{"type": "text", "text": "ツール結果"}]})
        self.finish(output)
        self.assertEqual(output.回答, "回答")

    def test_errors_are_failure_even_with_text_and_exit_zero(self):
        for reason in ("error", "aborted", "length"):
            with self.subTest(reason=reason):
                output = module.PiJSON出力()
                self.finish(output, reason)
                self.assertTrue(output.回答.startswith("!"))

    def test_truncated_stream_is_not_success(self):
        output = module.PiJSON出力()
        self.feed(output, type="message_end", message={"role": "assistant", "stopReason": "stop", "content": [{"type": "text", "text": "途中"}]})
        self.assertTrue(output.回答.startswith("!"))

    def test_successful_retry_replaces_api_failure(self):
        output = module.PiJSON出力()
        self.finish(output, "error")
        self.feed(output, type="agent_start")
        self.finish(output, text="再試行の回答")
        self.assertEqual(output.回答, "再試行の回答")


if __name__ == "__main__":
    unittest.main()
