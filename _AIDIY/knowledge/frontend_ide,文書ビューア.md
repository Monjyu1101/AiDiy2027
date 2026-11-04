# 文書ビューア

> 文書: `frontend_ide,文書ビューア.md` | 実装: `frontend_ide/src/components/ファイル閲覧/ファイルビューア.vue`, `frontend_ide/viewer/markdown-preview.mjs`, `frontend_ide/viewer/server.mjs`, `frontend_ide/viewer/preview.mjs`, `frontend_ide/viewer/web/office.js` | 検証: `frontend_ide/checks/markdown-preview.test.mjs`, `frontend_ide/viewer/checks/office.test.mjs`

## このメモを使う場面

- AiDiy IDE の Markdown・Word・Excel・PowerPoint・PDF 表示を変更・確認する。
- Office文書がバイナリ扱いになる、ライブラリ不足、表示崩れを調べる。

## 構成と依存

VS Code の Office Viewer（cweijan/vscode-office）で採用・紹介されているライブラリを、読み取り専用の独立した画面に組み込む。拡張そのものや VS Code の API は使用しない。

| 対象 | ライブラリ | 対応形式 |
|---|---|---|
| Word | docx-preview / JSZip | docx、dotx |
| Excel | SheetJS CE | xlsx、xls、xlsm、ods、csv、tsv |
| PowerPoint | PptxViewJS / JSZip / Chart.js | pptx、pptm |
| PDF | PDF.js | pdf |
| Markdown | markdown-it | md、markdown |

- Office/PDFの依存は `frontend_ide/viewer/package.json` / `package-lock.json` で管理し、他サブシステムから借りない。Markdownは `frontend_ide/package.json` に導入済みの `markdown-it`（MIT）を使う。ライセンスは各パッケージの同梱ファイルに従う。docx-preview / SheetJS / PDF.js は Apache-2.0、PptxViewJS / Chart.js は MIT、JSZip は MIT または GPL-3.0 の選択で MIT を利用する。
- SheetJS は公式配布元 `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` を固定する。npm registry の `xlsx` は旧版のため置き換えない。
- `/api/file` が `kind: office` と `format` を返し、`src/components/ファイル閲覧/ファイルビューア.vue` が `/office.html` の iframe を作る。
- `/api/document` は対象拡張子のみをバイナリ配信する。既存の `/api/raw` は画像専用のままにする。
- `/office-vendor/` は必要なファイルだけを配信する。Monaco の AMD ローダーとの干渉を避けるため、表示ライブラリを親画面へロードしない。
- iframe 内の CSP で外部接続を制限し、変換サーバーを使わずブラウザ内で処理する。書き込み・マクロ実行は提供しない。Word の埋め込み HTML（altChunk）は描画しない。
- 閉じる・別ファイル選択で iframe を破棄する。Vue部品の `revision` / `previewRun` と AbortController で古い読み込み結果を無効化し、別ファイルや破棄後の画面を上書きしないようにする。

## 導入と検証

### 内部認証ファイルの非公開

- Core / TaskTeam が生成する `internal_auth.json`、秘密鍵リング `internal_auth_keys.json`、それぞれの原子的保存用 `.internal_auth.json.*.tmp` / `.internal_auth_keys.json.*.tmp` は、汎用ファイル表示・静的プレビュー・一覧/本文検索・履歴/解析・Explorer操作から除外する。要求パスだけでなく解決後の実パスも確認し、別名symlink経由の取得を防ぐ。
- 資格情報としての拒否対象はこの名前に限定する。`docs/internal_auth.md` / `docs/internal_auth_keys.md` や通常のコード・JSONは従来どおり扱う。これはWebの汎用ファイルAPIからの公開を防ぐもので、同じマシンの利用者、Console、AI/CLIの直接ファイルアクセスを隔離する機能ではない。
- `node --test frontend_ide/viewer/checks/internal-credential-files.test.mjs` は合成資格情報・symlinkだけで検証する。実資格情報を読まず、サーバー・外部AI・OS関連アプリは起動しない。

### フィルターOFFでも残す除外

- OFFは「すべて表示」ではなく、バックアップより緩い通常表示。`backend_server/core_router/フォルダ除外規則.json` の `ignored`（`.git` / `.git_local` / `venv` / `.venv` / `node_modules` / `node_module`、既存の生成物・キャッシュ等）を常時除外し、ONだけ追加の `backupDirectories` / `backupFiles` / `backupPaths` / `backupExtensions` 条件を適用する。バックアップ保存処理自体の条件はこの変更で広げない。
- 常時除外はルート直下・入れ子の**ディレクトリ名の完全一致**で、大小文字を区別しない（Windowsの末尾の点・空白も正規化）。`.git-notes` や `node_modules.md` のような別名・通常ファイルは部分一致で除外しない。OFFなら `package.json` や `temp/` の通常文書は表示対象、ONなら従来のバックアップ条件で非表示になる。
- 一覧・更新状態・本文検索は同じ基準を使う。ファイル表示/プレビュー・履歴/解析・AI検索結果も要求パスと実パスを確認し、除外フォルダへの別名symlinkで読み取れないようにする。Monaco / Officeの固定資産ルートはプロジェクト走査とは別であり、親が `node_modules` というだけで配信を止めない。既存の明示ファイル操作・OS/AI/CLIへの一般的な権限制限を追加するものではない。
- `node --test frontend_ide/viewer/checks/always-excluded-files.test.mjs frontend_ide/viewer/checks/internal-credential-files.test.mjs` と `python -m unittest discover -s backend_server/checks -p test_folder_baseline.py` で、ON/OFF・入れ子・大小文字・symlink・通常文書の境界を合成ファイルだけで検証する。

