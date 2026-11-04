# backend_taskteam 実装概要

## 本書の目的

このファイルは `backend_taskteam` の構成、提供 API、統合ランタイム、実装入口を示す正規概要ドキュメントです。
起動、依存関係、ポート競合、検証、トラブル対応などの HowTo は `../_AIDIY/knowledge/` に集約します。
AI エージェントは、本書に個別手順や一時的な作業メモを追記しないでください。

## HowTo 参照先

| 目的 | 参照先 |
|------|--------|
| 全体の起動、依存関係、DB、API確認 | [`../_AIDIY/knowledge/共通,開発環境運用手順.md`](../_AIDIY/knowledge/共通,開発環境運用手順.md) |
| バックエンドの起動、再起動、import エラー | [`../_AIDIY/knowledge/backend_server,command_hermes,backend_tools,バックエンド起動.md`](../_AIDIY/knowledge/backend_server,command_hermes,backend_tools,バックエンド起動.md) |
| MCP Task Agents / Team Agents の使い分け | [`../_AIDIY/knowledge/backend_server,backend_tools,MCP活用手順.md`](../_AIDIY/knowledge/backend_server,backend_tools,MCP活用手順.md) |
| Vite proxy と接続ポート | [`../_AIDIY/knowledge/frontend_web,frontend_avatar,backend_server,Viteプロキシ設定.md`](../_AIDIY/knowledge/frontend_web,frontend_avatar,backend_server,Viteプロキシ設定.md) |
| SQLite スキーマ変更 | [`../_AIDIY/knowledge/backend_server,スキーマ変更手順.md`](../_AIDIY/knowledge/backend_server,スキーマ変更手順.md) |

## 概要

`backend_taskteam` はポート `8093` 上で次の2機能を同居させる FastAPI 常駐サーバーです。

- `/task/*`: 要求の AI 分解、DAG 形式の明細実行、実行開始条件、Code CLI サブプロセス監視。
- `/team/*`: 複数AIエージェントの要員・依頼・目標・経験・作業・会話・状態管理、PlanDo / SPDCA 作業ループ。

主な前提:

- Backend: FastAPI + uvicorn、Python 3.13 以上、uv 管理。
- エントリポイント: `taskteam_main.py`。
- 起動ポート: `8093` 固定。
- DB: `_data/AiDiy/database.db` を `backend_server` と共有。
- API prefix: `/task` と `/team`。両方とも同じプロセス・同じ OpenAPI に載る。
- ヘルスチェック: `GET /`、`GET /health`。
- MCP 連携: `backend_tools` の `aidiy_code_agents`、`aidiy_task_agents`、`aidiy_team_agents`。

## 統合アプリ構成

`taskteam_main.py` はログを初期化し、`taskteam_proc.app.create_app()` が返す単一 FastAPI app を公開します。
アプリへ登録する router は次の4つです。

| router | 役割 |
|--------|------|
| `taskteam_proc.routes.router` | `GET /`、`GET /health` |
| `task_proc.tasks_api.router` | `/task/*` |
| `task_proc.tasks_api.check_router` | 互換 API `POST /task_check_okng` |
| `team_proc.team_api.router` | `/team/*` |

Task と Team の旧 `app.py` / `routes.py` / `runtime.py` は統合先へ持ち込みません。root / health、lifespan、再起動監視は `taskteam_proc/` に一元化し、二重初期化や同名 route の衝突を防ぎます。

## 統合 lifespan

`taskteam_proc/runtime.py` の単一 lifespan が、Task と Team の初期化およびバックグラウンド処理をまとめて管理します。

起動時の順序:

1. Team の作業・経験・PDCA テーブルを初期化する。
2. 初期要員と初期目標を投入する。
3. 起動前の会話をクリアし、自動作業設定と作業ループをオフへ戻す。
4. Task テーブルを初期化する。
5. Task の残存 PID を整理し、停止中に期限到来した実行条件を次周期へ送る。
6. Team の残存 PID、生成中経験、未完了作業を整理する。
7. 次の5つの asyncio task を開始する。

