// Diag起動認証に加え、Tools側でCore利用者を毎回再検証する固定用途の中継。
import http from 'node:http';
import {DIAG_TRANSPORT_BYTE_LIMIT} from '../runtime/transport_limit.mjs';
import {readConfig} from '../runtime/model_probe.mjs';
import {代表試験,試験結果} from './代表試験.mjs';
export const TOOLS_SETTINGS_ACTIONS=Object.freeze({enabled:'/management/enabled',defaults:'/management/defaults'});
export const TOOLS_SETTINGS_BODY_LIMIT=DIAG_TRANSPORT_BYTE_LIMIT;
export const TOOLS_REPRESENTATIVE_BYTE_LIMIT=DIAG_TRANSPORT_BYTE_LIMIT;
export const BACKUP_REPRESENTATIVE_TIMEOUT_MS=300000;
// 設定読取5秒 + Core/有効確認各30秒 + Backup5分 + 余裕5秒。
export const BACKUP_REPRESENTATIVE_RESPONSE_TIMEOUT_MS=370000;
export const TOOL_IDS=Object.freeze(['aidiy_chrome_devtools','aidiy_desktop_capture','aidiy_sqlite','aidiy_postgres','aidiy_logs','aidiy_code_check','aidiy_backup','aidiy_image_generation','aidiy_movie_generation','aidiy_speech_to_text','aidiy_text_to_speech','aidiy_obs_studio_control','aidiy_ffmpeg_control','aidiy_notification_sounds','aidiy_code_agents','aidiy_chat_llms','aidiy_decisions_check','aidiy_task_agents','aidiy_team_agents','aidiy_windows_control']);
export const DEFAULT_FIELDS=Object.freeze({text_to_speech:['auto_provider','auto_voice'],speech_to_text:['auto_provider'],image_generation:['auto_provider'],movie_generation:['auto_provider','auto_model','auto_aspect_ratio','auto_resolution']});
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const text=v=>typeof v==='string'&&v.length>0&&v.length<=128&&!/[\x00-\x1f\x7f]/.test(v);
const failure=(status,message)=>Object.assign(new Error(message),{status});
const authExpired=()=>({status:'NG',authExpired:true,message:'Core へ再ログインしてください。',data:{}});
function validate(action,envelope){
 if(!Object.hasOwn(TOOLS_SETTINGS_ACTIONS,action))throw failure(404,'操作が見つかりません。');
 if(!object(envelope)||Object.keys(envelope).some(k=>!['token','data'].includes(k))||!object(envelope.data))throw failure(400,'入力が不正です。');
 const {token,data}=envelope;
 if(typeof token!=='string'||!token||token.length>8192||/[\x00-\x20\x7f]/.test(token))throw failure(403,'Core へのログインが必要です。');
 if(Object.keys(data).some(k=>![action,'write'].includes(k))||(data.write!==undefined&&typeof data.write!=='boolean'))throw failure(400,'設定項目が不正です。');
 if(data[action]!==undefined){
  const value=data[action];if(!object(value))throw failure(400,'設定はオブジェクトで指定してください。');
  if(action==='enabled'){
   if(Object.entries(value).some(([k,v])=>!TOOL_IDS.includes(k)||typeof v!=='boolean'))throw failure(400,'有効無効の指定が不正です。');
  }else for(const [group,fields] of Object.entries(value)){
   if(!Object.hasOwn(DEFAULT_FIELDS,group)||!object(fields)||Object.entries(fields).some(([k,v])=>!DEFAULT_FIELDS[group].includes(k)||!text(v)))throw failure(400,'既定値の指定が不正です。');
  }
 }
 return {token,data};
}
function bounded(promise,signal,timeoutMs){
 return new Promise((resolve,reject)=>{
  let done=false;const finish=(err,result)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);err?reject(err):resolve(result);};
  const abort=()=>finish(failure(503,'Tools への接続を中止しました。'));
  const timer=setTimeout(()=>finish(failure(503,'Tools の応答を確認できませんでした。')),timeoutMs);
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){abort();return;}
  promise.then(value=>finish(null,value),()=>finish(failure(503,'Tools の接続設定を確認してください。')));
 });
}
function requestTools({port,path,token,data,signal,timeoutMs,method='POST',responseLimit=DIAG_TRANSPORT_BYTE_LIMIT}){
 return new Promise((resolve,reject)=>{
  let req,res,done=false;const chunks=[];
  const finish=(err,value)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);chunks.length=0;res?.destroy();req?.destroy();err?reject(err):resolve(value);};
  const abort=()=>finish(failure(503,'Tools の接続を確認できませんでした。'));
  const timer=setTimeout(abort,timeoutMs);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)return abort();
  const payload=Buffer.from(method==='GET'?'':JSON.stringify(data));
  try{req=http.request({hostname:'127.0.0.1',port,path:encodeURI(path),method,agent:false,maxHeaderSize:8192,headers:{'Content-Type':'application/json','Content-Length':payload.length,Authorization:`Bearer ${token}`,Accept:'application/json'}},incoming=>{
   res=incoming;if(done){res.destroy();return;}let size=0;
   res.on('error',abort);res.on('aborted',abort);
   res.on('data',chunk=>{if(done)return;size+=chunk.length;if(size>responseLimit)return abort();chunks.push(chunk);});
   res.on('end',()=>{
    if(done)return;if([401,403].includes(res.statusCode))return finish(null,{authExpired:true});
    if(res.statusCode<200||res.statusCode>=300)return finish(null,{status:'NG'});
    try{const body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));if(!object(body))throw Error();finish(null,body);}catch{abort();}
   });res.on('close',()=>{if(!res.complete)abort();});
  });req.on('error',abort);req.end(payload);}catch{abort();}
 });
}
function clean(response){
 if(response.authExpired)return authExpired();
 if(response.status!=='OK')return {status:'NG',message:'Tools の処理に失敗しました。設定・利用状態を確認してください。',data:{}};
 const data=object(response.data)?response.data:{};
 const defaults={},schema={};
 for(const [group,fields] of Object.entries(DEFAULT_FIELDS)){
  defaults[group]={};schema[group]={};
  for(const field of fields){
   if(text(data.defaults?.[group]?.[field]))defaults[group][field]=data.defaults[group][field];
   const choices=data.schema?.[group]?.[field];
   if(Array.isArray(choices))schema[group][field]=choices.filter(text).slice(0,32);
  }
 }
 const tools=(Array.isArray(data.tools)?data.tools:[]).filter(row=>object(row)&&TOOL_IDS.includes(row.id)).map(row=>({id:row.id,enabled:row.enabled===true,available:row.available===true,status:typeof row.status==='string'&&row.status.length<=64?row.status:'unknown',label:text(row.label)?row.label:row.id,defaultsKey:Object.hasOwn(DEFAULT_FIELDS,row.defaultsKey)?row.defaultsKey:null}));
 return {status:'OK',message:'処理が完了しました。',data:{tools,defaults,schema,...(typeof data.saved==='boolean'?{saved:data.saved}:{})}};
}
export function createToolsSettingsBridge({reader,requestFn=requestTools,timeoutMs=15000}={}){
 return async function bridge(action,envelope,{signal}={}){
  const {token,data}=validate(action,envelope);
  const [state,config]=await bounded(readConfig(reader),signal,Math.min(timeoutMs,5000));
  const raw=config.PORT_TOOLS??8095;
  if(state==='読込不可'||!['number','string'].includes(typeof raw)||!/^\d+$/.test(String(raw).trim())||!Number.isInteger(Number(raw))||Number(raw)<1||Number(raw)>65535)throw failure(503,'Tools の接続設定を確認してください。');
  return clean(await bounded(requestFn({port:Number(raw),path:TOOLS_SETTINGS_ACTIONS[action],token,data,signal,timeoutMs}),signal,timeoutMs));
 };
}

