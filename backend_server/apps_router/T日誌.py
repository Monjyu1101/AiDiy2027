# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE for full terms.
import re

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from apps_crud import T日誌 as crud
from apps_schema.common import ResponseBase
from apps_schema.T日誌 import (
    T日誌一覧検索要求, T日誌一覧要求, T日誌変更要求, T日誌作業キー, T日誌作業変更要求, T日誌作業登録要求, T日誌登録要求,
    T日誌内容キー, T日誌内容変更要求, T日誌内容登録要求, T日誌検索要求, T日誌キー, 日誌本文上限,
)
from core_models import C利用者
from deps import get_db, get_現在利用者


def _NG(コード: str, メッセージ: str):
    return ResponseBase(status="NG", message=メッセージ, error={"code": コード})


class 日誌Route(APIRoute):
    def get_route_handler(self):
        ハンドラ = super().get_route_handler()

        async def 上限付き処理(request: Request):
            受信サイズ = 0

            async def 受信():
                nonlocal 受信サイズ
                message = await request.receive()
                受信サイズ += len(message.get("body", b""))
                if 受信サイズ > 日誌本文上限:
                    raise HTTPException(413)
                return message

            try:
                return await ハンドラ(Request(request.scope, receive=受信))
            except RequestValidationError as exc:
                # FastAPI標準の422は入力値を返しうる。日誌本文や添付はエラー文に含めない。
                エラー = exc.errors()[0]
                if エラー["type"] == "extra_forbidden":
                    メッセージ = "日誌APIで使用できない項目が指定されています。"
                else:
                    項目 = " / ".join(map(str, エラー["loc"][1:]))
                    メッセージ = f"{項目 + '：' if 項目 else ''}{エラー['msg']}"
                return JSONResponse(_NG("VALIDATION_ERROR", メッセージ).model_dump(), status_code=422)
            except HTTPException as exc:
                if exc.status_code != 413:
                    raise
                return JSONResponse(
                    _NG("PAYLOAD_TOO_LARGE", "日誌の送信サイズが上限（36 MiB）を超えています。").model_dump(),
                    status_code=413,
                )

        return 上限付き処理


router = APIRouter(prefix="/apps/T日誌", tags=["T日誌"], route_class=日誌Route)


_内部操作 = frozenset({"検索", "作業登録", "作業変更", "作業削除", "内容登録", "内容変更", "内容削除"})


def _直接接続(request: Request) -> bool:
    headers = request.headers
    return (
        request.client is not None and request.client.host in {"127.0.0.1", "::1"}
        and len(headers.getlist("host")) == 1
        and re.fullmatch(r"(127\.0\.0\.1|\[::1\])(?::[0-9]{1,5})?", headers.get("host", "")) is not None
        and not any(key in {"origin", "forwarded", "x-real-ip", "via", "x-original-host", "x-original-url", "x-rewrite-url"}
                    or key.startswith(("x-forwarded-", "sec-fetch-")) for key in headers)
    )


def _操作主体(request: Request, 利用者=Depends(get_現在利用者)):
    内部 = getattr(利用者, "認証種別", None) == "internal"
    if 内部:
        if (request.url.path.removeprefix("/apps/T日誌/") not in _内部操作 or not _直接接続(request)
                or request.headers.getlist("x-aidiy-diary") != ["tools"]):
            raise HTTPException(403, detail="日誌の内部連携はローカル Tools からだけ利用できます。")
    elif not 利用者.有効:
        raise HTTPException(403, detail="日誌は有効な利用者でログインして操作してください。")
    return 利用者


def _利用者情報(利用者):
    return {"利用者ID": 利用者.利用者ID, "利用者名": 利用者.利用者名}


def _対象利用者(要求, 操作者, core: Session):
    ID = 要求.利用者ID
    if ID is None:
        if getattr(操作者, "認証種別", None) == "internal":
            raise HTTPException(422, detail={"code": "USER_ID_REQUIRED", "message": "対象の利用者IDを指定してください。"})
        return _利用者情報(操作者)
    対象 = core.get(C利用者, ID)
    if 対象 is None:
        raise HTTPException(404, detail={"code": "USER_NOT_FOUND", "message": "指定の利用者が見つかりません。"})
    # 過去の日誌の閲覧・編集は利用者の無効化後も可能。新規登録だけは有効者に限定する。
    if isinstance(要求, (T日誌登録要求, T日誌作業登録要求)) and not isinstance(要求, T日誌作業変更要求) and not 対象.有効:
        raise HTTPException(422, detail={"code": "USER_INACTIVE", "message": "新規登録には有効な利用者を指定してください。"})
    return _利用者情報(対象)


def _日誌DB(request: Request):
    with Session(request.app.state.日誌DB) as db:
        yield db


def _見つからない():
    return _NG("NOT_FOUND", "指定された日付の日誌が見つかりません。")


@router.post("/一覧", response_model=ResponseBase)
def 一覧(要求: T日誌一覧要求 | None = None, 操作者=Depends(_操作主体), db: Session = Depends(_日誌DB)):
    data = crud.一覧(db, 操作者.利用者ID, 要求 or T日誌一覧要求())
    return ResponseBase(message="日誌一覧を取得しました。", data=data)


@router.post("/一覧検索", response_model=ResponseBase)
def 一覧検索(要求: T日誌一覧検索要求, _=Depends(_操作主体), db: Session = Depends(_日誌DB)):
    return ResponseBase(message="日誌一覧を検索しました。", data=crud.一覧検索(db, 要求))


