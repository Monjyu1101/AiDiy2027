# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""AI判断の入口。登録表でプロバイダを切り替え、共通のanswersを返す。"""
from __future__ import annotations

import asyncio
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timezone
import importlib
import json
from pathlib import Path
import time

import httpx
from pydantic import ValidationError

from AIコア.AI判断共通 import DecisionError, DecisionRequest, OPENAI_DECISION_MODEL, FREEAI_DECISION_MODEL, first_configured_api_key, validate_answers


@dataclass(frozen=True)
class Provider:
    module: str
    model_key: str
    default_model: str
    auth: str
    aliases: tuple[str, ...] = ()
    api_key_field: str | None = None
    auto_priority: int = 100
    fallback_key_fields: tuple[str, ...] = ()


PROVIDERS = {
    "openai_decisions": Provider("AIコア.AI判断_openai_decisions", "DECISION_OPENAI_MODEL", OPENAI_DECISION_MODEL, "api_key", api_key_field="openai_key_id"),
    "openai_oauth": Provider("AIコア.AI判断_openai_jsonchat", "DECISION_OAUTH_MODEL", OPENAI_DECISION_MODEL, "oauth", ("openai_jsonchat",), auto_priority=0),
    "freeai_chat": Provider("AIコア.AI判断_freeai_jsonchat", "DECISION_FREEAI_MODEL", FREEAI_DECISION_MODEL, "api_key", api_key_field="freeai_key_id", auto_priority=50, fallback_key_fields=("gemini_key_id",)),
    "gemini_chat": Provider("AIコア.AI判断_gemini_jsonchat", "DECISION_GEMINI_MODEL", FREEAI_DECISION_MODEL, "api_key", api_key_field="gemini_key_id", auto_priority=300, fallback_key_fields=("freeai_key_id",)),
}


def is_default(value: str) -> bool:
    return value.lower() in ("", "auto")


