# 共通 API クライアントパターン

> 文書: `frontend_web,frontend_avatar,共通APIクライアントパターン.md` | 実装: `frontend_web/src/api/client.ts`, `frontend_avatar/src/api/client.ts`, `frontend_avatar/src/api/config.ts`

## このメモを使う場面

- API クライアントに新しい interceptor を追加するとき
- 認証 token の付与・延長・削除の流れを確認するとき
- 401 エラーのハンドリングを変更するとき
- frontend_web と frontend_avatar で異なる挙動を統一・調整するとき

## Axios インスタンス

両プロジェクトとも Axios `create()` で client を生成します。

```typescript
const apiClient = axios.create({
    baseURL: '/',          // frontend_web: Vite proxy 前提
    // baseURL: CORE_BASE_URL,  // frontend_avatar: config.ts で動的解決
    headers: { 'Content-Type': 'application/json' },
})
```

| 項目 | frontend_web | frontend_avatar |
|------|-------------|-----------------|
| baseURL | `/` 固定 | `CORE_BASE_URL`（config.ts 解決） |
| 解決順 | — | 1. `VITE_CORE_BASE_URL` 環境変数 → 2. 開発時 `/` → 3. `http://127.0.0.1:8091` |

### Task / Team の境界

Task / Team は `frontend_ide` の独立アプリ `aidiy_task` / `aidiy_team` へ移設済みです。Web / Avatar の `client.ts` に `taskClient` / `teamClient` を追加せず、[Vue共通画面変更手順](./frontend_ide,Vue共通画面変更手順.md#task--team-の独立版avatarからの移設) で接続処理を確認します。両Vite設定にも `/task` / `/team` はありません。

## 共通構成

### リクエストインターセプター: Bearer token 付与

両者とも request interceptor で `Authorization: Bearer` を付与します。

```typescript
apiClient.interceptors.request.use((config) => {
    const token = ... // 取得方法は異なる
    if (token) {
        config.headers.Authorization = `Bearer ${token}`
    }
    return config
})
```

### レスポンスインターセプター: 401 ハンドリング

両者とも 401 を受け取ると認証情報を削除し、ログアウト状態へ遷移します。

```typescript
apiClient.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401) {
            // 認証情報削除 + ログアウト処理
        }
        return Promise.reject(error)
    }
)
```

## 差異点

### token 取得・保存

| 項目 | frontend_web | frontend_avatar |
|------|-------------|-----------------|
| token 取得 | `useAuthStore().token`（Pinia） | `authStorage.getItem('token')` |
| storage | `localStorage` 固定 | `window.desktopApi ? localStorage : sessionStorage` |
| token 更新 | `authStore.refreshToken()` | `apiClient.post('/core/auth/トークン更新')` を直接呼び出し |

### 操作系認証延長

| 項目 | frontend_web | frontend_avatar |
|------|-------------|-----------------|
| 延長タイミング | POST 送信前（`/core/C*`, `/core/V*`, `/apps/M*`, `/apps/T*`, `/apps/V*`） | なし（REST側では延長しない） |
| WebSocket 側延長 | `入力系認証トークン更新()` | `入力系認証トークン更新()`（両者ほぼ同一） |

### ログアウト後の遷移

- **frontend_web**: `router.push('/ログイン')`（Vue Router）
- **frontend_avatar**: `window.dispatchEvent(new Event('auth-expired'))`（イベント駆動）

## 両方に修正を加えるべきケース

以下の変更は必ず両方の `client.ts` を修正してください:

1. 認証ヘッダーの形式変更（`Bearer` → 他方式）
2. API パスの prefix 変更（`/core` → 他）
3. エラーハンドリングの追加（500 系の共通処理など）
4. タイムアウト値の変更
5. CSRF トークンなど新たなセキュリティヘッダーの追加
