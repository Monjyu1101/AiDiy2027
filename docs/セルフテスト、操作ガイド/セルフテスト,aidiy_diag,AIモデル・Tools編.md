# aidiy_diag AIモデル・Tools編 — 操作ガイドとセルフテスト

> 確認範囲：本文には過去の実機・自動試験結果と今回の追補を含みます。今回の実施状況は[確認結果](セルフテスト,共通,確認結果.md)の章別台帳を参照してください。今回の全章再実行・全条件合格を示すものではありません。

## 総合評価

**✅ OK（環境依存2件を含む確認範囲）。** Windowsの実Diagで設定モデル16行、AIモデル5種類、Toolsの個別・一括テストを確認しました。Toolsの画面集計は成功18件・失敗2件・対象外0件です。失敗2件はPostgreSQLの接続設定なしとOBSへの接続拒否で、環境依存・判定対象外として扱います。画面のERRは成功へ読み替えません。

1〜3章が「設定モデル・AIモデル・Tools」の操作ガイド、4章が追加テストと確認範囲です。モデル候補の取得は[環境確認編](セルフテスト,aidiy_diag,環境確認編.md)、設定保存とサービス再起動は[設定再起動編](セルフテスト,aidiy_diag,設定再起動編.md)を参照します。

対象はWindowsです。Mac／Linux実機、長時間連続運転は未実施です。[PDF版](セルフテスト,aidiy_diag,AIモデル・Tools編.pdf)を参照できます。

## 始める前に

[システム起動編](セルフテスト,aidiy_diag,システム起動編.md)でToolsを起動し、下部の「tools オンライン」を確認します。Toolsタブの管理画面にはCoreの起動とログインが必要です。team_agentsの試験にはTask / Teamも起動します。

モデル試行の入力は「おはよう」です。入力予測は同じプロジェクトに「昔々、あるところに」「おじいさんと」の2ターンを保存してから試行します。AI応答の生成・会話履歴保存を伴います。モデル設定のファイルは変更しません。

## 1. 設定モデルで応答を確認する

1. 「設定モデル」を開き、「再読込」で現在の設定を読みます。
2. 「動作確認」を押します。画面右上の「全テスト」とは別の操作です。
3. CHAT → LIVE → PREDICTION → DECISION → CODE1〜6、TASK／TEAMの順に結果が出るのを待ちます。同じ条件の結果を共有する行もあります。
4. 「試行が完了しました。」が出たら、左の行を選んで右側の結果・応答を読みます。
5. LIVEは音声プレーヤーの再生ボタンを押します。文字の返答、音声取得、再生、人による聴取は別々に確認します。

**完了の目印：** 各行の状態と実際の返答を確認し、未実施やエラーを正常応答と混同しません。全体の完了後は先頭のCHATへ戻ります。

設定モデルの初期画面です。設定済みのモデルと、未実施の状態が表示されます。

**図101：設定モデル初期画面**

![図101 設定モデル初期画面](images/セルフテスト,aidiy_diag,AIモデル・Tools編/Diag-AIモデルTools_101_設定モデル初期画面.png)

実行中の画面です。実行している行へ表示が移り、上部に進行中の項目を示します。

**図102：設定モデル実行中**

![図102 設定モデル実行中](images/セルフテスト,aidiy_diag,AIモデル・Tools編/Diag-AIモデルTools_102_設定モデル実行中.png)

全体の試行完了画面です。16行すべてOKとなりました。

**図103：設定モデル完了**

![図103 設定モデル完了](images/セルフテスト,aidiy_diag,AIモデル・Tools編/Diag-AIモデルTools_103_設定モデル完了.png)

CHATの返答です。右側を下へスクロールすると、実行モデルと応答本文を読めます。

**図104：設定モデルChat応答**

![図104 設定モデルChat応答](images/セルフテスト,aidiy_diag,AIモデル・Tools編/Diag-AIモデルTools_104_設定モデルChat応答.png)

LIVEは1.24秒の音声を取得しました。再生位置が末尾へ進んだことを確認しています。

