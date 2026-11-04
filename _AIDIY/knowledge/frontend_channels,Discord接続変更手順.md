# Discord 接続変更手順

> 文書: `frontend_channels,Discord接続変更手順.md` | 実装: `frontend_channels/src/ライブ/音声処理.ts`, `frontend_channels/checks/audio.test.ts`, `frontend_channels/src/`, `frontend_ide/host/src/runner.ts`, `frontend_ide/host/src/protocol.ts`, `frontend_ide/host/aidiy_live/src/protocol.ts`, `backend_server/conf/conf_json.py`

## このメモを使う場面

- Discord の Code / Live 接続や Bot コマンドを変更する。
- `AiDiy_key.json` の Discord 設定を追加する。
- 音声変換、同時操作、切断回収を検証する。
- 全体のセットアップ・起動・cleanup への組み込みを変更する。

## 開発中の受付窓口を維持する停止方針

- Discord は、開発中にも外部から調整依頼を受け付けるための窓口として使う。通常の setup / start 開始時と全体 start の Ctrl+C 終了時は、Code / IDE と同じく強制終了から除外する。
- パネル、Bot worker、ブラウザ版サーバーだけでなく、依頼処理に必要な Hermes / CLI / MCP の子孫も保持する。共通判定は `scripts/_setup_processes.py`、全体 start の通常終了は `_start.py::stop_processes` で揃える。
- Core 停止中の Live など、停止したバックエンドに依存する機能まで利用できることは保証しない。独立した Live / Console 等を Discord 配下という理由だけで保持しない。
- 明示的な `_cleanup.py` とパネルからの停止・終了は従来どおり対象を停止する。cleanup の停止要求は自動再起動を抑止する。
- 起動中の Discord は依存更新でも停止させない。通常の `frontend_channels/_setup.py` は起動中または判定不能なら依存・ランチャー・共通設定を変更せず `False` で保留する。一括setupで「エラーが発生しても続行」を選択した場合は保留せず、依存・パネル生成・Electron配置・ランチャー・設定補完を可能な限り試行する。Electronコピー・配置の `OSError` のみ WARN（入力欠損は除外）として別集計し、配置未確認と表示する。npm・ビルド等の失敗は NG のまま後続を試行し、最終 `False` を維持する。コピー警告だけなら警告付き `True`。実行中画面の継続動作は保証しない。
- 回帰確認は `python -B -m unittest discover -s scripts/checks -p test_setup_processes.py`、`python -B -m unittest discover -s scripts/checks -p test_start_shutdown_flow.py`、`python -B -m unittest discover -s frontend_channels/checks -p test_lifecycle.py`。合成プロセスとモックで保持・停止を検証し、実際のサービスは停止しない。

## 変更箇所

Electronの基本操作・表示は [共通,Electronウィンドウ基本方針.md](./共通,Electronウィンドウ基本方針.md) に従う。`panel/desktop.cjs` が本体窓へ共通の `attachNativeWindowMove(window,screen,'discord')` を一度取り付け、内容・配置の確定後に共通 `拡大表示` で透明パネル内をズームする。接続処理・終了時のworker回収は従来のまま。`node --test frontend_channels/checks/desktop.test.ts` は取り付け・最小メニュー・終了回収を確認する。

1. `frontend_channels/AGENTS.md` で構成を確認し、導入・操作は `frontend_channels/README.md` を参照する。
2. Discord 専用設定はトークン、サーバー ID、`discord_allowed_user_id`、`discord_text_channel_id`、`discord_voice_channel_id` の5項目とする。ID は配列ではなく単一文字列で指定する。`backend_server/conf/conf_json.py` の `DEFAULT_CONFIG`、`frontend_channels/src/接続/接続設定.ts`、README を揃える。旧キーの移行・読み替えは行わない。実トークンの内容は出力しない。
3. CLI 実行・停止・resume は `frontend_ide/host` の共通実装を使用する。CommonJS の日本語 export は `src/共通連携/IDE連携.ts` を通す。コードの実行環境は aidiy_hermes 固定で、パネルには固定表示する。モデルは aidiy_code と同じ1つの文字列（`auto` / `same` / `codex_cli/same` / `openai_oauth/gpt-…`）で選び、Hermes への引数は AIコア（`backend_server/AIコア/AIコード_cli.py`）と同じ規則で `src/コード/Hermesモデル.ts` の `Hermes会話引数` が作る。OAuth の provider は CLI に明示し、認証切れを別 provider への退避で隠さない。候補は AIコアのモデル情報API（`code_models.aidiy_hermes`）を優先し、停止中は `_AIDIY/aidiy_diag/code_models_info.json` を読む。未保存時の初期表示は共通 `CODE_AIDIY_HERMES_MODEL`（既定 `auto`）、実行回数は `CODE_MAX_TURNS`、作業フォルダは `CODE_BASE_PATH` を使う。
4. Live は既存の input / 0 / audio 接続を使用する。入力レートは `init` のモデル設定に追従する。
   接続先はローカルの `PORT_CORE`、初回の AI とモデル・音声は共通の `LIVE_AI_NAME` / `LIVE_*_MODEL` / `LIVE_*_VOICE` を使う。手動選択は後述の `~/.aidiy/aidiy_discord.json` の `live_models` に保存し、次回以降は優先する。共通キー JSON に Discord 専用のモデル項目を追加しない。
