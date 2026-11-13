// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
// 通常のChrome tool APIを固定セッションで実行する。任意URL・コマンドは受け付けない。
export const Tools代表テスト={
 aidiy_chrome_devtools:{
  label:'専用ブラウザの起動',
  description:'初回・停止後は白紙のChromeを専用セッション diag-tools-test で起動します。稼働中のセッションを再利用するため、headless条件を変更した場合は専用ブラウザを終了してから再テストしてください。普段のブラウザや有料APIは使いません。終了ボタンもこの専用セッションだけを対象にします。',
  defaults:{headless:false},
  headless:true,
  async run({call,input}){await call('Tools/representative',{operation:'open',headless:input.headless===true});return{status:'OK',message:'専用ブラウザの起動に成功しました。不要になったら「専用ブラウザを終了」を押してください。'};},
  async close({call}){await call('Tools/representative',{operation:'close',headless:false});return{status:'OK',message:'専用ブラウザを終了しました。'};},
 },
};

const 簡単な試験={
 aidiy_desktop_capture:['モニター情報の取得','モニターの数を取得します。画面撮影・保存は行いません。'],
 aidiy_sqlite:['SQLite 読取試験','SELECT 1 を実行します。業務テーブルの読取・更新は行いません。'],
 aidiy_postgres:['PostgreSQL 読取試験','設定済み接続先で SELECT 1 を実行します。接続設定が必要です。データは更新しません。'],
 aidiy_logs:['ログ一覧の取得','ログ登録の件数を確認します。ログ本文やパスは画面に表示しません。'],
 aidiy_code_check:['Python 構文チェック','backend_tools/tools_main.py の構文を確認します。ソースは変更しません。Python のキャッシュが作成される場合があります。'],
 aidiy_obs_studio_control:['OBS シーン一覧の取得','起動済みOBSからシーン件数を取得します。配信・録画・シーン切替は行いません。'],
 aidiy_ffmpeg_control:['短い無音の処理','ffmpegで0.1秒の無音を生成して破棄します。ファイル保存や音声再生は行いません。'],
 aidiy_notification_sounds:['短い通知音の再生','完了の通知音を1回再生します。音が聞こえるか確認してください。'],
 aidiy_team_agents:['チーム要員一覧の取得','TaskTeamへ接続して要員件数を取得します。依頼は登録・実行しません。'],
 aidiy_windows_control:['ウィンドウ一覧の取得','Windowsのウィンドウ件数を取得します。タイトルは表示せず、マウス・キーボード・ウィンドウを操作しません。'],
};
for(const id of ['aidiy_image_generation','aidiy_movie_generation','aidiy_speech_to_text','aidiy_text_to_speech','aidiy_code_agents','aidiy_chat_llms','aidiy_decisions_check','aidiy_task_agents']){
 簡単な試験[id]=['説明APIの疎通確認','Toolの説明APIが応答するか確認する軽量試験です。画像・動画・音声の生成、録音、AI呼出し、コード変更、タスク登録は行いません。実機能の動作確認とは別です。'];
}
for(const [id,[label,description]] of Object.entries(簡単な試験)){
 Tools代表テスト[id]={label,description,defaults:{},async run({call}){
  const result=await call('Tools/representative',{operation:'test',tool:id});
  if(typeof result?.summary!=='string'||!result.summary)throw Error('試験結果を確認できませんでした。');
  return {status:'OK',message:result.summary};
 }};
}

// Backup は明示テストで実際に保存する。Diag の初期値だけを true とし、必ず値を送る。
Tools代表テスト.aidiy_backup={
 label:'バックアップの作成',
 description:'この配置先のバックアップを実際に作成します。batch ON（初期値）はコピーを別スレッドへ渡し、受付を返します。OFFはコピー完了を待ちます。実行応答は最長5分待機しますが、接続・保存の失敗を防ぐものではありません。待機中止・期限切れでも開始済みコピーは止まりません。受付後の完了・失敗はToolsログで確認し、完了までは元ファイルの変更・削除やサーバー停止を避けてください。',
 defaults:{batch:true},batch:true,
 async run({call,input={}}){
  const result=await call('Tools/representative',{operation:'test',tool:'aidiy_backup',batch:input.batch??true});
  if(typeof result?.summary!=='string'||!result.summary)throw Error('試験結果を確認できませんでした。');
  return {status:'OK',message:result.summary};
 },
};