**図105：設定モデルLive音声**

![図105 設定モデルLive音声](images/セルフテスト,aidiy_diag,AIモデル・Tools編/Diag-AIモデルTools_105_設定モデルLive音声.png)

PREDICTIONの結果です。codex_cli / gpt-6-lunaで「おばあさん」を含む続きを予測し、「完璧」と表示されました。

**図106：設定モデル入力予測**

![図106 設定モデル入力予測](images/セルフテスト,aidiy_diag,AIモデル・Tools編/Diag-AIモデルTools_106_設定モデル入力予測.png)

TASK／TEAMの6行はCODE1の結果を共有しています。共有元の表示がある行を、別々のAI通信の成功回数として数えません。

**図107：TaskTeam結果共有**

![図107 TaskTeam結果共有](images/セルフテスト,aidiy_diag,AIモデル・Tools編/Diag-AIモデルTools_107_TaskTeam結果共有.png)

| 対象 | 結果 |
|---|---|
| CHAT・LIVE・PREDICTION・DECISION | 4行OK |
| CODE1〜6 | codex_cli・copilot_cli・claude_cli・antigravity_cli・opencode_cli・aidiy_hermesの6行OK |
| TASK plan／do／check・TEAM plan／do／check | 6行OK。CODE1の結果を共有 |

## 2. AIと入力を選んで試す

1. 「AIモデル」を開きます。候補を更新する場合は「候補を再読込」を押します。
2. CHAT・LIVE・PREDICTION・DECISION・CODEでプロバイダとモデルを選びます。LIVEは音声も選びます。
3. 自由プロンプトを確認します。例は「おはよう」です。DECISIONは質問形式・質問文・選択肢も確認します。
4. 上部の「動作確認」または右上の「一括試行」を押し、5種類が終わるまで待ちます。現在の種類だけなら、入力欄の「テスト」を使います。
5. 完了後はCHATへ戻ります。各タブを選び、指定モデル・実行モデル・返答を確認します。

**完了の目印：** 種類ごとの状態と返答を確認します。この画面で選んだ候補は本体設定へ保存されません。

AIモデルの入力画面です。左で条件を選び、右で結果を読みます。

**図201：AIモデル入力画面**

![図201 AIモデル入力画面](images/セルフテスト,aidiy_diag,AIモデル・Tools編/Diag-AIモデルTools_201_AIモデル入力画面.png)

一括試行中です。入力予測では、履歴に残す2ターンの送信と予測の経過を表示します。

**図202：AIモデル一括試行中**

![図202 AIモデル一括試行中](images/セルフテスト,aidiy_diag,AIモデル・Tools編/Diag-AIモデルTools_202_AIモデル一括試行中.png)

CHATの結果です。一括試行完了後にCHATへ戻り、返答を表示しました。

**図203：AIモデルChat応答**

![図203 AIモデルChat応答](images/セルフテスト,aidiy_diag,AIモデル・Tools編/Diag-AIモデルTools_203_AIモデルChat応答.png)

LIVEの結果です。freeai_liveのZephyrで1.12秒の音声を取得し、プレーヤーの再生位置が末尾へ進むことを確認しました。

**図204：AIモデルLive音声**

![図204 AIモデルLive音声](images/セルフテスト,aidiy_diag,AIモデル・Tools編/Diag-AIモデルTools_204_AIモデルLive音声.png)

PREDICTIONの結果です。「おばあさんが、山へ芝刈りに行きました。」と予測し、「完璧」と表示されました。

**図205：AIモデル入力予測**

![図205 AIモデル入力予測](images/セルフテスト,aidiy_diag,AIモデル・Tools編/Diag-AIモデルTools_205_AIモデル入力予測.png)

DECISIONはchoice形式の判断をJSONで返しました。この入力ではpolitenessがlowでした。指定auto、実行モデルはopenai_oauth / gpt-6-lunaです。

**図206：AIモデル判断JSON**

![図206 AIモデル判断JSON](images/セルフテスト,aidiy_diag,AIモデル・Tools編/Diag-AIモデルTools_206_AIモデル判断JSON.png)

