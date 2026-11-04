# _AIDIY/knowledge インデックス

このフォルダは現行実装の再利用 HowTo の入口です。履歴はGitと `_AIDIY/histories/` で確認し、旧版コピーは残しません。

- 文書の役割・命名・統合・削除・検証: [ナレッジ更新手順](./共通,ナレッジ更新手順.md)
- セルフテストの冊子・画像・PDF: [説明資料の書き方](./セルフテスト,_説明資料の書き方.md)
- セルフテストの音声解説と実演: [セルフテスト解説・ナレーション方法](./共通,セルフテスト解説・ナレーション方法.md)
- 実施済み試験と未確認範囲: [確認結果](../../docs/セルフテスト、操作ガイド/セルフテスト,共通,確認結果.md)
- 起動・依存・テスト: [開発環境運用手順](./共通,開発環境運用手順.md)
- cleanup と残留確認: [クリーンアップ手順](./共通,クリーンアップ手順.md)
- ローカルモデル: [モデル準備と起動](./backend_local,モデル準備と起動.md)
- アイコン: [原本と配布](./共通,アイコン原本と配布.md)

Toolsが利用できる場合の作業中の音声案内は [MCP活用手順](./backend_server,backend_tools,MCP活用手順.md#作業中の音声案内) を参照します。

## 重複しやすい話題の使い分け

| 話題 | 使い分け |
|------|----------|
| Node.js 外部 API の proxy / TLS / 安全な失敗ログ | [`共通,Node.js外部API通信の注意点.md`](./共通,Node.js外部API通信の注意点.md) を参照する。Discord と aidiy_diag の実装差、環境変数の優先順位、loopback mock による再検証をまとめる。 |
| 音声処理 | `AudioController` 単体、マイク、再生、エコー抑制、音声 WebSocket は [`backend_server,frontend_avatar,AI音声処理.md`](./backend_server,frontend_avatar,AI音声処理.md) に集約する。 |
| VRM / VRMA | モデルやモーションファイルを追加する場合は [`frontend_avatar,VRM_VRMA追加手順.md`](./frontend_avatar,VRM_VRMA追加手順.md)、表示サイズ・向き・表示選択 UI は [`frontend_avatar,frontend_web,アバター表示とVRMA.md`](./frontend_avatar,frontend_web,アバター表示とVRMA.md)、描画内部やカメラワークは [`frontend_avatar,3Dアバター制御(Three.js VRM).md`](<./frontend_avatar,3Dアバター制御(Three.js VRM).md>) を使う。 |
| MCP / 起動 | backend 常駐サーバーの起動は [`backend_server,command_hermes,backend_tools,バックエンド起動.md`](./backend_server,command_hermes,backend_tools,バックエンド起動.md)、MCP サーバー構成は [`backend_tools,構成.md`](./backend_tools,構成.md)、Code CLI への MCP 登録は [`command_hermes,backend_tools,CodeCLI_MCP設定.md`](./command_hermes,backend_tools,CodeCLI_MCP設定.md) を使う。 |

## セルフテスト資料の使い方



最初に共通準備・Diagを確認し、使うアプリまたはWeb業務の冊子へ進みます。Toolsは連携機能の確認時、確認結果は実施範囲と残件の照合時に参照します。すべてを順に実行する必要はありません。サーバー停止・外部送信・登録更新を伴う章は、その操作条件を確認してから実施します。

冊子の役割と実行形態の一覧はここに集約しています。**操作・検証ガイド21冊＋結果台帳1冊＝22冊**です。PDFの存在は全項目の合格を意味しません。実機試験、自動・隔離試験、音声解説、過去の証拠と今回の結果を区別し、各冊子の未確認範囲も確認してください。

共通の準備・記録・命名規則は[説明資料の書き方](./セルフテスト,_説明資料の書き方.md)、解説音声の段取りは[ナレーション方法](./共通,セルフテスト解説・ナレーション方法.md)です。この2文書と本索引は22冊のPDFに含めません。

### 共通準備・Diag

| 冊子・本文 | PDF | 役割 | 対象実行形態 |
|---|---|---|---|
| [aidiy_diag ／ システム起動編](../../docs/セルフテスト、操作ガイド/セルフテスト,aidiy_diag,システム起動編.md) | [PDF](../../docs/セルフテスト、操作ガイド/セルフテスト,aidiy_diag,システム起動編.pdf) | システムの起動・停止と稼働確認 | Diag Electron／管理サーバー |
| [aidiy_diag ／ ランチャー編](../../docs/セルフテスト、操作ガイド/セルフテスト,aidiy_diag,ランチャー編.md) | [PDF](../../docs/セルフテスト、操作ガイド/セルフテスト,aidiy_diag,ランチャー編.pdf) | 作業フォルダ選択、試験アカウント、アプリ起動 | Diag 標準・ミニ・アイコン |
| [aidiy_diag ／ 環境確認編](../../docs/セルフテスト、操作ガイド/セルフテスト,aidiy_diag,環境確認編.md) | [PDF](../../docs/セルフテスト、操作ガイド/セルフテスト,aidiy_diag,環境確認編.pdf) | 導入状況、モデル一覧、外部連携の確認 | Diag 環境確認タブ |
| [aidiy_diag ／ AIモデル・Tools編](../../docs/セルフテスト、操作ガイド/セルフテスト,aidiy_diag,AIモデル・Tools編.md) | [PDF](../../docs/セルフテスト、操作ガイド/セルフテスト,aidiy_diag,AIモデル・Tools編.pdf) | モデル応答とTools管理の確認 | Diag 診断画面／各接続先 |
| [aidiy_diag ／ 設定再起動編](../../docs/セルフテスト、操作ガイド/セルフテスト,aidiy_diag,設定再起動編.md) | [PDF](../../docs/セルフテスト、操作ガイド/セルフテスト,aidiy_diag,設定再起動編.pdf) | 設定保存・取消、再起動と復帰の確認 | Diag 設定画面／管理サーバー |

### 各アプリ

| 冊子・本文 | PDF | 役割 | 対象実行形態 |
|---|---|---|---|
| [aidiy_navi ／ 操作編](../../docs/セルフテスト、操作ガイド/セルフテスト,aidiy_navi,操作編.md) | [PDF](../../docs/セルフテスト、操作ガイド/セルフテスト,aidiy_navi,操作編.pdf) | 開発目標・作業項目・推定達成率・次の提案 | 単独／IDE・Web、読み取り専用 |
| [aidiy_console ／ 操作編](../../docs/セルフテスト、操作ガイド/セルフテスト,aidiy_console,操作編.md) | [PDF](../../docs/セルフテスト、操作ガイド/セルフテスト,aidiy_console,操作編.pdf) | CLIを開く入口とConsole画面 | 単独Electron（CLI個別操作はHermes編等） |
| [aidiy_hermes ／ 操作編](../../docs/セルフテスト、操作ガイド/セルフテスト,aidiy_hermes,操作編.md) | [PDF](../../docs/セルフテスト、操作ガイド/セルフテスト,aidiy_hermes,操作編.pdf) | ヘルプ・状態確認とCLI会話 | CLI。Electronアプリではありません |
| [aidiy_code ／ 操作編](../../docs/セルフテスト、操作ガイド/セルフテスト,aidiy_code,操作編.md) | [PDF](../../docs/セルフテスト、操作ガイド/セルフテスト,aidiy_code,操作編.pdf) | コード支援チャットの起動・入力・応答 | 単独Electron／--browser／VS Code拡張 |
| [aidiy_live ／ 操作編](../../docs/セルフテスト、操作ガイド/セルフテスト,aidiy_live,操作編.md) | [PDF](../../docs/セルフテスト、操作ガイド/セルフテスト,aidiy_live,操作編.pdf) | Live接続、文字・音声会話 | 単独Electron／--browser／VS Code拡張 |
| [aidiy_ide ／ 操作編](../../docs/セルフテスト、操作ガイド/セルフテスト,aidiy_ide,操作編.md) | [PDF](../../docs/セルフテスト、操作ガイド/セルフテスト,aidiy_ide,操作編.pdf) | 閲覧・検索・銀河表示とアプリ連携 | IDE Electron／ブラウザ。呼び出し・受渡しを扱う |
| [aidiy_browser ／ 操作編](../../docs/セルフテスト、操作ガイド/セルフテスト,aidiy_browser,操作編.md) | [PDF](../../docs/セルフテスト、操作ガイド/セルフテスト,aidiy_browser,操作編.pdf) | ページ閲覧、表示サイズ、パネルと連携 | 専用Browser Electron。Code/Liveの--browserとは別 |
| [aidiy_task ／ 操作編](../../docs/セルフテスト、操作ガイド/セルフテスト,aidiy_task,操作編.md) | [PDF](../../docs/セルフテスト、操作ガイド/セルフテスト,aidiy_task,操作編.pdf) | 要求・明細・開始条件と実行結果 | 単独Task／IDE連携起動 |
| [aidiy_team ／ 操作編](../../docs/セルフテスト、操作ガイド/セルフテスト,aidiy_team,操作編.md) | [PDF](../../docs/セルフテスト、操作ガイド/セルフテスト,aidiy_team,操作編.pdf) | 要員・依頼・作業ループと結果 | 単独Team／IDE連携起動 |
| [aidiy_avatar ／ Electron実行編](../../docs/セルフテスト、操作ガイド/セルフテスト,aidiy_avatar,Electron実行編.md) | [PDF](../../docs/セルフテスト、操作ガイド/セルフテスト,aidiy_avatar,Electron実行編.pdf) | 独立窓の認証・会話・表示・ファイル閲覧 | Avatar Electron（8092） |
| [aidiy_avatar ／ Web実行編](../../docs/セルフテスト、操作ガイド/セルフテスト,aidiy_avatar,Web実行編.md) | [PDF](../../docs/セルフテスト、操作ガイド/セルフテスト,aidiy_avatar,Web実行編.pdf) | 左右パネル・タブの認証と会話 | Avatar Web（8092）。通常Web8090とは別 |
| [aidiy_discord ／ 操作編](../../docs/セルフテスト、操作ガイド/セルフテスト,aidiy_discord,操作編.md) | [PDF](../../docs/セルフテスト、操作ガイド/セルフテスト,aidiy_discord,操作編.pdf) | Discord接続・会話・設定・終了 | Discordパネル／Bot。外部投稿・音声は別条件 |
| [aidiy_slack ／ 操作編](../../docs/セルフテスト、操作ガイド/セルフテスト,aidiy_slack,操作編.md) | [PDF](../../docs/セルフテスト、操作ガイド/セルフテスト,aidiy_slack,操作編.pdf) | Slack接続・スレッド会話・設定・終了 | Slackパネル／Bot。外部投稿は別条件 |

### Web業務・共通画面

| 冊子・本文 | PDF | 役割 | 対象実行形態 |
|---|---|---|---|
| [frontend_web ／ AiDiy編](../../docs/セルフテスト、操作ガイド/セルフテスト,frontend_web,AiDiy編.md) | [PDF](../../docs/セルフテスト、操作ガイド/セルフテスト,frontend_web,AiDiy編.pdf) | ログイン、AI画面、共通ナビ・管理・X系デモ | 通常Web（8090）。X系は第7章で、独立冊子なし |
| [frontend_web ／ 配車管理編](../../docs/セルフテスト、操作ガイド/セルフテスト,frontend_web,配車管理編.md) | [PDF](../../docs/セルフテスト、操作ガイド/セルフテスト,frontend_web,配車管理編.pdf) | 配車関連マスタ・伝票・日／週予定 | 通常Web（8090） |
| [frontend_web ／ 生産・在庫管理編](../../docs/セルフテスト、操作ガイド/セルフテスト,frontend_web,生産・在庫管理編.md) | [PDF](../../docs/セルフテスト、操作ガイド/セルフテスト,frontend_web,生産・在庫管理編.pdf) | 生産・在庫マスタ、伝票、予定・推移 | 通常Web（8090） |

### Tools

| 冊子・本文 | PDF | 役割 | 対象実行形態 |
|---|---|---|---|
| [backend_tools ／ 主要メソッド編](../../docs/セルフテスト、操作ガイド/セルフテスト,backend_tools,主要メソッド編.md) | [PDF](../../docs/セルフテスト、操作ガイド/セルフテスト,backend_tools,主要メソッド編.pdf) | 代表的なMCPメソッドと入出力の確認 | Tools API／MCP。全メソッド網羅ではない |

### 確認結果

| 冊子・本文 | PDF | 役割 | 対象実行形態 |
|---|---|---|---|
| [共通 ／ 確認結果](../../docs/セルフテスト、操作ガイド/セルフテスト,共通,確認結果.md) | [PDF](../../docs/セルフテスト、操作ガイド/セルフテスト,共通,確認結果.pdf) | 実施範囲・判定・未確認事項の照合 | 全体の結果台帳。操作ガイドの代わりにはしない |

## 迷ったときの入口

セルフテストの冊子選びは上の「セルフテスト資料の使い方」に集約しています。以下は実装・運用ナレッジへの案内です。

| 症状・依頼 | 最初に見るファイル |
|-----------|------------------|
| Electron画面の0.5秒長押しドラッグ、透明パネルで領域を先に確保する表示開始ズーム | [`共通,Electronウィンドウ基本方針.md`](./共通,Electronウィンドウ基本方針.md) |
| 今後の改善提案を比較し、採用条件を検討する | [`共通,明日のために,改善提案.md`](./共通,明日のために,改善提案.md) |
| 固定版の改善課題と再現条件・検証限界を確認する | [`共通,明日のために,改善課題.md`](./共通,明日のために,改善課題.md) |
| AGENTS / CLAUDE / _AIDIY の役割分担整理 | [`共通,ナレッジ更新手順.md`](./共通,ナレッジ更新手順.md) |
| DB スキーマ差分、起動時のカラム不足 | [`backend_server,スキーマ変更手順.md`](./backend_server,スキーマ変更手順.md) |
| M / T / V / S 系の追加、登録漏れ | [`backend_server,M系マスタ追加手順.md`](./backend_server,M系マスタ追加手順.md)、[`backend_server,T系トランザクション追加手順.md`](./backend_server,T系トランザクション追加手順.md)、[`backend_server,V系エンドポイント追加手順.md`](./backend_server,V系エンドポイント追加手順.md)、[`backend_server,S系スケジューラ追加手順.md`](./backend_server,S系スケジューラ追加手順.md) |
| M系マスタへのカラム追加 | [`backend_server,M系マスタ追加手順.md`](./backend_server,M系マスタ追加手順.md) |
| 採番、監査フィールド、初期データ | [`backend_server,C採番と監査フィールド.md`](./backend_server,C採番と監査フィールド.md) |
| backend の層構造、実装パターン、落とし穴 | [`backend_server,実装パターン.md`](./backend_server,実装パターン.md) |
| ログイン、401、トークン延長、パスワード | [`backend_server,frontend_web,frontend_avatar,JWT認証フロー.md`](./backend_server,frontend_web,frontend_avatar,JWT認証フロー.md)、[`backend_server,C利用者パスワード運用.md`](./backend_server,C利用者パスワード運用.md) |
| backend / MCP / task・team 起動、ポート残留 | [`backend_server,command_hermes,backend_tools,バックエンド起動.md`](./backend_server,command_hermes,backend_tools,バックエンド起動.md)、[`backend_tools,構成.md`](./backend_tools,構成.md) |
| AIタスク（要求分解・明細DAG・実行開始条件）、AIチーム（依頼・経験・作業ループ・自動会話）の仕様 | `backend_taskteam/AGENTS.md`（構成・仕様の入口。実行記録と繰り返し監視の HowTo は次項） |
| AIタスクの実行済み記録が空になる、間隔実行が1回のエラーで止まる、実行監視タスクを作る | [`backend_taskteam,AIタスクの実行記録と繰り返し監視.md`](./backend_taskteam,AIタスクの実行記録と繰り返し監視.md) |
| aidiy_hermes で MCP が `failed` / ツール未認識 | [`command_hermes,backend_tools,MCP_SSE接続.md`](./command_hermes,backend_tools,MCP_SSE接続.md) |
| upstream hermes-agent の新版を command_hermes へ取り込む、移植後に起動しない | [`command_hermes,upstream移植手順.md`](./command_hermes,upstream移植手順.md) |
| Windows ネイティブで terminal / file 操作が落ちる、OS 分岐を入れたい | [`command_hermes,Windows対応規則.md`](./command_hermes,Windows対応規則.md) |
| hermes を MCP サーバーとして Code CLI から使う | [`command_hermes,MCP_サーバー起動.md`](./command_hermes,MCP_サーバー起動.md) |
| プロジェクト別に Chat / Code の会話履歴を分析する | [`backend_server,frontend_ide,frontend_web,frontend_avatar,会話履歴のプロジェクト識別.md`](./backend_server,frontend_ide,frontend_web,frontend_avatar,会話履歴のプロジェクト識別.md) |
| AIチャット / AIコードの引数・実行オプション（会話継続・履歴保存・ストリーム送信・出力ファイル保存）を追加・変更する | [`backend_server,backend_tools,AIチャット・AIコード共通パラメータ.md`](./backend_server,backend_tools,AIチャット・AIコード共通パラメータ.md) |
| AI モデル、WebSocket、code1〜code6 | [`backend_server,frontend_avatar,frontend_web,AIモデル設定変更手順.md`](./backend_server,frontend_avatar,frontend_web,AIモデル設定変更手順.md)、[`backend_server,frontend_avatar,frontend_web,AIコアWebSocket仕様.md`](./backend_server,frontend_avatar,frontend_web,AIコアWebSocket仕様.md)、[`backend_server,frontend_avatar,frontend_web,AIコードパネル拡張手順.md`](./backend_server,frontend_avatar,frontend_web,AIコードパネル拡張手順.md) |
| Code CLI 追加、CLI 出力、MCP 設定 | [`backend_server,command_hermes,frontend_avatar,frontend_web,CodeCLI追加手順.md`](./backend_server,command_hermes,frontend_avatar,frontend_web,CodeCLI追加手順.md)、[`backend_server,command_hermes,frontend_avatar,CodeCLI表示ANSI制御コード対処.md`](./backend_server,command_hermes,frontend_avatar,CodeCLI表示ANSI制御コード対処.md)、[`command_hermes,backend_tools,CodeCLI_MCP設定.md`](./command_hermes,backend_tools,CodeCLI_MCP設定.md) |
| frontend_web 画面、X系、proxy | [`frontend_web,画面追加手順.md`](./frontend_web,画面追加手順.md)、[`frontend_web,X系静的画面追加.md`](./frontend_web,X系静的画面追加.md)、[`frontend_web,frontend_avatar,backend_server,Viteプロキシ設定.md`](./frontend_web,frontend_avatar,backend_server,Viteプロキシ設定.md) |
| frontend_web の UI ルール、qTubler、明細型編集 | [`frontend_web,画面追加手順.md`](./frontend_web,画面追加手順.md) |
| 画面コンポーネントを直す（Web / Avatar の対応実装と共通契約を確認） | [`frontend_web,画面追加手順.md`](./frontend_web,画面追加手順.md)（「共通実装を変更するとき」）、[`frontend_web,frontend_avatar,共通ユーティリティ.md`](./frontend_web,frontend_avatar,共通ユーティリティ.md) |
| frontend_avatar、Electron、VRM / VRMA、音声 | [`frontend_avatar,変更チェック.md`](./frontend_avatar,変更チェック.md)、[`frontend_avatar,ElectronIPC追加手順.md`](./frontend_avatar,ElectronIPC追加手順.md)、[`frontend_avatar,VRM_VRMA追加手順.md`](./frontend_avatar,VRM_VRMA追加手順.md)、[`frontend_avatar,frontend_web,アバター表示とVRMA.md`](./frontend_avatar,frontend_web,アバター表示とVRMA.md)、[`backend_server,frontend_avatar,AI音声処理.md`](./backend_server,frontend_avatar,AI音声処理.md) |
| VS Code の AiDiy Code / AiDiy Live 拡張を変更・検証・配布する | [`frontend_ide,VSCodeチャット拡張変更手順.md`](./frontend_ide,VSCodeチャット拡張変更手順.md) |
| Discord の Code / Live 接続、Bot 設定、音声中継を変更・検証する | [`frontend_channels,Discord接続変更手順.md`](./frontend_channels,Discord接続変更手順.md) |
| command_hermes の CLI 起動・確認 | [`command_hermes,backend_server,運用手順.md`](./command_hermes,backend_server,運用手順.md) |
| backend_tools の起動・SSE・環境変数 | [`backend_tools,backend_server,運用手順.md`](./backend_tools,backend_server,運用手順.md) |
| バックアップ保存先、旧 `.backup_local/`・`backup/` から `.aidiy_backup/` への移行、保存版との比較 | [`command_hermes,共通,MCPバックアップ検証手順.md`](./command_hermes,共通,MCPバックアップ検証手順.md) |
| backend_tools の メディア生成 HTTP API、save_path 挙動、SSE マウント方法 | [`backend_tools,HTTP_API_save_path挙動.md`](./backend_tools,HTTP_API_save_path挙動.md) |
| Markdown、BOM、ナレッジ整理 | [`共通,ナレッジ更新手順.md`](./共通,ナレッジ更新手順.md)、[`共通,UTF8BOM問題対処.md`](./共通,UTF8BOM問題対処.md) |
| 開発環境操作、DB、Swagger、よくある問題 | [`共通,開発環境運用手順.md`](./共通,開発環境運用手順.md) |
| GitHub issue の確認・close | [`共通,GitHubIssue運用手順.md`](./共通,GitHubIssue運用手順.md) |
| MCP（TTS / OBS / ffmpeg / Chrome devtools）で紹介動画を自動生成する | [`共通,mcp利用による自動ビデオ生成手順.md`](./共通,mcp利用による自動ビデオ生成手順.md) ※ 実装済み自動化: `backend_tools/aidiy_automations/ビデオページ生成/ビデオページ生成_紹介.py`, `backend_tools/aidiy_automations/ビデオページ生成/ビデオページ生成_解説.py` |
| 紹介ビデオ（take）またはアバター版プレゼンターを新規作成・改版する | [`frontend_web,X系紹介ビデオとアバター作成手順.md`](./frontend_web,X系紹介ビデオとアバター作成手順.md) |
| ニュース型掛け合いビデオ（female+male 2アバター・1ページ複数ターン）を作成・改版する | [`frontend_web,X系ニュース型掛け合いビデオ.md`](./frontend_web,X系ニュース型掛け合いビデオ.md) |

再修正時もこの索引から対象テーマを選び、記載された実装と検証方法を確認します。

## Backend データ・スキーマ

| 目的 | 参照ファイル |
|------|--------------|
| SQLite スキーマ変更と手動 DB 再作成の前提を確認する | [`backend_server,スキーマ変更手順.md`](./backend_server,スキーマ変更手順.md) |
| C採番と監査フィールドを使う | [`backend_server,C採番と監査フィールド.md`](./backend_server,C採番と監査フィールド.md) |
| backend の Model / Schema / CRUD / Router パターンを確認する | [`backend_server,実装パターン.md`](./backend_server,実装パターン.md) |

## Backend 認証

| 目的 | 参照ファイル |
|------|--------------|
| JWT ログインから 401 ハンドリングまで確認する | [`backend_server,frontend_web,frontend_avatar,JWT認証フロー.md`](./backend_server,frontend_web,frontend_avatar,JWT認証フロー.md) |
| C利用者のパスワード保存・照合方針を確認する | [`backend_server,C利用者パスワード運用.md`](./backend_server,C利用者パスワード運用.md) |

## Backend API 追加

| 目的 | 参照ファイル |
|------|--------------|
| M系マスタを追加する | [`backend_server,M系マスタ追加手順.md`](./backend_server,M系マスタ追加手順.md) |
| T系トランザクションを追加する | [`backend_server,T系トランザクション追加手順.md`](./backend_server,T系トランザクション追加手順.md) |
| V系 JOIN / 集計エンドポイントを追加する | [`backend_server,V系エンドポイント追加手順.md`](./backend_server,V系エンドポイント追加手順.md) |
| S系スケジューラを追加する | [`backend_server,S系スケジューラ追加手順.md`](./backend_server,S系スケジューラ追加手順.md) |

## Backend 起動・運用

| 目的 | 参照ファイル |
|------|--------------|
| backend_server / backend_tools / backend_taskteam を起動・再起動する | [`backend_server,command_hermes,backend_tools,バックエンド起動.md`](./backend_server,command_hermes,backend_tools,バックエンド起動.md) |
| 開発環境の起動、依存関係、DB、API確認、問題切り分けを行う | [`共通,開発環境運用手順.md`](./共通,開発環境運用手順.md) |
| Docker / Nginx 構成で起動する | [`backend_server,frontend_web,Docker構成.md`](./backend_server,frontend_web,Docker構成.md) |
| MCP サーバー構成を確認する | [`backend_tools,構成.md`](./backend_tools,構成.md) |
| backend_tools の起動、stdio bridge、環境変数を確認する | [`backend_tools,backend_server,運用手順.md`](./backend_tools,backend_server,運用手順.md) |
| MCP ツールをコードエージェントから使う | [`backend_server,backend_tools,MCP活用手順.md`](./backend_server,backend_tools,MCP活用手順.md) |
| MCP バックアップツールでファイル検証・差分確認をする | [`command_hermes,共通,MCPバックアップ検証手順.md`](./command_hermes,共通,MCPバックアップ検証手順.md) |

## Frontend 共通

| 目的 | 参照ファイル |
|------|--------------|
| Electron renderer の Avatar 構成例・配置判断と、長押しドラッグ・表示開始ズーム | [`共通,Electronウィンドウ基本方針.md`](./共通,Electronウィンドウ基本方針.md) |
| Avatar / VS Code の Electron を事前導入し、バイナリ・ZIP を再利用する | [`共通,開発環境運用手順.md`](./共通,開発環境運用手順.md)（「Electron の共通セットアップ」） |
| Vite proxy / CORS / ポートを調整する | [`frontend_web,frontend_avatar,backend_server,Viteプロキシ設定.md`](./frontend_web,frontend_avatar,backend_server,Viteプロキシ設定.md) |
| Axios API クライアントのパターン・token 付与・401 ハンドリングを確認する | [`frontend_web,frontend_avatar,共通APIクライアントパターン.md`](./frontend_web,frontend_avatar,共通APIクライアントパターン.md) |
| Monaco Editor / qAlert / qConfirm など共通ユーティリティを修正する | [`frontend_web,frontend_avatar,共通ユーティリティ.md`](./frontend_web,frontend_avatar,共通ユーティリティ.md) |
| 両プロジェクトの package.json / tsconfig / vite.config の差異と同期ルールを確認する | [`frontend_web,frontend_avatar,プロジェクト設定と依存関係.md`](./frontend_web,frontend_avatar,プロジェクト設定と依存関係.md) |

## Frontend Web

| 目的 | 参照ファイル |
|------|--------------|
| Vue 3 の業務画面を追加する | [`frontend_web,画面追加手順.md`](./frontend_web,画面追加手順.md) |
| X系の静的画面・ゲーム・デモを追加する | [`frontend_web,X系静的画面追加.md`](./frontend_web,X系静的画面追加.md) |

## Frontend Avatar / Electron

| 目的 | 参照ファイル |
|------|--------------|
| Electron IPC を追加する | [`frontend_avatar,ElectronIPC追加手順.md`](./frontend_avatar,ElectronIPC追加手順.md) |
| Electron / Web 両モードの変更チェックを行う | [`frontend_avatar,変更チェック.md`](./frontend_avatar,変更チェック.md) |
| VRM モデル・VRMA モーションを追加する | [`frontend_avatar,VRM_VRMA追加手順.md`](./frontend_avatar,VRM_VRMA追加手順.md) |
| アバター表示・VRMA 連続再生・表示選択 UI を調整する | [`frontend_avatar,frontend_web,アバター表示とVRMA.md`](./frontend_avatar,frontend_web,アバター表示とVRMA.md) |
| xneko / xeyes 系ウィジェットを追加する | [`frontend_avatar,xneko_xeyesウィジェット追加手順.md`](./frontend_avatar,xneko_xeyesウィジェット追加手順.md) |
| マイク入力・音声再生・エコー抑制を調整する | [`backend_server,frontend_avatar,AI音声処理.md`](./backend_server,frontend_avatar,AI音声処理.md) |
| AiDiy.vue の全体構成・状態・初期化フローを確認する | [`frontend_avatar,AiDiy.vue全体構成と状態管理.md`](./frontend_avatar,AiDiy.vue全体構成と状態管理.md) |
| Electron ウィンドウの位置・サイズ・IPC・ライフサイクルを変更する | [`frontend_avatar,Electronウィンドウ管理.md`](./frontend_avatar,Electronウィンドウ管理.md) |
| 3D アバター描画・VRMA 再生・視線補助・カメラワークを調整する | [`frontend_avatar,3Dアバター制御(Three.js VRM).md`](<./frontend_avatar,3Dアバター制御(Three.js VRM).md>) |

## aidiy_diag 環境診断

| 目的 | 参照ファイル |
|------|--------------|
| aidiy_diag の診断・Vue 画面・配布物・起動を変更・検証する | [`backend_diag,環境診断運用.md`](./backend_diag,環境診断運用.md) |

## Frontend IDE

| 目的 | 参照ファイル |
|------|--------------|
| Console / Code / Live / IDE の日本語機能フォルダ・共通 Vue 部品・配布・検証を確認する | [`frontend_ide,Vue共通画面変更手順.md`](./frontend_ide,Vue共通画面変更手順.md) |
| Code / Live の画面隅・複数窓、Console の縦横別サイズを調整する | [`frontend_ide,初期ウィンドウ配置.md`](./frontend_ide,初期ウィンドウ配置.md) |
| IDE の今日・本日最新の強調、電子の周回、描画負荷を確認する | [`frontend_ide,更新の目印と電子表示.md`](./frontend_ide,更新の目印と電子表示.md) |
| IDE の文書表示（Word / Excel / PowerPoint / PDF）を変更する | [`frontend_ide,文書ビューア.md`](./frontend_ide,文書ビューア.md) |

## Frontend Discord / Slack

| 目的 | 参照ファイル |
|------|--------------|
| Discord の Code / Live 接続・Vue パネル・配布物を変更・検証する | [`frontend_channels,Discord接続変更手順.md`](./frontend_channels,Discord接続変更手順.md) |

## Frontend VS Code

| 目的 | 参照ファイル |
|------|--------------|
| VS Code 拡張（Code / Live）と単独起動版を変更・検証・VSIX 配布する | [`frontend_ide,VSCodeチャット拡張変更手順.md`](./frontend_ide,VSCodeチャット拡張変更手順.md) |
| 拡張機能をセットアップして VS Code へ配置する | [`共通,開発環境運用手順.md`](./共通,開発環境運用手順.md) |
| 配置済み拡張機能と生成物を解除する | [`共通,クリーンアップ手順.md`](./共通,クリーンアップ手順.md) |

## AI コア

- [backend_server,backend_tools,AI判断追加手順.md](./backend_server,backend_tools,AI判断追加手順.md) — Decisions API / OAuth JSON Schema、共通入出力、MCP、プロバイダ追加。


| 目的 | 参照ファイル |
|------|--------------|
| AIコア WebSocket の接続・パケット形式を確認する | [`backend_server,frontend_avatar,frontend_web,AIコアWebSocket仕様.md`](./backend_server,frontend_avatar,frontend_web,AIコアWebSocket仕様.md) |
| Gemini の thought_signature を tool_calls で中間保持・復元する | [`backend_server,Gemini_thought_signature保持と復元.md`](./backend_server,Gemini_thought_signature保持と復元.md) |
| AIWebSocket クライアントの実装・再接続ポリシー・両フロントエンドの差分を確認する | [`frontend_web,frontend_avatar,共通WebSocketクライアント.md`](./frontend_web,frontend_avatar,共通WebSocketクライアント.md) |
| AIチャット / AIコードに共通パラメータを追加する（片方だけに独自引数を足さない） | [`backend_server,backend_tools,AIチャット・AIコード共通パラメータ.md`](./backend_server,backend_tools,AIチャット・AIコード共通パラメータ.md) |
| AI モデル設定を変更する | [`backend_server,frontend_avatar,frontend_web,AIモデル設定変更手順.md`](./backend_server,frontend_avatar,frontend_web,AIモデル設定変更手順.md) |
| code1〜code6 のコード AI パネルを調整する | [`backend_server,frontend_avatar,frontend_web,AIコードパネル拡張手順.md`](./backend_server,frontend_avatar,frontend_web,AIコードパネル拡張手順.md) |
| backend_server の設定管理（conf_json / conf_model / conf_path）を変更する | [`backend_server,設定管理(conf).md`](<./backend_server,設定管理(conf).md>) |

## Frontend Web ルーター・状態管理

| 目的 | 参照ファイル |
|------|--------------|
| Pinia store のパターン・auth store の動作を確認する | [`frontend_web,Pinia Storeパターン.md`](./frontend_web,Pinia Storeパターン.md) |
| Vue Router の3ファイル分割・認証ガード・ルート追加手順を確認する | [`frontend_web,Vue Routerパターン.md`](./frontend_web,Vue Routerパターン.md) |

## Code CLI

| 目的 | 参照ファイル |
|------|--------------|
| Code CLI を追加する | [`backend_server,command_hermes,frontend_avatar,frontend_web,CodeCLI追加手順.md`](./backend_server,command_hermes,frontend_avatar,frontend_web,CodeCLI追加手順.md) |
| Code CLI の MCP 設定を確認する | [`command_hermes,backend_tools,CodeCLI_MCP設定.md`](./command_hermes,backend_tools,CodeCLI_MCP設定.md) |
| aidiy_hermes の MCP SSE 接続を修復・確認する | [`command_hermes,backend_tools,MCP_SSE接続.md`](./command_hermes,backend_tools,MCP_SSE接続.md) |
| Code CLI のプロンプト整形責務を確認する | [`backend_server,CodeCLIプロンプト整形.md`](./backend_server,CodeCLIプロンプト整形.md) |
| CLI 出力の ANSI 制御コードを除去する | [`backend_server,command_hermes,frontend_avatar,CodeCLI表示ANSI制御コード対処.md`](./backend_server,command_hermes,frontend_avatar,CodeCLI表示ANSI制御コード対処.md) |
| upstream hermes-agent の新版へ移植する | [`command_hermes,upstream移植手順.md`](./command_hermes,upstream移植手順.md) |
| Hermes CLI の TUI を調整する | [`command_hermes,TUI調整手順.md`](./command_hermes,TUI調整手順.md) |
| Hermes CLI の Provider 一覧・選択ロジックを確認する | [`command_hermes,Provider一覧と選択ロジック.md`](./command_hermes,Provider一覧と選択ロジック.md) |
| Hermes CLI の Slash Command 一覧・追加手順を確認する | [`command_hermes,Slash Command一覧.md`](./command_hermes,Slash Command一覧.md) |
| command_hermes を単体 CLI として起動・確認する | [`command_hermes,backend_server,運用手順.md`](./command_hermes,backend_server,運用手順.md) |
| hermes を MCP サーバーとして起動・Code CLI から接続する | [`command_hermes,MCP_サーバー起動.md`](./command_hermes,MCP_サーバー起動.md) |
| opencode_cli 追加（パス解決・コマンド構築・suffix除去）のパターンを確認する | [`backend_server,opencode_cli追加と実行パターン.md`](./backend_server,opencode_cli追加と実行パターン.md) |
| grok_cli 追加（パス解決・コマンド構築・モデル候補・配線箇所）のパターンを確認する | [`backend_server,grok_cli追加と実行パターン.md`](./backend_server,grok_cli追加と実行パターン.md) |
| antigravity_cli のタイムアウト延長・継続フラグの調整パターンを確認する | [`backend_server,antigravity_cliタイムアウトと継続オプション.md`](./backend_server,antigravity_cliタイムアウトと継続オプション.md) |
| Windows ネイティブ実行の OS 分岐規則・落とし穴を確認する | [`command_hermes,Windows対応規則.md`](./command_hermes,Windows対応規則.md) |

## メディア生成

| 目的 | 参照ファイル |
|------|--------------|
| MCP（TTS / OBS / ffmpeg / Chrome devtools）で紹介動画を自動生成する | [`共通,mcp利用による自動ビデオ生成手順.md`](./共通,mcp利用による自動ビデオ生成手順.md) |
| 紹介ビデオ（take）またはアバター版プレゼンターを新規作成・改版する | [`frontend_web,X系紹介ビデオとアバター作成手順.md`](./frontend_web,X系紹介ビデオとアバター作成手順.md) |
| ニュース型掛け合いビデオ（female+male 2アバター・1ページ複数ターン）を作成・改版する | [`frontend_web,X系ニュース型掛け合いビデオ.md`](./frontend_web,X系ニュース型掛け合いビデオ.md) |

## その他の実装・運用入口

- [自動更新起動](./共通,自動更新起動手順.md)
- [TaskTeam内部認証と通常ログイン](./backend_taskteam,内部認証と通常ログイン.md)
- [小説解説ビデオ](./frontend_web,X系小説解説ビデオ作成手順.md)
- [IDEエクスプローラーファイル操作](./frontend_ide,エクスプローラーファイル操作.md)

## ドキュメント・共通

| 目的 | 参照ファイル |
|------|--------------|
| Markdown を現行実装へ追従させる | [`共通,ナレッジ更新手順.md`](./共通,ナレッジ更新手順.md) |
| UTF-8 BOM を検出・除去する | [`共通,UTF8BOM問題対処.md`](./共通,UTF8BOM問題対処.md) |
| 一時ファイル・バックアップを整理する | [`共通,クリーンアップ手順.md`](./共通,クリーンアップ手順.md) |
| Git 未管理フォルダにローカル履歴を用意する | [`共通,ローカルGit管理.md`](./共通,ローカルGit管理.md) |
| GitHub issue を確認・close する | [`共通,GitHubIssue運用手順.md`](./共通,GitHubIssue運用手順.md) |

## 明日のための改善検討

- [共通,明日のために,改善提案.md](./共通,明日のために,改善提案.md): 既存機能を踏まえた改善提案10件、判断基準と検証方法。
- [共通,明日のために,改善課題.md](./共通,明日のために,改善課題.md): 固定コミットの調査結果。現在の未解決一覧ではなく、再現条件・受入確認の参考。

## Tools主要メソッドのセルフテスト

[主要メソッド編](../../docs/セルフテスト、操作ガイド/セルフテスト,backend_tools,主要メソッド編.md) — 実行した18 MCP、環境依存のPASS、パラメータと結果のSVG図解。

セルフテスト証跡の維持方針は [説明資料の書き方](./セルフテスト,_説明資料の書き方.md) を参照します。資料整理・setup成功と実画面試験の合格を区別します。
