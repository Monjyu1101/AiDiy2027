# M系マスタ追加・カラム変更手順

> 文書: `backend_server,M系マスタ追加手順.md` | 実装: `backend_server/apps_models/`, `backend_server/apps_schema/`, `backend_server/apps_crud/`, `backend_server/apps_router/`

## このメモを使う場面
- M商品分類 / M商品 と同じ型の M系マスタを追加する
- 分類マスタと本体マスタを対で追加する
- V系一覧で分類名などを JOIN 表示する

## 関連ファイル
- `backend_server/apps_models/`
- `backend_server/apps_schema/`
- `backend_server/apps_crud/`
- `backend_server/apps_router/`
- `backend_server/apps_main.py`
- `backend_server/apps_crud/init.py`

## 実装手順

### 1. Model

- `apps_models/M<名称>.py` に SQLAlchemy Model を作る。
- 共通の監査8項目と `有効` を含める。
- `apps_models/__init__.py` に import を追加する。ここが漏れると `create_all()` の対象にならない。
- `apps_main.py` の `create_all(tables=[...])` に新 Model の `.__table__` を追加する。

### 2. Schema

- `apps_schema/M<名称>.py` に Base / Create / Update / Get / Delete / Response 用 schema を作る。
- `apps_schema/__init__.py` に import を追加する。Router が `apps_schema as schemas` 経由で参照するため必須。

### 3. CRUD

- `apps_crud/M<名称>.py` に get / list / create / update / delete / init 関数を作る。
- `apps_crud/__init__.py` に import と `__all__` を追加する。Router が `apps_crud as crud` 経由で呼ぶ場合に必須。
- 登録時は `create_audit_fields()`、更新時は `update_audit_fields()` を使う。
- 削除は既存パターンに合わせ、論理削除なら `有効=False` にする。

### 4. Router

- `apps_router/M<名称>.py` に `/一覧` `/取得` `/登録` `/変更` `/削除` を POST で作る。
- `apps_router/V<名称>.py` に一覧表示用 JOIN を作る。呼び出し側の一覧取得は原則 V 系を使う。
- `apps_main.py` に `from apps_router import M<名称>` / `V<名称>` と `app.include_router(...)` を追加する。

### 5. 初期データ

- 初期データが必要な場合は `apps_crud/init.py` へ init 関数 import と初期投入呼び出しを追加する。テーブル作成は `apps_main.py` の `create_all()` へ登録する。
- 初期データ関数は、既存データが1件でもあれば `return` する形を基本にする。起動のたびに upsert して監査項目を更新しない。
- 新規テーブルは `create_all()` で作成する。旧 DB の互換救済を目的とする `DROP TABLE` / `ALTER TABLE` / コピー移行は追加しない。スキーマ変更時は利用者が DB を手動で再作成する。

## 一覧件数と有効フラグ

- V系一覧は `request: Optional[schemas.ListRequest] = None` を受け取り、`list_controls.py` の `append_active_condition()` / `get_limit_clause()` を使う。
- `無効も表示=False` の既定動作では `有効=1` のみ返す。
- `件数制限=True` の既定動作では LIMIT 1000。V系で手書きの固定 LIMIT を入れず、`get_limit_clause()` の返り値を使う。
- 分類条件を使う場合は `apps_schema/common.py` の `ListRequest` に分類IDを追加し、V系 Router で params と WHERE 条件に反映する。

## 注意点

- `apps_crud/__init__.py` の import / `__all__` は漏れやすい。
- 既存テーブルの列不足は現行定義との差分として扱う。自動 `ALTER TABLE` や旧構造へのフォールバックを追加しない。DB再作成の安全な境界は [スキーマ変更手順](./backend_server,スキーマ変更手順.md) に従い、実DBを検証目的で変更しない。
- ユーザーが「マイグレーション不要」とした追加テーブルでは、旧スキーマ救済コードを残さない。`create_all()` と空テーブル時の seed だけにする。
- 呼び出し側が V系一覧を使う前提の場合、M系 Router だけでは一覧取得が動かない。

## 確認方法

```powershell
cd backend_server
.venv\Scripts\python.exe -m py_compile apps_models\M<名称>.py apps_schema\M<名称>.py apps_crud\M<名称>.py apps_router\M<名称>.py apps_router\V<名称>.py
```

- 専用の一時DBで新テーブルの存在、件数、必要カラムを確認する。`apps_main` の import は実DBへ接続・作成するため、構文確認の代用にしない。
- Swagger `http://127.0.0.1:8098/docs` で M系 / V系エンドポイントを確認する。
- V系一覧で有効フィルター、件数制限、分類条件が効くことを確認する。

