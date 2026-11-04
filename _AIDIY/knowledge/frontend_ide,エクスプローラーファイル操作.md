# エクスプローラーファイル操作

> 文書: `frontend_ide,エクスプローラーファイル操作.md` | 実装: `frontend_ide/src/components/ファイル閲覧/ファイル一覧.vue`, `frontend_ide/src/components/ファイル閲覧/エクスプローラー操作.js`, `frontend_ide/src/components/ファイル閲覧/エクスプローラー操作表示.vue`, `frontend_ide/ファイル機能/explorer-files.mjs`, `frontend_ide/ファイル機能/explorer-native.mjs`, `frontend_ide/ファイル機能/explorer-windows.ps1`

## このメモを使う場面

- Explorerの右クリック・インライン名前変更・コピー・ゴミ箱移動を変更するとき。
- OS差分、パス境界、競合、利用終了中のファイル操作を検証するとき。

## チェックと一括操作

`ファイル一覧.vue` は最終選択と `checkedPaths` を分けます。通常クリックは1件へ置換、Ctrl／Commandは階層をまたいで追加、Shiftは基点と同じ階層の範囲だけを拡大・縮小します。Shiftで別階層を押した場合はその項目だけへ置換します。チェック欄とSpaceは最終選択を移しません。チェック欄にフォーカスがあってもCtrl+Cなどの一覧ショートカットを通し、Spaceはチェック欄の標準操作へ任せます。

複数チェックの開始は `pause-refresh` で本体へ同期します。最終更新の取得を中断し、宇宙エンジンの再走査・自動追跡とフォルダ監視も停止します。進行中の走査は中断・世代無効化し、解除まで一覧を反映しません。1件以下で取得を再開します。

右クリックの一括対応項目は通常色の太字で「☑︎全てを」を付けます。対象はメニューを開いた時点で固定します。コピー用の内部クリップボードは複数項目を保持し、参照追加は本文を送らず1つの下書き依頼へまとめます。

変更APIは既存のJSONへ `paths` を追加した一括指定を受けます。copy／trash／pdfだけ、最大1000件。同じ操作キューで全対象を事前確認して直列実行します。異なる階層の個別ファイルは許可し、親フォルダと配下項目の重複は親へ集約せず拒否します。trashは全対象の確認が必須です。途中失敗では完了分・失敗パス・全件数を返し、画面は完了分だけ反映して自動再実行しません。OSの安全なゴミ箱処理と各パスの検証は単体操作と共用します。

`node scripts/check-explorer-multi.mjs` は配布画面をWeb別窓へピン留めし、選択から2回のコピー・2件削除までを順に確認します。ゴミ箱は専用fixture内の移動で代替し、利用者のファイルや通常のゴミ箱を使いません。画像は `temp/explorer-multi-check/` に保存し、採用分だけ冊子へ移して一時画像を整理します。

## 単体操作との共有

`ファイル一覧.vue` は本体とピン留め別窓で同じVue／DOMを使う。操作状態は `エクスプローラー操作.js` に持ち、OSのファイルクリップボードとは分離する。パスの文字コピーだけはOSクリップボードを使い、拒否時は手動コピー欄を表示する。名前変更はEnter適用／Esc取消、IME変換中のEnter・Escは確定・取消として扱わない。メニューの `selection-popup` とダイアログの `role="dialog"` は既存のネイティブ長押し窓移動を止めるため維持する。

「アプリで開く」はデスクトップ版でファイルを選んだときだけ有効にする。既存ビューアと同じ `aidiyWindow.openFile` → `development:open-file` → `native-preview-actions.cjs` を共用し、OSの既定アプリへ渡す。ピン留め時も元のIDEのAPIを使い、利用セッション・プロジェクト内の実パス・ファイル同一性の検証と、実行形式／スクリプト／ショートカットの確認を維持する。内部リンクは既存の閲覧境界に従い、外部へのリンクは拒否する。Web版とフォルダでは項目を無効化し理由を表示する。開けない場合はExplorer内にエラーを表示し、自動再試行やHTTP経由のOS起動APIは追加しない。

その直後に「フォルダを開く」を置く。ファイルならその所在フォルダ、フォルダならそのフォルダ、ルート行／背景ならプロジェクトルートをOSのファイルマネージャーで開く。デスクトップ版だけで有効にし、本体／ピン留め別窓とも元のIDEの `aidiyWindow.openFolder` → `development:open-folder` → `native-preview-actions.cjs` を使う。main側で種類とrealpathを確認し、削除済み・プロジェクト外・外部へのリンク・古い利用セッションを拒否する。ファイル自体は実行しない。macOSは `.app` などを起動しないよう、シェルを使わず固定argvでFinderを明示する。Web版にはHTTP経由の代替起動口を作らない。

「Code / Liveへ」は右クリックしたファイルの相対パスを、ビューアと同じ `fileDraftReference` で参照文にする。フォルダ・ルートは対象外。閲覧中の別ファイルや選択本文は含めず、既存の `下書き連携ダイアログ.vue` とAppの連携先確認・下書き追加処理を共用する。ダイアログはExplorer内に置き、ピン留め先でも同じ画面で操作する。利用セッション変更・Explorerの開閉・別窓への移動時はダイアログを閉じる。連携先を確認して「下書きへ追加」を押すまでは追加せず、AIへは送信しない。「再読み込み」は右クリックメニューには置かず、他の更新経路は維持する。

