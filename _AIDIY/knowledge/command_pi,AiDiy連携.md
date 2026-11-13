# command_pi（aidiy_pi）AiDiy 連携

> 文書: `command_pi,AiDiy連携.md` | 実装: `command_pi/aidiy/`、`command_pi/_setup.py`、`command_pi/_cleanup.py`

## このメモを使う場面

- `aidiy_pi` のモデル一覧・キー・OAuth・MCP・初期モデルの動きを確認、変更するとき
- `command_pi` の setup / cleanup、起動コマンド、アイコンを変更するとき
- AIコア / Tools の Code 実行、Diag の CLI 起動・テストで `aidiy_pi` を扱うとき
- upstream の Pi（earendil-works/pi、MIT）を新しい版へ差し替えるとき

## 位置づけ

`command_pi` は MIT ライセンスの AI エージェントハーネス Pi を同梱したものです。`aidiy_hermes` と同じく常駐しない Code CLI で、AiDiy では「Hermes と同じように使える」ことを基準にします。

- Pi 本体（`packages/`・`apps/` など upstream 由来）はできるだけ変更しない。AiDiy 独自の処理は `command_pi/aidiy/` に置く。
- ランタイムについて upstream 由来で変更しているのは、起動画面のロゴ（`packages/coding-agent/src/modes/interactive/components/pi-logo.ts` に AiDiy-Pi ロゴを追加、`interactive-mode.ts` と `first-time-setup.ts` から使用）と、test フォルダの削除に伴う `package.json` / `package-lock.json` のワークスペース登録の削除だけ。
- Discord / Slack、オフラインCode（Navi用Codeを含む）、Navi自身の案内／再評価、次入力予測で Hermes / Pi を選択できる。外部 Code CLI のモデル区分も共通化し、Piからは既存CodeAIの実行基盤へ委譲する。Navi・予測では外部CLIへの委譲を除外する。

## 構成

| ファイル | 役割 |
|---|---|
| `command_pi/aidiy/aidiy_pi.ts` | 起動入口。Pi の `main()` に AiDiy 拡張を渡し、初期モデルを決める |
| `command_pi/aidiy/aidiy-mode.ts` | YOLO / read-only の引数処理、読み取り専用プロンプトとツール実行制限 |
| `command_pi/aidiy/aidiy-cli.ts` / `aidiy-cli.py` | 外部CLIのPiプロバイダと共通CodeAIへのJSONLアダプター |
| `command_pi/aidiy/aidiy-providers.ts` | AiDiy 拡張。プロバイダ登録・MCP 登録・最終選択モデルの保存 |
| `command_pi/aidiy/aidiy-oauth.ts` | Codex CLI / Grok CLI の共有ログインの読込・更新 |
| `command_pi/aidiy/assets/` | アイコン正本 `AiDiy_pi.svg` / `.png`、Pi ロゴ原本 `upstream/pi-logo.svg` |
| `command_pi/_setup.py` / `_cleanup.py` | 個別の setup / cleanup。全体の `_setup.py` / `_cleanup.py` では Hermes の次（9番）に実行 |

起動は `node --import <source-resolver.ts> command_pi/aidiy/aidiy_pi.ts`（ソース実行、ビルドなし）。ランチャーは `_AIDIY/aidiy_pi/bin/aidiy_pi(.cmd)` で、Windows はユーザー PATH に登録します。実行したフォルダがそのまま作業フォルダ（プロジェクト）です。

## setup / cleanup

- setup は `npm ci --ignore-scripts`（Pi の方針どおり lifecycle script を実行しない）→ `npm run hydrate:model-data`（ネットワークで `packages/ai/src/providers/data/` を生成、失敗しても既存データがあれば続行）→ ランチャー作成 → `--version` で起動確認。
- cleanup はこの配置先が登録したランチャーと PATH 登録を解除し、確認のうえ全階層の `node_modules` と生成モデルデータを削除する。利用者の設定・認証・セッション（`~/.pi/agent`）は削除しない。
- `command_pi` 配下の test フォルダはセルフテストのため削除済み。ルート cleanup の test フォルダ削除はそのまま適用する（保護しない）。

## モデル一覧・キー・OAuth

