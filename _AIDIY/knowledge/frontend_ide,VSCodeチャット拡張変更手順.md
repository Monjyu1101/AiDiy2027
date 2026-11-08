# VS Code チャット拡張変更手順

> 文書: `frontend_ide,VSCodeチャット拡張変更手順.md` | 実装: `frontend_ide/host/package.json`, `frontend_ide/host/scripts/test.mjs`, `frontend_ide/host/src/extension.ts`, `frontend_ide/host/src/code-connection.ts`, `frontend_ide/host/src/forwarded-origin.ts`, `frontend_ide/host/src/runner.ts`, `frontend_ide/host/src/protocol.ts`, `frontend_ide/host/aidiy_code/src/offline.ts`, `frontend_ide/host/aidiy_code/src/server.ts`, `frontend_ide/host/aidiy_code/launch.mjs`, `frontend_ide/host/src/model-preferences.ts`, `frontend_ide/host/aidiy_live/`, `frontend_ide/host/_setup.py`, `frontend_ide/host/_cleanup.py`

## このメモを使う場面

- VS Code の AiDiy Code / AiDiy Live 拡張のビュー、コマンド、設定を変更する。
- `aidiy_hermes` の起動、停止、Provider / モデル選択を調整する。
- Live のライブ会話画面、音声入出力、AIコアへの接続を調整する。
- Webview と単独試用画面を変更する。
- VSIX を生成し、VS Code へ配置して確認する。
- 単独起動用の `aidiy_code` / `aidiy_live` コマンドを配置する。
- `out/*.cjs` と `out/aidiy_code/server.cjs` だけが差分一覧に出たとき、生成元との整合性を再検証する。
- `out/aidiy_code/<起動ID>.json` だけが変更通知に出たとき、起動完了通知として検証する。

> Code / Live の画面は frontend_ide の Vue 画面に統一済み（VS Code の Webview・単独起動・IDE で共用）。Vue 移行前の画面（`media/chat.html` / `chat.css`、`src/webview.ts`、`aidiy_code/bridge.js` / `theme.css`、`aidiy_live/src/view.ts` / `bridge.ts`、`aidiy_live/media/index.html` / `style.css`、`src/scroll-follow.ts`）と旧 Electron 本体（`aidiy_code` / `aidiy_live` の `desktop.cjs` / `preload.cjs`、`aidiy_live/permissions.cjs`）は 2026-10-18 に削除した。

## 変更箇所の選び方

| 変更内容 | 主なファイル | 同時に確認するもの |
|----------|--------------|--------------------|
| ビュー、コマンド、設定 | `package.json`, `src/extension.ts`, `src/vscode-html.ts` | `README.md`, `frontend_ide/src/components/コード/コードパネル.vue` |
| CLI 探索、引数、標準入出力、停止 | `src/runner.ts` | `checks/runner.test.cjs` |
| AIコード互換 packet | `src/protocol.ts` | `backend_server/AIコア/AIコード.py`, `backend_server/AIコア/AIコード_cli.py` |
| チャット表示、入力 | `frontend_ide/src/components/コード/コードパネル.vue`, `frontend_ide/src/components/コード/コード通信.js`, `frontend_ide/src/components/共通表示/会話表示.css` | `checks/aidiy_code.test.cjs`, frontend_ide の `checks/` |
| Code の接続・モデル候補 | `src/code-connection.ts` | `aidiy_live/local-backend.cjs`, AIコアのモデル情報API、`checks/code-connection.test.cjs`、`checks/code-extension.test.cjs` |
| 最終手動モデルの保存・復元 | `src/model-preferences.ts`, `src/extension.ts`, `aidiy_code/src/server.ts`, `aidiy_live/src/extension.ts`, `aidiy_live/src/server.ts`, `frontend_ide/src/components/ライブ/ライブパネル.vue` | Code / Live の画面・サーバー検証、両 README |
| 単独起動・IDE の API サーバー（画面は返さない） | `aidiy_code/src/server.ts` | `checks/aidiy_code.test.cjs`, `checks/browser-mode.test.cjs` |
| 単独ウィンドウ、タイトルバー | `frontend_ide/desktop.cjs`, `frontend_ide/デスクトップ/`, `aidiy_code/launch.mjs` | `frontend_ide/src/components/コード/コードパネル.vue`, `frontend_ide/src/components/共通表示/会話表示.css` |
| bundle / VSIX | `scripts/build.mjs`, `scripts/package.mjs`, `package.json`, `aidiy_live/build.mjs`, `aidiy_live/package.json` | 両 `.vscodeignore`, `dist/THIRD_PARTY_NOTICES.txt` |
| Live 拡張、通信、マイク | `aidiy_live/src/extension.ts`, `src/host.ts`, `microphone.py`（いずれも `aidiy_live/` 内） | `aidiy_live/checks/host.test.cjs`, `aidiy_live/checks/extension.test.cjs`, `aidiy_live/README.md` |
| Live 画面、音声、音量表示 | `frontend_ide/src/components/ライブ/ライブパネル.vue`, `aidiy_live/src/audio.ts`, `src/visualizer.ts`, `src/protocol.ts`, `media/capture.js`（`aidiy_live/` 内） | frontend_ide の `checks/`, `aidiy_live/checks/live.test.cjs` |
| Live 単独起動、中継、マイク許可 | `aidiy_live/launch.mjs`, `aidiy_live/src/server.ts`, `frontend_ide/desktop.cjs`（`audioAllowed`） | `aidiy_live/checks/launcher.test.cjs`, `aidiy_live/checks/live.test.cjs` |
| セットアップ、ランチャー、クリーンアップ | `_setup.py`, `_cleanup.py`, `scripts/vscode_extensions.py`, `scripts/standalone_processes.py` | `checks/test_setup.py`, `checks/test_extensions.py`, `checks/test_cleanup_processes.py` |

## 実装上の維持事項