5. 専用チャンネルの通常投稿をチャットとして受け付ける。`commands.ts` と `bot.ts` の許可判定より前に外部操作・返信を行わない。既存コマンドは互換用として残すが、通常の利用手順に要求しない。
6. 未接続時は設定画面、接続中（再接続中を含む）は aidiy_live の初期画面と同じ AiDiy 絵と回転する四角形のステージに切り替え、その下に最後の発言（発言者と本文）をターミナル演出で1回だけ表示し、約1分で消す。背景には aidiy_live と同じ円型インジケーター（`panel/components/ライブ/音声表示.js` は `aidiy_live/src/visualizer.ts` の移植。変更時は両方を揃える）を描く。入力はAIコアへ送るミキサー出力、再生音は `Discord音声出力` が実際に送出する20ms分から、worker で音量と128帯域の分布（`音声スペクトル` / `音声レベル`）だけを50ms間隔で求めてパネルへ送る。PCM自体は、接続中に「モニター」を ON にした間だけ（接続ごとに OFF から開始）無音を除いて base64 でパネルへ渡し、Web Audio で再生する（`Live接続.モニター送信` / `DiscordBot.モニター設定`）。スピーカー音を Discord のマイクが拾うとエコーになるため既定は OFF とする。Live の文字起こしはパネルへ逐次表示し、Discord へは発言ごとに投稿せず、AI の応答が1.5秒途切れた時点で「人間側の最後の発言＋AI の応答」を1件にまとめて投稿する（`Live接続.文字起こし送信`）。
7. 設定パネルの「音声会話」「コード」見出し右に OFF (〇　) ON のトグルを置き、結果で Discord への接続制御を行う。Live は切替可（`aidiy_discord.json` の `live`、未保存時は OFF）、Code は現在 ON 固定で操作不可。固定は `src/接続パネル/パネル操作.ts` の `コード固定ON`、Bot への反映は `Discord設定.liveEnabled` / `codeEnabled`。Live OFF では音声の自動接続・`live` / `leave` を行わず、Live のモデル確認も省く。Code OFF では通常投稿・`stop` / `new` を処理せず、Hermes 確認も省く。両方 OFF では接続しない。接続中パネルのプロジェクト行の下（右寄せ、`#features` の状態チップ）に「LIVE ON/OFF」「CODE ON/OFF」を表示し、Live OFF の間は円型インジケーターとモニター切替を出さない。
8. パネルの保存は `~/.aidiy/aidiy_discord.json` の1ファイル（`live` / `live_models` / `code_name` / `code_model`）とし、`src/接続パネル/パネル設定.ts` が検証・原子的保存・旧形式（`aidiy_discord_features.json` / `aidiy_discord_model.json` / `aidiy_discord_code_model.json`）からの1回限りの移行を行う。`code_name` は将来の別スタンドアロンハーネス用で、現在は `aidiy_hermes` だけを実行する（ない保存は読込時に書き足し、未対応の値では接続しない）。このファイルがあれば起動時（単独・Diag・全体起動）に自動接続し（`auto-start`）、未保存の初回は接続せずモデル設定画面から始める。切断・接続失敗ではモデル選択の画面に戻る。
9. 画面下部は aidiy_code / aidiy_live と同じ「モデル ▾」と現在のモデル（`Live: … · Code: aidiy_hermes - …`）を表示し、接続中に押すと設定を開いて「適用して再接続」で切断・保存・再接続する。接続中（接続処理中・再接続待ちを含む）に閉じると `panel/desktop.cjs` が終了を確認し、切断中はそのまま終了する。Slack 版（`frontend_channels/slack`）は同じ作りの双子で、変更時は対応するファイルを同じように変える（`frontend_channels/slack/AGENTS.md` の対応表）。
10. 音声の自動接続は Bot 起動・Gateway 復旧・許可ユーザーの入退室で参加状態を照合する。接続準備中の退出を直ちに反映し、接続処理と通知先の取得が遅れても退出済みの利用者に対して開始しない。ミュート切替や Bot 自身の参加で重複接続しない。

## 一括 build の依存同期

