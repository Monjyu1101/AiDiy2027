# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
"""実Code要求処理をASTで分離し、stub AIの生成画像通知を確認（AI/DB起動なし）。"""
import ast
import logging
import hashlib
import os
from pathlib import Path
import stat
import tempfile
from types import SimpleNamespace
from typing import Optional
import unittest
from unittest.mock import AsyncMock, Mock, patch

SOURCE = Path(__file__).resolve().parents[1] / 'AIコア/AIコード.py'
METHODS = {'_基本AI処理', '_生成画像属性', '_生成画像安全パス', '_生成画像一覧取得', '_生成ファイル通知'}
PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6EJAAAAAASUVORK5CYII='


def fixture(root, action, explicit=None):
    tree = ast.parse(SOURCE.read_text(encoding='utf-8'))
    cls = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == 'CodeAgent')
    cls.body = [node for node in cls.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in METHODS]
    constants = [node for node in tree.body if isinstance(node, ast.Assign)
                 and any(isinstance(target, ast.Name) and target.id.startswith('_生成画像') for target in node.targets)]
    preview = Mock(return_value=PNG)
    namespace = dict(os=os, stat=stat, hashlib=hashlib, Optional=Optional, logger=logging.getLogger('fixture-code-generated'),
                     画像プレビュー生成=preview, 応答正規化=lambda value: str(value or ''),
                     エラー応答=lambda error: '! ' + str(error), エラー応答判定=lambda text: text.startswith('!'))
    exec(compile(ast.fix_missing_locations(ast.Module(body=constants + [cls], type_ignores=[])), str(SOURCE), 'exec'), namespace)
    agent = namespace['CodeAgent']()
    messages, history = [], []

    async def send(channel, packet):
        messages.append((channel, dict(packet)))

    async def execute(**kwargs):
        action()
        return 'fixture finished'

    ai = SimpleNamespace(実行=AsyncMock(side_effect=execute))
    if explicit is not None:
        ai.last_output_files = explicit
    agent.絶対パス = str(root)
    agent.セッションID = 'fixture-session'
    agent.チャンネル = '1'
    agent.接続 = SimpleNamespace(send_to_channel=send)
    agent.保存関数 = lambda **packet: history.append(packet)
    agent.強制停止フラグ = False
    agent._ensure_ai_instance = AsyncMock(return_value=ai)
    agent._ストリーム開始通知送信 = AsyncMock()
    agent._ストリーム終了通知送信 = AsyncMock()
    agent._バックアップ検証ループ = AsyncMock(return_value=False)
    return agent, messages, history, preview, namespace, ai


def write(root, relative, data=b'fixture image'):
    target = Path(root, relative)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    return target


