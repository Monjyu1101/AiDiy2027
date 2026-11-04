# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
"""Offline transport regression. AST/pure readers only; no socket or gateway launch."""
from __future__ import annotations
import ast
import asyncio
import importlib.util
import json
import io
import inspect
import time
from pathlib import Path
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[1]
CAP = 20 * 1024 * 1024
CONSTANTS = {
    'gateway/platforms/api_server.py': 'MAX_REQUEST_BYTES',
    'gateway/platforms/bluebubbles.py': '_WEBHOOK_MAX_BODY_BYTES',
    'gateway/platforms/msgraph_webhook.py': 'DEFAULT_MAX_BODY_BYTES',
    'gateway/platforms/whatsapp_cloud.py': 'WEBHOOK_MAX_BODY_BYTES',
    'hermes_cli/proxy/server.py': 'MAX_REQUEST_BYTES',
    'plugins/platforms/raft/adapter.py': 'DEFAULT_MAX_BODY_BYTES',
    'plugins/platforms/wecom/callback_adapter.py': '_MAX_BODY',
    'plugins/platforms/teams/adapter.py': '_MAX_BODY_BYTES',
    'plugins/platforms/line/adapter.py': 'WEBHOOK_BODY_MAX_BYTES',
    'plugins/platforms/a2a/adapter.py': '_MAX_BODY',
    'plugins/platforms/sms/adapter.py': '_TWILIO_WEBHOOK_MAX_BODY_BYTES',
    'plugins/platforms/feishu/adapter.py': '_FEISHU_WEBHOOK_MAX_BODY_BYTES',
    'plugins/platforms/discord/adapter.py': '_DISCORD_STANDALONE_JSON_BODY_LIMIT_BYTES',
    'plugins/platforms/buzz/adapter.py': '_WS_MAX_MESSAGE_BYTES',
    'tools/discord_tool.py': '_DISCORD_RESPONSE_BODY_MAX_BYTES',
    'tools/tts_tool.py': 'TTS_RESPONSE_BODY_LIMIT_BYTES',
    'tools/tts_streaming.py': '_STREAM_SENTENCE_BYTE_CAP',
    'tui_gateway/hosted_room_peer_http.py': 'MAX_PEER_RESPONSE_BYTES',
}
def tree(file):
    return ast.parse((ROOT / file).read_text(encoding='utf-8'))
def evaluate(node, namespace=None):
    return eval(compile(ast.Expression(node), '<transport-config>', 'eval'), {'__builtins__': {}}, namespace or {})
def constant(file, name):
    for node in tree(file).body:
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == name for t in node.targets):
            return evaluate(node.value)
    raise AssertionError((file, name))
def calls(file, name):
    return [node for node in ast.walk(tree(file)) if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == name]
def load_function(file, name, namespace):
    node = next(n for n in ast.walk(tree(file)) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == name)
    node.decorator_list = []
    module = ast.Module(body=[ast.ImportFrom(module='__future__', names=[ast.alias(name='annotations')], level=0), node], type_ignores=[])
    exec(compile(ast.fix_missing_locations(module), str(ROOT/file), 'exec'), namespace)
    return namespace[name]

