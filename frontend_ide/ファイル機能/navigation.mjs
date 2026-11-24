import {DEFAULT_NAVIGATION_GOAL} from '../src/components/開発スペース/Navi既定値.js';
// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 開発目標のナビゲーション。既存CLI読取専用境界を使い、実作業は開始しない。
import {readFile, readdir, realpath, stat, writeFile, rename, mkdir, rm} from 'node:fs/promises';
import {join, dirname, relative, isAbsolute, sep} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import storage from '../host/scripts/project-storage.cjs';
import {fileURLToPath} from 'node:url';
import {scanTree} from '../viewer/file-scan.mjs';
import {latestFiles} from '../src/components/ファイル閲覧/最新ファイル.js';
import {runNavigationAgent,navigationAvailability} from './navigation-agent.mjs';
import {failedNavigationResponse,navigationRetryPrompt} from './navigation-retry.mjs';
import {NAVI_PROVIDERS} from '../../frontend_diag/diag/モデル情報/navi_providers.mjs';
async function replaceState(source,target){for(let attempt=0;;attempt++){try{return await rename(source,target);}catch(error){if(process.platform!=='win32'||!['EPERM','EACCES','EBUSY'].includes(error.code)||attempt>=4)throw error;await new Promise(done=>setTimeout(done,25*(attempt+1)));}}}
const within=(root,path)=>{const back=relative(root,path);return back!=='..'&&!back.startsWith(`..${sep}`)&&!isAbsolute(back);};
const text=(value,max)=>typeof value==='string'&&!!value.trim()&&value.length<=max;
const checkedTime=value=>Number.isSafeInteger(value)&&value>=0&&Number.isFinite(new Date(value).getTime())?value:null;
export function validateNavigation(data,job){
 if(data?.schemaVersion!==3)throw Error('Navi記録の形式が未対応です。旧形式への切替は行いません。「＋ 新規」で記録を切り替えてから「ナビ」で再作成してください。');
 if(!text(data?.requestId,80)||!text(data?.goal,4000)||data?.requestId!==job.id||((!job.inferred||job.action==='evaluate')&&data.goal!==job.goal)||!Array.isArray(data.items)||data.items.length>50)throw Error('Navi結果の依頼・目標・項目・次のプロンプトを確認してください。');
 if(job.action==='evaluate'&&(data.items.length!==job.items.length||data.items.some((item,index)=>['id','name','reason','weight','weightReason'].some(key=>item?.[key]!==job.items[index][key]))))throw Error('評価では項目の追加・削除・並べ替え・改名や根拠・工数比率・配分理由の変更はできません。達成度の数値だけを更新してください。');
 const ids=new Set();
 const items=data.items.map(item=>{
  if(!text(item?.id,80)||ids.has(item.id)||!text(item.name,200)||(!Number.isInteger(item.progress)||item.progress<0||item.progress>100)||!Number.isInteger(item.weight)||item.weight<1||item.weight>100||!text(item.weightReason,2000)||!text(item.reason,2000))throw Error('Navi項目のID・名前・達成度（整数0〜100、未実施・未評価は0）・工数比率（1〜100）・根拠が不正です。');
  ids.add(item.id);return {id:item.id,name:item.name,progress:item.progress,reason:item.reason,weight:item.weight,weightReason:item.weightReason};
 });
 if(items.length&&items.reduce((sum,item)=>sum+item.weight,0)!==100)throw Error('Naviの工数比率は合計100%にしてください。');
 const expected=Math.round(items.reduce((sum,item)=>sum+item.weight*item.progress,0)/100);
 if(!data.overall||!text(data.overall.reason,4000)||data.overall.progress!==expected)throw Error('Naviの総合評価と工数比率・達成度が一致しません。総合は未実施・未評価を0%として加重平均を四捨五入し、項目がない場合は0にしてください。');
 const nextItem=items.find(item=>item.progress<100);
 if(data.nextItemId!==(nextItem?.id??null)||(nextItem?!text(data.nextPrompt,8000):data.nextPrompt!==''))throw Error('おすすめプロンプトは上から最初の100%未満の項目1つだけを対象にしてください。全項目100%・項目なしの場合はnextItemIdをnull、nextPromptを空文字にしてください。');
 return {schemaVersion:3,requestId:job.id,goal:data.goal,inferred:!!job.inferred,items,overall:{progress:data.overall.progress,reason:data.overall.reason},nextItemId:data.nextItemId,nextPrompt:data.nextPrompt};
}

