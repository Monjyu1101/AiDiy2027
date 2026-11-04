"""設定生成とprovider解決の回帰試験（ネットワーク/有料APIは呼ばない）。"""
import ast
import asyncio
import base64
from contextlib import asynccontextmanager, AsyncExitStack
from types import SimpleNamespace
from typing import AsyncIterator
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch, AsyncMock, Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tools_proc import tools_settings as settings
from tools_proc.text_to_speech import TextToSpeech
from tools_proc.speech_to_text import SpeechToText
from tools_proc.image_generation import ImageGeneration
from tools_proc.movie_generation import MovieGeneration


class SettingsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / "config" / "AiDiy_tools.json"

    def write(self, value):
        self.path.parent.mkdir(exist_ok=True)
        self.path.write_text(json.dumps(value), encoding="utf-8")

    def test_generate_and_concurrent_start(self):
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(lambda _: settings.load_tools_settings(self.path), range(24)))
        self.assertTrue(all(result == settings.DEFAULTS for result in results))
        self.assertEqual(json.loads(self.path.read_text()), settings.DEFAULTS)
        self.assertEqual(list(self.path.parent.glob("*.tmp")), [])

    def test_existing_and_normalization(self):
        self.write({"text_to_speech": {"auto_provider": " OPENAI "}, "speech_to_text": {"auto_provider": "openai"}})
        before = self.path.read_bytes()
        result = settings.load_tools_settings(self.path)
        self.assertEqual(result["text_to_speech"]["auto_provider"], "openai")
        self.assertEqual(result["speech_to_text"]["auto_provider"], "openai")
        self.assertEqual(self.path.read_bytes(), before)

    def test_invalid_values_and_partial_config(self):
        for value in (None, [], "", "auto", "unknown", 1):
            with self.subTest(value=value):
                self.write({"text_to_speech": {"auto_provider": value}, "speech_to_text": {"auto_provider": "openai"}})
                with self.assertLogs(settings.logger, level="WARNING"):
                    result = settings.load_tools_settings(self.path)
                self.assertEqual(result["text_to_speech"], settings.DEFAULTS["text_to_speech"])
                self.assertEqual(result["speech_to_text"]["auto_provider"], "openai")
        self.write({})
        self.assertEqual(settings.load_tools_settings(self.path), settings.DEFAULTS)

    def test_bad_json_and_shape_are_not_overwritten(self):
        self.path.parent.mkdir()
        for value in ('{broken', '[]', '{"text_to_speech":null}'):
            self.path.write_text(value)
            with self.assertLogs(settings.logger, level="WARNING"):
                self.assertEqual(settings.load_tools_settings(self.path), settings.DEFAULTS)
            self.assertEqual(self.path.read_text(), value)

    def test_write_failure_and_cleanup(self):
        with patch.object(settings.os, "link", side_effect=PermissionError), self.assertLogs(settings.logger, level="WARNING"):
            self.assertEqual(settings.load_tools_settings(self.path), settings.DEFAULTS)
        self.assertFalse(self.path.exists())
        self.assertEqual(list(self.path.parent.iterdir()), [])

    def test_canonical_filename(self):
        self.assertEqual(settings.CONFIG_PATH.name, "AiDiy_tools.json")

    def test_absolute_path_and_no_shared_mutation(self):
        self.assertTrue(settings.CONFIG_PATH.is_absolute())
        result = settings.load_tools_settings(self.path)
        result["text_to_speech"]["auto_provider"] = "openai"
        self.assertEqual(settings.DEFAULTS["text_to_speech"]["auto_provider"], "edge")

    def test_all_supported_values(self):
        for name, fields in settings.CHOICES.items():
            for field, allowed in fields.items():
                for value in allowed:
                    with self.subTest(name=name, field=field, value=value):
                        self.write({name: {field: value}})
                        self.assertEqual(settings.load_tools_settings(self.path)[name][field], value)

    def test_every_field_rejects_invalid_value(self):
        for name, fields in settings.CHOICES.items():
            for field in fields:
                for invalid in (None, "", "unknown", [], 123):
                    with self.subTest(name=name, field=field, invalid=invalid):
                        self.write({name: {field: invalid}})
                        with self.assertLogs(settings.logger, level="WARNING"):
                            result = settings.load_tools_settings(self.path)
                        self.assertEqual(result[name][field], settings.DEFAULTS[name][field])

    def test_lifespan_applies_settings_before_services_start(self):
        # 実lifespan関数のみ抽出し、全外部サービスをmock。import副作用を避ける。
        source = Path(__file__).resolve().parents[1] / "tools_main.py"
        tree = ast.parse(source.read_text(encoding="utf-8"))
        fn = next(node for node in tree.body if isinstance(node, ast.AsyncFunctionDef) and node.name == "_mcp_lifespan")
        self.write({"text_to_speech": {"auto_provider": "openai"}, "movie_generation": {"auto_aspect_ratio": "9:16"}})
        env = {"asynccontextmanager": asynccontextmanager, "AsyncIterator": AsyncIterator,
               "FastAPI": object, "AsyncExitStack": AsyncExitStack, "MCP_MAP": {},
               "load_tools_settings": lambda: settings.load_tools_settings(self.path),
               "tools_decisions": SimpleNamespace(check_startup=AsyncMock(), register_tools=Mock()),
               "decisions": object(), "mcp_dj": object(), "logger": Mock(), "tools_management": Mock()}
        for name in ("tts", "stt", "ig", "mg"):
            env[name] = SimpleNamespace()
        exec(compile(ast.Module(body=[fn], type_ignores=[]), str(source), "exec"), env)
        async def run():
            async with env["_mcp_lifespan"](None):
                self.assertEqual(env["tts"].auto_provider, "openai")
                self.assertEqual(env["mg"].auto_aspect_ratio, "9:16")
                self.assertEqual(env["ig"].auto_provider, "codex")
                self.assertEqual(env["stt"].auto_provider, "google")
        asyncio.run(run())

    def test_unknown_keys(self):
        self.write({"typo": {}, "text_to_speech": {"typo": "openai"}})
        with self.assertLogs(settings.logger, level="WARNING"):
            self.assertEqual(settings.load_tools_settings(self.path), settings.DEFAULTS)


