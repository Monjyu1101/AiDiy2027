#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""avatar / hermes 紹介ビデオ用画像一括生成スクリプト"""

import base64
import json
import os
import sys
import time
from pathlib import Path

try:
    from openai import OpenAI
except ImportError:
    print("openai パッケージが必要です: pip install openai")
    sys.exit(1)

# APIキー取得
KEY_PATH = Path(__file__).resolve().parents[3] / "_config" / "AiDiy_key.json"
with open(KEY_PATH) as f:
    keys = json.load(f)
api_key = keys.get("openai_key_id", "")
if not api_key or api_key.startswith("<"):
    print("openai_key_id が設定されていません")
    sys.exit(1)

client = OpenAI(api_key=api_key)

BASE = Path(__file__).resolve().parent

TASKS = [
    # ── AVATAR ───────────────────────────────────────────────────────────
    {
        "out": "AiDiy紹介avatar/images/scene_000.png",
        "size": "1024x1024",
        "prompt": (
            "Square 1:1 hero poster for AiDiy Avatar edition. "
            "Central visual: the word AiDiy in ultra-premium futuristic typography with strong cyan electric-blue glow, "
            "a subtle VRM anime avatar silhouette blended behind the text suggesting a digital presenter, "
            "dark deep-space background, clean grid overlay, polished enterprise AI branding. "
            "Text reads only 'AiDiy'. No clutter, no fake logos, no paragraphs. "
            "Mood: premium tech keynote opening card."
        ),
    },
    {
        "out": "AiDiy紹介avatar/images/scene_001.png",
        "size": "1024x1536",
        "prompt": (
            "Vertical 2:3 key visual for AiDiy — a Japanese-first fullstack business management platform. "
            "Architectural diagram showing four modular blocks: backend_server, backend_tools, frontend_web, frontend_avatar "
            "connected by clean data-flow arrows, dark blueprint background, cyan and magenta accent lighting. "
            "Enterprise software poster style, no logos, realistic diagram aesthetic, high clarity."
        ),
    },
    {
        "out": "AiDiy紹介avatar/images/scene_002.png",
        "size": "1024x1536",
        "prompt": (
            "Vertical 2:3 infographic poster: Japanese-first software architecture. "
            "Four horizontal layers — Database, API, Frontend, Code — each labeled in Japanese, "
            "connected by thick arrows showing DB 利用者ID → API /core/利用者/一覧 → Vue component 利用者一覧.vue → variable 利用者名. "
            "Dark background, green accent, enterprise blueprint mood, clean boxes and labels, no garbled text."
        ),
    },
    {
        "out": "AiDiy紹介avatar/images/scene_003.png",
        "size": "1024x1536",
        "prompt": (
            "Vertical 2:3 architecture poster for AiDiy multi-server and multi-CLI system. "
            "Three resident server blocks: core 8091, apps 8098, mcp 8095, all feeding one AI core panel. "
            "From the AI core panel, branch out seven code lanes labeled: Claude CLI, Copilot CLI, Codex CLI, "
            "Antigravity CLI, OpenCode CLI, claude_sdk, aidiy_hermes. "
            "Highlight aidiy_hermes as a distinct Python subprocess engine. "
            "Dark enterprise blueprint, magenta accent, clean system diagram, no mascots."
        ),
    },
    {
        "out": "AiDiy紹介avatar/images/scene_004.png",
        "size": "1024x1536",
        "prompt": (
            "Vertical 2:3 collage of Japanese ERP business modules: 配車管理 dispatch, 生産管理 production, 資材在庫管理 inventory. "
            "Clean enterprise dashboard panels with taxonomy badge labels C M T V S A X. "
            "Warm amber accent, realistic ERP style, precise and practical, no cartoon look, dark background."
        ),
    },
    {
        "out": "AiDiy紹介avatar/images/scene_005.png",
        "size": "1024x1536",
        "prompt": (
            "Vertical 2:3 interface illustration for AI core with multiple panels: chat panel, voice waveform, image viewer, code editor. "
            "On the right side, a realistic VRM-style anime avatar standing as a digital presenter. "
            "Shows dual mode: web browser and Electron desktop window side by side. "
            "Blue-violet accent, professional Japanese software interface aesthetic, polished UI design."
        ),
    },
    {
        "out": "AiDiy紹介avatar/images/scene_999.png",
        "size": "1024x1024",
        "prompt": (
            "Square 1:1 elegant closing card for AiDiy Avatar presentation. "
            "Beautiful premium typography center: 'Thank you for Watching' in refined luxury tech style. "
            "Dark deep-blue gradient background, subtle violet-cyan glow, clean centered layout, "
            "a faint VRM avatar silhouette in soft light on one side. "
            "No clutter, no extra UI elements, polished and memorable closing visual."
        ),
    },

    # ── HERMES ───────────────────────────────────────────────────────────
    {
        "out": "AiDiy紹介hermes/images/hero.png",
        "size": "1024x1024",
        "prompt": (
            "Square 1:1 hero poster for aidiy_hermes — AiDiy's on-demand code agent CLI. "
            "Central typography: 'aidiy_hermes' in elegant premium futuristic font with strong purple-violet glow. "
            "Background suggests a TUI terminal with faint command-line text, dark theme, subtle grid lines. "
            "Mood: sophisticated CLI tool branding, enterprise developer tool aesthetic. "
            "No fake logos, no dense paragraphs, clean and bold."
        ),
    },
    {
        "out": "AiDiy紹介hermes/images/scene_001.png",
        "size": "1024x1536",
        "prompt": (
            "Vertical 2:3 technical diagram for on-demand code agent CLI concept. "
            "Left side: AiDiy backend_server box with AI code panel. "
            "Right side: subprocess call arrow pointing to aidiy_hermes CLI process that appears only on demand. "
            "Below: contrast with 'always running' HTTP server (crossed out) vs 'on-demand subprocess' (highlighted). "
            "Dark blueprint style, cyan accent, clean enterprise architecture diagram."
        ),
    },
    {
        "out": "AiDiy紹介hermes/images/scene_002.png",
        "size": "1024x1536",
        "prompt": (
            "Vertical 2:3 tech stack architecture poster for Python TUI code agent. "
            "Show layered components: Python 3.13 at base, then prompt_toolkit TUI layer, then provider abstraction layer, "
            "then CLI interface at top. Clean block diagram, terminal-style font labels. "
            "Dark background, purple-cyan gradient, professional developer tool aesthetic."
        ),
    },
    {
        "out": "AiDiy紹介hermes/images/scene_003.png",
        "size": "1024x1536",
        "prompt": (
            "Vertical 2:3 infographic showing 31 provider overlays for AI CLI tool. "
            "Center hub labeled 'aidiy_hermes', surrounded by provider nodes arranged in a circular network: "
            "openai, anthropic, gemini, azure, ollama, groq, mistral, and more. "
            "Each node connected by lines, some nodes grouped by category. "
            "Dark background, magenta-cyan accent, clean network diagram style, enterprise tech aesthetic."
        ),
    },
    {
        "out": "AiDiy紹介hermes/images/scene_004.png",
        "size": "1024x1536",
        "prompt": (
            "Vertical 2:3 TUI command reference poster for a developer tool. "
            "Dark terminal background showing a clean categorized command list: "
            "5 categories (Model, Session, Kanban, Config, Help) each with example slash commands like /model, /kanban, /export. "
            "Monospace font, syntax highlighting with cyan keywords, purple category headers. "
            "Professional terminal aesthetic, like a well-designed help screen."
        ),
    },
    {
        "out": "AiDiy紹介hermes/images/scene_005.png",
        "size": "1024x1536",
        "prompt": (
            "Vertical 2:3 system integration diagram showing aidiy_hermes connected to AiDiy backend. "
            "Top: frontend_web AI code panel → backend_server AIコード_cli.py → subprocess → aidiy_hermes process. "
            "Bottom: conf_model.py dynamically generating model list from aidiy_hermes overlay config. "
            "Flow arrows, data labels, dark blueprint background, orange-cyan accent, clean enterprise diagram."
        ),
    },
]