`_setup.py` の `b=build` は Discord だけ `npm ci --include=dev` で配布 lock を固定して導入する。他の画面の `npm install` と混同しない。npm 11 の `install` は `@discordjs/voice` 配下の optional peer `opusscript@0.0.8` を削除し、ルートの `0.1.1` では prism-media の要求を満たせず `build:panel` が失敗する場合がある。lock 検証は無効化しない。

以前の実行で lock が変更された場合は、`git diff -- frontend_channels/package-lock.json` で変更を確認し、必要な変更を退避してから配布版へ戻して再実行する。独自の依存変更は上書きしない。稼働中の Discord の保護は共通 `frontend_dependency_guard` に従う。

回帰確認: `python -B -m unittest discover -s scripts/checks -p test_node_refresh.py`。Discord だけが ci を使うこと、再試行でも install に戻らないこと、使用中の保護と失敗通知を確認する。

## 確認

起動ログは配置先リポジトリの `temp/aidiy_discord/logs/<UUID>.stdout.log` / `.stderr.log`、起動完了通知は `temp/aidiy_discord/runtime/<UUID>.ready.json` に保存する。`panel/launch.mjs` が保存先を決め、Electron / Web の通知書込先は `AIDIY_DISCORD_READY` で渡す。終了中の再起動も同じ通知ファイルで確認する。旧ログの移行・削除・旧保存先への退避は行わない。Windowsブラウザ版の `frontend_channels/out/aidiy_discord/browser-profile` と Electron の userData、モデル設定は従来のまま維持する。`checks/launch-restart.test.ts` で新保存先・profile維持・再起動・書込失敗時の非起動を、`checks/launch.test.ts` で設定検証失敗時に一時ファイルを作らないことを確認する。

独自実装のソース・パネル・起動スクリプト・検証コードには、README にある AiDiy の著作権・ライセンス定型文を付ける。JS / TS / CSS は `/*! ... */`、その他は各言語のコメント形式を使う。`frontend_channels/LICENSE` はルート `LICENSE` の全文と揃え、`package.json` の `license` は `SEE LICENSE IN LICENSE` とする。第三者ライブラリの表記には独自実装の定型文を適用しない。

`frontend_channels` で `npm run check` と `npm test` を実行する。通常起動には同梱の配布物を使うためビルド不要。Vue の画面・状態管理・描画ソースや依存関係を変更した場合だけ `npm run build:panel` で `panel/view.js` と `panel/build-manifest.json` を更新する。`npm run check:panel` はソースと配布物の一致を確認する。 セットアップは Electron 更新で lockfile が変わり得るため、依存導入後に `build:panel` → `check:panel` を実行し、いずれかが失敗した場合は導入失敗とする。manifest だけの書き換えや package-lock の検証除外で不一致を隠さない。

- `checks/code.test.ts`: stdin、ユーザー別・チャンネル別の resume、停止・終了。
- `checks/bot.test.ts`: 通常投稿→CLI→返信、連続投稿の順序、許可拒否、長文添付、起動・入室時の自動接続と準備中の退出、手動操作との競合、Live OFF / Code OFF 時の接続制御。
- `checks/live.test.ts`: localhost の模擬 AIコアを使った3ソケットの接続順、音声入力、再生予約破棄、接続拒否・切断回収。
- `checks/audio.test.ts`: 実 Opus コーデック、レート変換、無音、話者混合と上限。
- `checks/config.test.ts` / `commands.test.ts`: 設定検証、利用許可、本文分割。
- `checks/launch.test.ts`: 一時作業コピーで、空欄・1文字・`<` で始まるトークンが単独起動・自動接続とも Electron 起動前に拒否されることを確認する。実際のキーは変更しない。
- `checks/panel.test.ts`: 初回の共通モデル、選択の永続化・復元、Live ON/OFF の保存と Code の ON 固定、重複開始、接続途中の停止、終了、失敗とタイムアウトの回収。
- `checks/web-server.test.ts` / `desktop.test.ts` / `launch-restart.test.ts`: ブラウザ版の中継と終了、閉じる操作・終了中の再起動（詳細は後述の各節）。

本物の Bot の疎通には `AiDiy_key.json` に接続情報が必要。`npm run config:check` は外部に接続しない。実接続では専用チャンネルへの通常投稿、ボイス参加→自動接続→発話→退出による自動終了を確認する。mock の成功だけで Discord Gateway / DAVE / AI Provider まで検証済みとは扱わない。

全体スクリプトの検証はルートで `python -X utf8 -m unittest discover -s frontend_channels/checks -p "test_*.py"` を実行する。プロセス停止はモック、削除は一時ディレクトリで確認し、実環境の `_cleanup.py` を検証目的で実行しない。全体 `_setup.py` は Discord 既定 Yes、`_start.py` の Discord 選択は既定 No、`_cleanup.py` の削除選択は既定 Yes。