class ProviderTests(unittest.TestCase):
    def test_tts_auto_explicit_and_fallback(self):
        tts = TextToSpeech.__new__(TextToSpeech)  # ffmpeg/辞書初期化を回避
        tts.auto_provider = "openai"
        with patch.object(tts, "normalize_for_speech", return_value=("hello", [])), patch.object(tts, "_get_api_key", return_value="mock"), patch.object(tts, "_synthesize_provider", return_value=b"ID3mock") as synth:
            _, info = tts.synthesize("hello", provider="auto")
            self.assertEqual(synth.call_args.args[0], "openai")
            self.assertEqual(info["requested_provider"], "auto")
            _, info = tts.synthesize("hello", provider="edge")
            self.assertEqual(info["used_provider"], "edge")
            synth.side_effect = [RuntimeError("mock failure"), b"ID3mock"]
            _, info = tts.synthesize("hello", provider="auto")
            self.assertEqual(info["used_provider"], "edge")

    def test_image_provider_and_explicit(self):
        image = ImageGeneration()
        image.auto_provider = "openai"
        with patch.object(image, "_generate_provider", return_value=(b"mock", {"generated_path": "mock.png"})) as generate:
            _, info = image.generate("test")
            self.assertEqual(generate.call_args.args[0], "openai")
            self.assertEqual(info["requested_provider"], "auto")
            image.generate("test", provider="gemini", model="explicit")
            self.assertEqual(generate.call_args.args[0], "gemini")
            self.assertEqual(generate.call_args.args[3], "explicit")

    def test_movie_defaults_and_explicit(self):
        movie = MovieGeneration()
        with patch.object(movie, "_generate_gemini", return_value=(b"mock", {})) as generate:
            movie.generate("test")
            self.assertEqual(generate.call_args.kwargs["provider"], "freeai")
            self.assertEqual(generate.call_args.kwargs["resolution"], None)
            movie.auto_provider = "gemini"
            movie.auto_model = "veo-2.0-generate-001"
            movie.auto_aspect_ratio = "9:16"
            movie.auto_resolution = "720p"
            movie.generate("test")
            for key, value in {"provider": "gemini", "model": "veo-2.0-generate-001", "aspect_ratio": "9:16", "resolution": "720p"}.items():
                self.assertEqual(generate.call_args.kwargs[key], value)
            movie.generate("test", provider="freeai", model="veo-3.1-generate-preview", aspect_ratio="16:9", resolution="1080p")
            for key, value in {"provider": "freeai", "model": "veo-3.1-generate-preview", "aspect_ratio": "16:9", "resolution": "1080p"}.items():
                self.assertEqual(generate.call_args.kwargs[key], value)

    def test_voice_auto_only(self):
        tts = TextToSpeech.__new__(TextToSpeech)
        tts.auto_voice = "male"
        with patch.object(tts, "normalize_for_speech", return_value=("hello", [])), patch.object(tts, "_synthesize_provider", return_value=b"ID3mock") as synth:
            tts.synthesize("hello", voice="auto")
            self.assertEqual(synth.call_args.args[2], "ja-JP-KeitaNeural")
            tts.synthesize("hello", voice="female")
            self.assertEqual(synth.call_args.args[2], "ja-JP-NanamiNeural")

    def test_stt_auto_and_explicit(self):
        stt = SpeechToText()
        audio = base64.b64encode(b"mock wav").decode()
        with patch.object(stt, "_認識_auto", return_value="google"), patch.object(stt, "_事前チェック_音声あり", return_value=True), patch.object(stt, "_認識_openai", return_value="openai"):
            self.assertEqual(stt.recognize(base64_wav16k=audio)["provider"], "google")
            stt.auto_provider = "openai"
            self.assertEqual(stt.recognize(base64_wav16k=audio)["provider"], "openai")
            self.assertEqual(stt.recognize(base64_wav16k=audio, provider="google")["provider"], "google")
            stt.auto_provider = "google"
            self.assertEqual(stt.recognize(base64_wav16k=audio, provider="openai")["provider"], "openai")


if __name__ == "__main__":
    unittest.main()
