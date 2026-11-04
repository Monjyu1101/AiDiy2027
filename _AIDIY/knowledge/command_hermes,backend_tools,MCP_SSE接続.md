# command_hermes の MCP 接続と切り分け

> 文書: `command_hermes,backend_tools,MCP_SSE接続.md` | 実装: `command_hermes/tools/mcp_tool.py`, `command_hermes/cli_main.py`, `command_hermes/hermes_cli/tools_config.py`

## このメモを使う場面

- Hermes から AiDiy MCP に接続できない、バナーに出ない、モデルへツールが届かない
- upstream 取り込み後に設定のマージ・transport・discovery を確認する

Hermes が **クライアントとして** backend_tools へ接続する手順です。Hermes 自体の stdio サーバーは [MCP サーバー起動](./command_hermes,MCP_サーバー起動.md)、他の CLI への登録は [Code CLI MCP 設定](./command_hermes,backend_tools,CodeCLI_MCP設定.md)を参照します。

## 設定と実装の入口

1. `_load_aidiy_mcp_servers()` が `_config/AiDiy_mcp.json` の `mcpServers` を読む。URL のある設定を取り込み、未指定の `type` に `sse` を補う。
2. `_load_mcp_config()` が Hermes の `config.yaml` と合流する。同名は Hermes 側の設定が優先する。`HERMES_SAFE_MODE` では空になる。
3. `discover_mcp_tools()` → `register_mcp_servers()` → `_connect_server()` が接続し、`_register_server_tools()` が toolset に登録する。
4. `cli_main.py` の `main()` は toolset 解決前に discovery を呼ぶ。対話だけでなく単発要求・一覧表示にも必要であり、`cli.run()` 直前だけへ移さない。

## SSE と Streamable HTTP を混同しない

現行 `MCPServerTask._is_http()` は URL の有無を判定し、`_run_http()` 内の **`transport == "sse"`** で SSE 分岐へ入ります。旧版の `_is_sse()` / `_run_sse()` メソッドは存在しません。

一方、AiDiy 設定の loader は `type: sse` を補い、`get_mcp_status()` の表示も `type` を見ます。**表示が sse でも実際に SSE 分岐を通ったとは限りません。** 接続失敗時は loader の出力・同名上書き・`transport`・URL を照合します。秘密を含む headers / env はログへ出しません。

SSE を明示する Hermes 側の設定例（`config.yaml`、必要な対象だけ）:

```yaml
mcp_servers:
  aidiy_chrome_devtools:
    url: http://127.0.0.1:8095/aidiy_chrome_devtools/sse
    transport: sse
```

Streamable HTTP を使う場合は `/mcp` の URL と HTTP transport を対応させます。`backend_tools` はローカルの 8095 で起動しておきます。`type` / `transport` の不一致を旧メソッドの再追加だけで解決しようとせず、現行の認証・再接続・プロトコル交渉を維持します。

## 確認方法

Windows PowerShell（Linux / macOS は `.venv/bin/python`）:

```powershell
Set-Location command_hermes
.venv\Scripts\python.exe cli_main.py --list-tools
aidiy_hermes
```

- バナーの名前・状態と、実際に列挙されたツールを照合する。無効化済み、未起動、失敗を区別する。
- サーバー数・ツール数を固定値で判定しない。OS、設定、有効機能、接続結果により変わる。対象の現行設定と `backend_tools/tools_main.py` を同期元にする。
- `hermes_cli/tools_config.py` の `enabled_mcp_server_names()` とバナーの cheap probe も AiDiy 設定を取り込んでいるか確認する。
- 接続済みでも toolset の絞り込みや `tools.tool_search` によりモデルへ渡す形式が変わる。一覧表示と、許可された対象ツールの実呼び出しを別々に確認する。
- SSE の SDK import は遅延初期化される。依存解決と `mcp.client.sse` の可用性を確認し、旧 `_MCP_SSE_AVAILABLE` フラグを前提にしない。
- discovery には接続待ちがあり、短時間で返らないだけでは停止と判定しない。失敗内容は stderr / ログで確認する。
