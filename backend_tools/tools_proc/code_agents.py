# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""
Code Agents モジュール

AIコード.py (CodeAgent) を MCP ツールとして公開するラッパー。
起動時に key.json の各 CODE_AIx_NAME に対して CLI --version を確認し、
利用可能な AI 名を MCP ツールの description で通知する。

ツール公開先:
    SSE: http://127.0.0.1:8095/aidiy_code_agents/sse
"""

import json
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Optional

# 起動時バージョン確認の CLI --version タイムアウト秒。
# 並列実行と組み合わせるため、ハング時の打ち切りを早める一方、
# コールド起動（node / uv の初回立ち上げ）の実測値（warm で hermes ~5s）に
# 余裕を持たせた値にしている。
_VERSION_CHECK_TIMEOUT = 10


def _応答結果(応答):
    # backend_serverの共通規約を使う。呼出前に_setup_sys_pathで所有元を登録する。
    from AIコア.AI応答 import 応答正規化, エラー応答判定
    本文 = 応答正規化(応答)
    return 本文, "NG" if エラー応答判定(本文) else "OK"


class CodeAgentsError(Exception):
    """CodeAgents 実行エラー"""
    pass


class _NullConnection:
    """MCP経由実行時の接続ダミー。WebSocket送信を全て無視する。"""

    def __init__(self, モデル設定: Optional[dict] = None):
        self.モデル設定: dict = モデル設定 or {}

    async def send_to_channel(self, *args: Any, **kwargs: Any) -> None:
        pass


class CodeAgents:
    """AIコード.py の CodeAgent を MCP 経由で起動するラッパークラス"""

    KEY_JSON_REL = os.path.join("_config", "AiDiy_key.json")

    def __init__(self, project_root: Optional[str] = None):
        if project_root:
            self.root = os.path.abspath(project_root)
        else:
            # backend_tools/tools_proc/ から 2 つ上がプロジェクトルート
            here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            self.root = os.path.dirname(here)

        # 起動時バージョン確認結果（tools_main.py から _check_ai_versions() で設定）
        self.version_info: dict[str, dict] = {}

    # ------------------------------------------------------------------ #
    # sys.path 設定
    # ------------------------------------------------------------------ #

    def _setup_sys_path(self) -> None:
        """backend_server を sys.path に追加（AIコード.py のインポートに必要）"""
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
            with open(key_path, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}

    def _resolve_project_path(self, project_path: Optional[str] = None) -> str:
        """
        実行ディレクトリの絶対パスを解決する。

        1. project_path が指定されていれば絶対パスに正規化して返す。
        2. なければ AiDiy_key.json の CODE_BASE_PATH を使う。
           CODE_BASE_PATH は相対パス（例: "../"）の場合、_config/ 基準で解釈。
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

    def _resolve_ai_params(self, ai_name: str, ai_model: str) -> tuple[str, str]:
        """AI名を解決。CLIのautoは履歴によるモデル自動選択へ渡す。"""
        key = self._load_key_json()
        if ai_name in ("auto", "same"):
            # 自動・前回指定の入口は Hermes に統一し、モデルの auto / same を渡す。
            ai_name = "aidiy_hermes"
        if ai_model == "auto" and ai_name == "claude_sdk":
            model_key = f"CODE_{ai_name.upper()}_MODEL"
            ai_model = key.get(model_key, "auto")
        return ai_name, ai_model

    # ------------------------------------------------------------------ #
    # 起動時バージョン確認
    # ------------------------------------------------------------------ #

    def _check_ai_versions(self) -> dict[str, dict]:
        """
        key.json の CODE_AI1_NAME ... CODE_AI9_NAME に対して CLI --version を
        同期実行し、各 AI の利用可否を返す。

        claude_sdk は claude_agent_sdk パッケージと claude_key_id の存在で確認。
        CLI ベースは subprocess.run で --version を実行。
        また、必要な API キーが未設定の場合は利用不可とする。
        """
        self._setup_sys_path()

        key = self._load_key_json()

        # CODE_AI1_NAME ... CODE_AI9_NAME から候補を収集
        candidates: list[str] = []
        for i in range(1, 10):
            name = key.get(f"CODE_AI{i}_NAME", "").strip()
            if name and name not in candidates:
                candidates.append(name)
        # 同梱エージェントは CODE_AI* の登録有無にかかわらず確認する。
        for name in ("aidiy_hermes", "aidiy_pi"):
            if name not in candidates:
                candidates.append(name)

        # 各候補の CLI --version は I/O 待ちが支配的なので並列実行する。
        # 逐次だと最悪「候補数 × timeout」秒かかり、8095 起動（uvicorn）全体を
        # ブロックして VS Code からの全 MCP 接続が待たされるため。
        results: dict[str, dict] = {}
        with ThreadPoolExecutor(max_workers=len(candidates)) as executor:
            future_map = {
                executor.submit(self._probe_ai_version, ai_name, key): ai_name
                for ai_name in candidates
            }
            for future, ai_name in future_map.items():
                try:
                    results[ai_name] = future.result()
                except Exception as e:
                    results[ai_name] = {"ok": False, "version": str(e)[:80], "cmd": ""}

        # candidates の登録順を維持して返す
        return {ai_name: results[ai_name] for ai_name in candidates}

    def _probe_ai_version(self, ai_name: str, key: dict) -> dict:
        """単一の ai_name についてキー確認 + CLI --version を実行し info dict を返す。

        _check_ai_versions から ThreadPoolExecutor で並列に呼ばれる。"""
        info: dict = {"ok": False, "version": "", "cmd": ""}

        # 各 AI はサブスク認証（CLI 系）または内部 CLI 経由で動作するため API キーは不要。
        # 利用可否は CLI --version の実行結果（claude_sdk はパッケージ存在）で判定する。

        try:
            if ai_name == "claude_sdk":
                # SDK ベース: 実行モジュールが使う claude_agent_sdk の存在のみ確認。
                # 内部的に claude_cli 経由で動くため API キーは不要。
                try:
                    import claude_agent_sdk  # noqa: F401, PLC0415
                    version = getattr(claude_agent_sdk, "__version__", "claude_agent_sdk")
                    info = {"ok": True, "version": version, "cmd": "claude_agent_sdk"}
                except ImportError:
                    info = {"ok": False, "version": "claude_agent_sdk 未インストール", "cmd": "claude_agent_sdk"}

            else:
                from AIコア.AIコード_cli import CodeAI  # noqa: PLC0415
                dummy = CodeAI(AI_NAME=ai_name, AI_MODEL="auto")
                cmd_path = dummy._コマンドパス取得()
                info["cmd"] = cmd_path

                if ai_name == "aidiy_hermes":
                    base = dummy._hermes直接実行コマンド()
                    if None is base:
                        base = [cmd_path]
                    cmd = base + ["--version"]
                elif ai_name == "aidiy_pi":
                    # Pi は node で AiDiy 入口を直接起動する（ソース実行のため初回は数秒かかる）。
                    base = dummy._pi直接実行コマンド()
                    cmd = (base if base else [cmd_path]) + ["--version"]
                else:
                    direct = dummy._npmシム直接実行に解決(cmd_path)
                    cmd = (direct if direct else [cmd_path]) + ["--version"]

                result = subprocess.run(
                    cmd,
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), capture_output=True,
                    timeout=_VERSION_CHECK_TIMEOUT,
                )
                stdout = (result.stdout or b"").decode("utf-8", errors="replace").strip()
                stderr = (result.stderr or b"").decode("utf-8", errors="replace").strip()
                lines = (stdout or stderr).splitlines()
                first_line = lines[0].strip() if lines else ""
                ok = bool(first_line) and not first_line.startswith("Error:")
                info = {"ok": ok, "version": first_line, "cmd": cmd_path}

        except FileNotFoundError:
            info["version"] = "コマンドが見つかりません"
        except subprocess.TimeoutExpired:
            info["version"] = "timeout"
        except Exception as e:
            info["version"] = str(e)[:80]

        return info

    # ------------------------------------------------------------------ #
    # 情報取得
    # ------------------------------------------------------------------ #

    def get_config(self, project_path: Optional[str] = None) -> dict:
        """設定情報（解決済みパス・key.json の CODE_* 設定）を返す。"""
        key = self._load_key_json()
        resolved_path = self._resolve_project_path(project_path)
        code_keys = {k: v for k, v in key.items() if k.startswith("CODE_")}
        return {
            "project_root": self.root,
            "resolved_project_path": resolved_path,
            "project_path_exists": os.path.isdir(resolved_path),
            "key_json": os.path.join(self.root, self.KEY_JSON_REL),
            "code_config": code_keys,
            "version_info": self.version_info,
        }

    def get_description(self) -> str:
        """利用可能な AI 一覧を含む code_agents_run の description を生成する。"""
        available = [(k, self.version_info[k]) for k in self.version_info if self.version_info[k].get("ok")]
        unavailable = [k for k in self.version_info if not self.version_info[k].get("ok")]

        lines = ["AIコード.py の CodeAgent を実行する。"]

        if available:
            ver_parts = []
            for ai_name, v in available:
                ver = v.get("version", "")
                ver_parts.append(f"{ai_name}({ver})" if ver else ai_name)
            lines.append(f"\n利用可能な ai_name: {', '.join(ver_parts)}")

        if unavailable:
            lines.append(f"利用不可の ai_name: {', '.join(unavailable)}")

        lines.append("""
Args:
    prompt: エージェントへの依頼テキスト
    project_path: 作業ディレクトリの絶対パス（省略時は AiDiy_key.json の CODE_BASE_PATH）
    ai_name: 使用 AI（上記の利用可能な ai_name から指定。"auto" / "same" は aidiy_hermes を選択）
    ai_model: モデル名。autoはHermes/Codex/Claude/Copilotで履歴から自動選択。Hermesのsameは前回のprovider/モデルを復元、他CLIのsameは指定省略。
    max_turns: 最大ターン数（default: 999）
    code_plan: プラン設定（auto / on / off）
    code_verify: 検証設定（auto / on / off）
    code_permissions: 権限設定（auto / full / none）
    system_instruction: システム指示（省略時はデフォルト文）
    resume: セッション継続フラグ
    timeout_sec: タイムアウト秒数（default: 1800=30分）
    self_check_loop: バックアップ＋自己検証ループの最大回数（default: 0=実行のみ・バックアップなし。1以上でその回数までバックアップ＋AI検証修正を実行）""")

        return "\n".join(lines)

    # ------------------------------------------------------------------ #
    # エージェント実行
    # ------------------------------------------------------------------ #

    async def run_async(
        self,
        prompt: str,
        project_path: Optional[str] = None,
        ai_name: str = "auto",
        ai_model: str = "auto",
        max_turns: int = 999,
        code_plan: str = "auto",
        code_verify: str = "auto",
        code_permissions: str = "auto",
        system_instruction: Optional[str] = None,
        resume: bool = True,
        timeout_sec: int = 1800,
        self_check_loop: int = 0,
        実行オプション: Optional[Any] = None,
    ) -> dict:
        """
        AIコード.py の CodeAgent を使ってコードエージェントを実行する。

        Args:
            prompt: エージェントへの依頼テキスト
            project_path: 作業ディレクトリの絶対パス。
                          省略時は AiDiy_key.json の CODE_BASE_PATH を使用。
            ai_name: 使用 AI（例: claude_cli / copilot_cli / aidiy_hermes）。
                     "auto" / "same" は aidiy_hermes を選択。利用不可の場合はエラー。
            ai_model: CLIのautoは履歴から自動選択。Hermesのsameは前回値、他CLIは指定省略。
            max_turns: 最大ターン数（default: 999）
            code_plan: プラン設定（auto / on / off）
            code_verify: 検証設定（auto / on / off）
            code_permissions: 権限設定（auto / full / none）
            system_instruction: システム指示（省略時はデフォルト文）
            resume: セッション継続フラグ
            timeout_sec: タイムアウト秒数（default: 1800=30分）
            self_check_loop: バックアップ＋自己検証ループの最大回数。
                              default: 0 = 実行のみ（バックアップ・自己検証なし）。
                              1以上でその回数までAIコード.pyと同じバックアップ＋AI検証修正を実行する。
            実行オプション: AIコア.AI実行オプション の AI実行オプション。省略時は既定値（すべて有効）。

        Returns:
            {"status": "OK"/"NG", "result": "...", "project_path": "...", ...}
        """
        self._setup_sys_path()

        resolved_path = self._resolve_project_path(project_path)
        ai_name, ai_model = self._resolve_ai_params(ai_name, ai_model)

        # 予測専用の制約は通常の permissions=none と別扱い。初期化・CLI起動より前に確認。
        prediction_readonly = bool(getattr(実行オプション, "CLI読取専用", False))
        if prediction_readonly:
            from AIコア.AI実行オプション import 読取専用CLI対応方式
        if prediction_readonly and (ai_name not in 読取専用CLI対応方式 or self_check_loop > 0):
            return {
                "status": "NG",
                "result": "! 指定CLIまたは自己検証ループは予測用の読取専用実行に未対応です。",
                "prediction_readonly_unavailable": True,
                "project_path": resolved_path, "ai_name": ai_name, "ai_model": ai_model,
                "prompt_length": len(prompt),
            }

        # 利用不可の AI が指定された場合は早期リターン
        if ai_name in self.version_info and not self.version_info[ai_name].get("ok"):
            reason = self.version_info[ai_name].get("version", "利用不可")
            return {
                "status": "NG",
                "result": f"! ai_name='{ai_name}' は利用できません: {reason}",
                "project_path": resolved_path,
                "ai_name": ai_name,
                "ai_model": ai_model,
                "prompt_length": len(prompt),
            }

        try:
            from AIコア.AIコード import CodeAgent  # noqa: PLC0415
        except Exception as e:
            raise CodeAgentsError(f"AIコード.py のインポートに失敗しました: {e}") from e

        agent = CodeAgent(
            セッションID="mcp_session",
            チャンネル="mcp",
            絶対パス=resolved_path,
            AI_NAME=ai_name,
            AI_MODEL=ai_model,
            接続=_NullConnection({
                "CODE_BASE_PATH": resolved_path,
                "CODE_PERMISSIONS": code_permissions,
            }),
            保存関数=None,
            実行オプション=実行オプション,
        )
        # HTTP / MCP 呼び出し側が指定した persona などのシステム指示を、
        # CodeAgent が生成する CodeAI インスタンスへ確実に引き継ぐ。
        if isinstance(system_instruction, str) and system_instruction.strip():
            agent.システム指示 = system_instruction.strip()

        ai_instance = await agent._ensure_ai_instance()
        if not ai_instance:
            return {
                "status": "NG",
                "result": f"! AIインスタンスの初期化に失敗しました (ai_name={ai_name})",
                "project_path": resolved_path,
                "ai_name": ai_name,
                "ai_model": ai_model,
                "prompt_length": len(prompt),
            }

        self_check_updated = False
        self_check_files: list[str] = []
        try:
            result_text = await ai_instance.実行(
                要求テキスト=prompt,
                絶対パス=resolved_path,
                タイムアウト秒数=timeout_sec,
                resume=resume,
            )
            selected_model = getattr(ai_instance, "最終実行モデル", "")

            if self_check_loop > 0 and _応答結果(result_text)[1] == "OK":
                self_check_updated = await agent._バックアップ検証ループ(ai_instance, self_check_loop)
                self_check_files = list(agent.累積変更ファイル)
        except Exception as e:
            from AIコア.AI応答 import エラー応答
            result_text = エラー応答(e)
            selected_model = getattr(ai_instance, "最終実行モデル", "")
        finally:
            await ai_instance.終了()

        result_text, result_status = _応答結果(result_text)
        result = {
            "status": result_status,
            "result": result_text,
            "project_path": resolved_path,
            "ai_name": ai_name,
            "ai_model": ai_model,
            "prompt_length": len(prompt),
            "self_check_loop": self_check_loop,
            "selected_model": selected_model,
            "self_check_updated": self_check_updated,
            "self_check_files": self_check_files,
        }
        if prediction_readonly:
            result["prediction_readonly_unavailable"] = bool(getattr(ai_instance, "予測読取専用利用不可", False))
        return result
