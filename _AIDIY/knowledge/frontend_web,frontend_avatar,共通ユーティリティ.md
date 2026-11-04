# 共通ユーティリティ

> 文書: `frontend_web,frontend_avatar,共通ユーティリティ.md` | 実装: `frontend_web/src/utils/monaco.ts`, `frontend_avatar/src/utils/monaco.ts`, `frontend_web/src/utils/qAlert.ts`, `frontend_avatar/src/utils/qAlert.ts`

## このメモを使う場面

- Monaco Editor の Worker 設定や言語推定を変更するとき
- qAlert / qConfirm / qColorPicker ダイアログの動作を変更するとき
- 両プロジェクトで同じ実装がコピーされているユーティリティ・画面コンポーネントを修正するとき
- モナコの拡張子マッピングに言語を追加するとき

## Monaco Editor ユーティリティ

両プロジェクトとも `src/utils/monaco.ts` に Monaco Editor の Worker 設定と言語推定関数を持ちます。

### Worker 設定

全く同一の `self.MonacoEnvironment.getWorker()` 設定:

```typescript
self.MonacoEnvironment = {
    getWorker(_, label) {
        if (label === 'json') return new jsonWorker()
        if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker()
        if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker()
        if (label === 'typescript' || label === 'javascript') return new tsWorker()
        return new editorWorker()
    },
}
```

### 言語推定マップ

両者とも `モナコ言語推定(ファイル名)` 関数で拡張子 → Monaco 言語 ID をマッピングします。

| 拡張子 | Monaco 言語 | 備考 |
|--------|-------------|------|
| py | python | |
| vue | html | 構文ハイライトが十分なため |
| html/htm | html | |
| css/scss/less | css/scss/less | avatar は sass のみなし |
| js/jsx/mjs/cjs | javascript | avatar は js/jsx のみ |
| ts/tsx/mts | typescript | avatar は ts/tsx のみ |
| json | json | |
| md | markdown | |
| yml/yaml | yaml | |
| sh/bash | shell | avatar は sh のみ |
| bat/cmd | bat | 両方とも bat/cmd |
| ps1 | powershell | |
| sql | sql | |
| xml/svg | xml | |
| ini/env/toml | ini | avatar は ini/env/toml |
| txt/log/csv | plaintext | |
| dockerfile | dockerfile | web のみ（avatar はコード上未登録だが推定関数で特別処理） |

### 差分

| 項目 | frontend_web | frontend_avatar |
|------|-------------|-----------------|
| 変数名 | `拡張子と言語`（日本語） | `EXTENSION_TO_LANGUAGE`（英語） |
| エントリ数 | 多い（sass, mjs, cjs, mts, bash, cfg, conf, dockerfile, makefile, gitignore） | 少ない |
| 関数名 | `モナコ言語推定(ファイル名)` | `モナコ言語推定(fileName)` |
| 引数名 | `ファイル名` | `fileName` |

frontend_web のマップの方が充実しています。avatar にエントリを追加するときは web のマップを参照してください。

### 修正時の注意

**Monaco Worker 設定と拡張子マップは両方の `monaco.ts` を同時に修正してください。** 片方だけ変えると非互換が生じます。理想的には共通パッケージへ抽出すべき領域ですが、現状はコピー状態です。

## ダイアログユーティリティ (qAlert / qConfirm / qColorPicker)

両プロジェクトとも `src/utils/qAlert.ts` にシングルトン形式のダイアログユーティリティを持ちます。

### シングルトンパターン

```typescript
// インスタンス登録（App.vue / AiDiy.vue の onMounted で呼ぶ）
setAlertInstance(alertDialogRef)
setConfirmInstance(confirmDialogRef)
setColorPickerInstance(colorPickerRef)

// 呼び出し
await qAlert('保存しました')
const ok = await qConfirm('削除してよろしいですか？')
const color = await qColorPicker('#ff0000', '色を選択')
```

### 差分

