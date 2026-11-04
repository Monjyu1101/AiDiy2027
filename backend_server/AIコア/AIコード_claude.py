#!/usr/bin/env python
# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

from AIコア.AI応答 import 応答正規化, エラー応答
from AIコア.AI実行オプション import 既定実行オプション
from log_config import get_logger
logger = get_logger(__name__)

import os
import json
import time
import asyncio
from pathlib import Path
from typing import Optional, Dict

# Claude Agent SDK
import anyio
from claude_agent_sdk import query, ClaudeAgentOptions

# MCP設定ファイルパス（プロジェクトルート _config/AiDiy_mcp.json）
_MCP_CONFIG_PATH = os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "_config", "AiDiy_mcp.json")
)


def _load_mcp_servers() -> Dict[str, dict]:
    """
    AiDiy_mcp.json から mcpServers を読み取る。
    ファイルが無い・読み取り失敗の場合は空dictを返す。
    """
    if not os.path.exists(_MCP_CONFIG_PATH):
        return {}
    try:
        with open(_MCP_CONFIG_PATH, "r", encoding="utf-8-sig") as f:
            payload = json.load(f)
        servers = payload.get("mcpServers", {}) if isinstance(payload, dict) else {}
        if not isinstance(servers, dict):
            return {}
        logger.info(f"[CodeAI] MCP設定読込: {len(servers)}サーバー {list(servers.keys())}")
        return dict(servers)
    except Exception as e:
        logger.error(f"[CodeAI] MCP設定読込エラー: {e}")
        return {}


