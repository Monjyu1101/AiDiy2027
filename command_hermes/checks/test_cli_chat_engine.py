"""CLI chat keeps structured tool calls in the Hermes loop."""
import ast
import importlib.util
import os
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('bridge', ROOT / 'hermes_cli/aidiy_cli_bridge.py')
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)

class ChatEngineTest(unittest.TestCase):
    def test_default_and_explicit_mode(self):
        cli = SimpleNamespace(_aidiy_provider_slug='copilot-cli')
        self.assertTrue(bridge.uses_chat_engine(cli))
        cli._aidiy_cli_mode = 'passthrough'
        self.assertFalse(bridge.uses_chat_engine(cli))
        cli._aidiy_provider_slug = 'openai_chat'
        cli._aidiy_cli_mode = 'chat'
        self.assertFalse(bridge.uses_chat_engine(cli))

    def test_tool_call_and_result_roundtrip(self):
        cli = SimpleNamespace(_aidiy_provider_slug='copilot-cli', model='same',
                              _is_session_yolo_active=lambda: True)
        agent = SimpleNamespace(_interrupt_requested=False, context_compressor=SimpleNamespace())
        model_validate = Mock(side_effect=lambda value: value)
        api = SimpleNamespace(ChatCompletion=SimpleNamespace(model_validate=model_validate))
        call = {'id': 'call-1', 'type': 'function',
                'function': {'name': 'read_file', 'arguments': '{"path":"README.md"}'}}
        messages = [{'role': 'system', 'content': 'Hermes identity; memory; knowledge; loaded skill instructions'},
                    {'role': 'user', 'content': 'read README'}]
        tools = [{'type': 'function', 'function': {'name': 'read_file', 'parameters': {'type': 'object'}}}]
        with patch.dict(sys.modules, {'openai.types.chat': api}), \
             patch.dict(os.environ, {'AIDIY_HERMES_READ_ONLY': '1'}), \
             patch.object(bridge, 'run_cli', side_effect=[
                 {'role': 'assistant', 'content': None, 'tool_calls': [call]},
                 {'role': 'assistant', 'content': 'summary'}]) as run:
            bridge.install_chat_engine(agent, cli, ROOT.parent)
            first = agent._interruptible_api_call({'messages': messages, 'tools': tools})
            self.assertEqual(first['choices'][0]['finish_reason'], 'tool_calls')
            self.assertEqual(first['choices'][0]['message']['tool_calls'], [call])
            self.assertEqual(run.call_args.args[5], 'read-only')
            self.assertEqual(run.call_args.kwargs['messages'], messages)
            self.assertEqual(run.call_args.kwargs['tools'], tools)
            self.assertEqual(run.call_args.kwargs['cli_mode'], 'chat')
            followup = messages + [first['choices'][0]['message'],
                                  {'role': 'tool', 'tool_call_id': 'call-1', 'content': 'README text'}]
            second = agent._interruptible_api_call({'messages': followup, 'tools': tools})
            self.assertEqual(run.call_args.kwargs['messages'], followup)
            self.assertEqual(second['choices'][0]['finish_reason'], 'stop')
            self.assertEqual(agent._fallback_chain, [])
            run.side_effect = None
            run.return_value = {'role': 'assistant', 'content': 'context summary'}
            route = {}
            summary = agent.context_compressor._aidiy_chat_call(
                messages=[{'role': 'user', 'content': 'summarize knowledge and decisions'}],
                route_info=route)
            self.assertEqual(summary['choices'][0]['message']['content'], 'context summary')
            self.assertEqual(run.call_args.kwargs['tools'], [])
            self.assertEqual(route['provider'], 'copilot-cli')
            direct = agent._ensure_primary_openai_client(reason='iteration_limit_summary')
            self.assertEqual(direct.base_url, 'aidiy-cli://engine')
            direct.chat.completions.create(messages=messages, tool_choice='none')
            self.assertEqual(run.call_args.kwargs['messages'], messages)
            self.assertEqual(run.call_args.kwargs['tool_choice'], 'none')
            agent._interruptible_api_call({'messages': messages, 'response_format': {'type': 'json_object'}})
            self.assertEqual(run.call_args.kwargs['response_format'], {'type': 'json_object'})

    def test_argparse_choices(self):
        source = (ROOT / 'cli_main.py').read_text()
        tree = ast.parse(source)
        parser = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == '_build_arg_parser')
        statement = next(n for n in parser.body if isinstance(n, ast.Expr) and
                         isinstance(n.value, ast.Call) and n.value.args and
                         isinstance(n.value.args[0], ast.Constant) and n.value.args[0].value == '--cli')
        import argparse
        obj = argparse.ArgumentParser()
        exec(compile(ast.Module(body=[statement], type_ignores=[]), '<parser>', 'exec'), {'parser': obj})
        self.assertEqual(obj.parse_args([]).cli, 'chat')
        self.assertEqual(obj.parse_args(['--cli', 'passthrough']).cli, 'passthrough')
        with self.assertRaises(SystemExit):
            obj.parse_args(['--cli', 'unknown'])

if __name__ == '__main__':
    unittest.main()
