# Vite プロキシ設定

> 文書: `frontend_web,frontend_avatar,backend_server,Viteプロキシ設定.md` | 実装: `frontend_web/vite.config.ts`, `frontend_avatar/vite.config.mts`

## このメモを使う場面
- フロントから API を呼ぶと CORS エラーになる
- Vite / backend のポートを変更する
- HTTP API と WebSocket のプロキシ経路を確認する

## 関連ファイル
- `frontend_web/vite.config.ts` — Web 用 Vite Proxy（port 8090）
- `frontend_avatar/vite.config.mts` — Avatar 用 Vite Proxy（port 8092）
- `frontend_web/src/api/client.ts` — `baseURL: '/'` 前提の Axios クライアント
- `frontend_avatar/src/api/config.ts` — `VITE_CORE_BASE_URL` / `VITE_CORE_WS_URL` の解決
- `frontend_avatar/src/api/client.ts` — `apiClient`（core）
- `backend_server/core_main.py` — CORS 許可リスト
- `backend_server/apps_main.py` — CORS 許可リスト
- `backend_taskteam/taskteam_proc/app.py` — CORS ミドルウェアなし（`/task` と `/team` はプロキシ経由前提）

## 開発時の経路

```text
ブラウザ → Vite dev server (8090/8092)
        → /core/* → backend core (8091)
        → /apps/* → backend apps (8098)
        → /mcp/*  → backend tools (8095)   ※ frontend_web のみ。prefix は rewrite で除去
```

- Web / Avatar の Task / Team 画面とメニューは削除済みです。単独アプリ `aidiy_task` / `aidiy_team` を使い、両Vite設定に `/task` / `/team` プロキシは設けません。
- 画面側では `/core/...`、`/apps/...` の相対URLだけを書く。
- backend の `http://127.0.0.1:8091` / `8098` / `8093` をコンポーネントへ直書きしない。
- 本番では Vite dev server がいないため、Nginx 等で同等の `/core` / `/apps` プロキシを用意する。

## proxy 設定の基準

```typescript
proxy: {
  '/core': { target: 'http://127.0.0.1:8091', changeOrigin: true, ws: true },
  '/apps': { target: 'http://127.0.0.1:8098', changeOrigin: true, ws: true },
  // frontend_web のみ。backend_tools は prefix を持たないため rewrite で除去する
  '/mcp':  { target: 'http://127.0.0.1:8095', changeOrigin: true,
             rewrite: (path: string) => path.replace(/^\/mcp/, '') },
}
```

- `ws: true` は WebSocket 転送に必要。AIコアの `ws://127.0.0.1:8090/core/ws/AIコア` も backend core へ転送される。
- `/core` / `/apps` の prefix は backend 側エンドポイントでも使うため、rewrite で削らない。
- `/mcp` は `frontend_web/vite.config.ts` にだけある。`frontend_avatar` は `/core` `/apps` の2経路。
- 現状 `frontend_web/src` から `/mcp` を呼ぶコードはない。手元検証用の経路として残っている。
- `frontend_avatar` は `strictPort: true`。WebSocket URL を host から動的生成するため 8092 固定が前提。

## 現行ポート

| 対象 | ポート |
|------|--------|
| `frontend_web` | 8090 |
| `frontend_avatar` | 8092 |
| `backend_server/core_main.py` | 8091 |
| `backend_server/apps_main.py` | 8098 |
| `backend_taskteam/taskteam_main.py` | 8093（`/task/*`、`/team/*`） |
| `backend_local/local_main.py` | 8096 |
| `backend_tools/tools_main.py` | 8095 |

Task / Team は `frontend_ide` の独立アプリが担当します。接続・内部認証は [Vue共通画面変更手順](./frontend_ide,Vue共通画面変更手順.md) を参照し、Web / Avatar に旧プロキシを復活させないでください。

## ポート変更時の手順
1. `frontend_web/vite.config.ts` または `frontend_avatar/vite.config.mts` の `server.port` を更新する。
2. `backend_server/core_main.py` / `apps_main.py` の CORS origins にフロントの新URLを追加する。
3. 固定URLを参照している表示部品（例: `_TopBar.vue` のサーバー状態表示）を確認する。
4. `frontend_avatar` で明示 URL を使う場合は `VITE_CORE_BASE_URL` / `VITE_CORE_WS_URL` も更新する。
5. ブラウザの origin が変わるため、保存済み token / localStorage / sessionStorage を確認する。

```python
origins = [
    "http://127.0.0.1:8090",
    "http://127.0.0.1:8092",
    "http://127.0.0.1:5173",
]
```

## Avatar の接続先解決

`frontend_avatar/src/api/config.ts` ではRESTとWebSocketを別々に解決します。

- REST: `VITE_CORE_BASE_URL` → 開発時 `/` → 本番 `http://127.0.0.1:8091`。
- WebSocket: `VITE_CORE_WS_URL` → ページがHTTP(S)なら同じhostの `/core/ws/AIコア`（HTTPSならwss）→ それ以外は `ws://127.0.0.1:8091/core/ws/AIコア`。
- TaskTeam用の環境変数・クライアントはAvatarにはありません。

Electron と Web で同じ proxy 前提にできるよう、明示 URL を増やす場合は両モードで確認する。

## 注意点
- CORS エラーではまず `core_main.py` / `apps_main.py` の許可リストを見る。
- `localhost` と `127.0.0.1` はブラウザ上の origin が別。CORS、Storage、ログイン状態で混同しない。
- Vite dev server を介さず `http://127.0.0.1:8091/core/...` へ直アクセスすると、Origin 条件が通常の画面確認と変わる。
- 静的X系の `public/<画面名>/index.html` は Vite がそのまま配信する。404 の場合は proxy ではなく `public` パス、`BASE_URL`、日本語URLエンコードを疑う。

## 確認方法

```powershell
cd frontend_web
npm run dev
Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8090/core/サーバー状態'
```

- DevTools Network で `OPTIONS` が 200 を返すか、`Access-Control-Allow-Origin` が付くかを確認する。
- `/apps` は POST 中心なので、ログイン後に既存画面の `/apps/V商品/一覧` などを Network で確認する。
- WebSocket は AIコア画面で `101 Switching Protocols` または接続済み状態を確認する。
