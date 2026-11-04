// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// Diag の起動認証とは別に、Core の利用者認証を毎回検証する固定用途の中継。
import http from 'node:http';
import {DIAG_TRANSPORT_BYTE_LIMIT} from '../runtime/transport_limit.mjs';
import {createHash} from 'node:crypto';
import {readConfig} from '../runtime/model_probe.mjs';

export const AI_SETTINGS_ACTIONS=Object.freeze({
  ログイン:'/core/auth/ログイン', 現在利用者:'/core/auth/現在利用者',
  初期化:'/core/AIコア/初期化', 取得:'/core/AIコア/モデル情報/取得',
  設定:'/core/AIコア/モデル情報/設定', フォルダ参照:'/core/AIコア/フォルダ参照',
});
export const AI_SETTINGS_BODY_LIMIT=DIAG_TRANSPORT_BYTE_LIMIT;
const RESPONSE_LIMIT=DIAG_TRANSPORT_BYTE_LIMIT;
const failure=(status,message)=>Object.assign(new Error(message),{status});
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const safeText=(value,max=8192)=>typeof value==='string'&&value.length<=max&&!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value);
const authExpired=()=>({status:'NG',message:'Core の認証が失効しました。再ログインしてください。',authExpired:true,data:{}});
const digest=token=>createHash('sha256').update(token).digest('hex');
export const MODEL_SETTING_KEYS=Object.freeze(["CHAT_AI_NAME", "CHAT_GEMINI_MODEL", "CHAT_FREEAI_MODEL", "CHAT_OPENRT_MODEL", "CHAT_OPENAI_MODEL", "CHAT_OLLAMA_MODEL", "CHAT_LOCAL_MODEL", "LIVE_AI_NAME", "LIVE_GEMINI_MODEL", "LIVE_GEMINI_VOICE", "LIVE_FREEAI_MODEL", "LIVE_FREEAI_VOICE", "LIVE_OPENAI_MODEL", "LIVE_OPENAI_VOICE", "PREDICTION_AI_NAME", "PREDICTION_OPENAI_MODEL", "PREDICTION_OAUTH_MODEL", "PREDICTION_GEMINI_MODEL", "PREDICTION_FREEAI_MODEL", "PREDICTION_CODEX_CLI_MODEL", "PREDICTION_COPILOT_CLI_MODEL", "PREDICTION_AIDIY_HERMES_MODEL", "DECISION_AI_NAME", "DECISION_OPENAI_MODEL", "DECISION_OAUTH_MODEL", "DECISION_GEMINI_MODEL", "DECISION_FREEAI_MODEL", "CODE_AI1_NAME", "CODE_AI2_NAME", "CODE_AI3_NAME", "CODE_AI4_NAME", "CODE_AI5_NAME", "CODE_AI6_NAME", "CODE_AI1_MODEL", "CODE_AI2_MODEL", "CODE_AI3_MODEL", "CODE_AI4_MODEL", "CODE_AI5_MODEL", "CODE_AI6_MODEL", "CODE_CLAUDE_SDK_MODEL", "CODE_CLAUDE_CLI_MODEL", "CODE_COPILOT_CLI_MODEL", "CODE_ANTIGRAVITY_CLI_MODEL", "CODE_CODEX_CLI_MODEL", "CODE_AIDIY_HERMES_MODEL", "CODE_OPENCODE_CLI_MODEL", "CODE_GROK_CLI_MODEL", "CODE_CLAUDE_OLLAMA_MODEL", "CODE_CODEX_OLLAMA_MODEL", "CODE_BASE_PATH", "CODE_MAX_TURNS", "CODE_PLAN", "CODE_VERIFY", "CODE_PERMISSIONS", "CODE_SELF_CHECK_LOOP", "TASK_AI_NAME", "TASK_AI_MODEL_plan", "TASK_AI_MODEL_do", "TASK_AI_MODEL_check", "TEAM_AI_NAME", "TEAM_AI_MODEL_plan", "TEAM_AI_MODEL_do", "TEAM_AI_MODEL_check"]);
const settingsKeys=new Set(MODEL_SETTING_KEYS);
const rebootKeys=new Set(['reboot_core','reboot_apps','reboot_tools','reboot_local','reboot_task','reboot_team']);
function validate(action,envelope){
 if(!Object.hasOwn(AI_SETTINGS_ACTIONS,action))throw failure(404,'操作が見つかりません。');
 if(!object(envelope)||Object.keys(envelope).some(k=>!['token','data'].includes(k))||!object(envelope.data))throw failure(400,'入力が不正です。');
 const {token,data}=envelope;
 if(action!=='ログイン'&&(!safeText(token,8192)||!token||/[\r\n]/.test(token)))throw failure(403,'Core へのログインが必要です。');
 const allowed={ログイン:['利用者ID','パスワード'],現在利用者:[],初期化:[],取得:['セッションID'],設定:['セッションID','モデル設定','再起動要求','save','リセット'],フォルダ参照:['初期パス']}[action];
 if(Object.keys(data).some(k=>!allowed.includes(k)))throw failure(400,'指定できない項目があります。');
 if(action==='ログイン'&&(!safeText(data.利用者ID,256)||!data.利用者ID||!safeText(data.パスワード,4096)))throw failure(400,'ログイン入力が不正です。');
 if(['取得','設定'].includes(action)&&(!safeText(data.セッションID,256)||!data.セッションID))throw failure(400,'セッションを選択してください。');
 if(action==='フォルダ参照'&&!safeText(data.初期パス??'',4096))throw failure(400,'フォルダが不正です。');
 if(action==='設定'){
  if(!object(data.モデル設定)||Object.entries(data.モデル設定).some(([k,v])=>!settingsKeys.has(k)||!(safeText(v,4096)||(typeof v==='number'&&Number.isFinite(v))||typeof v==='boolean')))throw failure(400,'モデル設定が不正です。');
  if(!object(data.再起動要求)||Object.entries(data.再起動要求).some(([k,v])=>!rebootKeys.has(k)||typeof v!=='boolean'))throw failure(400,'再起動指定が不正です。');
  if(['save','リセット'].some(k=>data[k]!==undefined&&typeof data[k]!=='boolean'))throw failure(400,'保存指定が不正です。');
  const flags=[...rebootKeys].map(k=>data.再起動要求[k]);
  const saveOnly=data.save===true&&flags.every(v=>v===false);
  const restartOnly=data.save===false&&Object.keys(data.モデル設定).length===0&&flags.every(v=>v===true);
  if(data.リセット===true||(!saveOnly&&!restartOnly))throw failure(400,'永続設定の保存、または全AIの再起動のみ指定できます。');
 }
 return {token,data};
}
function bounded(promise,signal,timeoutMs){
 return new Promise((resolve,reject)=>{
  const abort=()=>finish(failure(503,'Core への接続を中止しました。'));
  const timer=setTimeout(()=>finish(failure(503,'Core の応答を確認できませんでした。')),timeoutMs);
  const finish=(error,value)=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(value);};
  signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted){abort();return;}
  promise.then(value=>finish(null,value),()=>finish(failure(503,'Core の接続設定を確認してください。')));
 });
}
function requestCore({port,path,token,data,signal,timeoutMs}){
 return new Promise((resolve,reject)=>{
  let req,res,done=false;const chunks=[];
  const finish=(error,result)=>{if(done)return;done=true;chunks.length=0;clearTimeout(timer);signal?.removeEventListener('abort',abort);res?.destroy();req?.destroy();error?reject(error):resolve(result);};
  const abort=()=>finish(failure(503,'Core への接続を中止しました。'));
  const timer=setTimeout(()=>finish(failure(503,'Core の応答を確認できませんでした。')),timeoutMs);
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)return abort();
  const payload=Buffer.from(JSON.stringify(data));
  req=http.request({hostname:'127.0.0.1',port,path:encodeURI(path),method:'POST',agent:false,maxHeaderSize:8192,headers:{'Content-Type':'application/json','Content-Length':payload.length,Accept:'application/json',...(token?{Authorization:`Bearer ${token}`}:{})}},incoming=>{
   res=incoming;if(done){res.destroy();return;}let size=0;
   res.on('error',abort);res.on('aborted',abort);
   res.on('data',chunk=>{if(done)return;size+=chunk.length;if(size>RESPONSE_LIMIT)return finish(failure(502,'Core の応答が大きすぎます。'));chunks.push(chunk);});
   res.on('end',()=>{if(done)return;if(res.statusCode===401||res.statusCode===403)return finish(null,{authExpired:true});if(res.statusCode<200||res.statusCode>=300)return finish(failure(503,'Core の応答を確認できませんでした。'));try{const body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));if(!object(body))throw Error();finish(null,body);}catch{finish(failure(502,'Core の応答形式が不正です。'));}});
   res.on('close',()=>{if(!res.complete)abort();});
  });req.on('error',abort);req.end(payload);
 });
}
function stringMap(value){if(!object(value))return {};return Object.fromEntries(Object.entries(value).filter(([k,v])=>safeText(k,4096)&&safeText(v,8192)&&!['__proto__','constructor','prototype'].includes(k)));}
function catalog(value){if(!object(value))return {};return Object.fromEntries(Object.entries(value).filter(([k])=>safeText(k,200)&&!['__proto__','constructor','prototype'].includes(k)).map(([k,v])=>[k,stringMap(v)]));}
function result(action,response){
 if(response.authExpired)return authExpired();
 if(response.status!=='OK')return {status:'NG',message:action==='ログイン'?'利用者IDまたはパスワードを確認してください。':'Core の処理に失敗しました。設定・接続状態を確認してください。',data:{}};
 const data=object(response.data)?response.data:{};let clean={};
 if(action==='ログイン'){
  if(!safeText(data.access_token,8192)||!data.access_token||/[\r\n]/.test(data.access_token))throw failure(502,'Core の認証応答が不正です。');
  clean={access_token:data.access_token,token_type:'bearer'};
 }else if(action==='現在利用者')clean={利用者ID:safeText(data.利用者ID,256)?data.利用者ID:'',利用者名:safeText(data.利用者名,256)?data.利用者名:''};
 else if(action==='初期化'){if(!safeText(data.セッションID,256)||!data.セッションID)throw failure(502,'Core のセッション応答が不正です。');clean={セッションID:data.セッションID};}
 else if(action==='取得'){
  const models=object(data.available_models)?data.available_models:{};
  clean={available_models:Object.fromEntries(['chat_models','live_models','live_voices','code_models','prediction_models','decision_models'].map(k=>[k,catalog(models[k])])),モデル設定:Object.fromEntries(Object.entries(object(data.モデル設定)?data.モデル設定:{}).filter(([k,v])=>settingsKeys.has(k)&&(safeText(v,4096)||typeof v==='boolean'||(typeof v==='number'&&Number.isFinite(v))))),external_root_dic:stringMap(data.external_root_dic)};
 }else if(action==='フォルダ参照')clean={選択パス:safeText(data.選択パス,4096)?data.選択パス:''};
 return {status:'OK',message:'処理が完了しました。',data:clean};
}
export function createCoreSettingsBridge({reader,requestFn=requestCore,timeoutMs=120000,now=Date.now}={}){
 let busy=false;const sessions=new Map();
 return async function bridge(action,envelope,{signal}={}){
  const {token,data}=validate(action,envelope);
  const mutating=['初期化','設定','フォルダ参照'].includes(action);
  if(mutating&&busy)throw failure(409,'AI設定の操作中です。完了後に再試行してください。');
  if(mutating)busy=true;
  try{
   const [state,config]=await bounded(readConfig(reader),signal,Math.min(timeoutMs,5000));const raw=config.PORT_CORE??8091;
   if(state==='読込不可'||!['string','number'].includes(typeof raw)||!/^\d+$/.test(String(raw).trim())||!Number.isInteger(Number(raw))||Number(raw)<1||Number(raw)>65535)throw failure(503,'Core の接続設定を確認してください。');
   const call=(path,body,credential=token)=>requestFn({port:Number(raw),path,token:credential,data:body,signal,timeoutMs});
   if(action!=='ログイン'){
    const auth=await call(AI_SETTINGS_ACTIONS.現在利用者,{});
    if(auth.authExpired||auth.status!=='OK'){sessions.delete(digest(token));return authExpired();}
    if(action==='現在利用者')return result(action,auth);
   }
   for(const [key,entry] of sessions)if(now()-entry.time>24*60*60*1000)sessions.delete(key);
   if(['取得','設定'].includes(action)&&sessions.get(digest(token))?.id!==data.セッションID)throw failure(403,'この画面のセッションを初期化してください。');
   // 取得はセッションに残る編集値ではなく、永続設定を表示する。所有確認は上で行う。
   const body=action==='取得'?{セッションID:''}:data;
   const clean=result(action,await call(AI_SETTINGS_ACTIONS[action],body,action==='ログイン'?undefined:token));
   if(action==='初期化'&&clean.status==='OK'){
    if(sessions.size>=128)sessions.delete(sessions.keys().next().value);
    sessions.set(digest(token),{id:clean.data.セッションID,time:now()});
   }
   return clean;
  }finally{if(mutating)busy=false;}
 };
}
