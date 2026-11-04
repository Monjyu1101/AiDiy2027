# loopback 専用 TLS fixture

`test-only-key.fixture` / `test-only-cert.fixture` は、このテスト専用に生成した公開のダミー鍵と自己署名証明書です。実サービス・アカウント・利用者の認証情報ではありません。実運用や OS の信頼ストアには導入しないでください。

テスト子プロセスだけが `NODE_EXTRA_CA_CERTS` でこの証明書を信頼します。接続先は mock が 127.0.0.1 へ限定し、実 API へ接続しません。SAN の API 名は TLS のホスト名検証を省略せず試験するためのものです。
