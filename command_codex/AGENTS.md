# command_codex の実装方針

## 位置づけ

`command_codex` は AiDiy のオンデマンド Code CLI `aidiy_codex` です。
OpenAI Codex（openai/codex、Apache-2.0）の Rust ワークスペース `codex-rs/` を AiDiy に内包し、`_compile.py` でコンパイルして利用します。`aidiy_hermes` / `aidiy_pi` と同じく AiDiy 向けに最適化する CLI で、独立した upstream Codex リポジトリとして運用しません（AiDiy 向けの調整は一部継続中）。

全体方針は [AiDiy の AGENTS.md](../AGENTS.md)、手順の入口は [_AIDIY/knowledge/_index.md](../_AIDIY/knowledge/_index.md) です。
コンパイル手順・オプションは [`_compile.py`](_compile.py) 冒頭の説明に集約し、本書には一時的な作業ログを書きません。

- 常駐 HTTP サーバーではない。`_start.py` は起動せず、利用可否と起動コマンドだけを案内する。
- 実行名は `aidiy_codex`。成果物は `~/.aidiy/bin/aidiy_codex(.exe)` に置き、プロジェクト内には残さない。
- 全体 `_setup.py` はコンパイルの選択に関係なく、`_AIDIY/aidiy_codex/bin` と `~/.local/bin` に本体へのランチャーを先に登録する。コンパイル前は本体が存在しないため起動できない。PATH 変更後は端末を開き直す。
- TUI は AiDiy の組込みハーネスを使う。公式配布パッケージが必要な共有 daemon を暗黙に開始・再利用しない（別版の Codex が動くのを防ぐ）。明示 `--remote` は維持する。修正前のコンパイル済み本体は `aidiy_codex --no-daemon` で起動できる。
- `_setup.py` の対象（既定は実行しない。独立プロセスでコンパイル）。aidiy_diag の「コンパイル」ボタンからも同じ処理を開始する。
- 全体 cleanup（`_cleanup.py`）は、実行中のコンパイルを最初に中止する（`python command_codex/_compile.py --cancel` と同じ）。続けて、選択（既定 y）に応じてコンパイルの中間ファイル `~/.aidiy/cache/codex/target/` を削除する。配置済みの `~/.aidiy/bin/aidiy_codex(.exe)`・設定 JSON・状態・ログは残す。削除後の次回ビルドは最初から（release で 1 時間以上）。
- 認証は本物の `codex` と同じ `~/.codex` を使う（openai_oauth）。他の区分のキーは AiDiy の `_config/AiDiy_key.json`（Hermes / Pi と同じキー名）。
- モデルは Hermes / Pi と同じ `<区分>/<モデル名>` 形式で指定する（`-m`、`exec`、config.toml の `model` / `review_model`）。`--model openai_oauth/gpt-6-astra` のように Codex 元のパラメータへ区分名付きのまま渡し、設定・app-server・履歴でもそのまま持ち回す。接続先はモデル名の区分から内部で決める（`--provider` などの指定・`model_provider` の選択肢は増やさない）。区分を外すのは API へ送るモデル名だけ（最初の `/` で区切る）。接頭辞なしのモデル名もそのまま使える（組み込みの openai）。

## 区分ごとの接続

接続方法は AiDiy Hermes（`command_hermes/cli_main.py`）・Pi（`command_pi/aidiy/aidiy-providers.ts`）に合わせる。実装は `codex-rs/model-provider-info/src/aidiy_sections.rs`（組み込みプロバイダ一覧には登録しない）。

| 区分 | 接続方式 | 接続先・認証 |
|---|---|---|
| `openai_oauth` | Responses | 組み込みの openai（ChatGPT ログイン、`~/.codex`） |
| `openai_chat` | Responses（Pi と同じ） | `api.openai.com/v1`、`openai_key_id` |
| `xai_oauth` | Chat Completions（xAI の Responses は Codex の namespace / custom ツールを受け付けないため） | `api.x.ai/v1`、Grok の共有ログイン `~/.grok/auth.json` を読み、期限前に更新して書き戻す（`codex-rs/login/src/auth/aidiy_grok.rs`。Rust 実装で外部コマンドは起動しない） |
| `claude_chat` | Anthropic Messages（`wire_api = "anthropic"`） | `api.anthropic.com/v1`、`claude_key_id`（`x-api-key` / `anthropic-version`） |
| `gemini_chat` / `freeai_chat` | Chat Completions（Hermes と同じ OpenAI 互換） | `generativelanguage.googleapis.com/v1beta/openai`、`gemini_key_id` / `freeai_key_id` |
| `openrt_chat` / `openrt_free` | Chat Completions | `openrouter.ai/api/v1`、`openrt_key_id`（両区分共通）。Hermes と同じく利用元表示 `HTTP-Referer`（同梱元 `https://github.com/openai/codex`）・`X-Title: AiDiy Codex` を付ける |
| `ollama_chat` | Chat Completions | `ollama_key_id` があれば Ollama Cloud（`ollama.com/v1`、モデル名の `-cloud` / `:cloud` を外す）、無ければ `ollama_host`（既定 `localhost:11434`）（Hermes と同じ） |
| `local_chat` | Chat Completions | backend_local `localhost:PORT_LOCAL`（既定 8096）、キー不要 |

