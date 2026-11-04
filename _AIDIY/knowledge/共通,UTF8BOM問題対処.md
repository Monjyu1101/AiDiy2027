# UTF-8 BOM 問題対処

> 文書: `共通,UTF8BOM問題対処.md` | 実装: `scripts/bom_anomaly_list.py`, `scripts/remove_bom.py`

## このメモを使う場面
- ファイル先頭の BOM による Python / FastAPI / Vue / JSON の不具合を疑う
- BOM 混入ファイルを検出・除去する
- Windows 環境で UTF-8 without BOM を維持する

## 関連ファイル
- `scripts/bom_anomaly_list.py` — BOM 混入ファイルの検出
- `scripts/remove_bom.py` — BOM の一括除去

## 検出手順

```powershell
python scripts/bom_anomaly_list.py
```

担当ファイルだけ確認する場合:

```powershell
$files = @(
  "_AIDIY/knowledge/backend_server,frontend_web,frontend_avatar,JWT認証フロー.md",
  "_AIDIY/knowledge/共通,ナレッジ更新手順.md"
)

foreach ($file in $files) {
  $bytes = [System.IO.File]::ReadAllBytes((Resolve-Path $file))
  if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) { $file }
}
```

## 除去手順

```powershell
python scripts/remove_bom.py          # プロジェクトルートから再帰的に除去
python scripts/remove_bom.py src/     # 指定フォルダ以下のみ除去
```

並列作業中は一括除去の前に差分対象を確認する。担当外ファイルに BOM が見つかった場合、許可がなければ編集せず最終報告で伝える。

## 判断基準

| 現象 | 確認対象 |
|------|----------|
| Python `SyntaxError: invalid character` | `.py` 先頭の BOM |
| FastAPI 起動失敗 | `__init__.py`, `main.py`, router 周辺の BOM |
| Vue / TypeScript のビルド失敗 | `.vue`, `.ts` 先頭の BOM |
| JSON パースエラー | `.json` 先頭の BOM と JSON 構文 |

## 再発防止

- VS Code は `files.encoding: "utf8"` にする。`utf8bom` は使わない。
- Windows メモ帳では「UTF-8 BOM あり」ではなく「UTF-8」で保存する。
- PowerShell で内容確認するときは `Get-Content -Encoding UTF8` を使う。
- docs の Python 先頭コメント `# -*- coding: utf-8 -*-` は BOM 付与を意味しない。
- コミット前や一括 Markdown 整理後は `python scripts/bom_anomaly_list.py` を実行する。

## 確認方法

```powershell
python scripts/bom_anomaly_list.py
# 出力が空なら BOM なし
```
