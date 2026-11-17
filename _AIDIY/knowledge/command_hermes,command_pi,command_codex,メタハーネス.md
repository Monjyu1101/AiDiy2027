# Hermes / Pi / Codex の外部 CLI chat / passthrough

モデルを `copilot_cli/same` のように選ぶと、親ハーネスが子CLIを利用する。Hermes / Pi / 新しいCodexソースでは `--cli chat` が既定、`--cli passthrough` で旧委譲方式へいつでも戻せる。APIモデルにはこの切替は影響しない。対応区分は `claude_cli`、`antigravity_cli`、`codex_cli`、`copilot_cli`、`opencode_cli`、`grok_cli`。`same` は子のモデルを変更せず、OpenCode の `openai/gpt-6-luna` のような階層付きモデル名は保持する。


## Hermes / Pi / Codex の chat（既定）と passthrough（旧方式）

- `--cli chat` / 指定なし: 親が会話・system・知識・tools・承認を所有し、子は推論だけを行う。構造化されたツール要求を親へ返し、親の通常ループで実行する。ファイル操作も親側で実施する。
- `--cli passthrough`: 既存方式。子CLI自身がツールを実行して最終回答を返す。
- 切替は起動オプションのみ。旧実装・旧CLIモデル候補は削除しない。未知の値はエラー。chatに未対応の子CLIを選んでも勝手にpassthroughへ切り替えない。

chatの子エンジンは現在 `claude_cli`（CLIのJSON Schema出力）と `copilot_cli`（通常のCopilot CLIをstdin/stdoutで呼出し）が対象。`codex_cli` は後述の専用版が必要。`antigravity_cli` / `opencode_cli` / `grok_cli` は推論専用実行を検証できていないため明示エラー。これらを使う場合は `--cli passthrough` を指定する。外側はHermes / Pi / Codexのソースにchat接続を実装している。Codexは再コンパイルが必要で、旧バイナリには反映されない。この「外側ハーネス」と「内側CLI」の対応は別物。

### Codexの専用推論入口

`codex_cli` のchatは、通常の外部 `codex` ではなく `~/.aidiy/bin/aidiy_codex(.exe)` の `exec --aidiy-inference-only` を使う。専用版への再コンパイルが必要。旧バイナリは未知オプションで停止し、外部Codexやpassthroughへ降格しない。通常のpassthroughは従来の外部CLIのまま。

既存の `~/.codex`（または `CODEX_HOME`）認証経路を使用し、秘密情報を一時フォルダへコピーしない。ユーザー設定・rules・プロジェクト設定からの自動実行を避け、新しい一時セッションに親の正規会話を毎回渡す。親側の知識・履歴・ツール結果が会話の正本で、子セッションはresumeしない。`same` / `auto` は隔離したCodex既定モデルとなり、ユーザーconfig内の既定モデルは読まない。モデルを固定したい場合は明示する。

Codexのstrict構造化応答に合わせ、transport上のみツール引数はJSON文字列とする。Pythonでobjectへ復元し、他エンジンと同じ親schemaで名前・引数を検証する。自然文のツール要求は実行しない。

検証にはRust専用入口の試験と共通Python試験の両方が必要。Python mock成功だけで新バイナリの実行や実認証推論を確認した扱いにしない。

### 未対応エンジンと障害の区別

「内側CLIのchat接続未対応」は外側Hermes/Pi/Codexの知識・ツール機構の不存在を意味しない。対応エンジンへ切り替えるか通常APIモデルを使う。旧方式の `passthrough` は子自身が処理する別方式で、chat障害時に自動選択しない。

- 外部Codexの `exec --output-schema` は最終応答形式だけを制約する。`read-only` は読取ツールを残すため推論専用ではない。内部の空 `ToolPolicy.allowed_tools` は全ツールを止められるが、現行の公開exec/app-server設定から指定できない。
- Grokのtools許可リストだけではMCP meta-toolsが残る。Antigravityの構造化出力だけでは別ファイルからのhooks等を止められない。OpenCodeの共有サーバー接続も、個別プロセスへ渡した設定だけで隔離できたと判断しない。
- Claudeの異常終了はCLI版・認証・通信・モデルの分類と終了コードを返す。子の生stderrは会話・秘密情報を含み得るため返さない。分類は診断補助であり、原因を確定するものではない。

ツール定義・会話・結果IDをJSONで渡し、応答は `{content, tool_calls:[{name, arguments}]}` の厳密なJSON。通常文章を正規表現でツール要求へ変換しない。子のファイル/シェル/MCP等は無効で、登録ツール名・引数schemaを共通入口で検証してから親形式へ変換する。呼出IDは共通入口が発行し、次の結果と対応付ける。画像・音声等は現状未対応で、捨てずにエラーにする。

