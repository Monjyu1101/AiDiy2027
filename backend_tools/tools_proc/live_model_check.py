# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""Diag 専用の非公開 Live 試行。MCP 登録・設定書き込み・会話文脈は持たない。"""
import asyncio
import base64
import io
import wave
import importlib
import inspect
import ipaddress
import json
import re
import sys
import time
import uuid
from pathlib import Path

from fastapi import HTTPException, Request

ROOT = Path(__file__).resolve().parents[2]
CONNECTION_TIMEOUT = 20
# 長い返答の生成・音声ターン完了まで待つ。接続・初回安定待機とは別枠。
RESPONSE_TIMEOUT = 60
SETTLE_SECONDS = 15
MAX_CONFIG = 1024 * 1024
MAX_BODY_BYTES = 20 * 1024 * 1024  # JSON transport。設定ファイル・prompt の制約とは別。
TABLE = {
    'freeai_live': ('AIコア.AIライブ_gemini', 'FREEAI', 'freeai_key_id', 'gemini_key_id'),
    'gemini_live': ('AIコア.AIライブ_gemini', 'GEMINI', 'gemini_key_id', 'freeai_key_id'),
    'openai_live': ('AIコア.AIライブ_openai', 'OPENAI', 'openai_key_id', None),
}


def read_config(root):
    with (root / '_config' / 'AiDiy_key.json').open('rb') as stream:
        data = stream.read(MAX_CONFIG + 1)
    if len(data) > MAX_CONFIG:
        raise ValueError('config size')
    value = json.loads(data.decode('utf-8-sig'))
    if not isinstance(value, dict):
        raise ValueError('config type')
    return value


def valid_string(value, limit=200):
    return isinstance(value, str) and 0 < len(value) <= limit and not value.startswith('<') and not any(ord(c) < 32 for c in value)


async def validate_request(request):
    # Host は DNS 解決せず、IP リテラルのみ。プロキシ由来の書き換えも拒否する。
    headers = request.headers
    try:
        peer = ipaddress.ip_address(request.client.host)
    except (ValueError, AttributeError):
        raise HTTPException(403, 'loopback only')
    if not peer.is_loopback or not re.fullmatch(r'(127\.0\.0\.1|\[::1\])(?::[0-9]{1,5})?', headers.get('host', '')):
        raise HTTPException(403, 'loopback only')
    if any(k == 'origin' or k == 'forwarded' or k.startswith('x-forwarded-') or k in ('x-real-ip', 'x-original-host', 'x-original-url', 'x-rewrite-url') for k in headers):
        raise HTTPException(403, 'direct requests only')
    if len(headers.getlist('host')) != 1 or len(headers.getlist('x-aidiy-diag')) != 1 or headers.get('x-aidiy-diag') != 'model-trial':
        raise HTTPException(403, 'diagnostic header required')
    if request.url.query or headers.get('content-type', '').split(';')[0].strip().lower() != 'application/json':
        raise HTTPException(400, 'valid diagnostic JSON required')
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > MAX_BODY_BYTES:
            raise HTTPException(413, 'request too large')
        body.extend(chunk)
    try:
        value = json.loads(body)
        return validate_manual(value)
    except (ValueError, UnicodeError):
        raise HTTPException(400, 'valid diagnostic JSON required')


def validate_manual(value):
    if not isinstance(value, dict):
        raise ValueError('request')
    if not value:
        return None
    if set(value) != {'ai_name', 'ai_model', 'voice', 'prompt'}:
        raise ValueError('fields')
    if not isinstance(value['ai_name'], str) or value['ai_name'] not in TABLE or not valid_string(value['ai_model']) or not valid_string(value['voice']):
        raise ValueError('model')
    prompt = value['prompt']
    if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 16000 or any(ord(c) < 32 and c not in '\n\r\t' for c in prompt):
        raise ValueError('prompt')
    return dict(value)


