# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""コマンド(hermes) 移植検証スクリプト

upstream `hermes-agent` の新版を `command_hermes` へ取り込んだあと、
取り込み漏れと AiDiy レイヤの再適用漏れを機械的に検出します。

手順の全体は `_AIDIY/knowledge/command_hermes,upstream移植手順.md` を参照。

使い方::

    .venv/Scripts/python.exe _verify.py
    .venv/Scripts/python.exe _verify.py --upstream ../hermes-agent-0.31
    .venv/Scripts/python.exe _verify.py --full      # LLM 疎通まで行う

終了コード: 0 = 全項目 OK / 1 = NG あり
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path

THIS_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = THIS_DIR.parent

# upstream ツリーの探索順（--upstream 未指定時）
UPSTREAM_GLOBS = ("hermes-agent-*", "hermes_agent-*")

# upstream をそのまま持ち込むディレクトリ。左が upstream 側、右が command_hermes 側。
MIRRORED_DIRS = [
    ("agent", "core"),
    ("tools", "tools"),
    ("hermes_cli", "hermes_cli"),
    ("gateway", "gateway"),
    ("plugins", "plugins"),
    ("cron", "cron"),
    ("acp_adapter", "acp_adapter"),
    ("tui_gateway", "tui_gateway"),
    ("providers", "providers"),
    ("skills", "skills"),
    ("optional-skills", "optional-skills"),
    ("optional-mcps", "optional-mcps"),
    ("locales", "locales"),
    ("native", "native"),
    ("assets", "assets"),
    ("scripts", "scripts"),
]

# 意図的に持ち込まないもの（実行時に参照されないことを確認済み）
EXCLUDED_DIRS = {
    "ui-tui", "web", "website", "evals", "tests", "tests-js", "docker", "nix",
    "docs", "contributors", "mcp-research-data", "datagen-config-examples",
    "apps", ".github",
}
# upstream ルート直下の .py で base/ へ置かないもの（wheel ビルド用ガード）
EXCLUDED_ROOT_PY = {"cli.py", "setup.py"}

SKIP_PARTS = {".venv", "__pycache__", "temp", ".git", "node_modules", ".pytest_cache"}

# AiDiy レイヤの再適用チェック。ファイル → そこに必ず残っているべき目印。
AIDIY_LAYER = {
    "core/prompt_builder.py": ["AIDIY_RUNTIME_IDENTITY", "AiDiy_hermes"],
    "core/system_prompt.py": ["stable_parts.append(AIDIY_RUNTIME_IDENTITY)"],
    "hermes_cli/default_soul.py": ["AiDiy_hermes", "_UPSTREAM_DEFAULT_SOUL_MD"],
    "SOUL.md": ["AiDiy Hermes", "AiDiy development team", "aidiy_hermes"],
    "cli_main.py": [
        'sys.modules["agent"] = _agent_package',      # layout shim
        '_sys.modules.setdefault("cli"',              # cli エイリアス
        "_AIDIY_KEY_JSON",                            # AiDiy_key.json 参照
        "_AIDIY_CLI_PROVIDERS",                       # 外部 CLI provider 定義
        "_AIDIY_RESPONSE_LABEL",                      # 応答ボックスのラベル
        "_AIDIY_WELCOME_TEXT",                        # Welcome 文言
        "_OPENAI_OAUTH_SLUG",                         # OpenAI サブスク provider
        "def _dispatch_aidiy_cli_subprocess",         # 外部 CLI ディスパッチ
        "def _handle_aidiy_model_command",            # /model フック
        "def _ensure_openai_oauth_auth",              # OAuth 自動ログイン
        "def _model_picker_entry_label",              # ピッカーのタプル対応
        '_os.environ["HERMES_HOME"]',                 # HERMES_HOME 固定
        "def cli_entry",                              # argparse エントリ
        "class _OneShotStderrProgress",              # one-shot の stderr 進捗
        "from tools.skills_sync import sync_skills",  # バンドルスキル同期
        "from tools.mcp_tool import discover_mcp_tools",  # MCP discovery
    ],
    "hermes_main.py": [
        'sys.modules["agent"] = _agent_package',
        '_os.environ["HERMES_HOME"]',
    ],
    "base/hermes_constants.py": ["_INSTALL_ROOT = Path(__file__).resolve().parent.parent"],
    "tools/mcp_tool.py": [
        "def _load_aidiy_mcp_servers",
        'str(cfg.get("type", "")).lower() == "sse"',   # バナーの transport 表示
    ],
    "hermes_cli/tools_config.py": ["_load_aidiy_mcp_servers"],  # toolset 解決へ合流
    "tools/daemon_pool.py": ['getattr(self, "_create_worker_context", None)'],
    "hermes_cli/main.py": ["Node/TypeScript TUI"],
    "hermes_cli/auth.py": ["device_url_with_code"],
    "hermes_cli/banner.py": [
        "AiDiy branding", 'base = f"AiDiy Hermes v',
        "_has_aidiy_mcp",                             # バナーの MCP セクション
    ],
    "hermes_cli/_startup_fast.py": ['print(f"AiDiy Hermes v'],
    "hermes_cli/_parser.py": ["AiDiy Python TUI build"],
    "acp_adapter/server.py": ['return f"AiDiy Hermes v'],
}

