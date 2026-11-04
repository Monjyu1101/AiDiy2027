# -*- coding: utf-8 -*-
#
# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""Code / Discord のモデル候補を aidiy_diag の合成ファイルだけから読む。"""
import json
from pathlib import Path
import re
import sys


# 実行時にHermesへ渡すprovider名と、合成ファイルのキーの対応。
PROVIDERS = {
    "freeai": ("chat", "freeai_chat", "FreeAI"),
    "gemini": ("chat", "gemini_chat", "Gemini"),
    "openai": ("chat", "openai_chat", "OpenAI"),
    "openai_oauth": ("chat", "openai_oauth", "OpenAI OAuth"),
    "openrt": ("chat", "openrt_chat", "OpenRouter"),
    "ollama": ("chat", "ollama_chat", "Ollama"),
    "local_chat": ("chat", "local_chat", "Local"),
    "claude-code": ("code", "claude_cli", "Claude Code (CLI)"),
    "codex-cli": ("code", "codex_cli", "Codex CLI"),
    "copilot-cli": ("code", "copilot_cli", "Copilot CLI"),
    "grok-cli": ("code", "grok_cli", "Grok CLI"),
    "opencode": ("code", "opencode_cli", "OpenCode"),
    "antigravity-cli": ("code", "antigravity_cli", "Antigravity CLI"),
}
_MODEL_ID = re.compile(r"[A-Za-z0-9._:/-]+")


def _read_catalog(project_root: Path, group: str) -> dict:
    try:
        payload = json.loads((project_root / "_AIDIY" / "aidiy_diag" / f"{group}_models_info.json").read_text(encoding="utf-8-sig"))
    except FileNotFoundError:
        return {}
    if not isinstance(payload, dict):
        raise ValueError("catalog")
    for entry in payload.values():
        if not isinstance(entry, dict) or not isinstance(entry.get("models"), dict):
            raise ValueError("models")
        if any(not isinstance(label, str) for label in entry["models"].values()):
            raise ValueError("label")
    return payload


def _diagnosed_models(project_root: Path, provider: str):
    entry = PROVIDERS.get(provider)
    if entry is None:
        return []
    group, key, _ = entry
    configured = _read_catalog(project_root, group).get(key, {}).get("models", {})
    choices = [{"id": model, "label": label} for model, label in configured.items()
               if _MODEL_ID.fullmatch(model) and model not in ("auto", "same")]
    # 直接CLIにはAIコアの自動判定がない。指定省略はsameとして公開する。
    return ([{"id": "same", "label": "same (変更なし)"}] if group == "code" else []) + choices


def _cli_models(project_root: Path, provider: str) -> list[dict[str, str]]:
    return _diagnosed_models(project_root, provider)


def catalog(cli_path: str, provider: str = "") -> dict:
    root = Path(cli_path).resolve().parent.parent
    if provider:
        return {"models": _diagnosed_models(root, provider)}
    catalogs = {group: _read_catalog(root, group) for group in ("chat", "code")}
    return {"providers": [{"id": slug, "label": label}
                          for slug, (group, key, label) in PROVIDERS.items()
                          if catalogs[group].get(key, {}).get("models")]}


if __name__ == "__main__":
    try:
        print(json.dumps(catalog(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else ""), ensure_ascii=False))
    except Exception:
        print("モデル候補を取得できません。aidiy_diag --headless で合成ファイルを生成してください。", file=sys.stderr)
        sys.exit(1)
