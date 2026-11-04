# -*- coding: utf-8 -*-
"""Code/Live 専用資格情報。通常利用者 JWT や DB 利用者とは独立する。"""
from datetime import datetime, timedelta, timezone
import json
import fnmatch
import os
from pathlib import Path
import secrets
import tempfile
import threading

from jose import JWTError, jwt

AUDIENCE = "aidiy-code-live"
ISSUER = "backend_core"
TOKEN_KIND = "internal_code_live"
TOKEN_TTL = timedelta(hours=25)
SCOPES = ("models:read", "models:session", "ai:connect")


def local_now():
    """既存サーバーと同じ OS ローカル日付。期限は UTC へ変換する。"""
    return datetime.now().astimezone()


class InternalTokenAuthority:
    def __init__(self, signing_key=None, *, clock=local_now, kid=None):
        # 稼働時は CoreKeyring から保存済み鍵を渡す。未指定時は低レベル検証用の一時鍵。
        self._key = signing_key if signing_key is not None else secrets.token_urlsafe(48)
        self._clock = clock
        self._kid = kid

    def issue(self, now):
        issued = now.astimezone(timezone.utc).replace(microsecond=0)
        expires = issued + TOKEN_TTL
        token = jwt.encode({
            "iss": ISSUER, "aud": AUDIENCE, "sub": "backend_core:code_live",
            "token_kind": TOKEN_KIND, "scope": list(SCOPES),
            "iat": int(issued.timestamp()), "exp": int(expires.timestamp()),
            "jti": secrets.token_hex(16),
        }, self._key, algorithm="HS256", headers={"kid": self._kid} if self._kid else None)
        return {"access_token": token, "token_type": "bearer",
                "issued_at": issued.isoformat(), "expires_at": expires.isoformat()}

    def verify(self, token, method, path):
        claims = jwt.decode(token, self._key, algorithms=["HS256"],
                            audience=AUDIENCE, issuer=ISSUER,
                            options={"require_exp": True, "require_iat": True,
                                     "require_sub": True, "require_aud": True, "require_iss": True})
        if (claims.get("token_kind") != TOKEN_KIND
                or claims.get("sub") != "backend_core:code_live"
                or not isinstance(claims.get("scope"), list)
                or set(claims["scope"]) != set(SCOPES)
                or type(claims["exp"]) is not int or type(claims["iat"]) is not int
                or self._clock().timestamp() >= claims["exp"]
                or self._clock().timestamp() < claims["iat"]
                or claims["exp"] - claims["iat"] > TOKEN_TTL.total_seconds()
                or claims["exp"] <= claims["iat"]):
            raise JWTError("Invalid internal token claims")
        return claims


def write_token_file(project_root, payload):
    """原子的な置換。失敗時は以前の完全なファイルを維持する。"""
    root = Path(project_root)
    knowledge = root / "_AIDIY"
    directory = knowledge / "backend_core"
    target = directory / "internal_auth.json"
    if knowledge.is_symlink() or directory.is_symlink() or target.is_symlink():
        raise OSError("Symlink credential path is not permitted")
    knowledge.mkdir(exist_ok=True)
    directory.mkdir(mode=0o700, exist_ok=True)
    if os.name != "nt":
        directory.chmod(0o700)
    if target.exists() and not target.is_file():
        raise OSError("Credential path is not a file")
    fd, temporary = tempfile.mkstemp(prefix=".internal_auth.json.", suffix=".tmp", dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            # mkstemp の POSIX 0600 を維持し、トークンをログへ出さない。
            json.dump(payload, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, target)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


class DailyTokenRotator:
    def __init__(self, issue, persist, *, clock=local_now, on_error=lambda: None):
        self._issue = issue
        self._persist = persist
        self._clock = clock
        self._on_error = on_error
        self._date = None
        self._stop = threading.Event()
        self._thread = None

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
                # 例外の引数・traceback に資格情報が含まれる可能性がある。
                self._on_error()

    def start(self):
        if self._thread is not None:
            raise RuntimeError("Internal token rotator already started")
        # 初回保存失敗は起動失敗とし、古いファイルで成功を装わない。
        self.refresh()
        self._thread = threading.Thread(target=self._run, name="core-internal-auth", daemon=True)
        self._thread.start()

    def stop(self):
        self._stop.set()
        if self._thread is not None:
            self._thread.join()


def is_internal_credential_path(path):
    """汎用ファイル API へ資格情報を公開しない（別名 symlink も確認）。"""
    for candidate in (os.fspath(path), os.path.realpath(path)):
        name = candidate.replace("\\", "/").rsplit("/", 1)[-1].casefold()
        # Windows の末尾点/空白・代替データストリーム表記も同じ資格情報を指す。
        name = name.split(":", 1)[0].rstrip(" .")
        if (name in ("internal_auth.json", "internal_auth_keys.json")
                or any(fnmatch.fnmatchcase(name, pattern) for pattern in
                       (".internal_auth.json.*.tmp", ".internal_auth_keys.json.*.tmp"))):
            return True
    root = Path(__file__).resolve().parent.parent
    for service in ("backend_core", "backend_taskteam"):
        for name in ("internal_auth.json", "internal_auth_keys.json"):
            target = root / "_AIDIY" / service / name
            try:
                if os.path.samefile(path, target):
                    return True
            except OSError:
                continue
    return False
