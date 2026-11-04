# -*- coding: utf-8 -*-
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""
ctx.py — VideoGenCtx コンテキストオブジェクト

3 つのビデオページ生成スクリプトが共有する実行時設定を 1 か所で管理する。
"""

import os
from dataclasses import dataclass, field


@dataclass
class VideoGenCtx:
    """ビデオページ生成の実行時コンテキスト。AutomationConfig の代替。"""

    # === 設定 JSON から（必須） ===
    folder_name: str
    topic: str
    template_dir: str
    video_base_dir: str
    backup_api_url: str
    tts_api_url: str
    image_gen_api_url: str
    code_agents_api_url: str
    chrome_api_url: str
    ffmpeg_api_url: str
    language: str
    tts_guide: bool
    frontend_base_url: str
    browser_preview: bool
    chrome_debug_port: int
    max_retries: int
    retry_wait_sec: int
    max_backup_stabilize: int
    start_step: int
    stop_step: int
    step_specified: bool

    # === スクリプト固有 ===
    script_type: str        # "紹介" / "解説" / "小説小話" / "翻訳ja2xx"
    steps_json_path: str    # _ビデオページ生成_XXX_状況.json のパス
    steps_json_name: str    # ファイル名のみ
    setting_json_name: str  # 設定 JSON のファイル名（エラーメッセージ用）

    # === 派生値 ===
    fix_mode: bool = False
    mcp_python: str = ""
    repo_dir: str = ""

    # === Progress TTS ===
    progress_tts_language: str = "ja"
    progress_tts_provider: str = "edge"
    use_english_voice: bool = False
    progress_label_fn: object = None  # Callable[[str], str] | None

    # === シナリオバージョン識別子（翻訳スクリプト用） ===
    scenario_version: str = ""  # "mcp", "duo-v2" など

    @property
    def output_dir(self) -> str:
        return os.path.join(self.video_base_dir, self.folder_name)