| バックグラウンド処理 | 主な間隔 | 役割 |
|----------------------|----------|------|
| Task 起動監視 | 5秒 | 実行可能な要求・明細をサブプロセスへ投入 |
| Task 状態監視 | 10秒 | 実行開始条件、タイムアウト、チーム状況集計 |
| Team シミュレーション | 8秒 | エージェントの表示状態・自動行動を更新 |
| Team 起動監視 | 5秒 | 準備開始のチーム依頼を担当選択・AIタスク投入へ進める |
| Team 状態監視 | 10秒 | 毎分ゲートでタイムアウト、経験、PDCA、会話を確認 |

停止時は5つの task をすべて cancel し、`CancelledError` を回収してから終了します。
Team テーブルを Task より先に初期化するのは、Task の起動時クリーンアップが `Aチーム依頼` / `Aチーム作業` / `Aチーム状況` を参照・更新するためです。

## 再起動

正規の再起動トリガーは次です。

```text
backend_taskteam/temp/reboot_taskteam.txt
```

`taskteam_proc/runtime.py` は移行互換として、同じ `backend_taskteam/temp/` 内の `reboot_task.txt` と `reboot_team.txt` も監視します。いずれかを検知すると統合プロセス全体が終了し、ルート `_start.py` の監視下では同じコマンドで再起動されます。新規コードや運用手順では `reboot_taskteam.txt` を使います。

## Task 機能

### 実行の流れ

1. `Aタスク要求`を`準備開始`で仮登録する。
2. Task 起動監視が要求を`準備中`へ進め、`task_sub/sub_init.py`を起動する。
3. AI が要求を明細へ分解し、開始行・処理行・終了行を本登録する。
4. `先行SEQ`がすべて完了した明細を実行可能とし、依存を満たした明細を並行起動する。
5. `task_sub/sub_start.py`、`sub_do.py`、`sub_if.py`、`sub_or.py`、`sub_end.py`が結果を API へ反映する。
6. 終了明細が完了すると要求を完了へ進める。チーム依頼由来の場合は経験生成まで Team 側と連動する。

`Aタスク明細` の `タイプ` は `start` / `do` / `if` / `or` / `end` の5値で、`明細SEQ` の直後の列です。
`0`=start、`9999`=end は SEQ で確定し、その間は AI（または明細編集ダイアログ）が
`do`（通常実行）/ `if`（Y・N 判定の分岐）/ `or`（合流点）から選びます。登録は `tasks_db.明細タイプ()` を通し、
AI の分解 JSON にも `明細SEQ` の直後のキーとして出させます。

### if 分岐と or 合流

`先行SEQ` の 1 要素は `5`（通常のエッジ）か `5=Y` / `5=N`（if 明細 5 の判定値で選ばれるエッジ）です
（解析は `tasks_db.先行SEQ解析()`）。`=Y` / `=N` を付けられるのは先行が `if` 明細のときだけで、
逆に `if` を先行に持つ明細は必ずどちらかを指定します。`sub_init.JSON検証()` が両方向とも検査し、
`if` の Y 側・N 側の後続が揃っているかも確認します。

| タイプ | サブプロセス | 動作 |
|--------|--------------|------|
| `if` | `task_sub/sub_if.py` | 要求内容を条件文として AI に Y / N を JSON で答えさせ、応答内容へ `Y: 理由` の形式で書き込む。判定の読み出しは `tasks_db.if判定値()`（先頭 1 文字） |
| `or` | `task_sub/sub_or.py` | AI を使わない合流点。先行SEQ のいずれか 1 本が完了していれば機械的に完了する |

実行可能判定は `or` だけ「いずれか 1 本」で、それ以外は従来どおり「全先行が完了」です。
`if` で選ばれなかった枝の明細は `tasks_db.明細パス伝播()` が状態 `パス` にし、その下流へ連鎖させます
（起動監視の毎回 5 秒ごとに実行）。`パス` は失敗ではないので要求の完了を妨げず、
明細の実行有効切替や停止復旧では `待機` へ戻して分岐をやり直せます。

