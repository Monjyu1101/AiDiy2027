# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE for full terms.
from hashlib import sha256
import json
from collections.abc import Sequence

from sqlalchemy import and_, delete, func, insert, or_, select, true, update
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

import database
from core_models import C採番

from apps_crud.utils import create_audit_fields, update_audit_fields
from apps_models.T日誌 import T日誌作業, T日誌明細
from apps_schema.T日誌 import T日誌一覧検索要求, T日誌一覧要求, T日誌保存要求, T日誌検索要求, 日誌記録要求, 最大作業ID
from list_controls import get_list_limit


def _所有者条件(モデル, 利用者ID: str, 日誌日付: str):
    return (モデル.利用者ID == 利用者ID, モデル.日誌日付 == 日誌日付)


def _日付条件(要求, 利用者ID: str | None = None):
    条件 = [T日誌作業.有効.is_(True)]
    if 利用者ID is not None:
        条件.append(T日誌作業.利用者ID == 利用者ID)
    if 要求.開始日付:
        条件.append(T日誌作業.日誌日付 >= 要求.開始日付)
    if 要求.終了日付:
        条件.append(T日誌作業.日誌日付 <= 要求.終了日付)
    return 条件


def _日別一覧(条件):
    return select(
        T日誌作業.日誌日付, T日誌作業.利用者ID, func.max(T日誌作業.利用者名).label("利用者名"),
        func.count().label("記録件数"),
    ).where(*条件).group_by(T日誌作業.利用者ID, T日誌作業.日誌日付)


def _キーワード一致(語: str):
    # JSON配列の名前だけを照合し、Base64の内容は検索・返却しない。
    添付要素 = func.json_each(T日誌明細.添付).table_valued("value")
    添付一致 = select(1).select_from(添付要素).where(
        func.json_extract(添付要素.c.value, '$.ファイル名').icontains(語, autoescape=True),
    ).correlate(T日誌明細).exists()
    明細一致 = select(1).where(
        T日誌明細.作業ID == T日誌作業.作業ID,
        or_(T日誌明細.作業内容.icontains(語, autoescape=True), 添付一致),
    ).exists()
    return or_(T日誌作業.作業タイトル.icontains(語, autoescape=True),
               T日誌作業.プロジェクト.icontains(語, autoescape=True), 明細一致)


def 一覧(db: Session, 利用者ID: str, 要求: T日誌一覧要求):
    return _一覧結果(db, _日別一覧(_日付条件(要求, 利用者ID)), 要求)


def 一覧検索(db: Session, 要求: T日誌一覧検索要求):
    query = _日別一覧(_日付条件(要求, 要求.利用者ID or None))
    作業条件 = []
    if 要求.プロジェクト:
        作業条件.append(T日誌作業.プロジェクト == 要求.プロジェクト)
    if 語 := 要求.キーワード.strip():
        作業条件.append(_キーワード一致(語))
    if 作業条件:
        # 同じ作業で全条件を満たす日を表示し、記録件数は日誌全体の件数を維持する。
        query = query.having(func.max(and_(*作業条件)) == 1)
    return _一覧結果(db, query, 要求)


def _一覧結果(db: Session, query, 要求: T日誌一覧要求):
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    limit = get_list_limit(要求)
    items = db.execute(query.order_by(T日誌作業.日誌日付.desc(), T日誌作業.利用者ID).limit(limit)).mappings()
    return {"items": [dict(行) for 行 in items], "total": total, "limit": limit}


def 一覧候補(db: Session, 所有者: dict):
    有効 = T日誌作業.有効.is_(True)
    利用者 = {
        row.利用者ID: dict(row)
        for row in db.execute(select(
            T日誌作業.利用者ID, func.max(T日誌作業.利用者名).label("利用者名"),
        ).where(有効).group_by(T日誌作業.利用者ID)).mappings()
    }
    利用者[所有者["利用者ID"]] = 所有者
    プロジェクト = db.scalars(select(T日誌作業.プロジェクト).where(
        有効, T日誌作業.プロジェクト != "",
    ).distinct().order_by(T日誌作業.プロジェクト))
    return {"利用者": [利用者[key] for key in sorted(利用者)], "プロジェクト": list(プロジェクト)}


def _作業一覧(db: Session, 利用者ID: str, 日誌日付: str):
    return list(db.scalars(select(T日誌作業).where(
        *_所有者条件(T日誌作業, 利用者ID, 日誌日付), T日誌作業.有効.is_(True),
    ).order_by(T日誌作業.作業ID)))


