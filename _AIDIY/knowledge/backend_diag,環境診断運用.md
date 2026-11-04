# 環境診断の運用

`backend_diag` は、Node.js の診断サーバーと Vue 3 配布画面を Electron / Web で表示する任意起動の診断ツールです。起動・認証・Codespaces・検証の詳細は [backend_diag/README.md](../../backend_diag/README.md) を参照してください。

総合テストの手順・実施結果・エビデンスと、その副産物として残す操作手順書素材は、別冊の[環境確認編](../../docs/セルフテスト、操作ガイド/セルフテスト,aidiy_diag,環境確認編.md)を参照してください。[システム起動編](../../docs/セルフテスト、操作ガイド/セルフテスト,aidiy_diag,システム起動編.md)・[ランチャー編](../../docs/セルフテスト、操作ガイド/セルフテスト,aidiy_diag,ランチャー編.md)とは、手順と実施結果を分けます。本書は実装・保守の運用情報を扱います。

Electronの長押し操作と表示開始ズームは [共通の基本方針](./共通,Electronウィンドウ基本方針.md) に従う。初期ミニ表示でも最終位置・寸法を先に確定し、透明パネル内でズームする。表示中の通常・ミニ切替には登場ズームを再実行しない。

通常・ミニ表示のタイトル行は 自 module 内の `ui/src/components/共通表示/タイトルバー配色.css` の変数を使い、Electron と Web で暗灰色 `#30343a`・白文字 `#fff` に揃えます。外枠は同じ背景色を参照する `--aidiy-panel-border` の1pxを内側に確保します。左上の実操作は `.launcher-selector` が所有し、未接続・切替中も文字のopacityを落とさず、暗い面・破線枠とnative disabledで無効を示します。古い `.window-actions .title-mini-switch` を配色元にしません。

シアンバーより下の通常面・タブ土台・見出し・通知・応答・ランチャー・AI設定フォームの外側は真黒 `#000` にします。入力欄、選択中タブ、警告、稼働状態、hoverと画像・内容本来の色は識別のため保持します。AI設定は黒い外側のラベルだけ明るくし、白い入力欄の暗色文字は保持します。microアイコン表示は背景透明・外枠0の例外です。配色原本を変更したら UI を再ビルドし、manifest一致と `checks/mini-titlebar.check.cjs`、`panel-palette.check.cjs`、`statusbar.check.cjs` で実タイトル操作・本文面・状態の分離を確認します。

タイトル欄の左側に「ランチャー表示」「アイコン化」を置き、接続中はどのタブからでもランチャーへ切り替える。アイコン化にはプロジェクトフォルダの選択も必要。ミニの左側にも同じ条件の「アイコン化」を置く。既存の「システム起動」と「アプリ起動」のボタンも維持する。通常表示への復帰は元のタブへ戻り、ミニ内のサービス名を押した場合は「システム起動」の該当ログへ移る。アプリ起動側からミニにした場合もポート状態の更新を続ける。アプリはdetachedで独立起動し、Diag終了時のサービス停止対象には登録しない。終了確認には、停止する管理サービスと継続するアプリの違いを明記する。

総合テストでは、キー未登録・機器未接続・任意サービス未起動を `PASS (別途環境調整必要)` として報告する。診断画面が実際に検出したNGの記録は保持し、環境条件と製品不具合を区別する。総合評価は `✅ OK (PASS n件含む)` とし、nの内訳を併記する。

専用Electron窓は通常・ミニ表示とも左ボタンを同じ位置で0.5秒押すとドラッグ移動できる。`起動/electron-main.cjs` が窓の生成時に `frontend_ide/デスクトップ/長押し窓移動.cjs` の `attachNativeWindowMove(window,screen,'diag')` を一度取り付ける。短押しはクリック、0.5秒前の移動は通常のログ選択・ドラッグとして扱い、移動後の解放でボタンを押さない。解放・Esc・フォーカス喪失・破棄で解除し、最大化・全画面では開始しない。ミニ状態の位置と通常表示への復元は `ミニ表示.cjs`、最前面ピンは共通の `最前面ピン.cjs` が管理する。通常・ミニとも起動時はOFFで、切替中もユーザーのON/OFF選択を維持する。Web / headlessには適用しない。`node backend_diag/checks/initial-mini-desktop.mjs` は合成Tools状態と隔離プロファイルで初期ミニ表示・通常復元に加え、実Electron入力による両表示の長押し移動とサイズ維持・誤クリック防止・Esc解除を確認する。