明細タイプは実行するサブプロセスの選択そのものにも使います
（`tasks_watcher._タイプ別サブプロセス`）。以前はタイトル文字列（「開始」「終了」）で分けていましたが、
`if` / `or` はタイトルが自由なため判定できず、タイプ基準へ切り替えました。タイプは登録・更新時に `明細タイプ()` で確定し、旧 DB の列追加や保存値の起動時補正は行いません。

明細の依存関係はカンバン固定列ではなく、`先行SEQ`（カンマ区切りで複数指定可）による DAG です。実行可能判定は先行明細の全完了を条件とし、フロントエンドのフロー図は最長経路をクリティカルパスとして配置します。

同時実行数は `tasks_watcher.明細並行上限`（既定3）で制御します。先行SEQ を満たした明細は、同一タスク内でもこの上限まで同時に起動します（フロー図の分岐どおりに並行実行するため）。タスクをまたぐ並行に制限はありません。通知音などの軽量明細は code agent を使わないため上限の対象外で、依存が許せば常に同時起動します。上限を 1 にすると、タスク単位の直列実行になります。

### 各サブプロセスの役割

| サブプロセス | 対象 | 動作 |
|--------------|------|------|
| `task_sub/sub_init.py` | 要求の準備 | 2段構え。第1ステップは対象プロジェクトフォルダで AI に分解させ、応答本文へ JSON 文字列を返させる（書き込みなし）。第2ステップは AiDiy ルート（`"../"`）で `temp/output/<タスクID>.json` へ書き出させる |
| `task_sub/sub_start.py` | 開始明細 | AI を使わず、`aidiy_backup` MCP でプロジェクトの差分バックアップを取り、要求内容を応答内容へコピーして`開始完了`にする |
| `task_sub/sub_do.py` | 処理明細 | 1ステップだけを `aidiy_code_agents` へ依頼する。`操作検証`ありの明細は AI が `/task_check_okng` へ報告した状態を確認し、書き込みなし・エラーのいずれかなら検証結果を踏まえて最大2回自動リトライする。再試行時は実行有効フラグと実行中PIDも復元する |
| `task_sub/sub_if.py` | 分岐明細 | 要求内容の条件を AI に Y / N で判定させ、応答内容へ `Y: 理由` を書き込む。判定だけでファイル操作は行わせない |
| `task_sub/sub_or.py` | 合流明細 | AI を使わず、通った先行SEQ を応答内容に記録して完了する |
| `task_sub/sub_end.py` | 終了明細 | `操作検証=false`（どの明細もファイル操作なし）なら AI を介さず`終了完了`。`true` なら最終検証を依頼し、AI が `/task_check_okng` へ報告する。無報告で戻った場合は強制的にエラーで確定する |

`sub_do.py` / `sub_end.py` は `temp/input` / `temp/output` に依存せず、タスクID と SEQ だけで完結します。

### 実行開始条件

`Aタスク実行条件`は要求の起動条件を、タスクID 単独を主キーに保持します。区分は2軸です。

| 列 | 値 | 補足 |
|----|----|------|
| `実行区分` | `即時` / `時間指定` / `間隔実行` / `定時実行` | 間隔は `間隔区分`（分・時・日）+ `間隔値`、定時は `定時区分`（毎日・毎週・毎月）+ `実行曜日` / `実行日` / `開始時刻` |
| `実行条件` | `無し` / `フォルダ変化` | `フォルダ変化`は `監視フォルダ`のファイル数・最終更新日時のスナップショット比較で判定する |

状態は`準備完了`（条件の充足待ち）で待機し、条件成立で明細 → 要求の順に`待機`へ戻して再実行します。時間駆動条件と`フォルダ変化`の確認は状態監視ループの毎分ゲートで行い、`即時`だけは1分ゲート無しで10秒ループの先頭から再実行させます。

停止中に期限を過ぎた条件は、起動時に過去分を一括発火せず次の周期へ更新します。

### Task API

