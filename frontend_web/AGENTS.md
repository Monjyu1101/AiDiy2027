# frontend_web 実装概要

## 本書の目的

このファイルは `frontend_web` の構成、設計方針、実装入口を示す概要ドキュメントです。
画面追加、qTubler、明細型編集、UI 統一ルール、開発コマンド、デバッグは `_AIDIY/knowledge` に移動しています。
AI エージェントは、本書に個別手順や一時的な作業メモを追記しないでください。
業務システム機能追加は `../docs/` の開発ガイドを優先し、コアシステム機能調整は `../_AIDIY/knowledge/_index.md` を入口にします。

## HowTo 参照先

| 目的 | 参照先 |
|------|--------|
| frontend_web の実装パターン、UI ルール、qTubler、明細型編集 | [`../_AIDIY/knowledge/frontend_web,画面追加手順.md`](../_AIDIY/knowledge/frontend_web,画面追加手順.md) |
| 業務画面追加 | [`../_AIDIY/knowledge/frontend_web,画面追加手順.md`](../_AIDIY/knowledge/frontend_web,画面追加手順.md) |
| X系静的画面 / ゲーム / デモ追加 | [`../_AIDIY/knowledge/frontend_web,X系静的画面追加.md`](../_AIDIY/knowledge/frontend_web,X系静的画面追加.md) |
| Vite proxy / CORS / ポート | [`../_AIDIY/knowledge/frontend_web,frontend_avatar,backend_server,Viteプロキシ設定.md`](../_AIDIY/knowledge/frontend_web,frontend_avatar,backend_server,Viteプロキシ設定.md) |
| JWT 認証 | [`../_AIDIY/knowledge/backend_server,frontend_web,frontend_avatar,JWT認証フロー.md`](../_AIDIY/knowledge/backend_server,frontend_web,frontend_avatar,JWT認証フロー.md) |
| 認証延長 | [`../_AIDIY/knowledge/backend_server,frontend_web,frontend_avatar,JWT認証フロー.md`](../_AIDIY/knowledge/backend_server,frontend_web,frontend_avatar,JWT認証フロー.md) |
| AI コア WebSocket | [`../_AIDIY/knowledge/backend_server,frontend_avatar,frontend_web,AIコアWebSocket仕様.md`](../_AIDIY/knowledge/backend_server,frontend_avatar,frontend_web,AIコアWebSocket仕様.md) |
| AI モデル設定 | [`../_AIDIY/knowledge/backend_server,frontend_avatar,frontend_web,AIモデル設定変更手順.md`](../_AIDIY/knowledge/backend_server,frontend_avatar,frontend_web,AIモデル設定変更手順.md) |
| Pinia Store パターン | [`../_AIDIY/knowledge/frontend_web,Pinia Storeパターン.md`](../_AIDIY/knowledge/frontend_web,Pinia Storeパターン.md) |
| Vue Router パターン | [`../_AIDIY/knowledge/frontend_web,Vue Routerパターン.md`](../_AIDIY/knowledge/frontend_web,Vue Routerパターン.md) |
| 開発環境起動、type-check、よくある問題 | [`../_AIDIY/knowledge/共通,開発環境運用手順.md`](../_AIDIY/knowledge/共通,開発環境運用手順.md) |

## 概要

`frontend_web` は AiDiy の通常 Web UI です。
管理画面、マスタ、トランザクション、ビュー、スケジューラ、AIコア、X系デモを提供します。

## 技術スタック

- Vue 3。
- Vite。
- TypeScript。
- Vue Router。
- Pinia。
- Axios。
- dayjs。
- Monaco Editor。
- qTubler 独自テーブル。

## 基本方針

- 日本語ファイル名、日本語 route、日本語 JSON key を使う。
- template の component tag は ASCII にする。
- 日本語 component は import して `<component :is="...">` で扱う。
- UI framework / CSS framework は使わず、既存 CSS と共有コンポーネントへ合わせる。
- API は `/core/*`、`/apps/*` を Vite proxy 経由で呼ぶ。
- ビルドや type-check の実行判断は `開発環境運用手順.md` を確認する。
- TypeScript は strict mode 無効の設定で運用しているが、既存型定義を使い、不要な `any` の拡大は避ける。

## ファイル構成

| パス | 役割 |
|------|------|
| `src/main.ts` | Vue app 初期化 |
| `src/App.vue` | root component |
| `src/router/` | Vue Router |
| `src/stores/` | Pinia store |
| `src/api/client.ts` | Axios client |
| `src/components/` | 画面・共通コンポーネント |
| `src/components/_share/` | qTubler、共通 UI、ダイアログ |
| `src/types/` | TypeScript 型 |
| `src/utils/` | qAlert など |
| `src/assets/` | CSS / static assets |

## Router 概要

3 ファイル分割構成です。

| Router | 対象 |
|--------|------|
| `index.ts` | 基底 + router 生成。ログイン、ログアウト、X系全般 |
| `coreRouter.ts` | C系 / A系 / AIコア（`/AiDiy`） |
| `appsRouter.ts` | M系 / T系 / V系 / S系 |

詳細なルート一覧と追加手順は `_AIDIY/knowledge/frontend_web,Vue Routerパターン.md` を参照してください。

## 主要 UI

- `_Layout.vue`
- `_TopBar.vue`
- `_TopMenu.vue`
- `qTublerFrame.vue`
- `qAlert`
- `qConfirm`
- `qColorPicker`

qTubler は `_share/qTublerFrame.vue` を中心にした独自テーブルです。
ソート、ページング、行選択を持ち、外部 UI framework へ置き換えない方針です。

## 認証

JWT token と user は `frontend_web` では `localStorage` に保存します。
401 は Axios response interceptor でログアウト処理へ流します。
認証延長対象は `認証延長ルール.md` を参照してください。

Task / Team は `frontend_ide` の独立アプリ `aidiy_task` / `aidiy_team` で操作し、この Web UI に画面・メニュー・API プロキシは持たせません。

## AI コア

`frontend_web` 版 AI コアは backend の `/core/ws/AIコア` と WebSocket で接続します。
code1〜code6、ファイル、画像、チャット、設定ダイアログを扱います。

AI packet やモデル設定の詳細は `_AIDIY/knowledge` の AI コア関連 HowTo を参照してください。

## 実装時の入口

- 業務 CRUD 画面は `components/C管理/`、`components/Mマスタ/`、`components/Tトラン/` を見る。
- V系一覧は `components/Vビュー/` を見る。
- S系は `components/Sスケジューラー/` を見る（route path は `/Sスケジュール/*`）。
- X系は `components/Xその他/` と `public/` を見る。
- API client や認証は `src/api/client.ts` と `src/stores/auth.ts` を見る。
- UI ルールや画面追加手順は必ず `_AIDIY/knowledge/_index.md` から該当 HowTo を開く。