class TransportConfigurationTests(unittest.TestCase):
    def test_http_body_defaults_and_parser_wiring(self):
        for file, name in CONSTANTS.items():
            with self.subTest(file=file):
                self.assertEqual(constant(file, name), CAP)
                apps = calls(file, 'Application')
                if apps:
                    values = [kw.value for app in apps for kw in app.keywords if kw.arg == 'client_max_size']
                    self.assertTrue(values)
                    self.assertTrue(any(isinstance(v, ast.Name) and v.id == name or isinstance(v, ast.Attribute) and v.attr == '_max_body_bytes' for v in values))

    def test_explicit_operator_overrides_remain_respected(self):
        for file in ['gateway/platforms/webhook.py', 'gateway/platforms/msgraph_webhook.py', 'plugins/platforms/raft/adapter.py']:
            get = next(n for n in calls(file, 'get') if n.args and isinstance(n.args[0], ast.Constant) and n.args[0].value == 'max_body_bytes')
            default = evaluate(get.args[1], {'DEFAULT_MAX_BODY_BYTES': CAP})
            self.assertEqual(default, CAP)
            for supplied in [1024, 0, 40*1024*1024]:
                config = SimpleNamespace(extra={'max_body_bytes': supplied})
                self.assertEqual(evaluate(get, {'config':config,'extra':config.extra,'DEFAULT_MAX_BODY_BYTES':CAP}), supplied)

    def test_proxy_request_cap_and_unlimited_response(self):
        node = next(n for n in ast.walk(tree('core/proxy_sources/iron_proxy.py')) if isinstance(n, ast.Dict) and any(isinstance(k,ast.Constant) and k.value=='max_request_body_bytes' for k in n.keys))
        values = {k.value:evaluate(v) for k,v in zip(node.keys,node.values) if isinstance(k,ast.Constant) and k.value in ('max_request_body_bytes','max_response_body_bytes')}
        self.assertEqual(values, {'max_request_body_bytes': CAP, 'max_response_body_bytes': 0})

    def test_websocket_and_control_reader_limits_are_explicit(self):
        for file,name,keyword,expected_count in [
            ('plugins/google_meet/node/server.py','serve','max_size',1),
            ('gateway/relay/ws_transport.py','connect','max_size',2),
            ('gateway/platforms/api_server.py','WebSocketResponse','max_msg_size',1),
            ('gateway/control_socket.py','start_unix_server','limit',1),
        ]:
            matching=calls(file,name)
            self.assertEqual(len(matching),expected_count,file)
            for call in matching:
                value=next((kw.value for kw in call.keywords if kw.arg==keyword),None)
                self.assertIsNotNone(value,file)
                self.assertEqual(evaluate(value,{'MAX_REQUEST_BYTES':CAP,'_MAX_REQUEST_BYTES':CAP}),CAP)
        self.assertEqual(constant('gateway/control_socket.py','_MAX_REQUEST_BYTES'),CAP)
        self.assertEqual(constant('gateway/control_socket.py','_MAX_RESPONSE_BYTES'),CAP)

    def test_gateway_provider_websocket_receive_limits(self):
        for file, name, owner, keyword, count in [
            ('gateway/platforms/yuanbao.py','connect','websockets','max_size',2),
            ('plugins/platforms/simplex/adapter.py','connect','_wsclient','max_size',3),
            ('plugins/platforms/homeassistant/adapter.py','ws_connect',None,'max_msg_size',1),
            ('plugins/platforms/mattermost/adapter.py','ws_connect',None,'max_msg_size',1),
            ('plugins/platforms/wecom/adapter.py','ws_connect',None,'max_msg_size',1),
            ('gateway/platforms/qqbot/adapter.py','ws_connect',None,'max_msg_size',1),
            ('plugins/google_meet/node/client.py','connect','PLAIN','max_size',1),
            ('plugins/google_meet/realtime/openai_client.py','connect','PLAIN','max_size',2),
            ('tools/tts_streaming.py','connect','websockets','max_size',1),
            ('plugins/platforms/buzz/adapter.py','connect','websockets','max_size',1),
        ]:
            matching=[]
            for node in ast.walk(tree(file)):
                if not isinstance(node,ast.Call):continue
                f=node.func
                match=(isinstance(f,ast.Name) and f.id==name) if owner=='PLAIN' else (isinstance(f,ast.Attribute) and f.attr==name and (owner is None or isinstance(f.value,ast.Name) and f.value.id==owner))
                if match:matching.append(node)
            self.assertEqual(len(matching),count,file)
            for call in matching:
                value=next((kw.value for kw in call.keywords if kw.arg==keyword),None)
                self.assertIsNotNone(value,file)
                self.assertEqual(evaluate(value,{'_WS_MAX_MESSAGE_BYTES':CAP}),CAP)

    def test_higher_and_semantic_limits_are_not_lowered(self):
        self.assertEqual(constant('hermes_cli/web_server.py','_DESKTOP_ATTACHMENT_WS_MAX_BYTES'),384*1024*1024)
        self.assertEqual(constant('gateway/hosted_rooms.py','MAX_GATEWAY_EVENT_BYTES'),16*1024*1024)
        self.assertEqual(constant('gateway/platforms/api_server.py','MAX_NORMALIZED_TEXT_LENGTH'),65536)
        self.assertEqual(constant('gateway/control_socket.py','_MAX_UNIX_PATH'),100)
        self.assertEqual(constant('plugins/platforms/discord/adapter.py','_DISCORD_STANDALONE_ERROR_BODY_LIMIT_BYTES'),8192)
        self.assertEqual(constant('tools/discord_tool.py','_DISCORD_ERROR_BODY_MAX_BYTES'),65536)
        self.assertEqual(constant('tui_gateway/hosted_room_peer_http.py','MAX_PEER_ERROR_RESPONSE_BYTES'),16384)