- Code / Live は既存AIコアのWebSocketとモデル情報APIを使う。Code の接続は `src/code-connection.ts` が input → セッション設定API → 出力1 の順に行い、両init完了後にAIコアへ送信する。未接続中のCode送信はHermesの直接実行へ渡す。
- 独立した Code セッションの input／1 の `connect` には JSON boolean の `voice: false` を送る。新規接続・保存済み会話の再開・自動再接続のすべてで維持し、`checks/code-connection.test.cjs` で実際の送信 packet を確認する。Live の `LiveConnection` と、Web／Avatar 内で音声セッションを共有するコード画面には、この指定を追加しない。
- Code / Live は別々の拡張 ID・コマンド・設定・VSIX を維持し、`extensionDependencies` / `extensionPack` で相互依存させない。片方の非導入・無効化で他方が起動できることを確認する。
- Live の Windows マイクは Webview の権限に依存せず、拡張ホストの Python 標準ライブラリ補助で取り込む。音声処理と自動減衰はスタンドアロンと共有し、非表示・切断・無効化でマイクを終了する。
- CLI は `shell: false` で起動し、要求本文は標準入力で渡す。要求文をコマンドライン引数へ埋め込まない。
- 拡張側から `--yolo` を追加しない。
- `input_text` / `input_request` / `cancel_run` / `output_stream` / `output_text` の識別子と、開始 `STX`・終了 `ETX`・中断 `CAN` の1バイト制御値を既存 AIコード実装と揃える。制御値に改行を含めず、Webview にも表示しない。
- `.cmd` は AiDiy `_setup.py` が生成する `PY` / `CLI` 形式だけを解析し、任意の batch を実行しない。
- ワークスペース未信頼時、仮想ワークスペース、Web 版では CLI を実行しない。
- Webview では Markdown の HTML と外部画像を無効のまま維持し、外部リンクは `http` / `https` のみにする。
- Vue 画面を変えた場合は VS Code 拡張（Webview）・単独起動・IDE の 3 つで確認する。
- `src/runner.ts`、`src/protocol.ts`、`aidiy_live/src/protocol.ts`、`src/model-preferences.ts`、`scripts/model-catalog.py` を変えた場合は、これらを直接共有する `frontend_channels/discord` で `npm run check` / `npm test` も実行する。詳細は [`frontend_channels,Discord接続変更手順.md`](./frontend_channels,Discord接続変更手順.md) を参照する。
- 初回は最初の状態通知を反映してから黒い画面からフェードインする。履歴復元時の保存済み回答にはタイプ表示を再適用せず、新しい回答だけを演出する。状態更新や会話切り替えではフェードインを繰り返さない。
- スタンドアロンの専用ウィンドウは中心を保ちながら初回だけ拡大する。拡大中は `opening` 通知で内容と初期画面の演出を止め、拡大後に最小サイズを戻して内容を表示する。ブラウザモードは CSS の拡大表示を使う。
- 専用ウィンドウの起動位置は、マウスポインターがある画面の作業領域を基準に Code を左上、Live を右上にする。端に約8pxの余白を設け、Live は拡大演出後の実際の幅で右端を合わせる。
- Live は `retainContextWhenHidden` で画面を保持し、タブ切り替えでは接続を閉じない。非表示中はマイクだけを停止し、heartbeat は拡張ホストで継続する。会話・接続通知を上限つきで保持して再表示時に反映し、非表示中の音声は再生しない。
- Live の input／0／audio の `connect` パケットに `CODE_BASE_PATH` と任意の `モデル設定`（Live の AI 名・モデル・音声）を含め、バックエンドの初期化前に反映する。接続後の設定 API による差し替えは行わない。接続中に別フォルダへ変わった場合は切断し、次回の接続に反映する。
- Live のモデル候補は `/core/AIコア/モデル情報/取得` を使う。起動時に空の `セッションID` で `AiDiy_key.json` に基づく既定設定と候補を取得し、接続前から AI 名・モデル・音声を表示する（セッションは作成しない）。起動引数の指定値を優先し、候補一覧にない設定値も選択肢へ補う。未接続の「選択する」はローカルの次回接続設定だけを更新し、接続中の「変更して再接続」は新しいセッションで3ソケットを接続し直す。画面の会話・入力は保持し、マイクは OFF に戻す。キャンセル後の再表示では確定済み設定から選択値を復元する。取得が遅れて接続や終了の後に応答した場合は、その既定値で現在設定を上書きしない。
- モデル選択の「専用ウィンドウで開く」は外し、VS Code のビュータイトル／コマンドパレットから実行する。確定操作は「選択する」または「変更して再接続」の1つにし、変更がある場合だけ有効にする。
- Code / Live の最終手動選択は対象プロジェクトの `_AIDIY/aidiy_code/aidiy_code_model.json` / `_AIDIY/aidiy_live/aidiy_live_model.json` に分けて保存し、それぞれ VS Code 拡張・単独画面で共用する。保存は画面で確定したときだけ行い、起動引数・接続・新規会話・キャンセルでは上書きしない。モデル未指定なら保存済み選択を復元し、明示モデルは優先する。Provider のみ指定した場合は同じ Provider の保存値を復元し、異なる場合はその Provider の既定値（Code は `auto`）を使う。Code の自動選択（空の Provider / モデル）も復元する。Live は音声も保存するが、保存値の復元だけでは自動接続しない。未保存・破損時は既定設定を使い、保存失敗時は現在設定を変更せずエラーを表示する。JSON は一時ファイルへ書いて原子的に置換する。`AiDiy_key.json` と会話履歴はこの選択記録へ保存しない。
- Code の説明は `frontend_ide/host/README.md`、Live の説明は `frontend_ide/host/aidiy_live/README.md` に分ける。VSIX 作成時はそれぞれの `extension/readme.md` が各拡張だけを説明していることを確認する。
- Code / Live の起動画面は中央の文字を `--terminal`（緑 `#00ff00`）にし、3行のタイプ表示を12秒周期に揃える。各行の文字送りは周期の4〜16%、26〜38%、48〜60%（それぞれ1.44秒）とし、行間は1.2秒待機する。文字とカーソルの開始・終了位置を同時に変更する。
- Code は新規会話で入力欄と保存済み下書きを空にし、`welcome-input-started` を引き継がず起動画面のターミナル演出を最初から再開する。同じ会話の状態通知では演出を再開せず、初回の下書き復元時は入力済みとして演出を停止する。VS Code / 単独画面の共通処理は `frontend_ide/src/components/コード/コードパネル.vue` に置く。
- Live は手動切断・接続断で、会話欄を初期の案内（ターミナル演出を再開始）、入力欄を空へ戻す。確定したモデル・音声の表示とプロジェクト表示は保持する。接続中の「新しい会話」は会話欄と入力をクリアし、現在のモデル・音声・作業フォルダで新規セッションへ接続し直す。マイクとスピーカーの ON/OFF は保持する。未接続時は表示と入力だけをクリアする。未接続の「接続」は黒文字で背景を白〜水色（`--voice`）へ変化させ、接続済みの「切断」は白背景と黒文字で固定する（ホバー時も同じ）。
- Code / Live / Discord パネルは OS の「動きを減らす」設定に従わず、Windows / macOS / Linux で同じ演出にする（`frontend_ide/src/components/共通表示/会話表示.css` に `prefers-reduced-motion` の分岐を置かず、`aidiy_live/src/visualizer.ts` と `frontend_channels/discord/panel/visualizer.js`・`view.js` でも参照しない）。
- 発言の登場演出とターミナル演出は `src/arrival-effect.ts` に置き、Code（`frontend_ide/src/components/コード/コードパネル.vue`）と Live（`frontend_ide/src/components/ライブ/ライブパネル.vue`）で共用する。見た目のクラスは `frontend_ide/src/components/共通表示/会話表示.css`に定義し、変更時は両方を揃える。テストでは画面と同じ vm 文脈で評価する（`checks/code-screen.cjs` の `moduleInContext`、Live の `view.test.cjs` も同じ関数を使う）。
- Live は送信した文字入力の位置を覚え、バックエンドから戻った同じ本文の `input_text` 行へ入力枠を飛ばす（15秒以内・1回だけ）。AI回答（`output_text` / `output_request` / `output` / `recognition_output`）は会話欄に全文の行を非表示（`arrival-waiting`）で置き、画面中央の受信通知でターミナル演出で全文を表示し終えてから3秒止め、その行へ飛ばす。受信通知の本文の文字色は回答の種類に合わせる（コードエージェントはシアン、音声字幕は淡い緑）。枠・背景は Code と同じ黒地・白枠で固定する。次の発言の到着・切断・新しい会話・画面終了では受信通知を閉じ、行をすぐに表示する（`回答演出停止`）。Live は行そのものが発言の枠なので、飛行先・浮かび上がりは行に付ける。
- Code のターミナル演出は、frontend_web の `AIコード.vue`（`演出初期化` / `演出キュー追加` / `演出実行` / `速度設定`）と同じ実装を `src/arrival-effect.ts` の `演出初期化` / `速度設定` に置き、AI回答の受信通知とストリーム受信枠（`#progress`）で共用する。文字列をキューに積み、通常は500ms待ってから10msごとに `floor(文字数 / 50) + 1` 文字、ストリームは30ms待ってから2msごとに `max(8, floor(文字数 / 12) + 2)` 文字ずつ追記する（長いほど速い）。カーソルは表示文字の右に置く半角スペース1文字の `inline-block`（幅8px）で、背景をカーソル色（通常は緑、ストリームはシアン）にして JS で0.3秒ごとに明滅させ、キューを流し切った完了時に外す。見た目は frontend_web の AIコード.vue で実際に表示されるものに揃える。同ファイルの `.terminal-text` / `.terminal-cursor` は `<style scoped>` で `:deep()` が無く、JS で作った要素には当たらない。そのため文字は親の `.agent-content`（Courier New / 11px / 行間1.5）を継承し、カーソルは JS の指定だけで細いブロックになる。ソースの CSS（`display: inline` / 左右2px / 太字）をそのまま移すと、半角1文字＋余白の太いカーソルになるので移さない。Code では `#progress` と `.answer-popup-text` を Courier New / 11px / 行間1.5 にし、CSS アニメーションのカーソルを重ねない。ストリーム受信枠は AIコード.vue と同じく `output_stream` パケットを起点にし、開始の制御コードで演出を作り、受信した1行ごとに `行\n` を積み、終了・中断の制御コードでだけ流し切ってカーソルを外す（`進捗演出開始` / `進捗行受信` / `進捗演出終了`）。状態通知の実行中フラグでは終えない（回答・検証の途中通知で演出が終わり、作り直しで全文が一瞬で出るため）。拡張は次の送信まで進捗を貯めるので、検証などで再び開始されても枠を消さずに続きから流す。状態通知の進捗全文との差分で積まない。差分は複数行が1つの塊になって速度が跳ね上がり、直近100行への切り詰めで続きとも判定できなくなるため。状態通知の進捗全文は、初回表示・会話の切替と、演出していない間の表示合わせにだけ使う（`進捗表示更新`）。
- Code の発言の登場演出（`src/arrival-effect.ts` の `枠飛行` / `到着表示` / `入力枠作成` / `受信通知作成`、`frontend_ide/src/components/共通表示/会話表示.css` の `.input-flight` / `.answer-popup` / `arrival-waiting` / `arrival-pending` / `arrival-reveal`）は、発言を透明（`arrival-pending`）のまま通常どおり配置して場所を確保し、そこへ枠を Web Animations で560msかけて飛ばしてから、白い光とぼかしから0.9秒で表示する。ユーザー発言は送信時の入力欄の位置から入力枠を飛ばす。AI回答は画面中央に受信通知（ヘッダーや受信時刻は付けず本文欄だけ、上から降りる登場のみで走査線や明滅などのフラッシュ的要素は付けない）として出す。受信通知は黒地・白枠で固定し、流し込む本文の文字だけを回答の色にする。高さは画面の30%（最小96px）で、本文は縦スクロールで常に最下部を表示する。そのうえで、上記のターミナル演出で本文を表示し、全文を表示し終えてから3秒止めて飛ばす。通知の表示中は履歴側の発言を `arrival-waiting`（非表示）にし、飛行開始時に `arrival-pending` へ切り替える。演出中に状態通知で再描画されても、`入力演出` / `応答演出` が段階を引き継ぐ。画面が非表示のとき、飛行先の大きさが取れないときは演出せずに表示する（OS の「動きを減らす」設定では省かない）。描画更新が止まっても発言を残さないよう、飛行は1.5秒の安全期限で必ず完了させる。
- Code は処理中（STOP 表示中、状態通知の `実行中`）に `#composer` へ `running` を付け、入力欄を包む `#prompt-frame` の疑似要素（入力欄の上下の1pxの枠線に重ねた帯）で、シアンと白の光を左右の外から反対側の外へ、すれ違ってゆっくり一定の速さで突き抜けさせる（4.2秒周期の `linear`、前後20%ずつ枠の外で止めるので、横切るのは約2.5秒、抜けた後は約1.7秒の間を空ける）。`alternate` の折り返しは枠の外（光の幅35%に対して `background-position` -60% / 160%）で行い、次の回は色の進む向きが入れ替わって反射して戻るように見せる。枠の中で折り返す（中で揺れる）動きにはしない。光は1pxの細い線のままにし、`drop-shadow` などのにじみや帯を太くする指定、入力欄の枠の色替えは付けない。ストリーム枠（`#progress-section` / IDE の `.code-component .progress`）が開いて `running` の間は、同じ光を入力欄ではなくストリーム枠の上下の枠線（疑似要素を枠線の幅だけ外へ出して重ねる）に流す。入力欄側は、Code 拡張は `body:has(#progress-section.running:not([hidden]))` で止め、IDE は `コードパネル.vue` の `waitingForStream` で `進捗表示.vue` の `visible` を見て止める（`scripts/check-chat-effects.mjs` で確認）。
- Code / Live の AIコア接続エラー（`#error`）は、フッターの最下部ではなく入力欄（Code の `#composer`、Live の `#text-form`）の直前に置き、入力欄の上に表示する。
- Code のタイトル行はアイコンを置かず、`frontend_ide/src/components/共通表示/会話表示.css` の3列グリッドで接続状態を左端、名前を中央、ウィンドウ操作を右端に置く（`.title-right` は `display: contents`）。VS Code 内では非表示だが、単独起動（`aidiy_code/theme.css` は高さと文字サイズだけ上書き）と同じ配置を保つ。Live のタイトル行も同じ並びで、単独起動でだけ表示する。
- Code / Live の手入力メッセージは白文字（`#fff`）で表示し、クリックで本文を入力欄へコピーしてフォーカスとカーソルを末尾へ移す。Live の `recognition_input` は灰色（`#e5e7eb`）、`recognition_output` は淡い緑（`#9ae6b4`）にし、同じクリック操作でコピーする。演出中・表示文字数の制限中でも元の全文をコピーし、この操作だけで送信は行わない。
- Live の文字表示には通常回答と音声認識に加え、コードエージェントの `output_request` を含める。旧バックエンドの `output_text: !` は送信エラーとして案内する。frontend_ide の `checks/` で VS Code / 単独画面の両方を検証する。
- 送信ボタンは Code / Live とも未接続・入力不可時は灰色と白い紙ヒコーキ（`ws-disabled`）。接続済みの空欄・空白入力では白背景（`rgba(255, 255, 255, .95)`）、青紫の枠（`#667eea`）、黒い紙ヒコーキ。送信可能時は `frontend_web/src/components/AiDiy/compornents/AIコード.vue` と同じ青紫（`#667eea`）、ホバー時は `#5a6fd8` にする。紙ヒコーキ画像は `brightness(0)` で黒、`brightness(0) invert(1)` で白にする。空欄・空白だけでは無効にし、VS Code テーマで色を上書きしない。
- 入力欄の Enter は通常の改行。Tab で送信ボタンへ移動し、そこで Enter を押すと送信する。日本語 IME の変換確定では送信しない。
- Code / Live の入力欄は共通の `field-sizing: content` で改行・折り返しに合わせて上へ伸縮する。最小高さは 76px、上限は 220px と画面高さの 35% の小さい方にし、上限を超えた内容は入力欄内でスクロールする。下書き復元・会話からのコピー・送信後のクリアにも自動で反映する。
- Code / Live の会話末尾への追従は Vue 画面（`frontend_ide/src/components/コード/コードパネル.vue` / `frontend_ide/src/components/ライブ/ライブパネル.vue`）で同じ規則にする。メッセージ追加・入力・送信受理・ストリーム枠の更新／開閉で即時と次の描画フレームに末尾へ移動し、`ResizeObserver` で会話領域の伸縮にも追従する。Code は会話履歴と進捗の両方を揃え、一覧から会話へ戻る際も末尾へ移す。確認は frontend_ide の `checks/` で、入力直後・表示枠の開閉・描画後の高さ変更を検証する。
- Code の接続表示は Live と同じタイトル左側の配置・文字色・10px文字・5pxの丸印に揃える。未接続は灰色、接続済みは緑、オンライン実行中は水色とし、文字は `未接続` / `接続中` / `接続済み` とする。CodeConnectionの接続開始・成功・失敗通知を単独版と拡張の `接続中` / `接続済み` に反映し、10秒の再試行待ちは未接続とする。シアンバーは実行状態ではなく接続状態へ連動させ、AIコアの入力・コード出力ソケットの初期化とモデル設定完了後に表示し、切断時に消す。オフライン中もタイトル左側は `未接続` を表示し、専用のオフライン表示・モードボタンは設けない。入力欄下は「上段：Enter の操作説明」「下段：モデル選択とモデル名」の2段にし、右端の送信／停止ボタンは2段分の高さにする。両モードで共通の HTML / CSS を使う。
- 履歴削除の確認は `frontend_ide/src/components/コード/コードパネル.vue` のパネル内ダイアログで共通処理し、確認後に `deleteHistory` を送る。拡張ホストや単独画面のブリッジで別の確認ダイアログを出さない。
- 「新規」「一覧」、モデル選択、履歴削除、送信、停止は Webview 内の共通 UI を主操作にする。VS Code 固有のコマンドは外部からの呼び出しやエディター連携用に残す。
- 単独画面の上部はタイトルバー、実行状態バー、会話操作行の順に置く。VS Code 拡張では接続状態の文字を含むタイトル行を省略し、シアンバーを表示する。「今の会話／会話一覧」、フォルダ名、「新規」「一覧」は会話操作行にまとめる。単独ウィンドウのドラッグ領域はタイトルバーだけに指定し、会話操作行を含めない。
- Code / Live の上部シアンバーは Web の `frontend_web/src/components/_TopBar.vue` と同じ `abs(sin(2πt / 9))` の明滅に揃える。`frontend_ide/src/components/共通表示/シアンバー.css` の `cyan-bar-breathe`（会話表示.cssとDiagから共有） は、4.5秒の周期を2.5%刻みで標本化したRGB値を `linear` で補間する。`ease-in-out` に戻すとカーブが変わるため、`linear` を維持する。
- Code の正式回答の緑はスタンドアロンと共通の `#00ff00` を `frontend_ide/src/components/共通表示/会話表示.css` で定義する。VS Code の明暗・高コントラストテーマでも、この色を上書きしない。
- Code の実行状況枠は CSS の `--stream`（シアン `#00ffff`）を基調にした枠線と薄い背景を使い、文字と点滅カーソルもシアンにする。Web / Avatar の `AIコード.vue` の `.stream-output .line-content` も同じ配色に揃える。Live の会話は `メッセージ識別` を行のクラスに残し、AIチャットパネルと同じく通常出力（`output_text`）は緑 `#00ff00`、コードエージェントの回答（`output_request`）はシアン `#00ffff`、音声出力認識は淡い緑で分ける。本文・文字送りカーソル・枠・背景はその種別の色を基調にし、文字送り完了後もクラスを保持する。
- 拡張機能一覧のアイコンは `package.json` 直下の `icon`、サイドバーのアイコンは `contributes.viewsContainers` の `icon` で指定する。両方とも `media/AiDiy.png`（`frontend_web/public/icons/AiDiy.png` と同じ画像）を使い、変更後は VSIX を再生成・再配置する。
- Live のマイク・スピーカーは `frontend_web/public/icons/microphone.png` / `speaker.png` を `aidiy_live/media/` にコピーし、CSS のマスクで赤／水色に表示する。画像追加時は Live の `.vscodeignore` と `src/server.ts` のリソース許可一覧へ含め、配布ディレクトリだけで読み込めることを確認する。
- Provider / モデル選択は VS Code 上部の Quick Pick ではなく、`frontend_ide/src/components/コード/コードパネル.vue` のチャットパネル内ダイアログで行う。候補は `chooseModel` / `modelCatalog` / `modelCatalogError`、確定値は `setModel` で Webview と実行層の間を受け渡す。
- Discord の直接CLI用 Provider と API モデルは `scripts/model-catalog.py` から Hermes の picker を再利用する。外部 CLI のモデルは `_config/AiDiy_code_*.json` を読み、設定がないか `auto` のみなら対応する `scripts/cli_bat` の `MODEL` 値を読む。`claude-code` は `AiDiy_code_claude_cli.json` に対応し、`claude_sdk` は Hermes の外部 CLI Provider には含まれない。
- Code は選択画面を開くたび `/core/AIコア/モデル情報/取得` の `available_models.code_models` を取得する。`aidiy_hermes` は `openai_oauth/gpt-6.1-sol` のような組み合わせID、`copilot_cli` はCLIのモデルIDをそのまま渡す。
- 外部 CLI Provider のモデルが `auto` の場合は `--model auto` を渡さず、各 CLI 自身の既定モデル選択へ任せる。明示モデルを選んだ場合は Hermes の外部 CLI 実行まで `--model <ID>` を渡す。
- `antigravity-cli` は Hermes の外部 CLI Provider 一覧から取得する。`xai-oauth` は API Provider のカタログ入口に含め、`grok-4.6` を Hermes の curated model 一覧から取得する。
- xAI OAuth の初回認証は静的なワンショット実行中ではなく、拡張の「対話 CLI」から `/model` で `xai-oauth` を選ぶか、`hermes auth add xai-oauth` を実行する。
- Code の履歴には `コアセッションID` を保存する。旧 `セッションID` はHermes用なのでAIコアへ渡さず、表示履歴だけ保持する。通信切断・初回失敗では約10秒後に再試行し、手動切断・画面破棄・サーバー終了ではタイマーと接続待ちを破棄する。

