# AIコア WebSocket 仕様

> 文書: `backend_server,frontend_avatar,frontend_web,AIコアWebSocket仕様.md` | 実装: `frontend_avatar/src/api/websocket.ts`, `frontend_avatar/src/AiDiy.vue`, `backend_server/AIコア/`

## このメモを使う場面
- AIコアの WebSocket 接続、再接続、セッション復元を調査する
- `input_text`、`input_audio` などの送受信形式を確認する
- Electron 補助ウィンドウや Web モードでセッション状態が同期されない原因を切り分ける

## 関連ファイル
- `frontend_avatar/src/api/websocket.ts` — WebSocket クライアント
- `frontend_avatar/src/AiDiy.vue` — コア/入力ソケット、BroadcastChannel、パネル状態
- `frontend_avatar/src/components/AIコア.vue` — 音声ソケット生成
- `backend_server/core_router/AIコア.py` — WebSocket エンドポイント
- `backend_server/AIコア/AIセッション管理.py` — セッションとモデル設定
- `frontend_avatar/src/api/config.ts` — `AI_WS_ENDPOINT`

## 接続仕様

エンドポイントは `ws://<host>/core/ws/AIコア`。Vite 開発時は frontend の host から生成され、Proxy 経由で backend `8091` へ転送される。

| ソケット番号 | 主な生成箇所 | 用途 |
|-------------|-------------|------|
| `0` | `AiDiy.vue` | AI出力受信、状態制御 |
| `1` | `AiDiy.vue` | テキスト、画像、ファイルなどの入力 |
| `audio` | `AIコア.vue` | `input_audio` 送信、`output_audio` / `cancel_audio` 受信 |
| `chat` / `file` / `code1`〜`code6` | 各パネル | パネル別の出力受信 |

接続時は WebSocket open 後に `{ type: "connect", セッションID, ソケット番号, CODE_BASE_PATH?, モデル設定?, voice? }` を送信し、サーバーから `{ メッセージ識別: "init", セッションID: "<確定ID>" }` を受けて sessionId が確定する。`connect()` を await せずに送信しない。

Avatar / Web の音声接続は、core ソケットの `init` に含まれるモデル設定と `CODE_BASE_PATH` が反映されてから開始する。WebSocket の `open` だけで入力接続済みにすると、既存セッションの復元時に空のフォルダ指定で音声接続し、設定受信後に再接続するため、Live の準備通知が二重になる。

接続待ちの音声ソケットも保持し、フォルダ変更・切断・画面破棄時に閉じる。旧ソケットの遅延イベントで新しい接続状態を上書きしない。接続順序と競合の検証は、Avatar の依存関係を導入した環境で `node --test frontend_avatar/checks/audio-connection.test.cjs` を実行する（リポジトリルートから）。

## セッション単位の音声利用

独立した AiDiy (Code) の `input` / `1` 接続は、`connect.voice: false`（JSON の真偽値）を送信する。バックエンドはこのセッションで Live / Recognition / 音声バッファ / 音声分離タスクを作らず、音声入力と Live 起動も行わない。コード要求と会話履歴はそのまま利用する。

- 新規接続で `voice` を省略すると従来どおり有効になる。既存セッションでは省略時に保存済みの値を引き継ぐ。
- 接続中のセッションへ異なる値を指定した場合、`error` と切断コード `1008` で拒否する。後から接続したソケットで Web / Avatar の共有音声を止めない。
- 全ソケットが切断済みの場合だけ、実行中タスクを停止して明示指定へ切り替えられる。セッションID、ボタン、モデル設定、会話履歴は引き継ぐため、以前の Code 会話も継続できる。
- 音声無効セッションの `audio` ソケットは受け付けない。音声利用を再開する場合は、全接続を閉じて `voice: true` で接続するか、新しいセッションを作る。
- Web / Avatar 内のコード画面は音声セッションを共有するので、このフラグを変更しない。Live および Discord の Live 接続も従来の省略時動作を維持する。

モデル設定APIは、Liveモデル・音声・プロジェクトフォルダが実際に変更され、音声が有効かつ `audio` が接続中の場合だけ Live を再開始する。Code設定だけの変更や同値の再送では Live を再起動しない。「保存(json書換)」だけの場合は実行中のセッションへ適用せず、その後の「適用」で変更を反映する。最後のソケット切断では音声認識・音声分離・ストリーミングのタスクも停止し、再接続時に再作成する。旧ソケットの切断通知は置き換え済みの新ソケットに適用しない。

ローカル回帰確認（外部AIへの接続なし）:

```bash
backend_server/.venv/bin/python -X utf8 -m unittest discover -s backend_server/checks -p 'test_live_*.py'
node --test frontend_ide/host/checks/code-connection.test.cjs
```

Python 側は Live の終了・受信待ち・送受信を検証する。モデル設定APIによる再開始条件と音声タスクの再作成には専用の自動テストがないため、実画面で設定変更・保存・適用・切断と再接続を確認する。

## 主要メッセージ形式

### AIチャット・AIコードのエラー応答

最終応答の本文は、`backend_server/AIコア/AI応答.py` の規約に揃えます。

| 本文 | 判定 |
|---|---|
| `!` | 無応答・詳細なしのエラー |
| `! エラーメッセージ` | 理由が分かるエラー。例：`! 実行エラー: 認証失敗` |
| 空文字・空白だけ | エラーとして扱い、送信時は `!` へ正規化 |
| `!`で始まる文字列 | 内容にかかわらずエラーとして扱う |

判定前に前後の空白を除きます。通常の返答の途中にある`!`はエラーにしません。`!`で始まる本文はエラー用に予約します。ストリームの途中の空断片には、この判定を適用しません。

WebSocketの`output_text`とMCPの`result`／`content`で同じ本文を返します。MCPではエラー応答の`status`も`NG`とし、Diagも空文字・`!`始まりを成功扱いしません。Code CLIは途中の回答があっても終了コードが0以外ならエラーとし、失敗後の検証・自己改善へ進みません。標準Chat Completionsの`tool_calls`だけの中間応答は、有効なツール要求なので空の`content`を許可します。

確認は外部AIへ接続せず、`backend_diag/checks/model-trials.check.mjs`で行います。Python 側の応答エラー整形・CLI出力振り分けには専用の自動テストがありません。変更の反映にはCoreとTools、Diagの再起動が必要です。

```typescript
// テキスト入力
{
  メッセージ識別: "input_text",
  メッセージ内容: "ユーザー入力",
  出力先チャンネル: "0",
  セッションID: "<id>",
}

// AI出力
{
  メッセージ識別: "output",
  チャンネル: "0",
  メッセージ内容: "AIの返答",
}

// 出力完了
{
  メッセージ識別: "output_end",
  チャンネル: "0",
}
```

AIコード.vue（Web / Avatar）は検証ループ回数を0〜3回から選択する（初期値1回）。コード送信の `input_text` に整数の `self_check_loop` を含め、`aidiy_code_agents` と同じパラメータ名を使う。0回はバックアップと検証ループを省略し、1〜3回は指定回数を上限に実行する（差分がなければ途中終了）。要求の回数指定を `CODE_SELF_CHECK_LOOP` より優先し、未指定・不正値なら従来のセッション設定を使う。WebSocket要求の数値は0〜3へ制限する。要求単位の指定なのでセッション設定は変更しない。Avatar は子コンポーネントの `submit` 第3引数を親の送信処理まで渡す。バックエンドの共通処理では `input_request` でも同じ指定が有効。

Code AI の `output_stream` は、本文と同じパケットの `メッセージ内容` に次の ASCII 制御値を入れて境界を通知する。制御値は1バイトだけで送り、LF (`0x0A`) を含めない。

| 状態 | `メッセージ内容` | バイト |
|------|----------------------|--------|
| 開始 | `STX` | `0x02` |
| 終了 | `ETX` | `0x03` |
| 中断・異常 | `CAN` | `0x18` |

制御値は表示文字列ではない。Web / Avatar は状態遷移にだけ使い、メッセージ本文、演出キュー、デバッグ表示へは追加しない。通常のストリーム本文は末尾の CR / LF を取り除いてから表示側で LF を1つ付け、二重改行を防ぐ。将来制御値を廃止するときは、backend の `AIストリーム制御.py` と frontend の `AIストリーム制御.ts` を入口にする。

音声は `audio` チャンネル専用に扱う。

接続維持用の `{ type: "ping" }` は、通常の `メッセージ識別` を持つパケットより先に処理する。バックエンドは受信したソケットへ `{ type: "pong", セッションID: "<確定ID>" }` を返し、AI処理や会話履歴へ渡さない。VS Code Live / Web / Avatar はJSON形式、現行DiscordはWebSocket制御フレームのpingを使うため、両者を区別する。`不明なメッセージ識別: None data={"type":"ping", ...}` はバックエンドのJSON heartbeat受け口を確認する。pong応答後も音声処理が続くことは、専用の自動テストがないため実接続で確認する。