async def close_adapter(adapter):
    # 終了は TaskGroup/socket を回収。Gemini の HTTP client も明示的に閉じる。
    try:
        await asyncio.wait_for(adapter.終了(), 5)
    finally:
        client = getattr(adapter, 'client', None)
        aio = getattr(client, 'aio', None)
        for target, name in ((aio, 'aclose'), (client, 'close')):
            fn = getattr(target, name, None)
            if callable(fn):
                try:
                    result = fn()
                    if inspect.isawaitable(result):
                        await asyncio.wait_for(result, 2)
                except Exception:
                    pass


class DiagnosticOutput(asyncio.Queue):
    """PCM を逐次集約。キューには小さいテキスト・完了通知だけを置く。"""
    MAX_PCM = 24000 * 2 * 30  # mono PCM16、最大30秒（WAV は2MiB未満）

    def __init__(self):
        super().__init__(maxsize=32)
        self.pcm = bytearray()
        self.audio_invalid = False

    async def put(self, item):
        if isinstance(item, dict) and 'bytes_data' in item:
            data = item.get('bytes_data')
            mime = item.get('mime_type', '')
            try:
                fields = [part.strip().lower() for part in mime.split(';')]
                if fields[0] != 'audio/pcm':
                    raise ValueError()
                params = dict(part.split('=', 1) for part in fields[1:] if part)
                if any(k not in ('rate', 'channels') for k in params):
                    raise ValueError()
                if int(params.get('rate', '24000')) != 24000 or int(params.get('channels', '1')) != 1:
                    raise ValueError()
                if not isinstance(data, (bytes, bytearray)) or len(data) % 2:
                    raise ValueError()
                if len(self.pcm) + len(data) > self.MAX_PCM:
                    raise ValueError()
                if not self.audio_invalid:
                    self.pcm.extend(data)
            except (ValueError, TypeError, AttributeError):
                self.audio_invalid = True
                self.pcm.clear()
            return
        if isinstance(item, dict) and set(item) == {'text'} and isinstance(item['text'], str):
            item = {'text': item['text'][:2000]}
        await super().put(item)

    def clear_before_send(self):
        while not self.empty():
            self.get_nowait()
        self.pcm.clear()
        self.audio_invalid = False

    def audio_result(self):
        if self.audio_invalid or len(self.pcm) < 24000 * 2:
            return None
        output = io.BytesIO()
        with wave.open(output, 'wb') as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(24000)
            wav.writeframes(self.pcm)
        return {'mime': 'audio/wav', 'duration_ms': len(self.pcm) * 1000 // 48000,
                'data_base64': base64.b64encode(output.getvalue()).decode('ascii')}


