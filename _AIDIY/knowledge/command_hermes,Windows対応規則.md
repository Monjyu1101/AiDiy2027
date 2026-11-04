# Windows 対応規則（aidiy_hermes）

> 文書: `command_hermes,Windows対応規則.md` | 実装: `command_hermes/cli_main.py`, `backend_server/AIコア/AIコード_cli.py`, `command_hermes/tools/environments/local.py`, `command_hermes/tools/environments/base.py`, `command_hermes/tools/file_operations.py`, `command_hermes/tools/file_tools.py`, `command_hermes/tools/terminal_tool.py`, `command_hermes/tools/process_registry.py`, `command_hermes/tools/daemon_pool.py`

## このメモを使う場面

- aidiy_hermes の terminal / file 操作系コードへ修正を入れるとき
- Windows ネイティブ実行で `[exit -1]`、タイムアウト、パス解決エラーが出たとき
- upstream `hermes-agent` の新版を取り込むとき

## 長文プロンプトと WinError 206

`[WinError 206] ファイル名または拡張子が長すぎます` は、実ファイル名だけでなく、Windows `CreateProcess` のコマンドライン全体が約 32,767 文字の上限を超えた場合にも発生します。`.cmd` を避けて Python と `cli_main.py` を直接起動しても、この `CreateProcess` の上限は残ります。

AiDiy の Code AI 連携では、長さにかかわらず完全プロンプトを argv へ入れません。`backend_server/AIコア/AIコード_cli.py` が `aidiy_hermes -Q --oneshot-stdin` を起動し、本文を UTF-8 の標準入力で渡します。stdin 送信は stdout / stderr 監視と並行実行し、双方向パイプのデッドロックを避けます。

手動実行用の `aidiy_hermes -Q -z "本文"` は互換性のため維持します。ただし、長文を自動連携する実装では `-z` に本文を渡さず、`--oneshot-stdin` を使います。

## 前提: Windows 対応は upstream 本体が持つ

`command_hermes` は upstream `hermes-agent` 0.21 系を取り込んでおり、**Windows ネイティブ実行は upstream 本体が対応済み**です。
0.12 系で AiDiy が独自に持っていた `*_win.py` / `*_linux.py` の platform selector 層は **廃止しました**。
`file_operations.py`、`file_tools.py`、`terminal_tool.py`、`process_registry.py` は upstream のまま単一実装です。

**新たに `*_win.py` / `*_linux.py` を作らないでください。** upstream 追従が不可能になります。

## upstream 側の Windows 実装

| 項目 | 実装 |
|------|------|
| 判定フラグ | `tools/environments/local.py` の `_IS_WINDOWS = platform.system() == "Windows"` |
| shell 選択 | `_find_shell()` → Windows では Git Bash（`bash.exe`）。`HERMES_GIT_BASH_PATH` → PortableGit（`%LOCALAPPDATA%\hermes\git`）→ `Program Files\Git` の順に探索 |
| パス変換 | `_msys_to_windows_path()` / `_windows_to_msys_path()` で `/c/Users/...` ⇄ `C:\Users\...` を相互変換 |
| ウィンドウ抑止 | `hermes_cli/_subprocess_compat.py` の `windows_hide_flags()` |
| PTY | Windows は `winpty`（pywinpty）、POSIX は `ptyprocess` |
| プロセス終了 | Windows では `os.setsid` / `os.killpg` / `fcntl` を呼ばない（`_IS_WINDOWS` でガード） |
| MSYS 引数変換抑止 | `MSYS_NO_PATHCONV` / `MSYS2_ARG_CONV_EXCL` を設定 |

**Windows では Git for Windows（Git Bash）が必須**です。見つからない場合、`terminal` ツールはインストールを促すエラーを返します。
0.12 系にあった PowerShell fallback は upstream には無く、廃止しました。

## OS 分岐コーディング規則