`aidiy_discord` / `npm start` は `panel/launch.mjs` から Electron の小型パネルを開く。プロジェクトフォルダ（Code の作業フォルダ）は aidiy_code / aidiy_live と共通の `frontend_ide/host/scripts/launch-project.mjs` で決め、`[作業フォルダ]` / `--project` 未指定時は起動したフォルダとする。worker へは `AIDIY_DISCORD_PROJECT` で渡し、未設定（`src/main.ts` 直接実行など）の場合だけ `CODE_BASE_PATH` を使う。全体起動はリポジトリ直下で起動する。画面位置はマウスのあるディスプレイの workArea 上部中央とする。単独起動は未接続、全体 `_start.py` で Yes の場合は `--connect` を渡して自動接続する。`--wait` を付けず独立起動する。全体の起動前整理・Ctrl+C 終了では Discord と必要な CLI / MCP 子孫を保持し、明示的な `_cleanup.py` では停止する。接続開始時に共通設定を再読込し、前回のモデルを適用する。接続・再接続中でも停止でき、終了時は worker に shutdown を送り、Code CLI・Live・Gateway を回収する。正常終了に応答しない場合だけ worker の子孫を停止する。Electron はセットアップで事前配置し、起動中にはダウンロードしない。

ブラウザ版（`--browser`、または Codespaces・画面のない Linux で自動）は Electron の代わりに `src/web-server.ts` を Node で起動し、同じ `panel/` の画面へ `panel/web-bridge.js` が `window.discordPanel` を WebSocket で提供する。操作の中継は Electron 版の `src/panel-worker.ts` と共通の `src/接続パネル/パネル中継.ts` に置き、通信路だけを入口ごとに分ける。接続元は aidiy_code / aidiy_live と共通の `frontend_ide/host/src/forwarded-origin.ts`（127.0.0.1、Codespaces ではポート転送先と localhost 転送も）だけを許可し、画面は推測できないトークン付きパスで配信する。Electron 版でパネルを閉じた時と同じく、画面を閉じると60秒（初回は120秒）後に Bot も終了する（`--wait` でも同じ）。専用ウィンドウを開けなければ理由を表示してブラウザ版に切り替える。4本（aidiy_code / aidiy_live / aidiy_discord / aidiy_slack）の起動規則は `frontend_ide/host/scripts/launch-project.mjs` 冒頭に一覧し、共通の関数（`ブラウザ自動判定` / `ブラウザ版表示` / `ブラウザ版へ切替`）を使う。入口ごとに独自の判定や案内文を追加しない。`checks/launch-restart.test.ts` で Electron 不可時のブラウザ版への切替と転送先 URL を確認する。`checks/web-server.test.ts` で接続元の拒否、要求・通知の中継、終了を確認する。Codespaces 実機と音声UDPは別途確認する。

起動引数のソースパスは絶対パスにし、`discord_processes.py` の照合と同期する。動作確認は `aidiy_discord --check` で行う（Discord への接続なし）。

## 接続に失敗する場合

- パネルのエラー詳細欄を選択してコピーし、失敗段階（設定読込 / Hermes確認 / モデル確認 / Bot作成 / Discord接続 / 準備完了待ち）、経過時間、エラー名・コード・本文・入れ子の原因を確認する。同じ情報を `frontend_channels/out/aidiy_discord/*.stderr.log` にも出力する。
- `src/接続/接続エラー.ts` は Bot トークンなどの認証情報を伏せ字にし、HTTP要求オブジェクト全体・本文・スタックを出力しない。エラーを拡張する場合もこの範囲を維持する。
- `TokenInvalid` / `Authentication failed` はトークン認証、`Used disallowed intents` は Message Content Intent、`ENOTFOUND` はDNS、`UND_ERR_CONNECT_TIMEOUT` / `ETIMEDOUT` は通信タイムアウトの切り分けに使う。経過時間だけで原因を断定しない。パネルの接続待ち上限は40秒で、それ以前にもSDK側のエラーが返る。
- `Hermes確認` の失敗は、実際に動かしているPCで `aidiy_discord --check` を実行してPython・CLIの起動パスを確認する。開発環境の不足を別PCの原因とみなさない。
- `checks/connection-error.test.ts` / `checks/panel.test.ts` で原因別の案内、詳細の伏せ字、失敗後の回収、再試行で詳細が消えることを確認する。Windows実機の接続可否は別途確認する。

### REST / Gateway のプロキシ経路を確認する

