# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

from sqlalchemy.orm import Session
from sqlalchemy import and_, desc
from core_models.A会話履歴 import A会話履歴
from core_crud.utils import create_audit_fields, update_audit_fields
from typing import Optional, List
from 会話履歴パス import normalize_project_path


_プロジェクトパス未指定 = object()


def create_会話履歴(
    db: Session,
    セッションID: str,
    シーケンス: int,
    チャンネル: str,
    メッセージ識別: str,
    メッセージ内容: Optional[str] = None,
    ファイル名: Optional[str] = None,
    サムネイル画像: Optional[str] = None,
    認証情報: dict = None,
    プロジェクトパス: Optional[str] = None
) -> A会話履歴:
    """会話履歴を作成"""
    audit_fields = create_audit_fields(認証情報)

    db_record = A会話履歴(
        セッションID=セッションID,
        シーケンス=シーケンス,
        チャンネル=チャンネル,
        プロジェクトパス=normalize_project_path(プロジェクトパス),
        メッセージ識別=メッセージ識別,
        メッセージ内容=メッセージ内容,
        ファイル名=ファイル名,
        サムネイル画像=サムネイル画像,
        **audit_fields
    )
    db.add(db_record)
    db.commit()
    db.refresh(db_record)
    return db_record


def get_会話履歴(db: Session, セッションID: str, シーケンス: int) -> Optional[A会話履歴]:
    """会話履歴を1件取得"""
    return db.query(A会話履歴).filter(
        and_(
            A会話履歴.セッションID == セッションID,
            A会話履歴.シーケンス == シーケンス
        )
    ).first()


def get_会話履歴_by_socket(
    db: Session,
    セッションID: str,
    チャンネル: Optional[str] = None,
    limit: int = 100,
    プロジェクトパス: Optional[str] = None
) -> List[A会話履歴]:
    """セッションIDで会話履歴を取得（チャンネル・プロジェクト指定可能）"""
    query = db.query(A会話履歴).filter(A会話履歴.セッションID == セッションID)

    if チャンネル is not None:
        query = query.filter(A会話履歴.チャンネル == チャンネル)

    project_path = normalize_project_path(プロジェクトパス)
    if project_path is not None:
        query = query.filter(A会話履歴.プロジェクトパス == project_path)

    return query.order_by(desc(A会話履歴.シーケンス)).limit(limit).all()


def get_next_sequence(db: Session, セッションID: str) -> int:
    """次のシーケンス番号を取得"""
    max_seq = db.query(A会話履歴.シーケンス).filter(
        A会話履歴.セッションID == セッションID
    ).order_by(desc(A会話履歴.シーケンス)).first()

    return (max_seq[0] + 1) if max_seq else 1


def update_会話履歴(
    db: Session,
    セッションID: str,
    シーケンス: int,
    メッセージ内容: Optional[str] = None,
    ファイル名: Optional[str] = None,
    サムネイル画像: Optional[str] = None,
    認証情報: dict = None,
    プロジェクトパス=_プロジェクトパス未指定
) -> Optional[A会話履歴]:
    """会話履歴を更新。プロジェクトパスは省略時に保持、明示的な None で解除。"""
    if プロジェクトパス is not _プロジェクトパス未指定:
        プロジェクトパス = normalize_project_path(プロジェクトパス)

    db_record = get_会話履歴(db, セッションID, シーケンス)
    if not db_record:
        return None

    audit_fields = update_audit_fields(認証情報)

    if プロジェクトパス is not _プロジェクトパス未指定:
        db_record.プロジェクトパス = プロジェクトパス

    if メッセージ内容 is not None:
        db_record.メッセージ内容 = メッセージ内容
    if ファイル名 is not None:
        db_record.ファイル名 = ファイル名
    if サムネイル画像 is not None:
        db_record.サムネイル画像 = サムネイル画像

    for key, value in audit_fields.items():
        setattr(db_record, key, value)

    db.commit()
    db.refresh(db_record)
    return db_record


def delete_会話履歴(db: Session, セッションID: str, シーケンス: int) -> bool:
    """会話履歴を削除"""
    db_record = get_会話履歴(db, セッションID, シーケンス)
    if not db_record:
        return False

    db.delete(db_record)
    db.commit()
    return True


def delete_会話履歴_by_socket(db: Session, セッションID: str) -> int:
    """セッションIDに紐づく会話履歴を全削除"""
    count = db.query(A会話履歴).filter(A会話履歴.セッションID == セッションID).count()
    db.query(A会話履歴).filter(A会話履歴.セッションID == セッションID).delete()
    db.commit()
    return count
