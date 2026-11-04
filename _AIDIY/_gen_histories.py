# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""
全コミットの diff 内容から 1日毎の要約文を生成。
git -c core.quotepath=false で日本語ファイル名を正しく扱う。

既定では histories/ に無い日付だけを追加する（手直し済みの過去分は保持）。
--all を付けると従来どおり全日付を削除して再生成する。
"""
import subprocess, os, sys, re
from collections import defaultdict, Counter
from datetime import datetime

HISTORIES = os.path.join(os.path.dirname(__file__), "histories")
TMP = os.path.join(os.path.dirname(__file__), "_tmp_clone")
if not os.path.isdir(TMP):
    # 作業用クローンが無ければリポジトリ本体の履歴を読む
    TMP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REGENERATE_ALL = "--all" in sys.argv[1:]

# コミットメッセージが "backup" のままの節目に付ける説明（短縮SHA 7桁 → 説明）。
# Code / Live / IDE（frontend_vscode → frontend_ide）の主な実装を中心に記録する。
HIGHLIGHTS = {
    "badbc7f": "Code: VS Code チャット拡張 frontend_vscode を新規作成（aidiy_hermes 直接実行の runner と単独起動版）",
    "ec1df25": "Code: 停止制御を共通化（AIストリーム制御.py / stream-control.ts、Web・Avatar も同じ制御へ）",
    "0f66632": "Code: Provider／モデル選択をチャットパネル内ダイアログへ、Code CLI 出力の振り分け",
    "71338f5": "Code: 会話履歴（作業フォルダ別の一覧・選択・削除）と最終選択モデルの引継ぎ",
    "19c4ff7": "Code: 中断ボタン（abort.png）を追加",
    "2e63750": "Code: モデル一覧（model-catalog.py）を Hermes の Provider に追従",
    "dfc7942": "Code: Hermes セッション消失時に --resume なしで一度だけ自動再試行",
    "741bece": "Code: 単独起動を launch-standalone.mjs に統一、テストを checks/ へ再編",
    "e60338a": "Code: 単独版を Electron のフレームレス窓へ（standalone/desktop.cjs・preload.cjs）",
    "d3d5b68": "Code: Electron の取得を setup_electron.py で Avatar と共通化",
    "a5f8b1f": "Code / Live: aidiy_code・aidiy_live の 2 拡張に分割、Live 新設（WinMM マイク取込 microphone.py）、VSIX 作成",
    "b2b3bed": "Live: 非表示中も接続を保持（マイクだけ停止）、Code / Live の送信ボタン共通化",
    "dcd75e0": "Live: connect で作業フォルダを CODE_BASE_PATH として渡し、LiveAI・コードエージェントが同じプロジェクトを参照",
    "be1872f": "Live: connect にモデル設定を含めて初期化前に反映、接続前のモデル候補取得",
    "834eaa2": "Live: OpenAI Live の文字回答に対応",
    "159d019": "Code / Live: vscode_code.bat・vscode_live.bat のモデル選択起動",
    "55b13b3": "Live: 切断時の画面初期化、新しい会話で同じ設定のまま再接続",
    "39ab24a": "Code / Live: 自動スクロール追従（scroll-follow.ts）",
    "94dc6a2": "Code / Live: モデル選択を ~/.aidiy/aidiy_{code,live}_model.json に保存して拡張・単独版で共用",
    "7a011ed": "Discord: frontend_discord を新規作成（Hermes チャット + Live 音声会話の Bot）",
    "8afdfb8": "Live / Discord: Live モデルカタログを共通化",
    "3bf6329": "Live: local-backend.cjs で _config/AiDiy_key.json の PORT_CORE を自動参照",
    "41dcc28": "Code / Live: ルートの _start.py へ組込み（frontend_vscode/_start.py）",
    "48bd926": "Live: build-state.cjs でソースと生成物のハッシュを照合して起動",
    "c507361": "Code / Live / Discord: ブラウザ版・Codespaces 対応（launch-project.mjs / forwarded-origin.ts / window-size.cjs）",
    "4e4e526": "Code: AIコア接続（code-connection.ts）— 接続中はコア経由、未接続は aidiy_hermes 直接実行",
    "8ba0397": "Code: 検証ループ 0〜3 回（AIコード.py の self_check_loop）、単独窓の二重起動防止（single-instance.cjs）",
    "c12df33": "Code: オフライン時の Hermes 実行と検証0固定、オンライン／オフライン別のモデル保存",
    "5d06849": "Code: コード実行状態の管理（test_code_execution_state.py）",
    "dee71cc": "Code / Live: 発言の到着演出（arrival-effect.ts — 紙ヒコーキ・入力枠の飛行・ターミナル文字送り）",
    "79e5d7c": "IDE: frontend_ide 新設（開発スペース）— frontend_vscode を host/ へ移設、Code / Live を Vue 3 共通部品化、viewer・宇宙表示・＋Code／＋Live 別窓",
    "e46021e": "IDE: AiDiy検索と軌跡・AiDiy分析・更新履歴比較・HTML/SVG/Vue プレビュー、Code 会話履歴を _AIDIY/aidiy_code/histories へ保存",
    "f19ece3": "X自己紹介: 開発スペース（Code / Live / IDE）の特徴・実装詳細を追記、MCP Hub ×19 の表記を修正",
    "c01a65d": "履歴: 9/6〜10/12 を追加、生成スクリプトを未作成の日付だけ生成する方式へ（--all で全件再生成）",
}

def area_names(parts):
    """パスの階層から Code / Live / IDE / Discord の区分を返す。"""
    top = parts[0]
    names = set()
    if top in ("frontend_vscode", "frontend_ide"):
        if "aidiy_live" in parts:
            names.add("Live")
        elif top == "frontend_vscode" or "host" in parts[:2] or "aidiy_code" in parts:
            names.add("Code")
        else:
            names.add("IDE")
    elif top in ("frontend_discord", "frontend_channels"):
        names.add("Discord")
    return names

GIT = 'git -c core.quotepath=false'

def run(cmd, cwd=TMP):
    return subprocess.run(
        cmd, shell=True, capture_output=True, text=True, cwd=cwd,
        encoding="utf-8", errors="replace",
    )

# 全コミット取得
r = run(f'{GIT} log --reverse --format="%H|%ai|%s"')
if r.returncode != 0:
    print("ERROR:", r.stderr); sys.exit(1)

commits = []
for line in r.stdout.strip().split("\n"):
    if not line: continue
    try: sha, date_str, subject = line.split("|", 2)
    except ValueError: continue
    commits.append((sha, date_str, subject))

print(f"Total commits: {len(commits)}")

def get_files(sha):
    """1コミットの変更ファイル一覧 [(status, path), ...]"""
    r = run(f'{GIT} diff-tree --no-commit-id --name-status -r "{sha}"')
    files = []
    if r.returncode != 0: return files
    for line in r.stdout.strip().split("\n"):
        if not line: continue
        parts = line.split("\t")
        if len(parts) >= 2:
            files.append((parts[0], parts[1]))
    return files

def get_diff_head(sha, max_lines=40):
    """diff の先頭部分を取得"""
    r = run(f'{GIT} show --format="" --no-color "{sha}"')
    if r.returncode != 0: return ""
    lines = r.stdout.split("\n")[:max_lines]
    return "\n".join(lines)

# ── 1日分の要約生成 ──
def day_summary_and_changes(date_key, day_commits):
    """
    1日分の変更を分析し、(要約文, コミット詳細行リスト) を返す。
    """
    # 全日のファイルを収集
    all_files = []
    commit_details = []  # (time, sha, msg, file_list, diff_head)

    for dt, sha, subject in day_commits:
        files = get_files(sha)
        all_files.extend(files)
        diff_head = get_diff_head(sha)
        commit_details.append((dt, sha, subject, files, diff_head))

    if not all_files:
        return "（変更内容なし）", commit_details

    # ── カテゴリ集計 ──
    cat_count = Counter()
    top_dirs = Counter()
    feature_names = set()
    areas = set()

    for status, p in all_files:
        parts = p.replace("\\", "/").split("/")
        top = parts[0]
        top_dirs[top] += 1
        areas |= area_names(parts)
        # カテゴリ判定
        if top == "backend_server":
            cat_count["Backend"] += 1
            for part in parts:
                if re.match(r'^[CMTVSX]', part):
                    feature_names.add(part)
                if part == "AIコア": feature_names.add("AIコア")
        elif top == "backend_tools":
            cat_count["MCP"] += 1
            for part in parts:
                if part.startswith("mcp_"): feature_names.add(part)
        elif top == "command_hermes":
            cat_count["Hermes"] += 1
        elif top == "frontend_web":
            cat_count["Frontend Web"] += 1
            for part in parts:
                if re.match(r'^[CMTVSX]', part): feature_names.add(part)
        elif top == "frontend_avatar":
            cat_count["Frontend Avatar"] += 1
            for part in parts:
                if part in ("electron", "Electron"): feature_names.add("Electron")
                if "VRM" in part: feature_names.add("VRM")
        elif top in ("frontend_vscode", "frontend_ide"):
            cat_count["Code・Live・IDE"] += 1
        elif top in ("frontend_discord", "frontend_channels"):
            cat_count["Discord"] += 1
        elif top == ".aidiy":
            cat_count["ナレッジ"] += 1
        elif top.startswith("_"):
            cat_count["スクリプト"] += 1
            feature_names.add(top)
        elif top in ("AGENTS.md", "CLAUDE.md", "README.md", "_AIDIY.md",
                      "LICENSE", "CONTRIBUTING.md", "NOTICE.md"):
            cat_count["ドキュメント"] += 1
        elif top == "docs":
            cat_count["ドキュメント"] += 1
        elif top in (".gitignore", ".gitattributes"):
            cat_count["設定"] += 1
        elif top in ("docker", "Docker"):
            cat_count["Docker"] += 1
        else:
            cat_count["その他"] += 1

    # ── diff 内容からの意図推測 ──
    all_diffs = "\n".join(d[4] for d in commit_details if d[4])
    n_add_files = sum(1 for s, _ in all_files if s == "A")
    n_del_files = sum(1 for s, _ in all_files if s == "D")
    total_files = len(all_files)

    # 要約文の構成
    parts = []

    # 新規追加の規模
    if n_add_files >= 20:
        parts.append(f"新規ファイル大量追加（+{n_add_files}）")
    elif n_add_files >= 5:
        parts.append(f"新規ファイル追加（+{n_add_files}）")

    # 削除の規模
    if n_del_files >= 20:
        parts.append(f"ファイル大量削除（-{n_del_files}）")
    elif n_del_files >= 5:
        parts.append(f"不要ファイル削除（-{n_del_files}）")

    # モジュール名から機能を推測
    if feature_names:
        f_list = sorted(feature_names)
        kw = "、".join(f_list[:3])
        if len(f_list) > 3: kw += "など"
        parts.append(f"{kw}を修正")

    # 主要カテゴリ
    top_cats = [c for c, _ in cat_count.most_common(2)]
    if not feature_names:
        parts.append(f"{'・'.join(top_cats)}の更新")

    # diff 内容からキーワード検出
    diff_keywords = []
    for kw, label in [
        ("WebSocket", "WebSocket"), ("websocket", "WebSocket"),
        ("JWT", "JWT"), ("jwt", "JWT"), ("認証", "認証"),
        ("VRM", "VRM"), ("Three.js", "Three.js"),
        ("Electron", "Electron"), ("electron", "Electron"),
        ("ffmpeg", "ffmpeg"), ("FFmpeg", "ffmpeg"),
        ("OBS", "OBS"), ("obs", "OBS"),
        ("TTS", "TTS"), ("tts", "TTS"),
        ("Monaco", "Monaco Editor"), ("monaco", "Monaco Editor"),
        ("proxy", "proxy"), ("Proxy", "proxy"),
        ("Docker", "Docker"), ("docker", "Docker"),
        ("nginx", "nginx"), ("Nginx", "Nginx"),
        ("sqlite", "SQLite"), ("SQLite", "SQLite"),
        ("PostgreSQL", "PostgreSQL"), ("postgres", "PostgreSQL"),
        ("uvicorn", "uvicorn"), ("FastAPI", "FastAPI"),
    ]:
        if kw in all_diffs:
            diff_keywords.append(label)
    if diff_keywords:
        unique = list(dict.fromkeys(diff_keywords))[:3]
        parts.append("・".join(unique) + "周りの変更")

    if not parts:
        parts.append(f"{'・'.join(top_cats)}の軽微な更新")

    summary = "、".join(parts[:3])
    if total_files >= 50:
        summary = "全体整備：" + summary
    if areas:
        order = ["Code", "Live", "IDE", "Discord"]
        summary = "【" + "・".join(a for a in order if a in areas) + "】" + summary
    summary += f"（{total_files}ファイル）"

    return summary, commit_details

# ── 実行 ──
by_date = defaultdict(list)
for sha, date_str, subject in commits:
    dt = datetime.fromisoformat(date_str)
    date_key = dt.strftime("%Y%m%d")
    by_date[date_key].append((dt, sha, subject))

# --all のときだけ既存ファイルを削除して全件再生成
if REGENERATE_ALL:
    for f in os.listdir(HISTORIES):
        if f.endswith(".md"):
            os.remove(os.path.join(HISTORIES, f))
targets = [d for d in sorted(by_date)
           if REGENERATE_ALL or not os.path.exists(os.path.join(HISTORIES, f"{d}.md"))]

# 日付ごとに生成
for i, date_key in enumerate(targets):
    items = by_date[date_key]
    summary, cds = day_summary_and_changes(date_key, items)

    lines = []
    lines.append(f"# {date_key[:4]}-{date_key[4:6]}-{date_key[6:8]}")
    lines.append("")
    lines.append(f"> {summary}")
    lines.append("")

    for dt, sha, msg, files, _ in cds:
        short = sha[:7]
        time_str = dt.strftime("%H:%M")
        prefix = f"- [{time_str}] `{short}`"

        # コミットメッセージ（"backup" 以外は表示）
        if msg and msg != "backup":
            prefix += f" **{msg}**"
        elif short in HIGHLIGHTS:
            prefix += f" **{HIGHLIGHTS[short]}**"

        if not files:
            lines.append(prefix)
            continue

        # ファイル名を整形（ディレクトリ階層を簡略化）
        simplified = []
        for st, p in files[:12]:
            base = os.path.basename(p)
            if st == "A": base = f"+{base}"
            elif st == "D": base = f"-{base}"
            simplified.append(base)
        detail = ", ".join(simplified)
        if len(files) > 12:
            detail += f" 他{len(files)-12}件"
        lines.append(f"{prefix} — {detail}")

    lines.append("")
    path = os.path.join(HISTORIES, f"{date_key}.md")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    if (i+1) % 15 == 0:
        print(f"  {i+1}/{len(targets)} done...")

print(f"\nDone: {len(targets)} files -> _AIDIY/histories/")
