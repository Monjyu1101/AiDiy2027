# Gemini thought_signature の保持と復元

> 文書: `backend_server,Gemini_thought_signature保持と復元.md` | 実装: `backend_server/AIコア/AIチャット_gemini.py`

## このメモを使う場面

- Gemini の function calling で `thought_signature` が消えて次ターンにエラーが出る
- `tool_calls` を OpenAI 互換形式で中間保持したあと Gemini SDK へ戻す処理を修正する
- `AIチャット_gemini.py` の `_function_call_part_to_tool_call` / `_messages_to_gemini_contents` を変更する
- Gemini thought_signature 関連のユニットテストを追加・修正する

## 背景

Gemini SDK の `types.Part` は `thought_signature: bytes` フィールドを持つ。
AiDiy の AIコアは会話履歴を OpenAI 互換 dict（`tool_calls`）で中間保持するため、
bytes 型の署名をそのまま保存できない。
JSON シリアライズ可能な base64 文字列に変換して保持し、次ターン時に bytes へ戻す実装が必要。

## 実装パターン

### bytes → base64 テキスト（保存時）

```python
@staticmethod
def _thought_signature_to_text(signature) -> Optional[str]:
    if not signature:
        return None
    if isinstance(signature, str):
        return signature
    try:
        return base64.b64encode(bytes(signature)).decode("ascii")
    except (TypeError, ValueError):
        return None
```

- `bytes(signature)` で SDK 独自型（`ByteString` 互換）を吸収する。
- 変換失敗時は `None` を返し、`tool_call` に `thought_signature` キーを追加しない。

### base64 テキスト → bytes（復元時）

```python
@staticmethod
def _thought_signature_from_text(signature) -> Optional[bytes]:
    if not signature:
        return None
    if isinstance(signature, bytes):
        return signature
    if not isinstance(signature, str):
        return None
    try:
        return base64.b64decode(signature, validate=True)
    except (ValueError, TypeError):
        return None
```

- `validate=True` で不正な base64 を `ValueError` に落とす。
- 無効な署名は `None` を返し、`function_call_part.thought_signature` を設定しない（例外なし）。

### tool_call への格納

```python
signature = self._thought_signature_to_text(getattr(part, "thought_signature", None))
if signature:
    tool_call["thought_signature"] = signature
```

### Gemini Content への復元

```python
signature = self._thought_signature_from_text(tc.get("thought_signature"))
if signature:
    function_call_part.thought_signature = signature
```

## `base64` インポートの注意点

`AIチャット_gemini.py` ではトップレベル（20行目）で `import base64` 済み。
別の場所に局所インポートを追加しない。

## 確認観点

専用の自動テストは現在ない。変更時は次の3点を確認する:

| 観点 | 確認内容 |
|---------|---------|
| 署名の往復 | bytes → base64 → bytes のラウンドトリップ後、`function_call.name`・`args`・`thought_signature` が一致する |
| 署名なしの旧形式 | `thought_signature` なしの旧来 tool_call でも `thought_signature` が `None` になりエラーが起きない |
| 不正な署名 | 不正 base64 文字列を渡した場合も `thought_signature` が `None` になり履歴が壊れない |

テストを追加する場合は `backend_server/checks/` に置き、`importlib` でモジュールを直接ロードして `log_config` をスタブ化する。
`google.genai` の実パッケージが必要なため、依存関係をインストール済みの venv で実行する。

## 次回の注意点

- `thought_signature` は Gemini SDK の opaque フィールドで、今後の SDK 更新で型や有無が変わる可能性がある。修正時は `getattr(part, "thought_signature", None)` で安全にアクセスすること。
- `_messages_to_gemini_contents` の `tool` ロール処理は署名を持たない（FunctionResponse に署名は不要）。
- テストを追加する場合は副作用なしで `ChatAI` を初期化できるよう、モジュールを直接ロードしてスタブ化する。
