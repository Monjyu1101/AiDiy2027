# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE for full terms.
from hashlib import sha256
import json
from collections.abc import Sequence

from sqlalchemy import delete, func, insert, or_, select, true, update
from sqlalchemy.orm import Session

from apps_crud.utils import create_audit_fields, update_audit_fields
from apps_models.T日誌 import T日誌作業, T日誌明細
from apps_schema.T日誌 import T日誌一覧要求, T日誌保存要求, T日誌検索要求, 日誌記録要求
from list_controls import get_list_limit


def _所有者条件(モデル, 利用者ID: str, 日付: str):
    return (モデル.利用者ID == 利用者ID, モデル.日付 == 日付)


def _日付条件(利用者ID: str, 要求):
    条件 = [T日誌作業.利用者ID == 利用者ID, T日誌作業.有効.is_(True)]
    if 要求.開始日付:
        条件.append(T日誌作業.日付 >= 要求.開始日付)
    if 要求.終了日付:
        条件.append(T日誌作業.日付 <= 要求.終了日付)
    return 条件


def _日別一覧(条件):
    return select(
        T日誌作業.日付, T日誌作業.利用者ID, func.max(T日誌作業.利用者名).label("利用者名"),
        func.count().label("記録件数"),
    ).where(*条件).group_by(T日誌作業.利用者ID, T日誌作業.日付)


def 一覧(db: Session, 利用者ID: str, 要求: T日誌一覧要求):
    query = _日別一覧(_日付条件(利用者ID, 要求))
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    limit = get_list_limit(要求)
    items = db.execute(query.order_by(T日誌作業.日付.desc()).limit(limit)).mappings()
    return {"items": [dict(行) for 行 in items], "total": total, "limit": limit}


def _作業一覧(db: Session, 利用者ID: str, 日付: str):
    return list(db.scalars(select(T日誌作業).where(
        *_所有者条件(T日誌作業, 利用者ID, 日付), T日誌作業.有効.is_(True),
    ).order_by(T日誌作業.記録SEQ)))


def _明細を取得(db: Session, 利用者ID: str, 日付: str):
    return select(T日誌明細).where(*_所有者条件(T日誌明細, 利用者ID, 日付)).order_by(
        T日誌明細.記録SEQ, T日誌明細.行SEQ,
    )


def 取得(db: Session, 利用者ID: str, 日付: str):
    作業 = _作業一覧(db, 利用者ID, 日付)
    if not 作業:
        return None
    記録 = {行.記録SEQ: {"記録SEQ": 行.記録SEQ, "記録タイトル": 行.記録タイトル,
                       "新規更新ファイル数": 行.新規更新ファイル数, "明細": []} for 行 in 作業}
    for 行 in db.scalars(_明細を取得(db, 利用者ID, 日付)):
        if 行.記録SEQ in 記録:
            記録[行.記録SEQ]["明細"].append({"行SEQ": 行.行SEQ, "内容": 行.内容, "添付": 行.添付})
    return {"日付": 日付, "利用者ID": 利用者ID, "利用者名": 作業[0].利用者名, "記録": list(記録.values())}