- Chat Completions（`wire_api = "chat"`、upstream では削除済み）と Anthropic Messages は AiDiy が追加した接続方式。実装は `codex-rs/codex-api/src/endpoint/chat_completions.rs` / `anthropic_messages.rs`。Codex が組み立てた Responses 形式の要求を変換し、ストリームを `ResponseEvent` に戻すので、core の再試行・認証・ツール実行はそのまま使う。
- ツールは function をそのまま、custom（`apply_patch` など）を文字列 `input` 1つの function に、namespace 内を `<namespace>__<name>` にして送り、呼び出しを元のツールに戻す。Web 検索などの組み込みツールは送らない。Anthropic は `input_schema` 最上位の `oneOf` / `anyOf` / `allOf` を受け付けないため、各候補の `properties` を1つの object にまとめる（`required` は `allOf` の分だけ残す）。
- aidiy_codex の設定は実行ファイルの隣の `~/.aidiy/bin/aidiy_codex_settings.json` の1ファイルにまとめる。項目は `aidiy_root`（AiDiy の場所。キーとモデル一覧を読む）と `client_version`（送る版番号）。`_compile.py` が配置時に無い項目だけを書き足し、手修正した値・他の項目は上書きしない（JSON として読めなければ変更しない）。キーそのものは `~/.aidiy/bin` にコピーしない。
- `/model` の AiDiy 区分付きモデルは、API / OAuth / 外部 CLI 間で同じ会話のまま切り替える。接続先・認証・プロトコルを区分から一体で解決し、変更時に接続・WebSocket・sticky routing を再作成する。第三者 API へ OpenAI の認証を引き継がない。圧縮・prewarm も選択区分に合わせ、送信直前の区分不一致は送信せずエラーにする。管理者の必須 provider と矛盾する変更、および runtime 認証セッションの provider 変更は拒否する。

## メタハーネス

- 外部 CLI 区分では `--cli chat`（省略時）が構造化会話・ツール定義を共通アダプターへ渡し、ツール要求を親 Codex の通常ループで実行する。`--cli passthrough` は従来の共通 CodeAI への子 CLI 委譲を維持する。TUI / exec とも同じ経路を使う。子の chat 対応能力が不足する場合は明示エラーとし、暗黙の委譲はしない。
- passthrough では親の全アクセス＋承認不要は YOLO、read-only は子にも読取専用として渡す。その他の独自 sandbox / workspace-write は安全に同等変換できないため停止する。chat では親が自身の sandbox / 承認を適用し、子側の独自ツールは共通アダプターが禁止する。制限を外して実行しない。
- 全会話のテキストを各ターンに渡し、子の過去の別セッションは resume しない。画像・音声・構造化出力・CLI モデルでの `/compact` は対象外。トークン使用量は子から取得できないため未報告。
- 実行には backend_tools または backend_server の Python venv が必要。親終了・中断で監視ラッパーが子孫を回収する。CLI の失敗を親が自動再実行しない。
- 起動例・モード継承・検証は [メタハーネス運用](../_AIDIY/knowledge/command_hermes,command_pi,command_codex,メタハーネス.md) を参照。

## AiDiy 連携

Hermes / Pi と同じく、AI コア（Code）・AIタスク・入力予測・Navi・Tools の Code エージェント・Diag のモデル試行から `aidiy_codex` を選べる。
引数は `codex_cli` と同じ経路（`exec`、`resume`、読取専用の予測）を使い、実行ファイルだけを `~/.aidiy/bin/aidiy_codex(.exe)` に固定する（PATH 上の同名は使わない）。

