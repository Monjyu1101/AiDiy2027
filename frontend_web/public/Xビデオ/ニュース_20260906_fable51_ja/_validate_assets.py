# -*- coding: utf-8 -*-
"""ニュース型ビデオ素材の最終検証。"""

from __future__ import annotations

import json
import re
import shutil
import struct
import subprocess
import sys
import zlib
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
PROJECT_NAME = "ニュース_20260906_fable51_ja"
MIN_IMAGES = 7
MIN_AUDIO = 28

errors: list[str] = []
warnings: list[str] = []


def result(number: str, label: str, ok: bool, detail: str) -> None:
    status = "OK" if ok else "NG"
    print(f"[確認 {number}] {status}: {label} - {detail}")
    if not ok:
        errors.append(f"確認 {number}: {label} ({detail})")


def load_scenario(path: Path) -> tuple[str, dict]:
    content = path.read_text(encoding="utf-8-sig")
    match = re.fullmatch(r"\s*window\.SCENARIO\s*=\s*(\{.*\})\s*;?\s*", content, re.DOTALL)
    if not match:
        raise ValueError("window.SCENARIO = {...}; 形式ではありません")
    return content, json.loads(match.group(1))


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
            raise ValueError(f"{chunk_type.decode('ascii', errors='replace')} の CRC が不正です")
        if chunk_type == b"IHDR":
            width, height = struct.unpack(">II", raw[data_start : data_start + 8])
        if chunk_type == b"IEND":
            found_iend = True
            break
        offset = crc_end
    if not found_iend or width <= 0 or height <= 0:
        raise ValueError("IHDR/IEND を正しく読めません")
    return width, height


def looks_like_mp3(path: Path) -> bool:
    raw = path.read_bytes()
    if len(raw) <= 500:
        return False
    if raw.startswith(b"ID3"):
        return True
    probe = raw[:8192]
    return any(probe[i] == 0xFF and probe[i + 1] & 0xE0 == 0xE0 for i in range(len(probe) - 1))