## セットアップと配置

VS Code の Code Webview では `<body class="vscode-host">` を拡張側で付け、`#title-bar` を非表示にする。Live は `frontend_ide/src/components/ライブ/ライブパネル.vue` が同じクラスを付け、`frontend_ide/src/components/共通表示/会話表示.css` の `.vscode-host > header` を非表示にする。両方とも接続状態の文字を含むタイトル行を省略し、シアンバーとプロジェクト・会話操作行は表示する。単独版にはこのクラスを付けず、ウィンドウのタイトル行と操作を維持する。

プロジェクト全体ではルートから実行し、`command_hermes` の次に `frontend_ide/host` を選ぶ。

```powershell
python _setup.py
```

拡張だけを処理する場合:

```powershell
python frontend_ide/host/_setup.py
```

`frontend_ide/host/_setup.py` は `npm install`、`npm update`、Electron の準備、`npm run package` による Code / Live の VSIX 生成、`code --install-extension --force` を順に実行し、最後に両拡張の ID とバージョンを再取得して配置を確認する。VS Code CLI が見つからない場合は単独画面だけをコンパイルする。最後に `~/.local/bin/aidiy_code.cmd`（Windows）または `~/.local/bin/aidiy_code`（macOS / Linux）を作り、`aidiy_code/launch.mjs` を絶対パスで呼び出す。`code` が PATH に無い場合は、稼働中の Codespaces / IDE Container / Remote SSH の Remote CLI と VS Code の標準配置先も探索する。単にファイルが存在するだけでなく、`--version` に成功した CLI だけを使う。