- 有効・無効は Diag の `installedCodeClis()`（`codexInstalled()`：実行ファイルの有無だけを見る）で決まる。未コンパイルなら `code_models_info.json` / `prediction_models_info.json` / `navi_models_info.json` に `aidiy_codex` 区分が入らず、各画面の選択肢にも出ない。
- 候補の正本は Diag が書き出す `_AIDIY/aidiy_diag/aidiy_codex_models_info.json`。Pi と同じ API / OAuth / 外部 CLI 区分を保存する。Code の `aidiy_codex` 区分は `<区分>/<モデル名>` に変換し、`openai_oauth` を先頭に置く。CLI の `xx/same` と明示モデルも渡す。CLI 委譲は `core/src/aidiy_cli.rs` と共通 `backend_tools/tools_proc/harness_cli.py` で行う。Navi・入力予測では外部 CLI 区分を除外する。
- 他社の区分（`gemini_chat/…` など）も候補に出て、上の「区分ごとの接続」で実行する。AiDiy 側（Diag・backend・画面）は `<区分>/<モデル名>` をそのまま渡す。
- 設定キーは `CODE_AIDIY_CODEX_MODEL`（既定 `auto`）と `PREDICTION_AIDIY_CODEX_MODEL`（既定 `openai_oauth/gpt-6-luna`）。
- 主な連携箇所: `backend_server/AIコア/AIコード_cli.py`（`_CODEX系AI`）、`AIコードモデル選択.py`、`AI実行オプション.py`、`frontend_diag/diag/モデル情報/models_info.mjs` / `codex_info.mjs`、`backend_tools/tools_proc/code_agents.py` / `prediction_llm.py`、`frontend_ide/ファイル機能/navigation-agent.mjs`、`scripts/cli_bat/_aidiy_codex_cli.bat`。
- IDE の Code オフライン直接実行と Discord / Slack は Hermes / Pi 専用のため対象外。

## 構成と責務

| 配置 | 責務 |
|---|---|
| `_compile.py` | 前提確認、cargo ビルド、`aidiy_codex` への配置と PATH 登録、設定 `aidiy_codex_settings.json` の書き足し、独立プロセス実行と状態・ログ |
| `aidiy/assets/` | AiDiy Codex アイコン（SVG / PNG）の正本。Diag には配布コピーだけを置く |
| `変更点と最新版再移行要点.md` | upstream からの変更点の一覧（Apache-2.0 の変更表示）と、最新版への再移行の手順・注意点・確認方法・記録 |
| `codex-rs/` | 内包した Codex の Rust ワークスペース。AiDiy の部品とは分けて一段下に置く |
| `codex-rs/LICENSE` / `NOTICE` | 同梱元の Apache-2.0 表示 |
| `codex-rs/rust-toolchain.toml` | Rust の版。初回ビルド時に rustup が取得する |
| `codex-rs/.cargo/config.toml` | ビルド環境変数とリンク設定（upstream ルートの `.cargo/` から移設） |
| `codex-rs/login/src/aidiy_settings.rs` | aidiy_codex の設定（`~/.aidiy/bin/aidiy_codex_settings.json`）のうち、サーバーへ送る版番号 `client_version`（既定 `0.169.0`）を読む。`login` の User-Agent と `models-manager` の `client_version_to_whole()` から使う。`aidiy_root` は `aidiy_sections.rs` が読む |
| `codex-rs/login/src/auth/aidiy_grok.rs` | xai_oauth のトークン取り出し（Grok の共有ログインを読み、期限前に更新して書き戻す。Pi と同じ処理）。接続先の `auth.command` が内部名 `aidiy:grok-login` のとき、`external_bearer.rs` が外部コマンドの代わりに呼ぶ（キャッシュ・401 時の再取得は Codex のまま） |
| `codex-rs/model-provider-info/src/aidiy_sections.rs` | `--model <区分>/<モデル名>` の区分から内部の接続先を作る（`aidiy_model_provider`。接続先・キー・AiDiy の場所の読み取り）と、API へ送るモデル名（`aidiy_api_model`）。`core/src/config/mod.rs` のプロバイダ確定箇所と `core/src/client.rs` の送信箇所（`AiDiy:` コメント）から呼ぶ。モデル情報は models-manager 既存の `namespace/model` 検索で引く |
| `codex-rs/codex-api/src/endpoint/chat_completions.rs` / `anthropic_messages.rs` | AiDiy が追加した Chat Completions / Anthropic Messages の接続（`model-provider-info` の `WireApi::Chat` / `Anthropic`、`core/src/client.rs` で切り替え） |

ビルド作業フォルダ・状態・ログは `~/.aidiy/cache/codex/`（`target/`、`aidiy_codex_compile.json`、`aidiy_codex_compile.log`）に置き、clone・コピーした別環境とも共有します。

## 変更時の基本方針