- `src/接続/ネットワーク接続.ts` は起動時の HTTP(S)_PROXY / NO_PROXY を読み、REST は Undici の安定API `Agent.factory` / `ProxyAgent`、Gateway は `https-proxy-agent` を使う。REST dispatcher を指定しただけで Gateway 対応済みとしない。
- 現行の `@discordjs/ws` 1.2.3 は Node で `ws` を使用し、`ws` が `createConnection` を指定するため `https.globalAgent` の変更だけではプロキシが適用されない。正規の `ws.buildStrategy` / `WorkerShardingStrategy` と `src/gateway-worker.mjs` で Gateway を専用スレッドへ分離し、その中の `https.request` に Gateway と resume の `*.discord.gg` だけ agent を渡す。停止時はSDKによる worker 終了まで待ち、CONNECT待ち・再接続タイマー・ソケットをまとめて回収する。RESTはBot本体の dispatcher をdestroyする。通常のBot workerの通信関数やローカルAIコアには適用しない。SDK更新時は、この経路とSDKの正規拡張点の有無を再確認する。node_modulesは編集しない。
- ローカルAIコアは常に直接接続する。プロキシURL・資格情報をIPCやログへ渡さず、`connection-error.ts` でも環境プロキシURLを伏せる。
- 音声用WebSocketは通常Gatewayとは別経路。`src/ライブ/ライブ会話.ts` のvoice adapterは `onVoiceServerUpdate` のendpointを `src/接続/ネットワーク接続.ts` の `Discord音声通信.接続先登録` へ渡してからSDKへ通知する。voice 0.19.2にはagent指定APIがないため、通知されたホスト・ポートへの `https.request` だけを捕捉する。非443ポート、NO_PROXY、音声サーバー変更・再接続を維持し、Live終了時にrequest関数・CONNECT待ち・ソケットを回収する。SDK更新時は正規のagent指定APIの有無を再確認する。
- 「WebSocket接続中」のタイムアウトでは「音声接続先」のホスト・ポートと「プロキシ経由／直接接続」を照合し、プロキシのCONNECT許可も確認する。HTTPプロキシ対応はUDP中継を含まない。「UDP接続・IP検出中」の失敗はUDP経路を別途確認する。音声のトークン・セッションID・暗号鍵・プロキシURLはログへ出さない。
- 設定方法は `frontend_channels/README.md` を参照する。環境変更後は旧パネルを閉じ、設定済みの起動元から開き直す。`panel/desktop.cjs` の fork は親環境を標準で継承する。GUIの起動元が端末と同じ環境を持つかは実機で確認する。
- `checks/network.test.ts` は外部通信なしで大小文字・NO_PROXY・直接経路・失敗後の回収を検証する。模擬HTTP CONNECTプロキシとHTTPS/Gatewayを用い、実際の discord.js ClientReady と resume、認証付きプロキシ、ローカル通信の除外、実SDKの接続途中停止とスレッド終了も確認する。`checks/fixtures/network-*.fixture` はテスト専用の自己署名証明書・秘密鍵であり、製品には使用しない。子プロセスの `NODE_EXTRA_CA_CERTS` だけで信頼し、TLS検証を無効化しない。
- `node checks/network-diagnostic.mjs` はBot設定を読まず、直接経路と環境経路の公開REST・認証前Gateway HELLOを比較する。通常テストから分離し、経路の失敗だけでは非ゼロ終了しない。Bot認証、対象PCのGUI接続、Hermes返信、音声UDPと実通話は別途確認する。
- `checks/fixtures/network-runner.ts` は実際のLive adapterとvoice SDKを使い、模擬CONNECTプロキシ経由の非443ポートへの音声WSS接続、ローカル通信の除外、接続待ち中の停止も確認する。模擬音声WSSの成功を、UDP・DAVE・実通話の成功とは扱わない。

## Vue 接続パネルの変更

- `panel/components/接続/接続パネル.vue` と `機能切替.vue` が描画、`panel/components/接続/パネル状態.js` が状態管理、`panel/components/ライブ/音声表示.js` が音声インジケーター。内部状態名は「接続状態」「コードAI」「ライブAI」「ライブモデル」「音声」「ウィンドウ操作」に揃える。IPC と `LIVE_*` 設定キーは外部互換のため維持する。
- `panel/view.js` は SFC を事前コンパイルした配布物。Electron の file:// とブラウザの token 配下で同じ静的 URL を使い、CSP に unsafe-eval や CDN を追加しない。`panel/visualizer.js` は旧 URL の互換入口として残す。
- シアン接続バー上のタイトル行は module 内の `panel/titlebar.css` の変数を使い、`style.css` から import します。共通配色と同じ内容を保守作業でコピーしますが、通常buildは他moduleのCSSを読みません。Web は固定 allowlist にあるコピーだけを配信し、原本フォルダは公開しません。配色変更後は ローカルコピー更新後に `build:panel` と `check:panel` で module 内の manifest を同期します。タイトルは背景 `#30343a`・文字 `#fff` に統一し、1px外枠も共通 `--aidiy-panel-border` でタイトルと同色にします。シアンバーより下の外側・通常の応答表示面は未接続・接続中とも真黒 `#000` に揃えます。入力・警告・機能状態・内容本来の色、接続バー、ピンの状態色は識別のため維持します。
- `checks/panel-vue.test.ts` は実バンドルを模擬 DOM・IPC・音声で検証する。保存中の連打、開始応答待ち中の停止、再接続、候補欠落、Live OFF、音声モニターの初期 OFF、終了時の購読・タイマー・AudioContext の回収も確認する。OS の実描画と Discord の実通話は別途検証する。

