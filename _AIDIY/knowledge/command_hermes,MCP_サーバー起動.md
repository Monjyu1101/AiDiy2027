# command_hermes MCP サーバー起動

> 文書: `command_hermes,MCP_サーバー起動.md` | 実装: `command_hermes/base/mcp_serve.py`, `command_hermes/hermes_cli/mcp_config.py`

## このメモを使う場面

- Claude Code / Gemini / Codex などのコードエージェントから Hermes の会話機能を使わせたい
- `hermes mcp serve` の動作・提供ツールを確認する
- Code CLI の MCP 設定に `hermes` を追加する

## 概要

`command_hermes/hermes_main.py mcp serve` を実行すると command_hermes が **stdio MCP サーバー** として起動し、
コードエージェントがメッセージ送受信・会話管理ツールを直接呼び出せるようになる。

```
cd command_hermes
.venv/Scripts/python.exe hermes_main.py mcp serve
.venv/Scripts/python.exe hermes_main.py mcp serve -v  # stderr にログ
```

`_setup.py` が生成するランチャーは `aidiy_hermes`（対話/ワンショット用）です。別の `hermes` コマンドが PATH にあるとは限らず、上流版が起動することもあるため、登録はこのリポジトリの Python と `hermes_main.py` の絶対パスを使います。Linux / macOS は `.venv/bin/python` を使います。

## 提供ツール一覧

| ツール名 | 概要 |
|---------|------|
| `conversations_list` | 全プラットフォームの会話一覧を返す（platform / search フィルタ対応） |
| `conversation_get` | session_key で会話の詳細情報を取得する |
| `messages_read` | 会話のメッセージ履歴を読み込む（最新 N 件） |
| `attachments_fetch` | メッセージから画像・ファイル等の添付を抽出する |
| `events_poll` | カーソル以降の新着イベントを返す（ポーリング） |
| `events_wait` | 次のイベントまでブロックする（ロングポール、最大 5 分） |
| `messages_send` | `platform:chat_id` 形式のターゲットへメッセージを送信する |
| `channels_list` | 送信可能なチャネル一覧を返す（messages_send の target 候補） |
| `permissions_list_open` | 未処理の承認リクエスト一覧を返す |
| `permissions_respond` | 承認リクエストに `allow-once/allow-always/deny` で応答する |

EventBridge がバックグラウンドで `sessions.json` と `state.db` を 200ms 間隔でポーリングし、
新着メッセージをメモリキュー（最大 1000 件）に積む。ファイルの mtime が変わらない間はポーリングをスキップするため低負荷。

## ディスパッチの流れ

```
hermes mcp serve
  └─ main.py: cmd_mcp(args) → mcp_config.mcp_command(args)
       └─ action == "serve"
            └─ mcp_serve.run_mcp_server()
                 ├─ EventBridge.start()   # バックグラウンドポーリング開始
                 ├─ create_mcp_server()   # MCP SDK 2.x の MCPServer で 10 ツールを登録
                 └─ server.run_stdio_async()  # stdio トランスポートで待機
```

## Code CLI への登録方法

### Claude Code（グローバル設定）

```json
{
  "mcpServers": {
    "hermes": {
      "command": "C:/path/to/AiDiy2027/command_hermes/.venv/Scripts/python.exe",
      "args": ["C:/path/to/AiDiy2027/command_hermes/hermes_main.py", "mcp", "serve"]
    }
  }
}
```

または Claude Code の CLI で:

```powershell
claude mcp add -s user hermes -- "C:/path/to/AiDiy2027/command_hermes/.venv/Scripts/python.exe" "C:/path/to/AiDiy2027/command_hermes/hermes_main.py" mcp serve
```

### Claude Code（プロジェクト設定）

プロジェクトルートに `.mcp.json` を作成:

```json
{
  "mcpServers": {
    "hermes": {
      "command": "C:/path/to/AiDiy2027/command_hermes/.venv/Scripts/python.exe",
      "args": ["C:/path/to/AiDiy2027/command_hermes/hermes_main.py", "mcp", "serve"]
    }
  }
}
```

### 他の Code CLI

Gemini の `.gemini/settings.json`、Codex の `~/.codex/config.toml` でも同じ Python 絶対パスを `command` に、`hermes_main.py` の絶対パス・`mcp`・`serve` を `args` に指定します。設定形式は [Code CLI MCP 設定](./command_hermes,backend_tools,CodeCLI_MCP設定.md)を参照します。例の `C:/path/to/AiDiy2027` は実際の配置先へ置き換え、既存の別サーバー設定は保持します。

## 確認方法

### CLI での確認

```powershell
# Claude Code の場合
claude mcp list
# → hermes が表示されること

# ツール一覧確認
claude mcp get hermes
```

### 読み取り専用の登録確認

`command_hermes/base/mcp_serve.py` の `create_mcp_server()` 内の `@mcp.tool()` を確認します。SDK の非公開 `_tool_manager` に依存した一覧取得コードは使いません。実接続はクライアント側のツール一覧と許可された読み取り操作で別途確認します。

## 注意点

- `mcp>=2,<3` パッケージが必要。インストールなしで起動しようとすると ImportError で停止する。
- MCP サーバーは `MCPServer` を `mcp.server` から import する。MCP 1.x の `mcp.server.fastmcp.FastMCP` は使わない。
- `hermes mcp serve` は stdio サーバーなので Code CLI が子プロセスとして起動する。プロセスが落ちると接続も切れる。
- `EventBridge` は `SessionDB` が起動時に利用可能でないとポーリングを無効化してメッセージイベントが届かなくなる。対象のセッションDBや連携 Gateway の状態も確認すること。起動だけでは対象プラットフォームへの送受信を保証しない。
- `hermes mcp serve` は Hermes が **クライアントとして** AiDiy MCP に接続するフロー（`mcp_tool.py`）とは別の独立した機能。混同しないこと（→ SSE 接続は [`command_hermes,backend_tools,MCP_SSE接続.md`](./command_hermes,backend_tools,MCP_SSE接続.md) 参照）。
