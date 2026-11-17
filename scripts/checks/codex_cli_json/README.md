# CLI JSON wrapper check

`cargo test --manifest-path scripts/checks/codex_cli_json/Cargo.toml --locked`

Codex本体と同じRustソースを直接読み込む軽量チェックです。JSON抽出・重複キー拒否・形式修正要求の入力保持を確認します。本体のプロセス制御・イベント変換・認証・Windows起動を検証するものではありません。
本体では `cargo test -p codex-core --locked aidiy_cli --lib` を別途実行してください。