Hermesの通常ループを通すためsystem/contextとメモリ・skills等の組立て、およびツール結果はそのままmessagesとして渡す。主会話・文脈圧縮・自動タイトル生成は同じCLIエンジンを使う。タイトルはagent専用callbackを背景スレッドへ渡し、別の補助APIを解決しない。失敗時はAPIへ切り替えず、入力から導出したタイトルを維持する。通常APIモードのタイトル生成経路は変更しない。回帰試験は `command_hermes/checks/test_cli_chat_title.py`。検索・ファイル操作等は親の許可されたツールとして実行される。ただし独自APIクライアントを直接生成する拡張機能までCLI経由へ自動変換するものではない。独立エージェント/補助機能の対応は別途検証する。

### Copilotの直接stdioチャット

Copilot chat はSDKを使わず、PATH上の通常の `copilot` を非TTYのstdin/stdoutで呼ぶ。親の会話・system・ツール定義・ツール結果をstdinへ渡し、`--silent --stream=off --output-format=text` の応答を受ける。親用の `{content, tool_calls:[{name, arguments}]}` JSONをプロンプトで指定するが、SDKのresponse_schemaやプロバイダのstrict schemaは要求しない。JSON以外や未知ツール、不正な引数は拒否し、自然文から実行命令を拾わない。

`--excluded-tools=builtin:*,mcp:*,custom:*` で子モデルの全ツール種別を除外する。`--deny-tool=shell,read,write,url,memory` も指定。空の `--available-tools` や単独の `--excluded-tools=*` はCLI 1.0.112でツールを消さないため代用しない。プロジェクトと別の一時作業フォルダで、custom instructions、built-in MCP、computer-use、実験機能、自動更新、セッション同期を無効にして起動する。親の自動承認・リポジトリhooks/拡張opt-in環境も引き継がない。

認証は通常CLI自身が行う。`COPILOT_HOME`やkeychainを隠さず、トークンを抽出・コピーしない。独立した新規起動ごとに正規の会話履歴を渡しresumeしない。これは丸投げpassthroughではなく、ファイル操作等は親が行う。CLI自身の認証更新・キャッシュ・ローカルセッション保存や、ユーザー/管理者が導入したグローバル拡張の起動処理まで禁止するOS隔離ではない。

共通PythonプロトコルをHermes/Pi/Codexが使用するため、このCopilot経路の変更は3ハーネスに共通。既にchatプロトコルを搭載したCodexバイナリなら今回のPython修正だけで反映する。古いバイナリへのchat機能追加は別途再コンパイルが必要。

必要なのは通常のCopilot CLIとそのログイン。PythonのCopilot SDK依存は不要。CLI非対応オプション・認証・通信・モデルの失敗は生stderrを出さず固定文面と終了コードで返す。自動で権限を緩めたりpassthroughへ切り替えたりしない。

検証は `backend_tools/checks/test_harness_copilot_chat.py` と、公式CLI実行ファイルを `AIDIY_TEST_COPILOT` に指定する `test_harness_copilot_stdio.py`。後者はローカル疑似APIで挨拶→親のtool call→tool result→報告と、子APIへ送られるtoolsが0個であることを検証する。GitHubへの認証済み実推論やWindows実機試験を代替しない。公式仕様: https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference

```powershell
aidiy_hermes --cli chat --model copilot_cli/same
aidiy_pi --cli chat --model copilot_cli/same
# 旧方式へ戻す
aidiy_hermes --cli passthrough --model codex_cli/gpt-6-luna
aidiy_pi --cli passthrough --model codex_cli/gpt-6-luna
```

検証: `backend_tools/checks/test_harness_chat.py`（入力・schema・不正呼出・旧方式への非降格）、各ハーネスのchat adapter試験。mockの往復成功は実認証付きCLIの精度評価ではない。実運用導入時は同じ課題でAPI・chat・passthroughの結果、ツール実行数、所要時間を比較する。

共通JSON入口の `cli_mode` 未指定は、現行Codexバイナリとの互換性のためpassthrough。Hermes / Pi / 新しいCodexソースは起動オプション未指定時にも明示的にchatを送る。

## 共通の実行経路（passthrough）

`backend_tools/tools_proc/harness_cli.py` が JSON 要求を受け、既存 CodeAI を呼び出す。HTTP サーバーや DB は起動しない。要求は `provider` / `model` / `project` / `prompt` / `mode` / `cli_mode`、応答は JSONL の `progress` と `result`。

各ターンに親の会話を渡し、子の別セッションを resume しない。認証とツール実行は子 CLI が担当する。`process_lifetime.py` で親終了時の子孫を回収する。実行には backend_tools または backend_server の Python venv が必要。

