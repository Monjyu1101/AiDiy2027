# 外部接続チャンネル

Discord と Slack を同階層の独立したチャンネルとして配置します。親フォルダには共通の案内と [LICENSE](./LICENSE) を残し、各チャンネルの依存・生成物・起動入口は子フォルダが所有します。

| チャンネル | 配置 | コマンド | 機能 |
|------------|------|----------|------|
| Discord | [discord/](./discord/README.md) | `aidiy_discord` | Hermes の Code チャット / AIコア Live 音声 |
| Slack | [slack/](./slack/README.md) | `aidiy_slack` | Hermes の Code チャット（HTTPS 定期取得） |

ルートの `python _setup.py` と `python _cleanup.py` では Channels をまとめて選択します。個別の setup・start・cleanup・テストは、各チャンネルの README を参照してください。

追加チャンネルも `frontend_channels/<チャンネル名>/` に配置し、既存チャンネルの内部ファイルに依存しない構成にします。接続情報は共通の `_config/AiDiy_key.json`、Code / Live の共通部品は `frontend_ide/host` を使います。