- モデル候補は aidiy_diag が生成する `_AIDIY/aidiy_diag/pi_models_info.json`。Hermesと同じ区分・順序・標準モデル名を使う（`frontend_diag/diag/モデル情報/pi_info.mjs`）。両者とも `-900k` 別名は表示せず、旧一覧に残っていても除外する。Hermesの900K補正はHermes内部だけの処理で、Piのコンテキスト設定は変更しない。
- 区分名がそのまま Pi のプロバイダ名になる（`openai_oauth` / `gemini_chat` / `freeai_chat` / `openrt_chat` / `openrt_free` / `openai_chat` / `xai_oauth` / `claude_chat` / `ollama_chat` / `local_chat`）。コンテキスト長などは Pi 組込みのモデル情報を流用し、無いものは控えめな既定値を使う。
- API キーは `_config/AiDiy_key.json`（`gemini_key_id` / `freeai_key_id` / `openai_key_id` / `claude_key_id` / `openrt_key_id` / `ollama_key_id`）を要求ごとに読み直す。Pi の `auth.json` には保存しない。
- `openai_oauth` は Codex CLI の `${CODEX_HOME:-~/.codex}/auth.json`、`xai_oauth` は Grok CLI の `${GROK_HOME:-~/.grok}/auth.json` を Hermes と同じく共有する。期限5分前を過ぎたらリフレッシュし、同じファイルへ書き戻す（他の項目は保持）。トークンは表示・ログ出力しない。
- 一覧ファイルが無い場合は、aidiy_diag でモデル一覧を取得・保存するよう案内する。

## 初期モデルと最終選択

- `--model` / `--models` / `--provider` を指定したら、その指定を使う。`--model same` は前回選択の復元、`--model auto` は初期モデルからの自動決定（Hermes と同じ指定）。
- `--model=<値>` も空白区切りと同じ指定として解釈する。プロンプト本文や `--` 以降は引数として書き換えない。外部CLIを `--provider codex_cli --model same` のように明示した場合のsame/autoは、指定したCLIへ渡す。
- セッション再開（`-c` / `-r` / `--session` など）はそのセッションのモデルを使う。
- それ以外は前回選んだモデル（`~/.pi/agent/aidiy_model.json`）、無ければ `openai_oauth/gpt-6.1-sol`。OpenAI OAuth に未ログインなら FreeAI（Gemini）の先頭モデルへ退避する。
- `/model` や Ctrl+P で選んだモデルは `model_select` イベントで `aidiy_model.json` に保存する。起動時の `--model` 指定や非対話実行では保存しない。

## MCP

- 起動のたびに `_config/AiDiy_mcp.json`（`backend_tools/_setup.py` が書く Hermes と同じ一覧）を読み、`pi.registerMcpServer()` で登録する。Pi の `mcp.json` には書かない。
- Pi は旧 SSE 方式に未対応のため、URL の `/sse` を Tools が併せて公開する Streamable HTTP の `/mcp` へ読み替える。
- 公開方式は Pi 既定の `codemode`（必要時にスクリプトからツールを探して呼ぶ）。20 サーバーでも文脈を圧迫しない。

## YOLO / read-only

- 通常起動は YOLO（Pi 標準の確認なし実行）。`--yolo` を明示しても同じ動作。
- `aidiy_pi --read-only -p "ソースを確認して"` は調査・説明専用。毎回のシステムプロンプトに読み取り専用の指示を一文追加し、`read` / `grep` / `find` / `ls` だけをモデルへ公開する。
- `write` / `edit` だけではシェル経由の変更が残るため、許可した4ツール以外は `tool_call` でも拒否する。bash / PowerShell / codemode / MCP、対話画面の `!` / `!!` とRPCのbashは使用できない。
- read-only では拡張の自動読込とMCP接続を無効にする。明示的な追加拡張（`-e` / `--extension`）、管理サブコマンド、`--export` はエラーにする。`--tools` で変更ツールを指定しても制約は解除されず、`--yolo` と併記した場合も read-only を優先する。
- read-only はモデルのツール操作の制限であり、OSのファイルシステムsandboxではない。OAuth更新やPi自身の状態管理は通常どおり。会話を保存しない場合は `--no-session` も指定する。AiDiyの最終選択モデルはread-only中に保存しない。
- AIコアの `読取専用=True` / `CLI読取専用=True` でも同じ `--read-only` を使用する。この場合は同梱Pi入口を使い、`AIDIY_PI_CLI_PATH` やPATH上の別CLIへ退避しない。CLIプロバイダは登録せず、保存値・明示値が外部CLIなら停止する。

