# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
"""TTS の REST 要求と返却形式を検証する。実 API・認証は使わない。"""

import base64
import io
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
import wave

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tools_proc.text_to_speech import TextToSpeech, TextToSpeechError


class GeminiTtsMigrationTests(unittest.TestCase):
    def setUp(self):
        self.tts = TextToSpeech.__new__(TextToSpeech)
        self.tts.normalize_for_speech = Mock(side_effect=lambda text, language: (text, []))
        self.tts._get_api_key = Mock(side_effect=lambda provider: {"gemini": "test-gemini", "freeai": "test-freeai"}.get(provider))
        self.tts._wav_to_mp3 = Mock(return_value=b"ID3mock")
        self.tts._apply_atempo = Mock(return_value=b"ID3adjusted")
        self.post = Mock()
        request_patch = patch.dict(sys.modules, {"requests": SimpleNamespace(post=self.post, RequestException=OSError)})
        request_patch.start()
        self.addCleanup(request_patch.stop)
        self.raw_pcm = b"\x01\x00\x34\x12" * 4
        output = io.BytesIO()
        with wave.open(output, "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(24000)
            wav.writeframes(self.raw_pcm)
        self.wav = output.getvalue()

    def set_response(self, data, mime="audio/wav", snake_case=False):
        inline = {
            "mime_type" if snake_case else "mimeType": mime,
            "data": base64.b64encode(data).decode(),
        }
        response = {"candidates": [{"content": {"parts": [{"text": "ignored"}, {
            "inline_data" if snake_case else "inlineData": inline,
        }]}}]}
        self.post.return_value = SimpleNamespace(status_code=200, json=lambda: response)

    def test_default_sends_only_transcript_and_converts_wav_once_for_both_keys(self):
        self.set_response(self.wav)
        for provider in ("gemini", "freeai"):
            with self.subTest(provider=provider), patch.dict(
                "os.environ", {"GEMINI_BASE_URL": "https://gemini.example.test/v1beta/",
                               "FREEAI_BASE_URL": "https://freeai.example.test/v1beta/"}
            ):
                self.post.reset_mock()
                self.tts._wav_to_mp3.reset_mock()
                self.tts._apply_atempo.reset_mock()
                audio, info = self.tts.synthesize("日本語で読み上げます。", provider=provider, voice="Zephyr")
                self.assertEqual(audio, b"ID3adjusted")
                self.assertEqual((info["used_provider"], info["model"], info["ratio"]),
                                 (provider, "gemini-3.8-flash-tts", 1.1))
                self.post.assert_called_once()
                self.assertEqual(self.post.call_args.args[0],
                                 f"https://{provider}.example.test/v1beta/models/gemini-3.8-flash-tts:generateContent")
                kwargs = self.post.call_args.kwargs
                self.assertEqual(kwargs["headers"]["x-goog-api-key"], f"test-{provider}")
                self.assertEqual(kwargs["json"], {
                    "contents": [{"parts": [{"text": "日本語で読み上げます。"}]}],
                    "generationConfig": {
                        "responseModalities": ["AUDIO"],
                        "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": "Zephyr"}}},
                    },
                })
                self.tts._wav_to_mp3.assert_called_once_with(self.wav)
                self.tts._apply_atempo.assert_called_once_with(b"ID3mock", 1.1)

    def test_legacy_pcm_is_wrapped_once_and_keeps_legacy_prompt(self):
        self.set_response(self.raw_pcm, "audio/L16;rate=24000", snake_case=True)
        _, info = self.tts.synthesize("従来モデル", provider="gemini", model="gemini-2.5-flash-preview-tts", ratio=1)
        self.assertEqual(info["model"], "gemini-2.5-flash-preview-tts")
        with wave.open(io.BytesIO(self.tts._wav_to_mp3.call_args.args[0])) as wrapped:
            self.assertEqual((wrapped.getframerate(), wrapped.getsampwidth(), wrapped.getnchannels()), (24000, 2, 1))
            self.assertEqual(wrapped.readframes(wrapped.getnframes()), self.raw_pcm)
        self.assertIn("Just speak this text naturally: 従来モデル",
                      self.post.call_args.kwargs["json"]["contents"][0]["parts"][0]["text"])
        self.tts._apply_atempo.assert_not_called()

    def test_error_does_not_retry_with_different_format_or_provider(self):
        self.post.return_value = SimpleNamespace(status_code=400, json=lambda: {"error": {"message": "invalid"}},
                                                text="invalid")
        with self.assertRaisesRegex(TextToSpeechError, "freeai.*HTTP 400"):
            self.tts.synthesize("失敗", provider="freeai")
        self.post.assert_called_once()
        self.tts._wav_to_mp3.assert_not_called()

    def test_transient_failure_retries_same_request_only(self):
        response = SimpleNamespace(status_code=429, json=lambda: {"error": {"message": "quota test-freeai"}},
                                   text="quota test-freeai")
        self.post.return_value = response
        with patch("tools_proc.text_to_speech.time.sleep") as sleep:
            with self.assertRaisesRegex(TextToSpeechError, r"freeai.*HTTP 429.*\[redacted\]") as error:
                self.tts.synthesize("無料枠不足", provider="freeai")
        self.assertNotIn("test-freeai", str(error.exception))
        self.assertEqual(self.post.call_count, 3)
        self.assertTrue(all(call == self.post.call_args for call in self.post.call_args_list))
        self.assertEqual(sleep.call_count, 2)
        self.tts._wav_to_mp3.assert_not_called()

    def test_auto_key_missing_does_not_call_another_provider(self):
        self.tts.auto_provider = "freeai"
        self.tts._get_api_key.return_value = None
        self.tts._get_api_key.side_effect = None
        with self.assertRaisesRegex(TextToSpeechError, "freeai.*API キー"):
            self.tts.synthesize("鍵なし", provider="auto")
        self.tts._get_api_key.assert_called_once_with("freeai")
        self.post.assert_not_called()

    def test_invalid_wav_is_not_treated_as_pcm(self):
        self.set_response(b"invalid")
        with self.assertRaisesRegex(TextToSpeechError, "RIFF"):
            self.tts.synthesize("壊れた音声", provider="gemini")
        self.tts._wav_to_mp3.assert_not_called()
        self.set_response(b"RIFF\x04\x00\x00\x00WAVE")
        with self.assertRaisesRegex(TextToSpeechError, "壊れています"):
            self.tts.synthesize("壊れた音声", provider="gemini")
        self.tts._wav_to_mp3.assert_not_called()


if __name__ == "__main__":
    unittest.main()