見出しの操作順は、本体・別窓とも「全てを閉じる」→緑の再取得→ピン（表示する場合）に揃える。「全てを閉じる」は重ねたフォルダーとマイナスのSVGで表し、同じ文言をツールチップとアクセシブル名に使う。「選択位置を表示」ボタンは置かず、選択変更やキーボード操作で使う内部の `reveal()` は維持する。

手動の一覧更新は見出しの緑の `↺`（一覧を更新）から行う。既存の `fileActions.action('refresh')` → `reloadExplorer()` を使い、フィルター・選択・フォルダ展開を初期化しない。更新中は印を回転させ、`aria-busy` と無効化で連打を防ぐ。名前変更・ダイアログ・grep検索中も更新ボタンを無効にする。成功・失敗は既存の操作メッセージ欄へ出し、失敗後は同じボタンから再試行できる。右端のピンと別窓の窓操作は変更せず、本体・ピン留め先で同じボタンを使う。

変更APIは `POST /api/explorer/actions`。JSONと `X-AiDiy-Explorer: 1` の両方を必須にし、既存のHost／Origin／利用セッション検証を通す。読み取りAPIやViewerの本文編集機能は増やさない。操作を直列化し、利用終了と接続世代の変更で待機要求を無効化する。

パスはプロジェクト相対の `/` 区切りだけ。ルート変更、絶対パス、親への脱出、リンクを通るパス、予約名、別ドライブ、ADSを拒否する。作成は排他的、コピーは衝突時に別名、名前変更はOSの上書き禁止機能を使う。フォルダコピーは全対象を検査し、リンク・自己／子孫コピー・容量／件数超過を拒否する。コピー中に問題があれば元を保持し、途中コピーを勝手に消さず場所を通知する。

ゴミ箱はLinuxの `gio trash`、macOSのFoundation、WindowsのIFileOperationを使う。Windowsは `PreDeleteItem` でもリサイクル処理だけを許可する。完全削除へのfallbackは禁止。OS処理の結果が不明な場合は再実行せず、元の場所とOSゴミ箱の確認を案内する。Windowsは8以降のローカル固定ドライブに限定し、ネットワーク／リムーバブルドライブは拒否する。Windows/macOSの実動作は各OSで別途確認する。

なお、同一サーバー内では操作を直列化するが、別プロセスが最終検査とOS呼出しの間に祖先フォルダを差し替える攻撃まで防ぐOSレベルのサンドボックスではない。信頼できないプロセスが同じプロジェクトを同時に書き換える環境では利用しない。

## MarkdownのPDF化

`.md` ファイルの右クリックにだけ「PDF化」を表示する。同じフォルダへ拡張子を `.pdf` に変えて保存し、既存PDFは確認なしで上書きする。作成後は一覧を更新する。

描画は `viewer/preview.mjs` のMarkdownプレビューを共用し、非表示のElectronでA4のPDFへ出力する。日本語・表・コード・相対画像を扱い、印刷時は白背景にする。元Markdownは変更しない。Markdownは1MBまで、PDFは50MBまで。生成や書き込みが失敗した場合は既存PDFを保持するため、同じフォルダの一時ファイルを完成させてから置換する。保存先の同名フォルダやリンクは拒否する。

Windowsで実PDF生成も検証する場合は `$env:AIDIY_TEST_PDF_RENDER='1'` を設定し、`node --test checks/markdown-pdf.test.mjs checks/markdown-preview.test.mjs checks/explorer-actions.test.mjs` を実行する。

## 再検証

`frontend_ide` で次を実行する。

- `node --test checks/explorer-actions.test.mjs checks/explorer-files.test.mjs checks/explorer-navigation.test.mjs checks/workflow-components.test.mjs checks/native-window-move.test.mjs checks/panel-lifecycle.test.mjs`
- `npm test` と `node --test viewer/checks/*.test.mjs`。
- `node scripts/check-explorer-component.mjs` は実Vueとsandbox有効のElectronをdata:画面に載せる隔離fixture。APIは固定データで、通常のメニュー／名前変更／確認／キーボード／別窓／長押し除外を確認する。headlessの1×1または空画像は視覚確認済みとは扱わない。
- UIの表示確認用に `node scripts/build.mjs` を実行した後、`node scripts/check-explorer-menu.mjs`。これは通常のChrome／Edgeが利用できる環境用で、実ファイルは専用一時fixture、ゴミ箱は専用一時フォルダへの移動で代替する。ブラウザーの接続／sandbox拒否を弱いフラグで回避しない。

Linuxのゴミ箱テストも専用の一時HOMEとXDG_DATA_HOMEだけを使う。既存のユーザーデータや通常のゴミ箱を使わず、復元可能なファイルが作成されたことを確認する。実機ではファイル／フォルダ、同名衝突、消えたコピー元、権限拒否、シンボリックリンク、ルート背景、別窓、モーダル中の窓移動禁止、Enter／Esc／IME、途中の終了・再接続を確認する。