CODEの返答です。指定autoから実行されたgpt-6-lunaと、会話履歴への保存を確認しました。

**図207：AIモデルCode応答**

![図207 AIモデルCode応答](images/セルフテスト,aidiy_diag,AIモデル・Tools編/Diag-AIモデルTools_207_AIモデルCode応答.png)

| 種類 | 実行した条件 | 結果 |
|---|---|---|
| CHAT | freeai_chat / gemini-3.8-flash | OK、挨拶の文字応答 |
| LIVE | freeai_live / gemini-2.5-flash-native-audio-preview-09-2025 / Zephyr | OK、文字と1.12秒の音声 |
| PREDICTION | auto → codex_cli / gpt-6-luna | OK、「おばあさん」を含む予測 |
| DECISION | auto → openai_oauth / gpt-6-luna | OK、choice形式のJSON |
| CODE | codex_cli / auto → gpt-6-luna | OK、挨拶の文字応答 |

## 3. Toolsを確認する

### ログインと一覧

1. Core・Toolsを起動し、「Tools」を開きます。
2. Coreの利用者IDでログインします。認証はこの画面内だけで保持します。
3. 一覧からTool名を選び、右側の既定値・テスト条件を読みます。

ログイン前の画面です。パスワードを入力していない状態を掲載しています。

**図301：Toolsログイン画面**

![図301 Toolsログイン画面](images/セルフテスト,aidiy_diag,AIモデル・Tools編/Diag-AIモデルTools_301_Toolsログイン画面.png)

ログイン後のTools一覧です。20項目のON／OFF、テスト操作、未実施の状態を表示します。

**図302：Tools一覧**

![図302 Tools一覧](images/セルフテスト,aidiy_diag,AIモデル・Tools編/Diag-AIモデルTools_302_Tools一覧.png)

### 個別に確認する

1. 左の「sqlite」を選びます。
2. テスト条件を読み、「この条件でテスト」を押します。行の「テスト」も同じ試験を実行します。
3. OKと「SELECT 1 の結果: 1（読取専用）」が出れば、この試験は成功です。

SQLiteの個別結果です。業務テーブルの更新は行いません。

名称を選ぶ操作と、隣の「テスト」は区別します。まず右側の「SQLite 読取試験」で、`SELECT 1`のみを実行し業務テーブルを読取・更新しないことを確認します。2026-11-02の解説実演でも、この1項目だけを実行し「SELECT 1 の結果: 1（読取専用）」とOKを実画面で確認しました。他のToolや業務データ全体の検査結果には広げません。閲覧用ログインは「Coreからログアウト」で終了し、Diagはミニへ戻せます。

**図303：SQLite個別結果**

![図303 SQLite個別結果](images/セルフテスト,aidiy_diag,AIモデル・Tools編/Diag-AIモデルTools_303_SQLite個別結果.png)

### 一括で確認する

1. 各ToolのON／OFFと試験内容を確認します。
2. backupは「batch」にチェックを入れます。`batch=true`で実際のバックアップを作成します。
3. 右上の「一括テスト」を押します。利用可能・有効なToolを一覧順に試験します。
4. 完了後の成功・失敗・対象外件数と、ERRの行の理由を確認します。
5. backupのOKは受付成功です。Toolsログのコピー完了も確認します。

backupのbatch ONです。別スレッドでコピーし、受付を返す条件になっています。

**図304：Backupのbatch設定**

![図304 Backupのbatch設定](images/セルフテスト,aidiy_diag,AIモデル・Tools編/Diag-AIモデルTools_304_Backupのbatch設定.png)

一括実行中です。実行中と待機中を区別して表示し、1件失敗しても次へ進みます。

**図305：Tools一括実行中**

![図305 Tools一括実行中](images/セルフテスト,aidiy_diag,AIモデル・Tools編/Diag-AIモデルTools_305_Tools一括実行中.png)

最終集計は成功18件・失敗2件・対象外0件です。2件のERRの条件は4章へ記載しています。

