# Docker 構成と起動手順

> 文書: `backend_server,frontend_web,Docker構成.md` | 実装: `docker/`, `docker/README.md`

## このメモを使う場面
- HTTPS 付き Nginx プロキシ構成で画面を確認する
- Docker で core/apps/backend と frontend_web をまとめて起動する
- Docker 環境とローカル起動環境の差を判断する

## 関連ファイル
- `docker/` — Docker 構成一式
- `docker/README.md` — 証明書や詳細手順の一次確認先
- `docker/docker_1build.bat` — 初回ビルド、再ビルド
- `docker/docker_2start.bat` — 起動
- `docker/docker_3stop.bat` — 停止
- `docker/Dockerfile` — イメージ内で `frontend_web` をビルドし、`/app/frontend_web/dist` へ配置する。ホスト側の `frontend_web/dist/` は不要

## 構成

```text
Nginx (HTTPS :443 / HTTP :80)
  -> frontend_web 静的ファイル
  -> backend core (:8091)
  -> backend apps (:8098)
```

- `backend_tools` (`:8095`)、`backend_taskteam` (`:8093`)、`backend_local` (`:8096`) は Docker 構成に含めない。nginx にも `/task` / `/team` のプロキシが無いため、AIタスク画面とAIチーム画面はこの構成では動かない。MCP 検証が必要な場合はローカルで別途起動する。
- `docker-compose.yml` が公開するホストポートは core/apps の `8091` / `8098` と nginx の `80` / `443` だけ。コンテナ内では `start.sh` が `python -m http.server 8090` も動かすが、`8090` はホストへ公開しないため画面確認は `https://localhost/` を使う。
- 通常の画面確認は `https://localhost/`、Swagger 確認は `http://127.0.0.1:8091/docs` / `http://127.0.0.1:8098/docs` を使う。
- コンテナ名は `aidiy2027`。ログ確認は `docker logs aidiy2027`。

## 起動手順

```powershell
cd docker
.\docker_1build.bat   # 初回、または frontend_web 変更反映時
.\docker_2start.bat   # 起動
.\docker_3stop.bat    # 停止
```

`docker_1build.bat` は SSL 証明書を生成してから `docker-compose build --no-cache` を実行する。ホスト側で `npm run build` は行わず、`frontend_web` のビルドは `docker/Dockerfile` の `frontend-builder` ステージ（`node:20-alpine` + `npm ci` + `npm run build`）がイメージ内で行う。ホストの `frontend_web/dist/` は使わないため、`npm run dev` の変更を Docker へ反映するにはイメージの再ビルドが必要。

## マウント構成

| ホスト側 | コンテナ内 | 備考 |
|---------|------------|------|
| `../_data/` | `/app/_data/` | SQLite DB（書き込み可） |
| `../_config/` | `/app/_config/` | APIキー設定（read-only） |
| `../_icons/` | `/app/_icons/` | アプリケーション共通アイコン |
| `../temp/` | `/app/temp/` | ログ・作業ファイル |
| named volume `frontend-dist` | `/app/frontend_web/dist`（app）<br>`/usr/share/nginx/html`（nginx, read-only） | イメージ内でビルドした静的ファイルを nginx へ共有する。ホストのフォルダではない |

- ローカル開発と Docker は、どちらもプロジェクトルートの `_data/AiDiy/database.db` を使用する。
- `_config` は read-only。設定変更は Docker 外で `_config/AiDiy_key.json` を編集し、コンテナを再起動して反映する。

## 判断基準

- 音声機能やマイク権限を確認する場合は HTTPS の `https://localhost/` を使う。
- API の単体確認や Swagger は `8091` / `8098` を直接使ってよい。
- MCP を含む疎通確認は Docker だけで完結しない。`backend_tools` をローカル起動する。
- HTTPS は自己署名証明書のため、ブラウザ警告は開発・検証用として扱う。
- Docker 仕様や証明書まわりで迷った場合は `docker/README.md` を優先する。

## 確認方法

```powershell
curl.exe -k https://localhost/
curl.exe http://127.0.0.1:8091/docs
curl.exe http://127.0.0.1:8098/docs
docker logs aidiy2027
```

画面確認では `https://localhost/` にログイン画面が表示されることを確認する。