### パスのコピーと関連アプリ

- 共通の `ファイルビューア.vue` は通常プレビュー・ピン留めの両方で同じ操作を使う。Electronでは限定した `aidiyWindow.copyFilePath` / `openFile` IPCを使い、Webでは「アプリで開く」を表示しない。HTTPにOSのアプリ起動APIを追加しない。
- コピーはElectronのネイティブクリップボードを優先する。WebはClipboard API、非対応・権限拒否時は選択用textareaによるコピーを試し、元のフォーカス・選択を復元する。失敗を成功扱いせず、表示されたパスの手動コピーを案内する。操作エラーで文書本文を隠さない。
- `デスクトップ/native-preview-actions.cjs` はIDEの信頼済みメインフレーム・所有者・稼働セッション・相対パス・実ファイルとリンク先のプロジェクト内境界を検証する。ピン留めはその窓の対象ファイルに限定する。状態取得や確認の待ち時間にもセッションとファイルを再検証する。
- 「アプリで開く」は明示クリック時だけ関連アプリへ渡す。実行形式・スクリプト・ショートカット等にはキャンセルを既定とする警告を表示する。連打・対象切替・閉じる際の遅い応答で、別ファイルへ成功やエラーを表示しない。
- `checks/file-actions.test.mjs` と `checks/preview-actions.test.mjs` はパス・Web代替コピー・実Vueテンプレートの表示とクリックを、`checks/native-preview-actions.test.mjs` はネイティブ境界を検証する。OSのクリップボード・関連アプリの実動作と狭い画面の配置は、実機で別途確認する。

### Markdownプレビュー

- 共通画面の `frontend_ide/src/components/ファイル閲覧/ファイルビューア.vue` は `.md` / `.markdown` を既定でプレビュー表示し、「コード / プレビュー」を切り替える。最後に選んだ表示をMarkdown全体で記憶し、ピン留め窓でも共用する。
- `/api/preview` から `viewer/preview.mjs` の別オリジンの静的サーバーへ渡し、`frontend_ide/viewer/markdown-preview.mjs` でHTMLへ変換する。元ファイルや変換ファイルは書き出さない。
- UTF-8 / Shift_JIS の1MBまで。見出し・日本語見出しへのアンカー・表・箇条書き・コードブロック・画像に対応する。相対画像・別Markdownへのリンクは元のフォルダを基準にし、外部リンクは別タブで開く。プロジェクト外・設定・鍵・バックアップ等は既存プレビューと同じ配信制限を守る。
- Markdown内のHTMLは文字として表示する。文書から任意のスクリプトを実行せず、操作通知だけをnonce付きで許可する。外部画像の表示にはネット接続が必要。
- ルートから `node --test frontend_ide/checks/markdown-preview.test.mjs frontend_ide/viewer/checks/preview.test.mjs`。実画面は `node frontend_ide/scripts/check-markdown.mjs` で見出し・表・コード・相対画像・リンク・コード切替・再読込・縦横画面・ピン留めを確認する。Chrome / Edge の場所が自動検出できない場合は `CHROME_PATH` を指定する。日時・連番付き画像を `temp/markdown-preview-check/` に保存する。

### 著作権表記の更新

- 独自実装のソース冒頭には、既存ソースと同じ `COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.` から始まる定型文を付ける（AiDiy 公開利用ライセンス v1.1、商用利用の事前書面承諾、LICENSE 参照、GitHub URL を含む）。第三者ライブラリの原文には適用しない。
- `scripts/licenses.mjs` はルート `LICENSE` を正本として `frontend_ide/viewer/LICENSE` と `web/LICENSE.txt` に全文を同梱し、著作権ページの「AiDiy IDE の独自実装」に定型文と全文を表示する。単独配布時は同梱 `LICENSE` を利用する。

