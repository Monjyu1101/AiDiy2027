# frontend_web 画面追加手順

> 文書: `frontend_web,画面追加手順.md` | 実装: `frontend_web/src/router/index.ts`, `frontend_web/src/router/coreRouter.ts`, `frontend_web/src/router/appsRouter.ts`

## このメモを使う場面
- Vue 3 で新しい業務画面（一覧＋編集）を追加する
- メニュー、router、qTublerFrame を既存パターンに合わせて追加する

## 関連ファイル
- `frontend_web/src/router/index.ts` — ベースルート、認証ガード、X系ルート
- `frontend_web/src/router/coreRouter.ts` — C系 / AiDiy ルート
- `frontend_web/src/router/appsRouter.ts` — M系 / T系 / V系 / S系 ルート
- `frontend_web/src/components/<カテゴリ>/` — 画面コンポーネント
- `frontend_web/src/api/client.ts` — Axios クライアント、JWT 付与、認証延長
- `frontend_web/src/types/` — エンティティ / API / qTubler 型
- カテゴリ別メニュー `.vue` — 画面への導線

## 追加ファイルの基本形
- `src/components/<カテゴリ>/<テーブル名>/一覧.vue` — 検索条件、件数制限、新規ボタン、一覧テーブル配置
- `src/components/<カテゴリ>/<テーブル名>/編集.vue` — 新規 / 編集 / 削除
- `src/components/<カテゴリ>/<テーブル名>/components/<テーブル名>一覧テーブル.vue` — `qTublerFrame` ラッパー
- `src/types/*.ts` — 表示行・フォーム型が必要な場合だけ追加
- `src/router/coreRouter.ts` / `appsRouter.ts` / `index.ts` — 系統に応じてルート追加
- メニュー `.vue` — `router-link` 追加

## ルート追加先

| 系統 | 追加先 | パス例 |
|------|--------|--------|
| C系 / AiDiy | `src/router/coreRouter.ts` | `/C管理/C利用者/一覧` |
| M系 / T系 / V系 / S系 | `src/router/appsRouter.ts` | `/Mマスタ/M商品/一覧` |
| X系 / ログイン / ベースメニュー | `src/router/index.ts` の `baseRoutes` | `/Xその他/Xテトリス/ゲーム` |

- ルート定義には `name`, `meta.requiresAuth: true`, `meta.title` を入れる。
- 編集画面の主キーは既存画面に合わせ、パスパラメータではなくクエリで渡す。

```typescript
router.push({
  path: '/Mマスタ/M商品/編集',
  query: { モード: '編集', 商品ID: row.商品ID, URLメニュー: '/Mマスタ', URL戻り先: '/Mマスタ/M商品/一覧' },
})
```

日本語URLのリロード対応は `router/index.ts` の `decodeURIComponent` 処理に寄せ、個別画面で再実装しない。

## API とデータ取得の判断
- 一覧表示は原則 V系 JOIN API、登録・更新・削除は M/T系 API を使う。
- API 呼び出しは既存CRUD画面に合わせ、画面側で `apiClient.post('/apps/...', payload)` / `apiClient.post('/core/...', payload)` を使う実装が多い。
- API レスポンスは `status === 'OK'` を確認し、`data.items` / `data.total` の有無に対応する。古い形式や静的配列では `Array.isArray(data)` の分岐を入れる。
- 検索、フィルタ、ソート、ページングは、取得済み配列に対して `filteredRows` → `sortedRows` → `pagedRows` の順に `computed` を組む既存実装が標準。
- 明細型画面では、表示専用計算値やバックエンドスキーマに存在しない項目を payload に含めない。

## UI ルール

| 項目 | ルール |
|------|--------|
| 数値入力 | 非フォーカス時は3桁区切り、フォーカス時はカンマ除去＋全選択 |
| 日付・日時 | センタリング表示 |
| ラベル幅 | `160px` またはその倍数 |
| ID 選択肢 | `ID : 名称` 形式 |
| ダイアログ | `qAlert(message)` / `qConfirm(message)` |
| テーブル | `qTublerFrame.vue` を使う |
| 外部UI | Vuetify / Element Plus / Quasar などは使わない |
| コンポーネントタグ | 日本語タグを直接書かず、lazy import または `<component :is="...">` を使う |

## qTublerFrame の使い方

```vue
<qTublerFrame
  :columns="columns"
  :rows="pagedRows"
  :rowKey="rowKey"
  :sortKey="sortKey"
  :sortOrder="sortOrder"
  :message="message"
  :messageType="messageType"
  :hasFilter="hasFilter"
  :totalCount="totalCount"
  :totalAll="totalAll"
  :currentPage="currentPage"
  :totalPages="totalPages"
  @sort="handleSort"
  @page="goToPage"
>
  <template #filter="{ column }">
    <input v-if="filters[column.key] !== undefined" v-model="filters[column.key]" class="filter-input" type="text" />
  </template>
  <template #cell="{ row, column, value }">
    <a v-if="column.key === rowKey" href="#" class="id-link" @click.prevent="openDetail(row)">{{ value ?? '' }}</a>
    <template v-else>{{ value ?? '' }}</template>
  </template>
</qTublerFrame>
```

