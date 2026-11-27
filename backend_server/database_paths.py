# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE for full terms.
"""Core / Apps / 日誌の現行SQLiteファイル。参照だけでDBやディレクトリを作らない。"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB_NAMES = json.loads((ROOT / "scripts" / "業務DB.json").read_text(encoding="utf-8"))


def database_dir() -> Path:
    return Path.home() / ".aidiy" / "datas"


def database_path(kind: str) -> Path:
    return database_dir() / DB_NAMES[kind]
