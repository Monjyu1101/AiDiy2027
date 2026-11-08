# AiDiy Discord

> Slack 版（`../slack/`、`aidiy_slack`）は、この Discord 版から音声会話を除いた双子のプログラムです。ファイル構成・画面・起動引数・試験をそろえ、接続部品とモデル設定だけが異なります。

配置フォルダは `frontend_channels/discord` です。`frontend_channels/slack` と同階層の独立したチャンネルです。Discord 機能・内部モジュール名・`aidiy_discord` コマンドは変わりません。

自分と AiDiy の専用テキストチャンネルに普通に話しかけると、`aidiy_hermes` が返信します。専用ボイスチャンネルに参加すると、AIコアの LiveAI と音声会話できます。チャットは `frontend_ide/host` の Code と同じ CLI 実行処理、ライブは同じ Live WebSocket 処理を使います。

## ウィンドウ操作

Electron のタイトルバーは「ー □ 📌 ×」で最小化・最大化／復元・最前面ピン・終了を操作します。ピンは OFF（沈んだ表示）で起動し、ON のときだけ最前面を維持します。ピン ON の AiDiy 窓同士は最後に選択した窓が前面になり、別窓からフォーカスを奪い返しません。ブラウザ版は引き続きブラウザ側のウィンドウ操作を使います。

## 導入

- Node.js 22.12 以降（`package.json` の `engines.node`）。
- `command_hermes` をセットアップし、使う Provider を認証しておきます。
- ライブを使う場合は `backend_server` の Core と LiveAI の設定が必要です。
- `frontend_ide/host` のソースを同じプロジェクトに保持します。VS Code 本体、拡張の導入、VSIX 生成は不要です。

プロジェクトルートで実行します。

```powershell
python frontend_channels/discord/_setup.py
```

setupとPython起動入口は `package.json` のNode.js要件を確認します。Vue 3・Electron・パネル生成用ツールは `npm ci --include=dev` でプロジェクトに導入し、グローバルVue CLI・Electronは不要です。Electron本体がない場合も既存のWeb起動へ切り替えられますが、Node.jsの版数不足・版数不明だけなら警告して継続します。Node.jsの実行失敗やDiscord設定の不備はエラーのままです。専用ウィンドウの復旧は上記 `_setup.py` を使います。

ルート `_setup.py` の「Channels(Discord / Slack)」からも導入できます。セットアップは既定 Yes（`[y]/n`）で、Electron の事前配置と `~/.local/bin/aidiy_discord`（Windows は `.cmd`）の登録も行います。ルート `_start.py` の Discord 起動は既定 No（`[n]/y`）で、Yes を選ぶとパネルを開いて自動接続します。

フォルダ移動前に登録した `aidiy_discord` は旧絶対パスを含むため、移動後にルート `_setup.py` の `b`（build: Node.js系の再ビルド）または上記のセットアップで再登録してください。既存の `node_modules` はフォルダごと移動して再利用でき、Git管理には追加しません。

## プロキシが必要なネットワーク

Discord への直接接続が制限される環境では、パネルを起動する親プロセスに `HTTPS_PROXY` を設定します。例のURLは、利用環境のHTTP(S)プロキシへ置き換えてください。

```powershell
$env:HTTPS_PROXY = 'http://proxy.example:8080'
$env:NO_PROXY = 'localhost,127.0.0.1,::1'
aidiy_discord
```

`HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` と小文字版に対応します。同じ変数が両方ある場合は空でない小文字版を優先し、HTTPS用が無ければHTTP用を使います。プロキシ未設定なら従来の直接接続です。`NO_PROXY` はカンマ・空白区切りのホスト名、ポート指定、`.example.com` / `*.example.com`、全除外の `*` を使えます。localhost・127系・IPv6ループバックは常に直接接続します。