- AiDiy 固有の処理は原則 `_compile.py` と `aidiy/` に置き、`codex-rs/` 側の変更は必要最小限にする。変更した箇所には `AiDiy:` のコメントを残す。
- Windows は MSVC / Visual Studio を使わず、`x86_64-pc-windows-gnullvm`（ARM64 は `aarch64-pc-windows-gnullvm`）と llvm-mingw でビルドする。不足する Rust と Windows llvm-mingw は `_compile.py` の通常実行時に公式配布元から導入する（Windows の自動導入は x64）。既存ツールは尊重し、`--check` では導入しない。Linux / macOS は OS の C ツールチェーンを使い、不足時は管理者操作を自動実行せず案内する。
- サーバーはクライアントの版でモデルを出し分ける（例: `gpt-6-luna` は `0.155.0` 以上）。送る版は実行ファイルと同じフォルダの `~/.aidiy/bin/aidiy_codex_settings.json` の `client_version` に外出ししてある（`codex-rs/login/src/aidiy_settings.rs`）。通常は `_compile.py` が配置時に書き出し、設定ファイル自体が無ければ初回起動時に `{"client_version": "0.169.0"}` で書き出し、手修正されていればその値を送る（再ビルド不要。不正な内容なら `0.169.0` を使い、ファイルは上書きしない）。使うのは User-Agent とモデル一覧取得の `client_version`。
- ビルドの版（`--version` の表示。`codex-rs/Cargo.toml` の `[workspace.package] version` と `Cargo.lock` のワークスペース分）も `0.169.0` に固定する。upstream main の `0.0.0` には戻さない。変えるのは明示の依頼がある場合だけ。
- 依存は `Cargo.lock` に従い `--locked` でビルドする。lockfile や toolchain の版を検証目的で勝手に更新しない。
- `_compile.py` は `~/.aidiy/bin`、Windows の公式同版 Code Mode ホスト（配布物のハッシュ検証付き）、`libunwind.dll`、設定 JSON、PATH をビルド前に準備する。Linux / macOS はホストも同時にコンパイル・配置する。本体は `aidiy_codex_temp(.exe)` を完成させて最後に入れ替え、交換失敗時は手動配置用に残す。ビルド後の起動確認（`--version`）は行わない。
- release ビルドは thin LTO で時間がかかる。日常の確認は `--check` / `--status` / `--debug` を優先し、release ビルドは理由が明確な場合だけ行う。
- AiDiy の起動導線（Diag の診断カタログ・アプリ起動、`_setup.py`、`_start.py`、`scripts/checks/test_setup_codex.py`）と成果物名・配置先をそろえて変更する。
- キー・トークン・`~/.codex` の認証ファイルの内容をログ、テスト証跡、コミットに含めない。有料API呼出しや実認証の更新をテスト目的で勝手に実行しない。
- 日本語の説明と UTF-8 を基本とする。upstream のクレート名・識別子は無理に改名しない。
- 他の作業の変更を巻き戻さない。push は依頼がある場合だけ行う。

## ライセンスと upstream

同梱 Codex の [LICENSE](codex-rs/LICENSE)（Apache-2.0、OpenAI）と [NOTICE](codex-rs/NOTICE)（Ratatui 由来部分を含む）を `codex-rs/` 内に維持します。
AiDiy 独自部分（`_compile.py`、`aidiy/`）の利用条件は [リポジトリルートの LICENSE](../LICENSE) に従います。両者を混同してライセンス表示を一括置換しません。
`aidiy_codex` のアイコンは Codex の公式ロゴを使わず、OpenAI による承認・提携を示すものではありません（[LICENSE_ICONS.md](../frontend_diag/static/LICENSE_ICONS.md)）。

AiDiy が upstream に加えた変更の一覧と、最新版へ移し替える手順・注意点は [変更点と最新版再移行要点.md](変更点と最新版再移行要点.md) にまとめます（Apache-2.0 第4条の変更表示を兼ねる）。`codex-rs/` を変更したら、同じ作業で一覧も更新してください。

upstream リポジトリの `codex-rs/` 以外（npm パッケージ、SDK、ドキュメント、CI 設定など）は同梱しません。
upstream の寄稿規則、GitHub 運用、リリース手順は AiDiy の運用ルールではありません。upstream 更新時も、それらを無条件に復活させず、`codex-rs/` の差し替えと `.cargo/config.toml` の移設、版 `0.169.0` の固定（`cargo update --workspace --offline` で `Cargo.lock` も合わせる）、送る版番号の外出し（`aidiy_settings.rs` と呼び出し2か所）、Chat Completions / Anthropic の接続（`WireApi` の追加、`codex-api` の2モジュール、`core/src/client.rs` の切り替え）、区分ごとの接続（`model-provider-info` の `aidiy_sections.rs`）と `AiDiy:` コメントの箇所、AiDiy の入口とナレッジを維持してください。
