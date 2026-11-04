# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

from fastapi import Depends, HTTPException, status
from types import SimpleNamespace
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError
from auth_keyring import KeyringError
from sqlalchemy.orm import Session
import auth, database, core_models as models

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/core/auth/token")

def get_db():
    db = database.SessionLocal()
    try:
        yield db
    finally:
        db.close()

def get_現在利用者(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = auth.verify_access_token(token)
        if payload.get("token_kind") == "internal_code_live":
            raise credentials_exception
        利用者ID: str = payload.get("sub")
        if 利用者ID is None:
            raise credentials_exception
    except JWTError:
        try:
            claims = auth.get_keyring().verify(token, '', '')
            # DBに実在する利用者へなりすまさず、通常の権限判定を通るサービス主体。
            return SimpleNamespace(
                利用者ID=claims['sub'], 利用者名='IDE 内部連携', 権限ID='', 有効=True,
                利用者備考=None, 認証種別='internal',
                登録日時='', 登録利用者ID='', 登録利用者名=None, 登録端末ID='',
                更新日時='', 更新利用者ID='', 更新利用者名=None, 更新端末ID='')
        except JWTError:
            raise credentials_exception from None
        except KeyringError:
            raise HTTPException(status_code=503, detail="Authentication service is not ready") from None
    except KeyringError:
        raise HTTPException(status_code=503, detail="Authentication service is not ready") from None

    利用者 = db.query(models.C利用者).filter(models.C利用者.利用者ID == 利用者ID).first()
    if 利用者 is None:
        raise credentials_exception
    return 利用者

