# Code CLI の MCP 設定

> 文書: `command_hermes,backend_tools,CodeCLI_MCP設定.md` | 実装: `backend_tools/_setup.py`, `backend_tools/tools_main.py`, `backend_tools/mcp_stdio.py`

## このメモを使う場面
- Claude / Gemini / Codex / Antigravity などの Code CLI から AiDiy MCP を使わせる
- CLI ごとの MCP 設定ファイルの場所を確認する
- `backend_tools` の SSE MCP を stdio クライアントへ接続する

## 設定場所

| CLI | 主な設定場所 | 備考 |
|-----|-------------|------|
| Claude | `~\.claude.json`、または project `.mcp.json` | `claude mcp add -s project` は `.mcp.json` を作る |
| Gemini | project `.gemini/settings.json` | BOM なし UTF-8 で保存する |
| Antigravity | `~\.gemini\config\mcp_config.json` | Streamable HTTP の `/{mcp_name}/mcp` を `serverUrl` で登録する |
| Codex | `~\.codex\config.toml` | Streamable HTTP の `/{mcp_name}/mcp` を `url` で登録する |
| Grok | `~\.grok\config.toml` | ネイティブ SSE（`type = "sse"`）。stdio ブリッジは使わない |
| Copilot | `~\.copilot\mcp-config.json` | `_setup.py` / `_cleanup.py` の対象 |
| OpenCode | `~\.config\opencode\opencode.json` | 公式 docs では `mcp` キー配下。`.opencode/` は agents / commands / plugins などのディレクトリ用途 |

## 関連ファイル
- `.mcp.json`
- `.gemini/settings.json`
- `.gitignore`
- `_setup.py`
- `backend_tools/_setup.py`
- `_cleanup.py`
- `scripts/cli_bat/_claude-code.bat`
- `scripts/cli_bat/_codex_cli.bat`
- `backend_tools/mcp_stdio.py`
- `~\.codex\config.toml`
- `~\.grok\config.toml`
- `~\.gemini\config\mcp_config.json`

## Grok へ SSE で直接登録する設定

Grok Build CLI（`grok`）は `~/.grok/config.toml` へ `type = "sse"` で直接書きます。`url` だけだと streamable HTTP 扱いになるので、`type` を省略しない。

Grok の `type=sse` は GET `/sse` のあと、同じ URL へ Streamable HTTP の `initialize` を POST する。サーバー側は GET を従来 SSE、POST/DELETE を Streamable HTTP として扱う。`grok mcp doctor <name>` で handshake が通ることを確認する。

### Grok の設定例 (config.toml)
```toml
[mcp_servers.aidiy_chrome_devtools]
url = "http://127.0.0.1:8095/aidiy_chrome_devtools/sse"
type = "sse"
enabled = true
```

`grok mcp add --transport sse <name> <sse-url>` でも同じ内容になる。`~/.claude.json` も読むが、同名は `~/.grok/config.toml` が優先する。

## Codex から Streamable HTTP で直接接続する設定

Codex CLI は stdio と Streamable HTTP に対応する。AiDiy のセットアップでは `/{mcp_name}/mcp` へ直接接続する設定を生成する。

### Codex の設定例 (config.toml)
```toml
[mcp_servers.aidiy_chrome_devtools]
url = "http://127.0.0.1:8095/aidiy_chrome_devtools/mcp"
startup_timeout_sec = 60
```

`backend_tools/_setup.py` の `upsert_codex_backend_tools_config()` は、共通定義の `sse_url` 末尾を `/sse` から `/mcp` へ変換する。既存の同名テーブルを置き換えるため、旧 stdio 設定の `command` / `args` も除去される。Codex 用の設定生成自体は Python 仮想環境や `mcp_stdio.py` の存在に依存しない。

登録対象と除外対象は同ファイルの `MCP_MODULES` / `CODE_CLI_MCP_EXCLUDE` に従う。接続時は `backend_tools` を起動し、設定変更後は Codex を再起動する。

## Antigravity から Streamable HTTP で直接接続する設定

Antigravity CLI は `~/.gemini/config/mcp_config.json` の `mcpServers` に HTTP 接続先を登録する。AiDiy のセットアップでは Codex と同じ `/mcp` へ直接接続する。

### Antigravity の設定例 (mcp_config.json)
```json
{
  "mcpServers": {
    "aidiy_chrome_devtools": {
      "serverUrl": "http://127.0.0.1:8095/aidiy_chrome_devtools/mcp"
    }
  }
}
```

登録対象は Codex と共通の `CODE_CLI_MCP_EXCLUDE` に従う。同名の旧 stdio 設定があれば `command` / `args` / `env` / `cwd` と旧形式の `type` / `url` / `httpUrl` を除去し、`serverUrl` を更新する。他のサーバーや接続方式に関係しない設定は保持する。設定生成自体は Python 仮想環境や `mcp_stdio.py` に依存しない。

