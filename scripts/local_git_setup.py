# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""未管理の作業フォルダだけに、外部接続のないローカル Git を用意する。"""
from __future__ import annotations

import os
from pathlib import Path
import shutil
import subprocess


def has_existing_git_management(root: Path) -> bool:
    """明示的な Git 環境や .git は、壊れた情報も含めて利用者の管理として保護。"""
    if any(key.upper() in {"GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR"}
           for key in os.environ):
        return True
    return any(os.path.lexists(directory / ".git") or
               all(os.path.lexists(directory / name) for name in ("HEAD", "objects", "refs"))
               for directory in (root, *root.parents))


def ensure_local_git(base_dir: Path) -> tuple[str, str]:
    """既存 Git 管理情報は変更しない。初回 add / commit / remote 設定も行わない。"""
    root = Path(base_dir).resolve(strict=True)
    if not root.is_dir():
        return "error", "Git: 対象がフォルダではありません。"
    # .git はディレクトリだけでなく worktree/submodule のファイルも有効。
    # 壊れたポインタやリンクも再初期化せず、利用者の管理情報を保護する。
    if has_existing_git_management(root):
        return "existing", "Git: 既存の管理環境があるため操作しません。"
    metadata = root / ".git_local"
    if os.path.lexists(metadata):
        return "skipped", "Git: .git_local が既にあるため変更しません。"
    git = shutil.which("git")
    if not git:
        return "skipped", "Git: 未導入のためローカル管理をスキップします。"
    # 呼び出し元の GIT_DIR / WORK_TREE / INDEX_FILE / CONFIG_* 等で別の
    # リポジトリに作用しないよう、この処理の子プロセスだけから除く。
    env = {key: value for key, value in os.environ.items() if not key.upper().startswith("GIT_")}

    def run(*args: str):
        return subprocess.run([git, "-C", str(root), *args], env=env,
                              capture_output=True, text=True, encoding="utf-8",
                              errors="replace", timeout=30, check=False)

    try:
        # 所有権エラー等を「未管理」と誤認しない。英語固定で判定する。
        # ファイルによる検出に加えて Git 自身の探索も確認する。
        env["LC_ALL"] = "C"
        probe = run("rev-parse", "--git-dir")
        if probe.returncode == 0:
            return "existing", "Git: 既存の管理環境を維持します。"
        if "not a git repository" not in probe.stderr.lower():
            return "error", "Git: 管理状態を確認できないため初期化しません。"
        # 探索中に別プロセスが管理情報を作成した場合も初期化しない。
        if has_existing_git_management(root):
            return "existing", "Git: 既存の管理環境があるため操作しません。"
        # テンプレートの独自フックを持ち込まず、空の履歴だけを作る。
        result = run(f"--git-dir={metadata}", f"--work-tree={root}",
                     "init", "--template=", "--initial-branch=main")
        if result.returncode != 0:
            return "error", "Git: ローカル管理の初期化に失敗しました（既存情報は削除しません）。"
        # .git ポインタは作らない。専用管理情報だけを明示して操作する。
        # 作業フォルダの移動後も使えるよう、管理ディレクトリからの相対参照。
        result = run(f"--git-dir={metadata}", "config", "--local", "core.worktree", "..")
        if result.returncode != 0:
            return "error", "Git: ローカル管理の設定に失敗しました（既存情報は削除しません）。"
        exclude = metadata / "info" / "exclude"
        exclude.parent.mkdir(parents=True, exist_ok=True)
        with exclude.open("a", encoding="utf-8") as stream:
            stream.write("\n# AiDiy local Git metadata, backup storage and ignore definitions\n/.git_local/\n.aidiy_backup/\n.backup_local/\n.aidiy_cache/\n.gitignore\n")
        return "created", "Git: .git_local を作成しました（ローカル履歴専用・未コミット）。"
    except (OSError, subprocess.SubprocessError):
        return "error", "Git: ローカル管理を準備できませんでした（既存情報は削除しません）。"
