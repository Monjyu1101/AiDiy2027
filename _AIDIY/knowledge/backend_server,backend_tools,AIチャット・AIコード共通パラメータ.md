# AIチャット・AIコードの共通パラメータ

> 文書: `backend_server,backend_tools,AIチャット・AIコード共通パラメータ.md` | 実装: `backend_server/AIコア/AI実行オプション.py`, `backend_server/AIコア/AIチャット.py`, `backend_server/AIコア/AIチャット_*.py`, `backend_server/AIコア/AIコード.py`, `backend_server/AIコア/AIコード_cli.py`, `backend_server/AIコア/AIコード_claude.py`, `backend_tools/tools_proc/chat_llm.py`, `backend_tools/tools_proc/code_agents.py`, `backend_tools/tools_proc/prediction_llm.py`

## このメモを使う場面

- AIチャット（Chat / ChatAI）または AIコード（CodeAgent / CodeAI）に引数・機能を追加する。
- 会話の引き継ぎ、会話履歴の保存、画面へのストリーム送信、出力ファイルの保存を止めた実行を作る。
- 予測・診断など、通常の会話に影響させない使い捨て実行を追加する。

## 基本方針

- AIチャットと AIコードのモジュールは、できるだけ同じ名前・同じ意味の共通パラメータにそろえる。片方だけに独自の引数やフラグを足さない。
- 処理部（`Chat` / `CodeAgent`）とAI実装（`ChatAI` / `CodeAI`）は、同じ並びの引数（`親`、`セッションID`、`チャンネル`、`絶対パス`、`AI_NAME`、`AI_MODEL`、`system_instruction`、`実行オプション` など）を受け取る。
- 新しい制御は個別の属性（例: `instance.出力ファイル保存 = False`）や、送信しないダミー接続を呼び出し側で組み立てる方法では足さず、`AI実行オプション` の項目として追加する。
- 既定値は従来の動作のまま（すべて有効）にし、通常の会話・Code パネルの動作を変えない。

## AI実行オプション

`backend_server/AIコア/AI実行オプション.py` の `AI実行オプション`（変更不可の dataclass）を使う。

| 項目 | 既定 | 無効にしたときの動作 |
|------|------|----------------------|
| `会話継続` | `True` | ChatAI は2回目以降の `実行` の前に前回の履歴を消す（`会話継続適用(self)`）。CodeAI は呼び出し側の `resume` に関わらず `resume=False` にする（Codex の `resume`、Copilot の `--continue` などを付けない） |
| `履歴保存` | `True` | 処理部が `保存関数` を外し、A会話履歴へ書き込まない |
| `ストリーム送信` | `True` | 処理部が接続を `送信無効接続` で包み、`send_to_channel` だけを止める。`モデル設定` などの参照は元の接続へ委譲する。CodeAI は `parent_manager.接続` 経由で送るため同じく止まる |
| `出力ファイル保存` | `True` | ChatAI（Gemini / OpenRouter / OpenAI）が生成画像などを `temp/output` に保存しない |

- `AI実行オプション.単発()` はすべて無効。予測のように「引き継がず・残さず・送らない」1回だけの実行に使う。
- 判定は各クラスの `self.実行オプション`（ChatAI / CodeAI）、または処理部のコンストラクタで行う。ほかのクラスの属性を直接見ない。読み取りは `実行オプション取得(対象)` を使うと未設定でも既定値になる。

## 渡し方

- 処理部: `Chat(..., 実行オプション=...)` / `CodeAgent(..., 実行オプション=...)`。処理部は受け取ったオプションで接続と保存関数を調整し、生成する ChatAI / CodeAI に同じオプションを渡す。
- AI実装: `ChatAI(..., 実行オプション=...)` / `CodeAI(..., 実行オプション=...)`。`AIチャット_openai.py` のように継承する実装は親クラスへそのまま渡す。
- Tools: `CodeAgents.run_async(..., 実行オプション=...)`。`ChatLLM` は `_実行オプション()` が返す値を ChatAI に渡す（既定は `None`＝既定値）。派生ラッパーは `_実行オプション()` を上書きする（例: 予測の `_PredictionChatLLM` は `単発()`）。

## 新しいパラメータ・機能を追加するとき

1. Chat 側と Code 側の両方で同じ意味になるかを先に確認する。片方にしか意味がない場合も、名前と既定値はもう片方に合わせておく。
2. 実行時の有効・無効は `AI実行オプション` の項目として追加し、既定値は従来の動作にする。
3. `Chat` / `CodeAgent` と、すべての `ChatAI` / `CodeAI` 実装（`AIチャット_gemini/local/ollama/openrt/openai.py`、`AIコード_cli/claude.py`）のコンストラクタへ同じ名前で追加する。
4. Tools のラッパー（`chat_llm.py` / `code_agents.py`）からも同じ名前で渡せるようにする。
5. このメモの表を更新する。

## 確認方法

- オプション未指定の `Chat` / `CodeAgent` で、接続・保存関数が渡したものと同一で、実行オプションが既定値であること。
- `単発()` を指定した `Chat` / `CodeAgent` で、`send_to_channel` が送られず、`モデル設定` は参照でき、`保存関数` が `None` になること。
- `単発()` の ChatAI で、1回目の実行前に注入した履歴は残り、2回目の実行前に消えること。既定値では消えないこと。
- 予測（`backend_tools/tools_proc/prediction_llm.py`）の Chat / CLI の両経路に `単発()` が渡ること。
