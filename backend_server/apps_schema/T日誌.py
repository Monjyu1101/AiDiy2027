# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE for full terms.
import base64
from datetime import date
from decimal import Decimal
from typing import Annotated, Self

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, model_validator

日誌添付上限 = 5 * 1024 * 1024
日誌添付合計上限 = 15 * 1024 * 1024
日誌本文上限 = 36 * 1024 * 1024
最大記録数 = 30
最大明細数 = 100
明細添付件数上限 = 20
添付データ長上限 = 4 * ((日誌添付上限 + 2) // 3)


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
    日誌日付: 日誌日付


class 日誌期間要求(日誌要求):
    開始日付: 日誌日付 | None = None
    終了日付: 日誌日付 | None = None

    @model_validator(mode="after")
    def _範囲(self) -> Self:
        if self.開始日付 and self.終了日付 and self.開始日付 > self.終了日付:
            raise ValueError("終了日付は開始日付以降を指定してください。")
        return self


class 日誌添付要求(日誌要求):
    ファイル名: str = Field(min_length=1, max_length=255)
    base64内容: str = Field(min_length=1, max_length=添付データ長上限)

    @model_validator(mode="after")
    def _名前(self) -> Self:
        if (
            not self.ファイル名.strip()
            or self.ファイル名 in {".", ".."}
            or any(c in "/\\:" or ord(c) < 32 or ord(c) == 127 for c in self.ファイル名)
        ):
            raise ValueError("ファイル名にはパスや制御文字を指定できません。")
        return self


class 日誌明細項目(日誌要求):
    作業内容: str | None = Field(default=None, max_length=10_000)
    添付: list[日誌添付要求] | None = Field(default=None, max_length=明細添付件数上限)


class 日誌明細要求(日誌明細項目):
    行番号: int = Field(ge=1, le=最大明細数)
    作業内容: str = Field(default="", max_length=10_000)
    添付: list[日誌添付要求] = Field(default_factory=list, max_length=明細添付件数上限)

    @model_validator(mode="after")
    def _確認(self) -> Self:
        if not self.作業内容.strip() and not self.添付:
            raise ValueError("明細には内容または添付ファイルを指定してください。")
        return self


def _プロジェクトパス(値: str) -> str:
    if any(ord(c) < 32 or ord(c) == 127 for c in 値):
        raise ValueError("プロジェクト（フォルダパス）に制御文字は指定できません。")
    return 値


プロジェクトパス = Annotated[str, Field(max_length=4096), AfterValidator(_プロジェクトパス)]
最大作業ID = 9_007_199_254_740_991
日誌作業ID = Annotated[int, Field(ge=1, le=最大作業ID)]
自己申告件数 = Annotated[int, Field(ge=0, le=9_007_199_254_740_991)]


def _作業時間の桁数(値: float) -> float:
    十進値 = Decimal(str(値))
    if 十進値 != 十進値.quantize(Decimal("0.01")):
        raise ValueError("作業時間(h)は小数第2位まで指定してください。")
    return 値


日誌作業時間 = Annotated[float, Field(ge=0, le=99.99, allow_inf_nan=False), AfterValidator(_作業時間の桁数)]


class T日誌一覧要求(日誌期間要求):
    件数制限: bool = True


class T日誌一覧検索要求(T日誌一覧要求):
    利用者ID: str = Field(default="", max_length=255)
    プロジェクト: プロジェクトパス = ""
    キーワード: str = Field(default="", max_length=200)


class 日誌記録要求(日誌要求):
    作業ID: 日誌作業ID | None = None
    プロジェクト: プロジェクトパス = ""
    作業タイトル: str = Field(min_length=1, max_length=200)
    作業時間: 日誌作業時間 | None = None
    新規更新ファイル数: 自己申告件数 | None = None
    明細: list[日誌明細要求] = Field(default_factory=list, max_length=最大明細数)

    @model_validator(mode="after")
    def _確認(self) -> Self:
        self.作業タイトル = self.作業タイトル.strip()
        if not self.作業タイトル:
            raise ValueError("作業タイトルを入力してください。")
        if any(行.行番号 != 番号 for 番号, 行 in enumerate(self.明細, 1)):
            raise ValueError("行番号は明細ごとに1から順に指定してください。")
        return self


class T日誌保存要求(T日誌キー):
    記録: list[日誌記録要求] = Field(min_length=1, max_length=最大記録数)

    @model_validator(mode="after")
    def _確認(self) -> Self:
        作業ID一覧 = [記録.作業ID for 記録 in self.記録 if 記録.作業ID is not None]
        if len(set(作業ID一覧)) != len(作業ID一覧):
            raise ValueError("同じ作業IDを複数回指定できません。")
        if sum(len(記録.明細) for 記録 in self.記録) > 最大明細数:
            raise ValueError("明細は日誌1件につき100行までです。")
        添付合計 = 0
        for 記録 in self.記録:
            for 行 in 記録.明細:
                for 番号, 添付 in enumerate(行.添付, 1):
                    位置 = f"記録{記録.作業ID}・行{行.行番号}・添付{番号}"
                    try:
                        添付サイズ = len(base64.b64decode(添付.base64内容, validate=True))
                    except ValueError:
                        raise ValueError(f"{位置}のBase64内容が不正です。") from None
                    if not 0 < 添付サイズ <= 日誌添付上限:
                        raise ValueError(f"{位置}は1バイト～5 MiBで指定してください。")
                    添付合計 += 添付サイズ
                    if 添付合計 > 日誌添付合計上限:
                        raise ValueError("添付の合計は日誌1件につき15 MiBまでです。")
        return self


class T日誌登録要求(T日誌保存要求):
    @model_validator(mode="after")
    def _新規作業のみ(self) -> Self:
        if any(記録.作業ID is not None for 記録 in self.記録):
            raise ValueError("新規登録では作業IDを指定できません。")
        return self


class T日誌変更要求(T日誌保存要求):
    更新版: str = Field(pattern=r"^[0-9a-f]{64}$")


class T日誌検索要求(日誌期間要求):
    キーワード: str = Field(default="", max_length=200)
    limit: int = Field(default=5, ge=1, le=10)
    offset: int = Field(default=0, ge=0, le=1_000_000)


class T日誌作業キー(T日誌キー):
    作業ID: 日誌作業ID


class T日誌作業登録要求(T日誌キー):
    プロジェクト: プロジェクトパス = ""
    作業タイトル: str = Field(min_length=1, max_length=200)
    作業時間: 日誌作業時間 | None = None
    新規更新ファイル数: 自己申告件数 | None = None


class T日誌作業変更要求(T日誌作業キー, T日誌作業登録要求):
    pass


class T日誌内容登録要求(T日誌作業キー, 日誌明細項目):
    作業内容: str = Field(default="", max_length=10_000)


class T日誌内容キー(T日誌作業キー):
    行番号: int = Field(ge=1, le=最大明細数)


class T日誌内容変更要求(T日誌内容キー, 日誌明細項目):
    @model_validator(mode="after")
    def _変更項目(self) -> Self:
        if self.作業内容 is None and self.添付 is None:
            raise ValueError("変更する内容または添付を指定してください。")
        return self
