"""Fixture-only authentication tests. No application lifespan, DB, live Core or credential writes."""
import asyncio
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'backend_taskteam'))
from fastapi import APIRouter, Depends, FastAPI, Request
from pydantic import BaseModel
from taskteam_proc.internal_auth import InternalTokenAuthority, DailyTokenRotator, write_token_file, internal_post_endpoints
from taskteam_proc import api_auth

NOW = datetime(2026, 10, 31, 0, tzinfo=timezone.utc)
ENDPOINTS = [('POST', '/task/test'), ('POST', '/team/test'), ('POST', '/task_check_okng')]


async def call(app, path='/task/test', token=None, body=None, method='POST', extra_headers=()):
    messages = []
    raw = json.dumps(body or {}).encode()
    sent = False
    async def receive():
        nonlocal sent
        if sent:
            return {'type': 'http.disconnect'}
        sent = True
        return {'type': 'http.request', 'body': raw, 'more_body': False}
    async def send(message):
        messages.append(message)
    headers = [(b'content-type', b'application/json')] + list(extra_headers)
    if token is not None:
        headers.append((b'authorization', f'Bearer {token}'.encode()))
    await app({'type': 'http', 'asgi': {'version': '3.0'}, 'http_version': '1.1',
               'method': method, 'scheme': 'http', 'path': path, 'raw_path': path.encode(),
               'query_string': b'', 'root_path': '', 'headers': headers,
               'client': ('192.0.2.4', 1234), 'server': ('fixture', 8093)}, receive, send)
    status = next(m['status'] for m in messages if m['type'] == 'http.response.start')
    data = b''.join(m.get('body', b'') for m in messages if m['type'] == 'http.response.body')
    return status, json.loads(data)


class AuthorityTests(unittest.TestCase):
    def test_valid_internal_auth_does_not_depend_on_endpoint_registry(self):
        app = FastAPI()
        nested = APIRouter()
        async def endpoint():
            return {'status': 'OK'}
        nested.add_api_route('/要員/一覧', endpoint, methods=['POST'])
        nested.add_api_route('/閲覧', endpoint, methods=['GET'])
        outer = APIRouter()
        outer.include_router(nested, prefix='/team')
        outer.add_api_route('/task/一覧', endpoint, methods=['POST'])
        outer.add_api_route('/task_check_okng', endpoint, methods=['POST'])
        outer.add_api_route('/core/test', endpoint, methods=['POST'])
        outer.add_api_route('/teamwork/test', endpoint, methods=['POST'])
        app.include_router(outer)
        endpoints = internal_post_endpoints(app)
        self.assertEqual(endpoints, {
            ('POST', '/team/要員/一覧'), ('POST', '/task/一覧'), ('POST', '/task_check_okng')})
        authority = InternalTokenAuthority(signing_key=b'fixture', clock=lambda: NOW, endpoints=endpoints)
        token = authority.issue(NOW)['access_token']
        authority.verify(token, 'POST', '/team/要員/一覧')
        for method, path in [('GET', '/team/閲覧'), ('POST', '/team/未登録'), ('POST', '/core/test')]:
            authority.verify(token, method, path)

    def authority(self, now=NOW, key=b'fixture-only-key'):
        return InternalTokenAuthority(signing_key=key, clock=lambda: now, endpoints=ENDPOINTS)

    def test_scope_tamper_expiry_restart_and_daily_overlap(self):
        authority = self.authority()
        old = authority.issue(NOW)['access_token']
        self.assertEqual(authority.verify(old, 'POST', '/task/test')['sub'], 'backend_taskteam:worker')
        for method, path in [('GET', '/task/test'), ('POST', '/core/auth/現在利用者'), ('POST', '/task/new')]:
            authority.verify(old, method, path)
        for bad in [old + 'x', 'abc', 'tt1.!.$', old.replace('tt1.', 'tt2.')]:
            with self.assertRaises(ValueError):
                authority.verify(bad, 'POST', '/task/test')
        self.authority(NOW + timedelta(hours=24)).verify(old, 'POST', '/task/test')
        for check in [self.authority(NOW + timedelta(hours=25)), self.authority(NOW - timedelta(seconds=1)),
                      self.authority(key=b'different-fixture-restart')]:
            with self.assertRaises(ValueError):
                check.verify(old, 'POST', '/task/test')

    def test_rotation_retry_and_atomic_permissions(self):
        now = [NOW]
        calls = []
        def persist(payload):
            calls.append(payload)
            if len(calls) == 1:
                raise OSError('fixture')
        rotator = DailyTokenRotator(lambda now: str(now), persist, clock=lambda: now[0])
        with self.assertRaises(OSError):
            rotator.refresh()
        self.assertTrue(rotator.refresh())
        self.assertFalse(rotator.refresh())
        now[0] += timedelta(days=1)
        self.assertTrue(rotator.refresh())
        with tempfile.TemporaryDirectory() as directory:
            write_token_file(directory, {'access_token': 'fixture'})
            path = Path(directory) / '_AIDIY/backend_taskteam/internal_auth.json'
            self.assertEqual(json.loads(path.read_text())['access_token'], 'fixture')
            if sys.platform != 'win32':
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)
                self.assertEqual(path.parent.stat().st_mode & 0o777, 0o700)
            with patch('taskteam_proc.internal_auth.os.replace', side_effect=OSError('fixture')):
                with self.assertRaises(OSError):
                    write_token_file(directory, {'access_token': 'new'})
            self.assertEqual(json.loads(path.read_text())['access_token'], 'fixture')
            self.assertEqual(list(path.parent.glob('*.tmp')), [])


class ApiTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.app = FastAPI()
        self.authority = InternalTokenAuthority(signing_key=b'fixture-key', clock=lambda: NOW, endpoints=ENDPOINTS)
        self.app.state.internal_token_authority = self.authority
        class Body(BaseModel):
            操作利用者ID: str = 'admin'
            利用者ID: str = ''
        async def endpoint(body: Body, request: Request):
            return {'body': body.model_dump(), 'principal': request.state.principal}
        for _, path in ENDPOINTS:
            self.app.post(path, dependencies=[Depends(api_auth.require_auth)])(endpoint)

    async def test_no_auth_bad_auth_duplicate_and_internal(self):
        with patch.object(api_auth, '_current_user', side_effect=AssertionError('no Core contact')):
            self.assertEqual((await call(self.app))[0], 401)
            self.assertEqual((await call(self.app, token='tt1.bad'))[0], 401)
            self.assertEqual((await call(self.app, token='tt1.bad', extra_headers=[(b'authorization', b'Bearer duplicate')]))[0], 401)
            token = self.authority.issue(NOW)['access_token']
            for _, path in ENDPOINTS:
                status, data = await call(self.app, path, token, {'利用者ID': 'scheduled-owner'})
                self.assertEqual(status, 200)
                self.assertEqual(data['principal']['kind'], 'internal_taskteam')

    async def test_normal_user_identity_cannot_spoof_including_omitted_defaults(self):
        with patch.object(api_auth, '_current_user', return_value={'利用者ID': 'alice', '利用者名': 'Alice'}):
            for key in ['利用者ID', '操作利用者ID']:
                self.assertEqual((await call(self.app, token='fixture-user', body={key: 'admin'}))[0], 403)
            status, data = await call(self.app, token='fixture-user')
            self.assertEqual(status, 200)
            self.assertEqual(data['body']['操作利用者ID'], 'alice')
            self.assertEqual(data['body']['利用者ID'], 'alice')

    async def test_core_failure_is_closed(self):
        from fastapi import HTTPException
        for status in [401, 503]:
            with patch.object(api_auth, '_current_user', side_effect=HTTPException(status)):
                self.assertEqual((await call(self.app, token='fixture-user'))[0], status)