Pi / Hermes / Codex → 共通アダプターは JSON を UTF-8 stdin で渡す。共通 CodeAI → `codex_cli` / `aidiy_codex` も `exec ... -`（継続時は `resume <id> -`）と stdin を使い、会話全文をコマンド引数へ載せない。初回・継続・read-only・モデル再選択後の再実行で同じ経路を使う。これにより Windows のコマンド長上限（WinError 206）を避け、改行・引用符を維持する。

`aidiy_codex` の通常モデルが使う Code Mode ホストは本体と同じ版を配置する。Windows では `_compile.py` が公式 npm 配布物の SHA-512 を検証して `~/.aidiy/bin/codex-code-mode-host.exe` を配置する。Windows の read-only 実機試験は共通 CodeAI と同じ `-c features.prefer_mxc=true` を使う。MXC 非対応環境では権限を広げず、元の sandbox 制約を維持する。

## 権限モードの同期（passthrough）

| 親 | 子に渡す状態 |
|---|---|
| Hermes `--yolo` / セッションの `/yolo` ON | `yolo` |
| Hermes YOLO OFF | `normal`（自動承認フラグなし） |
| Hermes `--read-only` / 読取専用予測入口 | `read-only` |
| Pi 標準 / `--yolo` | `yolo`（Pi 標準は確認なし） |
| Pi `--read-only` | `read-only` |
| Codex 全アクセス + approval never | `yolo` |
| Codex 全アクセス + その他の承認方式 | `normal` |
| Codex read-only | `read-only` |

read-only は YOLO より優先する。`code_permissions=none` は通常承認であり、read-only と同義ではない。Codex の workspace-write や独自の sandbox 制約は汎用 CLI へ同等変換できないため停止する。

read-only はモデルのツール操作を制限する。CLI 自身の認証更新・キャッシュ・履歴まで OS の書込み禁止にするものではない。

Pi の read-only 説明は、Pi 内のシェル禁止と、委譲先 CLI の read-only sandbox 内での読み取りを区別する。Pi の `tool_call` / `user_bash` 制限は維持する。Codex のように読み取りもコマンドで行う子 CLI に「Pi 内のシェル禁止」を誤適用させず、書込み禁止・権限昇格禁止は両方に適用する。

| 子 CLI | read-only の制約 |
|---|---|
| Codex CLI | read-only sandbox、承認 never、MCP の検出・無効化・再検証、フック等無効 |
| Claude CLI | Read / Glob / Grep のみ、MCP・プラグイン・フック等を制限 |
| Copilot CLI | view / grep / glob のみ、write / shell / 組込み MCP を禁止 |
| Grok CLI | read_file / grep / list_dir のみ、サブエージェント・MCP メタツール等を禁止 |
| Antigravity CLI | セッション限定 `--settings` で書込み・command・MCP・Web 操作を deny、plan モード |
| OpenCode V2 | 私有サーバー `--standalone` に `OPENCODE_CONFIG_CONTENT` を渡し、policy で読取・検索以外のツールと MCP / plugin / skill を禁止 |

Antigravity の deny は通常許可より優先する。設定ファイルへは保存しない。[公式の権限仕様](https://antigravity.google/docs/permissions?tab=cli)、[CLI 設定仕様](https://antigravity.google/docs/cli/reference) を参照。

OpenCode V2 の policy は agent の許可・過去の承認より優先する。V1 の `permission` / `bash` とは仕様が異なる。[公式の permissions](https://opencode.ai/docs/permissions/)、[policies](https://opencode.ai/docs/policies/) を参照。

## 起動と検証

```powershell
aidiy_hermes --cli passthrough --read-only --model codex_cli/gpt-6-luna -z "ソースを確認して要点を教えて"
aidiy_pi --cli passthrough --read-only --no-session --model codex_cli/gpt-6-luna -p "ソースを確認して要点を教えて"
aidiy_codex exec --sandbox read-only -m codex_cli/gpt-6-luna "ソースを確認して要点を教えて"
```

Codex の `/model` は現在の API 候補に Diag の CLI 候補を追加する。API → CLI と CLI 間を切替可能。CLI から開始した会話で API に移る場合は新しい会話を開始する。Codex の画像・音声・構造化出力・CLI モデルでの `/compact` は未対応。

単体検証は `backend_tools/checks/test_harness_cli.py`、`backend_server/checks/test_prediction_cli_readonly.py`、`test_prediction_hermes_adapter.py` を使う。実機試験では専用の一時フォルダに識別文字列を置き、子の読取結果・進捗イベント・終了コード・フォルダの変更有無を確認する。モデルが文章で「read-only」と回答するだけでは制限の検証にならないため、実引数と設定も確認する。

Codex の Rust 変更は再コンパイルが必要。既存コンパイル中に編集した場合、今回の変更が含まれたと扱わず、終了後に再検証・再ビルドする。