同時に `aidiy_live` のランチャーも作り、`aidiy_live/launch.mjs` を呼び出す。ランチャーだけの更新は `python frontend_ide/host/_setup.py --launchers-only` を使う。この作業コピーから配置した旧名 `aidiy_vscode` は新しいランチャーの配置後に解除する。生成済み VSIX だけを配置する場合は `python frontend_ide/host/_setup.py --extensions-only` を使う。通常セットアップと `--extensions-only` は両 VSIX の存在を確認してから、拡張名が `aidiy-` で始まる既存拡張（`publisher.aidiy-*`）をすべて除去し、除去を確認した後に Code / Live を配置する。旧 `aidiy-vscode` も同じ判定で対象になる。表示名は `AiDiy Code` / `AiDiy Live`、内部モジュール名・起動コマンドは `aidiy_code` / `aidiy_live` とする。拡張パッケージ名は `aidiy-code` / `aidiy-live`、拡張 ID は `aidiy.aidiy-code` / `aidiy.aidiy-live` とする。

片方だけを無効にする場合は VS Code の拡張一覧で対象の歯車から「無効にする」または「無効にする（ワークスペース）」を選択する。必要に応じてウィンドウを再読み込みする。

Electron は VSIX 生成・単独画面コンパイルより前に `scripts/_setup_electron.py` の共通処理で準備する。配置済みの実行ファイル・`version`・`path.txt` を照合し、未配置なら Avatar の同じバージョンのバイナリ、`.aidiy_cache/electron/` の共有 ZIP の順に再利用する。まだ取得されていない場合だけ Python で GitHub から取得する。npm の install / update / rebuild では Electron の自動取得をスキップし、同じ取得を繰り返さない。Electron を準備できない場合はセットアップを失敗扱いにする。詳細は [`共通,開発環境運用手順.md`](./共通,開発環境運用手順.md) の「Electron の共通セットアップ」を参照する。

単独画面は作業フォルダで `aidiy_code`、または `aidiy_code "C:\work\project"` のように明示して起動する。前者は起動時のカレントフォルダを使用する。`~/.local/bin` は Hermes のランチャーと共通なので PATH に含める。Windows の `.cmd` と macOS / Linux のシェルランチャーは、どちらも `aidiy_code/launch.mjs` を直接呼ぶ。`launch-extension-dev.ps1` は Windows で Code / Live の両方を `--extensionDevelopmentPath` に指定した VS Code 拡張の開発ホストを起動する。

配置は拡張機能ファイルを更新するだけで、VS Code 本体や AiDiy の常駐サービスを停止しない。すでに VS Code が起動している場合、変更の反映にはウィンドウ再読み込みが必要になる。

単独起動は Electron のフレームレスウィンドウを使う。ヘッダーのドラッグ領域から会話操作・ウィンドウ操作ボタンを除外し、最小化・最大化／復元・閉じるを preload の限定 API で扱う。Node integration は無効、context isolation と sandbox は有効にする。専用ウィンドウ終了時はサーバーと CLI を終了する。`aidiy_code --browser` では従来のブラウザモードを使い、接続が無くなって60秒後に終了する。Electron は開発・単独起動用依存で、VSIX に含めない。

`aidiy_code/launch.mjs` は Electron の取得処理を呼ばず、準備済みの実行ファイルを使う。未配置またはバージョン不一致の場合は `python frontend_ide/host/_setup.py` の再実行を案内する。`npm ci` だけで Electron バイナリが取得されるとは限らないため、専用ウィンドウを使う環境ではセットアップを実行する。

専用ウィンドウの現行起動は `frontend_ide/launch.mjs` に集約しています。`aidiy_code/launch.mjs` / `aidiy_live/launch.mjs` は互換入口です。`desktop.cjs` からIPCの `windowShown: true` または `existingWindow: true` を受け取るまで起動完了にせず、エラー・終了・20秒の表示待ち期限を確認します。Electronの起動は `デスクトップ/desktop-process.mjs` の `windowsHide: false` とIPCを使います。

## 起動完了通知を確認するとき

- 通常の単独起動はIPCで通知します。`--ready-file <パス>` を明示した場合だけ、共通ランチャーが `{ url, publicUrl, pid, kind, project }` を指定先へ保存します。現行の通知JSONに `windowShown` を必須としないでください。
- 旧 `out/aidiy_code/<起動ID>.json` は旧起動経路の残存通知として扱い、現行ランチャーが毎回生成するとは判断しません。会話履歴・モデル設定・テスト用bundleと混同しないでください。
- 通知のJSON構文・UTF-8・BOMと、現行の生成側・読込側を照合します。URLのポート・トークン長を旧実装から固定せず、`frontend_ide/server.mjs` と `launch.mjs` を確認します。実値をナレッジへ転記しません。
- 通知は起動時点の記録です。現在の稼働確認ではPID・実行ファイル・引数・待受ポートを別に照合し、終了済みというだけでJSONを書き換えません。バックアップとの一致も動作の正しさとは別です。
- 回帰の入口は `frontend_ide/checks/runtime.test.mjs` と `desktop-process.test.mjs`、実窓の確認は `scripts/check-launcher.mjs code` / `live` です。模擬試験・実画面・実AI接続を区別し、文書確認だけの依頼で再生成・再起動を行いません。

## Code の生成物だけが差分に出た場合

### 関連ファイルと確認箇所

以下のパスは `frontend_ide/host/` からの相対パス。`scripts/test.mjs` はテスト実行前に複数のbundleを esbuild で再生成する。以下はこの照合手順の対象6ファイルであり、生成物全体の一覧ではない。更新日時や変更通知だけで仕様変更と判断せず、内容と生成元を照合する。bundle には依存モジュールも含まれるため、エントリの変更だけを見ない。

| 生成物 | 生成元のエントリ | 確認する関連箇所 |
|--------|------------------|--------------------|
| `out/code-connection.cjs` | `src/code-connection.ts` | `CodeConnection` の `connect` / `open` / `send` / `clear`、両ソケットの初期化、再接続、要求全体の実行状態 |
| `out/forwarded-origin.cjs` | `src/forwarded-origin.ts` | `転送オリジン`、`接続元許可` の Host / Origin 判定と `初回待機時間` |
| `out/offline.cjs` | `aidiy_code/src/offline.ts` | `Hermes既定モデル`、`オフラインモデル候補`、`オフライン実行`、モデルと再開IDの受け渡し |
| `out/protocol.cjs` | `src/protocol.ts` | `コード要求実行`、ストリームの開始・終了・中断、再開セッション不在時の再試行 |
| `out/runner.cjs` | `src/runner.ts` | `起動解決`、`会話引数`、`CLI実行`、UTF-8入出力、無受信タイムアウト、子孫プロセスの停止 |
| `out/aidiy_code/server.cjs` | `aidiy_code/src/server.ts` | `単独起動` の `receive` / `execute` / `reconnect` / `close`、HTTP/SSE、オンラインとHermesの状態分離 |