## 外部CLIへの委譲

- `claude_cli` / `antigravity_cli` / `codex_cli` / `copilot_cli` / `opencode_cli` / `grok_cli` をPiのモデル一覧に登録する。例: `aidiy_pi --model codex_cli/same -p "修正して"`。TUIの `/model` でも選択でき、最終選択を保存する。
- `backend_tools` または `backend_server` のPython環境と、委譲先CLIの導入・認証が必要。常駐Core/ToolsやHermesの起動は不要。
- Piの会話履歴をテキストで渡し、委譲先は毎回新規会話として開始する。Piの再開会話へ、別のCLIセッションを混ぜない。モデルがsameなら委譲先のモデル指定を省略し、autoならCodeAIのモデル選択を使う。
- Windowsの `.cmd` 解決、タイムアウト、子孫の終了は既存 `AIコード_cli.py` / `process_lifetime.py` を再利用する。進捗はPiのthinkingイベント、結果はtext、異常終了はerrorへ変換する。外部CLIの利用量は取得できないためPiのトークン・費用表示は0となる。

## Navi・次入力予測

- Naviの方式一覧と実行環境確認に `aidiy_pi` を含め、既存 `navigation_readonly.py` から読み取り専用CodeAIを使用する。
- 予測設定キーは `PREDICTION_AIDIY_PI_MODEL`（初期値 `openai_oauth/gpt-6-luna`）。Coreの設定読込・保存、Web / Avatar / Diag設定画面、Tools内部RESTで扱う。autoの順序は Codex → Copilot → Hermes → Pi → OAuth → FreeAI → OpenAI API → Gemini。
- Navi・予測候補から `codex_cli/same` などの外部CLIモデルを除く。実行側でも同じ制約を検査し、通常実行への退避は行わない。
- 更新後はDiagでモデル一覧を書き込み直し、起動中のCore / Tools / Naviを再起動して候補・実行コードを反映する。

## AIコア / Tools / Diag

- Code 実行は `backend_server/AIコア/AIコード_cli.py` の `aidiy_pi` 経路。cmd.exe を経由せず node で入口を直接起動し、`--no-session --mode json -p --model <provider/model | same>` で実行する。完全プロンプトは Hermes と同じく UTF-8 標準入力で渡し、会話履歴は AiDiy 側が毎回送る。
- `AIコードPi出力.py` がJSONLのthinking・ツール開始／進捗／完了を `output_stream` へ送り、最後のassistantのtextだけを正式回答にする。受信ごとに待機時間を更新し、生JSON・思考・ツール結果は正式回答へ混ぜない。JSON内のerror/aborted/lengthと完了イベント欠落は、プロセス終了コードが0でも失敗扱いにする。
- 設定キーは `CODE_AIDIY_PI_MODEL`。モデル設定更新APIの許可キーとセッション初期読込の両方で扱う。AIコアの `auto` は Hermes と同じ Decisions 選択を使い、Piの一覧にある `openai_oauth/` の最新GPT系列から選ぶ。判断失敗時は一覧内の既定候補、候補なしなら `same` を使う。`code_models_info.json` の `aidiy_pi` 区分（OAuthモデルと導入済み外部CLIのsame経路）は command_pi が setup 済みのときだけ生成される。
- Tools の利用可否確認（`code_agents.py`）とバージョン確認も node の直接起動を使う。
- Diag の CLI 起動は Console と共用の `frontend_ide/aidiy_console/cli-launch.mjs`。`aidiy_pi` は PATH を探さず、この配置先の `command_pi` を node で起動する。通常は追加フラグ不要で、モードは「YOLO（Pi標準）」。
- Diag のアイコンは Hermes と同じく PNG（`CLI_aidiy_pi.png`）。並び順は Hermes の次。

## Discord / Slack・オフラインCode

- Discord / Slack のコード欄で `aidiy_hermes` / `aidiy_pi` を選び、エンジン別のモデル候補を使う。選択は既存のプロジェクト設定の `code_name` / `code_model` に保存する。接続中の変更は「適用して再接続」で反映する。
- Codeのオフライン用モデル選択は、VS Code拡張・単独画面・IDE・Navi用Codeで共通。オンライン用とは別の `aidiy_code_model_offline.json` にエンジンとモデルを保存する。
- 共通実行は `frontend_ide/host/src/runner.ts`。Piはこの配置のNodeソースを直接起動し、`--mode json -p --session-id <UUID>` へUTF-8標準入力を送る。JSONのセッションID・進捗・最終回答・エラーを分離し、受信中は待機時間を更新する。
- HermesとPiの再開IDは別々に保持する。Piの `same` で既存会話を再開するときは、そのセッションのモデルを使う。
- PiのOAuthは上記の共有ログインを使う。オフラインはAIコアを経由しない意味であり、クラウドモデルの通信は必要。

