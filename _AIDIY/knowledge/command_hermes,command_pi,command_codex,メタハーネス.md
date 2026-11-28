# Hermes / Pi / Codex の外部CLIへの委譲

`copilot_cli/same` のような外部CLIモデルを選ぶと、外部CLIに依頼全体を渡すパススルーで動作する。外部CLIの認証・ファイル操作・ツール実行は子CLI側が担当する。親が子を推論専用のチャットエンジンとして扱う機能と、方式を切り替える起動オプションは廃止した。通常のAPI / OAuthモデルの動作は変わらない。

対象は `claude_cli`、`antigravity_cli`、`agy_cli`、`codex_cli`、`copilot_cli`、`opencode_cli`、`grok_cli`。`same` は子のモデル指定を省略し、`openai/gpt-6-luna` のような階層付きモデルIDは保持する。`codex_cli` は通常の `codex` を起動し、`aidiy_codex` には委譲しない。

## 共通の実行経路

`backend_tools/tools_proc/harness_cli.py` が JSON 要求を受け、既存 CodeAI を呼び出す。HTTP サーバーや DB は起動しない。要求は `provider` / `model` / `project` / `prompt` / `mode`、応答は JSONL の `progress` と `result`。

各ターンに親の会話を渡し、子の別セッションを resume しない。認証とツール実行は子 CLI が担当する。`process_lifetime.py` で親終了時の子孫を回収する。実行には backend_tools または backend_server の Python venv が必要。

Pi / Hermes / Codex → 共通アダプターは JSON を UTF-8 stdin で渡す。共通 CodeAI → `codex_cli` / `aidiy_codex` も `exec ... -`（継続時は `resume <id> -`）と stdin を使い、会話全文をコマンド引数へ載せない。初回・継続・read-only・モデル再選択後の再実行で同じ経路を使う。これにより Windows のコマンド長上限（WinError 206）を避け、改行・引用符を維持する。

`aidiy_codex` の通常モデルが使う Code Mode ホストは本体と同じ版を配置する。Windows では `_compile.py` が公式 npm 配布物の SHA-512 を検証して `~/.aidiy/bin/codex-code-mode-host.exe` を配置する。Windows の read-only 実機試験は共通 CodeAI と同じ `-c features.prefer_mxc=true` を使う。MXC 非対応環境では権限を広げず、元の sandbox 制約を維持する。

## 権限モードの同期

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
aidiy_hermes --read-only --model codex_cli/gpt-6-luna -z "ソースを確認して要点を教えて"
aidiy_pi --read-only --no-session --model codex_cli/gpt-6-luna -p "ソースを確認して要点を教えて"
aidiy_codex exec --sandbox read-only -m codex_cli/gpt-6-luna "ソースを確認して要点を教えて"
```

Codex の `/model` は現在の API 候補に Diag の CLI 候補を追加する。API → CLI と CLI 間を切替可能。CLI から開始した会話で API に移る場合は新しい会話を開始する。Codex の画像・音声・構造化出力・CLI モデルでの `/compact` は未対応。

単体検証は `backend_tools/checks/test_harness_cli.py`、`backend_server/checks/test_prediction_cli_readonly.py`、`test_prediction_hermes_adapter.py` を使う。実機試験では専用の一時フォルダに識別文字列を置き、子の読取結果・進捗イベント・終了コード・フォルダの変更有無を確認する。モデルが文章で「read-only」と回答するだけでは制限の検証にならないため、実引数と設定も確認する。

Codex の Rust 変更は再コンパイルが必要。既存コンパイル中に編集した場合、今回の変更が含まれたと扱わず、終了後に再検証・再ビルドする。
