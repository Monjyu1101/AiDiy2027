# AI音声処理（AudioController）

> 文書: `backend_server,frontend_avatar,AI音声処理.md` | 実装: `frontend_avatar/src/components/AIコア_音声処理.ts`, `frontend_avatar/src/AiDiy.vue`

## このメモを使う場面
- マイク入力、スピーカー出力、ビジュアライザー、口パク連動を変更する
- 音声が出ない / マイクが使えない / AI 音声が二重に聞こえる問題を調査する
- 音声用 WebSocket と `AudioController` の責務分担を確認する

## 関連ファイル
- `frontend_avatar/src/components/AIコア_音声処理.ts` — `AudioController`
- `frontend_avatar/src/AiDiy.vue` — `AudioController` の生成と lifecycle
- `frontend_avatar/src/components/AIコア.vue` — マイク / スピーカー UI、audio socket 接続
- `frontend_avatar/src/components/AIコア_アバター.vue` — 出力レベルを使う口パク、ビジュアライザー連携
- `backend_server` 側の AIコア WebSocket 実装 — `input_audio` / `output_audio` / `cancel_audio`

## 位置づけ

音声処理のナレッジはこのファイルに集約する。
`AudioController` 単体の入力、出力、エコー抑制、ビジュアライザー調整もここを入口にし、WebSocket パケット形式や backend 側 Live AI 初期化との接続まで同時に確認する。

## 主な仕様

| 項目 | 値 |
|------|-----|
| 入力サンプルレート | 通常 16kHz（`inputSampleRate = 16000`）。モデル名に `openai` を含む場合は 24kHz |
| 出力サンプルレート | 24kHz（`outputSampleRate = 24000`） |
| ビジュアライザーバンド数 | 32（`VISUALIZER_BAR_COUNT = 32`） |
| 音声送信チャンネル | `input_audio`（`audioSocket` 経由） |

## 責務分担
- `AIコア.vue` が `AIWebSocket(AI_WS_ENDPOINT, sessionId, 'audio')` を生成する。
- `output_audio` は `AudioController.handleAudioMessage()` へ渡す。
- `cancel_audio` は `AudioController.cancelOutput({ resetLevel: false })` へ渡す。
- `AudioController` は PCM 変換、再生キュー、レベル計測、ビジュアライザーに集中する。
- 接続状態、マイク ON/OFF、スピーカー ON/OFF の UI 状態は `AIコア.vue` が管理し、`AudioController` へ反映する。

音声は高頻度送信なので、通常のテキスト入力ソケットと分ける。`input_audio` を通常入力へ混ぜると、テキスト入力や状態制御が遅延しやすい。

## マイク入力
- `getUserMedia({ audio: { echoCancellation, noiseSuppression, autoGainControl } })` を使う。
- `AudioContext({ sampleRate: 16000 })` と `ScriptProcessorNode(1024, 1, 1)` で入力を受ける。
- スピーカー出力中は `currentSpeakerLevel` を使ってエコー抑制をかける。
- Float32 を 16bit PCM に変換し、Base64 化して送信する。
- 送信 payload は `メッセージ内容: 'audio/pcm'`, `チャンネル: 'audio'`, `ファイル名: <base64>` の形式に合わせる。

入力処理の順序は `getUserMedia` → `AudioContext` → `ScriptProcessorNode` → エコー抑制 → PCM16 変換 → `input_audio` 送信と見る。
順序を変える場合は、音量レベル、payload 互換性、マイク入力遅延を同時に確認する。

## AI 音声出力
- `output_audio` の Base64 音声をキューに積む。
- PCM の場合は `createPcmAudioBuffer()`、それ以外は `decodeAudioData()` を試す。
- `nextPlaybackTime` でチャンクを連続再生し、チャンク間の途切れを抑える。

