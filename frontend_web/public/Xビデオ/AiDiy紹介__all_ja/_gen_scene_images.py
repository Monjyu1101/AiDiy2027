# -*- coding: utf-8 -*-
"""
シーン画像生成スクリプト

scenario.js の各 scene から images/scene_*.png を生成します。
既存の画像ファイル（1000 bytes 超）は自動スキップします。
"""

import json
import os
import time
import urllib.error
import urllib.request

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'images')
IMAGE_GEN_API_URL = 'http://127.0.0.1:8095/aidiy_image_generation/generate'
os.makedirs(OUTPUT_DIR, exist_ok=True)


def _clean_text(value):
    return " ".join(str(value or "").replace("\\n", " ").replace("\n", " ").split()).strip()


def load_scenes():
    scenario_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "scenario.js")
    with open(scenario_file, encoding="utf-8-sig") as f:
        content = f.read()

    json_str = content.strip()
    if json_str.startswith("window.SCENARIO ="):
        json_str = json_str[len("window.SCENARIO ="):].strip()
    json_str = json_str.rstrip(";").strip()

    data = json.loads(json_str)
    scenes = data.get("scenes", [])
    return scenes if isinstance(scenes, list) else []


def build_prompt(scene):
    title = _clean_text(scene.get("title", ""))
    headline = _clean_text(scene.get("headline", ""))
    kicker = _clean_text(scene.get("kicker", ""))
    lead = _clean_text(scene.get("lead", ""))
    subtitle = _clean_text(scene.get("subtitle", ""))

    lines = [
        "Create a high-quality, professional widescreen illustration/concept-art for a technology introduction presentation.",
    ]
    if kicker:
        lines.append(f"Topic: {kicker}.")
    if title:
        lines.append(f"Title: {title}.")
    if headline:
        lines.append(f"Headline: {headline}.")
    if lead:
        lines.append(f"Details: {lead}.")
    if subtitle:
        lines.append(f"Concept: {subtitle}.")
    lines.append("Style: modern technical slide illustration, clean design, gradient background, futuristic, beautiful, no text overlay baked into the image.")
    return "\n".join(lines).strip()


def post_json(url, payload, timeout_sec=600):
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout_sec) as res:
            raw = res.read().decode("utf-8", errors="replace")
    except urllib.error.URLError as e:
        raise RuntimeError(f"HTTP API に接続できません: {url} ({e})") from e
    result = json.loads(raw)
    if isinstance(result, dict) and result.get("error"):
        raise RuntimeError(result["error"])
    return result


def generate_one(prompt, out_path):
    attempts = [
        ("openai", "gpt-image-2.6-sunburst", "1536x1024", "medium"),
        ("freeai", "auto", "1920x1080", "auto"),
        ("auto", "auto", "1024x1024", "auto"),
    ]
    last_error = None
    for provider, model, size, quality in attempts:
        try:
            result = post_json(IMAGE_GEN_API_URL, {
                "prompt": prompt,
                "provider": provider,
                "model": model,
                "size": size,
                "quality": quality,
                "save_path": out_path,
            })
            return {
                "provider": provider,
                "model": model,
                "save_path": result.get("save_path", out_path),
            }
        except Exception as e:
            last_error = f"{provider}/{model}/{size}: {e}"
    raise RuntimeError(last_error or "image generation failed")


def main():
    scenes = load_scenes()
    total = len(scenes)
    done = 0
    skip = 0
    fail = 0

    for i, scene in enumerate(scenes):
        if not isinstance(scene, dict):
            continue
        scene_id = str(scene.get("id", f"scene_{i:03d}") or f"scene_{i:03d}")
        num_str = scene_id.replace("scene_", "")
        out_path = os.path.join(OUTPUT_DIR, f"scene_{num_str}.png")

        if os.path.exists(out_path) and os.path.getsize(out_path) > 1000:
            print(f"  [SKIP] {os.path.basename(out_path)}")
            skip += 1
            continue

        prompt = build_prompt(scene)
        title = _clean_text(scene.get("title", scene_id))
        print(f"  [GEN ] {os.path.basename(out_path)} : {title}")
        try:
            info = generate_one(prompt, out_path)
            size = os.path.getsize(out_path) if os.path.exists(out_path) else 0
            if size > 1000:
                print(
                    f"         -> OK ({size:,} bytes) "
                    f"[{info.get('provider', '?')}/{info.get('model', '?')}]"
                )
                done += 1
            else:
                print("         -> FAIL (empty or too small)")
                fail += 1
        except Exception as e:
            print(f"         -> ERROR: {e}")
            fail += 1

        time.sleep(1)

    print(f"\n完了: {done} 生成, {skip} スキップ, {fail} 失敗 (合計 {total} 件)")
    if fail:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
