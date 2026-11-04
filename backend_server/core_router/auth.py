# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from datetime import timedelta
import core_schema as schemas, auth, core_crud as crud, deps
from core_models import C利用者

router = APIRouter(prefix="/core/auth", tags=["auth"])

def issue_token(利用者: C利用者):
    access_token_expires = timedelta(minutes=auth.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = auth.create_access_token(
        data={"sub": 利用者.利用者ID}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}

@router.post("/ログイン", response_model=schemas.ResponseBase)
def login(request: schemas.LoginRequest, http_request: Request, db: Session = Depends(deps.get_db)):
    利用者 = crud.authenticate_C利用者(db, 利用者ID=request.利用者ID, パスワード=request.パスワード)
    if not 利用者:
        return schemas.ResponseBase(
            status="NG",
            message="利用者IDまたはパスワードが間違っています",
            data={"error": {"code": "AUTH_FAILED"}}
        )

    token_data = issue_token(利用者)
    # 設定から初期ページを取得
    app_conf = getattr(http_request.app, "conf", None)
    初期ページ = app_conf.get("WEBUI_FIRST_PAGE", "") if app_conf else ""
    token_data["初期ページ"] = 初期ページ

    return schemas.ResponseBase(
        status="OK",
        message="ログインしました",
        data=token_data
    )

@router.post("/token", response_model=schemas.Token)
def token(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(deps.get_db)):
    利用者 = crud.authenticate_C利用者(db, 利用者ID=form_data.username, パスワード=form_data.password)
    if not 利用者:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return issue_token(利用者)

@router.post("/ログアウト", response_model=schemas.ResponseBase)
def logout(現在利用者: C利用者 = Depends(deps.get_現在利用者)):
    # JWTはステートレスなのでサーバー側での無効化はブラックリスト等が必要だが
    # 今回はクライアント側でトークン破棄を想定し、レスポンスのみ返す
    return schemas.ResponseBase(
        status="OK",
        message="ログアウトしました"
    )

@router.post("/現在利用者", response_model=schemas.ResponseBase)
def read_現在利用者(現在利用者: C利用者 = Depends(deps.get_現在利用者)):
    return schemas.ResponseBase(
        status="OK",
        message="利用者情報を取得しました",
        data=({'利用者ID': 現在利用者.利用者ID, '利用者名': 現在利用者.利用者名, '権限ID': 現在利用者.権限ID, '認証種別': 'internal'}
              if getattr(現在利用者, '認証種別', '') == 'internal' else schemas.C利用者.model_validate(現在利用者))
    )

@router.post("/トークン更新", response_model=schemas.ResponseBase)
def トークン更新(現在利用者: C利用者 = Depends(deps.get_現在利用者), token: str = Depends(deps.oauth2_scheme)):
    """操作中とみなしてトークンを再発行する（セッション延長）"""
    token_data = {'access_token': token, 'token_type': 'bearer'} if getattr(現在利用者, '認証種別', '') == 'internal' else issue_token(現在利用者)
    return schemas.ResponseBase(
        status="OK",
        message="トークンを更新しました",
        data=token_data
    )


