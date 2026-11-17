# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
"""No authentication or CLI execution: Copilot chat isolation/protocol regression."""
import asyncio
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock, patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('copilot_chat', ROOT / 'backend_tools/tools_proc/harness_copilot_chat.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

TOOL = {'type': 'function', 'function': {'name': 'read_file', 'parameters': {'type': 'object', 'properties': {'path': {'type': 'string'}}, 'required': ['path'], 'additionalProperties': False}}}

class CopilotChatTest(unittest.IsolatedAsyncioTestCase):
    def fixtures(self, content='{"content":"answer", "tool_calls":[]}'):
        session = SimpleNamespace(send_and_wait=AsyncMock(return_value=SimpleNamespace(data=SimpleNamespace(content=content))), abort=AsyncMock(), rpc=SimpleNamespace(options=SimpleNamespace(update=AsyncMock())))
        client = SimpleNamespace(start=AsyncMock(), get_auth_status=AsyncMock(return_value=SimpleNamespace(isAuthenticated=True)), create_session=AsyncMock(return_value=session), force_stop=AsyncMock())
        factory = Mock(return_value=client)
        return session, client, factory

    async def test_no_child_tools_or_configuration_and_parent_transcript_preserved(self):
        session, client, factory = self.fixtures()
        request = {'model': 'chosen-model', 'messages': [{'role': 'tool', 'tool_call_id': 'call_1', 'content': 'actual result'}], 'tools': [TOOL]}
        with patch.object(module, '_load_sdk', return_value=(factory, lambda **kw: {'kind': 'reject', **kw}, SimpleNamespace)):
            result = await module.chat(request)
        self.assertEqual(result['content'], 'answer')
        self.assertEqual(factory.call_args.kwargs['mode'], 'copilot-cli')
        self.assertNotIn('base_directory', factory.call_args.kwargs)
        self.assertFalse(Path(factory.call_args.kwargs['working_directory']).exists())
        config = client.create_session.call_args.kwargs
        self.assertEqual(config['model'], 'chosen-model')
        self.assertEqual(config['tools'], [])
        self.assertEqual(config['available_tools'], [])
        self.assertEqual(set(config['excluded_tools']), {'builtin:*', 'mcp:*', 'custom:*'})
        for key in ('enable_config_discovery', 'enable_file_hooks', 'enable_skills', 'enable_host_git_operations', 'enable_session_store'):
            self.assertIs(config[key], False)
        self.assertEqual(config['mcp_servers'], {})
        self.assertEqual(config['memory'], {'enabled': False})
        self.assertTrue(config['custom_agents_local_only'])
        self.assertFalse(config['enable_experimental_mode'])
        self.assertEqual(session.rpc.options.update.call_args.args[0].installed_plugins, [])
        self.assertEqual(config['plugin_directories'], [])
        decision = await config['on_permission_request']({}, {})
        self.assertEqual(decision['kind'], 'reject')
        payload = json.loads(session.send_and_wait.call_args.args[0])
        self.assertEqual(payload, {'messages': request['messages'], 'tools': [TOOL], 'tool_choice': 'auto'})
        self.assertEqual(session.send_and_wait.call_args.kwargs['response_schema'], module.response_schema([TOOL]))
        session.abort.assert_awaited_once()
        client.force_stop.assert_awaited_once()

    async def test_same_model_does_not_override_cli_default(self):
        session, client, factory = self.fixtures()
        with patch.object(module, '_load_sdk', return_value=(factory, Mock(), SimpleNamespace)):
            await module.chat({'model': 'same', 'messages': [], 'tools': []})
        self.assertNotIn('model', client.create_session.call_args.kwargs)

    async def test_invalid_output_not_extracted_from_prose(self):
        for content in ('```json\n{"content":"x","tool_calls":[]}\n```', 'Here is {"content":"x"}', '[]'):
            session, client, factory = self.fixtures(content)
            with patch.object(module, '_load_sdk', return_value=(factory, Mock(), SimpleNamespace)):
                with self.assertRaises(ValueError):
                    await module.chat({'messages': [], 'tools': []})
            client.force_stop.assert_awaited_once()

    async def test_timeout_aborts_and_stops_runtime(self):
        session, client, factory = self.fixtures()
        session.send_and_wait.side_effect = asyncio.TimeoutError
        with patch.object(module, '_load_sdk', return_value=(factory, Mock(), SimpleNamespace)):
            with self.assertRaisesRegex(module.CopilotChatError, '推論.*タイムアウト'):
                await module.chat({'messages': [], 'tools': []})
        session.abort.assert_awaited_once()
        client.force_stop.assert_awaited_once()

    async def test_cancellation_aborts_and_stops_runtime(self):
        session, client, factory = self.fixtures()
        session.send_and_wait.side_effect = asyncio.CancelledError
        with patch.object(module, '_load_sdk', return_value=(factory, Mock(), SimpleNamespace)):
            with self.assertRaises(asyncio.CancelledError):
                await module.chat({'messages': [], 'tools': []})
        session.abort.assert_awaited_once()
        client.force_stop.assert_awaited_once()

    async def test_start_failure_stops_runtime(self):
        session, client, factory = self.fixtures()
        client.start.side_effect = RuntimeError('startup failed')
        with patch.object(module, '_load_sdk', return_value=(factory, Mock(), SimpleNamespace)):
            with self.assertRaisesRegex(module.CopilotChatError, 'runtime起動'):
                await module.chat({'messages': [], 'tools': []})
        client.create_session.assert_not_called()
        client.force_stop.assert_awaited_once()

    async def test_login_failure_does_not_start_inference(self):
        session, client, factory = self.fixtures()
        client.get_auth_status.return_value = SimpleNamespace(isAuthenticated=False)
        with patch.object(module, '_load_sdk', return_value=(factory, Mock(), SimpleNamespace)):
            with self.assertRaisesRegex(module.CopilotChatError, '認証確認'):
                await module.chat({'messages': [], 'tools': []})
        client.create_session.assert_not_called()
        session.send_and_wait.assert_not_called()
        client.force_stop.assert_awaited_once()

    async def test_sdk_failures_are_classified_without_raw_secrets(self):
        for error, expected in [(RuntimeError('authentication secret-value'), '認証'),
                                (RuntimeError('unknown model secret-value'), '指定モデル'),
                                (RuntimeError('connection secret-value'), '通信'),
                                (ValueError('secret-value'), 'SDK処理'),
                                (TypeError('secret-value'), '呼出仕様')]:
            session, client, factory = self.fixtures()
            session.send_and_wait.side_effect = error
            with patch.object(module, '_load_sdk', return_value=(factory, Mock(), SimpleNamespace)):
                with self.assertRaises(module.CopilotChatError) as caught:
                    await module.chat({'messages': [], 'tools': []})
            self.assertIn(expected, str(caught.exception))
            self.assertNotIn('secret-value', str(caught.exception))

    async def test_runtime_download_failure_is_identified_before_client_exists(self):
        factory = Mock(side_effect=RuntimeError('Failed to download https://example.invalid/?secret-value'))
        with patch.object(module, '_load_sdk', return_value=(factory, Mock(), SimpleNamespace)):
            with self.assertRaises(module.CopilotChatError) as caught:
                await module.chat({'messages': [], 'tools': []})
        self.assertIn('runtime準備', str(caught.exception))
        self.assertIn('SDK用runtime', str(caught.exception))
        self.assertNotIn('secret-value', str(caught.exception))

    async def test_plugin_isolation_failure_never_sends_prompt(self):
        session, client, factory = self.fixtures()
        session.rpc.options.update.side_effect = RuntimeError('failure')
        with patch.object(module, '_load_sdk', return_value=(factory, Mock(), SimpleNamespace)):
            with self.assertRaisesRegex(module.CopilotChatError, 'セッション作成'):
                await module.chat({'messages': [], 'tools': []})
        session.send_and_wait.assert_not_called()
        session.abort.assert_awaited_once()
        client.force_stop.assert_awaited_once()

    def test_schema_limits_names_and_no_tools(self):
        schema = module.response_schema([TOOL])
        import jsonschema
        jsonschema.validate({'content': '', 'tool_calls': [{'name': 'read_file', 'arguments': {'path': 'README.md'}}]}, schema)
        for value in ({'content': '', 'tool_calls': [{'name': 'shell', 'arguments': {}}]},):
            with self.assertRaises(jsonschema.ValidationError):
                jsonschema.validate(value, schema)
        with self.assertRaises(jsonschema.ValidationError):
            jsonschema.validate({'content': '', 'tool_calls': [{'name': 'read_file', 'arguments': {'path': 'README.md'}}]}, module.response_schema([]))

    def test_sdk_version_mismatch_fails_before_import_or_launch(self):
        with patch.object(module, 'version', return_value='0.1.0'):
            with self.assertRaisesRegex(ValueError, '1.0.34'):
                module._load_sdk()

if __name__ == '__main__':
    unittest.main()
