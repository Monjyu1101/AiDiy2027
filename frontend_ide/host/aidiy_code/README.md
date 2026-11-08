# AiDiy Code

`aidiy_code` はコード支援用のスタンドアロンです。表示名は **AiDiy Code** です。オンラインでは `AIコード.vue` と同じAIコアへ接続し、オフラインでは `aidiy_hermes` CLI を直接実行します。VS Code 拡張と会話画面を共用します。同じ画面は開発スペース（`aidiy_ide`）の部品としても動作し、IDE の「＋ Code」から開けます。

セットアップ後は、作業対象のフォルダで `aidiy_code` を実行します。プロジェクトルートから直接起動する場合は `frontend_ide/host/aidiy_code.cmd` を使えます。ブラウザモードは `aidiy_code --browser`、フォルダを明示する場合は `aidiy_code "C:\work\project"` です。

AIコアへ未接続の間も、文字を入力すると送信できます。送信先は自動で `aidiy_hermes` の単独実行になり、モデル選択もオフライン用の保存値を使います。オフライン専用の表示は設けず、タイトル左側の接続状態を使います。`aidiy_code --offline` なら最初からオフラインで起動します。`--browser` と併用できます。オフラインはAIコアサーバーを使わないという意味で、選んだAIモデルの認証・ネットワーク接続はHermes側の設定に従います。

- オンライン：AIコアのコードAI・モデルを選択でき、検証ループは0〜3回（初期値0回、最後に選んだ回数を次回も使用）。
- プロジェクトバー右側に「自動接続」「新規」「一覧」を表示します。自動接続は右がON、左がOFFで、通常起動時は毎回ONです。ONでは接続失敗・通信切断後も10秒ごとに再試行します。OFFでは接続と再試行を止め、新規会話・履歴復帰でも接続しません。ONでは未接続のバーは黒、接続済みはシアンの明滅、OFFでは赤の明滅です。実行中・モデル変更中は切り替えできません。Hermes実行中に接続が戻っても、その処理は最後までHermesで行い、次の送信からAIコアへ渡します。`--offline` で明示した場合は自動接続OFFで起動し、ONへ切り替えると新しいオンライン会話を開始します。
- オフライン：コードAIは `aidiy_hermes` のみ。検証ループは0回固定で、バックアップ・検証は行いません。モデル候補は `_AIDIY/aidiy_diag/code_models_info.json` の `aidiy_hermes.models` と `same` です。診断でファイルを生成・更新した後は、モデル選択を開き直すと再起動なしで反映され、確定時も最新の候補を確認します。未生成なら `same` だけを表示します。コードAI欄は `aidiy_hermes` 固定で変更できません。候補内の保存値は次回も使い、候補外なら共通設定の既定値（これも候補外なら `same`）を使います。モデルIDの手入力はありません。
- 最後に手動選択したモデルは、オンラインを `~/.aidiy/aidiy_code_model.json`、オフラインを `~/.aidiy/aidiy_code_model_offline.json` へ別々に保存します。起動引数・モード切り替えだけでは保存値を上書きしません。
- 自動切り替えでは表示中の会話を保ち、AIコアとHermesのセッションIDを別々に保持します。手動のモード切り替えでは新しい会話を開始します。前の会話は画面を開いている間「一覧」から戻せます。オンラインのAIコアセッションとオフラインのHermesセッションは共用しません。実行中の切り替えはできません。

直接指定する場合:

```powershell
aidiy_code --provider copilot_cli --model claude-sonnet-5.5
aidiy_code --provider aidiy_hermes --model openai_oauth/gpt-6-astra --browser
aidiy_code --offline --model openai_oauth/gpt-6.1-sol
```

引数なしの `aidiy_code` はオンラインで起動し、保存済みのオンラインモデルを使います。未保存なら `_config/AiDiy_key.json` の `CODE_AIDIY_HERMES_MODEL` を使い、AIコア接続前から表示します。`--offline` は保存済みのオフラインモデル、未保存なら同じHermes既定モデルを使います。共通設定が未配置・未指定の場合だけ `auto` を使います。画面で選択・保存した値は次回起動の初期値になり、明示したモデル起動引数がある場合はそちらを優先します。オンラインの `--provider copilot_cli` はAIコアのCopilot CLIを選択します。オフラインでは他のコードCLIは選べません。起動引数は共通の `frontend_ide/launch.mjs` から `server.mjs` へ渡し、CodeのAPIサーバーへ反映します。

共通の利用・検証方法は [Code README](../README.md) と [frontend_ide README](../../README.md) を参照してください。`launch.mjs` は `frontend_ide/launch.mjs` への互換入口で、専用ウィンドウは `frontend_ide/desktop.cjs`、Vue画面の配信は `frontend_ide/server.mjs` が担当します。このフォルダの `src/server.ts` はHTTP / SSEのCode APIを提供します。

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
