# Vue Router パターン

> 文書: `frontend_web,Vue Routerパターン.md` | 実装: `frontend_web/src/router/index.ts`, `frontend_web/src/router/coreRouter.ts`, `frontend_web/src/router/appsRouter.ts`

## このメモを使う場面

- 新しい画面を追加してルートを設定するとき
- 認証ガードの動作を確認するとき
- ルートのカテゴリ分けを変更するとき
- 画面追加手順の補完としてルートパターンを確認するとき

## 3 ファイル構成

ルート定義は役割別に 3 ファイルに分割されています。

| ファイル | 担当 | 含まれるルート |
|---------|------|--------------|
| `index.ts` | 基底 + router 生成 | ログイン、ログアウト、メニュー、X系全般 |
| `coreRouter.ts` | Core 系 | C管理（権限/利用者/採番）、AiDiy |
| `appsRouter.ts` | Apps 系 | Mマスタ、Tトラン、Vビュー、Sスケジュール |

```typescript
// index.ts — 3 つの配列をマージ
const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [...baseRoutes, ...coreRoutes, ...appsRoutes],
})
```

AIタスク・AIチームは `aidiy_task` / `aidiy_team` の単独アプリへ分離しています。`frontend_web` に `/AIタスク` / `/AIチーム` のルートやメニューを追加しません。

`public/` の独立HTMLはVue Routerの画面と区別し、それぞれのimportmapで外部ライブラリを解決します。`vite.config.ts` の `optimizeDeps.entries` はアプリ本体の `index.html` に限定します。依存削除後にpublic内のthree／VRM参照で探索エラーが出る場合は、不要な依存を戻す前に探索入口を確認してください。空の専用キャッシュを使った依存探索と通常画面の起動で検証します。

## ルート定義パターン

全ルートはフラット（ネストなし）で定義します。

```typescript
{
  path: '/C管理/C利用者/一覧',
  name: 'C利用者一覧',
  component: () => import('../components/C管理/C利用者/C利用者一覧.vue'),
  meta: { requiresAuth: true, title: 'C利用者一覧' },
}
```

| 項目 | ルール |
|------|-------|
| path | 日本語パス（`/C管理/...`、`/Mマスタ/...`） |
| component | 原則 遅延ローディング（`() => import(...)`） |
| meta.requiresAuth | 認証必要なし = `false` or 未指定（ログイン画面と静的ページへの別名ルート） |
| meta.title | ページタイトル（`afterEach` で `<title>` に設定） |
| ネスト | 不使用。全ルートフラット |

### ログイン画面（非認証ルート）

```typescript
{
  path: '/ログイン',
  name: 'login',
  component: ログイン, // eager import
  meta: { title: 'ログイン' },
}
```

## ナビゲーションガード

### beforeEach — 認証チェック

```typescript
router.beforeEach(async (to, _from, next) => {
  try {
    const decodedPath = decodeURIComponent(to.path)
    if (decodedPath !== to.path) {
      return next({ path: decodedPath, query: to.query, hash: to.hash })
    }
  } catch (e) {
    console.error('URL Decode Error:', e)
  }

  const authStore = useAuthStore()
  if (to.meta.requiresAuth) {
    if (!authStore.token) return next('/ログイン')
    if (authStore.user) {
      // キャッシュ済み利用者がいれば遷移を止めず、裏で認証確認する
      void authStore.ensureAuth()
    } else {
      await authStore.ensureAuth()
      if (!authStore.user) return next('/ログイン')
    }
  }
  next()
})
```

### afterEach — タイトル設定

```typescript
router.afterEach((to) => {
  const pageTitle = to.meta?.title || (typeof to.name === 'string' ? to.name : '')
  document.title = pageTitle ? `AiDiy - ${pageTitle}` : 'AiDiy'
})
```

## 画面追加時のルート設定手順

1. 画面のカテゴリを決める（C系→coreRouter, M/T/V/S系→appsRouter, X系/その他→index.ts）
2. 該当 router ファイルにルート定義を追加
3. `path` はコンポーネント配置と対応させる（`src/components/C管理/C利用者/C利用者一覧.vue` → `/C管理/C利用者/一覧`）
4. `meta.title` を設定（`afterEach` でドキュメントタイトルに反映される）
5. 認証が必要なら `requiresAuth: true` を設定

## ルート一覧

### baseRoutes（index.ts）

| path | name | 備考 |
|------|------|------|
| `/ログイン` | login | 非認証、eager import |
| `/ログアウト` | logout | |
| `/リンク` | リンク | |
| `/メニュー` | メニュー | |
| `/Xその他` | その他 | X系トップ |
| `/Xビデオ` | Xビデオ | X系トップ配下ではなく独立ルート |
| `/Xその他/Xテトリス/ゲーム` | Xテトリス | |
| `/Xその他/Xインベーダー/ゲーム` | Xインベーダー | |
| `/Xその他/Xリバーシ/ゲーム` | Xリバーシ | |
| `/Xその他/X立体リバーシ/ゲーム` | X立体リバーシ | |
| `/Xその他/Xドッグファイト/ゲーム` | Xドッグファイト | |
| `/Xその他/X世界の絶景/表示` | X世界の絶景 | |
| `/Xその他/X太陽系/表示` | X太陽系 | |
| `/Xその他/X動画再生BGM/再生` | X動画再生BGM | |
| `/Xその他/X自己紹介/表示` | X自己紹介 | |

`createStaticAliasRoute()` による静的ページへの別名ルートもあります。`requiresAuth` は付けず、`beforeEnter` で `BASE_URL` を考慮した `public/` のHTMLへ `window.location.replace()` します。対象一覧は `index.ts` を参照してください。

### coreRoutes（coreRouter.ts）

| path | グループ |
|------|---------|
| `/` | C管理（dashboard） |
| `/C管理` / `/C管理/C権限/一覧` / `/C管理/C権限/編集` | C権限 |
| `/C管理/C利用者/一覧` / `/C管理/C利用者/編集` | C利用者 |
| `/C管理/C採番/一覧` / `/C管理/C採番/編集` | C採番 |
| `/AiDiy` | AI コア（eager import） |

Task／Teamは `aidiy_task`／`aidiy_team` の独立画面です。旧 `/AIタスク`／`/AIチーム` はCoreルートに含めません。

### appsRoutes（appsRouter.ts）

| path | グループ |
|------|---------|
| `/Mマスタ` / `.../一覧` / `.../編集` | 配車区分、生産区分、車両、生産工程、商品分類、取引先分類、取引先、商品、商品構成 |
| `/Tトラン` / `.../一覧` / `.../編集` | 配車、生産、商品入庫、商品出庫、商品棚卸、生産払出 |
| `/Vビュー` / `/Vビュー/V商品推移表` | Vビュー |
| `/Sスケジュール` / `.../週表示` / `.../日表示` | 配車、生産 |

## 注意点

- **日本語 URL エンコード**: `beforeEach` で自動デコードするため、リンクは日本語パスで書いてよい
- **全ルートフラット**: 子ルートは使わない。コンポーネント内のタブ切り替えは別途実装
- **eager import**: ログイン画面と AiDiy のみ即時ロード。他は遅延ローディング