### 上書き前の照合

1. バックアップとの内容差分を先に取得する。MCP の `backup_diff_stats` の追加・削除行数と `before_timestamp` を確認し、必要なら基準時刻を指定する。詳細は [`command_hermes,共通,MCPバックアップ検証手順.md`](./command_hermes,共通,MCPバックアップ検証手順.md) を参照する。差分ゼロは保存版との同一性を示し、動作の正しさは別に確認する。
2. 次のコマンドを依存導入済みの `frontend_ide/host` で実行する。`scripts/test.mjs` と同じ生成条件に `write: false` を加え、メモリ上の出力と現行ファイルをバイト単位で照合する。比較前に `npm test` を使うと対象を上書きしてしまう。

```powershell
# プロジェクトルートから移動する。
Set-Location frontend_ide/host
@'
const { build } = require('esbuild');
const fs = require('node:fs');
const entries = [
  ['src/code-connection.ts', 'out/code-connection.cjs'],
  ['src/forwarded-origin.ts', 'out/forwarded-origin.cjs'],
  ['aidiy_code/src/offline.ts', 'out/offline.cjs'],
  ['src/protocol.ts', 'out/protocol.cjs'],
  ['src/runner.ts', 'out/runner.cjs'],
  ['aidiy_code/src/server.ts', 'out/aidiy_code/server.cjs'],
];
(async () => {
  for (const [entry, out] of entries) {
    const result = await build({ entryPoints: [entry], outfile: out, bundle: true,
      platform: 'node', target: 'node22', format: 'cjs', write: false });
    const same = fs.readFileSync(out).equals(Buffer.from(result.outputFiles[0].contents));
    console.log(out + ': ' + (same ? 'MATCH' : 'MISMATCH'));
    if (!same) process.exitCode = 1;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
'@ | node
```

`MISMATCH` は不整合を調べる入口であり、直ちに不具合と断定しない。生成条件・esbuild のバージョン・依存モジュール・生成物の欠落を確認する。生成条件の同期元は `scripts/test.mjs`。生成物を直接修正すると再生成で消えるため、本体修正が必要な依頼では生成元を修正してから該当生成物を更新する。

### 現行生成物を使う対象テスト

同じ `frontend_ide/host` ディレクトリで次を実行する。`node --test` は `scripts/test.mjs` の事前再生成を通さず、対象6ファイルを読み込む既存テストを実行できる。

```powershell
npm.cmd run check
node --test checks/runner.test.cjs checks/code-connection.test.cjs checks/code-extension.test.cjs checks/aidiy_code.test.cjs checks/browser-mode.test.cjs
```

- 型チェックは Code / Live の両方を確認する。対象テストではCLIの入出力・停止・タイムアウト、両ソケットの初期化と再接続、未接続時のHermes実行、モデル保存、HTTP/SSE中継、接続元の許可を確認する。
- テストは模擬CLI・模擬AIコアとローカルHTTP/SSEを使う。実AI、実VS Code画面、公開済み転送先への実接続を確認したことにはしない。
- `checks/browser-mode.test.cjs` の Linux 用ブラウザヘルパーのテストは Windows ではスキップされる。成功・失敗・スキップを区別し、テスト件数は固定値として判断基準にしない。
- バックアップとの内容差分、生成元との一致、対象テストの結果を合わせて追加修正の要否を判断する。一致して対象テストも成功した場合、変更通知だけを理由に追加修正しない。
- 知見整理だけの依頼では、上記は次回の手順として記録する。本体の再生成、再テスト、VSIX配置、バックアップ名変更、再起動は実施しない。システム再起動は利用者の判断に委ねる。

## Code / Live のファイル添付と返却画像

- HTTP本文・WebSocketメッセージの転送上限は、20 MiB未満だった固定値を20 × 1024 × 1024 bytesへそろえる。Code / LiveのHTTP中継、Live拡張ホストのAPIとWS双方向、IDEのExplorer・検索・解析・TaskTeam・共有下書き、Console・Browser CDP、Discord・SlackのパネルとDiscord Liveが対象。UTF-8の文字数ではなくbytesで判定する。既存の20 MiB以上・無制限の中継や利用者の明示設定は引き下げない。
- 転送上限と業務上限は別。下記の添付4 MiB・10件、入力文字数、検索・解析の指示文字数、プレビュー省略、Consoleの入力chunk・未確認出力、Liveの送信待ち量、ファイル専用packet検証、TaskダイアログのIPC上限は維持する。転送できても業務検証で拒否される要求がある。
- 転送境界は `frontend_ide/checks/transport-limits.test.mjs`、Code / Liveホスト再生成後の `host/aidiy_live/checks/host.test.cjs`、Discord / Slackそれぞれの `checks/transport-limits.test.ts` で確認する。実socketや実APIは不要で、20 MiBちょうど・1byte超過・マルチバイト・分割受信をpure/VM/mockで検証する。
- 共通Vueの `src/components/添付ファイル/` と `host/src/file-attachments.ts` を使う。単独起動・IDE・VS Code拡張とも、Core接続中の現在の会話へファイルをドロップする。Codeは「＋ ファイル」でも選べる。オフラインHermesへファイルを自動転送しない。
- 1件は空でない4 MiB以下、1回は10件まで。全件の名前・サイズを先に検証し、読込後もsession・会話・プロジェクトと接続世代を照合する。切断・会話変更・送信失敗時は残りを中止し、自動再送しない。本文の下書きは保持する。
- Avatarと同じ `input_file` packetを既存input WebSocketへ渡す。Codeはchannel 1、Liveはchannel 0。既存のHost / Origin / ランダムURL / ワークスペース信頼境界を維持し、ファイル取得用の新規REST中継は追加しない。`/core/files` のJWT認証を迂回しない。
- ローカル送信の成功とCore保存完了は別。会話欄への追加はCoreの `input_file` echo（ブーメラン）のみを使い、session・channel・保存パスをキーに重複echoを除く。失敗時はエラーと会話欄を確認してから必要なファイルだけ選び直す。Coreの `FILE_UPLOAD_FAILED` を受けた場合、成功表示にしない。
- Coreの入力保存は `AIコア/AI入力ファイル.py` が時刻＋UUID＋安全化した元名を排他的に作成する。同名・同秒・別session並行でも既存ファイルを上書きしない。返却packetの `ファイル名` は従来どおり `temp/input/...`、表示用の `元ファイル名` は元名を維持する。履歴と下流の添付登録は実際の保存パスを使い、既存ファイルは移動・削除しない。
- `input_file` とAI生成物の `output_file` は共通添付UIで表示する。Coreが返すPNGサムネイルだけを検証してインライン表示し、クリックでそのプレビューを拡大する。Core側も `AIコア/AIファイルプレビュー.py` で変換前に画素数を制限し、縦横320以内・拡大なしの静止PNGへ縮小する。非画像は名前とCore上のパスを文字で表示する。元ファイルのダウンロード・フル解像度取得・外部URL画像・HTML/SVG表示は行わない。CSPの `data:` 許可は `img-src` だけに限定する。
- Code生成画像は実行projectの `output` / `temp/output` / `images` / `assets` で要求前後の差分を確認し、自己channelへ返す。Liveからの `input_request` は同sessionのchannel 0にも返す。外部へのsymlink・過大走査を除外し、既存の未変更画像は通知しない。同じ保存パスの更新はSHA-256版で区別し、版のないCore履歴replayは同じPNGの重複を除く。
- Codeではサムネイルを会話履歴のサイズ予算に含める。履歴読込時も添付を再検証する。Coreのファイル登録は従来どおり同channelの直近1分以内が対象なので、受信表示を確認した後に本文の依頼を送る。Live画像は既存Coreの画像送信経路へ渡るが、任意のPDF等の内容理解をLiveへ追加するものではない。

検証は `frontend_ide/checks/chat-attachments.test.mjs`、`code-file-attachments.test.mjs`、`live-file-attachments.test.mjs`、hostのCode / Live試験、`backend_server/checks/test_input_file_storage.py` を使う。実Vueの合成イベント、模擬Coreとloopback、実input_file分岐のPNG・非画像fixtureで、往復・生成画像・サイズ制限・重複・古い接続・保存失敗・並行保存を確かめる。実AI・ユーザーの入力データを使う必要はない。実OSのD&Dや画像合成を目視した場合は、これらの非GUI試験と区別して記録する。

## VSIX 作成依存のセキュリティ更新

