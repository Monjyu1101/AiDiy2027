"""実アプリ・実DB・実資格情報を使わない内部認証の回帰テスト。"""
import ast
import asyncio
from typing import Optional
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace, ModuleType
import unittest
from unittest.mock import Mock, patch, AsyncMock, mock_open

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from jose import JWTError, jwt
from fastapi import HTTPException
from internal_auth import InternalTokenAuthority, DailyTokenRotator, write_token_file, TOKEN_TTL, AUDIENCE, is_internal_credential_path
from internal_api_auth import authenticate, Principal, require_session_owner, require_session_settings, require_manager_owner, bind_session_owner
from auth_keyring import KeyringError

TEST_KEY = 'test-only-never-a-runtime-key'
READ = '/core/AIコア/モデル情報/取得'
WS = '/core/ws/AIコア'


class TokenTests(unittest.TestCase):
    def setUp(self):
        self.authority = InternalTokenAuthority(signing_key=TEST_KEY)
        self.now = datetime.now(timezone.utc)

    def test_ttl_scope_and_rotation_overlap(self):
        old = self.authority.issue(self.now - timedelta(hours=24))
        new = self.authority.issue(self.now)
        for payload in (old, new):
            claims = self.authority.verify(payload['access_token'], 'POST', READ)
            self.assertEqual(claims['exp'] - claims['iat'], 25 * 3600)
            self.assertEqual(datetime.fromisoformat(payload['expires_at']) - datetime.fromisoformat(payload['issued_at']), TOKEN_TTL)
        self.assertNotEqual(old['access_token'], new['access_token'])

    def test_expired_wrong_key_wrong_audience_and_normal_token_rejected(self):
        payload = self.authority.issue(self.now)
        invalid = [self.authority.issue(self.now - timedelta(hours=26))['access_token'],
                   InternalTokenAuthority(signing_key='another-test-key').issue(self.now)['access_token'],
                   jwt.encode({'sub': 'test', 'exp': int((self.now + timedelta(hours=1)).timestamp())}, TEST_KEY)]
        claims = jwt.get_unverified_claims(payload['access_token'])
        claims['aud'] = 'wrong-test-audience'
        invalid.append(jwt.encode(claims, TEST_KEY))
        for token in invalid:
            with self.subTest(token_type='synthetic'), self.assertRaises(JWTError):
                self.authority.verify(token, 'POST', READ)
        self.authority.verify(payload['access_token'], 'POST', '/core/C利用者/登録')

    def test_exact_expiry_boundary_and_future_issue_rejected(self):
        issued = self.now.replace(microsecond=0)
        now = [issued + TOKEN_TTL - timedelta(seconds=1)]
        authority = InternalTokenAuthority(signing_key=TEST_KEY, clock=lambda: now[0])
        token = authority.issue(issued)['access_token']
        authority.verify(token, 'POST', READ)
        now[0] = issued + TOKEN_TTL
        with self.assertRaises(JWTError): authority.verify(token, 'POST', READ)
        now[0] = issued - timedelta(seconds=1)
        with self.assertRaises(JWTError): authority.verify(token, 'POST', READ)

    def test_restart_old_token_invalid(self):
        payload = self.authority.issue(self.now)
        with self.assertRaises(JWTError):
            InternalTokenAuthority(signing_key='restart-test-key').verify(payload['access_token'], 'POST', READ)

    def test_missing_claims_and_scope_rejected(self):
        claims = jwt.get_unverified_claims(self.authority.issue(self.now)['access_token'])
        for key in ('exp', 'iat', 'aud', 'iss', 'sub', 'token_kind', 'scope'):
            changed = dict(claims); changed.pop(key)
            with self.subTest(key=key), self.assertRaises(JWTError):
                self.authority.verify(jwt.encode(changed, TEST_KEY), 'POST', READ)


