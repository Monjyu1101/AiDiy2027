# -*- coding: utf-8 -*-
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027


# -------------------------------------------------------------------------
# See LICENSE for full terms.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""
小説小話.py — 一人語りによる「小説・小話」自動生成スクリプト

◆ このスクリプトが作るビデオ:
    一人のアバターが、小説解説や実話の小話を
    面白く語る「ひとり語り・小説小話型」動画。AiDiy の機能紹介ではなく、
    あくまで物語の語り手として 1 体で読み聞かせる。
    scenario.js の version は "mcp"。
    各シーンは short_narration（短い要約）と long_narration（詳しい語り）の 2 段階を持ち、
    音声ファイルは short_scene_NNN.mp3 / long_scene_NNN.mp3 の形式で生成する。
    AiDiy への言及は scene_999 の最後にひとことだけ軽く添える（本編・冒頭では一切触れない）。
    ナレーション音声は edge / female。
    テンプレートは設定 JSON から完成済みの「小説解説_AiDiy誕生_ja」を
    相対参照し、調整済みのプレイヤー、画像レイアウト、文字配置を流用する。

使い方:
    cd backend_tools
    .venv\\Scripts\\python aidiy_automations\\ビデオページ生成\\ビデオページ生成_小説小話.py [実行ステップ番号]
