# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
"""SDKなしのCopilot stdioと親側ツール検証。実認証は不要。"""
import io
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import AsyncMock, patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'backend_tools/tools_proc'))
import harness_copilot_chat as copilot
import harness_chat as chat
import harness_cli as cli
TOOL = {'type': 'function', 'function': {'name': 'read', 'parameters': {
    'type': 'object', 'properties': {'path': {'type': 'string'}},
    'required': ['path'], 'additionalProperties': False}}}
def request():
    return {'cli_mode':'chat', 'provider':'copilot_cli', 'model':'gpt-6.1-sol',
            'project':str(ROOT), 'mode':'normal', 'messages':[{'role':'user','content':'おはよう'}], 'tools':[TOOL]}

class CopilotStdioTests(unittest.IsolatedAsyncioTestCase):
    def test_command_never_uses_sdk_or_child_tools_or_resume(self):
        with patch.object(copilot.shutil, 'which', return_value='/bin/copilot'):
            command = copilot.command('gpt-6.1-sol')
        self.assertEqual(command[0], '/bin/copilot')
        self.assertIn('--excluded-tools=builtin:*,mcp:*,custom:*', command)
        self.assertIn('--deny-tool=shell,read,write,url,memory', command)
        self.assertIn('--no-custom-instructions', command)
        self.assertIn('--sync-session=off', command)
        self.assertEqual(command[-2:], ['--model','gpt-6.1-sol'])
        for bad in ('--allow-all', '--allow-all-tools', '--resume','--continue','--trust-folder'):
            self.assertNotIn(bad, command)

    def test_model_selection_same_and_auto(self):
        with patch.object(copilot.shutil, 'which', return_value='/bin/copilot'):
            self.assertNotIn('--model', copilot.command('same'))
            self.assertEqual(copilot.command('auto')[-2:], ['--model','auto'])

    def test_windows_npm_shim_resolves_to_direct_entry_without_cmd(self):
        from types import SimpleNamespace
        from unittest.mock import Mock
        resolver = Mock(return_value=['node.exe', 'copilot/npm-loader.js'])
        module = SimpleNamespace(CodeAI=SimpleNamespace(_npmシム直接実行に解決=resolver))
        with patch.dict(sys.modules, {'AIコア.AIコード_cli': module}), patch.object(copilot.shutil, 'which', return_value='C:/bin/copilot.cmd'):
            args = copilot.command('gpt-6.1-sol')
        self.assertEqual(args[:2], ['node.exe', 'copilot/npm-loader.js'])
        self.assertNotIn('cmd.exe', args)
        resolver.assert_called_once_with(None, 'C:/bin/copilot.cmd')

    async def test_greeting_and_tool_roundtrip_shared_by_all_outer_harnesses(self):
        r = request()
        outputs = [{'content':'おはようございます','tool_calls':[]},
                   {'content':'','tool_calls':[{'name':'read','arguments':{'path':'日本語.txt'}}]}]
        for raw in outputs:
            process = AsyncMock(return_value=json.dumps(raw,ensure_ascii=False).encode())
            out = io.StringIO()
            with patch.object(copilot, 'command', return_value=['copilot']), patch.object(chat,'run_process',process), patch.object(cli,'OUTPUT',out):
                await cli.run(r)
            event=json.loads(out.getvalue());self.assertTrue(event['ok'])
            cmd,payload,cwd=process.call_args.args
            self.assertNotIn('おはよう',str(cmd))
            self.assertIn('おはよう',payload.decode());self.assertIn('"tools"',payload.decode())
            self.assertNotEqual(cwd,str(ROOT));self.assertFalse(Path(cwd).exists())
            if raw['tool_calls']:
                call=event['message']['tool_calls'][0]
                self.assertEqual(json.loads(call['function']['arguments']),{'path':'日本語.txt'})
                r['messages'] += [event['message'],{'role':'tool','tool_call_id':call['id'],'content':'file result'}]
                chat.validate_request(r)

    async def test_auth_environment_preserved_without_parent_auto_approval(self):
        process=AsyncMock(return_value=b'{"content":"ok","tool_calls":[]}')
        with patch.dict(os.environ, {'COPILOT_HOME':'existing-home','COPILOT_ALLOW_ALL':'1','COPILOT_ASSISTED_APPROVAL':'1'}), patch.object(copilot,'command',return_value=['copilot']), patch.object(chat,'run_process',process):
            await copilot.chat(request())
        env=process.call_args.kwargs['env']
        self.assertEqual(env['COPILOT_HOME'],'existing-home')
        self.assertNotIn('COPILOT_ALLOW_ALL',env)
        self.assertNotIn('COPILOT_ASSISTED_APPROVAL',env)
        self.assertEqual(env['GITHUB_COPILOT_PROMPT_MODE_REPO_HOOKS'],'false')

    async def test_bad_output_not_extracted_or_executed(self):
        for raw in [b'private text {"content":"x"}',b'```json\n{}\n```',b'[]',b'{',b'\xff']:
            with patch.object(copilot,'command',return_value=['copilot']), patch.object(chat,'run_process',AsyncMock(return_value=raw)):
                with self.assertRaises(ValueError) as error: await copilot.chat(request())
            self.assertNotIn('private',str(error.exception))

    async def test_unregistered_tool_and_wrong_arguments_rejected(self):
        for name,args in [('shell',{}),('read',{'path':12})]:
            raw=json.dumps({'content':'','tool_calls':[{'name':name,'arguments':args}]}).encode()
            out=io.StringIO()
            with patch.object(copilot,'command',return_value=['copilot']), patch.object(chat,'run_process',AsyncMock(return_value=raw)),patch.object(cli,'OUTPUT',out):
                with self.assertRaises(ValueError): await cli.run(request())
            self.assertEqual(out.getvalue(),'')

    async def test_stdin_size_limit(self):
        with patch.object(chat,'LIMIT',1),patch.object(chat,'run_process',AsyncMock()) as process:
            with self.assertRaises(ValueError): await copilot.chat(request())
            process.assert_not_awaited()

    def test_missing_cli_no_sdk_fallback(self):
        with patch.object(copilot.shutil,'which',return_value=None):
            with self.assertRaisesRegex(ValueError,'Copilot CLI'):copilot.command('same')

if __name__ == '__main__':unittest.main()
