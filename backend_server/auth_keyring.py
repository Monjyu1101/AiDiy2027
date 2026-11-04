# -*- coding: utf-8 -*-
"""Core の環境固有鍵。通常ログインと内部通信の署名鍵は別に管理する。

import 時にはファイル・鍵を生成しない。Apps は verify_normal() の読取だけを使う。
"""
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import re
import secrets
import tempfile
import threading

from jose import JWTError, jwt
from internal_auth import (InternalTokenAuthority, local_now, AUDIENCE, ISSUER, TOKEN_KIND, SCOPES)

NORMAL_TTL = timedelta(minutes=600)
ACTIVE_TTL = timedelta(hours=25)
NORMAL_ISSUER = "aidiy-core"
NORMAL_AUDIENCE = "aidiy-user"
MAX_GENERATIONS = 32


class KeyringError(RuntimeError):
    """資格情報を含めない、安全な運用エラー。"""


def cycle(now):
    """OS ローカルの午前3時から翌午前3時までを1周期とする。"""
    return (now.date() if now.hour >= 3 else now.date() - timedelta(days=1)).isoformat()


def _timestamp(now):
    if now.tzinfo is None:
        raise KeyringError("Timezone-aware clock required")
    return int(now.timestamp())


def _iso(timestamp):
    return datetime.fromtimestamp(timestamp, timezone.utc).isoformat()