// 設定管理とは別の代表機能試行。任意URL/コマンド/パスを受け付けない。
export function createToolsRepresentativeBridge({reader,requestFn=requestTools,timeoutMs=30000,backupTimeoutMs=BACKUP_REPRESENTATIVE_TIMEOUT_MS}={}){
 let busy=false;
 return async function representative(envelope,{signal}={}){
  if(!object(envelope)||!object(envelope.data)||Object.keys(envelope).some(k=>!['token','data'].includes(k)))throw failure(400,'入力が不正です。');
  const {token}=validate('enabled',{token:envelope.token,data:{}});
  const data=envelope.data;
  const simple=data.operation==='test';
  const backup=simple&&data.tool==='aidiy_backup';
  if(simple){
   const fields=backup?['operation','tool','batch']:['operation','tool'];
   if(Object.keys(data).some(k=>!fields.includes(k))||typeof data.tool!=='string'||!Object.hasOwn(代表試験,data.tool)||(backup&&Object.hasOwn(data,'batch')&&typeof data.batch!=='boolean'))throw failure(400,'試行条件が不正です。');
  }else if(Object.keys(data).some(k=>!['operation','headless'].includes(k))||!['open','close'].includes(data.operation)||(data.headless!==undefined&&typeof data.headless!=='boolean'))throw failure(400,'試行条件が不正です。');
  const toolId=simple?data.tool:'aidiy_chrome_devtools';
  if(busy)throw failure(409,'Tools試行中です。完了後に再試行してください。');
  busy=true;
  try{
   const [state,config]=await bounded(readConfig(reader),signal,Math.min(timeoutMs,5000));
   const ports=[config.PORT_CORE??8091,config.PORT_TOOLS??8095];
   if(state==='読込不可'||ports.some(raw=>!['number','string'].includes(typeof raw)||!/^\d+$/.test(String(raw).trim())||!Number.isInteger(Number(raw))||Number(raw)<1||Number(raw)>65535))throw failure(503,'Core / Tools の接続設定を確認してください。');
   const call=(port,path,body,method='POST',limit=timeoutMs,responseLimit=DIAG_TRANSPORT_BYTE_LIMIT)=>bounded(requestFn({port:Number(port),path,token,data:body,signal,timeoutMs:limit,method,responseLimit}),signal,limit);
   const auth=await call(ports[0],'/core/auth/現在利用者',{});
   if(auth.authExpired||auth.status!=='OK')return authExpired();
   const stateResponse=await call(ports[1],'/management/enabled',{});
   if(stateResponse.authExpired)return authExpired();
   const tool=stateResponse.data?.tools?.find(row=>row.id===toolId);
   if(stateResponse.status!=='OK'||tool?.enabled!==true||tool?.available!==true)return {status:'NG',message:'選択したToolsはサービス外です。導入状態と有効設定を確認してください。',data:{}};
   if(simple){
    const test=代表試験[toolId];
    const payload=backup?{batch:data.batch??false}:test.body;
    let response;
    try{response=await call(ports[1],`/${toolId}/${test.method}`,payload,test.httpMethod||'POST',backup?backupTimeoutMs:timeoutMs,TOOLS_REPRESENTATIVE_BYTE_LIMIT);}
    catch(error){if(backup)throw failure(error.status||503,'バックアップの応答を確認できませんでした。処理が継続している場合があります。Toolsログを確認してから再試行してください。');throw error;}
    if(response.authExpired)return authExpired();
    const summary=backup&&response.batch!==payload.batch?null:試験結果(toolId,response);
    return summary?{status:'OK',message:summary,data:{summary}}:{status:'NG',message:'試験に失敗しました。対象サービスの起動・接続設定・Toolsログを確認してください。',data:{}};
   }
   const operation=data.operation==='open'?'open_session':'close_session';
   const payload={session:'diag-tools-test',...(operation==='open_session'?{headless:data.headless??false,show_automation_banner:true}:{})};
   const response=await call(ports[1],'/aidiy_chrome_devtools/'+operation,payload,'POST',timeoutMs,TOOLS_REPRESENTATIVE_BYTE_LIMIT);
   if(response.authExpired)return authExpired();
   // 任意本文やローカルパスを表示せず、既存APIの成功契約だけ認める。
   const success=operation==='open_session'?response.result==='起動しました'&&response.session?.running===true:['停止しました','稼働していません'].includes(response.result);
   if(!success||response.status==='NG'||response.available===false)return {status:'NG',message:'ブラウザToolsの動作を確認できませんでした。状態を確認してください。',data:{}};
   return {status:'OK',message:operation==='open_session'?'テスト用ブラウザを起動しました。':'テスト用ブラウザを停止しました。',data:{}};
  }finally{busy=false;}
 };
}
