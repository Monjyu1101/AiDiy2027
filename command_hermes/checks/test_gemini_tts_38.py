"""Offline Gemini 3.8 REST/WAV regressions. No credentials or network calls."""
import ast
import base64
import io
import json
import tempfile
import types
import unittest
import wave
from pathlib import Path
from unittest.mock import patch, Mock
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]

class GeminiTTS38(unittest.TestCase):
    def setUp(self):
        source = ast.parse((ROOT / 'tools/tts_tool.py').read_text(encoding='utf-8'))
        funcs = [n for n in source.body if isinstance(n, ast.FunctionDef) and n.name == '_generate_gemini_tts']
        self.ns = dict(Dict=dict, Any=object, base64=base64, json=json, urlparse=urlparse,
                       DEFAULT_GEMINI_TTS_MODEL='gemini-3.8-flash-tts', DEFAULT_GEMINI_TTS_VOICE='Kore',
                       DEFAULT_GEMINI_TTS_BASE_URL='https://generativelanguage.googleapis.com/v1beta',
                       _resolve_provider_key=lambda *a:'mock-only', get_env_value=lambda *a:None,
                       _read_gemini_persona_prompt=lambda config: config.get('persona',''),
                       _gemini_audio_tags_enabled=Mock(return_value=False),
                       _compose_gemini_tts_prompt=lambda text,*a,**kw:'legacy:'+text,
                       _resolve_max_text_length=lambda *a:32000,
                       _wrap_pcm_as_wav=Mock(return_value=b'legacy-wav'))
        exec(compile(ast.Module(body=funcs,type_ignores=[]), '<isolated-tts>', 'exec'),self.ns)
        self.response = Mock(status_code=200)
        self.post = Mock(return_value=self.response)
        self.wav = io.BytesIO()
        with wave.open(self.wav,'wb') as w:
            w.setnchannels(1);w.setsampwidth(2);w.setframerate(24000);w.writeframes(b'\0\1'*16)
        self.audio = self.wav.getvalue()
        self.ns['_read_tts_response_json'] = lambda *a,**kw: {'candidates':[{'content':{'parts':[{'inlineData':{'data':base64.b64encode(self.audio).decode(),'mimeType':'audio/wav'}}]}}]}

    def run_tts(self,config=None):
        config = config or {}
        with tempfile.TemporaryDirectory() as directory, patch.dict('sys.modules', {'requests':types.SimpleNamespace(post=self.post)}):
            output = Path(directory)/'result.wav'
            self.ns['_generate_gemini_tts']('  本文だけ\n',str(output),{'gemini':config})
            return output.read_bytes()

    def test_shipped_defaults_are_38(self):
        source = ast.parse((ROOT/'tools/tts_tool.py').read_text(encoding='utf-8'))
        default = next(n.value.value for n in source.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='DEFAULT_GEMINI_TTS_MODEL' for t in n.targets))
        self.assertEqual(default,'gemini-3.8-flash-tts')
        config = (ROOT/'hermes_cli/config_defaults.py').read_text(encoding='utf-8')
        self.assertIn('"model": "gemini-3.8-flash-tts"',config)
        self.assertNotIn('gemini-2.5-flash-preview-tts',config)

    def test_default_transcript_style_and_wav_pass_through(self):
        self.assertEqual(self.run_tts({'persona':'Calm voice'}),self.audio)
        args,kw=self.post.call_args
        self.assertIn('/gemini-3.8-flash-tts:generateContent',args[0])
        self.assertEqual(kw['json']['contents'][0]['parts'],[{'text':'  本文だけ\n','speechMetadata':{'style':'Calm voice'}}])
        self.assertEqual(kw['json']['generationConfig']['responseModalities'],['AUDIO'])
        self.ns['_wrap_pcm_as_wav'].assert_not_called()
        self.ns['_gemini_audio_tags_enabled'].assert_not_called()

    def test_explicit_flash_lite_uses_the_same_38_protocol(self):
        self.assertEqual(self.run_tts({'model':'gemini-3.8-flash-lite-tts','persona':'Calm'}),self.audio)
        args, kw = self.post.call_args
        self.assertIn('/gemini-3.8-flash-lite-tts:',args[0])
        self.assertEqual(kw['json']['contents'][0]['parts'],[{'text':'  本文だけ\n','speechMetadata':{'style':'Calm'}}])

    def test_persisted_old_default_resolved_without_config_write(self):
        config={'model':'gemini-2.5-flash-preview-tts'}
        self.run_tts(config)
        self.assertIn('/gemini-3.8-flash-tts:',self.post.call_args.args[0])
        self.assertEqual(config,{'model':'gemini-2.5-flash-preview-tts'})

    def test_explicit_other_model_preserved_with_pcm(self):
        self.audio=b'\0\1'*16
        self.assertEqual(self.run_tts({'model':'gemini-2.5-pro-preview-tts'}),b'legacy-wav')
        self.assertIn('/gemini-2.5-pro-preview-tts:',self.post.call_args.args[0])
        self.ns['_wrap_pcm_as_wav'].assert_called_once_with(self.audio)

    def test_38_nonwav_rejected_without_retry(self):
        self.audio=b'\0\1'*16
        with self.assertRaisesRegex(RuntimeError,'not a WAV'):self.run_tts()
        self.post.assert_called_once()

    def test_truncated_wav_rejected(self):
        self.audio=self.audio[:-2]
        with self.assertRaisesRegex(RuntimeError,'truncated'):self.run_tts()

    def test_http_failure_no_model_fallback(self):
        self.response.status_code=404
        self.ns['_read_tts_response_bytes']=lambda *a,**kw:b'{"error":{"message":"model unavailable"}}'
        with self.assertRaisesRegex(RuntimeError,'model unavailable'):self.run_tts()
        self.post.assert_called_once()

if __name__=='__main__':unittest.main()
