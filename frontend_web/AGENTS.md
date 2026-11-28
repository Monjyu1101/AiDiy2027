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
管理画面、マスタ、日誌を含むトランザクション、ビュー、スケジューラ、AIコア、X系デモを提供します。

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
- 開発時の API は `/core/*` → Core 8091、`/apps/*` → Apps 8098 を Vite proxy 経由で呼ぶ。`/mcp/*` は先頭の `/mcp` を除いて Tools 8095 へ転送する（`vite.config.ts`）。
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
認証延長対象は [JWT認証フロー](../_AIDIY/knowledge/backend_server,frontend_web,frontend_avatar,JWT認証フロー.md) と `src/api/client.ts` を参照してください。

Task / Team は `frontend_ide` の独立アプリ `aidiy_task` / `aidiy_team` で操作し、この Web UI に画面・メニュー・API プロキシは持たせません。

## AI コア

`frontend_web` 版 AI コアは backend の `/core/ws/AIコア` と WebSocket で接続します。
code1〜code6、ファイル、画像、チャット、設定ダイアログを扱います。

AI packet やモデル設定の詳細は `_AIDIY/knowledge` の AI コア関連 HowTo を参照してください。

## 日誌

`src/components/Tトラン/T日誌/` が一覧・編集を所有します。現行ルートは `/Tトラン/T日誌/一覧` と `/Tトラン/T日誌/編集`（短縮 alias は `/T日誌/一覧`・`/T日誌/編集`）で、どちらもログインが必要です。
`日誌API.ts` から `/apps/T日誌/*` を呼び、利用者・日付ごとの作業、プロジェクト、作業時間、新規更新ファイル数、明細本文・添付を扱います。保存先は Apps の専用日誌 DB です。

| ファイル | 役割 |
|----------|------|
| `T日誌一覧.vue` | 全利用者を対象にした日別一覧（`一覧検索`）。既定は当月の日付範囲で、前月・前日・翌日・翌月の移動、利用者・プロジェクト（`一覧候補`）・文字検索（作業タイトル・明細本文・添付名など）、件数制限、列フィルタ・並べ替え、30件ごとのページ表示 |
| `T日誌編集.vue` | 1日分の日誌の新規・編集・削除。新規時は有効な利用者（`利用者候補`）から登録先を選び、利用者1人の1日分に作業30件・全作業を合わせて明細100行、明細1行に添付20件まで。作業・明細の折り畳み、添付の選択・ドロップ・保存、未保存変更の離脱確認、`更新版` による同時更新の検出 |
| `日誌API.ts` / `日誌画面.ts` / `添付.ts` | API 呼出しとエラー表示、日付範囲の移動と戻り先 URL の検証、添付の読込・サイズ確認・画像判定 |
| `日誌.css` | 一覧・編集で共有する表示 |

- 現行実装では、ログイン中の有効な利用者は他の利用者の日誌も検索・閲覧・登録・変更・削除でき、監査項目に操作した利用者を記録する。無効化された利用者の過去の日誌は閲覧・編集できるが、新規の登録先には選べない。
- 現行実装では、添付は空でないファイル1件5 MiBまで。同じ利用者の1日分の添付合計は15 MiB、送信する要求本文全体は36 MiBまで。画面で画像として表示するのは PNG / JPEG / GIF / WebP だけで、SVG・HTML などはダウンロードのみとする。
- 日付範囲の計算は `checks/diary-date-range.test.mjs` で確認する。

バックエンドの構成は [backend_server/AGENTS.md](../backend_server/AGENTS.md)、AI からの操作は [T日誌の操作](../_AIDIY/knowledge/backend_tools,構成.md#t日誌の操作) を参照してください。

## 実装時の入口

- 業務 CRUD 画面は `components/C管理/`、`components/Mマスタ/`、`components/Tトラン/` を見る。
- V系一覧は `components/Vビュー/` を見る。
- S系は `components/Sスケジューラー/` を見る（route path は `/Sスケジュール/*`）。
- X系は `components/Xその他/` と `public/` を見る。
- API client や認証は `src/api/client.ts` と `src/stores/auth.ts` を見る。
- UI ルールや画面追加手順は必ず `_AIDIY/knowledge/_index.md` から該当 HowTo を開く。