- `host/package.json` の `overrides` は `@vscode/vsce` 配下の `minimatch` だけを `11.0.3` に固定する。vsce 4.1.0 の要求範囲は `^10.2.6` だが、[GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) の修正版は 11.0.1 以降のため、通常の範囲内更新では解消しない。
- メジャー更新を全依存へ強制しない。vsce が使用する CommonJS の `minimatch(path, pattern, { dot: true })` と Node 要件を確認し、Code / Live の `vsce ls --no-dependencies` の対象集合を更新前後で比較する。並び順ではなくファイル集合を比較する。
- `checks/package.test.cjs` は実際の vsce と両拡張の `.vscodeignore` を使い、一時フォルダで配布対象・除外対象・日本語名・隠しファイルを検証する。`npm test` に含まれる。依存変更後は `npm audit` と `npm run package` も確認する（拡張の配置・公開は別操作）。
- vsce が修正版 minimatch を正式に要求するようになったら、この override を外して lock を更新し、同じ検証を行う。監査警告を隠すための `--omit=dev` や `npm audit fix --force` で代替しない。

## 変更後の検証

Code の停止・接続切替は、通常回答・検証途中・知見整理中・停止後のAI再開待ちを分けて確認する。`src/code-connection.ts` は要求に `実行状態通知: true` を付け、`backend_server/AIコア/AIコード.py` が要求全体の開始に `実行中: true`、後始末完了に `output_end` / `実行中: false` を通知する。途中の `output_text`、`cancel_run`、CANだけでは操作を再開しない。通知に未対応の旧AIコアは従来動作へ戻るため、この変更の反映にはAIコアも再起動する。

停止の連打、送信直後のOFF、モデル候補確認中の新規・OFF、同じON通知の重複、Hermes実行中の自動再接続を確認する。画面中継のSSE切断はAIコアの切断と区別し、モデル・実行中状態を維持して操作を止める。検証入口は `checks/aidiy_code.test.cjs`、`checks/code-extension.test.cjs`、`checks/code-connection.test.cjs`（AIコア側の実行状態には専用の自動テストがない）。模擬AIと実HTTP/SSEで確認し、実機のWindows画面や実AIの確認と区別する。

`aidiy_code` 単独起動版とVS Code拡張は未接続中の送信を自動的にHermesへ渡す。拡張の `src/extension.ts` も `aidiy_code/src/offline.ts` のDiag候補読込・既定値探索・実行処理を共用する。表示用のprovider/modelだけを接続状態で切り替え、会話内のオンラインモデルへオフライン選択を代入しない。通常起動は自動接続ONを既定とし、10秒ごとの再接続を継続する。プロジェクトバー右側の「自動接続」「新規」「一覧」のスイッチでOFFにすると接続・再試行を止め、新規・履歴復帰・ready通知でも再開しない。ONへ戻すと接続を再開し、OFFの選択は次回起動へ保存しない。実行中・モデル変更中の切り替えはUIとホスト側の両方で拒否する。バーはONの未接続で黒、接続済みで従来のシアン明滅、OFFで赤の明滅にする。復帰時も実行中のHermesジョブを維持する。AIコアとHermesのセッションID・保存モデルは分離し、次の送信からAIコアへ戻す。`executionMode` または `--offline` で明示したオフラインは自動接続OFFにし、再接続しない。この場合にスイッチをONへ戻すと新しいオンライン会話へ切り替え、HermesセッションIDをAIコアへ渡さない。明示オフラインの履歴復帰でもOFFへ切り替える。画面に専用のオフライン表示・モードボタンは設けない。`aidiy_code/src/offline.ts` は既存の `runner.ts` / `protocol.ts` を使ってHermesを直接実行し、AIコア・バックアップ・検証ループは呼ばない。コードAIは `aidiy_hermes` に限定し、モデルIDはオンラインのHermesと同じ形式を使う。オンライン用の `aidiy_code_model.json` はそのまま保持し、オフライン用を `aidiy_code_model_offline.json` に別保存する。両ファイルを拡張・単独版で共用し、未接続のモデル変更はオフライン用ファイルだけへ保存する。Hermesの再開IDは `HermesセッションID` に保持し、`コアセッションID` と混在させない。オフラインのコードAI欄は `aidiy_hermes` 固定・変更不可とし、モデル候補は `same` と `_AIDIY/aidiy_diag/code_models_info.json` の `aidiy_hermes.models`（`same` / `auto` を除く）から取得する。既定値・保存値から候補を追加しない。候補外の保存値は共通設定の既定値へ戻し、既定値も候補外なら `same` を使う。Diag一覧がなければ `same` だけを表示し、不正な一覧はエラーにする。モデルAPIへの接続・モデルIDの手入力は不要。単独版の初期モデルは明示した起動引数、モード別の保存値、`_config/AiDiy_key.json` の `CODE_AIDIY_HERMES_MODEL` の順に優先し、共通設定が未配置・未指定の場合だけ `auto` を使う。既定値は配置先、作業フォルダの順で親へ探索し、AIコア接続前から表示する。候補外の起動引数・モデル変更要求は拒否する。

モード変更は実行中に拒否する。切り替え後は新規会話とし、一覧の各会話に実行モードを保持してAIコアのセッションIDをHermesへ渡さない。CLIジョブ終了前のモード変更・新規・モデル変更も拒否し、停止／サーバー終了では子プロセスを停止する。明示オフラインへオンライン接続の遅延通知を反映しない。自動オフラインでは再接続通知で実行中フラグを解除せず、停止を進行中のHermesジョブへ渡す。共通Webviewは `オフライン対応` が真の単独版・拡張で未接続時のHermes送信を許可し、オフライン中は検証0固定、オンライン復帰時は直前の検証回数へ戻す。

Code の検証ループ選択（0〜3回、オンライン・オフラインとも初期値0回。オフラインの間は0回に固定し、オンラインへ戻ると直前のオンラインの回数を `オンライン検証回数` から戻す。オンラインで選び直した回数は画面から `setSelfCheckLoop` で送り、拡張と単独起動版が `src/model-preferences.ts` の `検証回数保存` で `_AIDIY/aidiy_code/aidiy_code_options.json`（`コード設定保存先`、モデルの保存先から決める）へ保存する。次回は状態通知の `検証回数` を最初の1回だけ画面へ復元する。モデルは従来どおりオンライン `aidiy_code_model.json`・オフライン `aidiy_code_model_offline.json` に最後の手動選択を保存する）は `frontend_ide/src/components/コード/コードパネル.vue` で扱い、送信パケットに `self_check_loop` を含める。単独版の `aidiy_code/src/server.ts` と拡張の `src/extension.ts` の両方でAIコアまで渡す。0回はバックアップ・検証を省略する。UI・HTTP中継・拡張中継の確認は `checks/aidiy_code.test.cjs`、`checks/code-extension.test.cjs` を使う。単独版は既存のbundleを使うため、変更後に `npm run compile` で生成物を更新する。

```powershell
Set-Location frontend_ide/host
npm ci
npm run check
npm test
npm run live:test
npm run package
python -m unittest discover -s checks -p "test_*.py"
```

`npm run check` は Code / Live の型チェック、`npm test` は Code 側の Node.js テスト（`checks/*.test.cjs`。専用ウィンドウの起動は Live も含む）、`npm run live:test` は Live の Node.js テスト（`aidiy_live/checks/`）を実行する。Python テストはセットアップ・Electron 準備・拡張解除・クリーンアップ・モデル候補をモックで検証する。いずれも AI API や実バックエンドを呼ばない。Code のAIコア中継は模擬WebSocket/APIと実HTTP/SSEを組み合わせて検証する。

確認内容:

- TypeScript の型エラーがない。
- 日本語長文を stdin で渡せる。
- stdout の正式回答、stderr の進捗、Hermes セッション ID を分離できる。
- `copilot-cli`、`codex-cli`、`claude-code` が `-Q --oneshot-stdin` でも Hermes の API Provider 解決へ入らず、各 CLI を直接起動する。
- 非ゼロ終了、起動エラー、停止、タイムアウトを呼び出し元へ返せる。
- Windows の AiDiy `.cmd` をシェルなしで解決できる。
- packet が開始、進捗、終了または中断、正式回答の順になる。
- Code の両init前・切断中のHermes実行と検証0固定、オンライン／オフライン別のモデル保存・再起動後の復元、Hermes実行中の再接続と完了後のオンライン復帰、10秒間隔の再接続、自動接続OFFによる予約済み再試行の中止と新規・履歴復帰からの接続抑止、ONへの復帰と起動時ON、遅延イベント無視、モデルAPIのNG、破棄を確認する。接続済みで送信・停止・履歴復帰・CLI別モデル候補が動く。
- VS Code 側で旧 `workspaceState` の単一会話・履歴を、作業フォルダの `_AIDIY/aidiy_code/histories/` へ移行でき、作業フォルダ（プロジェクト）ごとに履歴が分かれる。単独起動版を再起動しても同じプロジェクトの履歴が残る（`checks/conversation-store.test.cjs`、`checks/aidiy_code.test.cjs` の再起動確認）。最終選択モデルが再起動後と新規会話へ引き継がれる。
- `dist/aidiy-code-<version>.vsix` と `dist/aidiy-live-<version>.vsix` が生成され、それぞれのファイルだけを含む。
- Live のセッション・音声パケット・WebSocket 中継・モデル API・切断・Origin 拒否を模擬バックエンドで確認できる。VS Code / 単独画面の両方で会話表示と末尾追従が動き、単独画面では起動時のモデル指定で1回だけ自動接続する。拡張ではタブを切り替えても接続を保持し、非表示中はマイクを止める。