class RotationTests(unittest.TestCase):
    def test_startup_same_day_forward_backward_and_failed_retry(self):
        now = [datetime(2030, 1, 1, 23, 59, tzinfo=timezone(timedelta(hours=9)))]
        issue = Mock(return_value={'access_token': 'fake-not-jwt'})
        persist = Mock()
        rotator = DailyTokenRotator(issue, persist, clock=lambda: now[0])
        self.assertTrue(rotator.refresh()); self.assertFalse(rotator.refresh())
        now[0] += timedelta(minutes=2)
        persist.side_effect = OSError('synthetic')
        with self.assertRaises(OSError): rotator.refresh()
        persist.side_effect = None
        self.assertTrue(rotator.refresh()); self.assertFalse(rotator.refresh())
        now[0] -= timedelta(days=1)
        self.assertTrue(rotator.refresh())
        self.assertEqual(issue.call_count, 4)

    def test_start_and_stop_thread(self):
        rotator = DailyTokenRotator(Mock(return_value={}), Mock())
        rotator.start(); rotator.stop()
        self.assertFalse(rotator._thread.is_alive())

    def test_atomic_private_file_and_failure_preserves_previous(self):
        with tempfile.TemporaryDirectory() as root:
            first = {'access_token': 'fake-only-one'}
            write_token_file(root, first)
            path = Path(root) / '_AIDIY/backend_core/internal_auth.json'
            self.assertEqual(json.loads(path.read_text()), first)
            if os.name != 'nt':
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)
                self.assertEqual(path.parent.stat().st_mode & 0o777, 0o700)
            with patch('internal_auth.os.replace', side_effect=OSError('synthetic')):
                with self.assertRaises(OSError): write_token_file(root, {'access_token': 'fake-only-two'})
            self.assertEqual(json.loads(path.read_text()), first)
            self.assertEqual(list(path.parent.glob('*.tmp')), [])

    @unittest.skipIf(os.name == 'nt', 'POSIX symlink fixture')
    def test_symlink_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            Path(root, '_AIDIY').symlink_to(root)
            with self.assertRaises(OSError): write_token_file(root, {'access_token': 'fake'})


