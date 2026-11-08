# Docker環境ガイド

現行の `Dockerfile` / `docker-compose.yml` / `start.sh` / `nginx.conf` に対応する、Core・Apps・Web の構成です。ローカルの全体起動と同じサービス一式ではありません。詳細は [Docker構成](../_AIDIY/knowledge/backend_server,frontend_web,Docker構成.md) を参照してください。

## 🚀 起動

以下の `.bat` は Windows のコマンドプロンプト用です。Docker Desktop が稼働し、スクリプトが呼ぶ `docker-compose` コマンドを利用できる必要があります。PowerShell では `.\docker_1build.bat` のように実行します。

```cmd
cd docker
rem 初回・ソース更新後のイメージ再構築
docker_1build.bat
rem 起動
docker_2start.bat
```

## 🌐 アクセス

⚠️ **音声機能にはHTTPS必須**

```
https://localhost/
```

**初回アクセス時の証明書警告:**
- Chrome: 「詳細設定」→「localhostにアクセスする」
- Edge: 「詳細」→「Webページへ移動」

**ログイン:**
- ユーザー名: `admin`
- パスワード: [ルートREADMEの初期ユーザー案内](../README.md)を確認。既存DBでは変更済みの認証情報を使用します。

## 📚 API

```
http://127.0.0.1:8091/docs  # Core API (C系, A系)
http://127.0.0.1:8098/docs  # Apps API (M系, T系, V系, S系)
```

## この構成に含まれないサービス

- `backend_tools`（`8095`、MCP は Windows 20 / Linux・macOS 19 サーバー、Windows Control は Windows のみ: `aidiy_chrome_devtools` / `aidiy_desktop_capture` / `aidiy_sqlite` / `aidiy_postgres` / `aidiy_logs` / `aidiy_code_check` / `aidiy_backup` / `aidiy_image_generation` / `aidiy_movie_generation` / `aidiy_speech_to_text` / `aidiy_text_to_speech` / `aidiy_obs_studio_control` / `aidiy_ffmpeg_control` / `aidiy_notification_sounds` / `aidiy_code_agents` / `aidiy_chat_llms` / `aidiy_decisions_check` / `aidiy_task_agents` / `aidiy_team_agents` / `aidiy_windows_control`）は、この Docker ガイドの構成には含めていません。ブラウザ自動操作などの MCP は、通常のローカル開発手順で `backend_tools` を別途扱う前提です。
- `backend_taskteam`（`8093`、AIタスク実行 + AIチーム）と `backend_local`（`8096`、ローカル LLM）も含みません。Task / Team は `frontend_ide` の独立アプリであり、この構成にその画面・バックエンドはありません。
- Diag、Avatar、IDEの単独アプリ、Channels、Hermes CLIもイメージには含めません。nginx のAPI転送は `/core/`・`/apps/`・`/ws/` で、`/mcp/`・`/task/`・`/team/` は未定義です。

## 🔧 基本操作

`docker_4delete.bat` はこの構成の削除に加えて、Docker 全体の未使用資源を整理します。他プロジェクトもある環境では、下の削除範囲を確認してから使ってください。

```cmd
rem 起動
docker_2start.bat
rem 停止
docker_3stop.bat
rem コンテナ・イメージ等の削除（データベースは保持）
docker_4delete.bat
```

## 🗑️ 削除方法

### パターン1: コンテナ停止のみ（データ保持）

```cmd
docker_3stop.bat
```

- コンテナを停止
- イメージ・データベース・SSL証明書は保持
- 次回は`docker_2start.bat`で再起動可能

### パターン2: コンテナ・イメージ等の削除

```cmd
docker_4delete.bat
```

- コンテナを停止・削除
- Dockerイメージを削除
- SSL証明書を削除
- データベース（`../_data`）は保持
- 次回は`docker_1build.bat`から再構築

現行スクリプトは `aidiy2027*` / `docker-aidiy2027*` / `nginx` イメージの削除を試み、`docker system prune -f`・`docker volume prune -f`・`docker network prune -f` も実行します。**他プロジェクトの停止済みコンテナや未使用資源も対象になり得ます。** `docker_frontend-dist` の削除も試みます。出力の一部を隠しているため、完了表示だけで全削除を判断せず Docker の状態を確認してください。

### パターン3: 完全削除（データベースも削除）

```cmd
rem 1. コンテナとイメージを削除
docker_4delete.bat

rem 2. データベースを削除
cd ..
rmdir /s /q _data

rem 3. 一時ファイルを削除
rmdir /s /q temp
```

### パターン4: SSL証明書の信頼削除

証明書を信頼済みルートに追加した場合：

```cmd
certutil -delstore "Root" localhost
```

## 🔐 SSL証明書

### 証明書の信頼設定（警告を消す）

```cmd
cd docker
certutil -addstore "Root" ssl\cert.pem
```

### 証明書の再生成

```cmd
cd docker
rmdir /s /q ssl
docker_1build.bat
```

## 🚨 トラブルシューティング

### HTTPSでアクセスできない

```cmd
rem コンテナ確認
docker ps
rem ログ確認
docker logs aidiy2027
rem 停止
docker_3stop.bat
rem 再起動
docker_2start.bat
```

### ポートが使用中

```cmd
rem ポート確認（この構成が使うのは 80 / 443 / 8091 / 8098）
netstat -ano | findstr :443
netstat -ano | findstr :8091

rem ローカル起動を停止してから再実行
docker_2start.bat
```

### イメージビルドエラー

```cmd
rem 完全クリーンアップ
docker_4delete.bat
rem 他プロジェクトの未使用イメージまで削除する prune -a は通常の再ビルドには不要

rem 再ビルド
docker_1build.bat
```

### データベースエラー

```cmd
rem 停止
docker_3stop.bat

rem データベースを退避（既存データを使わず新規作成する場合のみ）
cd ..
move _data\AiDiy\database.db _data\AiDiy\database.db.backup

rem 再起動（新規DB自動作成）
cd docker
docker_2start.bat
```

### マイクが使えない

1. HTTPSでアクセスしているか確認: `https://localhost/`
2. アドレスバーの錠前アイコン → マイク → 許可
3. F12開発者ツールでエラー確認

## 📝 技術情報

**ポート（ホストへ公開されるのは 8091 / 8098 / 80 / 443 のみ）:**
- 8090: Frontend (Vue 3) — コンテナ内の `python -m http.server` のみ。ホストへは非公開（画面は nginx が配信）
- 8091: Backend Core API
- 8098: Backend Apps API
- 8093: Backend TaskTeam（AIタスク・AIチーム。この Docker 構成では未提供）
- 8096: Backend Local（この Docker 構成では未提供）
- 8095: Backend MCP（この Docker 構成では未提供）
- 80: HTTP（Nginxプロキシ、自動的にHTTPSへリダイレクト）
- 443: HTTPS（Nginxプロキシ）

**データ永続化:**
- `../temp`: ログ・作業ファイル
- `../_data`: SQLiteデータベース
- `./ssl`: SSL証明書
- `../_config`: 共通設定をコンテナへ読み取り専用でマウント。必要な設定はホスト側で用意し、コンテナ内からの設定書込はできません。
- `../_icons`: 共通アイコン
- `frontend-dist`: ビルド済み Web を nginx と共有する名前付きボリューム。Compose の `aidiy-data` は宣言のみで、DB は上記 `_data` のバインドマウントを使います。

**コンテナ名:**
- `aidiy2027`: メインアプリケーション
- `aidiy2027-nginx`: Nginxリバースプロキシ
