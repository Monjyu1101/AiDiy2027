// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 手動の config モデル試行専用。起動・全診断・headless からは呼ばない。
import http from 'node:http';
import {DIAG_TRANSPORT_BYTE_LIMIT} from '../../runtime/transport_limit.mjs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {manualInput,manualDecisionAnswer,readManualCatalog} from './manual.mjs';
import {createHmac, randomBytes} from 'node:crypto';
import {readConfig,readOAuth} from '../../runtime/model_probe.mjs';
import {getToolsStatus} from '../診断/tools_status.mjs';
import {createAudioStore,validateAudio} from './audio_store.mjs';
import {installedCodeClis} from '../モデル情報/models_info.mjs';

// Live: 接続20秒 + 安定待ち15秒 + 応答60秒 + cleanup9秒 + 通信余裕。
export const LIVE_HTTP_TIMEOUT_MS=135000;
export const TRIAL_ROW_TIMEOUT_MS=150000;
// 予測は2ターンの会話と予測の3回を順に行うため、1行の期限を2倍にする。
export const PREDICTION_ROW_TIMEOUT_MS=TRIAL_ROW_TIMEOUT_MS*2;
export const TRIAL_RUN_TTL_MS=45*60*1000;

const CHAT = {gemini_chat:'GEMINI',freeai_chat:'FREEAI',openrt_chat:'OPENRT',openrt_free:'OPENRT_FREE',openai_chat:'OPENAI',openai_oauth:'OPENAI',ollama_chat:'OLLAMA',local_chat:'LOCAL'};
const LIVE = {gemini_live:'GEMINI',freeai_live:'FREEAI',openai_live:'OPENAI'};
const DECISION = new Set(['auto','openai_oauth','openai_jsonchat','freeai_chat','openai_decisions','gemini_chat']);
import {TRIAL_PROMPT,DECISION_CHOICES,decisionQuestions,TRIAL_FAMILIES,PREDICTION_PROVIDERS,PREDICTION_AUTO_PROVIDERS,PREDICTION_MODEL_KEYS,PREDICTION_CLI_PROVIDERS,PREDICTION_STORY_PROMPTS,predictionPerfect} from './defaults.mjs';
export {DECISION_CHOICES} from './defaults.mjs';
const CODE = new Set(['auto','same','claude_sdk','claude_cli','claude_ollama','copilot_cli','codex_cli','codex_ollama','antigravity_cli','grok_cli','opencode_cli','aidiy_hermes']);
const text = value => typeof value === 'string' ? value.trim() : '';
const label = value => /^[\w./:@+-]{1,180}$/.test(text(value)) && !/^(?:sk-|AIza|Bearer )/i.test(text(value)) ? text(value) : '';
const failure = (message, status=409) => Object.assign(new Error(message),{status,trialFailure:true});
const sharedKey = row => JSON.stringify([row.区分==='CHAT'?'chat':row.区分==='LIVE'?'live':row.区分==='PREDICTION'?'prediction':row.区分==='DECISION'?'decision':'code',row.プロバイダ,row.モデル,row.音声]);
function portOf(config) {const value=config.PORT_TOOLS ?? 8095;const port=Number(value);return /^(?:[1-9]\d*)$/.test(String(value)) && Number.isInteger(port) && port<=65535 ? port : 0;}
export function trialProjectPath(config) {
  const configured=text(config.CODE_BASE_PATH).replaceAll('\\','/');
  if(!configured||configured.length>4096||/[\u0000-\u001f\u007f]/.test(configured))return '';
  // AIコアの履歴と同じbackend_server基準。ドライブ相対パスや未設定は補完しない。
  if(/^[a-z]:/i.test(configured)&&!(/^[a-z]:\//i.test(configured)))return '';
  if(/^[a-z]:\//i.test(configured)||(configured.startsWith('//')&&!configured.startsWith('///')))return path.win32.normalize(configured);
  return path.resolve(fileURLToPath(new URL('../../../backend_server/',import.meta.url)),configured);
}
export function configRows(config) {
  const rows=[];
  const secrets=new Set(Object.entries(config).filter(([key,value])=>/key|token|secret|password/i.test(key) && typeof value==='string' && value.length>=4).map(([,value])=>value));
  function add(id, family, role, provider, model, voice='', inherited='') {
    const safe=value=>[...secrets].some(secret=>text(value).includes(secret))?'':label(value);
    provider=safe(provider);model=safe(model);voice=safe(voice);
    const supported=family==='CHAT' ? Object.hasOwn(CHAT,provider) : family==='LIVE' ? Object.hasOwn(LIVE,provider) : family==='PREDICTION' ? ['auto',...PREDICTION_PROVIDERS].includes(provider) : family==='DECISION' ? DECISION.has(provider) : CODE.has(provider);
    const state=provider && !supported ? '未対応' : !provider || !model || (family==='LIVE' && !voice) ? '未設定' : '未実行';
    rows.push({id,区分:family,役割:role,プロバイダ:provider,モデル:model,音声:voice,継承元:inherited,状態:state,説明:state==='未設定'?'設定値が不足または不正です。':state==='未対応'?'このプロバイダは試行に対応していません。':''});
  }
  const chat=text(config.CHAT_AI_NAME),live=text(config.LIVE_AI_NAME);
  add('CHAT','CHAT','会話',chat,config[`CHAT_${CHAT[chat]}_MODEL`]);
  add('LIVE','LIVE','音声会話',live,config[`LIVE_${LIVE[live]}_MODEL`],config[`LIVE_${LIVE[live]}_VOICE`]);
  // 予測も方式別モデル。auto方式の行はモデルもautoで送り、解決後の方式のキーを使う。
  const prediction=text(config.PREDICTION_AI_NAME)||'auto';
  add('PREDICTION','PREDICTION','入力予測',prediction,PREDICTION_MODEL_KEYS[prediction]?text(config[PREDICTION_MODEL_KEYS[prediction]])||'auto':'auto');
  const decision=text(config.DECISION_AI_NAME)||'auto';
  const decisionKey={openai_decisions:'DECISION_OPENAI_MODEL',openai_oauth:'DECISION_OAUTH_MODEL',openai_jsonchat:'DECISION_OAUTH_MODEL',gemini_chat:'DECISION_GEMINI_MODEL',freeai_chat:'DECISION_FREEAI_MODEL'}[decision];
  // auto方式はToolsで方式とそのモデルを解決する。
  const decisionModel=decisionKey ? config[decisionKey] : 'auto';
  add('DECISION','DECISION','挨拶の丁寧さ',decision,text(decisionModel)||'auto');
  for(let i=1;i<=6;i++){const inherit=i>1 && config[`CODE_AI${i}_NAME`]==='auto';const n=inherit?1:i;add(`CODE${i}`,'CODE',`CODE${i}`,config[`CODE_AI${n}_NAME`],config[`CODE_AI${n}_MODEL`],'',inherit?'CODE1':'');}
  for(const family of ['TASK','TEAM'])for(const phase of ['plan','do','check'])add(`${family}_${phase}`,family,phase,config[`${family}_AI_NAME`],config[`${family}_AI_MODEL_${phase}`]);
  return rows.map(row=>({...row,共有対象:rows.filter(other=>other.id===row.id || (row.状態==='未実行' && other.状態==='未実行' && sharedKey(other)===sharedKey(row))).map(other=>other.id)}));
}

// Tools の文字列戻り値は MCPServer が structuredContent: {result: '<JSON>'} に包む。
// オブジェクト形式や従来のテキスト形式も、内側の会話結果を取り出して判定する。
function toolPayload(result) {
  const object=value=>value && typeof value==='object' && !Array.isArray(value);
  if(object(result?.structuredContent)){
    const structured=result.structuredContent;
    if(typeof structured.status==='string')return structured;
    if(typeof structured.result==='string')try{const parsed=JSON.parse(structured.result);if(object(parsed))return parsed;}catch{}
  }
  for(const content of result?.content || [])if(content.type==='text')try{const parsed=JSON.parse(content.text);if(object(parsed))return parsed;}catch{}
  throw failure('MCP の試行結果を読み取れません。');
}

// 固定 loopback、リダイレクトなし、応答上限。JSON と MCP SSE の双方を処理する。
export function localRequest({port,path,method='POST',body,headers={},signal,id,timeoutMs=TRIAL_ROW_TIMEOUT_MS,responseLimit=DIAG_TRANSPORT_BYTE_LIMIT}) {
  return new Promise((resolve,reject)=>{
    let req,res,done=false,size=0,buffer='';
    const finish=(error,value)=>{if(done)return;done=true;buffer='';clearTimeout(timer);signal?.removeEventListener('abort',abort);res?.destroy();req?.destroy();error?reject(error):resolve(value);};
    const abort=()=>finish(failure('試行を中止しました。'));
    const timer=setTimeout(()=>finish(failure('応答が制限時間を超えました。')),timeoutMs);
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)return abort();
    const bytes=body===undefined?undefined:Buffer.from(JSON.stringify(body));
    req=http.request({hostname:'127.0.0.1',port,path,method,agent:false,maxHeaderSize:8192,headers:{Accept:'application/json, text/event-stream',...(bytes?{'Content-Type':'application/json','Content-Length':bytes.length}:{}),...headers}},incoming=>{
      res=incoming;if(done){res.destroy();return;}
      if(incoming.statusCode<200 || incoming.statusCode>=300)return finish(failure('Tools が要求を受け付けませんでした。'));
      const session=incoming.headers['mcp-session-id'];
      if(session!==undefined && (typeof session!=='string' || !/^[\x21-\x7e]{1,256}$/.test(session)))return finish(failure('MCP セッションが不正です。'));
      const sse=String(incoming.headers['content-type']).includes('text/event-stream');
      const accept=value=>{if(id!==undefined && value?.id!==id)return false;finish(null,{body:value,session});return true;};
      incoming.setEncoding('utf8');
      incoming.on('data',chunk=>{
        if(done)return;
        size+=Buffer.byteLength(chunk);if(size>responseLimit)return finish(failure('Tools 応答が上限を超えました。'));
        buffer+=chunk;
        if(sse){buffer=buffer.replace(/\r\n/g,'\n');let end;while((end=buffer.indexOf('\n\n'))>=0){const event=buffer.slice(0,end);buffer=buffer.slice(end+2);const data=event.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');if(data)try{if(accept(JSON.parse(data)))return;}catch{return finish(failure('MCP 応答を読み取れません。'));}}}
      });
      incoming.on('end',()=>{if(done)return;if(!buffer.trim() && id===undefined)return finish(null,{body:null,session});try{if(!sse && accept(JSON.parse(buffer)))return;}catch{}finish(failure('MCP 応答を読み取れません。'));});
      incoming.on('error',()=>finish(failure('Tools との通信が切断されました。')));
      incoming.on('aborted',()=>finish(failure('Tools との通信が切断されました。')));
    });
    req.on('error',()=>finish(failure('Tools に接続できません。')));req.end(bytes);
  });
}
// MCPの生エラーには資格情報や入力が混ざり得るため、判断系の既知カテゴリだけを固定文言へ変換。
// 文字列そのものや未対応の詳細は画面へ渡さない。
function decisionFailureDetail(error) {
  const parts=[error?.message,...(Array.isArray(error?.content)?error.content.filter(item=>item?.type==='text').map(item=>item.text):[])];
  const detail=parts.filter(item=>typeof item==='string').map(item=>item.slice(0,8192)).join('\n').slice(0,16384);
  const routes=[
    ['Decisions API','OpenAI Decisions API（APIキー方式）','APIキー・利用権限・課金・入力'],
    ['OAuth Responses','OpenAI OAuth Responses','OAuth認証・モデル・JSON Schema対応'],
    ['Gemini JSON判断','Gemini / FreeAI JSON判断','APIキー・モデル・JSON対応・利用枠'],
  ];
  for(const [prefix,name,check] of routes){
    const match=detail.match(new RegExp(`${prefix} HTTP ([45][0-9]{2})(?![0-9])`));
    if(match)return `${name} が HTTP ${match[1]} を返しました。${check}を確認してください。`;
  }
  const known=[
    ['AI判断の起動チェックが未完了','AI判断の起動チェックが未完了です。Toolsの起動完了を待って再試行してください。'],
    ['すべてのAI判断プロバイダが利用できません','AI判断の起動チェックで利用可能なプロバイダがありません。設定・認証とToolsの起動ログを確認してください。'],
    ['Codex OAuth認証が必要です','OpenAI OAuth認証が必要です。codex login または aidiy_hermes の認証状態を確認してください。'],
    ['AI判断の設定ファイルを読み込めません','AI判断の設定ファイルを読み込めません。'],
    ['未対応のAI判断プロバイダ:','AI判断のプロバイダ設定が未対応です。'],
    ['model と ai_model の指定が競合しています','判断モデルの指定が競合しています。'],
    ['ai_name と model のプロバイダが競合しています','判断プロバイダとモデルの指定が競合しています。'],
    ['モデル名が空です','判断モデル名が空です。'],
    ['AI判断がタイムアウトしました','AI判断がタイムアウトしました。'],
    ['AI判断の接続に失敗しました','AI判断の接続に失敗しました。'],
    ['AI判断の応答形式が不正です','AI判断の応答形式が不正です（JSON・回答名・型・確率分布）。'],
    ['Gemini JSON判断は入力を拒否しました','Gemini / FreeAI JSON判断が入力を拒否しました。'],
    ['Gemini JSON判断の回答候補が不正です','Gemini / FreeAI JSON判断の回答候補が不正です。'],
    ['Gemini JSON判断が拒否・未完了・異常終了しました','Gemini / FreeAI JSON判断が拒否・未完了・異常終了しました。'],
    ['Gemini JSON判断の本文がありません','Gemini / FreeAI JSON判断の応答本文がありません。'],
    ['Gemini JSON判断の本文形式が不正です','Gemini / FreeAI JSON判断の応答本文形式が不正です。'],
    ['OAuth Responses が失敗または未完了で終了しました','OpenAI OAuth Responses が失敗または未完了で終了しました。'],
    ['OAuth Responses の完了状態が不正です','OpenAI OAuth Responses の完了状態が不正です。'],
    ['OAuth Responses のストリームが完了前に切断されました','OpenAI OAuth Responses のストリームが完了前に切断されました。'],
  ];
  for(const [match,message] of known)if(detail.includes(match))return message;
  if(/(?:openai_key_id|gemini_key_id|freeai_key_id)(?: \/ (?:gemini_key_id|freeai_key_id))? が未設定です/.test(detail))return 'AI判断のAPIキーが未設定です。';
  return '';
}
export async function callMcp(row, config, {signal,request=localRequest,manual}={}) {
  const chat=row.区分==='CHAT',decision=row.区分==='DECISION',path=decision?'/aidiy_decisions_check/mcp':chat?'/aidiy_chat_llms/mcp':'/aidiy_code_agents/mcp',port=portOf(config);
  const project=decision?'':trialProjectPath(config);
  if(!decision&&!project)throw failure('CODE_BASE_PATHに会話履歴の対象プロジェクトを設定してください。');
  let session,protocol='2024-11-05';
  const headers=()=>({'MCP-Protocol-Version':protocol,...(session?{'Mcp-Session-Id':session}:{})});
  const rpc=async(id,method,params)=>{const response=await request({port,path,signal,id,headers:headers(),body:{jsonrpc:'2.0',...(id===undefined?{}:{id}),method,params}});session=response.session || session;if(id!==undefined && response.body?.jsonrpc!=='2.0')throw failure('MCP 応答が不正です。');if(response.body?.error)throw failure((decision&&decisionFailureDetail(response.body.error))||'MCP ツールの実行に失敗しました。');return response.body?.result;};
  try {
    const init=await rpc(1,'initialize',{protocolVersion:protocol,capabilities:{},clientInfo:{name:'aidiy-diag',version:'1.0'}});
    if(!init || !['2024-11-05','2025-03-26','2025-06-18'].includes(init.protocolVersion))throw failure('MCP 初期化に失敗しました。');protocol=init.protocolVersion;
    await rpc(undefined,'notifications/initialized',{});
    // 既存 MCP の通常契約だけを使う。診断専用 provider / CLI / 認証経路は作らない。
    const option=(key,allowed,fallback='auto')=>allowed.includes(config[key])?config[key]:fallback;
    const args=decision?{input:manual?.prompt??TRIAL_PROMPT,questions:manual?.questions??decisionQuestions(),ai_name:row.プロバイダ,ai_model:row.モデル,timeout_sec:60}:{prompt:manual?.prompt??TRIAL_PROMPT,project_path:project,ai_name:row.プロバイダ,ai_model:row.モデル,resume:false,timeout_sec:60,...(chat?{use_tools:false,session_id:`diag_${randomBytes(12).toString('hex')}`}:{code_permissions:option('CODE_PERMISSIONS',['auto','full','none']),self_check_loop:0})};
    const result=await rpc(2,'tools/call',{name:decision?'decisions_check':chat?'chat_llms_run':'code_agents_run',arguments:args});
    if(result?.isError)throw failure((decision&&decisionFailureDetail(result))||'MCP ツールがエラーを返しました。');
    try{return toolPayload(result);}catch(error){
      if(!decision||!manual)throw error;
      const raw=result?.structuredContent?.result??result?.content?.filter(item=>item.type==='text').map(item=>item.text).join('\n');
      return {status:'NG',raw_response:typeof raw==='string'?raw:''};
    }
  } finally {
    // 中止時も独立した短い期限でセッションを破棄する。
    if(session)try{await request({port,path,method:'DELETE',headers:headers(),timeoutMs:1500});}catch{}
  }
}
// MCP成功だけではOKにしない。選択値は3値すべてを許容し、意味的な正解は固定しない。
export function decisionAnswer(payload) {
  const answers=payload?.data?.answers;
  const invalid=()=>failure('判断応答のJSON形式が不正です。high / medium / low のchoice回答を確認できませんでした。');
  if(payload?.status!=='OK'||!Array.isArray(answers)||answers.length!==1)throw invalid();
  const answer=answers[0],probability=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1;
  if(answer?.type!=='choice'||answer.name!=='politeness'||!DECISION_CHOICES.includes(answer.choice)||!probability(answer.confidence)||!Array.isArray(answer.probabilities)||answer.probabilities.length!==3)throw invalid();
  if(new Set(answer.probabilities.map(item=>item?.value)).size!==3||answer.probabilities.some(item=>!DECISION_CHOICES.includes(item?.value)||!probability(item?.probability))||Math.abs(answer.probabilities.reduce((sum,item)=>sum+item.probability,0)-1)>1e-4)throw invalid();
  return {type:answer.type,name:answer.name,choice:answer.choice,probabilities:answer.probabilities.map(({value,probability})=>({value,probability})),confidence:answer.confidence};
}
// 予測の試行の途中経過。開始時刻から経過秒を求め、完了時に状態と秒を確定する。
function 経過追加(current,内容) {
  const item={内容,状態:'実行中',開始:Date.now()};(current.経過??=[]).push(item);
  return 状態=>{item.状態=状態;item.秒=Math.round((Date.now()-item.開始)/1000);};
}
const 経過一覧=current=>(current?.経過??[]).map(({内容,状態,開始,秒})=>({内容,状態,秒:秒??Math.round((Date.now()-開始)/1000)}));
function redact(value,config,limit=1500) {
  let result=text(value);
  for(const [key,secret] of Object.entries(config))if(/key|token|secret|password/i.test(key) && typeof secret==='string' && secret.length>=4)result=result.split(secret).join('[非表示]');
  return result.replace(/\b(?:sk-[\w-]{8,}|AIza[\w-]{15,}|Bearer\s+\S+)\b/gi,'[非表示]').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').slice(0,limit);
}
export function createModelTrials({reader,statusFn=getToolsStatus,request=localRequest,timeoutMs=TRIAL_ROW_TIMEOUT_MS,catalogReader=readManualCatalog,credentialReader=()=>readOAuth('codex'),installedClisFn=installedCodeClis,audioStore=createAudioStore()}={}) {
  const salt=randomBytes(32);let run,contextVersion='',generation=0;
  const chats=new Map();
  const clearChat=()=>{chats.clear();generation++;};
  const successList=()=>[...chats.values()];
  const readCatalog=async name=>{try{const value=await catalogReader(name);return value&&typeof value==='object'&&!Array.isArray(value)?value:{};}catch{return {};}};
  // 保存済みモデル一覧・認証状態ではなく、現在の実行ファイルの存在だけで判定する。
  // SDK・Hermes本体・auto/sameの自動選択は外部CLIの未導入と混同しない。
  const cliKeys=new Set(['claude_cli','copilot_cli','codex_cli','antigravity_cli','grok_cli','opencode_cli']);
  const installationRow=(row,installed)=>{
    if(!['CODE','TASK','TEAM'].includes(row.区分)||row.状態!=='未実行')return row;
    let provider=({claude_ollama:'claude_cli',codex_ollama:'codex_cli'})[row.プロバイダ]||row.プロバイダ;
    if(['aidiy_hermes','auto','same'].includes(provider))provider=row.モデル.split('/')[0];
    return cliKeys.has(provider)&&installed[provider]===false
      ? {...row,状態:'未実施',説明:`${provider} が未導入のため、テストをスキップしました。`}:row;
  };
  const snapshot=async()=>{
    const [state,config]=await readConfig(reader);
    const [predictionCatalog,chatCatalog,credentials]=await Promise.all([readCatalog('prediction_models'),readCatalog('chat_models'),Promise.resolve().then(()=>credentialReader()).catch(()=>null)]);
    const version=createHmac('sha256',salt).update(JSON.stringify([config,predictionCatalog,chatCatalog,credentials,generation])).digest('hex');
    if(contextVersion!==version){chats.clear();contextVersion=version;}
    const installed=await installedClisFn();
    return {state,config,version,predictionCatalog,installed,rows:configRows(config).map(row=>installationRow(row,installed))};
  };
  function predictionTarget(s,provider,model){
    let name=provider==='auto'?text(s.config.PREDICTION_AI_NAME)||'auto':provider;
    if(name==='auto')name=PREDICTION_AUTO_PROVIDERS.find(name=>Object.keys(s.predictionCatalog[name]?.models||{}).some(id=>label(id)&&!['auto','same'].includes(id)));
    let selected=model==='auto'?text(s.config[PREDICTION_MODEL_KEYS[name]])||'auto':model;
    const models=s.predictionCatalog[name]?.models;
    if(selected==='auto')selected=Object.keys(models||{}).find(id=>label(id)&&!['auto','same'].includes(id));
    let reason='';
    if(!PREDICTION_PROVIDERS.includes(name)||!label(selected)||redact(selected,s.config)!==selected||!models||!Object.hasOwn(models,selected))reason='予測モデル候補がありません。モデル一覧を再取得・書込してください。';
    const project=trialProjectPath(s.config);
    if(!project)reason='CODE_BASE_PATHに予測対象のプロジェクトを設定してください。';
    // 予測前の2ターンはChat試行でOKになったモデルで送る。予測モデルと同じである必要はない。
    const passed=successList().length>0;
    return {provider:label(redact(name,s.config)),model:label(redact(selected,s.config)),project,available:!reason,ready:!reason&&passed,reason:reason||(!passed?'先にChatテストを成功させてください（OKになったモデルで「昔々、あるところに」「おじいさんと」を送ります）。':'')};
  }
  const trialContext=s=>{const row=s.rows.find(row=>row.id==='PREDICTION');const target=predictionTarget(s,row.プロバイダ,row.モデル);return {チャット成功:successList(),予測条件:{プロバイダ:target.provider,モデル:target.model,プロジェクト:redact(target.project,s.config),利用可能:target.available,テスト可能:target.ready,説明:target.reason}};};
  const supported=(family,provider)=>family==='CHAT'?Object.hasOwn(CHAT,provider):family==='LIVE'?Object.hasOwn(LIVE,provider):family==='PREDICTION'?['auto',...PREDICTION_PROVIDERS].includes(provider):family==='DECISION'?DECISION.has(provider):family==='CODE'?CODE.has(provider):false;
  const publicSnapshot=s=>({版:s.version,項目:s.rows,...trialContext(s)});
  function cancel(preserveAudio=false){if(run){const id=run.id;run.controller.abort();clearTimeout(run.timer);run=null;if(!preserveAudio)void audioStore.clear(id).catch(()=>{});}}
  const service={
    async snapshot(){clearChat();return publicSnapshot(await snapshot());},
    invalidateChat(){clearChat();},
    async catalogs(){
      clearChat();const s=await snapshot(),families={};
      for(const [family,file] of Object.entries({CHAT:'chat_models',LIVE:'live_models',PREDICTION:'prediction_models',DECISION:'decisions_models',CODE:'code_models'})){
        let source={},state='読込済み';try{source=await catalogReader(file);if(!source||typeof source!=='object'||Array.isArray(source))throw Error();}catch{state='未取得';}
        const providers=[];
        for(const [provider,info] of Object.entries(source)){
          if(!supported(family,provider)||['auto','same'].includes(provider))continue;
          const models=Object.entries(info?.models||{}).filter(([id,title])=>label(id)&&typeof title==='string'&&redact(id,s.config)===id).map(([id,title])=>({id,名前:redact(title,s.config),保存値:false}));
          if(models.length)providers.push({id:provider,モデル:models});
        }
        for(const row of s.rows.filter(row=>row.区分===family)){
          if(!supported(family,row.プロバイダ)||(family!=='CODE'&&['auto','same'].includes(row.プロバイダ))||!row.モデル)continue;
          let provider=providers.find(p=>p.id===row.プロバイダ);if(!provider){provider={id:row.プロバイダ,モデル:[]};providers.push(provider);}
          if(!provider.モデル.some(m=>m.id===row.モデル))provider.モデル.push({id:row.モデル,名前:row.モデル+'（設定保持値・一覧外）',保存値:true});
        }
        if(family==='PREDICTION')providers.unshift({id:'auto',モデル:[{id:'auto',名前:'auto（自動判定）',保存値:false}]});
        if(family==='DECISION')for(const id of ['auto','openai_oauth','freeai_chat','openai_decisions','gemini_chat'])if(!providers.some(p=>p.id===id))providers.push({id,モデル:[]});
        if(family==='CODE'&&!providers.some(p=>p.id==='auto'))providers.unshift({id:'auto',モデル:[]});
        for(const provider of providers){
          const prefix=family==='CHAT'?CHAT[provider.id]:family==='LIVE'?LIVE[provider.id]:null;
          const configKey=prefix?`${family}_${prefix}_MODEL`:family==='PREDICTION'?PREDICTION_MODEL_KEYS[provider.id]:family==='DECISION'?{openai_oauth:'DECISION_OAUTH_MODEL',openai_jsonchat:'DECISION_OAUTH_MODEL',openai_decisions:'DECISION_OPENAI_MODEL',freeai_chat:'DECISION_FREEAI_MODEL',gemini_chat:'DECISION_GEMINI_MODEL'}[provider.id]:family==='CODE'&&!['auto','same'].includes(provider.id)?`CODE_${provider.id.toUpperCase()}_MODEL`:null;
          const rowModel=s.rows.find(row=>row.区分===family&&row.プロバイダ===provider.id)?.モデル;
          const saved=label(configKey?s.config[configKey]??(family==='CODE'?rowModel:''):rowModel);
          if(saved&&redact(saved,s.config)===saved){provider.現在モデル=saved;if(!provider.モデル.some(m=>m.id===saved))provider.モデル.push({id:saved,名前:saved+'（保持値・Diag一覧外／未確認）',保存値:true});}
          if(family==='CODE')provider.モデル=[
            {id:'auto',名前:'auto (自動判定)',保存値:false},
            {id:'same',名前:'same (変更なし)',保存値:false},
            ...provider.モデル.filter(m=>!['auto','same'].includes(m.id)),
          ];
          if(family==='PREDICTION'&&!provider.モデル.some(m=>m.id==='auto'))provider.モデル.unshift({id:'auto',名前:'auto（既定モデル）',保存値:false});
          if(family==='DECISION'&&!provider.モデル.some(m=>m.id==='auto'))provider.モデル.unshift({id:'auto',名前:'auto（既定モデル）',保存値:false});
        }
        if(family==='PREDICTION')for(const provider of providers)for(const model of provider.モデル){const target=predictionTarget(s,provider.id,model.id);Object.assign(model,{解決プロバイダ:target.provider,解決モデル:target.model,利用可能:target.available,説明:target.available?'':target.reason});}
        families[family]={状態:state,プロバイダ:providers};
      }
      let voices={};try{voices=await catalogReader('live_voices');}catch{}
      for(const provider of families.LIVE.プロバイダ){
        provider.音声=Object.entries(voices?.[provider.id]?.voices||{}).filter(([id,name])=>label(id)&&typeof name==='string'&&redact(id,s.config)===id).map(([id,name])=>({id,名前:redact(name,s.config)}));
        const saved=label(s.config[`LIVE_${LIVE[provider.id]}_VOICE`]);
        if(saved&&redact(saved,s.config)===saved)provider.現在音声=saved;
        if(saved&&redact(saved,s.config)===saved&&!provider.音声.some(v=>v.id===saved))provider.音声.push({id:saved,名前:saved+'（設定保持値・一覧外）'});
      }
      const 初期値=Object.fromEntries(s.rows.filter(row=>['CHAT','LIVE','PREDICTION','DECISION','CODE1'].includes(row.id)).map(row=>[row.区分,{provider:row.プロバイダ,model:row.モデル,voice:row.音声}]));
      return {区分:families,版:s.version,初期値,...trialContext(s)};
    },
    async start({signal,rowId,manual,manuals}={}) {
      if(run)throw failure('前の試行を終了してから開始してください。');
      if(manuals!==undefined){
        if(!Array.isArray(manuals)||manuals.length!==TRIAL_FAMILIES.length||manuals.some((item,i)=>item?.family!==TRIAL_FAMILIES[i]))throw failure('一括試行はCHAT・LIVE・PREDICTION・DECISION・CODEの順に指定してください。',400);
        manuals=manuals.map(item=>{try{return manualInput(item,supported,label);}catch(error){return {family:item.family,provider:'',model:'',voice:'',invalid:error.message};}});
      }
      if(manual)manual=manualInput(manual,supported,label);
      const manualRows=(manuals||[manual]).filter(Boolean).map(item=>({id:item.family==='CODE'?'CODE1':item.family,区分:item.family,プロバイダ:item.provider,モデル:item.model,音声:item.voice,状態:item.invalid?'NG':'未実行',説明:item.invalid||''}));
      // 準備中も占有し、同時の開始を拒否する。
      const current={id:randomBytes(16).toString('hex'),controller:new AbortController(),cache:new Map(),index:0,busy:false};run=current;
      const abort=()=>current.controller.abort();signal?.addEventListener('abort',abort,{once:true});
      try {await audioStore.clear();if(signal?.aborted)abort();const s=await snapshot();if(s.state!=='読込済み' || !portOf(s.config))throw failure('設定ファイルを読み取れません。');const queue=manualRows.length?manualRows:rowId===undefined?s.rows:s.rows.filter(row=>row.id===rowId);if(!queue.length)throw failure('設定項目が見つかりません。',404);if(queue.some(row=>row.区分==='CHAT'))chats.clear();if(queue.length===1&&queue[0].区分==='PREDICTION'){const target=predictionTarget(s,queue[0].プロバイダ,queue[0].モデル);if(!target.ready)throw failure(target.reason);}if(!(await statusFn({signal:current.controller.signal})).online || current.controller.signal.aborted)throw failure('Tools に接続してください。');Object.assign(current,s,{queue,manual,manuals});current.timer=setTimeout(cancel,TRIAL_RUN_TTL_MS);current.timer.unref?.();return {実行ID:current.id,実行順:queue.map(row=>row.id),...publicSnapshot(s)};}
      catch(error){if(run===current)cancel();throw error;}finally{signal?.removeEventListener('abort',abort);}
    },
    cancel(id){if(run?.id!==id)throw failure('試行が見つかりません。',404);cancel();return {状態:'中止'};},
    // 1回の要求で進む予測の試行（2ターン＋予測）の途中経過。画面が実行中に問い合わせる。
    progress(id){if(run?.id!==id)throw failure('試行が見つかりません。',404);return {経過:経過一覧(run)};},
    async next(id,rowId,{signal}={}) {
      const current=run;if(!current || current.id!==id || !current.rows)throw failure('試行が見つかりません。',404);
      if(current.busy)throw failure('モデル試行は順番に実行してください。');
      const row=current.queue[current.index];if(row?.id!==rowId)throw failure('モデル試行の順序が一致しません。');
      const manual=current.manuals?.find(item=>item.family===row.区分)||current.manual;
      const key=sharedKey(row);
      // 再試行の失敗・中止で古いChat成功を使わない。
      if(row.区分==='CHAT')chats.clear();
      current.busy=true;current.経過=[];current.予測完了=null;const started=Date.now(),abort=()=>current.controller.abort();signal?.addEventListener('abort',abort,{once:true});
      let timedOut=false;const timer=setTimeout(()=>{timedOut=true;abort();},row.区分==='PREDICTION'?timeoutMs*2:timeoutMs);if(signal?.aborted)abort();
      try {
        const latest=await snapshot();if(latest.version!==current.version){cancel();throw Object.assign(failure('設定が変更されました。読み直して開始してください。'),{configChanged:true});}
        const base={id:row.id,状態:row.状態,応答:'',実行モデル:'',共有元:'',所要ms:0,説明:row.説明};
        if(current.controller.signal.aborted)throw failure('試行を中止しました。');
        // 開始後の削除・導入も再確認。古い成功・失敗の共有より先に未導入を除外する。
        const checked=installationRow({...row,状態:row.状態==='未実施'?'未実行':row.状態},latest.installed);
        if(checked.状態!=='未実行'){current.cache.delete(key);return {...base,状態:checked.状態,説明:checked.説明};}
        // 同じ設定版・固定オプションでのみ共有。CHAT/LIVE は CODE 系と混ぜない。
        if(current.cache.has(key)){const prior=current.cache.get(key);return {...prior,id:row.id,共有元:prior.id,所要ms:0};}
        let payload;
        if(row.区分==='PREDICTION'){
          const target=predictionTarget(current,row.プロバイダ,row.モデル);
          if(!target.ready)return {...base,状態:'未実施',説明:target.reason};
          // 予測の材料として、Chat試行でOKになったモデルで2ターンを送り、通常経路で会話履歴へ保存させる。
          const cli=PREDICTION_CLI_PROVIDERS.includes(target.provider),chat=successList().at(-1);
          for(const prompt of PREDICTION_STORY_PROMPTS){
            const done=経過追加(current,`「${prompt}」を送信（${chat.provider} / ${chat.model}）`);
            const turn=await callMcp({区分:'CHAT',プロバイダ:chat.provider,モデル:chat.model},current.config,{signal:current.controller.signal,request,manual:{prompt}});
            if(current.controller.signal.aborted)throw failure('試行を中止しました。');
            if(turn?.status!=='OK'||turn?.history_saved!==true){done('NG');const result={...base,状態:'NG',実行プロバイダ:target.provider,実行モデル:target.model,所要ms:Date.now()-started,説明:`予測前の会話「${prompt}」を送信・履歴保存できませんでした。`,経過:経過一覧(current)};current.cache.set(key,result);return result;}
            done('OK');
          }
          current.予測完了=経過追加(current,`予測を実行（${target.provider} / ${target.model}）`);
          payload=(await request({port:portOf(current.config),path:'/internal/prediction_llms',body:{project_path:target.project,ai_name:target.provider,ai_model:target.model,timeout_sec:cli?120:60},headers:{'X-AiDiy-Diag':'model-trial'},signal:current.controller.signal,timeoutMs:cli?135000:75000})).body;
        }
        else if(row.区分==='LIVE')payload=(await request({port:portOf(current.config),path:'/internal/live_model_check',body:manual?{ai_name:row.プロバイダ,ai_model:row.モデル,voice:row.音声,prompt:manual.prompt}:{},headers:{'X-AiDiy-Diag':'model-trial'},signal:current.controller.signal,timeoutMs:LIVE_HTTP_TIMEOUT_MS,responseLimit:DIAG_TRANSPORT_BYTE_LIMIT})).body;
        else payload=await callMcp(row,current.config,{signal:current.controller.signal,request,manual});
        if(current.controller.signal.aborted)throw failure('試行を中止しました。');
        if((await snapshot()).version!==current.version){cancel();throw Object.assign(failure('設定が変更されました。読み直して開始してください。'),{configChanged:true});}
        if(row.区分==='PREDICTION'){
          const answer=text(payload?.result),ok=payload?.status==='OK'&&Boolean(answer);
          const perfect=ok&&predictionPerfect(answer);
          current.予測完了?.(ok?'OK':'NG');
          const result={...base,経過:経過一覧(current),状態:ok?'OK':'NG',...(ok?{予測評価:perfect?'完璧':'OK'}:{}),応答:ok?redact(answer,current.config,4000):'',実行プロバイダ:label(redact(payload?.ai_name,current.config)),実行モデル:label(redact(payload?.ai_model,current.config)),所要ms:Date.now()-started,説明:perfect?'「昔々、あるところに」「おじいさんと」の続きとして「おばあさん」を予測しました（完璧）。':ok?'「昔々、あるところに」「おじいさんと」の後の予測応答を確認しました（!・！を含む説明も応答として扱います）。':`予測応答を確認できませんでした。${answer?`（${redact(answer,current.config).slice(0,300)}）`:''}`};
          current.cache.set(key,result);return result;
        }
        if(row.区分==='DECISION'){
          let answer;
          if(manual){try{answer=manualDecisionAnswer(payload,manual.questions);}catch(error){
            let raw=payload?.raw_response??payload;try{raw=JSON.stringify(typeof raw==='string'?JSON.parse(raw):raw,null,2);}catch{}
            return {...base,状態:'NG',応答:redact(typeof raw==='string'?raw:'',current.config,4*1024*1024),説明:error.message,所要ms:Date.now()-started};
          }}else answer=decisionAnswer(payload);
          const result={...base,状態:'OK',判断結果:answer.choice,応答:redact(JSON.stringify(manual?payload:answer,null,2),current.config,manual?4*1024*1024:1500),実行プロバイダ:label(redact(payload.data.ai_name||payload.data.provider,current.config)),実行モデル:label(redact(payload.data.model||payload.data.ai_model,current.config)),所要ms:Date.now()-started,説明:manual?(answer.type==='refusal'?'モデルが回答を拒否しました。':'判断応答を受信しました。'):`挨拶の丁寧さ: ${answer.choice}（JSON回答形式を確認。選択内容の正誤判定は行いません）`};
          current.cache.set(key,result);return result;
        }
        const answer=text(payload?.result ?? payload?.reply),textOk=payload?.status==='OK' && !!answer && !answer.startsWith('!') && !['（応答なし）','(応答なし)'].includes(answer) && !/^(?:(?:api|ClaudeSDK|Copilot|subprocess)?実行エラー:|(?:Local |Ollama )?ChatAIが停止状態です。|処理タイムアウト\([0-9.]+秒\)が発生しました。|処理がキャンセルされました。|OpenAI OAuth 初期化エラー:|エラー[:：]|error[:：]|exception[:：]|traceback|APIエラー[:：]|認証エラー[:：]|接続エラー[:：]|\[error\])/i.test(answer);
        let audio;
        const live=row.区分==='LIVE';
        if(live && payload?.status==='OK')try{validateAudio(payload.audio);audio=await audioStore.put(payload.audio,current.id);}catch{}
        if(current.controller.signal.aborted || run!==current){await audioStore.clear(current.id);throw failure('試行を中止しました。');}
        if((await snapshot()).version!==current.version){cancel();throw Object.assign(failure('設定が変更されました。読み直して開始してください。'),{configChanged:true});}
        const historySaved=live||payload?.history_saved===true;
        const ok=(textOk && historySaved) || (live && !!audio);
        const historyUnconfirmed=!live && (textOk || payload?.history_error) && !historySaved;
        const actual=row.区分==='LIVE'?payload?.model:row.区分==='CHAT'?payload?.ai_model:payload?.selected_model;
        const result={...base,状態:ok?'OK':payload?.status==='UNSUPPORTED'?'未対応':'NG',応答:(ok && textOk)||(historyUnconfirmed && (textOk||payload?.execution_status==='OK'))?redact(answer,current.config):'',...(audio?{音声ファイル:audio}:{}),実行プロバイダ:label(redact(payload?.provider||payload?.ai_name||payload?.selected_ai,current.config)),実行モデル:['auto','same'].includes(text(actual))?'':label(redact(actual,current.config)),所要ms:Date.now()-started,説明:ok?(audio?'音声応答を確認しました。':live?'1秒以上の再生可能な音声がありません。':'会話履歴への保存を確認しました。'):historyUnconfirmed?'会話履歴への保存を確認できませんでした。AIの処理は完了している場合があります。再試行前に実行結果とDB・Toolsの対応を確認してください。':live?'有効な会話応答または1秒以上の音声応答を確認できませんでした。':payload?.status==='UNSUPPORTED'?'接続先 MCP はこのプロバイダに対応していません。':`有効な会話応答を確認できませんでした。${answer?`（${redact(answer,current.config).slice(0,300)}）`:''}`};
        if(row.区分==='CHAT'&&ok){const provider=label(redact(payload?.ai_name||payload?.provider||row.プロバイダ,current.config)),model=label(redact(payload?.ai_model||payload?.model||row.モデル,current.config));if(Object.hasOwn(CHAT,provider)&&model&&!['auto','same'].includes(model))chats.set(JSON.stringify([provider,model]),{provider,model});}
        current.cache.set(key,result);return result;
      }catch(error){for(const item of current.経過??[])if(item.状態==='実行中'){item.状態='NG';item.秒=Math.round((Date.now()-item.開始)/1000);}if(error?.configChanged)throw error;if(current.controller.signal.aborted){const continuing=!!manual&&timedOut&&run===current&&!signal?.aborted;if(continuing)current.controller=new AbortController();else if(run===current)cancel();const timeout=timedOut&&(!!manual||['DECISION','PREDICTION'].includes(row.区分));return {id:row.id,状態:timeout?'NG':'中止',...(timeout&&!continuing?{実行終了:true}:{}),応答:'',実行モデル:'',共有元:'',所要ms:Date.now()-started,説明:timeout?(manual?'試行が制限時間を超えました。':`${row.区分==='PREDICTION'?'予測':'判断'}試行が制限時間を超えました。`):'試行を中止しました。'};}if(run!==current)throw error;const result={id:row.id,状態:'NG',応答:'',実行モデル:'',共有元:'',所要ms:Date.now()-started,説明:error?.trialFailure?error.message:row.区分==='DECISION'?'Tools から判断応答を取得できませんでした。':row.区分==='PREDICTION'?'Tools から予測応答を取得できませんでした。':'Tools から会話応答を取得できませんでした。'};current.cache.set(key,result);return result;}
      finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);current.busy=false;current.index++;if(current.index>=current.queue.length && run===current)cancel(true);}
    },
    audio:id=>audioStore.get(id),
    close(){cancel();return audioStore.close().catch(()=>{});},
  };
  const next=service.next;service.next=async(...args)=>{const result=await next(...args);return {...result,...trialContext(await snapshot())};};
  return service;
}
