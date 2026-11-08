# AiDiy Code

現行画面は `frontend_ide` のVue共通部品です。既存の起動コマンドと拡張IDを維持します。共通画面の変更・起動手順は [frontend_ide README](../README.md) を参照してください。本書は現行のCode拡張・通信基盤と単独起動の補足です。

**AiDiy Code** は `aidiy_live` と同じローカル AIコアに接続し、`AIコード.vue` と同じ Code CLI を選択して、プロジェクトのコード調査・編集を支援する独立した VS Code 拡張です。同じチャット画面を使うスタンドアロンも提供します。さらに開発スペース（宇宙をテーマにした IDE 開発環境、`aidiy_ide`）の部品としても動作し、IDE の「＋ Code」から同じプロジェクトで呼び出せます。

拡張 ID は `aidiy.aidiy-code`、配布ファイルは `dist/aidiy-code-0.1.0.vsix` です。拡張機能一覧の歯車から、この拡張を個別に無効化・解除できます。

拡張バージョンは当面 `0.1.0` に固定します。

入力欄の「検証ループ」は0〜3回を選択できます（初期値0回）。オフラインの間は0回に固定し、オンラインへ戻ると直前に選んでいた回数に戻ります。最後に選んだ回数は `~/.aidiy/aidiy_code_options.json` に保存し、次回の起動でも使います（モデルと同じく単独起動版と VS Code 拡張で共通）。0回はバックアップ・検証なし、1〜3回は指定回数を上限にバックアップと検証・修正を実行します。差分がなくなれば途中で終了します。単独起動版とVS Code拡張で共通です。

単独起動版 `aidiy_code` とVS Code拡張は未接続中も文字入力で送信でき、自動的に `aidiy_hermes` を直接実行します（検証0回固定）。接続済みと未接続の選択モデルは別々に保存し、接続状態に合わせて表示と実行モデルを切り替えます。`aidiy_code --offline` で直接起動することもできます。詳しくは [単独起動版README](./aidiy_code/README.md) を参照してください。

実装構成と設計方針は [AGENTS.md](./AGENTS.md)、変更・検証手順は [`../../_AIDIY/knowledge/frontend_ide,VSCodeチャット拡張変更手順.md`](../../_AIDIY/knowledge/frontend_ide,VSCodeチャット拡張変更手順.md) を参照してください。

## 導入

Node.js 22.12 以降と npm が必要です。IDE群全体を使う場合は文書ビューアも満たす 22.13 以降を使用してください。Vue 3・Electronはプロジェクト依存として導入し、グローバルVue CLIやグローバルElectronは要求しません。

1. AiDiy の Core サーバーを起動し、使用する Code CLI の認証を用意します。拡張モードを使う場合は VS Code **1.106 以降**も必要です。
2. AiDiy ルートの `python _setup.py` で、**IDE群（Navigator / Console / Code / Live / IDE / Task / Team / Browser）** を選びます。単体では `python frontend_ide/host/_setup.py` を実行できます。
3. 単独画面は `aidiy_code` を実行します。拡張モードは VS Code でフォルダを開き、コマンドパレットから **AiDiy Code: チャットを開く**を実行します。

セットアップは依存関係と Electron バイナリの事前導入、単独起動コマンドの作成と、VS Code CLIがある場合は VSIX を生成・配置します。必要版（`^1.106.0`）を満たさない場合や版数を読めない場合は警告して継続し、明示的な `--extensions-only` も実際のCLI結果に従います。CLI未導入では単独画面だけを準備します。`aidiy_code` のランチャーは `aidiy_hermes` と同じ `~/.local/bin` に配置します（Windows は `.cmd`）。このフォルダが PATH にない場合は追加してください。ランチャーだけを更新する場合は `python frontend_ide/host/_setup.py --launchers-only` を使います。この作業コピーから配置した旧名 `aidiy_vscode` は解除します。手動で VSIX を配置する場合は、拡張機能画面の `…` → **VSIX からのインストール**で、`dist/aidiy-code-0.1.0.vsix` を選びます。解除と生成物削除は `python frontend_ide/host/_cleanup.py`、またはルートの `python _cleanup.py` から実行できます。

既定では右側のセカンダリサイドバーに表示されます。VS Code の配置を変更している場合は、ビューの移動操作で配置を調整できます。