class BoundaryTests(unittest.TestCase):
    def connection(self, headers):
        return SimpleNamespace(headers=headers, app=SimpleNamespace(state=SimpleNamespace(internal_token_authority=InternalTokenAuthority(signing_key=TEST_KEY))))

    def test_missing_invalid_fail_closed(self):
        for headers in ({}, {'authorization': 'Bearer fake-invalid'}, {'authorization': 'Basic fake'}):
            with self.assertRaises(HTTPException):
                authenticate(self.connection(headers), 'POST', READ, user_resolver=Mock(side_effect=ValueError))

    def test_internal_and_normal_principals_separate(self):
        connection = self.connection({})
        token = connection.app.state.internal_token_authority.issue(datetime.now(timezone.utc))['access_token']
        connection.headers['authorization'] = 'Bearer ' + token
        resolver = Mock(side_effect=ValueError)
        principal, protocol = authenticate(connection, 'POST', READ, user_resolver=resolver)
        self.assertEqual(principal.kind, 'internal'); resolver.assert_not_called()
        principal, protocol = authenticate(self.connection({'authorization': 'Bearer fake-normal'}), 'POST', READ, user_resolver=lambda _: 'fixture-user')
        self.assertEqual(principal, Principal('user', 'fixture-user'))

    def test_auth_not_ready_stays_503_instead_of_logging_user_out(self):
        connection = self.connection({'authorization': 'Bearer fake-token'})
        connection.app.state.internal_token_authority.verify = Mock(side_effect=KeyringError('fixture-not-ready'))
        with self.assertRaises(HTTPException) as caught:
            authenticate(connection, 'POST', READ)
        self.assertEqual(caught.exception.status_code, 503)
        connection.app.state.internal_token_authority = None
        with self.assertRaises(HTTPException) as caught:
            authenticate(connection, 'POST', READ, user_resolver=Mock(side_effect=HTTPException(status_code=503)))
        self.assertEqual(caught.exception.status_code, 503)

    def test_browser_ws_subprotocol_and_conflict(self):
        connection = self.connection({'sec-websocket-protocol': 'aidiy-auth, bearer.fake-normal'})
        principal, protocol = authenticate(connection, 'WEBSOCKET', WS, user_resolver=lambda _: 'fixture-user')
        self.assertEqual(protocol, 'aidiy-auth')
        connection.headers['authorization'] = 'Bearer another'
        with self.assertRaises(HTTPException): authenticate(connection, 'WEBSOCKET', WS)

    def test_session_ownership_preserved_and_settings_do_not_discriminate_internal(self):
        internal = Principal('internal', 'backend_core:code_live')
        user = Principal('user', 'fixture-user')
        session = SimpleNamespace(_auth_owner=user.owner)
        require_session_owner(session, user)
        with self.assertRaises(HTTPException): require_session_owner(session, internal)
        for save, reset, reboot in ((True, False, {}), (False, True, {}), (False, False, {'reboot_core': True})):
            request = SimpleNamespace(save=save, リセット=reset, 再起動要求=reboot)
            require_session_settings(internal, request)
            require_session_settings(user, request)

    def test_internal_credential_names_and_aliases_not_exposed(self):
        with tempfile.TemporaryDirectory() as root:
            secret = Path(root) / '_AIDIY/backend_core/internal_auth.json'
            secret.parent.mkdir(parents=True)
            secret.write_text('fake-only-fixture')
            self.assertTrue(is_internal_credential_path(secret))
            for alias in ('INTERNAL_AUTH.JSON', 'internal_auth.json. ', 'internal_auth.json::$DATA'):
                self.assertTrue(is_internal_credential_path(secret.parent / alias))
            self.assertTrue(is_internal_credential_path(secret.parent / '.internal_auth.json.fixture.tmp'))
            self.assertFalse(is_internal_credential_path(secret.parent / 'internal_auth.example.json'))
            if os.name != 'nt':
                alias = Path(root) / 'alias.json'; alias.symlink_to(secret)
                self.assertTrue(is_internal_credential_path(alias))
                hardlink = Path(root) / 'hardlink.json'; os.link(secret, hardlink)
                with patch('internal_auth.__file__', str(Path(root) / 'backend_server/internal_auth.py')):
                    self.assertTrue(is_internal_credential_path(hardlink))
                    taskteam = Path(root) / '_AIDIY/backend_taskteam/internal_auth.json'
                    taskteam.parent.mkdir(parents=True)
                    taskteam.write_text('fake-taskteam-fixture')
                    taskteam_link = Path(root) / 'taskteam-alias.json'
                    os.link(taskteam, taskteam_link)
                    self.assertTrue(is_internal_credential_path(taskteam_link))
                    for service in ('backend_core', 'backend_taskteam'):
                        private = Path(root) / '_AIDIY' / service / 'internal_auth_keys.json'
                        private.write_text('fake-private-fixture')
                        private_link = Path(root) / (service + '-private-alias.json')
                        os.link(private, private_link)
                        self.assertTrue(is_internal_credential_path(private))
                        self.assertTrue(is_internal_credential_path(private_link))
                        self.assertTrue(is_internal_credential_path(private.parent / '.internal_auth_keys.json.fixture.tmp'))
                    ordinary = Path(root) / 'ordinary.json'
                    ordinary.write_text('ordinary-fixture')
                    self.assertFalse(is_internal_credential_path(ordinary))

    def test_common_dependency_validates_internal_without_user_impersonation(self):
        root = Path(__file__).resolve().parents[1]
        fn = next(n for n in ast.parse((root / 'deps.py').read_text()).body if isinstance(n, ast.FunctionDef) and n.name == 'get_現在利用者')
        scope = dict(Depends=lambda _: None, oauth2_scheme=None, get_db=None,
                     HTTPException=HTTPException, status=SimpleNamespace(HTTP_401_UNAUTHORIZED=401),
                     jwt=jwt, JWTError=JWTError, Session=object,
                     auth=SimpleNamespace(verify_access_token=lambda token: jwt.decode(token, TEST_KEY, algorithms=['HS256'])),
                     KeyringError=KeyringError, SimpleNamespace=SimpleNamespace,
                     models=SimpleNamespace(C利用者=SimpleNamespace(利用者ID='利用者ID')))
        exec(compile(ast.Module(body=[fn], type_ignores=[]), '<dependency-fixture>', 'exec'), scope)
        token = jwt.encode({'sub': 'fixture-user', 'token_kind': 'internal_code_live',
                            'exp': int((datetime.now(timezone.utc) + timedelta(hours=1)).timestamp())}, TEST_KEY)
        db = Mock()
        with self.assertRaises(HTTPException): scope['get_現在利用者'](token=token, db=db)
        db.query.assert_not_called()
        authority = InternalTokenAuthority(signing_key=TEST_KEY)
        scope['auth'].get_keyring = lambda: authority
        scope['auth'].verify_access_token = Mock(side_effect=JWTError('not normal'))
        genuine = authority.issue(datetime.now(timezone.utc))['access_token']
        actor = scope['get_現在利用者'](token=genuine, db=db)
        self.assertEqual(actor.利用者ID, 'backend_core:code_live')
        self.assertEqual(actor.権限ID, '')
        self.assertEqual(actor.認証種別, 'internal')
        db.query.assert_not_called()
        for invalid in (genuine+'x', authority.issue(datetime.now(timezone.utc)-timedelta(hours=26))['access_token']):
            with self.assertRaises(HTTPException): scope['get_現在利用者'](token=invalid, db=db)
        scope['auth'].verify_access_token = lambda token: jwt.decode(token, TEST_KEY, algorithms=['HS256'])
        ordinary = jwt.encode({'sub': 'fixture-user', 'exp': int((datetime.now(timezone.utc) + timedelta(hours=1)).timestamp())}, TEST_KEY)
        expected = db.query.return_value.filter.return_value.first.return_value
        self.assertIs(scope['get_現在利用者'](token=ordinary, db=db), expected)
        db.reset_mock()
        scope['auth'].verify_access_token = Mock(side_effect=KeyringError('fixture-cold-start'))
        with self.assertRaises(HTTPException) as caught:
            scope['get_現在利用者'](token=ordinary, db=db)
        self.assertEqual(caught.exception.status_code, 503)
        db.query.assert_not_called()

    def test_wiring_is_before_ws_accept_and_outside_error_catch(self):
        root = Path(__file__).resolve().parents[1]
        tree = ast.parse((root / 'core_router/AIコア.py').read_text())
        ws = next(n for n in tree.body if isinstance(n, ast.AsyncFunctionDef) and n.name == 'websocket_endpoint')
        auth_calls = [n.lineno for n in ast.walk(ws) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == 'authenticate']
        accept_calls = [n.lineno for n in ast.walk(ws) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr == 'accept']
        self.assertLess(min(auth_calls), min(accept_calls))
        self.assertIn('rotator.stop()', (root / 'core_main.py').read_text())
        self.assertIn('internal_code_live', (root / 'deps.py').read_text())


