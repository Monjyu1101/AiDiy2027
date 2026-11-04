// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 診断サーバー専用。固定設定の読取・モデル一覧・読み取り専用の認証確認のみ。キーを戻り値やログへ出さない。
import {open,stat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import {DIAG_TRANSPORT_BYTE_LIMIT} from './transport_limit';
import {proxyRoute,MetadataProxyAgent,networkFailure} from './environment_proxy';
import {openrouterCatalog,googleCatalog,openaiCatalog,claudeCatalog,ollamaCatalog,codexCatalog,codexSlugs,codexFallbackCatalog,grokCatalog,idsCatalog,ollamaLocalCatalog,withoutRetired,GROK_CLI_MODELS,LOCAL_CHAT_MODELS,pythonString,type Catalog} from './model_catalog';
export const CONFIG_LIMIT=128*1024, RESPONSE_LIMIT=DIAG_TRANSPORT_BYTE_LIMIT;
// 公開・認証付き一覧とも同じHTTP上限。ローカルのCLIキャッシュは従来の上限を保つ。
export const PUBLIC_RESPONSE_LIMIT=DIAG_TRANSPORT_BYTE_LIMIT;
const MODEL_CACHE_LIMIT=1024*1024;
function connectionFailureDescription(error:unknown):string {
 const reasons:Record<string,string>={dns:'接続先またはプロキシの名前解決に失敗しました。',tls:'接続先またはプロキシのTLS証明書を検証できませんでした。',network:'接続できませんでした。ネットワークとプロキシ設定を確認してください。','proxy-config':'HTTP_PROXY / HTTPS_PROXY のURL設定が無効です。','proxy-auth':'プロキシ認証が拒否されました。','proxy-connect':'プロキシが接続を許可しませんでした。',auth:'HTTP認証またはアクセス権が拒否されました。',http:'正常なHTTP応答を取得できませんでした。',timeout:'通信がタイムアウトしました。',stopped:'取得を中止しました。',response:'受信が途中で切断されました。',size:'受信サイズが上限を超えました。',json:'応答をJSONとして読み取れませんでした。',shape:'モデルデータ形式が想定と異なります。'};
 const reason=error instanceof Error?error.message:'';
 return Object.hasOwn(reasons,reason)?reasons[reason]:'モデル取得処理に失敗しました。';
}
export function publicFailureDescription(code:unknown):string {
 if(typeof code==='string'&&['proxy-config','proxy-auth','proxy-connect','auth'].includes(code))return connectionFailureDescription(new Error(code));
 const reasons:Record<string,string>={size:"公開一覧の受信サイズが上限を超えました。",output:"整形した公開一覧が出力上限を超えました。",timeout:"公開一覧の通信がタイムアウトしました。",dns:"公開一覧サーバーまたはプロキシの名前解決に失敗しました。",tls:"公開一覧サーバーまたはプロキシのTLS証明書を検証できませんでした。",http:"公開一覧サーバーが正常なHTTP応答を返しませんでした。",json:"公開一覧の応答をJSONとして読み取れませんでした。",shape:"公開一覧のデータ形式が想定と異なります。",network:"公開一覧サーバーへ接続できませんでした。ネットワークやプロキシ設定を確認してください。",response:"公開一覧の受信が途中で切断されました。",stopped:"公開一覧の取得を中止しました。",busy:"別のモデル確認が実行中です。"};
 return typeof code==='string'&&Object.hasOwn(reasons,code)?reasons[code]:"公開一覧の取得処理に失敗しました。";
}
const CONFIG_PATH=fileURLToPath(new URL('../../_config/AiDiy_key.json',import.meta.url));
export const KEY_PROVIDERS=Object.freeze([
 ['gemini','Gemini','gemini_key_id','google'],['freeai','FreeAI（Gemini）','freeai_key_id','google'],
 ['claude','Claude','claude_key_id','anthropic'],['openai','OpenAI API','openai_key_id','openai'],
 ['openai_oauth','OpenAI OAuth','~/.codex/auth.json','codex'],['grok','Grok（xAI）','~/.grok/auth.json','grok'],
 ['azure','Azure OpenAI','azure_key_id',null],['copilot','GitHub Copilot','copilot_key_id',null],
 ['openrt','OpenRouter','openrt_key_id','openrouter'],['ollama','Ollama（ローカル）','ollama list','ollama-local'],['local','ローカル（backend_local）','固定候補','local-fixed'],
 ['huggingface_read','Hugging Face 読取','huggingface_key_read','huggingface'],['huggingface_write','Hugging Face 書込','huggingface_key_write','huggingface'],
 ['discord','Discord Bot','discord_bot_token','discord'],
 ['slack','Slack Bot','slack_bot_token','slack'],
].map(([id,名前,キー名,probe])=>Object.freeze({id:id!,名前:名前!,キー名:キー名!,probe,oauth:probe==='codex'||probe==='grok'?probe as OAuthKind:null})));
// モデル名に紛れたキー値を伏せる対象（行の追加・変更とは独立）。
const SECRET_CONFIG_KEYS=Object.freeze(['gemini_key_id','freeai_key_id','claude_key_id','openai_key_id','azure_key_id','copilot_key_id','openrt_key_id','ollama_key_id','huggingface_key_read','huggingface_key_write','discord_bot_token','slack_bot_token','slack_app_token','openai_organization']);
export type Dictionary=Record<string,unknown>;
const record=(value:unknown):value is Dictionary=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export type Reader=(path:string)=>Promise<string|Uint8Array>|string|Uint8Array;
// FIFO/device は開かない。事前確認後の置換も非blocking openとhandle側確認で防ぐ。
async function readLimited(file:string,limit=CONFIG_LIMIT):Promise<Uint8Array> {
 const before=await stat(file);if(!before.isFile()||before.size>limit)throw new Error('file');
 const handle=await open(file,constants.O_RDONLY|(constants.O_NONBLOCK??0));
 try{
  const info=await handle.stat();if(!info.isFile()||info.size>limit)throw new Error('file');
  const bytes=Buffer.alloc(limit+1);let total=0;
  while(total<bytes.length){const {bytesRead}=await handle.read(bytes,total,bytes.length-total,total);if(!bytesRead)break;total+=bytesRead;}
  return bytes.subarray(0,total);
 }finally{await handle.close();}
}
function parseJson(raw:string|Uint8Array,limit=CONFIG_LIMIT):Dictionary {
 const bytes=typeof raw==='string'?Buffer.from(raw):Buffer.from(raw);
 if(bytes.length>limit)throw new Error('size');
 const value:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/^﻿/,''));
 if(!record(value))throw new Error('shape');return value;
}
export async function readConfig(reader?:Reader):Promise<[string,Dictionary]> {
 try {return ['読込済み',parseJson(reader?await reader(CONFIG_PATH):await readLimited(CONFIG_PATH))];}
 catch(error){return [(error as NodeJS.ErrnoException)?.code==='ENOENT'?'未作成':'読込不可',{}];}
}
// OAuth は各 CLI のログイン情報ファイルを読むだけ。トークンの更新（ファイルの書換え）はしない。
export type OAuthKind='codex'|'grok';
export type OAuthReader=(kind:OAuthKind)=>Promise<string|Uint8Array>|string|Uint8Array;
export type OAuthCredential={token:string;account:string|null;expiresAt:number|null};
export function oauthPath(kind:OAuthKind,env:NodeJS.ProcessEnv=process.env,home=os.homedir()):string {
 return kind==='codex'?path.join(env.CODEX_HOME?.trim()||path.join(home,'.codex'),'auth.json'):path.join(home,'.grok','auth.json');
}
function jwtClaims(token:string):Dictionary {try{const value:unknown=JSON.parse(Buffer.from(token.split('.')[1]??'','base64url').toString('utf8'));return record(value)?value:{};}catch{return {};}}
export async function readOAuth(kind:OAuthKind,reader?:OAuthReader):Promise<OAuthCredential|null> {
 try {
  const value=parseJson(reader?await reader(kind):await readLimited(oauthPath(kind)));
  if(kind==='codex'){
   const tokens=value.tokens;if(!record(tokens)||typeof tokens.access_token!=='string'||!tokens.access_token.trim())return null;
   const token=tokens.access_token.trim(),claims=jwtClaims(token),auth=record(claims['https://api.openai.com/auth'])?claims['https://api.openai.com/auth'] as Dictionary:{};
   const account=[tokens.account_id,auth.chatgpt_account_id].find((v):v is string=>typeof v==='string'&&!!v.trim())?.trim()??null;
   return {token,account,expiresAt:typeof claims.exp==='number'?claims.exp*1000:null};
  }
  for(const [issuer,entry] of Object.entries(value)){
   if(!issuer.startsWith('https://auth.x.ai')||!record(entry)||typeof entry.key!=='string'||!entry.key.trim())continue;
   const expires=Date.parse(String(entry.expires_at??''));
   return {token:entry.key.trim(),account:null,expiresAt:Number.isFinite(expires)?expires:null};
  }
  return null;
 }catch{return null;}
}
const OAUTH_CLI:Record<OAuthKind,string>={codex:'codex',grok:'grok'};
// API が使えないときの Codex の代替候補元（get_codex_model_ids と同じ）: config.toml の model と models_cache.json。
export type CodexLocalReader=(name:'config.toml'|'models_cache.json')=>Promise<string|Uint8Array>|string|Uint8Array;
export async function readCodexLocal(reader?:CodexLocalReader,env:NodeJS.ProcessEnv=process.env,home=os.homedir()):Promise<{defaultModel:string|null;cacheIds:string[]}> {
 const folder=path.dirname(oauthPath('codex',env,home)),read=async(name:'config.toml'|'models_cache.json')=>reader?await reader(name):await readLimited(path.join(folder,name),MODEL_CACHE_LIMIT);
 let defaultModel:string|null=null,cacheIds:string[]=[];
 try {
  const text=Buffer.from(await read('config.toml')).toString('utf8'),top=text.split(/^\s*\[/m)[0];
  const match=/^\s*model\s*=\s*(["'])([^"'\r\n]+)\1/m.exec(top);if(match&&match[2].trim())defaultModel=match[2].trim();
 }catch{}
 try {cacheIds=codexSlugs(parseJson(await read('models_cache.json'),MODEL_CACHE_LIMIT));}catch{}
 return {defaultModel,cacheIds};
}
// 外部連携（モデル一覧なし）。読み取り専用の認証確認だけを行い、送信・書込・Gateway 接続はしない。
export const INTEGRATION_PROBES=Object.freeze(['huggingface','discord','slack']);
export function configured(value:unknown,id:string):value is string {return typeof value==='string'&&(id!=='slack'||(value.trim().length>1&&!/\s/.test(value.trim())))&&!!value.trim()&&!value.trim().startsWith('<')&&!(id==='ollama'&&value.trim().toLowerCase()==='ollama');}
export async function status({reader,oauthReader}:{reader?:Reader;oauthReader?:OAuthReader}={}) {
 const [state,values]=await readConfig(reader);
 const oauth:Record<OAuthKind,boolean>={codex:!!await readOAuth('codex',oauthReader),grok:!!await readOAuth('grok',oauthReader)};
 return {設定状態:state,項目:KEY_PROVIDERS.map(p=>{
  // OAuth は API キーではなく、該当フォルダのログイン情報の有無で設定済みを判断する。
  if(p.probe==='local-fixed')return {id:p.id,名前:p.名前,キー名:p.キー名,設定済み:null,キー不要:true,ローカル:true,状態:'未実施',理由:'',テスト可能:true,説明:'本体と同じ固定候補（CHAT_LOCAL_MODELS）を使います（API 取得なし）。'};
  if(p.probe==='ollama-local')return {id:p.id,名前:p.名前,キー名:p.キー名,設定済み:null,キー不要:true,ローカル:true,状態:'未実施',理由:'',テスト可能:true,説明:'本体と同じく、ローカルの Ollama（ollama list と同じ一覧）を確認します。キーは使いません。'};
  if(p.oauth){const present=oauth[p.oauth];return {id:p.id,名前:p.名前,キー名:p.キー名,設定済み:present,キー不要:false,状態:'未実施',理由:present?'':`ログイン情報がありません。${OAUTH_CLI[p.oauth]} CLI でログインしてください。`,テスト可能:present,説明:'ログイン情報（OAuth）の有無のみ。接続は未確認です。'};}
  const present=state==='読込不可'?null:configured(values[p.キー名],p.id);
  const reason=state==='読込不可'?'設定を読み取れません。':!present?'キーが未設定です。':!p.probe?'この項目の接続テストは未対応です。':'';
  return {id:p.id,名前:p.名前,キー名:p.キー名,設定済み:present,キー不要:false,状態:'未実施',理由:reason,テスト可能:state!=='読込不可'&&!!p.probe&&!!present,説明:p.id==='openrt'?'設定キーを確認し、公開モデル一覧キャッシュから候補を表示します。':INTEGRATION_PROBES.includes(p.probe as string)?'設定有無のみ。接続はテストで確認します（読み取り専用の認証確認）。':'設定有無のみ。接続は未確認です。'};
 }),モデル:[]};
}
// ローカル Ollama は ollama list と同じ API を loopback 固定で読む（プロセスは起動しない）。
const LOCAL_ENDPOINTS:Record<string,readonly [string,number,string]>={'ollama-local':['127.0.0.1',11434,'/api/tags']};
const ENDPOINTS:Record<string,readonly [string,string]>={codex:['chatgpt.com','/backend-api/codex/models?client_version=1.0.0'],grok:['cli-chat-proxy.grok.com','/v1/models'],google:['generativelanguage.googleapis.com','/v1beta/models'],anthropic:['api.anthropic.com','/v1/models'],openai:['api.openai.com','/v1/models'],openrouter:['openrouter.ai','/api/v1/models'],'openrouter-key':['openrouter.ai','/api/v1/key'],ollama:['ollama.com','/v1/models'],huggingface:['huggingface.co','/api/whoami-v2'],discord:['discord.com','/api/v10/users/@me'],slack:['slack.com','/api/auth.test']};
export type Fetch=(provider:string,headers:Record<string,string>,pageToken?:unknown,signal?:AbortSignal)=>Promise<Dictionary>;
export const fetchMetadata:Fetch=(provider,headers,pageToken,signal)=>new Promise((resolve,reject)=>{
 const local=LOCAL_ENDPOINTS[provider],endpoint=local?[local[0],local[2]] as const:ENDPOINTS[provider];if(!endpoint)return reject(new Error('provider'));
 let pathname=endpoint[1];
 if(pageToken){if(provider!=='google'||typeof pageToken!=='string'||pageToken.length>4096)return reject(new Error('pagination'));pathname+='?'+new URLSearchParams({pageToken});}
 if(signal?.aborted)return reject(new Error('stopped'));
 const responseLimit=provider==='openrouter'&&Object.keys(headers).length===0?PUBLIC_RESPONSE_LIMIT:RESPONSE_LIMIT;
 let settled=false,size=0;const chunks:Buffer[]=[];
 let agent:MetadataProxyAgent|undefined,request:http.ClientRequest|undefined,incoming:http.IncomingMessage|undefined;
 try{const proxy=local?null:proxyRoute(new URL(`https://${endpoint[0]}`));if(proxy)agent=new MetadataProxyAgent(proxy);}catch(error){return reject(new Error(networkFailure(error)));}
 // 明示した proxy のみ使用。キーは TLS 内側の API リクエストだけへ渡し、redirect は追わない。
 const respond=(response:http.IncomingMessage)=>{
  incoming=response;if(settled){response.destroy();return;}
  if(!response.statusCode||response.statusCode<200||response.statusCode>=300){return finish(new Error([401,403].includes(response.statusCode??0)?'auth':'http'));}
  response.on('data',(chunk:Buffer)=>{if(settled)return;size+=chunk.length;if(size>responseLimit)return finish(new Error('size'));chunks.push(chunk);});
  response.on('error',()=>finish(new Error('response')));
  response.on('aborted',()=>finish(new Error('response')));
  response.on('end',()=>{if(settled)return;try{const body:unknown=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!record(body))return finish(new Error('shape'));finish(undefined,body);}catch{finish(new Error('json'));}});
 };
 const cancel=()=>finish(new Error('stopped'));
 const timer=setTimeout(()=>finish(new Error('timeout')),local?10000:8000);
 function finish(error?:Error,value?:Dictionary){if(settled)return;settled=true;chunks.length=0;clearTimeout(timer);signal?.removeEventListener('abort',cancel);incoming?.destroy();request?.destroy();agent?.destroy();if(error)reject(error);else resolve(value!);}
 try{
  request=local?http.request({hostname:local[0],port:local[1],path:pathname,method:'GET',agent:false,headers:{Accept:'application/json',...headers}},respond):https.request({hostname:endpoint[0],path:pathname,port:443,method:provider==='slack'?'POST':'GET',agent:agent??false,rejectUnauthorized:true,headers:{Accept:'application/json',...headers}},respond);
  signal?.addEventListener('abort',cancel,{once:true});request.on('error',error=>finish(new Error(networkFailure(error))));request.end();
 }catch(error){finish(new Error(networkFailure(error)));}
});
function secretValues(values:Dictionary):string[] {return SECRET_CONFIG_KEYS.map(name=>values[name]).filter((value):value is string=>configured(value,'')).map(value=>value.trim());}
export function safeDetails(models:Dictionary,secrets:string[],limit:number|null=500) {
 const result:Record<string,string|null>[]=[];
 for(const [id,entry] of Object.entries(models)) {
  // OpenRouter の別名（~provider/model）も本体と同じく通す。
  if(!/^~?[A-Za-z0-9][A-Za-z0-9._:/@+\-]{0,199}$/.test(id)||!record(entry))continue;
  const values={...entry,model_id:id},cleaned:Record<string,string|null>={};
  for(const name of ['model_id','作成日','トークン数','モダリティ']){const value=values[name as keyof typeof values];let val=value==null?null:pythonString(value);if(val!==null&&(val.length>512||secrets.some(secret=>val!.includes(secret))))val=null;cleaned[name]=val;}
  if(cleaned.model_id!==null)result.push(cleaned);
 }
 return limit===null?result:result.slice(0,limit);
}
export function validatedCache(cache:unknown):[Catalog,boolean] {
 if(!record(cache)||cache.公開状態!=='取得済'||!record(cache.公開モデル)||Object.values(cache.公開モデル).some(value=>!record(value)))return [{},false];
 return [Object.fromEntries(safeDetails(cache.公開モデル,[],null).map(item=>[item.model_id,item])) as Catalog,true];
}
export async function publicCatalog({fetch=fetchMetadata,now,signal}:{fetch?:Fetch;now?:Date;signal?:AbortSignal}={}) {
 const timestamp=new Date().toISOString();
 try {
  const body=await fetch('openrouter',{},undefined,signal);if(!Array.isArray(body.data))throw new Error('shape');
  const details=safeDetails(openrouterCatalog(body,now),[],null);
  const result={状態:'OK',公開モデル:Object.fromEntries(details.map(item=>[item.model_id,item])),確認日時:timestamp,説明:'公開OpenRouter一覧の匿名取得成功。キーの有効性は未確認です。'};
  if(Buffer.byteLength(JSON.stringify(result))>RESPONSE_LIMIT)throw new Error('output');return result;
 }catch(error){
  const candidate=error instanceof Error?error.message:'';
  const code=['size','output','timeout','dns','tls','http','auth','proxy-config','proxy-auth','proxy-connect','json','network','response','stopped'].includes(candidate)?candidate:'shape';
  return {状態:'NG',公開モデル:{},確認日時:timestamp,失敗理由:code,説明:publicFailureDescription(code)};
 }
}
// 認証証跡はプロセス内の非列挙 Symbol のみ。JSON・ブラウザ・保存ファイルにキーや指紋を含めない。
// runner は bundle されるため、同一プロセスの共有 Symbol で安全化後の結果へ引き継ぐ。
const ROUTER_PROOF=Symbol.for('aidiy.diag.openrouter-proof');
// 判断用は公開補完前の取得一覧と認証を実行中だけ保持する。保存済みJSONは証跡にしない。
const DECISIONS_PROOF=Symbol.for('aidiy.diag.decisions-proof');
export function carryDecisionsProof<T extends object>(source:object,target:T):T {
 const proof=Object.getOwnPropertyDescriptor(source,DECISIONS_PROOF);
 if(proof)Object.defineProperty(target,DECISIONS_PROOF,proof);
 return target;
}
export async function currentDecisionModels(result:unknown,id:string,reader?:Reader,oauthReader?:OAuthReader):Promise<Dictionary[]> {
 if(!record(result)||result.状態!=='OK')return [];
 const proof=Object.getOwnPropertyDescriptor(result,DECISIONS_PROOF)?.value;
 return typeof proof==='function'?await proof(id,reader,oauthReader):[];
}
function decisionResult<T extends object>(result:T,id:string,models:Dictionary[],valid:(reader?:Reader,oauthReader?:OAuthReader)=>Promise<boolean>):T {
 return Object.defineProperty(result,DECISIONS_PROOF,{value:async(selected:string,reader?:Reader,oauthReader?:OAuthReader)=>selected===id&&await valid(reader,oauthReader)?models.map(row=>({...row})):[]});
}
export function carryOpenRouterProof<T extends object>(source:object,target:T):T {
 const proof=Object.getOwnPropertyDescriptor(source,ROUTER_PROOF);
 if(proof)Object.defineProperty(target,ROUTER_PROOF,proof);
 return target;
}
export async function currentOpenRouterProof(result:unknown,reader?:Reader):Promise<boolean> {
 if(!record(result))return false;
 const proof=Object.getOwnPropertyDescriptor(result,ROUTER_PROOF)?.value;
 return typeof proof==='function'&&await proof(reader)===true;
}
function authenticatedRouterResult<T extends object>(result:T,key:string):T {
 return Object.defineProperty(result,ROUTER_PROOF,{value:async(reader?:Reader)=>{
  const [state,values]=await readConfig(reader);
  return state==='読込済み'&&configured(values.openrt_key_id,'openrt')&&values.openrt_key_id.trim()===key;
 }});
}
export async function probe(id:string,{reader,oauthReader,codexLocalReader,fetch=fetchMetadata,now,cache,signal}:{reader?:Reader;oauthReader?:OAuthReader;codexLocalReader?:CodexLocalReader;fetch?:Fetch;now?:Date;cache?:unknown;signal?:AbortSignal}={}) {
 const output={id,状態:'未実施',説明:'未対応の項目です。',モデル:[] as string[],モデル詳細:[] as Record<string,string|null>[],確認日時:null as string|null,警告:[] as string[]};
 const selected=KEY_PROVIDERS.find(row=>row.id===id);if(!selected?.probe)return output;
 if(selected.oauth){
  const kind=selected.oauth,cli=OAUTH_CLI[kind],credential=await readOAuth(kind,oauthReader);
  if(!credential)return {...output,説明:`ログイン情報がありません。${cli} CLI でログインしてください。`};
  const timestamp=new Date().toISOString(),expired=credential.expiresAt!==null&&credential.expiresAt<=(now??new Date()).getTime();
  const expiredNote=`ログイン情報の有効期限が切れています。${cli} CLI を起動して再ログインしてください（診断はトークンを更新しません）。`;
  try {
   const headers:Record<string,string>={Authorization:'Bearer '+credential.token,'User-Agent':'aidiy-diag'};
   if(credential.account)headers['ChatGPT-Account-Id']=credential.account;
   const body=await fetch(kind,headers,undefined,signal);
   const details=safeDetails(kind==='codex'?codexCatalog(body):grokCatalog(body),[credential.token,...(credential.account?[credential.account]:[])]);
   const result={...output,状態:'OK',モデル:details.map(item=>item.model_id!),モデル詳細:details,確認日時:timestamp,警告:expired?[expiredNote]:[],説明:'OAuth のログイン情報でモデル一覧を取得しました。生成可否・利用上限は未確認です。',一覧範囲:kind==='codex'?'本体（get_codex_model_ids）と同じく、非表示・廃止モデルを除いて優先度順に並べ、将来版と -900k 版を補完。表示は最大500件。':'本体に API 一覧の絞り込みは無いため、非表示モデルだけを除外。表示は最大500件。'};
   return kind!=='codex'?result:decisionResult(result,id,safeDetails(idsCatalog(codexSlugs(body)),[credential.token,...(credential.account?[credential.account]:[])]),async(_reader,currentOAuthReader)=>{
    const current=await readOAuth(kind,currentOAuthReader);return current?.token===credential.token&&current?.account===credential.account;
   });
  }catch(error){
   // 本体は API で取れない場合も代替候補で続行する。OpenAI OAuth は API 一覧を使う系統なので NG とし、本体が使う候補を併せて示す。
   // Grok は本体がもともと固定候補を流し込む系統なので、固定候補を示して PASS（黄）とする。
   const fallback=kind==='codex'?await readCodexLocal(codexLocalReader).then(local=>codexFallbackCatalog(local.defaultModel,local.cacheIds)):idsCatalog(GROK_CLI_MODELS);
   const details=safeDetails(fallback,[credential.token,...(credential.account?[credential.account]:[])]);
   const reason=expired?expiredNote:'OAuth のモデル一覧取得に失敗しました。'+connectionFailureDescription(error);
   return {...output,状態:kind==='grok'?'PASS':'NG',説明:kind==='grok'?`本体と同じ固定候補（${GROK_CLI_MODELS.join(' / ')}）を使用します。API 一覧は未取得: ${reason}`:reason,確認日時:timestamp,モデル:details.map(item=>item.model_id!),モデル詳細:details,警告:[kind==='codex'?'API から取得できないため、本体と同じ代替候補（~/.codex の config.toml・models_cache.json・既定値）を表示しています。':'API から取得できないため、本体と同じ固定候補（Grok Build CLI の grok-4.7 / grok-4.6）を表示しています。'],一覧範囲:'代替候補（本体が API 取得失敗時に使う一覧）。'};
  }
 }
 const [router,ready]=validatedCache(cache);
 // backend_local: aidiy_diag の固定候補（本体 conf_model.py の CHAT_LOCAL_MODELS と同じ）。_config 側は廃止予定のため読まない。固定候補なので PASS（黄）。
 if(selected.probe==='local-fixed'){
  const details=safeDetails(idsCatalog(LOCAL_CHAT_MODELS),[]);
  return {...output,状態:'PASS',説明:'本体と同じ固定候補（aidiy_diag の定義。本体 CHAT_LOCAL_MODELS と同じ）を使用します。backend_local は API でモデル一覧を取得しません。',モデル:details.map(item=>item.model_id!),モデル詳細:details,確認日時:new Date().toISOString(),一覧範囲:'固定候補（本体の local_chat）。'};
 }
 if(selected.probe==='ollama-local'){
  const timestamp=new Date().toISOString(),[,values]=await readConfig(reader);
  try {
   const details=safeDetails(ollamaLocalCatalog(await fetch('ollama-local',{},undefined,signal)),secretValues(values));
   return {...output,状態:'OK',モデル:details.map(item=>item.model_id!),モデル詳細:details,確認日時:timestamp,説明:'ローカルの Ollama からモデル一覧を取得しました（本体の ollama list と同じ一覧）。生成可否は未確認です。',一覧範囲:'インストール済みのローカルモデル（新しい順）。表示は最大500件。'};
  }catch{return {...output,状態:'NG',説明:'ローカルの Ollama に接続できません。Ollama が起動しているか確認してください（本体ではこの場合 Ollama の候補が空になります）。',確認日時:timestamp};}
 }
 const [state,values]=await readConfig(reader);if(state==='読込不可')return {...output,説明:'設定を読み取れません。'};
 const keyValue=values[selected.キー名];if(!configured(keyValue,id))return {...output,説明:'キーが未設定です。'};
 const key=keyValue.trim(),provider=selected.probe,timestamp=new Date().toISOString();
 if(INTEGRATION_PROBES.includes(provider))return integrationProbe(id,provider,key,{...output,確認日時:timestamp},secretValues(values),fetch,signal);
 // 公開 /models はキー認証の証拠にならない。生成せず専用 GET /key で確認する。
 if(id==='openrt'){
  try {
   const body=await fetch('openrouter-key',{Authorization:'Bearer '+key},undefined,signal);
   if(!record(body.data)||typeof body.data.is_free_tier!=='boolean')throw new Error('shape');
   if(!ready)return {...output,状態:'NG',確認日時:timestamp,説明:'キー認証は成功しましたが、公開モデル一覧が利用できません。'};
   const details=safeDetails(withoutRetired(router),secretValues(values));
   return authenticatedRouterResult({...output,状態:'OK',認証確認:true,説明:'キー認証成功。公開一覧キャッシュから候補を表示します。生成可否・課金状態は未確認です。',モデル:details.map(item=>item.model_id!),モデル詳細:details,確認日時:timestamp,一覧範囲:'認証確認済み。公開一覧のキャッシュ。最大500件。'},key);
  }catch(error){return {...output,状態:'NG',確認日時:timestamp,説明:'OpenRouter のキー認証を確認できませんでした。'+connectionFailureDescription(error)};}
 }
 const warnings=['google','openai','anthropic'].includes(provider)&&!ready?['起動時の公開OpenRouter一覧が利用できません。元のモデル処理と同じ空一覧時の処理で、日付・対応情報の補完なしで続行しました。']:[];
 try {
  const headers:Record<string,string>=provider==='google'?{'x-goog-api-key':key}:provider==='anthropic'?{'x-api-key':key,'anthropic-version':'2023-06-01'}:{Authorization:'Bearer '+key};
  if(provider==='openai'&&configured(values.openai_organization,''))headers['OpenAI-Organization']=values.openai_organization.trim();
  let body=await fetch(provider,headers,undefined,signal),models:Catalog,decisionModels:Catalog={},live:string[]=[];
  if(provider==='google'){
   if(!Array.isArray(body.models))throw new Error('shape');const entries=[...body.models];let token=body.nextPageToken,pages=1;
   while(token){if(pages>=20)throw new Error('pages');body=await fetch(provider,headers,token,signal);if(!Array.isArray(body.models))throw new Error('shape');entries.push(...body.models);token=body.nextPageToken;pages++;}
   live=entries.filter(item=>record(item)&&typeof item.name==='string'&&Array.isArray(item.supportedGenerationMethods)&&item.supportedGenerationMethods.includes('bidiGenerateContent')).map(item=>String((item as Dictionary).name).replaceAll('models/',''));
   models=googleCatalog(entries.map(item=>{if(!record(item)||typeof item.name!=='string'||(item.supportedGenerationMethods!==undefined&&(!Array.isArray(item.supportedGenerationMethods)||item.supportedGenerationMethods.some(x=>typeof x!=='string'))))throw new Error('shape');return {name:item.name,supported_actions:item.supportedGenerationMethods??[],input_token_limit:item.inputTokenLimit??null};}),router);
   decisionModels=googleCatalog(entries.map(item=>{const value=item as Dictionary;return {name:value.name as string,supported_actions:(value.supportedGenerationMethods??[]) as string[],input_token_limit:value.inputTokenLimit??null};}));
  }else {
   if(!Array.isArray(body.data))throw new Error('shape');
   if(provider==='openai')models=withoutRetired(openaiCatalog(body.data.map(item=>{if(!record(item)||typeof item.id!=='string'||typeof item.created!=='number')throw new Error('shape');return {id:item.id,created:item.created};}),router,now));
   else if(provider==='anthropic')models=claudeCatalog({data:body.data.map(item=>{if(!record(item)||typeof item.id!=='string')throw new Error('shape');return {id:item.id,created_at:item.created_at};})},router,now);
   else models=ollamaCatalog(body,now);
   if(provider==='openai')decisionModels=withoutRetired(openaiCatalog(body.data as {id:string;created:number}[],{},now));
  }
  const secrets=secretValues(values);
  if(provider==='openai')live=Object.keys(models).filter(id=>id.toLowerCase().includes('realtime'));
  const liveDate=(id:string)=>{const value=provider==='google'?router[`google/${id}`]?.作成日:models[id]?.作成日;return typeof value==='string'&&/^\d{4}\/\d{2}\/\d{2}$/.test(value)?value:null;};
  const details=safeDetails(models,secrets),liveCandidates=[...new Set(live)].filter(id=>/^~?[A-Za-z0-9][A-Za-z0-9._:/@+\-]{0,199}$/.test(id)&&!secrets.some(secret=>id.includes(secret))).slice(0,200);
  const result={...output,状態:'OK',モデル:details.map(item=>item.model_id!),モデル詳細:details,ライブ候補:liveCandidates,ライブ候補作成日:Object.fromEntries(liveCandidates.map(id=>[id,liveDate(id)])),確認日時:timestamp,警告:warnings,説明:'モデル一覧API取得成功。元のモデル処理と同じ絞り込み・補完を適用。生成可否・課金状態は未確認です。',一覧範囲:'元のモデル処理を移植した取得モデルの絞り込み結果、表示は最大500件。静的・OAuth候補は含みません。',補完:['google','openai','anthropic'].includes(provider)?'起動時の公開OpenRouter一覧キャッシュを利用。テスト時の追加取得は行いません。':''};
  return decisionResult(result,id,safeDetails(decisionModels,secrets),async currentReader=>{
   const [currentState,current]=await readConfig(currentReader);
   return currentState==='読込済み'&&configured(current[selected.キー名],id)&&(current[selected.キー名] as string).trim()===key
    &&(provider!=='openai'||(configured(current.openai_organization,'')?current.openai_organization.trim():'')===(headers['OpenAI-Organization']??''));
  });
 }catch(error){return {...output,状態:'NG',説明:'モデル一覧APIの通信または診断用モデル処理に失敗しました。'+connectionFailureDescription(error),確認日時:timestamp,警告:warnings};}
}
// 表示名は固定の文字種・長さだけを通し、キー値を含むものは出さない（メール・組織・トークン名は返さない）。
function safeName(value:unknown,secrets:string[]):string {
 return typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._\-]{0,63}$/.test(value)&&!secrets.some(secret=>value.includes(secret))?value:'';
}
async function integrationProbe(id:string,provider:string,key:string,output:Dictionary,secrets:string[],fetch:Fetch,signal?:AbortSignal) {
 const name=provider==='slack'?'Slack':provider==='discord'?'Discord':'Hugging Face';
 try {
  if(provider==='slack'){
   // auth.test: 認証の確認のみ。App token・Socket Mode・投稿は使用しない。
   const body=await fetch('slack',{Authorization:'Bearer '+key,'Content-Type':'application/x-www-form-urlencoded'},undefined,signal);
   if(body.ok!==true||typeof body.bot_id!=='string'||!/^B[A-Z0-9]+$/.test(body.bot_id))return {...output,状態:'NG',説明:'Slack Bot トークンとして認証できませんでした。'};
   return {...output,状態:'OK',説明:'Slack Bot トークンで認証できました。App トークン・Socket Mode・チャンネル権限・メッセージ送信は未確認です。'};
  }
  if(provider==='discord'){
   // Discord API の User-Agent 規約に合わせる。Bot トークン以外（ユーザートークン）は NG。
   const body=await fetch('discord',{Authorization:'Bot '+key,'User-Agent':'DiscordBot (aidiy-diag, 0.1.0)'},undefined,signal);
   if(body.bot!==true)return {...output,状態:'NG',説明:'Bot トークンとして認証できませんでした。Discord Developer Portal の Bot トークンを設定してください。'};
   const bot=safeName(body.username,secrets);
   return {...output,状態:'OK',説明:`Bot トークンで認証できました${bot?`（Bot: ${bot}）`:''}。メッセージ送信・Gateway 接続・チャンネル権限は未確認です。`};
  }
  const body=await fetch('huggingface',{Authorization:'Bearer '+key,'User-Agent':'aidiy-diag'},undefined,signal);
  const user=safeName(body.name,secrets),token=record(body.auth)&&record(body.auth.accessToken)?body.auth.accessToken:{};
  const role=typeof token.role==='string'&&['read','write','fineGrained'].includes(token.role)?token.role:'';
  const label=`（${user?`ユーザー: ${user}、`:''}権限: ${role||'不明'}）`;
  if(id==='huggingface_write'){
   if(role==='write')return {...output,状態:'OK',説明:`書込権限のあるトークンで認証できました${label}。リポジトリへの実際の書込は未確認です。`};
   if(role==='fineGrained'){
    const permissions=record(token.fineGrained)?[...(Array.isArray(token.fineGrained.global)?token.fineGrained.global:[]),...(Array.isArray(token.fineGrained.scoped)?token.fineGrained.scoped.flatMap(item=>record(item)&&Array.isArray(item.permissions)?item.permissions:[]):[])]:[];
    return permissions.some(item=>typeof item==='string'&&item.endsWith('.write'))
     ?{...output,状態:'PASS',説明:`細粒度トークンで認証できました${label}。一部に書込権限がありますが、対象リポジトリの範囲は未確認です。`}
     :{...output,状態:'NG',説明:`認証はできましたが、書込権限がありません${label}。書込用には write 権限のトークンを設定してください。`};
   }
   return {...output,状態:'NG',説明:`認証はできましたが、書込権限がありません${label}。書込用には write 権限のトークンを設定してください。`};
  }
  return {...output,状態:'OK',説明:`トークンで認証できました${label}。個別リポジトリ・ゲート付きモデルへのアクセスは未確認です。`};
 }catch(error){return {...output,状態:'NG',説明:`${name} の認証を確認できませんでした。`+connectionFailureDescription(error)};}
}
