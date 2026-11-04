# -*- coding: utf-8 -*-
"""TaskTeam 専用の内部資格情報。Core の利用者/内部 JWT とは共有しない。"""
import base64
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import tempfile
import threading
from contextlib import contextmanager

TOKEN_TTL = timedelta(hours=25)
TOKEN_PREFIX = 'tt1.'


def internal_post_endpoints(app):
    """include_router の内部表現に依存せず、公開登録済みの POST だけを許可する。"""
    return {
        ('POST', path)
        for path, operations in app.openapi().get('paths', {}).items()
        if 'post' in operations
        and (path.startswith(('/task/', '/team/')) or path == '/task_check_okng')
    }


def local_now():
    return datetime.now().astimezone()


def _encode(value):
    return base64.urlsafe_b64encode(value).rstrip(b'=').decode('ascii')


class InternalTokenAuthority:
    """サービス専用鍵。永続化は PersistentTokenRotator が管理する。"""
    def __init__(self, *, signing_key=None, clock=local_now, endpoints=()):
        self._key = signing_key if signing_key is not None else secrets.token_bytes(48)
        self._previous = ()
        self._lock = threading.RLock()
        self._clock = clock
        self._endpoints = frozenset(endpoints)

    def issue(self, now):
        issued = now.astimezone(timezone.utc).replace(microsecond=0)
        expires = issued + TOKEN_TTL
        claims = {'iss': 'backend_taskteam', 'aud': 'aidiy-taskteam',
                  'sub': 'backend_taskteam:worker', 'token_kind': 'internal_taskteam',
                  'scope': ['taskteam:operate'], 'iat': int(issued.timestamp()),
                  'exp': int(expires.timestamp()), 'jti': secrets.token_hex(16)}
        content = TOKEN_PREFIX + _encode(json.dumps(claims, separators=(',', ':')).encode())
        token = content + '.' + _encode(hmac.digest(self._key, content.encode(), hashlib.sha256))
        return {'access_token': token, 'token_type': 'bearer',
                'issued_at': issued.isoformat(), 'expires_at': expires.isoformat()}

    def verify(self, token, method, path):
        try:
            if not token.startswith(TOKEN_PREFIX):
                raise ValueError()
            content, signature = token.rsplit('.', 1)
            with self._lock:
                keys = (self._key,) + tuple(key for key, expiry in self._previous
                                            if self._clock().timestamp() < expiry)
            matched = False
            for key in keys:
                expected = _encode(hmac.digest(key, content.encode(), hashlib.sha256))
                matched |= hmac.compare_digest(expected, signature)
            if not matched:
                raise ValueError()
            data = content[len(TOKEN_PREFIX):]
            claims = json.loads(base64.urlsafe_b64decode(data + '=' * (-len(data) % 4)))
            now = self._clock().timestamp()
            if (claims.get('iss') != 'backend_taskteam' or claims.get('aud') != 'aidiy-taskteam'
                    or claims.get('sub') != 'backend_taskteam:worker'
                    or claims.get('token_kind') != 'internal_taskteam'
                    or claims.get('scope') != ['taskteam:operate']
                    or type(claims.get('iat')) is not int or type(claims.get('exp')) is not int
                    or not claims['iat'] <= now < claims['exp']
                    or not 0 < claims['exp'] - claims['iat'] <= TOKEN_TTL.total_seconds()):
                raise ValueError()
            return claims
        except (ValueError, TypeError, KeyError, UnicodeError):
            raise ValueError('Invalid TaskTeam internal credential') from None


def _write_file(project_root, payload, filename):
    knowledge = Path(project_root) / '_AIDIY'
    directory = knowledge / 'backend_taskteam'
    target = directory / filename
    if knowledge.is_symlink() or directory.is_symlink() or target.is_symlink():
        raise OSError('Symlink credential path is not permitted')
    knowledge.mkdir(exist_ok=True)
    directory.mkdir(mode=0o700, exist_ok=True)
    if os.name != 'nt':
        directory.chmod(0o700)
    if target.exists() and not target.is_file():
        raise OSError('Credential path is not a file')
    fd, temporary = tempfile.mkstemp(prefix='.' + filename + '.', suffix='.tmp', dir=directory)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            json.dump(payload, stream, ensure_ascii=False, indent=2)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, target)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


def write_token_file(project_root, payload):
    _write_file(project_root, payload, 'internal_auth.json')


def write_keyring_file(project_root, payload):
    _write_file(project_root, payload, 'internal_auth_keys.json')


