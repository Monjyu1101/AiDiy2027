# frontend_avatar

`frontend_avatar` は、**Electron デスクトップアプリ** と **通常ブラウザ** の両方で動く AI コア専用クライアントです。

## 前提

- `backend_server`（`8091` / `8098`）が起動していること
- Task / Team は独立アプリ `aidiy_task` / `aidiy_team` を使用します。Avatar 内には画面・起動メニューを持ちません。
- Claude 系のブラウザ自動操作まで使う場合は `backend_tools`（`8095`）も起動していること

## 開発起動

```powershell
cd frontend_avatar
npm install
npm run dev
```

`npm run dev` で次が起動します。

- Vite 開発サーバー: `http://127.0.0.1:8092`
- Electron メインプロセス
- Electron アプリ本体

## Web モード

ブラウザからは次で確認できます。

```text
http://127.0.0.1:8092
```

## 主な構成

- `src/AiDiy.vue` : renderer 側のメインエントリ
- `src/components/` : ログイン、AIコア、チャット、ファイル、イメージ、コード
- `src/dialog/` : AI設定再起動などのダイアログ
- `electron/main.ts` : Electron メインプロセス
- `electron/preload.ts` : preload
- `src/api/config.ts` : API / WebSocket / VRM 設定

## 接続先

- Core API / WebSocket: `http://127.0.0.1:8091` / `ws://127.0.0.1:8091/core/ws/AIコア`
- Apps API: `http://127.0.0.1:8098`
- Backend MCP（Windows は19、Linux / macOS は18サーバー）: `http://127.0.0.1:8095/`（一覧）、`http://127.0.0.1:8095/{mcp_name}/sse`（SSE 接続）

## 補足コマンド

```powershell
cd frontend_avatar
npm run type-check
```

## ビルド

```powershell
cd frontend_avatar
npm run build
npm run start
```

注意:

- `npm run build` は `dist` / `dist-electron` を生成します。
- 通常の調査や開発では `npm run dev` / `npm run type-check` を優先してください。
