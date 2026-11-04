# -*- coding: utf-8 -*-
"""「小説解説_本好きの下剋上_ja」動画素材一式の最終検証。"""

from __future__ import annotations

import ast
import json
import re
import shutil
import struct
import subprocess
import sys
from pathlib import Path


PROJECT_NAME = "小説解説_本好きの下剋上_ja"
BASE_DIR = Path(__file__).resolve().parent
SOURCE_PLAYER_PATH = BASE_DIR.parent / "小説解説_本好きの下剋上_ja" / "index.html"
SCENARIO_PATH = BASE_DIR / "scenario.js"
SCENARIO_JSON_PATH = BASE_DIR / "scenario.json"
INDEX_PATH = BASE_DIR / "index.html"
ASSETS_PATH = BASE_DIR / "assets.json"
AUDIO_GENERATOR_PATH = BASE_DIR / "_gen_audio.py"
IMAGE_GENERATOR_PATH = BASE_DIR / "_gen_scene_images.py"
FINAL_SENTENCE = "この動画はAiDiyのビデオページ生成で作りました。"


def read_utf8(path: Path) -> str:
    return path.read_text(encoding="utf-8-sig")


def load_json(path: Path) -> dict:
    data = json.loads(read_utf8(path))
    if not isinstance(data, dict):
        raise ValueError("ルートがオブジェクトではありません")
    return data


def load_scenario(content: str) -> dict:
    prefix = "window.SCENARIO ="
    stripped = content.lstrip()
    if not stripped.startswith(prefix):
        raise ValueError("window.SCENARIO 代入形式ではありません")
    data = json.loads(stripped[len(prefix) :].strip().removesuffix(";").strip())
    if not isinstance(data, dict):
        raise ValueError("シナリオのルートがオブジェクトではありません")
    return data


def png_size(path: Path) -> tuple[int, int]:
    with path.open("rb") as stream:
        header = stream.read(24)
    if len(header) != 24 or header[:8] != b"\x89PNG\r\n\x1a\n" or header[12:16] != b"IHDR":
        raise ValueError("PNG ヘッダーが不正です")
    return struct.unpack(">II", header[16:24])


def mp3_has_header(path: Path) -> bool:
    with path.open("rb") as stream:
        header = stream.read(10)
    return header.startswith(b"ID3") or (
        len(header) >= 2 and header[0] == 0xFF and (header[1] & 0xE0) == 0xE0
    )


def contains_japanese(value: object) -> bool:
    return bool(re.search(r"[\u3040-\u30ff\u3400-\u9fff]", str(value or "")))


