# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
"""実SDKの引数/子プロセス環境を検証。ダウンロード・認証・推論は行わない。"""
import importlib.metadata
import inspect
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import AsyncMock, Mock, patch

sys.path.insert(0, str(Path(__file__).parent))
import test_harness_copilot_chat as fixtures
module = fixtures.module

try:
    SDK_READY = importlib.metadata.version('github-copilot-sdk') == module.SDK_VERSION
except importlib.metadata.PackageNotFoundError:
    SDK_READY = False


@unittest.skipUnless(SDK_READY, 'requires pinned github-copilot-sdk (no runtime/auth needed)')
class RealSdkContractTest(unittest.IsolatedAsyncioTestCase):
    async def test_adapter_arguments_match_real_sdk_and_keep_isolation(self):
        from copilot import CopilotClient
        from copilot.session import CopilotSession
        from copilot.generated.rpc import PermissionDecisionReject, SessionUpdateOptionsParams
        session, client, factory = fixtures.CopilotChatTest().fixtures()
        with patch.object(module, '_load_sdk', return_value=(factory, PermissionDecisionReject, SessionUpdateOptionsParams)):
            await module.chat({'model': 'claude-sonnet-5.5', 'messages': [], 'tools': []})
        inspect.signature(CopilotClient).bind(**factory.call_args.kwargs)
        inspect.signature(CopilotClient.create_session).bind(None, **client.create_session.call_args.kwargs)
        inspect.signature(CopilotSession.send_and_wait).bind(None, *session.send_and_wait.call_args.args, **session.send_and_wait.call_args.kwargs)
        self.assertEqual(session.rpc.options.update.call_args.args[0].to_dict(), {'installedPlugins': []})
        decision = await client.create_session.call_args.kwargs['on_permission_request']({}, {})
        self.assertEqual(decision.to_dict()['kind'], 'reject')

    async def test_real_sdk_wire_disables_child_capabilities(self):
        from copilot import CopilotClient
        from copilot.generated.rpc import PermissionDecisionReject, SessionUpdateOptionsParams
        from types import SimpleNamespace
        session, fake, factory = fixtures.CopilotChatTest().fixtures()
        with patch.object(module, '_load_sdk', return_value=(factory, PermissionDecisionReject, SessionUpdateOptionsParams)):
            await module.chat({'messages': [], 'tools': []})
        with patch.object(CopilotClient, '_resolve_runtime_entrypoint', return_value=sys.executable):
            real = CopilotClient(**factory.call_args.kwargs)
        wire = Mock()
        wire.request = AsyncMock(side_effect=RuntimeError('wire-stop'))
        real._client = wire
        with patch.object(real, '_cleanup_failed_session', new=AsyncMock()):
            with self.assertRaisesRegex(RuntimeError, 'wire-stop'):
                await real.create_session(**fake.create_session.call_args.kwargs)
        method, payload = wire.request.call_args_list[0].args
        self.assertEqual(method, 'session.create')
        for key in ('enableConfigDiscovery', 'enableFileHooks', 'enableHostGitOperations', 'enableSessionStore', 'enableSkills', 'enableOnDemandInstructionDiscovery'):
            self.assertIs(payload[key], False, key)
        self.assertEqual(payload['availableTools'], [])
        self.assertEqual(payload['excludedTools'], ['builtin:*', 'mcp:*', 'custom:*'])
        self.assertEqual(payload['mcpServers'], {})
        self.assertEqual(payload['memory'], {'enabled': False})

    async def test_real_sdk_previous_empty_mode_hid_login_new_host_keeps_it(self):
        from copilot import CopilotClient
        import copilot.client as sdk_client
        # Stop at process creation: neither official runtime nor real credentials used.
        for mode, base, hidden in [('empty', '/tmp/empty-fixture', True), ('copilot-cli', None, False)]:
            with self.subTest(mode=mode), patch.object(CopilotClient, '_resolve_runtime_entrypoint', return_value=sys.executable):
                client = CopilotClient(mode=mode, base_directory=base, working_directory='/tmp', use_logged_in_user=True)
            with patch.dict(os.environ, {'COPILOT_HOME': '/tmp/existing-login-fixture'}, clear=True), patch.object(sdk_client.subprocess, 'Popen', side_effect=OSError('fixture-stop')) as spawn:
                with self.assertRaises(OSError):
                    await client._start_cli_server()
            environment = spawn.call_args.kwargs['env']
            self.assertEqual(environment['COPILOT_HOME'], base if hidden else '/tmp/existing-login-fixture')
            self.assertEqual(environment.get('COPILOT_DISABLE_KEYTAR'), '1' if hidden else None)
            self.assertNotIn('--no-auto-login', spawn.call_args.args[0])


if __name__ == '__main__':
    unittest.main()
