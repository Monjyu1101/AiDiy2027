# Code CLI 表示 ANSI 制御コード対処

> 文書: `backend_server,command_hermes,frontend_avatar,CodeCLI表示ANSI制御コード対処.md` | 実装: `backend_server/AIコア/AIコード_cli.py`, `frontend_avatar/src/components/AIコード.vue`

## このメモを使う場面
- AIコードパネルやチャット表示に `?[36m`、`?[0m`、`\x1b[36m` のような制御コードが見える
- Hermes / Codex / Claude など CLI 系 Code AI の出力を WebSocket 表示へ流す処理を調整する
- 過去履歴やストリーム出力に混ざった ANSI エスケープを表示直前で無害化する

## 関連ファイル
- `backend_server/AIコア/AIコード_cli.py` — CLI subprocess 出力の取得と WebSocket 送信
- `frontend_avatar/src/components/AIコード.vue` — コードパネル表示
- `frontend_avatar/src/components/AIチャット.vue` — チャット表示
- `command_hermes/tools/code_execution_tool.py` — Hermes `execute_code`
- `command_hermes/tools/ansi_strip.py` — Hermes 側の ANSI 除去例

## 実装方針

- CLI subprocess の stdout / stderr は、WebSocket へ送る前に backend 側で ANSI 制御コードを除去する
- subprocess 環境変数に `NO_COLOR=1`、`FORCE_COLOR=0`、`CLICOLOR=0`、`TERM=dumb` を渡し、CLI 側にもプレーン出力を促す
- 実 ESC が壊れて `?[36m` のように保存/表示されるケースがあるため、通常 ANSI と `?\[[0-9;:]*[A-Za-z]` 形式の両方を除去する
- フロント側でも表示直前の文字列正規化を行い、既存履歴や別経路から混入した制御コードを落とす
- Windows subprocess 出力は `cp932` 任せにせず、`encoding="utf-8"` と `errors="replace"` を明示する
- 子 Python には `PYTHONIOENCODING=utf-8:replace` を渡す
- stdout / stderr は `None` や `bytes` になる経路を想定し、JSON 化前に文字列へ正規化してから末尾制限と ANSI 除去を行う

## 注意点

- CLI ごとに色停止オプションが違うため、共通環境変数と表示側サニタイズを優先する
- `output_stream` と最終 `output_text` の両方で除去する。片方だけだとストリーム中または完了後に再発する
- フロントの `textContent` は HTML としては安全だが、制御コード自体は文字として見えるため、表示直前の正規化は残す
- `UnicodeDecodeError` 後に `proc.stdout is None` の二次エラーが出る場合は、`subprocess.run(text=True)` の encoding 未指定を疑う

## 確認方法

```powershell
backend_server\.venv\Scripts\python.exe -m py_compile backend_server\AIコア\AIコード_cli.py
command_hermes\.venv\Scripts\python.exe -m py_compile command_hermes\tools\code_execution_tool.py
cd frontend_avatar
npm run type-check
```

表示確認では、次の両方が `--- Hermes ---` として表示されることを確認する。

```text
\x1b[36m--- Hermes ---\x1b[0m
?[36m--- Hermes ---?[0m
```
