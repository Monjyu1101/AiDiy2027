"""JSON固定補助応答と本体CLIの形式再試行を実subprocess境界で検証。"""
import io
import json
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / 'command_hermes'), str(ROOT / 'backend_tools')]
from hermes_cli.aidiy_cli_bridge import run_cli
from hermes_cli.aidiy_cli_json import structured_validator
from tools_proc.harness_chat import validate_request, validate_response
import jsonschema


class RecoveryTest(unittest.TestCase):
    def invoke(self, outputs, **options):
        requests = []
        results = iter(outputs)
        class Input(io.BytesIO):
            def close(self):
                if not self.closed:
                    requests.append(json.loads(self.getvalue()))
                super().close()
        class Process:
            def __init__(self, *a, **kw):
                self.stdin = Input()
                self.stdout = io.BytesIO((json.dumps(next(results)) + '\n').encode())
            def wait(self, **kw): return 0
            def poll(self): return 0
        def validate(*a, **kw):
            req = json.loads(kw['input'])
            try:
                message = validate_response(req['response'], validate_request(req), req.get('tool_choice', 'auto'))
                result = {'type': 'result', 'ok': True, 'message': message}
            except ValueError:
                result = {'type': 'result', 'ok': False}
            return SimpleNamespace(returncode=0, stdout=json.dumps(result).encode())
        self.requests = requests
        with patch('pathlib.Path.is_file', return_value=True), patch('subprocess.Popen', Process), patch('subprocess.run', side_effect=validate):
            return run_cli(ROOT, 'copilot-cli', 'same', '', str(ROOT), 'normal', lambda _: None,
                           cli_mode='chat', messages=[{'role': 'user', 'content': '昨日の作業内容を分析して'}], **options)

    @staticmethod
    def output(text):
        return {'type': 'result', 'ok': True, 'text': text}

    def test_title_direct_json_no_double_encoding(self):
        fmt = {'type': 'json_schema', 'json_schema': {'schema': {'type': 'object', 'required': ['title'],
            'properties': {'title': {'type': 'string'}}, 'additionalProperties': False}}}
        result = self.invoke([self.output('説明\n```json\n{"title":"朝の挨拶"}\n```')], response_format=fmt)
        self.assertEqual(json.loads(result['content']), {'title': '朝の挨拶'})
        self.assertEqual(result['tool_calls'], [])
        self.assertIn('do NOT wrap', self.requests[0]['engine_prompt'])
        with self.assertRaisesRegex(ValueError, 'schema'):
            self.invoke([self.output('{"title":123}')], response_format=fmt)
        self.assertEqual(len(self.requests), 1)

    def test_malformed_tool_request_retried_then_validated(self):
        tools = [{'type': 'function', 'function': {'name': 'read', 'parameters': {'type': 'object',
            'required': ['path'], 'properties': {'path': {'type': 'string'}}}}}]
        result = self.invoke([self.output('{"content":"bad "quote""}'), self.output(
            '{"content":"","tool_calls":[{"name":"read","arguments":{"path":"README.md"}}]}')], tools=tools)
        self.assertEqual(result['tool_calls'][0]['function']['name'], 'read')
        self.assertEqual(len(self.requests), 2)
        self.assertIn('FORMAT RETRY', self.requests[1]['engine_prompt'])
        self.assertNotIn('bad "quote"', self.requests[1]['engine_prompt'])

    def test_retry_limit_and_no_auth_retry(self):
        with self.assertRaisesRegex(ValueError, '1回'):
            self.invoke([self.output('not JSON'), self.output('{bad}')])
        self.assertEqual(len(self.requests), 2)
        with self.assertRaisesRegex(ValueError, '認証'):
            self.invoke([{'type': 'result', 'ok': False, 'text': '認証エラー'}])
        self.assertEqual(len(self.requests), 1)

    def test_unregistered_tool_not_retried_or_executed(self):
        with self.assertRaisesRegex(ValueError, '検証'):
            self.invoke([self.output('{"content":"","tool_calls":[{"name":"delete","arguments":{}}]}')])
        self.assertEqual(len(self.requests), 1)

    def test_format_schema_refs_and_tools_are_rejected(self):
        with self.assertRaisesRegex(ValueError, '外部参照'):
            structured_validator({'type': 'json_schema', 'json_schema': {'schema': {
                'type': 'object', '$ref': 'https://example.invalid/schema'}}})
        with self.assertRaisesRegex(ValueError, 'ツールなし'):
            self.invoke([], response_format={'type': 'json_object'}, tools=[{}])
        self.assertEqual(self.requests, [])

    def test_cancel_before_cli(self):
        with self.assertRaises(InterruptedError):
            self.invoke([], cancelled=lambda: True)
        self.assertEqual(self.requests, [])

if __name__ == '__main__': unittest.main()