class LiveModelCheck:
    def __init__(self, root=ROOT, factory=None, timeout=None, sleep=asyncio.sleep):
        self.root = Path(root)
        self.factory = factory
        self.connection_timeout = CONNECTION_TIMEOUT if timeout is None else timeout
        self.response_timeout = RESPONSE_TIMEOUT if timeout is None else timeout
        self.sleep = sleep
        self.busy = False

    async def run(self, manual=None):
        started = time.monotonic()
        provider = model = ''
        adapter = None
        def result(status, reason, reply=''):
            return dict(status=status, reply=reply[:1000], provider=provider, model=model,
                        duration_ms=round((time.monotonic()-started)*1000), reason=reason)
        if self.busy:
            return result('NG', 'busy')
        self.busy = True
        try:
            try:
                config = read_config(self.root)
            except Exception:
                return result('ERR', 'config_unavailable')
            manual = validate_manual(manual) if manual is not None else None
            selected = manual['ai_name'] if manual else config.get('LIVE_AI_NAME')
            if selected not in TABLE:
                return result('NG', 'unsupported_provider')
            provider = selected
            module, prefix, key_id, fallback = TABLE[selected]
            selected_model = manual['ai_model'] if manual else config.get('LIVE_'+prefix+'_MODEL')
            if not valid_string(selected_model):
                return result('NG', 'model_not_configured')
            model = selected_model
            key = config.get(key_id)
            if not valid_string(key, 8192) and fallback:
                key = config.get(fallback)
            if not valid_string(key, 8192):
                return result('NG', 'key_not_configured')
            voice = manual['voice'] if manual else config.get('LIVE_'+prefix+'_VOICE')
            if not valid_string(voice):
                return result('NG', 'voice_not_configured')
            backend = str(self.root / 'backend_server')
            if backend not in sys.path:
                sys.path.append(backend)
            # 初回SDK import中もToolsのpingを止めず、試行の切断誤判定を防ぐ。
            factory = self.factory or await asyncio.to_thread(lambda: getattr(importlib.import_module(module), 'LiveAI'))
            adapter = factory(セッションID='diag-'+uuid.uuid4().hex, parent_manager=None,
                              live_ai=prefix.lower(), live_model=model, live_voice=voice,
                              api_key=key, system_instruction='入力に日本語で簡潔に返答してください。' if manual else '挨拶に日本語で短く一文だけ返答してください。', diagnostic=True)
            queue = DiagnosticOutput()
            async with asyncio.timeout(self.connection_timeout):
                if not await adapter.開始(音声受信処理Ｑ=queue, テキスト受信処理Ｑ=queue):
                    return result('NG', 'connection_failed')
                while not adapter.live_session or (provider == 'openai_live' and not getattr(adapter, '設定反映済み', False)):
                    if getattr(adapter, 'エラーフラグ', False):
                        return result('NG', 'connection_failed')
                    await self.sleep(.05)
            # 設定モデル・AIモデルとも試行ごとに新規セッションを作るため、
            # 接続確立後、初回送信前に15秒待つ。同じセッションの毎送信待機ではない。
            await self.sleep(SETTLE_SECONDS)
            async with asyncio.timeout(self.response_timeout):
                # 送信前に届いた通知・出力を試行の応答として数えない。
                queue.clear_before_send()
                if not await adapter.テキスト送信(manual['prompt'] if manual else 'おはよう'):
                    return result('NG', 'send_failed')
                reply = ''
                while True:
                    item = await queue.get()
                    if isinstance(item, dict) and set(item) == {'text'} and isinstance(item['text'], str) and item['text'].strip():
                        reply = (reply + item['text'].strip())[:2000]
                        continue  # 字幕が先に届いても、音声のターン完了まで待つ。
                    if isinstance(item, dict) and 'diagnostic_turn_complete' in item:
                        if item['diagnostic_turn_complete'] is not True:
                            return result('NG', 'response_incomplete')
                        audio = queue.audio_result()
                        if not reply and not audio:
                            return result('NG', 'empty_response')
                        for name, secret in config.items():
                            if ('key' in name.lower() or 'token' in name.lower() or 'secret' in name.lower()) and isinstance(secret, str) and len(secret) >= 6:
                                reply = reply.replace(secret, '[redacted]')
                        response = result('OK', 'response_received' if reply else 'audio_response_received', reply)
                        if audio:
                            response['audio'] = audio
                        return response

        except TimeoutError:
            return result('NG', 'timeout')
        except Exception:
            # SDK の例外文字列は URL・キーを含む可能性がある。
            return result('ERR', 'live_check_failed')
        finally:
            try:
                if adapter is not None:
                    try:
                        await close_adapter(adapter)
                    except Exception:
                        pass
            finally:
                self.busy = False


def register_live_model_check(app, checker=None):
    checker = checker or LiveModelCheck()

    @app.post('/internal/live_model_check', include_in_schema=False)
    async def live_model_check(request: Request):
        async with asyncio.timeout(3):
            manual = await validate_request(request)
        task = asyncio.create_task(checker.run(manual) if manual else checker.run())
        async def disconnected():
            while True:
                message = await request.receive()
                if message['type'] == 'http.disconnect':
                    return
        watch = asyncio.create_task(disconnected())
        try:
            done, _ = await asyncio.wait((task, watch), return_when=asyncio.FIRST_COMPLETED)
            if task in done:
                return task.result()
            raise HTTPException(499, 'client disconnected')
        finally:
            for pending in (task, watch):
                if not pending.done():
                    pending.cancel()
            await asyncio.gather(task, watch, return_exceptions=True)
