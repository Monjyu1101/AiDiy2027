"""Offline title regression: per-agent CLI callback survives the background path."""
import ast
import importlib.util
import logging
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
modules = {
    'agent.auxiliary_client': SimpleNamespace(call_llm=Mock(side_effect=AssertionError('unexpected API'))),
    'agent.context_compressor': SimpleNamespace(LEGACY_SUMMARY_PREFIX='[summary]'),
    'agent.message_content': SimpleNamespace(flatten_message_text=lambda value: value),
    'agent.aux_accounting': SimpleNamespace(set_accounting_context=Mock()),
    'agent.portal_tags': SimpleNamespace(set_conversation_context=Mock()),
}
spec = importlib.util.spec_from_file_location('title_fixture', ROOT / 'core/title_generator.py')
title = importlib.util.module_from_spec(spec)
with patch.dict(sys.modules, modules):
    spec.loader.exec_module(title)
spec = importlib.util.spec_from_file_location('bridge_fixture', ROOT / 'hermes_cli/aidiy_cli_bridge.py')
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


def response(content):
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content))])


class CliTitleTest(unittest.TestCase):
    def setUp(self):
        self.patches = [patch.object(title, '_auto_title_enabled', return_value=True),
                        patch.object(title, '_title_language', return_value=None)]
        for item in self.patches:
            item.start()
            self.addCleanup(item.stop)

    def test_background_title_uses_agent_cli_not_api(self):
        cli = SimpleNamespace(_aidiy_provider_slug='copilot-cli', model='claude-sonnet-5.5',
                              _is_session_yolo_active=lambda: False)
        agent = SimpleNamespace()
        api = SimpleNamespace(ChatCompletion=SimpleNamespace(model_validate=lambda value:
              response(value['choices'][0]['message']['content'])))
        db = SimpleNamespace(get_session_title_source=lambda _: 'derived', get_conversation_root=lambda _: 'sid')
        with patch.dict(sys.modules, {**modules, 'openai.types.chat': api}), \
             patch.object(bridge, 'run_cli', return_value={'role': 'assistant', 'content': '{"title":"朝の挨拶"}'}) as run, \
             patch.object(title, 'call_llm', side_effect=AssertionError('unexpected API')) as http, \
             patch.object(title, '_persist_session_title', return_value='朝の挨拶') as persist, \
             patch.object(title, 'apply_instant_title'), \
             patch.object(title.threading, 'Thread') as thread:
            bridge.install_chat_engine(agent, cli, ROOT.parent)
            title.maybe_auto_title(db, 'sid', 'おはよう', chat_call=agent._aidiy_chat_call)
            args = thread.call_args.kwargs
            args['target'](*args['args'], **args['kwargs'])
            run.assert_called_once()
            self.assertEqual(run.call_args.args[1:3], ('copilot-cli', 'claude-sonnet-5.5'))
            self.assertEqual(run.call_args.kwargs['tools'], [])
            self.assertEqual(run.call_args.kwargs['tool_choice'], 'none')
            self.assertEqual(run.call_args.kwargs['cli_mode'], 'chat')
            self.assertEqual(run.call_args.kwargs['response_format'], title._TITLE_RESPONSE_FORMAT)
            self.assertIn('You name chat sessions', str(run.call_args.kwargs['messages']))
            http.assert_not_called()
            self.assertEqual(persist.call_args.args[2], '朝の挨拶')
            self.assertEqual(persist.call_args.kwargs['source'], 'llm')

    def test_cli_failure_keeps_derived_title_without_api_fallback(self):
        db = SimpleNamespace(get_session_title_source=lambda _: 'derived', get_conversation_root=lambda _: 'sid')
        failed = Mock(side_effect=ValueError('Copilot chat [認証確認]: fixture'))
        report = Mock()
        with patch.dict(sys.modules, modules), patch.object(title, 'call_llm') as http, \
             patch.object(title, '_persist_session_title', return_value='おはよう') as persist:
            with self.assertLogs(title.logger, level='WARNING'):
                title.auto_title_session(db, 'sid', 'おはよう', chat_call=failed, failure_callback=report)
            http.assert_not_called()
            self.assertEqual(persist.call_args.kwargs['source'], 'derived')
            self.assertEqual(report.call_args.args[0], 'title generation')

    def test_api_mode_and_stale_model_behavior_unchanged(self):
        with patch.object(title, 'call_llm', return_value=response('{"title":"API title"}')) as api:
            self.assertEqual(title.generate_title('hi'), 'API title')
            api.assert_called_once()
            callback = Mock()
            self.assertIsNone(title.generate_title('hi', chat_call=callback, runtime_validator=lambda: False))
            callback.assert_not_called()
            api.assert_called_once()

    def test_turn_prologue_passes_per_agent_callback(self):
        source = ast.parse((ROOT / 'core/turn_context.py').read_text(encoding='utf-8'))
        function = next(node for node in source.body if isinstance(node, ast.FunctionDef) and node.name == '_maybe_title_session_at_turn_start')
        callback = Mock()
        agent = SimpleNamespace(_session_db=object(), session_id='sid', _session_db_created=True,
                                model='same', provider='custom', _aidiy_chat_call=callback)
        target = Mock()
        namespace = {'Any': object, 'List': list, '_UNTITLED_PLATFORMS': set(), 'logger': logging.getLogger(__name__)}
        exec(compile(ast.Module(body=[function], type_ignores=[]), '<turn-prologue>', 'exec'), namespace)
        with patch.dict(sys.modules, {**modules, 'agent.title_generator': SimpleNamespace(maybe_auto_title=target)}):
            namespace[function.name](agent, [{'role': 'user', 'content': 'おはよう'}])
        self.assertIs(target.call_args.kwargs['chat_call'], callback)


if __name__ == '__main__':
    unittest.main()