## 音声変更時の注意

- 音声開始の成功判定にはソケット登録の `init` とProviderの待受準備を区別する。Discordはaudioの `connect` に `Live準備確認: true` を付け、同じセッションの `live_ready` を待ってからマイク中継・接続成功通知を開始する。バックエンドの `AIライブ.py` の `待受準備確認` は、Gemini / FreeAI のLiveセッション確立、OpenAIの `session.updated` による設定反映を確認する。要求しない旧クライアントは従来のinit完了方式を維持する。変更反映にはcoreとDiscordの両方を再起動する。
- 「接続しました」後に無応答なら、`[Discord Live]` の「待受準備が完了」「Discordの受信音声を復号」「AIの音声応答を受信」を順に確認する。最初の音声フレームだけを記録し、PCMや話者ID・設定値をログに出さない。Providerの拒否理由・コードは `connection-error.ts` で秘密値を伏せ、開始失敗時はBot、開始後はLive接続から一度だけ通知する。Discordの音声接続待ちは停止時にAbortSignalで解除する。
- 「Discord のボイス接続でエラー」はVoiceConnectionの例外であり、BotのGateway接続成功やLiveAIの準備完了とは別に確認する。通知の「ボイス状態」「音声通信」（WebSocket接続・認証、UDP接続・IP検出、暗号方式選択、Ready、再接続）と、後続の「原因 / 種類・コード・内容」を照合する。汎用案内だけではネットワーク障害や暗号化の失敗を断定しない。受信ストリームの暗号化例外とOpus復号例外も元の原因を保持する。SDKのdebugやnetworking全体にはボイストークン・暗号鍵が含まれるため出力せず、状態名と伏せ字済み例外だけを残す。`checks/live.test.ts` で接続後のボイスエラー・受信エラーの原因保持、秘密値除外、一度だけの終了通知を確認する。
- `checks/live.test.ts` と `checks/bot.test.ts` でinitのみでは入力を始めないこと、待受完了後の入力、準備中の終了、拒否理由の保持と伏せ字を確認する。バックエンドは `tests.test_live_text_response` と `tests.test_live_project_connection` でProvider設定受理と `live_ready` / `error` の通知順を検証する。

- Discord 音声は Opus / 48kHz / stereo。AI 入力は PCM16LE / mono / 16kHz または24kHz、出力は24kHz。
- 出力の20ms送出間隔は `@discordjs/voice` の AudioPlayer に任せる。Readable 側でも20ms待つとエンコード時間分の遅れが累積して無音が挿入されるため、要求時に即座に1フレームを渡し、highWaterMark で先読み量を制限する。
- AI 出力チャンクは20ms（24kHz mono PCM16で960バイト）単位とは限らない。端数を到着ごとに無音で埋めると、連続音声の途中に無音が混ざる。端数は次のチャンクと結合し、追加が60ms止まったときだけ発話末尾として無音で埋める。`checks/audio.test.ts` で分割受信時のOpusが連続PCMから生成したOpusと一致すること、および末尾の端数が失われないことを確認する。実通話でのざらつきが解消したかは別途試聴する。
- 音声間の無音を省くと AI の発話終了判定が止まる場合がある。
- `backend_server/AIコア/AI音声処理.py` の `音声入力データ処理` は、独自音量判定と切り離して全入力PCMをLiveAIへ渡す。音量判定で転送を絞ると、小声や一定音量の長い発話、発話末尾の無音が欠ける。OpenAI の `server_vad` は受信した無音で発話終了を判定するため、クライアントからの無音をバックエンドでも維持する。独自判定は音声認識バッファと再生割り込みに使う。
- レートの検証はサイズだけでなく実Opusの1秒音声の時間・周波数・音量を比較する。`checks/live.test.ts` では初期選択と異なる `init.LIVE_AI_NAME` でも、OpenAI が20msあたり960バイト、Gemini / FreeAI が640バイトのPCM16 monoを同じaudioソケットへ送ることを確認する。
- バックエンドの連続転送は `backend_server` で `uv run --locked python -X utf8 -m unittest tests.test_live_text_response` を実行する。4秒の一定音量発話と1.6秒の無音を、OpenAI / Gemini の送信アダプターまで欠落なく渡す回帰テストを含む。実Providerの発話終了イベントと実通話は別途確認する。
- 古い受信ストリームの遅延 close で、新しい同一話者のストリームを削除しない。
- 明示的終了、片側切断、途中の接続失敗、参加者全員の退出のすべてでタイマー・ソケット・Opus・プレイヤーを回収する。
- Discord パッケージ更新時は DAVE ライブラリと Node.js 必要版を実際の package.json / 公式資料で確認し、package-lock.json を更新する。
- WebSocket の `init` 成功だけでは AI の音声応答までは確認できない。文字要求後の `output_audio` も確認する。Provider が内容なしの `generation_complete` / `turn_complete` を返す場合は、短い自然な質問と別モデルで比較し、Discord のデコーダー障害と区別する。モデルを変更する場合は、共通の `LIVE_*` が他フロントエンドにも使われる点に注意する。

