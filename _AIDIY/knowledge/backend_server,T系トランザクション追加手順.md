# T系トランザクション追加手順

> 文書: `backend_server,T系トランザクション追加手順.md` | 実装: `backend_server/apps_models/`, `backend_server/apps_schema/`, `backend_server/apps_crud/`, `backend_server/apps_router/`

## このメモを使う場面
- T配車・T生産のような業務トランザクションテーブルを追加する
- 明細型（ヘッダー行＋明細行を単一テーブルで管理）を実装する
- T系一覧用の V系エンドポイントを追加する

## 関連ファイル
- `backend_server/apps_models/`
- `backend_server/apps_schema/`
- `backend_server/apps_crud/`
- `backend_server/apps_router/T*.py`
- `backend_server/apps_router/V*.py`
- `backend_server/apps_main.py`
- `backend_server/apps_crud/init.py`
- `backend_server/core_crud/C採番.py`

## 実装手順

### 1. Model

- `apps_models/T<名称>.py` に SQLAlchemy Model を作る。
- `apps_models/__init__.py` に import を追加する。ここが漏れると `create_all()` の対象にならない。
- `apps_main.py` の `create_all(tables=[...])` に新 Model の `.__table__` を追加する。
- 監査8項目と `有効` を含める。
- 日付は既存実装に合わせ、原則 `YYYY-MM-DD` 文字列で保存する。

### 2. Schema / CRUD

- `apps_schema/T<名称>.py` に request / response schema を作る。
- `apps_schema/__init__.py` に import を追加する。
- `apps_crud/T<名称>.py` に get / list / create / update / delete 関数を作る。
- `apps_crud/__init__.py` に CRUD 関数を import し、`__all__` に追加する。
- 登録時は `create_audit_fields()`、更新時は `update_audit_fields()` を使う。

### 3. Router

- `apps_router/T<名称>.py` に Router を作る。CRUD エンドポイントは POST で統一する。
- `apps_router/V<名称>.py` に一覧表示用 V系 Router を作る。JOIN は DB VIEW ではなく生SQLで実装する。
- `apps_main.py` に T系 / V系 Router の import と `include_router` を追加する。

### 4. 初期データ・採番

- 初期データが必要なら `apps_crud/init.py` の `init_db_data()` に追記する。
- カラム追加は Model / Schema / CRUD へ反映し、新規の一時 DB で確認する。起動時の移行処理は追加せず、利用時の DB 再作成は利用者が手動で行う。
- 伝票IDやシステム生成IDを使う場合は `C採番` に対象 `採番ID` を追加する。

## 明細型パターン

T生産・M商品構成が参考実装。

```python
class T生産(Base):
    __tablename__ = "T生産"
    生産伝票ID = Column(Text, primary_key=True)
    明細SEQ   = Column(Integer, primary_key=True)
    生産開始日時 = Column(Text)
    受入商品ID = Column(Text)
    受入数量 = Column(Float)
```

- `明細SEQ=0` をヘッダー行、`明細SEQ>=1` を明細行にする。
- 主キーは `伝票ID + 明細SEQ` の複合PKにする。
- `get_ヘッダ(db, ID)` は `明細SEQ=0` の1行を取得する。
- `get_明細一覧(db, ID)` は `明細SEQ>=1` の一覧を取得する。
- 登録時はヘッダー行を `明細SEQ=0` として先に作り、明細配列を 1 始まりで追加する。
- 更新時は対象伝票IDの既存行を全削除してから、ヘッダーと明細を再作成する。削除前に存在確認を行い、対象なしなら `NG` を返す。
- 削除は既存機能の方針に合わせる。論理削除なら対象伝票IDの全行を `有効=False` にする。
- V系やスケジューラでヘッダーだけを扱うときは必ず `明細SEQ = 0` を条件に入れる。明細行まで混ざると件数や予定表示が二重になる。
- 明細だけを集計する V 系では `明細SEQ > 0` を条件に入れる。

## T系一覧の件数制限