// 返答全体がJSONならその構造を保持する。説明文付きの場合だけ最初の{〜最後の}を解析する。
// JSON.parseに括弧・引用符・エスケープの解釈を任せ、複数オブジェクトから勝手に1件を選ばない。
export function parseNavigationResponse(content){
 if(typeof content!=='string'||Buffer.byteLength(content)>1024*1024)throw Error('Naviの回答サイズ・形式が不正です。');
 const text=content.trim().replace(/^\uFEFF/,'').trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i,'$1').trim();
 try{return JSON.parse(text);}catch{}
 const start=text.indexOf('{'),end=text.lastIndexOf('}');
 if(start<0||end<start)throw Error('Naviの回答に完成したJSONオブジェクトが見つかりません。');
 if(text.slice(0,start).trimEnd().endsWith('[')&&text.slice(end+1).trimStart().startsWith(']'))throw Error('Naviの回答は配列ではなく単一のJSONオブジェクトにしてください。');
 try{return JSON.parse(text.slice(start,end+1));}
 catch{throw Error('Naviの回答を単一のJSONとして読み取れません。複数の結果や未完成のJSONが含まれていないか確認してください。');}
}

// 今回のAI応答だけに適用する未評価0%の規約。保存済み記録の読戻しには使わない。
export function validateNavigationResponse(data,job){
 if(data?.schemaVersion!==3||!Array.isArray(data.items)||!data.overall)return validateNavigation(data,job);
 const note=(reason,extra,max)=>text(reason,max)&&reason.length+extra.length<=max?reason+extra:reason;
 const items=data.items.map(item=>item?.progress===null?{...item,progress:0,reason:job.action==='evaluate'?item.reason:note(item.reason,'\n未評価のため0%として集計。',2000)}:item);
 const overall=data.overall.progress===null?{...data.overall,progress:Math.round(items.reduce((sum,item)=>sum+(item?.weight*item?.progress),0)/100),reason:note(data.overall.reason,'\n未実施・未評価を0%とする規約に従い、全項目の工数比率による加重評価を数値化。',4000)}:data.overall;
 return validateNavigation({...data,items,overall},job);
}

