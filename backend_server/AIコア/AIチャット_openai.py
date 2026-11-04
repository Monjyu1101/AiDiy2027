#!/usr/bin/env python
# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""OpenAI API / ChatGPT OAuth の両方を扱うチャットプロバイダー。

``openai_chat`` は ``AiDiy_key.json`` の OpenAI API key を使う。
``openai_oauth`` は ``command_hermes`` の ``openai-codex`` 認証ストアと
Codex Responses API transport を共用する。
"""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path
from threading import Lock
from typing import Dict, Optional

import openai

from log_config import get_logger
from AIコア.AIチャット_openrt import ChatAI as OpenRouterChatAI

logger = get_logger(__name__)

_PROJECT_ROOT = Path(__file__).resolve().parents[2]
_HERMES_ROOT = _PROJECT_ROOT / "command_hermes"
_HERMES_BASE = _HERMES_ROOT / "base"
_MODEL_CACHE_SECONDS = 60.0
_model_cache: tuple[float, Dict[str, str]] = (0.0, {})
_model_cache_lock = Lock()

_FALLBACK_MODELS = (
    "gpt-6-astra",
    "gpt-6.1-sol",
    "gpt-6.1-terra",
    "gpt-6-luna",
)


class _OpenAICompletionsProxy:
    """OpenAI現行モデルで非対応の temperature を送らない。"""

    def __init__(self, completions):
        self._completions = completions

    def create(self, **kwargs):
        request = dict(kwargs)
        request.pop("temperature", None)
        return self._completions.create(**request)


class _OpenAIChatProxy:
    def __init__(self, chat):
        self.completions = _OpenAICompletionsProxy(chat.completions)


class _OpenAIClientProxy:
    """既存の Chat Completions 共通処理に適合させる軽量 proxy。"""

    def __init__(self, client):
        self._client = client
        self.chat = _OpenAIChatProxy(client.chat)

    def __getattr__(self, name):
        return getattr(self._client, name)

    def close(self):
        return self._client.close()


def _prepare_hermes_imports() -> None:
    """command_hermes の upstream 互換レイアウトを有効にする。"""
    if not _HERMES_ROOT.is_dir():
        raise RuntimeError(f"command_hermes が見つかりません: {_HERMES_ROOT}")

    for module_dir in (_HERMES_BASE, _HERMES_ROOT):
        module_dir_str = str(module_dir)
        if module_dir_str not in sys.path:
            sys.path.insert(0, module_dir_str)

    if not os.environ.get("HERMES_HOME", "").strip():
        os.environ["HERMES_HOME"] = str(Path.home() / ".hermes")

    # AiDiy 版 Hermes は upstream の agent/ を command_hermes/core/ に配置している。
    if "agent" not in sys.modules:
        import core as agent_package

        sys.modules["agent"] = agent_package


def _oauth_access_token(*, refresh_if_expiring: bool) -> Optional[str]:
    _prepare_hermes_imports()
    from hermes_cli.auth import resolve_codex_runtime_credentials

    credentials = resolve_codex_runtime_credentials(
        refresh_if_expiring=refresh_if_expiring,
    ) or {}
    token = credentials.get("api_key")
    return str(token).strip() if token else None


def get_openai_oauth_models(*, refresh: bool = False) -> Dict[str, str]:
    """ChatGPT アカウントで利用可能な Codex モデル一覧を返す。"""
    global _model_cache

    with _model_cache_lock:
        cached_at, cached_models = _model_cache
        cache_is_alive = time.monotonic() - cached_at < _MODEL_CACHE_SECONDS
        if not refresh and cached_models and cache_is_alive:
            return dict(cached_models)

    model_ids = []
    try:
        _prepare_hermes_imports()
        from hermes_cli.codex_models import get_codex_model_ids

        try:
            token = _oauth_access_token(refresh_if_expiring=False)
        except Exception:
            token = None
        model_ids = [
            str(model).strip()
            for model in get_codex_model_ids(token)
            if str(model).strip()
        ]
    except Exception as e:
        logger.warning(f"OpenAI OAuth モデル一覧取得エラー: {e}")

    if not model_ids:
        model_ids = list(_FALLBACK_MODELS)

    models = {
        model_id: f"yyyy/mm/dd - {model_id}"
        for model_id in dict.fromkeys(model_ids)
    }
    with _model_cache_lock:
        _model_cache = (time.monotonic(), models)
    return dict(models)


def _friendly_auth_error(error: Exception) -> str:
    message = str(error).strip()
    lowered = message.lower()
    if any(token in lowered for token in ("rate limit", "quota", "429", "exhausted")):
        return f"OpenAI OAuth の利用上限に達しています。{message}"
    if any(token in lowered for token in ("credential", "access_token", "refresh_token", "auth")):
        return (
            "OpenAI OAuth 認証が必要です。"
            "aidiy_hermes を起動し、openai_oauth を選択すると OAuth 認証できます。"
        )
    return f"OpenAI OAuth 初期化エラー: {message or type(error).__name__}"


class ChatAI(OpenRouterChatAI):
    """OpenAI API key / Hermes OAuth transport を切り替える ChatAI。"""

    def __init__(
        self,
        親=None,
        セッションID: str = "",
        チャンネル: int = 0,
        絶対パス: str = None,
        AI_NAME: str = "openai_chat",
        AI_MODEL: str = "gpt-6.1-sol",
        api_key: str = None,
        system_instruction: str = None,
        実行オプション=None,
    ):
        self.oauth_mode = AI_NAME == "openai_oauth"
        inherited_api_key = "oauth-managed-by-hermes" if self.oauth_mode else api_key
        super().__init__(
            親=親,
            セッションID=セッションID,
            チャンネル=チャンネル,
            絶対パス=絶対パス,
            AI_NAME=AI_NAME,
            AI_MODEL=AI_MODEL or "gpt-6.1-sol",
            api_key=inherited_api_key,
            system_instruction=system_instruction,
            実行オプション=実行オプション,
        )
        if self.oauth_mode:
            self.api_key = None
        self.last_error = ""

    def _メッセージ履歴構築(self, システムプロンプト: str = None) -> list:
        """OAuth時は Hermes adapter 向けに system content を文字列で渡す。"""
        messages = super()._メッセージ履歴構築(システムプロンプト=システムプロンプト)
        if self.oauth_mode and messages and messages[0].get("role") == "system":
            content = messages[0].get("content")
            if isinstance(content, list):
                text_parts = [
                    str(part.get("text") or "")
                    for part in content
                    if isinstance(part, dict) and part.get("type") == "text"
                ]
                messages[0]["content"] = "\n".join(part for part in text_parts if part)
        return messages

    async def 開始(self):
        """AI_NAME に応じて OpenAI API または OAuth transport を開始する。"""
        if self.oauth_mode:
            return await self._OAuth開始()
        return await self._API開始()

    async def _API開始(self):
        self.is_alive = False
        self.last_error = ""
        try:
            if not self.api_key or self.api_key.startswith("<"):
                raise RuntimeError("OpenAI API key is not configured")

            organization = None
            conf = getattr(self.親, "conf", None)
            if conf and hasattr(conf, "json"):
                organization = str(conf.json.get("openai_organization", "") or "").strip()
                if not organization or organization.startswith("<"):
                    organization = None

            client = openai.OpenAI(
                api_key=self.api_key,
                organization=organization,
            )
            self.client = _OpenAIClientProxy(client)
            self.is_alive = True
            return True
        except Exception as e:
            self.client = None
            self.last_error = f"OpenAI API 初期化エラー: {e}"
            logger.error(f"ChatAI(OpenAI API) 開始エラー: {e}")
            return False

    async def _OAuth開始(self):
        self.is_alive = False
        self.last_error = ""
        try:
            if not _oauth_access_token(refresh_if_expiring=True):
                raise RuntimeError("Codex OAuth credentials are not available")

            _prepare_hermes_imports()
            from agent.auxiliary_client import resolve_provider_client

            client, resolved_model = resolve_provider_client(
                provider="openai-codex",
                model=self.chat_model or "gpt-6.1-sol",
                api_mode="codex_responses",
            )
            if client is None:
                raise RuntimeError("Codex OAuth client could not be created")

            self.client = client
            if resolved_model:
                self.chat_model = resolved_model
            self.is_alive = True
            return True
        except Exception as e:
            self.client = None
            self.last_error = _friendly_auth_error(e)
            logger.error(f"ChatAI(OpenAI OAuth) 開始エラー: {e}")
            return False

    async def 終了(self):
        """使用中の OpenAI client の HTTP transport を閉じる。"""
        self.is_alive = False
        client = self.client
        self.client = None
        close = getattr(client, "close", None)
        if callable(close):
            try:
                close()
            except Exception as e:
                logger.debug(f"ChatAI(OpenAI) 終了処理エラー: {e}")
        return True