# AiDiy 専用ファイル（upstream には対応物が無い）
AIDIY_OWNED = [
    "_setup.py", "_start.py", "_cleanup.py", "_verify.py",
    "hermes_main.py", "aidiy_hermes_exec.bat", "aidiy_hermes_logo.txt",
    "AGENTS.md", "NOTICE.md", "pyproject.toml", "base/__init__.py",
]


class C:
    OK = "\033[92m"
    NG = "\033[91m"
    WARN = "\033[93m"
    HEAD = "\033[97m"
    DIM = "\033[90m"
    END = "\033[0m"


_failures: list[str] = []
_warnings: list[str] = []


def head(msg: str) -> None:
    print(f"\n{C.HEAD}{'=' * 62}{C.END}")
    print(f"{C.HEAD}{msg}{C.END}")
    print(f"{C.HEAD}{'=' * 62}{C.END}")


def ok(msg: str) -> None:
    print(f"{C.OK}[OK]{C.END} {msg}")


def ng(msg: str) -> None:
    print(f"{C.NG}[NG]{C.END} {msg}")
    _failures.append(msg)


def warn(msg: str) -> None:
    print(f"{C.WARN}[--]{C.END} {msg}")
    _warnings.append(msg)


def info(msg: str) -> None:
    print(f"{C.DIM}     {msg}{C.END}")


# ============================================================
# 1. upstream との網羅性
# ============================================================

def _rel_files(root: Path) -> set:
    if not root.exists():
        return set()
    return {
        str(p.relative_to(root)).replace("\\", "/")
        for p in root.rglob("*")
        if p.is_file() and not any(x in p.parts for x in SKIP_PARTS)
    }


def find_upstream(explicit: str | None) -> Path | None:
    if explicit:
        p = Path(explicit).expanduser().resolve()
        return p if p.is_dir() else None
    found = []
    for pattern in UPSTREAM_GLOBS:
        found.extend(d for d in PROJECT_ROOT.glob(pattern) if d.is_dir())
    if not found:
        return None
    # バージョン番号の大きい方を優先（名前順で十分）
    return sorted(found)[-1]


