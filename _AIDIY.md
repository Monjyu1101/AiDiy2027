# AiDiy

## 本書の役割

このファイルは、AI エージェントが AiDiy の入口だけを短く把握するための最小メモです。
ここに手順、詳細仕様、個別の実装メモを追記しないでください。

詳しい情報は [AGENTS.md](./AGENTS.md) を参照してください。

## システム概要

AiDiy は、日本語を第一言語とするフルスタック業務システム開発テンプレートです。

- Backend: FastAPI + SQLAlchemy + SQLite（core 8091 / apps 8098）。
- Command Hermes: `aidiy_hermes` コード支援 CLI（常駐なし）。
- Backend MCP: Windows は20個、Linux / macOS は19個の MCP サーバー（Windows Control は Windows のみ）（Chrome / Desktop / SQLite / PostgreSQL / Logs / Code Check / Backup / Image Generation / Movie Generation / Speech-to-Text / Text-to-Speech / OBS Studio Control / FFmpeg Control / Notification Sounds / Code Agents / Chat LLM / Decisions Check / Task Agents / Team Agents / Windows Control）（ポート 8095）。
- Backend Local: OpenAI 互換の Gemma ローカル推論サーバー（ポート 8096）。
- Backend TaskTeam: AIタスク実行 + 定期タスクと複数AIエージェントのチーム活動を統合したサーバー（ポート 8093）。
- Frontend Web: Vue 3 + Vite + TypeScript（ポート 8090）。
- Frontend Avatar: Electron / Web デュアルモードの AI Avatar UI（ポート 8092）。
- Frontend VS Code: VS Code 拡張 2 種（`aidiy_hermes` を操作する AiDiy (Code)、AIコアへ接続する音声会話の AiDiy (Live)）と単独起動版（常駐なし）。どちらも開発スペース（`aidiy_ide`）の部品としても動作。
- Frontend Discord: Hermes チャットと AIコア Live 音声会話をつなぐ任意起動の Discord Bot（接続パネル付き）。
- Frontend Slack: HTTPS の定期取得で Hermes チャットへ接続する任意起動の Slack Bot（音声なし）。Discord 版と双子の接続パネルで、両方をそろえて保守する。
- Frontend Navigator: `aidiy_navi` の読み取り専用開発案内。目標・作業項目・推定達成率・次のプロンプトを表示し、提案は自動実行しない。IDE の「＋ Navigator」からも開ける。
- Frontend IDE: 開発スペース（宇宙をテーマにした IDE 開発環境）。宇宙表示・左側エクスプローラー・読み取り専用ビューアの AiDiy IDE。Code / Live を部品として呼び出せる（ポート自動割り当て、全体のセットアップ・起動・クリーンアップに組み込み済み）。
- AI コア: チャット、音声、画像、ファイル、code1〜code6 のコード支援パネル。
- AIタスク: 要求を AI が明細へ分解し Code CLI で自動実行する画面と実行基盤。
- AIチーム: 複数の AI エージェントが目標を共有し、依頼と作業ループで協働する画面と実行基盤。

業務システム機能追加の手順は `docs/` を参照してください。
コアシステム機能調整の手順は [`_AIDIY/knowledge/_index.md`](./_AIDIY/knowledge/_index.md) を参照してください。
起動、依存関係、自動テスト、型チェックの手順は [`_AIDIY/knowledge/共通,開発環境運用手順.md`](./_AIDIY/knowledge/共通,開発環境運用手順.md) を参照してください。
`npm run build` は日常的な確認に使わず、配布物作成や明示依頼など理由が明確な場合だけ実行してください。

詳細な概要、サブシステム構成、文書インデックスは [AGENTS.md](./AGENTS.md) を参照してください。

著作権・利用条件は [LICENSE](./LICENSE) を参照し、既存表示と第三者資材の LICENSE / NOTICE を保持してください。
