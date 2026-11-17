"""Inference-only Codex command boundary; no live model credentials required."""
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend_tools/tools_proc'))
import harness_codex_chat as codex
import harness_chat


class CodexChatTests(unittest.IsolatedAsyncioTestCase):
    def test_uses_path_codex_with_child_tools_disabled(self):
        # codex_cli は PATH 上の通常の codex を使い、aidiy_codex を起動しない。
        with patch.object(harness_chat.shutil, 'which', return_value=None):
            with self.assertRaisesRegex(ValueError, 'Codex CLIがありません'):
                codex.command('same', 'schema', 'result')
        with patch.object(harness_chat.shutil, 'which', return_value='/usr/bin/codex') as which:
            args = codex.command('same', 'schema', 'result')
            which.assert_called_with('codex')
            self.assertEqual(args[:2], ['/usr/bin/codex', 'exec'])
            self.assertFalse(any('aidiy_codex' in arg or 'aidiy-inference-only' in arg for arg in args))
            self.assertIn('--ignore-user-config', args)
            self.assertIn('--ephemeral', args)
            self.assertIn('--ignore-rules', args)
            self.assertEqual(args[args.index('--sandbox') + 1], 'read-only')
            disabled = {args[i + 1] for i, arg in enumerate(args) if arg == '--disable'}
            self.assertTrue({'shell_tool', 'unified_exec', 'apps', 'plugins', 'computer_use', 'hooks'} <= disabled)
            self.assertIn('web_search=disabled', args)
            self.assertNotIn('--model', args)
            self.assertEqual(args[-1], '-')
            self.assertEqual(codex.command('gpt-6.1-sol', 'schema', 'result')[-3:], ['--model', 'gpt-6.1-sol', '-'])
            for model in ('codex_cli/same', 'copilot_cli/same', 'aidiy_hermes/same'):
                with self.assertRaisesRegex(ValueError, '再指定'):
                    codex.command(model, 'schema', 'result')

    async def test_round_trip_and_temp_cleanup(self):
        expected = {'content': '', 'tool_calls': [{'name':'read', 'arguments': {'path':'today.txt'}}]}
        transport = {'content': '', 'tool_calls': [{'name':'read', 'arguments': '{"path":"today.txt"}'}]}
        paths = []
        async def process(args, payload, cwd):
            self.assertIn('outer agent', payload.decode())
            self.assertIn('memory fixture', payload.decode())
            result = Path(args[args.index('--output-last-message') + 1])
            paths.append(result)
            self.assertEqual(result.parent, Path(cwd))
            result.write_text(json.dumps(transport), encoding='utf-8')
            return b''
        with patch.object(harness_chat, 'cli_entry', return_value=['codex']), patch.object(harness_chat, 'run_process', process):
            result = await codex.chat({'model': 'same', 'messages': [{'role':'system', 'content':'memory fixture'}], 'tools': []})
        self.assertEqual(result, expected)
        self.assertFalse(paths[0].exists())

    async def test_shared_outer_tool_validation(self):
        from unittest.mock import AsyncMock
        tool = {'type': 'function', 'function': {'name': 'read', 'parameters': {
            'type': 'object', 'properties': {'path': {'type':'string'}},
            'required': ['path'], 'additionalProperties': False}}}
        request = {'provider':'codex_cli', 'model':'same',
                   'messages':[{'role':'user', 'content':'read today.txt'}], 'tools':[tool]}
        value = {'content':'', 'tool_calls':[{'name':'read', 'arguments':{'path':'today.txt'}}]}
        with patch.object(codex, 'chat', AsyncMock(return_value=value)):
            message = await harness_chat.run_chat(request)
        self.assertEqual(message['tool_calls'][0]['function']['name'], 'read')
        self.assertTrue(message['tool_calls'][0]['id'].startswith('call_'))
        value['tool_calls'][0]['name'] = 'unregistered_shell'
        with patch.object(codex, 'chat', AsyncMock(return_value=value)):
            with self.assertRaisesRegex(ValueError, '未登録'):
                await harness_chat.run_chat(request)

    async def test_unknown_flag_failure_does_not_fallback(self):
        count = 0
        async def process(*args):
            nonlocal count
            count += 1
            raise ValueError('unknown flag --aidiy-inference-only')
        with patch.object(harness_chat, 'cli_entry', return_value=['codex']), patch.object(harness_chat, 'run_process', process):
            with self.assertRaisesRegex(ValueError, 'unknown flag'):
                await codex.chat({'model':'same', 'messages':[], 'tools':[]})
        self.assertEqual(count, 1)