def check_coverage(upstream: Path) -> None:
    head(f"1. upstream との網羅性  ({upstream.name})")

    for up_name, ch_name in MIRRORED_DIRS:
        u = _rel_files(upstream / up_name)
        c = _rel_files(THIS_DIR / ch_name)
        if not u:
            info(f"{up_name}: upstream に存在しない（スキップ）")
            continue
        missing = u - c
        if missing:
            ng(f"{up_name} -> {ch_name}: {len(missing)}/{len(u)} 件が未移植")
            for m in sorted(missing)[:5]:
                info(f"欠: {m}")
            if len(missing) > 5:
                info(f"... 他 {len(missing) - 5} 件")
        else:
            ok(f"{up_name} -> {ch_name}: {len(u)} 件すべて移植済み")

    # ルート直下の .py -> base/
    u = {p.name for p in upstream.glob("*.py")} - EXCLUDED_ROOT_PY
    c = {p.name for p in (THIS_DIR / "base").glob("*.py")}
    missing = u - c
    if missing:
        ng(f"ルート *.py -> base/: 未移植 {sorted(missing)}")
    else:
        ok(f"ルート *.py -> base/: {len(u)} 件すべて移植済み")

    # upstream に増えた新規トップレベルディレクトリの検知
    known = {n for n, _ in MIRRORED_DIRS} | EXCLUDED_DIRS
    new_dirs = [
        d.name for d in upstream.iterdir()
        if d.is_dir() and not d.name.startswith(".") and d.name not in known
    ]
    if new_dirs:
        warn(f"upstream に未分類のディレクトリ: {new_dirs}")
        info("移植要否を判断し、MIRRORED_DIRS か EXCLUDED_DIRS へ追記してください")
    else:
        ok("upstream のトップレベル構成に未分類の追加なし")


# ============================================================
# 2. AiDiy レイヤの再適用
# ============================================================

def check_aidiy_layer() -> None:
    head("2. AiDiy レイヤの再適用")

    for rel, markers in AIDIY_LAYER.items():
        path = THIS_DIR / rel
        if not path.is_file():
            ng(f"{rel}: ファイルが存在しない")
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        lost = [m for m in markers if m not in text]
        if lost:
            ng(f"{rel}: パッチ {len(lost)}/{len(markers)} 件が失われている")
            for m in lost:
                info(f"欠: {m}")
        else:
            ok(f"{rel}: パッチ {len(markers)} 件すべて健在")

    missing_owned = [f for f in AIDIY_OWNED if not (THIS_DIR / f).exists()]
    if missing_owned:
        ng(f"AiDiy 専用ファイルが不足: {missing_owned}")
    else:
        ok(f"AiDiy 専用ファイル {len(AIDIY_OWNED)} 件すべて存在")


# ============================================================
# 3. import 全数
# ============================================================

# POSIX 専用など、Windows で import できなくて正常なもの
IMPORT_ALLOWED_FAILURES = {"hermes_cli.pty_bridge"}


def check_imports() -> None:
    head("3. モジュール import（全数）")

    code = r'''
import sys, importlib, warnings, json
from pathlib import Path
warnings.filterwarnings("ignore")
root = Path(__file__).resolve().parent if "__file__" in dir() else Path.cwd()
root = Path(r"%ROOT%")
sys.path.insert(0, str(root / "base")); sys.path.insert(0, str(root))
import core as _c; sys.modules["agent"] = _c
mods = []
for d, pkg in (("core", "agent"), ("tools", "tools"), ("hermes_cli", "hermes_cli")):
    for f in sorted((root / d).glob("*.py")):
        if f.stem != "__init__":
            mods.append(f"{pkg}.{f.stem}")
for f in sorted((root / "base").glob("*.py")):
    if f.stem != "__init__":
        mods.append(f.stem)
fails = {}
for m in mods:
    try:
        importlib.import_module(m)
    except BaseException as e:
        fails[m] = f"{type(e).__name__}: {e}"
print(json.dumps({"tried": len(mods), "fails": fails}))
'''.replace("%ROOT%", str(THIS_DIR))

    res = _run_python(code, timeout=900)
    if res is None:
        ng("import テストを実行できませんでした")
        return
    tried = res.get("tried", 0)
    fails = res.get("fails", {})
    unexpected = {k: v for k, v in fails.items() if k not in IMPORT_ALLOWED_FAILURES}
    if unexpected:
        ng(f"import 失敗 {len(unexpected)} 件 / {tried} モジュール")
        for m, e in list(unexpected.items())[:10]:
            info(f"{m}: {e}")
    else:
        ok(f"{tried} モジュールすべて import 可（想定内の失敗 {len(fails)} 件を除く）")


