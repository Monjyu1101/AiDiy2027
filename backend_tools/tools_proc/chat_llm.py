# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""
Chat LLM モジュール

AIチャット.py 系の ChatAI を MCP ツールとして公開するラッパー。
aidiy_code_agents が AIコード を駆動するのに対し、本モジュールは AIチャット を駆動する。
起動時に key.json の CHAT_* 設定と各種 API キーから利用可能な ai_name を確認し、
MCP ツールの description で通知する。

ツール公開先:
    SSE: http://127.0.0.1:8095/aidiy_chat_llms/sse

加えて OpenAI / Ollama 互換の標準チャットインターフェース
(/aidiy_chat_completions) からも本ラッパーを利用する。
"""

import asyncio
import importlib
import inspect
import json
import os
import sys
from pathlib import Path
from typing import Any, Optional


def _応答結果(応答):
    # backend_serverの共通規約を使う。呼出前に_setup_sys_pathで所有元を登録する。
    from AIコア.AI応答 import 応答正規化, エラー応答判定
    本文 = 応答正規化(応答)
    return 本文, "NG" if エラー応答判定(本文) else "OK"


class ChatLLMError(Exception):
    """ChatLLM 実行エラー"""
    pass


# ai_name -> (モジュール, モデル設定キー, APIキー設定キー)
_AI_TABLE = {
    "openrt_chat": ("AIコア.AIチャット_openrt", "CHAT_OPENRT_MODEL", "openrt_key_id"),
    "openrt_free": ("AIコア.AIチャット_openrt", "CHAT_OPENRT_FREE_MODEL", "openrt_key_id"),
    "gemini_chat": ("AIコア.AIチャット_gemini", "CHAT_GEMINI_MODEL", "gemini_key_id"),
    "freeai_chat": ("AIコア.AIチャット_gemini", "CHAT_FREEAI_MODEL", "freeai_key_id"),
    "ollama_chat": ("AIコア.AIチャット_ollama", "CHAT_OLLAMA_MODEL", "ollama_key_id"),
    # 本体 AIチャット._select_ai_module と同じ対応。自動選択の候補には含めない。
    "openai_chat": ("AIコア.AIチャット_openai", "CHAT_OPENAI_MODEL", "openai_key_id"),
    "openai_oauth": ("AIコア.AIチャット_openai", "CHAT_OPENAI_MODEL", ""),
    "local_chat": ("AIコア.AIチャット_local", "CHAT_LOCAL_MODEL", ""),
}

# ai_name 候補（key.json の並びに依らず固定の優先順）
_AI_CANDIDATES = ["openrt_chat", "openrt_free", "gemini_chat", "freeai_chat", "ollama_chat"]


class _ConfShim:
    """ChatAI が参照する 親.conf.json を模した薄いラッパー"""

    def __init__(self, data: dict):
        self.json = data or {}


class _ParentShim:
    """ChatAI コンストラクタに渡す 親 オブジェクトの最小実装"""

    def __init__(self, data: dict):
        self.conf = _ConfShim(data)

    def 最近のファイル取得(self, *args: Any, **kwargs: Any) -> list:
        return []


class ChatLLM:
    """AIチャット.py 系の ChatAI を MCP / HTTP 経由で起動するラッパークラス"""

    KEY_JSON_REL = os.path.join("_config", "AiDiy_key.json")

    def __init__(self, project_root: Optional[str] = None):
        if project_root:
            self.root = os.path.abspath(project_root)
        else:
            # backend_tools/tools_proc/ から 2 つ上がプロジェクトルート
            here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            self.root = os.path.dirname(here)

        # 起動時 API キー確認結果（tools_main.py から _check_ai_versions() で設定）
        self.version_info: dict[str, dict] = {}

        # resume 用セッションキャッシュ（セッション・方式・モデル・プロジェクト単位）
        self._sessions: dict[tuple[str, str, str, str], Any] = {}

    # ------------------------------------------------------------------ #
    # sys.path 設定
    # ------------------------------------------------------------------ #

    def _setup_sys_path(self) -> None:
        """backend_server を sys.path に追加（AIチャット.py のインポートに必要）"""
        backend_server = os.path.join(self.root, "backend_server")
        if os.path.isdir(backend_server) and backend_server not in sys.path:
            sys.path.append(backend_server)

    # ------------------------------------------------------------------ #
    # 設定ファイル読み込み
    # ------------------------------------------------------------------ #

    def _load_key_json(self) -> dict:
        """AiDiy_key.json を読み込んで dict を返す。失敗時は空 dict。"""
        key_path = os.path.join(self.root, self.KEY_JSON_REL)
        try:
            with open(key_path, encoding="utf-8-sig") as f:
                return json.load(f)
        except Exception:
            return {}

    def _resolve_project_path(self, project_path: Optional[str] = None) -> str:
        """
        作業ディレクトリ（出力ファイル保存先）の絶対パスを解決する。

        1. project_path が指定されていれば絶対パスに正規化して返す。
        2. なければ AiDiy_key.json の CODE_BASE_PATH を使う
           （_config/ 基準の相対パスとして解釈）。
        3. それも取得できなければプロジェクトルートを返す。
        """
        if project_path:
            return str(Path(project_path).resolve())

        key = self._load_key_json()
        code_base = key.get("CODE_BASE_PATH", "").strip()
        if code_base:
            config_dir = os.path.join(self.root, "_config")
            resolved = Path(config_dir) / code_base
            return str(resolved.resolve())

        return self.root

    def _model_for(self, ai_name: str, key: dict) -> str:
        """ai_name に対応する既定モデル名を key.json から取得する"""
        entry = _AI_TABLE.get(ai_name)
        if not entry:
            return ""
        _, model_key, _ = entry
        return str(key.get(model_key, "") or "").strip()

    def _api_key_for(self, ai_name: str, key: dict) -> str:
        """ai_name に対応する API キーを取得する（freeai は gemini にフォールバック）"""
        if ai_name == "freeai_chat":
            return (key.get("freeai_key_id", "") or key.get("gemini_key_id", "")).strip()
        if ai_name == "ollama_chat":
            return (key.get("ollama_key_id", "") or "ollama").strip()
        if ai_name == "local_chat":
            return "local"  # backend_local は認証なし（ダミーキー）
        entry = _AI_TABLE.get(ai_name)
        if not entry or not entry[2]:
            return ""  # openai_oauth は command_hermes の OAuth auth store から取得
        _, _, key_id = entry
        return str(key.get(key_id, "") or "").strip()

    def _resolve_ai_params(self, ai_name: str, ai_model: str) -> tuple[str, str]:
        """ai_name / ai_model の "auto" を key.json 値で解決する"""
        key = self._load_key_json()
        if ai_name == "auto" or not ai_name:
            # 利用可能 AI を優先、なければ key.json の CHAT_AI_NAME
            available = [k for k, v in self.version_info.items() if v.get("ok")]
            default_name = (key.get("CHAT_AI_NAME", "") or "").strip()
            if default_name in available:
                ai_name = default_name
            elif available:
                ai_name = available[0]
            else:
                ai_name = default_name or "freeai_chat"
        if ai_model == "auto" or not ai_model:
            ai_model = self._model_for(ai_name, key) or "auto"
        return ai_name, ai_model

    def _select_chat_class(self, ai_name: str):
        """ai_name に応じた ChatAI クラスをインポートして返す"""
        entry = _AI_TABLE.get(ai_name)
        module_name = entry[0] if entry else "AIコア.AIチャット_openrt"
        module = importlib.import_module(module_name)
        ChatAI = getattr(module, "ChatAI", None)
        if ChatAI is None:
            raise ChatLLMError(f"{module_name} に ChatAI クラスが見つかりません")
        return ChatAI

    @staticmethod
    def _inject_history(ai_instance: Any, role: str, text: str) -> None:
        """ChatAI 実装ごとに異なる _履歴追加 のシグネチャ差異を吸収して履歴を注入する"""
        fn = getattr(ai_instance, "_履歴追加", None)
        if fn is None or not text:
            return
        try:
            params = inspect.signature(fn).parameters
            if "role" in params:          # ollama / openrt 形式
                fn(role=role, text=text)
            elif "type" in params:        # gemini 形式
                fn(text=text, type=role)
        except Exception:
            pass

    # ------------------------------------------------------------------ #
    # 起動時 API キー確認
    # ------------------------------------------------------------------ #

    def _check_ai_versions(self) -> dict[str, dict]:
        """
        各 ai_name の利用可否を API キーの有無で判定して返す。
        ollama_chat はローカル接続前提のため常に利用可（実接続は実行時に判定）。
        """
        self._setup_sys_path()
        key = self._load_key_json()

        results: dict[str, dict] = {}
        for ai_name in _AI_CANDIDATES:
            model = self._model_for(ai_name, key)

            if ai_name == "ollama_chat":
                cloud_key = (key.get("ollama_key_id", "") or "").strip()
                cloud = bool(cloud_key) and not cloud_key.startswith("<") and cloud_key.lower() != "ollama"
                results[ai_name] = {
                    "ok": True,
                    "version": "ollama cloud" if cloud else "ollama local",
                    "model": model,
                }
                continue

            api_key = self._api_key_for(ai_name, key)
            ok = bool(api_key) and not api_key.startswith("<")
            entry = _AI_TABLE.get(ai_name)
            key_label = entry[2] if entry else "key"
            results[ai_name] = {
                "ok": ok,
                "version": f"{key_label} {'設定済' if ok else '未設定'}",
                "model": model,
            }

        return results

    # ------------------------------------------------------------------ #
    # 情報取得
    # ------------------------------------------------------------------ #

    def get_config(self, project_path: Optional[str] = None) -> dict:
        """設定情報（解決済みパス・key.json の CHAT_* 設定）を返す。"""
        key = self._load_key_json()
        resolved_path = self._resolve_project_path(project_path)
        chat_keys = {k: v for k, v in key.items() if k.startswith("CHAT_")}
        return {
            "project_root": self.root,
            "resolved_project_path": resolved_path,
            "project_path_exists": os.path.isdir(resolved_path),
            "key_json": os.path.join(self.root, self.KEY_JSON_REL),
            "chat_config": chat_keys,
            "version_info": self.version_info,
        }

    def available_models(self) -> list[dict]:
        """OpenAI 互換 /models 用に利用可能な ai_name 一覧を返す。"""
        models = []
        for ai_name, v in self.version_info.items():
            if v.get("ok"):
                models.append({
                    "id": ai_name,
                    "object": "model",
                    "owned_by": "aidiy",
                    "model": v.get("model", ""),
                })
        return models

    def get_description(self) -> str:
        """利用可能な ai_name 一覧を含む chat_llms_run の description を生成する。"""
        available = [(k, self.version_info[k]) for k in self.version_info if self.version_info[k].get("ok")]
        unavailable = [k for k in self.version_info if not self.version_info[k].get("ok")]

        lines = ["AIチャット.py 系の ChatAI を実行してテキスト応答を生成する。"]

        if available:
            parts = []
            for ai_name, v in available:
                model = v.get("model", "")
                parts.append(f"{ai_name}({model})" if model else ai_name)
            lines.append(f"\n利用可能な ai_name: {', '.join(parts)}")

        if unavailable:
            lines.append(f"利用不可の ai_name: {', '.join(unavailable)}")

        lines.append("""