REST、Gateway（再接続・resumeを含む）、音声用 WebSocket をそれぞれプロキシ対応します。音声用はDiscordが通知したホスト・ポートへ接続します。環境変数を変更したら **パネルを閉じ、環境変数を設定した端末から起動し直してください**。既存パネルを呼び出すだけでは新しい環境は継承されません。OSのGUIから起動する場合も、その起動元に設定が必要です。プロキシURLを共通キーJSONやソースに追加する必要はありません。

認証不要の疎通確認は `frontend_channels/discord` で次を実行します。環境変数の存在有無、公開RESTのHTTP状態、Gatewayの認証前HELLOを確認し、URLや認証情報は表示しません。外部通信を使うため `npm test` とは分けて実行します。

```text
node checks/network-diagnostic.mjs
```

診断結果はBot認証や音声の成功を保証しません。HTTPプロキシではDiscord音声のUDP通信を運べないため、Live音声は対象ネットワークでボイス入室・双方向音声・退出まで確認してください。

音声接続に失敗した場合は、エラー詳細の「音声通信」と「音声接続先」を確認します。「WebSocket接続中」でタイムアウトする場合は、表示されたホスト・ポートへの直接接続またはプロキシのCONNECT許可を確認してください。「UDP接続・IP検出中」で失敗する場合は、別途UDPが通るネットワーク経路を確認してください。接続先にはホスト・ポートと「プロキシ経由／直接接続」を表示し、プロキシURLや認証情報は表示しません。

## Discord 側の準備

