# frontend_channels 実装概要

## 役割

外部接続チャンネルの共通の親フォルダです。各チャンネルの実装・依存・生成物は同階層の子フォルダへ分離します。

| フォルダ | 役割 |
|----------|------|
| `discord/` | Discord の Code / Live 接続。詳細は [discord/AGENTS.md](./discord/AGENTS.md) |
| `slack/` | Slack の Code 接続。詳細は [slack/AGENTS.md](./slack/AGENTS.md) |

## 基本方針

- 親には共通の案内と `LICENSE` を置き、特定チャンネルの起動入口・package.json・依存・生成物は置かない。
- 新しいチャンネルは `discord/`・`slack/` と同階層に追加する。個別の起動・停止・cleanup は他チャンネルのファイルやプロセスを対象にしない。
- Discord と Slack は音声機能と通信方式を除く双子のプログラム。共通の画面・起動・停止を変更するときは、両方の対応する実装を確認する。
- 各チャンネルは `frontend_ide/host` の CLI・共通部品を直接共有し、兄弟チャンネルの内部実装は読み込まない。
- 全体 setup / cleanup の Channels 選択と、個別の `aidiy_discord` / `aidiy_slack` コマンドを維持する。

導入・操作は [README.md](./README.md)、変更と検証は [接続機能の変更手順](../_AIDIY/knowledge/frontend_channels,Discord接続変更手順.md) を参照してください。