class WiringTests(unittest.IsolatedAsyncioTestCase):
    async def test_lifespan_publishes_before_workers_and_cleans_failure(self):
        import ast
        from contextlib import asynccontextmanager
        from types import SimpleNamespace
        source = (ROOT / 'backend_taskteam/taskteam_proc/runtime.py').read_text(encoding='utf-8')
        tree = ast.parse(source)
        function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'build_lifespan')
        function.returns = None
        for arg in function.args.args:
            arg.annotation = None
        for node in ast.walk(function):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                node.returns = None
                for arg in node.args.args:
                    arg.annotation = None
        events = []
        class Rotator:
            def __init__(self, *args, **kwargs): pass
            def start(self): events.append('published')
            def stop(self): events.append('stopped')
        @asynccontextmanager
        async def worker(logger):
            events.append('workers')
            raise RuntimeError('fixture startup failure')
            yield
        app = FastAPI()
        app.add_api_route('/task/test', lambda: {}, methods=['POST'])
        scope = {'asynccontextmanager': asynccontextmanager, 'InternalTokenAuthority': lambda **kwargs: SimpleNamespace(issue=None),
                 'PersistentTokenRotator': Rotator, 'write_token_file': None, 'BASE_DIR': ROOT,
                 'internal_post_endpoints': internal_post_endpoints,
                 '_worker_lifespan': worker}
        exec(compile(ast.Module(body=[function], type_ignores=[]), '<fixture extracted lifespan>', 'exec'), scope)
        with self.assertRaises(RuntimeError):
            async with scope['build_lifespan'](None)(app):
                pass
        self.assertEqual(events, ['published', 'workers', 'stopped'])
        self.assertIsNone(app.state.internal_token_authority)

    async def test_every_business_router_uses_auth_and_bind_is_unchanged(self):
        import ast
        tree = ast.parse((ROOT / 'backend_taskteam/taskteam_proc/app.py').read_text(encoding='utf-8'))
        found = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == 'include_router':
                name = node.args[0].id
                if name != 'router':
                    found.add(name)
                    self.assertIn('Depends(require_auth)', ast.unparse(node))
        self.assertEqual(found, {'tasks_router', 'check_router', 'team_router'})
        self.assertIn('host="0.0.0.0"', (ROOT / 'backend_taskteam/taskteam_main.py').read_text())
        self.assertNotIn('websocket(', ''.join(p.read_text() for p in (ROOT / 'backend_taskteam').glob('*_proc/*api.py')))


class CoreTransportTests(unittest.TestCase):
    def test_core_current_user_uses_only_configured_loopback_and_redacts(self):
        from unittest.mock import MagicMock
        from urllib.error import HTTPError, URLError
        from fastapi import HTTPException
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / '_config').mkdir()
            (root / '_config/AiDiy_key.json').write_text(json.dumps({'PORT_CORE': '18091'}))
            response = MagicMock()
            response.__enter__.return_value.read.return_value = json.dumps({'status': 'OK', 'data': {'利用者ID': 'alice'}}).encode()
            with patch.object(api_auth, 'PROJECT_ROOT', root), patch.object(api_auth._OPENER, 'open', return_value=response) as open_mock:
                self.assertEqual(api_auth._current_user('fixture-token')['利用者ID'], 'alice')
                request = open_mock.call_args.args[0]
                self.assertTrue(request.full_url.startswith('http://127.0.0.1:18091/'))
                self.assertEqual(request.headers['Authorization'], 'Bearer fixture-token')
            for error, status in [(HTTPError('fixture', 401, 'secret', {}, None), 401),
                                  (HTTPError('fixture', 302, 'secret', {}, None), 503), (URLError('secret'), 503)]:
                with patch.object(api_auth, 'PROJECT_ROOT', root), patch.object(api_auth._OPENER, 'open', side_effect=error):
                    with self.assertRaises(HTTPException) as caught:
                        api_auth._current_user('fixture-token')
                    self.assertEqual(caught.exception.status_code, status)
                    self.assertNotIn('secret', caught.exception.detail)


if __name__ == '__main__':
    unittest.main()