## アイコン

- 正本は `command_pi/aidiy/assets/AiDiy_pi.svg` / `.png`。AiDiy 人物原画（`_icons/AiDiy.png`）を全面に置き、下部 120×30px を金地の帯にして、黒タイル上の Pi ロゴと文字 `PI` を載せる。
- Pi ロゴの原本は同梱の `command_pi/apps/p2/src/web/PiLogo.tsx`（MIT）の形と `apps/p2/src/web/style.css` の色。
- PNG はヘッドレス Edge で 120×120px に書き出し、RGBA にそろえる。Diag へは `frontend_diag/diag/ui/components/アプリ起動/CLIアイコン/aidiy_pi.png` に配布コピーを置き、`frontend_diag/ui` の `npm run build` で `static/CLI_aidiy_pi.png` へ反映する。
- 出典・ハッシュ・利用条件は Diag の `CLIアイコン/LICENSE_ICONS.md` の `AiDiy / aidiy_pi` 節に記録する。

## upstream 更新時の注意

- 新しい版を取り込んだら、`command_pi/aidiy/` と `_setup.py` / `_cleanup.py` を残し、ロゴの変更（上記3ファイル）を移植する。
- test フォルダを削除する場合は、`package.json` の workspaces と `package-lock.json` からワークスペース登録（例: `packages/chord/test/examples/...`）も外す。外さないと `npm ci` が失敗する。
- Pi の拡張 API（`pi.registerProvider` / `pi.registerMcpServer` / `model_select`）、Codex / xAI OAuth のクライアント ID、`main(args, { extensionFactories })` の形が変わっていないか確認する。

## 確認方法

- 起動確認: `aidiy_pi --version`、`aidiy_pi --list-models`（AiDiy の区分がプロバイダとして並ぶ）。
- プロバイダ確認: `aidiy_pi --no-session --model <区分>/<モデル> -p "おはよう"`。
- MCP 確認: Tools 起動中に `aidiy_pi --no-session -p "通知音を鳴らして"` で `play_notification_sound` が呼ばれる。
- Diag のチェック: `node --test frontend_diag/checks/pi-info.check.mjs`（一覧生成・導入判定・Code テスト）、`cli-launch.check.mjs` / `aidiy-icon-ownership.check.mjs`（起動一覧・アイコン）。
- Console / CLI 起動: `node --test frontend_ide/checks/cli-launch.test.mjs`。
- setup 系: `python -B -X utf8 -m unittest discover -s scripts/checks`（`test_setup_messages` / `test_setup_processes` / `test_setup_posix` / `test_node_refresh` に Pi を含む）。

## 同梱ルートの整理方針

- 利用者・実装者の入口は `command_pi/README.md` と `AGENTS.md`。AiDiy の構成・設定・運用を案内する。
- upstream 開発用の `.pi/`（プロンプト・拡張・技能）、`.husky/`、`CONTRIBUTING.md`、`pi-test.*` は同梱しない。起動は setup が生成する `aidiy_pi` に統一する。これは利用者の `~/.pi/agent` や作業プロジェクトの `.pi/` を削除するという意味ではない。
- `prepare: husky` と専用依存も削除し、AiDiy の Git hooks を upstream 用設定で変更しない。
- `packages/`・`apps/` の実装／原資料、MIT LICENSE、第三者表示は保持する。これらの資料にある upstream 向け手順は AiDiy の setup 手順と区別する。
- `scripts/`、`test.sh`、TypeScript/Biome/Vitest 設定、Nix のカタログpinと配布設定はモデルデータ生成・検証・upstream保守の相互参照があるため保持する。AiDiy の通常起動は Nix や配布ビルドを必要としない。
- 整理の検証は `node --test scripts/aidiy-layout.test.mjs`（command_pi 内）と、setup後の `aidiy_pi --version` / `--help` で行う。モデルを呼ぶ必要はない。
