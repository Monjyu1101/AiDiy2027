# Code CLI プロンプト整形

> 文書: `backend_server,CodeCLIプロンプト整形.md` | 実装: `backend_server/AIコア/AIコード_cli.py`

## このメモを使う場面
- `AIコード_cli.py` の system prompt や送信プロンプトを調整する
- 履歴表示では改行を残し、CLI 引数へ渡す直前だけ 1 行化したい
- `None` と非文字列入力の扱いを判断する

## 関連ファイル
- `backend_server/AIコア/AIコード_cli.py`

## 実装方針

保持用テキストと送信用テキストを分ける。

- system prompt は履歴やデバッグ表示で読むため、構築時点では複数行を保持する
- CLI 引数へ渡す直前にだけ改行・復帰を空白へ置換し、1 行化する
- `None` は未設定値として空文字へ変換する
- `int`、`list` など非文字列は呼び出し側の不整合として `TypeError` にする

## 実装パターン

```python
def _CLI送信用テキスト正規化(self, text: Optional[str]) -> str:
    if text is None:
        return ""
    if not isinstance(text, str):
        raise TypeError(f"CLI送信用テキストは文字列である必要があります: {type(text).__name__}")
    return text.replace("\n", " ").replace("\r", " ").strip()
```

`_コマンド構築()` の冒頭で正規化する。

```python
def _コマンド構築(self, プロンプト: str, 初回: bool = False, repo_path: str = None, 読取専用: bool = False) -> list:
    プロンプト = self._CLI送信用テキスト正規化(プロンプト)
    ...
```

`_システムプロンプト構築()` は 1 行化しない。

```python
def _システムプロンプト構築(self) -> str:
    base_prompt = self.system_instruction.strip() if self.system_instruction else "あなたは賢いコードエージェントです。"
    return f"{base_prompt}\n{suffix}" if suffix else base_prompt
```

## 注意点

- `_システムプロンプト構築()` で早期に 1 行化すると、履歴表示やデバッグ出力が読みにくくなる
- `_CLI送信用テキスト正規化()` を厳格化したら、既存呼び出しで非文字列を渡していないか確認する
- 例外を呼び出し元で握りつぶして空文字化すると、原因調査が難しくなる
- system prompt 変更時は初回送信、継続送信、履歴再利用の 3 経路で整合を見る

## 確認方法

```powershell
backend_server\.venv\Scripts\python.exe -m py_compile backend_server\AIコア\AIコード_cli.py
```

追加で確認すること:
- `self.system_prompt` が複数行のまま保持される
- `_コマンド構築()` で CLI 送信直前に 1 行化される
- `None` は空文字、非文字列は例外になる
