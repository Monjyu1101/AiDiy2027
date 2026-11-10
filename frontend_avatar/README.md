# frontend_avatar

`frontend_avatar` は、**Electron デスクトップアプリ** と **通常ブラウザ** の両方で動く AI コア専用クライアントです。

## 前提

- AIコアの利用には `backend_server` の Core（`8091`）が起動していること。Apps（`8098`）への開発用プロキシも定義されていますが、Avatar の REST client は Core を使用します。
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

## IDEからの単独Avatar

IDEから起動するAvatarは選択プロジェクトを引き継ぎ、内部認証でChat（0番会話）・Code1〜6・File・Capture・設定を使用できます。Chatは同じセッション・プロジェクトの会話を表示・送信します。Fileの閲覧・保存先とCapture画像の `temp/input/` はそのプロジェクト内に限定します。内部認証情報はElectronのメインプロセスだけで扱います。画面収録に必要なOSの許可は利用者が行ってください。IDE終了またはAvatar本体終了では、その起動が所有する子窓・プロセスを停止します。別に起動済みのAvatarを再利用した場合や共有Coreサーバーは停止対象外です。Codeの実行権限は既存の許可設定に従います。

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

- 開発時は `http://127.0.0.1:8092` の `/core/*` と `/core/ws/AIコア` を Vite が Core `8091` へ転送します。`/apps/*` は Apps `8098` へ転送します。
- 配布版の REST は既定で `http://127.0.0.1:8091`。WebSocket は HTTP(S) 表示時に同じ公開元の `/core/ws/AIコア`、`file:` 表示時に `ws://127.0.0.1:8091/core/ws/AIコア` を使います。`VITE_CORE_BASE_URL` / `VITE_CORE_WS_URL` で変更できます（`src/api/config.ts`）。
- Backend MCP（Windows は20、Linux / macOS は19サーバー）: `http://127.0.0.1:8095/`（一覧）、`http://127.0.0.1:8095/{mcp_name}/sse`（SSE 接続）

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