Windows の実 VS Code で拡張ホストまで確認するときは、依存導入と compile 後に次を使う。

```powershell
./scripts/test-extension-host.ps1
./scripts/test-extension-host.ps1 -Scenario Code
./scripts/test-extension-host.ps1 -Scenario Live
```

外周枠・入力領域の確認は `node frontend_ide/host/scripts/check-webview-layout.mjs` をルートから実行します。専用プロファイルの実VS CodeでCode／Liveを順に開き、Webview内の外周色・境界幅・外寸・入力／送信領域を実測し、`temp/vscode-layout/` に画面と寸法を出力します。試験後はVS Codeと専用プロファイルを終了・削除します。AIへの送信は行いません。既定ではCodex同梱のplaywright-coreを利用し、別配置の場合は `AIDIY_TEST_PLAYWRIGHT_MODULE` に `playwright-core/index.mjs` の絶対パスを指定します。

VS CodeはWebview本文に既定の左右paddingを入れます。`src/vscode-html.ts` で `body.vscode-host` に `padding:0` を指定し、共有Vue画面の外周をWebview端へ揃えます。端数DPIでの境界幅はChromiumの描画ピクセルへの切り下げを考慮し、内側へ二重枠を追加しません。変更時はCode／Live両方をcompileし、VSIXを再生成・配置します。

通常の VS Code プロファイルへ配置する確認は `_setup.py` を使う。試用ホストの `out/manual-profile` と混同しない。

Code / Live はどちらも `package.json` の `extensionKind` を `["workspace"]` とし、配置・解除の対象環境を揃える。Remote SSH / WSL / Codespaces では接続先の拡張ホストで動かす。旧版の Live の `["ui", "workspace"]` は接続元を優先するため、Windows 側に配置された Live を Linux の Remote CLI で解除できない。既存の接続元 Live は接続元の拡張機能一覧、または `code --uninstall-extension aidiy.aidiy-live` で一度解除する。`npm run package` で VSIX を再生成し、`python frontend_ide/host/_setup.py --extensions-only` で接続先に配置して、Code / Live の両 ID が同じ拡張一覧にあることを確認する。Live の WinMM マイクは Windows の拡張ホスト用であり、Linux の拡張ホストでは単独ブラウザ版を使用する。Linux の cleanup は接続先で両 ID の解除と解除後の一覧を確認し、Live が残れば失敗にする。Remote CLI では接続元の旧 Live を確認できないことも表示する。

Code / Live の単独起動では、共通 `launch.mjs` がElectronへ `desktop.cjs --app <kind>` と `AIDIY_DEVELOPMENT_URL` / `AIDIY_DEVELOPMENT_KIND` / `AIDIY_DEVELOPMENT_PROJECT` 等を渡す。表示後の `windowShown: true` はIPCで通知する。旧 `AIDIY_CODE_*` / `AIDIY_LIVE_*` の起動通知経路を現行の共通ランチャーへ追加しない。

単独起動にはセットアップ済みの `aidiy_code` / `aidiy_live` コマンドを使います。Electron が未配置なら AiDiy の配置先で `python frontend_ide/host/_setup.py` を実行して準備します。ブラウザ版を確認する場合は各コマンドに `--browser` を付けます。Node.js の日本語出力とパス表示が文字化けしないよう、生成する `.cmd` の先頭では `chcp 65001 >nul` を実行します。生成済みランチャーだけを更新する場合は `python frontend_ide/host/_setup.py --launchers-only` を使います。

Live の単独画面では起動設定の `モデル設定` にモデル名がある場合、または `--connect` が指定された場合、初期設定の読み込み後に1回だけ自動接続する。`--connect` は Electron の `AIDIY_LIVE_CONNECT` とブラウザ起動引数を通り、中継の画面設定 `自動接続` へ渡す。モデル未指定なら保存済み選択（未保存なら Core の既定設定）を使う。モデル未指定・Provider だけの指定で `--connect` が無い場合と、VS Code 拡張は手動で接続する。自動接続は音声再生の許可待ちで止めず、マイクは OFF にする。接続失敗・手動切断・画面終了の後には自動再試行しない。frontend_ide の `checks/` で3種のモデル、接続失敗、音声再生の許可待ち、画面終了を検証する。

ルート `_start.py` の Code / Live は `frontend_ide/host/_start.py` から同じコマンド入口を使う。Code は待機指定を付けず独立起動し、Live は `--foreground --connect` で起動する。手動で閉じた画面は自動再表示せず、全体起動の起動前整理・終了時は Code / Discord とその配下を継続し、Live を `scripts/standalone_processes.py` で照合して停止する。明示的な cleanup では Code / Discord も停止する。共通の Electron バイナリだけで判定して未選択の Code / Live を止めない。起動選択・既定値・コマンド引数・停止対象は `checks/test_start.py` と Discord の `checks/test_lifecycle.py` で外部接続なしに検証する。

Live のブラウザ版は通常の `--browser` と Electron 失敗時の自動切り替えでサーバーを分離し、CMD / PowerShell へ戻る。画面は localhost 中継の `presence`（SSE）へ接続し、最後の画面が閉じて約60秒後にサーバーを終了する。`--browser --foreground` は診断用、`--serve` は URL の表示と手動終了用としてターミナル上で実行する。`aidiy_live/checks/launcher.test.cjs` では、GUI が常駐してもランチャーが戻ることと、Electron 失敗時にもブラウザ中継が動いたまま戻ることを検証する。

## バージョン更新時

当面のバージョン番号は `0.1.0` に固定する。機能変更だけを理由に更新しない。将来、明示的に固定解除または改版する場合は次を同時に確認する。

- `package.json` と `aidiy_live/package.json` の `version`。
- `scripts/package.mjs` に固定している VSIX ファイル名（`-0.1.0.vsix`）。`_setup.py` は `package.json` の `version` から VSIX のパスを組み立てるため、両者を揃える。
- `README.md` と `aidiy_live/README.md` の手動配置用 VSIX ファイル名。
- `checks/test_setup.py` / `checks/test_extensions.py` のバージョンを含む期待値。

`scripts/build.mjs` は Webview の依存パッケージから `dist/THIRD_PARTY_NOTICES.txt` を再生成する。依存追加後は VSIX 内にライセンス文書が含まれることを確認する。

独自実装には README の `COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.` から始まる定型文を付ける。対象は Code / Live の共通ソース・画面・起動スクリプト・検証コード。JS / TS / CSS は `/*! ... */` とし、esbuild の圧縮・結合後にも表記を残す。生成物を直接編集せず、`npm run compile` 後の各 bundle に定型文が残ることを確認する。Code / Live の `LICENSE` はルートの全文と揃え、既存の `.vscodeignore` にある `!LICENSE` を保持する。第三者ライブラリには独自実装の定型文を適用しない。

## クリーンアップ

```powershell
python frontend_ide/host/_cleanup.py
```

ルートの `python _cleanup.py` でも、`command_hermes` の次に `frontend_ide/host` を選択できる。拡張名が `aidiy-` で始まる配置済み拡張（`publisher.aidiy-*`）をすべて解除し、拡張一覧に対象が残っていないことを確認してから、`~/.local/bin` の Code / Live ランチャー（旧名 `aidiy_vscode` を含む）、`node_modules`、`dist`、`aidiy_live/dist`、`out`、`frontend_ide/host` 直下の `*.vsix`、Python cache を削除する。セットアップとクリーンアップの対象判定・解除確認は `frontend_ide/host/scripts/vscode_extensions.py` で共有する。解除が失敗した場合はランチャー・生成物を削除しない。

cleanup は VS Code 本体を終了しない。起動中の拡張ホストには再読み込みまで旧コードが残る場合があるため、解除を画面へ反映するときだけ利用者が VS Code のウィンドウを再読み込みする。CLI が利用できない、解除後も拡張が残る、生成物を削除できない場合は失敗として終了する。

削除前に、この作業コピーの Code / Live 単独実行サーバー、Electron、専用 Chrome / Edge を強制終了する。ルートの cleanup では常駐サービス停止と同じ段階で実行し、フォルダ単独の cleanup でも生成物削除前に実行する。判定と終了確認は `frontend_ide/host/scripts/standalone_processes.py` が担当する。専用ブラウザは `out/aidiy_code/browser-profile` / `out/aidiy_live/browser-profile` の完全一致で判定し、通常のブラウザは終了しない。`out` 内のキャッシュで WinError 32 が出る場合は、親サーバー終了後にも専用ブラウザが残っている可能性がある。終了確認後の一時的なファイル共有違反は短時間の再試行で吸収する。

## 問題の切り分け

