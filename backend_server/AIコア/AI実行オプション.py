# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""
AIチャット / AIコード 共通の実行オプション
会話継続・履歴保存・ストリーム送信・出力ファイル保存を1か所で指定する。
省略時は従来どおりすべて有効。予測などの使い捨て実行は 単発() を使う。
"""

from dataclasses import dataclass
from typing import Any

読取専用CLI対応方式 = frozenset({"aidiy_hermes", "aidiy_pi", "codex_cli", "copilot_cli", "claude_cli", "grok_cli"})


@dataclass(frozen=True)
class AI実行オプション:
    会話継続: bool = True        # 前回までの会話（ChatAI履歴・CLIセッション）を引き継ぐ
    履歴保存: bool = True        # 保存関数で A会話履歴 へ書き込む
    ストリーム送信: bool = True  # 接続の send_to_channel で画面へ送る
    出力ファイル保存: bool = True  # AIが返した画像などを temp/output へ保存する
    CLI読取専用: bool = False    # 内部予測専用。通常の code_permissions=none とは別の制約

    @classmethod
    def 単発(cls) -> "AI実行オプション":
        """引き継がず・残さず・送らない1回だけの実行。"""
        return cls(会話継続=False, 履歴保存=False, ストリーム送信=False, 出力ファイル保存=False)

    @classmethod
    def 読取専用予測(cls) -> "AI実行オプション":
        """単発予測を、モデルによる変更・副作用ツールを禁止したCLIで実行する。"""
        return cls(
            会話継続=False, 履歴保存=False, ストリーム送信=False,
            出力ファイル保存=False, CLI読取専用=True,
        )


既定実行オプション = AI実行オプション()


def 実行オプション取得(対象: Any) -> AI実行オプション:
    """対象（Chat / CodeAgent / ChatAI / CodeAI）の実行オプション。未設定は既定値。"""
    value = getattr(対象, "実行オプション", None)
    return value if isinstance(value, AI実行オプション) else 既定実行オプション


class 送信無効接続:
    """send_to_channel だけを止め、モデル設定などの参照は元の接続へ委譲する。"""

    def __init__(self, 接続: Any):
        self._接続 = 接続

    async def send_to_channel(self, *args: Any, **kwargs: Any) -> None:
        return None

    def __getattr__(self, name: str) -> Any:
        return getattr(self._接続, name)


def 接続適用(接続: Any, オプション: AI実行オプション) -> Any:
    """ストリーム送信が無効なら送信だけを止めた接続を返す。"""
    if 接続 is None or オプション.ストリーム送信 or isinstance(接続, 送信無効接続):
        return 接続
    return 送信無効接続(接続)


def 保存関数適用(保存関数: Any, オプション: AI実行オプション) -> Any:
    """履歴保存が無効なら保存関数を外す。"""
    return 保存関数 if オプション.履歴保存 else None


def 会話継続適用(インスタンス: Any, completions_tools: Any = None) -> None:
    """ChatAI.実行の先頭で呼ぶ。会話継続が無効なら前回の実行で残った履歴を消す。

    初回の実行前に注入された履歴（completions の messages など）は今回の入力として残す。
    自己ループが completions_tools 付きで呼ぶ内側の実行は同じ要求の途中なので消さない。
    CodeAI は同じ判定を resume=False として扱う。
    """
    if completions_tools or 実行オプション取得(インスタンス).会話継続:
        return
    if getattr(インスタンス, "_実行オプション実行済み", False) and hasattr(インスタンス, "履歴クリア"):
        インスタンス.履歴クリア()
    インスタンス._実行オプション実行済み = True