| エンドポイント群 | 役割 |
|------------------|------|
| `POST /task/タスク要求/一覧` / `取得` / `最大更新日時` / `新規既定値` | 要求の参照、ポーリング、新規入力の既定値取得 |
| `POST /task/タスク要求/AI登録` / `登録` / `更新登録` / `本登録` | 仮登録、再分解、AI分解結果の確定 |
| `POST /task/タスク要求/実行有効切替` / `AI失敗` | 実行可否と分解失敗の反映 |
| `POST /task/タスク要求/停止検査` / `停止復旧` | 停止理由の機械判定と、AI判断による再開・再分解・強制再開 |
| `POST /task/タスク実行条件/取得` | 要求に紐づく起動条件の取得 |
| `POST /task/タスク明細/一覧` / `最大更新日時` | 明細の参照とポーリング |
| `POST /task/タスク明細/更新登録` / `実行有効切替` / `全消去` | 明細の編集・実行可否・削除 |
| `POST /task/タスク明細/完了` / `開始完了` / `終了完了` / `失敗` / `再試行` | サブプロセスの状態・結果反映 |
| `POST /task/プロジェクト選択肢` | 要求編集用プロジェクト候補 |

新規タスクIDは `C採番`（採番ID=`Aタスク要求`、初期値1000）による `TK` + 8桁連番です。API からタスクIDを省略した場合は自動採番し、プロジェクトや `TASK_AI_*` の未指定値は同じ利用者の更新最終レコード、なければ共通設定から補完します。

Task の無進捗タイムアウトは、`準備中`の要求が10分、それ以外の要求が60分です。実行中明細は `予測分数×2`、未見積りを含む最低10分で判定します。

`停止検査` は人間向けの `停止理由` に加え、AI が分岐に使える `状態コード`、`推奨操作`、
`通常復旧可能`、`強制復旧必要` を返します。主な状態コードは `REQUEST_ERROR`、
`REQUEST_DISABLED`、`REQUEST_TIMEOUT`、`DETAIL_ERROR`、`DETAIL_DISABLED`、`DETAIL_TIMEOUT`、`NO_DETAILS`、
`UNDEFINED_DETAILS`、`DAG_BLOCKED` です。`停止復旧` の `復旧モード` は `auto`（既定）、
`再開`、`再分解`。タイムアウト中のプロセスを止めて戻す場合だけ `強制=true` を指定します。
健全な実行中タスクへ `強制=true` が誤送信されても、停止判定が false なら PID は停止しません。
先行SEQの循環・欠番は副作用を避けるため自動書換えせず、`推奨操作=手動修正` を返します。

## Team 機能

### 主要データ

| テーブル | 役割 |
|----------|------|
| `Aチーム要員` | 要員ID、表示名、役割、人格情報、有効状態。初期要員 `admin` は削除不可 |
| `Aチーム依頼` | 要員へ渡す要求と Team / Task の AI 設定、状態、PID、対応タスクID、応答・まとめ |
| `Aチーム目標` | プロジェクト単位のチーム目標、自動作業設定、チーム作業、作業ループ設定 |
| `Aチーム経験` | 完了タスクから生成した経験値、分類、まとめ、学び |
| `Aチーム作業` | PlanDo / SPDCA のサイクル、担当要員、依頼ID、区分、実行結果 |
| `Aチーム会話` | プロジェクト・要員ごとの自動会話と発言内容 |
| `Aチーム状況` | 要員ごとの待機・実行・まとめ中・完了・エラー集計 |

`Aチーム依頼`は `TR` + 8桁、`Aチーム経験`は `TE` + 8桁、`Aチーム作業`は `TW` + 8桁で採番します。

### 依頼と Task の連携

1. `Aチーム依頼`を`準備開始`で登録する。
2. Team 起動監視が`team_sub/sub_init.py`を起動する。
3. 有効要員一覧と要員ごとの `Aチーム経験`（経験値・分類・直近の学び）を材料に、AI へ担当要員を選ばせる。経験のある要員へ寄せることで蓄積ナレッジが再利用される。出力が有効要員一覧に無ければ `admin` へフォールバックする。
4. 依頼IDを task ID として `aidiy_task_agents`へ投入し、`Aタスク要求`と紐づける。
5. Task の進捗を同じ SQLite DB へ反映し、完了後に`team_sub/sub_exp.py`が経験を生成する。`sub_exp.py`は `task_sub/sub_init.py` と同じ2段構えで、第1ステップが対象プロジェクトで明細を読んで経験値をまとめ、第2ステップが AiDiy ルートで `temp/team/exp/output/<経験ID>.json` へ書き出す。
6. 経験本登録後、依頼を`済`へ進め、まとめ内容を保存する。

