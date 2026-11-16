"""モデル認証なしでchat境界と旧方式への非降格を検証。"""
import asyncio
import importlib.util
import io
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import AsyncMock, patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'backend_tools/tools_proc'))
import harness_chat as chat
import harness_cli as cli

TOOL = {'type': 'function', 'function': {'name': 'read', 'parameters': {
    'type': 'object', 'properties': {'path': {'type': 'string'}},
    'required': ['path'], 'additionalProperties': False}}}


def request():
    return {'cli_mode': 'chat', 'provider': 'claude_cli', 'model': 'same', 'project': str(ROOT), 'mode': 'normal',
            'messages': [{'role': 'user', 'content': 'read a file'}], 'tools': [TOOL]}


class ChatTests(unittest.IsolatedAsyncioTestCase):
    def test_schema_and_unknown_tools_fail_closed(self):
        defs = chat.validate_request(request())
        for value in [
            {'content': '', 'tool_calls': [{'name': 'shell', 'arguments': {}}]},
            {'content': '', 'tool_calls': [{'name': 'read', 'arguments': {'path': 1}}]},
            {'content': '', 'tool_calls': [{'name': 'read', 'arguments': {'path': 'a', 'extra': 1}}]},
            {'content': '', 'tool_calls': []},
        ]:
            with self.assertRaises(Exception):
                chat.normalize_response(value, defs)

    def test_ids_generated_by_outer_protocol(self):
        defs = chat.validate_request(request())
        v = {'content': '', 'tool_calls': [{'name': 'read', 'arguments': {'path': 'a'}}]}
        a, b = chat.normalize_response(v, defs), chat.normalize_response(v, defs)
        self.assertNotEqual(a['tool_calls'][0]['id'], b['tool_calls'][0]['id'])
        self.assertEqual(json.loads(a['tool_calls'][0]['function']['arguments']), {'path': 'a'})

    def test_tool_results_correlate_and_no_multimedia_loss(self):
        r = request()
        r['messages'] += [{'role': 'assistant', 'content': None, 'tool_calls': [
            {'id': 'x', 'type': 'function', 'function': {'name': 'read', 'arguments': '{"path":"a"}'}}]}]
        with self.assertRaises(ValueError): chat.validate_request(r)
        r['messages'] += [{'role': 'tool', 'tool_call_id': 'x', 'content': 'hello'}]
        chat.validate_request(r)
        r['messages'][-1]['tool_call_id'] = 'wrong'
        with self.assertRaises(ValueError): chat.validate_request(r)
        r = request(); r['messages'][0]['content'] = [{'type': 'image_url', 'image_url': 'x'}]
        with self.assertRaises(ValueError): chat.validate_request(r)

    def test_no_remote_schema_fetch(self):
        r = request()
        r['tools'] = [{'type': 'function', 'function': {'name': 'r', 'parameters': {'$ref': 'https://example.com/schema'}}}]
        with self.assertRaises(ValueError): chat.validate_request(r)

    def test_no_child_tools_or_project_settings(self):
        with patch.object(chat.shutil, 'which', return_value='/bin/claude'):
            cmd = chat.claude_command('same')
        self.assertEqual(cmd[cmd.index('--tools')+1], '')
        self.assertIn('--strict-mcp-config', cmd)
        self.assertIn('--safe-mode', cmd)
        self.assertEqual(cmd[cmd.index('--setting-sources')+1], '')
        self.assertNotIn('--dangerously-skip-permissions', cmd)

    async def test_explicit_chat_and_round_trip(self):
        r = request()
        raw = {'content': '', 'tool_calls': [{'name': 'read', 'arguments': {'path': 'a'}}]}
        process = AsyncMock(return_value=json.dumps({'type': 'result', 'structured_output': raw}).encode())
        out = io.StringIO()
        with patch.object(chat, 'claude_command', return_value=['fake']), patch.object(chat, 'run_process', process), patch.object(cli, 'OUTPUT', out):
            await cli.run(r)
        event = json.loads(out.getvalue())
        self.assertTrue(event['ok'])
        self.assertEqual(event['message']['tool_calls'][0]['function']['name'], 'read')
        sent = json.loads(process.call_args.args[1])
        self.assertEqual(sent['tools'], [TOOL])
        self.assertNotEqual(process.call_args.args[2], str(ROOT))
        r['messages'] += [event['message'], {'role': 'tool', 'tool_call_id': event['message']['tool_calls'][0]['id'], 'content': 'file data'}]
        chat.validate_request(r)

    async def test_initial_greeting_and_outer_file_analysis_scope(self):
        # Deterministic engine stub, not an authenticated model quality test.
        import tempfile
        r = request()
        r["messages"] = [{"role": "system", "content": "memory: Japanese, report dates"},
                         {"role": "user", "content": "おはよう"}]
        greeting = {"content": "おはようございます", "tool_calls": []}
        with patch.object(chat, "claude_command", return_value=["fake"]), patch.object(chat, "run_process", AsyncMock(return_value=json.dumps({"type":"result", "structured_output":greeting}).encode())):
            self.assertEqual((await chat.run_chat(r))["content"], "おはようございます")
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "today.txt"
            path.write_text("today's work", encoding="utf-8")
            r["messages"].append({"role":"user", "content":"ファイル更新日で今日の作業分析、報告して"})
            call = {"content":"", "tool_calls":[{"name":"read", "arguments":{"path":str(path)}}]}
            mock = AsyncMock(return_value=json.dumps({"type":"result", "structured_output":call}).encode())
            with patch.object(chat, "claude_command", return_value=["fake"]), patch.object(chat, "run_process", mock):
                message = await chat.run_chat(r)
            # Only the outer harness executes. The engine receives actual tool output next turn.
            result = json.dumps({"mtime": path.stat().st_mtime, "text": path.read_text()})
            r["messages"] += [message, {"role":"tool", "tool_call_id":message["tool_calls"][0]["id"], "content":result}]
            mock = AsyncMock(return_value=json.dumps({"type":"result", "structured_output":{"content":"今日更新されたファイルの作業内容です", "tool_calls":[]}}).encode())
            with patch.object(chat, "claude_command", return_value=["fake"]), patch.object(chat, "run_process", mock):
                answer = await chat.run_chat(r)
            forwarded = json.loads(mock.call_args.args[1])["messages"]
            self.assertEqual(forwarded[-1]["content"], result)
            self.assertIn("memory:", forwarded[0]["content"])
            self.assertFalse(answer["tool_calls"])

    async def test_unsupported_child_never_delegates(self):
        r = request(); r['provider'] = 'codex_cli'
        with self.assertRaisesRegex(ValueError, 'passthrough'):
            await cli.run(r)

    async def test_no_markdown_or_plain_text_tool_extraction(self):
        with patch.object(chat, 'claude_command', return_value=['fake']), patch.object(chat, 'run_process', AsyncMock(return_value=b'{"type":"result","result":"call read(a)"}')):
            with self.assertRaises(Exception): await chat.run_chat(request())


if __name__ == '__main__': unittest.main()
