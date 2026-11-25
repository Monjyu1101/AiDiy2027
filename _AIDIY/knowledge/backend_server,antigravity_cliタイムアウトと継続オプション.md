# antigravity_cli タイムアウトと継続オプション

> 文書: `backend_server,antigravity_cliタイムアウトと継続オプション.md` | 実装: `backend_server/AIコア/AIコード_cli.py`

## このメモを使う場面

- `antigravity_cli` (agy) のコマンドライン引数やパス解決を変更・修正する
- `antigravity_cli` のタイムアウト延長や継続フラグの動作を理解する
- Code AI 設定で `antigravity_cli` を選んだときの挙動を調整する

## Google OAuth 専用の Code AI（agy_cli）

- 既存の `antigravity_cli` の改名ではありません。通常の Code AI を `agy_cli` に明示変更して利用します。既定モデルキーは `CODE_AGY_CLI_MODEL`。会話用の `gemini_agy` は別方式・別設定です。
- `agy` の保存済み Google ログインを使い、API キーや明示的な ADC は子プロセスに渡しません。CLI 自体に別方式の認証が設定されて失敗した場合も、別プロバイダで再実行しません。
- Diag が OAuth 専用環境で `agy models` を読み、`_AIDIY/aidiy_diag/gemini_agy_models_info.json` へ保存します。この一覧を会話用と Code 用に展開しますが、旧 Antigravity や Gemini API のモデル一覧は混ぜません。未取得時の既定・設定値は利用実績を示しません。
- Windows の Visual Studio Code 拡張が配置する `%USERPROFILE%\.gemini\bin\agy.exe` も使用できます。Diag は標準導入先以外から検出したバイナリを再導入・削除しません。
- UTF-8 標準入力と構造化結果を使い、継続時は自分の会話IDを `--conversation` で指定します。旧経路の共有「最後の会話」を参照しません。コアや AI インスタンスを再作成した場合、CLI 側は新規になります。操作なしには `--dangerously-skip-permissions` を追加せず、Code の権限 `full` を明示したときだけ設定します。
- [Google 公式：認証](https://antigravity.google/docs/cli/install/) ／ [Google 公式：ヘッドレス実行](https://antigravity.google/docs/cli/headless/)

## モデルIDの確認

`invalid model selection` が出た場合は `agy models` でCLIが受け付けるIDを確認します。Gemini APIのモデル一覧とは別体系です。`frontend_diag/diag/モデル情報/antigravity_models.mjs` がこの一覧を取得し、モデル情報の書込時に `code_models_info.json` の `antigravity_cli` を置換します。取得失敗時は `auto` / `same` だけを残し、古いGemini候補は再利用しません。AIモデル試験・AI設定再起動は同じ合成ファイルを使います。

現行実装の `auto` / `same` は `--model` を付けず、CLIの既定選択を使います。明示モデルはIDをそのまま渡すため、古いIDを手動保存している場合は設定画面で選び直します。

## パス解決

`_コマンドパス取得()` 内の `antigravity_cli` 専用分岐:

```python
if self.code_ai == "antigravity_cli":
    if os.name == 'nt':
        userprofile = os.environ.get('USERPROFILE', os.path.expanduser('~'))
        candidate = os.path.join(userprofile, 'AppData', 'Local', 'agy', 'bin', 'agy.exe')
        if os.path.isfile(candidate):
            return candidate
    return "agy"
```

探索順:
1. `%USERPROFILE%\AppData\Local\agy\bin\agy.exe` (Windows ローカルインストール)
2. `agy` (PATH 依存フォールバック)

## コマンド構築パターン

`_コマンド構築()` 内の `antigravity_cli` 専用分岐:

```python
elif self.code_ai == "antigravity_cli":
    # Antigravity CLI (agy) — claude 互換インターフェース
    common = list(base)
    if self.code_permissions != "none":
        common.append("--dangerously-skip-permissions")
    if repo_path:
        common.extend(["--add-dir", repo_path])
    # CLI固定上限を無効にし、バックエンドの無受信監視を使う
    common.extend(["--print-timeout", "0"])
    if 初回:
        return common + ["-p", プロンプト]
    else:
        # -c (--continue) は -p の後ろに付ける（opencode_cli と同様）
        return common + ["-p", プロンプト, "-c"]
```

### タイムアウトの管理
現行実装は `--print-timeout 0` でCLI固有の固定上限を無効にします。バックエンドはstdout / stderrのどちらにも受信がない状態が900秒続いた場合に終了し、受信ごとに待機時間を数え直します。

### 継続会話（-c フラグ）の位置
`agy` の引数解析において、継続会話を示す `-c` フラグは `-p`（およびプロンプト）の後に付与する必要があります。
- 初回: `agy -p "プロンプト"`
- 継続: `agy -p "プロンプト" -c`

## stdout / stderr の役割

- stdout: 正式回答として収集し、実行完了後に `output_text` で返す
- stderr: 進捗・警告として `output_stream` へ随時送る
- stdout は `output_stream` へ送らない。途中表示と最終回答の二重表示を防ぐため
- stdout が空でも stderr を正式回答へ転用しない。stderr の内容はストリームと `last_stderr_output` に残る
- `antigravity_cli` の `_antigravity実行()` は共通の非表示起動を使う。Windowsでは監視プロセス・CLIとも `CREATE_NO_WINDOW` で起動する。`DETACHED_PROCESS` は子コマンドに表示コンソールが作られるため使わない。出力の役割は `copilot_cli` / `opencode_cli` と同じ
- 非表示実行と出力分離の専用自動テストは現在ない。WindowsではCLI実行中にコンソール窓が表示されないこと、CLIが通常起動した子コマンドでも窓が出ないこと、stderr が正式回答へ混ざらないことを実機で確認する

## 注意点

- `agy` は Go の標準フラグ解析機能を使用しており、オプションフラグの解析が厳密です。位置引数やフラグの指定順序が正しくない場合、引数解析エラー (`flag provided but not defined` 等) になる可能性があるため注意が必要です。
- `-c`（または `--continue`）フラグは `-p`（プロンプト）の後方に付与することで、前回の会話コンテキストを正しく引き継ぎます。
- 現行の引数は `--print-timeout 0`。CLI側のフラグ互換性は導入版で別途確認する。
