# Docker環境ガイド

## 🚀 起動

```bash
cd docker
docker_1build.bat    # 初回のみ（5-10分）
docker_2start.bat    # 起動（約10秒）
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
- パスワード: （README.mdを確認）

## 📚 API

```
http://127.0.0.1:8091/docs  # Core API (C系, A系)
http://127.0.0.1:8098/docs  # Apps API (M系, T系, V系, S系)
```

## この構成に含まれないサービス

- `backend_tools`（`8095`、MCP は Windows 20 / Linux・macOS 19 サーバー、Windows Control は Windows のみ: `aidiy_chrome_devtools` / `aidiy_desktop_capture` / `aidiy_sqlite` / `aidiy_postgres` / `aidiy_logs` / `aidiy_code_check` / `aidiy_backup` / `aidiy_image_generation` / `aidiy_movie_generation` / `aidiy_speech_to_text` / `aidiy_text_to_speech` / `aidiy_obs_studio_control` / `aidiy_ffmpeg_control` / `aidiy_notification_sounds` / `aidiy_code_agents` / `aidiy_chat_llms` / `aidiy_decisions_check` / `aidiy_task_agents` / `aidiy_team_agents` / `aidiy_windows_control`）は、この Docker ガイドの構成には含めていません。ブラウザ自動操作などの MCP は、通常のローカル開発手順で `backend_tools` を別途扱う前提です。
- `backend_taskteam`（`8093`、AIタスク実行 + AIチーム）と `backend_local`（`8096`、ローカル LLM）も未起動です。nginx にも `/task` / `/team` のプロキシがないため、**AIタスク画面とAIチーム画面はこの Docker 構成では動作しません**。

## 🔧 基本操作

```bash
docker_2start.bat    # 起動
docker_3stop.bat     # 停止
docker_4delete.bat   # 完全削除
```

## 🗑️ 削除方法

### パターン1: コンテナ停止のみ（データ保持）

```bash
docker_3stop.bat
```

- コンテナを停止
- イメージ・データベース・SSL証明書は保持
- 次回は`docker_2start.bat`で再起動可能

### パターン2: コンテナとイメージ削除

```bash
docker_4delete.bat
```

- コンテナを停止・削除
- Dockerイメージを削除
- SSL証明書を削除
- データベース（`../_data`）は保持
- 次回は`docker_1build.bat`から再構築

### パターン3: 完全削除（データベースも削除）

```bash
# 1. コンテナとイメージを削除
docker_4delete.bat

# 2. データベースを削除
cd ..
rmdir /s /q _data

# 3. 一時ファイルを削除
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

```bash
docker ps                # コンテナ確認
docker logs aidiy2027    # ログ確認
docker_3stop.bat         # 停止
docker_2start.bat        # 再起動
```

### ポートが使用中

```cmd
# ポート確認（この構成が使うのは 80 / 443 / 8091 / 8098）
netstat -ano | findstr :443
netstat -ano | findstr :8091

# ローカル起動を停止してから再実行
docker_2start.bat
```

### イメージビルドエラー

```bash
# 完全クリーンアップ
docker_4delete.bat
docker system prune -a -f

# 再ビルド
docker_1build.bat
```

### データベースエラー

```bash
# 停止
docker_3stop.bat

# データベース削除
cd ..
move _data\AiDiy\database.db _data\AiDiy\database.db.backup

# 再起動（新規DB自動作成）
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

**コンテナ名:**
- `aidiy2027`: メインアプリケーション
- `aidiy2027-nginx`: Nginxリバースプロキシ
