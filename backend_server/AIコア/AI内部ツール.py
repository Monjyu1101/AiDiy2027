#!/usr/bin/env python
# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

from AIコア.AI履歴コンテキスト import 内部要求履歴パス
from log_config import get_logger
logger = get_logger(__name__)

import json
import asyncio
import re
import urllib.error
import urllib.request
from typing import Dict, Any, List
from abc import ABC, abstractmethod


# ============================================================
# 1. 共通インターフェース・基底クラス
# ============================================================

class ToolInterface(ABC):
    """Tool Call機能の共通インターフェース"""
    
    @abstractmethod
    def get_tool_definition(self) -> Dict[str, Any]:
        """ツール定義を取得"""
        pass
    
    @abstractmethod
    async def execute(self, parameters: Dict[str, Any]) -> str:
        """ツールを実行"""
        pass
    
    @property
    @abstractmethod
    def tool_name(self) -> str:
        """ツール名を取得"""
        pass


# ============================================================
# 2. 具体的ツール実装クラス群
# ============================================================

class EchoTestTool(ToolInterface):
    """エコーテスト機能クラス（内部テスト用オウム返し）"""
    
    @property
    def tool_name(self) -> str:
        return "echoTest"
    
    def get_tool_definition(self) -> Dict[str, Any]:
        """エコーテスト機能の定義"""
        return {
            "name": "echoTest",
            "description": "内部テスト用のオウム返し機能です。送信されたメッセージをそのまま返します。",
            "parameters": {
                "type": "object",
                "properties": {
                    "message": {
                        "type": "string",
                        "description": "オウム返しするメッセージ"
                    }
                },
                "required": ["message"]
            }
        }
    
    async def execute(self, parameters: Dict[str, Any]) -> str:
        """エコーテスト実行"""
        try:
            メッセージ = parameters.get("message", "")
            結果 = f"エコーテスト: {メッセージ}"
            return 結果
        except Exception as e:
            logger.error(f"echoTest エラー: {e}")
            return f"エコーテストでエラーが発生しました: {str(e)}"


# ============================================================
# 3. 新ツール追加エリア（拡張専用セクション）
# ============================================================

class CodeAgentRequestTool(ToolInterface):
    """コードエージェント処理依頼機能クラス"""
    
    def __init__(self, セッション=None):
        self.セッション = セッション
    
    @property
    def tool_name(self) -> str:
        return "codeAgentRequest"
    
    def get_tool_definition(self) -> Dict[str, Any]:
        return {
            "name": "codeAgentRequest",
            "description": """
コードエージェントへ処理を依頼できます。
エージェント1: 通称設計君。計画、設計が得意、汎用的なこともこなします。
エージェント2: 通称バックエンド君。バックエンドに精通しており実装も得意。
エージェント3: 通称フロント、フロントエンド君。フロントエンドに精通しており実装も得意。
エージェント4: 通称検査、検証君。検査、検証が得意。
エージェント5: 通称コーダー君。コード実装、修正が得意。
エージェント6: 通称エルメス君。aidiy_hermes による汎用支援、雑多な作業をこなします。
""",
            "parameters": {
                "type": "object",
                "properties": {
                    "channel": {
                        "type": "integer",
                        "description": "依頼先のコードエージェント番号（1-6の範囲）。迷ったら1を指定。"
                    },
                    "request": {
                        "type": "string",
                        "description": "コードエージェントへの依頼内容"
                    }
                },
                "required": ["channel", "request"]
            }
        }
    
    async def execute(self, parameters: Dict[str, Any]) -> str:
        try:
            チャンネル = parameters.get("channel", 1)
            要求内容 = parameters.get("request", "")
            
            if チャンネル not in [1, 2, 3, 4, 5, 6]:
                return f"エラー: チャンネル番号は1-6の範囲で指定してください（指定値: {チャンネル}）"
            
            if not 要求内容:
                return "エラー: 処理依頼内容が空です"
            
            if not self.セッション or not hasattr(self.セッション, "code_agent_processors"):
                return "エラー: コードエージェントプロセッサが未初期化です"
            
            code_agents = self.セッション.code_agent_processors
            if not code_agents or len(code_agents) < チャンネル:
                return f"エラー: エージェント{チャンネル}が未初期化です"
            
            エージェント = code_agents[チャンネル - 1]
            チャンネルStr = str(チャンネル)  # sockets辞書は文字列キー
            
            プロジェクトパス = 内部要求履歴パス(self.セッション)

            # 1) フロントエンドへ送信（表示用）
            要求データ = {
                "プロジェクトパス": プロジェクトパス,
                "セッションID": self.セッション.セッションID,
                "メッセージ識別": "input_request",
                "メッセージ内容": 要求内容,
                "チャンネル": チャンネルStr,
                "ファイル名": None,
                "サムネイル画像": None
            }
            await self.セッション.send_to_channel(チャンネルStr, 要求データ)
            
            # 2) 会話履歴保存
            if hasattr(エージェント, "保存関数") and エージェント.保存関数:
                エージェント.保存関数(
                    プロジェクトパス=プロジェクトパス,
                    セッションID=self.セッション.セッションID,
                    チャンネル=チャンネルStr,
                    メッセージ識別="input_request",
                    メッセージ内容=要求内容,
                    ファイル名=None,
                    サムネイル画像=None
                )
            
            # 3) 処理キューへ投入
            await エージェント.コード要求(要求データ)
            
            logger.info(f"コードエージェント{チャンネル}へ処理依頼を送信しました")
            
            return "要求を受け付けました。しばらくお待ちください。\n継続する指示がある場合は、コードエージェントの応答を待って指示ください。"
            
        except Exception as e:
            logger.error(f"codeAgentRequest エラー: {e}")
            return f"コードエージェント処理依頼でエラーが発生しました: {str(e)}"