class PureReaderBoundaryTests(unittest.IsolatedAsyncioTestCase):
    async def test_whatsapp_bounded_reader_at_boundary_and_one_beyond(self):
        reader = load_function('gateway/platforms/whatsapp_cloud.py','_read_limited_request_body',{'asyncio':asyncio})
        for size in [CAP-1,CAP,CAP+1]:
            with self.subTest(size=size):
                stream=asyncio.StreamReader(limit=CAP+1)
                stream.feed_data(b'x'*size);stream.feed_eof()
                req=SimpleNamespace(content=stream)
                if size>CAP:
                    with self.assertRaisesRegex(ValueError,'payload too large'):await reader(req,CAP)
                else:self.assertEqual(len(await reader(req,CAP)),size)

    async def test_aiohttp_actual_request_reader_chunked_boundary(self):
        try:
            from aiohttp.web_request import BaseRequest
            from aiohttp.web_exceptions import HTTPRequestEntityTooLarge
        except ImportError:self.skipTest('aiohttp is optional; use installed backend_tools environment for this check')
        class Payload:
            def __init__(self,size):self.remaining=size
            def set_read_chunk_size(self,size):pass
            async def readany(self):
                width=min(self.remaining,65537);self.remaining-=width;return b'x'*width
        for size in [CAP-1,CAP,CAP+1]:
            with self.subTest(size=size):
                req=SimpleNamespace(_read_bytes=None,_client_max_size=CAP,_payload=Payload(size))
                if size>CAP:
                    with self.assertRaises(HTTPRequestEntityTooLarge):await BaseRequest.read(req)
                else:self.assertEqual(len(await BaseRequest.read(req)),size)

    async def test_api_middleware_content_length_and_chunked_oversize(self):
        class TooLarge(Exception):pass
        web=SimpleNamespace(HTTPRequestEntityTooLarge=TooLarge,json_response=lambda body,status:SimpleNamespace(status=status))
        middleware=load_function('gateway/platforms/api_server.py','body_limit_middleware',{'web':web,'MAX_REQUEST_BYTES':CAP,'_openai_error':lambda *a,**k:{}})
        async def ok(req):return SimpleNamespace(status=200)
        async def too_large(req):raise TooLarge()
        for value,expected in [(str(CAP-1),200),(str(CAP),200),(str(CAP+1),413),('bad',400)]:
            response=await middleware(SimpleNamespace(method='POST',headers={'Content-Length':value}),ok)
            self.assertEqual(response.status,expected)
        self.assertEqual((await middleware(SimpleNamespace(method='POST',headers={}),too_large)).status,413)

    def test_websocket_sans_io_text_frame_boundary(self):
        try:
            from websockets.protocol import Protocol, SERVER
            from websockets.frames import Frame, Opcode
            from websockets.exceptions import PayloadTooBig
        except ModuleNotFoundError:self.skipTest('websockets is optional; use installed backend_tools environment')
        for size in [CAP-1,CAP,CAP+1]:
            protocol=Protocol(SERVER,max_size=CAP)
            protocol.receive_data(Frame(Opcode.TEXT,b'x'*size).serialize(mask=True))
            events=protocol.events_received()
            if size>CAP:
                self.assertEqual(events,[])
                self.assertIsInstance(protocol.parser_exc,PayloadTooBig)
            else:self.assertEqual(len(events[0].data),size)

    async def test_control_stream_and_pipe_exact_frame_boundary(self):
        spec=importlib.util.spec_from_file_location('_offline_control',ROOT/'gateway/control_socket.py')
        mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
        class Transport:
            def __init__(self):self.output=[];self.closed=False
            def write(self,data):self.output.append(data)
            async def drain(self):pass
            def close(self):self.closed=True
        server=mod.GatewayControlServer(home=ROOT,verb_handlers={'synthetic':lambda:{'safe':True}})
        for size in [CAP-1,CAP,CAP+1]:
            body=b'{"verb":"synthetic"}'+b' '*(size-21)+b'\n'
            self.assertEqual(len(body),size)
            stream=asyncio.StreamReader(limit=mod._MAX_REQUEST_BYTES)
            stream.feed_data(body);stream.feed_eof();writer=Transport()
            await server._handle_connection(stream,writer)
            self.assertEqual(bool(writer.output),size<=CAP)
            self.assertTrue(writer.closed)
            transport=Transport();pipe=mod._PipeControlProtocol(server);pipe.connection_made(transport)
            for i in range(0,len(body),65537):pipe.data_received(body[i:i+65537])
            self.assertEqual(bool(transport.output),size<=CAP)
            self.assertTrue(transport.closed)

    async def test_control_response_boundary(self):
        spec=importlib.util.spec_from_file_location('_offline_control_response',ROOT/'gateway/control_socket.py')
        mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
        base={'ok':True,'protocol':1,'result':{'text':''}}
        overhead=len(json.dumps(base).encode())
        for size in [CAP-1,CAP,CAP+1]:
            server=mod.GatewayControlServer(home=ROOT,verb_handlers={'synthetic':lambda size=size:{'text':'x'*(size-overhead)}})
            line=server.handle_request_line(b'{"verb":"synthetic"}')
            value=json.loads(line)
            self.assertEqual(value['ok'],size<=CAP)
            if size<=CAP:self.assertEqual(len(line)-1,size)
            else:self.assertEqual(value['error'],'response too large')

