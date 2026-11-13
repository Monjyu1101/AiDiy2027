// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {callMcp,createModelTrials} from '../diag/モデル試行/trials.mjs';

const config={PORT_TOOLS:8095,CODE_BASE_PATH:'/synthetic/project',DECISION_AI_NAME:'auto'};
const row={区分:'DECISION',プロバイダ:'auto',モデル:'auto'};
function requestFor(detail,kind='tool'){
 return async ({body,method})=>{
  if(method==='DELETE'||body?.method==='notifications/initialized')return {body:null};
  const result=body.method==='initialize'?{protocolVersion:'2024-11-05'}:{isError:true,content:[{type:'text',text:detail}]};
  return {session:'fixture',body:{jsonrpc:'2.0',id:body.id,...(body.method==='tools/call'&&kind==='rpc'?{error:{code:-32603,message:detail}}:{result})}};
 };
}
test('decision MCP errors preserve known HTTP route and status without raw payload',async()=>{
 for(const kind of ['tool','rpc'])for(const [detail,expected] of [
  ['Decisions API HTTP 403（APIキー・利用権限・課金・入力を確認）','OpenAI Decisions API（APIキー方式） が HTTP 403'],
  ['OAuth Responses HTTP 401（認証・モデル・JSON Schema対応を確認）','OpenAI OAuth Responses が HTTP 401'],
  ['Gemini JSON判断 HTTP 429（APIキー・モデル・JSON対応・利用制限を確認）','Gemini / FreeAI JSON判断 が HTTP 429'],
 ]){
  await assert.rejects(()=>callMcp(row,config,{request:requestFor(`${detail} secret-not-for-ui https://secret.example/private`,kind)}),e=>{
   assert.ok(e.message.startsWith(expected));assert.doesNotMatch(e.message,/secret|private/);assert.equal(e.trialFailure,true);return true;
  });
 }
});
test('decision known availability/config/model failures use fixed safe messages',async()=>{
 for(const [detail,expected] of [
  ['現在利用不可：AI判断の起動チェックが未完了です。','起動チェックが未完了'],
  ['現在利用不可：すべてのAI判断プロバイダが利用できません。','利用可能なプロバイダがありません'],
  ['未対応のAI判断プロバイダ: secret-not-for-ui','プロバイダ設定が未対応'],
  ['ai_name と model のプロバイダが競合しています','プロバイダとモデルの指定が競合'],
  ['openai_key_id が未設定です','APIキーが未設定'],
  ['Codex OAuth認証が必要です。','OAuth認証が必要'],
  ['AI判断がタイムアウトしました','タイムアウト'],
 ])await assert.rejects(()=>callMcp(row,config,{request:requestFor(detail)}),e=>{assert.ok(e.message.includes(expected));assert.doesNotMatch(e.message,/secret-not-for-ui/);return true;});
});
test('unknown errors and all non-decision errors remain generic',async()=>{
 for(const kind of ['tool','rpc']){
  const expected=kind==='tool'?'MCP ツールがエラーを返しました。':'MCP ツールの実行に失敗しました。';
  await assert.rejects(()=>callMcp(row,config,{request:requestFor('secret-not-for-ui HTTP 401',kind)}),{message:expected});
  await assert.rejects(()=>callMcp({区分:'CHAT',プロバイダ:'openai_oauth',モデル:'gpt-6-luna'},config,{request:requestFor('OAuth Responses HTTP 401 secret-not-for-ui',kind)}),{message:expected});
 }
});
test('decision trial displays mapped failure instead of erasing its reason',async()=>{
 const trials=createModelTrials({reader:()=>JSON.stringify(config),statusFn:async()=>({online:true}),request:requestFor('Decisions API HTTP 403 secret-not-for-ui')});
 try{const start=await trials.start({rowId:'DECISION'});const result=await trials.next(start.実行ID,'DECISION');assert.equal(result.状態,'NG');assert.match(result.説明,/Decisions API.*HTTP 403/);assert.doesNotMatch(JSON.stringify(result),/secret-not-for-ui/);}finally{await trials.close();}
});

test('decision malformed and incomplete provider replies use fixed safe categories',async()=>{
 for(const kind of ['tool','rpc'])for(const [detail,expected] of [
  ['Gemini JSON判断は入力を拒否しました','Gemini / FreeAI JSON判断が入力を拒否しました。'],
  ['Gemini JSON判断の回答候補が不正です','Gemini / FreeAI JSON判断の回答候補が不正です。'],
  ['Gemini JSON判断が拒否・未完了・異常終了しました','Gemini / FreeAI JSON判断が拒否・未完了・異常終了しました。'],
  ['Gemini JSON判断の本文がありません','Gemini / FreeAI JSON判断の応答本文がありません。'],
  ['Gemini JSON判断の本文形式が不正です','Gemini / FreeAI JSON判断の応答本文形式が不正です。'],
  ['OAuth Responses が失敗または未完了で終了しました','OpenAI OAuth Responses が失敗または未完了で終了しました。'],
  ['OAuth Responses の完了状態が不正です','OpenAI OAuth Responses の完了状態が不正です。'],
  ['OAuth Responses のストリームが完了前に切断されました','OpenAI OAuth Responses のストリームが完了前に切断されました。'],
 ])await assert.rejects(()=>callMcp(row,config,{request:requestFor(`${detail} secret-not-for-ui`,kind)}),{message:expected});
});
