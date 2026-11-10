"""単独 Avatar のプロジェクト境界。実DB・実認証情報を使用しない。"""
import ast
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi import HTTPException
from internal_api_auth import Principal
from internal_file_access import resolve_session_file, session_temp_directory


class InternalFileAccessTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.base = Path(temp.name)
        self.root = self.base / 'project'
        self.root.mkdir()
        self.file = self.root / 'hello.txt'
        self.file.write_text('fixture', encoding='utf-8')
        self.principal = Principal('internal', 'backend_core:code_live')
        self.session = SimpleNamespace(_auth_owner=self.principal.owner, モデル設定={'CODE_BASE_PATH': str(self.root)})
        self.manager = SimpleNamespace(get_session=lambda sid: self.session if sid == 'owned' else None)

    def resolve(self, name, sid='owned', principal=None):
        return resolve_session_file(self.manager, sid, principal or self.principal, str(name))

    def test_owned_project_absolute_and_relative(self):
        self.assertEqual(self.resolve(self.file), str(self.file))
        self.assertEqual(self.resolve('hello.txt'), str(self.file))

    def test_missing_foreign_session_and_unset_root(self):
        for sid in ('', None, 'unknown'):
            with self.assertRaises(HTTPException): self.resolve(self.file, sid)
        with self.assertRaises(HTTPException): self.resolve(self.file, principal=Principal('user', 'other'))
        self.session.モデル設定 = {}
        with self.assertRaises(HTTPException): self.resolve(self.file)

    def test_escape_symlinks_and_internal_credentials(self):
        outside = self.base / 'outside.txt'
        outside.write_text('outside')
        (self.root / 'alias.txt').symlink_to(outside)
        (self.root / 'inside-alias.txt').symlink_to(self.file)
        (self.root / 'outside-dir').symlink_to(self.base, target_is_directory=True)
        for name in ('internal_auth.json', 'INTERNAL_AUTH_KEYS.JSON', '.internal_auth.json.test.tmp'):
            (self.root / name).write_text('synthetic')
        for name in (outside, '../outside.txt', 'alias.txt', 'inside-alias.txt', 'outside-dir/outside.txt',
                     'internal_auth.json', 'INTERNAL_AUTH_KEYS.JSON', '.internal_auth.json.test.tmp'):
            with self.subTest(name=name), self.assertRaises(HTTPException): self.resolve(name)

    def test_capture_temp_stays_inside_project(self):
        result = session_temp_directory(self.session, self.base, create_input=True)
        self.assertEqual(Path(result), self.root / 'temp/input')
        capture = Path(result) / 'capture.png'
        capture.write_bytes(b'fixture')
        self.assertEqual(self.resolve('temp/input/capture.png'), str(capture))

    def test_capture_temp_rejects_symlink(self):
        (self.root / 'temp').symlink_to(self.base, target_is_directory=True)
        with self.assertRaises(ValueError): session_temp_directory(self.session, self.base, create_input=True)

    def test_routes_use_session_guard_and_preserve_normal_resolution(self):
        source = (Path(__file__).resolve().parents[1] / 'core_router/files.py').read_text(encoding='utf-8')
        tree = ast.parse(source)
        fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == '_認証済みファイルパス')
        fallback = Mock(return_value='normal-backend-relative')
        namespace = {'_解決ファイルパス': fallback}
        exec(compile(ast.Module(body=[fn], type_ignores=[]), '<test>', 'exec'), namespace)
        request = SimpleNamespace(ファイル名=' temp/input/foo.txt ')
        self.assertEqual(namespace[fn.name](request, Principal('user', 'fixture')), 'normal-backend-relative')
        fallback.assert_called_once_with('temp/input/foo.txt')
        for name in ('get_ファイル内容', 'update_ファイル内容'):
            node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == name)
            text = ast.get_source_segment(source, node)
            self.assertIn('Depends(_ファイル認証)', text)
            self.assertIn('_認証済みファイルパス(request, 現在利用者)', text)

    def test_content_read_and_update_use_resolved_owned_file(self):
        import base64
        import os
        source = (Path(__file__).resolve().parents[1] / 'core_router/files.py').read_text(encoding='utf-8')
        tree = ast.parse(source)
        functions = []
        for node in tree.body:
            if isinstance(node, ast.FunctionDef) and node.name in ('get_ファイル内容', 'update_ファイル内容'):
                node.decorator_list = []
                node.returns = None
                node.args.defaults = []
                for arg in node.args.args:
                    arg.annotation = None
                functions.append(node)
        namespace = {
            'schemas': SimpleNamespace(ResponseBase=lambda **kw: SimpleNamespace(**kw)),
            '_認証済みファイルパス': lambda request, principal: self.resolve(request.ファイル名, request.セッションID, principal),
            'is_internal_credential_path': lambda path: False,
            'HTTPException': HTTPException, 'os': os, 'base64': base64,
        }
        exec(compile(ast.Module(body=functions, type_ignores=[]), '<routes-test>', 'exec'), namespace)
        request = SimpleNamespace(ファイル名='hello.txt', セッションID='owned', 内容='updated fixture')
        read = namespace['get_ファイル内容'](request, self.principal)
        self.assertEqual(base64.b64decode(read.data['base64_data']), b'fixture')
        update = namespace['update_ファイル内容'](request, self.principal)
        self.assertEqual(update.status, 'OK')
        self.assertEqual(self.file.read_text(), 'updated fixture')
        request.セッションID = 'unknown'
        for name in ('get_ファイル内容', 'update_ファイル内容'):
            with self.assertRaises(HTTPException): namespace[name](request, self.principal)

    def test_fastapi_request_binding_and_authentication(self):
        import base64
        from datetime import datetime, timedelta, timezone
        import os
        from unittest.mock import patch
        from fastapi import FastAPI, Request, Depends
        from fastapi.testclient import TestClient
        from pydantic import BaseModel
        from internal_api_auth import authenticate
        from internal_auth import InternalTokenAuthority, is_internal_credential_path

        source = (Path(__file__).resolve().parents[1] / 'core_router/files.py').read_text(encoding='utf-8')
        tree = ast.parse(source)
        names = {'ファイル内容取得Request', 'ファイル内容更新Request', '_ファイル認証',
                 'get_ファイル内容', 'update_ファイル内容'}
        nodes = [node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.ClassDef)) and node.name in names]
        for node in nodes:
            node.decorator_list = []
        def resolve(request, principal):
            if principal.kind == 'internal':
                return self.resolve(request.ファイル名, request.セッションID, principal)
            # The normal-user branch keeps backend-relative/absolute resolution.
            return str(self.file)
        namespace = {
            'BaseModel': BaseModel, 'Request': Request, 'Depends': Depends,
            'Principal': Principal, 'authenticate': authenticate,
            'schemas': SimpleNamespace(ResponseBase=lambda **kw: kw),
            '_認証済みファイルパス': resolve,
            'is_internal_credential_path': is_internal_credential_path,
            'HTTPException': HTTPException, 'os': os, 'base64': base64,
        }
        exec(compile(ast.Module(body=nodes, type_ignores=[]), '<fastapi-routes-test>', 'exec'), namespace)
        app = FastAPI()
        authority = InternalTokenAuthority(signing_key='synthetic-file-route-test-key')
        app.state.internal_token_authority = authority
        app.post('/core/files/内容取得')(namespace['get_ファイル内容'])
        app.post('/core/files/内容更新')(namespace['update_ファイル内容'])
        token = authority.issue(datetime.now(timezone.utc))['access_token']
        expired = authority.issue(datetime.now(timezone.utc) - timedelta(days=2))['access_token']
        payload = {'ファイル名': 'hello.txt', 'セッションID': 'owned', '内容': 'route fixture'}
        with TestClient(app) as client, patch('internal_api_auth._normal_user', side_effect=lambda value: 'fixture-user' if value == 'normal-fixture' else None):
            for endpoint in ('内容取得', '内容更新'):
                url = '/core/files/' + endpoint
                for bad in ('invalid-token', expired):
                    response = client.post(url, json=payload, headers={'Authorization': 'Bearer ' + bad})
                    self.assertEqual(response.status_code, 401, response.text)
                response = client.post(url, json=payload)
                self.assertEqual(response.status_code, 401, response.text)
                response = client.post(url, json=payload, headers={'Authorization': 'Bearer ' + token})
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json()['status'], 'OK')
                no_session = {k: v for k, v in payload.items() if k != 'セッションID'}
                response = client.post(url, json=no_session, headers={'Authorization': 'Bearer ' + token})
                self.assertEqual(response.status_code, 403, response.text)
                response = client.post(url, json=no_session, headers={'Authorization': 'Bearer normal-fixture'})
                self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(self.file.read_text(), 'route fixture')


if __name__ == '__main__':
    unittest.main()