"""

import asyncio
import json
import os
import sys

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

MCP_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
REPO_DIR = os.path.dirname(MCP_DIR)
sys.path.insert(0, MCP_DIR)

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _SCRIPT_DIR)

from utils.ctx import VideoGenCtx
from utils.runner import VideoGenRunner
from utils.infra import (
    sep, check,
    agent_run, verify_and_backup_until_stable,
    step_instruction_header, guide_tts,
    step_no_to_value, step_value_to_int, get_completed_step,
    ensure_preview_minimum_duration_mcp,
    run_python_script,
)
from utils.generation import (
    ensure_scene_image_script, ensure_dialogue_audio_script,
    validate_scene_id_range, validate_scene_expressions, validate_scene_media_refs, index_html_matches_theme,
    ensure_step_markdown, mark_step_done,
    backup_images_for_fix_mode, 参照画像ディレクトリ,
    count_scenario_scenes, count_scenario_dialogues, ensure_scene_html_pages, load_scenario_object,
    _sync_mcp_assets_json,
)
from utils.steps import (
    step00_preflight, step_add_routing, step_create_folder, step_generate_audio, step_review_audio,
    step_update_durations, step_completion_notice, ensure_audio_script_review_support,
    ensure_video_menu_registration, video_menu_registration_ok,
    video_menu_registration_paths, video_menu_review_prompt,
)

# ================================================================== #
# 定数
# ================================================================== #

SCRIPT_TYPE = "小説小話"
SCRIPT_FILE_NAME = os.path.basename(__file__)
SETTING_JSON_NAME = "_ビデオページ生成_小説小話_設定.json"
STEPS_JSON_NAME = "_ビデオページ生成_小説小話_状況.json"

SETTING_JSON_PATH = os.path.join(_SCRIPT_DIR, SETTING_JSON_NAME)
STEPS_JSON_PATH = os.path.join(_SCRIPT_DIR, STEPS_JSON_NAME)

REQUIRED_SCENE_IDS = (
    "scene_000",
    "scene_001",
    "scene_002",
    "scene_003",
    "scene_004",
    "scene_999",
)

NEWS_VIDEO_KNOWLEDGE_PATH = os.path.join(REPO_DIR, "_AIDIY", "knowledge", "backend_server,backend_tools,MCP活用手順.md")
AUTO_VIDEO_KNOWLEDGE_PATH = os.path.join(REPO_DIR, "_AIDIY", "knowledge", "共通,mcp利用による自動ビデオ生成手順.md")


def _is_four_panel_topic(topic: object) -> bool:
    """topic が4コマ漫画を明示している場合だけ True を返す。"""
    compact_topic = "".join(str(topic).split()).lower()
    return any(
        keyword in compact_topic
        for keyword in ("4コマ", "４コマ", "四コマ", "four-panel", "fourpanel")
    )


def _validate_narration_policy(scenario_path: str) -> bool:
    """女性音声設定と、空文字列を本文内の記号として誤用していないことを検証する。"""
    try:
        scenario_data = load_scenario_object(scenario_path)
        scenes = [
            scene for scene in scenario_data.get("scenes", [])
            if isinstance(scene, dict)
        ]
        embedded_marker_ids = [
            str(scene.get("id", ""))
            for scene in scenes
            if '""' in str(scene.get("long_narration", "") or "")
        ]
        tts_provider = str(
            (scenario_data.get("assets_policy") or {}).get("tts_provider", "")
        ).strip().lower()
        empty_string_ok = check(
            f'空文字列を本文内の二文字記号として使用していない（誤用={embedded_marker_ids}）',
            bool(scenes) and not embedded_marker_ids,
        )
        voice_ok = check(
            f"女性ナレーター音声設定 (tts_provider={tts_provider!r})",
            tts_provider == "edge:female",
        )
        return empty_string_ok and voice_ok
    except Exception as exc:
        return check(f"女性ナレーター・間合い方針の検証に失敗: {exc}", False)

# ================================================================== #
# 小説小話固有: 補助スクリプト生成
# ================================================================== #

def _build_scene_image_prompt_body() -> str:
    return (
        "def build_prompt(scene):\n"
        "    def _clean(v):\n"
        '        return " ".join(str(v or "").replace("\\\\n", " ").replace("\\n", " ").split()).strip()\n'
        "    title = _clean(scene.get('title', ''))\n"
        "    headline = _clean(scene.get('headline', ''))\n"
        "    kicker = _clean(scene.get('kicker', ''))\n"
        "    lead = _clean(scene.get('lead', ''))\n"
        "    subtitle = _clean(scene.get('subtitle', ''))\n"
        "    prompt = _clean(scene.get('image_prompt', ''))\n"
        "    if prompt:\n"
        "        return prompt\n"
        "    lines = ['Create a high-quality widescreen illustration for a warm Japanese entertainment story (small anecdote) video.']\n"
        "    if kicker: lines.append(f'Topic: {kicker}.')\n"
        "    if title: lines.append(f'Title: {title}.')\n"
        "    if headline: lines.append(f'Headline: {headline}.')\n"
        "    if lead: lines.append(f'Details: {lead}.')\n"
        "    if subtitle: lines.append(f'Concept: {subtitle}.')\n"
        "    lines.append('Style: warm cinematic comedy, friendly Japanese everyday-life mood, expressive but respectful characters, beautiful lighting, no readable text baked into the image.')\n"
        "    return '\\n'.join(lines).strip()\n"
    )


def _build_narration_audio_bodies() -> tuple[str, str, str]:
    load_tasks_body = (
        "def load_tasks():\n"
        '    scenario_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "scenario.js")\n'
        '    with open(scenario_file, encoding="utf-8-sig") as f:\n'
        "        content = f.read()\n"
        "    json_str = content.strip()\n"
        '    if json_str.startswith("window.SCENARIO ="):\n'
        '        json_str = json_str[len("window.SCENARIO ="):].strip()\n'
        '    json_str = json_str.rstrip(";").strip()\n'
        "    data = json.loads(json_str)\n"
        "    narrations = []\n"
        '    for scene in data.get("scenes", []):\n'
        '        scene_num = str(scene.get("id", "")).replace("scene_", "")\n'
        '        short_text = str(scene.get("short_narration", "") or "").strip()\n'
        '        long_text  = str(scene.get("long_narration",  "") or "").strip()\n'
        '        if "short_narration" in scene: narrations.append((scene_num, "short", short_text))\n'
        '        if "long_narration" in scene:  narrations.append((scene_num, "long",  long_text))\n'
        "    return narrations\n\n"
        "NARRATIONS = load_tasks()\n"
    )
    # ナレーション音声は edge / female（女性一人語り）。
    synthesize_body = (
        "def synthesize_one(text, out_path):\n"
        "    text = apply_pronunciation(text, out_path)\n"
        "    return post_json(TTS_API_URL, {\n"
        '        "speech_text": text,\n'
        '        "language": TTS_LANGUAGE,\n'
        '        "provider": "edge",\n'
        '        "voice": "female",\n'
        '        "save_path": out_path,\n'
        "    })\n"
    )
    main_loop_body = (
        "    selected = set(sys.argv[2:]) if len(sys.argv) > 1 and sys.argv[1] == '--only-file' else set()\n"
        "    total = len(NARRATIONS)\n"
        "    done = 0\n"
        "    skip = 0\n"
        "    fail = 0\n"
        "    for scene_num, kind, text in NARRATIONS:\n"
        '        fname = f"{kind}_scene_{scene_num}.mp3"\n'
        "        if selected and fname not in selected: continue\n"
        "        fpath = os.path.join(OUTPUT_DIR, fname)\n"
        "        if not selected and os.path.exists(fpath) and os.path.getsize(fpath) > 500:\n"
        '            print(f"  [SKIP] {fname}")\n'
        "            skip += 1\n"
        "            continue\n"
        '        print(f"  [GEN ] {fname}")\n'
        "        try:\n"
        "            synthesize_one(text, fpath)\n"
        "            size = os.path.getsize(fpath) if os.path.exists(fpath) else 0\n"
        "            if size > 500:\n"
        '                print(f"         -> OK ({size:,} bytes)")\n'
        "                done += 1\n"
        "            else:\n"
        '                print("         -> FAIL (empty or too small)")\n'
        "                fail += 1\n"
        "        except Exception as e:\n"
        '            print(f"         -> ERROR: {e}")\n'
        "            fail += 1\n"
        '    print(f"\\n完了: {done} 生成, {skip} スキップ, {fail} 失敗 (合計 {total} 件)")\n'
        "    if fail:\n"
        "        raise SystemExit(1)\n"
    )
    return load_tasks_body, synthesize_body, main_loop_body


# ================================================================== #
# Step 03: シナリオ作成
# ================================================================== #

async def step_create_scenario(ctx: VideoGenCtx, ca: dict, attempt: int = 1) -> bool:
    sep("Step 03: シナリオ作成")
    step_name = "Step 03: シナリオ作成"
    new_dir = ctx.output_dir
    folder_name = ctx.folder_name
    topic = ctx.topic
    is_four_panel = _is_four_panel_topic(topic)

    step_summary = (
        f'  "{folder_name}" の scenario.js を作成・更新します。\n'
        "  一人語りの小説・小話として、short/long ナレーション、画像・音声パス、オチのあるまとめを整えます。"
    )
    scenario_path = os.path.join(new_dir, "scenario.js")
    md_path       = os.path.join(new_dir, f"{folder_name}.md")
    template_scen = os.path.join(ctx.template_dir, "scenario.js")
    guide_tts(ctx, f"{step_name} を開始します。テーマに沿った小説小話の台本を作成します。")

    if os.path.isfile(scenario_path):
        with open(scenario_path, encoding="utf-8") as f:
            c = f.read()
        if "window.SCENARIO" in c and "scene_999" in c and folder_name in c:
            print("  [既存] scenario.js は作成済みです。内容検証を行い、問題があれば修正します")

    fix_mode_prefix = ""
    if ctx.fix_mode and os.path.isfile(scenario_path):
        with open(scenario_path, encoding="utf-8") as _f:
            _existing = _f.read()
        fix_mode_prefix = (
            "【修正モード】\n"
            "  構造（scene ID・音声ファイル名・version・short/long narration 形式）は維持してください。\n\n"
            f"【修正前 scenario.js の内容】\n```\n{_existing[:3000]}\n```\n"
            f"【修正の基準となる topic】\n{topic}\n\n"
        )

    prompt = (
        step_instruction_header(ctx, step_name, step_summary)
        + fix_mode_prefix
        + "以下の手順を実行してください。\n\n"
        "【参考ナレッジ】\n"
        f'  - "{NEWS_VIDEO_KNOWLEDGE_PATH}"\n'
        f'  - "{AUTO_VIDEO_KNOWLEDGE_PATH}"\n\n'
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
        "【作業 A】scenario.js の作成\n"
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
        f'参照テンプレート: "{template_scen}"\n'
        f'出力先: "{scenario_path}"\n\n'
        '- window.SCENARIO = { ... } 形式を維持\n'
        '- "version": "mcp" を維持（duo-v2 にしないこと）\n'
        '- "project_name" と top-level の "title" を今回テーマに合わせて更新\n'
        '- assets_policy の "tts_provider" は "edge:female" にする\n'
        '- assets_policy の他の値はテンプレートのまま維持\n\n'
        "■ これは AiDiy の機能紹介ではなく『小説解説または小話』のひとり語り動画です。\n"
        "  - アバター 1 体が物語の語り手として読み聞かせる構成にする。\n"
        "  - 語り手は日本語の女性ナレーターを前提とする。落ち着きと親しみがあり、情景や人物の感情を丁寧に伝える自然な話し言葉にする。\n"
        "  - 女性であることを不自然に強調したり、過度に芝居がかった語尾にしたりせず、作品世界を尊重した聞きやすい語りにする。\n"
        "  - 技術解説の数値や機能説明は入れない。chips / metrics / cards / facts / evidence は空配列でよい。\n"
        "  - 物語は headline / lead / subtitle と short/long narration で語る。\n\n"
        "■ 空文字列と無音の扱い\n"
        "  - JSONの \"\" は文字数ゼロの空文字列であり、本文へ埋め込む二文字の記号ではない。\n"
        "  - short_narration / long_narration の本文中に、間合い記号として \"\" を書き込まない。\n"
        "  - 独立した音声生成単位の値が空文字列の場合だけ、aidiy_text_to_speech が1秒の無音音声を生成する。\n"
        "  - 通常のナレーションでは、句読点と文の区切りで自然な間合いを作る。\n\n"
        "■ scenes 構成（通常は最小7ページ、最大30ページ。4コマ漫画指定時は例外として6ページ）\n"
        "  - scene_000: イントロ（小説・小話のつかみ）。先頭固定\n"
        "  - topic に4コマ漫画の指示がある場合は、scene_000、scene_001〜scene_004、scene_999 の全6ページ固定とする\n"
        "    （scene_001〜scene_004を4コマ本編とし、追加シーンは作らない）\n"
        "  - 4コマ漫画の指示がない場合は、scene_001〜scene_005 を物語の展開（起承転結＋オチへの前振り）として最低限必須とする\n"
        "  - 必要に応じて scene_006〜scene_028 まで追加可\n"
        "  - scene_999: まとめ（オチの余韻と締め）。最後固定\n\n"
        "■ 通常は物語の内容に応じて7〜20ページで構成する。30ページは絶対上限であり、目標ページ数ではない\n"
        "  - 21〜30ページは、topic に明示指定がある場合、または20ページでは物語を詰め込みすぎる場合だけ使用する\n"
        "  - ページ数は物語の展開に合わせて決めること（7ページ固定・30ページ固定ではない）\n"
        "  - 基本の考え方: 場面が変わる、時間が飛ぶ、語り手の立場が変わる。そこがシーンの切れ目\n"
        "  - 増やす判断: 1 つのシーンに場面転換が 2 回以上入るなら分けてシーンを増やす。\n"
        "    オチまでの前振りが駆け足になるようなら、展開のシーンを足す\n"
        "  - 減らす判断: 話が進まないシーンを足して水増ししないこと。短い小話は最小構成に収め、\n"
        "    テンポとオチの切れ味を優先する\n"
        "  - topic にシーン構成の指定があるときは、その指定を最優先する\n"
        "  - 再生時間の明示指示がなく、scene_000 と scene_999 を含む全体が6ページ以内の場合は、\n"
        "    short/long のどちらの再生モードも全体で1分以内になる分量に仕上げる\n\n"
        "■ 各シーンの必須フィールド\n"
        '  "id", "title", "expression", "accent", "accent_soft",\n'
        '  "kicker", "headline", "lead", "subtitle",\n'
        '  "image": "images/scene_NNN.png",\n'
        '  "chips": [], "metrics": [], "cards": [], "facts": [], "evidence": [],\n'
        '  "image_prompt"（物語シーンを描いた英語の画像プロンプト）,\n'
        '  "short_narration", "long_narration",\n'
        '  "short_audio": "audio/short_scene_NNN.mp3",\n'
        '  "long_audio": "audio/long_scene_NNN.mp3",\n'
        '  "short_start_sec": 0.0, "short_duration_sec": 10.0,\n'
        '  "long_start_sec": 0.0, "long_duration_sec": 30.0\n\n'
        "■ 表情（expression）の方針\n"
        "  - 全ページ \"neutral\"（自然な普通の顔）にする。\n"
        "  - \"happy\" / \"surprised\" / \"relaxed\" など他の値は使わない。\n\n"
        "■ AiDiy への言及は scene_999 の最後だけにする。scene_000 やそれ以外の本編では AiDiy に一切触れず、物語の語りに徹する\n\n"
        "■ scene_999 の long_narration の流れ\n"
        "  (1) まずは小説・小話の余韻を楽しく前向きにまとめる（ここがメイン）\n"
        "  (2) チャンネル登録のお願いを添える\n"
        "  (3) 最後にひとことだけ、軽く『この動画は AiDiy のビデオページ生成で作りました』程度に触れる\n"
        "      （※ 長々と宣伝しない。AiDiy の説明は最後のひとことだけに留める）\n\n"
        f"■ テーマ（元になる小説・小話）: {topic}\n\n"
        f'【作業 B】"{md_path}" の「シナリオ作成」チェックを [x] にしてください。\n\n'
        "【完了確認】scenario.js の先頭10行を表示してください。\n"
    )
    agent_timeout_sec = 600 if _is_four_panel_topic(ctx.topic) else 1200
    await agent_run(ctx, ca, prompt, timeout_sec=agent_timeout_sec)

    def validate() -> bool:
        ok1 = check("scenario.js 存在", os.path.isfile(scenario_path))
        ok2 = False
        if ok1:
            with open(scenario_path, encoding="utf-8") as f:
                c = f.read()
            ok2 = check(
                "scenario.js 内容（SCENARIO + scene_999 + folder_name）",
                "window.SCENARIO" in c and "scene_999" in c and folder_name in c,
            )
        min_mid = 4 if is_four_panel else 5
        max_mid = 4 if is_four_panel else 28
        ok3 = validate_scene_id_range(
            scenario_path, min_mid=min_mid, max_mid=max_mid, label="小説小話シナリオ"
        ) if ok1 else False
        ok4 = validate_scene_expressions(scenario_path, label="小説小話シナリオ") if ok1 else False
        ok5 = validate_scene_media_refs(scenario_path, label="小説小話シナリオ") if ok1 else False
        ok_pause = _validate_narration_policy(scenario_path) if ok1 else False
        ok6 = False
        if ok1:
            updated = ensure_scene_html_pages(new_dir, scenario_path, language=ctx.language)
            ok6 = check(f"scene HTML をシナリオ全件分生成（更新 {len(updated)} 件）", True)
        return ok1 and ok2 and ok3 and ok4 and ok5 and ok_pause and ok6

    return await verify_and_backup_until_stable(
        ctx=ctx, ca=ca,
        step_name=step_name, step_summary=step_summary,
        target_paths=[scenario_path, md_path],
        validate=validate, verify_timeout_sec=300, attempt=attempt,
    )


# ================================================================== #
# Step 04: HTML修正
# ================================================================== #

async def step_update_html(ctx: VideoGenCtx, ca: dict, attempt: int = 1) -> bool:
    sep("Step 04: HTML修正")
    step_name = "Step 04: HTML修正"
    new_dir = ctx.output_dir
    folder_name = ctx.folder_name
    topic = ctx.topic

    step_summary = (
        f'  "{folder_name}" の index.html を scenario.js と今回テーマに合わせて修正します。\n'
        "  <title>、.brand、.top-note、見出しを今回のテーマへ置き換えます。"
    )
    index_path    = os.path.join(new_dir, "index.html")
    assets_path   = os.path.join(new_dir, "assets.json")
    scenario_path = os.path.join(new_dir, "scenario.js")
    md_path       = os.path.join(new_dir, f"{folder_name}.md")
    guide_tts(ctx, f"{step_name} を開始します。画面のタイトルと説明を修正します。")

    already_valid = index_html_matches_theme(index_path, scenario_path, folder_name, topic)
    if already_valid:
        print("  [既存] index.html は機械検証済みです。CodeAgents の再実行を省略します")

    fix_mode_prefix_html = ""
    if ctx.fix_mode and os.path.isfile(index_path):
        with open(index_path, encoding="utf-8") as _f:
            _existing_html = _f.read()
        fix_mode_prefix_html = (
            "【修正モード】\n"
            "  HTML/CSS/JS の構造は維持してください。\n\n"
            f"【修正前 index.html の関連部分（先頭抜粋）】\n```\n{_existing_html[:2000]}\n```\n"
            f"【修正の基準となる topic】\n{topic}\n\n"
        )

    prompt = (
        step_instruction_header(ctx, step_name, step_summary)
        + fix_mode_prefix_html
        + "以下の手順で index.html を修正してください。\n\n"
        "【参考ナレッジ】\n"
        f'  - "{NEWS_VIDEO_KNOWLEDGE_PATH}"\n\n'
        "【修正方針】\n"
        "  - HTML/CSS/JavaScript の構造は維持する。\n"
        "  - 1アバター（シングル）表示、リップシンク、字幕表示ロジックは維持する。\n"
        "  - short_narration / long_narration の切り替え、short_audio / long_audio 再生ロジックは維持する。\n"
        "  - コピー元のレイアウトと再生ロジックを保ち、タイトルなどの内容だけを今回のテーマへ置き換える。\n\n"
        "【更新箇所】\n"
        f"  1. <title> タグにフォルダ名またはテーマ名を含める: {folder_name}\n"
        "  2. .brand div の中身を今回の小説・小話タイトル表示へ更新する（AiDiy 機能紹介の文言は残さない）。\n"
        "  3. .top-note の中身を小説・小話の簡潔な紹介文（1〜2文）へ更新する。\n"
        "  4. 見出し、サブタイトル、説明文などにテンプレート元テーマが残っていれば置き換える。\n"
        "【今回のテーマ】\n"
        f"  フォルダ名: {folder_name}\n"
        f"  テーマ詳細: {topic}\n\n"
        f'"{md_path}" の「HTML修正」チェックを [x] にしてください。\n\n'
        "【完了確認】index.html の <title>、.brand、.top-note 周辺と、VRM ロード行を表示してください。\n"
    )
    if already_valid:
        mark_step_done(md_path, "HTML修正")
    else:
        await agent_run(ctx, ca, prompt, timeout_sec=300)

    def validate() -> bool:
        ok1 = check("index.html 存在", os.path.isfile(index_path))
        ok2 = (
            check("index.html 内容（title + scenario.js + テーマ反映）",
                  index_html_matches_theme(index_path, scenario_path, folder_name, topic))
            if ok1 else False
        )
        return ok1 and ok2

    return await verify_and_backup_until_stable(
        ctx=ctx, ca=ca,
        step_name=step_name, step_summary=step_summary,
        target_paths=[index_path, assets_path, scenario_path, md_path],
        validate=validate, verify_timeout_sec=240, attempt=attempt,
        # Step 04 は直前の編集エージェントと Python 検証で十分に判定できる。
        # 同じ対象へ検証エージェントを重ねると、外側のAIタスクがHTTP待ちで
        # タイムアウトするため、ここでは再帰的な CodeAgents 呼び出しを行わない。
        skip_agent_verify=True,
    )


# ================================================================== #
# Step 05: 画像生成
# ================================================================== #

async def step_generate_images(ctx: VideoGenCtx, ca: dict, attempt: int = 1) -> bool:
    sep("Step 05: 画像生成")
    step_name = "Step 05: 画像生成"
    new_dir = ctx.output_dir
    folder_name = ctx.folder_name
    topic = ctx.topic

    step_summary = (
        f'  "{folder_name}" の scenario.js から各シーン画像を生成します。\n'
        "  _gen_scene_images.py を作成・実行し、images/scene_*.png を揃えます。"
    )
    images_dir    = os.path.join(new_dir, "images")
    scenario_path = os.path.join(new_dir, "scenario.js")
    gen_img_py    = os.path.join(new_dir, "_gen_scene_images.py")
    md_path       = os.path.join(new_dir, f"{folder_name}.md")
    guide_tts(ctx, f"{step_name} を開始します。シーン画像を生成します。")

    if os.path.isdir(images_dir) and os.path.isfile(scenario_path):
        scen_mtime = os.path.getmtime(scenario_path)
        existing = [
            f for f in os.listdir(images_dir)
            if f.endswith(".png")
            and os.path.getsize(os.path.join(images_dir, f)) > 1000
            and os.path.getmtime(os.path.join(images_dir, f)) >= scen_mtime
        ]
        if len(existing) >= 8:
            print(f"  [既存] images/*.png が {len(existing)} 件存在します。内容検証を行い、問題があれば修正します")
    ensure_step_markdown(md_path, folder_name, topic)

    # 生成済み画像のパスを参照として渡す（フォルダ作成で images はコピーしない）。
    # ゼロから描き起こすより生成が速く、既存 PNG のスキップ判定にも影響しない。
    参照画像 = 参照画像ディレクトリ(ctx, images_dir)
    if 参照画像:
        print(f"  [image] 参照画像フォルダ: {参照画像}")

    ensure_scene_image_script(
        ctx, gen_img_py,
        output_dir=os.path.join(new_dir, "images"),
        template_image_dir=参照画像,
        build_prompt_fn=_build_scene_image_prompt_body(),
    )
    print(f"  [image] 補助スクリプトを生成しました: {gen_img_py}")
    print(f'  [image] 実行コマンド: "{ctx.mcp_python}" "{gen_img_py}"')
    run_python_script(ctx.mcp_python, gen_img_py)
    mark_step_done(md_path, "画像生成")

    def validate() -> bool:
        if not os.path.isdir(images_dir):
            check("images フォルダ存在", False)
            return False
        if not os.path.isfile(scenario_path):
            return check("scenario.js 存在", False)

        import hashlib

        data = load_scenario_object(scenario_path)
        expected_names = {
            f"{scene.get('id')}.png"
            for scene in data.get("scenes", [])
            if isinstance(scene, dict) and scene.get("id")
        }
        pngs = {
            f for f in os.listdir(images_dir)
            if f.endswith(".png") and os.path.getsize(os.path.join(images_dir, f)) > 1000
        }
        ok_names = check(
            f"images/*.png 構成: {len(pngs)} 件（期待 {len(expected_names)} 件）",
            bool(expected_names) and pngs == expected_names,
        )

        hashes: dict[str, list[str]] = {}
        for name in sorted(pngs & expected_names):
            with open(os.path.join(images_dir, name), "rb") as f:
                digest = hashlib.sha256(f.read()).hexdigest()
            hashes.setdefault(digest, []).append(name)
        duplicates = [names for names in hashes.values() if len(names) > 1]
        ok_unique = check("シーン画像 SHA-256 重複なし", not duplicates)
        if duplicates:
            print(f"  [image] 重複画像: {duplicates}")
        return ok_names and ok_unique

    return await verify_and_backup_until_stable(
        ctx=ctx, ca=ca,
        step_name=step_name, step_summary=step_summary,
        target_paths=[scenario_path, gen_img_py, images_dir, md_path],
        validate=validate, verify_timeout_sec=600, attempt=attempt,
        # 画像APIの実行後は、scenario.js の期待件数と PNG の実在・サイズを
        # Python で確定できる。ここで検証エージェントを重ねると外側の
        # AIタスクの60分監視に達するため、機械検証と差分バックアップだけで判定する。
        skip_agent_verify=True,
    )


# ================================================================== #
# Step 06: 中間確認
# ================================================================== #

async def _recover_sources(ctx: VideoGenCtx, ca: dict, *, reason: str, attempt: int = 1) -> bool:
    print(f"  [recover] {reason}")
    guide_tts(ctx, "中間確認の前提をリカバリします。シナリオ訂正、HTML修正、画像生成を順番にやり直します。", voice="male")
    return (
        await step_create_scenario(ctx, ca, attempt=attempt)
        and await step_update_html(ctx, ca, attempt=attempt)
        and await step_generate_images(ctx, ca, attempt=attempt)
    )


async def step_mid_review(ctx: VideoGenCtx, ca: dict, attempt: int = 1) -> bool:
    sep("Step 06: 中間確認")
    step_name = "Step 06: 中間確認"
    new_dir = ctx.output_dir
    folder_name = ctx.folder_name
    topic = ctx.topic

    step_summary = (
        f'  "{folder_name}" のシナリオ、HTML、画像を音声生成前に中間確認します。\n'
        "  事実と異なる内容、不適切な言葉、問題のある画像があれば修正します。"
    )
    scenario_path = os.path.join(new_dir, "scenario.js")
    scenario_json_path = os.path.join(new_dir, "scenario.json")
    index_path    = os.path.join(new_dir, "index.html")
    images_dir    = os.path.join(new_dir, "images")
    gen_img_py    = os.path.join(new_dir, "_gen_scene_images.py")
    md_path       = os.path.join(new_dir, f"{folder_name}.md")
    guide_tts(ctx, f"{step_name} を開始します。内容の中間確認を行います。")
    ensure_step_markdown(md_path, folder_name, topic)
    expected_image_count = count_scenario_scenes(scenario_path) if os.path.isfile(scenario_path) else 8

    def _count_valid_images() -> int:
        return sum(1 for f in os.listdir(images_dir) if f.endswith(".png") and os.path.getsize(os.path.join(images_dir, f)) > 1000) if os.path.isdir(images_dir) else 0

    if not os.path.isfile(scenario_path) or not os.path.isfile(index_path) or _count_valid_images() < expected_image_count:
        reason = (f"Step 06 の前提不足 (scenario={os.path.isfile(scenario_path)}, "
                  f"index={os.path.isfile(index_path)}, images={_count_valid_images()}/{expected_image_count})")
        if not await _recover_sources(ctx, ca, reason=reason, attempt=attempt):
            return False

    # scenario.json は静的成果物の可読なマニフェストとして配布されるため、
    # プレイヤーが読む scenario.js と必ず同じ内容にそろえる。テンプレートから
    # コピーされた旧題材の scenario.json が残ると、音声台本や外部検証だけが
    # 別の物語を参照してしまうため、中間確認で同期・照合まで完結させる。
    try:
        scenario_data_for_json = load_scenario_object(scenario_path)
        with open(scenario_json_path, "w", encoding="utf-8", newline="\n") as f:
            json.dump(scenario_data_for_json, f, ensure_ascii=False, indent=2)
            f.write("\n")
        scenario_json_sync_ok = True
        print("  [SYNC] scenario.json を scenario.js と同期しました")
    except Exception as exc:
        scenario_json_sync_ok = False
        print(f"  [FAIL] scenario.json の同期に失敗: {exc}")

    prompt = (
        step_instruction_header(ctx, step_name, step_summary)
        + "以下の観点で中間確認を行い、必要な箇所だけ修正してください。\n\n"
        "【参考ナレッジ】\n"
        f'  - "{NEWS_VIDEO_KNOWLEDGE_PATH}"\n'
        f'  - "{AUTO_VIDEO_KNOWLEDGE_PATH}"\n\n'
        "【確認対象】\n"
        f'  scenario.js: "{scenario_path}"\n'
        f'  index.html: "{index_path}"\n'
        f'  images フォルダ: "{images_dir}"\n\n'
        "【確認・修正方針】\n"
        "  1. 小説・小話のテーマと照らして筋が通らない内容、不適切な言葉があれば修正する。\n"
        "  2. scene_000 や本編（scene_001〜）で AiDiy に触れていないか確認する（触れていたら物語の語りに直す）。\n"
        "  3. AiDiy への言及は scene_999 の最後のひとことだけに留まっているか確認する。長い宣伝になっていたら短くする。\n"
        "  4. short_narration は短い要約、long_narration は詳しい語りになっているか確認する。\n"
        "  5. 女性ナレーターが自然に読み聞かせる前提の、落ち着きと親しみのある文章になっているか確認する。\n"
        "  6. JSONの空文字列を本文内の二文字の間合い記号として誤用していないか確認する。\n"
        "  7. 表情は基本 neutral で、にやけ顔の \"happy\" が残っていないか確認する（あれば neutral か surprised に直す）。\n"
        "  8. scene_999 の締めが楽しく前向きなオチの余韻になっているか確認する。\n"
        "  9. 問題がなければ不要な全面書き換えや再生成はしない。\n\n"
        "【今回のテーマ】\n"
        f"  フォルダ名: {folder_name}\n"
        f"  テーマ詳細: {topic}\n\n"
        f'"{md_path}" の「中間確認」チェックを [x] にしてください。\n'
    )
    review_already_done = False
    if os.path.isfile(md_path):
        with open(md_path, encoding="utf-8-sig") as f:
            review_already_done = "- [x] 中間確認" in f.read()
    if review_already_done:
        print("  [RESUME] 中間確認の完了印を検出しました。重複レビューを省略して成果物を再検証します")
    else:
        agent_timeout_sec = 600 if _is_four_panel_topic(ctx.topic) else 1200
        await agent_run(ctx, ca, prompt, timeout_sec=agent_timeout_sec)
    mark_step_done(md_path, "中間確認")

    def validate() -> bool:
        ok1 = check("scenario.js 存在", os.path.isfile(scenario_path))
        ok2 = check("index.html 存在", os.path.isfile(index_path))
        ok3 = check("images フォルダ存在", os.path.isdir(images_dir))
        ok4 = check(f"images/*.png 生成数: {_count_valid_images()}/{expected_image_count}",
                    expected_image_count > 0 and _count_valid_images() >= expected_image_count) if ok3 else False
        ok5 = False
        if os.path.isfile(md_path):
            with open(md_path, encoding="utf-8-sig") as f:
                ok5 = check("進捗 Markdown に中間確認反映", "- [x] 中間確認" in f.read())
        else:
            check("進捗 Markdown に中間確認反映", False)
        ok6 = check("scenario.json 同期", scenario_json_sync_ok and os.path.isfile(scenario_json_path))
        if ok6:
            try:
                with open(scenario_json_path, encoding="utf-8-sig") as f:
                    scenario_json_data = json.load(f)
                scenario_js_data = load_scenario_object(scenario_path)
                ok6 = check("scenario.json と scenario.js の内容一致", scenario_json_data == scenario_js_data)
            except Exception as exc:
                print(f"  [FAIL] scenario.json の照合に失敗: {exc}")
                ok6 = check("scenario.json と scenario.js の内容一致", False)
        ok7 = _validate_narration_policy(scenario_path) if ok1 else False
        return ok1 and ok2 and ok3 and ok4 and ok5 and ok6 and ok7

    ok = await verify_and_backup_until_stable(
        ctx=ctx, ca=ca,
        step_name=step_name, step_summary=step_summary,
        target_paths=[scenario_path, scenario_json_path, index_path, images_dir, gen_img_py, md_path],
        validate=validate, verify_timeout_sec=300, attempt=attempt,
        # 中間確認本体で内容確認・必要箇所の修正を済ませ、直後に存在・画像件数・
        # 進捗を機械検証する。検証エージェントを重ねると TaskTeam の20分上限を
        # 超えるため、このステップでは二重実行しない。
        skip_agent_verify=True,
    )
    if ok:
        return True
    await _recover_sources(ctx, ca, reason="Step 06 の検証が NG だったため Step 03〜04 を再実行します", attempt=attempt)
    return False


# ================================================================== #
# Step 10: 最終確認
# ================================================================== #

async def step_final_review(ctx: VideoGenCtx, ca: dict, attempt: int = 1) -> bool:
    sep("Step 10: 最終確認")
    step_name = "Step 10: 最終確認"
    new_dir = ctx.output_dir
    folder_name = ctx.folder_name

    step_summary = (
        f'  "{folder_name}" の動画素材一式を最終検証します。\n'
        "  scenario.js、index.html、images、audio、生成補助スクリプトを確認します。"
    )
    md_path       = os.path.join(new_dir, f"{folder_name}.md")
    scenario_path = os.path.join(new_dir, "scenario.js")
    images_dir    = os.path.join(new_dir, "images")
    audio_dir     = os.path.join(new_dir, "audio")
    gen_img_py    = os.path.join(new_dir, "_gen_scene_images.py")
    gen_aud_py    = os.path.join(new_dir, "_gen_audio.py")
    assets_path   = os.path.join(new_dir, "assets.json")
    is_four_panel = _is_four_panel_topic(ctx.topic)
    declared_scene_ids: list[str] = []
    try:
        declared_data = load_scenario_object(scenario_path)
        declared_scene_ids = [
            str(scene.get("id", ""))
            for scene in declared_data.get("scenes", [])
            if isinstance(scene, dict)
        ]
    except Exception as exc:
        print(f"  [WARN] 最終確認前の scenario.js 読込に失敗: {exc}")
    expected_scene_ids = list(REQUIRED_SCENE_IDS) if is_four_panel else declared_scene_ids
    expected_audio_count = len(expected_scene_ids) * 2
    expected_image_count = len(expected_scene_ids)
    expected_scene_label = "、".join(expected_scene_ids) if expected_scene_ids else "scenario.js の全シーン"
    guide_tts(ctx, f"{step_name} を開始します。成果物を最終確認します。")
    ensure_step_markdown(md_path, folder_name, ctx.topic)

    if step_value_to_int(get_completed_step(ctx)) >= 10:
        print("  [SKIP] Step 10 は既に完了済みです")
        return True

    # Step 02 の登録が後から消えていても、最終確認の前にメニューへ戻しておく。
    ensure_video_menu_registration(ctx)

    prompt = (
        step_instruction_header(ctx, step_name, step_summary)
        + "以下の手順で最終確認・修正を行ってください。\n\n"
        "【参考ナレッジ】\n"
        f'  - "{NEWS_VIDEO_KNOWLEDGE_PATH}"\n'
        f'  - "{AUTO_VIDEO_KNOWLEDGE_PATH}"\n\n'
        "【確認対象フォルダ】\n"
        f'  "{new_dir}"\n\n'
        "【手順 1】検証スクリプトを書いて実行\n"
        f"  確認 1: scenario.js が存在し、シーンIDが {expected_scene_label} の順で完全一致するか\n"
        f"  確認 2: images フォルダに全シーンのPNGが各1枚（合計{expected_image_count}枚）あるか\n"
        f"  確認 3: audio フォルダに全シーンの short/long MP3 が各1個（合計{expected_audio_count}個）あるか\n"
        "  確認 4: index.html が存在し、今回のフォルダ名が含まれるか\n"
        "  確認 5: _gen_audio.py が存在するか\n"
        "  確認 6: AiDiy への言及が scene_999 の最後のひとことだけに留まり、本編・冒頭で触れていないか\n"
        "  確認 7: 各 scene に short_narration / long_narration / short_audio / long_audio があるか\n"
        "  確認 8: 女性ナレーター向けの自然な文章で、JSONの空文字列を本文内の記号として誤用していないか\n"
        "  確認 9: assets.json の画像・音声のパス、status、bytes が実ファイルと一致するか\n"
        "  確認 10: コピー元のプレイヤー構造を壊していないか\n\n"
        "【手順 2】不足があれば修正\n"
        f'  images 不足: "{ctx.mcp_python}" "{gen_img_py}" を実行\n'
        f'  audio 不足:  "{ctx.mcp_python}" "{gen_aud_py}" を実行\n\n'
        + video_menu_review_prompt(ctx)
        + "  最後に、修正したファイルと未修正で OK と判断したファイルを一覧表示してください。\n"
    )
    review_already_done = False
    if os.path.isfile(md_path):
        with open(md_path, encoding="utf-8-sig") as f:
            review_markdown = f.read()
        review_already_done = (
            ("## Step 10 最終確認" in review_markdown or "## Step 09 最終確認" in review_markdown)
            and "- [x] 素材最終確認" in review_markdown
        )
    if review_already_done:
        print("  [RESUME] 最終確認の完了印を検出しました。重複レビューを省略して成果物を再検証します")
    else:
        agent_timeout_sec = 600 if is_four_panel else 1200
        await agent_run(ctx, ca, prompt, timeout_sec=agent_timeout_sec)

    manifest_sync_ok = False
    try:
        scenario_data = load_scenario_object(scenario_path)
        _sync_mcp_assets_json(ctx, scenario_data, new_dir)
        manifest_sync_ok = True
        print("  [SYNC] assets.json を scenario.js と実ファイルから再構築しました")
    except Exception as exc:
        print(f"  [FAIL] assets.json の再構築に失敗: {exc}")

    def validate() -> bool:
        ok1 = check("scenario.js 存在", os.path.isfile(scenario_path))
        ok2 = check("index.html 存在", os.path.isfile(os.path.join(new_dir, "index.html")))
        ok3 = check("_gen_scene_images.py 存在", os.path.isfile(gen_img_py))
        ok4 = check("_gen_audio.py 存在", os.path.isfile(gen_aud_py))
        ok5 = check(f"進捗 Markdown 存在: {md_path}", os.path.isfile(md_path))
        scenario_ids: list[str] = []
        scenario_data: dict = {}
        try:
            scenario_data = load_scenario_object(scenario_path)
            scenario_ids = [
                str(scene.get("id", ""))
                for scene in scenario_data.get("scenes", [])
                if isinstance(scene, dict)
            ]
        except Exception as exc:
            print(f"  [FAIL] scenario.js の検証用読込に失敗: {exc}")
        if is_four_panel:
            ok6 = check(
                f"4コマ漫画の固定シーンID (実際={scenario_ids} / 必須={list(REQUIRED_SCENE_IDS)})",
                scenario_ids == list(REQUIRED_SCENE_IDS),
            )
        else:
            ok6 = validate_scene_id_range(
                scenario_path, min_mid=5, max_mid=28, label="小説小話シナリオ"
            ) and check(
                f"シナリオ作成時の全シーンIDを維持 (実際={scenario_ids} / 期待={expected_scene_ids})",
                bool(expected_scene_ids) and scenario_ids == expected_scene_ids,
            )
        ok_narration = _validate_narration_policy(scenario_path) if ok1 else False

        expected_image_names = {f"{scene_id}.png" for scene_id in expected_scene_ids}
        expected_audio_names = {
            f"{prefix}_{scene_id}.mp3"
            for prefix in ("short", "long")
            for scene_id in expected_scene_ids
        }
        image_names = set()
        audio_names = set()
        if os.path.isdir(images_dir):
            image_names = {name for name in os.listdir(images_dir) if name.endswith(".png")}
        if os.path.isdir(audio_dir):
            audio_names = {name for name in os.listdir(audio_dir) if name.endswith(".mp3")}
        ok7 = check(
            f"必須画像実体 (実際={sorted(image_names)} / 必須={sorted(expected_image_names)})",
            image_names == expected_image_names
            and all(os.path.getsize(os.path.join(images_dir, name)) > 1000 for name in image_names),
        )
        ok8 = check(
            f"必須音声実体 (実際={sorted(audio_names)} / 必須={sorted(expected_audio_names)})",
            audio_names == expected_audio_names
            and all(os.path.getsize(os.path.join(audio_dir, name)) > 500 for name in audio_names),
        )

        manifest_ok = False
        manifest_detail = "assets.json 未検証"
        try:
            with open(assets_path, encoding="utf-8-sig") as f:
                manifest = json.load(f)
            image_items = manifest.get("images", [])
            audio_items = manifest.get("audio", [])
            manifest_image_paths = {
                str(item.get("path", "")) for item in image_items if isinstance(item, dict)
            }
            manifest_audio_paths = {
                str(item.get(field, ""))
                for item in audio_items if isinstance(item, dict)
                for field in ("short_path", "long_path")
            }
            expected_image_paths = {f"images/{name}" for name in expected_image_names}
            expected_audio_paths = {f"audio/{name}" for name in expected_audio_names}
            image_bytes_ok = all(
                isinstance(item, dict)
                and item.get("status") == "generated"
                and os.path.isfile(os.path.join(new_dir, str(item.get("path", "")).replace("/", os.sep)))
                and item.get("bytes") == os.path.getsize(
                    os.path.join(new_dir, str(item.get("path", "")).replace("/", os.sep))
                )
                for item in image_items
            )
            audio_bytes_ok = all(
                isinstance(item, dict)
                and item.get("status") == "generated"
                and all(
                    os.path.isfile(os.path.join(new_dir, str(item.get(field, "")).replace("/", os.sep)))
                    and item.get(f"{prefix}_bytes") == os.path.getsize(
                        os.path.join(new_dir, str(item.get(field, "")).replace("/", os.sep))
                    )
                    for prefix, field in (("short", "short_path"), ("long", "long_path"))
                )
                for item in audio_items
            )
            manifest_ok = (
                manifest.get("status") == "complete"
                and manifest_image_paths == expected_image_paths
                and manifest_audio_paths == expected_audio_paths
                and image_bytes_ok
                and audio_bytes_ok
            )
            manifest_detail = (
                f"status={manifest.get('status')!r}, images={len(image_items)}, audio={len(audio_items)}, "
                f"image_bytes_ok={image_bytes_ok}, audio_bytes_ok={audio_bytes_ok}"
            )
        except Exception as exc:
            manifest_detail = str(exc)
        ok9 = check(
            f"assets.json 実ファイル同期 ({manifest_detail})",
            manifest_sync_ok and manifest_ok,
        )
        html_scene_names = {
            name for name in os.listdir(new_dir)
            if name.startswith("scene_") and name.endswith(".html")
        } if os.path.isdir(new_dir) else set()
        expected_html_names = {f"{scene_id}.html" for scene_id in expected_scene_ids}
        ok10 = check(
            f"シーンHTML構成 (実際={sorted(html_scene_names)} / 必須={sorted(expected_html_names)})",
            html_scene_names == expected_html_names,
        )
        ok11 = video_menu_registration_ok(ctx)
        return all((ok1, ok2, ok3, ok4, ok5, ok6, ok_narration, ok7, ok8, ok9, ok10, ok11))

    ok = await verify_and_backup_until_stable(
        ctx=ctx, ca=ca,
        step_name=step_name, step_summary=step_summary,
        target_paths=[scenario_path, os.path.join(new_dir, "index.html"), images_dir, audio_dir, assets_path, gen_img_py, gen_aud_py, md_path,
                      *video_menu_registration_paths(ctx)],
        validate=validate, verify_timeout_sec=300, attempt=attempt,
        # Step 10 は、この関数の前段で完了済みレビュー印を確認している。
        # 検証専用エージェントをさらに起動すると同じ Step 10 を再帰実行するため、
        # ここでは Python 側の厳密な素材・manifest・メニュー検証とバックアップで確定する。
        skip_agent_verify=True,
    )
    if not ok:
        return False
    mark_step_done(md_path, "完成")
    print("  [complete] 最終確認が完了しました")
    return True


# ================================================================== #
# main
# ================================================================== #

def main(argv: list | None = None) -> None:
    args = argv if argv is not None else sys.argv
    if len(args) >= 2 and args[1] in ("-h", "--help", "/?"):
        print(f"使い方: python aidiy_automations\\ビデオページ生成\\{SCRIPT_FILE_NAME} [実行ステップ番号]")
        print("  実行ステップ番号: 0=初期確認 1=フォルダ作成 2=ルーティング追加 3=シナリオ作成 4=HTML修正")
        print("                  5=画像生成 6=中間確認 7=音声生成 8=音声照合 9=再生時間更新 10=最終確認 99=完成案内")
        return

    runner = VideoGenRunner.from_argv(
        args, SCRIPT_TYPE, SETTING_JSON_PATH, STEPS_JSON_PATH,
        mcp_dir=MCP_DIR, repo_dir=REPO_DIR,
        progress_tts_language="ja", progress_tts_provider="edge",
        use_english_voice=False,
    )
    runner.print_flow()
    ctx = runner.ctx
    new_dir = ctx.output_dir
    gen_aud_py = os.path.join(new_dir, "_gen_audio.py")

    load_tasks_body, synthesize_body, main_loop_body = _build_narration_audio_bodies()

    def _ensure_audio_script() -> None:
        ensure_dialogue_audio_script(
            ctx, gen_aud_py,
            output_dir=os.path.join(new_dir, "audio"),
            load_tasks_body=load_tasks_body,
            synthesize_body=synthesize_body,
            main_loop_body=main_loop_body,
            script_docstring="ナレーション音声生成スクリプト（小説小話 / edge female / mcp 形式）",
        )
    async def _step_gen_audio(ca: dict, attempt: int = 1) -> bool:
        _ensure_audio_script()
        return await step_generate_audio(ctx, ca, gen_aud_py, "_gen_audio.py", attempt=attempt)

    async def _step_review_audio(ca: dict, attempt: int = 1) -> bool:
        if os.path.isfile(gen_aud_py):
            ensure_audio_script_review_support(gen_aud_py)
        else:
            _ensure_audio_script()
        return await step_review_audio(ctx, ca, gen_aud_py, attempt=attempt)

    steps = [
        (0,  "初期確認",     lambda ca, attempt=1: step00_preflight(ctx, ca, attempt=attempt)),
        (1,  "フォルダ作成", lambda ca, attempt=1: step_create_folder(ctx, ca, (NEWS_VIDEO_KNOWLEDGE_PATH, AUTO_VIDEO_KNOWLEDGE_PATH), attempt=attempt)),
        (2,  "ルーティング追加", lambda ca, attempt=1: step_add_routing(ctx, ca, attempt=attempt)),
        (3,  "シナリオ作成", lambda ca, attempt=1: step_create_scenario(ctx, ca, attempt=attempt)),
        (4,  "HTML修正",     lambda ca, attempt=1: step_update_html(ctx, ca, attempt=attempt)),
        (5,  "画像生成",     lambda ca, attempt=1: step_generate_images(ctx, ca, attempt=attempt)),
        (6,  "中間確認",     lambda ca, attempt=1: step_mid_review(ctx, ca, attempt=attempt)),
        (7,  "音声生成",     _step_gen_audio),
        (8,  "音声照合",     _step_review_audio),
        (9,  "再生時間更新", lambda ca, attempt=1: step_update_durations(ctx, ca, attempt=attempt)),
        (10, "最終確認",     lambda ca, attempt=1: step_final_review(ctx, ca, attempt=attempt)),
        (99, "完成案内",     lambda ca, attempt=1: step_completion_notice(
            ctx, ca, attempt=attempt, final_review_fn=step_final_review,
        )),
    ]

    asyncio.run(runner.run(steps, ensure_fn=ensure_preview_minimum_duration_mcp))


if __name__ == "__main__":
    main()