無進捗タイムアウトは、担当選択・タスク投入中の`準備中`が10分、それ以外が30分です。

### Team API

| エンドポイント群 | 役割 |
|------------------|------|
| `POST /team/状態/取得` / `設定/取得` | チーム全体のスナップショットと共通設定 |
| `POST /team/エージェント/一覧` / `召喚` / `状態変更` / `排除` / `会話` | インメモリ状態、persona 召喚、単発調査会話 |
| `POST /team/活動/一覧` / `シミュレーション/切替` / `召喚要員/一覧` | 活動履歴、自動行動、persona 候補 |
| `POST /team/要員/一覧` / `取得` / `登録` / `変更` / `削除` | `Aチーム要員`の保守 |
| `POST /team/依頼/一覧` / `取得` / `最大更新日時` / `登録` / `変更` | `Aチーム依頼`の参照・登録・編集 |
| `POST /team/経験/一覧` / `取得` / `最大更新日時` / `本登録` / `失敗` | 経験の参照と生成結果反映 |
| `POST /team/作業/一覧` / `最大更新日時` | PDCA 作業の参照 |
| `POST /team/会話/一覧` / `最大更新日時` | 自動会話の参照 |
| `POST /team/目標/一覧` / `最終` / `取得` / `保存` / `削除` | プロジェクト目標と自動作業設定 |
| `POST /team/状況/一覧` / `最大更新日時` | 要員別のタスク集計 |

### 作業ループ

対応パターン:

- `PlanDo`: `P`（計画）→ `D`（実行）。既定値。
- `SPDCA`: `S`（相談）→ `P`（計画）→ `D`（実行）→ `C`（評価）→ `A`（改善）。

ソース変更を許可するのは `D` だけです。`C` と `A` は読み取り・テスト・動作確認を行いますが、変更は行いません。各段は `team_sub/sub_SPDCA__common.py` の共通処理を通して `Aチーム依頼`・`Aチーム作業`・`Aタスク要求`を連携させます。

`Aチーム目標.作業ループ回数`は1〜99で、99は無制限です。`動員要員数`は相談段の人数上限です。起動時には自動作業設定と作業ループをオフへ戻し、前回プロセスの続きを無断で再開しません。

### 自動会話（雑談）と取りまとめ

`Aチーム目標`（最終更新1件）の自動作業設定がオンのとき、Team 状態監視の毎分ゲートで次を回します。チーム作業の中身を、要員の意見から決めるための仕組みです。

| 分の下一桁 | 起動するもの | 動作 |
|-----------|--------------|------|
| 1〜9 | `team_sub/sub_self_talk.py` | 雑談エリア（状態=`雑談中`）の要員から1名を選び、チーム目標・他要員の最新発言・その要員自身の1回前の発言を渡して「今やるべきこと」を1件発言させ、`Aチーム会話`の該当行へ書き戻す。意見を集めるだけで実行はしない |
| 0 | `team_sub/sub_self_work.py` | 有効要員数の50%以上の意見が集まっていれば、admin 人格でチーム作業へ取りまとめる。成功時は `Aチーム会話`を admin の取りまとめ1件へ置き換え、`Aチーム目標.チーム作業`へ反映し、対象プロジェクトの既存 `Aチーム作業`をクリアする |

雑談は「前回プロセスが動いている間は次を投入しない」で直列化しています。発言のタイムアウトを延ばすと発言頻度がそのまま落ちる点に注意してください。

### 単発会話の2モード

`team_proc/team_chat.py` は `backend_tools` へ依存せず、`aidiy_code_agents` の HTTP API を毎回呼びます。会話履歴や CodeAgent インスタンスは Team 側に保持しません。モードは2つです。