# ============================================================
# 4. メイン管理クラス
# ============================================================

class Tools:
    """AIコア用Tool Call機能統合管理クラス"""
    
    def __init__(self, セッション=None):
        self.セッション = セッション
        self.エコーテストツール = EchoTestTool()
        self.コードエージェント依頼ツール = CodeAgentRequestTool(セッション=セッション)
        
        self.ツール関数辞書 = {}
        self.ツールインスタンス辞書 = {}
        self.ツール関数初期化()
    
    # ----------------------------------------
    # 外部インターフェース（LiveAIから呼び出し）
    # ----------------------------------------
    
    async def execute_tool_call(self, tool_name: str, parameters: Dict[str, Any]) -> str:
        """Tool Callの実行（新しいキューシステム対応）"""
        try:
            if tool_name not in self.ツール関数辞書:
                エラーメッセージ = f"未知のツールです: {tool_name}"
                logger.error(f"{エラーメッセージ}")
                logger.error(f"利用可能なツール: {list(self.ツール関数辞書.keys())}")
                return エラーメッセージ
            
            # echoTest, codeAgentRequest を即座実行
            ツール関数 = self.ツール関数辞書[tool_name]
            結果 = await ツール関数(parameters)
            return 結果
            
        except Exception as e:
            logger.error(f"Tool Call実行エラー ({tool_name}): {e}")
            return f"Tool実行エラー: {str(e)}"
    
    # ----------------------------------------
    # ツール登録・管理
    # ----------------------------------------
    
    def ツール関数初期化(self):
        """Tool Call機能で使用可能なツール群を初期化"""
        self.ツール関数辞書["echoTest"] = self.エコーテストツール.execute
        self.ツールインスタンス辞書["echoTest"] = self.エコーテストツール
        
        self.ツール関数辞書["codeAgentRequest"] = self.コードエージェント依頼ツール.execute
        self.ツールインスタンス辞書["codeAgentRequest"] = self.コードエージェント依頼ツール
    
    def _register_new_tool(self):
        """新しいツール登録用メソッド（拡張用）"""
        # 新しいツールを追加する際はここに実装
        # 例:
        # self.新ツール = NewTool()
        # self.ツール関数辞書["newTool"] = self.新ツール.execute
        # self.ツールインスタンス辞書["newTool"] = self.新ツール
        pass
    
    # ----------------------------------------
    # 互換性・外部インターフェース
    # ----------------------------------------
    
    @property
    def tool_functions(self):
        """互換性のためのプロパティ"""
        return self.ツール関数辞書
    
    def get_tool_calling_tools(self) -> List[Dict[str, Any]]:
        """Gemini apiで使用するTool Calling用のツール定義を取得"""
        ツール宣言リスト = []
        
        # 各機能の定義を収集
        for ツールインスタンス in self.ツールインスタンス辞書.values():
            ツール宣言リスト.append(ツールインスタンス.get_tool_definition())
        
        return [{"function_declarations": ツール宣言リスト}]

    def exec(self, json_str: str) -> str:
        """Tool Call実行（要求された形式）"""
        try:
            呼出データ = json.loads(json_str)
            ツール名 = 呼出データ.get("function_name", "")
            パラメータ = 呼出データ.get("parameters", {})

            if ツール名 == "echoTest":
                メッセージ = パラメータ.get("message", "")
                return json.dumps({'result': f"エコーテスト: {メッセージ}"}, ensure_ascii=False)
            return json.dumps({'error': f"未知のツール: {ツール名}"}, ensure_ascii=False)

        except Exception as e:
            return json.dumps({'error': f"実行エラー: {str(e)}"}, ensure_ascii=False)


