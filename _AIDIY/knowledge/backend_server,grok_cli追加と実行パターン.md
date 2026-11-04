# grok_cli 追加と実行パターン

> 文書: `backend_server,grok_cli追加と実行パターン.md` | 実装: `_setup.py`, `backend_server/AIコア/AIコード_cli.py`, `backend_server/conf/conf_model.py`, `scripts/cli_bat/_grok_cli.bat`

## このメモを使う場面

- `grok_cli` のパス解決を変更・修正する
- `grok_cli` のコマンドライン引数構成を確認する
- Code AI 設定で `grok_cli` を選んだときの挙動を理解する
- grok のモデル候補を更新する

## 対象 CLI

公式の Grok Build CLI（`xai-org/grok-build`、Rust 製 TUI）。コマンド名は `grok`。

- Windows 導入: `irm https://x.ai/cli/install.ps1 | iex`
- 導入先: `%USERPROFILE%\.grok\bin\grok.exe`（インストーラが同ディレクトリを PATH へ追加する）
- 同名の別物が npm に複数ある。`@vibe-kit/grok-cli`、`grok-cli`、`@spikewang/grok-cli` はいずれも非公式または macOS 専用なので採用しない

## 一括セットアップ

ルートの `_setup.py` で「グローバル環境の AI CLI ツール」に `y` を選ぶと、Grok Build も並列導入対象になる。Windows では公式 `install.ps1`、macOS / Linux では公式 `install.sh` を一時ファイルへ取得して実行する。完了確認と失敗集計では `grok-build` として表示される。

## パス解決

`_コマンドパス取得()` 内の `grok_cli` 専用分岐:

```python
if self.code_ai == "grok_cli":
    userprofile = os.environ.get('USERPROFILE', os.path.expanduser('~'))
    exe = 'grok.exe' if os.name == 'nt' else 'grok'
    candidate = os.path.join(userprofile, '.grok', 'bin', exe)
    if os.path.isfile(candidate):
        return candidate
    return "grok"
```

npm 配布ではないため、`_コマンドパス取得()` 末尾の npm シム名マップ（`codex_cli` / `copilot_cli`）には載せない。

## コマンド構築パターン

`_コマンド構築()` 内の `grok_cli` 専用分岐:

```python
if self.code_ai == "grok_cli":
    common = list(base)
    if self.code_permissions != "none":
        common.append("--always-approve")
    if self.code_model and self.code_model.lower() not in ("auto", "same"):
        common.extend(["--model", self.code_model])
    if repo_path:
        common.extend(["--cwd", repo_path])
    common.append("--no-auto-update")
    if 初回:
        return common + ["-p", プロンプト]
    else:
        return common + ["-c", "-p", プロンプト]
```

- 初回: `grok --always-approve [--model <model>] --cwd <repo> --no-auto-update -p "<プロンプト>"`
- 継続: 上記に `-c` を追加

主なフラグ:

| フラグ | 意味 |
|--------|------|
| `-p, --single` | 単発プロンプト。応答を stdout へ出して終了する |
| `-c, --continue` | 同一 cwd の直近セッションを継続する |
| `-m, --model` | モデル ID |
| `--always-approve` | 全ツール実行を自動承認（`--yolo` のエイリアス） |
| `--cwd` | 作業ディレクトリ |
| `--no-auto-update` | 自動更新チェックを止める。`--help` には出ないが有効 |
| `--output-format` | `plain` / `json` / `streaming-json` / `streaming-messages-json` |

`CODE_PERMISSIONS` が `none` のときは `--always-approve` を付けない。

## セッション継続

`codex_cli` のような `resume <session-id>` 方式ではなく、`-c` で cwd 基準の直近セッションを継続する。
そのため `_codexセッションID抽出()` 相当の stderr 解析は不要で、`実行()` 内のセッションID保存分岐にも追加しない。