def generate_image(task: dict) -> bool:
    out_path = BASE / task["out"]
    out_path.parent.mkdir(parents=True, exist_ok=True)

    print(f"  生成中: {task['out']} ({task['size']}) ...", flush=True)
    try:
        response = client.images.generate(
            model="gpt-image-2.5-sunburst",
            prompt=task["prompt"],
            size=task["size"],
            quality="medium",
            n=1,
        )
        first = response.data[0]
        b64 = getattr(first, "b64_json", None)
        if b64:
            img_data = base64.b64decode(b64)
        else:
            import urllib.request
            img_data = urllib.request.urlopen(first.url).read()
        out_path.write_bytes(img_data)
        print(f"  ✓ 保存: {out_path.name} ({len(img_data)//1024}KB)")
        return True
    except Exception as e:
        print(f"  ✗ エラー: {e}")
        return False


def main():
    print(f"画像生成開始: 合計 {len(TASKS)} 枚\n")
    ok = 0
    for i, task in enumerate(TASKS, 1):
        print(f"[{i}/{len(TASKS)}]", end=" ")
        if generate_image(task):
            ok += 1
        if i < len(TASKS):
            time.sleep(2)  # API rate limit 対策

    print(f"\n完了: {ok}/{len(TASKS)} 枚生成")


if __name__ == "__main__":
    main()