def main() -> int:
    scenario_path = BASE_DIR / "scenario.js"
    scenario_content = ""
    scenario: dict = {}
    scenario_ok = scenario_path.is_file()
    if scenario_ok:
        try:
            scenario_content, scenario = load_scenario(scenario_path)
        except Exception as exc:
            scenario_ok = False
            errors.append(f"scenario.js 解析失敗: {exc}")
    result(
        "1",
        "scenario.js / window.SCENARIO / scene_999",
        scenario_ok and "window.SCENARIO" in scenario_content and "scene_999" in scenario_content,
        "存在し、JSON として解析可能" if scenario_ok else "不存在または解析不可",
    )

    image_paths = sorted((BASE_DIR / "images").glob("*.png")) if (BASE_DIR / "images").is_dir() else []
    invalid_images: list[str] = []
    dimensions: set[tuple[int, int]] = set()
    for path in image_paths:
        try:
            dimensions.add(validate_png(path))
        except Exception as exc:
            invalid_images.append(f"{path.name}: {exc}")
    result(
        "2",
        "images/*.png",
        len(image_paths) >= MIN_IMAGES and not invalid_images,
        f"{len(image_paths)} 枚、破損 {len(invalid_images)} 枚、画像サイズ {sorted(dimensions)}",
    )
    errors.extend(f"画像破損: {item}" for item in invalid_images)

    audio_paths = sorted((BASE_DIR / "audio").glob("*.mp3")) if (BASE_DIR / "audio").is_dir() else []
    invalid_audio = [path.name for path in audio_paths if not looks_like_mp3(path)]
    actual_audio_durations: dict[str, float] = {}
    ffprobe = shutil.which("ffprobe")
    if ffprobe:
        for path in audio_paths:
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
                actual_audio_durations[path.name] = duration
    else:
        warnings.append("ffprobe がないため、MP3 実尺の照合を省略しました")
    result(
        "3",
        "audio/*.mp3",
        len(audio_paths) >= MIN_AUDIO and not invalid_audio,
        f"{len(audio_paths)} 個、空・形式不正・実尺解析失敗 {len(invalid_audio)} 個",
    )
    errors.extend(f"音声破損: {name}" for name in invalid_audio)

    index_path = BASE_DIR / "index.html"
    index_text = index_path.read_text(encoding="utf-8-sig") if index_path.is_file() else ""
    index_ok = index_path.is_file() and PROJECT_NAME in index_text
    result(
        "4",
        "index.html / 対象フォルダ名",
        index_ok,
        "対象名を含む" if index_ok else f"{PROJECT_NAME} がありません",
    )

    audio_generator = BASE_DIR / "_gen_dialogue_audio.py"
    audio_generator_ok = audio_generator.is_file() and audio_generator.stat().st_size > 0
    result(
        "5",
        "_gen_dialogue_audio.py",
        audio_generator_ok,
        "存在する" if audio_generator_ok else "不存在または空ファイル",
    )

    first_female_text = ""
    if scenario:
        scene_000 = next((scene for scene in scenario.get("scenes", []) if scene.get("id") == "scene_000"), {})
        first_female = next((turn for turn in scene_000.get("dialogue", []) if turn.get("speaker") == "female"), {})
        first_female_text = str(first_female.get("naration_text") or first_female.get("text") or "")
    intro_ok = all(word in first_female_text for word in ("AiDiy", "ビデオ生成機能", "作られ"))
    result(
        "6",
        "scene_000 の最初の female 発話",
        intro_ok,
        "AiDiy のビデオ生成機能で作成された旨あり" if intro_ok else "必須の案内が不足",
    )

    if scenario:
        if scenario.get("project_name") != PROJECT_NAME:
            errors.append(f"project_name 不一致: {scenario.get('project_name')!r}")
        if scenario.get("language") != "ja":
            errors.append(f"language 不一致: {scenario.get('language')!r}")

        scenes = scenario.get("scenes", [])
        scene_ids = [str(scene.get("id", "")) for scene in scenes]
        if len(scene_ids) != len(set(scene_ids)):
            errors.append("シーン ID が重複しています")
        referenced_images: set[str] = set()
        referenced_audio: set[str] = set()
        dialogue_count = 0
        total_duration = 0.0
        for scene in scenes:
            scene_id = str(scene.get("id", ""))
            image_ref = str(scene.get("image", ""))
            if image_ref:
                referenced_images.add(image_ref)
                if not (BASE_DIR / image_ref).is_file():
                    errors.append(f"{scene_id}: 参照画像が不存在 ({image_ref})")
            turns = scene.get("dialogue", [])
            scene_duration = 0.0
            for turn_index, turn in enumerate(turns, start=1):
                dialogue_count += 1
                speaker = turn.get("speaker")
                if speaker not in {"female", "male"}:
                    errors.append(f"{scene_id} 発話 {turn_index}: speaker 不正 ({speaker!r})")
                narration = str(turn.get("naration_text") or turn.get("text") or "").strip()
                telop = str(turn.get("telop_text") or turn.get("subtitle") or "").strip()
                if not narration or not telop:
                    errors.append(f"{scene_id} 発話 {turn_index}: 日本語原稿または字幕が空です")
                audio_ref = str(turn.get("audio", ""))
                if audio_ref:
                    referenced_audio.add(audio_ref)
                    if not (BASE_DIR / audio_ref).is_file():
                        errors.append(f"{scene_id} 発話 {turn_index}: 参照音声が不存在 ({audio_ref})")
                    actual_duration = actual_audio_durations.get(Path(audio_ref).name)
                    declared_duration = float(turn.get("duration_sec") or 0)
                    if actual_duration is not None and abs(actual_duration - declared_duration) > 0.02:
                        errors.append(
                            f"{scene_id} 発話 {turn_index}: 音声実尺不一致 "
                            f"(ffprobe {actual_duration:.3f} / 宣言 {declared_duration:.3f})"
                        )
                else:
                    errors.append(f"{scene_id} 発話 {turn_index}: audio 参照が空です")
                scene_duration += float(turn.get("duration_sec") or 0)
            declared_scene_duration = float(scene.get("duration_sec") or 0)
            if abs(scene_duration - declared_scene_duration) > 0.02:
                errors.append(
                    f"{scene_id}: duration_sec 不一致 "
                    f"(発話合計 {scene_duration:.3f} / 宣言 {declared_scene_duration:.3f})"
                )
            total_duration += declared_scene_duration
        declared_total = float(scenario.get("total_duration_sec") or 0)
        if abs(total_duration - declared_total) > 0.02:
            errors.append(
                f"total_duration_sec 不一致 (シーン合計 {total_duration:.3f} / 宣言 {declared_total:.3f})"
            )
        print(
            f"[追加] シーン {len(scenes)} 件、発話 {dialogue_count} 件、"
            f"画像参照 {len(referenced_images)} 件、音声参照 {len(referenced_audio)} 件"
        )

    if '<html lang="ja">' not in index_text:
        errors.append("index.html の lang が ja ではありません")
    if 'src="scenario.js"' not in index_text:
        errors.append("index.html から scenario.js への参照がありません")

    helper_paths = [audio_generator, BASE_DIR / "_gen_scene_images.py"]
    for helper in helper_paths:
        if not helper.is_file() or helper.stat().st_size == 0:
            errors.append(f"生成補助スクリプトが不存在または空: {helper.name}")
            continue
        try:
            source = helper.read_text(encoding="utf-8-sig")
            compile(source, str(helper), "exec")
        except SyntaxError as exc:
            errors.append(f"{helper.name} 構文エラー: {exc}")

    scan_paths = [scenario_path, index_path, *helper_paths]
    residue_pattern = re.compile(
        r"TODO|FIXME|PLACEHOLDER|ニュース_20260521_|ニュース_20260902_|ニュース_20260905_|AiDiy解説__all_ja",
        re.IGNORECASE,
    )
    for path in scan_paths:
        if not path.is_file():
            continue
        for line_no, line in enumerate(path.read_text(encoding="utf-8-sig").splitlines(), start=1):
            if residue_pattern.search(line):
                errors.append(f"テンプレート残留候補: {path.name}:{line_no}: {line.strip()}")

    print("\n--- 最終判定 ---")
    if errors:
        for item in errors:
            print(f"NG: {item}")
    for item in warnings:
        print(f"WARN: {item}")
    if errors:
        print(f"検証失敗: {len(errors)} 件")
        return 1
    print("検証成功: 必須項目と追加整合性チェックはすべて OK です。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
