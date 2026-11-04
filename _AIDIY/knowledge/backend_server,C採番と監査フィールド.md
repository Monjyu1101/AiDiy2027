# C採番と監査フィールド

> 文書: `backend_server,C採番と監査フィールド.md` | 実装: `backend_server/core_crud/C採番.py`, `backend_server/core_router/C採番.py`

## このメモを使う場面
- 新規レコード登録時に ID を採番する
- 登録・更新時に監査フィールドを付与する
- 新しい M系 / T系テーブルを追加し、採番対象にするか判断する

## 関連ファイル
- `backend_server/core_crud/C採番.py`
- `backend_server/core_router/C採番.py`
- `backend_server/core_crud/utils.py`
- `backend_server/apps_crud/utils.py`
- `backend_server/apps_crud/init.py`

## 実装手順

### 1. 採番の使い方

新規レコード作成前に `C採番` から ID を取得する。AUTOINCREMENT は使わない。

```python
from core_crud import get_next_id

new_id = get_next_id(db, "テーブル名")
```

API 経由で採番する場合は `POST /core/C採番/採番` を使い、対象テーブル名を渡す。採番IDは原則テーブル名と一致させる。

### 2. 採番IDを初期化する

新しい採番対象を追加したら、`core_crud/C採番.py` の初期データへ対象 `採番ID` を追加する。

`C採番` の初期化関数は既存データがあると return するため、新規 DB 上で初期値を確認する。旧 DB だけを補正する起動時処理は追加しない。Task / Team の各採番確保処理による通常の採番行作成とは区別する。

### 3. 監査フィールドを付与する

全テーブルに以下の 8 フィールドを持たせる。

| フィールド | 登録時 | 更新時 |
|-----------|--------|--------|
| `登録日時` | 設定 | 変更しない |
| `登録利用者ID` | 設定 | 変更しない |
| `登録利用者名` | 設定 | 変更しない |
| `登録端末ID` | 設定 | 変更しない |
| `更新日時` | 設定 | 更新 |
| `更新利用者ID` | 設定 | 更新 |
| `更新利用者名` | 設定 | 更新 |
| `更新端末ID` | 設定 | 更新 |

```python
from apps_crud.utils import create_audit_fields, update_audit_fields

audit = create_audit_fields(認証情報)
record = MyModel(**data.dict(), **audit)

audit = update_audit_fields(認証情報)
for key, value in audit.items():
    setattr(record, key, value)
db.commit()
```

認証情報 dict は `利用者ID` / `利用者名` / `端末ID` を揃える。初期データでは `system` を明示する。

### 4. 初期データ投入時

```python
from apps_crud.utils import create_audit_fields

audit = create_audit_fields({"利用者ID": "system", "利用者名": "system", "端末ID": "system"})
record = MyModel(ID="M001", 名称="サンプル", **audit)
db.add(record)
db.commit()
```

## 注意点

- `C採番` に対象テーブル名のエントリがないと採番が失敗する。
- 更新時に `create_audit_fields()` を使わない。登録系フィールドを上書きしない。
- 監査フィールドを Model 定義に書き忘れると `column not found` になる。
- 既存実装に端末ID省略時の既定値があっても、新規実装では明示する。

## 判断基準

- M系分類マスタなど、利用者が意味のあるIDを入力するマスタは採番不要でよい。
- T系伝票ID、システム生成ID、衝突回避したい連番IDは `C採番` を使う。
- 明細型テーブルはヘッダーIDだけを採番し、`明細SEQ` はリクエスト明細順に `0, 1, 2...` を組み立てる。

## 確認方法

```powershell
sqlite3 _data/AiDiy/database.db "SELECT * FROM C採番"
```

```powershell
cd backend_server
.venv\Scripts\python.exe -m py_compile core_crud\C採番.py apps_crud\utils.py core_crud\utils.py
.venv\Scripts\python.exe -c "import apps_main; import core_main"
```
