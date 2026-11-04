# -*- coding: utf-8 -*-
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""
runner.py — VideoGenRunner クラス

VideoGenCtx と steps リストを受け取り、ワークフロー全体を実行するランナー。
build_ctx / run_automation_loop の薄いラッパーとして機能する。
"""

from __future__ import annotations

import asyncio
import os
import sys

from .ctx import VideoGenCtx
from .log_config import get_logger, setup_logging
from .infra import (
    build_ctx,
    ensure_steps_json,
    get_completed_step,
    guide_tts,
    post_mcp_method,
    sep,
    step_no_to_value,
)
from .steps import run_automation_loop


class VideoGenRunner:
    """ビデオページ生成ワークフローの実行管理クラス。"""

    def __init__(self, ctx: VideoGenCtx) -> None:
        self.ctx = ctx

    # ------------------------------------------------------------------
    # ファクトリ
    # ------------------------------------------------------------------

    @classmethod
    def from_argv(
        cls,
        argv: list[str],
        script_type: str,
        setting_json_path: str,
        steps_json_path: str,
        *,
        knowledge_paths: dict | None = None,
        use_english_voice: bool = False,
        progress_tts_language: str = "ja",
        progress_tts_provider: str = "edge",
        progress_label_fn=None,
        valid_steps: set | None = None,
        mcp_dir: str = "",
        repo_dir: str = "",
    ) -> "VideoGenRunner":
        """
        設定 JSON と CLI 引数から VideoGenRunner を構築する。

        Parameters
        ----------
        argv : list[str]
            sys.argv 相当のリスト
        script_type : str
            "紹介" / "解説" / "翻訳ja2xx"
        setting_json_path : str
            設定 JSON の絶対パス
        steps_json_path : str
            状況 JSON の絶対パス
        knowledge_paths : dict | None
            追加ナレッジパスの辞書（メインスクリプトから渡す）
        use_english_voice : bool
            True のとき英語 TTS を使用
        progress_tts_language : str
        progress_tts_provider : str
        progress_label_fn : callable | None
        valid_steps : set | None
        mcp_dir : str
        repo_dir : str
        """
        setting_json_name = os.path.basename(setting_json_path)
        steps_json_name = os.path.basename(steps_json_path)

        ctx = build_ctx(
            argv,
            script_type=script_type,
            setting_json_path=setting_json_path,
            setting_json_name=setting_json_name,
            steps_json_path=steps_json_path,
            steps_json_name=steps_json_name,
            steps_keys=(script_type,),
            valid_steps=valid_steps,
            mcp_dir=mcp_dir,
            repo_dir=repo_dir,
            progress_tts_language=progress_tts_language,
            progress_tts_provider=progress_tts_provider,
            use_english_voice=use_english_voice,
            progress_label_fn=progress_label_fn,
        )
        return cls(ctx)

    # ------------------------------------------------------------------
    # 情報表示
    # ------------------------------------------------------------------

    def print_flow(self) -> None:
        """設定情報を標準出力に表示する。"""
        ctx = self.ctx
        script_base = os.path.splitext(os.path.basename(ctx.setting_json_name.replace("_設定.json", "")))[0]
        sep(f"AiDiy Automation: {ctx.script_type}")
        print(f"フォルダ名     : {ctx.folder_name}")
        print(f"言語           : {ctx.language}")
        print(f"トピック       : {ctx.topic}")
        print(f"生成先         : {ctx.output_dir}")
        print(f"テンプレート   : {ctx.template_dir}")
        print(f"実行ステップ   : {step_no_to_value(ctx.start_step)}")
        print(f"ステップ指定   : {'あり' if ctx.step_specified else 'なし（次ステップ自動）'}")

    # ------------------------------------------------------------------
    # 実行
    # ------------------------------------------------------------------

    async def run(self, steps: list, ensure_fn) -> None:
        """
        ステップリストを実行する。

        Parameters
        ----------
        steps : list of (step_no, step_name, async_fn)
            async_fn のシグネチャ: (ca: dict, attempt: int = 1) -> bool
        ensure_fn : callable
            index.html にプレビューパッチを当てる関数
        """
        ctx = self.ctx
        setup_logging(f"video_gen_{ctx.script_type}")
        _logger = get_logger("video_gen.runner")
        _logger.info("=== %s 開始 folder=%s step=%s ===",
                     ctx.script_type, ctx.folder_name, ctx.start_step)
        ensure_steps_json(ctx.steps_json_path, ctx.steps_json_name, (ctx.script_type,))

        completed_step = get_completed_step(ctx)
        if completed_step == "99" and not ctx.step_specified:
            print(f"\n{ctx.steps_json_name} は complete_steps=99 です。完了済みとして終了します。")
            print(f"再実行する場合は complete_steps を \"\" にしてください: {ctx.steps_json_path}")
            guide_tts(ctx, f"{ctx.script_type} は既に完了しています。")
            return

        if ctx.use_english_voice:
            guide_tts(ctx, f"AiDiy video generation is starting. The output folder is {ctx.folder_name}.")
        else:
            guide_tts(ctx, f"AiDiy ビデオ生成を開始します。フォルダ名は {ctx.folder_name} です。")

        try:
            ca_info = await asyncio.to_thread(
                post_mcp_method, ctx.code_agents_api_url, "config", {"project_path": ctx.repo_dir}, 120
            )
        except Exception as e:
            print(f"ERROR: CodeAgents HTTP API に接続できません: {e}")
            guide_tts(ctx, "コードエージェント API に接続できません。処理を中断します。", voice="male")
            sys.exit(1)

        version_info = ca_info.get("version_info", {}) if isinstance(ca_info, dict) else {}
        ca = {"api_url": ctx.code_agents_api_url, "version_info": version_info}

        available = [k for k, v in version_info.items() if v.get("ok")]
        if not available:
            print("ERROR: 利用可能な AI がありません")
            guide_tts(ctx, "利用可能な AI がありません。処理を中断します。", voice="male")
            sys.exit(1)
        print(f"利用可能 AI  : {available}")

        await run_automation_loop(ctx, ca, steps, ensure_fn)
