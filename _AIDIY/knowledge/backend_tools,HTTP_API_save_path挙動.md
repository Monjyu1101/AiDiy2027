# backend_tools HTTP API の save_path 挙動

> 文書: `backend_tools,HTTP_API_save_path挙動.md` | 実装: `backend_tools/tools_proc/tools_media.py`, `backend_tools/tools_proc/media_output.py`

## このメモを使う場面

- 画像・動画・音声生成APIの保存先とbase64返却を調べる。
- MCPとHTTP、処理クラス直接呼出しの既定値の違いを確認する。

## HTTP API と保存先

URLは `http://127.0.0.1:8095` に次のパスを付ける。旧短縮名 `/tts` / `/imageGen` / `/movieGen` は現行ルーターにない。

| POST エンドポイント | ファイル | save_path省略時の保存先（リポジトリルート基準） | base64 |
|---|---|---|---|
| `/aidiy_text_to_speech/synthesize` | MP3 | `temp/output/yyyymmdd.HHMMSS.mp3` | `base64_audio` |
| `/aidiy_image_generation/generate` | PNG | `backend_server/temp/output/` | `data` |
| `/aidiy_movie_generation/generate` | MP4 | `backend_server/temp/output/` | 常に返さない |

全てJSON応答で、音声・画像の生バイナリHTTP応答ではない。画像・動画の時刻付きファイル名は各生成クラスで決まる。保存先を指定した場合、画像と音声はbase64を生成しない。画像は `type: "file"` / `save_path` / `mimeType` 等を返し、音声は `base64_audio` を空文字として返す。動画は常に保存先とメタデータを返す。

- base64省略の共通判定は `media_output.base64を返すか()`。空白だけのパスなどを独自に解釈せず、利用側では有効な保存先か未指定を渡す。
- CLI画像生成は生成元の `generated_path` を維持し、明示した `save_path` へ同じPNGをコピーする。生成元とコピー先を混同しない。
- 画像・動画の同期元は `image_generation.py` / `movie_generation.py` の `DEFAULT_OUTPUT_DIR` と `_resolve_default_output_dir()`。
- TTSは `tools_media.py` のMCP/HTTPラッパーが `temp/output/` を明示する。`TextToSpeech.to_base64()` の直接呼出しで使うクラス既定値 `backend_server/temp/output/` とは異なる。コメントだけでなく実際の引数を追う。

## TTS の入力と再生

- 必須キーは `speech_text`。`text` は使わない。任意キーは `TtsRequest` の `language` / `provider` / `model` / `voice` / `ratio` / `save_path` / `local_play` / `play`。
- `speech_text` 全体がJSONの空文字列 `""` なら1秒の無音MP3を作る。本文中の `""` は間合い記号ではない。
- `save_path` 省略でもファイルへ保存する。`local_play=true` または `play=true` はサーバー側の再生試行であり、呼出し元PCの再生成功を保証しない。
- 稼働中サービスが空文字列を拒否する場合は、配置ソースと稼働版の相違を確認し、必要なら再起動する。旧サービスでの失敗を現行実装の仕様にしない。

## 関連する接続仕様

MCP一覧・SSE/Streamable HTTPのマウントは [backend_tools 構成](./backend_tools,構成.md)。バックアップとコード実行はメディア保存APIではないため [MCP活用手順](./backend_server,backend_tools,MCP活用手順.md) を参照する。バックアップは `/aidiy_backup/save/scan` / `/aidiy_backup/save/run` / `/aidiy_backup/check/{method}`、コード実行は `/aidiy_code_agents/run`。