- `qTublerFrame` は枠、ヘッダー、スロット、ページャを提供する。並び替え、フィルタ、ページ切替後の配列作成は呼び出し側で行う。
- 現行 props / events は `columns`, `rows`, `rowKey`, `sort`, `page`。古い `headers/items/selectedId/row-click` 形式は使わない。
- `Column` は `src/types/qTubler.ts` の `key`, `label`, `width`, `align`, `sortable`。幅は固定値を入れ、数値や日付は `align: 'right'` / `'center'` を明示する。

## 一覧画面の手順
1. 親の `一覧.vue` に検索条件、件数制限、無効も表示、新規ボタン、一覧テーブルを置く。
2. 子の `一覧テーブル.vue` に API 取得、ローカルフィルタ、ソート、ページング、行リンク遷移を持たせる。
3. 親から再検索する場合は、子で `defineExpose({ loadData })` し、親が `ref` 経由で呼ぶ。
4. `URLメニュー` は大元メニュー、`URL戻り先` は現在の呼出元画面として扱う。どちらもクエリ値に全角の `？＆＝` が混ざる可能性を考慮し、戻る前に半角へ正規化する。編集など別画面へ遷移する場合は `URLメニュー` を保持し、`URL戻り先` に現在画面 URL を渡す。

## 編集画面の手順
1. `route.query.モード` が `新規` か `編集` かで初期処理を切り替える。
2. 編集時は `route.query.<ID名>` から主キーを取得し、`/取得` API でフォームへ反映する。
3. 保存時は `登録` / `変更` を分ける。削除は `qConfirm` 後に `/削除` を呼ぶ。
4. 数値入力は内部値をカンマなし文字列で保持し、表示時だけ整形する。空欄を `0` にしない。
5. プルダウンのラベルは `商品ID` ではなく `商品` など業務名にし、選択肢は `ID : 名称` にする。

## 明細型編集画面

明細型マスタや明細型トランザクションの編集画面では、ヘッダー form と `明細一覧` 配列を分ける。

実装パターン:

1. 明細行の Form 型を定義する。
2. 数値欄は空欄を扱えるよう string で保持する。
3. 行追加時は空行を push する。
4. 行削除時は `明細SEQ` を 1 から再採番する。
5. 送信前に空行除去、trim、数値変換を行う。
6. 表示専用の計算値は payload に含めない。
7. backend schema にない項目を送らない。

代表実装:

- `frontend_web/src/components/Mマスタ/M商品構成/M商品構成編集.vue`
- `frontend_web/src/components/Tトラン/T生産/T生産編集.vue`

## 共通実装を変更するとき

- Vue 3 Composition API / `<script setup lang="ts">` を使い、API項目名はバックエンドと揃える。
- `qAlert` / `qConfirm` は `@/utils/qAlert` から使い、標準 `alert` / `confirm` を画面ごとに追加しない。
- `_share`、AiDiy関連部品、`utils`、`api` を変える場合は、Web / Avatar の現存する対応実装を検索し、共有する契約の変更だけを両方へ反映する。画面固有の差分を無条件にコピーしない。
- Task / Team の画面は `frontend_ide/src/components/タスクチーム/` が所有する。Web / Avatar に旧画面を追加し直さない。
- CSS のコピーは自動同期されない。共通UIの変更後は両方の型検査と表示を確認する。
- 認証の保存・遷移は [Pinia Store](./frontend_web,Pinia Storeパターン.md)、[APIクライアント](./frontend_web,frontend_avatar,共通APIクライアントパターン.md)、[JWT認証](./backend_server,frontend_web,frontend_avatar,JWT認証フロー.md) を正本とし、画面へ再実装しない。権限IDは文字列として比較する。

## 注意点
- メニューカード追加だけでは遷移できない。router、カテゴリメニュー、必要ならトップ / メインメニューを確認する。
- TypeScript の `strictNullChecks` は無効なので型エラーが出にくいが、`npm run type-check` は必ず実行する。
- `npm run build` は `dist` を生成するため、明示指示がない限り通常確認では実行しない。
- API URL は `baseURL: '/'` と Vite Proxy 前提。`http://127.0.0.1:8091` を画面へ直書きしない。

## 確認方法
1. `npm run dev` でブラウザを開き、追加ルートへ直接アクセスする。
2. 一覧表示 → 編集 → 保存 → 一覧に戻る動線を確認する。
3. `npm run type-check` で型エラーがないことを確認する。Avatarの対応実装も変更した場合はそちらでも実行する。
4. DevTools Network で `/core` / `/apps` の呼び先、payload、`status/message/data` を確認する。
5. 日本語URLをリロードし、ログイン済みなら同じ画面へ復帰することを確認する。

一覧の件数・ページング・ソート、登録・変更・削除後の再取得、DevTools Consoleの警告とNetworkの401 / 403 / 500も確認します。
