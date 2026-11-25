# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
"""AGY の保存済み OAuth を使う経路で、API キー・ADC を継承しない。"""
import os
import shutil
from pathlib import Path


# Windows の環境変数も大文字小文字を区別しない。
_代替認証環境 = frozenset({
    "GEMINI_API_KEY", "GOOGLE_API_KEY", "AGY_ADC_AUTH",
    "GOOGLE_APPLICATION_CREDENTIALS", "GOOGLE_GEMINI_BASE_URL",
})


def agy_oauth環境(env=None):
    """親環境と AGY の保存済みログイン設定は変更しない。"""
    return {key: value for key, value in (os.environ if env is None else env).items()
            if key.upper() not in _代替認証環境}


def agy_oauthコマンド(env=None, *, platform=None):
    """公式 agy と VS Code 拡張の同梱バイナリを探す。導入・設定変更は行わない。"""
    values = {key.upper(): value for key, value in (os.environ if env is None else env).items()}
    if (os.name if platform is None else platform) == "nt":
        home = Path(values["USERPROFILE"]) if values.get("USERPROFILE") else None
        local = Path(values["LOCALAPPDATA"]) if values.get("LOCALAPPDATA") else None
        candidates = [Path(directory.strip('"')) / "agy.exe"
                      for directory in values.get("PATH", "").split(";") if directory]
        if local:
            candidates.append(local / "agy" / "bin" / "agy.exe")
        if home:
            candidates.append(home / ".gemini" / "bin" / "agy.exe")
        for candidate in candidates:
            if candidate.is_absolute() and candidate.is_file():
                return str(candidate)
        return None
    candidate = shutil.which("agy", path=values.get("PATH", ""))
    if candidate:
        return os.path.abspath(candidate)
    if values.get("HOME"):
        fallback = Path(values["HOME"]) / ".local" / "bin" / "agy"
        if fallback.is_file() and os.access(fallback, os.X_OK):
            return str(fallback.absolute())
    return None