def main() -> int:
    if sys.platform == "win32":
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")

    results: list[tuple[str, bool, str]] = []

    def check(label: str, condition: bool, detail: str) -> None:
        results.append((label, bool(condition), detail))

    scenario_content = read_utf8(SCENARIO_PATH) if SCENARIO_PATH.is_file() else ""
    check(
        "確認 1: scenario.js",
        SCENARIO_PATH.is_file()
        and "window.SCENARIO" in scenario_content
        and "scene_999" in scenario_content,
        "window.SCENARIO と scene_999 を確認",
    )

    scenario: dict = {}
    try:
        scenario = load_scenario(scenario_content)
        check("scenario.js JSON 構文", True, "正常に解析可能")
    except Exception as exc:
        check("scenario.js JSON 構文", False, str(exc))

    scenes = scenario.get("scenes", []) if isinstance(scenario.get("scenes"), list) else []
    scene_ids = [str(scene.get("id", "")) for scene in scenes if isinstance(scene, dict)]
    expected_ids = [*(f"scene_{number:03d}" for number in range(21)), "scene_999"]
    check(
        "シーン構成",
        scene_ids == expected_ids,
        f"{len(scene_ids)} シーン / 期待順序: scene_000～scene_020, scene_999",
    )
    check(
        "プロジェクト名",
        scenario.get("project_name") == PROJECT_NAME and BASE_DIR.name == PROJECT_NAME,
        f"scenario={scenario.get('project_name')!r}, folder={BASE_DIR.name!r}",
    )

    required_fields = ("short_narration", "long_narration", "short_audio", "long_audio")
    incomplete_scenes = [
        str(scene.get("id", "(IDなし)"))
        for scene in scenes
        if not isinstance(scene, dict)
        or any(not str(scene.get(field, "")).strip() for field in required_fields)
    ]
    check(
        "確認 7: シーン必須項目",
        bool(scenes) and not incomplete_scenes,
        "全シーンに4項目あり" if not incomplete_scenes else ", ".join(incomplete_scenes),
    )

    japanese_errors = [
        str(scene.get("id", "(IDなし)"))
        for scene in scenes
        if not contains_japanese(scene.get("short_narration"))
        or not contains_japanese(scene.get("long_narration"))
    ]
    target_language = str(scenario.get("target", {}).get("language", ""))
    check(
        "日本語設定・原稿",
        target_language in {"ja", "ja-JP"} and not japanese_errors,
        f"target.language={target_language!r}、全ナレーションが日本語",
    )

    aidiy_errors: list[str] = []
    visible_fields = ("title", "kicker", "headline", "lead", "subtitle", *required_fields[:2])
    for scene in scenes:
        scene_id = str(scene.get("id", ""))
        visible_texts = [str(scene.get(field, "")) for field in visible_fields]
        if scene_id != "scene_999" and any("AiDiy" in text for text in visible_texts):
            aidiy_errors.append(f"{scene_id}: 本編に言及あり")
        if scene_id == "scene_999":
            for field in ("short_narration", "long_narration"):
                narration = str(scene.get(field, ""))
                if narration.count("AiDiy") != 1 or not narration.endswith(FINAL_SENTENCE):
                    aidiy_errors.append(f"scene_999.{field}: 最後のひとこと以外に言及")
            non_narration = [str(scene.get(field, "")) for field in visible_fields[:-2]]
            if any("AiDiy" in text for text in non_narration):
                aidiy_errors.append("scene_999: 画面本文に言及あり")
    check(
        "確認 6: AiDiy への言及",
        not aidiy_errors,
        "scene_999 の各ナレーション末尾だけ" if not aidiy_errors else "; ".join(aidiy_errors),
    )

    image_files = sorted((BASE_DIR / "images").glob("*.png"))
    audio_files = sorted((BASE_DIR / "audio").glob("*.mp3"))
    check("確認 2: PNG 枚数", len(image_files) >= 22, f"{len(image_files)} 枚（必要: 22 枚以上）")
    check("確認 3: MP3 個数", len(audio_files) >= 44, f"{len(audio_files)} 個（必要: 44 個以上）")

    expected_images = {
        str(scene.get("image", "")) for scene in scenes if isinstance(scene, dict) and scene.get("image")
    }
    expected_audio = {
        str(scene.get(field, ""))
        for scene in scenes
        if isinstance(scene, dict)
        for field in ("short_audio", "long_audio")
        if scene.get(field)
    }
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

    invalid_png: list[str] = []
    for path in image_files:
        try:
            width, height = png_size(path)
            if path.stat().st_size <= 1000 or width < 1280 or height < 720:
                invalid_png.append(path.name)
        except Exception:
            invalid_png.append(path.name)
    check("PNG 実体", not invalid_png, "全ファイル正常" if not invalid_png else ", ".join(invalid_png))

    invalid_mp3 = [
        path.name for path in audio_files if path.stat().st_size <= 500 or not mp3_has_header(path)
    ]
    measured_durations: dict[str, float] = {}
    ffprobe = shutil.which("ffprobe")
    if ffprobe and not invalid_mp3:
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
            )
            try:
                duration = float(probe.stdout.strip())
            except ValueError:
                duration = 0.0
            if probe.returncode != 0 or duration <= 0:
                invalid_mp3.append(path.name)
            else:
                measured_durations[path.relative_to(BASE_DIR).as_posix()] = duration
    check("MP3 実体", not invalid_mp3, "全ファイル正常" if not invalid_mp3 else ", ".join(invalid_mp3))

    duration_errors: list[str] = []
    if measured_durations:
        for scene in scenes:
            for mode in ("short", "long"):
                audio = str(scene.get(f"{mode}_audio", ""))
                declared = float(scene.get(f"{mode}_duration_sec", 0))
                measured = measured_durations.get(audio, 0.0)
                if measured <= 0 or abs(declared - measured) > 0.15:
                    duration_errors.append(f"{audio}: 宣言 {declared:.3f} / 実測 {measured:.3f}")
    check(
        "音声尺の一致",
        bool(measured_durations) and not duration_errors,
        "全音声が実測値と一致" if not duration_errors else "; ".join(duration_errors),
    )
    total_errors: list[str] = []
    for mode in ("short", "long"):
        actual_total = round(sum(float(scene.get(f"{mode}_duration_sec", 0)) for scene in scenes), 3)
        declared_total = float(scenario.get(f"total_{mode}_duration_sec", 0))
        if abs(actual_total - declared_total) > 0.01:
            total_errors.append(f"{mode}: 宣言 {declared_total:.3f} / 合計 {actual_total:.3f}")
    check(
        "全体尺の集計",
        not total_errors,
        "short / long とも一致" if not total_errors else "; ".join(total_errors),
    )

    index_content = read_utf8(INDEX_PATH) if INDEX_PATH.is_file() else ""
    check(
        "確認 4: index.html",
        INDEX_PATH.is_file() and PROJECT_NAME in index_content,
        f"フォルダ名 {PROJECT_NAME} の記載を確認",
    )
    check(
        "index.html 日本語・シナリオ読込",
        '<html lang="ja">' in index_content and 'src="scenario.js"' in index_content,
        "lang=ja と scenario.js 読込を確認",
    )
    source_player_content = read_utf8(SOURCE_PLAYER_PATH) if SOURCE_PLAYER_PATH.is_file() else ""
    normalized_index = index_content.replace(
        "小説解説_本好きの下剋上_ja | 紙一枚から図書館都市へ",
        "小説解説_本好きの下剋上_ja | 紙一枚から国の未来へ",
    ).replace(
        "<div class=\"brand\">小説解説『本好きの下剋上』改</div>",
        "<div class=\"brand\">小説解説『本好きの下剋上』</div>",
    ).replace(
        "本を求める病弱な少女が、紙作りから王権、そして図書館都市へ駆け上がる本編全5部を紹介します。全編ネタバレあり。",
        "本だけを求めた病弱な少女が、紙作りから王権と図書館都市へ駆け上がる全5部をたどります。全編ネタバレあり。",
    )
    check(
        "確認 8: コピー元プレイヤー構造",
        bool(source_player_content) and normalized_index == source_player_content,
        "タイトル・表示文言以外はコピー元と一致"
        if source_player_content and normalized_index == source_player_content
        else "コピー元 index.html と予期しない差分あり",
    )
    avatar = str(scenario.get("assets_policy", {}).get("avatar", ""))
    avatar_ok = (
        "VRM_female.vrm" in avatar
        and "VRM_AiDiy" not in scenario_content
        and "VRM_female.vrm" in index_content
        and "VRM_AiDiy" not in index_content
    )
    check("アバター設定", avatar_ok, f"scenario avatar={avatar!r} / index.html を確認")
    avatar_path = (BASE_DIR / avatar).resolve() if avatar else Path()
    check("VRM 実体", bool(avatar) and avatar_path.is_file(), str(avatar_path))

    wrapper_errors: list[str] = []
    for index, scene in enumerate(scenes):
        scene_id = str(scene.get("id", ""))
        wrapper_path = BASE_DIR / f"{scene_id}.html"
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
        f"{len(scenes)} ページの順序・日本語設定・読込が正常"
        if not wrapper_errors
        else ", ".join(wrapper_errors),
    )

    check("確認 5: _gen_audio.py", AUDIO_GENERATOR_PATH.is_file(), AUDIO_GENERATOR_PATH.name)
    script_errors: list[str] = []
    for path in (AUDIO_GENERATOR_PATH, IMAGE_GENERATOR_PATH):
        if not path.is_file():
            script_errors.append(f"{path.name}: なし")
            continue
        try:
            ast.parse(read_utf8(path), filename=str(path))
        except SyntaxError as exc:
            script_errors.append(f"{path.name}:{exc.lineno}: {exc.msg}")
    check(
        "生成補助スクリプト構文",
        not script_errors,
        "2本とも正常" if not script_errors else "; ".join(script_errors),
    )
    audio_script = read_utf8(AUDIO_GENERATOR_PATH) if AUDIO_GENERATOR_PATH.is_file() else ""
    image_script = read_utf8(IMAGE_GENERATOR_PATH) if IMAGE_GENERATOR_PATH.is_file() else ""
    generator_ok = (
        "TTS_LANGUAGE = 'ja'" in audio_script
        and PROJECT_NAME in audio_script
        and '"scenario.js"' in audio_script
        and PROJECT_NAME in image_script
        and '"scenario.js"' in image_script
    )
    check("生成補助スクリプト設定", generator_ok, "日本語・対象フォルダ・scenario.js 連携を確認")

    stale_markers = ("AiDiy紹介__all_ja", "VRM_AiDiy", "small anecdote")
    checked_texts = {
        "scenario.js": scenario_content,
        "index.html": index_content,
        AUDIO_GENERATOR_PATH.name: audio_script,
        IMAGE_GENERATOR_PATH.name: image_script,
    }
    stale_found = [
        f"{name}: {marker}"
        for name, content in checked_texts.items()
        for marker in stale_markers
        if marker in content
    ]
    check(
        "テンプレート固有文言",
        not stale_found,
        "残存なし" if not stale_found else "; ".join(stale_found),
    )

    try:
        scenario_json = load_json(SCENARIO_JSON_PATH)
        scenario_json_ok = scenario_json == scenario
        scenario_json_detail = "scenario.js と一致" if scenario_json_ok else "scenario.js と内容不一致"
    except Exception as exc:
        scenario_json_ok = False
        scenario_json_detail = str(exc)
    check("scenario.json 同期", scenario_json_ok, scenario_json_detail)

    try:
        assets = load_json(ASSETS_PATH)
        asset_images = {
            str(item.get("path", "")) for item in assets.get("images", []) if isinstance(item, dict)
        }
        asset_audio = {
            str(item.get(field, ""))
            for item in assets.get("audio", [])
            if isinstance(item, dict)
            for field in ("short_path", "long_path")
            if item.get(field)
        }
        assets_ok = (
            assets.get("project_name") == PROJECT_NAME
            and assets.get("status") == "complete"
            and assets.get("policy", {}).get("avatar_model") == "../_vrm/VRM_female.vrm"
            and asset_images == expected_images
            and asset_audio == expected_audio
            and all(item.get("status") == "generated" for item in assets.get("images", []))
            and all(item.get("status") == "generated" for item in assets.get("audio", []))
        )
        assets_detail = "シナリオ・実ファイルと一致" if assets_ok else "件数・状態・アバターのいずれかが不一致"
    except Exception as exc:
        assets_ok = False
        assets_detail = str(exc)
    check("assets.json 同期", assets_ok, assets_detail)

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
