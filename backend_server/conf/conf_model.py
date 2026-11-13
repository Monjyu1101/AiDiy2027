# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

from log_config import get_logger
import json
import os
from typing import Dict, Optional

logger = get_logger(__name__)


class conf_models:
    """モデル候補はaidiy_diagの合成JSONだけを読む。外部API取得・設定への書込は行わない。"""
    def __init__(self, conf=None):
        self.conf = conf
        self.mcp_servers = self._load_mcp_config("AiDiy_mcp.json")

    def _config_dir_path(self) -> str:
        """プロジェクトルートの _config ディレクトリを返す"""
        return os.path.normpath(
            os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "_config")
        )


    def _load_mcp_config(self, filename: str) -> Dict[str, dict]:
        """
        MCP設定JSONを読込。ファイルが無ければ空dictを返す（ファイル作成は行わない）。
        期待する形式: {"mcpServers": {"サーバー名": {"type": "sse", "url": "..."}, ...}}
        """
        file_path = os.path.join(self._config_dir_path(), filename)
        if not os.path.exists(file_path):
            logger.info(f"MCP設定ファイルが存在しません（スキップ）: {os.path.relpath(file_path)}")
            return {}
        try:
            with open(file_path, "r", encoding="utf-8-sig") as f:
                payload = json.load(f)
            if not isinstance(payload, dict):
                raise ValueError("JSONのルートはobject(dict)である必要があります")
            servers = payload.get("mcpServers", {})
            if not isinstance(servers, dict):
                raise ValueError("mcpServers は object(dict)である必要があります")
            logger.info(f"MCP設定JSONを読込: {os.path.relpath(file_path)} ({len(servers)}サーバー)")
            return dict(servers)
        except Exception as e:
            logger.error(f"MCP設定JSON読込エラー: {os.path.relpath(file_path)}, {e}")
            return {}


    def fetch_all_models(self):
        """互換入口。外部API・CLIは呼ばず、合成ファイルの読込だけを確認する。"""
        for kind in ("chat", "live", "prediction", "decisions", "code"):
            self._get_diag_models(kind)
        self.get_live_voices()


    def get_chat_models(self) -> Dict[str, Dict[str, str]]:
        """chat合成ファイルの候補を取得する。"""
        return self._get_diag_models("chat") or {}


    def get_live_models(self) -> Dict[str, Dict[str, str]]:
        """live合成ファイルの候補を取得する。"""
        return self._get_diag_models("live") or {}


    def get_prediction_models(self) -> Dict[str, Dict[str, str]]:
        """予測実行と同じChat・CLI方式の有効なモデルIDだけを画面へ渡す。"""
        return self._get_diag_models("prediction") or {}


    def get_decisions_models(self) -> Dict[str, Dict[str, str]]:
        """認証付き取得一覧の判断候補。空でも設定値や実行時既定値は補完・変更しない。"""
        return self._get_diag_models("decisions") or {}


    def get_live_voices(self) -> Dict[str, Dict[str, str]]:
        """診断の音声合成JSONを読み込む。"""
        return self._get_diag_models("live", field="voices") or {}


    def _get_diag_models(self, kind: str, *, field: str = "models") -> Optional[Dict[str, Dict[str, str]]]:
        """モデル情報API向けに合成JSONの {区分: {models}} を展開する。"""
        filename = os.path.join(self._config_dir_path(), "..", "_AIDIY", "aidiy_diag", f"{kind}_{field}_info.json")
        try:
            with open(filename, encoding="utf-8-sig") as source:
                text = source.read(4 * 1024 * 1024 + 1)
            if len(text) > 4 * 1024 * 1024:
                raise ValueError("モデル情報ファイルが大きすぎます")
            payload = json.loads(text)
            if not isinstance(payload, dict):
                raise ValueError("モデル情報のルートはobjectで指定してください")
            result = {}
            entries = payload.items()
            if kind == "prediction":
                entries = ((name, payload.get(name)) for name in (
                    "openai_oauth", "freeai_chat", "openai_chat", "gemini_chat",
                    "codex_cli", "copilot_cli", "aidiy_hermes", "aidiy_pi",
                ))
            for provider, entry in entries:
                models = entry.get(field) if isinstance(entry, dict) else None
                if kind == "prediction":
                    # PredictionLLM._catalogと同じ条件。空・不正の区分は補完しない。
                    if isinstance(models, dict):
                        valid = {model: label for model, label in models.items()
                                 if isinstance(model, str) and 0 < len(model) <= 200 and model.strip() == model
                                 and not any(ord(c) < 32 or ord(c) == 127 for c in model) and model not in ("auto", "same")
                                 and isinstance(label, str)}
                        if valid:
                            result[provider] = valid
                    continue
                if not isinstance(models, dict) or any(not isinstance(label, str) for label in models.values()):
                    raise ValueError(f"{field}は表示名のobjectで指定してください")
                result[provider] = dict(models)
            return result
        except FileNotFoundError:
            logger.warning(f"合成ファイルがありません。aidiy_diag --headless で生成してください: {kind}_{field}_info.json")
            return None
        except (OSError, UnicodeError, ValueError):
            logger.warning(f"aidiy_diag の情報を読み込めません。aidiy_diag --headless で生成してください: {kind}_{field}_info.json")
            return None


    def get_code_models(self) -> Dict[str, Dict[str, str]]:
        """code合成ファイルに画面用の実行方法だけを追加する。"""
        models = self._get_diag_models("code") or {}
        return {
            provider: {"auto": "auto (自動判定)", "same": "same (変更なし)",
                       **{key: label for key, label in choices.items() if key not in ("auto", "same")}}
            for provider, choices in models.items()
        }


    def normalize_initial_settings(self, settings: dict) -> dict:
        """共通初期値だけを診断候補に合わせる。設定ファイル・接続済みセッションは変更しない。"""
        result = dict(settings)
        for kind in ("chat", "live", "code"):
            catalog = self._get_diag_models(kind)
            if catalog is None:
                continue
            available = {key: models for key, models in catalog.items() if models}
            if not available:
                continue
            def select(key, choices, controls=False):
                current = result.get(key)
                if current not in choices and not (controls and current in ("auto", "same", "")):
                    result[key] = next(iter(choices), "")
            if kind == "code":
                for provider, choices in available.items():
                    select(f"CODE_{provider.upper()}_MODEL", choices, True)
                for index in range(1, 7):
                    name_key, model_key = f"CODE_AI{index}_NAME", f"CODE_AI{index}_MODEL"
                    if result.get(name_key) in ("auto", "same", ""):
                        continue
                    select(name_key, available)
                    select(model_key, available[result[name_key]], True)
                continue
            select(f"{kind.upper()}_AI_NAME", available)
            for provider, choices in available.items():
                vendor = provider.removesuffix(f"_{kind}").upper()
                if kind == "chat" and provider == "openai_chat" and result.get("CHAT_AI_NAME") == "openai_oauth":
                    continue
                if provider == "openai_oauth":
                    if result.get("CHAT_AI_NAME") != provider:
                        continue
                    vendor = "OPENAI"
                select(f"{kind.upper()}_{vendor}_MODEL", choices)
            if kind == "live":
                for provider, voices in self.get_live_voices().items():
                    if provider in available and voices:
                        select(f"LIVE_{provider.removesuffix('_live').upper()}_VOICE", voices)
        return result


__all__ = ["conf_models"]
