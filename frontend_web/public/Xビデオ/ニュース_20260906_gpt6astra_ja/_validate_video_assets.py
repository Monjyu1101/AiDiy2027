# -*- coding: utf-8 -*-
"""ニュース型ビデオ素材一式の最終検証。"""

from __future__ import annotations

import ast
import json
import re
import shutil
import struct
import subprocess
import sys
import zlib
from pathlib import Path


PROJECT_NAME = "ニュース_20260906_gpt6astra_ja"
BASE_DIR = Path(__file__).resolve().parent
SCENARIO_PATH = BASE_DIR / "scenario.js"
INDEX_PATH = BASE_DIR / "index.html"
AUDIO_GENERATOR_PATH = BASE_DIR / "_gen_dialogue_audio.py"
IMAGE_GENERATOR_PATH = BASE_DIR / "_gen_scene_images.py"
MIN_IMAGES = 7
MIN_AUDIO = 28


def read_utf8(path: Path) -> str:
    return path.read_text(encoding="utf-8-sig")


def load_scenario(content: str) -> dict:
    match = re.fullmatch(
        r"\s*window\.SCENARIO\s*=\s*(\{.*\})\s*;?\s*",
        content,
        re.DOTALL,
    )
    if not match:
        raise ValueError("window.SCENARIO = {...}; 形式ではありません")
    data = json.loads(match.group(1))
    if not isinstance(data, dict):
        raise ValueError("シナリオのルートがオブジェクトではありません")
    return data


def validate_png(path: Path) -> tuple[int, int]:
    raw = path.read_bytes()
    if not raw.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError("PNG シグネチャがありません")
    offset = 8
    width = height = 0
    found_iend = False
    while offset + 12 <= len(raw):
        length = struct.unpack(">I", raw[offset : offset + 4])[0]
        chunk_type = raw[offset + 4 : offset + 8]
        data_start = offset + 8
        data_end = data_start + length
        crc_end = data_end + 4
        if crc_end > len(raw):
            raise ValueError("途中で切れた PNG チャンクです")
        expected_crc = struct.unpack(">I", raw[data_end:crc_end])[0]
        actual_crc = zlib.crc32(chunk_type + raw[data_start:data_end]) & 0xFFFFFFFF
        if expected_crc != actual_crc:
            raise ValueError(f"{chunk_type!r} の CRC が不正です")
        if chunk_type == b"IHDR":
            width, height = struct.unpack(">II", raw[data_start : data_start + 8])
        if chunk_type == b"IEND":
            found_iend = True
            break
        offset = crc_end
    if not found_iend or width <= 0 or height <= 0:
        raise ValueError("IHDR/IEND を正しく読めません")
    return width, height


def mp3_has_header(path: Path) -> bool:
    raw = path.read_bytes()
    if len(raw) <= 500:
        return False
    if raw.startswith(b"ID3"):
        return True
    probe = raw[:8192]
    return any(
        probe[index] == 0xFF and probe[index + 1] & 0xE0 == 0xE0
        for index in range(len(probe) - 1)
    )


def contains_japanese(value: object) -> bool:
    return bool(re.search(r"[\u3040-\u30ff\u3400-\u9fff]", str(value or "")))


