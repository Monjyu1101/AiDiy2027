# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""
コードチェックモジュール

AIエージェントの自己検証用に、以下を subprocess 経由で実行する:

- Python 単一ファイルの構文チェック（py_compile）
- Python プロジェクト全体の ruff check（任意）
- frontend_web / frontend_avatar の TypeScript 型チェック（npm run type-check）

どれも副作用なしの検査系のみ。ビルドや dev server 起動は行わない。
"""

import os
import subprocess
from typing import Optional


class CodeCheckError(Exception):
    """コードチェック実行エラー"""
    pass


class CodeChecker:
    """各種チェックコマンドをラップする"""

    DEFAULT_TIMEOUT = 120  # 秒
    MAX_OUTPUT = 64 * 1024  # 返す標準出力の最大バイト数

    def __init__(self, project_root: Optional[str] = None):
        if project_root:
            self.root = project_root
        else:
            here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            self.root = os.path.dirname(here)

    # ------------------------------------------------------------------ #
    # 内部
    # ------------------------------------------------------------------ #

    def _run(
        self,
        cmd: list[str],
        cwd: str,
        timeout: int = DEFAULT_TIMEOUT,
    ) -> dict:
        """subprocess 実行。成否と stdout/stderr を返す。"""
        if not os.path.isdir(cwd):
            raise CodeCheckError(f"作業ディレクトリが存在しません: {cwd}")
        try:
            result = subprocess.run(
                cmd,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), cwd=cwd,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=timeout,
                shell=False,
            )
        except FileNotFoundError as e:
            raise CodeCheckError(f"コマンドが見つかりません: {cmd[0]} ({e})") from e
        except subprocess.TimeoutExpired:
            raise CodeCheckError(f"タイムアウト（{timeout}秒）: {' '.join(cmd)}")

        return {
            "command": " ".join(cmd),
            "cwd": os.path.relpath(cwd, self.root).replace("\\", "/") or ".",
            "returncode": result.returncode,
            "ok": result.returncode == 0,
            "stdout": (result.stdout or "")[-self.MAX_OUTPUT:],
            "stderr": (result.stderr or "")[-self.MAX_OUTPUT:],
        }

    def _resolve_python(self, venv_project: str) -> str:
        """プロジェクト直下の `.venv` Python を優先。なければ `python`"""
        candidates = [
            os.path.join(self.root, venv_project, ".venv", "Scripts", "python.exe"),
            os.path.join(self.root, venv_project, ".venv", "bin", "python"),
        ]
        for c in candidates:
            if os.path.isfile(c):
                return c
        return "python"

    # ------------------------------------------------------------------ #
    # ツール
    # ------------------------------------------------------------------ #

    def python_syntax(self, file_path: str, venv_project: str = "backend_server") -> dict:
        """
        Python ファイル 1 つを `python -m py_compile` で構文チェック。
        相対パスはプロジェクトルート基準。
        """
        abs_path = file_path if os.path.isabs(file_path) else os.path.join(self.root, file_path)
        if not os.path.isfile(abs_path):
            raise CodeCheckError(f"ファイルが存在しません: {file_path}")
        python = self._resolve_python(venv_project)
        return self._run([python, "-m", "py_compile", abs_path], cwd=self.root, timeout=60)

    def python_ruff(
        self,
        path: str = "backend_server",
        venv_project: str = "backend_server",
    ) -> dict:
        """
        プロジェクト配下を `ruff check` で lint。未インストール時はその旨を返す。
        """
        abs_path = path if os.path.isabs(path) else os.path.join(self.root, path)
        if not os.path.exists(abs_path):
            raise CodeCheckError(f"パスが存在しません: {path}")
        python = self._resolve_python(venv_project)
        return self._run([python, "-m", "ruff", "check", abs_path], cwd=self.root, timeout=120)

    def typescript_check(self, project: str = "frontend_web") -> dict:
        """
        `npm run type-check` を実行。

        Args:
            project: 'frontend_web' または 'frontend_avatar'
        """
        if project not in ("frontend_web", "frontend_avatar"):
            raise CodeCheckError("project は 'frontend_web' / 'frontend_avatar' のみ")
        cwd = os.path.join(self.root, project)
        # Windows の場合 npm は npm.cmd、Unix は npm
        npm = "npm.cmd" if os.name == "nt" else "npm"
        return self._run([npm, "run", "type-check"], cwd=cwd, timeout=180)

    def list_targets(self) -> dict:
        """利用可能なチェック対象を返す（存在確認付き）"""
        info = {
            "project_root": self.root,
            "python_venvs": {},
            "ts_projects": {},
        }
        for p in ("backend_server", "backend_tools", "command_hermes"):
            python = self._resolve_python(p)
            info["python_venvs"][p] = {
                "python": python,
                "exists": os.path.isfile(python) or python == "python",
            }
        for p in ("frontend_web", "frontend_avatar"):
            pkg = os.path.join(self.root, p, "package.json")
            info["ts_projects"][p] = {
                "package_json": os.path.relpath(pkg, self.root).replace("\\", "/"),
                "exists": os.path.isfile(pkg),
            }
        return info
