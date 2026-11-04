# Node.js 外部 API 通信の注意点

> 文書: `共通,Node.js外部API通信の注意点.md` | 実装: `backend_diag/runtime/environment_proxy.ts`, `backend_diag/runtime/model_probe.ts`, `frontend_channels/src/接続/ネットワーク接続.ts`, `frontend_channels/src/接続/接続エラー.ts`

## このメモを使う場面

- ブラウザや Python では使える API が Node.js からだけ取得できない。
- 正しいキーでもモデル一覧取得が失敗し、認証と通信経路を切り分けたい。
- HTTP クライアント変更時に、プロキシ・TLS・ローカル通信の回帰を確認する。

## 自動適用を前提にしない

Node.js のバージョンと使用クライアント（標準 `http/https`、組込み `fetch`、Undici、SDK）の設定を区別する。`HTTP_PROXY` が存在するだけで全クライアントが従うとは限らない。標準 HTTP の `proxyEnv` は Node.js 24.5.0 / 22.21.0 以降の機能で、global agent で使う場合は `NODE_USE_ENV_PROXY=1` 等の有効化条件がある。個別 agent / dispatcher を使う処理にも適用されたか実通信で確かめる。[Node.js 公式 HTTP ドキュメント](https://nodejs.org/api/http.html#built-in-proxy-support)

OS のプロキシ画面、PAC / 自動検出、ブラウザの設定と、実行プロセスが継承した環境変数は別物。ターミナル、Electron、サービス、IDE、子プロセスで環境が異なる場合がある。OS 設定や資格情報を診断コードから書き換えず、対象プロセスに変数があるかを値を表示せず確認する。

## AiDiy の明示的な経路規則

Discord の `プロキシ経路` と Diag の `proxyRoute` は次の優先順位を使う。空文字列は未指定として次候補へ進む。大文字小文字を区別できる環境では小文字優先。Windows の `process.env` は大文字小文字を区別しないため、相反する二重定義に依存しない。

| 対象 | 優先順位・動作 |
|---|---|
| HTTP | `http_proxy` → `HTTP_PROXY` |
| HTTPS | `https_proxy` → `HTTPS_PROXY` → HTTP の設定 |
| 除外指定 | `no_proxy` → `NO_PROXY`、カンマまたは空白区切り、大文字小文字を区別しない |
| HTTP(S) プロキシ URL | `http://host:port` または `https://host:port`。既存の user/password 指定は CONNECT 用 Basic 認証にだけ使用 |
| `ALL_PROXY` / `all_proxy` | 両実装とも参照しない。SOCKS、PAC、OS 設定の自動読取も未対応 |

`NO_PROXY` は `*`、完全一致ホスト、`.example.com` / `*.example.com` の末尾一致、`host:port` を扱う。単独 `example.com` はサブドメイン全体ではなく完全一致。`.example.com` は頂点の `example.com` を含まないので必要なら両方書く。CIDR、IP 範囲、任意位置の glob、DNS 解決後のアドレス照合は行わない。他のライブラリや Node 組込みの除外規則と同一とは限らない。

`localhost`、`.localhost`、`127.*`、`[::1]` は除外指定がなくても直接接続する。Diag の Ollama は `127.0.0.1:11434` 固定、MCP / Live 試行は既存の固定 loopback・`agent:false` のまま。global agent を変更せず、外部モデル API 専用の agent を使うので、ローカル試行を外部プロキシへ流さない。任意ホスト名が内部 IP に解決されるケースまで保証する仕組みではない。

## TLS と認証情報

- Diag は固定 HTTPS API に HTTP(S) proxy の CONNECT トンネルを使用する。HTTPS proxy 自身とトンネル内の API の双方で TLS 検証を有効にし、接続先ホスト名も検証する。
- API の Authorization / API key はトンネル内へ、Proxy-Authorization は CONNECT へ分離する。プロキシ URL にパス・query・fragment を含めた設定は Diag では拒否する。
- 明示されたプロキシが拒否・認証エラー・切断・タイムアウトになっても勝手に直接接続へ切り替えない。リダイレクトも追わない。`NO_PROXY` に一致する場合だけ、利用者が指定した除外経路を使う。
- 組織の TLS 検査等で CA が必要なら、管理者から正当に提供された CA を Node の正式な信頼設定で使用する。`NODE_EXTRA_CA_CERTS` は起動時読取で、後から `process.env` を変えてもそのプロセスには反映されない。明示的な `ca` オプション指定時の優先関係にも注意する。[Node.js 公式 CA 設定](https://nodejs.org/api/cli.html#node_extra_ca_certsfile)
- `rejectUnauthorized:false` や TLS 検証無効化を解決策にしない。HTTP proxy への CONNECT 自体は暗号化されないため、proxy 認証を使う場合は組織が許可した通信経路を選ぶ。

## 安全な原因分類と切り分け

1. API 認証・アクセス拒否（HTTP 401/403）と、名前解決・TLS・接続失敗を区別する。Diag は `dns` / `tls` / `network` / `timeout` / `proxy-config` / `proxy-auth` / `proxy-connect` / `auth` 等の固定分類から説明を作る。
2. エラーオブジェクト全文、URL、ヘッダー、応答本文、キー、OAuth token、proxy user/password をログ・UI・ナレッジへ保存しない。分類文字列以外の生の `error.message` は出さない。DNS/TLS は API と proxy のどちらでも起こるため、キー不正と断定しない。
3. 同じ実行経路で環境変数の有無、クライアントの agent / dispatcher、CA 継承を確認する。実機で発生したモデル取得エラーの原因は未確定であり、コード上の proxy 差だけを根拠に原因確定としない。

## Discord と Diag の実装上の根拠

Discord は `frontend_channels/src/接続/ネットワーク接続.ts` で REST に Undici `ProxyAgent`、Gateway / 音声 WSS に `HttpsProxyAgent` を明示的に使う。`接続エラー.ts` はネットワーク分類と安全な説明を扱う。履歴 `a8535f1497f49e13bb466126cc015fa0f43fb697` が REST / Gateway、`f50d3884a4c5ba0510c81bc5073071ee9dc84288` が音声 WSS 経路追加の参照点。

Diag は旧 `model_probe.ts` の外部 HTTPS も `agent:false` 固定だったため環境 proxy を使わなかった。現行は `environment_proxy.ts` が経路選択と標準モジュールによる CONNECT を所有し、`model_probe.ts` が固定宛先・タイムアウト・応答上限・キャンセルを維持する。OAuth / 公開一覧 / 個別 API で同じ通信処理を使う。モデル試行の外部 API は MCP / Live 側の既存実装が担当し、この変更で一括制御されるわけではない。

## 再検証

`node --test backend_diag/checks/environment-proxy.check.mjs backend_diag/checks/model-http.check.mjs` で、実キー・実 API を使わず loopback mock の proxy と TLS API へ接続する。proxy が CONNECT を受けたこと、API と proxy の認証ヘッダーが分離されること、NO_PROXY / 未指定時の直接接続、自己署名・ホスト名不一致の拒否、proxy 拒否・切断・中止・タイムアウト時の非直結、ローカル Ollama の直接接続、安全な失敗説明を検証する。TLS fixture はテスト子プロセスだけが信頼する公開ダミーで、OS 信頼ストアに入れない。

`python -m unittest discover -s backend_diag/checks -p check_setup.py` は、一括・単独セットアップの Diag 見出し / 対象説明 / 順序 / 重複なしを stdout mock で確認する。runtime の TypeScript を変更したら、既存の `node backend_diag/ui/build.mjs` で配布物を再生成し `node backend_diag/ui/verify.mjs` で一致を確認する。
