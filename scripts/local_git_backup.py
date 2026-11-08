# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""AiDiy 専用 .git_local にだけバックアップ時の変更を記録する。"""
from __future__ import annotations
import os
import importlib.util
from contextlib import contextmanager
from fnmatch import fnmatchcase
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile
import threading
from collections import deque


_PENDING_LOCK = threading.Lock()
_PENDING = {}


def _load_setup_module():
    spec = importlib.util.spec_from_file_location("aidiy_local_git_setup", Path(__file__).with_name("local_git_setup.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def queue_local_backup(base_dir, files, *, logger, **exclusions):
    """コピーとは独立して記録する。同一対象は一つの専用 worker で受付順に実行。"""
    try:
        root = Path(base_dir).resolve()
        # .git のファイル/ディレクトリ/壊れたリンク、親の管理も worker 起動前に保護。
        if _load_setup_module().has_existing_git_management(root):
            return False
        key = os.path.normcase(str(root))
        job = (tuple(files), {name: tuple(value) for name, value in exclusions.items()}, logger)
        with _PENDING_LOCK:
            pending = _PENDING.get(key)
            if pending is not None:
                pending.append(job)
                return True
            pending = deque([job])
            _PENDING[key] = pending

            def run():
                while True:
                    with _PENDING_LOCK:
                        if not pending:
                            del _PENDING[key]
                            return
                        paths, options, log = pending.popleft()
                    try:
                        # 受付後に .git が現れた場合も .git_local を作成/更新しない。
                        if _load_setup_module().has_existing_git_management(root):
                            continue
                        state, detail = commit_local_backup(root, paths, **options)
                        if state == "error":
                            log.warning(detail)
                        elif state == "created":
                            log.info("ローカル Git 変更記録を作成しました。")
                    except Exception:
                        log.exception("ローカル Git 記録に失敗しました。ファイルバックアップには影響しません。")

            try:
                thread = threading.Thread(target=run, name="AiDiy-backup-git", daemon=False)
                thread.start()
            except Exception:
                del _PENDING[key]
                raise
        return True
    except Exception:
        logger.exception("ローカル Git 記録スレッドを開始できませんでした。ファイルバックアップを継続します。")
        return False


@contextmanager
def _index_lock(metadata):
    lock = metadata / "index.lock"
    descriptor = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:
        os.close(descriptor)
        yield
    finally:
        lock.unlink(missing_ok=True)


def commit_local_backup(base_dir, files, *, excluded_dirs=(), excluded_files=(), excluded_suffixes=(), excluded_pairs=()):
    """戻り値は (created/unchanged/skipped/error, 説明)。外部通信はしない。未管理時の初期化は setup と共通。"""
    root = Path(base_dir).resolve()
    metadata = root / ".git_local"
    git = shutil.which("git")
    if not git or not root.is_dir():
        return "skipped", ""
    try:
        module = _load_setup_module()
        # .git_local の有無に関わらず、既存 .git / 親の管理環境を最優先する。
        if module.has_existing_git_management(root):
            return "skipped", ""
        if not os.path.lexists(metadata):
            state, detail = module.ensure_local_git(root)
            if state == "error":
                return "error", detail
            if state != "created":
                return "skipped", ""
    except (OSError, RuntimeError, ImportError):
        return "error", "ローカル Git の初期化処理を利用できません。"
    if not metadata.is_dir():
        return "error", "ローカル Git の管理情報が不完全なため記録しません。"
    if metadata.is_symlink() or getattr(metadata, "is_junction", lambda: False)():
        return "error", "ローカル Git の管理先がリンクのため記録しません。"
    try:
        # 外部worktree、共有object、リンク経由の管理情報は対象外。
        if any((metadata / name).exists() for name in ("commondir", "objects/info/alternates")):
            return "error", "共有 Git 管理情報は記録対象外です。"
        for current, dirs, names in os.walk(metadata):
            if any((Path(current) / name).is_symlink() or getattr(Path(current) / name, "is_junction", lambda: False)() for name in dirs + names):
                return "error", "リンクを含む Git 管理情報は記録対象外です。"
        env = {k: v for k, v in os.environ.items() if not k.upper().startswith("GIT_")}
        env.update(GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL=os.devnull, GIT_TERMINAL_PROMPT="0", GIT_NO_REPLACE_OBJECTS="1", LC_ALL="C")
        prefix = [git, "--git-dir=" + str(metadata), "--work-tree=" + str(root), "-c", "core.hooksPath=" + os.devnull, "-c", "gc.auto=0", "-c", "maintenance.auto=false"]
        def run(*args, input=None, check=True):
            result = subprocess.run(prefix + list(args), cwd=root, env=env, input=input,
                                    capture_output=True, timeout=60)
            if check and result.returncode:
                raise RuntimeError("Git command failed")
            return result
        if run("rev-parse", "--is-bare-repository").stdout.strip() != b"false":
            return "error", "作業フォルダのない Git は記録対象外です。"
        configured = run("config", "--local", "--get", "core.worktree", check=False)
        if configured.returncode == 0 and (metadata / os.fsdecode(configured.stdout.strip())).resolve() != root:
            return "error", "Git の作業フォルダが一致しません。"
        branch = run("symbolic-ref", "-q", "HEAD", check=False)
        if branch.returncode or not branch.stdout.startswith(b"refs/heads/"):
            return "error", "通常ブランチ以外は自動記録しません。"
        old = run("rev-parse", "--verify", "HEAD", check=False)
        old_sha = old.stdout.strip().decode() if old.returncode == 0 else None
        if old.returncode and run("show-ref", check=False).returncode not in (1,):
            return "error", "Git の履歴状態を確認できません。"
        dirs = set(excluded_dirs) | {".git", ".git_local", ".aidiy_backup", ".backup_local", ".aidiy_cache", "_config", ".env", ".ssh"}
        names = set(excluded_files) | {".git", ".gitignore", ".env", "aidiy_key.json"}
        suffixes = tuple(excluded_suffixes) + (".db", ".sqlite", ".sqlite3", ".pem", ".key")
        candidates = []
        for name in files:
            path = Path(name)
            if path.is_absolute() or ".." in path.parts or not path.parts:
                continue
            if any(part in dirs for part in path.parts[:-1]) or path.name in names or path.name.startswith(".env.") or path.name.endswith(suffixes):
                continue
            # バックアップ元と同じディレクトリパターン。末尾の通常ファイル名は判定しない。
            folder_parts = path.parts[:-1]
            if any(fnmatchcase(parent, parent_pattern) and fnmatchcase(child, child_pattern)
                   for parent, child in zip(folder_parts, folder_parts[1:])
                   for parent_pattern, child_pattern in excluded_pairs):
                continue
            actual = root / path
            if any(p.is_symlink() or getattr(p, "is_junction", lambda: False)() for p in (actual, *list(actual.parents)[:len(path.parts)-1])) or not actual.is_file():
                continue
            candidates.append(path.as_posix())
        candidates = sorted(set(candidates))
        if candidates:
            ignored = run("check-ignore", "--no-index", "-z", "--stdin", input=b"\0".join(os.fsencode(p) for p in candidates) + b"\0", check=False)
            if ignored.returncode not in (0, 1):
                raise RuntimeError("ignore check failed")
            excluded = {os.fsdecode(p) for p in ignored.stdout.split(b"\0") if p}
            candidates = [p for p in candidates if p not in excluded]
        # ファイル確認中に既存 Git 環境へ変わった場合も書き込まない。
        if module.has_existing_git_management(root):
            return "skipped", ""
        # 一時 index で記録を組み立て、利用者の通常 .git は一切参照しない。
        with _index_lock(metadata), tempfile.TemporaryDirectory(prefix="aidiy-backup-", dir=metadata) as temporary:
            staged = run("diff", "--cached", "--quiet", "--no-ext-diff", "--no-textconv", check=False)
            if staged.returncode != 0:
                return "error", "ステージ済みの変更を保護するためローカル Git 自動記録をスキップします。"
            env["GIT_INDEX_FILE"] = str(Path(temporary) / "index")
            run("read-tree", "--empty")
            entries = []
            for start in range(0, len(candidates), 128):
                batch = candidates[start:start+128]
                hashes = run("hash-object", "-w", "--no-filters", "--", *batch).stdout.splitlines()
                if len(hashes) != len(batch):
                    raise RuntimeError("file hash count mismatch")
                for name, digest in zip(batch, hashes):
                    mode = b"100755" if os.name != "nt" and (root / name).stat().st_mode & stat.S_IXUSR else b"100644"
                    entries.append(mode + b" " + digest + b"\t" + os.fsencode(name) + b"\0")
            if entries:
                run("update-index", "-z", "--index-info", input=b"".join(entries))
            tree = run("write-tree").stdout.strip().decode()
            previous_tree = run("rev-parse", "HEAD^{tree}").stdout.strip().decode() if old_sha else None
            if tree == previous_tree or (not old_sha and not candidates):
                return "unchanged", ""
            # 利用者の個人情報を補完せず、このコマンドだけでアプリ用識別子を使用。
            identity_name = run("config", "--local", "--get", "user.name", check=False).stdout.strip().decode("utf-8", "replace") or "AiDiy Local Backup"
            identity_email = run("config", "--local", "--get", "user.email", check=False).stdout.strip().decode("utf-8", "replace") or "aidiy-local@localhost"
            env.update(GIT_AUTHOR_NAME=identity_name, GIT_AUTHOR_EMAIL=identity_email,
                       GIT_COMMITTER_NAME=identity_name, GIT_COMMITTER_EMAIL=identity_email)
            args = ["commit-tree", tree]
            if old_sha:
                args += ["-p", old_sha]
            commit = run(*args, input=b"AiDiy local backup\n").stdout.strip().decode()
            run("update-ref", branch.stdout.strip().decode(), commit, old_sha or "0" * len(commit))
            # 専用 index を今回の記録に合わせる。通常 .git/index は触らない。
            os.replace(env["GIT_INDEX_FILE"], metadata / "index")
            return "created", commit
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):
        return "error", "ローカル Git 記録に失敗しました。通常バックアップは継続します。"