def _明細の所有者条件(利用者ID: str, 日誌日付: str):
    return (*_所有者条件(T日誌作業, 利用者ID, 日誌日付), T日誌作業.有効.is_(True))


def _明細を取得(利用者ID: str, 日誌日付: str):
    return select(T日誌明細).join(T日誌作業).where(*_明細の所有者条件(利用者ID, 日誌日付)).order_by(
        T日誌明細.作業ID, T日誌明細.行番号,
    )


def 取得(db: Session, 利用者ID: str, 日誌日付: str):
    作業 = _作業一覧(db, 利用者ID, 日誌日付)
    if not 作業:
        return None
    記録 = {行.作業ID: {"作業ID": 行.作業ID, "作業タイトル": 行.作業タイトル,
                       "プロジェクト": 行.プロジェクト,
                       "新規更新ファイル数": 行.新規更新ファイル数, "明細": []} for 行 in 作業}
    for 行 in db.scalars(_明細を取得(利用者ID, 日誌日付)):
        if 行.作業ID in 記録:
            記録[行.作業ID]["明細"].append({"行番号": 行.行番号, "作業内容": 行.作業内容, "添付": 行.添付})
    return {"日誌日付": 日誌日付, "利用者ID": 利用者ID, "利用者名": 作業[0].利用者名, "記録": list(記録.values())}


