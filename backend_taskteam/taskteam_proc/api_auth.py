# -*- coding: utf-8 -*-
"""通常画面は Core の現在利用者、内部処理は TaskTeam 専用tokenで認証。"""
import asyncio
import json
from pathlib import Path
import urllib.error
import urllib.request
from urllib.parse import quote

from fastapi import HTTPException, Request

from .internal_auth import TOKEN_PREFIX

PROJECT_ROOT = Path(__file__).resolve().parents[2]


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())


def _current_user(token):
    # Core と同居する配置のportのみ。要求のHost/URL/転送ヘッダーは信用しない。
    port = 8091
    config = PROJECT_ROOT / '_config/AiDiy_key.json'
    try:
        if config.is_file():
            port = json.loads(config.read_text(encoding='utf-8-sig')).get('PORT_CORE', 8091)
        if isinstance(port, bool) or not str(port).isdigit():
            raise ValueError()
        port = int(port)
        if not 1 <= port <= 65535:
            raise ValueError()
        request = urllib.request.Request(
            f'http://127.0.0.1:{port}' + quote('/core/auth/現在利用者'),
            data=b'{}', headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'},
            method='POST')
        with _OPENER.open(request, timeout=5) as response:
            data = json.loads(response.read(1024 * 1024))
        if not isinstance(data, dict):
            raise ValueError()
        user = data.get('data')
        if data.get('status') != 'OK' or not isinstance(user, dict) or not isinstance(user.get('利用者ID'), str) or not user['利用者ID']:
            raise HTTPException(401, 'ログインを確認してください。', headers={'WWW-Authenticate': 'Bearer'})
        return user
    except urllib.error.HTTPError as error:
        if error.code in (401, 403):
            raise HTTPException(401, 'ログインを確認してください。', headers={'WWW-Authenticate': 'Bearer'}) from None
        raise HTTPException(503, 'Core認証を確認できません。') from None
    except (OSError, ValueError, TypeError):
        raise HTTPException(503, 'Core認証を確認できません。') from None


async def require_auth(request: Request):
    headers = request.headers.getlist('authorization')
    parts = headers[0].split() if len(headers) == 1 else []
    if len(parts) != 2 or parts[0].lower() != 'bearer' or len(parts[1]) > 16384:
        raise HTTPException(401, 'ログインが必要です。', headers={'WWW-Authenticate': 'Bearer'})
    token = parts[1]
    if token.startswith(TOKEN_PREFIX):
        authority = getattr(request.app.state, 'internal_token_authority', None)
        try:
            if authority is None:
                raise ValueError()
            claims = authority.verify(token, request.method, request.url.path)
        except ValueError:
            raise HTTPException(401, '内部認証を確認してください。', headers={'WWW-Authenticate': 'Bearer'}) from None
        request.state.principal = {'kind': 'internal_taskteam', 'subject': claims['sub']}
        return
    user = await asyncio.to_thread(_current_user, token)
    request.state.principal = ({'kind': 'internal_core', 'subject': user['利用者ID']}
                               if user.get('認証種別') == 'internal' else {'kind': 'user', 'user': user})
    # body の任意利用者IDを認証済identityとして扱わない。所有権は既存API契約を維持。
    try:
        body = await request.json()
    except ValueError:
        return  # JSON/モデルの検証はFastAPIに任せる。
    if isinstance(body, dict):
        for key in ('利用者ID', '操作利用者ID'):
            value = body.get(key)
            if value and str(value).strip() != str(user['利用者ID']):
                raise HTTPException(403, 'ログイン利用者と操作利用者が一致しません。')

        # FastAPI がモデルへ変換する同じJSONを補完し、admin既定への偽装を防ぐ。
        body['利用者ID'] = str(user['利用者ID'])
        body['操作利用者ID'] = str(user['利用者ID'])
        body['操作利用者名'] = str(user.get('利用者名') or user['利用者ID'])
