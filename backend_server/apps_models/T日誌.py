# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE for full terms.
from sqlalchemy import Boolean, CheckConstraint, ForeignKeyConstraint, Integer, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class 日誌Base(DeclarativeBase):
    """業務共有DBのメタデータには登録しない。"""


class T日誌(日誌Base):
    __tablename__ = "T日誌"

    利用者ID: Mapped[str] = mapped_column(Text, primary_key=True)
    日付: Mapped[str] = mapped_column(Text, primary_key=True)
    利用者名: Mapped[str] = mapped_column(Text)
    有効: Mapped[bool] = mapped_column(Boolean, default=True)
    登録日時: Mapped[str] = mapped_column(Text)
    登録利用者ID: Mapped[str] = mapped_column(Text)
    登録利用者名: Mapped[str] = mapped_column(Text)
    登録端末ID: Mapped[str] = mapped_column(Text)
    更新日時: Mapped[str] = mapped_column(Text)
    更新利用者ID: Mapped[str] = mapped_column(Text)
    更新利用者名: Mapped[str] = mapped_column(Text)
    更新端末ID: Mapped[str] = mapped_column(Text)


class T日誌記録(日誌Base):
    __tablename__ = "T日誌記録"
    __table_args__ = (
        ForeignKeyConstraint(["利用者ID", "日付"], ["T日誌.利用者ID", "T日誌.日付"], ondelete="CASCADE"),
        CheckConstraint("記録SEQ > 0"),
    )

    利用者ID: Mapped[str] = mapped_column(Text, primary_key=True)
    日付: Mapped[str] = mapped_column(Text, primary_key=True)
    記録SEQ: Mapped[int] = mapped_column(Integer, primary_key=True)
    記録タイトル: Mapped[str] = mapped_column(Text)


class T日誌明細(日誌Base):
    __tablename__ = "T日誌明細"
    __table_args__ = (
        ForeignKeyConstraint(
            ["利用者ID", "日付", "記録SEQ"],
            ["T日誌記録.利用者ID", "T日誌記録.日付", "T日誌記録.記録SEQ"],
            ondelete="CASCADE",
        ),
        CheckConstraint("行SEQ > 0"),
    )

    利用者ID: Mapped[str] = mapped_column(Text, primary_key=True)
    日付: Mapped[str] = mapped_column(Text, primary_key=True)
    記録SEQ: Mapped[int] = mapped_column(Integer, primary_key=True)
    行SEQ: Mapped[int] = mapped_column(Integer, primary_key=True)
    内容: Mapped[str] = mapped_column(Text)
    ファイル名: Mapped[str] = mapped_column(Text)
    base64内容: Mapped[str] = mapped_column(Text)
