# -*- coding: utf-8 -*-
"""Tools から同じ配置の TaskTeam へだけ送る内部資格情報。"""
import ipaddress
import json
from pathlib import Path
from urllib.parse import unquote, urlsplit, urlunsplit

import requests

# tools_proc → backend_tools → repository root
TOKEN_FILE = Path(__file__).resolve().parents[2] / '_AIDIY/backend_taskteam/internal_auth.json'


def _local_url(url):
    """資格情報を外部ホスト・リダイレクト・環境 proxy へ渡さない。"""
    try:
        parsed = urlsplit(url)
        host = parsed.hostname
        if (parsed.scheme not in ('http', 'https') or parsed.username is not None
                or parsed.password is not None or parsed.query or parsed.fragment):
            raise ValueError
        if host == 'localhost':
            host = '127.0.0.1'  # DNS 設定に依存させない
        address = ipaddress.ip_address(host)
        if not address.is_loopback:
            raise ValueError
        decoded_path = unquote(parsed.path)
        if ('\\' in decoded_path or any(part in ('.', '..') for part in decoded_path.split('/'))
                or any(ord(c) < 32 for c in url)):
            raise ValueError
        port = parsed.port
        if not port or not (parsed.path.startswith('/task/') or parsed.path.startswith('/team/')):
            raise ValueError
        netloc = f'[{address}]:{port}' if address.version == 6 else f'{address}:{port}'
        return urlunsplit((parsed.scheme, netloc, parsed.path, '', ''))
    except (ValueError, TypeError):
        raise requests.RequestException('TaskTeam 内部接続先は loopback の task/team API に限定されます。') from None


def _read_token():
    try:
        if TOKEN_FILE.is_symlink() or TOKEN_FILE.parent.is_symlink() or TOKEN_FILE.parent.parent.is_symlink():
            raise ValueError
        with TOKEN_FILE.open('r', encoding='utf-8') as stream:
            value = json.loads(stream.read(65537))
        token = value.get('access_token')
        if not isinstance(token, str) or not token or len(token) > 16384 or any(c.isspace() for c in token):
            raise ValueError
        return token
    except (OSError, ValueError, AttributeError):
        raise requests.RequestException('TaskTeam 内部認証ファイルが利用できません。TaskTeam の起動を確認してください。') from None


def post_taskteam(url, payload, timeout):
    """日次更新を毎回反映し、再起動による 401 のみ一度再読込する。"""
    url = _local_url(url)
    with requests.Session() as session:
        session.trust_env = False
        for attempt in range(2):
            token = _read_token()
            try:
                response = session.post(url, json=payload, timeout=timeout,
                                        headers={'Authorization': f'Bearer {token}'},
                                        allow_redirects=False)
                if response.status_code == 401 and attempt == 0:
                    response.close()
                    continue
                if 300 <= response.status_code < 400:
                    raise requests.RequestException('TaskTeam redirect refused')
                response.raise_for_status()
                return response
            except requests.RequestException:
                # request/header/応答本文を例外文字列経由で呼出元へ返さない。
                raise requests.RequestException('TaskTeam への接続または内部認証に失敗しました。') from None