**図306：Tools一括結果**

![図306 Tools一括結果](images/セルフテスト,aidiy_diag,AIモデル・Tools編/Diag-AIモデルTools_306_Tools一括結果.png)

batch=trueの受付結果です。予定8件と表示され、Toolsログで同じ8件のバッチコピー完了を確認しました。受付と完了のログは同じ秒に記録されました。差分の件数・所要時間は対象によって変わります。

**図307：Backup受付結果**

![図307 Backup受付結果](images/セルフテスト,aidiy_diag,AIモデル・Tools編/Diag-AIモデルTools_307_Backup受付結果.png)

### 専用ブラウザを閉じて終了する

1. 「chrome_devtools」を選びます。
2. 「専用ブラウザを終了」を押し、終了通知を確認します。
3. 作業後は「Coreからログアウト」を押します。

専用Chromeの終了通知です。撮影・試験用のブラウザは終了しています。

**図308：専用Chrome終了**

![図308 専用Chrome終了](images/セルフテスト,aidiy_diag,AIモデル・Tools編/Diag-AIモデルTools_308_専用Chrome終了.png)

## 4. 追加テストと確認範囲

### Toolsの結果一覧

| Tool | 確認内容 | 結果 |
|---|---|---|
| chrome_devtools | 専用Chromeの起動・終了 | OK |
| desktop_capture | モニター情報 | OK |
| sqlite | 読取専用SELECT 1 | OK |
| postgres | 読取専用SELECT 1 | 環境依存・判定対象外。DSN未設定、画面はERR |
| logs | ログ一覧の件数 | OK |
| code_check | tools_main.pyの構文 | OK |
| backup | batch=trueの実バックアップ | OK、8件の受付とコピー完了 |
| image_generation | 説明API | OK |
| movie_generation | 説明API | OK |
| speech_to_text | 説明API | OK |
| text_to_speech | 説明API | OK |
| obs_studio_control | シーン一覧 | 環境依存・判定対象外。接続拒否、画面はERR |
| ffmpeg_control | 0.1秒の無音処理 | OK |
| notification_sounds | 通知音の再生処理 | OK、人による聴取は未判定 |
| code_agents | 説明API | OK |
| chat_llms | 説明API | OK |
| decisions_check | 説明API | OK |
| task_agents | 説明API | OK |
| team_agents | 要員一覧 | OK、要員4件 |
| windows_control | ウィンドウ一覧 | OK |

チーム要員一覧の結果です。4件を取得できました。依頼の登録・実行は行いません。

**図401：チーム要員一覧**

![図401 チーム要員一覧](images/セルフテスト,aidiy_diag,AIモデル・Tools編/Diag-AIモデルTools_401_チーム要員一覧.png)

画像生成など8項目の代表試験は説明APIの疎通です。これらのOKは、画像・動画・音声の生成、録音、AI実行、タスク登録の成功を意味しません。

**図402：説明APIの確認範囲**

![図402 説明APIの確認範囲](images/セルフテスト,aidiy_diag,AIモデル・Tools編/Diag-AIモデルTools_402_説明APIの確認範囲.png)

PostgreSQLはDSNが未設定のためERRでした。詳細の原因はToolsログでも照合しています。実DBへの疎通は未確認です。

**図403：PostgreSQL未設定**

![図403 PostgreSQL未設定](images/セルフテスト,aidiy_diag,AIモデル・Tools編/Diag-AIモデルTools_403_PostgreSQL未設定.png)

OBSは接続先から接続を拒否されてERRでした。配信・録画・シーン切替は行っていません。

**図404：OBS接続不可**

![図404 OBS接続不可](images/セルフテスト,aidiy_diag,AIモデル・Tools編/Diag-AIモデルTools_404_OBS接続不可.png)

### 自動試験・設定保持・未確認範囲

自動・隔離試験はモデル試行とTools関連173件、TaskTeam認証関連22件、計195件が成功しました。中止・競合・遅延応答、音声の取得・解放、入力上限、batchの指定と受付表示、登録済みAPIの認証と未登録APIの拒否を含みます。実AIの応答結果とは別に判定しています。

