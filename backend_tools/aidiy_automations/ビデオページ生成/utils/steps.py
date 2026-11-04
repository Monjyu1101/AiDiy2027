# -*- coding: utf-8 -*-
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""
steps.py — 3 スクリプト共通ステップ実装

step00_preflight, step_create_folder, step_generate_audio,
step_review_audio, step_update_durations, step_mid_review, step_final_review,
step_completion_notice を提供する。

各関数は ctx: VideoGenCtx を受け取り、グローバル変数に依存しない。
"""

from __future__ import annotations

import json
import os
import shutil
import sys
import time

from .ctx import VideoGenCtx
from .log_config import get_logger

_logger = get_logger("video_gen.steps")
from .infra import (
    sep, check, run_python_script,
    step_no_to_value, step_value_to_int,
    get_completed_step, set_completed_step, ensure_steps_json,
    guide_tts, refresh_browser_preview, start_final_playback,
    PREVIEW_AUTO_NONE, PREVIEW_AUTO_LOOP,
    agent_run, step_instruction_header, topic_brief,
    verify_and_backup_until_stable,
    post_backup_api,
)
from .generation import (
    ensure_step_markdown, mark_step_done,
    count_scenario_scenes, count_scenario_dialogues,
    collect_scenario_duration_stats, update_scenario_audio_durations,
)
from .audio_review import audio_tasks, ensure_audio_script_review_support, review_audio_by_agent


# ================================================================== #
# Step 00: 初期確認
# ================================================================== #

async def step00_preflight(ctx: VideoGenCtx, ca: dict, attempt: int = 1) -> bool:
    """Step 00: 自動化を始める前の初期確認。"""
    from .infra import _post_backup_api  # noqa: PLC0415
    step_name = "Step 00: 初期確認"
    sep(step_name)

    tts_msg = (
        "Step zero, preflight is starting. I will check the settings, template, APIs, and available AI agents."
        if ctx.use_english_voice else
        "ステップゼロ、初期確認を開始します。設定、テンプレート、API、AIの利用可否を確認します。"
    )
    guide_tts(ctx, tts_msg)

    ok_template = check(f"テンプレート存在: {ctx.template_dir}", os.path.isdir(ctx.template_dir))
    ok_base = check(f"生成先ルート存在: {ctx.video_base_dir}", os.path.isdir(ctx.video_base_dir))
    ok_folder = check("フォルダ名指定", bool(ctx.folder_name.strip()))
    ok_topic = check("トピック指定", bool(ctx.topic.strip()))
    version_info = ca.get("version_info", {})
    ok_agents = check("CodeAgents HTTP API 利用可能", bool([k for k, v in version_info.items() if v.get("ok")]))

    try:
        post_backup_api(ctx.backup_api_url, dry_run=True)
        ok_backup = check(f"backup API 疎通: {ctx.backup_api_url}", True)
    except Exception as e:
        print(f"  [backup] 疎通確認 NG: {e}")
        ok_backup = check(f"backup API 疎通: {ctx.backup_api_url}", False)

    if ctx.tts_guide:
        try:
            tts_check_msg = (
                "This is the progress voice check. The AiDiy automation can start."
                if ctx.use_english_voice else
                "音声案内の確認です。AiDiy 自動化ソリューションを開始できます。"
            )
            guide_tts(ctx, tts_check_msg)
            ok_tts = check(f"tts API 案内: {ctx.tts_api_url}", True)
        except Exception as e:
            print(f"  [tts] 疎通確認 NG: {e}")
            ok_tts = check(f"tts API 案内: {ctx.tts_api_url}", False)
    else:
        ok_tts = check("tts API 案内: OFF", True)

    print(f"  出力予定: {ctx.output_dir}")
    return ok_template and ok_base and ok_folder and ok_topic and ok_agents and ok_backup and ok_tts


# ================================================================== #
# Step 01: フォルダ作成
# ================================================================== #

def _テンプレートを機械コピー(
    template_dir: str,
    new_dir: str,
    *,
    画像コピー: bool = False,
) -> tuple[list[str], list[str]]:
    """テンプレートフォルダを Python で直接コピーする。

    以前は AI へ robocopy を実行させていたが、コマンドの成否がエージェント任せになり
    フォルダ作成が失敗することがあったため、コピー自体はここで機械的に済ませる
    （AI には結果の確認だけを依頼する）。

    - audio / __pycache__ の中身はコピーしない（各動画で生成するため）
    - images も既定ではコピーしない。テンプレートの絵をそのまま持ち込まず、
      今回のテーマで作り直すため。生成時はコピーの代わりにテンプレート画像の
      パスを参照として渡す（generation.参照画像ディレクトリ)
    - テンプレート側の進捗 Markdown はコピーしない（今回のテーマで作り直すため）
    - 既存ファイルは上書きしない（作りかけの成果物を壊さないため）

    Args:
        画像コピー: True で images の中身もコピーする。翻訳のように
            絵をそのまま流用して作り直さない用途だけで使う。
            コピーしておくと画像生成ステップが全件スキップになり、再実行が早く終わる。

    戻り値: (コピーしたファイル名, 既存のため据え置いたファイル名)
    """
    除外フォルダ = {"audio", "__pycache__", ".git", ".git_local", ".aidiy_backup", ".backup_local", ".aidiy_cache"}
    if not 画像コピー:
        除外フォルダ.add("images")
    コピー済: list[str] = []
    据え置き: list[str] = []
    for root, dirs, files in os.walk(template_dir):
        dirs[:] = [d for d in dirs if d not in 除外フォルダ]
        相対 = os.path.relpath(root, template_dir)
        出力先 = new_dir if 相対 == "." else os.path.join(new_dir, 相対)
        os.makedirs(出力先, exist_ok=True)
        for name in files:
            if name.lower().endswith(".md"):
                continue  # 進捗 Markdown は ensure_step_markdown が今回のテーマで作る
            dst = os.path.join(出力先, name)
            if os.path.isfile(dst):
                据え置き.append(name)
                continue
            shutil.copy2(os.path.join(root, name), dst)
            コピー済.append(name)
    return コピー済, 据え置き


async def step_create_folder(
    ctx: VideoGenCtx,
    ca: dict,
    knowledge_paths: tuple[str, str],
    attempt: int = 1,
) -> bool:
    """Step 01: 出力フォルダの土台を作成する。

    テンプレートのコピー・images/audio の作成・進捗 Markdown の作成は Python 側で機械的に行い、
    AI には「揃っているか」「テンプレート由来の文言が残っていないか」の確認だけを依頼する。
    """
    sep("Step 01: フォルダ作成")
    step_name = "Step 01: フォルダ作成"
    new_dir = ctx.output_dir
    folder_name = ctx.folder_name
    topic = ctx.topic
    template_dir = ctx.template_dir
    # knowledge_paths は他ステップと同じ引数で受けるが、このステップでは渡さない。
    # 存在確認だけの作業にナレッジは不要で、読ませると調査が始まりタイムアウトの原因になる。
    _ = knowledge_paths

    # topic 全文（2000字超）は貼らない。フォルダの存在確認に内容は要らず、
    # 長い指示ほど AI が余計な調査を始めてタイムアウトしやすくなるため。
    step_summary = (
        f'  動画フォルダ "{new_dir}" を用意します。\n'
        "  テンプレートからのコピー、images/・audio/ の作成、進捗 Markdown の用意は\n"
        "  このスクリプトが Python で実行済みです。AI 側はファイルの存在確認だけを行ってください。"
    )

    md_path    = os.path.join(new_dir, f"{folder_name}.md")
    index_path = os.path.join(new_dir, "index.html")
    tts_msg = (
        "AiDiy automation is starting. Step one, folder preparation will prepare the video folder."
        if ctx.use_english_voice else
        f"AiDiy 自動化ソリューションを開始します。{step_name}、動画フォルダを準備します。"
    )
    guide_tts(ctx, tts_msg)

    folder_already_exists = (
        os.path.isdir(new_dir)
        and os.path.isfile(index_path)
        and os.path.isfile(os.path.join(new_dir, "scenario.js"))
    )
    if folder_already_exists:
        print("  [既存] コピー先に index.html / scenario.js が存在します。テンプレートからのコピーは行いません")
    else:
        print("  [新規] テンプレートからフォルダを作成します")

    images_dir = os.path.join(new_dir, "images")
    audio_dir = os.path.join(new_dir, "audio")

    # テンプレートのコピーは AI に任せず機械的に行う。ただし出力フォルダが既にある場合は一切コピーしない
    # （途中まで作った scenario.js などをテンプレートで壊さないため）
    os.makedirs(new_dir, exist_ok=True)
    if not folder_already_exists:
        try:
            コピー済, 据え置き = _テンプレートを機械コピー(template_dir, new_dir)
            print(f"  [copy] テンプレートから {len(コピー済)} 件コピーしました（既存のため据え置き {len(据え置き)} 件）")
            if コピー済:
                表示 = ", ".join(コピー済[:12]) + (" ..." if len(コピー済) > 12 else "")
                print(f"         {表示}")
        except Exception as e:
            print(f"  [copy] テンプレートのコピーに失敗しました: {e}")
            _logger.exception("テンプレートのコピーに失敗しました")

    # images / audio と進捗 Markdown も AI を待たずに用意する（AI 側は確認だけ）
    os.makedirs(images_dir, exist_ok=True)
    os.makedirs(audio_dir, exist_ok=True)
    ensure_step_markdown(md_path, folder_name, topic)

    # 指示は「存在確認だけ」に絞る。調査・修正の余地を残すと AI が読み込みや点検を始め、
    # フォルダ作成ステップが実行タイムアウトまで伸びるため。
    prompt = (
        step_instruction_header(ctx, step_name, step_summary)
        + "このステップで行うのは、下記ファイルの存在確認だけです。\n"
        "コピー・作成・修正・調査は一切行わないでください。ファイルの中身を開く必要もありません。\n\n"
        "【確認するもの】次の 5 つがあるかどうかだけを見てください\n"
        f'  "{index_path}"\n'
        f'  "{os.path.join(new_dir, "scenario.js")}"\n'
        f'  "{images_dir}"（この時点では空でよい）\n'
        f'  "{audio_dir}"（この時点では空でよい）\n'
        f'  "{md_path}"\n\n'
        "【やらないこと】\n"
        "  - robocopy / copy などでのコピー（Python 側で実行済みです）\n"
        "  - 既存ファイルの上書き・削除・内容修正\n"
        "  - index.html や scenario.js の中身の確認\n"
        "    （テンプレートのテーマのままで正常です。Step 04 で更新します）\n"
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

    # AI が誤って消した場合に備えて、確認後にもう一度だけ整える（既存は壊さない）
    os.makedirs(images_dir, exist_ok=True)
    os.makedirs(audio_dir, exist_ok=True)
    ensure_step_markdown(md_path, folder_name, topic)

    def validate() -> bool:
        ok1 = check(f"フォルダ存在: {new_dir}", os.path.isdir(new_dir))
        ok2 = check("index.html 存在", os.path.isfile(index_path))
        ok3 = check("scenario.js 存在", os.path.isfile(os.path.join(new_dir, "scenario.js")))
        ok4 = check("images / audio フォルダ存在",
                    os.path.isdir(images_dir) and os.path.isdir(audio_dir))
        ok5 = check("進捗 Markdown 存在", os.path.isfile(md_path))
        return ok1 and ok2 and ok3 and ok4 and ok5

    return await verify_and_backup_until_stable(
        ctx=ctx, ca=ca,
        step_name=step_name, step_summary=step_summary,
        target_paths=[new_dir, index_path, os.path.join(new_dir, "scenario.js"), md_path],
        # 存在確認だけのステップなので検証エージェントは呼ばない。
        # 呼ぶと AI が構文チェックや Markdown の手直しで毎ラウンド差分を作り、
        # ラウンドが積み上がって Step 01 だけで十数分かかる（タスク側がタイムアウトする）。
        validate=validate, verify_timeout_sec=180, attempt=attempt,
        skip_agent_verify=True,
    )


# ================================================================== #
# Step 02: ルーティング追加
# ================================================================== #

# folder_name の接頭辞 → Xビデオ.vue のセクション見出し。
# 上から順に判定し、どれにも当たらない場合は最後の要素の見出しへ入れる。
_VUE_SECTION_RULES = (
    ("AiDiy紹介", "AiDiy紹介"),
    ("AiDiy解説", "AiDiy実装・解説"),
    ("AiDiy実装", "AiDiy実装例"),
    ("ニュース", "時事ニュース・解説"),
    ("解説", "時事ニュース・解説"),
    ("四コマ漫画", "四コマ漫画"),
    ("小説", "小説"),
    ("", "時事ニュース・解説"),
)


def _vue_section_label(folder_name: str) -> str:
    """folder_name の接頭辞から Xビデオ.vue のセクション見出しを決める。"""
    for prefix, label in _VUE_SECTION_RULES:
        if prefix and folder_name.startswith(prefix):
            return label
    return _VUE_SECTION_RULES[-1][1]


def _routing_target_paths(ctx: VideoGenCtx) -> tuple[str, str, str]:
    """メニュー Vue と router のパス、URL セグメント（"Xビデオ"）を返す。

    video_base_dir は "<repo>/frontend_web/public/Xビデオ" 形式なので、
    そこから frontend_web を辿る。見つからない場合だけ repo_dir を使う。
    """
    video_base = os.path.normpath(ctx.video_base_dir)
    url_segment = os.path.basename(video_base) or "Xビデオ"
    frontend_dir = os.path.dirname(os.path.dirname(video_base))
    vue_path = os.path.join(frontend_dir, "src", "components", f"{url_segment}.vue")
    router_path = os.path.join(frontend_dir, "src", "router", "index.ts")
    if not (os.path.isfile(vue_path) and os.path.isfile(router_path)) and ctx.repo_dir:
        alt_dir = os.path.join(ctx.repo_dir, "frontend_web")
        alt_vue = os.path.join(alt_dir, "src", "components", f"{url_segment}.vue")
        alt_router = os.path.join(alt_dir, "src", "router", "index.ts")
        if os.path.isfile(alt_vue) and os.path.isfile(alt_router):
            return alt_vue, alt_router, url_segment
    return vue_path, router_path, url_segment


def _vue_const_name(folder_name: str) -> str:
    """folder_name から Vue の const 名を作る（JS 識別子として安全な形にする）。"""
    name = "".join(ch if (ch.isalnum() or ch == "_") else "_" for ch in folder_name)
    if not name or name[0].isdigit():
        name = f"v_{name}"
    return f"{name}Url"


def _menu_card_texts(folder_name: str, topic: str) -> tuple[str, str, str]:
    """メニューカードの (アイコン, タイトル, 説明) を folder_name と topic から作る。

    ここで作るのは AI が整える前の下書き。機械的に作っておくことで、
    AI 側が文言を直せなかった場合でも意味の通るカードが残る。
    """
    parts = [p for p in folder_name.split("_") if p]
    lang_suffixes = {"ja", "en", "zh", "ko", "fr", "de", "es", "pt", "it", "ru"}
    if len(parts) > 1 and parts[-1].lower() in lang_suffixes:
        parts = parts[:-1]
    head = parts[0] if parts else folder_name
    rest = [p for p in parts[1:] if not (len(p) == 8 and p.isdigit())]
    title = f"{head} ({' '.join(rest)})" if rest else head
    icon = f"X{head[:2]}" if head else "X動"

    brief = topic_brief(topic, 160)
    for prefix in ("テーマ:", "テーマ："):
        if brief.startswith(prefix):
            brief = brief[len(prefix):].strip()
            break
    description = " ".join(brief.split())[:100] or f"{folder_name} の自動生成ビデオ"
    return icon, title, description


def _html_escape(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _ensure_router_alias(router_path: str, url_segment: str, folder_name: str) -> str:
    """router/index.ts に createStaticAliasRoute を 1 件追加する。戻り値は状態文字列。"""
    alias_path = f"/{url_segment}/{folder_name}"
    target_path = f"{url_segment}/{folder_name}/index.html"

    with open(router_path, encoding="utf-8") as f:
        text = f.read()

    if f"'{alias_path}'" in text:
        return "既存"

    anchor = text.find("const router = createRouter(")
    if anchor < 0:
        return "失敗（createRouter が見つかりません）"
    close_idx = text.rfind("\n]", 0, anchor)
    if close_idx < 0:
        return "失敗（baseRoutes の終端が見つかりません）"

    block = (
        "    createStaticAliasRoute(\n"
        f"        '{alias_path}',\n"
        f"        '{target_path}',\n"
        f"        '{url_segment}'\n"
        "    ),\n"
    )
    updated = text[:close_idx + 1] + block + text[close_idx + 1:]
    with open(router_path, "w", encoding="utf-8", newline="\n") as f:
        f.write(updated)
    return "追加"


def _ensure_vue_menu_card(
    vue_path: str,
    url_segment: str,
    folder_name: str,
    icon: str,
    title: str,
    description: str,
) -> str:
    """Xビデオ.vue に URL const とメニューカードを 1 件追加する。戻り値は状態文字列。"""
    const_name = _vue_const_name(folder_name)
    page_path = f"{url_segment}/{folder_name}/index.html"
    # メニュー導線はクエリなしの素の URL にする。既存カードについても、
    # 以前の自動化が付けた ?auto=loop を再実行時に取り除けるようにする。
    page_url = page_path
    expected_const = f"const {const_name} = `${{baseUrl}}{page_url}`;"

    with open(vue_path, encoding="utf-8") as f:
        lines = f.read().split("\n")

    const_idx = next(
        (i for i, ln in enumerate(lines) if ln.startswith(f"const {const_name} = ")),
        None,
    )
    card_exists = any(f':href="{const_name}"' in ln for ln in lines)
    const_updated = False
    if const_idx is not None:
        if lines[const_idx] != expected_const:
            lines[const_idx] = expected_const
            const_updated = True
        if card_exists:
            if const_updated:
                with open(vue_path, "w", encoding="utf-8", newline="\n") as f:
                    f.write("\n".join(lines))
                return "更新"
            return "既存"

    # 1) <script setup> の URL 定義群の末尾へ const を追加する
    if const_idx is None:
        const_marker = "${baseUrl}"
        insert_idx = None
        for i, ln in enumerate(lines):
            if ln.startswith("const ") and const_marker in ln and ln.rstrip().endswith(";"):
                insert_idx = i
        if insert_idx is None:
            return "失敗（URL const の定義位置が見つかりません）"
        lines.insert(insert_idx + 1, expected_const)

    # 2) folder_name に合うセクションの menu-row 末尾へカードを追加する。
    #    見出しが無い場合は既定セクションへ入れ、登録漏れにはしない。
    section_label = _vue_section_label(folder_name)
    section_idx = None
    for label in dict.fromkeys((section_label, _VUE_SECTION_RULES[-1][1])):
        section_idx = next(
            (i for i, ln in enumerate(lines) if f'<div class="section-label">{label}</div>' in ln),
            None,
        )
        if section_idx is not None:
            section_label = label
            break
    if section_idx is None:
        return f"失敗（セクション見出しが見つかりません: {section_label}）"

    row_end_idx = None
    for i in range(section_idx + 1, len(lines)):
        if lines[i] == "        </div>":
            row_end_idx = i
            break
    if row_end_idx is None:
        return f"失敗（menu-row の終端が見つかりません: {section_label}）"

    card = [
        f'          <a class="menu-card menu-card-fixed" :href="{const_name}" target="_blank" rel="noopener noreferrer">',
        '            <div class="menu-card-title">',
        f'              <span class="icon">{_html_escape(icon)}</span>',
        f"              {_html_escape(title)}",
        "            </div>",
        '            <div class="menu-card-description">',
        f"              {_html_escape(description)}",
        "            </div>",
        "          </a>",
        "",
    ]
    lines[row_end_idx:row_end_idx] = card

    with open(vue_path, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines))
    return f"追加（{section_label}）"


async def step_add_routing(ctx: VideoGenCtx, ca: dict, attempt: int = 1) -> bool:
    """Step 02: Xビデオメニューへのカード追加とルーティング登録を行う。

    フォルダを作っただけではメニューからも URL からもページへ到達できないため、
    表示（ブラウザプレビュー）を始める前にここで導線を通しておく。
    追加自体は Python が機械的に行い、AI には文言の調整と最終確認だけを依頼する。
    """
    sep("Step 02: ルーティング追加")
    step_name = "Step 02: ルーティング追加"
    new_dir = ctx.output_dir
    folder_name = ctx.folder_name
    topic = ctx.topic
    md_path = os.path.join(new_dir, f"{folder_name}.md")

    vue_path, router_path, url_segment = _routing_target_paths(ctx)
    alias_path = f"/{url_segment}/{folder_name}"
    page_url = f"{url_segment}/{folder_name}/index.html"
    menu_page_url = page_url
    const_name = _vue_const_name(folder_name)

    step_summary = (
        f'  "{folder_name}" を {url_segment} メニューとルーティングへ登録します。\n'
        f'  "{os.path.basename(vue_path)}" にメニューカードを、'
        f'"{os.path.basename(router_path)}" に createStaticAliasRoute を追加します。'
    )

    tts_msg = (
        "Step two, routing registration is starting. I will add the video to the menu and the router."
        if ctx.use_english_voice else
        f"{step_name} を開始します。Xビデオメニューとルーティングへ登録します。"
    )
    guide_tts(ctx, tts_msg)

    ok_files = check(f"メニュー Vue 存在: {vue_path}", os.path.isfile(vue_path))
    ok_router = check(f"ルーター存在: {router_path}", os.path.isfile(router_path))
    if not (ok_files and ok_router):
        print("  [routing] 対象ファイルが見つからないため登録できません")
        return False

    icon, title, description = _menu_card_texts(folder_name, topic)
    router_state = _ensure_router_alias(router_path, url_segment, folder_name)
    print(f"  [routing] ルーティング: {router_state} -> {alias_path}")
    vue_state = _ensure_vue_menu_card(vue_path, url_segment, folder_name, icon, title, description)
    print(f"  [routing] メニューカード: {vue_state} -> {const_name}")

    ensure_step_markdown(md_path, folder_name, topic)

    prompt = (
        step_instruction_header(ctx, step_name, step_summary)
        + f'"{folder_name}" をメニューとルーティングへ登録する作業です。\n'
        "追加そのものはこのスクリプトが Python で実行済みです。AI 側は文言の調整と確認だけを行ってください。\n\n"
        "【対象ファイル】\n"
        f'  "{vue_path}"\n'
        f'  "{router_path}"\n\n'
        "【確認すること】\n"
        f"  1. {os.path.basename(router_path)} に次のルートがあること\n"
        f"       createStaticAliasRoute('{alias_path}', '{page_url}', '{url_segment}')\n"
        f"  2. {os.path.basename(vue_path)} に const {const_name} があり、\n"
        f"     その値が `${{baseUrl}}{menu_page_url}` になっていること\n"
        f"  3. 追加されたメニューカードが :href=\"{const_name}\" を参照していること\n\n"
        "【直してよいこと】メニューカードの文言だけです\n"
        "  - menu-card-title の見出し（今は下書きの機械生成です）\n"
        "  - menu-card-description の説明文（今回のテーマに合う 1 行の日本語にしてください）\n"
        "  - span.icon の短いラベル（2〜3 文字。周りのカードと重複しない表記にしてください）\n"
        f"  今回のテーマ: {topic_brief(topic, 200)}\n\n"
        "【やらないこと】\n"
        "  - 他のメニューカード・他のルート定義の変更や削除\n"
        f'  - "{new_dir}" 配下のファイルの変更（このステップでは触りません）\n'
        "  - npm / vite などのコマンド実行\n"
        "  - 新しいセクションやレイアウトの追加\n\n"
        "【報告】追加されたルートとメニューカードを引用し、文言をどう直したかだけ答えてください。\n"
    )
    await agent_run(ctx, ca, prompt, timeout_sec=240)

    mark_step_done(md_path, "ルーティング追加")

    def validate() -> bool:
        return _routing_registration_ok(vue_path, router_path, url_segment, folder_name)

    return await verify_and_backup_until_stable(
        ctx=ctx, ca=ca,
        step_name=step_name, step_summary=step_summary,
        target_paths=[vue_path, router_path, md_path],
        validate=validate, verify_timeout_sec=240, attempt=attempt,
    )


def _routing_registration_ok(vue_path: str, router_path: str, url_segment: str, folder_name: str) -> bool:
    """ルート・メニュー URL const・メニューカードが揃っているかを検証する（ファイルは変更しない）。"""
    alias_path = f"/{url_segment}/{folder_name}"
    page_url = f"{url_segment}/{folder_name}/index.html"
    const_name = _vue_const_name(folder_name)
    try:
        with open(router_path, encoding="utf-8") as f:
            router_text = f.read()
        with open(vue_path, encoding="utf-8") as f:
            vue_text = f.read()
    except OSError as e:
        print(f"  [routing] ファイル読み込みに失敗しました: {e}")
        return False

    ok1 = check(f"ルート登録: {alias_path}", f"'{alias_path}'" in router_text)
    ok2 = check(f"リダイレクト先: {page_url}", f"'{page_url}'" in router_text)
    ok3 = check(
        f"メニュー URL const: {const_name}",
        f"const {const_name} = `${{baseUrl}}{page_url}`;" in vue_text,
    )
    ok4 = check(f"メニューカード参照: {const_name}", f':href="{const_name}"' in vue_text)
    # カードを差し込んだあとにタグの数が合っているかだけ見る（簡易構文チェック）
    ok5 = check(
        "メニューカードのタグ整合",
        vue_text.count('<a class="menu-card') == vue_text.count("</a>"),
    )
    return ok1 and ok2 and ok3 and ok4 and ok5


def video_menu_registration_paths(ctx: VideoGenCtx) -> list[str]:
    """Xビデオメニュー登録で変更するファイル（メニュー Vue・router）のパスを返す。"""
    vue_path, router_path, _ = _routing_target_paths(ctx)
    return [vue_path, router_path]


def video_menu_registration_ok(ctx: VideoGenCtx) -> bool:
    """今回のビデオが Xビデオメニューとルーティングに登録済みかを検証する（ファイルは変更しない）。"""
    vue_path, router_path, url_segment = _routing_target_paths(ctx)
    return _routing_registration_ok(vue_path, router_path, url_segment, ctx.folder_name)


def ensure_video_menu_registration(ctx: VideoGenCtx) -> bool:
    """Xビデオメニューとルーティングへの登録を再確認し、抜けていれば登録し直す。

    Step 02 で登録しても、後から Xビデオ.vue / router/index.ts が古い版へ戻されると
    完成したビデオがメニューから外れる。最終確認と完成案内でもこの関数を呼び、
    メニューから開けない状態のまま完成扱いにしない。
    """
    vue_path, router_path, url_segment = _routing_target_paths(ctx)
    folder_name = ctx.folder_name
    ok_vue = check(f"メニュー Vue 存在: {vue_path}", os.path.isfile(vue_path))
    ok_router = check(f"ルーター存在: {router_path}", os.path.isfile(router_path))
    if not (ok_vue and ok_router):
        return False

    icon, title, description = _menu_card_texts(folder_name, ctx.topic)
    router_state = _ensure_router_alias(router_path, url_segment, folder_name)
    print(f"  [routing] ルーティング再確認: {router_state} -> /{url_segment}/{folder_name}")
    vue_state = _ensure_vue_menu_card(vue_path, url_segment, folder_name, icon, title, description)
    print(f"  [routing] メニューカード再確認: {vue_state} -> {_vue_const_name(folder_name)}")
    return _routing_registration_ok(vue_path, router_path, url_segment, folder_name)


def video_menu_review_prompt(ctx: VideoGenCtx) -> str:
    """最終確認プロンプトに差し込む「Xビデオメニュー登録の確認」指示を返す。"""
    vue_path, router_path, url_segment = _routing_target_paths(ctx)
    folder_name = ctx.folder_name
    alias_path = f"/{url_segment}/{folder_name}"
    page_url = f"{url_segment}/{folder_name}/index.html"
    const_name = _vue_const_name(folder_name)
    return (
        f"【手順 3】{url_segment}メニューへの登録確認（完成の必須条件）\n"
        f"  完成したビデオは {url_segment} メニューから開けなければなりません。次の 3 点を確認してください。\n"
        f'  対象: "{vue_path}"\n'
        f'        "{router_path}"\n'
        f"  確認 A: {os.path.basename(router_path)} に createStaticAliasRoute('{alias_path}', '{page_url}', '{url_segment}') があるか\n"
        f"  確認 B: {os.path.basename(vue_path)} に const {const_name} = `${{baseUrl}}{page_url}`; があるか\n"
        f"  確認 C: 「{_vue_section_label(folder_name)}」セクションに :href=\"{const_name}\" のメニューカードがあり、\n"
        "          見出し・説明・span.icon が今回のテーマに合っているか（機械生成の下書きのままなら直す）\n"
        "  抜けていれば追加してください。他のメニューカード・他のルート定義は変更・削除しないこと。\n\n"
    )


# ================================================================== #
# Step 07: 音声生成
# ================================================================== #

async def step_generate_audio(
    ctx: VideoGenCtx,
    ca: dict,
    gen_aud_py: str,
    audio_script_name: str,
    attempt: int = 1,
) -> bool:
    """Step 07: ナレーション / 掛け合い音声を生成する。"""
    sep("Step 07: 音声生成")
    step_name = "Step 07: 音声生成"
    new_dir = ctx.output_dir
    folder_name = ctx.folder_name
    topic = ctx.topic
    audio_dir = os.path.join(new_dir, "audio")
    scenario_path = os.path.join(new_dir, "scenario.js")
    md_path = os.path.join(new_dir, f"{folder_name}.md")

    step_summary = (
        f'  "{folder_name}" の scenario.js からナレーション音声を生成します。\n'
        f"  {audio_script_name} を作成・実行し、音声 MP3 を全件揃えます。"
    )

    tts_msg = (
        "Step seven, audio generation is starting. I will generate the narration audio."
        if ctx.use_english_voice else
        f"{step_name} を開始します。ナレーション音声を生成します。"
    )
    guide_tts(ctx, tts_msg)
    expected_count = count_scenario_dialogues(scenario_path)

    if os.path.isdir(audio_dir):
        existing = [
            f for f in os.listdir(audio_dir)
            if f.endswith(".mp3") and os.path.getsize(os.path.join(audio_dir, f)) > 500
        ]
        if len(existing) >= expected_count:
            print(f"  [既存] audio/*.mp3 が {len(existing)} 件存在します。内容検証を行い、問題があれば修正します")

    ensure_step_markdown(md_path, folder_name, topic)
    print(f"  [audio] 補助スクリプトを生成しました: {gen_aud_py}")
    print(f'  [audio] 実行コマンド: "{ctx.mcp_python}" "{gen_aud_py}"')
    run_python_script(ctx.mcp_python, gen_aud_py)
    mark_step_done(md_path, "音声生成")

    def validate() -> bool:
        if not os.path.isdir(audio_dir):
            check("audio フォルダ存在", False)
            return False
        mp3s = [
            f for f in os.listdir(audio_dir)
            if f.endswith(".mp3") and os.path.getsize(os.path.join(audio_dir, f)) > 500
        ]
        return check(
            f"audio/*.mp3 生成数: {len(mp3s)} 件（期待 {expected_count} 件）",
            len(mp3s) >= expected_count,
        )

    return await verify_and_backup_until_stable(
        ctx=ctx, ca=ca,
        step_name=step_name, step_summary=step_summary,
        target_paths=[scenario_path, gen_aud_py, audio_dir, md_path],
        validate=validate, verify_timeout_sec=300, attempt=attempt,
    )


# ================================================================== #
# Step 08: 音声照合
# ================================================================== #

async def step_review_audio(ctx: VideoGenCtx, ca: dict, gen_aud_py: str, attempt: int = 1) -> bool:
    """全音声を音声認識(重ねた窓)と原稿から照合し、誤読される語の読み指定を codex_cli にもらって再合成する。

    字幕（scenario.js の原稿）は変えない。TTS へ渡す文字だけを置き換える（_gen_audio.py の PRONUNCIATION_OVERRIDES）。
    直った分だけ再合成し、直した箇所を再確認する（最大 2 回）。
    """
    sep("Step 08: 音声照合")
    guide_tts(ctx, "Step eight, audio review is starting." if ctx.use_english_voice else "Step 08: 音声照合を開始します。")
    report = await review_audio_by_agent(ctx, ca, gen_aud_py)
    print(f"  [review] 照合 {len(report['files'])} 件、読み指定の追加 {len(report.get('readings_added', []))} 件、"
          f"再合成 {len(report['regenerated'])} 件、未確定 {len(report['unresolved'])} 件")
    for method in dict.fromkeys(report.get("methods", [])):
        print(f"  [review] 確認方法: {method}")
    md_path = os.path.join(ctx.output_dir, f"{ctx.folder_name}.md")
    mark_step_done(md_path, "音声照合")
    return await verify_and_backup_until_stable(
        ctx=ctx, ca=ca, step_name="Step 08: 音声照合",
        step_summary="全 MP3 を音声認識と原稿から照合し、誤読される語の読み指定（字幕は変えず TTS の入力だけ）を反映して再合成します。",
        target_paths=[gen_aud_py, os.path.join(ctx.output_dir, "audio"),
                      os.path.join(ctx.output_dir, "audio_review.json"), md_path],
        validate=lambda: check("音声照合レポートと全件照合", os.path.isfile(os.path.join(ctx.output_dir, "audio_review.json"))
                               and set(report["files"]) == set(audio_tasks(os.path.join(ctx.output_dir, "scenario.js")))),
        verify_timeout_sec=300, attempt=attempt, skip_agent_verify=True,
    )


# ================================================================== #
# Step 09: 再生時間更新
# ================================================================== #

async def step_update_durations(ctx: VideoGenCtx, ca: dict, attempt: int = 1) -> bool:
    """Step 09: 音声ナレーションの実時間で scenario.js の duration_sec を更新する。"""
    sep("Step 09: 再生時間更新")
    step_name = "Step 09: 再生時間更新"
    new_dir = ctx.output_dir
    folder_name = ctx.folder_name
    topic = ctx.topic
    scenario_path = os.path.join(new_dir, "scenario.js")
    assets_path = os.path.join(new_dir, "assets.json")
    audio_dir = os.path.join(new_dir, "audio")
    md_path = os.path.join(new_dir, f"{folder_name}.md")

    step_summary = (
        f'  "{folder_name}" の音声ファイル実時間で scenario.js の再生時間欄を更新します。\n'
        "  duration_sec / start_sec と assets.json の素材情報を揃えます。"
    )

    tts_msg = (
        "Step nine, duration update is starting. I will update the playback durations from the generated audio."
        if ctx.use_english_voice else
        f"{step_name} を開始します。音声ナレーションの再生時間を反映します。"
    )
    guide_tts(ctx, tts_msg)

    ensure_step_markdown(md_path, folder_name, topic)
    if not os.path.isfile(scenario_path):
        raise RuntimeError(f"scenario.js が見つかりません: {scenario_path}")
    if not os.path.isdir(audio_dir):
        raise RuntimeError(f"audio フォルダが見つかりません: {audio_dir}")

    result = await update_scenario_audio_durations(ctx, scenario_path, new_dir)

    if "dialogue_count" in result and result.get("total_duration_sec", 0) > 0:
        print(
            "  [duration] "
            f"dialogue={result['dialogue_count']}件 "
            f"scene={result['scene_count']}件 "
            f"total_duration_sec={result['total_duration_sec']}"
        )
    else:
        print(
            "  [duration] "
            f"audio={result['audio_count']}件 "
            f"scene={result['scene_count']}件 "
            f"short={result['total_short_duration_sec']}s "
            f"long={result['total_long_duration_sec']}s"
        )
    mark_step_done(md_path, "再生時間更新")

    def validate() -> bool:
        stats = collect_scenario_duration_stats(scenario_path)
        ok1 = check(
            f"duration_sec 更新数: {stats['audio_ok']}/{stats['audio_count']}",
            stats["audio_count"] > 0 and stats["audio_ok"] == stats["audio_count"],
        )
        ok2 = check(
            f"scene duration 整合数: {stats['scene_ok']}/{stats['scene_count']}",
            stats["scene_count"] > 0 and stats["scene_ok"] == stats["scene_count"],
        )
        ok3 = check(
            "total duration 設定済み",
            stats["total_short_duration_sec"] > 0 and stats["total_long_duration_sec"] > 0,
        )
        ok4 = False
        if os.path.isfile(assets_path):
            try:
                with open(assets_path, encoding="utf-8-sig") as f:
                    assets = json.load(f)
                scene_count = stats["scene_count"]
                ok4 = check(
                    "assets.json 対象作品・素材件数整合",
                    assets.get("project_name") == folder_name
                    and len(assets.get("images", [])) == scene_count
                    and len(assets.get("audio", [])) == scene_count,
                )
            except (OSError, ValueError, TypeError) as e:
                print(f"  [assets] 読み込み失敗: {e}")
                check("assets.json 対象作品・素材件数整合", False)
        else:
            check("assets.json 存在", False)
        return ok1 and ok2 and ok3 and ok4

    return await verify_and_backup_until_stable(
        ctx=ctx, ca=ca,
        step_name=step_name, step_summary=step_summary,
        target_paths=[scenario_path, assets_path, audio_dir, md_path],
        validate=validate, verify_timeout_sec=300, attempt=attempt,
    )


# ================================================================== #
# Step 99: 完成案内
# ================================================================== #

async def step_completion_notice(
    ctx: VideoGenCtx,
    ca: dict,
    attempt: int = 1,
    final_review_fn=None,
) -> bool:
    """Step 99: 未記録の最終確認を必要時に補完して完成案内を行う。"""
    sep("Step 99: 完成案内")

    completed_step = get_completed_step(ctx)
    if step_value_to_int(completed_step) < 10:
        if final_review_fn is None:
            print(f"  [NG] Step 10 が未完了です（現在: {completed_step or '未実行'}）")
            print("  Step 10: 最終確認 を先に実行してください。")
            return False

        print(f"  [recover] Step 10 が未記録です（現在: {completed_step or '未実行'}）")
        print("  成果物を最終確認し、成功した場合だけ完成案内を続行します。")
        if not await final_review_fn(ctx, ca, attempt=attempt):
            print("  [NG] Step 10 の回復実行に失敗しました。")
            return False
        set_completed_step(ctx, 10)

    # Step 10 完了済みで再開した場合も、メニューから外れたまま完成案内しない。
    if not ensure_video_menu_registration(ctx):
        print("  [NG] Xビデオメニューとルーティングへの登録を確認できませんでした。")
        return False

    print(f"  [complete] Step 99: 完成案内: {ctx.folder_name}")
    tts_msg = (
        "Video generation is complete. Please review the output artifacts."
        if ctx.use_english_voice else
        "ビデオ生成が完了しました。成果物の確認をお願いします。"
    )
    guide_tts(ctx, tts_msg)
    return True


# ================================================================== #
# メインループ
# ================================================================== #

async def run_automation_loop(
    ctx: VideoGenCtx,
    ca: dict,
    steps: list,
    ensure_fn,
) -> None:
    """
    steps リストに従ってステップを順次実行する共通ループ。

    Parameters
    ----------
    ctx : VideoGenCtx
    ca : dict
        CodeAgents 情報 {"api_url": ..., "version_info": ...}
    steps : list of (step_no, step_name, async_fn)
        async_fn は (ca, attempt=1) -> bool のシグネチャ
    ensure_fn : callable
        index.html にプレビューパッチを当てる関数
    """
    start_step = ctx.start_step
    stop_step  = ctx.stop_step
    is_fix_mode = ctx.fix_mode

    if is_fix_mode:
        print(f"  [修正モード] コピー元とコピー先が同じフォルダのため Step 01 を自動スキップします: {ctx.template_dir}")

    for step_no, step_name, fn in steps:
        if step_no < start_step:
            print(f"\n[Step {step_no:02d}: {step_name}] SKIP（実行ステップ {step_no_to_value(start_step)} より前）")
            continue
        if step_no == 1 and is_fix_mode:
            print("\n[Step 01: フォルダ作成] AUTO-SKIP（修正モード: コピー元 = コピー先）")
            set_completed_step(ctx, 1)
            continue
        if step_no > stop_step:
            print(f"\n[Step {step_no:02d}: {step_name}] STOP（実行ステップ {step_no_to_value(stop_step)} より後）")
            break

        success = False
        for attempt in range(1, ctx.max_retries + 1):
            print(f"\n[Step {step_no:02d}: {step_name}] 試行 {attempt}/{ctx.max_retries}")
            _logger.info("Step %02d [%s] 試行 %d/%d 開始", step_no, step_name, attempt, ctx.max_retries)
            try:
                success = await fn(ca, attempt=attempt)
            except Exception as e:
                print(f"  ERROR: {e}")
                _logger.error("Step %02d [%s] 例外: %s", step_no, step_name, e, exc_info=True)
                err_msg = (
                    f"Step {step_no:02d} raised an error. Retrying."
                    if ctx.use_english_voice else
                    f"{step_name} でエラーが発生しました。再試行します。"
                )
                guide_tts(ctx, err_msg, voice="male")
                success = False

            if success:
                print(f"  → [Step {step_no:02d}: {step_name}] 完了")
                _logger.info("Step %02d [%s] 完了", step_no, step_name)
                set_completed_step(ctx, step_no)
                # 表示は Step 02: ルーティング追加 が成功してから始める。
                # Step 01 の直後はメニューもルートも未登録で、ページを開いても正しく表示できないため。
                #
                # 進み具合に合わせて再生モードを上げ、途中経過が見えるようにする。
                #   Step 02-03（ルーティング追加・シナリオ作成）: 表示のみ・無音
                #     この時点は index.html がテンプレート元のままで画像も音声も無い。
                #     再生させても中身の無い画面が流れるだけなので、表示の確認にとどめる。
                #   Step 04-09（HTML修正〜再生時間更新）: ループ再生・無音
                #     今回のテーマが画面に載るので流して確認する。1 周で止めると
                #     見に行ったときには終わっていることが多いのでループさせる。
                #     Step 07〜09 も、最終確認が済むまでは案内音声と動画音声を
                #     重ねないため無音を維持する。
                #   Step 10（最終確認）: 最終確認後に音声つきループ再生
                #   Step 99（完成案内）: 終了通知のみ（再生状態は変更しない）
                if 2 <= step_no <= 3:
                    await refresh_browser_preview(
                        ctx,
                        f"Step {step_no:02d}: {step_name}",
                        ensure_fn=ensure_fn,
                        speaker_enabled=False,
                        auto_mode=PREVIEW_AUTO_NONE,
                    )
                elif 4 <= step_no <= 9:
                    await refresh_browser_preview(
                        ctx,
                        f"Step {step_no:02d}: {step_name}",
                        ensure_fn=ensure_fn,
                        speaker_enabled=False,
                        auto_mode=PREVIEW_AUTO_LOOP,
                    )
                elif step_no == 10:
                    await start_final_playback(ctx, f"Step {step_no:02d}: {step_name}")
                break
            else:
                if attempt < ctx.max_retries:
                    print(f"  → 検証NG。{ctx.retry_wait_sec}秒後にリトライします...")
                    _logger.warning("Step %02d [%s] 検証NG: %d秒後リトライ", step_no, step_name, ctx.retry_wait_sec)
                    time.sleep(ctx.retry_wait_sec)
                else:
                    print(f"\nERROR: [Step {step_no:02d}: {step_name}] が {ctx.max_retries} 回失敗しました。処理を中断します。")
                    _logger.error("Step %02d [%s] %d回失敗で中断", step_no, step_name, ctx.max_retries)
                    fail_msg = (
                        f"Step {step_no:02d} failed {ctx.max_retries} times. Stopping."
                        if ctx.use_english_voice else
                        f"{step_name} が {ctx.max_retries} 回失敗しました。処理を中断します。"
                    )
                    guide_tts(ctx, fail_msg, voice="male")
                    sys.exit(1)

    if stop_step < 99:
        done_val = step_no_to_value(stop_step)
        print(f"\n実行ステップ {done_val} の検証を完了しました。")
        done_msg = (
            f"Verification for requested step {done_val} is complete."
            if ctx.use_english_voice else
            f"実行ステップ {done_val} の検証を完了しました。"
        )
        guide_tts(ctx, done_msg)
        return

    completed_step = get_completed_step(ctx)
    if completed_step == "99":
        new_dir = ctx.output_dir
        print(f"\n{'=' * 60}")
        print("  ビデオ生成完了!")
        print(f"  フォルダ  : {new_dir}")
        print(f"  ステップ  : complete_steps={completed_step}")
        print(f"  管理JSON  : {ctx.steps_json_path}")
        print(f"{'=' * 60}")
    else:
        print(f"\nERROR: 完了ステップが 99 ではありません（現在: {completed_step or '未実行'}）")
        guide_tts(ctx, "完了ステップが記録されませんでした。処理を確認してください。", voice="male")
        sys.exit(1)