| 項目 | frontend_web | frontend_avatar |
|------|-------------|-----------------|
| qMessage | あり（`setMessageInstance` + `qMessage()`） | なし |
| 型定義インターフェース名 | `AlertDialogInstance`, `ConfirmDialogInstance`, `MessageDialogInstance`, `ColorPickerDialogInstance` | 同左（`MessageDialogInstance` 除く） |
| フォールバック | alert/confirm のブラウザ標準関数 | 同左 |

### 修正時の注意

- **両方の `qAlert.ts` を同時に修正してください。**
- frontend_web の `qMessage()` を frontend_avatar に追加してもよいが、対応する `MessageDialogInstance` コンポーネントも必要です。
- 新しいダイアログ種別を追加する場合は、両プロジェクトでセットで実装します（型定義 + `setXxxInstance` + `qXxx` 関数 + 呼び出し側コンポーネント）。

## AI 会話表示とメッセージ入力の文字サイズ

- 会話本文とストリーム本文は `11px`、メッセージ入力欄は `12px` に揃える。
- Web / Avatar の対象は `AIチャット.vue`、`AIコード.vue`、`AIイメージ.vue`。Task / Team は `frontend_ide/src/components/タスクチーム/`、VS Code / 単独 Code / Live は `frontend_ide/src/components/コード/`・`ライブ/` と `共通表示/会話表示.css` を確認する。撤去済みのhost/mediaのCSSを編集しない。
- Web / Avatar の入力欄は通常 `12px` とし、高さ上限に達した `.at-limit` 状態では従来どおり `8px` へ縮小する。
- VS Code テーマの基本文字サイズを継承させず、会話本文と入力欄に上記サイズを明示する。文字送りカーソルは本文のサイズを継承する。

## AI メッセージ入力のキー操作

`AIチャット.vue`、`AIコード.vue`、`AIイメージ.vue` の入力欄は、両プロジェクトで同じ操作にする。

- Enter は textarea 標準の改行。日本語 IME の確定でも送信しない。
- Tab は `送信ボタン` の ref にフォーカスを移す。チャットのモード選択などが間にあっても Tab 1回で移動する。
- 送信ボタンにフォーカスがあるときの Enter は、標準のボタン操作でクリックと同じ送信処理を呼ぶ。独自の Enter ハンドラーを重ねない。
- Shift+Tab と修飾キー付き Tab は標準動作を維持し、IME 入力中や送信ボタンが無効な場合はフォーカス移動を強制しない。
- 確認は、入力欄の Enter で送信されないこと、Tab → Enter で1回だけ送信されること、空欄や未接続では送信できないことを両プロジェクトで確認する。vscode の共通 Webview も同じ仕様を使う。

## コピー状態の同期ルール

`utils/` 以下のファイルと、AIタスク / AIチーム / AiDiy / `_share` 系の**画面コンポーネント**は
両プロジェクトで実質コピー状態です。以下のルールで運用します:

| 操作 | 手順 |
|------|------|
| バグ修正 | 対応実装を比較し、共通契約に関わる修正を両方へ反映する |
| 機能追加 | 両方で必要か判断し、必要な差分だけ反映する |
| リファクタリング | 内容を一致させた上で、共通パッケージ化を検討する |

現状コピー状態のファイル:

| ファイル | 状態 |
|----------|------|
| `utils/monaco.ts` | ほぼ同一（avatar のマップがやや少ない） |
| `utils/qAlert.ts` | ほぼ同一（web に qMessage 追加） |
| `api/websocket.ts` | 同一インターフェース、実装に若干の差異あり |
| `components/_share/*.vue`（qTublerFrame, qBooleanCheckbox など） | ほぼ同一 |

Task／Teamは `frontend_ide/src/components/タスクチーム/` が所有します。Web／Avatar内の旧実装は撤去済みで、上記のコピー同期対象には含めません。

コンポーネントは `<template>` だけでなく **`<style scoped>` も両方に書く**こと。
scoped CSS は片方に入れても他方へ波及しないため、見た目だけ片側に残る差異が生まれやすい。
確認は両方の `npm run type-check`（MCP なら `check_typescript` を project ごとに 2 回）。
