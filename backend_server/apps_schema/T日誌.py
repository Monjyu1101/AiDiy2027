# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE for full terms.
import base64
from datetime import date
from typing import Annotated, Self

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, model_validator

日誌添付上限 = 5 * 1024 * 1024
日誌添付合計上限 = 15 * 1024 * 1024
日誌本文上限 = 36 * 1024 * 1024
最大記録数 = 30
最大明細数 = 100


def _実在日付(値: str) -> str:
    try:
        date.fromisoformat(値)
    except ValueError:
        raise ValueError("実在する日付をYYYY-MM-DDで指定してください。") from None
    return 値


日誌日付 = Annotated[str, Field(pattern=r"^[0-9]{4}-[0-9]{2}-[0-9]{2}$"), AfterValidator(_実在日付)]


class 日誌要求(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class T日誌キー(日誌要求):
    日付: 日誌日付


class T日誌一覧要求(日誌要求):
    開始日付: 日誌日付 | None = None
    終了日付: 日誌日付 | None = None
    件数制限: bool = True

    @model_validator(mode="after")
    def _範囲(self) -> Self:
        if self.開始日付 and self.終了日付 and self.開始日付 > self.終了日付:
            raise ValueError("終了日付は開始日付以降を指定してください。")
        return self


class 日誌明細要求(日誌要求):
    行SEQ: int = Field(ge=1, le=最大明細数)
    内容: str = Field(default="", max_length=10_000)
    ファイル名: str = Field(default="", max_length=255)
    base64内容: str = Field(default="", max_length=4 * ((日誌添付上限 + 2) // 3))

    @model_validator(mode="after")
    def _確認(self) -> Self:
        if bool(self.ファイル名) != bool(self.base64内容):
            raise ValueError("ファイル名とBase64内容は両方指定してください。")
        if self.ファイル名 and (
            not self.ファイル名.strip()
            or self.ファイル名 in {".", ".."}
            or any(c in "/\\:" or ord(c) < 32 or ord(c) == 127 for c in self.ファイル名)
        ):
            raise ValueError("ファイル名にはパスや制御文字を指定できません。")
        if not self.内容.strip() and not self.ファイル名:
            raise ValueError("明細には内容または添付ファイルを指定してください。")
        return self


class 日誌記録要求(日誌要求):
    記録SEQ: int = Field(ge=1, le=最大記録数)
    記録タイトル: str = Field(min_length=1, max_length=200)
    明細: list[日誌明細要求] = Field(default_factory=list, max_length=最大明細数)

    @model_validator(mode="after")
    def _確認(self) -> Self:
        self.記録タイトル = self.記録タイトル.strip()
        if not self.記録タイトル:
            raise ValueError("記録タイトルを入力してください。")
        if any(行.行SEQ != 番号 for 番号, 行 in enumerate(self.明細, 1)):
            raise ValueError("行SEQは明細ごとに1から順に指定してください。")
        return self


class T日誌保存要求(T日誌キー):
    記録: list[日誌記録要求] = Field(min_length=1, max_length=最大記録数)

    @model_validator(mode="after")
    def _確認(self) -> Self:
        if any(記録.記録SEQ != 番号 for 番号, 記録 in enumerate(self.記録, 1)):
            raise ValueError("記録SEQは1から順に指定してください。")
        if sum(len(記録.明細) for 記録 in self.記録) > 最大明細数:
            raise ValueError("明細は日誌1件につき100行までです。")
        添付合計 = 0
        for 記録 in self.記録:
            for 行 in 記録.明細:
                if not 行.base64内容:
                    continue
                try:
                    添付サイズ = len(base64.b64decode(行.base64内容, validate=True))
                except ValueError:
                    raise ValueError(f"記録{記録.記録SEQ}・行{行.行SEQ}のBase64内容が不正です。") from None
                if not 0 < 添付サイズ <= 日誌添付上限:
                    raise ValueError(f"記録{記録.記録SEQ}・行{行.行SEQ}の添付は1バイト～5 MiBで指定してください。")
                添付合計 += 添付サイズ
                if 添付合計 > 日誌添付合計上限:
                    raise ValueError("添付の合計は日誌1件につき15 MiBまでです。")
        return self