class CodeAI:
    """
    Claude Agent SDK統合クラス（履歴管理 + SDK resume混合実装）
    """
    
    def __init__(self, 親=None, セッションID: str = "", チャンネル: int = 0, 絶対パス: str = None,
                 AI_NAME: str = "claude", AI_MODEL: str = "sonnet", max_turns: int = 999,
                 code_plan: str = "auto", code_verify: str = "auto", code_permissions: str = "auto",
                 system_instruction: str = None, 実行オプション=None):
        """初期化"""

        # 実行オプション（会話継続・履歴保存・ストリーム送信・出力ファイル保存）
        self.実行オプション = 実行オプション or 既定実行オプション

        # セッションID・チャンネル
        self.セッションID = セッションID
        self.チャンネル = チャンネル

        # 親参照（セッションマネージャー）
        self.parent_manager = 親
        self.親 = 親

        # プロバイダー設定
        self.code_ai = AI_NAME
        self.code_model = AI_MODEL
        self.最終実行モデル = ""
        self.max_turns = max_turns
        self.code_plan = code_plan
        self.code_verify = code_verify
        self.code_permissions = code_permissions if code_permissions in ("auto", "full", "none") else "auto"
        self.system_instruction = system_instruction if isinstance(system_instruction, str) and system_instruction else None
        
        # apiキー設定（Claude Agent SDK用）
        # Claude Agent SDKはキーなしで動作可能
        # 環境変数への保存は行わない（セキュリティ上の理由）
        pass
        
        # 作業ディレクトリ設定
        work_dir_input = 絶対パス if isinstance(絶対パス, str) else None
        if work_dir_input and isinstance(work_dir_input, str):
            work_dir = Path(work_dir_input)
        else:
            work_dir = Path.cwd()

        cwd_str = work_dir.resolve().as_posix()  # "/" 区切りに統一
        self.base_abs_path = cwd_str
        # logger.info(f"作業ディレクトリ設定: {cwd_str}")
        pass
        
        # システムプロンプトを構築（システム情報を含む）
        system_prompt = self._システムプロンプト構築()
        
        # 基本オプション
        self.base_options = {
            "max_turns": max_turns,
            "system_prompt": system_prompt,
            "cwd": cwd_str,
            # 通常時は許可ツールを実行時に指定する
            # "allowed_tools": 指定なし = 全ツール利用可能
            # "permission_mode": CODE_PERMISSIONS=none の場合は指定しない
        }
        
        # 履歴管理システム(ローカル保管)
        self.履歴最終番号 = 0
        self.履歴最終時刻 = time.time()
        self.履歴辞書 = {}
        
        # SDK session管理（WebSocketのセッションIDとは分離）
        self.AIセッションID = None
        
        # 生存状態管理
        self.is_alive = True
        self._停止マーカー送信済み = False
        
        # バージョン管理（変化検出用）
        self.last_version = None

        # バージョン文字列（開始()時に取得）
        self.バージョン: str = ""

        # MCP設定（AiDiy_mcp.json から読み込み）
        self.mcp_servers: Dict[str, dict] = _load_mcp_servers()

        # logger.info(f"初期化:完了 (Claude Agent SDK設定済み, 履歴管理有効)")
        pass
    
    def _システムプロンプト構築(self) -> str:
        """
        システムプロンプトを構築（【システム情報】セクション付き）
        
        Args:
            base_prompt: 基本のシステムプロンプト
            cwd_str: 作業ディレクトリ
            
        Returns:
            システム情報を含む完全なシステムプロンプト
        """
        try:
            if self.system_instruction:
                base_prompt = self.system_instruction.strip()
            else:
                # 上位コンテキスト未定義時（テスト等）は簡素な既定文を使用
                base_prompt = "あなたは、美しい日本語を話す、賢いコードエージェントです。"

            # Windows文言は常に文末へ自動付加（重複は除去）
            if os.name == 'nt':
                windows_suffix = "Windows環境で動作していることを考慮して、適切なコマンドを使用してください。"
                normalized = base_prompt.replace(windows_suffix, "").strip()
                base_prompt = f"{normalized}\n{windows_suffix}" if normalized else windows_suffix

            return base_prompt
            
        except Exception as e:
            logger.error(f"システムプロンプト構築エラー: {e}")
            return base_prompt

    def _aidiy参照プロンプト取得(self, 実行パス: str = None) -> str:
        """_AIDIY/knowledge/_index.md がある場合のみ、知見参照指示を返す"""
        try:
            base_dir = Path(実行パス if 実行パス else self.base_abs_path).resolve()
            index_path = base_dir / "_AIDIY" / "knowledge" / "_index.md"
            if not index_path.exists():
                return ""
            return (
                "\n\n"
                "プロジェクト内のファイル操作するときは、\n"
                "_AIDIY/knowledgeフォルダ並びに_AIDIY/knowledge/_index.mdを確認し、\n"
                "類似の操作の記載があれば知見として利用すること。\n"
                f"参照先: `{index_path.as_posix()}`"
            )
        except Exception as e:
            logger.warning(f"ClaudeSDK _AIDIY/knowledge 参照プロンプト生成エラー: {e}")
            return ""

    async def バージョン確認(self) -> str:
        """claude --version を実行してバージョン文字列を返す。失敗時は空文字。"""
        if os.name == 'nt':
            userprofile = os.environ.get('USERPROFILE', os.path.expanduser('~'))
            cmd = os.path.join(userprofile, 'AppData', 'Roaming', 'npm', 'claude.cmd')
        else:
            cmd = 'claude'
        custom_cmd = os.environ.get('CLAUDE_CLI_PATH')
        if custom_cmd:
            cmd = custom_cmd
        try:
            proc = await asyncio.create_subprocess_exec(
                cmd, "--version",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            try:
                stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=10.0)
            except asyncio.TimeoutError:
                proc.kill()
                await proc.communicate()
                logger.warning(f"[CodeAI] --version タイムアウト: {cmd}")
                return ""
            output = (stdout or b"").decode("utf-8", errors="replace").strip()
            if not output:
                output = (stderr or b"").decode("utf-8", errors="replace").strip()
            first_line = output.splitlines()[0].strip() if output else ""
            logger.info(f"[CodeAI] {cmd} --version => {first_line}")
            return first_line
        except FileNotFoundError:
            logger.warning(f"[CodeAI] コマンドが見つかりません: {cmd}")
            return ""
        except Exception as e:
            logger.warning(f"[CodeAI] --version 実行エラー: {cmd} {e}")
            return ""

    async def 開始(self):
        """コードAI開始（claude --version で利用可能性を確認）"""
        try:
            # SDK resumeセッション初期化（最初の実行時に作成）
            self.AIセッションID = None
            self.is_alive = True
            self.バージョン = await self.バージョン確認()
            if not self.バージョン:
                self.is_alive = False
                return False
            return True
        except Exception as e:
            logger.error(f"CodeAI開始:エラー {e}")
            self.is_alive = False
            return False
    
    async def 終了(self):
        """CodeAI終了"""
        try:
            self.is_alive = False
            # SDK session終了処理は不要（実行ベースのため）
            # logger.info(f"CodeAI: 終了完了 セッションID={self.セッションID[:8]}")
            pass
        except Exception as e:
            logger.error(f"CodeAI終了:エラー {e}")
            self.is_alive = False

    async def 強制終了(self):
        """
        Claude SDKの実行を中断

        Note: Claude SDKはストリーミング実行のため、
        親タスクのキャンセルで自動的に中断される。
        このメソッドは互換性のために用意。
        """
        self.is_alive = False
        logger.info("[CodeAI] Claude SDK強制終了（タスクキャンセルで中断）")

    def _強制停止要求あり(self) -> bool:
        """親側フラグも含めて強制停止要求を判定"""
        if not self.is_alive:
            return True
        if self.parent_manager and getattr(self.parent_manager, "強制停止フラグ", False):
            return True
        return False

    async def _停止マーカー送信(self) -> None:
        """強制停止を1回だけ記録する。CAN 送信は親の CodeAgent が担当する。"""
        if self._停止マーカー送信済み:
            return
        self._停止マーカー送信済み = True
    
    def _履歴追加(self, text: str, type: str):
        """履歴に項目を追加"""
        self.履歴最終番号 += 1
        self.履歴最終時刻 = time.time()
        key = str(self.履歴最終番号)
        
        self.履歴辞書[key] = {
            "seq": str(self.履歴最終番号),
            "time": self.履歴最終時刻,
            "type": type,
            "text": text
        }
        
        # logger.debug(f"履歴追加: {key} ({type}) - {text[:50]}...")
        pass
    
    def _履歴取得(self) -> str:
        """過去の会話履歴を取得してフォーマット"""
        if not self.履歴辞書:
            return ""
        
        履歴テキスト = "【過去の会話履歴】\n"
        
        # 番号順にソートして履歴を構築
        sorted_keys = sorted(self.履歴辞書.keys(), key=lambda x: int(x))
        
        for key in sorted_keys:
            item = self.履歴辞書[key]
            if item["type"] == "system":
                履歴テキスト += f"```system\n{item['text']}\n```\n"
            elif item["type"] == "user":
                履歴テキスト += f"```user\n{item['text']}\n```\n"
            elif item["type"] == "agent":
                履歴テキスト += f"```agent\n{item['text']}\n```\n"
        
        return 履歴テキスト
    
        
    
    async def 実行(self, 要求テキスト: str, タイムアウト秒数: int = 1800,
                   resume: bool = True, 読取専用: bool = False, 絶対パス: str = None, file_path: str = None, 変更ファイル一覧: list = None, 再プラン要求: bool = False) -> str:
        """
        Claude Agent SDK実行（セッション.chatメソッド使用）
        ストリーム出力のみ行い、開始/終了/中断通知は親側で行う

        Args:
            要求テキスト: ユーザーの要求テキスト
            タイムアウト秒数: タイムアウト時間
            resume: セッション継続フラグ
            読取専用: 読取専用モード
            絶対パス: 実行ディレクトリの絶対パス
            file_path: 添付ファイルの絶対パス（オプション）
            変更ファイル一覧: 変更されたファイルのリスト（検証用、オプション）
            再プラン要求: 修正内容の再プラン要求フラグ（オプション）
        """
        # 会話継続が無効な実行オプションでは、呼び出し側の指定に関わらず新しいセッションにする。
        if not self.実行オプション.会話継続:
            resume = False
        try:
            self._停止マーカー送信済み = False
            aidiy_prompt = self._aidiy参照プロンプト取得(絶対パス)
            # 添付ファイルを後段で埋め込むためのブロックを準備（ログには含めない）
            attachment_block = ""
            if file_path:
                try:
                    abs_path = Path(file_path).resolve()
                    path_str = abs_path.as_posix()
                    attachment_block = f"\n\n添付ファイル: `{path_str}`"
                    logger.info(f"ClaudeSDK: 添付ファイルをコンテキストに追加: {path_str}")
                except Exception as e:
                    logger.error(f"ClaudeSDK: ファイルパス処理エラー: {e}")

            # 再プラン要求ブロックを準備
            replan_block = ""
            if 再プラン要求:
                try:
                    replan_block = """

修正が正しいことを検証するために、
修正概要、修正手順を再プランしてください。
"""
                    logger.info("ClaudeSDK: 再プラン要求をプロンプトに追加")
                except Exception as e:
                    logger.error(f"ClaudeSDK: 再プラン要求処理エラー: {e}")

            # 生存状態チェック
            if not self.is_alive:
                logger.warning("ClaudeSDK実行:ClaudeSDKが開始されていません")
                return "! ClaudeSDKが停止状態です。開始してください。"

            # 履歴管理（セッション内で自動管理されるが、独自履歴も維持）
            if not resume:
                self.AIセッションID = None
                self.履歴辞書.clear()
                self.履歴最終番号 = 0
            if len(self.履歴辞書) == 0:
                self._履歴追加(self.base_options["system_prompt"], "system")

            # 最終プロンプトを作成
            # 変更ファイル一覧がある場合は検証モード（元の依頼は実施済みとして検証のみ）
            if 変更ファイル一覧 and len(変更ファイル一覧) > 0:
                try:
                    ファイル一覧文字列 = '\n'.join([f"- {ファイル名}" for ファイル名 in 変更ファイル一覧])
                    最終要求テキスト = f"""前回の依頼「{要求テキスト}」は実施済みです。

以下のファイルが変更されました：
{ファイル一覧文字列}

これらのファイルの変更内容を検証し、問題があれば追加修正を行ってください。
問題がなければ「検証完了」と報告してください。""" + aidiy_prompt + attachment_block + replan_block
                    logger.info(f"ClaudeSDK: 検証モード - 変更ファイル {len(変更ファイル一覧)}件")
                except Exception as e:
                    logger.error(f"ClaudeSDK: 変更ファイル一覧処理エラー: {e}")
                    最終要求テキスト = 要求テキスト + aidiy_prompt + attachment_block + replan_block
            else:
                # 通常モード（順序：元の要求 → _AIDIY/knowledge知見 → 添付ファイル → 再プラン要求）
                最終要求テキスト = 要求テキスト + aidiy_prompt + attachment_block + replan_block

            # 送信コンテキスト側で「今回の依頼」を必ず明示（オリジナルの要求文は改変しない）
            依頼本文 = (最終要求テキスト or "").strip()
            if 依頼本文.startswith("【今回の依頼】"):
                送信用要求テキスト = 依頼本文
            else:
                送信用要求テキスト = f"【今回の依頼】\n{依頼本文}\n"

            if self._強制停止要求あり():
                await self._停止マーカー送信()
                return "!"
            # CLIと同じ判断を使い、設定のautoは維持して今回のSDKオプションだけへ反映する。
            選択モデル = ""
            モデル選択失敗 = False
            実行モデル = (self.code_model or "").strip()
            if 実行モデル.lower() == "auto":
                from AIコア.AIコードモデル選択 import select_model
                選択モデル = await select_model(
                    "claude_cli", self._履歴取得() if self.AIセッションID else "", 送信用要求テキスト,
                )
                モデル選択失敗 = not 選択モデル
                if モデル選択失敗:
                    選択モデル = "sonnet"
                実行モデル = 選択モデル
            self.最終実行モデル = "" if 実行モデル.lower() in ("", "auto", "same") else 実行モデル
            if self._強制停止要求あり():
                await self._停止マーカー送信()
                return "!"
            if 選択モデル and self.parent_manager and hasattr(self.parent_manager, '接続'):
                try:
                    await self.parent_manager.接続.send_to_channel(self.チャンネル, {
                        "セッションID": self.セッションID, "チャンネル": self.チャンネル,
                        "メッセージ識別": "output_stream",
                        "メッセージ内容": (f"[モデル選択失敗: {選択モデル} を使用します]\n" if モデル選択失敗
                                           else f"[選択モデル: {選択モデル}]\n"),
                        "ファイル名": None, "サムネイル画像": None,
                    })
                except Exception:
                    logger.warning("ClaudeSDK選択モデル通知を送信できませんでした")
            if self._強制停止要求あり():
                await self._停止マーカー送信()
                return "!"
            self._履歴追加(最終要求テキスト, "user")

            result_text = ""
            last_stream_time = time.time()
            
            # セッション.chat実行（タイムアウト監視付き）
            try:
                async def _chat_execution():
                    nonlocal result_text, last_stream_time

                    # 作業ディレクトリを決定（パラメータ優先、なければデフォルト）
                    cwd_posix = 絶対パス if 絶対パス else self.base_options["cwd"]

                    # オプション設定（初回はresume=False、2回目以降のみセッションID使用）
                    # 読取専用パラメータに応じてallowed_toolsを設定
                    allowed_tools_list = ["Read", "Write", "Bash"] if not 読取専用 else ["Read"]
                    logger.info(f"ClaudeSDK許可ツール: {allowed_tools_list}, 読取専用={読取専用}, AIセッションID={self.AIセッションID}")

                    # Claude Agent SDK用のパス設定（Windows環境ではパス区切り文字を変換）
                    if os.name == 'nt':
                        cwd = cwd_posix.replace('/', '\\')
                    else:
                        cwd = cwd_posix

                    logger.info(f"ClaudeSDK実行パス: {cwd}")
                    perm_mode = None if self.code_permissions == "none" else "bypassPermissions"
                    if not self.AIセッションID:
                        # 初回：新規セッション作成
                        options_kwargs = {
                            "max_turns": self.base_options["max_turns"],
                            "system_prompt": self.base_options["system_prompt"],
                            "cwd": Path(cwd),
                            "allowed_tools": allowed_tools_list,
                            "continue_conversation": False,
                            "mcp_servers": self.mcp_servers if self.mcp_servers else {},
                        }
                        if perm_mode:
                            options_kwargs["permission_mode"] = perm_mode
                    else:
                        # 継続会話：読取専用パラメータに応じてallowed_toolsを設定
                        options_kwargs = {
                            "max_turns": self.base_options["max_turns"],
                            "system_prompt": self.base_options["system_prompt"],
                            "cwd": Path(cwd),
                            "allowed_tools": allowed_tools_list,  # 毎回正しく設定
                            "continue_conversation": True,
                            "resume": self.AIセッションID,
                            "mcp_servers": self.mcp_servers if self.mcp_servers else {},
                        }
                        if perm_mode:
                            options_kwargs["permission_mode"] = perm_mode
                    if self.最終実行モデル:
                        options_kwargs["model"] = self.最終実行モデル
                    options = ClaudeAgentOptions(**options_kwargs)
                     
                    # テスト用：初回のみ system_prompt、毎回「今回の依頼」（送信用）を標準出力に表示（平文）
                    try:
                        print("\n" + "=" * 80)
                        if not self.AIセッションID:
                            print("送信コンテキスト（Claude Agent SDK / 初回）")
                        else:
                            print("送信コンテキスト（Claude Agent SDK）")
                        print(f"AI={self.code_ai} model={self.code_model} resume={resume} 読取専用={読取専用}")
                        print(f"allowed_tools={allowed_tools_list} permission_mode={perm_mode} cwd={cwd}")
                        if self.mcp_servers:
                            print(f"mcp_servers={list(self.mcp_servers.keys())}")
                        if not self.AIセッションID:
                            print("-" * 80)
                            print("【system_prompt】")
                            print(self.base_options.get("system_prompt", ""))
                        print("-" * 80)
                        print(送信用要求テキスト)
                        print("=" * 80 + "\n")
                    except Exception:
                        pass

                    # queryメソッドで実行（ストリーミング対応）
                    async for message in query(prompt=送信用要求テキスト, options=options):
                        # 強制停止チェック（is_aliveがFalseならストリーム中断）
                        if self._強制停止要求あり():
                            logger.info("[CodeAI] 強制停止要求検出、ストリーム中断")
                            await self._停止マーカー送信()
                            break

                        last_stream_time = time.time()

                        # AIセッションIDを取得・保存（SDK仕様のsession_id属性）
                        if not self.AIセッションID:
                            sdk_id = getattr(message, "session_id", None)
                            if sdk_id:
                                self.AIセッションID = sdk_id
                                # logger.info(f"AIセッションID取得: {self.AIセッションID}")
                                pass

                        # ストリーミングコンテンツを抽出
                        content = self.メッセージ内容抽出(message)

                        # parent_manager経由でoutput_stream送信（ストリーム出力のみ）
                        # 強制停止チェック（送信前にも再確認）
                        if self._強制停止要求あり():
                            logger.info("[CodeAI] 強制停止要求検出、ストリーム送信スキップ")
                            await self._停止マーカー送信()
                            break

                        if content and self.parent_manager and hasattr(self.parent_manager, '接続'):
                            try:
                                await self.parent_manager.接続.send_to_channel(self.チャンネル, {
                                    "セッションID": self.セッションID,
                                    "チャンネル": self.チャンネル,
                                    "メッセージ識別": "output_stream",
                                    "メッセージ内容": content,
                                    "ファイル名": None,
                                    "サムネイル画像": None
                                })
                            except Exception as e:
                                logger.error(f"[CodeClaud] output_stream送信エラー(stream): {e}")

                        # 最終結果を取得
                        if getattr(message, 'is_error', False):
                            result_text = エラー応答(getattr(message, 'result', None) or 'ClaudeSDKの実行に失敗しました。')
                        elif hasattr(message, 'result') and message.result:
                            result_text = str(message.result)
                
                # タイムアウト監視
                async def _timeout_monitor():
                    while True:
                        await asyncio.sleep(1)
                        if self._強制停止要求あり():
                            logger.info("[CodeAI] 強制停止要求検出（monitor）")
                            await self._停止マーカー送信()
                            return "stop_requested"
                        if time.time() - last_stream_time > タイムアウト秒数:
                            raise asyncio.TimeoutError(f"タイムアウト({タイムアウト秒数}秒)")
                
                # 実行とタイムアウト監視を並行実行
                monitor_task = asyncio.create_task(_timeout_monitor())
                execution_task = asyncio.create_task(_chat_execution())
                
                done, pending = await asyncio.wait([execution_task, monitor_task], return_when=asyncio.FIRST_COMPLETED)
                
                for task in pending:
                    task.cancel()
                    try:
                        await task
                    except asyncio.CancelledError:
                        pass
                
                for task in done:
                    if task == monitor_task:
                        monitor_result = task.result()
                        if monitor_result == "stop_requested":
                            result_text = "!"
                        else:
                            raise asyncio.TimeoutError(f"タイムアウト({タイムアウト秒数}秒)")
                
            except asyncio.TimeoutError:
                logger.warning(f"ClaudeSDK タイムアウト ({タイムアウト秒数}秒)")
                result_text = f"! 処理タイムアウト({タイムアウト秒数}秒)が発生しました。"

            except Exception as sdk_error:
                logger.error(f"ClaudeSDK エラー: {sdk_error}")
                result_text = f"! ClaudeSDK実行エラー: {str(sdk_error)}"

            if self._停止マーカー送信済み and result_text.strip() == "":
                result_text = "!"

            # 履歴に結果を追加
            final_result = 応答正規化(result_text)
            self._履歴追加(final_result, "agent")

            return final_result

        except Exception as e:
            # ツールエラーログ（必須）
            セッションID_str = (self.セッションID[:10] + '...') if self.セッションID else '新規'
            logger.error(f"ClaudeSDK実行エラー: {e} 要求=[{要求テキスト[:10]}...] セッション={セッションID_str}")
            エラーメッセージ = f"! 実行エラー: {str(e)}"

            return エラーメッセージ
    
    def メッセージ内容抽出(self, message) -> Optional[str]:
        """メッセージから内容を抽出"""
        try:
            if hasattr(message, 'result') and message.result:
                # 結果はストリームしない（関数戻り値のみ）
                return None
            
            if hasattr(message, 'content') and message.content:
                if hasattr(message.content, '__iter__') and len(message.content) > 0:
                    first_content = message.content[0]
                    if hasattr(first_content, 'text'):
                        return first_content.text
                    elif 'ToolUseBlock' in str(type(first_content).__name__):
                        tool_name = getattr(first_content, 'name', '不明')
                        return f"[{tool_name}実行中...]"
                return str(message.content)
            
            if hasattr(message, 'text') and message.text:
                return message.text
                
            return None
            
        except Exception:
            return None


