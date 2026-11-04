# -*- coding: utf-8 -*-
"""
掛け合い音声生成スクリプト（duo-v2 形式）

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
    dialogues = []
    for scene in data.get("scenes", []):
        scene_num = str(scene.get("id", "")).replace("scene_", "")
        for turn, dlg in enumerate(scene.get("dialogue", []), start=1):
            speaker = str(dlg.get("speaker", "female") or "female")
            text = str(dlg.get("naration_text", "") or "").strip()
            if not text:
                continue
            dialogues.append((scene_num, turn, speaker, text))
    return dialogues

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


def synthesize_one(text, speaker, out_path):
    return post_json(TTS_API_URL, {
        "speech_text": text,
        "language": TTS_LANGUAGE,
        "provider": "edge",
        "voice": speaker,
        "save_path": out_path,
    })



def main():
    total = len(NARRATIONS)
    done = 0
    skip = 0
    fail = 0
    for scene, turn, speaker, text in NARRATIONS:
        fname = f"dlg_{scene}_{turn:02d}_{speaker}.mp3"
        fpath = os.path.join(OUTPUT_DIR, fname)
        if os.path.exists(fpath) and os.path.getsize(fpath) > 500:
            print(f"  [SKIP] {fname}")
            skip += 1
            continue
        print(f"  [GEN ] {fname}")
        try:
            synthesize_one(text, speaker, fpath)
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