@router.post("/一覧候補", response_model=ResponseBase)
def 一覧候補(操作者=Depends(_操作主体), db: Session = Depends(_日誌DB)):
    return ResponseBase(message="日誌一覧の検索候補を取得しました。", data=crud.一覧候補(db, _利用者情報(操作者)))


@router.post("/利用者候補", response_model=ResponseBase)
def 利用者候補(_=Depends(_操作主体), core: Session = Depends(get_db)):
    rows = core.execute(select(C利用者.利用者ID, C利用者.利用者名).where(
        C利用者.有効.is_(True),
    ).order_by(C利用者.利用者ID)).mappings()
    return ResponseBase(message="利用者候補を取得しました。", data=[dict(row) for row in rows])


@router.post("/取得", response_model=ResponseBase)
def 取得(要求: T日誌キー, 操作者=Depends(_操作主体), db: Session = Depends(_日誌DB), core: Session = Depends(get_db)):
    所有者 = _対象利用者(要求, 操作者, core)
    data = crud.更新版付き(crud.取得(db, 所有者["利用者ID"], 要求.日誌日付))
    return ResponseBase(message="日誌を取得しました。", data=data) if data else _見つからない()


@router.post("/登録", response_model=ResponseBase)
def 登録(要求: T日誌登録要求, 操作者=Depends(_操作主体), db: Session = Depends(_日誌DB), core: Session = Depends(get_db)):
    try:
        data = crud.保存(db, _対象利用者(要求, 操作者, core), 要求, 新規=True, 操作者=_利用者情報(操作者))
    except crud.日誌操作エラー as exc:
        return _NG(exc.コード, str(exc))
    if data is None:
        return _NG("DUPLICATE", "この日付の日誌は登録済みです。日誌一覧から編集してください。")
    return ResponseBase(message="日誌を登録しました。", data=data)


@router.post("/変更", response_model=ResponseBase)
def 変更(要求: T日誌変更要求, 操作者=Depends(_操作主体), db: Session = Depends(_日誌DB), core: Session = Depends(get_db)):
    try:
        data = crud.保存(db, _対象利用者(要求, 操作者, core), 要求, 新規=False, 操作者=_利用者情報(操作者))
    except crud.日誌操作エラー as exc:
        return _NG(exc.コード, str(exc))
    return ResponseBase(message="日誌を更新しました。", data=data) if data else _見つからない()


@router.post("/削除", response_model=ResponseBase)
def 削除(要求: T日誌キー, 操作者=Depends(_操作主体), db: Session = Depends(_日誌DB), core: Session = Depends(get_db)):
    所有者 = _対象利用者(要求, 操作者, core)
    if not crud.削除(db, 所有者["利用者ID"], 要求.日誌日付):
        return _見つからない()
    return ResponseBase(message="日誌を削除しました。")


@router.post("/検索", response_model=ResponseBase)
def 検索(要求: T日誌検索要求, 操作者=Depends(_操作主体), db: Session = Depends(_日誌DB), core: Session = Depends(get_db)):
    所有者 = _対象利用者(要求, 操作者, core)
    return ResponseBase(message="日誌を検索しました。", data=crud.検索(db, 所有者["利用者ID"], 要求))


def _部分操作(db: Session, 所有者, 操作者, 要求, 操作: str):
    try:
        data = crud.部分操作(db, 所有者, 要求, 操作, 操作者=_利用者情報(操作者))
    except crud.日誌操作エラー as exc:
        return _NG(exc.コード, str(exc))
    except ValidationError as exc:
        return _NG("VALIDATION_ERROR", exc.errors(include_input=False)[0]["msg"])
    return ResponseBase(message=f"日誌の{操作}が完了しました。", data=data)


@router.post("/作業登録", response_model=ResponseBase)
def 作業登録(要求: T日誌作業登録要求, 操作者=Depends(_操作主体), db: Session = Depends(_日誌DB), core: Session = Depends(get_db)):
    return _部分操作(db, _対象利用者(要求, 操作者, core), 操作者, 要求, "作業登録")


@router.post("/作業変更", response_model=ResponseBase)
def 作業変更(要求: T日誌作業変更要求, 操作者=Depends(_操作主体), db: Session = Depends(_日誌DB), core: Session = Depends(get_db)):
    return _部分操作(db, _対象利用者(要求, 操作者, core), 操作者, 要求, "作業変更")


@router.post("/作業削除", response_model=ResponseBase)
def 作業削除(要求: T日誌作業キー, 操作者=Depends(_操作主体), db: Session = Depends(_日誌DB), core: Session = Depends(get_db)):
    return _部分操作(db, _対象利用者(要求, 操作者, core), 操作者, 要求, "作業削除")


@router.post("/内容登録", response_model=ResponseBase)
def 内容登録(要求: T日誌内容登録要求, 操作者=Depends(_操作主体), db: Session = Depends(_日誌DB), core: Session = Depends(get_db)):
    return _部分操作(db, _対象利用者(要求, 操作者, core), 操作者, 要求, "内容登録")


@router.post("/内容変更", response_model=ResponseBase)
def 内容変更(要求: T日誌内容変更要求, 操作者=Depends(_操作主体), db: Session = Depends(_日誌DB), core: Session = Depends(get_db)):
    return _部分操作(db, _対象利用者(要求, 操作者, core), 操作者, 要求, "内容変更")


@router.post("/内容削除", response_model=ResponseBase)
def 内容削除(要求: T日誌内容キー, 操作者=Depends(_操作主体), db: Session = Depends(_日誌DB), core: Session = Depends(get_db)):
    return _部分操作(db, _対象利用者(要求, 操作者, core), 操作者, 要求, "内容削除")
