# セルフテスト・操作ガイド

操作・検証ガイド21冊と確認結果1冊。実施結果、残件、日時とエビデンスは本フォルダで管理します。全章合格を意味しません。

| 文書 | PDF |
|---|---|
| [セルフテスト,aidiy_avatar,Electron実行編](./セルフテスト,aidiy_avatar,Electron実行編.md) | [PDF](./セルフテスト,aidiy_avatar,Electron実行編.pdf) |
| [セルフテスト,aidiy_avatar,Web実行編](./セルフテスト,aidiy_avatar,Web実行編.md) | [PDF](./セルフテスト,aidiy_avatar,Web実行編.pdf) |
| [セルフテスト,aidiy_browser,操作編](./セルフテスト,aidiy_browser,操作編.md) | [PDF](./セルフテスト,aidiy_browser,操作編.pdf) |
| [セルフテスト,aidiy_code,操作編](./セルフテスト,aidiy_code,操作編.md) | [PDF](./セルフテスト,aidiy_code,操作編.pdf) |
| [セルフテスト,aidiy_console,操作編](./セルフテスト,aidiy_console,操作編.md) | [PDF](./セルフテスト,aidiy_console,操作編.pdf) |
| [セルフテスト,aidiy_diag,AIモデル・Tools編](./セルフテスト,aidiy_diag,AIモデル・Tools編.md) | [PDF](./セルフテスト,aidiy_diag,AIモデル・Tools編.pdf) |
| [セルフテスト,aidiy_diag,システム起動編](./セルフテスト,aidiy_diag,システム起動編.md) | [PDF](./セルフテスト,aidiy_diag,システム起動編.pdf) |
| [セルフテスト,aidiy_diag,ランチャー編](./セルフテスト,aidiy_diag,ランチャー編.md) | [PDF](./セルフテスト,aidiy_diag,ランチャー編.pdf) |
| [セルフテスト,aidiy_diag,環境確認編](./セルフテスト,aidiy_diag,環境確認編.md) | [PDF](./セルフテスト,aidiy_diag,環境確認編.pdf) |
| [セルフテスト,aidiy_diag,設定再起動編](./セルフテスト,aidiy_diag,設定再起動編.md) | [PDF](./セルフテスト,aidiy_diag,設定再起動編.pdf) |
| [セルフテスト,aidiy_discord,操作編](./セルフテスト,aidiy_discord,操作編.md) | [PDF](./セルフテスト,aidiy_discord,操作編.pdf) |
| [セルフテスト,aidiy_hermes,操作編](./セルフテスト,aidiy_hermes,操作編.md) | [PDF](./セルフテスト,aidiy_hermes,操作編.pdf) |
| [セルフテスト,aidiy_ide,操作編](./セルフテスト,aidiy_ide,操作編.md) | [PDF](./セルフテスト,aidiy_ide,操作編.pdf) |
| [セルフテスト,aidiy_live,操作編](./セルフテスト,aidiy_live,操作編.md) | [PDF](./セルフテスト,aidiy_live,操作編.pdf) |
| [セルフテスト,aidiy_slack,操作編](./セルフテスト,aidiy_slack,操作編.md) | [PDF](./セルフテスト,aidiy_slack,操作編.pdf) |
| [セルフテスト,aidiy_task,操作編](./セルフテスト,aidiy_task,操作編.md) | [PDF](./セルフテスト,aidiy_task,操作編.pdf) |
| [セルフテスト,aidiy_team,操作編](./セルフテスト,aidiy_team,操作編.md) | [PDF](./セルフテスト,aidiy_team,操作編.pdf) |
| [セルフテスト,backend_tools,主要メソッド編](./セルフテスト,backend_tools,主要メソッド編.md) | [PDF](./セルフテスト,backend_tools,主要メソッド編.pdf) |
| [セルフテスト,frontend_web,AiDiy編](./セルフテスト,frontend_web,AiDiy編.md) | [PDF](./セルフテスト,frontend_web,AiDiy編.pdf) |
| [セルフテスト,frontend_web,生産・在庫管理編](./セルフテスト,frontend_web,生産・在庫管理編.md) | [PDF](./セルフテスト,frontend_web,生産・在庫管理編.pdf) |
| [セルフテスト,frontend_web,配車管理編](./セルフテスト,frontend_web,配車管理編.md) | [PDF](./セルフテスト,frontend_web,配車管理編.pdf) |
| [セルフテスト,共通,確認結果](./セルフテスト,共通,確認結果.md) | [PDF](./セルフテスト,共通,確認結果.pdf) |

[音声解説の実施記録](./共通,セルフテスト解説・ナレーション方法.md)

実施方法・記録様式は [_AIDIYのナレッジ](../../_AIDIY/knowledge/_index.md) を参照。現行ガイドと証拠は、この一覧と `evidence/` に集約します。

## 更新と閲覧

各Markdownと同名PDFをこのフォルダから開きます。操作手順・図解・実施結果は各編の本文、残件は末尾の証拠照合を参照します。画像は `images/<文書名>/`、必要な台帳・JSONは `evidence/` に保管します。証拠内の過去の実行パスは履歴であり、現在の保存先とは区別します。

PDF更新はプロジェクトルートで次を実行します。対象名は同フォルダ内のMarkdownファイル名です。

```powershell
node "docs/セルフテスト、操作ガイド/_tools/総合テストPDF.mjs" "セルフテスト,aidiy_task,操作編.md"
```

方法の詳細は [説明資料の書き方](../../_AIDIY/knowledge/セルフテスト,_説明資料の書き方.md) を参照します。現在の実施先はこの索引の22冊です。旧版・比較用の退避コピーは残しません。

## 現行判定の入口

各冊末尾の「現行の判定」を最新とし、[文書別残件一覧](evidence/_work_records/selftest-20261102/remaining-actions.md)に集約しています。先行調査の保留は後続結果で更新されており、Code実機競合・Live故障前提試験は利用者指定で実施不要です。正常イベント警告のCore反映確認は実機返信成功と分けて残しています。

## Navigator

[Navigator 操作編・セルフテスト計画](./セルフテスト,aidiy_navi,操作編.md)を追加しました。既存22冊とは別の新規アプリ用ガイドで、既済証拠と未確認範囲を区別しています。[PDF](./セルフテスト,aidiy_navi,操作編.pdf)を生成しました。
