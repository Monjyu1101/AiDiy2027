# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
"""入力保存名と実input_file分岐を確認。AI、DB、ユーザーファイルは起動/変更しない。"""
import ast
import asyncio
import base64
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
import importlib.util
import logging
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('input_file_storage', ROOT / 'AIコア/AI入力ファイル.py')
storage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(storage)
preview_spec = importlib.util.spec_from_file_location('file_preview', ROOT / 'AIコア/AIファイルプレビュー.py')
preview = importlib.util.module_from_spec(preview_spec)
preview_spec.loader.exec_module(preview)


class FrozenTime:
    @classmethod
    def now(cls):
        return datetime(2026, 10, 29, 12, 34, 56)


class InputFileStorageTest(unittest.TestCase):
    def test_same_name_same_second_and_parallel_sessions_do_not_overwrite(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(storage, 'datetime', FrozenTime):
            old = Path(folder, '20261029.123456.資料.txt')
            old.write_bytes(b'existing')
            def save(index):
                data = f'session-{index}'.encode()
                return storage.入力ファイル保存(folder, '資料.txt', data), data
            with ThreadPoolExecutor(max_workers=8) as pool:
                saved = list(pool.map(save, range(24)))
            self.assertEqual(len({name for name, _ in saved}), 24)
            for name, data in saved:
                self.assertTrue(name.startswith('20261029.123456.'))
                self.assertTrue(name.endswith('.資料.txt'))
                self.assertEqual(Path(folder, name).read_bytes(), data)
            self.assertEqual(old.read_bytes(), b'existing')
            self.assertEqual(len(list(Path(folder).iterdir())), 25)

    def test_uuid_collision_does_not_truncate_existing_file(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(storage, 'datetime', FrozenTime):
            uuid = SimpleNamespace(hex='fixed')
            with patch.object(storage.uuid, 'uuid4', return_value=uuid):
                name = storage.入力ファイル保存(folder, 'a.txt', b'first')
                with self.assertRaises(FileExistsError):
                    storage.入力ファイル保存(folder, 'a.txt', b'second')
            self.assertEqual(Path(folder, name).read_bytes(), b'first')

    def test_names_cannot_escape_and_long_utf8_name_preserves_extension(self):
        with tempfile.TemporaryDirectory() as folder:
            for name in ['../../a.png', 'C:\\private\\a.png', '資料' * 150 + '.png', '<bad>:\0.png', None]:
                actual = storage.入力ファイル保存(folder, name, b'test')
                self.assertEqual(Path(folder, actual).parent, Path(folder))
                self.assertEqual(Path(folder, actual).read_bytes(), b'test')
                self.assertLessEqual(len(actual.encode('utf8')), 255)
                if name:
                    self.assertTrue(actual.endswith('.png'))


    def test_windows_suffix_characters_are_safe_without_changing_original_input(self):
        with tempfile.TemporaryDirectory() as folder:
            for name in ["report.txt. ", "...", "a\x7f.txt"]:
                actual = storage.入力ファイル保存(folder, name, b'test')
                self.assertFalse(actual.endswith((".", " ")))
                self.assertNotIn("\x7f", actual)
                self.assertEqual(Path(folder, actual).read_bytes(), b'test')

class Session:
    def __init__(self, identity):
        self.identity = identity
        self.messages = []
        self.files = []
        self.voice_enabled = False

    async def send_to_channel(self, channel, message):
        await asyncio.sleep(0)
        self.messages.append((channel, message))

    def ファイル登録(self, channel, path):
        self.files.append((channel, path))


def route_fixture(folder):
    # 実WS関数のinput_file分岐だけを実行し、周囲のAI/DB初期化はstubへ置換する。
    source = (ROOT / 'core_router/AIコア.py').read_text(encoding='utf8')
    tree = ast.parse(source)
    endpoint = next(n for n in tree.body if isinstance(n, ast.AsyncFunctionDef) and n.name == 'websocket_endpoint')
    branch = next(n for n in ast.walk(endpoint) if isinstance(n, ast.If)
        and isinstance(n.test, ast.Compare) and isinstance(n.test.left, ast.Name)
        and n.test.left.id == 'メッセージ識別' and len(n.test.comparators) == 1
        and isinstance(n.test.comparators[0], ast.Constant) and n.test.comparators[0].value == 'input_file')
    wrapper = ast.parse('async def route(受信データ, セッション, ソケット番号="input"):\n    セッションID=セッション.identity\n    for _ in [0]:\n        pass\n').body[0]
    wrapper.body[1].body = branch.body
    history = []
    namespace = dict(os=os, base64=base64, datetime=datetime, logger=logging.getLogger('fixture-input-file'),
                     入力ファイル保存=storage.入力ファイル保存, 画像プレビュー生成=preview.画像プレビュー生成, バックエンドディレクトリ=folder,
                     保存_会話履歴=lambda **kwargs: history.append(kwargs))
    exec(compile(ast.fix_missing_locations(ast.Module(body=[wrapper], type_ignores=[])), 'input-file-under-test', 'exec'), namespace)
    return namespace['route'], history, namespace


class InputFileRouteTest(unittest.IsolatedAsyncioTestCase):
    async def test_echo_paths_and_original_names_remain_compatible_with_registry_and_history(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(storage, 'datetime', FrozenTime):
            route, history, _ = route_fixture(folder)
            a, b = Session('a'), Session('b')
            def packet(text, channel):
                return {'チャンネル': channel, 'ファイル名': '同名.txt', 'メッセージ内容': base64.b64encode(text.encode()).decode(), 'プロジェクトパス': '/fixture/project'}
            await asyncio.gather(route(packet('one', '1'), a), route(packet('two', '0'), b))
            self.assertEqual(len(a.messages), 1)
            self.assertEqual(len(b.messages), 1)
            paths = []
            for session, channel, text in [(a, '1', b'one'), (b, '0', b'two')]:
                received_channel, message = session.messages[0]
                self.assertEqual(received_channel, channel)
                self.assertEqual(message['セッションID'], session.identity)
                self.assertEqual(message['元ファイル名'], '同名.txt')
                self.assertEqual(message['メッセージ識別'], 'input_file')
                self.assertEqual(message['メッセージ内容'], 'ファイル受信: 同名.txt')
                self.assertTrue(message['ファイル名'].startswith('temp/input/'))
                self.assertEqual(Path(folder, message['ファイル名']).read_bytes(), text)
                self.assertEqual(session.files, [(channel, message['ファイル名'])])
                paths.append(message['ファイル名'])
            self.assertNotEqual(*paths)
            self.assertEqual({h['ファイル名'] for h in history}, set(paths))
            self.assertEqual({h['プロジェクトパス'] for h in history}, {'/fixture/project'})

    async def test_save_failure_is_error_not_success_echo_and_does_not_register(self):
        with tempfile.TemporaryDirectory() as folder:
            route, history, namespace = route_fixture(folder)
            session = Session('failed')
            def failed(*_):
                raise PermissionError('fixture denied')
            namespace['入力ファイル保存'] = failed
            with self.assertLogs('fixture-input-file', level='ERROR'):
                await route({'チャンネル': '1', 'ファイル名': 'a.txt', 'メッセージ内容': 'YWJj'}, session)
            self.assertEqual(session.messages[0][1]['エラーコード'], 'FILE_UPLOAD_FAILED')
            self.assertEqual(session.messages[0][1]['メッセージ識別'], 'error')
            self.assertEqual(session.files, [])
            self.assertEqual(history, [])

    async def test_non_input_socket_cannot_upload(self):
        with tempfile.TemporaryDirectory() as folder:
            route, history, _ = route_fixture(folder)
            session = Session('a')
            await route({'チャンネル': '1', 'ファイル名': 'a.txt', 'メッセージ内容': 'YWJj'}, session, '1')
            self.assertEqual(session.messages, [])
            self.assertEqual(history, [])
            self.assertEqual(list(Path(folder).iterdir()), [])

    async def test_png_echo_includes_preview_and_live_receives_the_same_fixture_image(self):
        try:
            from PIL import Image
            from io import BytesIO
        except ImportError:
            self.skipTest('Pillow is needed for Core thumbnail generation')
        from unittest.mock import AsyncMock
        data = BytesIO()
        Image.new('RGB', (2, 2), 'cyan').save(data, format='PNG')
        image = base64.b64encode(data.getvalue()).decode()
        with tempfile.TemporaryDirectory() as folder:
            route, _, _ = route_fixture(folder)
            session = Session('live')
            session.voice_enabled = True
            session.live_processor = SimpleNamespace(画像送信=AsyncMock())
            await route({'チャンネル': '0', 'ファイル名': '画像.png', 'メッセージ内容': image}, session)
            echo = session.messages[0][1]
            self.assertTrue(base64.b64decode(echo['サムネイル画像']).startswith(b'\x89PNG\r\n\x1a\n'))
            session.live_processor.画像送信.assert_awaited_once_with(image, format='png')


if __name__ == '__main__':
    unittest.main()
