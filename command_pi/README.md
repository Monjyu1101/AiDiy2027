# AiDiy Pi（aidiy_pi）

AiDiy に統合したオンデマンド Code CLI です。MIT ライセンスの [Pi](https://github.com/earendil-works/pi) を基盤に、AiDiy のモデル一覧・APIキー・共有 OAuth・MCP・外部CLIを利用します。

## 導入と起動

AiDiy ルートで `python _setup.py` を実行し、Pi を選択してください。単体導入は `python command_pi/_setup.py` です。
導入後は、作業したいプロジェクトフォルダで `aidiy_pi` を実行します。起動したフォルダが作業対象となります。
upstream のグローバル `pi` インストールは不要です。
Pi本体の自己更新・更新チェック・通知は無効です。本体はAiDiy側で更新してください。拡張とモデル一覧の更新コマンドは利用できます。
組込みの検索（`grep` / `find`）とファイル名補完は Node.js で動作し、`rg` / `fd` 実行ファイルの自動ダウンロード・起動は行いません。

詳しい起動・モデル・認証・MCP・検証・cleanup の手順は [AiDiy 連携ナレッジ](../_AIDIY/knowledge/command_pi,AiDiy連携.md) を参照してください。

## 構成

- `aidiy/`: AiDiy 固有の入口と連携処理
- `_setup.py` / `_cleanup.py`: AiDiy 共通の導入・解除
- `packages/` / `apps/`: 同梱 Pi とその資料
- `scripts/`・ビルド／検証設定: モデルデータ生成と同梱コード保守

開発方針は [AGENTS.md](AGENTS.md)、実行上の注意は [SECURITY.md](SECURITY.md) を参照してください。

## ライセンス

Pi 由来部分は [MIT License](LICENSE)（Copyright (c) 2025 Mario Zechner）です。
AiDiy 独自部分は [AiDiy の LICENSE](../LICENSE) に従います。各第三者資材のライセンス・帰属表示も維持しています。