モデル設定ファイルとMCP設定ファイルは試行前後で不変でした。既定値の変更・適用・保存とChatLLM代表項目のON／OFF保存・再読込・復元は、末尾の実機結果で確認済みです。

既存の操作を現行画面で確認した範囲を掲載しています。全プロバイダ・全モデルの組合せ、全Toolの実生成機能、実タスク登録、人による音声聴取、長時間連続運転、Mac／Linux実機は未実施です。

モデル試行の結果は診断用セッションのものです。単独Liveの会話・各アプリの操作全体は、それぞれの冊子で扱います。

## 証拠照合と残る確認

2026-11-03の文書・既存証拠照合です。新しい実機試験ではありません。

- **確認済み**：設定モデル16行、AIモデル5種、Tools一括18成功・2ERRは本文の各図と第4章結果表の既存試験を維持します。2026-11-02のSQLite SELECT 1は追加実機確認済みです。元一括試験の時刻は本書では未記載です。
- **残る確認・限界**：Tools既定値の代表1項目は下記の追補で確認しました。ON/OFFは下記のChatLLM代表項目で保存・保持・復元を確認しました。PostgreSQL DSN未設定・OBS接続拒否は当時の環境制約で、現時点の不可を断定しません。説明API成功を実生成成功へ拡張しません。

- **既定値の実機確認（2026-11-03）**：通常DiagのTools画面で `movie_generation.auto_aspect_ratio` を `16:9` → `9:16` へ変更。「適用のみ」後のファイル不変、「既定値を保存」後の `_config/AiDiy_tools.json` の該当値、画面の「再読込」後の9:16保持を確認しました。続いて16:9へ戻して保存・再読込し、設定全体の値とファイルハッシュが変更前と一致。他の設定JSONも不変でした。保存対象はこのToolの既定引数のみで、provider・model・resolutionは変更していません。動画生成・AI依頼は0回、サーバー再起動・ソース変更なし。CoreからログアウトしDiagミニへ戻しました。
- **ON/OFFの扱い**：OFF時は実行ゲートで遮断されます。下記の承認済み代表試験で保存・再読込・復元を確認しました。既定引数の試験とは区別します。

### 設定APIと利用可否の確認

既存設定APIの隔離10件はPASS。通常DiagでChatLLMをONからOFFへ切り替え、保存して再読込し、元へ戻しました。ON時はモデル一覧APIが4件を返し、OFF後と保存・再読込後は同じAPIが「サービス外」（NG、available=false）を返しました。HTTPステータスだけで合否を判断しません。

最後にONへ戻して保存し、今回追加されたenabledキー以外が不変であることを確認して元ファイルを復元。ファイル全体のバイト一致、再読込後のON、モデル一覧の再取得成功を確認しました。外部AIへの質問・動画生成は0回です。説明APIはゲート除外のため使わず、外部通信しないモデル一覧APIで抑止を確認しています。

この結果はaidiy_chat_llmsの利用停止・保存・復元の代表確認です。他ツールの生成成功まで意味しません。ログアウトしDiagミニへ戻し、5サーバー正常・Local停止を保持しました。

[ChatLLM利用停止・復元の証拠](evidence/.aidiy_cache/selftest/セルフテスト,aidiy_diag,AIモデル・Tools編/Diag-AIモデルTools_304_ChatLLM利用停止復元.json)。

### 現行の判定（文書順再照合）

- **確認済み**：既定値保存復元、ChatLLM ON取得→OFF抑止→保存再読込→完全復元済み。
- **本当に残る確認・範囲**：PostgreSQL DSN未設定・OBS接続拒否は当時の制約。現在可否未確認。他Tools全件への結果拡張なし。
- **証拠の扱い**：上記の本文・図・参照結果を照合。先行調査の未実施/拒否/準備失敗は当時の記録であり、後続の成功や実施不要指定を優先します。今回の文書整理を新しい実機PASSには数えません。
