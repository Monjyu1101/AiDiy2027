# -*- coding: utf-8 -*-
"""Code/Live 連携 API だけの認証境界。通常認証に内部権限を追加しない。"""
from dataclasses import dataclass
from fastapi import HTTPException
from jose import JWTError
from auth_keyring import KeyringError


@dataclass(frozen=True)
class Principal:
    kind: str
    subject: str

    @property
    def owner(self):
        return (self.kind, self.subject)


def _normal_user(token):
    # 接続時だけ DB に触れ、テスト時はこの resolver を差し替える。
    import database
    import deps
    db = database.SessionLocal()
    try:
        user = deps.get_現在利用者(token=token, db=db)
        return str(user.利用者ID)
    finally:
        db.close()


def authenticate(connection, method, path, *, user_resolver=None):
    """WebSocket では accept 前に呼び、秘密を URL / エラーへ含めない。"""
    authorization = connection.headers.get("authorization")
    protocols = [p.strip() for p in connection.headers.get("sec-websocket-protocol", "").split(",") if p.strip()]
    protocol_tokens = [p[len("bearer."):] for p in protocols if p.startswith("bearer.")]
    protocol = None
    if method == "WEBSOCKET" and protocol_tokens:
        if authorization or len(protocol_tokens) != 1 or "aidiy-auth" not in protocols:
            raise HTTPException(status_code=401, detail="Invalid authentication")
        token = protocol_tokens[0]
        protocol = "aidiy-auth"
    else:
        parts = (authorization or "").split()
        if len(parts) != 2 or parts[0].lower() != "bearer":
            raise HTTPException(status_code=401, detail="Authentication required")
        token = parts[1]
    if not token:
        raise HTTPException(status_code=401, detail="Authentication required")
    authority = getattr(connection.app.state, "internal_token_authority", None)
    if authority is not None:
        try:
            claims = authority.verify(token, method, path)
            return Principal("internal", claims["sub"]), protocol
        except (JWTError, ValueError, TypeError, KeyError):
            pass
        except KeyringError:
            raise HTTPException(status_code=503, detail="Authentication service is not ready") from None
    try:
        subject = (user_resolver or _normal_user)(token)
    except HTTPException as error:
        if error.status_code == 503:
            raise
        raise HTTPException(status_code=401, detail="Invalid authentication") from None
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid authentication") from None
    if not subject:
        raise HTTPException(status_code=401, detail="Invalid authentication")
    return Principal("user", subject), protocol


def require_session_owner(session, principal):
    if session is not None and getattr(session, "_auth_owner", None) != principal.owner:
        raise HTTPException(status_code=403, detail="Session is not owned by this principal")


def require_session_settings(principal, request):
    # 認証種別では操作権限を分けない。セッション所有者の照合は呼出元で維持する。
    return


def require_manager_owner(manager, session_id, principal):
    if not session_id:
        return
    require_session_owner(manager.get_session(session_id), principal)
    owner = getattr(manager, '_auth_owners', {}).get(session_id)
    if owner is not None and owner != principal.owner:
        raise HTTPException(status_code=403, detail="Session is not owned by this principal")


def bind_session_owner(manager, session_id, principal):
    session = manager.get_session(session_id)
    if session is not None:
        session._auth_owner = principal.owner
        if not hasattr(manager, '_auth_owners'):
            manager._auth_owners = {}
        manager._auth_owners[session_id] = principal.owner
