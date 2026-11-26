# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE for full terms.
import os
from pathlib import Path

from sqlalchemy import URL, create_engine, delete, event, func, insert, or_, select, update
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from apps_crud.utils import create_audit_fields, update_audit_fields
from apps_models.T日誌 import T日誌, T日誌作業集計, T日誌明細, T日誌添付, T日誌記録, 日誌Base
from apps_schema.T日誌 import T日誌一覧要求, T日誌保存要求, T日誌検索要求
from list_controls import get_list_limit


def 日誌DB初期化() -> Engine:
    """Apps起動時にだけ専用DBを作る。既存データには触れない。"""
    パス = Path.home() / ".aidiy" / "diary" / "diary.db"
    パス.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    try:
        fd = os.open(パス, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        pass
    else:
        os.close(fd)
    db_engine = create_engine(URL.create("sqlite+pysqlite", database=str(パス)), hide_parameters=True)

    @event.listens_for(db_engine, "connect")
    def _接続(接続, _):
        接続.isolation_level = None
        接続.execute("PRAGMA foreign_keys=ON")

    @event.listens_for(db_engine, "begin")
    def _開始(接続):
        接続.exec_driver_sql("BEGIN")

    try:
        日誌Base.metadata.create_all(db_engine)
    except Exception:
        db_engine.dispose()
        raise
    return db_engine


def _所有者条件(モデル, 利用者ID: str, 日付: str):
    return (モデル.利用者ID == 利用者ID, モデル.日付 == 日付)


def 一覧(db: Session, 利用者ID: str, 要求: T日誌一覧要求):
    条件 = [T日誌.利用者ID == 利用者ID, T日誌.有効.is_(True)]
    if 要求.開始日付:
        条件.append(T日誌.日付 >= 要求.開始日付)
    if 要求.終了日付:
        条件.append(T日誌.日付 <= 要求.終了日付)
    記録件数 = (
        select(func.count())
        .select_from(T日誌記録)
        .where(T日誌記録.利用者ID == T日誌.利用者ID, T日誌記録.日付 == T日誌.日付)
        .scalar_subquery()
        .label("記録件数")
    )
    limit = get_list_limit(要求)
    total = db.scalar(select(func.count()).select_from(T日誌).where(*条件))
    query = select(T日誌.日付, T日誌.利用者ID, T日誌.利用者名, 記録件数).where(*条件).order_by(T日誌.日付.desc())
    items = db.execute(query.limit(limit)).mappings()
    return {"items": [dict(行) for 行 in items], "total": total, "limit": limit}


def _自己申告一覧(db: Session, 利用者ID: str, 日付: str):
    return dict(db.execute(select(
        T日誌作業集計.記録SEQ, T日誌作業集計.新規更新ファイル数,
    ).where(*_所有者条件(T日誌作業集計, 利用者ID, 日付))).all())


def 取得(db: Session, 利用者ID: str, 日付: str, *, 旧形式も返す=True):
    見出し = db.get(T日誌, (利用者ID, 日付))
    if 見出し is None or not 見出し.有効:
        return None
    集計 = _自己申告一覧(db, 利用者ID, 日付)
    記録 = {
        行.記録SEQ: {"記録SEQ": 行.記録SEQ, "記録タイトル": 行.記録タイトル,
                  "新規更新ファイル数": 集計.get(行.記録SEQ), "明細": []}
        for 行 in db.scalars(
            select(T日誌記録).where(*_所有者条件(T日誌記録, 利用者ID, 日付)).order_by(T日誌記録.記録SEQ)
        )
    }
    添付一覧 = {}
    for 添付 in db.scalars(select(T日誌添付).where(*_所有者条件(T日誌添付, 利用者ID, 日付)).order_by(
        T日誌添付.記録SEQ, T日誌添付.行SEQ, T日誌添付.添付SEQ,
    )):
        添付一覧.setdefault((添付.記録SEQ, 添付.行SEQ), []).append({
            "ファイル名": 添付.ファイル名, "base64内容": 添付.base64内容,
        })
    for 行 in db.scalars(
        select(T日誌明細).where(*_所有者条件(T日誌明細, 利用者ID, 日付)).order_by(T日誌明細.記録SEQ, T日誌明細.行SEQ)
    ):
        添付 = 添付一覧.get((行.記録SEQ, 行.行SEQ), [])
        if not 添付 and 行.ファイル名 and 行.base64内容:
            添付 = [{"ファイル名": 行.ファイル名, "base64内容": 行.base64内容}]
        明細 = {"行SEQ": 行.行SEQ, "内容": 行.内容, "添付": 添付}
        if 旧形式も返す:
            明細.update(添付[0] if len(添付) == 1 else {"ファイル名": "", "base64内容": ""})
        記録[行.記録SEQ]["明細"].append(明細)
    return {"日付": 日付, "利用者ID": 利用者ID, "利用者名": 見出し.利用者名, "記録": list(記録.values())}


def _明細登録(db: Session, 利用者ID: str, 日付: str, 記録):
    共通 = {"利用者ID": 利用者ID, "日付": 日付}
    db.execute(
        insert(T日誌記録),
        [{**共通, "記録SEQ": 作業.記録SEQ, "記録タイトル": 作業.記録タイトル} for 作業 in 記録],
    )
    集計 = [{**共通, "記録SEQ": 作業.記録SEQ, "新規更新ファイル数": 作業.新規更新ファイル数}
          for 作業 in 記録 if 作業.新規更新ファイル数 is not None]
    if 集計:
        db.execute(insert(T日誌作業集計), 集計)
    for 作業 in 記録:
        for 行 in 作業.明細:
            _明細書込(db, {**共通, "記録SEQ": 作業.記録SEQ, "行SEQ": 行.行SEQ}, 行)


def _明細書込(db: Session, キー: dict, 行, *, 更新=False):
    値 = {"内容": 行.内容, "ファイル名": "", "base64内容": ""}
    if 更新:
        db.execute(update(T日誌明細).filter_by(**キー).values(**値))
        db.execute(delete(T日誌添付).filter_by(**キー))
    else:
        db.execute(insert(T日誌明細).values(**キー, **値))
    添付 = [{**キー, "添付SEQ": i, **file.model_dump()} for i, file in enumerate(行.添付一覧(), 1)]
    if 添付:
        db.execute(insert(T日誌添付), 添付)


def 保存(db: Session, 認証情報: dict, 要求: T日誌保存要求, *, 新規: bool):
    利用者ID = 認証情報["利用者ID"]
    with db.begin():
        if 新規:
            stmt = (
                sqlite_insert(T日誌)
                .values(日付=要求.日付, **認証情報, **create_audit_fields(認証情報))
                .on_conflict_do_nothing(index_elements=[T日誌.利用者ID, T日誌.日付])
            )
        else:
            stmt = (
                update(T日誌)
                .where(*_所有者条件(T日誌, 利用者ID, 要求.日付), T日誌.有効.is_(True))
                .values(利用者名=認証情報["利用者名"], **update_audit_fields(認証情報))
            )
        if db.execute(stmt).rowcount != 1:
            return None
        if not 新規:
            if any(行.添付 is None for 作業 in 要求.記録 for 行 in 作業.明細) or (
                要求.添付形式 is None and not any(作業.明細 for 作業 in 要求.記録)
            ):
                複数添付 = db.scalar(
                    select(T日誌添付.添付SEQ).where(*_所有者条件(T日誌添付, 利用者ID, 要求.日付),
                                                    T日誌添付.添付SEQ > 1).limit(1)
                )
                if 複数添付 is not None:
                    raise 日誌操作エラー("複数添付のある日誌は、対応した編集画面から保存してください。", "VALIDATION_ERROR")
            if 要求.添付形式 is None:
                # 件数欄を持たない旧画面からの上書きで自己申告値を黙って消さない。
                if _自己申告一覧(db, 利用者ID, 要求.日付) and any(
                    "新規更新ファイル数" not in 作業.model_fields_set for 作業 in 要求.記録
                ):
                    raise 日誌操作エラー("自己申告件数のある日誌は、対応した編集画面から保存してください。", "VALIDATION_ERROR")
            # 記録の削除に明細が従う。見出しの更新から再登録までを一つのトランザクションとする。
            db.execute(delete(T日誌記録).where(*_所有者条件(T日誌記録, 利用者ID, 要求.日付)))
        _明細登録(db, 利用者ID, 要求.日付, 要求.記録)
        return 取得(db, 利用者ID, 要求.日付, 旧形式も返す=要求.添付形式 is None)


def 削除(db: Session, 利用者ID: str, 日付: str) -> bool:
    with db.begin():
        return db.execute(delete(T日誌).where(*_所有者条件(T日誌, 利用者ID, 日付))).rowcount == 1


def 検索(db: Session, 利用者ID: str, 要求: T日誌検索要求):
    """日付範囲+リテラル検索。添付のバイナリは取得しない。"""
    条件 = [T日誌.利用者ID == 利用者ID, T日誌.有効.is_(True)]
    if 要求.開始日付:
        条件.append(T日誌.日付 >= 要求.開始日付)
    if 要求.終了日付:
        条件.append(T日誌.日付 <= 要求.終了日付)
    if 語 := 要求.キーワード.strip():
        作業一致 = select(1).where(
            *_所有者条件(T日誌記録, T日誌.利用者ID, T日誌.日付),
            T日誌記録.記録タイトル.icontains(語, autoescape=True),
        ).exists()
        明細一致 = select(1).where(
            *_所有者条件(T日誌明細, T日誌.利用者ID, T日誌.日付),
            or_(T日誌明細.内容.icontains(語, autoescape=True), T日誌明細.ファイル名.icontains(語, autoescape=True)),
        ).exists()
        添付一致 = select(1).where(
            *_所有者条件(T日誌添付, T日誌.利用者ID, T日誌.日付),
            T日誌添付.ファイル名.icontains(語, autoescape=True),
        ).exists()
        条件.append(or_(作業一致, 明細一致, 添付一致))
    total = db.scalar(select(func.count()).select_from(T日誌).where(*条件))
    items = []
    for 見出し in db.scalars(select(T日誌).where(*条件).order_by(T日誌.日付.desc()).offset(要求.offset).limit(要求.limit)):
        日付 = 見出し.日付
        集計 = _自己申告一覧(db, 利用者ID, 日付)
        記録 = {
            行.記録SEQ: {"記録SEQ": 行.記録SEQ, "記録タイトル": 行.記録タイトル,
                      "新規更新ファイル数": 集計.get(行.記録SEQ), "明細": []}
            for 行 in db.scalars(select(T日誌記録).where(
                *_所有者条件(T日誌記録, 利用者ID, 日付),
            ).order_by(T日誌記録.記録SEQ))
        }
        明細 = select(
            T日誌明細.記録SEQ, T日誌明細.行SEQ, T日誌明細.内容, T日誌明細.ファイル名,
        ).where(*_所有者条件(T日誌明細, 利用者ID, 日付)).order_by(T日誌明細.記録SEQ, T日誌明細.行SEQ)
        名前 = {}
        for seq, 行SEQ, ファイル名 in db.execute(
            select(T日誌添付.記録SEQ, T日誌添付.行SEQ, T日誌添付.ファイル名)
            .where(*_所有者条件(T日誌添付, 利用者ID, 日付))
            .order_by(T日誌添付.記録SEQ, T日誌添付.行SEQ, T日誌添付.添付SEQ)
        ):
            名前.setdefault((seq, 行SEQ), []).append(ファイル名)
        for seq, 行SEQ, 内容, ファイル名 in db.execute(明細):
            添付名 = 名前.get((seq, 行SEQ), [ファイル名] if ファイル名 else [])
            記録[seq]["明細"].append({
                "行SEQ": 行SEQ, "内容": 内容[:1000], "内容省略": len(内容) > 1000,
                "ファイル名": 添付名[0] if len(添付名) == 1 else "", "添付": [{"ファイル名": name} for name in 添付名],
            })
        items.append({"日付": 日付, "利用者ID": 利用者ID, "利用者名": 見出し.利用者名, "記録": list(記録.values())})
    return {"items": items, "total": total, "limit": 要求.limit, "offset": 要求.offset}


class 日誌操作エラー(Exception):
    def __init__(self, メッセージ: str, コード: str = "NOT_FOUND"):
        super().__init__(メッセージ)
        self.コード = コード


def 部分操作(db: Session, 認証情報: dict, 要求, 操作: str):
    """既存 Web の連番・検証規則を守り、書込ロック内の最新状態だけを編集する。"""
    利用者ID = 認証情報["利用者ID"]
    日付 = 要求.日付
    # 読み取りより先に書き込みトランザクションを取得し、同時追加の採番競合を防ぐ。
    with db.begin():
        if 操作 == "作業登録":
            db.execute(sqlite_insert(T日誌).values(日付=日付, **認証情報, **create_audit_fields(認証情報))
                       .on_conflict_do_nothing(index_elements=[T日誌.利用者ID, T日誌.日付]))
        db.execute(update(T日誌).where(
            *_所有者条件(T日誌, 利用者ID, 日付), T日誌.有効.is_(True),
        ).values(利用者名=認証情報["利用者名"], **update_audit_fields(認証情報)))
        現在 = 取得(db, 利用者ID, 日付, 旧形式も返す=False)
        if 現在 is None:
            raise 日誌操作エラー("指定された日付の日誌が見つかりません。")
        記録 = 現在["記録"]
        結果 = {"日付": 日付}
        if 操作 == "作業登録":
            結果["記録SEQ"] = len(記録) + 1
            記録.append({"記録タイトル": 要求.記録タイトル, "新規更新ファイル数": 要求.新規更新ファイル数, "明細": []})
        else:
            対象 = next((行 for 行 in 記録 if 行["記録SEQ"] == 要求.記録SEQ), None)
            if 対象 is None:
                raise 日誌操作エラー("指定された作業が見つかりません。")
            結果["記録SEQ"] = 要求.記録SEQ
            if 操作 == "作業変更":
                対象["記録タイトル"] = 要求.記録タイトル
                if "新規更新ファイル数" in 要求.model_fields_set:
                    対象["新規更新ファイル数"] = 要求.新規更新ファイル数
            elif 操作 == "作業削除":
                記録.remove(対象)
            else:
                明細 = 対象["明細"]
                if 操作 == "内容登録":
                    結果["行SEQ"] = len(明細) + 1
                    明細.append({"内容": 要求.内容, "添付": [file.model_dump() for file in 要求.添付一覧()]})
                else:
                    対象行 = next((行 for 行 in 明細 if 行["行SEQ"] == 要求.行SEQ), None)
                    if 対象行 is None:
                        raise 日誌操作エラー("指定された明細が見つかりません。")
                    結果["行SEQ"] = 要求.行SEQ
                    if 操作 == "内容変更":
                        if 要求.内容 is not None:
                            対象行["内容"] = 要求.内容
                        if 要求.添付 is not None or 要求.ファイル名 is not None:
                            if 要求.添付 is None and len(対象行["添付"]) > 1:
                                raise 日誌操作エラー("変更には添付一覧を指定してください。", "VALIDATION_ERROR")
                            対象行["添付"] = [file.model_dump() for file in 要求.添付一覧()]
                    else:  # 内容削除
                        明細.remove(対象行)
        for i, 作業 in enumerate(記録, 1):
            作業["記録SEQ"] = i
            for j, 行 in enumerate(作業["明細"], 1):
                行["行SEQ"] = j
        保存要求 = T日誌保存要求(日付=日付, 記録=記録) if 記録 else None
        記録SEQ = 結果["記録SEQ"]
        作業条件 = (*_所有者条件(T日誌記録, 利用者ID, 日付), T日誌記録.記録SEQ == 記録SEQ)
        明細条件 = (*_所有者条件(T日誌明細, 利用者ID, 日付), T日誌明細.記録SEQ == 記録SEQ)
        if 操作 == "作業登録":
            _明細登録(db, 利用者ID, 日付, 保存要求.記録[-1:])
        elif 操作 == "作業変更":
            db.execute(update(T日誌記録).where(*作業条件).values(
                記録タイトル=保存要求.記録[記録SEQ - 1].記録タイトル,
            ))
            if "新規更新ファイル数" in 要求.model_fields_set:
                キー = {"利用者ID": 利用者ID, "日付": 日付, "記録SEQ": 記録SEQ}
                db.execute(delete(T日誌作業集計).filter_by(**キー))
                if 要求.新規更新ファイル数 is not None:
                    db.execute(insert(T日誌作業集計).values(**キー, 新規更新ファイル数=要求.新規更新ファイル数))
        elif 操作 == "作業削除":
            # 親の主キー変更では外部キーが追従しない。連番が変わる作業だけ再挿入する。
            db.execute(delete(T日誌記録).where(
                *_所有者条件(T日誌記録, 利用者ID, 日付), T日誌記録.記録SEQ >= 記録SEQ,
            ))
            残り = 保存要求.記録[記録SEQ - 1:] if 保存要求 is not None else []
            if 残り:
                _明細登録(db, 利用者ID, 日付, 残り)
        else:
            行SEQ = 結果["行SEQ"]
            行条件 = (*明細条件, T日誌明細.行SEQ == 行SEQ)
            作業明細 = 保存要求.記録[記録SEQ - 1].明細
            if 操作 == "内容削除":
                db.execute(delete(T日誌明細).where(*行条件))
                for 行 in 作業明細[行SEQ - 1:]:
                    db.execute(update(T日誌明細).where(
                        *明細条件, T日誌明細.行SEQ == 行.行SEQ + 1,
                    ).values(行SEQ=行.行SEQ))
            else:
                _明細書込(
                    db, {"利用者ID": 利用者ID, "日付": 日付, "記録SEQ": 記録SEQ, "行SEQ": 行SEQ},
                    作業明細[行SEQ - 1], 更新=操作 == "内容変更",
                )
        return 結果
