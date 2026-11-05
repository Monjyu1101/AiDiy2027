# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
"""Diag が生成した Hermes /model 候補。通信・認証・設定への書込は行わない。"""
from __future__ import annotations

import json
from pathlib import Path
import re


CHAT_PROVIDERS = frozenset({"gemini", "freeai", "openrt", "openrt_free", "openai_chat", "claude_chat"})
_ALIASES = {
    "openai": "openai_chat",
    "anthropic": "claude_chat",
    "anthropic_chat": "claude_chat",
    "openrouter": "openrt",
    "openrt_chat": "openrt",
    "gemini_chat": "gemini",
    "freeai_chat": "freeai",
}
_MODEL_ID = re.compile(r"~?[A-Za-z0-9][A-Za-z0-9._:/@+\-]{0,199}\Z")
_MAX_CATALOG_BYTES = 4 * 1024 * 1024


def normalize_chat_provider(provider: str | None) -> str:
    slug = str(provider or "").strip().lower()
    return _ALIASES.get(slug, slug)


def read_model_labels(
    filename: Path,
    provider: str,
    *,
    include_special: bool = False,
) -> tuple[list[tuple[str, str]], str]:
    """Diag の ID・表示名・順番を保持する。件数・日付・世代では絞らない。

    Chat パネルと異なり Hermes が返せない画像・音声等は Diag の生成時に除外する。
    空/破損時に未検証の既定モデルを追加して、取得成功に見せない。
    """
    key = normalize_chat_provider(provider)
    guidance = "aidiy_diag でモデル一覧を取得・保存してください。"
    try:
        with Path(filename).open("rb") as source:
            raw = source.read(_MAX_CATALOG_BYTES + 1)
        if len(raw) > _MAX_CATALOG_BYTES:
            raise ValueError("catalog size")
        payload = json.loads(raw.decode("utf-8-sig"))
        if not isinstance(payload, dict):
            raise ValueError("catalog root")
        section = payload.get(key)
        if section is None:
            return [], f"hermes_models_info に {key} の候補がありません。{guidance}"
        if not isinstance(section, dict) or not isinstance(section.get("models"), dict):
            raise ValueError("catalog models")
        models = section["models"]
        rows = []
        excluded = 0
        for model, label in models.items():
            if (not isinstance(model, str) or not _MODEL_ID.fullmatch(model)
                    or not isinstance(label, str) or not label.strip()
                    or any(ord(c) < 32 or ord(c) == 127 for c in label)):
                raise ValueError("catalog row")
            if not include_special and model.lower() in {"auto", "same"}:
                excluded += 1
                continue
            rows.append((label, model))
        if not rows:
            if excluded:
                return [], "Hermes の対話で使える候補がありません。"
            return [], f"{key} のモデル一覧が空です。{guidance}"
        notice = ""  # CLI の auto/same は呼出側で従来どおり処理する。
        return rows, notice
    except FileNotFoundError:
        return [], f"hermes_models_info が未作成です。{guidance}"
    except (OSError, UnicodeError, ValueError, TypeError):
        return [], f"hermes_models_info を読み取れません。{guidance}"
