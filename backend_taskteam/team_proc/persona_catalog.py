# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

from __future__ import annotations

import json
import re
from pathlib import Path


PERSONA_ROOT = Path(__file__).resolve().parents[1] / "persona"
要員ID最大長 = 16
要員ID形式 = re.compile(r"^[\w-]+$", re.UNICODE)


def _文字列一覧(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def _要員ID検証(要員ID: str) -> None:
    if not 1 <= len(要員ID) <= 要員ID最大長:
        raise ValueError(
            f"personaフォルダ名は1～{要員ID最大長}文字にしてください: {要員ID}"
        )
    if not 要員ID形式.fullmatch(要員ID):
        raise ValueError(
            "personaフォルダ名に使用できるのは、空白を含まない"
            f"英数字・日本語・_・-だけです: {要員ID}"
        )


def _persona読込(persona_folder: Path) -> dict:
    要員ID = persona_folder.name
    _要員ID検証(要員ID)
    json_path = persona_folder / "persona.json"
    if not json_path.is_file():
        raise ValueError(f"persona.jsonがありません: {要員ID}")

    try:
        data = json.loads(json_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"persona.jsonを読み込めません: {要員ID}") from exc
    if not isinstance(data, dict):
        raise ValueError(f"persona.jsonのルートはオブジェクトにしてください: {要員ID}")

    specialties = _文字列一覧(data.get("得意分野"))
    personalities = _文字列一覧(data.get("性格"))
    role = str(data.get("役割", "")).strip() or (
        specialties[0] if specialties else "AIエージェント"
    )
    return {
        "要員ID": 要員ID,
        "要員名": 要員ID,
        "役割": role,
        "人格情報": "\n".join(personalities),
        "人物名": str(data.get("人物名", 要員ID)).strip() or 要員ID,
        "ニックネーム": str(data.get("ニックネーム", 要員ID)).strip() or 要員ID,
        "有効": True,
    }


def 召喚要員一覧() -> list[dict]:
    if not PERSONA_ROOT.is_dir():
        return []
    folders = sorted(
        (path for path in PERSONA_ROOT.iterdir() if path.is_dir()),
        key=lambda path: (path.name != "admin", path.name.casefold()),
    )
    items = [_persona読込(folder) for folder in folders]
    if not any(item["要員ID"] == "admin" for item in items):
        raise ValueError("初期メンバーのpersona/adminがありません")
    return items


def 召喚要員取得(要員ID: str) -> dict | None:
    要員ID = 要員ID.strip()
    _要員ID検証(要員ID)
    persona_folder = PERSONA_ROOT / 要員ID
    if not persona_folder.is_dir():
        return None
    return _persona読込(persona_folder)