# ============================================================
# 5. 外部 MCP ブリッジ（aidiy MCP 群を OpenAI tools 化して self-call 実行）
# ============================================================

class MCPツールブリッジ:
    """自前 aidiy MCP 群（backend_tools / 既定 8095）を OpenAI tools として動的収集し、
    self-call（HTTP）で実行する共通ブリッジ。

      - 一覧: GET  {base_url}/               -> {"mcps": [...]}
      - 定義: GET  {base_url}/{mcp}/list     -> {"tools": [{name, description, inputSchema}]}
      - 実行: POST {base_url}/{mcp}/{method} -> 任意 JSON

    self-call は IPv4 loopback HTTP のため標準ライブラリ urllib のみを使う（requests 非依存）。
    Windows のシステムプロキシと localhost の IPv6 フォールバックを避けるため、
    proxy 無効の専用 opener を使用する。
    aidiy_chat_llms / aidiy_code_agents 自身は無限再帰防止のため既定で除外する。
    """

    既定除外 = {"aidiy_chat_llms", "aidiy_code_agents"}

    def __init__(self, base_url: str = "http://127.0.0.1:8095", exclude=None):
        self.base_url = base_url.rstrip("/")
        self.exclude = set(exclude) if exclude is not None else set(self.既定除外)
        self._tools_cache = None  # (tools, name_map)
        self._http_methods_cache: Dict[str, set[str]] = {}
        self._http_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    # ---- 収集 ----

    def list_mcps(self) -> List[str]:
        """8095 のインデックスから露出対象 MCP 名一覧を取得（除外を適用）。"""
        try:
            with self._http_opener.open(f"{self.base_url}/", timeout=10) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            names = data.get("mcps", []) if isinstance(data, dict) else []
        except Exception as e:
            logger.warning(f"MCPツールブリッジ: MCP一覧取得失敗: {e}")
            names = []
        # tools 定義はプロンプト先頭に載るため、順序を固定してキャッシュを壊さない
        return sorted(n for n in names if n not in self.exclude)

    @staticmethod
    def safe_tool_name(mcp: str, method: str, used: Dict[str, Any]) -> str:
        """OpenAI function name 制約 ^[a-zA-Z0-9_-]{1,64}$ に収め、衝突を回避する。"""
        raw = re.sub(r"[^a-zA-Z0-9_-]", "_", f"{mcp}__{method}")
        safe = raw[:64]
        if safe not in used:
            return safe
        i = 1
        while True:
            suffix = f"_{i}"
            cand = safe[: 64 - len(suffix)] + suffix
            if cand not in used:
                return cand
            i += 1

    def collect_tools(self, refresh: bool = False):
        """各 MCP の /list を集約し (OpenAI tools, name_map) を返す。結果はキャッシュ。

        name_map: safe_name -> (mcp_name, method_name)
        """
        if self._tools_cache is not None and not refresh:
            return self._tools_cache

        tools: List[Dict[str, Any]] = []
        name_map: Dict[str, Any] = {}
        for mcp in self.list_mcps():
            try:
                with self._http_opener.open(f"{self.base_url}/{mcp}/list", timeout=10) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
            except Exception:
                continue
            # ツール順もプロンプト先頭の一部。MCP 側の返却順に依存させない
            for t in sorted(data.get("tools", []), key=lambda x: str(x.get("name") or "")):
                method = t.get("name")
                if not method:
                    continue
                safe = self.safe_tool_name(mcp, method, name_map)
                tools.append({
                    "type": "function",
                    "function": {
                        "name": safe,
                        "description": (t.get("description") or "")[:1024],
                        "parameters": t.get("inputSchema") or {"type": "object", "properties": {}},
                    },
                })
                name_map[safe] = (mcp, method)

        self._tools_cache = (tools, name_map)
        return self._tools_cache

    # ---- 実行 ----

    async def call_tool(self, safe_name: str, name_map: Dict[str, Any],
                        arguments: Dict[str, Any], timeout: int = 120) -> Any:
        """safe_name を (mcp, method) に逆引きして self-call 実行。例外は dict で返す。"""
        mapping = name_map.get(safe_name)
        if mapping is None:
            return {"error": f"unknown tool: {safe_name}"}
        mcp, method = mapping

        def _post(method_name: str) -> Any:
            url = f"{self.base_url}/{mcp}/{method_name}"
            body = json.dumps(arguments or {}, ensure_ascii=False).encode("utf-8")
            req = urllib.request.Request(
                url, data=body, method="POST",
                headers={"Content-Type": "application/json"},
            )
            try:
                with self._http_opener.open(req, timeout=timeout) as resp:
                    raw = resp.read().decode("utf-8")
                try:
                    return json.loads(raw)
                except Exception:
                    return {"text": raw}
            except urllib.error.HTTPError as e:
                try:
                    return json.loads(e.read().decode("utf-8"))
                except Exception:
                    return {"error": f"HTTP {e.code}"}
            except Exception as e:
                return {"error": f"{type(e).__name__}: {e}"}

        last_result: Any = None
        for method_name in self._method_candidates(mcp, method):
            last_result = await asyncio.to_thread(_post, method_name)
            if not self._is_unknown_method_error(last_result):
                return last_result
        return last_result

    def _method_candidates(self, mcp: str, method: str) -> List[str]:
        """MCP ツール名と HTTP POST メソッド名の揺れを吸収する候補を返す。

        FastMCP の `/list` は `sqlite_list_tables` のような MCP ツール名を返す一方、
        HTTP 直呼びエンドポイントは `list_tables` を受ける MCP がある。
        `/docs` の methods と suffix 一致する名前を優先フォールバックにする。
        """
        candidates: List[str] = []

        def add(name: str) -> None:
            if name and name not in candidates:
                candidates.append(name)

        add(method)

        docs_methods = self._http_method_names(mcp)
        for http_method in docs_methods:
            if method == http_method or method.endswith(f"_{http_method}"):
                add(http_method)

        prefix = mcp[len("aidiy_"):] if mcp.startswith("aidiy_") else mcp
        if method.startswith(f"{prefix}_"):
            add(method[len(prefix) + 1:])
        if "_" in method:
            add(method.split("_", 1)[1])

        return candidates

    def _http_method_names(self, mcp: str) -> set[str]:
        if mcp in self._http_methods_cache:
            return self._http_methods_cache[mcp]
        methods: set[str] = set()
        try:
            with self._http_opener.open(f"{self.base_url}/{mcp}/docs", timeout=5) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            if isinstance(data, dict) and isinstance(data.get("methods"), dict):
                methods = set(data["methods"].keys())
        except Exception:
            methods = set()
        self._http_methods_cache[mcp] = methods
        return methods

    @staticmethod
    def _is_unknown_method_error(result: Any) -> bool:
        if not isinstance(result, dict):
            return False
        error = result.get("error")
        return isinstance(error, str) and "未知のメソッド" in error


