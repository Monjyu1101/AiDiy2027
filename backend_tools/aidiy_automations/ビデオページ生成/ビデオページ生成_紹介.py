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
ビデオページ生成_紹介.py — 一人アバター（AiDiy）による紹介ビデオ自動生成スクリプト

◆ このスクリプトが作るビデオ:
    AiDiy アバター（女性、一人）が機能・ツール・仕組みを 1 体で紹介する「紹介・ガイド型」動画。
    scenario.js の version は "mcp"。
    各シーンは short_narration（短い要約）と long_narration（詳しい説明）の 2 段階ナレーションを持ち、
    音声ファイルは short_scene_NNN.mp3 / long_scene_NNN.mp3 の形式で生成する。
    テンプレートは "AiDiy紹介__all_ja" フォルダを使用。

使い方:
    cd backend_tools
    .venv\\Scripts\\python aidiy_automations\\ビデオページ生成\\ビデオページ生成_紹介.py [実行ステップ番号]
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
    step_instruction_header, guide_tts,
    step_no_to_value, step_value_to_int, get_completed_step,
    ensure_preview_minimum_duration_mcp,
    run_python_script, topic_brief,
)
from utils.generation import (
    ensure_scene_image_script, ensure_dialogue_audio_script,
    validate_scene_id_range, validate_scene_expressions, validate_scene_media_refs, index_html_matches_theme,
    scenario_title_and_lead, ensure_step_markdown, mark_step_done,
    backup_images_for_fix_mode, 参照画像ディレクトリ,
    count_scenario_scenes, count_scenario_dialogues, ensure_scene_html_pages,
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

SCRIPT_TYPE = "紹介"
SCRIPT_FILE_NAME = os.path.basename(__file__)
SETTING_JSON_NAME = "_ビデオページ生成_紹介_設定.json"
STEPS_JSON_NAME = "_ビデオページ生成_紹介_状況.json"

SETTING_JSON_PATH = os.path.join(_SCRIPT_DIR, SETTING_JSON_NAME)
STEPS_JSON_PATH = os.path.join(_SCRIPT_DIR, STEPS_JSON_NAME)

NEWS_VIDEO_KNOWLEDGE_PATH = os.path.join(REPO_DIR, "_AIDIY", "knowledge", "backend_server,backend_tools,MCP活用手順.md")
AUTO_VIDEO_KNOWLEDGE_PATH = os.path.join(REPO_DIR, "_AIDIY", "knowledge", "共通,mcp利用による自動ビデオ生成手順.md")


# ================================================================== #
# 紹介固有: 補助スクリプト生成
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
        "    lines = ['Create a high-quality, professional widescreen illustration/concept-art for a technology introduction presentation.']\n"
        "    if kicker: lines.append(f'Topic: {kicker}.')\n"
        "    if title: lines.append(f'Title: {title}.')\n"
        "    if headline: lines.append(f'Headline: {headline}.')\n"
        "    if lead: lines.append(f'Details: {lead}.')\n"
        "    if subtitle: lines.append(f'Concept: {subtitle}.')\n"
        "    lines.append('Style: modern technical slide illustration, clean design, gradient background, futuristic, beautiful, no text overlay baked into the image.')\n"
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
    synthesize_body = (
        "def synthesize_one(text, out_path):\n"
        "    text = apply_pronunciation(text, out_path)\n"
        "    return post_json(TTS_API_URL, {\n"
        '        "speech_text": text,\n'
        '        "language": TTS_LANGUAGE,\n'
        '        "provider": "freeai",\n'
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

    step_summary = (
        f'  "{folder_name}" の scenario.js を作成・更新します。\n'
        "  7〜12 シーン構成、short/long ナレーション、画像・音声パス、AiDiy 説明入りのまとめを整えます。"
    )
    scenario_path = os.path.join(new_dir, "scenario.js")
    md_path       = os.path.join(new_dir, f"{folder_name}.md")
    template_scen = os.path.join(ctx.template_dir, "scenario.js")
    guide_tts(ctx, f"{step_name} を開始します。テーマに沿った台本を作成します。")

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
        '- assets_policy はテンプレートの値をそのまま維持（変更しないこと）\n\n'
        "■ scenes 構成（最小7ページ、最大30ページ）\n"
        "  - scene_000: イントロ。先頭固定\n"
        "  - scene_001〜scene_005: 各テーマ。最低限必須\n"
        "  - 必要に応じて scene_006〜scene_028 まで追加可\n"
        "  - scene_999: まとめ。最後固定\n\n"
        "■ 通常は内容に応じて7〜20ページで構成する。30ページは絶対上限であり、目標ページ数ではない\n"
        "  - 21〜30ページは、topic に明示指定がある場合、または20ページでは内容を詰め込みすぎる場合だけ使用する\n"
        "  - ページ数はテーマの情報量に合わせて決めること（7ページ固定・30ページ固定ではない）\n"
        "  - 基本の考え方: 紹介したい機能・論点が N 個あるなら『イントロ + N + まとめ』にする\n"
        "  - 増やす判断: 1 つのシーンに別々の話題が 3 つ以上入るなら、そこは分けてシーンを増やす。\n"
        "    説明が長くなって long_narration が 400 文字を超えそうなときも分けるサイン\n"
        "  - 減らす判断: 内容の薄いシーンを足して水増ししないこと。語ることが少ないテーマは\n"
        "    最小構成に収め、1 シーンあたりの密度を保つほうがよい\n"
        "  - topic にシーン構成の指定があるときは、その指定を最優先する\n\n"
        "■ 各シーンの必須フィールド\n"
        '  "id", "title", "expression": "neutral", "accent", "accent_soft",\n'
        '  "kicker", "headline", "image": "images/scene_NNN.png",\n'
        '  "chips", "metrics", "cards", "facts", "evidence",\n'
        '  "short_narration", "long_narration",\n'
        '  "short_audio": "audio/short_scene_NNN.mp3",\n'
        '  "long_audio": "audio/long_scene_NNN.mp3",\n'
        '  "short_start_sec": 0.0, "short_duration_sec": 10.0,\n'
        '  "long_start_sec": 0.0, "long_duration_sec": 30.0\n\n'
        '■ "expression" は全シーン "neutral" 固定にすること\n'
        "  （happy などを混ぜるとアバターの表情が崩れる。他テーマの紹介動画も全シーン neutral で統一している）\n\n"
        "■ scene_000 の long_narration 冒頭に「AiDiy のビデオページ生成機能で自動生成されました」という趣旨を必ず入れる\n\n"
        "■ scene_999 の long_narration に必ず含めること\n"
        "  (1) AiDiy で作られたという説明  (2) チャンネル登録のお願い\n"
        "  (3) AiDiy を使ってみたくなる誘導フレーズ  (4) 楽しく前向きな終わり方\n\n"
        f"■ テーマ: {topic}\n\n"
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
        ok3 = validate_scene_id_range(scenario_path, min_mid=5, max_mid=28, label="紹介シナリオ") if ok1 else False
        ok4 = validate_scene_expressions(scenario_path, label="紹介シナリオ") if ok1 else False
        ok5 = validate_scene_media_refs(scenario_path, label="紹介シナリオ") if ok1 else False
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
        "  <title>、.brand、.top-note、見出しなどのテンプレート元文言を置き換えます。"
    )
    index_path    = os.path.join(new_dir, "index.html")
    scenario_path = os.path.join(new_dir, "scenario.js")
    md_path       = os.path.join(new_dir, f"{folder_name}.md")
    guide_tts(ctx, f"{step_name} を開始します。画面のタイトルと説明を修正します。")

    already_valid = index_html_matches_theme(index_path, scenario_path, folder_name, topic)
    if already_valid:
        print("  [既存] index.html は機械検証済みです。CodeAgents の再実行を省略します")

    # 検証（index_html_matches_theme）は scenario.js の title / project_name などが
    # index.html に含まれるかで判定する。指示側に同じ値を明示しないと、エージェントが
    # 独自に要約したタイトルを書いてしまい、検証NGのリトライを繰り返す。
    scenario_title, scene000_lead = scenario_title_and_lead(scenario_path)
    title_source = scenario_title or folder_name

    fix_mode_prefix_html = ""
    if ctx.fix_mode and os.path.isfile(index_path):
        # 先頭抜粋は <style> しか入らず、修正対象（.brand / .top-note は 350 行目付近）を含まない。
        # 抜粋は貼らず、パスを渡して必要な箇所だけ読ませる。
        fix_mode_prefix_html = (
            "【修正モード】\n"
            "  index.html は既にあります。全文を書き直さず、下記【更新箇所】の該当行だけを置換してください。\n\n"
        )

    prompt = (
        step_instruction_header(ctx, step_name, step_summary)
        + fix_mode_prefix_html
        + "以下の手順で index.html を修正してください。\n\n"
        "【対象ファイル】\n"
        f'  修正する: "{index_path}"\n'
        f'  参照する（先に読むこと）: "{scenario_path}"\n\n'
        "【参考ナレッジ】\n"
        f'  - "{NEWS_VIDEO_KNOWLEDGE_PATH}"\n\n'
        "【厳守（守らないと検証NGでやり直しになります）】\n"
        "  - 全文を書き直さない。下記【更新箇所】に挙げた箇所だけを置換する。\n"
        "  - <style> と <script> の中身は変更しない。CSS クラス名、id、JavaScript の変数名・関数名、\n"
        "    ファイルパス（scenario.js、images/、audio/、../_vrm/）は 1 文字も変えない。\n"
        "  - 1アバター（シングル）表示、リップシンク、字幕表示ロジックは触らない。\n"
        "  - short_narration / long_narration の切り替え、short_audio / long_audio 再生ロジックは触らない。\n"
        "  - シーンの本文（見出し、セリフ、画像パス）は scenario.js が持つ。\n"
        "    index.html にシーン内容を書き足さない。\n\n"
        "【更新箇所】\n"
        "  1. <title> …… 次の文字列をそのまま入れる（要約・短縮・語句の変更をしない）。\n"
        f"       {title_source}\n"
        "     前後に文言を足す場合も、この文字列は欠けなく含めること。\n"
        "  2. .brand div の中身 …… 今回のテーマを表す短い見出し（全角 20 文字程度まで）。\n"
        "     テンプレート元の「AiDiy 完全紹介」は残さない。\n"
        "  3. .top-note div の中身 …… 下記の scene_000 lead を基に 1〜2 文で書く。<br> 区切りは残してよい。\n"
        "  4. 1〜3 以外にテンプレート元テーマの文言が残っていれば今回のテーマへ置き換える。\n\n"
        "【今回のテーマ】\n"
        f"  フォルダ名: {folder_name}\n"
        f"  scenario.js の title: {scenario_title or '(取得できず)'}\n"
        f"  scene_000 の lead: {scene000_lead or '(取得できず)'}\n"
        f"  テーマ要約: {topic_brief(topic)}\n\n"
        f'"{md_path}" の「HTML修正」チェックを [x] にしてください。\n\n'
        "【完了確認】index.html の <title>、.brand、.top-note の最終的な文言を表示してください。\n"
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
        "  2. scene_000 の long_narration に AiDiy のビデオページ生成機能で作られた旨があるか確認する。\n"
        "  3. short_narration は短い要約、long_narration は詳しい読み上げになっているか確認する。\n"
        "  4. scene_999 の締めが楽しく前向きで AiDiy を試してみたくなるか確認する。\n"
        "  5. index.html の title、brand、top-note も確認し、必要なら修正する。\n"
        "  6. 問題がなければ不要な全面書き換えや再生成はしない。\n\n"
        "【今回のテーマ】\n"
        f"  フォルダ名: {folder_name}\n"
        f"  テーマ詳細: {topic}\n\n"
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
        "  確認 1: scenario.js が存在し 'window.SCENARIO' と 'scene_999' が含まれるか\n"
        f"  確認 2: images フォルダに *.png が {expected_image_count} 枚以上あるか\n"
        f"  確認 3: audio フォルダに *.mp3 が {expected_audio_count} 個以上あるか\n"
        "  確認 4: index.html が存在し、今回のフォルダ名が含まれるか\n"
        "  確認 5: _gen_audio.py が存在するか\n"
        "  確認 6: scene_000 の long_narration に AiDiy のビデオページ生成機能で作られた旨があるか\n"
        "  確認 7: 各 scene に short_narration / long_narration / short_audio / long_audio があるか\n\n"
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
            script_docstring="ナレーション音声生成スクリプト（mcp 形式）",
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
