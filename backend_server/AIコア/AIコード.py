# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""
AIコア コードエージェント処理プロセッサ
非同期キューでコード要求を受け取り、AI応答を生成してWebSocketへ返す
エージェント1-4（チャンネル1-4）専用
"""

import asyncio
import importlib
import json
import os
import shutil
import random
import stat
import hashlib
from typing import Optional, Any
from types import ModuleType
from AIコア.AIバックアップ import コードベース絶対パス取得
from AIコア.AIバックアップ実行 import バックアップ完了待機
from AIコア.AIストリーム制御 import AIストリーム開始, AIストリーム終了, AIストリーム中断

from AIコア.AIファイルプレビュー import 画像プレビュー生成
from AIコア.AI要求相関 import ナビ要求相関
from AIコア.AI応答 import 応答正規化, エラー応答, エラー応答判定
from AIコア.AI履歴コンテキスト import 履歴要求コピー, 履歴要求コンテキスト, セッション履歴パス
from AIコア.AI実行オプション import AI実行オプション, 既定実行オプション, 接続適用, 保存関数適用
from log_config import get_logger

logger = get_logger(__name__)

_生成画像走査上限 = 2000
_生成画像通知上限 = 20
_生成画像読込上限 = 16 * 1024 * 1024

_CODE_CONTEXT_JSON_PATH = os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "_config", "AiDiy_code__context.json")
)

_CODE_CONTEXT_TEMPLATE_LINES = [
    "あなたは、美しい日本語を話す、賢いコードエージェントです。",
    "このプロジェクトの概要は _AIDIY.md を確認してください。",
    "上記以外の *.md の記載内容は必要に応じて確認してください。",
    "概要が不明な場合は、プログラムコードの説明、分析、実装支援を行います。",
    "機能追加、修正操作時は、同類のソースを参考にしてください。",
    "AiDiy自体の改造時、reboot_core.txt,reboot_apps.txtでシステム再起動できますが、再起動はユーザー判断にゆだねてください。"
]


def _context_template_payload() -> dict:
    return {
        "version": 1,
        "description": "AIコア CodeAI 定型コンテキスト",
        "system_instruction_lines": _CODE_CONTEXT_TEMPLATE_LINES,
    }


def _compose_instruction(lines: list[str]) -> str:
    text = "\n".join(lines)
    if not text.endswith("\n"):
        text += "\n"
    return text


def _load_or_create_code_context() -> str:
    """CodeAI定型コンテキストを読み込む。無ければひな形JSONを作成。"""
    template_payload = _context_template_payload()
    template_instruction = _compose_instruction(template_payload["system_instruction_lines"])

    try:
        os.makedirs(os.path.dirname(_CODE_CONTEXT_JSON_PATH), exist_ok=True)

        if not os.path.exists(_CODE_CONTEXT_JSON_PATH):
            with open(_CODE_CONTEXT_JSON_PATH, "w", encoding="utf-8") as f:
                json.dump(template_payload, f, indent=2, ensure_ascii=False)
            logger.info(f"[CodeAgent] 定型コンテキストJSONを作成: {_CODE_CONTEXT_JSON_PATH}")
            return template_instruction

        with open(_CODE_CONTEXT_JSON_PATH, "r", encoding="utf-8-sig") as f:
            payload = json.load(f)

        lines = payload.get("system_instruction_lines") if isinstance(payload, dict) else None
        if isinstance(lines, list):
            normalized = [str(line) for line in lines]
            return _compose_instruction(normalized)

        logger.warning(f"[CodeAgent] 定型コンテキストJSONの形式不正。ひな形を再作成します: {_CODE_CONTEXT_JSON_PATH}")
        with open(_CODE_CONTEXT_JSON_PATH, "w", encoding="utf-8") as f:
            json.dump(template_payload, f, indent=2, ensure_ascii=False)
        return template_instruction
    except Exception as e:
        logger.error(f"[CodeAgent] 定型コンテキスト読込エラー: {e}")
        return template_instruction


def _バックアップ保存版パス確認(保存先: str) -> Optional[str]:
    """元の保存先か、同じ親内でコメントを追記した保存版を確認する。"""
    parent, name = os.path.split(保存先)
    try:
        with os.scandir(parent) as entries:
            for entry in entries:
                if (entry.name == name or entry.name.startswith(name + ".")) and entry.is_dir(follow_symlinks=False):
                    return entry.path
    except OSError:
        pass
    return None


class CodeAgent:
    """コードエージェント処理クラス（キュー処理）- エージェント1-4（チャンネル1-4）専用"""

    def __init__(
        self,
        親=None,
        セッションID: str = "",
        チャンネル: str = "0",
        絶対パス: str = "",
        AI_NAME: str = "",
        AI_MODEL: str = "",
        接続=None,
        保存関数=None,
        実行オプション: Optional[AI実行オプション] = None,
    ):
        self.セッションID = セッションID
        self.チャンネル = チャンネル
        # 会話継続は CodeAI が自身のオプションで resume を判定する。
        self.実行オプション = 実行オプション or 既定実行オプション
        self.接続 = 接続適用(接続, self.実行オプション)
        self.保存関数 = 保存関数適用(保存関数, self.実行オプション)
        self.AI_NAME = AI_NAME
        self.AI_MODEL = AI_MODEL
        self.絶対パス = 絶対パス
        self.親 = 親
        self.システム指示 = _load_or_create_code_context()
        self.AIモジュール = self._select_ai_module()
        self.AIインスタンス = None
        self.is_alive = False
        self.コード処理Ｑ = asyncio.Queue()
        self.worker_task: Optional[asyncio.Task] = None
        self.会話履歴 = []  # エージェント専用の会話履歴
        self.累積変更ファイル: list[str] = []  # 検証対象ファイルを累積
        self._累積変更ファイルキー: set[str] = set()  # パス正規化キーで重複排除
        self.強制停止フラグ = False  # cancel_run用
        self.現在タスク: Optional[asyncio.Task] = None  # 実行中の処理タスク
        self.要求タスク: Optional[asyncio.Task] = None  # 検証・自己改善を含む要求全体
        self._停止ロック = asyncio.Lock()

    def _配下パス判定(self, 対象パス: str, 基準パス: str) -> bool:
        """対象パスが基準パス配下（同一含む）かを返す"""
        if not 対象パス or not 基準パス:
            return False
        try:
            return os.path.commonpath([os.path.abspath(対象パス), os.path.abspath(基準パス)]) == os.path.abspath(基準パス)
        except ValueError:
            return False

    def _添付ファイルパス解決(self, ファイルパス: str) -> Optional[str]:
        """
        添付ファイルの実パスを解決する。
        - 現在の実行プロジェクト配下ならそのまま返す
        - backend_server/temp 配下で、かつ実行プロジェクト外なら実行先 temp 配下へコピーして返す
        """
        if not ファイルパス:
            return None

        絶対元パス = os.path.abspath(ファイルパス)
        if not os.path.exists(絶対元パス):
            logger.warning(f"[CodeAgent] 添付ファイルが見つかりません: {ファイルパス}")
            return None

        実行基準パス = os.path.abspath(self.絶対パス) if self.絶対パス else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        if self._配下パス判定(絶対元パス, 実行基準パス):
            return 絶対元パス

        backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        backend_temp_dir = os.path.join(backend_dir, "temp")
        if not self._配下パス判定(絶対元パス, backend_temp_dir):
            return 絶対元パス

        try:
            相対パス = os.path.relpath(絶対元パス, backend_dir)
            コピー先パス = os.path.abspath(os.path.join(実行基準パス, 相対パス))

            if os.path.normcase(os.path.normpath(絶対元パス)) == os.path.normcase(os.path.normpath(コピー先パス)):
                return 絶対元パス

            os.makedirs(os.path.dirname(コピー先パス), exist_ok=True)

            コピー要否 = True
            if os.path.exists(コピー先パス):
                try:
                    コピー要否 = (
                        os.path.getsize(絶対元パス) != os.path.getsize(コピー先パス)
                        or os.path.getmtime(絶対元パス) > os.path.getmtime(コピー先パス)
                    )
                except OSError:
                    コピー要否 = True

            if コピー要否:
                shutil.copy2(絶対元パス, コピー先パス)
                logger.info(f"[CodeAgent] temp添付ファイルを作業先へコピー: {絶対元パス} -> {コピー先パス}")

            return コピー先パス
        except Exception as e:
            logger.warning(f"[CodeAgent] temp添付ファイルのコピー失敗。元パスを使用します: {絶対元パス} error={e}")
            return 絶対元パス

    def _添付ファイル一覧解決(self, 添付ファイル一覧: list[str]) -> list[str]:
        """添付ファイル一覧を実行可能なパスへ解決する"""
        解決後一覧: list[str] = []
        for ファイルパス in 添付ファイル一覧 or []:
            解決後パス = self._添付ファイルパス解決(ファイルパス)
            if 解決後パス and 解決後パス not in 解決後一覧:
                解決後一覧.append(解決後パス)
        return 解決後一覧

    def _変更ファイルキー(self, ファイルパス: str) -> str:
        """重複判定用の正規化キーを返す"""
        if not ファイルパス:
            return ""
        return os.path.normcase(os.path.normpath(ファイルパス.replace("/", os.sep)))

    def _累積変更ファイル追加(self, 変更ファイル一覧: list[str]) -> int:
        """累積変更ファイルへ重複なしで追加し、追加件数を返す"""
        追加件数 = 0
        for ファイル in 変更ファイル一覧:
            キー = self._変更ファイルキー(ファイル)
            if not キー:
                continue
            if キー in self._累積変更ファイルキー:
                continue
            self._累積変更ファイルキー.add(キー)
            self.累積変更ファイル.append(ファイル)
            追加件数 += 1
        return 追加件数

    def _aidiyフォルダ取得(self) -> str:
        """現在の作業先に対応する _AIDIY/knowledge フォルダの絶対パスを返す"""
        実行基準パス = os.path.abspath(self.絶対パス) if self.絶対パス else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        return os.path.join(実行基準パス, "_AIDIY", "knowledge")

    def _自己改善プロンプト生成(self, 元要求: str, 最終応答: str) -> str:
        """自己改善書き込み依頼のプロンプトを生成する"""
        aidiy_dir = self._aidiyフォルダ取得()
        aidiy_index = os.path.join(aidiy_dir, "_index.md")
        aidiy_last = os.path.join(aidiy_dir, "_最終修正")
        変更ファイル一覧 = "\n".join(f"- {path}" for path in self.累積変更ファイル) if self.累積変更ファイル else "- なし"
        return (
            "自己改善書き込みを実施してください。\n"
            "今回の修正処理は完了済みで、ユーザー向けの完了通知も終わっています。\n"
            "これ以降は、次回以降の改造精度を上げるための知見整理だけを行ってください。\n\n"
            f"作業対象フォルダ: `{aidiy_dir}`\n"
            f"更新必須ファイル: `{aidiy_index}`, `{aidiy_last}`\n"
            "加えて、今回の修正テーマを表す .md を _AIDIY/knowledge 配下に1件以上作成または更新してください。\n"
            "テーマ名は内容がわかる日本語ファイル名にしてください。\n\n"
            "更新内容の要件:\n"
            "1. `_AIDIY/knowledge/_index.md` に今回の修正知見の索引を追記・更新\n"
            "2. `_AIDIY/knowledge/_最終変更.md` に今回の最終変更内容を上書きまたは更新\n"
            "3. テーマ別 .md に、修正内容・関連ファイル・関連箇所・次回の注意点を整理\n"
            "4. 既存の _AIDIY/knowledge 記録があれば読み、重複ではなく知見を統合\n"
            "5. アプリ本体の仕様変更や追加修正は行わず、_AIDIY/knowledge 配下の記録更新だけを実施\n\n"
            f"【今回の依頼】\n{(元要求 or '').strip()}\n\n"
            f"【最終応答】\n{(最終応答 or '').strip()}\n\n"
            f"【変更ファイル一覧】\n{変更ファイル一覧}\n"
        )

    async def _自己改善書き込み実行(self, ai_instance: Any, 元要求: str, 最終応答: str) -> None:
        """検証・通知完了後に _AIDIY/knowledge へ知見を書き込ませる"""
        if エラー応答判定(最終応答):
            return
        if self.強制停止フラグ:
            logger.info(f"[CodeAgent] チャンネル{self.チャンネル} 強制停止中のため自己改善をスキップ")
            return
        if not ai_instance:
            logger.warning(f"[CodeAgent] チャンネル{self.チャンネル} AIインスタンス未初期化のため自己改善をスキップ")
            return
        if not self.累積変更ファイル:
            logger.info(f"[CodeAgent] チャンネル{self.チャンネル} 変更ファイルなしのため自己改善をスキップ")
            return

        aidiy_dir = self._aidiyフォルダ取得()
        try:
            os.makedirs(aidiy_dir, exist_ok=True)
        except Exception as e:
            logger.warning(f"[CodeAgent] _AIDIY/knowledge フォルダ作成エラー: {e}")

        自己改善プロンプト = self._自己改善プロンプト生成(元要求=元要求, 最終応答=最終応答)
        logger.info(f"[CodeAgent] チャンネル{self.チャンネル} 自己改善書き込みを開始: {aidiy_dir}")

        try:
            await self.接続.send_to_channel(self.チャンネル, {
                "セッションID": self.セッションID,
                "メッセージ識別": "output_text",
                "メッセージ内容": "\n【自己改善開始】\n_AIDIY/knowledge の知見整理を継続します。\n"
            })
        except Exception as e:
            logger.warning(f"[CodeAgent] 自己改善開始通知送信エラー: {e}")

        try:
            await self._ストリーム開始通知送信()
            自己改善結果 = await ai_instance.実行(
                要求テキスト=自己改善プロンプト,
                絶対パス=self.絶対パス or None,
            ) or "!"
            await self._ストリーム終了通知送信()

            if not エラー応答判定(自己改善結果):
                await self.接続.send_to_channel(self.チャンネル, {
                    "セッションID": self.セッションID,
                    "メッセージ識別": "output_text",
                    "メッセージ内容": f"\n【自己改善完了】\n{自己改善結果}"
                })
                if self.保存関数:
                    self.保存関数(
                        セッションID=self.セッションID,
                        チャンネル=self.チャンネル,
                        メッセージ識別="output_text",
                        メッセージ内容=f"【自己改善完了】\n{自己改善結果}",
                        ファイル名=None,
                        サムネイル画像=None
                    )
        except Exception as e:
            logger.error(f"[CodeAgent] 自己改善書き込みエラー: {e}")

    def _select_ai_module(self) -> Optional[ModuleType]:
        """AI_NAMEに応じたコードモジュールを選択してインポート"""
        module_name = "AIコア.AIコード_cli"
        if self.AI_NAME == "claude_sdk":
            module_name = "AIコア.AIコード_claude"
        try:
            return importlib.import_module(module_name)
        except Exception as e:
            logger.error(f"[CodeAgent] AIモジュールのインポート失敗: {module_name} error={e}")
            return None

    async def _ensure_ai_instance(self) -> Optional[Any]:
        """AIモジュールのCodeAIインスタンスを生成・開始"""
        if not self.AIモジュール:
            return None
        if self.AIインスタンス:
            if not getattr(self.AIインスタンス, "is_alive", False):
                logger.info(f"[CodeAgent] チャンネル{self.チャンネル} CodeAI停止状態を検出。再開始します")
                try:
                    開始成功 = await self.AIインスタンス.開始()
                    if (開始成功 is False) or (not getattr(self.AIインスタンス, "is_alive", False)):
                        logger.warning(f"[CodeAgent] チャンネル{self.チャンネル} CodeAI再開始失敗。再生成します")
                        self.AIインスタンス = None
                    else:
                        return self.AIインスタンス
                except Exception as e:
                    logger.warning(f"[CodeAgent] チャンネル{self.チャンネル} CodeAI再開始エラー: {e}")
                    self.AIインスタンス = None
            else:
                return self.AIインスタンス
        try:
            CodeAI = getattr(self.AIモジュール, "CodeAI", None)
            if CodeAI is None:
                logger.error("[CodeAgent] CodeAIクラスが見つかりません")
                return None
            self.AIインスタンス = CodeAI(
                親=self,
                セッションID=self.セッションID,
                チャンネル=self.チャンネル,
                AI_NAME=self.AI_NAME,
                AI_MODEL=self.AI_MODEL,
                絶対パス=self.絶対パス or None,
                code_permissions=(
                    (self.接続.モデル設定 or {}).get("CODE_PERMISSIONS", "auto")
                    if self.接続 and hasattr(self.接続, "モデル設定")
                    else "auto"
                ),
                system_instruction=self.システム指示,
                実行オプション=self.実行オプション,
            )
            開始成功 = await self.AIインスタンス.開始()
            if (開始成功 is False) or (not getattr(self.AIインスタンス, "is_alive", False)):
                logger.error(
                    f"[CodeAgent] CodeAI開始失敗: AI={self.AI_NAME} モデル={self.AI_MODEL} "
                    f"セッション={self.セッションID} チャンネル={self.チャンネル}"
                )
                self.AIインスタンス = None
                return None
            return self.AIインスタンス
        except Exception as e:
            logger.error(f"[CodeAgent] CodeAI初期化エラー: {e}")
            self.AIインスタンス = None
            return None

    async def 開始(self) -> None:
        """コード処理ワーカーを開始"""
        self.is_alive = True
        if self.worker_task is None or self.worker_task.done():
            self.worker_task = asyncio.create_task(self._コード処理ワーカー())
            logger.debug(f"[CodeAgent] チャンネル{self.チャンネル} 開始")

    async def 終了(self) -> None:
        """コード処理ワーカーを終了"""
        self.is_alive = False
        if self.worker_task and not self.worker_task.done():
            self.worker_task.cancel()
            try:
                await self.worker_task
            except asyncio.CancelledError:
                pass
        logger.debug(f"[CodeAgent] チャンネル{self.チャンネル} 終了")

    async def 接続時welcome送信(self) -> None:
        """チャンネル接続時にCodeAI初期化を試み、結果をwelcome_textで送信"""
        await asyncio.sleep(0.3)  # welcome_info / 会話履歴の後に送信
        ai_label = f"[{self.AI_NAME or f'Agent{self.チャンネル}'}]"

        try:
            instance = await self._ensure_ai_instance()
            if instance and getattr(instance, "is_alive", False):
                バージョン = getattr(instance, "バージョン", "") or ""
                if バージョン:
                    メッセージ = f"{ai_label}準備できました。({バージョン})"
                else:
                    メッセージ = f"{ai_label}会話準備ができました。"
            else:
                バージョン = getattr(instance, "バージョン", "") if instance else ""
                if not バージョン:
                    ai_name = self.AI_NAME or ""
                    if ai_name in ("claude_sdk", "claude_cli"):
                        tool = "claude code"
                    elif ai_name == "copilot_cli":
                        tool = "copilot"
                    elif ai_name == "antigravity_cli":
                        tool = "antigravity"
                    elif ai_name == "codex_cli":
                        tool = "codex"
                    elif ai_name == "aidiy_hermes":
                        tool = "aidiy_hermes"
                    elif ai_name == "opencode_cli":
                        tool = "opencode"
                    elif ai_name == "grok_cli":
                        tool = "grok"
                    else:
                        tool = ai_name or "コマンド"
                    メッセージ = f"{ai_label}{tool}が利用できません。（{tool}未インストール?)"
                else:
                    メッセージ = f"{ai_label}初期化に失敗しました。"

        except Exception as e:
            logger.error(f"[CodeAgent] 接続時welcome送信エラー: {e}")
            メッセージ = f"{ai_label}初期化に失敗しました。"

        if self.接続:
            try:
                await self.接続.send_to_channel(self.チャンネル, {
                    "セッションID": self.セッションID,
                    "チャンネル": self.チャンネル,
                    "メッセージ識別": "welcome_text",
                    "メッセージ内容": メッセージ,
                    "ファイル名": None,
                    "サムネイル画像": None,
                })
            except Exception as e:
                logger.error(f"[CodeAgent] welcome_text送信エラー: {e}")

    async def 強制停止(self) -> bool:
        async with self._停止ロック:
            return await self._強制停止実行()

    async def _強制停止実行(self) -> bool:
        """
        現在実行中のタスクを強制停止

        Returns:
            True: タスクをキャンセルした
            False: 実行中のタスクがなかった
        """
        # 1. フラグを立てる（互換性のため - subprocess内のポーリング用）
        self.強制停止フラグ = True

        # 2. 実行中のタスクをキャンセル
        現在タスク = self.要求タスク or self.現在タスク
        if 現在タスク and not 現在タスク.done():
            # 即時に中断通知を送信（停止処理完了を待たない）
            await self._中断通知送信()

            # 3. AIインスタンスのis_aliveをFalseに（ストリーム送信を即座に停止）
            if self.AIインスタンス and hasattr(self.AIインスタンス, '強制終了'):
                try:
                    await self.AIインスタンス.強制終了()
                except Exception as e:
                    logger.warning(f"[CodeAgent] AIインスタンス強制終了エラー: {e}")

            # 4. タスクをキャンセル
            現在タスク.cancel()
            try:
                await asyncio.wait_for(asyncio.shield(現在タスク), timeout=5.0)
            except (asyncio.CancelledError, asyncio.TimeoutError):
                pass
            except Exception as e:
                logger.warning(f"[CodeAgent] タスクキャンセル待機エラー: {e}")

            # 5. 次回実行のためにAIインスタンスを再開（claude_sdkはis_aliveをTrueに戻す）
            if self.AIインスタンス and hasattr(self.AIインスタンス, '開始'):
                try:
                    await self.AIインスタンス.開始()
                    logger.info(f"[CodeAgent] チャンネル{self.チャンネル} AIインスタンス再開完了")
                except Exception as e:
                    logger.warning(f"[CodeAgent] AIインスタンス再開エラー: {e}")

            logger.info(f"[CodeAgent] チャンネル{self.チャンネル} 強制停止完了")
            return True

        # 実行中タスクが無くても、前回中断でCodeAIが停止状態なら復帰させる
        if self.AIインスタンス and (not getattr(self.AIインスタンス, "is_alive", False)) and hasattr(self.AIインスタンス, '開始'):
            try:
                await self.AIインスタンス.開始()
                logger.info(f"[CodeAgent] チャンネル{self.チャンネル} 実行タスクなしだがAIインスタンスを再開")
            except Exception as e:
                logger.warning(f"[CodeAgent] 実行タスクなし時のAIインスタンス再開エラー: {e}")

        logger.info(f"[CodeAgent] チャンネル{self.チャンネル} 実行中のタスクなし")
        return False

    async def _ストリーム開始通知送信(self) -> None:
        """ストリーム開始通知をクライアントに送信"""
        try:
            await self.接続.send_to_channel(self.チャンネル, {
                "セッションID": self.セッションID,
                "チャンネル": self.チャンネル,
                "メッセージ識別": "output_stream",
                "メッセージ内容": AIストリーム開始,
                "ファイル名": None,
                "サムネイル画像": None
            })
        except Exception as e:
            logger.error(f"[CodeAgent] ストリーム開始通知送信エラー: {e}")

    async def _ストリーム終了通知送信(self) -> None:
        """ストリーム終了通知をクライアントに送信"""
        try:
            await self.接続.send_to_channel(self.チャンネル, {
                "セッションID": self.セッションID,
                "チャンネル": self.チャンネル,
                "メッセージ識別": "output_stream",
                "メッセージ内容": AIストリーム終了,
                "ファイル名": None,
                "サムネイル画像": None
            })
        except Exception as e:
            logger.error(f"[CodeAgent] ストリーム終了通知送信エラー: {e}")

    async def _中断通知送信(self) -> None:
        """中断通知をクライアントに送信"""
        try:
            await self.接続.send_to_channel(self.チャンネル, {
                "セッションID": self.セッションID,
                "チャンネル": self.チャンネル,
                "メッセージ識別": "output_stream",
                "メッセージ内容": AIストリーム中断,
                "ファイル名": None,
                "サムネイル画像": None
            })
            await self.接続.send_to_channel(self.チャンネル, {
                "セッションID": self.セッションID,
                "チャンネル": self.チャンネル,
                "メッセージ識別": "output_text",
                "メッセージ内容": "! 処理は強制中断しました。",
                "ファイル名": None,
                "サムネイル画像": None
            })
        except Exception as e:
            logger.error(f"[CodeAgent] 中断通知送信エラー: {e}")

    async def コード要求(self, 受信データ: dict) -> None:
        """コード要求をキューに追加（受信データ構造体をそのまま投入）"""
        if not 受信データ:
            return
        await self.コード処理Ｑ.put(履歴要求コピー(self.接続, 受信データ))

    async def _コード処理ワーカー(self) -> None:
        """コード処理ワーカー（キューから取り出して処理）"""
        while self.is_alive:
            try:
                try:
                    受信データ = await asyncio.wait_for(self.コード処理Ｑ.get(), timeout=1.0)
                except asyncio.TimeoutError:
                    await asyncio.sleep(0.2)
                    continue

                if not isinstance(受信データ, dict):
                    continue
                    
                with 履歴要求コンテキスト(self.セッションID, 受信データ.get("プロジェクトパス")):
                    self.履歴処理中 = True
                    try:
                        if 受信データ.get("プロジェクトパス") != セッション履歴パス(self.接続):
                            text = "プロジェクトが変更されたため要求を実行しませんでした。再送してください。"
                            await self.接続.send_to_channel(self.チャンネル, {
                                "セッションID": self.セッションID, "メッセージ識別": "output_text", "メッセージ内容": text, "実行中": False,
                                **ナビ要求相関(受信データ),
                            })
                            if self.保存関数:
                                self.保存関数(セッションID=self.セッションID, チャンネル=self.チャンネル,
                                          メッセージ識別="output_text", メッセージ内容=text)
                            if ナビ要求相関(受信データ):
                                await self.接続.send_to_channel(self.チャンネル, {
                                    "セッションID": self.セッションID, "チャンネル": self.チャンネル,
                                    "メッセージ識別": "output_end", "メッセージ内容": "", "実行中": False,
                                    **ナビ要求相関(受信データ), "navigationStatus": "failed",
                                })
                        else:
                            メッセージ識別 = 受信データ.get("メッセージ識別", "")

                            if メッセージ識別 in ("input_text", "input_request") and 受信データ.get("実行状態通知") is True:
                                await self._実行状態つき要求処理(受信データ)
                            elif メッセージ識別 == "input_text":
                                # テキスト処理: [ECHO]付きoutput_text送信 → 会話履歴保存
                                await self._処理_input_text(受信データ)
                            elif メッセージ識別 == "input_request":
                                # リクエスト処理: 前後処理付きでAI実行
                                await self._処理_input_request(受信データ)
                            elif メッセージ識別 == "input_file":
                                # ファイル処理: temp/outputコピー → output_file送信 → 会話履歴保存
                                await self._処理_input_file(受信データ)
                    finally:
                        self.履歴処理中 = False

                self.コード処理Ｑ.task_done()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"[CodeAgent] チャンネル{self.チャンネル} 処理エラー: {e}")
                await asyncio.sleep(0.2)

    async def _実行状態つき要求処理(self, 受信データ: dict) -> None:
        """途中回答と要求全体の完了を分け、停止後のAI再開まで操作を待たせる。"""
        処理 = self._処理_input_text if 受信データ["メッセージ識別"] == "input_text" else self._処理_input_request
        相関 = ナビ要求相関(受信データ)
        状態 = "failed"  # 完了通知だけでは成功と見なさない。
        await self.接続.send_to_channel(self.チャンネル, {
            "セッションID": self.セッションID, "チャンネル": self.チャンネル,
            "メッセージ識別": "output_stream", "メッセージ内容": AIストリーム開始, "実行中": True,
            **相関,
        })
        self.要求タスク = asyncio.create_task(処理(受信データ))
        try:
            結果 = await self.要求タスク
            if self.強制停止フラグ:
                状態 = "cancelled"
            elif not エラー応答判定(応答正規化(結果)):
                状態 = "succeeded"
        except asyncio.CancelledError:
            状態 = "cancelled"
            if asyncio.current_task().cancelling():
                raise
        finally:
            self.要求タスク = None
            # 強制停止は中断通知を先行送信する。AIの後始末が済むまで完了にしない。
            async with self._停止ロック:
                await self.接続.send_to_channel(self.チャンネル, {
                    "セッションID": self.セッションID, "チャンネル": self.チャンネル,
                    "メッセージ識別": "output_end", "メッセージ内容": "", "実行中": False,
                    **相関, **({"navigationStatus": 状態} if 相関 else {}),
                })

    async def _処理_input_text(self, 受信データ: dict) -> Optional[str]:
        """
        input_text処理:
        1. AI実行 + output_stream/output_text送信
        2. バックアップ検証ループ（self_check_loopで指定回数）
        3. 生成ファイル通知
        4. update_info送信

        asyncio.Taskでラップし、強制停止時にキャンセル可能
        """
        # 強制停止フラグをリセット
        self.強制停止フラグ = False
        # 累積変更ファイルをクリア
        self.累積変更ファイル = []
        self._累積変更ファイルキー = set()

        # タスク化して実行
        self.現在タスク = asyncio.create_task(self._基本AI処理(受信データ))
        try:
            最終応答 = await self.現在タスク
            ai_instance = await self._ensure_ai_instance()
            await self._自己改善書き込み実行(
                ai_instance=ai_instance,
                元要求=受信データ.get("メッセージ内容", ""),
                最終応答=最終応答 or "",
            )
            return 最終応答
        except asyncio.CancelledError:
            # 中断通知は強制停止()で即時送信済み
            logger.info(f"[CodeAgent] チャンネル{self.チャンネル} タスクがキャンセルされました")
        finally:
            self.現在タスク = None

    async def _処理_input_request(self, 受信データ: dict) -> Optional[str]:
        """
        input_request処理:
        1. inputチャンネルへ開始通知（音声付き）
        2. input_text処理（_基本AI処理）- タスク化
        3. output_request送信（チャンネル0へ）
        4. inputチャンネルへ完了通知（音声付き）

        asyncio.Taskでラップし、強制停止時にキャンセル可能
        """
        # 強制停止フラグをリセット
        self.強制停止フラグ = False
        メッセージ内容 = ""
        try:
            メッセージ内容 = 受信データ.get("メッセージ内容", "")

            # 添付ファイル一覧があればメッセージに追記
            添付ファイル一覧 = 受信データ.get("添付ファイル一覧", [])
            if 添付ファイル一覧:
                有効ファイル = self._添付ファイル一覧解決(添付ファイル一覧)
                if 有効ファイル:
                    受信データ["添付ファイル一覧"] = 有効ファイル
                    添付テキスト = "\n``` 添付ファイル\n"
                    for パス in 有効ファイル:
                        添付テキスト += f"{パス}\n"
                    添付テキスト += "```"
                    メッセージ内容 = メッセージ内容 + 添付テキスト
                    受信データ["メッセージ内容"] = メッセージ内容

            # 1. inputチャンネルへ処理開始を連絡
            # 累積変更ファイルをクリア
            self.累積変更ファイル = []
            self._累積変更ファイルキー = set()

            開始メッセージ = (
                f"コードエージェント{self.チャンネル}です。\n"
                f"処理要求を開始しました。\n"
                f"詳細を省き、端的に音声で処理の開始を伝えてください。\n"
                f"``` 要求\n"
                f"{メッセージ内容}\n"
                f"```"
            )
            try:
                await self.接続.send_to_channel("input", {
                    "セッションID": self.セッションID,
                    "チャンネル": "input",
                    "メッセージ識別": "input_text",
                    "メッセージ内容": 開始メッセージ
                })
            except Exception as e:
                logger.warning(f"[CodeAgent] inputチャンネルへの開始メッセージ送信エラー: {e}")
            try:
                lp = getattr(self.接続, "live_processor", None)
                if lp and getattr(getattr(lp, "AIインスタンス", None), "live_session", None):
                    await lp.開始()
                    await lp.テキスト送信(開始メッセージ)
            except Exception as e:
                logger.warning(f"[CodeAgent] LiveAI開始メッセージ送信エラー: {e}")

            # 2. 基本AI処理（タスク化して実行）
            self.現在タスク = asyncio.create_task(self._基本AI処理(受信データ))
            try:
                出力メッセージ内容 = await self.現在タスク
            except asyncio.CancelledError:
                # 中断通知は強制停止()で即時送信済み
                logger.info(f"[CodeAgent] チャンネル{self.チャンネル} タスクがキャンセルされました(request)")
                # 中断メッセージをinputチャンネルへ通知
                中断メッセージ = (
                    f"コードエージェント{self.チャンネル}です。\n"
                    f"処理要求が中断されました。\n"
                )
                try:
                    await self.接続.send_to_channel("input", {
                        "セッションID": self.セッションID,
                        "チャンネル": "input",
                        "メッセージ識別": "input_text",
                        "メッセージ内容": 中断メッセージ
                    })
                except Exception:
                    pass
                return
            finally:
                self.現在タスク = None

            # 3. output_request送信（チャンネル0へ）
            await self.接続.send_to_channel("0", {
                "セッションID": self.セッションID,
                "メッセージ識別": "output_request",
                "メッセージ内容": 出力メッセージ内容,
                "ファイル名": None,
                "サムネイル画像": None
            })

            # 会話履歴保存（チャンネル0）
            if self.保存関数:
                self.保存関数(
                    セッションID=self.セッションID,
                    チャンネル="0",
                    メッセージ識別="output_request",
                    メッセージ内容=出力メッセージ内容,
                    ファイル名=None,
                    サムネイル画像=None
                )

            # 4. inputチャンネルへ処理終了を連絡
            完了メッセージ = (
                f"コードエージェント{self.チャンネル}です。\n"
                f"処理要求が完了しました。\n"
                f"詳細を省き、端的に音声で処理の完了を伝えてください。\n"
                f"``` 要求\n"
                f"{メッセージ内容}\n"
                f"```\n"
                f"``` 結果\n"
                f"{出力メッセージ内容}\n"
                f"```"
            )
            try:
                await self.接続.send_to_channel("input", {
                    "セッションID": self.セッションID,
                    "チャンネル": "input",
                    "メッセージ識別": "input_text",
                    "メッセージ内容": 完了メッセージ
                })
            except Exception as e:
                logger.warning(f"[CodeAgent] inputチャンネルへの完了メッセージ送信エラー: {e}")
            try:
                lp = getattr(self.接続, "live_processor", None)
                if lp and getattr(getattr(lp, "AIインスタンス", None), "live_session", None):
                    await lp.開始()
                    await lp.テキスト送信(完了メッセージ)
            except Exception as e:
                logger.warning(f"[CodeAgent] LiveAI完了メッセージ送信エラー: {e}")

            ai_instance = await self._ensure_ai_instance()
            await self._自己改善書き込み実行(
                ai_instance=ai_instance,
                元要求=受信データ.get("メッセージ内容", ""),
                最終応答=出力メッセージ内容,
            )
            return 出力メッセージ内容

        except Exception as e:
            logger.error(f"[CodeAgent] チャンネル{self.チャンネル} input_request処理エラー: {e}")

    async def _基本AI処理(self, 受信データ: dict) -> str:
        """
        基本AI処理（input_text/input_request共通）:
        1. ストリーム開始通知
        2. AI実行 + output_text送信
        3. ストリーム終了通知
        4. バックアップ検証ループ（self_check_loopで指定回数）
        5. 生成ファイル通知
        6. update_info送信

        Returns:
            出力メッセージ内容（output_requestで使用）
        """
        出力メッセージ内容 = ""
        受信種別 = ""
        # 同じプロジェクトで並行する別要求との厳密な生成者識別ではなく、要求前後の変更だけを見る。
        生成画像開始時 = self._生成画像一覧取得()
        ai_instance = None
        try:
            メッセージ内容 = 受信データ.get("メッセージ内容", "")
            受信種別 = 受信データ.get("メッセージ識別", "")

            # 添付ファイル一覧があればメッセージに追記
            添付ファイル一覧 = 受信データ.get("添付ファイル一覧", [])
            if 添付ファイル一覧:
                有効ファイル = self._添付ファイル一覧解決(添付ファイル一覧)
                if 有効ファイル:
                    受信データ["添付ファイル一覧"] = 有効ファイル
                    添付テキスト = "\n``` 添付ファイル\n"
                    for パス in 有効ファイル:
                        添付テキスト += f"{パス}\n"
                    添付テキスト += "```"
                    メッセージ内容 = メッセージ内容 + 添付テキスト
                    logger.info(f"[CodeAgent] 添付ファイル追記: {len(有効ファイル)}件")
            else:
                # 60s以内のファイルがなく、ファイルパネルで選択中のパスがある場合はメッセージに追加
                選択ファイル情報 = 受信データ.get("選択ファイル情報")
                if 選択ファイル情報:
                    メッセージ内容 = メッセージ内容 + f"\n[{選択ファイル情報}]"
                    logger.info(f"[CodeAgent] 選択ファイル情報をメッセージに追加: {選択ファイル情報}")

            # 処理要求ログ
            セッションID_短縮 = self.セッションID[:10] if self.セッションID else '不明'
            logger.info(f"[CodeAgent] 実行パス: {self.絶対パス}")
            logger.info(
                f"処理要求: チャンネル={self.チャンネル}, ソケット={セッションID_短縮}...,\n{メッセージ内容.rstrip()}\n"
            )

            # ストリーム開始通知
            await self._ストリーム開始通知送信()

            # AI実行
            try:
                ai_instance = await self._ensure_ai_instance()
                if ai_instance:
                    出力メッセージ内容 = await ai_instance.実行(
                        要求テキスト=メッセージ内容,
                        絶対パス=self.絶対パス or None,
                    )
            except Exception as e:
                logger.error(f"[CodeAgent] AI実行エラー: {e}")
                出力メッセージ内容 = エラー応答(e)
            出力メッセージ内容 = 応答正規化(出力メッセージ内容)

            # 強制停止フラグチェック → 中断通知は強制停止()で送信済みなのでここでは戻り値のみ設定
            if self.強制停止フラグ:
                logger.info(f"[CodeAgent] チャンネル{self.チャンネル} 強制停止フラグ検出（AI実行後）")
                出力メッセージ内容 = "! 処理は強制中断しました。"
                # _中断通知送信は強制停止()で既に送信済みのため、ここでは呼ばない
                return 出力メッセージ内容

            # ストリーム終了通知
            await self._ストリーム終了通知送信()

            # 処理応答ログ
            logger.info(
                f"処理応答: チャンネル={self.チャンネル}, ソケット={セッションID_短縮}...,\n{出力メッセージ内容.rstrip()}\n"
            )

            # output_text送信（自チャンネル）
            await self.接続.send_to_channel(self.チャンネル, {
                "セッションID": self.セッションID,
                "メッセージ識別": "output_text",
                "メッセージ内容": 出力メッセージ内容
            })

            # 会話履歴保存（自チャンネル）
            if self.保存関数:
                self.保存関数(
                    セッションID=self.セッションID,
                    チャンネル=self.チャンネル,
                    メッセージ識別="output_text",
                    メッセージ内容=出力メッセージ内容,
                    ファイル名=None,
                    サムネイル画像=None
                )

            # 要求ごとの検証回数。未指定の既存クライアントはセッション設定を使う。
            今回更新あり = False
            try:
                セッション設定 = self.接続.モデル設定 if self.接続 and hasattr(self.接続, "モデル設定") else None
                try:
                    self_check_loop = int(セッション設定.get("CODE_SELF_CHECK_LOOP", 1)) if isinstance(セッション設定, dict) else 1
                except (TypeError, ValueError):
                    self_check_loop = 1
                if "self_check_loop" in 受信データ:
                    try:
                        self_check_loop = max(0, min(3, int(受信データ["self_check_loop"])))
                    except (TypeError, ValueError, OverflowError):
                        pass  # 不正な指定はセッション設定へフォールバック
                if self_check_loop > 0 and not エラー応答判定(出力メッセージ内容):
                    logger.info(f"[CodeAgent] バックアップ検証ループを開始します（最大{self_check_loop}回）")
                    今回更新あり = await self._バックアップ検証ループ(ai_instance, self_check_loop)
                    logger.info(f"[CodeAgent] バックアップ検証ループ完了: 更新あり={今回更新あり}")
                else:
                    logger.info("[CodeAgent] self_check_loop=0 のためバックアップ・検証をスキップします")
            except Exception as e:
                logger.error(f"[CodeAgent] バックアップ検証ループエラー: {e}")

            # この要求中に実行プロジェクトで作成・更新された画像を自チャンネルに通知
            try:
                通知先 = [self.チャンネル]
                if 受信種別 == "input_request" and self.チャンネル != "0":
                    通知先.append("0")
                await self._生成ファイル通知(生成画像開始時, ai_instance, 通知先)
            except Exception as e:
                logger.error(f"[CodeAgent] 生成ファイル通知エラー: {e}")

            # update_info送信（今回更新があった場合のみ）
            if 今回更新あり:
                try:
                    通知チャンネル一覧 = [self.チャンネル]
                    # input_text経由の処理はチャット側（チャンネル0）にも更新完了を通知
                    if 受信種別 == "input_text" and self.チャンネル != "0":
                        通知チャンネル一覧.append("0")
                    await self._update_info送信(通知チャンネル一覧=通知チャンネル一覧)
                except Exception as e:
                    logger.error(f"[CodeAgent] update_info送信エラー: {e}")

        except Exception as e:
            logger.error(f"[CodeAgent] 基本AI処理エラー: {e}")
            出力メッセージ内容 = エラー応答(e)

        return 応答正規化(出力メッセージ内容)

    async def _バックアップ検証ループ(self, ai_instance: Any, 最大ループ回数: int = 1) -> bool:
        """バックアップ→検証→修正を繰り返すシンプルループ（最大回数はself_check_loopで指定）"""


        # CLI / SDK の実行先とバックアップ対象を一致させる。
        backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        アプリ設定 = getattr(self.親, "conf", None)
        セッション設定 = dict(getattr(self.接続, "モデル設定", None) or {})
        if self.絶対パス:
            セッション設定["CODE_BASE_PATH"] = self.絶対パス
        実行パス = コードベース絶対パス取得(
            アプリ設定=アプリ設定, backend_dir=backend_dir, セッション設定=セッション設定
        )
        セッション設定["CODE_BASE_PATH"] = 実行パス
        今回更新あり = False

        logger.info(f"[検証ループ] 開始（最大{最大ループ回数}回）")

        # 初回バックアップ前に少し待機（ファイル書き込み完了を待つ）
        await asyncio.sleep(0.5)

        for n in range(1, 最大ループ回数 + 1):
            # 強制停止フラグチェック
            if self.強制停止フラグ:
                logger.info(f"[検証ループ] 強制停止フラグ検出 → 検証中断")
                break

            # 同じ実行先で初回全件・以後差分を保存する。
            logger.debug(f"[検証{n}回目] バックアップ実行を呼び出します")
            result = await バックアップ完了待機(アプリ設定=アプリ設定, backend_dir=backend_dir, セッション設定=セッション設定)
            if self.強制停止フラグ:
                logger.info("[検証ループ] バックアップ待機中に停止 → 検証中断")
                break
            
            # エラー → 終了
            if result is None:
                logger.info(f"[検証{n}回目] バックアップエラー → 検証終了")
                break
            
            最終時刻, 全ファイル, 差分ファイル, 全件フラグ, バックアップフォルダ = result

            # 差分なし → 終了
            if not 差分ファイル:
                logger.info(f"[検証{n}回目] 差分なし → 検証終了")
                break

            今回更新あり = True
            
            # 累積変更ファイルに追加
            追加件数 = self._累積変更ファイル追加(差分ファイル)
            logger.info(f"[検証{n}回目] 総ファイル数={len(全ファイル)}, 差分={len(差分ファイル)}件, 累積={len(self.累積変更ファイル)}件, 全件={全件フラグ}")
            
            # 検証メッセージ送信
            logger.info(f"[検証{n}回目] バックアップ保存先: {バックアップフォルダ}")
            
            await self.接続.send_to_channel(self.チャンネル, {
                "セッションID": self.セッションID,
                "メッセージ識別": "output_text",
                "メッセージ内容": f"\n【検証開始】({n}回目)\n\n"
            })

            # 検証プロンプト
            プロンプトファイル一覧 = "\n".join(f"- {f}" for f in 差分ファイル)
            検証プロンプト = (
                f"【{n}回目の検証】\n"
                f"プロジェクトルート（差分ファイルの基準）: {実行パス}\n"
                f"バックアップ保存先（絶対パス）: {バックアップフォルダ}\n"
                f"バックアップ親フォルダ（絶対パス）: {os.path.dirname(バックアップフォルダ)}\n\n"
                f"差分ファイル{len(差分ファイル)}件:\n{プロンプトファイル一覧}\n\n"
                f"上記の既存バックアップフォルダの名前に、変更内容を .コメント として追記してください。\n"
                f"リネームは上記の親フォルダ内だけで行い、先頭の時刻と .all があればそれも維持してください。\n"
                f"バックアップフォルダや保存済みファイルを別の場所へ移動・複製・新規作成しないでください。\n"
                f"_AIDIY/backup へは保存・移動しないでください。\n"
                f"ファイルの検証を行い、問題があれば修正してください。\n"
                f"問題がなければ「検証完了」とだけ回答してください。"
            )

            # ストリーム開始通知（検証）
            await self._ストリーム開始通知送信()

            # AI検証実行
            検証結果 = await ai_instance.実行(
                要求テキスト=検証プロンプト,
                変更ファイル一覧=差分ファイル,
                絶対パス=実行パス,
            ) or "!"

            検証結果 = 応答正規化(検証結果)
            検証後保存先 = _バックアップ保存版パス確認(バックアップフォルダ)
            if 検証後保存先:
                logger.info(f"[検証{n}回目] 検証後バックアップ保存先: {検証後保存先}")
            else:
                logger.warning(
                    f"[検証{n}回目] 検証後にバックアップ保存版が元の親フォルダ内に見つかりません"
                    f"（保存時: {バックアップフォルダ}）"
                )

            # ストリーム終了通知（検証）
            await self._ストリーム終了通知送信()

            # 検証結果送信
            await self.接続.send_to_channel(self.チャンネル, {
                "セッションID": self.セッションID,
                "メッセージ識別": "output_text",
                "メッセージ内容": 検証結果
            })
            
            # 会話履歴保存
            if self.保存関数:
                self.保存関数(
                    セッションID=self.セッションID,
                    チャンネル=self.チャンネル,
                    メッセージ識別="output_text",
                    メッセージ内容=検証結果,
                    ファイル名=None,
                    サムネイル画像=None
                )

            if エラー応答判定(検証結果):
                return False

        # 検証完了メッセージ送信（強制停止でなく、かつ検証を実行した場合のみ）
        if not self.強制停止フラグ and 今回更新あり:
            await self.接続.send_to_channel(self.チャンネル, {
                "セッションID": self.セッションID,
                "メッセージ識別": "output_text",
                "メッセージ内容": "\n【検証完了】\n\n"
            })

        return 今回更新あり

    @staticmethod
    def _生成画像属性(info) -> tuple:
        # Windows の st_ctime_ns は lstat と fstat で意味が異なるため照合に使わない。
        if os.name == "nt":
            return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns)
        return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)

    @staticmethod
    def _生成画像安全パス(root: str, relative: str) -> Optional[str]:
        """現在のプロジェクトから外へ出るパス・途中のリンクを使わない。"""
        path = os.path.abspath(os.path.join(root, relative))
        try:
            if os.path.commonpath([root, path]) != root:
                return None
            current = root
            for part in os.path.relpath(path, root).split(os.sep):
                current = os.path.join(current, part)
                if os.path.islink(current):
                    return None
            if os.path.commonpath([root, os.path.realpath(path)]) != root:
                return None
        except (OSError, ValueError):
            return None
        return path

    def _生成画像一覧取得(self) -> Optional[tuple]:
        """生成対象4フォルダの限定走査。上限・読取失敗時は差分全体を無効にする。"""
        if not self.絶対パス or not os.path.isabs(self.絶対パス):
            return None
        root = os.path.realpath(self.絶対パス)
        images = {}
        count = 0
        try:
            if not os.path.isdir(root):
                return None
            pending = []
            for relative in ("output", "temp/output", "images", "assets"):
                path = self._生成画像安全パス(root, relative)
                if path and os.path.isdir(path):
                    pending.append(path)
            while pending:
                folder = pending.pop()
                if not self._生成画像安全パス(root, os.path.relpath(folder, root)):
                    continue
                with os.scandir(folder) as entries:
                    for entry in entries:
                        count += 1
                        if count > _生成画像走査上限:
                            logger.warning("[CodeAgent] 生成画像の走査上限を超えたため通知を省略")
                            return None
                        if entry.is_symlink():
                            continue
                        relative = os.path.relpath(entry.path, root)
                        if not self._生成画像安全パス(root, relative):
                            continue
                        if entry.is_dir(follow_symlinks=False):
                            pending.append(entry.path)
                        elif os.path.splitext(entry.name)[1].lower() in (".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp"):
                            # Windows の DirEntry.stat は st_dev / st_ino が 0 のため、fstat と照合できる lstat を使う。
                            info = os.lstat(entry.path)
                            if stat.S_ISREG(info.st_mode):
                                images[relative.replace(os.sep, "/")] = self._生成画像属性(info)
            return root, images
        except OSError as error:
            logger.warning(f"[CodeAgent] 生成画像の走査を省略: {error}")
            return None

    async def _生成ファイル通知(self, 開始時: Optional[tuple], ai_instance=None, 通知チャンネル一覧=None) -> None:
        """要求前後の変更画像を現session/channelへ通知する（cwdや直近時刻は使わない）。"""
        if 開始時 is None:
            return
        終了時 = self._生成画像一覧取得()
        if 終了時 is None or 終了時[0] != 開始時[0]:
            return
        root, images = 終了時
        candidates = [path for path, info in images.items() if 開始時[1].get(path) != info]
        explicit = getattr(ai_instance, "last_output_files", None)
        if isinstance(explicit, list) and explicit:
            if len(explicit) > _生成画像通知上限:
                return
            selected = set()
            for path in explicit:
                if not isinstance(path, str):
                    continue
                safe = self._生成画像安全パス(root, path)
                if safe:
                    selected.add(os.path.relpath(safe, root).replace(os.sep, "/"))
            candidates = [path for path in candidates if path in selected]
        if len(candidates) > _生成画像通知上限:
            logger.warning("[CodeAgent] 生成画像の通知上限を超えたため通知を省略")
            return
        for relative in sorted(candidates):
            try:
                path = self._生成画像安全パス(root, relative)
                expected = images[relative]
                if not path or not 0 < expected[2] <= _生成画像読込上限:
                    continue
                # 走査後のリンクへの置換・並行更新を検出して、別ファイルを読み込まない。
                descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
                with os.fdopen(descriptor, "rb") as source:
                    if self._生成画像属性(os.fstat(source.fileno())) != expected:
                        continue
                    if not self._生成画像安全パス(root, relative):
                        continue
                    data = source.read(_生成画像読込上限 + 1)
                    if len(data) != expected[2] or self._生成画像属性(os.fstat(source.fileno())) != expected:
                        continue
                preview = 画像プレビュー生成(data)
                packet = {
                    "セッションID": self.セッションID, "チャンネル": self.チャンネル,
                    "プロジェクトパス": self.絶対パス,
                    "メッセージ識別": "output_file",
                    "メッセージ内容": f"ファイル出力: {os.path.basename(relative)}",
                    "ファイル名": relative, "サムネイル画像": preview,
                    "ファイル版": hashlib.sha256(data).hexdigest(),
                }
                for channel in dict.fromkeys(通知チャンネル一覧 or [self.チャンネル]):
                    outgoing = {**packet, "チャンネル": channel}
                    await self.接続.send_to_channel(channel, outgoing)
                    if self.保存関数:
                        self.保存関数(**{key: value for key, value in outgoing.items() if key != "ファイル版"})
            except (OSError, ValueError) as error:
                logger.warning(f"[CodeAgent] 生成画像通知を省略: {relative}, {error}")

    async def _update_info送信(self, 通知チャンネル一覧=None) -> None:
        """累積変更ファイルがある場合、update_infoメッセージを送信"""
        if not self.累積変更ファイル:
            logger.debug("[CodeAgent] 累積変更ファイルなし、update_info送信スキップ")
            return

        # 相対パス一覧（重複排除）
        相対パス一覧 = list(dict.fromkeys(self.累積変更ファイル))

        if not 通知チャンネル一覧:
            通知チャンネル一覧 = [self.チャンネル]
        送信先チャンネル一覧 = list(dict.fromkeys(通知チャンネル一覧))

        # update_infoメッセージ送信
        for 送信先チャンネル in 送信先チャンネル一覧:
            await self.接続.send_to_channel(送信先チャンネル, {
                "セッションID": self.セッションID,
                "メッセージ識別": "update_info",
                "メッセージ内容": {
                    "update_files": 相対パス一覧
                },
                "ファイル名": None,
                "サムネイル画像": None
            })

        logger.info(
            f"[CodeAgent] update_info送信完了: {len(相対パス一覧)}件のファイル, "
            f"送信先={送信先チャンネル一覧}"
        )

        # 注意: 累積変更ファイルはクリアしない（次回のリクエストでも累積し続ける）
        # クリアが必要な場合は、ユーザーがアプリ再起動またはリセット再起動を実行する


    async def _処理_input_file(self, 受信データ: dict) -> None:
        """input_file処理: temp/outputコピー → output_file送信"""
        try:

            
            # 受信データから相対パスを取得
            入力ファイル名 = 受信データ.get("ファイル名")  # "temp/input/20260128.123456.xxx.png"
            サムネイル = 受信データ.get("サムネイル画像")
            
            if not 入力ファイル名:
                return
            
            if not os.path.exists(入力ファイル名):
                logger.warning(f"[CodeAgent] 入力ファイルが見つかりません: {入力ファイル名}")
                return
            
            # AI処理を模倣（1～10秒のランダムsleep）
            待機時間 = random.uniform(1.0, 10.0)
            await asyncio.sleep(待機時間)
            
            # 同じファイル名でtemp/outputへコピー
            ファイル名のみ = os.path.basename(入力ファイル名)  # "20260128.123456.xxx.png"
            os.makedirs("temp/output", exist_ok=True)
            出力ファイル名 = f"temp/output/{ファイル名のみ}"
            shutil.copyfile(入力ファイル名, 出力ファイル名)
            
            # 1) output_file送信（チャンネル登録されている場合のみ）
            await self.接続.send_to_channel(self.チャンネル, {
                "セッションID": self.セッションID,
                "メッセージ識別": "output_file",
                "メッセージ内容": f"ファイル出力: {ファイル名のみ}",
                "ファイル名": 出力ファイル名,
                "サムネイル画像": サムネイル
            })
            
            # 2) 会話履歴保存
            if self.保存関数:
                self.保存関数(
                    セッションID=self.セッションID,
                    チャンネル=self.チャンネル,
                    メッセージ識別="output_file",
                    メッセージ内容=f"ファイル出力: {ファイル名のみ}",
                    ファイル名=出力ファイル名,
                    サムネイル画像=サムネイル
                )
        except Exception as e:
            logger.error(f"[CodeAgent] チャンネル{self.チャンネル} input_file処理エラー: {e}")