@contextmanager
def _keyring_lock(root):
    directory = Path(root) / '_AIDIY/backend_taskteam'
    if directory.parent.is_symlink() or directory.is_symlink():
        raise OSError('Symlink credential path is not permitted')
    directory.parent.mkdir(exist_ok=True)
    directory.mkdir(mode=0o700, exist_ok=True)
    path = directory / '.internal_auth_keys.lock'
    if path.is_symlink():
        raise OSError('Symlink lock path is not permitted')
    fd = os.open(path, os.O_CREAT | os.O_RDWR, 0o600)
    with os.fdopen(fd, 'r+b') as stream:
        if os.name == 'nt':
            import msvcrt
            if os.fstat(stream.fileno()).st_size == 0:
                stream.write(b'0')
                stream.flush()
            stream.seek(0)
            msvcrt.locking(stream.fileno(), msvcrt.LK_LOCK, 1)
        else:
            import fcntl
            fcntl.flock(stream.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            if os.name == 'nt':
                stream.seek(0)
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(stream.fileno(), fcntl.LOCK_UN)


def _cycle(now):
    boundary = now.replace(hour=3, minute=0, second=0, microsecond=0)
    return boundary if now >= boundary else boundary - timedelta(days=1)


class DailyTokenRotator:
    def __init__(self, issue, persist, *, clock=local_now, on_error=lambda: None):
        self._issue, self._persist, self._clock = issue, persist, clock
        self._on_error, self._date = on_error, None
        self._stop, self._thread = threading.Event(), None

    def refresh(self):
        now = self._clock()
        if now.date() == self._date:
            return False
        self._persist(self._issue(now))
        self._date = now.date()
        return True

    def _run(self):
        while not self._stop.wait(1):
            try:
                self.refresh()
            except Exception:
                self._on_error()

    def start(self):
        if self._thread is not None:
            raise RuntimeError('Internal token rotator already started')
        self.refresh()
        self._thread = threading.Thread(target=self._run, name='taskteam-internal-auth', daemon=True)
        self._thread.start()

    def stop(self):
        self._stop.set()
        if self._thread is not None:
            self._thread.join()


class PersistentTokenRotator(DailyTokenRotator):
    """有効な起動時tokenは再利用。稼働中03時/期限切れだけ新しい鍵を発行する。"""
    def __init__(self, authority, project_root, *, clock=local_now, on_error=lambda: None):
        super().__init__(None, None, clock=clock, on_error=on_error)
        self._authority, self._root = authority, Path(project_root)
        self._watermark = None

    def _load(self):
        path = self._root / '_AIDIY/backend_taskteam/internal_auth_keys.json'
        if path.is_symlink():
            raise OSError('Symlink credential path is not permitted')
        try:
            with path.open(encoding='utf-8') as stream:
                ring = json.loads(stream.read(1024 * 1024))
        except FileNotFoundError:
            return None
        try:
            if ring['version'] != 1 or not isinstance(ring['previous'], list):
                raise ValueError()
            for generation in [ring['current'], *ring['previous']]:
                key = base64.b64decode(generation['key'], validate=True)
                if len(key) != 48 or not isinstance(generation['kid'], str):
                    raise ValueError()
                if (type(generation['issued_at']) is not int or type(generation['expires_at']) is not int
                        or generation['expires_at'] - generation['issued_at'] != int(TOKEN_TTL.total_seconds())):
                    raise ValueError()
            current = ring['current']
            payload = current['token_payload']
            # 永続正本に破損/鍵不一致があれば黙って作り直さず起動を止める。
            checker = InternalTokenAuthority(signing_key=base64.b64decode(current['key']),
                clock=lambda: datetime.fromtimestamp(current['issued_at'], timezone.utc),
                endpoints=[('POST', '/task/_fixture_verify')])
            claims = checker.verify(payload['access_token'], 'POST', '/task/_fixture_verify')
            if (claims['iat'] != current['issued_at'] or claims['exp'] != current['expires_at']
                    or payload['token_type'] != 'bearer'
                    or datetime.fromisoformat(payload['expires_at']).timestamp() != current['expires_at']
                    or datetime.fromisoformat(payload['issued_at']).timestamp() != current['issued_at']):
                raise ValueError()
            return ring
        except (ValueError, KeyError, TypeError, AttributeError):
            raise ValueError('Invalid TaskTeam private keyring') from None

    def _install(self, ring):
        current = ring['current']
        with self._authority._lock:
            self._authority._key = base64.b64decode(current['key'])
            self._authority._previous = tuple((base64.b64decode(item['key']), item['expires_at'])
                                              for item in ring['previous'])

    def refresh(self):
        now = self._clock()
        stamp = int(now.timestamp())
        boundary = _cycle(now)
        cycle = boundary.date()  # UTC offset変更でも同じローカル日付cycleを二重実行しない。
        with _keyring_lock(self._root):
            ring = self._load()
            valid = ring is not None and ring['current']['issued_at'] <= stamp < ring['current']['expires_at']
            # 起動時は03時を過ぎても有効な正本をそのまま使う。
            scheduled = (self._watermark is not None and cycle > self._watermark
                         and ring is not None and ring['current']['issued_at'] < boundary.timestamp())
            rotated = not valid or scheduled
            if rotated:
                previous = [] if ring is None else [ring['current'], *ring['previous']]
                previous = [{k: item[k] for k in ('kid', 'key', 'issued_at', 'expires_at')}
                            for item in previous if item['expires_at'] > stamp]
                key = secrets.token_bytes(48)
                issuer = InternalTokenAuthority(signing_key=key, clock=self._clock)
                payload = issuer.issue(now)
                ring = {'version': 1, 'current': {
                    'kid': secrets.token_hex(16), 'key': base64.b64encode(key).decode('ascii'),
                    'issued_at': stamp, 'expires_at': stamp + int(TOKEN_TTL.total_seconds()),
                    'token_payload': payload}, 'previous': previous}
                # 正本だけを先にcommit。公開JSONの失敗でも次回同じtokenを再公開できる。
                write_keyring_file(self._root, ring)
            self._install(ring)
            token_path = self._root / '_AIDIY/backend_taskteam/internal_auth.json'
            if token_path.is_symlink():
                raise OSError('Symlink credential path is not permitted')
            try:
                current_payload = json.loads(token_path.read_text(encoding='utf-8'))
            except (OSError, ValueError):
                current_payload = None
            if current_payload != ring['current']['token_payload']:
                write_token_file(self._root, ring['current']['token_payload'])
            self._watermark = max(cycle, self._watermark or cycle)
            return rotated
