# Hermes / Pi / Codex の外部 CLI chat / passthrough

モデルを `copilot_cli/same` のように選ぶと、親ハーネスが子CLIを利用する。Hermes / Pi では `--cli chat` が既定、`--cli passthrough` で旧委譲方式へいつでも戻せる。APIモデルにはこの切替は影響しない。対応区分は `claude_cli`、`antigravity_cli`、`codex_cli`、`copilot_cli`、`opencode_cli`、`grok_cli`。`same` は子のモデルを変更せず、OpenCode の `openai/gpt-6-luna` のような階層付きモデル名は保持する。


## Hermes / Pi の chat（既定）と passthrough（旧方式）

- `--cli chat` / 指定なし: 親が会話・system・知識・tools・承認を所有し、子は推論だけを行う。構造化されたツール要求を親へ返し、親の通常ループで実行する。ファイル操作も親側で実施する。
- `--cli passthrough`: 既存方式。子CLI自身がツールを実行して最終回答を返す。
- 切替は起動オプションのみ。旧実装・旧CLIモデル候補は削除しない。未知の値はエラー。chatに未対応の子CLIを選んでも勝手にpassthroughへ切り替えない。

chatの子エンジンは現在 `claude_cli`（CLIのJSON Schema出力）と `copilot_cli`（公式Python SDKのempty modeと構造化応答）が対象。`codex_cli` / `antigravity_cli` / `opencode_cli` / `grok_cli` は推論専用実行を検証できていないため明示エラー。これらを使う場合は `--cli passthrough` を指定する。外側は今回Hermes / Piのみ対応。Codex外側の変更は検証後に別途提供し、現行Codexは従来の委譲方式を維持する。この「外側ハーネス」と「内側CLI」の対応は別物。

ツール定義・会話・結果IDをJSONで渡し、応答は `{content, tool_calls:[{name, arguments}]}` の厳密なJSON。通常文章を正規表現でツール要求へ変換しない。子のファイル/シェル/MCP等は無効で、登録ツール名・引数schemaを共通入口で検証してから親形式へ変換する。呼出IDは共通入口が発行し、次の結果と対応付ける。画像・音声等は現状未対応で、捨てずにエラーにする。

Hermesの通常ループを通すためsystem/contextとメモリ・skills等の組立て、およびツール結果はそのままmessagesとして渡す。主会話と文脈圧縮は同じCLIエンジンを使う。検索・ファイル操作等は親の許可されたツールとして実行される。ただし独自APIクライアントを直接生成する拡張機能までCLI経由へ自動変換するものではない。独立エージェント/補助機能の対応は別途検証する。

必要依存はbackend_tools/backend_serverのsetupで入れる。Copilotは公式SDKが対応runtimeを用意するため初回取得と既存の認証が必要。Claudeは上記の安全オプションに対応するCLIが必要で、古い版や認証失敗では停止し権限を緩めない。推論専用はCLIの認証・キャッシュ等の内部状態の書込み禁止を意味しない。

```powershell
aidiy_hermes --cli chat --model copilot_cli/same
aidiy_pi --cli chat --model copilot_cli/same
# 旧方式へ戻す
aidiy_hermes --cli passthrough --model codex_cli/gpt-6-luna
aidiy_pi --cli passthrough --model codex_cli/gpt-6-luna
```

検証: `backend_tools/checks/test_harness_chat.py`（入力・schema・不正呼出・旧方式への非降格）、各ハーネスのchat adapter試験。mockの往復成功は実認証付きCLIの精度評価ではない。実運用導入時は同じ課題でAPI・chat・passthroughの結果、ツール実行数、所要時間を比較する。

共通JSON入口の `cli_mode` 未指定は、現行Codexバイナリとの互換性のためpassthrough。Hermes / Piは起動オプション未指定時にも明示的にchatを送る。

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