```typescript
// マイクPCM送信
{
  チャンネル: "audio",
  メッセージ識別: "input_audio",
  メッセージ内容: "audio/pcm",
  ファイル名: "<base64 PCM>",
  サムネイル画像: null,
}

// AI音声受信
{
  メッセージ識別: "output_audio",
  チャンネル: "audio",
  メッセージ内容: "audio/pcm",
  ファイル名: "<base64 PCM>",
}

// 音声停止
{
  メッセージ識別: "cancel_audio",
  チャンネル: "audio",
}
```

## セッションと状態共有

- Electron は `localStorage`、Web は `sessionStorage` に `token` / `user` / `avatar_session_id` を保持する
- Web モードは URL の `?セッションID=` も参照し、リロード復帰しやすくする
- Electron 補助ウィンドウは BroadcastChannel `avatar-desktop-sync` の snapshot で sessionId と状態を受け取る
- 401 時は `apiClient` が認証情報を削除し、`auth-expired` イベント経由でログインへ戻す

パネル状態を追加する場合は、`SharedSnapshot` 型、`buildSnapshot()`、受信側反映処理、Electron の `WindowRole` / `PanelKey` をセットで確認する。

## トークン延長ルール

送信前に `/core/auth/トークン更新` を呼ぶ対象:
- `input_text`
- `input_file`
- `input_image`
- `input_request`
- AIファイル `files_temp`

延長しない対象:
- `input_audio`（高頻度送信のため）
- `operations`
- `cancel_run`
- `cancel_audio`

## 注意点

- sessionId は `init` 受信後に確定する
- 明示的に `disconnect()` すると自動再接続は止まる
- Electron と Web で Storage が違うため、調査時は実行モードを先に確認する
- Vite 開発時の Network では `8092/core/ws/...` に見えても、実体は Proxy 先の `8091` で処理される
- Code AI パネルは現行 `code1`〜`code6` 前提。実装確認は `frontend_avatar/src/AiDiy.vue`、`frontend_web/src/components/AiDiy/AiDiy.vue`、`backend_server/core_router/AIコア.py` を見る

## 確認方法

- ブラウザ DevTools の Network で WebSocket frames を確認する
- 接続直後に `connect` 送信と `init` 受信が見えることを確認する
- 音声調査では `audio` チャンネルに `input_audio` / `output_audio` / `cancel_audio` が流れることを確認する

## 接続時のプロジェクト指定

`connect` の `CODE_BASE_PATH` は任意指定です。新規セッションでは `init` 通知・バックアップ・LiveAI／CodeAI 初期化より先にセッションのフォルダへ反映し、共通設定ファイルは変更しません。既存セッションでは同じフォルダを指定してください。相対パスは `backend_server/` 基準で解決します。参照できないフォルダや既存セッションと異なるフォルダは `error` と切断コード `1008` で拒否します。

`aidiy_live` と `frontend_channels`（Live）は input／0／audio の接続時に作業フォルダを送信します。Web／Avatar は core 初期化情報の `モデル設定.CODE_BASE_PATH` を音声接続時に送信します。指定しない旧クライアントは従来のセッション設定を使用します。

Discordのaudio接続は `connect.Live準備確認: true` を指定し、ソケット登録の `init` に加えて `{ メッセージ識別: "live_ready", セッションID: "<確定ID>" }` を待つ。backendの `Live.待受準備確認()` がProviderの準備完了を確認してから同じaudioソケットへ返す。開始拒否・未設定キー・準備タイムアウトは `error` を返す。`Live準備確認` を指定しない接続は従来のinit方式を維持する。共有クライアントでは `waitForLiveReady: true` を指定した場合のみこの確認を使う。

確認: 専用の自動テストはありません。初期化通知前の反映、音声への引継ぎ、フォルダ不一致・存在しないフォルダの拒否、旧クライアント互換を実接続で確認します。

## 接続時の Live モデル指定

`connect.モデル設定` は任意のオブジェクトで、`LIVE_AI_NAME` と Gemini／FreeAI／OpenAI のモデル・音声キーのみを受け付けます。指定した値は `init` 通知・AI 初期化より先に新規セッションへ反映し、未指定・空文字の値は既定設定を使用します。共通設定ファイルには保存しません。既存セッションと異なるモデルを指定した場合は `error` と切断コード `1008` で拒否します。モデル変更は新規セッションで再接続してください。

Live のモデル選択では、接続前に `/core/AIコア/モデル情報/取得` へ空の `セッションID` を指定し、既定設定と候補を取得できます。セッションは作成せず、実際の接続時にフォルダと選択したモデルを渡します。接続中の変更時もこの同じ接続方式を使います。

初期モデル・音声の反映、未指定時の既定値、既存セッションのモデル不一致、接続前の候補取得は、専用の自動テストがないため実接続で確認します。