# ============================================================
# 6. 自己ループ実行（ChatAI を tool_calls 実行しながら回す共通ループ）
# ============================================================

# プロンプトキャッシュのブレークポイントを明示指定するモデル（OpenRouter 経由の Anthropic 系）。
# OpenAI / DeepSeek 系は自動キャッシュのため印は不要、ローカル推論も不要。
_キャッシュ印対象キーワード = ("claude", "anthropic")

# Anthropic のブレークポイント上限は 4。system 用に 1 枠残す。
_キャッシュ印上限 = 3


def キャッシュ印対象モデル(モデル名: str) -> bool:
    """明示 cache_control を付けるべきモデルか判定する"""
    低 = str(モデル名 or "").lower()
    return any(k in 低 for k in _キャッシュ印対象キーワード)


def _キャッシュ印付与(messages: List[Dict[str, Any]]) -> None:
    """messages 末尾に cache_control を付け直す（ローリングブレークポイント）。

    毎ターン末尾へ印を移すことで、前ターンまでの内容がキャッシュ済みプレフィックスとして
    再利用される。古い印は上限を超えた分だけ先頭側から外す。
    """
    if not messages:
        return

    # 末尾メッセージの content を parts 形式へ寄せて印を付ける
    末尾 = messages[-1]
    content = 末尾.get("content")
    if isinstance(content, str) and content:
        parts = [{"type": "text", "text": content}]
    elif isinstance(content, list) and content:
        parts = content
    else:
        return  # content 無し（tool_calls のみ等）には印を付けられない
    最終パート = parts[-1]
    if not isinstance(最終パート, dict):
        return
    最終パート["cache_control"] = {"type": "ephemeral"}
    末尾["content"] = parts

    # 上限超過分の古い印を外す（system 側の印は別枠のため対象外）
    印付き = [
        p
        for m in messages
        if m.get("role") != "system" and isinstance(m.get("content"), list)
        for p in m["content"]
        if isinstance(p, dict) and "cache_control" in p
    ]
    for p in 印付き[: max(0, len(印付き) - _キャッシュ印上限)]:
        p.pop("cache_control", None)