class CoreKeyring:
    def __init__(self, project_root=None, *, clock=local_now, key_factory=None, kid_factory=None, on_error=lambda: None):
        self.root = Path(project_root) if project_root is not None else Path(__file__).resolve().parent.parent
        self.directory = self.root / "_AIDIY/backend_core"
        self.path = self.directory / "internal_auth_keys.json"
        self.token_path = self.directory / "internal_auth.json"
        self.lock_path = self.directory / ".internal_auth_keys.lock"
        self.clock = clock
        self.key_factory = key_factory or (lambda: secrets.token_urlsafe(48))
        self.kid_factory = kid_factory or (lambda: secrets.token_hex(16))
        self.on_error = on_error
        self._cycle = None
        self._stop = threading.Event()
        self._thread = None

    def _check_paths(self):
        if any(path.is_symlink() for path in (self.root / "_AIDIY", self.directory, self.path, self.token_path, self.lock_path)):
            raise KeyringError("Symlink credential path is not permitted")

    @contextmanager
    def _locked(self):
        self._check_paths()
        (self.root / "_AIDIY").mkdir(exist_ok=True)
        self.directory.mkdir(mode=0o700, exist_ok=True)
        if os.name != "nt":
            self.directory.chmod(0o700)
        flags = os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0)
        fd = os.open(self.lock_path, flags, 0o600)
        try:
            if os.name == "nt":
                import msvcrt
                if os.fstat(fd).st_size == 0:
                    os.write(fd, b"0")
                os.lseek(fd, 0, os.SEEK_SET)
                msvcrt.locking(fd, msvcrt.LK_LOCK, 1)
            else:
                import fcntl
                fcntl.flock(fd, fcntl.LOCK_EX)
            try:
                self._check_paths()
                yield
            finally:
                if os.name == "nt":
                    os.lseek(fd, 0, os.SEEK_SET)
                    msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
                else:
                    fcntl.flock(fd, fcntl.LOCK_UN)
        finally:
            os.close(fd)

    def _atomic_write(self, target, value):
        self._check_paths()
        fd, name = tempfile.mkstemp(prefix="." + target.name + ".", suffix=".tmp", dir=self.directory)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                json.dump(value, stream, ensure_ascii=False, indent=2)
                stream.write("\n")
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(name, target)
            if os.name != "nt":
                directory_fd = os.open(self.directory, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
                try:
                    os.fsync(directory_fd)
                finally:
                    os.close(directory_fd)
        finally:
            try:
                os.unlink(name)
            except FileNotFoundError:
                pass

    @staticmethod
    def _retention(generation):
        return max(generation["internal_expires_at"], generation["normal_expires_at"])

    def _validate(self, state):
        try:
            if state["version"] != 1 or not isinstance(state["previous"], list):
                raise ValueError
            generations = [state["current"], *state["previous"]]
            if len(generations) > MAX_GENERATIONS:
                raise ValueError
            seen = set()
            for index, generation in enumerate(generations):
                kid = generation["kid"]
                if not isinstance(kid, str) or not re.fullmatch(r"[a-zA-Z0-9_-]{16,64}", kid) or kid in seen:
                    raise ValueError
                seen.add(kid)
                for name in ("normal_key", "internal_key"):
                    if not isinstance(generation[name], str) or not re.fullmatch(r"[a-zA-Z0-9_-]{43,128}", generation[name]):
                        raise ValueError
                if generation["normal_key"] == generation["internal_key"]:
                    raise ValueError
                for name in ("issued_at", "active_until", "internal_expires_at", "normal_expires_at"):
                    if type(generation[name]) is not int:
                        raise ValueError
                if (generation["active_until"] != generation["issued_at"] + int(ACTIVE_TTL.total_seconds())
                        or generation["internal_expires_at"] != generation["active_until"]
                        or not isinstance(generation["internal_token"], str)
                        or not generation["internal_token"]
                        or not isinstance(generation["rotation_cycle"], str)):
                    raise ValueError
                if index and (type(generation.get("retired_at")) is not int or generation["retired_at"] < generation["issued_at"]):
                    raise ValueError
                if (generation["normal_expires_at"] != 0
                        and not generation["issued_at"] < generation["normal_expires_at"] <= generation["active_until"] + int(NORMAL_TTL.total_seconds())):
                    raise ValueError
                datetime.strptime(generation["rotation_cycle"], "%Y-%m-%d")
                header = jwt.get_unverified_header(generation["internal_token"])
                claims = jwt.decode(generation["internal_token"], generation["internal_key"], algorithms=["HS256"],
                                    issuer=ISSUER, audience=AUDIENCE,
                                     # 保存世代は期限切れでも署名を検証してから整理する。
                                     # python-jose の require_exp は verify_exp=False を上書きする。
                                     # iat/exp の存在・値は直後の世代情報との一致で検証する。
                                     options={"verify_exp": False, "verify_iat": False,
                                             "require_sub": True, "require_aud": True, "require_iss": True})
                if (header.get("kid") != kid or claims.get("iat") != generation["issued_at"]
                        or claims.get("exp") != generation["internal_expires_at"]
                        or claims.get("token_kind") != TOKEN_KIND
                        or claims.get("sub") != "backend_core:code_live" or claims.get("scope") != list(SCOPES)):
                    raise ValueError
            return state
        except (KeyError, TypeError, ValueError, JWTError):
            raise KeyringError("Invalid private keyring") from None

    def _read(self, *, missing_ok=False):
        self._check_paths()
        try:
            # Apps の読取は原子的置換だけを利用し、ディレクトリ・鍵を作らない。
            if self.path.stat().st_size > 256 * 1024:
                raise KeyringError("Invalid private keyring")
            return self._validate(json.loads(self.path.read_text(encoding="utf-8")))
        except FileNotFoundError:
            if missing_ok:
                return None
            raise KeyringError("Core keyring is not ready") from None
        except (json.JSONDecodeError, UnicodeError):
            raise KeyringError("Invalid private keyring") from None

    def _new_generation(self, now):
        stamp = _timestamp(now)
        normal_key, internal_key = self.key_factory(), self.key_factory()
        kid = self.kid_factory()
        authority = InternalTokenAuthority(signing_key=internal_key, clock=self.clock, kid=kid)
        token = authority.issue(now)
        return {"kid": kid, "normal_key": normal_key, "internal_key": internal_key,
                "issued_at": stamp, "active_until": stamp + int(ACTIVE_TTL.total_seconds()),
                "internal_expires_at": stamp + int(ACTIVE_TTL.total_seconds()), "normal_expires_at": 0,
                "internal_token": token["access_token"], "rotation_cycle": cycle(now)}

    def _rotate(self, state, now):
        stamp = _timestamp(now)
        previous = [] if state is None else state["previous"][:]
        if state is not None:
            retired = dict(state["current"], retired_at=stamp)
            previous.append(retired)
        previous = [g for g in previous if self._retention(g) > stamp]
        result = self._validate({"version": 1, "current": self._new_generation(now), "previous": previous})
        self._atomic_write(self.path, result)  # private を先に公開。token file 失敗でも旧鍵を失わない。
        return result

    def _publish_token(self, state):
        current = state["current"]
        payload = {"access_token": current["internal_token"], "token_type": "bearer",
                   "issued_at": _iso(current["issued_at"]), "expires_at": _iso(current["internal_expires_at"])}
        self._check_paths()
        try:
            existing = json.loads(self.token_path.read_text(encoding="utf-8")) if self.token_path.stat().st_size <= 32 * 1024 else None
        except (FileNotFoundError, json.JSONDecodeError, UnicodeError):
            existing = None
        if existing != payload:
            self._atomic_write(self.token_path, payload)

    def initialize(self):
        with self._locked():
            now = self.clock()
            stamp = _timestamp(now)
            state = self._read(missing_ok=True)
            if state is not None and stamp < state["current"]["issued_at"]:
                raise KeyringError("Clock precedes current key generation")
            if state is None or stamp >= state["current"]["active_until"]:
                state = self._rotate(state, now)
            self._publish_token(state)
            # 起動時に有効な最新鍵があれば03時通過済みでも使う。
            self._cycle = cycle(now)
            return state["current"]["kid"]

    def _refresh_locked(self, now):
        stamp = _timestamp(now)
        state = self._read()
        if stamp < state["current"]["issued_at"]:
            raise KeyringError("Clock precedes current key generation")
        current_cycle = cycle(now)
        if (stamp >= state["current"]["active_until"]
                or (self._cycle is not None and current_cycle > self._cycle
                    and current_cycle > state["current"]["rotation_cycle"])):
            state = self._rotate(state, now)
        kept = [g for g in state["previous"] if self._retention(g) > stamp]
        if kept != state["previous"]:
            state["previous"] = kept
            self._atomic_write(self.path, state)
        self._publish_token(state)
        self._cycle = max(self._cycle or current_cycle, current_cycle)
        return state

    def refresh(self):
        with self._locked():
            self._refresh_locked(self.clock())

    def issue_normal(self, data, expires_delta=None):
        ttl = NORMAL_TTL if expires_delta is None else expires_delta
        if ttl < timedelta(seconds=1) or ttl > NORMAL_TTL:
            raise ValueError("Normal token lifetime must be at most 600 minutes")
        if not isinstance(data.get("sub"), str) or not data["sub"]:
            raise ValueError("Normal token subject required")
        with self._locked():
            now = self.clock()
            state = self._refresh_locked(now)
            current = state["current"]
            issued, expires = _timestamp(now), _timestamp(now) + int(ttl.total_seconds())
            claims = {"sub": data["sub"], "iss": NORMAL_ISSUER, "aud": NORMAL_AUDIENCE,
                      "token_kind": "user", "iat": issued, "exp": expires}
            token = jwt.encode(claims, current["normal_key"], algorithm="HS256", headers={"kid": current["kid"]})
            # 応答より先に最大expを保存。rotateと排他し、旧JWTの残存期限を確保する。
            if expires > current["normal_expires_at"]:
                current["normal_expires_at"] = expires
                self._atomic_write(self.path, state)
            return token

    def _generation(self, token):
        try:
            header = jwt.get_unverified_header(token)
            if header.get("alg") != "HS256" or not isinstance(header.get("kid"), str):
                raise JWTError("Invalid token header")
            state = self._read()
            for generation in (state["current"], *state["previous"]):
                if generation["kid"] == header["kid"]:
                    return generation
        except (ValueError, TypeError):
            pass
        raise JWTError("Unknown token key")

    def _validate_times(self, claims, generation, limit, recorded_exp):
        now = _timestamp(self.clock())
        issued, expires = claims.get("iat"), claims.get("exp")
        if (type(issued) is not int or type(expires) is not int or issued > now or now >= expires
                or issued < generation["issued_at"] or expires <= issued
                or expires - issued > int(limit.total_seconds()) or expires > recorded_exp
                or ("retired_at" in generation and issued > generation["retired_at"])):
            raise JWTError("Invalid token lifetime")

    def verify_normal(self, token):
        generation = self._generation(token)
        claims = jwt.decode(token, generation["normal_key"], algorithms=["HS256"],
                            issuer=NORMAL_ISSUER, audience=NORMAL_AUDIENCE,
                            options={"verify_exp": False, "require_exp": True, "require_iat": True,
                                     "require_sub": True, "require_aud": True, "require_iss": True})
        if claims.get("token_kind") != "user":
            raise JWTError("Not a normal user token")
        self._validate_times(claims, generation, NORMAL_TTL, generation["normal_expires_at"])
        return claims

    def verify(self, token, method, path):
        generation = self._generation(token)
        # 固定鍵・別backend・通常JWTの署名はこの鍵では検証できない。
        authority = InternalTokenAuthority(signing_key=generation["internal_key"], clock=self.clock)
        claims = authority.verify(token, method, path)
        self._validate_times(claims, generation, ACTIVE_TTL, generation["internal_expires_at"])
        return claims

    def _run(self):
        while not self._stop.wait(1):
            try:
                self.refresh()
            except Exception:
                self.on_error()

    def start(self):
        if self._thread is not None:
            raise KeyringError("Keyring watcher already started")
        self.initialize()
        self._thread = threading.Thread(target=self._run, name="core-auth-keyring", daemon=True)
        self._thread.start()

    def stop(self):
        self._stop.set()
        if self._thread is not None:
            self._thread.join()
