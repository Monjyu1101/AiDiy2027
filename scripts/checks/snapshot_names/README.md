# Snapshot名の回帰確認

Codexと同じ `insta = 1.46.3` で、短い名前の保存先解決・自動連番・既存のOS suffixの継承を検証する小さな独立ハーネスです。Codex本体の描画・会話処理テストを代替するものではありません。

リポジトリルートから実行します。期待値を更新しないよう `INSTA_UPDATE=no`、内容比較のみの確認として `INSTA_REQUIRE_FULL_MATCH=0` を指定します。

```sh
python -m unittest discover -s scripts/checks -p test_repository_paths.py
INSTA_UPDATE=no cargo test --locked --manifest-path scripts/checks/snapshot_names/Cargo.toml
INSTA_UPDATE=no INSTA_REQUIRE_FULL_MATCH=0 cargo run --locked --manifest-path scripts/checks/snapshot_names/Cargo.toml -- "$PWD"
```

Windowsでは同じ環境変数を `set` またはPowerShellの `$env:` で指定し、最後の引数にリポジトリの絶対パスを渡します。

- `codex_snapshot_renames.json` は改名対応表です。snapshotを追加・移動した場合は対応表も更新します。
- `codex_snapshot_aliases.json` は最初に個別短名化した31件の対応表です。
- snapshotの内容は読み取り、同じ値でInstaのlookupを実行します。元のRust評価式の実行結果を比較する検証ではありません。
- 実際の回帰確認ではCodex側の対象crateテストも実行してください。