# ============================================================
# 4. ランタイム資産（スキル / MCP / ツール）
# ============================================================

def check_runtime_assets() -> None:
    head("4. ランタイム資産（スキル / MCP カタログ / ツール）")

    code = r'''
import sys, json
from pathlib import Path
root = Path(r"%ROOT%")
sys.path.insert(0, str(root / "base")); sys.path.insert(0, str(root))
import core as _c; sys.modules["agent"] = _c
out = {}
try:
    from tools.skills_sync import sync_skills
    sync_skills(quiet=True)
    from tools.skills_tool import skills_list
    out["skills"] = len(json.loads(skills_list()).get("skills") or [])
except Exception as e:
    out["skills_error"] = f"{type(e).__name__}: {e}"
try:
    from hermes_cli.mcp_catalog import list_catalog
    out["mcp_catalog"] = len(list_catalog())
except Exception as e:
    out["mcp_catalog_error"] = f"{type(e).__name__}: {e}"
try:
    from tools.mcp_tool import _load_aidiy_mcp_servers
    out["aidiy_mcp_servers"] = len(_load_aidiy_mcp_servers())
except Exception as e:
    out["aidiy_mcp_error"] = f"{type(e).__name__}: {e}"
try:
    from tools.environments.local import _find_shell
    out["shell"] = _find_shell()
except Exception as e:
    out["shell_error"] = f"{type(e).__name__}: {e}"
try:
    from tools.terminal_tool import terminal_tool
    r = json.loads(terminal_tool(command="echo hermes-verify"))
    out["terminal_ok"] = r.get("exit_code") == 0 and "hermes-verify" in (r.get("output") or "")
except Exception as e:
    out["terminal_error"] = f"{type(e).__name__}: {e}"
try:
    from tools.file_tools import read_file_tool
    r = json.loads(read_file_tool("pyproject.toml", limit=3))
    out["read_file_ok"] = bool(r.get("content"))
except Exception as e:
    out["read_file_error"] = f"{type(e).__name__}: {e}"
print(json.dumps(out))
'''.replace("%ROOT%", str(THIS_DIR))

    res = _run_python(code, timeout=600)
    if res is None:
        ng("ランタイム資産チェックを実行できませんでした")
        return

    n = res.get("skills")
    (ok if n else ng)(f"スキル: {n} 件（0 なら sync_skills() の呼び出し漏れ）")
    n = res.get("mcp_catalog")
    (ok if n else ng)(f"MCP カタログ (optional-mcps): {n} 件")
    n = res.get("aidiy_mcp_servers")
    (ok if n else warn)(f"AiDiy MCP サーバー (AiDiy_mcp.json): {n} 件")
    shell = res.get("shell")
    (ok if shell else ng)(f"シェル: {shell or res.get('shell_error')}")
    (ok if res.get("terminal_ok") else ng)(
        f"terminal ツール: {'動作' if res.get('terminal_ok') else res.get('terminal_error', '失敗')}")
    (ok if res.get("read_file_ok") else ng)(
        f"read_file ツール: {'動作' if res.get('read_file_ok') else res.get('read_file_error', '失敗')}")


# ============================================================
# 5. CLI スモーク
# ============================================================

