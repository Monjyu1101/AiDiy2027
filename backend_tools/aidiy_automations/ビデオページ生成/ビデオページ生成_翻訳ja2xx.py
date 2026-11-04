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
ビデオページ生成_翻訳ja2xx.py — 日本語紹介ビデオを別言語へ翻訳する自動生成スクリプト

◆ このスクリプトが作るビデオ:
    日本語の一人アバター紹介ビデオ（version: "mcp"）をコピー元にして、
    scenario.js、index.html、字幕、ナレーション、音声を指定言語へ翻訳した動画。
    テンプレートは設定 JSON の template_dir に指定した日本語フォルダを使用。

使い方:
    cd backend_tools
    .venv\\Scripts\\python aidiy_automations\\ビデオページ生成\\ビデオページ生成_翻訳ja2xx.py [実行ステップ番号]
"""

import asyncio
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
    step_instruction_header, guide_tts, progress_step_label,
    step_no_to_value, step_value_to_int, get_completed_step,
    ensure_preview_minimum_duration_mcp,
    run_python_script,
    backup_diff_count_url, backup_save_once_url,
)
from utils.generation import (
    ensure_scene_image_script, ensure_dialogue_audio_script,
    validate_scene_id_range, validate_scene_expressions, validate_scene_media_refs, index_html_matches_theme,
    ensure_step_markdown, mark_step_done,
    backup_images_for_fix_mode, 参照画像ディレクトリ,
    count_scenario_scenes, count_scenario_dialogues, ensure_scene_html_pages,
)
from utils.steps import (
    step00_preflight, step_add_routing, step_generate_audio, step_review_audio,
    step_update_durations, step_completion_notice, ensure_audio_script_review_support,
    ensure_video_menu_registration, video_menu_registration_ok,
    video_menu_registration_paths, video_menu_review_prompt,
    _テンプレートを機械コピー,
)

# ================================================================== #
# 定数
# ================================================================== #

SCRIPT_TYPE = "翻訳ja2xx"
SCRIPT_FILE_NAME = os.path.basename(__file__)
SETTING_JSON_NAME = "_ビデオページ生成_翻訳ja2xx_設定.json"
STEPS_JSON_NAME = "_ビデオページ生成_翻訳ja2xx_状況.json"

SETTING_JSON_PATH = os.path.join(_SCRIPT_DIR, SETTING_JSON_NAME)
STEPS_JSON_PATH = os.path.join(_SCRIPT_DIR, STEPS_JSON_NAME)

NEWS_VIDEO_KNOWLEDGE_PATH = os.path.join(REPO_DIR, "_AIDIY", "knowledge", "backend_server,backend_tools,MCP活用手順.md")
AUTO_VIDEO_KNOWLEDGE_PATH = os.path.join(REPO_DIR, "_AIDIY", "knowledge", "共通,mcp利用による自動ビデオ生成手順.md")

SCENARIO_VERSION = "mcp"

_LANG_MAP = {
    "en": ("English",    "globally appealing, internationally neutral",  "NO Japanese text, NO hiragana, NO katakana, NO kanji"),
    "fr": ("French",     "European, French cultural aesthetic",           "NO Japanese text, NO hiragana, NO katakana, NO kanji"),
    "de": ("German",     "European, German/Central European aesthetic",   "NO Japanese text, NO hiragana, NO katakana, NO kanji"),
    "es": ("Spanish",    "Latin/Spanish cultural aesthetic",              "NO Japanese text, NO hiragana, NO katakana, NO kanji"),
    "pt": ("Portuguese", "Latin/Portuguese cultural aesthetic",           "NO Japanese text, NO hiragana, NO katakana, NO kanji"),
    "it": ("Italian",    "European, Italian cultural aesthetic",          "NO Japanese text, NO hiragana, NO katakana, NO kanji"),
    "ru": ("Russian",    "Eastern European/Russian aesthetic",            "NO Japanese text, NO hiragana, NO katakana, NO kanji"),
    "nl": ("Dutch",      "European, Dutch/Nordic aesthetic",              "NO Japanese text, NO hiragana, NO katakana, NO kanji"),
    "zh": ("Chinese",    "East Asian, Chinese cultural aesthetic",        "NO hiragana, NO katakana. Chinese hanzi characters are acceptable if needed"),
    "ko": ("Korean",     "East Asian, Korean cultural aesthetic",         "NO hiragana, NO katakana. Korean hangul characters are acceptable if needed"),
    "ar": ("Arabic",     "Middle Eastern/Arabic cultural aesthetic",      "NO Japanese text, NO hiragana, NO katakana, NO kanji"),
    "ja": ("Japanese",   "Japanese cultural aesthetic",                   ""),
}


def _get_lang_info(lang_code: str) -> tuple:
    base = lang_code.split("-")[0].lower()
    return _LANG_MAP.get(base, (lang_code, "internationally neutral", "NO Japanese text, NO hiragana, NO katakana, NO kanji"))


# ================================================================== #
# 翻訳固有: 補助スクリプト生成
# ================================================================== #

def _build_image_directive_str(language: str) -> str:
    lang_name, style_hint, char_ban = _get_lang_info(language)
    lines = [
        "CRITICAL REQUIREMENTS — strictly follow all of the following:",
        f"1. This image is for a {lang_name}-language presentation. Use visuals that feel natural and appealing to {lang_name}-speaking audiences ({style_hint}).",
        "2. NO embedded text, NO readable labels, NO text overlay of any kind baked into the image.",
    ]
    if char_ban:
        lines.append(f"3. {char_ban} anywhere in the image.")
    lines.append("4. If a reference image is provided, use it ONLY for layout/composition/style inspiration. Do NOT copy any text or language-specific elements from it.")
    return "\\n".join(lines)


def _build_scene_image_prompt_body(language: str) -> str:
    image_directive = _build_image_directive_str(language)
    return (
        f"IMAGE_DIRECTIVE = {image_directive!r}\n\n\n"
        "def build_prompt(scene):\n"
        "    def _clean(v):\n"
        '        return " ".join(str(v or "").replace("\\\\n", " ").replace("\\n", " ").split()).strip()\n'
        "    image_prompt = _clean(scene.get('image_prompt', ''))\n"
        "    if image_prompt:\n"
        "        return f'{image_prompt}\\n\\n{IMAGE_DIRECTIVE}'\n"
        "    title = _clean(scene.get('title', ''))\n"
        "    headline = _clean(scene.get('headline', ''))\n"
        "    kicker = _clean(scene.get('kicker', ''))\n"
        "    lead = _clean(scene.get('lead', ''))\n"
        "    subtitle = _clean(scene.get('subtitle', ''))\n"
        "    lines = ['Create a high-quality, professional widescreen illustration/concept-art for a technology introduction presentation.']\n"
        "    if kicker: lines.append(f'Topic: {kicker}.')\n"
        "    if title: lines.append(f'Title: {title}.')\n"
        "    if headline: lines.append(f'Headline: {headline}.')\n"
        "    if lead: lines.append(f'Details: {lead}.')\n"
        "    if subtitle: lines.append(f'Concept: {subtitle}.')\n"
        "    lines.append('Style: modern technical slide illustration, clean design, gradient background, futuristic, beautiful.')\n"
        "    lines.append(IMAGE_DIRECTIVE)\n"
        "    return '\\n'.join(lines).strip()\n"
    )


def _build_audio_bodies() -> tuple[str, str, str]:
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
        "    tasks = []\n"
        '    for scene in data.get("scenes", []):\n'
        '        for prefix in ("short", "long"):\n'
        '            a_key = f"{prefix}_audio"\n'
        '            t_key = f"{prefix}_narration"\n'
        "            if a_key in scene and t_key in scene:\n"
        "                text = str(scene[t_key] or '').strip()\n"
        "                audio = str(scene[a_key] or '').strip()\n"
        '                if audio: tasks.append((text, "female", audio))\n'
        '        dialogues = scene.get("dialogue", [])\n'
        "        if isinstance(dialogues, list):\n"
        "            for dlg in dialogues:\n"
        "                if not isinstance(dlg, dict): continue\n"
        '                audio = str(dlg.get("audio", "") or "").strip()\n'
        '                text = ""\n'
        '                for tk in ("naration_text", "text", "content"):\n'
        "                    if tk in dlg:\n"
        "                        text = str(dlg[tk] or '').strip()\n"
        "                        break\n"
        '                speaker = str(dlg.get("speaker", "female") or "female")\n'
        "                if audio: tasks.append((text, speaker, audio))\n"
        "    return tasks\n\n"
        "NARRATIONS = load_tasks()\n"
    )
    synthesize_body = (
        "def synthesize_one(text, speaker, out_path):\n"
        "    text = apply_pronunciation(text, out_path)\n"
        "    return post_json(TTS_API_URL, {\n"
        '        "speech_text": text,\n'
        '        "language": TTS_LANGUAGE,\n'
        '        "provider": "edge",\n'
        '        "voice": speaker,\n'
        '        "save_path": out_path,\n'
        "    })\n"
    )
    main_loop_body = (
        "    selected = set(sys.argv[2:]) if len(sys.argv) > 1 and sys.argv[1] == '--only-file' else set()\n"
        "    total = len(NARRATIONS)\n"
        "    done = 0\n"
        "    skip = 0\n"
        "    fail = 0\n"
        "    for text, speaker, audio_ref in NARRATIONS:\n"
        "        fname = os.path.basename(audio_ref)\n"
        "        if selected and fname not in selected: continue\n"
        "        fpath = os.path.join(OUTPUT_DIR, fname)\n"
        "        if not selected and os.path.exists(fpath) and os.path.getsize(fpath) > 500:\n"
        '            print(f"  [SKIP] {fname}")\n'
        "            skip += 1\n"
        "            continue\n"
        '        print(f"  [GEN ] {fname}")\n'
        "        try:\n"
        "            synthesize_one(text, speaker, fpath)\n"
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
# Step 01: フォルダ作成（翻訳版: 内容変更禁止を明示）
# ================================================================== #

async def step_create_folder(ctx: VideoGenCtx, ca: dict, attempt: int = 1) -> bool:
    sep("Step 01: フォルダ作成")
    step_name = "Step 01: フォルダ作成"
    new_dir = ctx.output_dir
    folder_name = ctx.folder_name
    topic = ctx.topic

    step_summary = (
        f'  動画フォルダ "{new_dir}" を用意します。\n'
        "  テンプレートのコピーと images/・audio/ の作成は、このスクリプトが Python で実行済みです。\n"
        "  AI 側はファイルの存在確認だけを行ってください。内容の変更・翻訳は一切しません。"
    )
    md_path    = os.path.join(new_dir, f"{folder_name}.md")
    index_path = os.path.join(new_dir, "index.html")
    scenario_path = os.path.join(new_dir, "scenario.js")
    guide_tts(ctx, f"AiDiy automation is starting. {progress_step_label(step_name)} will prepare the video folder.")

    folder_already_exists = (
        os.path.isdir(new_dir) and os.path.isfile(index_path) and os.path.isfile(scenario_path)
    )
    if folder_already_exists:
        print("  [既存] コピー先に index.html / scenario.js が存在。テンプレートからの再コピーはスキップします")
    else:
        print("  [新規] フォルダを作成します")

    images_dir = os.path.join(new_dir, "images")
    audio_dir = os.path.join(new_dir, "audio")

    # テンプレートのコピーは AI に任せず機械的に行う。ただし出力フォルダが既にある場合は一切コピーしない
    os.makedirs(new_dir, exist_ok=True)
    if not folder_already_exists:
        try:
            # 翻訳は元動画の絵をそのまま使う（作り直さない）。images もコピーして
            # おくと、画像生成ステップが全件スキップになり再実行が短く済む。
            コピー済, 据え置き = _テンプレートを機械コピー(
                ctx.template_dir, new_dir, 画像コピー=True,
            )
            print(f"  [copy] テンプレートから {len(コピー済)} 件コピーしました（既存のため据え置き {len(据え置き)} 件）")
        except Exception as e:
            print(f"  [copy] テンプレートのコピーに失敗しました: {e}")
    else:
        print("  [copy] 既存フォルダのため、テンプレートからのコピーは行いません")
    os.makedirs(images_dir, exist_ok=True)
    os.makedirs(audio_dir, exist_ok=True)
    ensure_step_markdown(md_path, folder_name, topic)

    # 指示は「存在確認だけ」に絞る。調査・修正の余地を残すと AI が読み込みや点検を始め、
    # フォルダ作成ステップが実行タイムアウトまで伸びるため。
    prompt = (
        "以下は AiDiy の自動ビデオ生成ワークフローの 1 ステップです。\n\n"
        f"【今回のステップ内容】\n{step_summary}\n\n"
        "このステップで行うのは、下記ファイルの存在確認だけです。\n"
        "コピー・作成・修正・翻訳・調査は一切行わないでください。ファイルの中身を開く必要もありません。\n\n"
        "【確認するもの】次の 5 つがあるかどうかだけを見てください\n"
        f'  "{index_path}"\n'
        f'  "{scenario_path}"\n'
        f'  "{images_dir}"（この時点では空でよい）\n'
        f'  "{audio_dir}"（この時点では空でよい）\n'
        f'  "{md_path}"\n\n'
        "【やらないこと】\n"
        "  - robocopy / copy などでのコピー（Python 側で実行済みです）\n"
        "  - 既存ファイルの上書き・削除・内容修正・翻訳\n"
        "  - index.html や scenario.js の中身の確認（翻訳前のままで正常です）\n"
        "  - 参考資料・ナレッジ・設定ファイルの読み込み\n"
        "  - 他フォルダの調査\n"
        + (
            ""
            if not folder_already_exists else
            f'  - テンプレートからのコピー（"{new_dir}" には作りかけの内容が入っています）\n'
        )
        + "\n"
        "【報告】フォルダ直下のファイル一覧を表示し、上の 5 つが揃っているかだけ答えてください。\n"
        "  足りないものがあれば名前を挙げるだけにしてください（補完は不要です）。\n"
    )
    await agent_run(ctx, ca, prompt, timeout_sec=180)

    os.makedirs(images_dir, exist_ok=True)
    os.makedirs(audio_dir, exist_ok=True)
    ensure_step_markdown(md_path, folder_name, topic)

    ok1 = check(f"フォルダ存在: {new_dir}", os.path.isdir(new_dir))
    ok2 = check("index.html 存在", os.path.isfile(index_path))
    ok3 = check("scenario.js 存在", os.path.isfile(scenario_path))
    ok4 = check("images/ 存在", os.path.isdir(images_dir))
    ok5 = check("audio/ 存在", os.path.isdir(audio_dir))
    if not (ok1 and ok2 and ok3 and ok4 and ok5):
        return False

    # 判定は全体の差分件数のまま。内訳として出力フォルダ配下の件数も表示させる
    diff = backup_diff_count_url(ctx.backup_api_url, new_dir, folder_name)
    if diff > 0:
        backup_save_once_url(ctx.backup_api_url)
    return True


# ================================================================== #
# Step 03: シナリオ翻訳
# ================================================================== #

async def step_create_scenario(ctx: VideoGenCtx, ca: dict, attempt: int = 1) -> bool:
    sep("Step 03: シナリオ作成")
    step_name = "Step 03: シナリオ作成"
    new_dir = ctx.output_dir
    folder_name = ctx.folder_name
    topic = ctx.topic

    step_summary = (
        f'  "{folder_name}" の scenario.js をコピー元から翻訳します。\n'
        "  scene 構成、画像・音声パス、short/long ナレーション形式を維持し、表示文言を指定言語へ揃えます。"
    )
    scenario_path = os.path.join(new_dir, "scenario.js")
    md_path       = os.path.join(new_dir, f"{folder_name}.md")
    template_scen = os.path.join(ctx.template_dir, "scenario.js")
    guide_tts(ctx, f"{progress_step_label(step_name)} is starting. I will translate the Japanese source scenario into the target language.")

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
            f"  構造（scene ID・音声ファイル名・version={SCENARIO_VERSION}）は維持してください。\n\n"
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
        "【★★ 表現品質の絶対禁止事項 ★★】\n"
        "禁止表現: Japanese-first / Japanese-First / Japanese-centric / Japanese-only / Native Japanese-language\n"
        "代替表現例: 'business-domain identifier conventions', 'full-stack business template built in Japan'\n\n"
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
        "【作業 A】scenario.js の翻訳\n"
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
        f'コピー元 scenario.js: "{template_scen}"\n'
        f'出力先: "{scenario_path}"\n\n'
        f"■ 出力言語: {ctx.language}\n"
        "  - 日本語の字幕、見出し、本文、ナレーション原稿を残さない\n"
        "  - 固有名詞、製品名、ファイル名、URL、API パス、JSON キーは変更しない\n\n"
        "■ 必須要件（構造の完全維持）\n"
        '- window.SCENARIO = { ... } 形式を完全に維持する\n'
        '- コピー元の "version" フィールドの値はそのまま維持する\n'
        '- "project_name" は出力フォルダ名へ更新する\n'
        '- top-level の "title" は指定言語の自然なタイトルへ翻訳する\n'
        f'- target.language は "{ctx.language}" または "{ctx.language}-US" など、翻訳先言語へ更新する\n'
        '- assets_policy やその他の設定ブロックは一切変更せずそのまま維持する\n\n'
        "■ 翻訳するフィールド\n"
        "  title, kicker, headline, chips, metrics, cards, facts,\n"
        "  evidence 配列内の text, short_narration, long_narration,\n"
        "  dialogue 配列内の naration_text, image_prompt\n\n"
        "■ 翻訳・変更しないフィールド\n"
        "  キー名、id、image、*_audio、audio、start_sec、*_duration_sec、duration_sec\n\n"
        f"■ 翻訳メモ / テーマ補足・追加指示: {topic}\n\n"
        f'【作業 B】"{md_path}" の「シナリオ作成」チェックを [x] にしてください。\n\n'
        "【完了確認】scenario.js の先頭10行を表示してください。\n"
    )
    await agent_run(ctx, ca, prompt, timeout_sec=600)

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
        ok3 = validate_scene_id_range(scenario_path, min_mid=5, max_mid=28, label="翻訳シナリオ") if ok1 else False
        ok4 = validate_scene_expressions(scenario_path, label="翻訳シナリオ") if ok1 else False
        ok5 = validate_scene_media_refs(scenario_path, label="翻訳シナリオ") if ok1 else False
        ok6 = False
        if ok1:
            updated = ensure_scene_html_pages(new_dir, scenario_path, language=ctx.language)
            ok6 = check(f"scene HTML をシナリオ全件分生成（更新 {len(updated)} 件）", True)
        return ok1 and ok2 and ok3 and ok4 and ok5 and ok6

    return await verify_and_backup_until_stable(
        ctx=ctx, ca=ca,
        step_name=step_name, step_summary=step_summary,
        target_paths=[scenario_path, md_path],
        validate=validate, verify_timeout_sec=300, attempt=attempt,
    )


# ================================================================== #
# Step 04: HTML翻訳
# ================================================================== #

async def step_update_html(ctx: VideoGenCtx, ca: dict, attempt: int = 1) -> bool:
    sep("Step 04: HTML修正")
    step_name = "Step 04: HTML修正"
    new_dir = ctx.output_dir
    folder_name = ctx.folder_name
    topic = ctx.topic

    step_summary = (
        f'  "{folder_name}" の index.html を scenario.js と指定言語に合わせて修正します。\n'
        "  <title>、.brand、.top-note、見出しなどの日本語文言を翻訳します。"
    )
    index_path    = os.path.join(new_dir, "index.html")
    scenario_path = os.path.join(new_dir, "scenario.js")
    md_path       = os.path.join(new_dir, f"{folder_name}.md")
    guide_tts(ctx, f"{progress_step_label(step_name)} is starting. I will translate the page title and visible descriptions.")

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
        "【★★ 表現品質の絶対禁止事項 ★★】\n"
        "禁止: Japanese-first / Japanese-First / Japanese-centric / Japanese-only / Native Japanese-language\n"
        "代替: 'built in Japan', 'domain-aligned identifiers', 'practical full-stack business framework'\n\n"
        "【対象ファイル】\n"
        f'  index.html: "{index_path}"\n'
        f'  scenario.js（必ず読むこと）: "{scenario_path}"\n\n'
        "【修正方針】\n"
        "  - HTML/CSS/JavaScript の基本構造、レイアウト、再生ロジックは一切変更・破壊せず維持する。\n"
        "  - CSS クラス名、JavaScript 変数名、ファイルパスは変更しない。\n\n"
        "【更新箇所と scenario.js からの参照元】\n"
        f'  1. <title>   ← scenario.js の top-level "title" フィールドを使う\n'
        f'  2. .brand    ← "AiDiy" + scenario.js の top-level "title" を短く要約した表現\n'
        f'  3. .top-note ← scenario.js の scene_000 の "lead" または "subtitle" を使う\n'
        "  4. その他 HTML 内に残っている日本語テキストや古い文言があれば、指定言語へ置き換える。\n\n"
        "【今回の設定】\n"
        f"  フォルダ名: {folder_name}\n"
        f"  出力言語: {ctx.language}\n\n"
        f'"{md_path}" の「HTML修正」チェックを [x] にしてください。\n\n'
        "【完了確認】index.html の <title> と .brand と .top-note の最終的な文言を表示してください。\n"
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
        target_paths=[index_path, scenario_path, md_path],
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
    guide_tts(ctx, f"{progress_step_label(step_name)} is starting. I will generate the scene images.")

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

    template_image_dir = 参照画像ディレクトリ(ctx, images_dir)
    if template_image_dir:
        print(f"  [image] 参照画像フォルダ: {template_image_dir}")

    ensure_scene_image_script(
        ctx, gen_img_py,
        output_dir=os.path.join(new_dir, "images"),
        template_image_dir=template_image_dir,
        build_prompt_fn=_build_scene_image_prompt_body(ctx.language),
        language=ctx.language,
    )
    print(f"  [image] 補助スクリプトを生成しました: {gen_img_py}")
    print(f'  [image] 実行コマンド: "{ctx.mcp_python}" "{gen_img_py}"')
    run_python_script(ctx.mcp_python, gen_img_py)
    mark_step_done(md_path, "画像生成")

    def validate() -> bool:
        if not os.path.isdir(images_dir):
            check("images フォルダ存在", False)
            return False
        expected = count_scenario_scenes(scenario_path) if os.path.isfile(scenario_path) else 8
        pngs = [f for f in os.listdir(images_dir) if f.endswith(".png") and os.path.getsize(os.path.join(images_dir, f)) > 1000]
        return check(f"images/*.png 生成数: {len(pngs)} 件（期待 {expected} 件以上）", expected > 0 and len(pngs) >= expected)

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
    guide_tts(ctx, "I will recover the prerequisites for the mid review by rerunning scenario translation, HTML translation, and image generation.", voice="male")
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
    index_path    = os.path.join(new_dir, "index.html")
    images_dir    = os.path.join(new_dir, "images")
    gen_img_py    = os.path.join(new_dir, "_gen_scene_images.py")
    md_path       = os.path.join(new_dir, f"{folder_name}.md")
    guide_tts(ctx, f"{progress_step_label(step_name)} is starting. I will run the mid review.")
    ensure_step_markdown(md_path, folder_name, topic)
    expected_image_count = count_scenario_scenes(scenario_path) if os.path.isfile(scenario_path) else 8

    def _count_valid_images() -> int:
        return sum(1 for f in os.listdir(images_dir) if f.endswith(".png") and os.path.getsize(os.path.join(images_dir, f)) > 1000) if os.path.isdir(images_dir) else 0

    if not os.path.isfile(scenario_path) or not os.path.isfile(index_path) or _count_valid_images() < expected_image_count:
        reason = (f"Step 06 の前提不足 (scenario={os.path.isfile(scenario_path)}, "
                  f"index={os.path.isfile(index_path)}, images={_count_valid_images()}/{expected_image_count})")
        if not await _recover_sources(ctx, ca, reason=reason, attempt=attempt):
            return False

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
        "  1. テーマと照らして事実と大きく異なる内容、不適切な言葉があれば修正する。\n"
        "  2. ナレーションや対話テキストの中に、AiDiy のビデオページ生成機能で作られた旨があるか確認する。\n"
        "  3. ナレーション/対話の役割分担や読み上げ分量が全体として自然であるか確認する。\n"
        "  4. scene_999 などの締めが楽しく前向きで AiDiy を試してみたくなるか確認する。\n"
        "  5. index.html の title、brand、top-note、説明文も同じ観点で確認する。\n"
        "  6. 問題がなければ不要な全面書き換えや再生成はしない。\n\n"
        "【今回のテーマ】\n"
        f"  フォルダ名: {folder_name}\n"
        f"  テーマ詳細・追加指示: {topic}\n\n"
        f'"{md_path}" の「中間確認」チェックを [x] にしてください。\n'
    )
    await agent_run(ctx, ca, prompt, timeout_sec=600)
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
        return ok1 and ok2 and ok3 and ok4 and ok5

    ok = await verify_and_backup_until_stable(
        ctx=ctx, ca=ca,
        step_name=step_name, step_summary=step_summary,
        target_paths=[scenario_path, index_path, images_dir, gen_img_py, md_path],
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
    expected_audio_count = count_scenario_dialogues(scenario_path) if os.path.isfile(scenario_path) else 0
    expected_image_count = count_scenario_scenes(scenario_path) if os.path.isfile(scenario_path) else 8
    guide_tts(ctx, f"{progress_step_label(step_name)} is starting. I will run the final artifact check.")
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
        "  確認 1: scenario.js が存在し 'window.SCENARIO' と 'scene_999' が含まれるか\n"
        f"  確認 2: images フォルダに *.png が {expected_image_count} 枚以上あるか\n"
        f"  確認 3: audio フォルダに *.mp3 が {expected_audio_count} 個以上あるか\n"
        "  確認 4: index.html が存在し、今回のフォルダ名が含まれるか\n"
        "  確認 5: _gen_audio.py が存在するか\n"
        "  確認 6: ナレーション/対話セリフの中に、AiDiy のビデオページ生成機能で作られた旨があるか\n"
        "  確認 7: scenario.js に記述された各シーンの音声が漏れなく audio/ フォルダに生成されているか\n\n"
        "【手順 2】不足があれば修正\n"
        f'  images 不足: "{ctx.mcp_python}" "{gen_img_py}" を実行\n'
        f'  audio 不足:  "{ctx.mcp_python}" "{gen_aud_py}" を実行\n\n'
        + video_menu_review_prompt(ctx)
        + "  最後に、修正したファイルと未修正で OK と判断したファイルを一覧表示してください。\n"
    )
    await agent_run(ctx, ca, prompt, timeout_sec=600)

    def validate() -> bool:
        ok1 = check("scenario.js 存在", os.path.isfile(scenario_path))
        ok2 = check("index.html 存在", os.path.isfile(os.path.join(new_dir, "index.html")))
        ok3 = check("_gen_scene_images.py 存在", os.path.isfile(gen_img_py))
        ok4 = check("_gen_audio.py 存在", os.path.isfile(gen_aud_py))
        ok5 = check(f"進捗 Markdown 存在: {md_path}", os.path.isfile(md_path))
        ok6 = False
        if os.path.isdir(images_dir):
            pngs = [f for f in os.listdir(images_dir) if f.endswith(".png") and os.path.getsize(os.path.join(images_dir, f)) > 1000]
            ok6 = check(f"images/*.png 生成数: {len(pngs)}/{expected_image_count}", expected_image_count > 0 and len(pngs) >= expected_image_count)
        else:
            check("images フォルダ存在", False)
        ok7 = False
        if os.path.isdir(audio_dir):
            mp3s = [f for f in os.listdir(audio_dir) if f.endswith(".mp3") and os.path.getsize(os.path.join(audio_dir, f)) > 500]
            required = expected_audio_count if expected_audio_count > 0 else 1
            ok7 = check(f"audio/*.mp3 生成数: {len(mp3s)}/{required}", len(mp3s) >= required)
        else:
            check("audio フォルダ存在", False)
        ok8 = video_menu_registration_ok(ctx)
        return ok1 and ok2 and ok3 and ok4 and ok5 and ok6 and ok7 and ok8

    ok = await verify_and_backup_until_stable(
        ctx=ctx, ca=ca,
        step_name=step_name, step_summary=step_summary,
        target_paths=[scenario_path, os.path.join(new_dir, "index.html"), images_dir, audio_dir, gen_img_py, gen_aud_py, md_path,
                      *video_menu_registration_paths(ctx)],
        validate=validate, verify_timeout_sec=300, attempt=attempt,
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
        progress_tts_language="en", progress_tts_provider="edge",
        use_english_voice=True,
        progress_label_fn=progress_step_label,
    )
    runner.print_flow()
    ctx = runner.ctx
    new_dir = ctx.output_dir
    gen_aud_py = os.path.join(new_dir, "_gen_audio.py")

    load_tasks_body, synthesize_body, main_loop_body = _build_audio_bodies()

    def _ensure_audio_script() -> None:
        ensure_dialogue_audio_script(
            ctx, gen_aud_py,
            output_dir=os.path.join(new_dir, "audio"),
            load_tasks_body=load_tasks_body,
            synthesize_body=synthesize_body,
            main_loop_body=main_loop_body,
            script_docstring="ナレーション音声生成スクリプト（汎用設計）",
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
        (1,  "フォルダ作成", lambda ca, attempt=1: step_create_folder(ctx, ca, attempt=attempt)),
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