def main() -> int:
    results: list[tuple[str, bool, str]] = []

    def check(label: str, condition: bool, detail: str) -> None:
        results.append((label, bool(condition), detail))

    scenario_content = read_utf8(SCENARIO_PATH) if SCENARIO_PATH.is_file() else ""
    scenario: dict = {}
    try:
        scenario = load_scenario(scenario_content)
        scenario_parsed = True
        scenario_detail = "存在し、window.SCENARIO と scene_999 を含み、JSON として解析可能"
    except Exception as exc:
        scenario_parsed = False
        scenario_detail = str(exc)
    check(
        "確認 1: scenario.js",
        SCENARIO_PATH.is_file()
        and "window.SCENARIO" in scenario_content
        and "scene_999" in scenario_content
        and scenario_parsed,
        scenario_detail,
    )

    image_files = sorted((BASE_DIR / "images").glob("*.png"))
    invalid_images: list[str] = []
    image_dimensions: set[tuple[int, int]] = set()
    for path in image_files:
        try:
            image_dimensions.add(validate_png(path))
        except Exception as exc:
            invalid_images.append(f"{path.name}: {exc}")
    check(
        "確認 2: images/*.png",
        len(image_files) >= MIN_IMAGES and not invalid_images,
        f"{len(image_files)} 枚、破損 {len(invalid_images)} 枚、サイズ {sorted(image_dimensions)}",
    )

    audio_files = sorted((BASE_DIR / "audio").glob("*.mp3"))
    invalid_audio = [path.name for path in audio_files if not mp3_has_header(path)]
    measured_durations: dict[str, float] = {}
    ffprobe = shutil.which("ffprobe")
    if ffprobe:
        for path in audio_files:
            probe = subprocess.run(
                [
                    ffprobe,
                    "-v",
                    "error",
                    "-show_entries",
                    "format=duration",
                    "-of",
                    "default=noprint_wrappers=1:nokey=1",
                    str(path),
                ],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                check=False,
            )
            try:
                duration = float(probe.stdout.strip())
            except ValueError:
                duration = 0.0
            if probe.returncode != 0 or duration <= 0:
                invalid_audio.append(f"{path.name} (ffprobe 解析失敗)")
            else:
                measured_durations[path.relative_to(BASE_DIR).as_posix()] = duration
    check(
        "確認 3: audio/*.mp3",
        len(audio_files) >= MIN_AUDIO and not invalid_audio,
        f"{len(audio_files)} 個、空・形式不正・実尺解析失敗 {len(invalid_audio)} 個"
        + ("" if ffprobe else "（ffprobe 未検出のため実尺解析は省略）"),
    )

    index_content = read_utf8(INDEX_PATH) if INDEX_PATH.is_file() else ""
    check(
        "確認 4: index.html",
        INDEX_PATH.is_file() and PROJECT_NAME in index_content,
        f"対象フォルダ名 {PROJECT_NAME} の記載を確認",
    )
    node = shutil.which("node")
    index_script_error = ""
    if node and INDEX_PATH.is_file():
        javascript_validator = r'''
const fs = require("fs");
const vm = require("vm");
const html = fs.readFileSync(process.argv[1], "utf8");
const blocks = [...html.matchAll(/<script(?:\s+([^>]*))?>([\s\S]*?)<\/script>/g)];
for (const [, attrs = "", code] of blocks) {
  if (/\bsrc=/.test(attrs)) continue;
  if (/type="importmap"/.test(attrs)) JSON.parse(code);
  else if (/type="module"/.test(attrs)) new vm.SourceTextModule(code);
  else new vm.Script(code);
}
'''
        script_probe = subprocess.run(
            [node, "--experimental-vm-modules", "-e", javascript_validator, str(INDEX_PATH)],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )
        if script_probe.returncode != 0:
            index_script_error = (script_probe.stderr or script_probe.stdout).strip()
    check(
        "index.html JavaScript 構文",
        not node or not index_script_error,
        "インライン script / module / importmap は構文正常"
        if node and not index_script_error
        else (index_script_error if index_script_error else "node 未検出のため省略"),
    )
    check(
        "確認 5: _gen_dialogue_audio.py",
        AUDIO_GENERATOR_PATH.is_file() and AUDIO_GENERATOR_PATH.stat().st_size > 0,
        "存在し、空ファイルではありません",
    )

    scenes = scenario.get("scenes", []) if isinstance(scenario, dict) else []
    scene_000 = next(
        (scene for scene in scenes if isinstance(scene, dict) and scene.get("id") == "scene_000"),
        {},
    )
    first_female = next(
        (
            turn
            for turn in scene_000.get("dialogue", [])
            if isinstance(turn, dict) and turn.get("speaker") == "female"
        ),
        {},
    )
    opening_text = str(first_female.get("naration_text") or first_female.get("text") or "")
    opening_telop = str(first_female.get("telop_text") or first_female.get("subtitle") or "")
    opening_ok = (
        "AiDiy" in opening_text
        and "ビデオ生成機能" in opening_text
        and ("作られ" in opening_text or "生成され" in opening_text or "自動生成" in opening_text)
        and "AiDiy" in opening_telop
        and ("生成" in opening_telop or "作成" in opening_telop)
    )
    check(
        "確認 6: scene_000 最初の female 発話",
        opening_ok,
        "発話と字幕に AiDiy のビデオ生成機能で作られた旨を確認",
    )

    scene_ids = [str(scene.get("id", "")) for scene in scenes if isinstance(scene, dict)]
    check(
        "シーン構成",
        len(scenes) >= MIN_IMAGES
        and len(scene_ids) == len(set(scene_ids))
        and "scene_000" in scene_ids
        and "scene_999" in scene_ids,
        f"{len(scenes)} シーン、ID 重複なし、scene_000 / scene_999 あり",
    )
    check(
        "対象名・言語",
        BASE_DIR.name == PROJECT_NAME
        and scenario.get("project_name") == PROJECT_NAME
        and scenario.get("language") == "ja"
        and '<html lang="ja">' in index_content,
        f"folder={BASE_DIR.name!r}, scenario={scenario.get('project_name')!r}, language={scenario.get('language')!r}",
    )
    root_sources = scenario.get("source_documents", [])
    scene_metadata_ok = all(
        isinstance(scene, dict)
        and str(scene.get("title", "")).strip()
        and str(scene.get("headline", "")).strip()
        and str(scene.get("image", "")).strip()
        and str(scene.get("source_summary", "")).strip()
        and bool(scene.get("factual_bullets"))
        and bool(scene.get("forbidden_elements"))
        and str(scene.get("image_prompt", "")).strip()
        for scene in scenes
    )
    check(
        "出典・画像生成情報",
        bool(root_sources) and scene_metadata_ok,
        f"ルート出典 {len(root_sources)} 件、全シーンに要約・事実・禁止要素・プロンプトあり",
    )

    dialogues = [
        turn
        for scene in scenes
        if isinstance(scene, dict)
        for turn in scene.get("dialogue", [])
        if isinstance(turn, dict)
    ]
    dialogue_fields_ok = all(
        turn.get("speaker") in {"female", "male"}
        and contains_japanese(turn.get("telop_text") or turn.get("subtitle"))
        and contains_japanese(turn.get("naration_text") or turn.get("text"))
        and str(turn.get("audio", "")).strip()
        and float(turn.get("duration_sec", 0)) > 0
        for turn in dialogues
    )
    check(
        "字幕・ナレーション・話者",
        len(dialogues) >= MIN_AUDIO and dialogue_fields_ok,
        f"{len(dialogues)} 発話、全字幕・ナレーションは日本語、話者・音声参照・尺あり",
    )

    expected_images = {
        str(scene.get("image", ""))
        for scene in scenes
        if isinstance(scene, dict) and scene.get("image")
    }
    expected_audio = {str(turn.get("audio", "")) for turn in dialogues if turn.get("audio")}
    actual_images = {path.relative_to(BASE_DIR).as_posix() for path in image_files}
    actual_audio = {path.relative_to(BASE_DIR).as_posix() for path in audio_files}
    check(
        "画像参照の対応",
        expected_images == actual_images,
        f"scenario {len(expected_images)} 件 / disk {len(actual_images)} 件",
    )
    check(
        "音声参照の対応",
        expected_audio == actual_audio,
        f"scenario {len(expected_audio)} 件 / disk {len(actual_audio)} 件",
    )

    duration_errors: list[str] = []
    if measured_durations:
        for turn in dialogues:
            audio = str(turn.get("audio", ""))
            declared = float(turn.get("duration_sec", 0))
            measured = measured_durations.get(audio, 0.0)
            if measured <= 0 or abs(declared - measured) > 0.02:
                duration_errors.append(f"{audio}: 宣言 {declared:.3f} / 実測 {measured:.3f}")
    check(
        "音声尺の一致",
        not ffprobe or (len(measured_durations) == len(audio_files) and not duration_errors),
        "全発話が実測値と一致"
        if ffprobe and not duration_errors
        else ("; ".join(duration_errors) if duration_errors else "ffprobe 未検出のため省略"),
    )

    aggregate_errors: list[str] = []
    for scene in scenes:
        if not isinstance(scene, dict):
            continue
        dialogue_total = sum(float(turn.get("duration_sec", 0)) for turn in scene.get("dialogue", []))
        scene_total = float(scene.get("duration_sec", 0))
        if abs(dialogue_total - scene_total) > 0.01:
            aggregate_errors.append(
                f"{scene.get('id')}: scene {scene_total:.3f} / dialogue {dialogue_total:.3f}"
            )
    declared_total = float(scenario.get("total_duration_sec", 0))
    scenes_total = sum(float(scene.get("duration_sec", 0)) for scene in scenes if isinstance(scene, dict))
    if abs(declared_total - scenes_total) > 0.01:
        aggregate_errors.append(f"total: scenario {declared_total:.3f} / scenes {scenes_total:.3f}")
    check(
        "シーン・全体尺の集計",
        declared_total > 0 and not aggregate_errors,
        "dialogue → scene → total の集計が一致"
        if not aggregate_errors
        else "; ".join(aggregate_errors),
    )

    dependencies = [
        (BASE_DIR / str(scenario.get("assets_policy", {}).get(key, ""))).resolve()
        for key in ("male_avatar", "female_avatar")
    ] + [
        (BASE_DIR / "../_common/playback_start_delay.js").resolve(),
        (BASE_DIR / "../_common/playback_controls_autohide.js").resolve(),
    ]
    missing_dependencies = [str(path) for path in dependencies if not path.is_file()]
    check(
        "共有アセット参照",
        not missing_dependencies,
        "VRM 2 点・共通スクリプト 2 点あり"
        if not missing_dependencies
        else "; ".join(missing_dependencies),
    )

    wrapper_errors: list[str] = []
    for index, scene in enumerate(scenes):
        if not isinstance(scene, dict):
            continue
        wrapper_path = BASE_DIR / f"{scene.get('id', '')}.html"
        wrapper_content = read_utf8(wrapper_path) if wrapper_path.is_file() else ""
        if (
            not wrapper_path.is_file()
            or '<html lang="ja">' not in wrapper_content
            or f"window._SCENE_INDEX = {index};" not in wrapper_content
            or 'src="scenario.js"' not in wrapper_content
        ):
            wrapper_errors.append(wrapper_path.name)
    check(
        "シーン確認ページ",
        not wrapper_errors,
        f"{len(scenes)} ページの順序・言語・読込が正常"
        if not wrapper_errors
        else ", ".join(wrapper_errors),
    )

    script_errors: list[str] = []
    for path in (AUDIO_GENERATOR_PATH, IMAGE_GENERATOR_PATH):
        if not path.is_file() or path.stat().st_size == 0:
            script_errors.append(f"{path.name}: 不存在または空")
            continue
        try:
            ast.parse(read_utf8(path), filename=str(path))
        except SyntaxError as exc:
            script_errors.append(f"{path.name}:{exc.lineno}: {exc.msg}")
    check(
        "生成補助スクリプト構文",
        not script_errors,
        "2 本とも正常" if not script_errors else "; ".join(script_errors),
    )

    audio_generator = read_utf8(AUDIO_GENERATOR_PATH) if AUDIO_GENERATOR_PATH.is_file() else ""
    image_generator = read_utf8(IMAGE_GENERATOR_PATH) if IMAGE_GENERATOR_PATH.is_file() else ""
    helper_config_ok = (
        "TTS_LANGUAGE = 'ja'" in audio_generator
        and '"scenario.js"' in audio_generator
        and '"scenario.js"' in image_generator
        and 'TEMPLATE_IMAGE_DIR = ""' in image_generator
        and "ThreadPoolExecutor" not in image_generator
    )
    check(
        "生成補助スクリプト設定",
        helper_config_ok,
        "日本語・scenario.js 連携・テンプレート画像なし・画像逐次生成を確認",
    )

    checked_texts = {
        "scenario.js": scenario_content,
        "index.html": index_content,
        AUDIO_GENERATOR_PATH.name: audio_generator,
        IMAGE_GENERATOR_PATH.name: image_generator,
    }
    stale_pattern = re.compile(
        r"TODO|FIXME|PLACEHOLDER|ニュース_20260521_|ニュース_20260902_|ニュース_20260905_|AiDiy解説__all_ja",
        re.IGNORECASE,
    )
    stale_markers = [
        f"{name}:{line_number}: {line.strip()}"
        for name, content in checked_texts.items()
        for line_number, line in enumerate(content.splitlines(), start=1)
        if stale_pattern.search(line)
    ]
    check(
        "テンプレート固有文言",
        not stale_markers,
        "残存なし" if not stale_markers else "; ".join(stale_markers),
    )

    empty_files = [
        path.relative_to(BASE_DIR).as_posix()
        for path in BASE_DIR.rglob("*")
        if path.is_file() and path.stat().st_size == 0
    ]
    check("空ファイル", not empty_files, "なし" if not empty_files else ", ".join(empty_files))

    failed = 0
    for label, ok, detail in results:
        print(f"[{'OK' if ok else 'NG'}] {label}: {detail}")
        if not ok:
            failed += 1
    print(f"\n最終結果: {'OK' if failed == 0 else 'NG'} ({len(results) - failed}/{len(results)} 項目成功)")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