export function validateNavigationModel(value){
 if(!value||!NAVI_PROVIDERS.includes(value.provider)||!text(value.model,300)||/[\x00-\x1f]/.test(value.model))throw Error('読取専用対応AIとモデルを選択してください。');
 return {provider:value.provider,model:value.model.trim()};
}
// DiagがCode一覧から生成したread-only専用候補を使用。実行時の制約は別途必須。
export async function navigationCatalog(provider,file=fileURLToPath(new URL('../../_AIDIY/aidiy_diag/navi_models_info.json',import.meta.url))){
 if(!NAVI_PROVIDERS.includes(provider))throw Error('対応していないAIです。');
 let models,notice='';try{const info=JSON.parse(await readFile(file,'utf8'));if(info._meta?.schema!==1||info._meta?.readOnly!==true)throw Error('旧形式');models=info[provider]?.models;}catch{notice='Navi用モデル一覧が未作成・旧形式・読込不能です。Diagでモデル情報を書き出してください。';}
 const items=[{id:'same',label:'same（前回のモデル）'},{id:'auto',label:'auto（自動選択）'}];
 if(models&&typeof models==='object'&&!Array.isArray(models))for(const [id,label]of Object.entries(models)){
  if(['same','auto'].includes(id)||typeof label!=='string'||!text(id,300)||/[\x00-\x1f]/.test(id))continue;
  if(['aidiy_hermes','aidiy_pi'].includes(provider)&&/^(?:[a-z0-9_-]*_cli|codex|copilot|claude|claude-code|codex-cli|copilot-cli|opencode|opencode-cli|antigravity|grok)[/:]/i.test(id))continue;
  items.push({id,label});
 }
 return {items,notice};
}
export async function navigationModels(provider,file){return (await navigationCatalog(provider,file)).items;}
// Diagが保存した候補をそのまま使う。画面表示時には環境を再確認しない。
export async function navigationProviders(file=fileURLToPath(new URL('../../_AIDIY/aidiy_diag/navi_models_info.json',import.meta.url))){
 let info;try{info=JSON.parse(await readFile(file,'utf8'));if(info._meta?.schema!==1||info._meta?.readOnly!==true)throw Error('旧形式');}catch{return {providers:[],notice:'Navi用モデル一覧をDiagで書き出してください。'};}
 const candidates=Object.keys(info).filter(provider=>{if(!NAVI_PROVIDERS.includes(provider))return false;const models=info[provider]?.models;return models&&typeof models==='object'&&!Array.isArray(models)&&Object.entries(models).some(([id,label])=>text(id,300)&&typeof label==='string'&&!/[\x00-\x1f]/.test(id)&&(!['aidiy_hermes','aidiy_pi'].includes(provider)||!/^(?:[a-z0-9_-]*_cli|codex|copilot|claude|claude-code|codex-cli|copilot-cli|opencode|opencode-cli|antigravity|grok)[/:]/i.test(id)));});
 return {providers:candidates,notice:candidates.length?'':'Navi用AIの候補がありません。Diagの一覧を更新してください。'};
}
// CodeのHermes用既定値を共有し、保存済みの窓別選択を優先する。
export async function navigationDefaultModel(file=fileURLToPath(new URL('../../_config/AiDiy_key.json',import.meta.url))){
 let model='auto';
 try{const config=JSON.parse((await readFile(file,'utf8')).replace(/^\uFEFF/,''));model=config.CODE_AIDIY_HERMES_MODEL||'auto';}catch{}
 try{return validateNavigationModel({provider:'aidiy_hermes',model});}catch{return {provider:'aidiy_hermes',model:'auto'};}
}
export function createNavigation(project,{state,defaultModel=navigationDefaultModel,runAgent=runNavigationAgent,availability=runAgent===runNavigationAgent?navigationAvailability:async()=>({available:true,reason:''}),providerList=navigationProviders,waitMs=300000,now=Date.now,scan=scanTree,stateRoot=join(storage.programDataDirectory(project,'aidiy_navi',fileURLToPath(new URL('../../',import.meta.url))),'navigation'),instance='default',modelFile=join(dirname(stateRoot),'aidiy_navi_model.json')}={}){
 project=storage.projectRoot(project,fileURLToPath(new URL('../../',import.meta.url)));
 if(!/^[a-zA-Z0-9_-]{1,80}$/.test(instance))throw Error('Navi IDが不正です。');
 let job=null,closed=false,starting=null;
 const cancelledRequests=new Set();
 const validRequest=id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{1,160}$/.test(id);
 const rememberCancel=id=>{cancelledRequests.add(id);if(cancelledRequests.size>256)cancelledRequests.delete(cancelledRequests.values().next().value);};
 const directory=async()=>{const identity=await realpath(project);const folder=join(stateRoot,createHash('sha256').update(process.platform==='win32'?identity.toLowerCase():identity).digest('hex'),instance);await mkdir(folder,{recursive:true});const base=await realpath(stateRoot);if(!within(base,await realpath(folder)))throw Error('Navi保存先が不正です。');return folder;};
 const historyDirectory=async()=>{const dir=join(await directory(),'..','history');await mkdir(dir,{recursive:true});const base=await realpath(stateRoot),full=await realpath(dir);if(!within(base,full))throw Error('Navi履歴の保存先が不正です。');return full;};
 const validId=id=>typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id);
 // 旧記録の明示的な更新日時だけを評価日時として使う。作成日時から補完せず、不明は履歴選択後も保持する。
 const restored=data=>({evaluationBasis:['source','documents'].includes(data.evaluationBasis)?data.evaluationBasis:'auto',...validateNavigation(data,{id:data.requestId,goal:data.goal,inferred:data.inferred}),createdAt:data.createdAt,navigationId:validId(data.navigationId)?data.navigationId:data.requestId,updatedAt:data.updatedAt||data.createdAt,checkedAt:checkedTime(Object.hasOwn(data,'checkedAt')?data.checkedAt:data.updatedAt),...(data.selection?{selection:validateNavigationModel(data.selection)}:{})});
 async function atomicJSON(file,data){const temporary=file+'.'+randomUUID()+'.tmp';try{await writeFile(temporary,JSON.stringify(data,null,2),{encoding:'utf8',flag:'wx'});await replaceState(temporary,file);}finally{await rm(temporary,{force:true});}}
 async function historyRead(id){if(!validId(id))throw Error('Navi履歴IDが不正です。');const dir=await historyDirectory(),file=await realpath(join(dir,id+'.json'));if(!within(dir,file)||(await stat(file)).size>1024*1024)throw Error('Navi履歴が不正です。');return restored(JSON.parse(await readFile(file,'utf8')));}
 async function list(){active();const dir=await historyDirectory(),items=[];for(const name of await readdir(dir)){if(!name.endsWith('.json')||!validId(name.slice(0,-5)))continue;try{const item=await historyRead(name.slice(0,-5));items.push({id:item.navigationId,goal:item.goal,updatedAt:item.updatedAt});}catch{}}return items.sort((a,b)=>b.updatedAt-a.updatedAt);}
 async function select(id){active();if(starting||job&&current(job)&&job.status==='running')throw Error('解析完了後に履歴を選択してください。');const result=await historyRead(id);await atomicJSON(join(await directory(),'latest.json'),result);job=null;return get();}
 async function fresh(){active();if(starting||job&&current(job)&&job.status==='running')throw Error('解析完了後に新規作成してください。');await rm(join(await directory(),'latest.json'),{force:true});job=null;return get();}
 // 最後に確定したモデルは、Code / Liveと同じく プロジェクトの _AIDIY/aidiy_navi/aidiy_navi_model.json（同じプロジェクトの窓に共通）へ保存する。次に開く窓はその値で始まる。
 // 開いている窓は、最初に読んだ値か自分で確定した値を保持し、他の窓の確定では変わらない。開いた時点で保存済みの値がなければ既定値を使い、保存ファイルを再読込しない。
 let selected=null,openedWithoutSaved=false;
 async function readModel(){
  if(selected)return selected;
  if(!openedWithoutSaved){try{return selected=validateNavigationModel(JSON.parse(await readFile(modelFile,'utf8')));}catch{openedWithoutSaved=true;}}
  return validateNavigationModel(await defaultModel());
 }
 async function saveModel(value){active();if(starting||job&&current(job)&&job.status==='running')throw Error('解析完了後にモデルを変更してください。');const model=validateNavigationModel(value);await mkdir(dirname(modelFile),{recursive:true,mode:0o700});const temp=modelFile+'.'+randomUUID()+'.tmp';try{await writeFile(temp,JSON.stringify(model,null,2)+'\n',{encoding:'utf8',mode:0o600,flag:'wx'});await replaceState(temp,modelFile);}finally{await rm(temp,{force:true});}selected=model;return model;}
 const active=()=>{if(closed||!state().active)throw Error('IDEの利用を開始してください。');};
 const current=j=>!closed&&state().active&&state().startedAt===j.session&&job===j;
 async function read(){
  const dir=await directory(),path=join(dir,'latest.json');
  try{const full=await realpath(path);if(!within(dir,full)||(await stat(full)).size>1024*1024)throw Error('Navi記録の保存先・サイズが不正です。');
   const data=JSON.parse(await readFile(full,'utf8'));return restored(data);
  }catch(e){if(e.code==='ENOENT')return null;throw e;}
 }
 const describeJob=j=>({id:j.id,action:j.action,clientRequestId:j.clientRequestId,goal:j.goal,status:j.status,message:j.message,deadline:j.deadline,
  ...(j.status==='failed'&&j.failedResponses?.length?{failedResponses:j.failedResponses}:{})});
 const describe=()=>job&&current(job)?describeJob(job):null;
 async function cancel({clientRequestId,jobId}={}){
  active();if(clientRequestId!==undefined&&!validRequest(clientRequestId)||jobId!==undefined&&!validId(jobId)||clientRequestId===undefined&&jobId===undefined)throw Error('中止するNavi要求IDが不正です。');
  if(clientRequestId!==undefined)rememberCancel(clientRequestId);
  const j=job;
  if(j&&current(j)&&(clientRequestId!==undefined?j.clientRequestId===clientRequestId:j.id===jobId)&&j.status==='running'){
   // 保存開始後は完了まで待ち、中止したとは返さない。次の開始も同じ間は拒否する。
   if(j.committing)await j.done;
   else{j.status='cancelled';j.message='処理を中止しました。';if(starting===j)starting=null;j.controller.abort();}
  }
  return {job:describe()};
 }
 async function get(){active();const selection=await readModel();return {result:await read(),job:describe(),selection,availability:state().mode==='offline'?{available:false,reason:'オフライン利用中です。オンライン利用へ戻すと実行できます。'}:await availability(selection)};}
 async function execute(j,dir){
  let timer,temporary,abort;
  const timeoutMessage='5分以内にNavi結果を確認できませんでした。';
  const failureResponses=[];
  try{
   const boundary=new Promise((_,reject)=>{
    timer=setTimeout(()=>{reject(Error(timeoutMessage));j.controller.abort();},Math.max(0,j.deadline-now()));timer.unref?.();
    abort=()=>reject(Error('処理を中止しました。'));j.controller.signal.addEventListener('abort',abort,{once:true});
   });
   const checkActive=()=>{
    if(!current(j)||j.status!=='running')return false;
    if(j.controller.signal.aborted||now()>=j.deadline){j.controller.abort();throw Error(timeoutMessage);}
    return true;
   };
   let result,prompt=j.prompt;
   for(let attempt=1;attempt<=2;attempt++){
    if(!checkActive())return;
    const answer=await Promise.race([boundary,Promise.resolve().then(()=>checkActive()?runAgent({project,prompt,signal:j.controller.signal,selection:j.selection}):null)]);
    if(!checkActive())return;
    const content=typeof answer==='string'?answer:answer?.content;
    if(typeof content!=='string'||!content.trim())throw Error('読取専用AIの回答を確認できません。');
    try{
     const validated=validateNavigationResponse(parseNavigationResponse(content),j),checkedAt=now();
     // 受け取った全項目の有効な評価日時。スコープ追記後の長さもこの段階で検証する。
     result=withNavigationPromptScope({...validated,evaluationBasis:j.evaluationBasis,createdAt:j.createdAt??checkedAt,updatedAt:checkedAt,checkedAt,navigationId:j.navigationId||j.id,selection:j.selection});
     break;
    }catch(error){
     const failure=failedNavigationResponse(attempt,error.message,content);
     failureResponses.push(failure);
     if(attempt===2)throw error;
     j.message='回答の形式を修正するため、一度だけ再試行しています。';
     prompt=navigationRetryPrompt(j.prompt,failure);
    }
   }
   if(!checkActive())return;
   temporary=join(dir,randomUUID()+'.tmp');await writeFile(temporary,JSON.stringify(result,null,2),{encoding:'utf8',flag:'wx'});
   if(!checkActive())return;
   // この代入から保存完了までは中止不可。非同期renameの直前を確定境界にする。
   j.committing=true;clearTimeout(timer);
   await replaceState(temporary,join(dir,'latest.json'));
   await atomicJSON(join(await historyDirectory(),result.navigationId+'.json'),result);
   j.status='complete';j.message='Naviを更新しました。';
  }catch(e){if((current(j)||j.committing)&&j.status==='running'){j.status='failed';j.message=e.code==='ENOENT'?'AIの結果JSONを確認できませんでした。':e.message;j.failedResponses=failureResponses;}}
  finally{clearTimeout(timer);j.controller.signal.removeEventListener('abort',abort);if(temporary)await rm(temporary,{force:true});}
 }
 async function start(goal,action='navigate',clientRequestId,evaluationBasis){
  if(evaluationBasis!==undefined&&!['auto','source','documents'].includes(evaluationBasis))throw Error('評価基準が不正です。');
  active();if(!['navigate','evaluate'].includes(action))throw Error('Navi操作が不正です。');if(state().mode==='offline')throw Error('オンラインで利用を開始してください。');
  if(action==='navigate'&&(typeof goal!=='string'||goal.length>4000||!goal.trim()))throw Error('開発目標を1〜4000文字で入力してください。');
  if(clientRequestId!==undefined&&!validRequest(clientRequestId))throw Error('Navi要求IDが不正です。');
  if(clientRequestId!==undefined&&cancelledRequests.has(clientRequestId))return {job:{id:null,action,clientRequestId,goal,status:'cancelled',message:'処理を中止しました。',deadline:null}};
  if(starting||job?.committing&&job.status==='running'||job&&current(job)&&job.status==='running')throw Error('Naviを作成中です。');
  const j={id:randomUUID(),action,clientRequestId:clientRequestId??null,goal,session:state().startedAt,status:'running',message:'プロジェクトを確認しています。最大5分お待ちください。',deadline:now()+waitMs,controller:new AbortController()};
  starting=j;job=j;
  const interrupted=()=>j.status==='cancelled'||job!==j;
  try{
   const session=j.session,dir=await directory();if(interrupted())return {job:describeJob(j)};active();if(state().startedAt!==session)throw Error('IDEの利用状態が変わりました。');
   const previous=action==='evaluate'?await read():null;if(interrupted())return {job:describeJob(j)};if(action==='evaluate'&&!previous)throw Error('先にNaviで作業項目を作成してください。');
   if(previous)goal=previous.goal;
   evaluationBasis=evaluationBasis??previous?.evaluationBasis??'auto';
   const ready=await availability(await readModel());if(interrupted())return {job:describeJob(j)};if(!ready.available)throw Error(ready.reason||'実行環境が利用できません。');
   const selection=await readModel();if(interrupted())return {job:describeJob(j)};
   const id=j.id;
   Object.assign(j,{evaluationBasis,navigationId:previous?.navigationId,createdAt:previous?.createdAt,selection,items:previous?.items,goal:previous?previous.goal:goal.trim(),inferred:previous?previous.inferred:goal.trim()===DEFAULT_NAVIGATION_GOAL});
   const recentScan=await scan(project,{filter:'backup',limits:{timeMs:3000,maxFiles:10000}});
   if(interrupted())return {job:describeJob(j)};
   if(closed||!state().active||state().startedAt!==session)throw Error('IDEの利用状態が変わりました。');
   const recent=latestFiles(recentScan.tree,0).sort((a,b)=>b.mtime-a.mtime).slice(0,30).map(({path,mtime})=>({path,updatedAt:new Date(mtime).toISOString()}));
   const input={requestId:id,goal:j.inferred&&!previous?null:j.goal,...(previous?{items:previous.items.map(({progress,...item})=>item)}:{})};
   j.prompt=navigationEvaluationPrompt(evaluationBasis)+`プロジェクトを読み取り調査してください。秘密や私的情報を結果に含めず、ファイルは変更しないでください。
【目標と根拠】
${j.inferred&&!previous?'入力データのgoalがnullなのは新規の既定指示です。最近の変更から仮の開発目標をgoalに設定し、推測の根拠と不確実さを示してください。':'入力データのgoalを一字も変えず返してください。'}
観測日時: ${new Date(now()).toISOString()}。最近の更新（相対パスと日時、${recentScan.truncated?'走査上限による一部のみ':'除外規則適用済み'}）: ${JSON.stringify(recent)}。更新一覧は探索の手掛かりです。一覧に該当資料がなくても関連内容を探して読み、日時だけで達成を断定せず、読めない・不足する根拠は明記してください。
${evaluationBasis==='auto'?'':'限定評価の手順: 新規は選択範囲だけで項目を作り、対象資料が未作成でも作成すべき項目は0で返せます。再評価で対象外の項目も削除・改名せず、選択範囲で判定できなければ0にしてoverall.reasonで説明します。次の依頼文は選択範囲の根拠と残作業だけを扱います。\n'}
【採点と次の対象】
1. ${previous?'再評価: 入力データのitemsを同じ数・順序で返し、id・name・reason・weight・weightReasonは一字も変えず維持します。保存済みreasonは過去の記録で、新しい根拠ではありません。明細はprogressの数値だけを今回の調査で採点し、工数比率を再配分しないでください。前回の総合値や提案は入力に含みません。最新の根拠から依頼文として書き直してください。':'新規ナビ: 実際の目標を最大50項目に分け、重複しないid（文字列）とnameを付けます。reasonには現状の根拠と不確実さを示し、weightは全体の見積工数の比率（整数1〜100、項目があれば合計100）にし、weightReasonに根拠を書きます。残工数や重要度の比率ではありません。'}
2. 各progressは整数0〜100。未実施・未評価・根拠不足は0。確認できた範囲だけを評価してください。overall.progressは全項目で sum(weight * progress) / 100 を普通に四捨五入（42.5 → 43）。項目なしなら0。overall.reasonに最新の根拠、未確認部分、加重評価の理由を書きます。progressにnullや"70%"を使いません。
3. 今回のitemsを先頭から見て最初にprogressが100未満の1件だけを選びます。最小の達成率・重要度・weight・IDの大小では選びません。全体が四捨五入で100でも明細に99があれば選び、根拠不足で0の先頭項目も飛ばしません。nextItemIdはそのid文字列を一字も変えず入れます（"2"は数値の2ではありません）。該当なし（全件100または空）はnextItemIdをJSONのnull（文字列の"null"ではない）、nextPromptを厳密に空文字""とし、新たな仕事を作らないでください。
4. 選んだ項目があるときは「今回の目標」「対処しようとしている内容」「今回の作業」の順で、今回の根拠と残作業をその一件だけに絞った依頼文を作ります。後続項目・複数項目は含めず、「レビューアーの指摘に対処してください。」で締めます。作業手順は実行するAIに任せ、修正対象の定型文はアプリが最後に追加するので書かないでください。
【最終回答】
完成したJSONオブジェクト1つだけを返してください。前置き・JSON外の説明・Markdown・コードフェンスは出力せず、途中版・修正版・複数案を並べたりしないでください。回答例や入力データを別掲せず、差分だけでなく全必須キーと全明細・閉じ括弧を省略せず最後まで出力してください。改行・二重引用符・バックスラッシュはJSONの規則でエスケープします。
必須キー: 最上位はschemaVersion・requestId・goal・items・overall・nextItemId・nextPrompt。itemsの各要素はid・name・reason・weight・weightReason・progress。overallはprogress・reason。
schemaVersionは数値3。requestIdは末尾の入力データの値をそのまま使います。文字列の上限はgoal 4000、id 80、name 200、reasonとweightReason 各2000、overall.reason 4000、nextPrompt 7900（アプリの追記余裕）。出力前の照合: 固定値、weight合計、加重平均、最初の未完了IDとnextPromptを確認してください。
【説明用の回答例】例の目標・requestId・項目・根拠を実回答に転記しないでください。
${navigationExamples(evaluationBasis,!!previous)}
入力データ: ${JSON.stringify(input)}`;
   j.deadline=now()+waitMs;j.done=execute(j,dir);return {job:describe()};
  }catch(error){if(interrupted())return {job:describeJob(j)};if(current(j)){j.status='failed';j.message=error.message;}throw error;}finally{if(starting===j)starting=null;}
 }
 return {get,start,cancel,saveModel,list,select,fresh,close(){closed=true;job?.controller.abort();},async handle(req,res,url){
  if(url.pathname!=='/api/navigation')return false;
  const reply=(status,data)=>res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}).end(JSON.stringify(data));
  try{
   if(req.method==='GET')reply(200,url.searchParams.get('providers')==='1'?await providerList():url.searchParams.has('catalog')?await navigationCatalog(url.searchParams.get('catalog')):url.searchParams.get('list')==='1'?{items:await list()}:await get());
   else if(req.method==='POST'||req.method==='PUT'){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>20000)throw Error('入力が大きすぎます。');chunks.push(Buffer.from(chunk));}const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(req.method==='PUT')reply(200,{selection:await saveModel(data)});else if(data.action==='cancel')reply(200,await cancel(data));else if(data.action==='select')reply(200,await select(data.id));else if(data.action==='new')reply(200,await fresh());else reply(202,await start(data.goal,data.action,data.clientRequestId,data.evaluationBasis));}
   else reply(405,{error:'対応していない操作です。'});
  }catch(e){reply(400,{error:e.message});}return true;
 }};
}