# ===== 使用例とテストコード =====

async def session_test(AI_NAME="claude", AI_MODEL="sonnet"):
    """
    セッション管理テスト（Claude Agent SDK版）
    - セッション開始
    - 1回目: 近藤の自己紹介
    - 2回目: 名前を覚えているか確認
    - 3回目: Pythonコードの質問
    - 4回目: 続けて質問
    - 履歴表示
    """
    print("=" * 50)
    print("ClaudeSDK セッション管理テスト")
    print("=" * 50)

    # ClaudeSDKインスタンス作成
    codeai = CodeAI(親=None, セッションID="test_session", AI_NAME=AI_NAME, AI_MODEL=AI_MODEL, max_turns=10)

    try:
        # セッション開始
        print("\n[セッション開始]")
        start_result = await codeai.開始()
        print(f"セッション開始結果: {start_result}")

        # 1回目実行
        print("\n[1回目] 自己紹介")
        result1 = await codeai.実行(
            要求テキスト="私の名前は近藤です。覚えておいてください。",
            タイムアウト秒数=30,
            resume=False
        )
        print(f"結果: {result1[:100]}...")
        print(f"履歴件数: {len(codeai.履歴辞書)}件")

        # 2回目実行
        print("\n[2回目] 名前確認")
        result2 = await codeai.実行(
            要求テキスト="私の名前を教えてください",
            タイムアウト秒数=30,
            resume=True
        )
        print(f"結果: {result2[:100]}...")
        print(f"履歴件数: {len(codeai.履歴辞書)}件")

        # 3回目実行
        print("\n[3回目] Pythonコード質問")
        result3 = await codeai.実行(
            要求テキスト="if文の使い方を教えて",
            タイムアウト秒数=30,
            resume=True
        )
        print(f"結果: {result3[:100]}...")
        print(f"履歴件数: {len(codeai.履歴辞書)}件")

        # 4回目実行
        print("\n[4回目] 続けて質問")
        result4 = await codeai.実行(
            要求テキスト="for文との違いは何ですか？",
            タイムアウト秒数=30,
            resume=True
        )
        print(f"結果: {result4[:100]}...")
        print(f"履歴件数: {len(codeai.履歴辞書)}件")

        # 履歴表示
        print("\n[履歴表示]")
        formatted_history = codeai._履歴取得()
        print(formatted_history)

    except Exception as e:
        print(f"エラー: {e}")
        import traceback
        traceback.print_exc()
    finally:
        # セッション終了
        await codeai.終了()

    print("=" * 50)
    print("テスト完了")
    print("=" * 50)