def 更新版付き(data):
    if data is None:
        return None
    版 = sha256(json.dumps(data, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")).hexdigest()
    return {**data, "更新版": 版}


def _明細書込(db: Session, キー: dict, 行, *, 更新=False):
    値 = {"作業内容": 行.作業内容, "添付": [file.model_dump() for file in 行.添付]}
    if 更新:
        db.execute(update(T日誌明細).filter_by(**キー).values(**値))
    else:
        db.execute(insert(T日誌明細).values(**キー, **値))


def _作業ID採番(db: Session, 認証情報: dict, 件数: int) -> range:
    """業務DBのC採番からまとめて払い出す。日誌DBの保存失敗による欠番は再利用しない。"""
    if not 件数:
        return range(0)
    採番ID = "T日誌作業"
    # 日誌DBに既存のIDがある場合、採番値の手動変更などで衝突しないようにする。
    下限 = db.scalar(select(func.max(T日誌作業.作業ID))) or 0
    with database.SessionLocal.begin() as 採番DB:
        採番DB.execute(sqlite_insert(C採番).values(
            採番ID=採番ID, 最終採番値=10000, 採番備考="日誌作業の採番", 有効=True,
            **create_audit_fields(認証情報),
        ).on_conflict_do_nothing(index_elements=[C採番.採番ID]))
        終値 = 採番DB.scalar(update(C採番).where(
            C採番.採番ID == 採番ID, C採番.有効.is_(True),
            func.max(C採番.最終採番値, 下限) <= 最大作業ID - 件数,
        ).values(
            最終採番値=func.max(C採番.最終採番値, 下限) + 件数,
            **update_audit_fields(認証情報),
        ).returning(C採番.最終採番値))
        if 終値 is None:
            raise 日誌操作エラー("C採番の「T日誌作業」が無効か上限に達しています。", "NUMBERING_UNAVAILABLE")
    return range(終値 - 件数 + 1, 終値 + 1)


def _作業項目(作業: 日誌記録要求):
    return 作業.model_dump(include={"プロジェクト", "作業タイトル", "新規更新ファイル数"})


def _作業登録(db: Session, 認証情報: dict, 日誌日付: str, 作業: 日誌記録要求, 作業ID: int):
    db.execute(insert(T日誌作業).values(
        作業ID=作業ID, 日誌日付=日誌日付, **認証情報,
        **create_audit_fields(認証情報), **_作業項目(作業),
    ))
    _明細登録(db, 作業ID, 作業)


def _明細登録(db: Session, 作業ID: int, 作業: 日誌記録要求):
    for 行 in 作業.明細:
        _明細書込(db, {"作業ID": 作業ID, "行番号": 行.行番号}, 行)


def 保存(db: Session, 認証情報: dict, 要求: T日誌保存要求, *, 新規: bool):
    利用者ID = 認証情報["利用者ID"]
    日誌日付 = 要求.日誌日付
    with db.begin():
        db.connection(execution_options={"diary_write": True})
        条件 = _所有者条件(T日誌作業, 利用者ID, 日誌日付)
        旧作業 = _作業一覧(db, 利用者ID, 日誌日付)
        if 新規:
            if db.scalar(select(T日誌作業.作業ID).where(*条件).limit(1)) is not None:
                return None
        elif not 旧作業:
            return None
        else:
            現在 = 更新版付き(取得(db, 利用者ID, 日誌日付))
            if 現在["更新版"] != 要求.更新版:
                raise 日誌操作エラー(
                    "この日誌は別の画面またはツールで更新されています。入力内容を控え、最新の日誌を開き直してください。",
                    "CONFLICT",
                )
        送信ID = {作業.作業ID for 作業 in 要求.記録 if 作業.作業ID is not None}
        既存ID = {作業.作業ID for 作業 in 旧作業}
        if not 送信ID <= 既存ID:
            raise 日誌操作エラー("この日誌にない作業IDが指定されました。", "VALIDATION_ERROR")
        新規ID = iter(_作業ID採番(db, 認証情報, len(要求.記録) - len(送信ID)))
        削除ID = 既存ID - 送信ID
        if 削除ID:
            db.execute(delete(T日誌作業).where(*条件, T日誌作業.作業ID.in_(削除ID)))
        for 作業 in 要求.記録:
            if 作業.作業ID is None:
                _作業登録(db, 認証情報, 日誌日付, 作業, next(新規ID))
                continue
            db.execute(update(T日誌作業).where(*条件, T日誌作業.作業ID == 作業.作業ID).values(
                **_作業項目(作業), **update_audit_fields(認証情報),
            ))
            db.execute(delete(T日誌明細).where(T日誌明細.作業ID == 作業.作業ID))
            _明細登録(db, 作業.作業ID, 作業)
        return 更新版付き(取得(db, 利用者ID, 日誌日付))


def 削除(db: Session, 利用者ID: str, 日誌日付: str) -> bool:
    with db.begin():
        return db.execute(delete(T日誌作業).where(*_所有者条件(T日誌作業, 利用者ID, 日誌日付))).rowcount > 0


def 検索(db: Session, 利用者ID: str, 要求: T日誌検索要求):
    条件 = _日付条件(要求, 利用者ID)
    日別 = _日別一覧(条件)
    if 語 := 要求.キーワード.strip():
        日別 = 日別.having(func.max(_キーワード一致(語)) == 1)
    total = db.scalar(select(func.count()).select_from(日別.subquery()))
    items = []
    for 日誌日付, *_ in db.execute(日別.order_by(T日誌作業.日誌日付.desc()).offset(要求.offset).limit(要求.limit)):
        作業一覧 = _作業一覧(db, 利用者ID, 日誌日付)
        記録 = {row.作業ID: {"作業ID": row.作業ID, "作業タイトル": row.作業タイトル,
                            "プロジェクト": row.プロジェクト,
                            "新規更新ファイル数": row.新規更新ファイル数, "明細": []} for row in 作業一覧}
        名前 = {}
        要素 = func.json_each(T日誌明細.添付).table_valued("key", "value")
        添付名 = select(T日誌明細.作業ID, T日誌明細.行番号, func.json_extract(要素.c.value, '$.ファイル名')).select_from(
            T日誌明細.__table__.join(T日誌作業.__table__).join(要素, true()),
        ).where(*_明細の所有者条件(利用者ID, 日誌日付)).order_by(
            T日誌明細.作業ID, T日誌明細.行番号, 要素.c.key,
        )
        for seq, 行番号, ファイル名 in db.execute(添付名):
            名前.setdefault((seq, 行番号), []).append({"ファイル名": ファイル名})
        明細 = _明細を取得(利用者ID, 日誌日付).with_only_columns(
            T日誌明細.作業ID, T日誌明細.行番号, func.substr(T日誌明細.作業内容, 1, 1000), func.length(T日誌明細.作業内容),
        )
        for seq, 行番号, 作業内容, 長さ in db.execute(明細):
            if seq in 記録:
                記録[seq]["明細"].append({
                    "行番号": 行番号, "作業内容": 作業内容, "内容省略": 長さ > 1000, "添付": 名前.get((seq, 行番号), []),
                })
        items.append({"日誌日付": 日誌日付, "利用者ID": 利用者ID, "利用者名": 作業一覧[0].利用者名, "記録": list(記録.values())})
    return {"items": items, "total": total, "limit": 要求.limit, "offset": 要求.offset}


class 日誌操作エラー(Exception):
    def __init__(self, メッセージ: str, コード: str = "NOT_FOUND"):
        super().__init__(メッセージ)
        self.コード = コード


def 部分操作(db: Session, 認証情報: dict, 要求, 操作: str):
    """固定の作業IDと明細の行番号で、書込ロック内の最新状態を編集する。"""
    利用者ID = 認証情報["利用者ID"]
    日誌日付 = 要求.日誌日付
    # 読み取りより先に書き込みトランザクションを取得し、同時追加の採番競合を防ぐ。
    with db.begin():
        db.connection(execution_options={"diary_write": True})
        現在 = 取得(db, 利用者ID, 日誌日付)
        if 現在 is None and 操作 != "作業登録":
            raise 日誌操作エラー("指定された日付の日誌が見つかりません。")
        if 現在 is None and db.scalar(select(T日誌作業.作業ID).where(
            *_所有者条件(T日誌作業, 利用者ID, 日誌日付),
        ).limit(1)) is not None:
            raise 日誌操作エラー("指定された日付の日誌は無効です。")
        記録 = 現在["記録"] if 現在 else []
        結果 = {"日誌日付": 日誌日付}
        if 操作 == "作業登録":
            記録.append({"作業タイトル": 要求.作業タイトル, "プロジェクト": 要求.プロジェクト, "新規更新ファイル数": 要求.新規更新ファイル数, "明細": []})
        else:
            対象 = next((行 for 行 in 記録 if 行["作業ID"] == 要求.作業ID), None)
            if 対象 is None:
                raise 日誌操作エラー("指定された作業が見つかりません。")
            結果["作業ID"] = 要求.作業ID
            if 操作 == "作業変更":
                対象["作業タイトル"] = 要求.作業タイトル
                if "プロジェクト" in 要求.model_fields_set:
                    対象["プロジェクト"] = 要求.プロジェクト
                if "新規更新ファイル数" in 要求.model_fields_set:
                    対象["新規更新ファイル数"] = 要求.新規更新ファイル数
            elif 操作 == "作業削除":
                記録.remove(対象)
            else:
                明細 = 対象["明細"]
                if 操作 == "内容登録":
                    結果["行番号"] = len(明細) + 1
                    明細.append({"作業内容": 要求.作業内容, "添付": [file.model_dump() for file in (要求.添付 or [])]})
                else:
                    対象行 = next((行 for 行 in 明細 if 行["行番号"] == 要求.行番号), None)
                    if 対象行 is None:
                        raise 日誌操作エラー("指定された明細が見つかりません。")
                    結果["行番号"] = 要求.行番号
                    if 操作 == "内容変更":
                        if 要求.作業内容 is not None:
                            対象行["作業内容"] = 要求.作業内容
                        if 要求.添付 is not None:
                            対象行["添付"] = [file.model_dump() for file in 要求.添付]
                    else:  # 内容削除
                        明細.remove(対象行)
        for 作業 in 記録:
            for j, 行 in enumerate(作業["明細"], 1):
                行["行番号"] = j
        保存要求 = T日誌保存要求(日誌日付=日誌日付, 記録=記録) if 記録 else None
        if 操作 == "作業登録":
            作業ID = _作業ID採番(db, 認証情報, 1).start
            _作業登録(db, 認証情報, 日誌日付, 保存要求.記録[-1], 作業ID)
            return {**結果, "作業ID": 作業ID}
        作業ID = 結果["作業ID"]
        作業条件 = (*_所有者条件(T日誌作業, 利用者ID, 日誌日付), T日誌作業.作業ID == 作業ID)
        # 上で所有者の日誌から作業IDを確認済み。明細はそのIDだけで特定できる。
        明細条件 = (T日誌明細.作業ID == 作業ID,)
        if 操作 == "作業変更":
            作業 = next(行 for 行 in 保存要求.記録 if 行.作業ID == 作業ID)
            db.execute(update(T日誌作業).where(*作業条件).values(
                **_作業項目(作業), **update_audit_fields(認証情報),
            ))
        elif 操作 == "作業削除":
            db.execute(delete(T日誌作業).where(*作業条件))
        else:
            db.execute(update(T日誌作業).where(*作業条件).values(**update_audit_fields(認証情報)))
            行番号 = 結果["行番号"]
            行条件 = (*明細条件, T日誌明細.行番号 == 行番号)
            作業明細 = next(行.明細 for 行 in 保存要求.記録 if 行.作業ID == 作業ID)
            if 操作 == "内容削除":
                db.execute(delete(T日誌明細).where(*行条件))
                for 行 in 作業明細[行番号 - 1:]:
                    db.execute(update(T日誌明細).where(
                        *明細条件, T日誌明細.行番号 == 行.行番号 + 1,
                    ).values(行番号=行.行番号))
            else:
                _明細書込(
                    db, {"作業ID": 作業ID, "行番号": 行番号},
                    作業明細[行番号 - 1], 更新=操作 == "内容変更",
                )
        return 結果