async def 自己ループ実行(ai_instance, messages: List[Dict[str, Any]], ブリッジ: "MCPツールブリッジ",
                        tools: List[Dict[str, Any]], name_map: Dict[str, Any],
                        max_turns: int = 8, timeout: int = 120) -> Dict[str, Any]:
    """ChatAI 実装の 実行(自己ループ=False, completions_tools=...) を繰り返し、
    tool_calls をブリッジで実行しながら応答が確定するまでループする。

    各 ChatAI は completions_tools={tools, tool_choice, messages} を渡すと、その messages で
    1 回実行し last_tool_calls を捕捉して返す共通契約を持つ（openrt/gemini/ollama 共通）。

    Returns:
        {"content", "tool_trace":[{mcp,method,arguments,ok}], "turns", "stopped"}
    """
    tool_trace: List[Dict[str, Any]] = []
    content = ""
    completed = False
    turn = -1
    印付与 = キャッシュ印対象モデル(getattr(ai_instance, "chat_model", ""))

    for turn in range(max_turns):
        if 印付与:
            # 前ターンまでの messages をキャッシュ済みプレフィックスとして再利用させる
            _キャッシュ印付与(messages)
        completions_tools = {"tools": tools, "tool_choice": "auto", "messages": messages}
        result_text = await ai_instance.実行(
            要求テキスト="",
            タイムアウト秒数=timeout,
            completions_tools=completions_tools,
            自己ループ=False,
        )
        content = (result_text or "").strip()
        tool_calls = list(getattr(ai_instance, "last_tool_calls", []) or [])
        if content.startswith("!") and content != "!":
            completed = True
            break
        if content == "!":
            if not tool_calls:
                completed = True
                break
            content = ""

        if not tool_calls:
            completed = True
            messages.append({"role": "assistant", "content": content})
            break

        # assistant の tool_calls を履歴へ
        messages.append({"role": "assistant", "content": content or None, "tool_calls": tool_calls})

        # 各 tool_call を実行して tool 結果を履歴へ
        for tc in tool_calls:
            fn = tc.get("function", {}) or {}
            safe = fn.get("name", "")
            args_raw = fn.get("arguments", "") or "{}"
            try:
                args = json.loads(args_raw) if isinstance(args_raw, str) else (args_raw or {})
            except Exception:
                args = {}
            if not isinstance(args, dict):
                args = {}

            out = await ブリッジ.call_tool(safe, name_map, args, timeout)
            ok = not (isinstance(out, dict) and "error" in out)
            out_str = out if isinstance(out, str) else json.dumps(out, ensure_ascii=False)
            messages.append({"role": "tool", "tool_call_id": tc.get("id"), "content": out_str})

            mapping = name_map.get(safe)
            tool_trace.append({
                "mcp": mapping[0] if mapping else None,
                "method": mapping[1] if mapping else safe,
                "arguments": args,
                "ok": ok,
            })

    if not completed and content:
        messages.append({"role": "assistant", "content": content})

    return {
        "content": content,
        "tool_trace": tool_trace,
        "turns": turn + 1,
        "stopped": not completed,
    }
