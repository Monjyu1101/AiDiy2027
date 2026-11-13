# command_pi の実装方針

## 位置づけ

`command_pi` は AiDiy のオンデマンド Code CLI `aidiy_pi` です。
Pi（earendil-works/pi、MIT）のランタイムを同梱し、AiDiy のモデル一覧、設定、共有認証、MCP、外部 Code CLI と連携します。独立した upstream Pi リポジトリとして運用しません。

全体方針は [AiDiy の AGENTS.md](../AGENTS.md)、手順の入口は [_AIDIY/knowledge/_index.md](../_AIDIY/knowledge/_index.md) です。
setup・起動・検証・モデル設定などの HowTo は [command_pi,AiDiy連携.md](../_AIDIY/knowledge/command_pi,AiDiy連携.md) に集約し、本書には一時的な作業ログを書きません。

## 構成と責務

| 配置 | 責務 |
|---|---|
| `aidiy/aidiy_pi.ts` | AiDiy 用起動入口、引数、初期モデル |
| `aidiy/aidiy-providers.ts` | AiDiy モデル・キー・MCP・最終選択の連携 |
| `aidiy/aidiy-oauth.ts` | Codex / Grok の共有ログイン |
| `aidiy/aidiy-cli.ts` / `aidiy-cli.py` | 既存 CodeAI 基盤への外部CLI委譲 |
| `aidiy/aidiy-mode.ts` | YOLO / read-only の実行制約 |
| `aidiy/assets/` | AiDiy Pi アイコンと帰属用の原本 |
| `_setup.py` / `_cleanup.py` | AiDiy 共通運用に従う依存導入・ランチャー登録・解除 |
| `packages/` / `apps/` | 同梱Piの実装・資料。AiDiy連携と責務を分離 |
| `scripts/`、各種設定 | 同梱コードの検証・モデルデータ生成・保守基盤 |

## 変更時の基本方針

- AiDiy 固有の処理は原則 `aidiy/` に置き、upstream 側の変更は必要最小限にする。既存の AiDiy-Pi ロゴを維持する。
- Node のソース実行と source resolver を維持する。日常の検証のためだけに配布ビルドを追加しない。
- AiDiy のモデル区分・設定キー・CodeAI 実行基盤を再利用し、独自の設定や別の認証保存先を増やさない。
- キー・トークン・認証ファイルの内容をログ、テスト証跡、コミットに含めない。read-only の制限を弱めない。
- 日本語の説明と UTF-8 を基本とする。upstream API の識別子やパッケージ名は無理に改名しない。
- TypeScript の Node ソース実行に対応する構文を使う。生成モデルデータを手編集せず、既存の生成処理を利用する。
- パッケージ資材の解決は既存の `packages/coding-agent/src/config.ts` の仕組みを使う。
- 依存は lockfile に従い `--ignore-scripts` で導入する。型エラー回避のため機能を削除しない。
- 検証は変更対象に絞り、認証不要の起動確認・型検査・ローカルテストを優先する。有料API呼出しや実認証の更新をテスト目的で勝手に実行しない。
- 他の作業の変更を巻き戻さない。push は依頼がある場合だけ行う。

## ライセンスと upstream

同梱 Pi の [LICENSE](LICENSE)（MIT、Mario Zechner）と各第三者資材の表示を維持します。
AiDiy 独自部分の利用条件は [リポジトリルートの LICENSE](../LICENSE) に従います。両者を混同してライセンス表示を一括置換しません。

upstream の寄稿承認制度、GitHub 運用、リリース指示、ローカル開発拡張は AiDiy の運用ルールではありません。
upstream 更新時も、それらを無条件に復活させず、AiDiy の入口とナレッジを維持してください。