| モード | 使う処理 | 権限 / タイムアウト |
|--------|----------|---------------------|
| 調査モード | 利用者画面の会話（`/team/エージェント/会話`）、雑談の発言（`sub_self_talk.py`） | `code_permissions` を既定（`auto`）に戻してツールを使わせる。CodeAgent 300秒 / HTTP 360秒。システム指示で「読み取り調査のみ・変更禁止」を明示する |
| 通常モード（既定） | 意見の取りまとめ（`sub_self_work.py`）など、入力が全て渡っていて追加調査が要らない用途 | `code_permissions="none"` でツール禁止。CodeAgent 170秒 / HTTP 180秒 |

調査モードの HTTP 360秒は、フロントエンド `AIチーム_会話要求.vue` の `最大待機秒 = 360` と揃えています。片方だけ変えないでください。

## DB と設定

Task と Team の全 DB モジュールはプロジェクトルートの `_data/AiDiy/database.db` を sqlite3 で直接参照します。現行 DDL による新規テーブル作成を前提とし、旧テーブルのコピー・主キー変更・列順補正は行いません。スキーマ変更時は利用者が DB を手動で再作成します。各接続は30秒の timeout / busy timeout、WAL、`synchronous=NORMAL` を使い、複数サーバー・サブプロセスの並行アクセスに備えます。

設定はプロジェクトルートの `_config/AiDiy_key.json` と共通 `backend_server/conf/conf_json.py` を参照します。主なキーは次です。

- `CODE_BASE_PATH`。
- `TASK_AI_NAME` / `TASK_AI_MODEL_plan` / `TASK_AI_MODEL_do` / `TASK_AI_MODEL_check`。
- `TEAM_AI_NAME` / `TEAM_AI_MODEL_plan` / `TEAM_AI_MODEL_do` / `TEAM_AI_MODEL_check`。
- `PORT_TASKTEAM`。現行値は `8093`。

Task が AI へ渡すプロンプトの定型部は `_config/AiDiy_task__context.json` に外だししています。
無ければ `task_sub/sub_context.py` が初回実行時にひな形を書き出し、あればその内容を使います
（`AiDiy_chat__context.json` などと同じ方式）。キーは次のとおりです。

- `plan_instruction_lines` / `plan_save_instruction_lines`。要求分解と JSON 保存。
- `common_instruction_lines`。do と check で共通の外枠。
- `do_request_lines` / `do_verify_lines` / `do_retry_lines`。ステップ実行の `[今回要求]` 部。
- `check_request_lines`。最終検証の `[今回要求]` 部。

本文中の `{要求内容}` などは差込キーです。置換は 1 回だけの走査で行うため、
JSON の例に出てくる波括弧はエスケープ不要で、差し込んだ値の中身は再走査されません。

do と check は同じ外枠を共有し、`[タイトル]` → `[全体タスク]` → `[実行済み]` → `[今回要求]`
の順に並べます。毎回変わるのは `[今回要求]` 以降だけなので、ステップが進んでも先頭が変化せず、
最終検証も直前ステップと同じ先頭を再利用できて、プロバイダのプロンプトキャッシュが効きます。
役割（「1 ステップを実行する担当」「最終検証を行う担当」）とフェーズ固有の指示は
`[今回要求]` の冒頭に置きます。ここを外枠へ動かすと do と check で先頭が食い違い、
キャッシュが効かなくなります。同じ理由で、外枠に差込キーを増やすのも避けてください。
あわせて外枠の冒頭で「実際に行うのは `[今回要求]` だけ」と宣言し、
実行AIが全体タスクや実行済みステップに手を出すのを防ぎます。

Team 側は用途ごとにファイルを分けてあり、`team_proc/team_context.py` が同じ方式で読み込みます。

| ファイル | 用途 |
| --- | --- |
| `AiDiy_team__spdca_context.json` | 作業ループ SPDCA（S=相談 / P=計画 / D=実行 / C=評価 / A=改善） |
| `AiDiy_team__plando_context.json` | 作業ループ PlanDo（P=計画 / D=実行） |
| `AiDiy_team__select_context.json` | 依頼を担当させる要員の選択 |
| `AiDiy_team__exp_context.json` | 完了した依頼から経験値をまとめる |
| `AiDiy_team__talk_context.json` | 要員の自律発言（雑談）と admin の作業取りまとめ |
| `AiDiy_team__chat_context.json` | 要員チャットのペルソナ指示 |

