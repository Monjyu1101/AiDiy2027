# S系スケジューラ追加手順

> 文書: `backend_server,S系スケジューラ追加手順.md` | 実装: `backend_server/apps_router/S*.py`, `backend_server/apps_main.py`

## このメモを使う場面
- 配車スケジュール・生産スケジュールのような週/日カレンダー用 API を追加する
- ドラッグ更新・リサイズ更新用の backend API を実装する
- スケジュール表示用の整形済みデータを返す

## 関連ファイル
- `backend_server/apps_router/S*.py`
- `backend_server/apps_main.py`
- `backend_server/apps_models/T*.py`
- `backend_server/apps_crud/utils.py`

## 実装手順

S系は以下のエンドポイントをセットで実装する。

| エンドポイント | 用途 |
|--------------|------|
| `POST /apps/S<名称>/<行マスタ>一覧` | スケジュール行（縦軸）の一覧 |
| `POST /apps/S<名称>/<対象>一覧` | スケジュールアイテム一覧（日付範囲指定） |
| `POST /apps/S<名称>/データ` | カレンダー表示用の整形済みデータ |
| `POST /apps/S<名称>/ドラッグ更新` | ドラッグ移動後の日時・行を更新 |
| `POST /apps/S<名称>/リサイズ更新` | リサイズ後の期間を更新 |
| `POST /apps/S<名称>/最終更新日時` | 変更監視用（軽量） |

週表示・日表示を分ける場合は、既存の `S配車_週表示.py` / `S配車_日表示.py`、`S生産_週表示.py` / `S生産_日表示.py` のように Router ファイルも分ける。`apps_main.py` には両方を import し、両方 `include_router` する。

### Request クラス

```python
class データRequest(BaseModel):
    開始日付: str  # YYYY-MM-DD
    終了日付: str
    利用者ID: str | None = None

class ドラッグ更新Request(BaseModel):
    ID: str
    新開始日付: str
    新終了日付: str
    新行ID: str  # 車両IDや工程IDなど
    # 認証情報
    利用者ID: str
    利用者名: str
    端末ID: str
```

### ドラッグ更新・リサイズ更新

```python
@router.post("/ドラッグ更新")
def ドラッグ更新(request: ドラッグ更新Request, db: Session = Depends(get_db),
                current_user = Depends(get_current_user)):
    record = db.query(T配車).filter(
        T配車.配車ID == request.ID, T配車.明細SEQ == 0
    ).first()
    if not record:
        return {"status": "NG", "message": "対象データなし"}
    record.開始日付 = request.新開始日付
    record.終了日付 = request.新終了日付
    record.車両ID   = request.新行ID
    audit = update_audit_fields(request.dict())
    for k, v in audit.items():
        setattr(record, k, v)
    db.commit()
    return {"status": "OK", "message": "更新しました"}
```

## 判断基準

- 行マスタ（車両・工程など）は `有効=True` で絞るか、既存の「無効も表示」方針と合わせる。
- スケジュール対象が明細型 T 系の場合、表示・更新対象はヘッダー行だけにする。条件に `明細SEQ == 0` を入れる。
- 表示範囲は指定範囲ぴったりではなく、ドラッグや横スクロールのため前後に余白を持たせてもよい。余白日数は現行実装を確認して合わせる。
- 日時を扱う場合は ISO 形式文字列で保存し、比較時は `datetime.fromisoformat()` または SQLite の `date()` を使う。
- ドラッグ更新では「新しい行ID」「新しい開始/終了」を保存する前に、開始 < 終了、対象行の存在、重複を確認する。
- 監査項目は `current_user` から `利用者ID` / `利用者名` を作って `update_audit_fields()` で更新する。端末IDが必要な API では request から渡す。

## 注意点

- 重複チェック（同一行・同一期間に既存スケジュールがあるか）は更新前に必ず実施
- 日付の比較は `YYYY-MM-DD` 文字列比較で可（SQLite は文字列比較で日付順が保証される）
- ドラッグ更新とリサイズ更新は「移動量だけ」ではなく「移動後の確定値」を受け取る設計にする
- `最終更新日時` エンドポイントは認証チェックありで実装する
- 重複チェックでは自分自身を除外する。除外条件がないと、ドラッグやリサイズを保存するたびに自レコードと重複して更新不能になる。
- 日表示と週表示で同じ T 系を更新する場合、更新ロジックの条件を揃える。片方だけ重複判定や監査更新が違うと挙動がずれる。

## 確認方法

```powershell
cd backend_server
.venv\Scripts\python.exe -m py_compile apps_router\S<名称>.py
.venv\Scripts\python.exe -c "import apps_main"
```

- Swagger `http://127.0.0.1:8098/docs` で各エンドポイントを実行する。
- データ取得で表示範囲内の予定だけが返ることを確認する。
- ドラッグ更新後に再取得して位置が保存されていることを確認する。
- 既存予定と重なる更新で `NG` が返ることを確認する。
- 週表示 / 日表示を分けた場合、同じ更新結果が両方に反映されることを確認する。