class RouteCompatibilityTests(unittest.IsolatedAsyncioTestCase):
    async def test_normal_init_get_ws_save_and_reboot_with_stubs(self):
        root = Path(__file__).resolve().parents[1]
        principal = Principal('user', 'fixture-user')
        class Session:
            def __init__(self, session_id, voice_enabled=True):
                self.セッションID = session_id
                self.voice_enabled = voice_enabled
                self.モデル設定 = {}
                self.ボタン状態 = {}
                self.ソース最終更新日時 = None
                self.初期化ロック = asyncio.Lock()
                self.sockets = {}
            def get_socket(self, number): return self.sockets.get(number)
            def set_socket(self, number, socket): self.sockets[number] = socket
        class Socket:
            def __init__(self, *args): self.is_connected = False
            async def send_json(self, payload): pass
        scope = dict(Optional=Optional, WebSocket=object, SessionConnection=Session,
                     WebSocketConnection=Socket, WebSocketState=SimpleNamespace(CONNECTED='connected'),
                     logger=Mock(), REPLACED_CLOSE_CODE=4000)
        manager_tree = ast.parse((root / 'AIコア/AIセッション管理.py').read_text())
        methods = [n for n in ast.walk(manager_tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name in ('connect', 'ensure_session')]
        for method in methods:
            method.decorator_list = []
            exec(compile(ast.Module(body=[method], type_ignores=[]), '<manager-fixture>', 'exec'), scope)
        manager = SimpleNamespace(sessions={}, session_states={}, セッションID生成=lambda: 'fixture-session',
                                  _新規セッション初期モデル設定=lambda *_: {}, save_session_state=Mock(),
                                  _接続設定照合=Mock(), _fmt_log=lambda **_: 'fixture')
        manager.get_session = lambda sid: manager.sessions.get(sid)
        manager.ensure_session = lambda *a, **k: scope['ensure_session'](manager, *a, **k)
        conf_json = SimpleNamespace(get=lambda key, default=None: default, update=Mock(return_value=True))
        request_context = SimpleNamespace(app=SimpleNamespace(conf=SimpleNamespace(models=None, json=conf_json)))
        scope.update(dict(Request=object, 初期化リクエスト=object, モデル情報取得リクエスト=object,
                          モデル設定リクエスト=object, 初期化レスポンス=lambda **kw: SimpleNamespace(**kw),
                          authenticate=lambda *_: (principal, None), AIセッション管理=manager,
                          require_session_owner=require_session_owner, require_manager_owner=require_manager_owner,
                          bind_session_owner=bind_session_owner, require_session_settings=require_session_settings,
                          取得_コードベース選択肢=lambda _: {}, コードベース絶対パス取得=lambda **_: 'fixture-path',
                          対象パスキー=lambda path: path, セッションバックアップ完了待機=AsyncMock(),
                          バックエンドディレクトリ='fixture-backend', プロジェクトルート='fixture-root', os=os,
                          datetime=datetime))
        route_tree = ast.parse((root / 'core_router/AIコア.py').read_text())
        for fn in route_tree.body:
            if isinstance(fn, ast.AsyncFunctionDef) and fn.name in ('初期化', 'モデル情報取得', 'モデル情報設定'):
                fn.decorator_list = []
                exec(compile(ast.Module(body=[fn], type_ignores=[]), '<route-fixture>', 'exec'), scope)
        result = await scope['初期化'](request_context, SimpleNamespace(セッションID=''))
        self.assertEqual(result.status, 'OK')
        session_id = result.data['セッションID']
        self.assertEqual(manager.get_session(session_id)._auth_owner, principal.owner)
        decision = ModuleType('AIコア.AI判断'); decision.Decision = SimpleNamespace(model_options=lambda _: {})
        with patch.dict(sys.modules, {'AIコア.AI判断': decision}):
            result = await scope['モデル情報取得'](request_context, SimpleNamespace(セッションID=session_id))
        self.assertEqual(result['status'], 'OK')
        result = await scope['connect'](manager, SimpleNamespace(application_state='connected'),
                                         セッションID=session_id, accept_in_connect=False, auth_owner=principal.owner)
        self.assertEqual(result, session_id)
        with self.assertRaises(ValueError):
            await scope['connect'](manager, SimpleNamespace(), セッションID=session_id, auth_owner=('internal', 'fixture'))
        setting = SimpleNamespace(セッションID=session_id, モデル設定={'CODE_AI1_NAME': 'fixture'},
                                  再起動要求={}, save=True, リセット=False)
        result = await scope['モデル情報設定'](request_context, setting)
        self.assertEqual(result['status'], 'OK'); conf_json.update.assert_called_once()
        setting.モデル設定 = {}; setting.save = False; setting.再起動要求 = {'reboot_core': True}
        with patch('builtins.open', mock_open()) as writes:
            result = await scope['モデル情報設定'](request_context, setting)
        self.assertEqual(result['status'], 'OK'); writes.assert_called_once()


if __name__ == '__main__': unittest.main()
