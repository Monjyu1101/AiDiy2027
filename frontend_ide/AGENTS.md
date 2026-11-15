# frontend_ide 実装概要

IDE / Term / Browser / Navi / Code / Live / Task / Team / CPU は AiDiy の正式なサブシステムであり、本フォルダが9種類のVue 3画面を所有する。VS Code拡張はCode / Liveだけ、単独起動は9種類。Task / Team はAvatarから移設した独立版で、専用bundleと独立した認証・ウィンドウを使う。Web／Avatar内の旧Task／Team画面・入口は撤去済み。

全体のコンセプトは **開発スペース（宇宙をテーマにした IDE 開発環境）**。プロジェクトを宇宙（フォルダ＝銀河、ファイル＝星・惑星）として見せ、人はソースをほぼ触らずに「眺める・辿る・読む・頼む」で開発する。本文の編集は Code / Live を通じて AI に任せ、ビューアは読み取り専用を保つ。エクスプローラーでは明示操作によるコピー・名前変更・新規作成・確認付きのゴミ箱移動を提供する。Code / Live は単独起動・VS Code 拡張を維持したまま、開発スペースの部品としても動作させる（3つの使い方を壊さない）。説明文では見た目を宇宙、画面の文字は「フォルダ」「ファイル」など一般名で書く。

- ルート直下は起動入口（`launch.mjs` / `server.mjs` / `desktop.cjs`）、セットアップ・解除、設定・説明に限定する。Electronの内部処理は `デスクトップ/`、検索・解析・履歴・エクスプローラー操作のAPIは `ファイル機能/`、PTYは `aidiy_term/`、Markdown表示は `viewer/`、VS Code用HTMLは `host/src/` に置く。
- 画面・通信・描画・補助処理は `src/components/` の日本語機能フォルダにまとめ、独立ダイアログは `src/dialog/` に分ける。Task / Team は専用 bundle の機能内構成を維持する。共通表示と下書き連携は各画面から共有し、同じ概念の別名部品やアプリ別コピーを増やさない。
- Code / Liveの通信・VS Code拡張ホストは `host/`、ファイルAPI・Office表示は `viewer/` に統合する。Discord・Slack（`frontend_channels`）は `host/` の共通処理を利用する。AIコアと共通の Hermes / Pi 実行基盤を使用し、UIに秘密情報を渡さない。Codeのオフライン利用はHermes / Piを選択して直接実行する。
- ポートは自動割り当て。ElectronとWebで同じVue画面を使う。BrowserだけはElectron専用で、通常Webへの切り替えは行わない。
- IDEのElectron版は「＋ Term」「＋ Code」「＋ Live」で同じプロジェクトの別ウィンドウを開く。Web版は画面内タブ。別窓はIDEの利用モード・セッションとの連携を必須とする。「終了」は子窓を閉じて起動画面へ戻す。タイトルバーの×は確認後にIDE全体を閉じる。オンライン判定はTermと同じtoolsポートのpingを使う。toolsの接続喪失では作業セッションと子窓を維持し、tools復帰時に再接続する。起動・権限・終了連携はElectronメインプロセスで管理する。
- IDEの利用開始は手動。Term / Browser / Codeは利用開始後に開け、オンラインではNavi / Live / Avatar / Task / Teamも使う。Browserはオフラインでも起動・操作でき、AI解析だけtools接続中に有効とする。宇宙表示と文書ビューアは読み取り専用。
- コンポーネント破棄時は購読、タイマー、描画、マイク、接続を片付ける。
- 自作ソースには既存の著作権・利用条件の定型文を維持する。第三者ライセンスは配布物へ含める。
- 実装変更は画面を撮影して確認する。手順はREADMEと `_AIDIY/knowledge/` に記載する。

- Termは `ターミナルパネル.vue`（xterm.js）と `aidiy_term/term.mjs`（WebSocket）を使い、`aidiy_term/term-process.mjs` / `aidiy_term/term-worker.mjs` が端末ごとのPTYとプロセス終了を管理する。端末は通常のシェル権限を持ち、ファイルビューアだけが読み取り専用。TermにはVS Code拡張を作らない。
- setup / cleanup の表示・処理順は IDE → Term → Browser → Navi → Code → Live → Task → Team → CPU。全体startの自動起動対象は従来どおりで、Navi / Browser は独立コマンドやDiagから手動起動し、Task / Team はそれに加えて全体startの個別選択（既定OFF）でも起動できる。共有依存物は各アプリの停止・解除後に片付ける。