- T系の一覧エンドポイントは `Optional[schemas.ListRequest] = None` を受け取り、ORM なら `apply_active_filter()`、生SQLなら `append_active_condition()` / `get_limit_clause()` を使う。
- `件数制限` と `無効も表示` を request から受け取れるようにし、レスポンスの `data` には `items` / `total` / `limit` を返す。
- 日付範囲を受ける場合は `開始日付` / `終了日付` を使い、保存値が `YYYY-MM-DD` なら文字列比較でよい。日時文字列の場合は `date(カラム)` を使う。

## 注意点

- `apps_crud/__init__.py` への登録が漏れると Router から CRUD 関数を参照できない。
- 呼び出し側が V系一覧を使う前提の場合、T系の直接 `/apps/T*/一覧` は補助用として扱う。
- 明細型の `create/update` で「明細行だけ更新」は標準にしない。全明細を削除・再作成する。
- 採番対象は `C採番` を経由する。AUTOINCREMENT は使わない。
- 日時項目を使う場合は、保存形式と比較方法を現行実装に合わせる。

## 確認方法

```powershell
cd backend_server
.venv\Scripts\python.exe -m py_compile apps_models\T<名称>.py apps_schema\T<名称>.py apps_crud\T<名称>.py apps_router\T<名称>.py apps_router\V<名称>.py
```

- Swagger `http://127.0.0.1:8098/docs` で POST エンドポイントを確認する。
- 作成、一覧取得、更新、削除を実行する。
- 明細型はヘッダー行だけの取得、明細行だけの取得、V系集計条件を確認する。

`apps_main.py` はimport時に `create_all()` を実行する。importによる確認は実DBへ向けず、設定・DBを隔離した検証環境で行う。

## T日誌（業務DBとは別の日誌・作業・明細・添付）

Apps 起動時に、実行ユーザーのホームにある `~/.aidiy/diary/diary.db` の未作成テーブルを追加する。業務 DB の利用者と通常の JWT で認証し、日誌には独立した DB 接続を使う。日誌 DB の退避・移行は Apps を停止して DB をコピーする。

| テーブル | 主キー | 内容 |
|---|---|---|
| `T日誌` | 利用者ID＋日付 | 1利用者・1日につき1件。利用者名と監査項目 |
| `T日誌記録` | 利用者ID＋日付＋記録SEQ | 日誌配下の作業。記録タイトル |
| `T日誌作業集計` | 利用者ID＋日付＋記録SEQ | 作業配下に0〜1件。`新規更新ファイル数` は自己申告の非負整数。行なし＝未入力、行あり・値0＝0件 |
| `T日誌明細` | 利用者ID＋日付＋記録SEQ＋行SEQ | 作業配下の明細。内容。従来のファイル名／Base64列は既存添付の読取用 |
| `T日誌添付` | 利用者ID＋日付＋記録SEQ＋行SEQ＋添付SEQ | 明細配下の添付。ファイル名・Base64内容 |

- 各 SEQ は各親内で1から採番する。親を削除すると配下も削除する。新設テーブルは既存テーブルの作り直しや一括移行を行わずに追加する。旧列だけに保存された添付は読込時に1件として扱い、編集・保存時に添付テーブルへ書く。
- `POST /apps/T日誌/{一覧,取得,登録,変更,削除}` はログイン利用者本人に限定する。`一覧` は開始日付・終了日付・件数制限を受け、本文・添付を返さない。Web の `取得` は `{日付, 添付形式:"複数"}`。`登録`・`変更` の形式は `{日付, 添付形式:"複数", 記録:[{記録SEQ, 記録タイトル, 新規更新ファイル数, 明細:[{行SEQ, 内容, 添付:[{ファイル名, base64内容}]}]}]}`。自己申告数の未入力は `null`。
- 作業は日誌1件につき最大30、明細は合計100行。添付は1行20ファイル、1ファイル最大5 MiB、日誌全体で15 MiB。空ファイルは保存しない。Web で明細の添付欄に複数ファイルをドラッグ＆ドロップ、またはファイル選択で追加できる。明細を折りたたんでも添付は保持され、保存ボタンで日誌と一緒に保存される。
- 検証はリポジトリルートで `python -m unittest discover -s backend_server/checks -p test_diary.py`。一時ホームと一時業務 DB を使用し、既存の日誌や実利用者には触れない。
