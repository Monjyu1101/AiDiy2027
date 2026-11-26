# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE for full terms.
from sqlalchemy import JSON, Boolean, CheckConstraint, ForeignKeyConstraint, Integer, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class 日誌Base(DeclarativeBase):
    """業務共有DBのメタデータには登録しない。"""


class T日誌作業(日誌Base):
    __tablename__ = "T日誌作業"
    __table_args__ = (
        CheckConstraint("作業ID > 0"),
        CheckConstraint("新規更新ファイル数 >= 0"),
    )

    利用者ID: Mapped[str] = mapped_column(Text, primary_key=True)
    日誌日付: Mapped[str] = mapped_column(Text, primary_key=True)
    作業ID: Mapped[int] = mapped_column(Integer, primary_key=True)
    利用者名: Mapped[str] = mapped_column(Text)
    プロジェクト: Mapped[str] = mapped_column(Text)
    作業タイトル: Mapped[str] = mapped_column(Text)
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
        ForeignKeyConstraint(
            ["利用者ID", "日誌日付", "作業ID"],
            ["T日誌作業.利用者ID", "T日誌作業.日誌日付", "T日誌作業.作業ID"],
            ondelete="CASCADE", onupdate="CASCADE",
        ),
        CheckConstraint("行番号 > 0"),
        CheckConstraint("json_valid(添付) AND json_type(添付) = 'array'"),
    )

    利用者ID: Mapped[str] = mapped_column(Text, primary_key=True)
    日誌日付: Mapped[str] = mapped_column(Text, primary_key=True)
    作業ID: Mapped[int] = mapped_column(Integer, primary_key=True)
    行番号: Mapped[int] = mapped_column(Integer, primary_key=True)
    作業内容: Mapped[str] = mapped_column(Text)
    添付: Mapped[list[dict[str, str]]] = mapped_column(JSON)
