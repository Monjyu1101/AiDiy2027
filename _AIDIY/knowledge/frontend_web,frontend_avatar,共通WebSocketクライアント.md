# 共通 WebSocket クライアント

> 文書: `frontend_web,frontend_avatar,共通WebSocketクライアント.md` | 実装: `frontend_web/src/api/websocket.ts`, `frontend_avatar/src/api/websocket.ts`, `frontend_avatar/src/api/config.ts`

## このメモを使う場面

- WebSocket 接続・切断・再接続の挙動を確認するとき
- AIコアとのパケット送受信形式を確認するとき
- `AIWebSocket` class に新しいメソッドを追加するとき
- 両プロジェクトで WebSocket 実装を同期するとき

## クラス構成

両者とも `AIWebSocket` class（別名 `AIコアWebSocket`）が WebSocket 接続を管理します。

```
AIWebSocket (implements IWebSocketClient)
  ├── connect()      → Promise<string>  (セッションIDを返す)
  ├── send()         → void
  ├── on() / off()   → メッセージハンドラ登録・削除
  ├── disconnect()   → void
  ├── sendPing()     → void
  ├── sendInputText()→ void
  └── updateState()  → void
```

## 共通の接続フロー

```text
1. new AIWebSocket(url, セッションID?, ソケット番号?, codeBasePath?)
2. connect() → WebSocket 接続
3. 接続確立 → { type: "connect", セッションID, ソケット番号, CODE_BASE_PATH? } を送信
4. サーバー応答 → { type: "init", セッションID, ソケット番号 } → Promise resolve
5. 以降は on() で登録したハンドラがメッセージを受信
```

`onopen` では `connect` パケットを送信してから `onStateChange(true)` を通知する。状態ハンドラが操作状態を同期するため、先に通知すると `operations` がサーバーの初回受信になり、その後の `connect` が「不明なメッセージ識別: None」になる。初回接続・再接続の送信順序は `node --test frontend_avatar/checks/websocket-handshake.test.cjs` で確認する。

## 音声セッションのプロジェクトフォルダ

Web／Avatar の親画面は `core` の初期化情報から `モデル設定.CODE_BASE_PATH` を保持し、AIコアの `codeBasePath` prop へ渡します。音声接続は `new AIWebSocket(url, sessionId, 'audio', codeBasePath)` で作成し、初回・再接続とも `connect` パケットに `CODE_BASE_PATH` を含めます。未指定時は従来のセッション設定を使用します。

バックエンドは `init` を返す前にフォルダを確定し、LiveAI とコードエージェントの初期化に使用します。既存セッションと異なるフォルダや、バックエンドから参照できないフォルダは `error` 通知と切断コード `1008` で拒否します。Web／Avatar のフォルダ選択は既存のモデル設定画面を使い、設定後の音声接続でも同じ値を渡してください。

## 共通の再接続ポリシー

| 項目 | 値 |
|------|-----|
| 最大再試行回数 | 5 |
| 再試行間隔 | 3 秒 |
| 切断条件 | reconnectAttempts >= maxReconnectAttempts |
| 意図的切断 | `isIntentionallyClosed` / `intentionallyClosed` フラグで判定 |

## メッセージディスパッチ

`on(messageType, handler)` で登録されたハンドラは以下の順で実行されます:

1. チャンネル別ハンドラ: `${messageType}_${チャンネル}`
2. 通常ハンドラ: `messageType`
3. 汎用ハンドラ: `*`

## WebSocket URL 生成

### frontend_web

`createWebSocketUrl(path)` 関数で window.location から動的生成:

```typescript
export function createWebSocketUrl(path: string): string {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.hostname
    const port = window.location.port
    return `${protocol}//${host}:${port}${path}`
}
```

Vite proxy を経由するため、`/core/ws/AIコア` と指定すれば 8091 へ転送されます。

### frontend_avatar

config.ts で `AI_WS_ENDPOINT` を解決。`/core/ws/AIコア` の場合は特別にこの定数を使います:

```typescript
export function createWebSocketUrl(path: string): string {
    if (path === '/core/ws/AIコア') {
        return AI_WS_ENDPOINT  // 環境変数 or window.location から解決
    }
    // それ以外は frontend_web と同じ動的生成
}
```

`AI_WS_ENDPOINT` の優先順:
1. `VITE_CORE_WS_URL` 環境変数
2. window.location から生成（Vite proxy 経由）
3. `ws://127.0.0.1:8091/core/ws/AIコア`（フォールバック）

## パケット形式

```typescript
interface WebSocketMessage {
    セッションID?: string
    ソケット番号?: string
    チャンネル?: string | null
    出力先チャンネル?: string
    メッセージ識別?: string    // 実質 type と同じ
    type?: string
    メッセージ内容?: unknown
    ファイル名?: string | null
    サムネイル画像?: string | null
    [key: string]: unknown
}
```

### 認証延長

両者とも `input_text`, `input_file`, `input_image`, `input_request` の送信時にトークン延長を試みます。

```typescript
const 認証延長対象メッセージ識別 = new Set(['input_text', 'input_file', 'input_image', 'input_request'])
```

- **frontend_web**: `useAuthStore().refreshToken()` を呼ぶ
- **frontend_avatar**: `apiClient.post('/core/auth/トークン更新')` を直接呼び出し

## 実装差分

| 項目 | frontend_web | frontend_avatar |
|------|-------------|-----------------|
| ソケット変数名 | `ws` | `socket` |
| ハンドラ保存 | `Map<string, MessageHandler[]>` | `Map<string, Set<MessageHandler>>` |
| init タイムアウト | setTimeout 30s + 別途 reject | setTimeout 30s（より堅牢な二重実行ガード） |
| エラーログ | `console.error` 詳細 | 最小限 |
| sendChatMessage | 非推奨（warning 出力） | `sendInputText(message, '0')` に委譲 |
| requestStream | 非推奨（warning 出力） | 未使用（warning 出力） |

frontend_avatar の実装の方が後続でリファクタリングされており、コードがより簡潔です。frontend_web に古い非推奨メソッドが残っています。

## 両方に修正を加えるべきケース

以下の変更は必ず両方の `websocket.ts` を修正してください:

1. 再接続ポリシーの変更（最大試行回数、間隔）
2. 接続フロー（connect → init のシーケンス）
3. メッセージディスパッチのロジック
4. 認証延長の対象メッセージ識別
5. WebSocket URL 生成方式
6. 新しいメソッドの追加（interface 拡張含む）

interface `IWebSocketClient` と class `AIWebSocket` は両方で維持するため、片方だけの変更は非互換を生む可能性があります。