Args:
    prompt: AI への入力テキスト
    project_path: 出力ファイル保存先の絶対パス（省略時は AiDiy_key.json の CODE_BASE_PATH）
    ai_name: 使用 AI（上記の利用可能な ai_name から指定。"auto" は CHAT_AI_NAME を優先）
    ai_model: モデル名（"auto" で key.json の設定を使用）
    system_instruction: システム指示（省略時はデフォルト文）
    session_id: 会話履歴のキー（resume=True 時に同一セッションの履歴を継続）
    resume: True で session_id の会話履歴を継続、False で毎回新規
    temperature: 生成温度（省略時はモジュール既定値）
    timeout_sec: タイムアウト秒数""")

        return "\n".join(lines)

    # ------------------------------------------------------------------ #
    # ChatAI インスタンス生成
    # ------------------------------------------------------------------ #

    def _実行オプション(self):
        """ChatAI に渡す AI実行オプション。None は従来どおりの既定値。派生ラッパーだけ上書きする。"""
        return None

    async def _build_instance(
        self,
        ai_name: str,
        ai_model: str,
        system_instruction: Optional[str],
        resolved_path: str,
        temperature: Optional[float],
    ):
        """ChatAI インスタンスを生成・開始して返す。失敗時は None。"""
        key = self._load_key_json()
        api_key = self._api_key_for(ai_name, key)
        parent = _ParentShim(key)

        # SDK の初回 import は時間がかかる。Tools の ping・中止処理を止めない。
        ChatAI = await asyncio.to_thread(self._select_chat_class, ai_name)
        instance = ChatAI(
            親=parent,
            セッションID="mcp_session",
            チャンネル="0",
            絶対パス=resolved_path,
            AI_NAME=ai_name,
            AI_MODEL=ai_model,
            api_key=api_key or None,
            system_instruction=system_instruction,
            実行オプション=self._実行オプション(),
        )
        if temperature is not None and hasattr(instance, "temperature"):
            try:
                instance.temperature = float(temperature)
            except (TypeError, ValueError):
                pass

        開始成功 = await instance.開始()
        if (開始成功 is False) or (not getattr(instance, "is_alive", False)):
            return None
        return instance

    # ------------------------------------------------------------------ #
    # 実行（aidiy_chat_llms: code_agents 互換インターフェース）
    # ------------------------------------------------------------------ #

    async def run_async(
        self,
        prompt: str,
        project_path: Optional[str] = None,
        ai_name: str = "auto",
        ai_model: str = "auto",
        system_instruction: Optional[str] = None,
        session_id: str = "mcp_default",
        resume: bool = True,
        temperature: Optional[float] = None,
        timeout_sec: int = 120,
        file_path: Optional[str] = None,
        use_tools: bool = True,
        max_turns: int = 8,
    ) -> dict:
        """
        AIチャット.py 系の ChatAI を使ってテキスト応答を生成する。

        use_tools=True かつ画像添付が無い場合は、ChatAI 自身に自前 MCP 群をツールとして
        使わせ、tool_calls をサーバー側で実行しながら応答が確定するまで自己ループする
        （AIコア/AIチャット_xxxx.py の 実行(自己ループ=True) に委譲）。MCP が収集できない
        ／use_tools=False ／画像添付ありの場合は 1 回の素応答を返す（_run_plain）。

        Returns:
            {"status": "OK"/"NG", "result": "...", "ai_name": ..., "ai_model": ...,
             "tool_trace": [...], "turns": ..., ...}
        """
        self._setup_sys_path()

        resolved_path = self._resolve_project_path(project_path)
        ai_name, ai_model = self._resolve_ai_params(ai_name, ai_model)

        # 利用不可の AI が指定された場合は早期リターン
        if ai_name in self.version_info and not self.version_info[ai_name].get("ok"):
            reason = self.version_info[ai_name].get("version", "利用不可")
            return {
                "status": "NG",
                "result": f"! ai_name='{ai_name}' は利用できません: {reason}",
                "project_path": resolved_path,
                "ai_name": ai_name,
                "ai_model": ai_model,
                "prompt_length": len(prompt or ""),
            }

        # ツール対応（自己ループ）: ChatAI 自身に MCP ツールを使わせる。
        # file_path（画像）指定時はツール経路が未対応のため素実行にフォールバック。
        if use_tools and not file_path:
            return await self._run_with_self_loop(
                prompt, resolved_path, ai_name, ai_model, system_instruction,
                timeout_sec, max_turns, temperature,
            )

        # 素実行（tools 無し）
        return await self._run_plain(
            prompt, resolved_path, ai_name, ai_model, system_instruction,
            session_id, resume, temperature, timeout_sec, file_path,
        )

    async def _run_plain(
        self,
        prompt: str,
        resolved_path: str,
        ai_name: str,
        ai_model: str,
        system_instruction: Optional[str],
        session_id: str,
        resume: bool,
        temperature: Optional[float],
        timeout_sec: int,
        file_path: Optional[str],
    ) -> dict:
        """従来挙動: ChatAI を 1 回だけ実行して素応答を返す（session_id で履歴継続）。"""
        cache_key = (session_id, ai_name, ai_model, os.path.normcase(resolved_path))
        instance = self._sessions.get(cache_key) if resume else None

        try:
            if instance is None:
                instance = await self._build_instance(
                    ai_name, ai_model, system_instruction, resolved_path, temperature
                )
                if instance is None:
                    return {
                        "status": "NG",
                        "result": f"! AIインスタンスの初期化に失敗しました (ai_name={ai_name})",
                        "project_path": resolved_path,
                        "ai_name": ai_name,
                        "ai_model": ai_model,
                        "prompt_length": len(prompt or ""),
                    }
                if resume:
                    self._sessions[cache_key] = instance
            elif temperature is not None and hasattr(instance, "temperature"):
                try:
                    instance.temperature = float(temperature)
                except (TypeError, ValueError):
                    pass

            result_text = await instance.実行(
                要求テキスト=prompt,
                タイムアウト秒数=timeout_sec,
                システムプロンプト=system_instruction,
                file_path=file_path,
            )
            output_files = list(getattr(instance, "last_output_files", []) or [])
        except Exception as e:
            from AIコア.AI応答 import エラー応答
            result_text = エラー応答(e)
            output_files = []
        finally:
            if not resume and instance is not None:
                try:
                    await instance.終了()
                except Exception:
                    pass

        result_text, result_status = _応答結果(result_text)
        return {
            "status": result_status,
            "result": result_text,
            "project_path": resolved_path,
            "ai_name": ai_name,
            "ai_model": ai_model,
            "output_files": output_files,
            "tool_trace": [],
            "turns": 1,
            "prompt_length": len(prompt or ""),
        }

    async def _run_with_self_loop(
        self,
        prompt: str,
        resolved_path: str,
        ai_name: str,
        ai_model: str,
        system_instruction: Optional[str],
        timeout_sec: int,
        max_turns: int,
        temperature: Optional[float],
    ) -> dict:
        """ChatAI 自身の 実行(自己ループ=True) に委譲して MCP ツールを使わせる。

        ツール収集・実行・ループ制御は AIコア/AI内部ツール.py（MCPツールブリッジ /
        自己ループ実行）と各 AIチャット_xxxx.py 側にある。本メソッドは ChatAI を起動して
        委譲し、結果と tool_trace を回収するだけの薄いラッパー。
        MCP が未収集（8095 未起動等）の場合は ChatAI 側が素応答にフォールバックする。
        会話履歴は ChatAI 内部で完結するため毎回新インスタンスで実行する。"""
        instance = await self._build_instance(
            ai_name, ai_model, system_instruction, resolved_path, temperature
        )
        if instance is None:
            return {
                "status": "NG",
                "result": f"! AIインスタンスの初期化に失敗しました (ai_name={ai_name})",
                "project_path": resolved_path,
                "ai_name": ai_name,
                "ai_model": ai_model,
                "prompt_length": len(prompt or ""),
            }

        try:
            result_text = await instance.実行(
                要求テキスト=prompt,
                タイムアウト秒数=timeout_sec,
                システムプロンプト=system_instruction,
                自己ループ=True,
                max_turns=max_turns,
            )
            output_files = list(getattr(instance, "last_output_files", []) or [])
            tool_trace = list(getattr(instance, "last_tool_trace", []) or [])
            turns = int(getattr(instance, "last_tool_turns", 0) or 0)
            stopped = bool(getattr(instance, "last_tool_stopped", False))
        except Exception as e:
            from AIコア.AI応答 import エラー応答
            result_text = エラー応答(e)
            output_files, tool_trace, turns, stopped = [], [], 0, False
        finally:
            try:
                await instance.終了()
            except Exception:
                pass

        result_text, result_status = _応答結果(result_text)
        return {
            "status": result_status,
            "result": result_text,
            "project_path": resolved_path,
            "ai_name": ai_name,
            "ai_model": ai_model,
            "output_files": output_files,
            "tool_trace": tool_trace,
            "turns": turns,
            "tool_stopped": stopped,
            "prompt_length": len(prompt or ""),
        }

    # ------------------------------------------------------------------ #
    # 実行（aidiy_chat_completions: OpenAI / Ollama 互換）
    # ------------------------------------------------------------------ #

    @staticmethod
    def _extract_parts(content: Any) -> tuple[str, list[str]]:
        """OpenAI messages の content（文字列 or パーツ配列）から
        テキストと画像 URL（data: / http(s) / ローカルパス）を抽出する。

        Returns:
            (テキスト, [画像URL, ...])
        """
        if content is None:
            return "", []
        if isinstance(content, str):
            return content, []
        if not isinstance(content, list):
            return str(content), []

        texts: list[str] = []
        images: list[str] = []
        for part in content:
            if isinstance(part, dict):
                ptype = part.get("type")
                if ptype in (None, "text") and "text" in part:
                    texts.append(str(part.get("text", "")))
                elif ptype == "image_url":
                    iu = part.get("image_url")
                    url = iu.get("url") if isinstance(iu, dict) else iu
                    if url:
                        images.append(str(url))
            else:
                texts.append(str(part))
        return "\n".join(t for t in texts if t), images

    def _materialize_image(self, url: str, dest_dir: str) -> Optional[str]:
        """画像 URL を一時ファイル化して絶対パスを返す。失敗時は None。

        - data: URL は base64 デコードして保存
        - http(s) URL はダウンロードして保存
        - 既存ローカルパスはそのまま返す
        """
        import base64  # noqa: PLC0415
        import os as _os  # noqa: PLC0415
        import tempfile  # noqa: PLC0415
        import urllib.request  # noqa: PLC0415

        _ext_by_mime = {
            "image/png": ".png", "image/jpeg": ".jpg", "image/jpg": ".jpg",
            "image/gif": ".gif", "image/webp": ".webp", "image/bmp": ".bmp",
        }
        try:
            if url.startswith("data:"):
                header, b64 = url.split(",", 1)
                mime = header[5:].split(";")[0].strip()
                ext = _ext_by_mime.get(mime, ".png")
                raw = base64.b64decode(b64)
            elif url.startswith(("http://", "https://")):
                with urllib.request.urlopen(url, timeout=30) as resp:  # noqa: S310
                    raw = resp.read()
                ext = _os.path.splitext(url.split("?")[0])[1] or ".png"
            elif _os.path.isfile(url):
                return str(Path(url).resolve())
            else:
                return None

            _os.makedirs(dest_dir, exist_ok=True)
            fd, path = tempfile.mkstemp(suffix=ext, prefix="chat_img_", dir=dest_dir)
            with _os.fdopen(fd, "wb") as f:
                f.write(raw)
            return path
        except Exception:
            return None

    def _parse_model_field(self, model: str, ai_name: str, ai_model: str) -> tuple[str, str]:
        """
        completions の model フィールドを ai_name / ai_model に解決する。

        - "ai_name/ai_model" 形式 → 分割
        - 候補 ai_name そのもの → ai_name として扱う
        - それ以外 → ai_model として扱う（ai_name は呼び出し側指定 or auto）
        """
        if not model:
            return ai_name, ai_model
        model = model.strip()
        if "/" in model:
            head, tail = model.split("/", 1)
            if head in _AI_TABLE:
                return head, (tail or "auto")
        if model in _AI_TABLE:
            return model, ai_model
        # 具体モデル名が来た場合は ai_model として採用
        return ai_name, model

    def _completion_result(self, instance, content, *, completed=True):
        """通常チャットの応答規約。専用の派生ラッパーだけ上書きできる。"""
        return _応答結果(content)

    async def complete_async(
        self,
        messages: list,
        model: Optional[str] = None,
        ai_name: str = "auto",
        ai_model: str = "auto",
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        timeout_sec: int = 120,
        project_path: Optional[str] = None,
        tools: Optional[list] = None,
        tool_choice: Any = None,
    ) -> dict:
        """
        OpenAI / Ollama 互換の messages 配列を受けて 1 回の生成を行う。

        tools / tool_choice が指定された場合は OpenAI function calling として
        ChatAI へ completions_tools 経由で委譲し、tool_calls を回収して返す。

        Returns:
            {"status": "OK"/"NG", "content": "...", "ai_name": ..., "ai_model": ...,
             "output_files": [...], "tool_calls": [...] | None,
             "prompt_tokens": .., "completion_tokens": ..}
        """
        self._setup_sys_path()

        resolved_path = self._resolve_project_path(project_path)

        if model:
            ai_name, ai_model = self._parse_model_field(model, ai_name, ai_model)
        ai_name, ai_model = self._resolve_ai_params(ai_name, ai_model)

        if ai_name in self.version_info and not self.version_info[ai_name].get("ok"):
            reason = self.version_info[ai_name].get("version", "利用不可")
            return {
                "status": "NG",
                "content": f"! ai_name='{ai_name}' は利用できません: {reason}",
                "ai_name": ai_name,
                "ai_model": ai_model,
            }

        # messages を system / 履歴 / 最後の user に分解（画像 URL も保持）
        system_parts: list[str] = []
        turns: list[tuple[str, str, list[str]]] = []  # (role, text, image_urls)
        for m in messages or []:
            if not isinstance(m, dict):
                continue
            role = m.get("role", "user")
            text, images = self._extract_parts(m.get("content"))
            if role == "system":
                if text:
                    system_parts.append(text)
            else:
                turns.append((role, text, images))

        system_instruction = "\n".join(system_parts) if system_parts else None

        # 最後のメッセージを要求テキスト・添付画像とし、それ以前を会話履歴にする。
        # （tool calling の 2 巡目では末尾が role="tool" の結果になるため、
        #   「最後の user」ではなく「最後のメッセージ」を要求として扱う）
        要求テキスト = ""
        last_images: list[str] = []
        history: list[tuple[str, str]] = []
        if turns:
            要求テキスト = turns[-1][1]
            last_images = turns[-1][2]
            history = [(r, t) for r, t, _ in turns[:-1]]

        prompt_chars = sum(len(t) for _, t, _ in turns) + sum(len(s) for s in system_parts)

        # tools / tool_choice を completions_tools(dict) に集約（空なら None=従来挙動）
        completions_tools: Optional[dict] = None
        if tools:
            completions_tools = {"tools": tools}
            if tool_choice is not None:
                completions_tools["tool_choice"] = tool_choice
            # tool calling 時は assistant.tool_calls / tool 結果のリンクを保つため、
            # 元の messages を忠実に API へ渡す（ChatAI のテキスト履歴再構成を上書き）。
            faithful: list[dict] = []
            for m in messages or []:
                if not isinstance(m, dict):
                    continue
                entry: dict = {"role": m.get("role", "user"), "content": m.get("content")}
                if m.get("tool_calls"):
                    entry["tool_calls"] = m["tool_calls"]
                if m.get("tool_call_id"):
                    entry["tool_call_id"] = m["tool_call_id"]
                if m.get("name"):
                    entry["name"] = m["name"]
                faithful.append(entry)
            if system_instruction and not any(e.get("role") == "system" for e in faithful):
                faithful.insert(0, {"role": "system", "content": system_instruction})
            completions_tools["messages"] = faithful

        instance = await self._build_instance(
            ai_name, ai_model, system_instruction, resolved_path, temperature
        )
        if instance is None:
            return {
                "status": "NG",
                "content": f"! AIインスタンスの初期化に失敗しました (ai_name={ai_name})",
                "ai_name": ai_name,
                "ai_model": ai_model,
            }

        # 最後の user メッセージの先頭画像を一時ファイル化して file_path として渡す
        # （ChatAI 側は単一画像の file_path 添付に対応）
        file_path: Optional[str] = None
        temp_image_paths: list[str] = []
        if last_images:
            dest_dir = os.path.join(resolved_path, "temp", "input")
            for url in last_images:
                materialized = self._materialize_image(url, dest_dir)
                if materialized:
                    file_path = materialized
                    # 新規生成した一時ファイル（chat_img_*）だけ後始末対象にする
                    # （既存ローカルパスのパススルーは削除しない）
                    if os.path.basename(materialized).startswith("chat_img_"):
                        temp_image_paths.append(materialized)
                    break

        completed = False
        try:
            # 過去ターンを履歴注入（最後の user を除く）
            for role, text in history:
                norm_role = "assistant" if role in ("assistant", "model") else "user"
                self._inject_history(instance, norm_role, text)

            result_text = await instance.実行(
                要求テキスト=要求テキスト,
                タイムアウト秒数=timeout_sec,
                システムプロンプト=system_instruction,
                file_path=file_path,
                completions_tools=completions_tools,
            )
            output_files = list(getattr(instance, "last_output_files", []) or [])
            tool_calls = list(getattr(instance, "last_tool_calls", []) or [])
            completed = True
        except Exception as e:
            from AIコア.AI応答 import エラー応答
            result_text = エラー応答(e)
            output_files, tool_calls = [], []
        finally:
            try:
                await instance.終了()
            except Exception:
                pass
            # 生成した一時画像を後始末
            for p in temp_image_paths:
                try:
                    if os.path.isfile(p):
                        os.remove(p)
                except Exception:
                    pass

        content = result_text or ""
        # tool_calls のみでテキストが無い場合、ChatAI は "!" を返すため空に正規化する
        if tool_calls and content.strip() in ("", "!"):
            content = ""
        content, result_status = ("", "OK") if tool_calls and content == "" else self._completion_result(instance, content, completed=completed)
        return {
            "status": result_status,
            "content": content,
            "ai_name": ai_name,
            "ai_model": ai_model,
            "output_files": output_files,
            "tool_calls": tool_calls or None,
            "prompt_tokens": prompt_chars,
            "completion_tokens": len(content),
        }