## 出力チャンク境界と末尾処理の再修正チェック

### 修正内容と関連箇所

- `src/ライブ/音声処理.ts` の `Discord音声出力.追加` は PCM を結合し、空でない追加だけで `lastAudioAt` を更新する。`_read` は960バイト未満の端数を保持し、最後の追加から60ms未満なら端数を消費せず Opus 無音パケットを返す。60ms以上で末尾を960バイトへゼロ埋めする。数値の同期元は同クラスとする。
- 完全な960バイトのフレームは待機せず変換する。チャンクごとのゼロ埋めをやめることと、AudioPlayer に送出間隔を任せることは別の条件であり、両方を維持する。
- `checks/audio.test.ts` の「20ms未満のチャンクは続きが届くまで保持し…」は `Date.now` をモックし、分割チャンクからの Opus を連続PCMから生成した Opus と比較する。待機中に端数を消費しないこと、60ms後に末尾を一度だけ送出することを確認する。
- 同ファイルの「再生側の要求ごとに20msのOpusを即座に供給し…」は連続フレームの即時取得、実 Opus デコード後のサイズ、バッファ上限と破棄を確認する。エンコーダーは状態を持つため、比較側にも同じ順番でフレームを与える。

### 次回の注意点と確認方法

1. 編集前に `_index.md` と本手順を読み、上記クラス・テストの現行実装を照合する。行番号ではなくクラス名・テスト名を入口にする。
2. 60msは発話末尾を推定する猶予であり、明示的な終了通知でも `_read` 内の待機タイマーでもない。空チャンクで猶予を延長せず、無音パケットの送出とPCM端数の消費を混同しない。
3. 回帰テストを追加する場合は実時間の sleep に依存せず、モック時刻とフレーム比較を使う。59ms/60msの境界や空チャンクも、変更対象に応じて確認候補にする。既存テストが全候補を網羅済みとは扱わない。
4. 本体を変更する作業では `frontend_channels` で `npm run check` と `npm test` を実行する。単体テスト成功と実通話での試聴を区別する。知見整理だけの依頼では、本体・テスト・設定・再起動ファイルを変更しない。

## ライブモデル・声の候補

- `src/ライブ/ライブモデル候補.ts` が モデル情報 API を優先し、取得できない場合は `_AIDIY/aidiy_diag/live_models_info.json` と `live_voices_info.json` を表示順ごと読み込む。FreeAI は Gemini と同じ一覧を使う。Core 未起動でも候補を表示できる。
- パネルの Live モデル・音声は選択式とし、共通設定や保存済み設定から候補を追加しない。保存時・開始時も候補と照合し、削除されたモデル・音声では接続せず選び直しを促す。読込失敗時は既定候補へ置き換えない。
- `checks/live-catalog.test.ts` / `checks/panel.test.ts` で JSON 読込、順序、FreeAI 共有、削除済み選択による保存・起動の拒否を確認する。候補編集後はパネルを開き直し、Core 側の候補も更新する場合は Core を再起動する。

## ウィンドウの大きさと初回演出（4本共通）

- 大きさは `frontend_ide/host/scripts/window-size.cjs`（幅476・最小幅360、高さは会話画面602／Discord・Slack パネル414の2種類）だけを使い、各 `desktop.cjs` に数値を書かない。ブラウザ版のアプリ表示も同じ値を使う。
- 初回の拡大演出は `frontend_ide/host/scripts/window-opening.cjs` の `拡大表示`（frontend_avatar のログイン・コア画面も `electron/main.ts` の `主ウィンドウ表示` から同じものを使う）。実ウィンドウを毎フレーム `setBounds` で広げると、Windows では未描画の縁が白くちらつく（`backgroundColor` も届かない）。そのため、最終位置・最終サイズの透明なキャンバス用ウィンドウの中で矩形を CSS で拡大し、実ウィンドウは大きさを変えずに透明のまま表示して、描画後に見せる。
- キャンバス用ウィンドウに `setIgnoreMouseEvents` / `focusable: false` を付けると、透明部分が白く描かれる環境がある。付けない。
- 変更時は画面を連続キャプチャして白い画素が出ないことを実機で確認する。単体テスト（`checks/desktop.test.*`）は呼び出し順・透明度・大きさを変えないことだけを確認する。

