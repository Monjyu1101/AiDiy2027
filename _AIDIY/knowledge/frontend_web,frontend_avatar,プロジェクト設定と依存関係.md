# プロジェクト設定と依存関係

> 文書: `frontend_web,frontend_avatar,プロジェクト設定と依存関係.md` | 実装: `frontend_web/package.json`, `frontend_avatar/package.json`, `frontend_web/tsconfig.json`, `frontend_avatar/tsconfig.json`, `frontend_web/vite.config.ts`, `frontend_avatar/vite.config.mts`

## このメモを使う場面

- npm パッケージを追加・アップデートするとき
- TypeScript のコンパイラオプションを変更するとき
- Vite の設定を変更するとき
- 両プロジェクトの設定差異を確認するとき

## 共通依存パッケージ（バージョン同期必須）

以下は現行の両 `package.json` に共通する依存と指定範囲です。解決された版は各 `package-lock.json` で確認します。

### 本番依存

| パッケージ | frontend_web | frontend_avatar | 備考 |
|-----------|-------------|-----------------|------|
| `vue` | ^3.5.41 | ^3.5.41 | 共通 |
| `axios` | ^1.20.0 | ^1.20.0 | 共通 |
| `monaco-editor` | ^0.56.0 | ^0.56.0 | 共通 |

### 開発依存

| パッケージ | frontend_web | frontend_avatar | 備考 |
|-----------|-------------|-----------------|------|
| `vite` | ^8.2.2 | ^8.2.2 | 共通 |
| `vue-tsc` | ^3.3.11 | ^3.3.11 | 共通 |
| `typescript` | ^5.9.3 | ^5.9.3 | 共通 |
| `@vitejs/plugin-vue` | ^6.0.8 | ^6.0.8 | 共通 |
| `@vue/tsconfig` | ^0.9.1 | ^0.9.1 | 共通 |
| `@types/node` | ^26.3.0 | ^26.3.0 | 共通 |

### バージョン同期ルール

1. 共通パッケージのバージョンを片方だけで上げない。
2. アップデート時は両方の `package.json` を同時に修正する。
3. `npm install` 後に両方で `npm run type-check` が通ることを確認する。

### 各プロジェクト固有の依存

| パッケージ | 在籍プロジェクト | 用途 |
|-----------|----------------|------|
| `pinia` | web | 状態管理 |
| `vue-router` | web | ルーティング |
| `dayjs` | web | 日付処理 |
| `jquery` | web | DOM操作（CDN等でも可） |
| `qrcode` | web | QRコード表示 |
| `@guolao/vue-monaco-editor` | web | Monaco Editor Vue ラッパー |
| `three` / `@types/three` (dev) | avatar | 3D描画と型定義 |
| `@pixiv/three-vrm` | avatar | VRMモデル読み込み |
| `@pixiv/three-vrm-animation` | avatar | VRMAモーション再生 |
| `electron` (dev) | avatar | Electron |
| `concurrently` (dev) | avatar | 並列起動 |
| `cross-env` (dev) | avatar | 環境変数 |

## TypeScript 設定の差異

| 項目 | frontend_web | frontend_avatar | 影響 |
|------|-------------|-----------------|------|
| strict | false | true | web の緩い型定義を avatar に持ち込む場合に型エラーとなり得る |
| strictNullChecks | false | true (strict に内包) | null 安全の有無 |
| noImplicitAny | false | true (strict に内包) | any 暗黙利用の可否 |
| allowJs | true | false | avatar は .js ファイルを受け付けない |
| jsx | preserve | preserve | 差異なし |

### strict 差異による注意点

frontend_avatar の型を frontend_web で使うとき:

- web 側は null の誤用を型検査で検出しにくいため、実行時の null / undefined 処理も確認する
- 逆に web から avatar へ型を持ち込む場合は `strictNullChecks` の有無を意識する
- 両プロジェクトで共有する型（`ModelSettings`, `AuthUser` など）は avatar の strict 設定で通るよう定義する

## Vite 設定

経路・ポートと接続先解決は [Viteプロキシ設定](./frontend_web,frontend_avatar,backend_server,Viteプロキシ設定.md) に集約します。

- Web の依存探索は `entries: ['index.html']` と `include: ['monaco-editor']`。public配下の独立HTMLは各ページのimportmapを使い、npm依存探索へ混ぜません。
- Avatar の `optimizeDeps.include` は `monaco-editor`、`three`、`@pixiv/three-vrm`、`@pixiv/three-vrm-animation`。
- Avatar は `vite.config.mts` をESMとして読みます。Electronは `tsconfig.electron.json` の CommonJS 出力を使うため、Vite警告対策でプロジェクト全体へ `"type": "module"` を追加しません。

### 各プロジェクトの tsconfig 継承

両方とも `@vue/tsconfig/tsconfig.dom.json` を extends しています。このベース設定のアップデートも両方へ同時適用します。

## npm scripts 命名規則

| スクリプト | frontend_web | frontend_avatar |
|-----------|-------------|-----------------|
| dev | vite | `electron/dev-start.cjs`（内部で renderer / Electron を起動） |
| build | type-check + vite build | renderer build + electron build |
| type-check | vue-tsc --noEmit | vue-tsc + tsc (electron) |
| preview | vite preview | vite preview |

新規スクリプトを追加するときは、同じ意味のものは同じ名前で揃えてください。avatar 独自の electron 関連スクリプトは役割が分かる名前（`dev:electron`, `dev:renderer` など）を付けます。
