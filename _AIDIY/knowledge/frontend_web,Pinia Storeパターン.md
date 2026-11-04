# Pinia Store パターン

> 文書: `frontend_web,Pinia Storeパターン.md` | 実装: `frontend_web/src/stores/auth.ts`

## このメモを使う場面

- 新しい Pinia store を追加するとき
- 認証ストア（auth）の動作を確認するとき
- localStorage との永続化パターンを確認するとき
- 画面追加手順の補完として store パターンを確認するとき

## 共通パターン

`frontend_web` の Pinia store は **Options API** パターンで統一されています。

```typescript
import { defineStore } from 'pinia'

interface SomeState {
  key: string
  items: SomeType[]
  loaded: boolean
}

export const useSomeStore = defineStore('some', {
  state: (): SomeState => ({
    key: '',
    items: [],
    loaded: false,
  }),
  getters: {
    hasItems: (state) => state.items.length > 0,
  },
  actions: {
    async fetchItems() {
      // API 呼び出し → this.items = ...
    },
  },
})
```

| 項目 | パターン |
|------|---------|
| defineStore | Options API（`{ state, getters, actions }`） |
| Composition API (`setup()`) | 不使用 |
| `storeToRefs` | 不使用 |
| 継承/基底 | なし。各 store は独立 |

## auth store — 認証管理

唯一の既存 store です。

### 状態

```typescript
state: () => ({
  token: localStorage.getItem('token') || '',
  user: JSON.parse(localStorage.getItem('user') || 'null'),
  authChecked: false,
})
```

`token` と `user` は初期化時に `localStorage` から復元します。ページリロード後も認証状態を維持するためです。

### getters

| getter | ロジック |
|--------|---------|
| `isAuthenticated` | `!!state.token` |
| `isAdmin` | `state.user?.権限ID === '1'`（文字列比較） |

### actions

| action | 処理 |
|--------|------|
| `login(username, password)` | `POST /core/auth/ログイン` → token 格納 + `fetchUser()` → `router.push()` |
| `fetchUser()` | `POST /core/auth/現在利用者` → user を localStorage 保存 + `authChecked = true`。失敗時は `logout()` |
| `logout()` | token/user/authChecked をクリア + localStorage 削除 → `router.push('/ログイン')` |
| `ensureAuth()` | token 無し→早期return。`authChecked` が false なら `fetchUser()` を呼ぶ |
| `refreshToken()` | `POST /core/auth/トークン更新` → token 差し替え。失敗は無視（401 インターセプター任せ） |

### 認証フロー

```
ページ遷移 → beforeEach ガード
  → ensureAuth()
    → token 無し → user = null, authChecked = true, そのまま遷移（login 画面へ）
    → token あり、未チェック → fetchUser()
      → 成功 → 遷続行
      → 失敗 → logout() → /ログインへ
```

## 新規 store 追加手順

1. `src/stores/` に `{name}.ts` を作成
2. `defineStore('{name}', { state, getters, actions })` の Options API 形式で定義
3. 画面のコンポーネントで `const store = useXxxStore()` で呼び出し
4. API 呼び出しは `src/api/client.ts` の `apiClient` 経由

## 注意点

- **localStorage 永続化**: 手動で `getItem/setItem` を書く。Pinia の `$subscribe` やプラグインは使っていない
- **auth store のみ**: 現状は auth store 1 つだけ。新規 store 追加時も同パターンに従う
- **Options API 固定**: Composition API 形式の store は混在させない
