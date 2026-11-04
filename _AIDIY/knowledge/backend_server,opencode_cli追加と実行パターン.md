# opencode_cli 追加と実行パターン

> 文書: `backend_server,opencode_cli追加と実行パターン.md` | 実装: `backend_server/AIコア/AIコード_cli.py`

## このメモを使う場面

- `opencode_cli` のパス解決を変更・修正する
- `opencode_cli` のコマンドライン引数構成を確認する
- Code AI 設定で `opencode_cli` を選んだときの挙動を理解する

## パス解決

`_コマンドパス取得()` 内の `opencode_cli` 専用分岐:

```python
if self.code_ai == "opencode_cli":
    if os.name == 'nt':
        userprofile = os.environ.get('USERPROFILE', os.path.expanduser('~'))
        candidate = os.path.join(userprofile, '.local', 'bin', 'opencode.exe')
        if os.path.isfile(candidate):
            return candidate
        npm_bin = os.path.join(userprofile, 'AppData', 'Roaming', 'npm')
        candidate2 = os.path.join(npm_bin, 'opencode.cmd')
        if os.path.isfile(candidate2):
            return candidate2
    return "opencode"
```

探索順:
1. `%USERPROFILE%\.local\bin\opencode.exe`
2. `%USERPROFILE%\AppData\Roaming\npm\opencode.cmd` (npm global install)
3. `opencode` (PATH 依存フォールバック)

## コマンド構築パターン

`_コマンド構築()` 内の `opencode_cli` 専用分岐:

```python
if self.code_ai == "opencode_cli":
    _model = self._ollama_cloud_suffix除去(self.code_model)
    model_args = ["--model", _model] if _model and _model.lower() != "auto" else []
    cmd_args = base + ["run"]
    cmd_args += model_args + [プロンプト]
    if not 初回:
        cmd_args.append("-c")
    return cmd_args
```

- 初回: `opencode run [--model <model>] "<プロンプト>"` — 新規会話
- 継続: `opencode run [--model <model>] "<プロンプト>" -c` — 同じセッションで継続

## バージョン確認と履歴管理

- `opencode_cli` は `実行()` 内の `完全プロンプト` フローに入る（履歴送信不要、初回のみ system_prompt 付与）
- 該当条件: `self.code_ai in ["claude_cli", "copilot_cli", "antigravity_cli", "codex_cli", "opencode_cli", "grok_cli"]`
- バージョン確認は `_バージョン確認実行()` の汎用パスで実行する

## stdout / stderr の役割

- stdout: 正式回答として収集し、実行完了後に `output_text` で返す
- stderr: 進捗・警告として `output_stream` へ随時送る
- stdout は `output_stream` へ送らない。途中表示と最終回答の二重表示を防ぐため
- stdout が空でも stderr を正式回答へ転用しない。stderr の内容はストリームと `last_stderr_output` に残る

## モデル名の suffix 除去

`_ollama_cloud_suffix除去()` は `opencode_cli` と `aidiy_hermes` の両方から呼ばれる。
`-cloud` / `:cloud` 末尾を除去して純粋な Ollama モデル名にする。

## 注意点

- `opencode_cli` は `npm` 経由の `.cmd` シムを直接実行に解決する (`_npmシム直接実行に解決()`)
- パターン2 (node 経由) の解析は `npm.cmd` 内の `"%_prog%" "..." %*` を正規表現で拾う
- `opencode.exe` の場合はパターン1 (.exe 直接呼び出し) で解決される
- 継続会話の `-c` フラグは opencode のセッション管理に依存する。opencode 側で session が切れた場合は新規会話と同じ挙動になる