// 各作業窓に独立したジョブ・モデル・保存領域を割り当てる。
export function createNavigationInstances(project,options){
 const instances=new Map();
 return {
  close(){for(const service of instances.values())service.close();instances.clear();},
  async handle(req,res,url){
   if(url.pathname!=='/api/navigation')return false;
   const id=url.searchParams.get('instance');
   if(!id||!/^navi-[1-9][0-9]{0,5}$/.test(id)){
    res.writeHead(400,{'content-type':'application/json'}).end(JSON.stringify({error:'Navi IDが不正です。'}));return true;
   }
   let service=instances.get(id);
   if(req.method==='DELETE'){
    service?.close();instances.delete(id);res.writeHead(200,{'content-type':'application/json'}).end('{}');return true;
   }
   if(!service){service=createNavigation(project,{...options,instance:(options.instancePrefix||'')+id});instances.set(id,service);}
   return service.handle(req,res,url);
  }
 };
}


// 自動は既存の要求を変更しない。限定モードは共通の出力・読取専用規則を保ったまま評価の根拠を絞る。
export function navigationEvaluationPrompt(basis){
 if(basis==='source')return '評価基準: 実装ソース。以下の指示中の「関連内容」「関連ファイル」「現状の根拠」は実装ソースとテストコードの内容だけを指します。関連文書・README・設計書・作業履歴の記述は達成度の根拠にしないでください。例: 文書に「実装済み」とあってもソースに存在しなければ完了にしません。実装が存在すれば文書が未整備という理由で減点しません。対象ソースがない・読めない場合は根拠不足として0%にし、overall.reasonに明記してください。新規の項目分解とおすすめプロンプトも実装ソースの範囲に限定します。再評価では保存済み項目を維持しますが、保存済みの達成率やreasonを新しい根拠にせず、今回のソースだけで再判定してください。\n';
 if(basis==='documents')return '評価基準: 関連文書。以下の指示中の「関連内容」「関連ファイル」「現状の根拠」は目標に関連する文書（README・仕様書・設計書・操作手順など）の内容だけを指します。実装ソースやテストコードは評価の根拠にしないでください。例: 実装済みでも必要な説明が文書になければ文書の完成とはしません。文書が整っていれば実装が未完成という理由で減点しません。記述された実装完了を実際の動作保証と混同せず、文書内容の充足度だけを評価してください。対象文書がない・読めない場合は根拠不足として0%にし、overall.reasonに明記してください。新規の項目分解とおすすめプロンプトも関連文書の範囲に限定します。再評価では保存済み項目を維持しますが、保存済みの達成率やreasonを新しい根拠にせず、今回の文書だけで再判定してください。\n';
 return '';
}

