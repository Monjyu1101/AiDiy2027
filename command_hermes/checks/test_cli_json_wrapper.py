"""Hermes自身がCLI生テキストをJSONとして検証する回帰。"""
import io
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / 'command_hermes'), str(ROOT / 'backend_tools')]
from hermes_cli.aidiy_cli_json import engine_prompt, parse_response
from hermes_cli.aidiy_cli_bridge import run_cli
from tools_proc.harness_chat import validate_request, validate_response
import jsonschema  # load package resources before mocking Path.is_file

class WrapperTest(unittest.TestCase):
    def test_extract(self):
        for prefix, suffix in [('', ''), ('説明\n```json\n', '\n```以上')]:
            self.assertEqual(parse_response(prefix + '{"content":"{文字}","tool_calls":[]}' + suffix)['content'], '{文字}')
        for bad in ['none', '{} {}', '{"a":1,"a":2}', '{"a":{"b":1,"b":2}}', '{"n":NaN}', '{broken}']:
            with self.assertRaises(ValueError): parse_response(bad)

    def test_roundtrip_subprocess_boundary(self):
        class Process:
            def __init__(self, *args, **kwargs):
                self.stdin = io.BytesIO()
                self.stdout = io.BytesIO((json.dumps({'type':'result','ok':True,'text':'説明\n{"content":"おはよう","tool_calls":[]}\n以上'})+'\n').encode())
            def wait(self, **kw): return 0
            def poll(self): return 0
        messages = [{'role':'user','content':'おはよう'}]
        def validate(*args, **kwargs):
            request = json.loads(kwargs['input'])
            from types import SimpleNamespace
            message = validate_response(request['response'], validate_request(request))
            return SimpleNamespace(returncode=0, stdout=json.dumps({'type':'result','ok':True,'message':message}).encode())
        with patch('pathlib.Path.is_file', return_value=True), patch('subprocess.Popen', Process), patch('subprocess.run', side_effect=validate):
            value = run_cli(ROOT, 'copilot-cli','same','',str(ROOT),'normal',lambda _:None,cli_mode='chat',messages=messages)
        self.assertEqual(value, {'role':'assistant','content':'おはよう','tool_calls':[]})
        self.assertIn('first { to the last }', engine_prompt(messages, []))

    def test_schema_and_choice_stay_strict(self):
        request = {'messages':[{'role':'user','content':'read'}], 'tools':[{'type':'function','function':{'name':'read','parameters':{'type':'object','required':['path'],'properties':{'path':{'type':'string'}}}}}]}
        defs = validate_request(request)
        for response in ['{"content":"","tool_calls":[{"name":"write","arguments":{}}]}', '{"content":"","tool_calls":[{"name":"read","arguments":{"path":123}}]}']:
            with self.assertRaises(ValueError): validate_response(parse_response(response), defs)
        valid = parse_response('```json\n{"content":"","tool_calls":[{"name":"read","arguments":{"path":"a"}}]}\n```')
        with self.assertRaises(ValueError): validate_response(valid, defs, 'none')
        self.assertEqual(validate_response(valid, defs)['tool_calls'][0]['function']['name'], 'read')

if __name__ == '__main__': unittest.main()