- `scripts/licenses.mjs` は導入済みのブラウザ用依存と `package-lock.json` のバージョンを照合し、同梱の LICENSE / NOTICE / ThirdPartyNotices などを原文のまま収集する。PDF用フォント・WASMの表記も対象。Node.js専用の任意依存 `@napi-rs/canvas` はブラウザへ配信しないため、この一覧の対象外。
- `npm ci` / `npm install` の `postinstall`、または `npm run licenses` で `web/THIRD_PARTY_NOTICES.txt` と `web/licenses.html` を生成する。両方をソース・配布物に含め、ライブラリ内の既存の著作権表記も残す。
- `npm run check` は表記の更新漏れも検出する。ライセンス原文が見つからない新規依存では生成を停止するので、配布元の原文を確認して収集方法を追加する。
- 表記の照合ではCRLF / LFの違いだけを無視する。OSやGitの改行設定による差を更新漏れと誤判定せず、パッケージのバージョンと原文の内容は引き続き確認する。
- 画面左上の「著作権・ライセンス」から別タブで開く。項目の展開と原文テキスト保存を確認する。
- JSZip は MIT、DOMPurify は Apache-2.0 を選択する。選択元の複数ライセンス原文も保存する。Office Viewer は参考元として作者・リンクを掲載し、拡張本体のコードを組み込んだとは表記しない。

### 動作確認

1. `python frontend_ide/viewer/_setup.py` で依存を導入する（Node.js 22.13 以降）。
2. サーバー側も変更した場合は AiDiy IDE のサーバーを再起動する。画面の再読み込みだけでは `server.mjs` の変更は反映されない。
3. `frontend_ide/viewer` で `npm run check` と `npm test` を実行する。
4. ブラウザで Word の日本語・ページ区切り、Excel のシート切り替え・数式結果・結合セル・行送り、PowerPoint / PDF のページ送りと倍率変更を確認する。
5. 文書 → ソースコード → 文書、ビューアを閉じる、壊れた文書のエラー表示を確認する。

`checks/fixtures.mjs` の `createFixtures(root)` で、指定した一時ディレクトリに Word / Excel / PDF / CSV / 壊れた文書 / コードの検証用ファイルを生成できる。PowerPoint は既存の `AiDiy概要.pptx` などを読み取り用の一時フォルダへコピーして使用する。原本は更新しない。

実画面の一括確認は、ルートから `node frontend_ide/scripts/check-office.mjs` を実行する。Chrome / Edgeが自動検出できない場合は `CHROME_PATH` で実行ファイルを指定する。専用の一時プロジェクトでWord日本語・ページ区切り・倍率・更新後の再読込、Excel計算結果・シート切替・行送り・結合セル・CSV、PDF / PowerPointのページ送り・倍率・縦横表示、Monacoとの切替、壊れた文書のエラーとその後の復旧、iframeの破棄を確認する。Monacoを親画面に読み込んだ状態でOfficeを開き、AMDローダーが文書へ持ち込まれないことも確認する。日時・連番付き画像は `temp/office-viewer-check/` に保存する。

### 文書のページ送り

- Word・Excel・PDF・PowerPointは、表示中ページの先頭右側に2ページ目以降だけ「前のページへ」、本文末尾に最終ページ以外だけ「次のページへ」を表示する。既存ツールバー・左右キー・PageUp / PageDownと同じ `move()` を使う。空・1ページの文書では両方を隠す。テキストの先頭1MB制限をページ送りと混同しない。
- Wordはdocx-previewが改ページ・セクション情報等から生成する `section.docx` を1ページずつ表示する。文字数や画面高さで独自に分割しない。文書全体のスタイル・ヘッダー・フッター・脚注を保持し、VML等の計測フレームを待ってからページを切り替える。文書内のブックマークは対象ページを表示して位置へ移動し、外部リンクは引き続き開かない。Wordアプリの自動改ページと完全一致するページ数を保証するものではない。
- 内容とページ番号・シート選択・上下ボタンは、描画に成功してからまとめて確定する。連打・倍率・リサイズ・シート切替の古い結果を捨て、失敗時は表示済みページを残して再試行できるようにする。ページ送りの成功時だけ本文先頭へ戻し、倍率変更だけではスクロールを戻さない。
- PowerPointはPptxViewJSが保持する描画canvasを固定し、完成したスナップショットを本文へ差し替える。遅延グラフの再描画も共通の直列処理を通す。別ファイル・閉じる際はiframeごと破棄し、pagehideで通信・監視・文書ライブラリを片付ける。
- `viewer/checks/office-pagination.test.mjs` は実Officeスクリプトの操作・描画寿命を模擬DOMで検証する。画面幅・横スクロール・倍率・先頭と末尾の配置は `scripts/check-office.mjs` 等で別途実画面確認する。

## 制限と切り分け

- Office/PDFは50MBまで、Markdownは1MBまで。Excel は最大100,000行、先頭100列、1画面200行を表示する。大きいシートでは省略を画面に表示する。
- Excel の数式を再計算しない。ファイルに保存された計算結果を表示する。グラフ・画像・高度な書式の再現は対象外。
- Word / PowerPoint はブラウザ用描画エンジンによる近似表示。フォント・複雑なレイアウト・図形などでOfficeアプリとの差が出る場合がある。
- `.doc` / `.ppt` の旧形式とパスワード付き文書は対象外。PDF はページ単位のCanvas描画で、文字検索・文字選択は提供しない。
- 依存不足ならセットアップを再実行する。文書が従来どおりバイナリ扱いなら、旧サーバーが動いていないか確認する。
- 表示サイズ変更は描画を直列化して処理する。拡大時は canvas の左端にもスクロールできる配置を維持する。
