# -*- coding: utf-8 -*-
"""
シーン画像生成スクリプト

scenario.js の各 scene から images/scene_*.png を生成します。
既存の画像ファイル（1000 bytes 超）は自動スキップします。
"""

import json
import os
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.join(_THIS_DIR, 'images')
TEMPLATE_IMAGE_DIR = 'C:\\Users\\admin\\Desktop\\AiDiy2027_dev\\frontend_web\\public\\Xビデオ\\小説解説_本好きの下剋上_ja\\images'
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
    def _clean(v):
        return " ".join(str(v or "").replace("\\n", " ").replace("\n", " ").split()).strip()
    title = _clean(scene.get('title', ''))
    headline = _clean(scene.get('headline', ''))
    kicker = _clean(scene.get('kicker', ''))
    lead = _clean(scene.get('lead', ''))
    subtitle = _clean(scene.get('subtitle', ''))
    prompt = _clean(scene.get('image_prompt', ''))
    if prompt:
        return prompt
    lines = ['Create a high-quality widescreen illustration for a warm Japanese entertainment story (small anecdote) video.']
    if kicker: lines.append(f'Topic: {kicker}.')
    if title: lines.append(f'Title: {title}.')
    if headline: lines.append(f'Headline: {headline}.')
    if lead: lines.append(f'Details: {lead}.')
    if subtitle: lines.append(f'Concept: {subtitle}.')
    lines.append('Style: warm cinematic comedy, friendly Japanese everyday-life mood, expressive but respectful characters, beautiful lighting, no readable text baked into the image.')
    return '\n'.join(lines).strip()



def get_template_image(num_str):
    """テンプレート元画像のパスを返す。存在しない場合は None。"""
    if not TEMPLATE_IMAGE_DIR:
        return None
    path = os.path.join(TEMPLATE_IMAGE_DIR, f"scene_{num_str}.png")
    if os.path.isfile(path) and os.path.getsize(path) > 1000:
        return path
    return None


def post_json(url, payload, timeout_sec=300):
    data = json.dumps(payload, ensure_ascii=False).encode('utf-8')
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
    if isinstance(result, dict) and result.get('error'):
        raise RuntimeError(result['error'])
    return result


def generate_one(prompt, out_path, original_path=None):
    payload = {
        "prompt": prompt,
        "provider": "auto",
        "model": "auto",
        "size": "auto",
        "quality": "auto",
        "save_path": out_path,
    }
    if original_path:
        payload["original_path"] = original_path
    result = post_json(IMAGE_GEN_API_URL, payload)
    return {
        "provider": result.get("provider", "auto"),
        "model": result.get("model", "auto"),
        "save_path": result.get("save_path", out_path),
    }


def generate_scene(task):
    scene_id, scene, out_path, num_str = task
    prompt = build_prompt(scene)
    original_path = get_template_image(num_str)
    info = generate_one(prompt, out_path, original_path=original_path)
    size = os.path.getsize(out_path) if os.path.exists(out_path) else 0
    return scene_id, out_path, original_path, info, size


def main():
    scenes = load_scenes()
    total = len(scenes)
    done = 0
    skip = 0
    fail = 0

    tasks = []
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

        original_path = get_template_image(num_str)
        title = _clean_text(scene.get("title", scene_id))
        ref_label = f" (ref: {os.path.basename(original_path)})" if original_path else ""
        print(f"  [WAIT] {os.path.basename(out_path)} : {title}{ref_label}")
        tasks.append((scene_id, scene, out_path, num_str))

    worker_count = min(3, len(tasks))
    if worker_count:
        print(f"\n画像生成を開始します（最大 {worker_count} 件並行）")
        with ThreadPoolExecutor(max_workers=worker_count) as executor:
            futures = {executor.submit(generate_scene, task): task for task in tasks}
            for future in as_completed(futures):
                task = futures[future]
                scene_id, _scene, out_path, _num_str = task
                try:
                    _scene_id, out_path, _original_path, info, size = future.result()
                except Exception as e:
                    print(f"  [ERR ] {os.path.basename(out_path)} -> {e}")
                    fail += 1
                    continue
            if size > 1000:
                print(
                    f"  [ OK ] {os.path.basename(out_path)} ({size:,} bytes) "
                    f"[{info.get('provider', '?')}/{info.get('model', '?')}]"
                )
                done += 1
            else:
                print(f"  [FAIL] {os.path.basename(out_path)} (empty or too small)")
                fail += 1
    print(f"\n完了: {done} 生成, {skip} スキップ, {fail} 失敗 (合計 {total} 件)")
    if fail:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