async def simple_test(AI_NAME="claude", AI_MODEL="sonnet"):
    """キューなしのシンプルテスト"""
    print("\n" + "=" * 30)
    print("シンプルテスト開始")
    print("=" * 30)

    # ClaudeSDKインスタンス作成
    codeai = CodeAI(親=None, セッションID="simple_test", AI_NAME=AI_NAME, AI_MODEL=AI_MODEL, max_turns=10)

    try:
        # セッション開始
        await codeai.開始()

        # キューなしでの実行
        result = await codeai.実行("こんにちは、CodeAIです。現在の時刻を教えてください。")
        print(f"シンプル実行結果: {result}")

        # 追加プロンプト：AI に作業をやらせる
        result2 = await codeai.実行("temp/hello.txt というファイルを作成して、Hello World と書いて。")
        print(f"作業実行結果: {result2}")

    except Exception as e:
        print(f"シンプルテストエラー: {e}")
        import traceback
        traceback.print_exc()
    finally:
        await codeai.終了()

    print("=" * 30)
    print("シンプルテスト完了")
    print("=" * 30)


if __name__ == "__main__":

    # プロバイダーとモデルの設定
    AI_NAME, AI_MODEL = "claude_sdk", "sonnet"

    #print("履歴テスト")
    #asyncio.run(session_test(AI_NAME=AI_NAME, AI_MODEL=AI_MODEL))

    print("\nシンプルテスト")
    asyncio.run(simple_test(AI_NAME=AI_NAME, AI_MODEL=AI_MODEL))
