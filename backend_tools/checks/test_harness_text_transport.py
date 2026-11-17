"""Text engine protocol: no JSON mode or parsing below parent harness."""
import asyncio
from pathlib import Path
import sys
import unittest
from unittest.mock import AsyncMock, patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tools_proc import harness_chat, harness_copilot_chat, harness_cli

class TransportTest(unittest.TestCase):
    def request(self, provider):
        return {'provider':provider,'model':'test','messages':[{'role':'user','content':'hi'}],
                'tools':[], 'engine_prompt':'PARENT PROMPT', 'cli_mode':'chat',
                'project':str(Path.cwd()), 'mode':'normal'}

    def test_claude_text(self):
        with patch('shutil.which', return_value='/cli/claude'), patch.object(harness_chat, 'run_process', AsyncMock(return_value=b'prefix {} suffix')) as run:
            self.assertEqual(asyncio.run(harness_chat.run_text_chat(self.request('claude_cli'))), 'prefix {} suffix')
            command, payload, _ = run.call_args.args
            self.assertNotIn('--json-schema', command)
            self.assertEqual(command[command.index('--output-format') + 1], 'text')
            self.assertEqual(payload, b'PARENT PROMPT')
            self.assertIn('--tools', command)

    def test_copilot_text(self):
        with patch.object(harness_copilot_chat, 'command', return_value=['copilot']), patch.object(harness_chat, 'run_process', AsyncMock(return_value=b'prefix {} suffix')) as run:
            self.assertEqual(asyncio.run(harness_chat.run_text_chat(self.request('copilot_cli'))), 'prefix {} suffix')
            self.assertEqual(run.call_args.args[1], b'PARENT PROMPT')

    def test_codex_text(self):
        from tools_proc import harness_codex_chat
        with patch.object(harness_codex_chat, 'command', return_value=['codex','exec','--aidiy-inference-only','--output-schema','','--output-last-message','','-']), patch.object(harness_chat, 'run_process', AsyncMock(return_value=b'prefix {} suffix')) as run:
            self.assertEqual(asyncio.run(harness_chat.run_text_chat(self.request('codex_cli'))), 'prefix {} suffix')
            self.assertNotIn('--output-schema', run.call_args.args[0])
            self.assertIn('--aidiy-inference-only', run.call_args.args[0])

    def test_transport_envelope(self):
        with patch.object(harness_chat,'run_text_chat',AsyncMock(return_value='raw')), patch.object(harness_cli,'emit') as emit:
            asyncio.run(harness_cli.run(self.request('copilot_cli')))
            emit.assert_called_once_with({'type':'result','ok':True,'text':'raw'})

if __name__ == '__main__': unittest.main()