class CodeGeneratedFilesTest(unittest.IsolatedAsyncioTestCase):
    async def run_request(self, agent, kind='input_text'):
        answer = await agent._基本AI処理({'メッセージ識別': kind, 'メッセージ内容': 'make an image', 'self_check_loop': 0})
        self.assertEqual(answer, 'fixture finished')

    async def test_real_request_only_reports_created_or_changed_images_in_requested_project(self):
        with tempfile.TemporaryDirectory() as folder:
            a, b = Path(folder, 'a'), Path(folder, 'b')
            write(a, 'images/existing.png', b'existing')
            write(a, 'images/changed.png', b'before')
            write(b, 'output/unrelated.png', b'unrelated')
            def action():
                write(a, 'output/new.PNG', b'new')
                write(a, 'images/changed.png', b'after')
                write(a, 'assets/readme.txt', b'not an image')
                write(b, 'output/other-new.png', b'other')
            agent, messages, history, preview, _, ai = fixture(a, action)
            previous = os.getcwd()
            try:
                os.chdir(b)
                await self.run_request(agent)
            finally:
                os.chdir(previous)
            output = [(channel, packet) for channel, packet in messages if packet['メッセージ識別'] == 'output_file']
            self.assertEqual({packet['ファイル名'] for _, packet in output}, {'images/changed.png', 'output/new.PNG'})
            self.assertEqual({args[0][0] for args in preview.call_args_list}, {b'new', b'after'})
            for channel, packet in output:
                self.assertEqual(channel, '1')
                self.assertEqual(packet['チャンネル'], '1')
                self.assertEqual(packet['セッションID'], 'fixture-session')
                self.assertEqual(packet['プロジェクトパス'], str(a))
                self.assertEqual(packet['サムネイル画像'], PNG)
                self.assertIn({key: value for key, value in packet.items() if key != "ファイル版"}, history)
            ai.実行.assert_awaited_once_with(要求テキスト='make an image', 絶対パス=str(a))
            self.assertTrue(all(packet['チャンネル'] == '1' for packet in history))

    async def test_live_input_request_also_returns_image_to_same_session_channel_zero(self):
        with tempfile.TemporaryDirectory() as folder:
            agent, messages, history, preview, _, _ = fixture(folder, lambda: write(folder, 'temp/output/live.png'))
            await self.run_request(agent, 'input_request')
            output = [(channel, packet) for channel, packet in messages if packet['メッセージ識別'] == 'output_file']
            self.assertEqual([channel for channel, _ in output], ['1', '0'])
            for channel, packet in output:
                self.assertEqual(packet['チャンネル'], channel)
                self.assertEqual(packet['セッションID'], 'fixture-session')
                self.assertIn({key: value for key, value in packet.items() if key != "ファイル版"}, history)
            preview.assert_called_once_with(b'fixture image')

    async def test_unchanged_recent_file_is_not_reported_and_missing_project_never_uses_cwd(self):
        with tempfile.TemporaryDirectory() as folder:
            write(folder, 'images/existing.png')
            for root in [folder, '', 'relative-project']:
                agent, messages, _, preview, _, _ = fixture(root, lambda: None)
                await self.run_request(agent)
                self.assertFalse(any(packet['メッセージ識別'] == 'output_file' for _, packet in messages))
                preview.assert_not_called()

    async def test_explicit_output_list_is_preferred_but_cannot_include_outside_or_unchanged_file(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder, 'project')
            write(root, 'images/unchanged.png')
            outside = write(folder, 'outside.png')
            def action():
                write(root, 'output/selected.png', b'selected')
                write(root, 'output/other.png', b'not selected')
            agent, messages, _, preview, _, _ = fixture(root, action,
                ['output/selected.png', 'images/unchanged.png', str(outside), '../outside.png'])
            await self.run_request(agent)
            self.assertEqual([packet['ファイル名'] for _, packet in messages if packet['メッセージ識別'] == 'output_file'], ['output/selected.png'])
            preview.assert_called_once_with(b'selected')

    async def test_symlink_file_directory_and_parent_escape_are_never_read(self):
        with tempfile.TemporaryDirectory() as folder:
            root, outside = Path(folder, 'project'), Path(folder, 'outside')
            root.mkdir()
            secret = write(outside, 'secret.png', b'private')
            try:
                (root / 'assets').symlink_to(outside, target_is_directory=True)
                (root / 'temp').symlink_to(outside, target_is_directory=True)
            except (OSError, NotImplementedError):
                self.skipTest('symlink creation unavailable')
            def action():
                write(outside, 'output/new.png', b'private')
                (root / 'images').mkdir()
                (root / 'images' / 'linked.png').symlink_to(secret)
                write(root, 'output/safe.png', b'safe')
            agent, messages, _, preview, _, _ = fixture(root, action)
            await self.run_request(agent)
            self.assertEqual([packet['ファイル名'] for _, packet in messages if packet['メッセージ識別'] == 'output_file'], ['output/safe.png'])
            preview.assert_called_once_with(b'safe')

    async def test_scan_count_and_notification_count_fail_closed(self):
        with tempfile.TemporaryDirectory() as folder:
            for limit_name, limit in [('_生成画像走査上限', 2), ('_生成画像通知上限', 2)]:
                root = Path(folder, limit_name)
                root.mkdir()
                def action():
                    for i in range(3):
                        write(root, f'output/{i}.png')
                agent, messages, _, preview, namespace, _ = fixture(root, action)
                namespace[limit_name] = limit
                await self.run_request(agent)
                self.assertFalse(any(packet['メッセージ識別'] == 'output_file' for _, packet in messages))
                preview.assert_not_called()

    async def test_incomplete_start_snapshot_does_not_treat_old_files_as_new(self):
        with tempfile.TemporaryDirectory() as folder:
            for i in range(3):
                write(folder, f'images/{i}.png')
            agent, messages, _, preview, namespace, _ = fixture(folder, lambda: write(folder, 'output/new.png'))
            namespace['_生成画像走査上限'] = 2
            await self.run_request(agent)
            self.assertFalse(any(packet['メッセージ識別'] == 'output_file' for _, packet in messages))
            preview.assert_not_called()

    async def test_oversize_generated_file_is_not_read_and_invalid_preview_stays_text_only(self):
        with tempfile.TemporaryDirectory() as folder:
            def action():
                write(folder, 'output/big.png', b'large')
                write(folder, 'output/bad.png', b'bad')
            agent, messages, _, preview, namespace, _ = fixture(folder, action)
            namespace['_生成画像読込上限'] = 3
            preview.return_value = None
            await self.run_request(agent)
            output = [packet for _, packet in messages if packet['メッセージ識別'] == 'output_file']
            self.assertEqual([packet['ファイル名'] for packet in output], ['output/bad.png'])
            self.assertIsNone(output[0]['サムネイル画像'])
            preview.assert_called_once_with(b'bad')

    async def test_file_replaced_after_snapshot_is_not_previewed(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder, 'project')
            root.mkdir()
            secret = write(folder, 'outside.png', b'private')
            agent, messages, _, preview, _, _ = fixture(root, lambda: write(root, 'output/result.png', b'public'))
            original_open = os.open
            replaced = False
            def replace_then_open(path, flags, *args, **kwargs):
                nonlocal replaced
                if str(path).endswith('result.png') and not replaced:
                    replaced = True
                    Path(path).unlink()
                    Path(path).symlink_to(secret)
                return original_open(path, flags, *args, **kwargs)
            with patch.object(os, 'open', side_effect=replace_then_open):
                await self.run_request(agent)
            preview.assert_not_called()
            self.assertFalse(any(packet['メッセージ識別'] == 'output_file' for _, packet in messages))

    async def test_output_revision_changes_only_with_bytes_and_history_keeps_existing_signature(self):
        with tempfile.TemporaryDirectory() as folder:
            payload = [b'first']
            agent, messages, history, _, _, _ = fixture(folder, lambda: write(folder, 'output/reused.png', payload[0]))
            await self.run_request(agent)
            payload[0] = b'second'
            await self.run_request(agent)
            await self.run_request(agent)
            output = [packet for _, packet in messages if packet['メッセージ識別'] == 'output_file']
            self.assertEqual(len(output), 3)
            self.assertEqual(output[0]['ファイル版'], hashlib.sha256(b'first').hexdigest())
            self.assertEqual(output[1]['ファイル版'], hashlib.sha256(b'second').hexdigest())
            self.assertEqual(output[1]['ファイル版'], output[2]['ファイル版'])
            self.assertTrue(all('ファイル版' not in packet for packet in history))
            self.assertTrue(all(packet['ファイル名'] == 'output/reused.png' for packet in output))

    async def test_real_request_uses_real_bounded_png_helper(self):
        import base64
        import importlib.util
        from io import BytesIO
        try:
            from PIL import Image
        except ImportError:
            self.skipTest('Pillow is needed for Core preview integration')
        spec = importlib.util.spec_from_file_location('fixture_preview', SOURCE.with_name('AIファイルプレビュー.py'))
        helper = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(helper)
        data = BytesIO()
        Image.new('RGB', (1, 10000), 'cyan').save(data, format='PNG')
        with tempfile.TemporaryDirectory() as folder:
            agent, messages, _, _, namespace, _ = fixture(folder, lambda: write(folder, 'output/tall.png', data.getvalue()))
            namespace['画像プレビュー生成'] = helper.画像プレビュー生成
            await self.run_request(agent)
            output = [packet for _, packet in messages if packet['メッセージ識別'] == 'output_file']
            self.assertEqual(len(output), 1)
            with Image.open(BytesIO(base64.b64decode(output[0]['サムネイル画像']))) as image:
                self.assertEqual(image.format, 'PNG')
                self.assertLessEqual(image.width, 320)
                self.assertLessEqual(image.height, 320)

    def test_source_line_endings_and_shared_preview_import_are_preserved(self):
        data = SOURCE.read_bytes()
        # Git checkouts may use LF or CRLF; reject mixed line endings.
        self.assertIn(data.count(b'\r\n'), (0, data.count(b'\n')))
        self.assertIn('from AIコア.AIファイルプレビュー import 画像プレビュー生成', data.decode('utf-8'))


if __name__ == '__main__':
    unittest.main()
