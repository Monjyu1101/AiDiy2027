# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE for full terms.
from sqlalchemy import JSON, Boolean, CheckConstraint, Float, ForeignKey, Index, Integer, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class 日誌Base(DeclarativeBase):
    """業務共有DBのメタデータには登録しない。"""


class T日誌作業(日誌Base):
    __tablename__ = "T日誌作業"
    __table_args__ = (
        CheckConstraint("作業ID > 0"),
        Index("ix_日誌作業_利用者日付", "利用者ID", "日誌日付"),
        CheckConstraint("作業時間 BETWEEN 0 AND 99.99 AND round(作業時間, 2) = 作業時間"),
        CheckConstraint("新規更新ファイル数 >= 0"),
    )

    作業ID: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    利用者ID: Mapped[str] = mapped_column(Text)
    日誌日付: Mapped[str] = mapped_column(Text)
    利用者名: Mapped[str] = mapped_column(Text)
    プロジェクト: Mapped[str] = mapped_column(Text)
    作業タイトル: Mapped[str] = mapped_column(Text)
    作業時間: Mapped[float | None] = mapped_column(Float)
    新規更新ファイル数: Mapped[int | None] = mapped_column(Integer)
    有効: Mapped[bool] = mapped_column(Boolean, default=True)
    登録日時: Mapped[str] = mapped_column(Text)
    登録利用者ID: Mapped[str] = mapped_column(Text)
    登録利用者名: Mapped[str] = mapped_column(Text)
    登録端末ID: Mapped[str] = mapped_column(Text)
    更新日時: Mapped[str] = mapped_column(Text)
    更新利用者ID: Mapped[str] = mapped_column(Text)
    更新利用者名: Mapped[str] = mapped_column(Text)
    更新端末ID: Mapped[str] = mapped_column(Text)


class T日誌明細(日誌Base):
    __tablename__ = "T日誌明細"
    __table_args__ = (
        CheckConstraint("行番号 > 0"),
        CheckConstraint("json_valid(添付) AND json_type(添付) = 'array'"),
    )

    作業ID: Mapped[int] = mapped_column(ForeignKey("T日誌作業.作業ID", ondelete="CASCADE"), primary_key=True)
    行番号: Mapped[int] = mapped_column(Integer, primary_key=True)
    作業内容: Mapped[str] = mapped_column(Text)
    添付: Mapped[list[dict[str, str]]] = mapped_column(JSON)
