# Contributing

本プロジェクトへの貢献ありがとうございます。

## 前提

- 文字コードは UTF-8 固定
- 日本語の命名規約（テーブル/カラム/API/コンポーネント）を遵守
- ライセンス条件（`LICENSE`）を遵守（非商用利用のみ許可）
- 既存ドキュメントに従う
  - `AGENTS.md`
  - `docs/` フォルダ（コーディングルール、実装例など）
  - `backend_server/AGENTS.md`
  - `backend_tools/AGENTS.md`
  - `backend_local/AGENTS.md`
  - `backend_taskteam/AGENTS.md`
  - `command_hermes/AGENTS.md`
  - `frontend_web/AGENTS.md`
  - `frontend_avatar/AGENTS.md`
  - `frontend_ide/host/AGENTS.md`
  - `frontend_channels/AGENTS.md`
  - `frontend_channels/slack/AGENTS.md`
  - `frontend_ide/AGENTS.md`
  - `backend_diag/AGENTS.md`

## ライセンス（重要）

- 本プロジェクトは非商用利用を前提とした公開ライセンスです
- 商用利用には、事前に全著作権者（諸作権者）の書面承諾が必要です

## 変更の流れ

1. 変更方針を決める（関連ドキュメントを確認）
2. 小さく変更し、動作確認する
3. README やドキュメントへの追記が必要なら同時に更新

## テスト

主な自動テストは `backend_server/checks/` の `unittest` と、`frontend_ide/host/checks/`（Code）・`frontend_ide/host/aidiy_live/checks/`（Live）の Node.js テスト、`frontend_ide/host/checks/` の Python テスト、`frontend_channels/checks/` の Node.js / Python テストです。サーバー起動や Discord への接続は不要です。`command_hermes/checks/`、`scripts/checks/` にも `unittest` があります。

```powershell
cd backend_server
.venv\Scripts\python.exe -X utf8 -m unittest discover -s checks -v

cd ../frontend_ide/host
npm run check
npm test
npm run live:test
python -m unittest discover -s checks -p "test_*.py"

cd ../frontend_channels
npm run check
npm test
```

`frontend_avatar/checks/` には Web / Avatar の接続を検証する Node.js テスト、`scripts/checks/` にはルート起動・停止・セットアップのテストもあります。実行方法は [開発環境運用手順](./_AIDIY/knowledge/共通,開発環境運用手順.md) の「自動テスト」を参照し、変更対象に応じて実行してください。画面操作は手動でも確認します。

- API: http://127.0.0.1:8091/docs / http://127.0.0.1:8098/docs / http://127.0.0.1:8093/docs
- UI: http://127.0.0.1:8090
- 型チェック: `frontend_web` / `frontend_avatar` は `npm run type-check`（`npm run build` は配布物作成・成果物確認・明示依頼など、実行理由がある場合のみ）
- VS Code 拡張変更時: `frontend_ide/host` で `npm run check` / `npm test` / `npm run live:test`。配布物確認時は `npm run package`（Code / Live の 2 つの VSIX を生成）。`frontend_channels` は `frontend_ide/host` の CLI 実行・Live 通信・モデル保存処理を共有するため、これらを変えた場合は Discord のテストも実行
- Discord Bot 変更時: `frontend_channels` で `npm run check` / `npm test`（ビルド不要）。ルートで `python -X utf8 -m unittest discover -s frontend_channels/checks -p "test_*.py"`
- Slack Bot 変更時: `frontend_channels/slack` で `npm run check` / `npm test`。ルートで `python -X utf8 -m unittest discover -s frontend_channels/slack/checks -p "test_*.py"`
- MCP 連携変更時: `backend_tools` の MCP サーバー（Windows は20、Linux / macOS は19）（一覧は `GET http://127.0.0.1:8095/`、SSE は `http://127.0.0.1:8095/<mcp_name>/sse`）も確認

## セキュリティ

- APIキーなどの機密情報はコミットしないでください
- `_config/AiDiy_key.json` は `.gitignore` で除外しています

## 相談

大きな変更や設計変更は、Issue で相談してから進めてください。