未接続時の実行と「対話 CLI」の Hermes は PATH と `~/.local/bin` から探索します。AiDiy の `_setup.py` が生成した Windows の `.cmd` に対応します。見つからない場合は、拡張の設定で **Cli Path** に `aidiy_hermes.cmd` または `cli_main.py` の絶対パスを指定してください。Python を直接指定する場合は **Python Path** を使用します（空欄では `cli_main.py` に隣接する `.venv`）。CLI 本体・Python・API 認証情報は VSIX に含めません。

## 操作

### チャット単独ウィンドウで使う

セットアップ後は、作業対象フォルダで次を実行します（Node.jsとセットアップ済みの共通画面が必要です。AIコア接続時はCore、未接続時の実行はHermesを使います）。

```powershell
aidiy_code
```

別のフォルダを明示する場合は `aidiy_code "C:\work\my-project"` と指定できます。セットアップ前の試用や開発中は、作業対象フォルダから `node /path/to/AiDiy2027/frontend_ide/host/aidiy_code/launch.mjs` を実行します。`launch-extension-dev.ps1` は Windows で VS Code 拡張の開発用ウィンドウを開くスクリプトです。

単独画面は Electron のフレームレスウィンドウで開き、起動時のカレントフォルダを作業対象にします。AiDiy ロゴのあるヘッダーをドラッグして移動でき、右上のボタンで最小化・最大化／復元・終了を操作できます。ウィンドウの端でサイズを変更できます。モデル選択・送信・進捗表示・停止・新規会話・会話履歴の選択と削除は VS Code 拡張と共通です。会話履歴は作業フォルダの `_AIDIY/aidiy_code/histories/` に1会話1ファイルで保存し、次回の起動や VS Code 拡張・開発スペースの Code 部品とも共用します。専用ウィンドウを閉じると実行中のコード処理へ停止要求を送り、接続と単独サーバーを終了します。VS Code の選択コード添付は拡張モードで利用してください。

ブラウザで開く場合は `aidiy_code --browser`（フォルダ指定も併用可能）を使います。現行の単独起動は `frontend_ide/launch.mjs` と `server.mjs` が所有し、CodeのAPIサーバーは `keepAlive:true` で共通サーバーに従います。ブラウザのタブを閉じるだけでは共通サーバーは終了しないため、起動したターミナルのCtrl+Cで終了してください。旧API単体起動の60秒アイドル終了とは異なります。

Codespacesと画面のないLinuxはWebで開き、`$BROWSER` とポート転送を使います。Electron起動失敗時は前景起動ならWebへ切り替えますが、通常の分離起動では失敗を報告します。起動時にElectronをダウンロードしません。`python frontend_ide/host/_setup.py` で事前に準備し、共通画面・起動の詳細は [frontend_ide README](../README.md) を参照してください。

VS Code 拡張として試す場合は、次の手順を使います。

作業対象のフォルダで PowerShell を開き、`frontend_ide/host/launch-extension-dev.ps1` を実行します。たとえば AiDiy2027 のルートからは次のコマンドです。

```powershell
.\frontend_ide/host\launch-extension-dev.ps1
```

起動したフォルダがプロジェクトフォルダになります。VS Code の開発用ウィンドウが開くので、コマンドパレットの **AiDiy Code: チャットを開く**で操作してください。AIコアへ接続するため、通常のチャットと同様に依頼を実行します。

試用時の VS Code 設定は `out/manual-profile` に保存します。通常の VS Code で同じフォルダを開いていても、試用ウィンドウで開けます。

### チャット操作

画面は会話と入力欄を中心とし、フォルダの追加・選択は VS Code 標準の操作だけを使います。「新規」「一覧」、モデル選択、履歴削除の確認、送信、停止は拡張モードと単独画面で同じチャットパネルから操作します。「設定」「選択コード」「実行ログ」「対話 CLI」は VS Code のビューの `…` メニューまたはコマンドパレットから操作できます。

