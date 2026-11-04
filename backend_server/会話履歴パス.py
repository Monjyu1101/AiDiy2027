# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""会話履歴のプロジェクト識別用パス。ファイルシステムにはアクセスしない。"""

import ntpath
import posixpath
import re
from typing import Optional


def normalize_project_path(value: Optional[str]) -> Optional[str]:
    """絶対パスを実行OSによらず正規化する。未指定は None、相対パスは拒否。

    Windows はドライブ絶対パスと UNC を受け付け、区切りを / に統一して
    大文字小文字を同一視する。POSIX は大文字小文字を維持する。
    シンボリックリンクの解決・存在確認・実行ディレクトリの補完は行わない。
    """
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError("プロジェクトパスは絶対パスの文字列で指定してください")
    value = value.strip()
    if not value:
        return None
    if "\x00" in value:
        raise ValueError("プロジェクトパスに NUL 文字は使用できません")

    # //server/share は UNC と扱う。/// は POSIX の重複区切りとして扱う。
    windows_path = bool(re.match(r"^[A-Za-z]:", value)) or value.startswith("\\\\") or (
        value.startswith("//") and not value.startswith("///")
    )
    if windows_path:
        path = value.replace("\\", "/")
        # 長いパス形式も通常のドライブ / UNC 表記へまとめる。
        if path[:8].casefold() == "//?/unc/":
            path = "//" + path[8:]
        elif path.startswith("//?/"):
            path = path[4:]
        if path.startswith("//./"):
            raise ValueError("プロジェクトパスにデバイスパスは指定できません")

        drive, tail = ntpath.splitdrive(path)
        if re.fullmatch(r"[A-Za-z]:", drive):
            if not tail.startswith("/"):
                raise ValueError("プロジェクトパスはドライブを含む絶対パスで指定してください")
        elif drive.startswith("//"):
            parts = drive[2:].split("/")
            if len(parts) != 2 or any(part in ("", ".", "..", "?") for part in parts):
                raise ValueError("UNC プロジェクトパスにはサーバー名と共有名が必要です")
        else:
            raise ValueError("プロジェクトパスは絶対パスで指定してください")

        # casefold は Straße / Strasse 等の別フォルダまで統合するため使わない。
        normalized = ntpath.normcase(ntpath.normpath(path)).replace("\\", "/")
        # ドライブのルート c:/ は保持し、UNC の共有ルート末尾 / は除去する。
        return normalized if re.fullmatch(r"[a-z]:/", normalized) else normalized.rstrip("/")

    if not value.startswith("/"):
        raise ValueError("プロジェクトパスは絶対パスで指定してください")
    return posixpath.normpath(value)
