# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
"""本番lifespanと媒体REST/MCPの統合回帰。待受socket・実AI・実設定は使わない。"""
import ast
import base64
from collections.abc import AsyncIterator
from contextlib import AsyncExitStack, ExitStack, asynccontextmanager
import importlib.util
import json
from pathlib import Path
import sys
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import httpx
from fastapi import FastAPI
from mcp.server.mcpserver import MCPServer
from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
from PIL import Image
from tools_proc import tools_media, tools_settings
from tools_proc.image_generation import ImageGeneration
from tools_proc.movie_generation import MovieGeneration
from tools_proc.speech_to_text import SpeechToText
from tools_proc.text_to_speech import TextToSpeech


class IntegrationTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.path = self.root / '_config' / 'AiDiy_tools.json'
        self.patches = ExitStack()
        self.addCleanup(self.patches.close)
        self.ig, self.mg, self.stt = ImageGeneration(), MovieGeneration(), SpeechToText()
        self.tts = TextToSpeech.__new__(TextToSpeech)  # 辞書生成・ffmpeg検出を避ける。
        self.patches.enter_context(patch.object(self.tts, 'normalize_for_speech', side_effect=lambda text, language: (text, [])))
        self.patches.enter_context(patch.object(self.tts, '_get_api_key', return_value='synthetic-key'))
        self.synth = self.patches.enter_context(patch.object(self.tts, '_synthesize_provider', return_value=b'ID3synthetic'))
        self.patches.enter_context(patch.object(self.tts, 'to_base64', return_value=('', str(self.root / 'speech.mp3'))))
        self.patches.enter_context(patch.object(self.tts, 'play_mp3', side_effect=AssertionError('no playback')))
        self.patches.enter_context(patch.object(self.stt, '_事前チェック_音声あり', return_value=True))
        self.patches.enter_context(patch.object(self.stt, '_認識_auto', return_value='synthetic-google'))
        self.patches.enter_context(patch.object(self.stt, '_認識_openai', return_value='synthetic-openai'))
        self.image = self.patches.enter_context(patch.object(self.ig, '_generate_provider', side_effect=lambda provider, prompt, original, model, size, quality: (Image.new('RGB', (1, 1)), {'provider': provider, 'prompt': prompt, 'model': model, 'generated_path': str(self.root / 'image.png')})))
        self.patches.enter_context(patch.object(tools_media, '_image_base64_and_paths', return_value=('synthetic', str(self.root / 'image.png'), str(self.root / 'image.png'))))
        self.patches.enter_context(patch.object(self.ig, 'to_base64', return_value=('synthetic', str(self.root / 'image.png'))))
        self.patches.enter_context(patch.object(self.ig, 'copy_generated_file', return_value=str(self.root / 'image.png')))
        self.movie = self.patches.enter_context(patch.object(self.mg, '_generate_gemini', side_effect=lambda **kwargs: (b'synthetic-mp4', {**kwargs, 'video_bytes_length': 13})))
        self.patches.enter_context(patch.object(self.mg, 'save', return_value=str(self.root / 'movie.mp4')))

    def write(self, value):
        self.path.parent.mkdir(exist_ok=True)
        self.path.write_text(json.dumps(value), encoding='utf-8')

    def make_app(self):
        # 起動処理の関数をそのままコンパイル。対象外のChrome/OBS/判断API等の
        # import時副作用だけを避け、媒体のサービス・登録・session managerは実物を使う。
        filename = Path(__file__).resolve().parents[1] / 'tools_main.py'
        tree = ast.parse(filename.read_text(encoding='utf-8'))
        names = {'_mcp_lifespan', '_ensure_session_manager'}
        functions = [node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in names]
        self.assertEqual(len(functions), 2)
        servers = {name: MCPServer(name, version='fixture') for name in ('image', 'movie', 'stt', 'tts')}
        for name, register, service in [('image', tools_media.register_image_gen_tools, self.ig), ('movie', tools_media.register_movie_gen_tools, self.mg), ('stt', tools_media.register_stt_tools, self.stt), ('tts', tools_media.register_tts_tools, self.tts)]:
            register(servers[name], service)
        decisions = SimpleNamespace(check_startup=AsyncMock(), register_tools=Mock())
        env = dict(asynccontextmanager=asynccontextmanager, AsyncIterator=AsyncIterator, AsyncExitStack=AsyncExitStack,
                   FastAPI=FastAPI, MCPServer=MCPServer, StreamableHTTPSessionManager=StreamableHTTPSessionManager,
                   MCP_MAP=servers, tools_management=Mock(), tools_decisions=decisions, decisions=object(), mcp_dj=object(), logger=Mock(),
                   load_tools_settings=lambda: tools_settings.load_tools_settings(self.path),
                   ig=self.ig, mg=self.mg, stt=self.stt, tts=self.tts)
        exec(compile(ast.Module(body=functions, type_ignores=[]), str(filename), 'exec'), env)
        app = FastAPI(lifespan=env['_mcp_lifespan'])
        app.include_router(tools_media.create_router(self.ig, self.mg, self.stt, self.tts))
        return app, servers, decisions

    async def test_lifespan_creates_config_and_starts_real_media_managers(self):
        app, servers, decisions = self.make_app()
        self.assertFalse(self.path.exists())
        async with app.router.lifespan_context(app):
            self.assertEqual(json.loads(self.path.read_text()), tools_settings.DEFAULTS)
            self.assertEqual(self.ig.auto_provider, 'codex')
            self.assertEqual(self.tts.auto_provider, 'edge')
            self.assertTrue(all(server.session_manager for server in servers.values()))
            decisions.check_startup.assert_awaited_once()
        self.assertFalse(list(self.path.parent.glob('*.tmp')))

    async def test_settings_apply_on_startup_not_during_requests_and_existing_file_is_preserved(self):
        self.write({'text_to_speech': {'auto_provider': 'openai'}})
        before = self.path.read_bytes()
        app, _, _ = self.make_app()
        async with app.router.lifespan_context(app):
            self.assertEqual(self.tts.auto_provider, 'openai')
            self.assertEqual(self.path.read_bytes(), before)
            self.write({'text_to_speech': {'auto_provider': 'gemini'}})
            self.assertEqual(self.tts.auto_provider, 'openai')
        app, _, _ = self.make_app()
        async with app.router.lifespan_context(app):
            self.assertEqual(self.tts.auto_provider, 'gemini')

    async def test_rest_config_auto_explicit_and_omitted_tts_compatibility(self):
        self.write({'text_to_speech': {'auto_provider': 'openai', 'auto_voice': 'male'},
                    'speech_to_text': {'auto_provider': 'openai'}, 'image_generation': {'auto_provider': 'openai'},
                    'movie_generation': {'auto_provider': 'gemini', 'auto_model': 'veo-2.0-generate-001', 'auto_aspect_ratio': '9:16', 'auto_resolution': '720p'}})
        app, _, _ = self.make_app()
        async with app.router.lifespan_context(app), httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://fixture') as client:
            async def post(endpoint, payload):
                response = await client.post(endpoint, json=payload)
                self.assertEqual(response.status_code, 200)
                data = response.json();self.assertNotIn('error', data);return data
            payload = {'speech_text': 'synthetic', 'save_path': str(self.root / 'speech.mp3')}
            self.assertEqual((await post('/aidiy_text_to_speech/synthesize', payload))['used_provider'], 'edge')
            self.assertEqual((await post('/aidiy_text_to_speech/synthesize', {**payload, 'provider': 'auto', 'voice': 'auto'}))['used_provider'], 'openai')
            self.assertEqual(self.synth.call_args.args[2], self.tts._resolve_voice('male', 'openai', 'ja'))
            self.assertEqual((await post('/aidiy_text_to_speech/synthesize', {**payload, 'provider': 'edge', 'voice': 'female'}))['voice'], 'ja-JP-NanamiNeural')
            audio = {'base64_wav16k': base64.b64encode(b'synthetic-wave').decode()}
            self.assertEqual((await post('/aidiy_speech_to_text/recognize', audio))['provider'], 'openai')
            self.assertEqual((await post('/aidiy_speech_to_text/recognize', {**audio, 'provider': 'google'}))['provider'], 'google')
            await post('/aidiy_image_generation/generate', {'prompt': 'synthetic'})
            self.assertEqual(self.image.call_args.args[0], 'openai')
            await post('/aidiy_image_generation/generate', {'prompt': 'synthetic', 'provider': 'gemini', 'model': 'explicit-image-model'})
            self.assertEqual(self.image.call_args.args[0], 'gemini');self.assertEqual(self.image.call_args.args[3], 'explicit-image-model')
            await post('/aidiy_movie_generation/generate', {'prompt': 'synthetic'})
            for key, expected in {'provider': 'gemini', 'model': 'veo-2.0-generate-001', 'aspect_ratio': '9:16', 'resolution': '720p'}.items():
                self.assertEqual(self.movie.call_args.kwargs[key], expected)
            await post('/aidiy_movie_generation/generate', {'prompt': 'synthetic', 'provider': 'freeai', 'model': 'veo-3.1-generate-preview', 'aspect_ratio': '16:9', 'resolution': '1080p'})
            for key, expected in {'provider': 'freeai', 'model': 'veo-3.1-generate-preview', 'aspect_ratio': '16:9', 'resolution': '1080p'}.items():
                self.assertEqual(self.movie.call_args.kwargs[key], expected)

    async def test_mcp_registered_tool_uses_config_while_preserving_explicit_choices(self):
        self.write({'text_to_speech': {'auto_provider': 'openai', 'auto_voice': 'male'},
                    'speech_to_text': {'auto_provider': 'openai'}, 'image_generation': {'auto_provider': 'gemini'},
                    'movie_generation': {'auto_provider': 'gemini', 'auto_aspect_ratio': '9:16'}})
        app, servers, _ = self.make_app()
        async with app.router.lifespan_context(app):
            await servers['tts'].call_tool('synthesize_speech', {'speech_text': 'synthetic', 'save_path': str(self.root / 'speech.mp3')})
            self.assertEqual(self.synth.call_args.args[0], 'openai')
            await servers['tts'].call_tool('synthesize_speech', {'speech_text': 'synthetic', 'provider': 'edge', 'voice': 'female', 'save_path': str(self.root / 'speech.mp3')})
            self.assertEqual(self.synth.call_args.args[0], 'edge')
            self.assertEqual(self.synth.call_args.args[2], 'ja-JP-NanamiNeural')
            await servers['stt'].call_tool('recognize_speech', {'base64_wav16k': base64.b64encode(b'synthetic-wave').decode()})
            self.stt._認識_openai.assert_called_once()
            await servers['image'].call_tool('generate_image', {'prompt': 'synthetic'})
            self.assertEqual(self.image.call_args.args[0], 'gemini')
            await servers['movie'].call_tool('generate_movie', {'prompt': 'synthetic', 'save_path': str(self.root / 'movie.mp4')})
            self.assertEqual(self.movie.call_args.kwargs['provider'], 'gemini')
            self.assertEqual(self.movie.call_args.kwargs['aspect_ratio'], '9:16')