- **送信**: 送信ボタンは空欄・空白だけの入力では白背景・青紫の枠・黒い紙ヒコーキで無効です。接続や入力の準備が整っていないときは灰色になります。送信できる文字を入力すると青紫になり、押すと送信します。入力欄の Enter は通常の改行です。Tab で送信ボタンへ移動し、そこで Enter を押すと送信します。日本語 IME の変換確定では送信しません。
- **停止**: 実行中の CLI と子プロセスを停止します。実行済みのファイル変更は残ります。
- **自動接続**: プロジェクトバー右側に「自動接続」「新規」「一覧」を配置します。スイッチは右がON、左がOFFで、通常起動時は毎回ONです。OFFではAIコアへの接続と10秒ごとの再試行を停止し、ONへ戻すと接続します。OFF中の新規会話・履歴復帰でも接続を開始しません。実行中・モデル変更中は切り替えできません。
- **予測**: 入力欄の操作行で「検証」の左にあるトグルです。毎回OFFで開始します。ONで、AIコアへ自動接続済み・toolsのpingが正常・入力欄が空白のときだけ、正式回答と処理全体の完了後に1回、次の入力を予測します。履歴は接続中のセッションから取得したプロジェクトパスに限定し、未取得・切断中は予測しません（起動フォルダ・画面の選択・共通設定で補完しません）。推論中は「予測中、、、」と左右に動く光を表示して入力欄を一時ロックします。通常の結果は編集可能な下書きへ入れるだけで、自動送信・会話履歴への追加はしません。予測困難を表す `!`（`！`も対応）で始まる正常応答は、記号を除いた説明をダイアログに表示します。通信失敗・履歴なし・タイムアウトは何も表示せず入力へ戻ります。OFF・新規会話・プロジェクトやセッションの変更・次の処理開始・画面終了では古い結果を破棄します。単独起動・IDE・VS Codeで共通です。
- **接続表示**: 自動接続ONでは未接続時は黒、接続済みはシアンのバーが4.5秒周期で明滅します。自動接続OFFでは赤いバーが同じ周期で明滅します。VS Code拡張ではタイトル行と接続状態の文字を表示しません。
- **新規**: 新しい会話に切り替えます。旧会話は履歴に残ります。
- **会話一覧**: 会話画面右上の「一覧」で、現在の作業フォルダの会話を最終更新日時の新しい順に表示します。日時と最初の依頼から会話を選択でき、各行の「削除」ではチャットパネル内に確認を表示します。実行中は切り替えと削除を行えません。「戻る」で今の会話に戻ります。
- **選択コード**: エディターで選択したコードを右クリックメニューから添付します。
- **コードAI／モデル**: 「モデル」から `aidiy_hermes`、`copilot_cli`、`codex_cli` 等を選び、各コードAIのモデルを選択します。モデル情報APIは `_AIDIY/aidiy_diag/code_models_info.json` を優先して読み、診断で保存した表示名・順序を使います。Hermes は `openai_oauth/gpt-6.1-sol`、Copilot は `claude-haiku-5.5` などを選択します。「自動」はAIコアの既定設定です。接続中の変更はセッションの設定だけに反映し、共通設定は保存しません。

オフラインのHermes候補も合成ファイルの `aidiy_hermes.models` を使い、`same` を追加します。合成ファイルがない場合は `same` だけを表示します。診断でファイルを生成・更新した後は、モデル選択を開き直すと再起動なしで反映されます。選択を確定するときも最新の候補を確認します。`claude_cli/same` / `codex_cli/same` / `copilot_cli/same` は各CLIのモデルを維持して呼び出します。
- **接続状態**: 単独版はタイトル左側に `未接続` / `接続中` / `接続済み` を表示します。接続済みはモデル設定と入力・コード出力の初期化完了を示します。拡張・単独版とも、自動接続ONでは通信切断・接続失敗時も10秒ごとに再接続を試みます。未接続中はHermesで送信できます。接続復帰時のHermes実行は完了まで維持し、次の送信からAIコアを使います。単独版の `--offline` は自動接続OFFで起動します。この場合、ONへの切り替えは新しいオンライン会話を開始します。

未接続時のコードAIは `aidiy_hermes` 固定です。モデルは診断の候補と `same` を使い、`~/.aidiy/aidiy_code_model_offline.json` に保存します。次回起動時もこの保存値を復元し、未保存なら `AiDiy_key.json` の `CODE_AIDIY_HERMES_MODEL`（候補外なら `same`）を使います。オンライン用の保存値は変更しません。表示形式は両方とも `NAME - MODEL` です。