// 採点境界と調査範囲を、実際に検証できる完全なJSONで示す。実際の入力とは分離する。
function navigationExamples(basis, reevaluate){
 const scope={
  auto:{
   goal:'検索条件を保存して再利用する',
   detail:[['保存処理','設定の保存先と更新処理を確認。','既存保存処理とデータ整合性の検証に半分を見積もる。'],['読込時の表示','一覧の復元は確認。読込エラーを利用者へ表示していない。','画面と状態遷移に3割を見積もる。'],['動作確認','結合確認は未実施。','確認用データの準備と回帰確認に2割を見積もる。']],
   next:['保存先と更新処理を見つけたが、不正な設定値が保存される場合を確認できていません。','一覧の復元処理は確認しましたが、読込エラーが画面に表示されません。'],
   reviewNext:'一覧の復元と読込エラー表示は確認しましたが、エラー文言に再試行の案内が一箇所ありません。',
   limit:'動作確認の範囲外は保証しない。',
   complete:'この例では保存・読込・動作確認の各項目を確認した。',empty:'目標に結び付く具体的な作業を特定できる根拠がない。',
   done:['設定の保存先と不正値への対応を確認。','一覧の復元と読込エラー表示を確認。','合成データで保存から再表示までの確認が完了。'],
  },
  source:{
   goal:'検索条件の入力と再表示を実装する',
   detail:[['入力処理の実装','空入力と正規化の分岐をソースで確認。','入力処理と型定義の変更を見込み半分。'],['表示処理の実装','表示実装に異常値を受け取った場合の分岐がない。','表示分岐と状態管理に3割を見積もる。'],['テストコードの整備','異常値に対応するテストコードは未作成。','テストコードの追加に2割を見積もる。']],
   next:['正規化はありますが、想定外の型を受ける分岐が入力ソースで未確認です。','表示ソースでは異常値を除外する分岐が未実装です。'],
   reviewNext:'表示ソースに復元・異常値除外の分岐が加わりましたが、空値時に補助ラベル一箇所が未設定です。',
   limit:'ソースとテストコードのみを確認。実行時の動作は保証していません。',
   complete:'対象処理とテストコードの内容を確認。実行時の動作は保証していません。',empty:'目標に結び付く実装ソースやテストコードを特定できない。',
   done:['正規化・空入力・型エラーを扱う入力ソースを確認。','表示ソースに復元・異常値を除外する分岐がある。','正常値と異常値に対応するテストコードがある。'],
  },
  documents:{
   goal:'検索条件の保存仕様と操作手順を文書にまとめる',
   detail:[['要件・仕様の記述','仕様書に保存対象とキー規則が記載されている。','仕様の整理と記載確認に半分を見積もる。'],['操作手順の記述','通常の保存手順はあるが、失敗時の説明がない。','操作例と例外の記述に3割を見積もる。'],['文書間の整合確認','仕様書と操作手順の表記の一致は未確認。','関連文書の照合に2割を見積もる。']],
   next:['仕様書には保存対象がありますが、無効な条件の扱いが記載されていません。','操作手順では通常の保存は説明済みですが、保存失敗時の説明がありません。'],
   reviewNext:'操作手順に通常時と保存失敗時の記述が揃いましたが、再試行のボタン名が一箇所記載されていません。',
   limit:'関連文書の記載だけを評価し、実装や動作は評価していません。',
   complete:'仕様書と操作手順の記載および整合を確認。実装や動作は評価していません。',empty:'目標に結び付く関連文書の内容を確認できない。',
   done:['仕様書に保存対象・キー規則・無効値の扱いがある。','操作手順に通常の保存と失敗時の扱いがある。','仕様書と操作手順で対象・キー・失敗時の説明が一致。'],
  },
 }[basis];
 const requestId=reevaluate?'sample-review':'sample-navigation';
 const ids=['z-12','2','a-7'],weights=[50,30,20];
 const items=scope.detail.map(([name,reason,weightReason],index)=>({id:ids[index],name,reason:reevaluate&&index===2?scope.done[2]:reason,weight:weights[index],weightReason}));
 const make=(scores,overall,reason,id,issue)=>({schemaVersion:3,requestId,goal:scope.goal,
  items:scores.map((progress,i)=>({...items[i],progress})),overall:{progress:overall,reason},nextItemId:id,
  nextPrompt:issue===undefined?'':`今回の目標: ${scope.goal}。\n対処しようとしている内容: ${issue}\n今回の作業: レビューアーの指摘に対処してください。`});
 const line=(label,value)=>label+': '+JSON.stringify(value);
 const complete=make([100,100,100],100,scope.complete,null);
 // 再評価だけは古い明細の根拠をそのまま使い、最新の確認はoverall.reasonに書く。
 if(!reevaluate)complete.items=complete.items.map((item,index)=>({...item,reason:scope.done[index]}));
 return [
  ...(reevaluate?[
   line('例の前回結果（参考・回答ではない）',{...make([60,70,100],71,'前回の加重平均は71。先頭の確認が残っていた。'+scope.limit,'z-12',scope.next[0]),requestId:'sample-previous'}),
   line('回答例（再評価・100,99,100、総合99.7→100でも次は文字列の2）',make([100,99,100],100,'新たに先頭を確認。次の項目に小さな不足だけが残る。加重平均は99.7で表示は100。'+scope.limit,'2',scope.reviewNext)),
  ]:[line('回答例（新規・100,70,0、後続の0でなく最初の未完了）',make([100,70,0],71,'50×100、30×70、20×0を足して100で割ると71。2件目に不足があり3件目は未確認。'+scope.limit,'2',scope.next[1]))]),
  line('回答例（全項目100・追加依頼なし）',complete),
  line('回答例（項目なし・総合0、再評価では入力itemsも空の場合のみ）',make([],0,scope.empty,null)),
 ].join('\n');
}

// 新規・再評価の保存前に範囲指定を付加し、復元・コピー・自動航行で同じ本文を使う。
export function withNavigationPromptScope(result){
 if(!result.nextPrompt?.trim()||!result.items?.some(item=>item.progress<100))return result;
 const suffix=result.evaluationBasis==='source'?'ソースを修正してください。':result.evaluationBasis==='documents'?'関連文書を修正してください。':'';
 if(!suffix)return result;
 const body=result.nextPrompt.trimEnd().replace(/(?:\s*(?:ソースを修正してください。|関連文書を修正してください。))+$/u,'');
 const nextPrompt=body+'\n'+suffix;
 if(nextPrompt.length>8000)throw Error('おすすめプロンプトが評価基準の指示を含め8000文字を超えています。');
 return {...result,nextPrompt};
}
