// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {Readable} from 'node:stream';
import {createHandler} from '../diag/diag_main.mjs';
import {createCoreSettingsBridge,AI_SETTINGS_ACTIONS,AI_SETTINGS_BODY_LIMIT} from '../diag/AI設定/コア設定接続.mjs';
const ok=data=>({status:'OK',data});
const reader=async()=>JSON.stringify({PORT_CORE:8091});
const envelope=(data={},token='fixture.jwt.token')=>({token,data});
const rebootFlags=value=>Object.fromEntries(['reboot_core','reboot_apps','reboot_tools','reboot_local','reboot_task','reboot_team'].map(k=>[k,value]));
const mutation={セッションID:'fixture-session',モデル設定:{CHAT_AI_NAME:'openai'},再起動要求:rebootFlags(false),save:true};
function mock(){
 const calls=[];
 const requestFn=async request=>{
  calls.push(request);
  if(request.path===AI_SETTINGS_ACTIONS.ログイン)return ok({access_token:'fixture.jwt.token',private_key:'must-not-return'});
  if(request.path===AI_SETTINGS_ACTIONS.現在利用者)return ok({利用者ID:'fixture',利用者名:'Fixture',パスワード:'must-not-return'});
  if(request.path===AI_SETTINGS_ACTIONS.初期化)return ok({セッションID:'fixture-session',private_key:'must-not-return'});
  if(request.path===AI_SETTINGS_ACTIONS.取得)return ok({モデル設定:{CHAT_AI_NAME:'openai',OPENAI_API_KEY:'must-not-return'},available_models:{chat_models:{openai:{fixture:'Fixture'}},api_key:'must-not-return'},external_root_dic:{project:'/fixture'},private_key:'must-not-return'});
  if(request.path===AI_SETTINGS_ACTIONS.フォルダ参照)return ok({選択パス:'/fixture'});
  return ok({private_key:'must-not-return'});
 };
 return {calls,requestFn,bridge:createCoreSettingsBridge({reader,requestFn})};
}
test('fixed Core actions authenticate every request and filter sensitive response fields',async()=>{
 const {bridge,calls}=mock();
 assert.deepEqual((await bridge('ログイン',{data:{利用者ID:'fixture',パスワード:'fixture'}})).data,{access_token:'fixture.jwt.token',token_type:'bearer'});
 assert.equal(calls[0].token,undefined);
 for(const action of ['現在利用者','初期化','取得','設定','フォルダ参照']){
  const before=calls.length;
  const body=action==='取得'?{セッションID:'fixture-session'}:action==='設定'?mutation:action==='フォルダ参照'?{初期パス:''}:{};
  const response=await bridge(action,envelope(body));
  assert.equal(response.status,'OK');assert.ok(!JSON.stringify(response).includes('must-not-return'));
  assert.equal(calls[before].path,AI_SETTINGS_ACTIONS.現在利用者);
  assert.equal(calls.at(-1).path,AI_SETTINGS_ACTIONS[action]);
 }
 assert.ok(calls.every(c=>c.port===8091));
 assert.deepEqual(calls.find(c=>c.path===AI_SETTINGS_ACTIONS.取得).data,{セッションID:''});
 await bridge('設定',envelope({...mutation,モデル設定:{},save:false,再起動要求:rebootFlags(true)}));
 for(const data of [{...mutation,リセット:true},{...mutation,save:false},{...mutation,再起動要求:rebootFlags(true)},{...mutation,再起動要求:{}}])await assert.rejects(bridge('設定',envelope(data)),e=>e.status===400);
});
test('reject unknown actions, keys, invalid envelopes, arbitrary session and nonboolean restarts',async()=>{
 const {bridge,calls}=mock();
 for(const [action,input] of [['other',envelope()],['初期化',{data:{}}],['取得',envelope({セッションID:'other'})],['設定',envelope({...mutation,モデル設定:{OPENAI_API_KEY:'no'}})],['設定',envelope({...mutation,再起動要求:{reboot_core:'yes'}})],['初期化',envelope({セッションID:'other'})],['ログイン',{data:{利用者ID:'x',パスワード:'x'},url:'https://invalid'}]]){
  await assert.rejects(bridge(action,input),error=>[400,403,404].includes(error.status));
 }
 assert.ok(!calls.some(c=>c.path===AI_SETTINGS_ACTIONS.設定));
 await bridge('初期化',envelope());
 await assert.rejects(bridge('取得',envelope({セッションID:'fixture-session'},'other.jwt.token')),e=>e.status===403);
});
test('expired Core auth returns authExpired rather than Diag 401 and never invokes settings',async()=>{
 const paths=[];const bridge=createCoreSettingsBridge({reader,requestFn:async r=>{paths.push(r.path);return {authExpired:true};}});
 const response=await bridge('設定',envelope(mutation));assert.equal(response.authExpired,true);assert.deepEqual(paths,[AI_SETTINGS_ACTIONS.現在利用者]);
});
test('mutation single flight and unlock on error, config timeout and cancellation',async()=>{
 let release;const bridge=createCoreSettingsBridge({reader,requestFn:()=>new Promise(resolve=>{release=resolve;})});
 const pending=bridge('初期化',envelope());await new Promise(r=>setImmediate(r));
 await assert.rejects(bridge('設定',envelope(mutation)),e=>e.status===409);release({authExpired:true});await pending;
 const next=bridge('初期化',envelope());await new Promise(r=>setImmediate(r));release({authExpired:true});await next;
 const timeout=createCoreSettingsBridge({reader:()=>new Promise(()=>{}),timeoutMs:5});
 await assert.rejects(timeout('初期化',envelope()),e=>e.status===503);
 const controller=new AbortController();controller.abort();
 await assert.rejects(timeout('初期化',envelope(),{signal:controller.signal}),e=>e.status===503);
});
test('config destination must be a valid fixed loopback port',async()=>{
 for(const port of ['https://example.invalid',0,65536,1.5]){
  const bridge=createCoreSettingsBridge({reader:async()=>JSON.stringify({PORT_CORE:port}),requestFn:()=>assert.fail('must not connect')});
  await assert.rejects(bridge('現在利用者',envelope()),e=>e.status===503);
 }
});
async function handlerRequest(handler,{action='ログイン',method='POST',auth='Bearer diag-fixture',body={data:{利用者ID:'fixture',パスワード:'fixture'}},headers={}}={}){
 const req=Readable.from([Buffer.from(typeof body==='string'?body:JSON.stringify(body))]);
 Object.assign(req,{url:'/api/AI設定/'+encodeURIComponent(action),method,headers:{authorization:auth,'content-type':'application/json',host:'127.0.0.1:8097',...headers}});
 const res={writeHead(status){this.status=status;},end(body){this.body=JSON.parse(body.toString());}};
 await handler(req,res);return res;
}
test('Diag route keeps token gate, same-origin and bounded POST JSON, authExpired stays HTTP200',async()=>{
 let count=0;const handler=createHandler({token:'diag-fixture',coreSettingsBridge:async()=>{count++;return {status:'NG',authExpired:true};}});
 for(const [options,status] of [[{auth:''},401],[{action:'other'},404],[{method:'GET'},405],[{headers:{origin:'https://evil.invalid'}},403],[{headers:{'sec-fetch-site':'cross-site'}},403],[{headers:{'content-type':'text/plain'}},400],[{body:'{'},400],[{headers:{'content-length':String(AI_SETTINGS_BODY_LIMIT+1)}},413],[{body:' '.repeat(AI_SETTINGS_BODY_LIMIT+1)},413]]){
  assert.equal((await handlerRequest(handler,options)).status,status);
 }
 assert.equal(count,0);
 const response=await handlerRequest(handler,{headers:{origin:'http://127.0.0.1:8097'}});assert.equal(response.status,200);assert.equal(response.body.authExpired,true);assert.equal(count,1);
});
test('real transport mock: no redirects, bounded responses, timeout and safe errors',async()=>{
 let mode='ok';let hits=0;
 const server=http.createServer((req,res)=>{hits++;req.resume();if(mode==='wait')return;if(mode==='redirect'){res.writeHead(302,{Location:'http://example.invalid/'});return res.end();}if(mode==='auth'){res.writeHead(401);return res.end('secret');}if(mode==='large')return res.end('x'.repeat(AI_SETTINGS_BODY_LIMIT+1));if(mode==='invalid')return res.end('secret invalid JSON');res.end(JSON.stringify(ok({利用者ID:'fixture'})));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const bridge=createCoreSettingsBridge({reader:async()=>JSON.stringify({PORT_CORE:server.address().port}),timeoutMs:100});
  assert.equal((await bridge('現在利用者',envelope())).status,'OK');
  mode='auth';assert.equal((await bridge('現在利用者',envelope())).authExpired,true);
  for(const value of ['redirect','large','invalid','wait']){mode=value;const before=hits;await assert.rejects(bridge('現在利用者',envelope()),e=>[502,503].includes(e.status)&&!e.message.includes('secret'));assert.equal(hits,before+1);}
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('save reload reads persisted Core configuration rather than stale session settings',async()=>{
 let stored='old-model';const requests=[];
 const bridge=createCoreSettingsBridge({reader,requestFn:async r=>{
  requests.push(r);
  if(r.path===AI_SETTINGS_ACTIONS.現在利用者)return ok({利用者ID:'fixture'});
  if(r.path===AI_SETTINGS_ACTIONS.初期化)return ok({セッションID:'fixture-session'});
  if(r.path===AI_SETTINGS_ACTIONS.設定){stored=r.data.モデル設定.CHAT_OPENAI_MODEL;return ok({});}
  if(r.path===AI_SETTINGS_ACTIONS.取得)return ok({モデル設定:{CHAT_OPENAI_MODEL:r.data.セッションID?'stale-session-model':stored}});
  assert.fail('unexpected action');
 }});
 await bridge('初期化',envelope());
 assert.equal((await bridge('取得',envelope({セッションID:'fixture-session'}))).data.モデル設定.CHAT_OPENAI_MODEL,'old-model');
 await bridge('設定',envelope({...mutation,モデル設定:{CHAT_OPENAI_MODEL:'new-model'}}));
 assert.equal((await bridge('取得',envelope({セッションID:'fixture-session'}))).data.モデル設定.CHAT_OPENAI_MODEL,'new-model');
 assert.equal(requests.filter(r=>r.path===AI_SETTINGS_ACTIONS.取得).length,2);
});
test('Core NG response messages and unrecognized transport exceptions never expose secrets',async()=>{
 const bridge=createCoreSettingsBridge({reader,requestFn:async()=>({status:'NG',message:'secret fixture credential',data:{API_KEY:'secret'}})});
 const response=await bridge('ログイン',{data:{利用者ID:'fixture',パスワード:'fixture'}});
 assert.ok(!JSON.stringify(response).includes('secret'));
 const handler=createHandler({token:'diag-fixture',coreSettingsBridge:async()=>{throw new Error('secret fixture credential');}});
 const result=await handlerRequest(handler);assert.equal(result.status,503);assert.ok(!JSON.stringify(result.body).includes('secret'));
});

test('AI settings filters Slack credential fields from success data and never echoes credential errors',async()=>{
 const secrets={slack_bot_token:'xoxb-fixture-slack-bot',slack_app_token:'xapp-fixture-slack-app'};
 const configured=async()=>JSON.stringify({PORT_CORE:8091,...secrets});
 const bridge=createCoreSettingsBridge({reader:configured,requestFn:async r=>{
  if(r.path===AI_SETTINGS_ACTIONS.現在利用者)return ok({利用者ID:'fixture',...secrets});
  if(r.path===AI_SETTINGS_ACTIONS.初期化)return ok({セッションID:'fixture-session',...secrets});
  if(r.path===AI_SETTINGS_ACTIONS.取得)return ok({モデル設定:{CHAT_AI_NAME:'openai',...secrets},...secrets});
  return {status:'NG',message:Object.values(secrets).join(' '),data:secrets};
 }});
 for(const [action,data] of [['現在利用者',{}],['初期化',{}],['取得',{セッションID:'fixture-session'}],['設定',mutation]]){
  const response=await bridge(action,envelope(data));
  for(const value of Object.values(secrets))assert.ok(!JSON.stringify(response).includes(value));
 }
 const handler=createHandler({token:'diag-fixture',coreSettingsBridge:async()=>{throw Error(Object.values(secrets).join(' '));}});
 const failed=await handlerRequest(handler);assert.equal(failed.status,503);
 for(const value of Object.values(secrets))assert.ok(!JSON.stringify(failed.body).includes(value));
});

test('free OpenRouter model is whitelisted end to end but API keys remain private and unwritable',async()=>{
 const calls=[];
 const settings={CHAT_AI_NAME:'openrt_free',CHAT_OPENRT_FREE_MODEL:'vendor/new:free',CHAT_OPENRT_MODEL:'vendor/paid',openrt_key_id:'must-not-return',openrt_free_key_id:'must-not-return'};
 const bridge=createCoreSettingsBridge({reader,requestFn:async request=>{
  calls.push(request);
  if(request.path===AI_SETTINGS_ACTIONS.現在利用者)return ok({利用者ID:'fixture'});
  if(request.path===AI_SETTINGS_ACTIONS.初期化)return ok({セッションID:'fixture-session'});
  if(request.path===AI_SETTINGS_ACTIONS.取得)return ok({モデル設定:settings,available_models:{chat_models:{openrt_free:{'vendor/new:free':'Free'}}}});
  return ok({});
 }});
 await bridge('初期化',envelope());
 const loaded=await bridge('取得',envelope({セッションID:'fixture-session'}));
 assert.equal(loaded.data.モデル設定.CHAT_OPENRT_FREE_MODEL,'vendor/new:free');
 assert.deepEqual(loaded.data.available_models.chat_models.openrt_free,{'vendor/new:free':'Free'});
 assert.ok(!JSON.stringify(loaded).includes('must-not-return'));
 await bridge('設定',envelope({...mutation,モデル設定:loaded.data.モデル設定}));
 assert.equal(calls.at(-1).data.モデル設定.CHAT_OPENRT_FREE_MODEL,'vendor/new:free');
 for(const key of ['openrt_key_id','openrt_free_key_id'])await assert.rejects(bridge('設定',envelope({...mutation,モデル設定:{[key]:'secret'}})),e=>e.status===400);
});
