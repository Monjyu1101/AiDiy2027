# AiDiy紹介__all_ja
テーマ: AiDiy は日本語ファーストのフルスタック業務管理テンプレートであり、FastAPI + SQLAlchemy + SQLite (Python 3.13) + Vue 3 + Vite + TypeScript を中核とする。 サービス構成は 5 本: backend_server (core_main ポート8091 / apps_main ポート8098)、backend_tools (MCP Hub ポート8095)、frontend_web (ポート8090)、frontend_avatar (Electron/Web デュアルモード ポート8092)。 日本語ファースト設計: テーブル名・カラム名・API パス・JSON キー・ファイル名・Vue Router パス・Python 変数名すべてを日本語で統一。system語(request/query/items)と英字ライブラリ名のみ英字可。 業務サンプル: C系(権限・利用者・採番)、M系(車両・配車区分・商品・取引先・商品構成・生産区分・生産工程)、T系(配車・入庫・出庫・棚卸・生産・生産払出)、V系(商品推移表 生SQL)、S系(スケジューラ週表示/日表示)。 AI コア: マルチAI対話・WebSocket ストリーミング・音声認識・画像生成・Code AI エージェント連携を多パネル UI で提供。 frontend_avatar: Electron/Web デュアルモード・Three.js + @pixiv/three-vrm・VRM アバター・AI 音声同期。 Code AI: code1〜code6 パネルに複数の Code AI CLI (claude-code / github-copilot / codex-cli / antigravity / opencode 等) を流し込む。aidiy_hermes は独自 Python エンジンで TUI・プロバイダ切り替え・subprocess 統合を提供。 AiDiy TOOL HUB (backend_tools): 14 の MCP サーバーを SSE / Streamable HTTP / stdio の 3 トランスポートで同一ポート 8095 に集約。ブラウザ操作・デスクトップキャプチャ・SQLite・PostgreSQL・ログ・コードチェック・バックアップ・画像生成・動画生成・音声認識・音声合成・OBS Studio制御・FFmpeg制御・コードエージェントを提供。HTTP POST で直接利用可能。 ビデオページ生成自動化: ビデオページ生成_紹介.py (ひとりアバター) / ビデオページ生成_解説.py (二人掛け合い) の 2 スクリプトで、topic から scenario.js 生成→画像生成→音声合成→HTML 組み立てまでを 9 ステップで全自動化。専用設定 JSON (_ビデオページ生成_*_設定.json) と状況 JSON で管理。 共有シーンテンプレート: _common/ フォルダに scene_core.js・scene.css・aidiy_scene.js (ひとり用)・double_scene.js (ふたり用) を一元管理。各 scene_NNN.html は 12 行の最小スタブ。 ナレッジ: _AIDIY/knowledge/_index.md が全 HowTo の入口。AGENTS.md は全体アーキテクチャ。スキーマ変更手順・MCP 実装パターン・フロントエンド共通パターン等を knowledge に集約。 この動画は AiDiy 自身のビデオページ生成機能で自動生成された。シナリオ作成・画像生成・音声合成・HTML 組み立てすべてを MCP と CodeAgents が担当。

## 進捗
- [x] フォルダ作成
- [x] シナリオ作成
- [x] HTML修正
- [x] 画像生成
- [x] 中間確認
- [x] 音声生成
- [x] 再生時間更新
- [x] 完成
