# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
"""Optional real CLI + local HTTP fixture. No GitHub login or remote inference.
AIDIY_TEST_COPILOT=/absolute/path/copilot python -m unittest discover -s backend_tools/checks -p 'test_harness*.py'
"""
import asyncio
import http.server
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
import test_harness_copilot_chat as common

EXECUTABLE = os.environ.get('AIDIY_TEST_COPILOT')

@unittest.skipUnless(EXECUTABLE, 'set AIDIY_TEST_COPILOT to an installed official CLI')
class RealCopilotStdioTest(unittest.TestCase):
    def test_cli_stdin_stdout_and_zero_child_tools(self):
        requests = []
        response = {'content': 'おはようございます', 'tool_calls': []}
        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args): pass
            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                requests.append(body)
                content = json.dumps(response, ensure_ascii=False)
                self.send_response(200)
                if body.get('stream'):
                    self.send_header('Content-Type', 'text/event-stream'); self.end_headers()
                    for delta, finish in [({'role':'assistant','content':content},None), ({},'stop')]:
                        event = {'id':'fixture', 'object':'chat.completion.chunk', 'model':'fixture',
                                 'choices':[{'index':0,'delta':delta,'finish_reason':finish}]}
                        self.wfile.write(('data: '+json.dumps(event)+'\n\n').encode())
                    self.wfile.write(b'data: [DONE]\n\n')
                else:
                    self.send_header('Content-Type','application/json'); self.end_headers()
                    self.wfile.write(json.dumps({'choices':[{'index':0,'message':{'role':'assistant','content':content},'finish_reason':'stop'}]}).encode())
        server = http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
        worker = threading.Thread(target=server.serve_forever,daemon=True); worker.start()
        try:
            with tempfile.TemporaryDirectory(prefix='copilot-fixture-home-') as home:
                env = {k:v for k,v in os.environ.items() if not any(x in k.upper() for x in ('TOKEN','COPILOT','GITHUB','GH_'))}
                env.update(HOME=home, USERPROFILE=home, COPILOT_HOME=home,
                           COPILOT_PROVIDER_BASE_URL=f'http://127.0.0.1:{server.server_port}/v1', COPILOT_MODEL='fixture')
                request = common.request(); request['model'] = 'fixture'
                with patch.dict(os.environ,env,clear=True),patch.object(common.copilot.shutil,'which',return_value=EXECUTABLE):
                    result=asyncio.run(common.chat.run_chat(request))
                    self.assertEqual(result['content'],'おはようございます')
                    response.update(content='',tool_calls=[{'name':'read','arguments':{'path':'日本語.txt'}}])
                    result=asyncio.run(common.chat.run_chat(request))
                    call=result['tool_calls'][0]
                    self.assertEqual(json.loads(call['function']['arguments']),{'path':'日本語.txt'})
                    request['messages'] += [result,{'role':'tool','tool_call_id':call['id'],'content':'file content'}]
                    response.update(content='作業報告です',tool_calls=[])
                    result=asyncio.run(common.chat.run_chat(request))
                    self.assertEqual(result['content'],'作業報告です')
                self.assertEqual(len(requests),3)
                for sent in requests:
                    self.assertEqual(sent.get('tools') or [],[])
                self.assertIn('file content',json.dumps(requests[-1],ensure_ascii=False))
        finally:
            server.shutdown(); server.server_close();worker.join(timeout=5)