1. [Discord Developer Portal](https://discord.com/developers/applications) で Application / Bot を作成します。
2. Bot の **Message Content Intent** を有効にします。投稿本文の受信に必要です。
3. Bot トークンを下記 `discord_bot_token` に保存します。通常ユーザーのトークンは使いません。
4. OAuth2 の `bot` スコープでサーバーへ招待します。テキスト側に「チャンネルを見る」「メッセージを送信」「メッセージ履歴を読む」「ファイルを添付」、ボイス側に「チャンネルを見る」「接続」「発言」の権限を付けます。スレッドで利用するときは「スレッドでメッセージを送信」も必要です。
5. Discord の開発者モードで、サーバー ID、利用者 ID、テキスト・ボイスチャンネル ID をコピーします。スレッドの場合はスレッド自身の ID を許可します。

自分と Bot が利用できるプライベートのテキスト・ボイスチャンネルを指定します。アプリコマンド登録、接頭辞、Bot メンションは不要です。

## 接続情報

既存の **`_config/AiDiy_key.json`** に設定します。新しい別名のキー管理ファイルは作りません。セットアップと Core 起動時に不足する `discord_*` の初期値が `< your discord bot token >` のような `<` で始まる仮設定で補完されます（未設定扱い）。既存の AI キーや他の設定はそのまま残し、以下の項目を編集してください。

```json
{
  "discord_bot_token": "Bot のトークン",
  "discord_guild_id": "111111111111111111",
  "discord_allowed_user_id": "222222222222222222",
  "discord_text_channel_id": "333333333333333333",
  "discord_voice_channel_id": "444444444444444444"
}
```

| 設定 | 意味 |
|------|------|
| `discord_bot_token` | Bot トークン。空欄・1文字（`<` など）・`<` で始まる仮設定ではパネルを起動しません |
| `discord_guild_id` | 利用する1つのサーバー ID |
| `discord_allowed_user_id` | 操作・音声入力を許可する利用者1人の ID |
| `discord_text_channel_id` | 普通の投稿に返信する専用テキストチャンネルの ID。音声会話の字幕・接続通知も送ります |
| `discord_voice_channel_id` | 入室に合わせて自動接続する専用ボイスチャンネルの ID |

Discord 専用設定はこの5項目だけです。すべて必須で、ID は配列や数値ではなく1つの文字列で指定します。それ以外は同じファイルの共通設定を使います。

| 共通設定 | Discord での用途 |
|----------|------------------|
| `LIVE_AI_NAME`、`LIVE_*_MODEL`、`LIVE_*_VOICE` | 初回の LiveAI、モデル、音声。手動選択後は前回の選択を優先 |
| `PORT_CORE` | ローカル AIコアの接続先ポート |
| `CODE_BASE_PATH` | Code / Live 共通の作業フォルダ。相対パスは `backend_server` 基準 |
| `CODE_AIDIY_HERMES_MODEL` | Hermes の初期モデル。未設定時は `auto`。パネル保存済みの選択を優先 |
| `CODE_MAX_TURNS` | Hermes の最大実行ターン数 |

Hermes と Python は VS Code と同じ起動探索で自動解決します。OpenAI OAuth の指定は CLI の provider と model に分けて渡し、認証エラー時に別 provider へ切り替えません。CLI の無応答タイムアウトは15分です。

旧 Discord 専用の Live / Code / URL / 接頭辞設定は廃止しました。セットアップまたは backend の設定読み込みで除去し、共通設定には転記しません。接続情報・Code 設定の変更は、パネルで切断して再度接続すると読み直します。

許可したユーザーは Bot 実行ユーザーの権限で Hermes のコード・ツールを利用できます。信頼する利用者を登録し、返信や音声を共有してよいチャンネルを指定してください。音声入力は許可ユーザーのみを取り込みますが、AI の発言は同じボイスチャンネルの参加者に聞こえます。

## 起動と操作

```powershell
aidiy_discord
```

画面中央上部に小さなパネルが開き、前回のモデルで Discord へ自動接続します。初回（接続時の設定が未保存）は自動接続せず、モデル設定画面から始まります。音声会話は OFF が初期値です。モデルを選んで「接続」を押すと設定が保存され、次回から自動接続します。「切断」を押すとモデル選択の画面に戻り、Live の AI・モデル・音声と、コードのモデルを選び直して右上の「接続」で再接続できます。コードは「aidiy_hermes」の固定表示で、モデルを `auto`（自動判定）／`same`（変更なし）／`codex_cli/same` などの CLI 名付き／`openai_oauth/gpt-…` などの一覧から選びます（aidiy_code と同じ指定）。候補は AIコアのモデル情報APIから取得し、停止中は `_AIDIY/aidiy_diag/code_models_info.json` を読みます。未保存時の初期表示は共通設定の `CODE_AIDIY_HERMES_MODEL` です。接続に失敗した場合も、エラーの案内と詳細を表示したモデル選択の画面に戻ります。左上には作業フォルダを「プロジェクト: フォルダ名」で表示します。作業フォルダは aidiy_code / aidiy_live と同じく、`aidiy_discord [作業フォルダ]`（または `--project`）で指定し、省略時は起動したフォルダです。Liveのモデル・音声と初期値はAPIを優先して取得し、API停止中は診断の合成JSONから選択します。「切断」でチャット・音声を終了して切断し、パネルを閉じた場合も Bot と実行中の CLI を終了します。接続中に「×」で閉じると「接続中です。終了しますか？」と確認し、「キャンセル」なら接続を続けます。切断中はそのまま終了します。画面下部には aidiy_code / aidiy_live と同じ「モデル ▾」と現在のモデル（`Live: AI - モデル · Code: aidiy_hermes - モデル`、Live OFF のときは Code だけ）を表示します。未接続で「モデル」を押すと設定欄へ移ります。接続中に押すと設定欄を開き、「適用して再接続」で切断・保存・再接続し、「キャンセル」で変更を戻して接続を続けます。パネルを重ねて起動すると既存の画面を表示します。終了処理中のパネルに重ねて起動した場合は、終了を待ってから開き直します。

コードのモデルは Live の選択状態と独立して保存します。Live のモデルまたは音声候補がない AI は「候補なし」と表示し、選択できません。保存済みの Live 設定が無効な場合もコードの変更は保存できますが、Live を ON で接続する前に有効なモデル・音声を選び直してください。

「音声会話」「コード」の見出し右にある OFF / ON スイッチで、接続する機能を選びます。音声会話（Live）は切り替えでき、OFF で接続するとボイスチャンネルに入室しても音声会話を開始せず、Live のモデル確認も行いません。コードは現在 ON 固定で、スイッチは操作できません。両方 OFF では接続しません。切り替えは切断中だけ行えます。

接続中のパネルは設定欄の代わりに、AiDiy の絵と、最後のやり取り（発言者と本文）を1件だけ表示し、約1分で消します。プロジェクト行の下の右寄せに「LIVE ON/OFF」「CODE ON/OFF」を表示し、Live が ON の間は背景に入力（赤）と AI の声（水色）の円型インジケーターを描きます。画面下部右端の「モニター」を ON にすると、通過する音声（許可ユーザーの入力と AI の声）をこの PC で聞けます。スピーカーの音を Discord のマイクが拾うとエコーになるため、モニターは接続ごとに OFF から始まります。Live が OFF の間はインジケーターとモニターを表示しません。

`aidiy_discord`、Diag の Discord ボタン、ルート `_start.py` で Discord を Yes にした場合のいずれも、前回のモデルで自動接続します。未接続で開く場合は `aidiy_discord --no-connect` を使います（`--connect` は従来の指定として受け付けます）。起動引数は Slack 版（`aidiy_slack`）と同じです。全体起動からのパネルも手動で停止・終了でき、閉じたパネルを監視ループで再表示しません。setup / start 開始時と全体の Ctrl+C 終了時も、Discord と必要な CLI / MCP 子プロセスは Code / IDE と同じく継続します。Core 停止中は Live の接続機能が使えません。明示的な cleanup、またはパネルからの停止・終了では従来どおり停止します。

どちらの起動方法でも、パネルを開く前に共通設定・Hermes の起動パスを確認します。トークンが空欄・1文字・`<` で始まる仮設定の場合は、設定項目名を示すエラーを表示して終了コード1で中止します。トークンそのものは表示せず、この確認で Discord には接続しません。

モデル情報APIから初期値とモデル・音声候補を取得します。APIを取得できない場合は `_AIDIY/aidiy_diag/` の `live_models_info.json`、`live_voices_info.json`、`chat_models_info.json`、`code_models_info.json` を読みます。キーや音声の旧設定ファイルは使いません。候補を更新する場合は `aidiy_diag --headless` を実行してパネルを開き直してください。共通初期値は有効な候補へ補正します。手動保存したモデル・音声が候補から削除されている場合は、選び直すまで接続を止めます。

パネルの選択は `~/.aidiy/aidiy_discord.json` の1ファイルに、音声会話の ON/OFF（`live`、未保存時は OFF）、Live のモデル・音声（`live_models`）、コードの実行環境（`code_name`、現在は `aidiy_hermes` 固定。将来の別ハーネス用）とモデル（`code_model`）をまとめて保存します。このファイルがあれば起動時に自動接続します。旧形式の `aidiy_discord_features.json` / `aidiy_discord_model.json` / `aidiy_discord_code_model.json` は、初回の読込で1回だけ移して削除します。未保存・破損時は共通 `LIVE_*` / `CODE_AIDIY_HERMES_MODEL` を使います。API キー・トークン・ID はモデル保存ファイルには含めません。

`frontend_channels/discord` での `npm start`、またはプロジェクトルートでの `python frontend_channels/discord/_start.py` でも同じパネルが開きます。`aidiy_discord --check` / `npm run config:check` は設定と Hermes の実行パスだけを確認し、Discord には接続しません。Code だけなら Core は不要で、Live を利用する場合はルート `_start.py` などで Core を起動してください。Core 停止中は保存済み・共通設定のモデルを表示します。起動ログは配置先リポジトリの `temp/aidiy_discord/logs/`（`<UUID>.stdout.log` / `.stderr.log`）、起動完了通知は `temp/aidiy_discord/runtime/`（`<UUID>.ready.json`）に保存します。旧ログの移行・削除・旧保存先への退避は行いません。ブラウザ版の `frontend_channels/discord/out/aidiy_discord/browser-profile` に保存します。Electron のユーザー設定は従来のままです。

### ブラウザ版（Codespaces など）

`aidiy_discord --browser` で、Electron の代わりにブラウザでパネルを開きます。画面・操作は Electron 版と同じで、パネルのサーバー（`src/web-server.ts`）と WebSocket でやり取りします。GitHub Codespaces（`CODESPACES=true`）と画面のない Linux（`DISPLAY` / `WAYLAND_DISPLAY` なし）では、`--browser` を省略してもブラウザ版で開きます。ブラウザは VS Code / Codespaces が設定する `$BROWSER` を優先して手元の PC で開き、Codespaces の `$BROWSER` には元の localhost URL を渡し、VS Code にポート転送と外部 URI の解決を任せます。手動用にはトークン付き転送先 URL（`https://<名前>-<ポート>.app.github.dev/…`）を表示します。開けない場合は URL を表示します。判定と起動は `frontend_ide/host/scripts/launch-project.mjs`、接続元の許可は `frontend_ide/host/src/forwarded-origin.ts` で aidiy_code / aidiy_live / aidiy_discord / aidiy_slack 共通です。Electron 版でパネルを閉じた時と同じく、画面を閉じると60秒後（初回は120秒後、Codespaces では初回接続まで終了しない）に Bot も終了します。4本（aidiy_code / aidiy_live / aidiy_discord / aidiy_slack）の起動規則は `frontend_ide/host/scripts/launch-project.mjs` の冒頭に一覧し、そこで共通化しています。Electron の専用ウィンドウを開けない場合（未セットアップ・起動失敗）は、理由を表示してブラウザ版に切り替えます。通常のブラウザ版は初回120秒、最後の画面切断後60秒で終了します。Codespaces では初回接続まで終了しません。Bot の音声は Discord の UDP 通信を使うため、Codespaces で音声会話がつながるかは環境によります。

## クリーンアップ

ルート `python _cleanup.py` の Channels(Discord / Slack) 項目は既定 Yes で、両チャンネルをまとめて選択します。削除前にこの作業コピーの Bot を子孫プロセスごと停止し、終了できない場合は削除を中止します。Channels の削除を選ばない場合でも、全体 cleanup の開始時には他サービスと同じく Bot を停止します。

削除対象は `frontend_channels/discord` 内の `node_modules`、生成物、temp、Python キャッシュと、この作業コピーを指す `aidiy_discord` ランチャーです。ソース、`package-lock.json`、共通 `_config/AiDiy_key.json`、前回のモデル・機能の選択は残ります。単独 cleanup は `python frontend_channels/discord/_cleanup.py` です。

## 会話のしかた

| 操作 | 動作 |
|--------|------|
| 専用テキストチャンネルに「おはよう」と投稿 | Hermes が返信 |
| 続けて普通に投稿 | 前の会話を引き継いで、送信順に返信 |
| 専用ボイスチャンネルに参加 | AiDiy も参加し、音声会話を開始 |
| ボイスチャンネルから退出 | 指定ユーザーが退出すると、AiDiy も音声会話を終了 |

### 短いコマンド（Slack 版と共通）

- `!help`: 使い方、`!status`: 状態、`!stop`: 実行中のコード要求の停止、`!new`: 新しいコード会話、`!chat 本文`: 明示的なチャット。
- Discord の音声操作は `!live [本文]` / `!leave`。旧 `!aidiy new` 形式には対応せず、未登録コマンドとして help を返します。
- **投稿の1文字目**が半角 `!` または全角 `！` ならコマンドです。`！new` も同じ意味です。空の `!`、未登録の `!unknown` は help を返し、AI には送りません。
- 記号の後の空白は許容します（`! new`）。先頭に空白がある ` !new`、文中の `説明 !new` は通常チャットです。Bot メンションは通常チャットの宛先として扱い、操作コマンドは実行しません。
- 起動後の最初の確定返信にだけ、使い方を自動付加します（音声接続通知も含む）。最初が help なら重複しません。Bot インスタンス全体で一度だけで、会話ごとではありません。Gateway の一時切断・復帰では戻らず、Bot を新しく起動すると戻ります。
- 同時返信でも案内は一度だけ。案内送信に失敗した場合は次の成功返信へ持ち越します。長文・添付の場合は回答の末尾に案内を別投稿します。

パネルで音声会話を OFF にして接続した場合、ボイスチャンネルの入退室には反応せず、`!live` / `!leave` も「Live は OFF のため利用できません。」と返します。

Code の会話は「サーバー・テキストチャンネル・ユーザー」ごとに分かれ、プロセス内で最新200会話まで保持します。Bot 再起動後は新規会話です。Hermes 自身の保存セッションは削除しません。続けて届いたメッセージは同じ会話内で順番に処理し、実行中を含む待機数は10件まで、全体の並行実行は4件までです。長文回答は添付テキストにし、回答内の `@everyone` などは通知を発生させません。

Live は指定ユーザーが指定ボイスチャンネルへ入室すると自動接続します。Bot 起動時も参加状態を確認します。音声の文字起こしはパネルに表示し、指定テキストチャンネルには AI の応答が終わるごとに「あなたの最後の発言＋AI の応答」を1件にまとめて送ります。指定ユーザーの退出、Discord / AIコアの切断で終了します。別のユーザーやチャンネルでは開始しません。接続失敗時はボイスチャンネルに入り直してください。DM、Stage チャンネル、画面共有・映像には対応しません。

## 接続パネルの Vue ソースと配布物

Electron とブラウザ版は同じ Vue 3 画面を使います。`panel/components/接続/接続パネル.vue` が画面、`機能切替.vue` が共通トグル、`panel/components/接続/パネル状態.js` が接続状態・モデル選択・コード・ライブの状態管理、`panel/components/ライブ/音声表示.js` が描画を担当します。画面内部は「接続状態」「コードモデル」「ライブAI」「ライブモデル」「音声」「ウィンドウ操作」などの日本語で追えます。IPC、`LIVE_*`、保存済み JSON のキーは互換性のため変更しません。

`panel/view.js` は事前コンパイルした配布物としてリポジトリへ同梱します。通常起動ではビルドや CDN 接続は不要です。セットアップは `npm ci --include=dev`、Electron 更新、`build:panel`、`check:panel` を実行して配布物を揃えます。`index.html`、`view.js`、`visualizer.js`、`style.css` の公開 URL、Electron preload と WebSocket の API は維持しています。`visualizer.js` は互換 URL のための小さな入口で、描画本体は Vue バンドルに含まれます。

画面ソース・依存関係を変更して配布物を更新する場合だけ、次を実行します。

```powershell
npm ci
npm run build:panel
npm run check
npm test
```

`npm run check` は TypeScript と `panel/build-manifest.json` のソース・配布物一致を確認します。生成された `view.js`、manifest と Vue の MIT 表記を含む `THIRD_PARTY_NOTICES.txt` を一緒に保存します。`checks/panel-vue.test.ts` は実バンドルを模擬 DOM・IPC・音声で操作し、選択と保存、接続・再接続、画面下部のモデル設定と適用時の再接続、連打、保存失敗、モニター OFF 初期化、遅延応答、画面終了時の後始末を検証します。これは実 Discord 通話・OS 上の描画確認の代わりにはなりません。

## 検証・音声仕様

```powershell
npm run check
npm test
```

テストは模擬 CLI と localhost の WebSocket を使い、Discord や AI Provider へ接続しません。実 Bot の確認にはトークンと ID の設定が必要です。

- Discord の48kHzステレオ Opus を PCM16 に復号し、LiveAI へ16kHzモノラル（Gemini / FreeAI）または24kHzモノラル（OpenAI）で送ります。
- AIコアからの24kHzモノラル PCM16 を48kHzステレオ Opus にして再生します。FFmpeg は不要です。
- 指定ユーザーの音声を20ms単位で送り、無音も送って発話終了を検出します。
- `cancel_audio` で再生予約を破棄します。音声・通知キューには上限を設けています。
- DAVE 対応の `@discordjs/voice` と同梱の `@snazzah/davey` を使います。Discord 音声受信は Discord 側の公式 API 仕様が公開されていないため、Discord の変更時には接続の再確認が必要です。[discord.js 音声ライブラリ](https://discord.js.org/docs/packages/voice/0.19.2)、[Discord Voice 仕様](https://docs.discord.com/developers/topics/voice-connections)

応答がないときは Message Content Intent、許可 ID、チャンネル権限を確認します。ライブだけ接続できないときは Core の起動、`LIVE_*` 設定、UDP 通信、ボイス接続・発言権限を確認してください。

## 著作権・ライセンス

独自実装には次の定型文を使用します。ライセンス全文は [LICENSE](../LICENSE) を参照してください。

```text
COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027
```

第三者ライブラリには各配布元のライセンスが適用されます。再配布時は、それぞれの著作権表示・ライセンス文書も保持してください。

### lockfile の検証と Electron 更新

- `npm run check:lock` は package.json と lock の直接宣言、および Opus の optional peer 解決を確認します。npm 全体の依存検証の代替ではなく、配布前には clean な一時フォルダで `npm ci` も確認します。
- Electron 更新は `npm run update:electron` を使います。npm 11 の `npm update electron` が変更対象外の `prism-media` 用 `opusscript@0.0.8` の lock を省略し、npm 10 の次回 `ci` が `Missing: opusscript@0.0.8` で失敗する場合があります。OS 固有ではありません。
- 更新前の正常 lock と変更されていない peer 所有パッケージを照合し、この省略が起きた場合だけ既存 entry の維持を明示して `npm ci` で導入物も揃えます。元から Opus peer が不整合な lock や、peer 宣言が変わった不整合は自動修復せず失敗にします。
- `build:panel` / `check:panel` もこの整合確認を行うため、manifest のハッシュ更新だけで依存欠落を承認しません。依存更新後は実際に `npm run build:panel` を実行します。

### ローカル Core の内部認証

モデル候補の取得と Discord Live の接続は、設定ファイルを読み込んだ配置先の
`_AIDIY/backend_core/internal_auth.json` を Node 側だけで読み、Authorization ヘッダーで認証します。
Core を先に起動してください。トークンは Core 起動時・日付変更時に更新され、各要求・接続の直前に再読込します。
配置先の `PORT_CORE` と一致する `127.0.0.1` 以外へは送信せず、HTTP / WebSocket の転送も追従しません。
作業フォルダの設定は認証探索に使わず、パネル・URL・ログへトークンを渡しません。
Core 停止中はモデル候補を既存のローカルファイルから取得できますが、Live 接続は認証なしで継続しません。
Code の Hermes 直接起動、Discord Bot 自体の認証、Discord への添付送信は別経路です。

Core 再起動中のモデル取得は、認証ファイルの一時欠落や 401/403 に対して最大5回の準備確認を行います。
拒否された旧トークンは再送せず、新しいファイルを待ちます（待機間隔 250 / 500 / 1000 / 2000 ms、各 HTTP 要求は最大1500 ms）。
パネル停止で待機も中断します。業務 POST やチャット本文は再送しません。
Live は最初の init より前の認証・接続失敗だけを最大5回再試行します。
通話開始後に Core が落ちた場合は従来どおりボイスチャンネルへ入り直してください。
その再接続時に新トークンを読み、以前の音声・テキストは再送しません。
