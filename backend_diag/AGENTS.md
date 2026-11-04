# backend_diag 実装概要

Node.js 標準モジュールの診断・起動管理サーバーと Electron / Web 表示です。AIコアや DB が未設定でも診断画面を起動できます。起動管理は明示操作時だけ Python の既存起動基盤を使用します。

- `起動/desktop.mjs` / `起動/electron-main.cjs`: 既存共有セットアップで用意した Electron を通常表示に使います。ブラウザ・Codespaces は Node.js のみです。
- `diag_main.mjs`: ループバック HTTP、起動単位の認証、ブラウザ起動。
- `起動/サービス管理.mjs` / `ui/src/components/起動/`: 起動対象の保存、機能別コンソール、順次再起動と停止。起動順・既定値はルートと共通の `scripts/起動対象.json`、各 `_start.py` の Diag 経路は `scripts/_diag_start.py` が担当します。
- `モデル情報/models_info.mjs`: プロバイダ別モデル情報とchat / live / code / prediction / decisionsの合成JSON。取得モデルから `models` を生成し、API の詳細情報も保持。PredictionはDecisionsと同じ認証済み低コスト候補を使い、OpenAI API区分を `openai_decisions` から `openai_chat` に置き換えます。予測JSONに `openai_decisions` は含めません。Diagは候補を書き出すだけで、予測処理は `backend_tools` の内部REST `POST /internal/prediction_llms`（`aidiy_prediction_llms`、MCP非公開）が担います。Grok / backend_local の固定候補と、Copilot／OpenCode導入済み・合成候補なし時の固定8モデルを管理。本体・クライアントは合成JSONを読み、`_config` 上のモデル設定ファイルには依存しません。
- `モデル情報/voices_info.mjs`: Gemini / FreeAI / OpenAIの固定音声候補。取得・認証状態にかかわらず3区分の `live_voices_info.json` を生成します。候補の存在は認証成功を意味しません。
- `診断/headless.mjs`: `--headless` の全診断と、画面の書込と共通の保存形式。画面・待受なしで最速実行し、`_AIDIY/aidiy_diag/*.json` へ成功時だけ保存します（導入状況の `install_info.json` とプロバイダ別・用途別のモデル情報）。
- `診断/catalog.json`: リポジトリの利用箇所から整理した外部プログラムの登録情報。
- `診断/probes.mjs`: 固定引数での存在・バージョン確認。任意コマンド API は設けません。
- `導入管理/導入管理.mjs`: 明示操作専用の固定 npm / Windows WinGet / Antigravity / Grok Build 導入・再導入・削除。導入元の照合、項目単位の排他（別項目は並行実行）、期限・中止・コンソールを管理し、終了後は個別確認と共通の probe・結果反映を使います。
- `ui/src/`: Vue 3 SFC。認証・上部タブの入口は `App.vue`、各機能の画面・状態・CSS・資産は `components/` の日本語機能フォルダ、AI設定再起動ダイアログは `dialog/AI設定再起動.vue` に分離します。複数画面の状態表示は `components/共通表示/状態バッジ.vue`、タイトルバーと Tools 接続は `components/ウィンドウ/` に集約します。
- `Tools/代表試験.mjs` / `ui/src/components/Tools/`: Core認証後のTools管理と軽量な代表試験。個別・一括試験の結果は共通バッジで表示し、未実施と利用可否を区別する。
- `ui/build.mjs` / `static/`: ローカルの Vue を事前コンパイルした配布 UI。起動時はビルド・ダウンロード不要で、ソースとの一致を検証します。
- `モデル試行/audio_store.mjs`: Live が返した1秒以上の音声を専用一時領域に期限付きで保存し、認証付きの不透明IDで再生します。設定ファイル・モデル情報の保存とは分離します。
- `モデル試行/trials.mjs`: 明示操作専用の config 16役割・逐次会話試行。認証済み API から固定 loopback の MCP / Live アダプター / Prediction 内部RESTへ接続し、同じ設定の結果だけを実行内で共有します。
- `モデル情報/public_models.mjs`: 起動時の匿名公開モデル取得と、起動中メモリだけのキャッシュ。個別キーの試験結果とは分離します。
- `モデル情報/bundled_models.mjs` / `モデル情報/openrouter_models/openrouter_models.zip`: 公開モデルを取得できない場合の同梱キャッシュ。一時フォルダへ展開して同じ絞り込みで使い、画面には「キャッシュ利用」と表示します。
- `モデル情報/key_status.mjs`: UI に返す固定スキーマの制限。設定値やキー値をブラウザへ返しません。
- `runtime/*.ts` / `runtime/*.mjs`: Node 標準モジュールの固定設定読取・HTTPS・キャンセルと、本体由来のモデル判定。TypeScript は既存 UI ビルドで事前変換し、実行時の Python・コンパイラ・venv 依存はありません。
- `checks/reference/`: 移植前の Python 実装から生成・凍結した合成ゴールデン。比較専用で本番実行から参照しません。
- `_setup.py` / `_cleanup.py`: この作業コピーのランチャー配置・解除。

診断の確認処理はインストール・接続設定の変更・ログインを行いません。導入状況の導入・再導入・削除だけは、利用者の明示操作と確認後に登録済みの固定パッケージと公式 Antigravity バイナリを変更します。認証・設定・履歴を削除せず、headless・全テスト・初期表示から実行しません。起動タブは利用者の明示操作で起動設定を保存し、サービスを起動・停止します。`--auto` 指定時（全体起動の Diag 選択）だけ、画面表示と並行して保存済みの設定で設定起動を1回実行します。全テストは導入状況・モデル一覧・外部連携の確認と書込を順に行い、終わると導入状況タブへ切り替えます。起動管理と、会話生成を伴う config モデル試行は headless・全テストには含めません。モデル試行は Tools 接続中の明示操作専用です。通常の画面起動時は匿名の公開 OpenRouter 一覧だけを取得します。キーを使うモデル API は、画面の明示操作（各行のテスト・一括取得・全テスト）または明示的な headless 実行時に接続します。外部連携（Hugging Face / Discord / Slack）の読み取り専用の認証確認は、画面の明示操作（状況確認・全テスト）時だけ接続します。外部連携の結果は `_AIDIY/aidiy_diag/integration_info.json` へ保存し、headless では確認しません。API は起動時の認証が必須で、公開する静的ファイルに診断結果や認証キーを埋め込みません。

起動・検証・追加手順は [README.md](./README.md) を参照してください。