作業ループ（spdca / plando）は task と同じ考え方で外枠を共通化し、
`[プロジェクト]` → `[チーム目標]` → `[チーム作業]` → `[引き継ぎ]` → `[今回要求]` の順に並べます。
段ごとに変わる役割と指示は `[今回要求]` 側に置くので、同じループの中では先頭が変わりません。
ただし段が進むと `[引き継ぎ]` の中身が入れ替わるため、キャッシュが効くのは外枠と
プロジェクト・目標・作業までです。

雑談（`talk_instruction_lines`）とチャット（`persona_instruction_lines`）は、
固定の手順・行動指示を先頭に置き、要員ごとに変わる情報を末尾へ回しています。
これらは要員ごと・ラウンドごとに繰り返し呼ばれるので、先頭を揃える効果が最も大きい箇所です。

モデルはフェーズごとに使い分けます。Aタスクは準備（AIによる明細分解）が plan、各ステップの実行が do、
終了時の最終確認が check。作業ループは S・P が plan、D が do、C・A が check。

`Aタスク要求` は `TASK_AI_MODEL_plan` / `_do` / `_check` の3列、`Aチーム目標` と `Aチーム依頼` は
TEAM・TASK それぞれ3列（計6列）を持ち、各編集ダイアログから指定します。
`Aタスク明細` は各ステップの実行だけなので `TASK_AI_MODEL_do` 1列で、本登録時に要求の `_do` を引き継ぎます。
フェーズが1つしかない処理もキー名でフェーズを明示します（会話要求は `TASK_AI_MODEL_plan`、
雑談は `TASK_AI_MODEL_plan`、自己作業は `TASK_AI_MODEL_do`、経験まとめは依頼の `*_AI_MODEL_plan`）。

モデルの流れは 目標 → 依頼 → Aタスク要求 で、3種のまま引き渡します
（`team_sub/sub_SPDCA__common.AI設定を決める()` → `タスク投入()`）。TEAM 側3種は作業ループの段
（S・P=plan / D=do / C・A=check）、TASK 側3種は投入した Aタスクの内部フェーズ（準備 / 各ステップ /
最終確認）で使い分けます。Aタスクを作らず code_agents を直に呼ぶ段（S・P・C・A）は
`段のモデル()` が区分に対応するフェーズを選び、`auto` なら共通設定のフェーズ別値へ落とします。

モデルはフェーズ別キーだけで扱います（旧版の単一キー `TASK_AI_MODEL` / `TEAM_AI_MODEL` は
DB 列・API・MCP のいずれにも存在しません）。MCP は `aidiy_task_agents.submit` が
`ai_model_plan` / `_do` / `_check`、`aidiy_team_agents.submit` が `team_ai_model_plan` などで指定します。

## temp の分離

Task と Team は同じプロセスルートを使うため、Team の一時ファイルを `temp/team/` 配下へ分離しています。

| パス | 用途 |
|------|------|
| `temp/input/` | Task の要求分解入力 JSON |
| `temp/output/` | Task の要求分解出力 JSON |
| `temp/task/` | Task サブプロセスのログ |
| `temp/team/input/` | Team 依頼の担当選択入力 |
| `temp/team/output/` | Team 依頼の担当選択出力 |
| `temp/team/exp/` | 経験生成の入力・出力・ログ |
| `temp/team/pdca/` | PlanDo / SPDCA の入力 |
| `temp/team/talk/` | 自動会話・取りまとめの入力 |
| `temp/logs/` | 統合サーバーのログ |

Task ID と Team 依頼IDが同じ文字列になる連携があるため、Task と Team の input / output を同じディレクトリへ置かないでください。

## ファイル構成