class LocationTests(unittest.TestCase):
    def test_config_path_follows_copied_project_not_working_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp);module_file = root / 'backend_tools' / 'tools_proc' / 'tools_settings.py'
            module_file.parent.mkdir(parents=True)
            module_file.write_bytes(Path(tools_settings.__file__).read_bytes())
            spec = importlib.util.spec_from_file_location('isolated_tools_settings', module_file)
            module = importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
            result = module.load_tools_settings()
            self.assertEqual(result, module.DEFAULTS)
            self.assertEqual(module.CONFIG_PATH, root / '_config' / 'AiDiy_tools.json')
            self.assertTrue(module.CONFIG_PATH.is_file())

    def test_independent_processes_publish_one_complete_default_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp);module_file = root / 'backend_tools' / 'tools_proc' / 'tools_settings.py'
            module_file.parent.mkdir(parents=True)
            module_file.write_bytes(Path(tools_settings.__file__).read_bytes())
            code = "import sys,json;sys.path.insert(0,sys.argv[1]);from tools_settings import *;assert load_tools_settings()==DEFAULTS;assert json.loads(CONFIG_PATH.read_text())==DEFAULTS"
            children = [subprocess.Popen([sys.executable, '-c', code, str(module_file.parent)], stdout=subprocess.PIPE, stderr=subprocess.PIPE) for _ in range(4)]
            try:
                for child in children:
                    stdout, stderr = child.communicate(timeout=15)
                    self.assertEqual(child.returncode, 0, stderr.decode(errors='replace'))
                config = root / '_config' / 'AiDiy_tools.json'
                self.assertEqual(json.loads(config.read_text()), tools_settings.DEFAULTS)
                self.assertEqual(list(config.parent.iterdir()), [config])
            finally:
                for child in children:
                    if child.poll() is None:
                        child.kill()
                    child.communicate()


if __name__ == '__main__':
    unittest.main()
