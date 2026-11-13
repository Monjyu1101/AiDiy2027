// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createToolsRepresentativeBridge,TOOL_IDS} from '../diag/Tools/設定接続.mjs';
import {代表試験} from '../diag/Tools/代表試験.mjs';
import {Tools代表テスト} from '../diag/ui/components/Tools/Tools代表テスト.mjs';
const reader=async()=>JSON.stringify({PORT_CORE:8091,PORT_TOOLS:8095});
const fixtures={
 aidiy_desktop_capture:{monitors:[{width:1920,height:1080}]},
 aidiy_sqlite:{rows:[{diag_test:1}]},aidiy_postgres:{rows:[{diag_test:1}]},
 aidiy_logs:{logs:{server:[],mcp:[]}},aidiy_code_check:{ok:true},aidiy_backup:{ok:true,batch:false,全件数:0,バックアップ件数:0},
 aidiy_obs_studio_control:{scenes:[]},aidiy_ffmpeg_control:{returncode:0},
 aidiy_notification_sounds:{status:'ok',scene:'legacy',notification_type:'完了'},
 aidiy_team_agents:{status:'OK',items:[]},aidiy_windows_control:{windows:[]},
};
const envelope=tool=>({token:'fixture.jwt',data:{operation:'test',tool}});
test('ログ一覧はserver/mcpの配列を合計し、パスを表示しない',async()=>{
 const id='aidiy_logs';
 const response={logs:{server:[{path:'private-server.log'}],mcp:[{path:'private-mcp.log'}]}};
 const result=await setup(id,response).bridge(envelope(id));
 assert.equal(result.data.summary,'ログ登録: 2件');
 for(const logs of [[],{}, {server:[]}, {server:[],mcp:null}])assert.equal((await setup(id,{logs}).bridge(envelope(id))).status,'NG');
});
function setup(id,answer,enabled=true){
 const calls=[];
 const bridge=createToolsRepresentativeBridge({reader,requestFn:async r=>{
  calls.push(r);
  if(r.path==='/core/auth/現在利用者')return {status:'OK'};
  if(r.path==='/management/enabled')return {status:'OK',data:{tools:[{id,enabled,available:true}]}};
  return answer;
 }});
 return {bridge,calls};
}
test('登録済み20個すべてに試験があり、実行しない試験は説明APIと明記する',()=>{
 assert.deepEqual(Object.keys(Tools代表テスト).sort(),[...TOOL_IDS].sort());
 assert.equal(Object.keys(代表試験).length,19);
 for(const [id,definition] of Object.entries(代表試験))if(definition.httpMethod==='GET'){
  assert.equal(definition.method,'docs');
  assert.match(Tools代表テスト[id].label,/説明API/);
 }
});
for(const [id,definition] of Object.entries(代表試験)){
 test(`${id}: 認証・有効確認後に固定APIだけを呼び、本文を公開しない`,async()=>{
  const fixture=fixtures[id]||{service:id};
  const {bridge,calls}=setup(id,{...fixture,secret:'do-not-display'});
  const result=await bridge(envelope(id));assert.equal(result.status,'OK');assert.ok(result.data.summary);
  assert.doesNotMatch(JSON.stringify(result),/do-not-display/);
  assert.deepEqual(calls.map(r=>r.path),['/core/auth/現在利用者','/management/enabled',`/${id}/${definition.method}`]);
  assert.equal(calls[2].method,definition.httpMethod||'POST');assert.deepEqual(calls[2].data,definition.body);
  const shown=await Tools代表テスト[id].run({input:id==='aidiy_backup'?{batch:false}:undefined,call:async(action,data)=>{assert.equal(action,'Tools/representative');assert.deepEqual(data,{...envelope(id).data,...(id==='aidiy_backup'?{batch:false}:{})});return result.data;}});
  assert.equal(shown.message,result.data.summary);
 });
 test(`${id}: エラー・不正応答・無効状態は成功にしない`,async()=>{
  for(const response of [{},{status:'OK'},{...(fixtures[id]||{service:id}),error:'secret'},{...(fixtures[id]||{service:id}),available:false}]){
   assert.equal((await setup(id,response).bridge(envelope(id))).status,'NG');
  }
  const {bridge,calls}=setup(id,fixtures[id],false);assert.equal((await bridge(envelope(id))).status,'NG');assert.equal(calls.length,2);
 });
}
test('任意URL/SQL/コマンド・未知Tool・headless混在は実行前に拒否する',async()=>{
 const {bridge,calls}=setup('aidiy_sqlite',fixtures.aidiy_sqlite);
 for(const data of [{operation:'test',tool:'../bad'},{operation:'test',tool:'__proto__'},...['url','sql','args_str','headless'].map(key=>({...envelope('aidiy_sqlite').data,[key]:'bad'}))]){
  await assert.rejects(bridge({token:'fixture.jwt',data}),e=>e.status===400);
 }
 assert.equal(calls.length,0);
});
test('期限切れ・中止・同時実行を扱い、次の試験でロックを解放する',async()=>{
 const id='aidiy_sqlite';const {bridge}=setup(id,{authExpired:true});assert.equal((await bridge(envelope(id))).authExpired,true);
 let release;const pending=createToolsRepresentativeBridge({reader,requestFn:()=>new Promise(resolve=>release=resolve),timeoutMs:1000});
 const controller=new AbortController();const first=pending(envelope(id),{signal:controller.signal});
 await new Promise(resolve=>setImmediate(resolve));
 await assert.rejects(pending(envelope(id)),e=>e.status===409);
 controller.abort();await assert.rejects(first,e=>e.status===503);release({status:'OK'});
 const second=pending(envelope(id),{signal:AbortSignal.abort()});await assert.rejects(second,e=>e.status===503);
});
