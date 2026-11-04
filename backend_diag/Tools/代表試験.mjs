// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
// 固定条件の軽量試験。任意SQL・パス・コマンドを画面から受け取らない。
const array = (value, key) => Array.isArray(value?.[key]);
const query = value => value.rows?.length === 1 && value.rows[0]?.diag_test === 1;
const count = (value, key, label) => `${label}: ${value[key].length}件`;
export const 代表試験 = {
 aidiy_desktop_capture: {method:'screen_info', body:{}, check:r=>array(r,'monitors')&&r.monitors.length>0, summary:r=>count(r,'monitors','モニター')},
 aidiy_sqlite: {method:'query',body:{sql:'SELECT 1 AS diag_test',max_rows:1,allow_write:false},check:query,summary:()=> 'SELECT 1 の結果: 1（読取専用）'},
 aidiy_postgres: {method:'query',body:{sql:'SELECT 1 AS diag_test',max_rows:1,allow_write:false},check:query,summary:()=> 'SELECT 1 の結果: 1（読取専用）'},
 aidiy_logs: {method:'list',body:{},check:r=>array(r.logs,'server')&&array(r.logs,'mcp'),summary:r=>`ログ登録: ${r.logs.server.length+r.logs.mcp.length}件`},
 aidiy_code_check: {method:'python_syntax',body:{file_path:'backend_tools/tools_main.py',venv_project:'backend_tools'},check:r=>r.ok===true,summary:()=> 'tools_main.py の Python 構文チェックに成功しました。'},
 aidiy_backup: {method:'save/run',body:{batch:false},check:r=>r.ok===true&&typeof r.batch==='boolean'&&Number.isSafeInteger(r.バックアップ件数)&&r.バックアップ件数>=0&&Number.isSafeInteger(r.全件数)&&r.全件数>=r.バックアップ件数,summary:r=>r.batch?`バックアップ受付: 予定 ${r.バックアップ件数}件（コピー完了は未確認）。完了・失敗はToolsログで確認してください。`:`バックアップ完了: ${r.バックアップ件数}件。`},
 aidiy_obs_studio_control: {method:'list_scenes',body:{},check:r=>array(r,'scenes'),summary:r=>count(r,'scenes','OBSシーン')},
 aidiy_ffmpeg_control: {method:'ffmpeg_run',body:{args_str:'-hide_banner -f lavfi -i anullsrc=r=8000:cl=mono -t 0.1 -f null -',timeout_sec:10},check:r=>r.returncode===0,summary:()=> '0.1秒の無音を処理しました（保存・再生なし）。'},
 aidiy_notification_sounds: {method:'play',body:{notification_type:'完了',scene:'legacy'},check:r=>r.status==='ok'&&r.scene==='legacy'&&r.notification_type==='完了',summary:()=> '通知音の再生処理を受け付けました。音が聞こえたか確認してください。'},
 aidiy_team_agents: {method:'get_member_list',body:{include_disabled:false,request_timeout_sec:10},check:r=>r.status==='OK'&&array(r,'items'),summary:r=>count(r,'items','チーム要員')},
 aidiy_windows_control: {method:'list_windows',body:{},check:r=>array(r,'windows'),summary:r=>count(r,'windows','ウィンドウ')},
};
// 高コスト・録音・ソース変更・タスク登録を伴うToolは説明APIの疎通だけを確認する。
for(const id of ['aidiy_image_generation','aidiy_movie_generation','aidiy_speech_to_text','aidiy_text_to_speech','aidiy_code_agents','aidiy_chat_llms','aidiy_decisions_check','aidiy_task_agents']) {
  代表試験[id]={method:'docs',httpMethod:'GET',body:{},check:r=>r.service===id,summary:()=> '説明APIの応答を確認しました。生成・認識・AI実行の動作は未試験です。'};
}
export function 試験結果(id, response) {
 const test=代表試験[id];
 if(!test || !response || response.error || response.status==='NG' || response.status==='error' || response.available===false || !test.check(response))return null;
 return test.summary(response);
}
