# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""
ログ tail モジュール

AiDiy のバックエンド 3 サーバー（core / apps / mcp）のログファイルから
最新行を取り出して AIエージェントの自己検証を支える。

- core/apps:  backend_server/temp/logs/yyyyMMdd.AiDiy.log（日次で 1 ファイル）
- mcp:        backend_tools/temp/logs/yyyymmdd.hh0000.mcp_main.log（毎時で 1 ファイル）
"""

import glob
import os
import re
from collections import deque
from datetime import datetime
from typing import Optional


class LogTailError(Exception):
    """ログ tail エラー"""
    pass


class LogTailer:
    """AiDiy のログを安全に tail する"""

    MAX_LINES = 2000  # 1 回の tail で返す上限行数

    # サーバー種別 → ログ探索パターン
    LOG_PATTERNS = {
        # core/apps は同一ファイルに書き込む構成（log_config.py）
        "core":   ["backend_server/temp/logs/*.AiDiy.log"],
        "apps":   ["backend_server/temp/logs/*.AiDiy.log"],
        "server": ["backend_server/temp/logs/*.AiDiy.log"],
        "mcp":    ["backend_tools/temp/logs/*.mcp_main.log"],
    }

    # Python Traceback / ERROR / 例外系を拾う正規表現
    ERROR_PATTERN = re.compile(
        r"(ERROR|CRITICAL|Traceback|Exception|Error:|^\s*File \".+\", line \d+)",
        re.IGNORECASE,
    )

    def __init__(self, project_root: Optional[str] = None):
        if project_root:
            self.root = project_root
        else:
            here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            self.root = os.path.dirname(here)

    # ------------------------------------------------------------------ #
    # ヘルパ
    # ------------------------------------------------------------------ #

    def _resolve_latest(self, server: str) -> str:
        patterns = self.LOG_PATTERNS.get(server)
        if not patterns:
            raise LogTailError(
                f"server は {list(self.LOG_PATTERNS.keys())} のいずれかを指定してください"
            )
        candidates: list[str] = []
        for p in patterns:
            candidates.extend(glob.glob(os.path.join(self.root, p)))
        if not candidates:
            raise LogTailError(f"ログファイルが見つかりません: server={server}")
        # 更新時刻の新しい順
        candidates.sort(key=lambda p: os.path.getmtime(p), reverse=True)
        return candidates[0]

    def _read_tail(self, path: str, lines: int) -> list[str]:
        """末尾 lines 行を deque で取得（大容量対応）"""
        lines = max(1, min(int(lines or 100), self.MAX_LINES))
        dq: deque[str] = deque(maxlen=lines)
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                for line in f:
                    dq.append(line.rstrip("\r\n"))
        except OSError as e:
            raise LogTailError(f"ログ読み込みエラー: {e}") from e
        return list(dq)

    # ------------------------------------------------------------------ #
    # ツール
    # ------------------------------------------------------------------ #

    def list_logs(self) -> dict:
        """監視対象のログファイル一覧を返す"""
        results: dict[str, list[dict]] = {}
        for key in ("server", "mcp"):
            items: list[dict] = []
            for p in self.LOG_PATTERNS[key]:
                for path in glob.glob(os.path.join(self.root, p)):
                    try:
                        st = os.stat(path)
                        items.append({
                            "path": os.path.relpath(path, self.root).replace("\\", "/"),
                            "size": st.st_size,
                            "mtime": datetime.fromtimestamp(st.st_mtime).isoformat(timespec="seconds"),
                        })
                    except OSError:
                        continue
            items.sort(key=lambda x: x["mtime"], reverse=True)
            results[key] = items
        return results

    def tail(
        self,
        server: str = "server",
        lines: int = 100,
        grep: Optional[str] = None,
    ) -> dict:
        """
        指定サーバーの最新ログを末尾から返す。

        Args:
            server: 'server'（core/apps 共通）/ 'mcp' / 'core' / 'apps'
            lines:  末尾から取得する行数（最大 2000）
            grep:   指定時は正規表現で抽出

        Returns:
            {'path': ..., 'total_scanned': N, 'matched': M, 'lines': [...]}
        """
        path = self._resolve_latest(server)
        all_lines = self._read_tail(path, lines)
        if grep:
            try:
                pat = re.compile(grep)
            except re.error as e:
                raise LogTailError(f"正規表現エラー: {e}") from e
            matched = [ln for ln in all_lines if pat.search(ln)]
        else:
            matched = all_lines
        return {
            "path": os.path.relpath(path, self.root).replace("\\", "/"),
            "total_scanned": len(all_lines),
            "matched": len(matched),
            "lines": matched,
        }

    def recent_errors(self, server: str = "server", lines: int = 500) -> dict:
        """ERROR/CRITICAL/Traceback に該当する行とその直前直後 2 行を返す"""
        path = self._resolve_latest(server)
        tail_lines = self._read_tail(path, lines)
        hits: list[dict] = []
        for i, ln in enumerate(tail_lines):
            if self.ERROR_PATTERN.search(ln):
                start = max(0, i - 2)
                end = min(len(tail_lines), i + 3)
                hits.append({
                    "line_no": i + 1,
                    "context": tail_lines[start:end],
                })
        return {
            "path": os.path.relpath(path, self.root).replace("\\", "/"),
            "scanned_lines": len(tail_lines),
            "error_count": len(hits),
            "hits": hits[:100],  # 最大 100 ヒット
        }
