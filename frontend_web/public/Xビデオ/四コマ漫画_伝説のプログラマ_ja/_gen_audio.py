# -*- coding: utf-8 -*-
"""
ナレーション音声生成スクリプト（四コマ漫画_伝説のプログラマ_ja / edge female / mcp 形式）

既存の音声ファイル（500 bytes 超）は自動スキップします。
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.join(_THIS_DIR, 'audio')
TTS_API_URL = 'http://127.0.0.1:8095/aidiy_text_to_speech/synthesize'
TTS_LANGUAGE = 'ja'
os.makedirs(OUTPUT_DIR, exist_ok=True)


def load_tasks():
    scenario_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "scenario.js")
    with open(scenario_file, encoding="utf-8-sig") as f:
        content = f.read()
    json_str = content.strip()
    if json_str.startswith("window.SCENARIO ="):
        json_str = json_str[len("window.SCENARIO ="):].strip()
    json_str = json_str.rstrip(";").strip()
    data = json.loads(json_str)
    narrations = []
    for scene in data.get("scenes", []):
        scene_num = str(scene.get("id", "")).replace("scene_", "")
        short_text = str(scene.get("short_narration", "") or "").strip()
        long_text  = str(scene.get("long_narration",  "") or "").strip()
        if short_text: narrations.append((scene_num, "short", short_text))
        if long_text:  narrations.append((scene_num, "long",  long_text))
    return narrations

NARRATIONS = load_tasks()



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


def synthesize_one(text, out_path):
    return post_json(TTS_API_URL, {
        "speech_text": text,
        "language": TTS_LANGUAGE,
        "provider": "edge",
        "voice": "female",
        "save_path": out_path,
    })


def parse_args():
    parser = argparse.ArgumentParser(description="scenario.js からナレーション音声を生成します。")
    parser.add_argument(
        "--force-scene",
        action="append",
        default=[],
        metavar="SCENE_ID",
        help="既存音声も再生成するシーンID。複数回指定できます（例: scene_001）。",
    )
    return parser.parse_args()



def main():
    args = parse_args()
    force_scenes = {scene_id.removeprefix("scene_") for scene_id in args.force_scene}
    total = len(NARRATIONS)
    done = 0
    skip = 0
    fail = 0
    for scene_num, kind, text in NARRATIONS:
        fname = f"{kind}_scene_{scene_num}.mp3"
        fpath = os.path.join(OUTPUT_DIR, fname)
        if (
            scene_num not in force_scenes
            and os.path.exists(fpath)
            and os.path.getsize(fpath) > 500
        ):
            print(f"  [SKIP] {fname}")
            skip += 1
            continue
        print(f"  [GEN ] {fname}")
        try:
            synthesize_one(text, fpath)
            size = os.path.getsize(fpath) if os.path.exists(fpath) else 0
            if size > 500:
                print(f"         -> OK ({size:,} bytes)")
                done += 1
            else:
                print("         -> FAIL (empty or too small)")
                fail += 1
        except Exception as e:
            print(f"         -> ERROR: {e}")
            fail += 1
    print(f"\n完了: {done} 生成, {skip} スキップ, {fail} 失敗 (合計 {total} 件)")
    if fail:
        raise SystemExit(1)



if __name__ == "__main__":
    main()