VS Codeで作業フォルダを開いていなくても、未接続用のモデルは選択・保存できます。送信には実行先のフォルダが必要です。「ファイル」→「フォルダーを開く」で作業対象を開くと、AIコアが未接続でも文字入力で送信が有効になります。

画面で確定したコードAIとモデルは `~/.aidiy/aidiy_code_model.json` へ保存し、拡張・単独画面で共用します。未保存ならAIコアの既定設定を使い、起動引数は保存値より優先します。`aidiy_code --provider aidiy_hermes --model openai_oauth/gpt-6.1-sol` または `aidiy_code --provider copilot_cli --model gpt-6-sol` のように起動できます。旧設定の `openai_oauth` と `gpt-6.1-sol` は Hermes の組み合わせモデルへ移行し、`copilot-cli` 等の旧名も読み替えます。新規会話は最後の手動選択を使い、履歴復帰はその会話のモデルとAIコアのセッションを使います。

接続先は Live と共通の解決処理で `127.0.0.1` と `_config/AiDiy_key.json` の `PORT_CORE`（未配置時8091）を使います。Core は拡張ホストまたは単独サーバーと同じ環境で起動してください。
- **実行ログ**: stdout / stderr の実行状況を出力パネルで確認します。
- **対話 CLI**: 認証、`/model` などの対話操作が必要な場合に利用します。

プロジェクトフォルダには、VS Code で開いている作業フォルダを自動で使います。複数フォルダのワークスペースでは、編集中のファイルが属するフォルダを優先し、該当がなければ先頭のフォルダを使います。会話開始後はそのフォルダを維持します。別フォルダで会話を始める場合は「新規」を使ってください。会話履歴は作業フォルダごとに表示し、会話ごとの表示履歴（最新60件、最大200万文字）と AIコアのセッションIDを、その作業フォルダの `_AIDIY/aidiy_code/histories/` に保存します（プロジェクトごとの保管。単独起動版・開発スペースとも共用）。旧版が VS Code のワークスペース内ストレージに保存した履歴は、そのフォルダを開いた時に自動で移します。

### ローカル Core の内部認証

Code / Live の Core API 通信は、通常の Web / Avatar の利用者ログインとは別の内部トークンを使います。Core が作成する `<AiDiy配置先>/_AIDIY/backend_core/internal_auth.json` を Node ホストだけが読み、REST と WebSocket の `Authorization: Bearer` に付与します。トークンを画面、URL、設定保存、ログへコピーしないでください。

セットアップで VS Code へ配置する際、拡張内の `aidiy-installation.json` に配置元 AiDiy の絶対パスだけを記録します。Code / Live はこの記録を優先し、別プロジェクトを開いていても同じ配置元の `_config/AiDiy_key.json` の `PORT_CORE` と内部認証ファイルを使います。トークンや共通設定の内容は拡張へコピーしません。配布元 VSIX は変更せず、配置に使う一時コピーだけに記録します。

AiDiy を移動・削除した場合や記録が壊れた場合、別の checkout へ自動で切り替えません。移動先から Code / Live を再セットアップして VS Code のウィンドウを再読み込みしてください。新しいソースの反映には通常セットアップが必要です。更新済み VSIX の再配置だけなら `python frontend_ide/host/_setup.py --extensions-only` を使えます。記録のない旧版・開発ホスト・手動配置の VSIX は従来どおり拡張配置先、信頼済み作業フォルダの順に親を探索します。

接続先は同じ配置の `http://127.0.0.1` に限定し、設定・Core 本体のないフォルダ、別ポート、リモート URL、不正・期限切れの内部認証ファイルは拒否します。フォルダ名は自由です。WSL / SSH / Codespaces では拡張ホスト側でセットアップと Core 起動を行い、別の環境の記録や認証ファイルをコピーしないでください。

各 API 要求と新しい WebSocket 接続でファイルを読み直すため、Core の日次更新・再起動後も再起動前のトークンを固定保持しません。Code は接続失敗時に約10秒ごとに再接続し、明示的な切断・終了で停止します。Live は従来どおり手動で再接続します。認証ファイルがまだ更新されていない場合は Core の起動完了を待ってください。送信済みの依頼を認証更新のために自動再送しません。

## ストリームの仕様