1. **判定は `_IS_WINDOWS`（`tools/environments/local.py`）を使う** — 新規に `os.name == 'nt'` や `sys.platform` を混ぜない。
2. **POSIX 経路を温存** — `if _IS_WINDOWS:` を追加する形にし、既存の POSIX 分岐のロジックは触らない。
3. **戻り値・副作用の互換性を厳守** — Windows 経路でも戻り値の形、`self.cwd` 更新、callback の呼び出しタイミングを POSIX 経路と揃える。
4. **例外は同じ型・メッセージ形式で raise** — silent fail で謎の `exit -1` を返さない。
5. **AiDiy 独自の Windows 修正はコメントで明示** — upstream 追従時に再適用が必要なため。`AGENTS.md` の「upstream 追従時の注意」表にも追記する。

## AiDiy 独自の Windows / ランタイム修正

現在 AiDiy に残っている Windows / ランタイム起因の主な独自修正は次のとおりです。

| 対象 | 内容 |
|------|------|
| `cli_main.py` / `backend_server/AIコア/AIコード_cli.py` | Windows の argv 長制限を避けるため、AiDiy 連携の完全プロンプトを `--oneshot-stdin` + UTF-8 stdin で渡す。 |
| `tools/daemon_pool.py` | Python 3.14 で `ThreadPoolExecutor` の worker 引数が `(ref, ctx, work_queue)` に変わったため、`_adjust_thread_count()` で `_create_worker_context` の有無を見て分岐する。upstream は `requires-python <3.14` のため未対応 |

upstream の `requires-python` は `>=3.11,<3.14` ですが、AiDiy の宣言条件は `pyproject.toml` の `>=3.13` で、3.14 を使う環境も対象にしています。
3.14 固有の不具合を見つけたら、まず「upstream が 3.14 未対応なだけではないか」を疑ってください。

## 動作確認コマンド

各修正後、以下を確認します。MCP discovery や外部 LLM の待ち時間を含むため、数秒以内という固定条件にはしません。

```bash
cd command_hermes
.venv/Scripts/python.exe cli_main.py --version
.venv/Scripts/python.exe cli_main.py --list-tools
.venv/Scripts/python.exe cli_main.py -Q -z "1+1は? 数字だけ答えて"
```

ツール単体（`base/` と `core` の shim を張ってから import する）:

```python
import sys
from pathlib import Path
root = Path('.').resolve()
sys.path.insert(0, str(root / 'base')); sys.path.insert(0, str(root))
import core as _c; sys.modules['agent'] = _c

from tools.environments.local import _find_shell, _IS_WINDOWS
from tools.terminal_tool import terminal_tool
from tools.file_tools import read_file_tool, search_tool, write_file_tool, patch_tool
```

- `_find_shell()` が `...\Git\bin\bash.exe` を返す
- `terminal_tool(command='pwd; python -V')` が exit_code 0 で返る
- `terminal_tool(..., background=True)` が session_id を返す
- `read_file_tool` / `search_tool` / `write_file_tool` / `patch_tool` が成功する
- `tools.mcp_tool.discover_mcp_tools()` が 現在の OS と設定で有効な対象を拾う（件数は固定しない）

統合確認:

- `--list-tools -t aidiy_sqlite` で MCP ツールだけが列挙される
- `-Q -z` の stdout に応答テキストしか出ない（session_id は stderr）
- AiDiy 連携のコマンド配列に完全プロンプトが含まれず、`--oneshot-stdin` が含まれる
- 数 MB の stdin / stdout を同時に扱っても停止せず、stdin を読まない子プロセスはタイムアウト後に残留しない

## Linux/macOS 回帰テスト

Linux/WSL で `aidiy_hermes` を起動し、`pwd`、`ls`、`read_file` が従来通り動くこと。
upstream 由来コードをそのまま使っているため原理的に影響はないが、AiDiy レイヤを触った場合は目視確認する。