- Navi は独立した開発案内画面。目標・作業項目・推定達成率・次のプロンプトの作成と再評価は読み取り専用。明示的に自動航行をオンにした場合だけ、右側に埋め込んだ専用Codeへ提案を送り、成功後に再評価する。Codeはファイル変更を伴う通常実行で、総合評価100%・3回連続の改善なし・失敗・対象変更などで停止する。停止要求は変更済みファイルの取り消しではない。単独起動は `aidiy_navi`、IDEでは「＋ Navi」から複数窓を開く。

- CPUは `aidiy_cpu` で単独起動できる小型のホスト使用率画面。IDE子窓と同じVue部品・計測APIを使い、Core / Toolsへの接続を必要としない。単独サーバーは計測と状態読込だけを公開し、ファイル操作・AI・Term起動は許可しない。DiagのCPUアイコンと全体startの個別選択（既定OFF）からも起動する。

## 開発スペースの考え方

AiDiy IDE の中心となる画面は `frontend_ide/src/components/開発スペース/` が所有し、`frontend_ide/viewer` はファイルAPI・Office表示を担当します。AiDiy の**開発スペース**（宇宙をテーマにした IDE 開発環境）は、作業フォルダを眺め、探し、中身を読むための開発用 UI です。目指すのは「ソースをほぼ触らない IDE」で、人は宇宙で全体を眺め、エクスプローラーで辿り、ビューアで読み、変更は部品として呼び出す Code / Live を通じて AI に任せます。

- フォルダを銀河、ファイルを星・惑星として1階層ずつ表示する。
- 左上のバーガーボタンで左側のエクスプローラーを開閉し、右側でコード・画像・フォルダ内容を表示する。
- ビューアは読み取り専用。起点日時以降の更新を明滅・金色表示で可視化する。
- Node.js、Vue 3、Canvas 描画、Monaco Editor で構成する。IDE / Term / Browser / Navi / Code / Live / Task / Team / CPU の画面と依存物は `frontend_ide` で共有する。
- 全体のセットアップ・起動・クリーンアップに組み込み済み。単独起動コマンドは `aidiy_ide`、ポートは固定せず自動割り当て。

ファイルAPI・Office表示は [viewer/AGENTS.md](./viewer/AGENTS.md) を参照してください。

## Navi 概要

Navi は `frontend_ide` が所有する開発案内画面です。`aidiy_navi` で単独起動するか、IDE の「＋ Navi」から開きます。ナビ・再評価は読み取り専用で、目標・作業項目・推定達成率・次のプロンプトを表示します。「自動航行」を明示的にオンにすると、専用 Code が提案を実行してファイルを変更し、完了後に再評価します。自動航行の許可は保存せず、再表示時はオフです。全体 start の個別自動起動対象ではありません。

## Vue共通画面と配置規則

現行のIDE / Term / Browser / Navi / Code / Live / Task / Team / CPUの画面は `frontend_ide` のVue部品を使用します。VS Code拡張はCode / Liveのみ、単独実行は9種類です。エクスプローラーは `frontend_ide/src/components/ファイル閲覧/ファイル一覧.vue` に集約し、選択と検索マークを宇宙表示へ通知します。既存の `frontend_ide/host` は拡張ホスト・Code の Hermes / Pi 実行・Live音声基盤、`frontend_ide/viewer` はファイルAPI・Office表示資産を提供します。旧起動入口からもVue版へ進みます。詳細は `_AIDIY/knowledge/frontend_ide,Vue共通画面変更手順.md` を参照してください。

Diag / Navi / Code / Live / Term / IDE / Discord / Slack の独自実装は、日本語の機能名で配置し、共通処理は所有元から再利用します。`src`・`checks`・`scripts`・`dist` などの規約名、公開起動入口、配布URL、IPC/API・保存キーは互換性のため維持します。画面の所有元は Diag が `frontend_diag/diag/ui`、Memo が `frontend_diag/memo/ui/src`、Navi / Code / Live / Term / IDE / Task / Team / Browser / CPU が `frontend_ide/src`、Discord が `frontend_channels/discord/panel`、Slack が `frontend_channels/slack/panel` です。
