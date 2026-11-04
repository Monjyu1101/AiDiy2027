# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
"""実PNG fixtureのみでCoreの展開量/縮小/非画像fallbackを検証する。"""
import ast
import base64
import importlib.util
from io import BytesIO
from pathlib import Path
import struct
import sys
import tempfile
from types import ModuleType
import unittest
from unittest.mock import patch
import zlib

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('file_preview_under_test', ROOT / 'AIコア/AIファイルプレビュー.py')
preview = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preview)


class FilePreviewTest(unittest.TestCase):
    def setUp(self):
        from PIL import Image
        self.Image = Image

    def png(self, size):
        data = BytesIO()
        self.Image.new('RGB', size, 'cyan').save(data, format='PNG')
        return data.getvalue()

    def test_thin_wide_and_small_images_fit_both_dimensions_without_upscaling(self):
        for size, expected in [((1, 10000), (1, 320)), ((10000, 1), (320, 1)), ((640, 480), (320, 240)), ((2, 2), (2, 2))]:
            with self.subTest(size=size):
                result = preview.画像プレビュー生成(self.png(size))
                self.assertIsNotNone(result)
                with self.Image.open(BytesIO(base64.b64decode(result))) as image:
                    self.assertEqual(image.size, expected)
                    self.assertEqual(image.format, 'PNG')

    def test_decoded_pixel_limit_is_checked_before_load_resize_or_convert(self):
        # IHDRだけ過大にしたPNG。巨大画像自体は確保しない。
        data = bytearray(self.png((1, 1)))
        data[16:24] = struct.pack('>II', 4097, 4097)
        data[29:33] = struct.pack('>I', zlib.crc32(data[12:29]))
        with patch.object(self.Image.Image, 'thumbnail', side_effect=AssertionError('must not resize')) as resize, \
                patch.object(self.Image.Image, 'convert', side_effect=AssertionError('must not convert')) as convert:
            self.assertIsNone(preview.画像プレビュー生成(bytes(data)))
            resize.assert_not_called()
            convert.assert_not_called()

    def test_non_image_malformed_and_oversize_encoded_files_have_no_preview(self):
        for data in [b'', b'plain text', b'<svg onload="alert(1)"/>', b'\x89PNG\r\n\x1a\n']:
            self.assertIsNone(preview.画像プレビュー生成(data))
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder, 'fixture.png')
            path.write_bytes(self.png((2, 2)))
            self.assertIsNotNone(preview.画像プレビュー生成(str(path)))
            self.assertIsNone(preview.画像プレビュー生成(folder))
            with patch.object(preview, '最大画像バイト数', 8):
                self.assertIsNone(preview.画像プレビュー生成(str(path)))
                self.assertIsNone(preview.画像プレビュー生成(path.read_bytes()))

    def test_chat_output_method_uses_the_same_bounded_preview(self):
        source = ast.parse((ROOT / 'AIコア/AIチャット.py').read_text(encoding='utf8'))
        agent = next(node for node in source.body if isinstance(node, ast.ClassDef) and any(isinstance(item, ast.FunctionDef) and item.name == '_サムネイル生成' for item in node.body))
        method = next(node for node in agent.body if isinstance(node, ast.FunctionDef) and node.name == '_サムネイル生成')
        namespace = {}
        exec(compile(ast.fix_missing_locations(ast.Module(body=[method], type_ignores=[])), 'chat-preview-under-test', 'exec'), namespace)
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder, 'thin.png')
            path.write_bytes(self.png((1, 10000)))
            with patch.dict(sys.modules, {'AIコア': ModuleType('AIコア'), 'AIコア.AIファイルプレビュー': preview}):
                result = namespace['_サムネイル生成'](None, str(path))
            with self.Image.open(BytesIO(base64.b64decode(result))) as image:
                self.assertEqual(image.size, (1, 320))


if __name__ == '__main__':
    unittest.main()
