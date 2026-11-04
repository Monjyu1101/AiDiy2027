# スキーマ変更手順

> 文書: `backend_server,スキーマ変更手順.md` | 実装: `backend_server/core_models/`, `backend_server/apps_models/`, `backend_taskteam/task_proc/tasks_db.py`, `backend_taskteam/team_proc/*_db.py`

## このメモを使う場面

- テーブル・カラム・主キー・索引の定義を変更する
- 新規 DB のスキーマと初期データを確認する
- 起動時や API 実行時のカラム不足・旧テーブル参照を切り分ける

## 基本方針

- アプリは現行スキーマで新規作成した DB を前提とする。
- 旧テーブル・旧カラムへのフォールバックや、起動時の `ALTER TABLE`、コピー移行、主キー・列順の自動変換を追加しない。
- スキーマ変更時の DB 再作成は利用者が手動で行う。コード修正・構文確認・テストを理由に、実 DB の削除や再構築を実行しない。
- `create_all()` と `CREATE TABLE IF NOT EXISTS` は未作成テーブルを作るだけで、既存テーブルの定義を更新しない。
- 既存 DB の列不足は、旧構造へのフォールバックで隠さず、現行定義との不一致として扱う。

## 関連ファイルと役割

- `backend_server/core_models/`, `backend_server/apps_models/`: Core / Apps の現行モデル定義。
- `backend_server/core_main.py`, `backend_server/apps_main.py`: 対象モデルのテーブル作成。
- `backend_server/core_crud/init.py`, `backend_server/apps_crud/init.py`: 現行スキーマへの初期データ投入。
- `backend_server/core_crud/C採番.py`: 新規 DB 向け採番初期値。
- `backend_taskteam/task_proc/tasks_db.py`: Task の現行 DDL と初期化。
- `backend_taskteam/team_proc/*_db.py`: Team の現行 DDL と初期化。
- `backend_tools/tools_proc/sqlite_query.py`: 読み取り中心のスキーマ診断。診断のための列一覧取得は旧構造互換処理とは区別する。

## 実装手順

1. Model または DDL を現行定義へ変更し、Schema / CRUD / Router / 利用側との項目名を揃える。
2. 新規テーブルは所定の初期化処理へ登録する。既存テーブルを検出して自動変換する処理は追加しない。
3. 初期データと採番が新規 DB 上で成立することを確認する。旧データの補完は初期データ投入へ混在させない。
4. 型・主キー・索引・列順を一時 DB で確認する。Task 明細のタイプは登録・更新時に `明細タイプ()` で決め、起動時に旧レコードを補正しない。
5. スキーマ変更後の利用には利用者による手動再作成が必要なことを伝える。保持が必要なデータの退避と再作成方法は [`共通,開発環境運用手順.md`](./共通,開発環境運用手順.md) の「DB 管理」を参照する。

## 検証時の安全な切り分け

- `ast.parse()` など接続を伴わない構文確認を先に行う。
- DB を使う検証は `:memory:` または専用の一時ディレクトリへ接続先を固定する。アプリの import や起動だけで実 DB に接続する経路がないか確認する。
- 新規作成と複数回の初期化を確認する。現行テーブル・索引・初期データが存在し、再初期化で既存行を書き換えないことを検証する。
- 旧構造の一時 fixture を用いる場合は、初期化が既存テーブルを削除・コピー・変換しないことと、必要列を使う処理が不整合を隠さないことを確認する。
- 正常なロールバック、接続ロックへの対処、初期化前の別機能テーブル未作成への対処、読み取り専用のスキーマ診断は、旧 DB 互換処理として一括削除しない。
- 実 DB を使う起動試験・削除・再作成は、一時 DB の検証とは別の作業として扱う。