既存の `AIコード.vue` / `AIコード.py` / `AIコード_cli.py` と同じメッセージ形式を採用しています。

| 種類 | メッセージ識別 / 内容 |
|---|---|
| 要求 | `input_text`（アダプターは `input_request` も受理） |
| 停止 | `cancel_run` |
| 開始 | `output_stream` / `STX` (`0x02`) |
| 実行中 | stdout / stderr の各行を `output_stream` で逐次表示 |
| 終了 | `output_stream` / `ETX` (`0x03`) |
| 中断・異常 | `output_stream` / `CAN` (`0x18`) |
| 正式回答 | `output_text` |

制御コードは状態遷移にだけ使い、表示本文には含めません。AIコアへは `input` とコード出力 `1` の2本で接続し、両方の `init` とモデル設定の反映後に送信します。未接続時は同じ形式でHermesの出力を中継します。AIコアとHermesのセッションIDは別々に保持し、再接続で混在させません。

## 対応範囲

- Windows デスクトップ版 VS Code での利用を想定しています。Linux/macOS のプロセス起動分岐もありますが、実機検証対象は Windows です。
- `extensionKind: workspace` のためRemote SSH / WSL / Codespacesでは接続先のNode.js拡張ホストで動作します。接続先にAiDiyとCLIを準備してください。仮想ワークスペースと、リモート拡張ホストのないWeb版VS Codeは対象外です。
- CLI のツール実行・承認設定に従います。拡張から `--yolo` を付けません。
- チャット入力はワンショットの要求文です。TUI のスラッシュコマンドや対話承認画面は「対話 CLI」で利用してください。
- 手動の差分適用ボタンはありません。AIコア接続中・待機中は画像を含むファイルを入力欄へドロップして送信できます（1件4MiB・一度に10件まで）。未接続時のHermes直接実行ではファイルドロップを受け付けません。

## 開発・配布

以下は依存準備とVSIX配布物を更新する場合の手順です。日常の文書確認だけでビルド・配布を実行する必要はありません。

```powershell
Set-Location frontend_ide/host
npm ci
npm run check
npm test
npm run package
```

Windows の実 VS Code で登録・起動を確認する場合は、コンパイル後に `./scripts/test-extension-host.ps1 -Scenario Code` を実行します。専用の一時プロファイルで Code の登録・起動を確認します。

`dist/aidiy-code-0.1.0.vsix` が生成されます。共通セットアップで生成済み VSIX を配置する場合は、ルートから `python frontend_ide/host/_setup.py --extensions-only` を実行します。セットアップは配置対象の VSIX の存在を確認し、拡張名が `aidiy-` で始まる既存拡張（`publisher.aidiy-*`）をすべて除去してから拡張を配置します。旧 `aidiy-vscode` も対象です。クリーンアップも同じ判定で除去し、解除を確認できない場合はランチャー・生成物の削除を中止します。生成物を削除する前に、この作業コピーの単独実行と専用ブラウザも強制終了し、終了を確認します。手動では各 VSIX を個別にインストールできます。`npm test` はモック CLI による検証で、AI API を呼びません。

Marketplace で公開する場合は、所有する publisher ID に `package.json` の `publisher` を合わせて公開します。初期値 `aidiy` はローカル配布用の識別子です。

仕様の参照: [Secondary Side Bar の拡張 API](https://code.visualstudio.com/updates/v1_106)、[Webview API](https://code.visualstudio.com/api/extension-guides/webview)、[VSIX の配布](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)。

Codespaces のブラウザ版は、ポート転送やブラウザ認証を待てるよう、初回の画面接続までは自動終了しません。一度画面を開いた後は、最後の画面を閉じて約60秒で終了します。起動時は `$BROWSER`（VS Code のブラウザヘルパー）にトークン付き localhost URL を渡し、VS Code にポート転送と外部 URI の解決を任せます。転送先の URL を手で組み立ててヘルパーへ渡さないでください。手動では起動時に表示されるトークン付き URL を開きます。

## 著作権・ライセンス

独自実装には次の定型文を使用します。ライセンス全文は [LICENSE](./LICENSE) を参照してください。

```text
COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027
```

第三者ライブラリには各配布元のライセンスが適用されます。再配布時は、それぞれの著作権表示・ライセンス文書も保持してください。