class ResponseReaderBoundaryTests(unittest.IsolatedAsyncioTestCase):
    def test_discord_sync_response_boundary(self):
        class SyntheticError(Exception):pass
        reader=load_function('tools/discord_tool.py','_read_limited_response_body',{'DiscordAPIError':SyntheticError})
        for size in [CAP-1,CAP,CAP+1]:
            response=io.BytesIO(b'x'*size)
            if size>CAP:
                with self.assertRaises(SyntheticError):reader(response,CAP,label='synthetic')
            else:self.assertEqual(len(reader(response,CAP,label='synthetic')),size)

    async def test_discord_async_response_boundary(self):
        class Response:
            def __init__(self,size):self.data=io.BytesIO(b'x'*size);self.content=self;self.closed=False
            async def read(self,size):return self.data.read(size)
            def close(self):self.closed=True
        reader=load_function('plugins/platforms/discord/adapter.py','_standalone_read_response_bytes_limited',{'inspect':inspect,'_standalone_close_response':lambda r:r.close()})
        for size in [CAP-1,CAP,CAP+1]:
            response=Response(size);body,truncated=await reader(response,CAP)
            self.assertEqual(len(body),min(size,CAP));self.assertEqual(truncated,size>CAP);self.assertEqual(response.closed,size>CAP)

    def test_tts_upstream_response_boundary_and_close(self):
        class Response:
            def __init__(self,size):self.size=size;self.closed=False
            def iter_content(self,chunk_size):
                remaining=self.size
                while remaining:
                    width=min(remaining,chunk_size);remaining-=width;yield b'x'*width
            def close(self):self.closed=True
        reader=load_function('tools/tts_tool.py','_read_tts_response_bytes',{'TTS_RESPONSE_BODY_LIMIT_BYTES':CAP,'TTS_RESPONSE_BODY_CHUNK_BYTES':65536,'_response_has_explicit_stream':lambda r:True,'_close_response':lambda r:r.close()})
        for size in [CAP-1,CAP,CAP+1]:
            response=Response(size)
            if size>CAP:
                with self.assertRaisesRegex(RuntimeError,'exceeds'):reader(response,label='synthetic')
            else:self.assertEqual(len(reader(response,label='synthetic')),size)
            self.assertTrue(response.closed)

    def test_tts_streaming_cap_stops_pulling_after_oversize(self):
        warnings=[]
        capped=load_function('tools/tts_streaming.py','_capped',{'_STREAM_SENTENCE_BYTE_CAP':CAP,'logger':SimpleNamespace(warning=lambda *a:warnings.append(a))})
        for size in [CAP-1,CAP]:self.assertEqual(sum(map(len,capped([b'x'*size],'synthetic'))),size)
        def oversized():
            yield b'x'*CAP
            yield b'x'
            raise AssertionError('reader continued after crossing cap')
        self.assertEqual(sum(map(len,capped(oversized(),'synthetic'))),CAP)
        self.assertEqual(len(warnings),1)

    def test_hosted_peer_response_boundary(self):
        class TooLarge(Exception):pass
        class Deadline(Exception):pass
        reader=load_function('tui_gateway/hosted_room_peer_http.py','_read_bounded_response',{'_content_length':lambda r:getattr(r,'declared',None),'_set_response_socket_timeout':lambda *a:None,'time':time,'_PEER_RESPONSE_CHUNK_BYTES':65536,'_PeerResponseTooLarge':TooLarge,'_PeerResponseDeadlineExceeded':Deadline})
        for declared in [False,True]:
            for size in [CAP-1,CAP,CAP+1]:
                response=io.BytesIO(b'x'*size)
                if declared:response.declared=size
                if size>CAP:
                    with self.assertRaises(TooLarge):reader(response,max_bytes=CAP,deadline=time.monotonic()+10)
                else:self.assertEqual(len(reader(response,max_bytes=CAP,deadline=time.monotonic()+10)),size)

if __name__ == '__main__':unittest.main()