Gemini / FreeAI の native-audio モデルでは、`backend_server/AIコア/AIライブ_gemini.py` の
`LiveConnectConfig` に `output_audio_transcription` を指定し、`server_content.output_transcription.text` を受け取る。
字幕は `turn_complete` または `interrupted` でまとめてテキスト受信キューへ渡し、`AIライブ.py` がチャンネル0の `output_text` として通知する。
`model_turn.parts.text` だけを監視すると音声回答の文字を受け取れない。
`model_turn.parts` の `thought=True` は内部推論なので、会話の回答や字幕へ転送しない。
字幕対応 LiveAI の出力音声は `AI音声処理.py` でローカル音声認識へ再投入せず、二重表示を避ける。
[Google の音声字幕仕様](https://ai.google.dev/gemini-api/docs/live-api/capabilities#audio-transcriptions)を参照する。

### Gemini / FreeAI Liveの無応答を調べる

接続済み・準備完了を確認して15秒待機し、初回送信後は最大60秒観測する。画面の実回答と、既存のCoreログの接続・送受信エラーを照合する。送信受付や入力エコーだけでは回答成功にしない。

FreeAIはGeminiの無料枠を利用する方式である。FreeAIの試験で応答がない場合は、対応するGeminiへ画面で切り替えて同等の処理を試験し、Geminiで正常応答を確認できれば試験全体をPASSとしてよい。利用枠制限の明示エラーは代替通過判定の必須条件にしない。Liveでは同じ `AIライブ_gemini.py` を使い、標準の15秒待機・最大60秒観測で確認する。

切替前後のプロバイダ・モデルと結果を残し、「Geminiによる代替試験でPASS」と記録する。FreeAI自体の応答成功や利用枠制限の原因確定とは区別する。これは試験の手動切替・判定方針であり、通常動作の自動フォールバックは追加しない。通常処理に送信時間・受信件数・文字数・音声バイト数などの調査用計測や進捗ログは追加しない。

`受信ワーカー:終了` と `live_session破棄完了` は終了状態のINFOログで、実際の接続・受信例外は別のERRORログに残る。経過時間は受信ワーカー内で計測し、キャンセル時にも未定義変数による例外で上書きしない。外部AIを呼ばない確認は `backend_server/.venv/Scripts/python.exe -m unittest discover -s backend_server/checks -p test_live_gemini_lifecycle.py -v` で行う。

### 接続準備中の送信とエラー通知

接続準備中はプロバイダーの `is_alive` が `False` のため、この値だけでテキスト送信を拒否しない。
明示的な停止は `中断停止フラグ` で判定し、接続準備中の送信は Gemini / OpenAI の `テキスト送信()` 内の最大5秒の接続待ちを通す。
送信失敗の共通案内は接続状態の確認と再接続を促す。APIキー未設定が原因とは限らない。
送信が拒否された場合や LiveAI が停止中の場合は、`AIライブ.py` がチャンネル0へ `error` を返す。
`!` だけの応答は画面で隠れるため、送信失敗の通知には使わない。
OpenAI Realtime の `error` イベントは `AIライブ_openai.py` が `error` / `code` をテキスト受信キューへ入れ、`AIライブ.py` がチャンネル0の `error` と `エラーコード` へ変換する。
`response.done` の `status=failed` も `status_details.error` を同じ経路へ渡す。失敗応答からツールを実行したり、保留中の `response.create` を自動で再送したりしない。WebSocket接続自体が失敗した場合も、HTTP応答のJSONエラー、またはHTTP状態・例外名を通知する。応答ヘッダー・HTML全体は表示せず、APIキーを伏せ字にする。
`aidiy_live` と `aidiy_discord` の音声会話はこの処理を共用する。ただしDiscordパネルのBotログイン失敗はOpenAI接続前の別段階であり、同じ原因と決めつけない。Windowsでの原因調査はそのPCの画面とCoreログを確認する。
`credit_balance_exhausted` は APIクレジット残高なしとして案内し、`insufficient_quota` 系は残高・利用上限の確認を促して自動再接続を停止する。後続の送信でも拒否理由を保持し、共通の送信エラーで上書きしない。
原因の確認は [OpenAI公式エラーコード](https://developers.openai.com/api/docs/guides/error-codes) を参照する。キーの認証やモデル確認が成功しても、Realtime 接続が残高不足で拒否される場合がある。
OpenAI のツール呼び出しは `response.done` の `completed` 応答に含まれる確定済みの `function_call` を実行する。
`response.function_call_arguments.done` は応答全体の終了ではないため、ここで `response.create` を送ると `conversation_already_has_active_response` が発生する。
複数の呼び出しは全ての `function_call_output` を返してから1回だけ応答を開始する。ツール実行中も受信を継続し、追加入力の応答開始は現在の応答とツール処理が終わるまで待つ。
音声の自動応答と開始要求が競合した場合、このエラーだけは再接続せず、`response.done` 後に開始要求を再送する。停止・切断時はツール処理をキャンセルする。
[OpenAI の Realtime ツール呼び出し仕様](https://developers.openai.com/api/docs/guides/realtime-conversations#function-calling)を参照する。
OpenAIの切断では、ワーカーをキャンセルするだけでなく、外側の `finally` でWebSocketを閉じる。接続中の `asyncio.to_thread` はキャンセルしてもスレッドが止まらないため、`_WebSocket接続` で完了を待って遅れて返ったソケットも閉じる。通常切断と接続準備中の切断を両方検証し、次の会話へ接続を残さない。
OpenAI の切断には専用の自動テストがないため、通常切断と接続準備中の切断を実接続で確認する。Gemini Live の終了・受信待ちは `backend_server/checks/test_live_gemini_lifecycle.py` で確認できる。
- スピーカー OFF でもビジュアライザー用の再生系を残す設計があるため、実音と視覚演出を分けて確認する。
- キャンセル後に古いチャンクを再生しないよう、キュー世代管理を確認する。

## エコー抑制とビジュアライザー
- エコー抑制は `currentSpeakerLevel` が閾値を超える場合だけ適用する。
- 抑制係数を強くすると AI 音声の回り込みは減るが、人の発話も削れやすい。
- 入力スペクトラムは `inputAnalyser.getByteFrequencyData()`、出力スペクトラムは `visualizerAnalyser.getByteFrequencyData()` を使う。
- `onInputLevel` / `onOutputLevel` / `onInputSpectrum` / `onOutputSpectrum` の連携先を変更する場合は、`AIコア.vue` と `AIコア_アバター.vue` をセットで確認する。
- 口パクは出力レベルを使うため、音を止める修正と視覚演出を止める修正を混同しない。

## キャンセル処理

`cancelOutput()` はキューを破棄し、再生中ソースを短くフェードアウトして停止する。

- 連続キャンセルでゲイン復元が競合しないよう `fadeOutTimer` を見る。
- 停止対象は `speakerSources` と `visualizerSources` の両方を確認する。
- `cancel_audio` 受信後に古いキューが再開しないことを確認する。

## よくある問題と対処

| 現象 | 主な原因 | 確認箇所 |
|------|----------|----------|
| 音声が出ない | スピーカー OFF | `AIコア.vue` のスピーカートグル |
| 音声が出ない | `AudioContext` 未 resume | 初回ユーザー操作後の `audioContext.resume()` |
| 音声が出ない | audio socket 未接続 | `audioSocket` の接続状態 |
| マイクが使えない | Electron 権限 | `main.ts` の `session.setPermissionRequestHandler` |
| マイクが使えない | audio socket 未接続 | `audioSocket` の接続状態 |
| AI 音声が二重に聞こえる | 古い socket / controller が残っている | `音声接続世代`, `cleanup()`, `disconnect()` |
| 口パクだけ動いて音が出ない | スピーカー OFF だが visualizer は動いている | `speakerEnabled`, `visualizerSources` |
| マイクが AI 音声を拾う | エコー抑制や出力レベル処理の戻りが早い | `currentSpeakerLevel`, fade out 処理 |

## 変更時の注意点
- `AudioContext` はブラウザの自動再生制限を受ける。初回クリック後に resume する経路を維持する。
- 音声送信はトークン延長対象から外す。高頻度送信で認証延長 API を叩かない。
- 音声モデル変更時は frontend の同期だけでなく、backend の Live AI 初期化タイミングも確認する。
- `ScriptProcessorNode` を変更する場合は、入力サンプルレート、PCM 変換、Base64 payload の互換性を見る。
- 再生キューの停止処理を追加するときは、実音、ビジュアライザー、口パクのどれを止めるかを分けて考える。

## 確認方法
1. マイク ON で入力レベルと入力スペクトラムが動く。
2. AI 発話で出力レベルと出力スペクトラムが動く。
3. スピーカー OFF で実音は止まり、必要な視覚演出だけ残る。
4. `cancel_audio` 受信時に即時停止し、キューが再開しない。
5. Electron と Web の両方で、初回クリック後に `AudioContext` が resume する。
6. DevTools Console で AudioController 関連のエラーがないことを確認する。
