# TaskTeam の内部認証と通常ログイン

## 認証の境界

- 単独起動のTask / TeamはCoreの通常ログインを使う。IDE連携起動はCoreの既存内部トークンをサーバー側で利用し、画面へ資格情報を渡さない。API は受け取った Bearer を同居 Core の `/core/auth/現在利用者` で検証する。Core内部主体は `internal_core` として識別し、利用者IDを他人やadminへ置換しない。Core が利用不能なら 503、無効なログインなら 401。localhost や任意の利用者IDヘッダーだけで認証しない。
- `/task/*`、`/team/*`、`/task_check_okng` の業務 POST はすべて認証対象。root / health は最小限の稼働情報として公開する。待受 `0.0.0.0:8093` は維持し、Tools の loopback 制限とは分ける。
- 通常利用者・Core内部主体が本文へ指定する `利用者ID` / `操作利用者ID` はログイン利用者と一致が必要。省略された操作情報も実際の利用者で補完する。既存のタスクID単独CRUD・共有Teamの操作契約は変更しない（新たなレコード所有者ACLを導入したわけではない）。

## 内部ワーカーの資格情報

TaskTeam 起動時は永続化した最新の鍵・tokenが有効ならそのまま再利用し、期限外なら生成する。稼働中はOSローカル時刻の03:00を跨ぐと鍵・25時間tokenを一度更新する。公開先は `_AIDIY/backend_taskteam/internal_auth.json`。JSON の項目は `access_token`、`token_type`、`issued_at`、`expires_at`。

内部tokenは `tt1.` 形式の署名付き不透明Bearer。HMAC-SHA256、サービス専用のランダム秘密鍵、TaskTeam固有のissuer/audience/subject/scopeで検証する。通常利用者やadminを偽装せず、TaskTeam内部workerとして識別する。有効な内部トークンにAPI別の許可表による差を設けず、認証後の通常の業務条件は維持する。Coreの通常JWT・Code/Live内部JWTとは別物で、Coreへの権限は持たない。

- 有効期限は発行から25時間。更新時は以前の鍵を旧側へ移し、旧tokenも自身の期限まで検証できる。再起動でもこの重なりを維持する。
- 起動時点が03:00を過ぎていても有効な最新tokenは再利用する。次の03:00より先に期限が来る場合は期限到達時にも生成し、期限切れのまま待たない。Core再起動には依存しない。
- 秘密鍵の正本は `_AIDIY/backend_taskteam/internal_auth_keys.json`。公開tokenファイルに秘密鍵は入れない。世代ごとの鍵・発行時刻・期限と最新tokenを持ち、原子的に保存する。非秘密の `.internal_auth_keys.lock` で並行更新を直列化する。
- 秘密鍵正本→検証状態→公開tokenの順で反映する。公開保存だけ失敗したときは次回同じ確定済みtokenを再公開し、不要な再生成をしない。壊れた秘密鍵正本は黙って作り直さずエラーにする。
- 初回保存失敗は起動失敗とする。日次保存失敗は定数メッセージだけ記録し再試行する。
- POSIXではディレクトリ0700、ファイル0600。symlink配置は拒否する。Windowsでは配置先ACLも適切に管理する。
- tokenファイルはGit・汎用ファイルAPI・バックアップ対象にしない。本文・ログ・コマンド引数・AIプロンプトへtokenを貼らない。

## 呼出し元

- Task の init/start/do/if/or/end、Team の init/経験/SPDCA共通HTTPは `taskteam_proc/internal_client.py` を使い、要求ごとにファイルを読み、401時だけ一度再読込する。
- Tools の Task Agents / Team Agents は自身の配置先からTaskTeamファイルを読み、同じ再読込規則でPOSTする。Toolsに新たなissuerは作らない。Tools自身のlocal実行境界は別途維持する。
- 内部tokenを外部URL・環境proxy・redirect先へ送らない。リモートのTaskTeamへ接続する任意設定には内部tokenを転送しない。
- AIからの完了報告は認証helperを使う。helperの案内だけをプロンプトへ渡し、tokenそのものは渡さない。既存custom promptを使う場合にも実行時に案内を追加する。
- TaskTeamには現状WebSocket/SSEエンドポイントがない。単独画面は既存axiosのBearer付与・401時ログイン破棄を維持する。IDE連携はNode側で要求ごとにCore内部ファイルを再読込し、401時だけ一度再読込・再試行する。RendererのstorageやURLには内部トークンを置かない。

## 安全な検証

本番サービス・DB・資格情報を使わず、`backend_taskteam/checks/test_taskteam_auth.py` と `test_internal_client.py` / `test_persisted_auth.py`、`backend_tools/checks/test_taskteam_auth.py` / `test_tools_outbound.py` をfixtureで実行する。起動の確認は実際のlifespanを起動せず、抽出した制御順序をmockで検査する。03時更新・有効tokenの再起動再利用・期限境界・改ざん・無認証・利用者偽装・Core停止・proxy/redirect拒否を分けて確認する。
