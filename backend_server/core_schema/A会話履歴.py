# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

from pydantic import BaseModel, field_validator
from 会話履歴パス import normalize_project_path
from typing import Optional

# --- A会話履歴 ---

class _プロジェクトパスSchema(BaseModel):
    プロジェクトパス: Optional[str] = None

    @field_validator("プロジェクトパス")
    @classmethod
    def validate_project_path(cls, value: Optional[str]) -> Optional[str]:
        return normalize_project_path(value)


class A会話履歴Base(_プロジェクトパスSchema):
    セッションID: str
    シーケンス: int
    チャンネル: str
    メッセージ識別: str
    メッセージ内容: Optional[str] = None
    ファイル名: Optional[str] = None
    サムネイル画像: Optional[str] = None


class A会話履歴Create(A会話履歴Base):
    pass


class A会話履歴Update(_プロジェクトパスSchema):
    セッションID: str
    シーケンス: int
    メッセージ内容: Optional[str] = None
    ファイル名: Optional[str] = None
    サムネイル画像: Optional[str] = None


class A会話履歴Delete(BaseModel):
    セッションID: str
    シーケンス: int


class A会話履歴Get(BaseModel):
    セッションID: str
    シーケンス: int


class A会話履歴ListRequest(_プロジェクトパスSchema):
    セッションID: Optional[str] = None
    チャンネル: Optional[str] = None
    件数: Optional[int] = None


class A会話履歴Response(A会話履歴Base):
    登録日時: str
    登録利用者ID: str
    登録利用者名: Optional[str]
    登録端末ID: str
    更新日時: str
    更新利用者ID: str
    更新利用者名: Optional[str]
    更新端末ID: str

    class Config:
        from_attributes = True