def check_cli(full: bool) -> None:
    head("5. CLI スモーク")
    py = _venv_python()
    if py is None:
        ng(".venv が見つかりません（_setup.py を実行してください）")
        return

    out = _run_cli(py, ["--version"], timeout=180)
    if out and "aidiy_hermes v" in out:
        ok(f"--version: {out.strip().splitlines()[-1]}")
    else:
        ng(f"--version が想定外: {out!r}")

    out = _run_cli(py, ["--list-tools"], timeout=300)
    if out and "Total:" in out:
        ok("--list-tools: " + [l for l in out.splitlines() if "Total:" in l][-1].strip())
    else:
        ng("--list-tools が失敗")

    if not full:
        info("LLM 疎通は --full 指定時のみ実行します")
        return

    out = _run_cli(py, ["-Q", "-z", "1+1は? 数字だけ答えて"], timeout=500)
    if out and out.strip():
        ok(f"-Q -z 単発クエリ: {out.strip().splitlines()[-1]!r}")
    else:
        ng("-Q -z 単発クエリが失敗（provider 設定 / 認証を確認）")


# ============================================================
# ヘルパー
# ============================================================

def _venv_python() -> Path | None:
    for rel in ("Scripts/python.exe", "bin/python"):
        p = THIS_DIR / ".venv" / rel
        if p.is_file():
            return p
    return None


def _run_python(code: str, timeout: int):
    py = _venv_python()
    if py is None:
        return None
    try:
        proc = subprocess.run(
            [str(py), "-c", code], cwd=str(THIS_DIR),
            capture_output=True, text=True, encoding="utf-8",
            errors="replace", timeout=timeout,
        )
    except Exception as exc:
        info(f"実行失敗: {exc}")
        return None
    for line in reversed((proc.stdout or "").splitlines()):
        line = line.strip()
        if line.startswith("{") and line.endswith("}"):
            try:
                return json.loads(line)
            except Exception:
                continue
    info(f"出力を解釈できません: {(proc.stdout or proc.stderr or '')[-300:]}")
    return None


def _run_cli(py: Path, args: list, timeout: int) -> str:
    try:
        proc = subprocess.run(
            [str(py), str(THIS_DIR / "cli_main.py"), *args], cwd=str(THIS_DIR),
            capture_output=True, text=True, encoding="utf-8",
            errors="replace", timeout=timeout,
        )
        return proc.stdout or ""
    except Exception as exc:
        info(f"実行失敗: {exc}")
        return ""


# ============================================================
# main
# ============================================================

def main() -> int:
    parser = argparse.ArgumentParser(
        prog="_verify.py",
        description="command_hermes の upstream 移植を検証する",
    )
    parser.add_argument("--upstream", default=None,
                        help="upstream hermes-agent のパス（省略時は ../hermes-agent-* を自動検出）")
    parser.add_argument("--full", action="store_true",
                        help="LLM 疎通テストまで実行する")
    parser.add_argument("--skip-coverage", action="store_true",
                        help="upstream との網羅性比較を省く")
    args = parser.parse_args()

    print(f"{C.HEAD}command_hermes 移植検証{C.END}")
    print(f"  対象: {THIS_DIR}")

    if not args.skip_coverage:
        upstream = find_upstream(args.upstream)
        if upstream is None:
            warn("upstream ツリーが見つからないため網羅性比較をスキップします")
            info("--upstream <path> で明示するか、プロジェクト直下に hermes-agent-* を置いてください")
        else:
            check_coverage(upstream)

    check_aidiy_layer()
    check_imports()
    check_runtime_assets()
    check_cli(args.full)

    head("結果")
    if _failures:
        print(f"{C.NG}NG {len(_failures)} 件{C.END}")
        for f in _failures:
            print(f"  - {f}")
    if _warnings:
        print(f"{C.WARN}要確認 {len(_warnings)} 件{C.END}")
        for w in _warnings:
            print(f"  - {w}")
    if not _failures:
        print(f"{C.OK}すべての検証項目を通過しました{C.END}")
    return 1 if _failures else 0


if __name__ == "__main__":
    sys.exit(main())