旧設定先 `~/.gemini/antigravity-cli/mcp_config.json` への新規書き込みは行わない。cleanup は新旧両方の設定先から `aidiy_*` を解除する。`mcp_stdio.py` は stdio 接続を選ぶ別クライアント向けに残す。

### Antigravity の接続と権限の切り分け

```powershell
agy --version
agy mcp list
```

`agy mcp list` の `TYPE` が `http`、接続先が `http://127.0.0.1:8095/<名前>/mcp` であることを確認する。これは設定の読み込み確認なので、実接続は `agy` から対象 MCP ツールを呼び出して確かめる。

通知音で確認する場合は、`aidiy_notification_sounds.play_notification_sound` に `notification_type="完了", scene="plane"` を指定して 1 回呼び出す。CLI のツール結果と backend_tools のログを照合し、`status: ok` と再生記録を確認する。

非対話の `agy --print` は、確認が必要なツールを実行できずに終了する場合がある。これは HTTP の接続失敗とは分けて扱う。依頼された通知音だけを許可する場合は、権限設定 `~/.gemini/antigravity-cli/settings.json` の `permissions.allow` に `mcp(aidiy_notification_sounds/play_notification_sound)` を指定できる。テストのために追加した許可は検証後に取り除き、既存の権限設定は保持する。MCP 設定と権限設定ではディレクトリが異なる点に注意する。

## セットアップ/クリーンアップの方針

- `python _setup.py` は必要に応じて Claude / Gemini / Copilot / OpenCode / Codex / Grok / Antigravity 用 MCP 設定を生成する
- `python _cleanup.py` は AiDiy が追加した MCP 設定を削除する
- `.claude/` と `.gemini/` は CLI がローカルで更新するため、project 配下に置く場合は `.gitignore` に入れる
- Decisions / FFmpegなどの起動チェック結果にかかわらず、外部設定にMCP接続先を登録する。利用不可は接続後の `initialize.instructions` と診断ツールで伝え、実行ツールだけを非公開にする。

## Windows の注意点

- `scripts/cli_bat/*.bat` では `.cmd` を `start` で直接起動せず、`call "%USERPROFILE%\\AppData\\Roaming\\npm\\*.cmd"` で実行する
- `codex.cmd -c "mcp_servers...='http://...'"` のような起動引数は引用符崩れが起きやすい。永続設定は `config.toml` を優先する
- Gemini の `settings.json` は BOM 付き UTF-8 だと `Unexpected token` で起動失敗する。先頭バイトが `EF BB BF` なら BOM なし UTF-8 で保存し直す

## 注意点

- Claude のグローバル設定に旧 `chrome-devtools` が残ると `claude mcp list` で失敗表示になる。現行は `aidiy_chrome_devtools`
- OpenCode の公式なグローバル設定は `~/.config/opencode/opencode.json`。`.opencode/` は project / home 配下で agents、commands、plugins などを置く用途
- `scripts/cli_bat/_claude-code.bat` は `--mcp-config` を付けず、グローバル設定を使う前提
- Codex や Antigravity から AiDiy MCP へつなぐ場合は、`backend_tools` が起動済みであることを先に確認する。どちらも Streamable HTTP を使う
- ローカル CLI 設定はユーザー環境依存なので、project の同期対象へ入れない

## 確認方法

```powershell
claude mcp list
gemini mcp list
codex mcp list
agy mcp list
grok mcp list
grok inspect
python _setup.py
python _cleanup.py
```

`_setup.py` 実行後は、次を確認する。

- `.gitignore` に `.claude/` と `.gemini/` が含まれること。
- Codex の各 `aidiy_*` が `url = "http://127.0.0.1:8095/<名前>/mcp"` と `startup_timeout_sec = 60` を持ち、旧 `command` / `args` が残らないこと。`codex mcp list --json` の `transport.type` は `streamable_http` になる。
- Antigravity の各 `aidiy_*` が `serverUrl: "http://127.0.0.1:8095/<名前>/mcp"` を持ち、旧 `command` / `args` が残らないこと。`agy mcp list` の TYPE は `http` になる。
- Grok は各 `aidiy_*` に `type = "sse"` があり、`grok mcp list` にサーバーが出ること。

`codex mcp list` は設定の読み込み確認であり、ツール実行の疎通確認とは分ける。実接続は Codex から対象 MCP のツールを呼び出して確認する。非対話の `codex exec` で承認が必要なツールが `approval policy is never` により止まる場合は、依頼済みの操作を承認審査に回せる `--approve-for-me` を使う。これは接続エラーではない。

## Antigravity の仕様参照先

- [MCP 設定](https://antigravity.google/docs/mcp/)
- [非対話モードと権限](https://antigravity.google/docs/cli/headless/)
- [権限ルール](https://antigravity.google/docs/permissions/)