## 既存マスタのカラム追加

以下の「標準単価」は追加方法を示す例であり、現行 `M商品` に存在する項目ではない。Model / Schema（Base と個別 Update）/ CRUD / 必要な画面と初期データを揃える。

### 実装手順

#### 1. Model にカラム定義を追加

```python
# apps_models/M商品.py
from sqlalchemy import Column, Boolean, Text, Float  # Float を追加
from database import Base

class M商品(Base):
    __tablename__ = "M商品"

    商品ID = Column(Text, primary_key=True)
    商品名 = Column(Text, nullable=False)
    単位 = Column(Text, nullable=False)
    商品分類ID = Column(Text, nullable=False)
    標準単価 = Column(Float)  # 追加（NULL許容）
    商品備考 = Column(Text)
    # ... 監査項目
```

- 型に応じた import を追加する（`Float`, `Integer`, `DateTime` など）
- Optional なカラムは `Column(型)` のみ、必須なら `nullable=False` を指定

#### 2. Schema にフィールドを追加

```python
# apps_schema/M商品.py
from pydantic import BaseModel
from typing import Optional

class M商品Base(BaseModel):
    商品名: str
    単位: str
    商品分類ID: str
    標準単価: Optional[float] = None  # 追加
    商品備考: Optional[str] = None
    有効: bool = True

class M商品Update(BaseModel):
    商品ID: str
    商品名: Optional[str] = None
    単位: Optional[str] = None
    商品分類ID: Optional[str] = None
    標準単価: Optional[float] = None  # 追加
    商品備考: Optional[str] = None
    有効: Optional[bool] = None
```

- `Base` クラスに追加すると `Create` / `Response` にも継承される
- `Update` は個別定義のため手動で追加が必要

#### 3. CRUD の create 関数を更新

```python
# apps_crud/M商品.py
def create_M商品(db: Session, 商品: schemas.M商品Create, 認証情報: Optional[Dict] = None):
    audit = create_audit_fields(認証情報)
    db_商品 = models.M商品(
        商品ID=商品.商品ID,
        商品名=商品.商品名,
        単位=商品.単位,
        商品分類ID=商品.商品分類ID,
        標準単価=商品.標準単価,  # 追加
        商品備考=商品.商品備考,
        有効=True,
        **audit
    )
    db.add(db_商品)
    db.commit()
    db.refresh(db_商品)
    return db_商品
```

#### 4. 新規 DB の定義と初期データを確認

- `create_all()` は既存テーブルの列を更新しない。現行 Model から作成した一時 DB で、新しいカラムの型・NULL 許容・既定値を確認する。
- 初期データで新項目を使う場合は `init_M<名称>_data()` の投入値も調整する。
- `init.py` へ旧列検出や `ALTER TABLE` を追加しない。スキーマ変更後の利用は利用者による手動 DB 再作成を前提とする。
- 詳細は [`backend_server,スキーマ変更手順.md`](./backend_server,スキーマ変更手順.md) を参照する。

### 型の対応表

| Python / Pydantic | SQLAlchemy | SQLite |
|-------------------|------------|--------|
| `float` | `Float` | `REAL` |
| `int` | `Integer` | `INTEGER` |
| `str` | `Text` | `TEXT` |
| `bool` | `Boolean` | `INTEGER` |
| `datetime` | `DateTime` | `TEXT` |

### 注意点

- **関連レイヤーを揃える**: Model / Schema(Base, Update) / CRUD を変更し、必要なら初期データも更新する
- **旧 DB は自動変換しない**: カラム不足を旧スキーマへのフォールバックで隠さず、手動再作成が必要な定義差分として扱う
- **Update schema は Base を継承していない**: 個別に追加が必要
- **Router も確認する**: Schema 経由の項目は反映されるが、手書きの更新代入・SELECT・一覧 JOIN に新項目が必要なら併せて変更する

### 確認方法

```powershell
cd backend_server
.venv\Scripts\python.exe -m py_compile apps_models\M商品.py apps_schema\M商品.py apps_crud\M商品.py apps_crud\init.py
```

DB 検証は `:memory:` または専用の一時ディレクトリへ接続先を固定し、現行 Model から作成した `M商品` の列定義と初期投入・CRUD を確認する。`apps_main` の import は実 DB を作成・接続するため、構文確認の代わりに実行しない。