`実行()` の `完全プロンプト` フロー（履歴送信不要、初回のみ system_prompt 付与）に入る。
該当条件: `self.code_ai in ["claude_cli", "copilot_cli", "antigravity_cli", "codex_cli", "opencode_cli", "grok_cli"]`

バージョン確認は `_バージョン確認実行()` の汎用パス（`--version`）で動く。専用分岐は不要。

## モデル候補

候補の正本: `backend_diag/モデル情報/models_info.mjs` の `FIXED_MODELS.grok_cli`。利用可能性はログイン済みアカウントの `grok models` で確認する。

現行の候補は `grok-4.7` と `grok-4.6` の 2 つ（設定画面には `auto` も表示）。
公開済みかは OpenRouter の `x-ai/` 一覧に載っているかで判断する（`~x-ai/grok-latest` の参照先が最新）。2026-10-15 時点で `grok-4.8` は発表のみで未掲載のため候補に含めない。
`grok-4` / `grok-4-fast` / `grok-code-fast-1` / `grok-4.6-build` は `unknown model id` で拒否される。
`grok-4.6-build` は `--output-format json` の `modelUsage` に出る内部名で、`-m` には渡せない。

固定候補はDiagが `code_models_info.json` に合成し、`conf_model.py` は読込だけを行う。旧 `_config/AiDiy_code_grok_cli.json` の作成・同期は行わない。

## 配線箇所

Code AI を 1 つ追加するときに触る箇所（`grok_cli` の実績）:

| ファイル | 内容 |
|----------|------|
| `AIコア/AIコード_cli.py` | `_コマンドパス取得()` / `_コマンド構築()` / 履歴非送信リスト |
| `AIコア/AIコード.py` | 未インストール案内の表示名 |
| `AIコア/AIセッション管理.py` | `CODE_GROK_CLI_MODEL` をセッション設定へ |
| `core_router/AIコア.py` | 設定保存キー一覧 / welcome の provider_key / `モデル情報/TASK選択肢` のフォールバック一覧 |
| `conf/conf_model.py` | Diag合成JSONの読込・`get_code_models()` |
| `conf/conf_json.py` | `CODE_GROK_CLI_MODEL` の既定値 |
| `frontend_web` / `frontend_avatar` の `AI設定再起動.vue` | `CODE_MODEL_KEYS` |
| 両フロントの `AIタスク_要求編集.vue` / `AIタスク_明細編集.vue` | `TASK_CODE_MODELS既定` |
| `scripts/cli_bat/_grok_cli.bat` | 手動起動用ランチャ |

`AIチーム_依頼編集.vue` の API 失敗時フォールバックは既定 AI 1 つだけを持つ設計なので追加しない。

## 注意点

- モデル一覧はアカウントの割り当てで変わる。`grok models` の実行結果を正とする
- `--no-auto-update` は `--help` に記載がない。有効性は無効フラグ（`error: unexpected argument` が即座に出る）との比較で確認する
- 設定 UI の候補は backend の `available_models.code_models` から生成されるため、追加後は core server の再起動が必要
- `_setup.py` は `~/.grok/config.toml` に `aidiy_*` を `type = "sse"` で書く。`grok mcp list` と `grok inspect` で確認する
- Grok の `type=sse` は `/sse` へ Streamable HTTP の `initialize` を POST する。`grok mcp doctor <name>` が healthy なら接続できている
- `~/.claude.json` も読むが、同名は `config.toml` が優先する。stdio ブリッジは使わない

## 確認方法

```powershell
grok --version
grok models
grok --always-approve --cwd "D:\OneDrive\_sandbox\AiDiy2027" --no-auto-update -p "おはよう"
grok --always-approve --cwd "D:\OneDrive\_sandbox\AiDiy2027" --no-auto-update -c -p "さっき私は何と言った？"
grok mcp list
grok inspect
```

```powershell
backend_server\.venv\Scripts\python.exe -m py_compile backend_server\AIコア\AIコード_cli.py
cd frontend_web
npm run type-check
cd ..\frontend_avatar
npm run type-check
```
