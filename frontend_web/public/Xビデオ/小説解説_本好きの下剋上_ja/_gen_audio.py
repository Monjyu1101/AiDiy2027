# -*- coding: utf-8 -*-
"""
ナレーション音声生成スクリプト（小説解説「本好きの下剋上」改 / edge female / MCP 形式）

既存の音声ファイル（500 bytes 超）は自動スキップします。
"""

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
PRONUNCIATION_OVERRIDES = {}
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
    global PAUSE_SCENES
    PAUSE_SCENES = {str(scene.get("id", "")).replace("scene_", "")
                    for scene in data.get("scenes", [])
                    if "pause_after_speech_text" in scene}
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


def apply_pronunciation(text, out_path):
    changes = PRONUNCIATION_OVERRIDES.get(os.path.basename(out_path), {})
    if isinstance(changes, str):
        return changes
    for old, reading in changes.items():
        text = text.replace(old, reading)
    return text


def synthesize_one(text, out_path):
    text = apply_pronunciation(text, out_path)
    return post_json(TTS_API_URL, {
        "speech_text": text,
        "language": TTS_LANGUAGE,
        "provider": "edge",
        "voice": "female",
        "save_path": out_path,
    })



def main():
    selected_files = set(sys.argv[2:]) if len(sys.argv) > 1 and sys.argv[1] == '--only-file' else set()
    force_long = "--force-long" in sys.argv[1:]
    total = len(NARRATIONS)
    done = 0
    skip = 0
    fail = 0
    for scene_num, kind, text in NARRATIONS:
        fname = f"{kind}_scene_{scene_num}.mp3"
        if selected_files and fname not in selected_files: continue
        fpath = os.path.join(OUTPUT_DIR, fname)
        if os.path.exists(fpath) and os.path.getsize(fpath) > 500 and not (force_long and kind == "long") and fname not in selected_files:
            print(f"  [SKIP] {fname}")
            skip += 1
            continue
        print(f"  [GEN ] {fname}")
        try:
            synthesize_one(text, fpath)
            if scene_num in PAUSE_SCENES:
                scripts_dir = os.path.abspath(os.path.join(_THIS_DIR, "..", "..", "..", "..", "scripts"))
                if scripts_dir not in sys.path:
                    sys.path.insert(0, scripts_dir)
                from booklove_pause_pass import append_silence, ensure_silence
                append_silence(fpath, ensure_silence())
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