- 通常の全体setupではDiagを質問なしで対象にし、共通処理の後に準備します。全体cleanupではDiagの解除を最初に確認し、既定 `[y]/n`・a=autoでも対象です。全体startでは最初のDiag起動質問（既定Yes）で、Diag経由と個別サービス起動を分けます。
- 通常は `aidiy_diag` で Electron 起動、`aidiy_diag --browser` で Web 起動します。Codespaces / GUI なしでは Web です。Electron は既存 `scripts/_setup_electron.py` の共有 ZIP / 同版 dist を使ってセットアップします。Node.js 自体が無い場合はランチャーが理由と公式導入先を表示します。Python は診断アプリ起動には不要です。
- 単独のPython管理入口 `python backend_diag/_start.py [引数]` は通常の `aidiy_diag` と同じNode本体へ引数をそのまま渡し、暗黙の `--auto` は付けません。子の失敗を終了コードに反映し、中断は130です。ルート起動のDiag選択にだけ既存の `--auto` が付きます。
- GUIなしの通常setupでもNodeの実行可否は確認します。Electron / npmは不要ですが、Node未導入・実行不能・timeoutは成功にしません。新しい版数確認は警告継続、起動前の既存Node18条件は維持します。ランチャーだけの再登録では実行環境を新たに要求しません。
- cleanupの停止通知は排他的な同一フォルダの一時ファイルから置換します。固定 `.stop-request.tmp` のsymlink参照先を書き換えず、置換失敗時には自分の一時ファイルだけを整理します。所属が不明な相対起動や、POSIXの未引用空白パスは断片を結合して停止対象へ加えず、終了確認不能として削除を中止します。対象を画面・元端末で終了してから再実行します。配布 `static/` と既存の削除選択は保持します。
- Mac / Linux の Electron 導入失敗は共通セットアップを確認します。Python の証明書検証失敗時は検証を有効にした curl へ切り替え、ZIP は unzip に依存せずリンクと補助プログラムの実行権限を保持します。修復は `python3 backend_diag/_setup.py` で行います。ランチャー専用の修復では Electron 本体を直しません。詳細は [共通の Electron セットアップ](./共通,開発環境運用手順.md#electron-の共通セットアップ) を参照してください。
- `aidiy_diag --headless` は画面を開かず全診断をコマンドラインで最速実行し、`_AIDIY/aidiy_diag/install_info.json` へ保存します。画面の「書込」「全テスト」も同じ形式で保存します。画面の「全テスト」は外部連携（Hugging Face / Discord）の読み取り専用の認証確認と `integration_info.json` への保存も行いますが、headless では外部連携を確認しません。実行に失敗した場合は既存の結果を書き換えません。
- ルート `_start.py` はToolsを実際に起動する直前（自動再起動時も含む）に必ず `aidiy_diag --headless` を1回実行し、モデル合成JSONの生成完了を待ちます。Tools未選択・クリーンアップによる起動スキップ時は実行しません。失敗時はToolsを起動せず終了し、すでに起動した管理対象プロセスを停止します。最初のDiag起動の質問でNoを選び、Toolsを個別起動する経路でも、このheadless事前処理は必須です。
- ルート `_setup.py` のaidiy_diagは `[y]` の表示だけで選択入力を受けず、ランチャー配置とElectronの準備を必ず行います。終盤は「キャッシュクリア」の見出し、import由来キャッシュの削除、headless診断の順で実行します。診断失敗は既存の「エラーが発生しても続行」の選択に従います。単独の `aidiy_diag` は従来どおりGUIで使えます。
- Python、uv、Node.js、npm、npx、Electron、その他のコア周辺、機能別の任意依存の順に確認します。任意機能の未検出をシステム全体の故障と判断しないでください。
- バージョン確認は各15秒待ちます。一括診断は4並列のため、高負荷時に失敗した項目は個別確認で切り分けます。全体・Web・Avatarの起動前npm確認、Diag起動前のNode.js確認、サービス起動用Python確認も15秒です。npmのタイムアウトは未導入と断定せず、直前の警告と導入パスを確認します。Windowsの通常のnpm.cmdはユーザー側npmへ転送する場合がありますが、Diagは検出パスに同居するJS CLIを直接確認するため、両者のバージョンが異なる場合があります。
- 固定 version 引数に副作用が無いことを確認できない項目は、存在確認のみにします。Ollama の `--version` はサーバーへ接続するため実行しません。
- Ollama のモデル取得はローカル `127.0.0.1:11434/api/tags` 固定です。画面・headless とも、今回のインストール確認で「未検出」なら通信せず「未実施」とスキップ理由を保存します。未確認・検出エラーを未導入とは見なさず、従来の取得を続けます。
- Web 版でも全機能を使えます。Codespaces の転送ポートは Private にし、起動時の認証 URL を共有しないでください。確認対象はブラウザ端末ではなく診断サーバーです。
- カタログ追加ではソース参照と必要な機能を必ず記載します。設定ファイルのキー、ログイン情報、環境変数全体を返す診断は追加しません。

## 標準・ミニ・アイコン表示のタイトル操作

標準パネルは、タイトルのダブルクリックで最大化、再度のダブルクリックで元の位置・寸法へ復元し、最大化中のタイトルドラッグでは復元後も押した位置がポインターに追従します。ミニと透明なアイコンは特殊表示として分け、標準の最大化操作を適用しません。

Windowsでは透明なBrowserWindowのnative最大化が制限されるため、アイコン表示と共用する窓を不透明へ変更せず、`起動/通常窓サイズ.cjs` の復元寸法と `起動/標準タイトル操作.cjs` の標準タイトル操作を併用します。preloadの固定能力 `customNormalTitle` がtrueの標準タイトルだけ `no-drag` にし、mainのnative `clickCount` と隔離worldのtrusted pointer状態で処理します。Linux/macOSはnativeタイトル操作を維持します。rendererから任意の座標・窓IDを渡すIPCは追加しません。

- □操作・タイトル操作・背景の500ms長押しは同じ最大化状態を参照します。標準タイトルは背景長押しから除外し、ボタン・入力・選択・ダイアログをタイトル移動対象にしません。
- 最大化からのドラッグは押下だけでは復元せず、実際の移動開始時に保存済み通常寸法へ戻します。画面座標はDIPで統一し、負の画面原点を許容します。通常の解放位置は保持し、capture喪失・Esc・blur・遷移・終了・表示切替・古い非同期結果では移動を継続しません。
- 標準内での最大化→復元は元の位置・寸法です。標準→ミニ／アイコン→標準では既存どおり、元の通常寸法を現在の特殊表示位置から復元し、自動で再最大化しません。
- 最大化演出の待機中に最小化・終了・再読込・表示切替を要求した場合、遅れて最大化しないよう要求世代を破棄します。

確認は `node --test backend_diag/checks/normal-title.check.cjs backend_diag/checks/normal-size.check.cjs backend_diag/checks/desktop.check.mjs backend_diag/checks/size-transition.check.cjs backend_diag/checks/mini-titlebar.check.cjs`。`backend_diag/checks/normal-title-desktop.cjs` は導入済みElectronへ渡す隔離試験で、実trusted入力・DOM対象判定・capture喪失を検査します。Linux画面なし環境では `--ozone-platform=headless` を指定できますが、viewport・窓寸法・OSカーソル・フォーカスを合成するため、Windows実機のnativeジェスチャーや異なるDPIの複数画面での確認には代用しません。実機では通常／最大化の反復、最大化からのドラッグ、画面をまたぐ移動、ミニ・アイコンへの切替と復帰を別途確認してください。

## システム起動管理

導入状況のPython／Node.jsは `backend_diag/診断/セキュリティバージョン.mjs` の系列別基準で緊急パッチを確認します。Python 3.14.10／3.15.2、Node.js 24.22.1／26.12.1が基準です。同系列の基準未満は「注意」とし、右側詳細に「バージョンが古い！ セキュリティパッチ未対応」と更新先を表示します。基準一致・以降は警告しません。Python 3.14未満・Node.jsの旧系列は判定対象外として更新を促す注意にします。Python 3.16以降・Node.js 27以降の未来系列は対応済み扱いにする運用方針です。これは最新版や全脆弱性の安全性保証ではありません。基準は同ファイル記載の公式発表で更新し、境界値の試験 `node --test backend_diag/checks/security-version.check.mjs` を実行します。警告によってエラーや起動禁止にはしません。未検出・コマンド実行失敗は元の判定を維持します。

一括起動（`--auto` のポート解放待機を含む）と強制停止は、タブ下の非モーダル進行ボックスに大きな「一括起動中…」「強制停止中…」と回転表示、実際の処理対象・準備状況を表示します（推定の進捗率は表示しません）。タブの切り替えや他画面の操作を遮らず、別タブでも状態確認を続けます。進行中は表示を閉じず、正常完了・取消後は自動で消え、完了通知を残しません。失敗はコンソール確認の案内とともに残し、「閉じる」で消せます。ミニ表示はコンパクトなボックス、アイコン表示は短い起動中・停止中表示と回転表示、詳細ツールチップです。失敗時は「詳細を確認」から通常表示へ戻せます。アイコンから通常表示へ戻すと詳細を確認できます。通信失敗は処理完了と判断せず、状態の再確認を案内します。検証は `checks/start-progress.check.mjs` と `checks/start-manager.check.mjs`。

ミニ表示への切り替えはユーザーが行います。設定起動では自動で切り替えず、通常表示では今までどおり起動に合わせてタブとコンソールを切り替えます。ミニ表示を選んだ場合はその表示を保ちます。起動処理中、または1つでもTCPポートが開放されている間は、「起動対象」がONでポートが未開放の機能を赤く脈動させます。ポートが開けば緑の脈動へ戻ります。通常タブとミニ表示で同じ判定を使い、内部再起動中の一時的なポート閉鎖も赤で示します。起動対象外・未確認だけの場合・全停止後は赤くしません。通常表示は約800ms、ミニ表示は約5秒ごとに確認します。

右上の一括操作は、全6機能のTCPポートが未開放かつ管理プロセスも停止済みのときだけ「設定起動」を有効にする。未確認時は起動させず、稼働中・起動処理中は「強制停止」へ切り替える。認証付き `POST /api/起動/強制停止` は空JSONのみを受け付け、`サービス管理.mjs` が後続起動を取り消してタブの逆順（Web → Task / Team → Apps → Core → Tools / MCP → Local）に生存プロセス・開放ポートを再確認して停止する。停止済みはスキップし、失敗時も残りを続行して理由を表示する。管理外のサービスは固定IDだけを受け付ける `scripts/_diag_stop.py` で、通常監視への停止通知・既存Diagの実行ID更新・既存の停止処理を使用する。設定起動のAPIでも稼働中・未確認を拒否する。個別の再起動と停止は従来どおり。 `--auto` のポート解放待ち・再試行は、個別停止・強制停止・手動再起動・Diag終了で取り消す。停止指示後に旧待機が起動を再受理しないよう、待機前とポート確認後の両方で操作世代を照合する。取り消した自動起動は手動操作の通知を上書きしない。検証は `checks/start-manager.check.mjs`、`checks/start-bulk-state.check.mjs`、`checks/start-browser.mjs`、`scripts/checks/test_diag_stop.py`。


Webの「ブラウザで開く」の右に「手動で開く」を置く。Tools / MCPとWebの両TCPポートが開放されているときだけ有効とし、通常表示でも全6機能のポート確認を使う。チェック欄のON/OFFと独立した一時操作で、サービスや設定は変更しない。一括起動の自動ブラウザ表示にもTools / MCPが必要。手動操作の認証付き `POST /api/起動/ブラウザ` は空JSONだけを受け付け、押下時に両ポートを再確認してから `起動/Webブラウザ.mjs` が既存の `POST /aidiy_chrome_devtools/new_page` を呼び、固定の `http://localhost:8090/` とページIDを確認する。URL・コマンド・起動対象は受け付けず、連打は抑止する。検証は `checks/web-browser.check.mjs` と `checks/start-browser.mjs`。

- 専用窓の初期表示は `起動/electron-main.cjs` が一度だけ127.0.0.1:8095へTCP接続して判定する。開放時は非表示の窓をミニへ整え、主ディスプレイのworkArea左上から8px内側へ、最前面ピンOFFで初表示する。未開放・確認不可は通常のシステム起動画面。通常表示は中央ではなく、主ディスプレイのworkArea左上から48px内側（ミニの左上角より内側）に表示を始める。TCP接続は `起動/ポート接続.cjs` を周期的なサーバー確認と共用し、500msで打ち切る。
- 初期ミニの真偽だけを固定のadditionalArgumentsからsandbox preloadへ渡し、`aidiyWindow.initialMini` として公開する。Vueは最初の描画から同じモードを使う。認証失敗時は通常表示へ戻す。画面再読込は通常表示へ戻し、初期ポート判定を繰り返さない。ミニ中もピンをON/OFFできる。通常へ戻す時は現在のフォーム左肩で元の通常寸法を復元し、最前面ピンは最新のユーザー選択を保持する。任意座標や最前面レベルのIPCは追加しない。
- 通常・ミニの切替と最大化・復元は `起動/サイズ切替.cjs` の380msの縮小・拡大演出を使う。内包される縮小も登場ズームと同じ透明な短命窓に統一し、実画面へdata画像やinline styleを注入せずCSPを維持する。切替前後の画面画像を変形・クロスフェードし、実窓の連続リサイズで白い縁を出さない。`startMini` は画像を準備して実窓の寸法を変え、Vueが描画した後に固定の `finishMini` で演出を完了する。ミニの内容高はその間に測り、最終寸法へ一度だけ変形する。切替中はボタンを無効にし、再読込・終了・撮影失敗時は演出窓と透明度を回収する。未完了でも2.5秒で実窓を復元する。初期表示には既存の750msの登場ズームだけを使う。検証は `checks/size-transition.check.cjs` と `checks/initial-mini-desktop.mjs` で行う。
- headlessはElectron経路へ入らず、起動時の8095確認・UI・HTTP待受も実行しない。`checks/node-only-startup.check.mjs` は実headlessのポート確認とlistenを禁止して、診断・書込が従来どおり完了することを確認する。`checks/desktop.check.mjs` / `checks/start-mini.check.mjs` は開放・未開放・確認不可の分岐と位置の復元、最前面ピンの保持を検証する。`node backend_diag/checks/initial-mini-desktop.mjs` は合成Tools稼働・実Electronの初期描画、左上座標、最前面、通常復元を確認する。実サービスには接続せず、テスト窓はフォーカスとマウスを奪わない。
- 画面は `backend_diag/ui/src/components/起動/`、認証付き API は `diag_main.mjs` の `/api/起動*`、管理は `起動/サービス管理.mjs`。プロセス起動は Node の `spawn` で固定の `python -u -X utf8 <各フォルダ>/_start.py --diag-start <ID>` を実行する。HTTP でコマンド・引数・作業フォルダは指定させない。
- `scripts/起動対象.json` は順番、フォルダ、既定値の共通元。ルート `_start.py` の auto と aidiy_diag の初期値を両方確認する。aidiy_diag の対象は local / tools / core / apps / taskteam / web の6機能。`起動管理: false` の Avatar 以降はルート起動の既定値だけを残し、システム起動の表示・起動 API・専用経路から除外する（アプリ起動は別機能）。aidiy_diag 自身と on-demand の Hermes も対象に含めない。
- 設定は `_config/AiDiy_diag_start.json` に原子的に保存する。機能ごとに既知の真偽値だけを受け付ける。起動時に設定のコピーを固定し、処理中に変更した設定は次回へ適用する。ページ再読込・別タブへの移動ではプロセスを停止しない。
- `scripts/_diag_start.py` は既存の `check_environment` / `start` / `kill_ports` を共用する。Core / Apps は対応するポートだけを停止する。Tools は固定の `diag_main.mjs --headless` を先に実行する。設定不足・事前診断失敗・待受失敗時は後続の起動を中止する。
- Web の表示設定は「ブラウザで開く」の1項目（保存キー `ブラウザ表示`、既定 ON）。保存ファイルに統合前の `chrome_devtoolsで開く` があれば読込時だけ取り除き、`ブラウザ表示` の ON / OFF は維持する。設定 API は引き続き既知の真偽値だけを受け付ける。ON 時はポート開通後も HTTP 200 が20秒間継続するまで待ち、失敗応答で安定時間を数え直す（最大90秒）。安定後に Tools の既存 `POST /aidiy_chrome_devtools/new_page` を呼び、戻り値のページ ID を確認する。OFF 時は画面を開かず Web だけ起動する。Tools / Chrome の失敗は理由をコンソールに出して Web を稼働継続し、HTTP 安定待機の失敗は起動失敗とする。loopback 通信はプロキシを経由させず、安定待機中の停止ではページを開かない。外部サービスを操作しない Python 試験で応答失敗・継続安定・停止・タイムアウト・呼出順・Tools 失敗を確認する。
- 通常の `_start.py` 監視には既存の `cleanup_stop_request` を通知し、旧インスタンスの自動復活を防ぐ。aidiy_diag 同士の入替は `temp/aidiy_diag/起動/<ID>.json` の実行IDと OS ファイルロックを使い、旧監視が停止処理を終えるまで新監視は待つ。PID だけを保存して後から停止する方式にはしない。
- キーボードの Ctrl+C / ⌘C はログの選択コピーに使い、停止 API へ接続しない。起動画面は通常のテキスト選択を許可する。「停止（Ctrl+C）」ボタンは Python の制御入力に停止要求を送り、`scripts/_diag_console.py` が対象へ実際の割り込みを送る。POSIX は対象のプロセスグループへ SIGINT、Windows は aidiy_diag 経路だけ隠した専用コンソールへ分離し、短命の補助プロセスから CTRL_C_EVENT を送る。専用コンソールとして生成した印がないプロセスには送らず、他のターミナルを巻き込まない。5秒で終了しない場合や送信失敗時は従来の強制停止へ進み、各機能の子・孫プロセスも既存停止 API で回収する。起動中の停止、異常終了時の再起動待ちの停止、aidiy_diag 終了による標準入力 EOF も同じ停止要求として処理する。自動再起動 ON の明示停止は再起動させない。
- Windows で一瞬コマンド画面が出る場合は、診断本体だけでなく環境確認・ポート整理・強制停止の子プロセスも確認する。Tools の事前 headless 診断は本サービスと同じ `ConsoleSubprocess` で隠した専用コンソールへ起動し、停止時の Ctrl+C を維持する。各フォルダの `subprocess.run` は aidiy_diag 経路の間だけ `HiddenSubprocess` を介し、`CREATE_NO_WINDOW` と既定の標準入力 EOF を指定する。診断単独の Node バージョン確認・headless 実行も同様に非表示にする。Node 側の診断コマンドは `windowsHide: true` を維持する。Electron や利用者が選んだ Web ブラウザには非表示指定を適用しない。`scripts/checks/test_diag_start.py` は実プロセスのコンソール有無・非表示・出力取得と Ctrl+C を確認する。
- コンソールは機能別にメモリ上で最大120,000文字を保持し、ログ位置を指定して差分を取得する。個別再起動の受理時は対象のログをクリアし、位置の基点を以前の末尾より先へ進めて古いカーソルにも置換を通知する。UIも対象のキャッシュとカーソルを消し、取得中の古い応答を無効にする。一括起動では履歴を維持する。ANSI 制御文字を除去し、画面はテキスト補間で表示する。HTTP の起動要求を全診断・headless・画面初期表示から呼ばない。起動画面の表示だけでは Python を探索・起動しない。
- ログは `white-space: pre` で折り返さず横スクロールできるようにする。幅は画面内に収め、ページ全体を横へ広げない。新着ログ・対象切替・起動画面の再表示時は描画後にコンソールを最下部へスクロールする。手動で上へスクロールしても新着時は最下部へ戻す。実ブラウザ試験は長い合成ログで縦横の内部スクロールを発生させ、手動スクロール後の追従も確認する。
- 専用窓の終了確認は `起動/終了確認.cjs` と Electron の `close` イベントで扱う。タイトルバー・OS の閉じる・ミニ表示に共通で、renderer の表示タブやポーリング済み状態には依存させない。固定 loopback の認証付き `api/起動` を3秒以内に再取得し、`終了時停止あり` が true のときだけ停止の確認を表示する。この値は順次起動の実行中または未終了の管理子プロセスがある間 true とし、起動処理の完了後も稼働中なら true のまま。状態取得失敗時も確認し、既定と Escape はキャンセルとする。連打中は同じ確認を共有する。親サーバーの切断は既存の自動終了を継続する。検証は `close-confirm.check.cjs` と `desktop.check.mjs` で、未起動・稼働中・キャンセル・承認・二重操作・状態取得失敗・認証・外部 redirect の非追従を確認する。
- Mac のアプリ名とメニューは `起動/MacOS-Menu.cjs` から全7アプリ共通の `frontend_ide/host/scripts/MacOS-Menu.cjs` を使う。`electron-main.cjs` が ready 前に `app.setName('AiDiy 診断')`、ウィンドウと終了確認の作成後に最小メニューと Dock のアイコンを設定する。独自メニューの閉じる・⌘Q / ⌘W は `window.close()` を呼び、確認を飛ばす `app.exit()` は呼ばない。編集メニューを表示せず、非表示の native role と `acceleratorWorksWhenHidden` でコピー・貼付・選択・元に戻す等を維持する。`before-input-event` でキー入力を横取りしない。Windows / Linux へは適用しない。`desktop.check.mjs` で終了キャンセル・承認と編集メニュー構成を確認する。`app.setName` は OS 側の Dock 名を変更しない。Dock 名の変更にはアプリバンドルの名称・Info.plist 等の配布設定が必要で、[Electron 公式のパッケージ化手順](https://www.electronjs.org/docs/latest/tutorial/application-distribution)を参照する。
- 順次起動の表示追従は `api/起動` の `起動表示: {対象, 実行ID}` を使う。サーバーは各機能の再起動開始前に実行IDを更新し、完了・失敗後も最後の対象を保持する。UI は未反映の実行IDだけでタブを選択し、同じ対象の再起動にも対応する。通知文の解析や状態配列の先頭検索で対象を推測しない。定期取得のたびに選択を上書きせず、手動で別タブを見た場合は次の開始まで維持する。ミニ表示を解除せず、表示追従から起動・停止 API を呼ばない。単体確認は `start-follow.check.mjs`、実画面は `start-browser.mjs` で6機能の準備完了を順に保留・解放し、途中の自動表示と手動選択の保持を確認する。
- 起動画面のミニ表示は `ui/src/components/起動/起動ミニパネル.vue`、切替状態は `ui/src/components/ウィンドウ/起動ミニ表示.mjs`、専用窓の寸法管理は `起動/ミニ表示.cjs` が担当する。上部の6アプリ、利用可能なCLIのアイコンと名称帯、下部の6機能の状態を幅330px・内容に追従する高さで表示し、通常表示で元の位置・寸法・最大化状態を戻す。ミニ中はログの取得を止め、管理状態とポート開放状態を約5秒ごとに取得する。画面切替は起動・停止 API を呼ばない。どのタブからでもミニに入り、復帰は元タブを保持する。切断や画面再読込では通常の窓寸法を復元する。切替IPCは主フレームからの真偽値だけを受け付ける。高さ専用IPCはミニ中だけ80〜360pxの整数を受け付け、幅と位置の指定は公開しない。`ウィンドウ/ミニ高さ.mjs` が自然な内容高と共通タイトル31px・接続線3pxを測り、同値を再送せず、通常表示への復帰で監視を破棄する。検証は `start-mini.check.mjs` と既存 `desktop.check.mjs`、実ブラウザの `start-browser.mjs` で行う。
- ミニのサーバー表示は管理プロセスの状態に依存させず、認証付き `GET /api/起動/ポート` と `起動/ポート状態.mjs` を使う。`scripts/起動対象.json` の管理対象6機能のポートだけを127.0.0.1へ並列TCP接続し、1接続500msで打ち切る。任意のホスト・ポート・入力は受け付けず、HTTP本文や認証情報を送らない。開放は緑、未開放・確認不可は灰色。tooltipにポート番号と状態を出す。確認不可を過去の開放結果で補わない。
- `ui/src/components/起動/起動状態.mjs` は通常表示の更新を800ms、ミニ表示は5秒に分ける。ミニ退出・切断でタイマーと取得中のリクエストを破棄する。管理状態は終了確認・コンソール・停止の所有権に引き続き使い、外部 `_start.py` のサーバーを検出しても所有・停止対象へ加えない。アプリ起動のAvatar / Live / Discordの二重起動確認は押下時だけのまま。
- ポートの検証は `checks/port-status.check.mjs` の無害なTCP待受で開放・終了・再開、無送信、タイムアウト・キャンセル・固定対象・認証を確認する。`checks/start-mini.check.mjs` は5秒の更新間隔・退出時の停止・未管理サーバーの検出を確認する。`checks/start-browser.mjs` は管理状態とポート状態を独立して変化させ、5秒ごとの色の更新とログ取得停止を実画面で確認する。
- 検証は `node --test backend_diag/checks/start-manager.check.mjs`、`python -B -X utf8 scripts/checks/test_diag_start.py`、`node backend_diag/checks/start-browser.mjs`。実サービスを起動せず、合成プロセス・模擬フォルダと既存 Chrome / Edge で順番、保存・再読込、二重実行、Ctrl+C でのコピーと停止 API の非呼出、停止ボタン、横幅1280 / 390、パス型 proxy を確認する。Python の合成サブプロセス試験は監視プロセスの入替、Ctrl+C による子の終了処理、共有コンソールへの誤送信防止、停止タイムアウト時の強制停止も確認する。
- UI 変更後は今回の画面反映を目的として `backend_diag/ui` の `npm run build`、続けて `node backend_diag/ui/verify.mjs` で配布物を同期する。

## 保存済み結果の初期表示

導入状況・モデル一覧・外部連携は `診断/前回結果.mjs` から既存の保存ファイルを読み、実行ボタン左側に前回実行日時を表示します。通常の確認・再取得では画面上だけ更新し、自動保存はしません。保存は headless と確認後の書込ボタン（全テスト内の書込を含む）です。保存前に再起動すれば最後に保存した内容へ戻ります。

タブ移動では今回の結果・実行日時・書込済み表示を保持します。モデル一覧と外部連携の再確認はそれぞれ `api/キー設定/モデル一覧` / `api/キー設定/外部連携` を使い、対象側だけ結果と書込済みを解除します。サーバーの書込対象も同じ範囲で破棄し、別タブの未保存結果を失わないようにします。

欠損・破損JSONは未確認として扱い、表示用の結果を今回の認証証跡や書込対象へ戻しません。回帰確認は `node --test backend_diag/checks/previous-results.check.mjs`、実ブラウザの位置・表示・再起動確認は `node backend_diag/checks/previous-results-browser.mjs`（既存Chrome/Edgeを使用、外部APIを呼ばない合成データ）です。

## 内部ファイルの配置

- ルートには公開入口 `diag_main.mjs` / `aidiy_diag` / `aidiy_diag.cmd` と `_setup.py` / `_start.py` / `_cleanup.py`、パッケージ設定・案内を残します。
- `起動/` は Electron・IPC・停止監視、`診断/` は導入確認・headless・カタログ、`モデル情報/` はキー確認・モデル/音声合成を担当します。
- OpenRouter の同梱 ZIP は `backend_diag/モデル情報/openrouter_models/openrouter_models.zip`。対応するローダーと同じ機能の配下に置き、静的公開する `static/` へは入れません。
- モジュール移動時は import、`import.meta.url`、Electron の package main / preload、fixture の差し替え先を追従させます。Electron の依存物・安全ログ・停止要求は従来の `backend_diag/` 基準、永続的な診断・モデル情報JSONは `_AIDIY/aidiy_diag/` に維持します。一時用途のアプリ/CLI起動ログは `temp/aidiy_diag/アプリ起動/`、サービス監視の実行ID JSON・OSロック・置換用一時ファイルは `temp/aidiy_diag/起動/` を使います。旧場所の自動移動・削除・フォールバックは行いません。更新前の Diag と管理サービスは終了してから起動し直し、稼働中のロック・実行IDは手動削除しません。停止API・cleanupの対象は変更せず、`backend_diag/.stop-request` の位置も維持します。
- `node --test backend_diag/checks/*.check.mjs backend_diag/checks/*.check.cjs` の layout / bundled-models / launcher / startup / headless テストでパスと起動の回帰を確認します。UI・runtime を変更しない配置変更では配布物を無用に再生成せず、`node backend_diag/ui/verify.mjs` で一致を確認します。

ミニ表示の外部アイコンは6列相当の幅で折り返します。7個以上で1列に固定すると、中央寄せの両端が窓の外へ出るため、`.mini-cli-buttons` の `flex-wrap:wrap` を維持します。高さは内容とタイトル・接続線・外周枠から測り、横方向にはスクロールを作りません。`node backend_diag/checks/initial-mini-desktop.mjs` は実Electronの端数DPI、全外部アイコンの画面内配置、縦スクロール残り、最前面の切替、通常表示への復帰と操作領域を検証します。CLIの導入状態は読み取り、アプリは実起動しません。

## ソース調査の基準

`backend_diag/診断/coverage.json` の基準コミットに対し、対象ソース・設定 3,333 件を全件全文静的走査し、246 候補へ整理した調査履歴を保持しています。現在の診断対象は 19 件（ベース 6、CLI群 7、その他拡張 6）です。AiDiy 起動コマンド、Hermes 専用、Mac 音声、GStreamer、Edge、Brave、OS・任意スキル・開発導入補助等 227 件は確認対象から除外しています。通常の Markdown 本文や画像・音声・モデル等は除外です。各詳細の行番号、`reference/source-manifest.json` の blob SHA、README の調査範囲を照合してください。実行時の導入・認証・接続成功の保証とは別です。

## 設定モデルの手動試行

設定モデルは実装済みで、Tools 接続中に専用タブを表示する。現在の CHAT / LIVE / PREDICTION / DECISION / CODE1〜6 / TASK・TEAM 各3フェーズの16行を、利用者の明示操作で確認する。設定ファイルは読み取りだけで、起動・headless・全診断から生成試行を自動実行しない。外部送信や課金があり得ることを説明する。

Chat / Code は既存 MCP、Live / Prediction は非公開の固定 loopback アダプターを使う。未導入CLIは未実施とし、導入済みCLIの認証失敗を未導入と混同しない。同一設定の共有、音声の保存・取消、実SDK契約試験の詳細は `backend_diag/README.md` の「設定モデル（手動のみ）」と `backend_diag/モデル試行/`、`backend_diag/ui/src/components/設定モデル/` を同期元にする。

## Tools管理

通常タブの「Tools」は「システム起動」の直前に置きます。Core / Toolsの起動と、既存のCore利用者による明示ログインが必要です。Configと同じログインAPIを使い、Coreトークンはこのパネルのメモリだけに保持します。未認証ではTool一覧・既定値を表示せず、切断・認証期限切れ・画面破棄で消去します。Diagの起動キーとCoreの認証は混同しません。

- 管理APIは `POST api/Tools/enabled` と `POST api/Tools/defaults` の2つ。いずれも `{token, data}` を送ります。`data: {}` は実行時設定の読取だけです。オン・オフの切替と「適用のみ」は `write: false`、明示的な「保存」だけ `write: true` にします。`data.saved: true` を確認してから保存完了と表示します。
- 左に登録済みToolのオン・オフ、代表テスト、状態を表示します。OFFでも登録は残り「サービス外」です。`available: false` の操作は無効にし、依存機能が無い状態をONと誤認させません。保存は変更したIDだけを送り、対象外Toolを勝手に有効化しません。
- AIモデルと同じ見出し・テストボタン・状態バッジを使い、右に選択Toolの既定値・テスト条件・結果を表示します。結果は未実施でも応答欄を表示し、未対応／OFF／利用不可でも理由と右ペインを残します。変更候補はサーバーの `schema` を使用し、秘密情報や任意設定項目を編集対象にしません。オン・オフの保存と既定値の保存は別操作として成功・失敗を表示します。
- 代表テストは登録済み20 Toolに用意する（Windows ControlはWindowsのみ）。Chromeは専用セッション `diag-tools-test` の起動・終了、Desktopはモニター情報、SQLite/PostgreSQLは読取専用の `SELECT 1`、Logsは一覧、Code Checkは `backend_tools/tools_main.py` の構文、Backupは実際のバックアップ作成、OBSはシーン一覧、FFmpegは0.1秒の無音を処理して破棄、通知音はlegacy完了音、Teamは要員一覧、Windows Controlはウィンドウ一覧を確認する。既存APIを固定条件で呼び、件数・成否だけ表示する。通知音の実際の聞こえ方は利用者が確認する。
- 画像・動画生成、STT/TTS、Code Agents、Chat、Decisions、Taskの8 Toolは説明APIの疎通確認だけを行う。「生成・認識・AI実行の動作は未試験」と表示し、生成APIへの課金、録音、コード変更、タスク登録を行わない。画面のOKは表示した試験内容の成功であり、全機能の保証ではない。
- 固定中継 `api/Tools/representative` は毎回Core認証と対象Toolの有効・利用可能状態を確認する。Chromeは `{operation: open|close, headless: boolean}`、Backupは `{operation: test, tool: aidiy_backup, batch: boolean}`、他は `{operation: test, tool: 登録済みID}` だけを受け付け、任意URL・SQL・パス・コマンドは拒否する。試験の所有元は `Tools/代表試験.mjs`、画面説明は `ui/src/components/Tools/Tools代表テスト.mjs`。説明APIのGETも固定loopbackへ中継し、応答本文や秘密値を画面へ返さない。ChromeのheadlessはChromeだけに表示し、条件変更時は専用セッションを終了して再試験する。
- Backupは既存の `POST /aidiy_backup/save/run` を呼びます。画面のbatch条件は初期ON（backendの既定は従来どおりfalse）。ONのOKは「受付・予定件数」でコピー完了ではなく、OFFはコピー完了後の応答です。batchの返却値が要求と違う・欠落した応答は成功にしません。完了・失敗はToolsログで確認し、それまでは元ファイルの変更・削除やサーバー停止を避けます。待機中止・画面切断・期限切れでも受付済みコピーは止まりません。再試行前にログを確認してください。
- Backup実行の応答待ちは最大5分（Core認証・有効状態確認は各30秒のまま）。Diag側の外側通信待機もこの経路だけ370秒へ連動し、終了後は元へ戻します。時間を長くしても失敗しない保証にはなりません。
- Diagの既存HTTP入力・応答中継のサイズ上限は20MiB（20×1024×1024 bytes）へ統一します。Tools管理・代表試験、AI設定、起動操作、モデル試行・公開モデル取得、状態取得を対象とし、超過・不正JSON・中止は従来どおり拒否します。URL・認証ヘッダー・個別項目の長さ、ローカル設定ファイル、音声保存の業務上限は別物として維持します。件数・成否だけを画面へ返す代表試験は大きい元応答やパスをそのまま表示しません。
- 回帰確認は `node --test backend_diag/checks/tools-representative.check.mjs backend_diag/checks/tools-backup-run.check.mjs backend_diag/checks/tools-settings-api.check.mjs backend_diag/checks/tools-panel.check.cjs backend_diag/checks/tools-layout.check.cjs`。合成応答で全項目・失敗・無効・認証・中止・二重実行を確認する。実サービスの接続可否はTools画面の個別テストで別途確認する。
- Tools見出し右上の「一括テスト」は、開始時に有効・利用可能なToolと条件を固定し、一覧順に逐次実行します。OFF・利用不可・未対応は対象外、個別失敗は記録して次へ進み、最後に成功・失敗・対象外件数を表示します。通知音・Chrome専用セッションの起動・実際のバックアップ作成も含み、実行前の説明に明記します。中止・タブ移動・切断・ログアウト・認証期限切れでは後続を実行せず、遅い応答を破棄します。Chromeの終了は既存の「専用ブラウザを終了」で行います。
- 全体の全診断・初期表示から代表機能を自動実行しません。同時操作／二重押しを抑止し、タブを離れた場合はテスト応答の待機を中止します。開始済みの実操作が取り消せるとは表示しません。
- 画面の残り高さは `.tools-scroll` が `flex:1 1 auto!important; min-height:0` で受け、認証後の一覧・詳細は各ペイン内だけでスクロールします。共通の `#app>.panel>*{flex:none}` に戻さないでください。701px以上は左右2列、700px以下は一覧40%・内容を残り高さへ割り当て、長い一覧の下に詳細が隠れないようにします。Tool変更時は右だけを先頭へ戻し、一覧のスクロール位置は維持します。ログイン画面も内部スクロールで低い画面に対応します。
- `node --test backend_diag/checks/tools-layout.check.cjs backend_diag/checks/tools-panel.check.cjs backend_diag/checks/tools-settings-api.check.mjs backend_diag/checks/compact-tabs.check.cjs` はモックで検証し、実Chromeや有料APIは呼びません。UI変更後は既存手順で配布build・manifest照合を実施します。

タブは文字サイズを維持して上下・左右の余白と間隔を詰め、800px以下では折返しを維持します。行を非表示にしたり横切れでアクセスできなくしたりしないでください。

## 状態インジケーター

一覧・詳細・集計・絞り込み・凡例は同じ 5 種類で表示します。
- 未確認（黒）: 未実施。OS 対象外の場合も未確認とし、詳細に対象外の理由を表示します。
- 未検出（黄）: 登録した探索先に見つかりません。
- OK（緑）: 存在確認、または固定バージョンコマンドの正常終了。存在のみ・版未取得の場合は詳細で区別します。認証や実機能の動作保証ではありません。
- NG（赤）: バージョンコマンドの非ゼロ終了、または確認した最低バージョン要件の不足。検出対象とは別の仮想環境まで否定しません。
- ERR（赤）: 起動・探索例外、タイムアウト、出力上限等により確認できません。

確認中は進行メッセージを表示し、別の判定状態にはしません。色に加えて必ず状態名も表示します。

## モデル合成が空のときの確認

- 合成 JSON はモデル0件のプロバイダを除外します。chat の local 固定候補は残り、Ollama は取得モデルがある場合だけ残ります。
- OpenRouter の匿名公開一覧は補完用です。選択候補にするには設定キーの `/api/v1/key` 確認が必要です。保存済みの認証確認だけでは合成せず、今回の認証成功結果が必要です（設定再読込後は再テスト）。キー削除・今回の確認失敗後も古い候補を引き継ぎません。
- chat が空、または候補が `local_chat` のみなら、`AiDiy_key.json` の `CHAT_AI_NAME` と対応する `CHAT_*_MODEL` を「仮設定（未検証）」として補完します。config 候補は local より前に保存し、既存 local の候補と順序を保持します。同一候補は重複させません。local 以外が1件でもあれば補完せず、設定未作成・空値・未対応プロバイダなら現状を保持します。認証成功や取得成功としては扱いません。
- live 全体が空なら `AiDiy_key.json` の `LIVE_AI_NAME` と対応する `LIVE_*_MODEL` を「仮設定（未検証）」として補完します。設定未作成・空値・未対応プロバイダなら空のままです。既存候補が1件でもあれば補完しません。code 全体が空なら従来どおり `aidiy_hermes / auto` を補います。config 自体は変更しません。
- `live_voices_info.json` は取得・認証状態にかかわらず `freeai_live`、`gemini_live`、`openai_live` の3区分を常に保存します。既存の音声定義と順序を使用し、FreeAI/Gemini は各30件、OpenAI は13件です。
- 仮モデルや音声候補の表示は、認証成功・モデル取得成功・利用可否の保証ではありません。
- OpenAI OAuth の一覧取得失敗・空一覧は、Copilot 既定の OpenAI 系4モデル（`gpt-6-astra`、`gpt-6.1-sol`、`gpt-6.1-terra`、`gpt-6-luna`）を未検証候補として補い、診断状態を PASS とします。Chat の `openai_oauth` と Hermes の `openai_oauth/` 経路に使用し、成功時は取得結果を優先します。未設定は未実施のままで4候補を補わず、明示的なログアウト後は保存済みOAuth候補を合成しません。通信失敗とHTTP認証失敗はモデル取得処理ではともに NG ですが、4候補の補完後は既存の PASS を使います。失敗理由・未検証の警告は保持し、認証確認や実モデル応答を成功にはしません。
- 回帰確認は `node --test backend_diag/checks/*.check.mjs backend_diag/checks/*.check.cjs`。実キーを使わず、未設定・無効・有効キー、旧保存結果、全区分の空プロバイダ除外、固定仮補完を合成データと設定ファイル未作成の実 headless 起動で検証します。runtime 変更後は README の配布物再生成と一致確認も行います。

## 判断用モデル一覧

`モデル情報/decisions_info.mjs` が `_AIDIY/aidiy_diag/decisions_models_info.json` を生成する。既存の `*_models_info.json` 命名を使用し、`desisions_model_info.json` は作成しない。スキーマは `{openai_oauth: {models: {モデルID: 表示名}}, openai_decisions: ..., freeai_chat: ..., gemini_chat: ...}`。表示名は `YYYY/MM/DD - ID`、取得日が不明なら `yyyy/mm/dd - ID`。認証付き一覧を取得できた方式だけを含める。

- 既存のキー確認と同じGET・ページング・proxy/TLS・制限時間・キャンセルを使い、追加の生成API試行は行わない。判断用の元一覧は公開補完前に分離する。OpenAIは既存の240日・廃止モデル除外、OAuthはAPIが返した表示対象IDのみ、GoogleはgenerateContent対応モデルから候補を作る。明らかな音声・画像・Live・埋込などの専用モデルを除く。JSON/Decisions対応の保証ではなく、実行可否はToolsの既存起動チェックで確認する。
- 公開OpenRouter一覧・同梱キャッシュ・OAuthの固定候補・将来版や900kの合成候補・設定モデルからの補完は行わない。認証の証跡は実行中のメモリだけに保持し、キー値や指紋をJSONへ保存しない。
- 書込時に現在のキー（OpenAIは組織も）またはOAuthトークン・アカウントが取得時と一致することを確認する。キー変更・削除、一覧取得失敗、旧JSONだけが残っている状態は候補にしない。個別確認後は同じaidiy_diag実行内で保持する他方式の有効な取得結果を使うが、再起動や設定再読込後は再確認が必要。
- FreeAI/Geminiは判断実行と同じ優先キーを使い、優先キー未設定時だけ他方の認証付き取得結果を代用する。キーが設定済みで認証に失敗した場合は代用しない。
- 空の方式は省略し、全方式が空なら `{}` を保存する。設定・autoの選択順・方式別既定値は書き換えない。生成確認済みの利用可能モデルとこの候補一覧を混同しない。
- headlessと画面のモデル書込は共通処理で生成し、保存先一覧にもファイル名を含める。Pythonの読込口は `conf_models.get_decisions_models()`。Web/Avatar設定画面もこの一覧を利用し、取得済み候補と設定保持値を区別して表示する。
- モック検証: `node --test backend_diag/checks/decisions-info.check.mjs`。4方式、認証変更、公開/固定/旧保存候補の排除、キー代用、失敗・空一覧、共通書込とheadlessの保存先を確認する。

### 判断系4方式の候補管理

autoの優先順は `openai_oauth` → `freeai_chat` → `openai_decisions` → `gemini_chat`。起動チェックに成功した方式だけを優先対象にする。

判断系の低コスト方針は `backend_diag/モデル情報/decisions_info.mjs` の `DECISION_MODEL_CANDIDATES` で書き出す候補を絞って管理する。現在はOpenAI両方式が `gpt-6-luna`、FreeAI/Geminiが `gemini-3.5-flash-lite`。将来別モデルへ変更するときはこの候補配列を調整し、認証付き一覧を再取得・書き出しする。実行側や画面にモデル固定・恒久的な選択禁止は置かない。

モデルIDの同期元は `backend_diag/モデル情報/decisions_info.mjs` の定数と `backend_server/AIコア/AI判断共通.py`。認証付き一覧で実在を確認し、番号やaliasの解決先を推測して候補を生成しない。

aidiy_diagは認証付きGET一覧に候補配列のIDそのものがある方式だけを掲載する。GoogleはgenerateContent対応を要求する。公開一覧・設定値・別バージョンから候補を捏造しない。未取得・認証なし・失敗・対象ID不在なら方式を省略し、全方式が空なら `{}`。モデル一覧は実行の許可リストではなく、設定画面の候補として扱う。

## OpenCode / Copilot のCode候補

`code_models_info.json` の `opencode_cli.models` はCodex用に合成した候補を共通元とし、OpenCode側のIDと表示名のモデル部分に `openai/` を付ける（例: `openai/gpt-6.1-sol`）。日付・順序は保持し、既存の接頭辞は二重に付けない。Codex候補が0件ならCopilotと同じ `COPILOT_FALLBACK_MODELS` の規定8モデルに同じ `openai/` を付けて補完する。Copilot側の取得候補・規定値は変更しない。OpenCodeの出力条件は自身の導入検出だけで、Codex / Copilotの導入には依存しない。補完はモデル候補の書き出しだけで、認証・実行成功を意味しない。検証は `checks/models-info.check.mjs` で行う。

## 予測モデルの手動試行

設定モデル・AIモデルともLive直後にPredictionを置きます。同一provider・実行modelのChat成功をサーバー側で確認し、auto解決後に一致したときだけ `/internal/prediction_llms` へ進みます。OAuth／APIキー、FreeAI／Geminiを混同しません。設定・モデル候補・OAuth認証の変更、再取得・再読込・手動入力変更、Chat再試行で過去の成功を破棄します。

Chatの `aidiy_chat_llms/chat_llms_run`、Code系の `aidiy_code_agents/code_agents_run`、Predictionに同じCODE_BASE_PATHの絶対 `project_path` を渡します。相対パスはbackend_server基準、未設定は実行不可です。通常のMCP側で実際の入力と成功応答をA会話履歴へ保存し、Diagは `history_saved: true` まで確認して成功とします。Chat成功後の1往復は、Predictionが同一プロジェクトの直近2時間・最新最大10ターンを読む通常経路で参照できます。Predictionの試行は、Chat試行でOKになったモデル（予測モデルと同じでなくてよい）で「昔々、あるところに」「おじいさんと」の2ターンをChatとして送り、両方の履歴保存を確認してから予測する。非空の応答はOK、「おばあさん」を含めば `予測評価: 完璧`。1行の期限は通常の2倍。保存失敗・未確認ではPredictionを解禁せず、診断用交換・合成履歴・専用APIで代替しません。

正常な非空応答は `!`／`！` で始まる説明も合格とし、NG・空応答・通信失敗・タイムアウトは合格にしません。予測結果を履歴に保存せず、ブラウザから履歴本文や成功判定を受け付けません。詳しい確認条件・経路・mock検証方針は [READMEのPrediction手動試行](../../backend_diag/README.md#predictionの手動試行) を参照します。

## 判断モデルの手動試行

設定モデル動作確認のPREDICTION直後に `DECISION / 挨拶の丁寧さ` を表示する。個別「テスト」と全体「動作確認」の両方で、既存MCP `/aidiy_decisions_check/mcp` の `decisions_check` を呼ぶ。HTTP `/check` への代替直結は行わない。Tools接続中の明示操作に限定し、headless・起動・全診断では実行しない。

`DECISION_AI_NAME` と方式別 `DECISION_OPENAI_MODEL` / `DECISION_OAUTH_MODEL` / `DECISION_GEMINI_MODEL` / `DECISION_FREEAI_MODEL` が不足時はauto。方式が明示されている試行行は対応する方式別値を使う。方式autoの行はモデルもautoで送り、Toolsで方式とモデルを解決する。autoの方式順はOAuth → FreeAI → Decisions API → Gemini。結果には実効モデルを表示し、設定ファイルへは書き戻さない。

入力は「おはよう」、質問は挨拶としての丁寧さ、choice名は `politeness`、選択肢は `high / medium / low`。3値すべてを正常な選択として受け付け、特定値を正解とはしない。MCPのJSON内のstatus、回答名・型・選択値、3候補の確率分布・合計、confidenceを検証する。不正JSON・欠落・未知選択肢・通信エラーはNG。結果詳細に選択値と検証済みJSON、実際の実行モデルを表示する。

Chat/Live/Codeと判断結果は共有しない。MCPの初期化・セッション破棄、設定変更による結果破棄、既存のタイムアウトを共用する。判断の行期限を超えた場合はNGと理由を表示し、その全体実行を終了する。ユーザーによる中止は従来の中止表示を維持する。

検証は `checks/decision-trials.check.mjs`、既存モデル試行/API/音声/UIテスト、`DIAG_TEST_PYTHON` を指定する実MCP SDK fixtureで行う。fixtureの生成APIはMockTransportへ置換し、外部の生成サービスを使わない。Web/Avatarの設定画面とaidiy_diag試行UIは同じ候補と通常のモデル解決を使う。


## AIモデルの手動試行

Gemini系Live（`freeai_live` 経由を含む）は接続直後の初回送信で失敗する場合があります。診断では接続確立後に15秒待って初回送信し、送信後の応答・音声ターン完了を最大60秒待つ設定です。この条件で実回答を確認したLive試験は通過とし、初回失敗は注意事項・経過の証跡として残します。

「AIモデル」はChat / Live / Prediction / Decision / Codeの5画面です。初期値はconfigのCHAT・LIVE・PREDICTION・DECISION各設定とCODE1を使います。Decisionの方式autoはモデルもautoとしてTools側で解決します。入力の「おはよう」とDecisionのpoliteness / high・medium・lowは `モデル試行/defaults.mjs` を既存設定モデル試行と共用し、手動画面では自由に編集できます。

候補は `_AIDIY/aidiy_diag/{chat,live,prediction,decisions,code}_models_info.json` と `live_voices_info.json` の保存済み内容を使います。Codeのモデル候補には、Web / Avatarの「AI設定・再起動」と同じ実行方法 `auto (自動判定)`、`same (変更なし)` をこの順で先頭に補い、重複を除きます。これらはモデル一覧JSONへ書き戻しません。画面初期読込・再読込は認証付きローカルaidiy_diag APIを使い、外部モデル取得は行いません。プロバイダ変更は画面内で候補を連動し、一覧外の設定保持値を未確認として残します。 Code初回表示はCODE1の設定を使い、プロバイダ切替時は `CODE_<プロバイダ大文字>_MODEL`（例: `CODE_GROK_CLI_MODEL`）を優先します。そのキーがない場合だけCODE1〜6の同プロバイダ設定、次に候補の先頭へ戻します。画面内で手動選択した値は再読込まで優先して保持します。候補の存在は認証・モデル利用成功の保証ではありません。選択や入力をconfigへ書き戻しません。

試行はTools接続中の明示操作だけです。既存 `モデル試行/trials.mjs` のMCP初期化・呼出し・セッション終了、逐次実行ロック、設定変更検知、期限、音声保存を共用します。Chatは `chat_llms_run`、Codeは `code_agents_run`、Decisionは `decisions_check` をHTTP MCPで呼び、Liveは既存 `/internal/live_model_check` へ明示した方式・モデル・音声・入力を渡します。設定モデル・AIモデルのLiveは、試行ごとに新規セッションを作り、接続確立後の初回送信前に15秒自動待機してから送信します。同じセッションの毎送信に課す待機ではなく、利用者の追加待機も不要です。長い返答の生成・音声ターン完了に余裕を持たせ、送信後の応答待ちは最大60秒です。接続準備20秒・初回待機15秒・終了処理9秒と通信余裕を含め、内部HTTPは135秒、1試行は150秒、全実行は45分を上限とします。アダプター終了処理も共通です。空JSONの従来Live試行は従来のconfigと固定挨拶を使います。

AIモデルタブのタイトルバー「一括試行」は5画面の入力を開始時に固定し、Chat→Live→Prediction→Decision→Codeを1実行として順に呼びます。NG・行タイムアウトでも次へ進みます。連打は抑止し、入力変更・実行中の画面移動・Tools切断で中止して古い結果を破棄します。全診断・headless・起動ではAI試行しません。設定モデルの16項目試行とAIモデルの5種試行は別の操作です。

Decisionは1問ずつpredicate / choice / scoreを選び、質問名・質問文と、必要な選択肢／段階（2〜32件、重複不可）を編集します。戻り値全体はJSONを読めればインデント付き、読めなければ元文字列を安全なテキストとして表示します。表示できることと回答スキーマの成功判定は別です。既知の秘密値は伏せます。

Liveの応答テキストと1秒以上のWAVを表示し、受信時に認証付き音声APIからBlobを自動取得してネイティブプレーヤーで再生できる状態にします。自動再生しません。AIモデル・設定モデルとも、完了後のタブ移動では再生だけを停止し、結果と取得済み音声を保持します。再実行・設定再読込・切断・終了ではObject URLを解放します。通常は音声再読込の操作を求めず、取得・再生失敗時だけ「音声取得を再試行」を表示します。短い音声・音声なしは明示します。

検証は実AIを使わず、`checks/manual-models.check.mjs`、`ui/src/components/AIモデル/checks/manual-state.check.mjs` を使います。`DIAG_TEST_PYTHON` をTools依存環境のPythonへ設定すると `checks/model-trials-sdk.check.mjs` が実MCP SDKと合成AIで経路を確認します。`checks/manual-models-browser.mjs` は既存Chrome/Edgeの隔離プロファイルで4画面・幅1280/720/390・合成音声再生・破棄・一括試行・非JSON表示を確認します。UI変更後は依頼に応じて `backend_diag/ui` のビルドと `node backend_diag/ui/verify.mjs` で配布物を同期します。

## アプリ起動

- ミニ表示は `ui/src/components/アプリ起動/ミニアプリ起動.vue` を使い、Appの同じアプリ状態（選択フォルダ・処理中・結果）を共有する。aidiy_diag起動・再読込時は毎回フォルダ未選択で始める。稼働数の集計行を置かず、「□」の復帰操作はタイトルバーから同じミニ解除イベントを呼ぶ。ミニの6起動ボタンはアイコンのみ、名称はtitleとaria-labelへ残す。サービス状態は3列2行の短い名称と色で表示し、詳細はtitleで確認する。稼働中はミニの項目全体（`起動ミニ.css` の `mini-blink`）と通常画面のタブ下線（`起動.css` の `start-bar-blink`）を緑で非線形に明滅させる。表示灯の丸印は置かない。周期（約4.5秒、項目ごとに4.32〜4.68秒）と開始位置は `ui/src/components/起動/明滅.mjs` が項目ごとにずらし、表示のたびに乱数の揺らぎを加える。明るさはタイトルバーのシアン帯と同じ |sin(πt)| を2.5%刻みで直線補間する。ミニはポート確認が未確認のとき直前の表示を保つ。プロジェクト未選択時は赤字の英語案内「SELECT YOUR PROJECT ▸▸ READY FOR LAUNCH」を電光掲示板風に右端から左端へ流し（`mini-marquee`、黒い格子線を `::after` で重ねたドット文字、titleは「プロジェクト選択してね」）、無効な6起動ボタンを表示する。通常画面のプロジェクト欄も未選択時は赤い枠で選択を促す（`アプリ起動.css` の `app-project-alert`）。アプリ一覧の読込だけを表示時に行い、タスク確認・起動は押下時だけ。ミニと通常で起動経路を複製しない。
- アイコンは Avatar の `frontend_avatar/public/icons/`、IDE / Console / Code / Live の `frontend_ide/public/`、Discord の `frontend_channels/panel/` から `ui/src/components/アプリ起動/アイコン/` へコピーしたPNG。ビルドでstaticへ同梱し、認証情報を含まない固定6ファイルだけをHTTP公開する。ソースと配布PNGをmanifestで照合し、起動時に他アプリのフォルダを配信しない。アイコン更新後はUIビルドと一致確認を行う。`app-launch-browser.mjs` が6画像の読込、ミニ幅330px・内容高の収まり、赤字・不活性、選択フォルダの共有、ミニからの起動・排他を確認する。
- 画面は `ui/src/components/アプリ起動/`、固定起動対象・タスク確認・プロセス生成は `起動/アプリ起動.mjs`、認証付き API は `/api/アプリ起動` と `/api/アプリ起動/{開始,フォルダ}`。システム起動の管理・停止・終了確認に参加させない。
- 起動には存在する絶対パスのフォルダが必要。Avatar にも選択を必須とするが、Avatar 自体の作業パスは AiDiy 本体にする。他の5種類は選択したパスを `cwd` と `--project` の単一引数に渡す。シェル文字列や任意コマンド・引数は受け付けない。共有設定の `CODE_BASE_PATH` を書き換えない。
- Electron の `selectProject` は主ウィンドウの主フレームだけが呼べる固定フォルダダイアログ。Web はサーバー側フォルダだけを列挙する。選択は画面内だけで保持し、再読込時は未選択とする。
- Avatar / Live / Discord だけ、押下後に PowerShell CIM（Windows）または ps（macOS / Linux）でタスクを1回取得し、既知の実行入口と照合する。タスク内容は画面へ返さない。確認失敗時は起動しない。起動直前の同時クリックを排除し、各アプリ既存の排他も残す。起動後のタイマー・状態監視・PID保存による後日停止を追加しない。
- 起動は `detached: true` / 標準入力 EOF / ログファイル出力 / `unref()`。aidiy_diag と IPC で所有関係を結ばない。ログは `temp/aidiy_diag/アプリ起動/` に起動ごとに分ける。画面の通知は「起動要求」とし、表示成功として扱わない。
- IDE / Code は既存 `frontend_ide/launch.mjs --new-window` から一時プロファイルで別窓を開く。通常起動の既存窓再利用や Live の排他は変えない。Console は従来から複数起動を許可する。一時プロファイルはアプリ終了時に回収する。
- 検証は `checks/app-launch.check.mjs`（実フォルダ・パス・タスク判定・認証・入力制限・aidiy_diag終了後の無害な子プロセス継続）、`checks/desktop.check.mjs`（フォルダ選択の限定IPC）、`frontend_ide/checks/project-instance.test.mjs`（通常起動と複数窓）。`checks/app-launch-browser.mjs` は合成プロセスで390/1280pxの実画面、フォルダ必須、押下時だけの確認、起動先、定時監視がないことを確認する。


## 総合テストの補足確認

`checks/initial-mini-probe.cjs` は、本体が `appData/aidiy_diag` をuserDataに使う前に、検証用の `appData` 自体も隔離します。userDataだけを先に指定すると本体に上書きされ、実行中のDiagの単一起動ロックへ接続してしまいます。`checks/initial-mini-desktop.mjs` で実画面の位置・最前面・通常復帰、長押し成立時間、750msズームのアニメーション時間と透明領域の寸法維持を確認できます。

`checks/start-browser.mjs` は合成サービスを使い、ミニ表示の約5秒周期・ログの最下部追従・コピーで停止しないこと・停止ボタン・小画面を検証します。実際のログコピーはComputer Useで文字を選択してCtrl+Cを送り、OSのクリップボードを選択行と照合します。通常停止が5秒以内に完了しない場合は既定のプロセス回収へ進むため、停止信号の送信・ポート閉鎖・他機能の継続・明示停止後の自動再起動抑止を分けて記録します。

設定モデルの結果説明は、正常応答で説明文が空でも「応答を確認しました。」と表示します。バッジがOKなのに詳細を未実施と表示しないことを `checks/model-trials-browser.mjs` で確認します。

AIチャット・AIコードの最終応答が空文字・空白だけ、または前後の空白を除いて`!`で始まる場合はNGです。`!`単独は無応答、`! エラーメッセージ`は理由付きエラーです。MCP側の`status`が誤ってOKでも、本文がこの形式なら成功扱いにしません。旧版の「応答なし」や既知のエラー文の判定も互換性のため残します。共通規約は[AIコアWebSocket仕様](./backend_server,frontend_avatar,frontend_web,AIコアWebSocket仕様.md#aiチャットaiコードのエラー応答)を参照します。

完了した冊子のPDFは `node scripts/checks/総合テストPDF.mjs <md名>` で作成できます。元のMarkdownと同じフォルダへ同名で保存し、本文の修正後は再生成します。本文の折りたたみ欄も開いて出力し、説明と画像を同じ図として配置します。生成後はPoppler等で全ページを画像化し、日本語・表・画像・改ページを確認してください。

## 個別確認と導入管理

導入状況・モデル一覧・外部連携の各行は、別項目なら並行して確認できます。モデル一覧・外部連携のキー確認は公開モデル取得・設定読込と共通の FIFO キューを使い、同時実行は2件までです。3件目以降は「待機中…」、実行枠を得た行は「確認中…」と表示し、同じ行の二重実行を防ぎます。既定25秒のタイムアウトは待機時間を含めず実行開始から計測し、成功・失敗・タイムアウトのいずれでも次の待機項目へ進みます。画面の切断・設定破棄では通信を中止し、未開始の項目は実行・保存しません。 モデル一覧の一括取得と外部連携の一括確認は共通の画面側キューでも送信を2件までに絞り、未送信分を「待機中…」にして進捗取得用の接続枠を残します。個別操作はサーバーの共有キューへ送り、複数画面からでもサーバー全体の同時実行上限2件を守ります。一括確認・結果書込・設定状況の再読込は個別確認の完了を待ちます。導入・再導入・削除は確認対象の実行ファイルを変更するため、導入状況の確認とは同時実行しません。導入管理情報の再読込は個別確認ボタンの解除を待たせません。これら3タブは同じ薄い水色で表示します。

回帰確認は `node --test backend_diag/checks/{individual-parallel,model-queue,key-queue-ui}.check.*`。実際の `testKey` と runner を通す制御済み fixture で FIFO・2件上限・待機時間の除外・中止・重複・外部連携の保存を確認します。異なる項目の同時実行、同じ項目の重複拒否、完了順の逆転、一方の失敗、切断後の古い応答破棄を確認します。

モデル一覧の 「一括取得」 後の「書込」は、従来の合成JSONに加えて `_AIDIY/aidiy_diag/prediction_models_info.json` も生成する。headless / 全テストも同じ生成処理を使う。Predictionは `decisions_models_info.json` と生成関数を共用し、同じ低コスト候補・現在の認証条件を適用した後、`openai_decisions` 区分を `openai_chat` へ置き換える。予測JSONの方式は `openai_oauth` / `freeai_chat` / `openai_chat` / `gemini_chat` と、合成済み `code_models_info.json` から `auto` / `same` を除いて載せる `codex_cli` / `copilot_cli` / `aidiy_hermes` で、`openai_decisions` は含めない。CLI方式の試行も、Chat試行でOKになったモデルで2ターンを送ってから予測する。認証済み一覧にない方式は出力せず、全て空なら `{}`。候補を書き出すだけで `PREDICTION_AI_NAME` と方式別 `PREDICTION_*_MODEL` の設定値を変更せず、予測も実行しない。内部REST `POST /internal/prediction_llms`（`aidiy_prediction_llms`、MCP非公開）は方式がautoの場合、候補がある `codex_cli` → `copilot_cli` → `aidiy_hermes` → `openai_oauth` → `freeai_chat` → `openai_chat` → `gemini_chat` から選ぶ。判断側の挙動は変更しない。内容・候補管理は [READMEの予測用モデル一覧](../../backend_diag/README.md#予測用モデル一覧) を参照する。

- 各行の「確認」は認証付き `POST api/診断/<登録済みID>` を使用し、その項目だけ既存 probe で再確認する。全項目確認と書込は同じ実行排他を使う。今回確認していない前回保存済み結果は表示だけに使い、書込対象へ混ぜない。
- 導入管理は `GET api/導入管理` で能力と実行状態を取得し、`POST api/導入管理/<登録済みID>/<導入・再導入・削除>` で開始、`DELETE api/導入管理/<実行ID>` で中止する。入力本文・クエリ・任意コマンドは不可。操作後は個別確認と共通の probe と結果反映を各対象に1回呼ぶ。FFmpeg は3行を確認し、`結果一覧` と対象行の `結果` を返す。
- 対象は従来の npm4パッケージに加え、Windows の FFmpeg 一式・uv・Ollama（新規導入のみ）・OBS・VS Code Stable・Antigravity。複数製品を `start` する BAT、`__pip_uninstall.bat`、広いフォルダ削除・PATH 編集は流用しない。Grok / Chrome / Python / Node.js / npm / Electron の操作は追加しない。
- WinGet は固定 ID・公式 source・実行ファイル・登録先・アンインストーラーを照合する。list の表示だけでは所有元としない。portable は WinGet 所有登録、native の OBS / Code は Diag の導入記録と実体ハッシュが一致する場合だけ破壊的操作を許す。scope 重複・別 PATH の優先・manual / 他方式・リンク・不明な process 状態では操作しない。Ollama は既定モデルの保持を保証できないため再導入・削除を許さない。
- WinGet の標準インストーラーによる PATH 登録・UAC の可能性を操作確認へ表示する。`--accept-*`、強制・purge・権限回避を付けない。OBS の設定・シーン・録画は保持するが、本体内の追加プラグインは再導入が必要な場合がある。アプリや関連プロセスが動いている間は変更せず、利用者が終了して再確認する。
- Antigravity は固定公式 installer のレビュー済み SHA256 を照合し、`--skip-path --skip-aliases` 付きで実行する。既存ありの no-op を避けるため所有確認した `agy.exe` だけを退避し、公式 manifest の SHA512 と実体を確認後に確定する。固定の OS CMD でレビュー済み installer だけを実行し、Windows 引用符は `windowsVerbatimArguments` で保持する。パスの展開・制御文字は事前に拒否する。失敗・中止時は旧バイナリを戻し、復旧ファイルが残れば次の操作を止めて手動確認を求める。共有 staging、`.gemini/antigravity-cli`、OS 資格情報、未知のファイルは削除しない。インストーラー更新時は [公式 CMD](https://antigravity.google/cli/install.cmd) と [オプション](https://www.antigravity.google/docs/cli/install/) を再レビューしてから digest を更新する。
- npm の標準 prefix / root と実体を確認し、パッケージ外のリンク、別方式のランチャー、不正 manifest では操作しない。操作直前にも所有元を再確認する。再導入は同じ固定パッケージへ `npm install --global` を1回だけ実行して更新し、事前に削除しない。「削除」だけが `npm uninstall --global` を実行する。確認ダイアログはサーバーの `再導入説明` を表示し、npm で削除後に導入すると案内しない。利用者の認証・設定・履歴は削除しない。
- コマンドは固定 argv・shell 無効・空の一時 npmrc・公式 registry で実行する。終了・失敗・中止時は一時領域を回収して再確認するが、停止未確認中は排他を保持する。同じ OS 利用者の Diag 間では WinGet は全体、npm / Antigravity は同じ導入先で排他する。一時ロックは利用者別なので、別 OS 利用者間の競合は WinGet 自身の制御に従う。ロックが異常終了で残った場合、自動削除しない。OS 上で対象 npm 処理の停止と所有権を確認してから運用者が復旧する。
- 検証は `node --test backend_diag/checks/install-*.check.mjs` と `node --test backend_diag/ui/src/components/導入状況/checks/*.check.cjs`。合成プロセス・一時 fixture・Vue イベントで確認し、実際のグローバル導入・削除・認証を行わない。Windows の shim と POSIX の実体は別ケースで検証する。
- UI 変更時は配布画面へ反映するため `npm --prefix backend_diag/ui run build`、`npm --prefix backend_diag/ui run check` を実行する。実ブラウザ確認は別途許可された環境だけで行い、ソース・mock 成功と実OS画面検証を区別する。


## ミニCLI起動を変更するとき

- 通常のアプリ起動パネルも同じ `CLI状態.mjs` と起動APIを使う。`全項目` は未導入を含む全7CLIを保持し、通常画面には6アプリ・Hermes・外部CLIの順で並べる。未導入は「未導入」と表示して無効化し、状態処理でも起動要求を送らない。ミニは従来の導入済みだけの `項目` を使う。通常画面のアイコンは72pxで名称は画像内の帯を使い、別の名前ラベルを重ねない。通常・ミニとも明示クリックでは起動確認ダイアログを出さず、固定の起動APIへ直接送る。起動受付・成功・起動済みの通知やログ保存先は表示せず、通常画面は処理中とエラーだけ表示する。ミニ画面は処理中・成功・失敗の一時メッセージを表示せず、起動中もプロジェクト表示を保ち、通知行の追加による高さ変更を起こさない。エラー内容は通常画面の同じ状態から確認する。
- `ui/src/components/アプリ起動/CLI状態.mjs` と `ミニCLI起動.vue` が確認・利用可能項目・名称帯を管理する。プロジェクトは既存アプリ状態を共有する。Hermes・外部CLIは起動中も追加起動でき、要求ごとの処理中状態を管理する。確認ダイアログ・他アプリの起動・フォルダ選択は重ねない。ミニ表示時と再接続時は存在確認だけで、CLI・ログイン・導入を実行しない。
- `起動/CLI起動.mjs` は固定ID・絶対プロジェクト・自動承認指定だけを受け付け、固定 `frontend_ide/launch.mjs --app console --cli <ID> --cli-auto-approve` へ渡す。ミニの明示クリックは確認ダイアログなしで従来の起動指定を送り、成功後の説明を表示しない。エラー・処理中の状態は通常画面で確認できるまま保持し、ミニには表示しない。同じCLI・プロジェクトでもクリックごとに別のConsole窓を開く。モデル・コマンド文字列を受け付けず、実行ファイルの探索と引数は `frontend_ide/aidiy_console/cli-launch.mjs` を共有する。公式フラグ・出典・古いCLIでの失敗時の扱いは backend_diag/README.md の「ミニ表示からCLIを開く」を参照する。
- 起動通知はIPCでConsole窓の準備完了を待つ。CLI自身の起動結果はConsoleに表示する。同じDiagで同じCLI・正規化済みプロジェクトでも並行起動し、既存窓へ戻らない。Consoleごとに動的ポート・端末セッション・起動ログを分ける。1つの窓の起動失敗・終了では他の窓のCLIやサーバーを止めない。ブラウザの最後の有効な端末接続が切れて30秒戻らない場合と、表示後30秒以内に初回端末接続が始まらない場合はその窓のCLIと所有サーバーだけを終了する。Diag終了とConsole終了は連動させない。Avatar・Live・Discordの単一起動制限は維持する。
- タイトル欄はdrag、ボタンはno-dragを維持する。ミニは幅330pxで高さは表示内容に追従する。外部CLIのSVG・PNG・出典・ライセンスは `ui/src/components/アプリ起動/CLIアイコン/` に保持する。AiDiy系は各所有moduleが正本を持ち、DiagはローカルPNGコピーだけを使う（[共通手順](./共通,アイコン原本と配布.md)）。CopilotはGitHub Octicons、Codex / Claude CodeはLobeHub、Grok / OpenCodeは公式配布元の実素材。Hermesは既存AiDiy画像、AgyはAntigravity公式サイトの山形マーク。画像はSVGで作ってPNG化し、生成スクリプトは常設しない。外部CLIのSVGとPNG派生物、HermesのPNG、出典・ライセンス全文 `LICENSE_ICONS.md` をstaticへ配布する。Hermesの正本は `command_hermes/assets/`、Diagでは保守時にコピーしたPNGだけを表示する。通常build/verifyでは他moduleのassetを読まない。AiDiy6アプリも画像内の名称を使い、HTMLの名前は重ねない。上段はAiDiy6アプリ＋Hermes、下段は存在する外部CLIだけを同じ幅で中央寄せする。外部CLI0件なら下段と余白を出さず、更新ボタンも置かない。全画像は名称帯込みの40px枠・40px表示（縦横比維持）、稼働インジケーター6件は1行。変更後はUIビルドとmanifest照合を行う。
- 回帰確認: `node --test backend_diag/checks/{cli-launch,cli-launch-state,mini-cli-ui,start-mini}.check.*` と frontend_ide のCLI/端末テスト（`cli-parallel-lifecycle.test.mjs`を含む）。全タブ復帰・ミニの確認なし起動と成功説明の非表示・連続／同時起動・個別終了・切断・起動失敗・日本語と記号付きパス・モデル引数なし・再接続での再実行なしをfixtureで確認する。実CLI自動作業や有料APIを回帰テストに使わない。


## アイコン化ランチャー

通常画面の左上は「ランチャー表示」「アイコン化」の2ボタンです。ランチャー表示の左上にも「アイコン化」があり、接続済み・プロジェクトフォルダ選択済み・表示切替中でない場合だけ選べます。

- 通常・ランチャー表示（ミニ）・アイコン化の全切替は、現在のフォームの左肩（左上座標）を引き継ぎます。フォームを移動した後も、その位置から右下へ拡大・縮小します。画面全体の左上や以前の通常位置には戻しません。最大化からミニ／アイコン化へ移った場合も、復帰時は現在位置で通常寸法へ戻します。中央画像40px、収納中は名称なし、展開中はDIAG入りです。画像自体に枠を付けず、明るい2pxの虹色二重四角を回転させます。回転線はぼかさず、背後のダーク背景と影だけを柔らかく広げます。
- 中央クリックで6アプリと利用可能なCLIを均等角度で順番に展開します。有効数をNとして半径は max(80, ceil(58 / (2 sin(π/N)))) px（Nが0〜1なら80px）。最小円周は約503px、隣接中心間隔58pxで40px正方形画像の重なりを避けます。6〜8個は半径80px、10個は94px、13個は122pxです。処理中の一時無効化では数を変えません。
- 収納窓は幅128px・最小高さ128px、展開窓は半径の2倍+76px（最小236px、13個320px）。表示とネイティブ窓は同じ円周配置の計算を使い、展開中の有効数変更にも追従します。画面端では作業領域の内側に展開し、上中央なら下へ広がります。収納後は元の位置へ戻し、展開中の移動量を引き継ぎます。
- 収納中はアイコンの下にプロジェクトのベースネームを幅120px・透明背景で表示します。日本語と空白なしの長い英字も折り返し、実測高さに合わせてネイティブ窓だけ縦へ伸縮します。短名へ戻すと最小高さへ戻り、幅とアイコンの基準位置は変えません。展開／収納アニメーション中は名前を隠し、展開窓は従来の円周寸法を使います。
- 表示画像40px、操作領域48px。全アイコンに中央と同じ56px四方のダーク背景・8pxのぼかし・影を敷き、外側へ自然に薄くします。CLIだけの硬い黒背景は付けません。丸い囲み枠、内側のサーバー表示、下部の追加マークはありません。
- アイコンは正立したままゆっくり回転し、外周アイコンへのマウスオーバー・キーボードフォーカスで停止します。中央付近にカーソルがあっても回転します。基本操作は中央クリックでの開閉です。60分間操作がなければ自動で収納します。
- 中央を普通にドラッグして移動できます（移動4pxでクリックと区別、長押し不要）。ダブルクリックでランチャー表示へ戻り、途中の通常画面は見せずに切り替えます。Escは展開中なら収納、収納中なら通常画面へ戻ります。
- アイコン化中は無条件で最前面に固定します。解除時は元のピン状態へ戻ります。透明部分は背後へクリックを通します。Web版ではOSの最前面・クリック透過・窓寸法変更は対象外です。

実装上、Windowsのアイコン表示は専用の最前面レベルを設定し、表示切替完了時にも実際の最前面状態を確認します。解除時は共通ピンの選択へ戻します。ドラッグの起点はメインプロセスのマウス押下で記録し、IPC到着前にポインターが動いた場合も最初の移動量を保持します。素早い解放時も最後の位置を反映して終了します。
- アプリとCLIの起動状態・フォルダは既存状態を共有します。CLIから開くConsoleは作業領域中央に約800×600pxで表示します。

画面は backend_diag/ui/src/components/アプリ起動/マイクロランチャー.vue / .css、共通寸法は同フォルダの 円周配置.cjs、窓制御は backend_diag/起動/マイクロ表示.cjs です。回帰確認は node --test backend_diag/checks/micro-window.check.mjs backend_diag/checks/icon-drag.check.mjs backend_diag/checks/desktop.check.mjs。配布画面を更新するときは npm --prefix backend_diag/ui run build と npm --prefix backend_diag/ui run check を実行します。

## 起動アイコンのモーション

通常・ミニ・マイクロ表示のアプリ／CLI／VS Codeアイコンは、起動状態が要求を受け付けたときにアイコンを動かさず、枠の周囲を短い光が右回りに1周します。角丸の経路を900msで、最初はゆっくり・後半ほど速く連続加速し、出入りだけ短くフェードします。起動成功の表示ではなく、起動APIの完了を待たずに再生します。未導入・無効・確認キャンセル・排他で拒否した操作では再生しません。許可された連続CLI起動は前の演出を取り消して1周を再開します。OSの動きを減らす設定では再生しません。

共通実装は `ui/src/components/アプリ起動/起動モーション.mjs` と各起動状態の `開始時` コールバックです。固定寸法の枠上で SVG の線だけを動かすため、マイクロ外周の配置・公転、ボタンの操作領域は変えません。確認は `node --test backend_diag/checks/launch-motion.check.mjs backend_diag/checks/app-launch-state.check.mjs backend_diag/checks/cli-launch-state.check.mjs backend_diag/checks/mini-cli-ui.check.cjs`。実OSの見え方は別途確認します。

### Task / Team のアプリ起動

アプリ起動の並びは Avatar、Task、Team の順です。Task / Team は `frontend_ide` の独立ランチャーを使用し、Avatar 内の既存画面は変更しません。通常・ミニ・アイコン表示とも、配置先 `_config/AiDiy_key.json` の `PORT_TASKTEAM`（省略時8093）にある TaskTeam バックエンドの `/health` が正常な場合だけ選択できます。停止・接続不明・設定不正時は無効となり、受付時にも再確認します。Core の起動・認証はアプリ側で確認してください。

これは手動アプリ起動への追加です。一括起動や `--auto` の既定対象を増やしません。

## 一括起動前の再起動要求の清掃

手動の一括起動と `--auto` は、全対象の未起動を確認した後、最初のプロセスを生成する前に再起動要求を削除します。起動対象に選んでいない Local も含めます。

- Core / Apps: `backend_server/temp/reboot_core.txt`、`reboot_apps.txt`、補助ファイル `reboot_apps_code_base_path.txt`。
- Tools: `backend_tools/temp/reboot_tools.txt`。
- Local: `backend_local/temp/reboot_local.txt`。
- TaskTeam: `backend_taskteam/temp/reboot_taskteam.txt`、互換入力 `reboot_task.txt`、`reboot_team.txt`。

固定の8ファイルだけを削除し、設定・モデル・その他の一時ファイルは残します。ファイルがなければ続行し、削除に失敗した場合は一括起動を中止します。個別再起動では他バックエンドの再起動要求を削除しません。追加・改名時は各バックエンドの監視処理と Core の再起動要求発行を照合し、`backend_diag/checks/start-manager.check.mjs` の削除対象・起動前順序テストも更新してください。

## 設定再起動のCore接続条件

設定再起動タブはDiag接続済みかつ既存の起動ポート監視でCoreの開放を確認した場合だけ操作できます。未確認・停止・状態取得失敗時は無効です。設定画面を開いたままCoreが停止した場合もフォームを閉じ、画面内のCore認証と処理を破棄します。タブ移動だけでは接続済み状態を消しません。実操作は固定Core APIが毎回認証し、接続不能なら書込みを成功扱いにしません。確認は `checks/start-bulk-state.check.mjs` と `checks/ai-settings-*.check.*` を使います。

### アイコン配置と起動受付

- Browser → Hermes → Discord の順に表示し、Chrome は最後に表示します。Browser と Hermes の表示名には aidiy / AiDiy を付けません。両方に名前の帯を表示します。
- Browser は Tools / MCP 稼働中のみ起動できます。Chrome は従来どおり Tools / MCP と Web の両方が必要です。状態取得失敗・切断時は起動不可とします。
- 円形表示は10個以下で一重円、11個以上で二重円です。表示順の先頭から約40%（四捨五入）を内側、残りを外側へ配置します。現在の18個では内側7個・外側11個です。
- 内側は時計回り、外側は反時計回りです。画像は正立を維持し、円の間隔も確保します。
- 起動受付の光は1.8秒で連続して2回転し、その間は他の起動アイコンを暗くします。演出は起動完了待ちではなく、起動要求と並行します。
- アイコン表示の右クリックで「ミニサイズ」「標準サイズ」「閉じる」、区切り線、「ランチメニュー」を表示します。「ランチメニュー」のサブメニューには、表示中の起動アイコンを同じ順序で1項目1行ずつ並べます。表示中のアイコンだけを通常表示で並べ、選択したアプリへ既存の起動処理を呼び出します。終了時は既存の終了確認を使用します。

- 展開は外側を順に広げてから内側へ進み、収納は内側から外側へ逆順です。アイコンごとに45msの時間差をつけ、収納演出が終わってから窓を縮めます。

## Slack の外部連携確認

- 外部連携タブは Hugging Face 読取・書込、Discord Bot、Slack Bot の順。Slackをモデル一覧へ混ぜません。通常の行・状態バッジ・右詳細・明示テストを再利用します。
- 設定有無は `slack_bot_token` のみ判定。trim後の空欄・1文字・`<` 始まり・内部空白はDiscordと同様に未設定です。実値は表示・保存しません。残るApp token・ID3欄を検証済みとは扱いません。
- 明示操作だけで固定 POST `https://slack.com/api/auth.test` を使用します。`ok === true` とBot IDの確認に成功して初めてOKです。接続中・投稿可能という意味ではありません。App token・Socket Mode・チャンネル権限確認やメッセージ送信は行いません。
- 一括確認・同時2件の待機・重複防止・切断時abort・再確認・結果書込は既存処理を共有。`integration_info.json` には未実施を含む4行を保存し、起動時とheadlessは外部認証を呼びません。
- `node --test backend_diag/checks/slack-integration-ui.check.mjs` はローカルVue描画とmockで選択・未設定・未認証・待機・二重押し・遅い応答・FIFO・保存先を確認します。backendの `model-probe` / `key-status` / `server` / `headless` 回帰も実施します。実Slack APIや実GUIは試験とは別です。

固定メソッドと認証応答の根拠: [Slack公式 auth.test](https://docs.slack.dev/reference/methods/auth.test/)。SlackのHTTPS定期取得・接続パネル・制限は [SlackのREADME](../../frontend_channels/slack/README.md) を参照してください。


### Slackのランチャー登録と未導入時

通常・ミニ・マイクロ・右クリックのSlackはDiscordの直後に並ぶ。アイコンはDiag内の `AiDiy_slack.png` コピーだけを参照する。`frontend_channels/slack/panel/launch.mjs` が通常ファイルとして見つからなければ「未導入」として起動不可、認証済APIの直接要求も503で返し、process探索・ログ作成・spawnをしない。通常表示に特別な「準備中」ラベルは加えない。

現行実装ではSlackの接続runtimeとパネルを実装済み。ランチャー登録やBot認証OKは接続成功を意味しない。明示クリック時に入口の実在確認を再実行し、Slack専用のprocess識別を経て固定argvでパネルを起動する。通常のbuild/verify/testが兄弟moduleの画像へ依存しない点は維持する。接続・停止・確認手順は `frontend_channels/slack/README.md` を参照。

局所確認: `node --test backend_diag/checks/slack-launcher.check.mjs backend_diag/checks/micro-project.check.cjs backend_diag/checks/icon-menu.check.cjs`。すべてmockで実アプリやSlack APIを起動しない。

## 導入状況の公式サイト

左の名前直後の角丸の「Web」は公式サイトを既定ブラウザで開きます。URLは `backend_diag/ui/src/components/導入状況/公式サイト.json` が所有し、VueのリンクとElectronの許可先で共用します。登録URLとの完全一致だけを外部ブラウザへ渡し、Diag本体のページ遷移・Electron新規ウィンドウは許可しません。ベース・CLI群・その他拡張は初期状態ですべて展開します。URL追加時は診断カタログのIDと照合し、画面反映のbuild・verify、導入状況checksとdesktop.checkを確認します。Electron側の変更反映にはDiagの再起動が必要です。

外部連携タブも同じURL一覧を使用し、公開モデル操作（Hugging Face）・Discord・Slackの見出し横にWebリンク、その下にサービス名を表示します。外部連携のURL追加時は `backend_diag/ui/src/components/外部連携/checks` も確認します。

## ランチャーの起動可否と表示

標準のアプリ起動画面は全項目を表示し、起動条件を満たさない項目を薄く表示します。ミニランチャー・アイコン展開・その右クリック一覧は、バックエンドや導入状態により起動できない項目を表示対象から外します。処理中の一時的な操作禁止やフォルダ未選択だけで並びを変えないよう、表示対象の判定とボタンの押下可否を分けます。

Task / Team停止時はTask・Team、Tools停止時はBrowser・Chromeが非表示になります。Core停止だけではオフライン利用できるIDE・Console・Code・Live等を隠しません。サービス復帰後は元の順序へ戻し、円周配置とミニ表示の高さも件数に追従させます。

## アイコンメニュー

実装: `backend_diag/起動/アイコンメニュー.cjs`、`backend_diag/起動/アイコンメニュー-preload.cjs`、`backend_diag/起動/アイコンメニュー.css`。

回転メニューを閉じた小さいアイコンの状態でも右クリックから使える。ミニサイズ・標準サイズ・閉じると、表示対象のアプリだけを並べるランチメニューを備える。右クリック時から一覧を展開し、表示操作とアプリ一覧を一体のパネルに収める。全体幅は264px。表示操作は上部の1行に集約し、アプリ行は32px。高さは表示件数から計算し、クリックしたモニターの作業領域内へ位置・サイズを補正する（タスクバーを避け、負座標のモニターにも対応）。画面が小さい場合は一覧内をスクロールする。左列はAvatar〜Discord（Browser・Hermesを含む）、右列はClaudeなどの外部ツール〜Chrome。項目が未表示でも列の所属は変えず、表示対象だけを載せる。多い場合は一覧内をスクロールする。Esc、外側クリック、フォーカス離脱で閉じる。

専用のsandbox付きElectron窓で表示する。起動キーは親から渡された一覧に限定し、送信元とmainFrameを照合する。閉じるは親の `window.close()` を呼び、既存のサーバー稼働時の終了確認を通す。表示変更は既存のmini／normalイベント、アプリ起動は既存のlaunchイベントへ渡す。

変更後はDiagを開き直す。Vueの変更がない場合はUIビルド不要。確認は `node --test backend_diag/checks/icon-menu.check.cjs backend_diag/checks/close-confirm.check.cjs`。下図は実装部品を18項目・2列で開いた確認画面。

![右クリックメニュー](../../docs/セルフテスト、操作ガイド/images/backend_diag,アイコンメニュー/右クリックメニュー.jpg)

### すりガラス表示

Windows 11 22H2以降ではElectronのbackgroundMaterial（acrylic）で背後の画面をぼかす。macOSはvibrancy（menu）を指定する。文字とアイコンは不透明のまま、濃紺の背景だけ半透明にする。未対応環境は従来の濃紺パネル。Windows実機で表示確認済み、macOS実機は未検証。

左上の見出しは「AiDiy ランチャー」とし、Aマークは表示しない。