| 症状 | 確認箇所 |
|------|----------|
| `code` が見つからず VSIX を配置できない | VS Code CLI の PATH、`frontend_ide/host/_setup.py` の `find_vscode_cli()`。単独画面はセットアップ可能 |
| Electron が未配置 | `python frontend_ide/host/_setup.py` を再実行する。Avatar の同じバージョン、共有 ZIP を優先して再利用する。`dist/version`・実行ファイル・`path.txt` の照合まで成功しているか確認する |
| 専用ウィンドウが表示されない | ターミナルに出る起動エラーを確認する。`frontend_ide/desktop.cjs` のIPC通知と共通 `frontend_ide/launch.mjs` の表示確認を照合する |
| Hermes が見つからない | `aidiyHermes.cliPath`、`~/.local/bin`、`command_hermes/.venv` |
| Provider / モデルが空 | `scripts/model-catalog.py`、Hermes 設定、Cli Path が AiDiy CLI を指すか |
| 送信できない | ワークスペース信頼、フォルダが開かれているか、実行中状態 |
| 回答が出ない | VS Code 出力パネルの `AiDiy Code`、CLI の終了コード、認証が必要なら「対話 CLI」 |
| `Session not found` | 古い拡張では新しい会話を開始する。更新版では `--resume` を外して一度だけ自動再試行するため、実行ログと保存セッション ID を確認する |
| VSIX に変更が入らない | `npm run package` の prepublish、Code の `dist/extension.js` / `dist/development/`、Live の `aidiy_live/dist/extension.js` / `aidiy_live/dist/development/`、`--force` 配置 |
| Live の専用ウィンドウでマイクが ON にならない | `frontend_ide/desktop.cjs` の `audioAllowed` の origin 正規化と音声・メインフレーム制限。Windows のサウンド入力にデバイスがあるかを確認する。リモートデスクトップでは録音転送を有効にして再接続する。詳細は `aidiy_live/README.md` の「マイクを ON にできない場合」 |

## Live のローカル接続先

- 接続先の画面表示、`--backend`、`aidiyLive.backendUrl` は使わない。`aidiy_live/local-backend.cjs` がホストを `127.0.0.1` に固定し、AiDiy配置先から親へ、次に作業フォルダから親へ `_config/AiDiy_key.json` を探索して `PORT_CORE` を使う。設定ファイルが無い配布済み拡張では8091を使う。読込失敗・不正ポートは既定値で隠さずエラーにする。
- ランチャー・ブラウザ中継・拡張ホストで同じ解決処理を使う。ポート変更後はCoreとLiveを再起動する。モデル選択画面に接続先欄を再追加しない。
- `checks/launcher.test.cjs` で既定起動と共通ポート変更後の起動を確認する。現行の単独起動は共通 `frontend_ide/launch.mjs` へ進み、Vue配布物がなければセットアップを案内する。起動時の自動再生成を前提にせず、画面とホストの配布物を変更後に更新する。手動では `frontend_ide/host` の `npm run live:compile` で更新できる。VS Code拡張はVSIXの更新も必要。
- 画面テストの `getElementById` は実HTMLにないIDへ `null` を返す。任意IDのモック要素を生成すると、HTMLとJavaScriptの不整合を見逃す。
- モデル情報APIへの通信失敗は、単独版・拡張とも実際の接続先と原因コードを表示する。`ECONNREFUSED` ならローカルCoreの起動・待受ポートを確認する。OpenAI側の障害と区別し、画面表示だけでAPIキーやモデルの問題と判断しない。

## Codespaces でブラウザ版が正常終了してしまう場合

- Code / Live / Discord は、通常のブラウザ版では初回120秒、最後の画面切断後60秒で終了する。Codespaces では転送登録・ブラウザ認証が遅れるため、`src/forwarded-origin.ts` の `接続元許可.初回待機時間` を未設定にし、初回接続まで自動終了しない。接続後の60秒の終了条件は維持する。
- `scripts/launch-project.mjs` はトークン付き localhost URL を `$BROWSER`（VS Code の `--openExternal`）へ渡す。転送先 URL を手で組み立てて直接渡すと、VS Code の localhost 転送・URI 解決を経由しない。localhost URL も端末へ表示し、自動転送を促す。転送先のルートではなく起動時のパスを含む URL を開く。再起動するとポートとパスが変わる。
- `[WARN] ... 終了コード: 0` は正常終了であり、ポート転送の障害とは限らない。待受プロセス、転送登録、トークン付きパスへの環境内応答、認証付き外部応答を照合する。
- `checks/browser-mode.test.cjs`、`aidiy_live/checks/live.test.cjs`、Discord の `checks/web-server.test.ts` で初回120秒以上待っても終了しないことと画面切断後の終了を確認する。


## AiDiy IDE の埋め込みパネルを変更するとき

- `frontend_ide/viewer/panels.mjs` は `dist/aidiy_code/server.cjs` / `dist/aidiy_live/server.cjs` を遅延起動し、HTTP・SSE・WebSocketをIDEの公開元へ中継する。Code / Liveの変更を反映するには該当するビルド成果物も更新する。Codeサーバーだけなら `node frontend_ide/host/aidiy_code/build.mjs` を使う。
- Codeの `lockedMode: true` はIDE専用。接続切り替えと別モードの履歴復帰を拒否し、画面不在60秒での自動終了を止める。終了管理はIDEが担当する。
- オフラインではLiveを表示・起動しない。CodeのHermes直接実行は単独版と共通で、オフライン開始からAIコアへの通信を行わないことを確認する。
- 埋め込み表示だけ `frame-ancestors 'self'` にする。単独版のCSPは変更しない。CodespacesのHost / Origin検証はIDEで行い、内部への転送時にローカルのHost / Originへ揃える。
- 確認は `node --test frontend_ide/viewer/checks/panels.test.mjs`。Liveの音声許可は `frontend_ide/desktop.cjs` の `audioAllowed` の同一公開元・Live子フレーム・音声限定を維持する。マイク実機を使わない確認にはElectronの `use-fake-device-for-media-stream` を使い、許可判定を省く `use-fake-ui-for-media-stream` は付けない。

## Code / Live 内部認証の変更・検証

- セットアップの `stage_extension_package()` は元 VSIX を変更せず、一時 VSIX の `extension/aidiy-installation.json` に `{version: 1, root: 配置元の絶対パス}` だけを追加します。Code / Live 両方の検証完了後に既存拡張を解除・配置します。通常セットアップと `--extensions-only` の共通処理です。配布元 VSIX にマシン固有の記録や秘密を混ぜないでください。
- `host/src/extension-installation.ts` は配置元を接続単位で固定し、接続先と認証を同じ root から解決します。別プロジェクトや複数 checkout があっても記録元を優先し、壊れた記録・移動後の配置元を workspace で補完しません。再セットアップ後は VS Code を再読み込みします。記録なしの旧版・開発ホストでは従来の探索を維持します。
- Node 専用の `host/src/internal-auth.ts` が、同じ配置先の内部認証ファイルを要求ごとに読みます。`PORT_CORE` と loopback origin の一致、期限、秘密ファイルの symlink 拒否を維持します。WSL / SSH / Codespaces の配置元は拡張ホスト側です。Live 拡張から開くブラウザ版も同じ認証を使います。
- `checks/extension-installation.test.cjs`、`checks/extension-origin-host.test.cjs`、`checks/test_setup.py` で、配置済み拡張＋別プロジェクト、独自ポート、複数配置、移動、旧版、記録破損、ローテーション、元 VSIX 不変、配置前検証失敗を隔離 fixture で確認します。
- 接続箇所は `src/code-connection.ts`、`aidiy_live/src/host.ts`、`aidiy_live/src/server.ts`。Vue の `ライブ通信.ts` は既存 IPC / localhost 中継を使い、内部トークンを受け取りません。REST は redirect を追跡せず、WS は undici の header または Node HTTP upgrade の header にだけ付与します。
- `checks/internal-auth.test.cjs` と `checks/internal-auth-transport.test.cjs` は一時 fixture / メモリ内 mock で実行します。実際の認証ファイルや利用者の設定・DBをテストに使いません。配置名変更、期限切れ、不正JSON、ローテーション、別origin拒否、画面・URLへの漏洩防止を検証します。
- Core 再起動時、Code の既存10秒再接続が新しいトークンを再読込すること、切断・破棄で停止すること、依頼を二重送信しないことを確認します。Live の手動再接続方針は変更しません。
- undici は Node bundle に含め、Web / Vue bundle に含めません。Live VSIX は `dist/THIRD_PARTY_NOTICES.txt` も配布します。

## フォルダ未選択時の操作保護

Code / LiveのVS Code版は、`host/src/workspace-folder.ts`で実在ローカルディレクトリを判定する。赤字案内は両Vueパネルの入力欄直上に置き、フォルダを開く導線だけを残す。拡張ホストでも要求を拒否し、フォルダ削除・切替時は接続を破棄して認証を読み直す。LiveはWebviewを再初期化し、古い世代の要求を破棄する。信頼・認証チェックや単独版の挙動は維持する。確認は `checks/workspace-folder.test.cjs`、`checks/code-extension.test.cjs`、`aidiy_live/checks/extension.test.cjs` とVueのCode/Liveモデル選択テストを使う。