| パス | 役割 |
|------|------|
| `taskteam_main.py` | ログ初期化と統合 app 公開を行うエントリポイント |
| `taskteam_proc/app.py` | 単一 FastAPI app の生成と全 router 登録 |
| `taskteam_proc/routes.py` | 統合 root / health |
| `taskteam_proc/runtime.py` | 統合 lifespan、5つの非同期処理、再起動監視 |
| `task_proc/tasks_api.py` | `/task/*` API |
| `task_proc/tasks_db.py` | `Aタスク*` と連携する `Aチーム*` の DB 操作 |
| `task_proc/tasks_watcher.py` | Task の起動・状態監視とサブプロセス起動 |
| `task_sub/` | 要求分解（`sub_init.py`）、開始（`sub_start.py`）、処理（`sub_do.py`）、終了（`sub_end.py`）の各 Task サブプロセス |
| `task_sub/sub_context.py` | Task の定型コンテキスト（plan / do / check）の読込 |
| `team_proc/team_context.py` | Team の定型コンテキスト（用途別6ファイル）の読込 |
| `team_proc/team_api.py` | `/team/*` API |
| `team_proc/store.py` | エージェントのインメモリ状態とシミュレーション |
| `team_proc/config.py` | 共通設定の読込 |
| `team_proc/persona_catalog.py` | persona の検証・一覧化 |
| `team_proc/team_db.py` | `Aチーム要員` |
| `team_proc/team_work_db.py` | `Aチーム依頼` |
| `team_proc/team_goal_db.py` | `Aチーム目標` |
| `team_proc/team_exp_db.py` | `Aチーム経験` |
| `team_proc/team_pdca_db.py` | `Aチーム作業` と作業ループ判定 |
| `team_proc/team_talk_db.py` | `Aチーム会話` |
| `team_proc/team_status_db.py` | `Aチーム状況`の読取 |
| `team_proc/team_chat.py` | persona 指示付き単発会話（調査モード / 通常モード） |
| `team_proc/team_watcher.py` | Team の依頼・経験・PDCA・会話監視 |
| `team_sub/` | 担当選択（`sub_init.py`）、経験生成（`sub_exp.py`）、PlanDo（`sub_PlanDo_*.py`）、SPDCA（`sub_SPDCA_*.py` と共通処理 `sub_SPDCA__common.py`）、雑談発言（`sub_self_talk.py`）、取りまとめ（`sub_self_work.py`）の各サブプロセス |
| `persona/<要員ID>/persona.json` | 召喚候補。`admin` は削除不可 |
| `_start.py` / `_setup.py` / `_cleanup.py` | ルートスクリプトからの委譲先 |
| `pyproject.toml` / `uv.lock` | uv 依存定義と lock |

## フロントエンドと MCP からの利用

- `frontend_web` と `frontend_avatar` の Vite proxy は `/task/*` と `/team/*` をともに `http://127.0.0.1:8093` へ転送します。
- Avatar の `taskClient` と `teamClient` は責務別に分けますが、Electron 本番の base URL は両方 8093 です。
- `backend_tools/tools_proc/task_agents.py` と `team_agents.py` も同じ 8093 の統合サーバーへ接続します。
- Team のサブプロセスが Task API を呼ぶ場合も、`/team` と `/task` の両方を 8093 で使用します。

## 起動手順の参照先

全体起動は [開発環境運用手順](../_AIDIY/knowledge/共通,開発環境運用手順.md)、単独起動・再起動は [AIタスクの実行記録と繰り返し監視](../_AIDIY/knowledge/backend_taskteam,AIタスクの実行記録と繰り返し監視.md) を参照してください。

## 実装時の注意

- `/task` と `/team` の prefix は維持し、既存フロントエンドと MCP の契約を壊さない。
- root / health、lifespan、再起動スレッドを Task / Team 側へ再追加しない。
- `task_proc` と `team_proc` の相対 import は各パッケージ内に保ち、サブプロセスの `sys.path` 前提を崩さない。
- Team テーブル初期化を Task の連携クリーンアップより後へ移動しない。
- Team の一時ファイルは `temp/team/` を使い、Task の `temp/input` / `temp/output` と混在させない。
- DB 項目名、API JSON key、状態値は日本語を維持する。
- `npm run build` はこのバックエンドの通常検証には不要。フロント変更時も通常は type-check を優先する。
