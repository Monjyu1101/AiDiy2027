# backend_server 実装パターン

> 文書: `backend_server,実装パターン.md` | 実装: `backend_server/apps_models/`, `backend_server/apps_schema/`, `backend_server/apps_crud/`, `backend_server/apps_router/`

## このメモを使う場面

- `backend_server` の Model / Schema / CRUD / Router の責務を確認する。
- core/apps のどちらへ実装するか判断する。
- API レスポンス、認証、監査、ログ、WebSocket の既存パターンへ合わせる。
- backend の落とし穴を実装前後に確認する。

## 関連ファイル

- `backend_server/core_main.py`
- `backend_server/apps_main.py`
- `backend_server/database.py`
- `backend_server/deps.py`
- `backend_server/auth.py`
- `backend_server/log_config.py`
- `backend_server/core_models/`
- `backend_server/apps_models/`
- `backend_server/core_schema/`
- `backend_server/apps_schema/`
- `backend_server/core_crud/`
- `backend_server/apps_crud/`
- `backend_server/core_router/`
- `backend_server/apps_router/`

## core / apps の分担

| 実装先 | 対象 |
|--------|------|
| `core_main.py` | C系、A系、認証、files、AIコア |
| `apps_main.py` | M系、T系、V系、S系 |

core/apps は同じ SQLite DB を共有する。どちらに置くか迷う場合は、認証・共通・AIは core、業務マスタ・業務トランザクションは apps を優先する。

## 基本実装単位

新規テーブルや機能は、原則として次の層を揃える。

| 層 | 役割 |
|----|------|
| Model | SQLAlchemy テーブル定義 |
| Schema | Pydantic request / response 定義 |
| CRUD | DB 操作とトランザクション |
| Router | POST API、認証、入力検証、レスポンス整形 |
| Main | `include_router` 登録、起動時初期化 |

M/T/S 系追加時の詳細は `M系マスタ追加手順.md`、`T系トランザクション追加手順.md`、`S系スケジューラ追加手順.md` を使う。

## API レスポンス

Router は統一レスポンス形式へ寄せる。

```json
{
  "status": "OK",
  "message": "メッセージ",
  "data": {}
}
```

例外時は `db.rollback()` して、ログへ詳細、レスポンスへ利用者向けメッセージを返す。

## V系の実装判断

- DB VIEW オブジェクトは作らない。
- `core_router/V*.py` または `apps_router/V*.py` に生 SQL を書く。
- `SELECT` と `COUNT(*)` は同じ FROM / JOIN / WHERE 条件を使う。
- SQL へ値を直結せず、bind params を使う。
- SQLAlchemy Row は `dict(row._mapping)` で dict 化する。

詳細は `V系エンドポイント追加手順.md` を使う。

## 採番と監査

- AUTOINCREMENT を前提にしない。
- 採番が必要なテーブルは `C採番` に初期値を追加する。
- 作成時は `create_audit_fields()`、更新時は `update_audit_fields()` を使う。
- 監査日時を個別実装で直接作らない。

詳細は `C採番と監査フィールド.md` を使う。

## 認証とパスワード

- 認証は `deps.get_現在利用者` を Router dependency として使う。
- JWT の基本仕様は `JWT認証フロー.md` を確認する。
- パスワードは通常登録・変更時にハッシュ保存を前提にする。
- 既存DB互換のため、認証側はプレーン保存利用者とハッシュ保存利用者の両方を照合できるようにする。

詳細は `C利用者パスワード運用.md` を使う。

## ログ

```python
from log_config import get_logger

logger = get_logger(__name__)
```

- startup や router で標準 logger を使う。
- 頻繁に呼ばれるサーバー状態 API などは filter 側で除外される。
- 調査時は `backend_server/temp/logs/` と console 出力を確認する。

## WebSocket

AIコアの WebSocket は `AIセッション管理` を中心に扱う。

- 接続時に socket id を得る。
- リロード時は既存 socket id / session id を渡して復元する。
- チャンネルごとの message type は `AIコアWebSocket仕様.md` を確認する。

## 明細型の backend パターン

ヘッダー行と明細行を単一テーブルで扱う場合:

- `明細SEQ=0` をヘッダー行に予約する。
- `(親ID, 明細SEQ)` の複合主キーを使う。
- 明細行でしか使わない列は nullable にする。
- 更新時は対象親IDの既存行を全削除して、ヘッダー + 明細を再作成する。
- V系一覧では `明細SEQ=0` のヘッダー行だけを取得し、明細件数は `明細SEQ>0` で集計する。

代表実装:

- `apps_models/M商品構成.py`
- `apps_crud/M商品構成.py`
- `apps_router/M商品構成.py`
- `apps_router/V商品構成.py`
- `apps_models/T生産.py`
- `apps_crud/T生産.py`

## 起動時初期化の考え方

- `create_all()` は新規テーブル作成には効くが、既存テーブルのカラム追加・削除・型変更には効かない。
- 既存DB向けスキーマ変更は `init.py` 側の冪等処理に入れる。
- 初期データは「未存在なら投入」方式を優先し、既存DBを勝手に上書きしない。

詳細は `スキーマ変更手順.md` と `開発環境運用手順.md` を使う。

## よくある落とし穴

- `apps_crud/__init__.py` の import / `__all__` 追加漏れ。
- `apps_models/__init__.py` の import 追加漏れにより `create_all()` 対象外になる。
- M/T 画面用の V系エンドポイント作成漏れ。
- `apps_main.py` / `core_main.py` の router 登録漏れ。
- 採番IDの初期化漏れ。
- 監査フィールドの設定漏れ。
- 複数テーブル更新時の `rollback()` 漏れ。
- SQLite Browser や DBeaver を開いたまま起動して `database is locked` になる。

## 最小確認

- 対象 router が Swagger に表示される。
- 登録 / 取得 / 一覧 / 変更 / 削除の POST が通る。
- V系一覧の `items` と `total` が一致する。
- 既存DBで不足カラムがない。
- `apps_crud/__init__.py` / `apps_models/__init__.py` / `apps_main.py` の登録漏れがない。