class Decision:
    def __init__(self, config_path: str | Path | None = None, *, config: dict | None = None, transport=None):
        self.config_path = Path(config_path) if config_path else Path(__file__).resolve().parents[2] / "_config" / "AiDiy_key.json"
        self._config = config
        self.transport = transport
        # 未確認を利用不可と混同しない。起動チェック完了時に全件まとめて更新。
        self.availability: dict[str, dict] = {}

    def _load_config(self) -> dict:
        if self._config is not None:
            return dict(self._config)
        try:
            value = json.loads(self.config_path.read_text(encoding="utf-8-sig"))
            if not isinstance(value, dict):
                raise ValueError("not an object")
            return value
        except FileNotFoundError:
            return {}
        except (OSError, ValueError):
            raise DecisionError("AI判断の設定ファイルを読み込めません") from None

    @staticmethod
    def _canonical(name: str) -> str:
        for key, provider in PROVIDERS.items():
            if name == key or name in provider.aliases:
                return key
        raise DecisionError(f"未対応のAI判断プロバイダ: {name}")

    def resolve(self, request: DecisionRequest, config: dict) -> tuple[str, str]:
        name = request.ai_name
        model = request.model if not is_default(request.model) else request.ai_model
        if not is_default(request.model) and not is_default(request.ai_model) and request.ai_model != request.model:
            raise DecisionError("model と ai_model の指定が競合しています")
        if "/" in model:
            prefix, model = model.split("/", 1)
            provider = self._canonical(prefix)
            if not is_default(name) and self._canonical(name) != provider:
                raise DecisionError("ai_name と model のプロバイダが競合しています")
            name = provider
            if not model:
                raise DecisionError("モデル名が空です")
        if is_default(name):
            name = str(config.get("DECISION_AI_NAME") or "auto").strip()
        if is_default(name):
            available = [key for key in PROVIDERS if self.availability.get(key, {}).get("ok")]
            if available:
                name = min(available, key=lambda key: PROVIDERS[key].auto_priority)
            else:
                name = "openai_oauth"
        name = self._canonical(name)
        provider = PROVIDERS[name]
        if is_default(model):
            model = self._default_model(provider, config)
        return name, model

    @staticmethod
    def model_options(catalogs=None) -> dict[str, dict[str, str]]:
        """Diag取得済みの候補だけを返す。autoは制御値であり利用可否ではない。"""
        catalogs = catalogs or {}
        options = {}
        for name in sorted(PROVIDERS, key=lambda key: PROVIDERS[key].auto_priority):
            models = {"auto": "auto（方式別の既定モデル）"}
            for model, label in catalogs.get(name, {}).items():
                if not is_default(model):
                    models[model] = label
            options[name] = models
        return {"auto": {"auto": "auto（方式別の既定モデル）", **{
            model: label for models in options.values() for model, label in models.items() if model != "auto"
        }}, **options}

    @staticmethod
    def _default_model(provider: Provider, config: dict) -> str:
        model = str(config.get(provider.model_key, "auto") or "auto").strip()
        return provider.default_model if is_default(model) else model

    def get_config(self) -> dict:
        config = self._load_config()
        name, model = self.resolve(DecisionRequest(input="config", questions=[{"type": "predicate", "name": "config", "instructions": "config"}]), config)
        return {
            **self.get_availability_status(),
            "default_model": f"{name}/{model}",
            "configured_defaults": {
                "DECISION_AI_NAME": str(config.get("DECISION_AI_NAME") or "auto").strip() or "auto",
                **{key: str(config.get(key, "auto") or "auto").strip() or "auto" for key in ("DECISION_OPENAI_MODEL", "DECISION_OAUTH_MODEL", "DECISION_GEMINI_MODEL", "DECISION_FREEAI_MODEL")},
            },
            "providers": [{"ai_name": key, "implementation": provider.module.rsplit(".", 1)[-1], "aliases": list(provider.aliases), "auth": provider.auth, "default_model": self._default_model(provider, config), "model_config_key": provider.model_key} for key, provider in PROVIDERS.items()],
            "selection_note": "方式は明示引数、DECISION_AI_NAMEの順。autoなら起動チェック成功の方式からOAuth → FreeAI → Decisions API → Geminiの順。モデルは明示model/ai_model → 方式別MODEL設定 → 低コスト既定値。Diagの候補は書き出し側で絞りますが、実行時のモデル指定を固定しません。既存設定値と明示プロバイダを保持します。",
            "question_types": ["predicate", "choice", "score"],
            "availability": deepcopy(self.availability),
            "availability_checked": bool(self.availability),
            "available_models": [
                f"{key}/{info['model']}"
                for key, info in self.availability.items() if info["ok"]
            ],
            "probability_note": "OAuth / FreeAI / GeminiのJSON判断の確率・confidenceは生成モデルの推定値で、Decisions APIと同じ校正値ではありません。",
        }

    def get_availability_status(self) -> dict:
        """MCP公開可否。起動チェック成功の方式が1つ以上ある場合のみ利用可能。"""
        available = any(info.get("ok") for info in self.availability.values())
        return {
            "status": "OK" if available else "NG",
            "available": available,
            "message": "AI判断を利用できます" if available else (
                "現在利用不可：すべてのAI判断プロバイダが利用できません。設定・認証を確認して再起動してください。"
                if self.availability else "現在利用不可：AI判断の起動チェックが未完了です。"
            ),
        }

    async def check_availability(self, timeout_sec: float = 15) -> dict[str, dict]:
        """各方式の既定モデルで「おはよう=挨拶」を実行し、利用可否を保持する。

        起動チェックは失敗しても他サービスを停止しない。利用可否はチェック時点の
        指定モデルについての結果であり、別モデルの動作や継続的な可用性を保証しない。
        """
        config_error = ""
        try:
            config = self._load_config()
        except DecisionError as exc:
            config = {}
            config_error = str(exc)

        async def probe(name: str, provider: Provider) -> tuple[str, dict]:
            started = time.monotonic()
            model = self._default_model(provider, config)
            info = {"ok": False, "model": model, "reason": "", "answer": None}
            try:
                if config_error:
                    raise DecisionError(config_error)
                key_fields = (provider.api_key_field, *provider.fallback_key_fields)
                if provider.api_key_field and not first_configured_api_key(config, *key_fields):
                    raise DecisionError(f"{' / '.join(key_fields)} が未設定です（空欄・<...>・空引用符）")
                check = DecisionRequest(
                    ai_name=name, ai_model=model, timeout_sec=timeout_sec,
                    input="おはよう",
                    questions=[{
                        "type": "choice", "name": "greeting",
                        "instructions": "入力の言葉を分類してください。おはようは挨拶です。",
                        "choices": [
                            {"value": "挨拶", "description": "おはよう・こんにちは等の挨拶"},
                            {"value": "その他", "description": "挨拶ではない言葉"},
                        ],
                    }],
                )
                async with asyncio.timeout(timeout_sec):
                    result = await self.実行(check)
                answer = result["data"]["answers"][0]
                info["answer"] = answer.get("choice")
                info["ok"] = answer["type"] == "choice" and info["answer"] == "挨拶"
                info["reason"] = "おはよう → 挨拶 を確認" if info["ok"] else "起動チェックの期待結果（挨拶）と不一致、または回答拒否"
            except DecisionError as exc:
                info["reason"] = str(exc)
            except TimeoutError:
                info["reason"] = "AI判断の起動チェックがタイムアウトしました"
            except Exception as exc:
                # 依存不足などもサーバー全体の起動を妨げない。例外本文に秘密を含めない。
                info["reason"] = f"AI判断の起動チェックに失敗しました（{type(exc).__name__}）"
            info["checked_at"] = datetime.now(timezone.utc).isoformat()
            info["elapsed_ms"] = round((time.monotonic() - started) * 1000)
            return name, info

        self.availability = dict(await asyncio.gather(*(
            probe(name, provider) for name, provider in PROVIDERS.items()
        )))
        return deepcopy(self.availability)

    async def 実行(self, request: DecisionRequest | dict) -> dict:
        request = DecisionRequest.model_validate(request)
        config = self._load_config()
        selected_model = request.model if not is_default(request.model) else request.ai_model
        if is_default(request.ai_name) and "/" not in selected_model and self.availability and not self.get_availability_status()["available"]:
            raise DecisionError(self.get_availability_status()["message"])
        name, model = self.resolve(request, config)
        ai = importlib.import_module(PROVIDERS[name].module).DecisionAI()
        started = time.monotonic()
        try:
            async with asyncio.timeout(request.timeout_sec):
                async with httpx.AsyncClient(timeout=request.timeout_sec, transport=self.transport, follow_redirects=False) as client:
                    data = await ai.実行(request, model, config, client)
                answers = validate_answers(data, request.questions)
        except DecisionError:
            raise
        except (TimeoutError, httpx.TimeoutException):
            raise DecisionError("AI判断がタイムアウトしました") from None
        except httpx.HTTPError:
            raise DecisionError("AI判断の接続に失敗しました") from None
        except (ValidationError, ValueError, TypeError, AttributeError):
            raise DecisionError("AI判断の応答形式が不正です（JSON・回答名・型・確率分布を確認）") from None
        return {"status": "OK", "message": "判断が完了しました", "data": {"ai_name": name, "ai_model": model, "model": f"{name}/{model}", "method": ai.method, "answers": answers, "usage": data.get("usage"), "elapsed_ms": round((time.monotonic() - started) * 1000)}}
