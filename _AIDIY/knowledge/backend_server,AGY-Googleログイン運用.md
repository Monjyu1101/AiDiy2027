# 公式 agy の Google ログインを AiDiy で使う

- チャットは `gemini_agy`（`CHAT_GEMINI_AGY_MODEL`）。テキスト専用で、添付画像、MCP、OpenAI互換の function calling は対象外。会話文は標準入力で渡し、CLI の最終応答だけを返す。AiDiy のチャット履歴を引き継ぎ、他の agy セッションは再開しない。
- コード作業は `agy_cli`（`CODE_AGY_CLI_MODEL`）。AiDiy 内で従来の `antigravity_cli` の設定や会話IDを引き継がず、`agy_cli` が取得した会話IDでのみ再開する。従来の `antigravity_cli` は変更せず、ワークスペース内の直近会話を探す CLI の `--continue` のまま。経路を切り替える場合は既存会話の続きではなく新規会話から確認する。接続中の省略モデルは agy 側の標準モデルを使う。モデル ID は Gemini API の名前から推定しない。
- どちらも Core / Tools を起動する OS ユーザーで、公式 agy に対話式で Google ログインしておく。Google API キーや Cloud ADC を子プロセスに渡さず、別プロバイダへ切り替えない。CLI に API キーモードが設定されている場合は、そのまま課金経路を使わず失敗することがある。ログイン済みでも実際の利用枠は Google のアカウント側に従う。
- Windows では VS Code 拡張の `%USERPROFILE%\.gemini\bin\agy.exe` と標準の `%LOCALAPPDATA%\agy\bin\agy.exe`、PATH を確認する。拡張配下の実行ファイルを AiDiy で上書きしない。
- Diag の標準ランチャーは Windows で「Antigravity CLI」と「agy.exe」を別々に表示します。ミニ・アイコン表示では利用可能な Antigravity CLI が優先で、なければ検出した agy.exe が出ます。「agy.exe」は選んだプロジェクトで Term を開き、承認省略フラグを追加しません。
- Diag でモデル一覧を生成・書込すると、Google ログイン用の取得結果は `_AIDIY/aidiy_diag/gemini_agy_models_info.json` に保存し、`gemini_agy` と `agy_cli` の候補を合成する。従来の `antigravity_cli` は別の `antigravity_models_info.json` の取得結果から合成する。CLI の検出と、選択できるモデルの取得・Google 認証・推論の成功はそれぞれ別。候補が取れないときは、Diag が見つけた同じ `agy` でログイン状態を確かめる。
- チャットの選択欄は `gemini_agy` → `gemini_chat` → `freeai_chat` の順です。`gemini_agy` は CLI を検出でき、専用カタログを読み込めるときだけ候補に出ます。候補から外れても保存済みの接続設定は変更しません。
- `_config/AiDiy_key.json` の新規作成・既存設定読み込み時に、不足する `CHAT_GEMINI_AGY_MODEL` を `gemini-4-hydrogen`、`CODE_AGY_CLI_MODEL` を `auto` で補います。Web・Avatar・Diag の「設定・再起動」は保存済みの設定を表示します。チャットの方式で `gemini_agy` を選び、コードは他のCLIと同じく、各コード枠で `agy_cli` とモデルを選びます。方式切替時の初期値には、候補にある場合は `CODE_AGY_CLI_MODEL` を使います。枠のモデルを保存しても、この既定値は上書きしません。Google API のキーや従来の `antigravity_cli` の設定は共用しません。
- 入力予測と判断にも `gemini_agy` を明示指定できます。`PREDICTION_GEMINI_AGY_MODEL` と `DECISION_GEMINI_AGY_MODEL` は既定 `gemini-4-hydrogen` で、通常チャットやコードのモデルとは別設定です。`auto` の Gemini 系優先順は `gemini_agy` → `freeai_chat` → `gemini_chat` です。Diag の「モデル一覧」で再取得・書込すると、実際に取得した AGY 候補が予測・判断の一覧にも入ります。どちらもテキスト専用で、予測の結果を自動実行せず、判断は共通の JSON 回答検証を通します。判断の `auto` は起動確認済みの方式を使い、画像がある場合はテキスト専用の AGY を飛ばします。
- 初回確認は、Diag の設定で `gemini_agy` を選択してモデル試行で「おはよう」が返ることを確認する。次に `agy_cli` を別のコード枠に選び、同じくファイル変更を依頼せず疎通する。Gemini API のキー・課金設定は変更しない。

参考: [Antigravity CLI の認証](https://antigravity.google/docs/cli-install)・[ヘッドレス入出力](https://antigravity.google/docs/cli/headless/)

## Hermes・Pi・Codex と設定画面での候補

- Diagでモデル一覧を取得・書き込みすると、導入状態に応じて `code_models_info.json` から `hermes_models_info.json`、`pi_models_info.json`、`aidiy_codex_models_info.json` が生成される。両方が使える場合は `antigravity_cli` の直後に `agy_cli`。未導入の区分は足さない。
- 各ハーネスのモデル選択は、専用一覧に保存された順序とモデルIDを使う。外部CLIは共通の委譲入口へ渡し、親の認証設定やAPIキーをAGYの認証に流用しない。Codexの選択に反映するには更新後のバイナリへ再コンパイルが必要。
- Web・Avatar・Diagの「設定・再起動」は、Coreが `code_models_info.json` から返す順序をそのまま使う。未検証の保存済み値を残す動作と、実行時の既定方式は変更しない。