def 更新版付き(data):
    if data is None:
        return None
    版 = sha256(json.dumps(data, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")).hexdigest()
    return {**data, "更新版": 版}


def _明細書込(db: Session, キー: dict, 行, *, 更新=False):
    値 = {"内容": 行.内容, "添付": [file.model_dump() for file in 行.添付]}
    if 更新:
        db.execute(update(T日誌明細).filter_by(**キー).values(**値))
    else:
        db.execute(insert(T日誌明細).values(**キー, **値))


def _作業登録(db: Session, 認証情報: dict, 日付: str, 記録: Sequence[日誌記録要求], 旧作業=()):
    共通 = {"日付": 日付, **認証情報, **create_audit_fields(認証情報)}
    # 全体保存では従来の日誌と同様、日別の登録監査を維持する。
    if 旧作業:
        共通.update({key: getattr(旧作業[0], key) for key in 共通 if key.startswith("登録")})
    for 作業 in 記録:
        db.execute(insert(T日誌作業).values(**共通,
            記録SEQ=作業.記録SEQ, 記録タイトル=作業.記録タイトル, 新規更新ファイル数=作業.新規更新ファイル数))
        for 行 in 作業.明細:
            _明細書込(db, {"利用者ID": 認証情報["利用者ID"], "日付": 日付,
                         "記録SEQ": 作業.記録SEQ, "行SEQ": 行.行SEQ}, 行)


def 保存(db: Session, 認証情報: dict, 要求: T日誌保存要求, *, 新規: bool):
    利用者ID = 認証情報["利用者ID"]
    日付 = 要求.日付
    with db.begin():
        db.connection(execution_options={"diary_write": True})
        条件 = _所有者条件(T日誌作業, 利用者ID, 日付)
        旧作業 = _作業一覧(db, 利用者ID, 日付)
        if 新規:
            if db.scalar(select(T日誌作業.記録SEQ).where(*条件).limit(1)) is not None:
                return None
        elif not 旧作業:
            return None
        else:
            現在 = 更新版付き(取得(db, 利用者ID, 日付))
            if 現在["更新版"] != 要求.更新版:
                raise 日誌操作エラー(
                    "この日誌は別の画面またはツールで更新されています。入力内容を控え、最新の日誌を開き直してください。",
                    "CONFLICT",
                )
            db.execute(delete(T日誌作業).where(*条件))
        _作業登録(db, 認証情報, 日付, 要求.記録, 旧作業)
        return 更新版付き(取得(db, 利用者ID, 日付))


def 削除(db: Session, 利用者ID: str, 日付: str) -> bool:
    with db.begin():
        return db.execute(delete(T日誌作業).where(*_所有者条件(T日誌作業, 利用者ID, 日付))).rowcount > 0


def 検索(db: Session, 利用者ID: str, 要求: T日誌検索要求):
    条件 = _日付条件(利用者ID, 要求)
    if 語 := 要求.キーワード.strip():
        # JSON配列の名前だけを照合し、Base64の内容は検索・返却しない。
        添付要素 = func.json_each(T日誌明細.添付).table_valued("value")
        添付一致 = select(1).select_from(添付要素).where(
            func.json_extract(添付要素.c.value, '$.ファイル名').icontains(語, autoescape=True),
        ).correlate(T日誌明細).exists()
        明細一致 = select(1).where(
            *_所有者条件(T日誌明細, T日誌作業.利用者ID, T日誌作業.日付),
            T日誌明細.記録SEQ == T日誌作業.記録SEQ,
            or_(T日誌明細.内容.icontains(語, autoescape=True), 添付一致),
        ).exists()
        日別 = _日別一覧(条件).having(func.max(
            or_(T日誌作業.記録タイトル.icontains(語, autoescape=True), 明細一致)
        ) == 1)
    else:
        日別 = _日別一覧(条件)
    total = db.scalar(select(func.count()).select_from(日別.subquery()))
    items = []
    for 日付, *_ in db.execute(日別.order_by(T日誌作業.日付.desc()).offset(要求.offset).limit(要求.limit)):
        作業一覧 = _作業一覧(db, 利用者ID, 日付)
        記録 = {row.記録SEQ: {"記録SEQ": row.記録SEQ, "記録タイトル": row.記録タイトル,
                            "新規更新ファイル数": row.新規更新ファイル数, "明細": []} for row in 作業一覧}
        名前 = {}
        要素 = func.json_each(T日誌明細.添付).table_valued("key", "value")
        添付名 = select(T日誌明細.記録SEQ, T日誌明細.行SEQ, func.json_extract(要素.c.value, '$.ファイル名')).select_from(
            T日誌明細.__table__.join(要素, true()),
        ).where(*_所有者条件(T日誌明細, 利用者ID, 日付)).order_by(
            T日誌明細.記録SEQ, T日誌明細.行SEQ, 要素.c.key,
        )
        for seq, 行SEQ, ファイル名 in db.execute(添付名):
            名前.setdefault((seq, 行SEQ), []).append({"ファイル名": ファイル名})
        明細 = _明細を取得(db, 利用者ID, 日付).with_only_columns(
            T日誌明細.記録SEQ, T日誌明細.行SEQ, func.substr(T日誌明細.内容, 1, 1000), func.length(T日誌明細.内容),
        )
        for seq, 行SEQ, 内容, 長さ in db.execute(明細):
            if seq in 記録:
                記録[seq]["明細"].append({
                    "行SEQ": 行SEQ, "内容": 内容, "内容省略": 長さ > 1000, "添付": 名前.get((seq, 行SEQ), []),
                })
        items.append({"日付": 日付, "利用者ID": 利用者ID, "利用者名": 作業一覧[0].利用者名, "記録": list(記録.values())})
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
        db.connection(execution_options={"diary_write": True})
        現在 = 取得(db, 利用者ID, 日付)
        if 現在 is None and 操作 != "作業登録":
            raise 日誌操作エラー("指定された日付の日誌が見つかりません。")
        if 現在 is None and db.scalar(select(T日誌作業.記録SEQ).where(
            *_所有者条件(T日誌作業, 利用者ID, 日付),
        ).limit(1)) is not None:
            raise 日誌操作エラー("指定された日付の日誌は無効です。")
        記録 = 現在["記録"] if 現在 else []
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
                    明細.append({"内容": 要求.内容, "添付": [file.model_dump() for file in (要求.添付 or [])]})
                else:
                    対象行 = next((行 for 行 in 明細 if 行["行SEQ"] == 要求.行SEQ), None)
                    if 対象行 is None:
                        raise 日誌操作エラー("指定された明細が見つかりません。")
                    結果["行SEQ"] = 要求.行SEQ
                    if 操作 == "内容変更":
                        if 要求.内容 is not None:
                            対象行["内容"] = 要求.内容
                        if 要求.添付 is not None:
                            対象行["添付"] = [file.model_dump() for file in 要求.添付]
                    else:  # 内容削除
                        明細.remove(対象行)
        for i, 作業 in enumerate(記録, 1):
            作業["記録SEQ"] = i
            for j, 行 in enumerate(作業["明細"], 1):
                行["行SEQ"] = j
        保存要求 = T日誌保存要求(日付=日付, 記録=記録) if 記録 else None
        記録SEQ = 結果["記録SEQ"]
        作業条件 = (*_所有者条件(T日誌作業, 利用者ID, 日付), T日誌作業.記録SEQ == 記録SEQ)
        明細条件 = (*_所有者条件(T日誌明細, 利用者ID, 日付), T日誌明細.記録SEQ == 記録SEQ)
        if 操作 == "作業登録":
            _作業登録(db, 認証情報, 日付, 保存要求.記録[-1:])
        elif 操作 == "作業変更":
            作業 = 保存要求.記録[記録SEQ - 1]
            db.execute(update(T日誌作業).where(*作業条件).values(
                記録タイトル=作業.記録タイトル, 新規更新ファイル数=作業.新規更新ファイル数,
                **update_audit_fields(認証情報),
            ))
        elif 操作 == "作業削除":
            db.execute(delete(T日誌作業).where(*作業条件))
            for 作業 in 保存要求.記録[記録SEQ - 1:] if 保存要求 is not None else []:
                db.execute(update(T日誌作業).where(
                    *_所有者条件(T日誌作業, 利用者ID, 日付), T日誌作業.記録SEQ == 作業.記録SEQ + 1,
                ).values(記録SEQ=作業.記録SEQ))
        else:
            db.execute(update(T日誌作業).where(*作業条件).values(**update_audit_fields(認証情報)))
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
