# AiDiy Pi の実行上の注意

`aidiy_pi` は起動ユーザーの権限で動作するローカル CLI です。通常モードではファイル変更・コマンド実行が可能です。信頼できるプロジェクトと拡張だけを使用し、必要に応じて OS やコンテナで隔離してください。

`--read-only` はモデルへ公開するツールを制限する AiDiy の機能で、OS のサンドボックスではありません。OAuth 更新や Pi 自身の状態管理は通常どおりです。詳細は [AiDiy 連携ナレッジ](../_AIDIY/knowledge/command_pi,AiDiy連携.md#yolo--read-only) を参照してください。

AiDiy のキー、共有 OAuth、Pi の設定・セッションは秘密情報として扱い、ログや公開 issue に添付しないでください。不具合報告には秘密情報を除いた再現手順とバージョンを記載してください。

Pi 本体の upstream セキュリティ窓口は [upstream の SECURITY.md](https://github.com/earendil-works/pi/blob/main/SECURITY.md) を確認してください。upstream の運用方針を AiDiy 全体の方針とは扱いません。