## 接続中にパネルを閉じる・直後に再起動する場合

- 接続中（接続処理中・再接続待ちを含む）に閉じると、`panel/desktop.cjs` は worker から届いた最新の接続状態を見て「接続中です。終了しますか？」を確認する（「キャンセル」で接続を続ける）。切断中は確認せずそのまま終了する。Slack 版も同じ。
- `panel/desktop.cjs` は worker の終了までウィンドウを保持する。閉じる操作が重なっても終了処理は一度だけ開始し、終了待ち中の `before-quit` は毎回キャンセルする。
- worker の終了済み判定には `exitCode` と `signalCode` の両方を使う。シグナル終了時は `exitCode` が `null` のため、この値だけで判定すると、発火済みの `exit` を再び待って重複起動ロックが残る。起動失敗で PID が無い場合も待たない。
- 終了応答が15秒無い場合は対象 worker のプロセスツリーを停止する。強制停止後も最大3秒で待機を終える。通常の Node / Electron や別アプリを名前だけで停止しない。
- 終了待ち中の `second-instance` には `closing` と親 PID を通知する。`panel/launch.mjs` は旧プロセス終了後に起動し直し、表示完了まで確認する。消える予定のウィンドウを起動成功と通知しない。
- Bot の終了は Live・Code・Gateway の回収を並行して開始する。返信先取得などの REST 応答の完了を待ってから Gateway を切断する順序に戻さない。遅れて戻った音声開始処理は `closing` で拒否する。
- `checks/desktop.test.ts` / `checks/launch-restart.test.ts` で接続中の終了確認、閉じる連打、シグナル終了済み、worker 起動失敗、強制停止、終了中の再起動をモック確認する。`checks/bot.test.ts` / `checks/panel.test.ts` では通信・CLI待ちが切断開始を妨げないことを確認する。実際の Discord 通話と Windows の GUI 再起動は別途確認する。

## アプリアイコンの所有者

Discord / Slack の正本はそれぞれ `frontend_channels/discord/panel/AiDiy_discord.{svg,png}`、`frontend_channels/slack/panel/AiDiy_slack.{svg,png}` です。現行 Discord の `panel/AiDiy_discord.png` と Diag の PNG は配布コピーで、別の SVG 原本を置きません。

名称帯は黒・白文字、8px白枠は下の帯だけ。人物原画は無改変です。`build:panel` は現行 module 内の Discord PNG を配布します。Diag へのコピーは明示的な保守作業で行い、通常 Diag build / verify / test / 起動に他 module の asset を必要としません。welcome 原画も `panel/AiDiy.png` を使い、旧 frontend_ide 素材パスを公開しません。

[共通,アイコン原本と配布](./共通,アイコン原本と配布.md) に全所有者と検証手順をまとめています。アイコン素材の変更は、Slack・Discord の接続処理の変更とは別作業です。


## Slack / Discord の短縮コマンドと起動時案内

- 両側の `src/接続/コマンド処理.ts` は、入力の**最初の文字**が `!` / `！` ならコマンドと判定する。判定前に trim しない。記号直後の空白は許容し、先頭空白・文中の記号は通常チャットとして従来どおり本文を渡す。
- 共通カタログは `help` / `status` / `stop` / `new` / `chat`。Discord だけ `live` / `leave` が加わる。旧 `!aidiy new` 等は登録しない。空・未登録の bang コマンドは help で終了し、Hermes へ渡さない。メンションは宛先として除去して通常チャットにする（操作を実行しない）。利用許可・会話キーの判定は変更しない。
- 起動後の自動 help は Bot インスタンス単位。一時的な Gateway 復帰・Slack の巡回復旧ではリセットしない。新しい Bot を生成する再起動ではリセットする。Discord は音声接続通知も対象、Slack の仮表示「考えています…」は対象外で確定回答へ付加する。
- 最初が help なら追加しない。最初の送信を直列化して重複を防ぎ、案内を含む最後の送信が成功してから消費する。失敗時は次の返信へ持ち越す。長文・添付では回答本体の成功と案内自体の成功を区別する。
- 再検証は両ディレクトリで `npm run check` と `npm test`。実サービス不要の `checks/commands.test.ts` / `checks/bot.test.ts` に半角・全角、空・未知、先頭空白、旧形式の拒否、メンションの通常投稿、初回 help、同時送信、送信失敗、長文、再接続、別 Bot の境界を置く。tsx CLI の IPC pipe が sandbox で EPERM になる場合、同じ test 群を `node --import tsx --test checks/*.test.ts` で実行できる（ネットワーク制限の解除ではない）。実 Slack / Discord 接続・有料 AI 実行の検証とは区別する。
