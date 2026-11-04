# V系エンドポイント追加手順

> 文書: `backend_server,V系エンドポイント追加手順.md` | 実装: `backend_server/apps_router/V*.py`, `backend_server/apps_main.py`

## このメモを使う場面
- M系 / T系テーブルを JOIN して一覧表示するエンドポイントを追加する
- DB VIEW を使わずに生 SQL で JOIN / 集計する
- 一覧件数制限、有効フィルター、最終更新日時をそろえる

## 関連ファイル
- `backend_server/apps_router/V*.py`
- `backend_server/apps_main.py`
- `backend_server/apps_schema/common.py`
- `backend_server/list_controls.py`

## 実装手順

### 1. Router を作る

V系は POST メソッドで統一する。DB VIEW オブジェクトは作らず、生 SQL（`text()`）で実装する。

```python
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import Optional
import apps_schema as schemas, deps, apps_models as models
from list_controls import append_active_condition, get_limit_clause

router = APIRouter(prefix="/apps/V商品", tags=["V商品"])

@router.post("/一覧", response_model=schemas.ResponseBase)
def 商品一覧(request: Optional[schemas.ListRequest] = None,
             db: Session = Depends(deps.get_db),
             現在利用者: models.C利用者 = Depends(deps.get_現在利用者)):
    conditions = []
    params = {}
    append_active_condition(conditions, request, "M.有効")
    if request and getattr(request, "商品名", None):
        conditions.append("M.商品名 LIKE :商品名")
        params["商品名"] = f"%{request.商品名}%"

    limit_sql, limit_value = get_limit_clause(request)
    if limit_value is not None:
        params["limit"] = limit_value

    where_sql = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    sql = f"""
        SELECT
            M.商品ID,
            M.商品名,
            C.分類名
        FROM M商品 M
        LEFT JOIN M商品分類 C ON M.分類ID = C.分類ID
        {where_sql}
        ORDER BY M.商品ID
        {limit_sql}
    """
    rows = db.execute(text(sql), params).fetchall()
    items = [dict(row._mapping) for row in rows]
    return {"status": "OK", "data": {"items": items, "total": len(items)}}
```

### 2. `apps_main.py` に登録する

```python
from apps_router import V商品
app.include_router(V商品.router)
```

### 3. 件数制限・有効フィルターを入れる

V系の一覧は `backend_server/list_controls.py` を使う。`request=None` でも既定で「件数制限あり・有効のみ」になる。

```python
from list_controls import append_active_condition, get_limit_clause

conditions = []
append_active_condition(conditions, request, "M.有効")
limit_sql, limit_value = get_limit_clause(request)
params = {}
if limit_value is not None:
    params["limit"] = limit_value

where_sql = f"WHERE {' AND '.join(conditions)}" if conditions else ""
sql = f"""
SELECT ...
FROM M商品 M
{where_sql}
ORDER BY M.商品ID
{limit_sql}
"""
rows = db.execute(text(sql), params).fetchall()
total = db.execute(text(f"SELECT count(*) FROM M商品 M {where_sql}"), params).scalar()
```

`conditions` を後から追加した場合は `where_sql` を作り直す。`V商品.py` の分類絞り込みが参考になる。

### 4. 最終更新日時エンドポイントを作る

一覧元テーブルの更新監視用に軽量エンドポイントを作る。

```python
@router.post("/最終更新日時")
def 最終更新日時(db: Session = Depends(deps.get_db),
            現在利用者: models.C利用者 = Depends(deps.get_現在利用者)):
    row = db.execute(text("SELECT MAX(更新日時) as 最終更新日時 FROM M商品")).fetchone()
    return {"status": "OK", "data": {"最終更新日時": row[0]}}
```

## list_controls の関数シグネチャ

```python
# backend_server/list_controls.py
LIMITED_MAX_ITEMS = 1000

def get_limit_clause(request) -> tuple[str, Optional[int]]:
    # → ("LIMIT :limit", 1000)  または ("", None)（件数制限なし時）

def append_active_condition(conditions: list[str], request, column_name: str) -> None:
    # request.無効も表示=False（既定）なら conditions に "{column_name} = 1" を追加

def apply_active_filter(query, model, request):
    # ORM クエリ用。生SQLなら append_active_condition を使う
```

`request` が `None` のときは `getattr(request, "件数制限", None)` → `None` → `True`（制限あり）、`getattr(request, "無効も表示", None)` → `None` → `False`（有効のみ）として動くため、`request=None` でも安全に使える。

## 注意点

- 呼び出し側が V系一覧を使う前提の場合、M系 / T系エンドポイントだけでは一覧取得が動かない。
- `dict(row._mapping)` で行を辞書化する。`row._asdict()` は使わない。
- 生 SQL のカラム名は DB のカラム名と完全一致させる。
- LIMIT は `get_limit_clause()` を使い、値は `params["limit"]` に渡す。
- f-string は固定SQL断片（`where_sql` / `limit_sql` など）の組み立てに限定する。
- テーブル名・カラム名のような識別子は bind parameter にできない。動的にする必要がある場合は、許可リストで選んだ固定文字列だけを SQL に埋め込む。
- `WHERE` 条件の値は必ず `params` に入れる。ユーザー入力を f-string で直接結合しない。
- 集計系 V（例: 商品推移表）は必ずしも生SQLだけに寄せなくてよい。期間前在庫や同日イベント優先度など、SQLだけだと読みにくい業務計算は Python 側で整形してよい。
- 最終更新日時は、一覧の元になる全テーブルの `MAX(更新日時)` を考慮する。JOIN先マスタ名だけが変わる機能なら、マスタ側更新も監視対象に含めるかを判断する。

## 確認方法

```powershell
cd backend_server
.venv\Scripts\python.exe -m py_compile apps_router\V<名称>.py
.venv\Scripts\python.exe -c "import apps_main"
```

- Swagger `http://127.0.0.1:8098/docs` で `/一覧` と `/最終更新日時` を実行する。
- `無効も表示=False` で有効データのみ返ることを確認する。
- `件数制限=True` で LIMIT が効くことを確認する。
- 検索条件や分類条件がある場合、params 経由で絞り込まれることを確認する。
