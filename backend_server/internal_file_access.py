# -*- coding: utf-8 -*-
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
"""単独 Avatar のファイル操作を所有セッションのプロジェクトへ限定する。"""
import os
from pathlib import Path
from fastapi import HTTPException
from internal_api_auth import require_session_owner
from internal_auth import is_internal_credential_path


def resolve_session_file(manager, session_id, principal, filename):
    session = manager.get_session(session_id) if session_id else None
    if session is None:
        raise HTTPException(status_code=403, detail="所有セッションが必要です")
    require_session_owner(session, principal)
    raw_root = (getattr(session, "モデル設定", None) or {}).get("CODE_BASE_PATH")
    if not isinstance(raw_root, str) or not raw_root.strip():
        raise HTTPException(status_code=403, detail="プロジェクトが設定されていません")
    try:
        backend = Path(__file__).resolve().parent
        root_path = Path(raw_root)
        if not root_path.is_absolute():
            root_path = backend / root_path
        root = root_path.resolve(strict=True)
        if not root.is_dir() or not filename or "\0" in filename:
            raise ValueError()
        path = Path(filename)
        if not path.is_absolute():
            path = root / path
        # resolve 前にリンク要素を確認し、プロジェクト内リンクも許可しない。
        relative = path.relative_to(root)
        current = root
        for part in relative.parts:
            if part in (".", "..") or ":" in part:
                raise ValueError()
            current /= part
            if current.is_symlink() or getattr(current, "is_junction", lambda: False)():
                raise ValueError()
        resolved = path.resolve(strict=True)
        if not resolved.is_relative_to(root) or not resolved.is_file():
            raise ValueError()
        if is_internal_credential_path(resolved):
            raise ValueError()
        return os.fspath(resolved)
    except (ValueError, OSError, RuntimeError):
        raise HTTPException(status_code=403, detail="プロジェクト内の通常ファイルだけを操作できます") from None


def session_temp_directory(session, backend_dir, *, create_input=False):
    """内部セッションだけが使う project/temp。リンクを辿って作成しない。"""
    raw_root = (getattr(session, "モデル設定", None) or {}).get("CODE_BASE_PATH")
    if not isinstance(raw_root, str) or not raw_root.strip():
        raise ValueError("プロジェクトが設定されていません")
    root = Path(raw_root)
    if not root.is_absolute():
        root = Path(backend_dir) / root
    root = root.resolve(strict=True)
    if not root.is_dir():
        raise ValueError("プロジェクトが見つかりません")
    current = root
    for part in (("temp", "input") if create_input else ("temp",)):
        current /= part
        if current.is_symlink() or getattr(current, "is_junction", lambda: False)():
            raise ValueError("リンク先は操作できません")
        if create_input:
            current.mkdir(exist_ok=True)
        if current.exists() and not current.is_dir():
            raise ValueError("通常フォルダが必要です")
    return os.fspath(current)
