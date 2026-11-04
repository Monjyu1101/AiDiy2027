# -*- coding: utf-8 -*-
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""音声照合（Step 08）: 生成した MP3 が原稿どおりに読まれているかを確認し、誤読を読み指定で直す。

流れ（1 シーンずつ）:
  1. 各 MP3 を Google 音声認識にかける。25 秒の窓を 20 秒ずつずらして重ねて認識する（窓の端で語が切れても、
     隣の窓では完全な形で認識される）。
  2. 原稿と、重ねた認識結果を codex_cli（読み取り専用）へ渡し、誤読される語の「読み指定」を返してもらう。
  3. 読み指定を _gen_audio.py の PRONUNCIATION_OVERRIDES へ反映し、該当 MP3 だけ再合成する。
  4. 直した MP3 をもう一度確認する（最大 2 回）。

字幕（scenario.js の原稿）は変えない。TTS へ渡す文字だけを置き換える。日本語以外は対象外。
"""

from __future__ import annotations

import ast
import asyncio
from concurrent.futures import ThreadPoolExecutor
import io
import json
import os
import re
import shutil
import subprocess
import tempfile

from .generation import load_scenario_object


def audio_tasks(scenario_path: str) -> dict[str, str]:
    """4 種の scenario 形式から MP3 名と原稿を対応させる。"""
    tasks: dict[str, str] = {}
    def add(name: str, value: str) -> None:
        if not name.endswith(".mp3") or name != os.path.basename(name):
            raise RuntimeError(f"シナリオの音声ファイル名が不正です: {name!r}")
        if name in tasks:
            raise RuntimeError(f"シナリオの音声ファイル名が重複しています: {name}")
        tasks[name] = value

    for scene in load_scenario_object(scenario_path).get("scenes", []):
        scene_no = str(scene.get("id", "")).replace("scene_", "")
        dialogues = scene.get("dialogue") or []
        if dialogues:
            for turn, dlg in enumerate(dialogues, 1):
                speaker = str(dlg.get("speaker") or "female")
                name = os.path.basename(str(dlg.get("audio") or ""))
                if not name:
                    name = f"dlg_{scene_no}_{turn:02d}_{speaker}.mp3"
                add(name, str(next((dlg[k] for k in ("naration_text", "text", "content") if k in dlg), "") or "").strip())
        for kind in ("short", "long"):
            key = f"{kind}_narration"
            if key in scene:
                name = os.path.basename(str(scene.get(f"{kind}_audio") or "")) or f"{kind}_scene_{scene_no}.mp3"
                add(name, str(scene[key] or "").strip())
    return tasks



def _recognize_segments(path: str, language: str, window: float = 25.0, step: float = 25.0) -> list[dict]:
    """MP3 を window 秒ずつ WAV にし、既存 STT と同じ Google 音声認識にかける。

    step < window にすると窓が重なる。窓の端で語が切れても、隣の窓では完全な形で認識される。
    """
    import speech_recognition as sr

    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", path],
        capture_output=True, text=True, encoding="utf-8", check=True, timeout=30,
    )
    duration = float(probe.stdout.strip())
    if duration <= 0:
        raise RuntimeError(f"音声長が不正です: {path}")
    locale = {"ja": "ja-JP", "en": "en-US", "zh": "zh-CN", "ko": "ko-KR", "fr": "fr-FR", "de": "de-DE", "es": "es-ES", "pt": "pt-BR"}.get(language.lower(), language)
    parts: list[dict] = []
    start = 0.0
    prev_end = None
    while True:
        length = min(window, duration - start)
        wave = subprocess.run(
            ["ffmpeg", "-v", "error", "-ss", f"{start:.3f}", "-t", f"{length:.3f}", "-i", path,
             "-ac", "1", "-ar", "16000", "-f", "wav", "pipe:1"],
            capture_output=True, check=True, timeout=120,
        ).stdout
        if wave:
            recognizer = sr.Recognizer()
            recognizer.operation_timeout = 30
            with sr.AudioFile(io.BytesIO(wave)) as source:
                audio = recognizer.record(source)
            try:
                text = recognizer.recognize_google(audio, language=locale)
            except sr.UnknownValueError:
                text = ""
            part = {"start_sec": round(start, 1), "end_sec": round(start + length, 1), "text": text}
            if prev_end is not None and start < prev_end:
                # 前の窓と重なる区間。この区間は 2 つの窓で別々に認識されている。
                part["overlap_with_previous_sec"] = [round(start, 1), round(prev_end, 1)]
            parts.append(part)
            prev_end = start + length
        if start + window >= duration:
            break
        start += step
    return parts


def _transcribe_windows(tasks: dict[str, str], audio_dir: str, language: str,
                        window: float = 25.0, step: float = 20.0) -> dict[str, list[dict]]:
    """各 MP3 を、重ねた窓（既定: 25 秒の窓を 20 秒ずつずらす = 5 秒重なる）で認識する。"""
    def one(name: str) -> tuple[str, list[dict]]:
        return name, _recognize_segments(os.path.join(audio_dir, name), language, window, step)

    with ThreadPoolExecutor(max_workers=3) as pool:
        return dict(pool.map(one, tasks))



def _read_overrides(source: str) -> dict[str, str]:
    for node in ast.parse(source).body:
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "PRONUNCIATION_OVERRIDES" for t in node.targets):
            value = ast.literal_eval(node.value)
            if isinstance(value, dict):
                return value
    raise RuntimeError("音声生成 Python に PRONUNCIATION_OVERRIDES がありません")


def _write_overrides(script_path: str, overrides: dict[str, str]) -> None:
    with open(script_path, encoding="utf-8") as f:
        source = f.read()
    updated, count = re.subn(
        r"(?m)^PRONUNCIATION_OVERRIDES = .*?$",
        lambda _: f"PRONUNCIATION_OVERRIDES = {overrides!r}", source, count=1,
    )
    if count != 1:
        raise RuntimeError("音声生成 Python の読み指定を更新できません")
    compile(updated, script_path, "exec")
    with open(script_path, "w", encoding="utf-8", newline="\n") as f:
        f.write(updated)


def ensure_audio_script_review_support(script_path: str) -> bool:
    """既存の音声生成処理を残し、読み指定と対象 MP3 の再生成機能を追加する。"""
    with open(script_path, encoding="utf-8-sig") as f:
        original = f.read()
    source = original

    def insert_once(pattern: str, replacement, label: str) -> None:
        nonlocal source
        source, count = re.subn(pattern, replacement, source, count=1, flags=re.MULTILINE)
        if count != 1:
            raise RuntimeError(f"音声生成 Python に {label} を追加できません: {script_path}")

    if not re.search(r"(?m)^PRONUNCIATION_OVERRIDES\s*=", source):
        insert_once(r"^(TTS_LANGUAGE\s*=.*)$", r"\1\nPRONUNCIATION_OVERRIDES = {}", "読み指定")
    if "def apply_pronunciation(" not in source:
        helper = (
            "def apply_pronunciation(text, out_path):\n"
            "    changes = PRONUNCIATION_OVERRIDES.get(os.path.basename(out_path), {})\n"
            "    if isinstance(changes, str):\n"
            "        return changes\n"
            "    for old, reading in changes.items():\n"
            "        text = text.replace(old, reading)\n"
            "    return text\n\n\n"
        )
        insert_once(r"^(def synthesize_one\(text(?:, speaker)?, out_path\):)$", lambda m: helper + m.group(1), "読み適用関数")
    if "text = apply_pronunciation(text, out_path)" not in source:
        insert_once(
            r"^(def synthesize_one\(text(?:, speaker)?, out_path\):)$",
            r"\1\n    text = apply_pronunciation(text, out_path)", "音声合成への読み適用",
        )
    if "selected_files = set(sys.argv[2:])" not in source:
        insert_once(
            r"^(def main\(\):)$",
            r"\1\n    selected_files = set(sys.argv[2:]) if len(sys.argv) > 1 and sys.argv[1] == '--only-file' else set()",
            "対象ファイル指定",
        )
    if "if selected_files and fname not in selected_files:" not in source:
        insert_once(
            r"^(\s+fname = .*\.mp3\"$)",
            r"\1\n        if selected_files and fname not in selected_files: continue",
            "対象ファイル選択",
        )
    if not re.search(r"(?m)^\s*if os\.path\.exists\(fpath\).*and fname not in selected_files:", source):
        insert_once(
            r"^(\s*if os\.path\.exists\(fpath\).*?)(:)$",
            r"\1 and fname not in selected_files\2", "既存音声スキップ条件",
        )

    if source == original:
        return False
    compile(source, script_path, "exec")
    parent = os.path.dirname(script_path)
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", newline="\n", dir=parent,
                                     prefix="._audio_review_", suffix=".py", delete=False) as f:
        temp_path = f.name
        f.write(source)
    try:
        os.replace(temp_path, script_path)
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)
    return True



# ====================================================================== #
# codex_cli に原稿と音声認識を渡し、誤読される語の「読み指定」をもらう
# （字幕=原稿は変えない。TTS へ渡す文字だけを置き換える。音声は直接は聞けない前提）
# ====================================================================== #

_DIALOGUE_TEXT_KEYS = ("naration_text", "text", "content")
_READING_CHARS = re.compile(r"[ぁ-ゖーァ-ヶ一-龥々〆]+")


def _audio_index(scenario_path: str) -> dict[str, dict]:
    """MP3 名 → {scene, field, text(strip 済み)}。audio_tasks と同じ対応で、原稿の場所も返す。"""
    index: dict[str, dict] = {}
    for scene in load_scenario_object(scenario_path).get("scenes", []):
        scene_id = str(scene.get("id", ""))
        scene_no = scene_id.replace("scene_", "")
        for turn, dlg in enumerate(scene.get("dialogue") or [], 1):
            speaker = str(dlg.get("speaker") or "female")
            name = os.path.basename(str(dlg.get("audio") or "")) or f"dlg_{scene_no}_{turn:02d}_{speaker}.mp3"
            text = str(next((dlg[k] for k in _DIALOGUE_TEXT_KEYS if k in dlg), "") or "").strip()
            index[name] = {"scene": scene_id, "field": f"dialogue[{turn - 1}]", "text": text}
        for kind in ("short", "long"):
            key = f"{kind}_narration"
            if key in scene:
                name = os.path.basename(str(scene.get(f"{kind}_audio") or "")) or f"{kind}_scene_{scene_no}.mp3"
                index[name] = {"scene": scene_id, "field": key, "text": str(scene[key] or "").strip()}
    return index


def _extract_review_json(answer: str) -> dict:
    """codex_cli の応答から {"files": [...]} を含む JSON を取り出す。"""
    text = answer.strip()
    fenced = re.search(r"```(?:json)?\s*(\{.*\})\s*```", text, re.DOTALL)
    if fenced:
        text = fenced.group(1)
    decoder = json.JSONDecoder()
    for pos, char in enumerate(text):
        if char != "{":
            continue
        try:
            data, _ = decoder.raw_decode(text[pos:])
        except json.JSONDecodeError:
            continue
        if isinstance(data, dict) and isinstance(data.get("files"), list):
            return data
    raise ValueError("音声照合 AI 応答に files 配列がありません")


def _agent_review_prompt(ctx, entries: list[dict], round_no: int, overrides: dict) -> str:
    """原稿と音声認識(重ねた窓)を渡し、誤読される語の読み指定を返してもらう指示。"""
    files = [{"file": e["name"], "scene": e["scene"], "field": e["field"], "text": e["text"],
              "applied_readings": overrides.get(e["name"], {}) if isinstance(overrides.get(e["name"], {}), dict) else {},
              "asr_windows": e.get("asr_windows", [])} for e in entries]
    again = ""
    if round_no > 1:
        again = ("\n【再確認】前回の読み指定を反映して、これらの MP3 を再合成しました。"
                 "直した箇所が正しく読まれているか、新しい読み違いが出ていないかを確認してください。"
                 "直す必要がなければ readings は空にしてください。\n")
    return (
        "あなたはナレーション動画の校閲担当です。音声合成（TTS）で作った MP3 が、原稿どおりに読まれているかを、"
        "音声認識の結果と原稿から確認し、誤読される語の『読み指定』を返してください。\n"
        f"ナレーションの言語: {ctx.language}\n"
        "\n【前提】原稿は字幕として画面に出るので、原稿（text）は絶対に変えない。"
        "変えるのは、TTS へ渡す文字だけ（読み指定）。読み指定は、原稿中の語句を、TTS が正しく読める表記"
        "（ひらがな・カタカナなど）に置き換えて音声合成する仕組みで、字幕には影響しない。\n"
        + again
        + "\n【渡すもの】files の各要素: file=MP3 名、scene / field=原稿の場所、text=読み上げの元原稿、"
        "applied_readings=適用済みの読み指定（原稿の句→TTS へ渡す文字）、"
        "asr_windows=こちらで取った Google 音声認識の結果（下記）。\n"
        "\n【asr_windows の読み方】\n"
        "  - MP3 を 25 秒の窓に切り、20 秒ずつずらして認識してある。隣り合う窓は 5 秒ずつ重なる。"
        "例: 61.5 秒の MP3 は、窓1=0〜25 秒、窓2=20〜45 秒、窓3=40〜61.5 秒。"
        "窓2 の overlap_with_previous_sec は [20, 25]（窓1 の終わりの 5 秒と、窓2 の始まりの 5 秒は同じ音声）。\n"
        "  - 窓の先頭と末尾では、語が途中で切れて誤認識されていることがある。その語は隣の窓では中ほどにあり、"
        "完全な形で認識されている。切れ目付近の食い違いは、隣の窓の結果を優先する。\n"
        "  - 重なる 5 秒は、同じ音声を 2 回認識した結果になる。2 回とも同じ食い違いなら、その語の発音が原稿と違う可能性が高い。"
        "1 回だけの食い違いは、認識の揺れの可能性が高い。\n"
        "  - asr は漢字かな交じりで、同音異字に寄る。そのため読みの違い（『実』を『じつ』と読む等）は現れにくい。"
        "ただし、TTS が別の読みで発音した語は、認識結果にひらがなのまま出ることがある"
        "（例:『養父』が『やぶ』と読まれると、認識結果は『やぶ』のひらがなで返る）。\n"
        "\n【目的】TTS が原稿を正しい日本語として読むこと。特に音読みと訓読みの取り違えが多い。\n"
        "\n【文脈に沿った確認】読みは、単語だけでなく、その文の意味で決まる。語を辞書どおりに見るのではなく、"
        "次の順で 1 文ずつ確認する。\n"
        "  1. 前後の文を含めて、その文で誰が何をしているか（何を指しているか）を確定する。\n"
        "  2. その意味での自然な読みを決める。\n"
        "  3. TTS が、別の意味の読み（よく使われる読みや、音読み）に取り違えそうかを判断する。\n"
        "  同じ漢字でも、文脈で読みが変わる語に特に注意する。"
        "例: 『一行』は、旅の一団なら『いっこう』、文章の 1 行なら『いちぎょう』。"
        "『空』は、中身がないなら『から』、天なら『そら』、仏教の語なら『くう』（『杯を空にした』は『からにした』）。"
        "『間』は、『間に合う』『間が悪い』『間を置く』なら『ま』（『間に合わない』は『まにあわない』）、"
        "『二つの間』『間にある』なら『あいだ』、『時間』『期間』のような熟語なら『かん』と読む。"
        "『金』は、色や光（金と黒の光、金色）を指すなら『きん』、お金の意味なら『かね』と読む"
        "（『金と黒』『黒と金』は、いずれも『きんとくろ』『くろときん』）。"
        "『重』は、『重なる』『重ねる』『積み重なる』『折り重なる』なら『かさ』（『重要』『慎重』『貴重』『厳重』『尊重』のような熟語では『じゅう』のまま）。"
        "『小広間』は『しょうひろま』（『こひろま』ではない）。"
        "呼称・敬称も、取り違えやすい。『お父様』は『おとうさま』（『おととさま』ではない）、『お母様』は『おかあさま』、"
        "『お兄様』は『おにいさま』、『お姉様』は『おねえさま』、『養父』は『ようふ』（『やぶ』ではない）。"
        "『神官長』は必ず『しんかんちょう』（『しんかんなが』のように『長』を訓読みしない）。"
        "ほかにも『人気』『上手』『大人』『行う』『生』のように、意味で読みが変わる語は、どれも同じ観点で確認する。"
        "例はどれも一例で、これ以外の語も同じ観点で探す。\n"
        "\n【やること】原稿の各文を確認し、TTS が誤読した（または誤読する可能性が高い）語句だけを、"
        "読み指定で直す。次のいずれかの根拠があるものだけを対象にする。\n"
        "  (1) asr_windows が、その語を原稿と別の発音・別の語で一貫して返している（重なる 2 回とも同じ食い違い）。\n"
        "  (2) asr_windows が、その語をひらがなのまま返している。\n"
        "  (3) 音読みと訓読みの取り違えが典型的に起き、TTS が誤読する可能性が高い語。"
        "文脈で読みが変わる語（上の【文脈に沿った確認】）も含む。ASR の食い違いが無くても、"
        "この観点に当てはまれば指定する（ASR は誤読でも正しく聞こえることがある）。"
        "例: 果実の『実』→『み』、『礎』→『いしずえ』、『養父』→『ようふ』、『側仕え』→『そばづかえ』、"
        "『七色』→『なないろ』、『杯』→『さかずき』、『間に合わない』→『まにあわない』、"
        "『金と黒』→『きんと黒』（色や光を指す『金』を『かね』と誤読させない）、"
        "『重なります』→『かさなります』、『積み重なる』→『積みかさなる』（『重要』等の熟語と混同しない）、"
        "『小広間』→『しょうひろま』、『神官長』→『しんかんちょう』（『長』の訓読みに誤読しない）。"
        "例はどれも一例で、これ以外の語も同じ観点で探す。\n"
        "  変えないもの: TTS がふつうに正しく読む語（『木の根』『油』『技』『故郷』『魔術具』のような日常語・一般的な熟語）、"
        "読みが一つに決まる語、同音の漢字違いにすぎない認識の揺れ（1 回だけ出る食い違い）、すでにかな書きの語、"
        "適用済みの読み指定。読みが複数あるというだけでは指定しない。\n"
        "  TTS へ渡す文字が不自然に長いかな連続になると、抑揚が崩れる。置き換えは誤読される語だけに絞る。"
        "根拠が弱いものは指定せず、uncertain に書く。\n"
        "\n【読み指定の書き方】readings で返す。\n"
        "  - source: text の中の連続した文字列。置き換える語に前後 1〜2 文字を足して、他の読みの語を巻き込まない長さにする。"
        "（同じ文字列が text に複数回あれば、すべて同じ読みで置き換わる。別の読みが混じる語は、前後を足して区別する）\n"
        "  - reading: source の置き換え後（TTS へ渡す文字）。誤読される語だけをひらがな・カタカナにし、他の文字は source のまま残す。\n"
        "  - 例: source『この実を眺める』→ reading『このみを眺める』。source『養父』→ reading『ようふ』。\n"
        "\n【出力】最後に次の JSON だけを返す。\n"
        '{"method":"確認の方法（短く）","files":[{"file":"MP3 名","verdict":"ok|fixed|uncertain",'
        '"readings":[{"source":"…","reading":"…","reason":"根拠 (1)(2)(3) のどれか"}],"note":"短い補足"}],"limits":"できなかったこと"}\n'
        + json.dumps({"files": files}, ensure_ascii=False)
    )


def _codex_user_setting(key: str) -> str:
    """~/.codex/config.toml のトップレベルの設定値（model など）を読む。無ければ空文字。"""
    try:
        with open(os.path.join(os.path.expanduser("~"), ".codex", "config.toml"), encoding="utf-8") as f:
            for line in f:
                if line.lstrip().startswith("["):   # 最初のテーブルより後は対象外（トップレベルだけ）
                    break
                m = re.match(rf'\s*{re.escape(key)}\s*=\s*"([^"]*)"', line)
                if m:
                    return m.group(1)
    except OSError:
        pass
    return ""


def _run_codex_readonly(prompt: str, cwd: str, timeout_sec: int = 1500) -> str:
    """codex を直接、読み取り専用で実行して、最後のメッセージを返す。

    code_agents 経由（aidiy_code_agents）は使わない。Codex は常にサンドボックス無効・全 MCP サーバー起動で動くため、
    1 呼び出しあたり約 40 プロセス・約 1.6 GB を使い、メモリ不足になる。ここでは次のとおり絞る。
      - --sandbox read-only: ファイルを変更できない
      - --ignore-user-config: config.toml の MCP サーバー（21 個）を起動しない
      - モデルと推論の強さだけ、config.toml の値を明示して引き継ぐ
    """
    codex = shutil.which("codex")
    if not codex:
        raise RuntimeError("codex コマンドが見つかりません")
    model = _codex_user_setting("model")
    effort = _codex_user_setting("model_reasoning_effort")
    with tempfile.TemporaryDirectory(prefix="aidiy_codex_review_") as tmp:
        out_path = os.path.join(tmp, "last_message.txt")
        cmd = [codex, "exec", "--skip-git-repo-check", "--ephemeral", "--ignore-user-config",
               "--sandbox", "read-only", "-C", cwd, "-o", out_path]
        if model:
            cmd += ["-m", model]
        if effort:
            cmd += ["-c", f'model_reasoning_effort="{effort}"']
        cmd.append("-")   # 指示は標準入力から渡す（コマンドラインの長さ制限を避ける）
        run = subprocess.run(cmd, input=prompt, capture_output=True, text=True, encoding="utf-8",
                             errors="replace", timeout=timeout_sec)
        answer = ""
        if os.path.isfile(out_path):
            with open(out_path, encoding="utf-8", errors="replace") as f:
                answer = f.read().strip()
    if run.returncode or not answer:
        raise RuntimeError(f"codex の実行に失敗しました（exit={run.returncode}）: {(run.stderr or run.stdout)[-400:]}")
    return answer


def _validate_reading(text: str, current_override: dict, item: dict) -> tuple[str, str] | str:
    """読み指定 1 件を検証する。戻り値は (source, reading)、または却下理由の文字列。"""
    if not isinstance(item, dict):
        return "提案が object ではありません"
    source, reading = str(item.get("source", "")), str(item.get("reading", ""))
    if len(source) < 2:
        return "source は 2 文字以上の句にする"
    if source == reading:
        return "source と reading が同じ"
    if not _READING_CHARS.fullmatch(reading) or not re.search(r"[ぁ-ゖァ-ヶ]", reading):
        return "reading の形式が不正（仮名を含む日本語のみ）"
    if len(reading) > len(source) * 4 + 10:
        return "reading が長すぎる"
    # 既存の読み指定を適用した後の文字列に source が残っていること（重なる指定を避ける）
    applied_text = text
    for old, new in current_override.items():
        applied_text = applied_text.replace(old, new)
    if source not in applied_text:
        return "source が原稿（既存の読み指定を適用後）にない、または既存の読み指定と重なる"
    return source, reading


async def review_audio_by_agent(ctx, ca: dict, script_path: str, max_rounds: int = 2, concurrency: int = 1) -> dict:
    """1 シーンごとに、原稿と音声認識を codex_cli へ渡して『読み指定』をもらい、TTS へ反映して再合成する。

    字幕（scenario.js の原稿）は変えない。codex_cli は読み取り専用で、読み指定は Python が適用する
    （複数シーンを並列に処理できる）。直した分だけ再合成し、直した箇所を再確認する（最大 max_rounds 回）。
    """
    scenario_path = os.path.join(ctx.output_dir, "scenario.js")
    audio_dir = os.path.join(ctx.output_dir, "audio")
    report_path = os.path.join(ctx.output_dir, "audio_review.json")
    tasks = audio_tasks(scenario_path)
    if not tasks:
        raise RuntimeError("音声照合対象がありません")
    if ctx.language.split("-", 1)[0].lower() != "ja":
        # 読み指定は日本語（音読み・訓読み）向け。日本語以外は照合の対象外として、その旨だけを記録する。
        report = {"mode": "skipped", "language": ctx.language, "reason": "日本語以外は音声照合の対象外",
                  "files": {name: {"verdict": "skipped"} for name in tasks},
                  "methods": [], "limits": [], "rounds": [], "regenerated": [], "unresolved": [],
                  "readings_added": []}
        with open(report_path, "w", encoding="utf-8", newline="\n") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        return report
    for name in tasks:
        path = os.path.join(audio_dir, name)
        if not os.path.isfile(path) or os.path.getsize(path) <= 500:
            raise RuntimeError(f"照合対象の MP3 がありません: {path}")

    index0 = _audio_index(scenario_path)
    with open(script_path, encoding="utf-8") as f:
        overrides = _read_overrides(f.read())
    report: dict = {"mode": "agent", "language": ctx.language, "files": {}, "methods": [], "limits": [],
                    "rounds": [], "regenerated": [], "unresolved": [], "readings_added": [],
                    "existing_overrides": json.loads(json.dumps(overrides))}
    lock = asyncio.Lock()                  # 読み指定 / MP3 / レポートの更新は 1 シーンずつ
    sem = asyncio.Semaphore(concurrency)   # 音声認識 + codex_cli の呼び出しの同時数

    def save() -> None:
        with open(report_path, "w", encoding="utf-8", newline="\n") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)

    scene_groups: dict[str, list[str]] = {}
    for name, row in index0.items():
        scene_groups.setdefault(row["scene"], []).append(name)

    async def review_scene(scene_names: list[str]) -> None:
        pending = list(scene_names)
        for round_no in range(1, max_rounds + 1):
            async with sem:
                asr: dict = {}
                try:
                    asr = await asyncio.to_thread(
                        _transcribe_windows, {n: index0[n]["text"] for n in pending}, audio_dir, ctx.language)
                except Exception as exc:
                    report["unresolved"].append({"files": pending, "round": round_no,
                                                 "reason": f"音声認識を取得できませんでした: {exc}"})
                entries = [{"name": n, **index0[n], "asr_windows": asr.get(n, [])} for n in pending]
                try:
                    answer = await asyncio.to_thread(
                        _run_codex_readonly, _agent_review_prompt(ctx, entries, round_no, overrides), ctx.output_dir)
                except Exception as exc:   # この 1 シーンだけ諦めて、他のシーンは続ける
                    async with lock:
                        report["unresolved"].append({"files": pending, "round": round_no,
                                                     "reason": f"codex_cli を実行できませんでした: {exc}"})
                        save()
                    return
            try:
                result = _extract_review_json(answer)
            except ValueError as exc:
                async with lock:
                    report["unresolved"].append({"files": pending, "round": round_no, "reason": str(exc)})
                    save()
                return

            async with lock:
                if result.get("method"):
                    report["methods"].append(str(result["method"]))
                if result.get("limits"):
                    report["limits"].append(str(result["limits"]))
                changed: list[str] = []
                before_overrides = json.loads(json.dumps(overrides))
                for row in result["files"]:
                    name = os.path.basename(str(row.get("file", "")))
                    if name not in pending:   # この呼び出しの対象外のファイルへの指定は受け付けない
                        continue
                    report["files"][name] = {"verdict": row.get("verdict", ""), "readings": row.get("readings", []),
                                             "note": row.get("note", ""), "round": round_no,
                                             "asr_windows": asr.get(name, [])}
                    current = overrides.get(name, {})
                    if not isinstance(current, dict):
                        report["unresolved"].append({"filename": name, "reason": "既存の読み指定が文字列形式のため追加できない"})
                        continue
                    for item in row.get("readings") or []:
                        checked = _validate_reading(index0[name]["text"], overrides.get(name, {}), item)
                        if isinstance(checked, str):
                            report["unresolved"].append({"filename": name, "round": round_no, "item": item, "reason": checked})
                            continue
                        source, reading = checked
                        overrides[name] = {**overrides.get(name, {}), source: reading}
                        report["readings_added"].append({"filename": name, "round": round_no, "source": source,
                                                         "reading": reading, "reason": item.get("reason", "")})
                        if name not in changed:
                            changed.append(name)
                report["rounds"].append({"files": pending, "round": round_no, "changed": changed})
                if changed:
                    # 読み指定を反映して、直した分だけ再合成（失敗したら MP3・読み指定を元へ戻す）
                    old_audio = {}
                    for n in changed:
                        with open(os.path.join(audio_dir, n), "rb") as f:
                            old_audio[n] = f.read()
                    try:
                        _write_overrides(script_path, overrides)
                        run = await asyncio.to_thread(
                            subprocess.run, [ctx.mcp_python, script_path, "--only-file", *changed],
                            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=1800)
                        if run.returncode:
                            raise RuntimeError(f"音声再合成に失敗しました: {run.stdout[-800:]} {run.stderr[-800:]}")
                        for n in changed:
                            path = os.path.join(audio_dir, n)
                            with open(path, "rb") as f:
                                new_audio = f.read()
                            if len(new_audio) <= 500 or new_audio == old_audio[n]:
                                with open(path, "wb") as f:
                                    f.write(old_audio[n])
                                report["unresolved"].append({"filename": n, "round": round_no,
                                                             "reason": "再合成されなかったため元の MP3 へ戻した"})
                            else:
                                report["regenerated"].append({"filename": n, "round": round_no})
                    except Exception:
                        for n, data in old_audio.items():
                            with open(os.path.join(audio_dir, n), "wb") as f:
                                f.write(data)
                        overrides.clear()
                        overrides.update(before_overrides)
                        _write_overrides(script_path, overrides)
                        save()
                        raise
                save()
            if not changed:
                return
            pending = changed  # 次のラウンドでは、直した分だけ再確認する
        async with lock:
            report["unresolved"].append({"files": pending,
                                         "reason": f"{max_rounds} 回確認しても指定が続いたため、最後の状態を採用"})
            save()

    outcomes = await asyncio.gather(*(review_scene(names) for names in scene_groups.values()), return_exceptions=True)
    errors = [o for o in outcomes if isinstance(o, BaseException)]
    for exc in errors:
        report["unresolved"].append({"reason": f"シーンの照合中に例外: {exc!r}"})

    for name in tasks:
        report["files"].setdefault(name, {"verdict": "unreviewed", "readings": [], "note": "", "round": 0})
    report["applied_overrides"] = overrides
    save()
    if errors:
        raise errors[0]
    return report
