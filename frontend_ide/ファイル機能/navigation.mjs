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
import {NAVI_PROVIDERS} from '../../backend_diag/diag/モデル情報/navi_providers.mjs';
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
  if(provider==='aidiy_hermes'&&/^(?:[a-z0-9_-]*_cli|codex|copilot|claude|claude-code|codex-cli|copilot-cli|opencode|opencode-cli|antigravity|grok)[/:]/i.test(id))continue;
  items.push({id,label});
 }
 return {items,notice};
}
export async function navigationModels(provider,file){return (await navigationCatalog(provider,file)).items;}
// Diagが保存した候補をそのまま使う。画面表示時には環境を再確認しない。
export async function navigationProviders(file=fileURLToPath(new URL('../../_AIDIY/aidiy_diag/navi_models_info.json',import.meta.url))){
 let info;try{info=JSON.parse(await readFile(file,'utf8'));if(info._meta?.schema!==1||info._meta?.readOnly!==true)throw Error('旧形式');}catch{return {providers:[],notice:'Navi用モデル一覧をDiagで書き出してください。'};}
 const candidates=Object.keys(info).filter(provider=>{if(!NAVI_PROVIDERS.includes(provider))return false;const models=info[provider]?.models;return models&&typeof models==='object'&&!Array.isArray(models)&&Object.entries(models).some(([id,label])=>text(id,300)&&typeof label==='string'&&!/[\x00-\x1f]/.test(id)&&(provider!=='aidiy_hermes'||!/^(?:[a-z0-9_-]*_cli|codex|copilot|claude|claude-code|codex-cli|copilot-cli|opencode|opencode-cli|antigravity|grok)[/:]/i.test(id)));});
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
 const restored=data=>({...validateNavigation(data,{id:data.requestId,goal:data.goal,inferred:data.inferred}),createdAt:data.createdAt,navigationId:validId(data.navigationId)?data.navigationId:data.requestId,updatedAt:data.updatedAt||data.createdAt,checkedAt:checkedTime(Object.hasOwn(data,'checkedAt')?data.checkedAt:data.updatedAt),...(data.selection?{selection:validateNavigationModel(data.selection)}:{})});
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
 const describeJob=j=>({id:j.id,action:j.action,clientRequestId:j.clientRequestId,goal:j.goal,status:j.status,message:j.message,deadline:j.deadline});
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
  try{
   const answer=await Promise.race([runAgent({project,prompt:j.prompt,signal:j.controller.signal,selection:j.selection}),new Promise((_,reject)=>{timer=setTimeout(()=>{reject(Error('5分以内にNavi結果を確認できませんでした。'));j.controller.abort();},waitMs);timer.unref?.();}),new Promise((_,reject)=>{abort=()=>reject(Error('処理を中止しました。'));j.controller.signal.addEventListener('abort',abort,{once:true});})]);
   if(!current(j)||j.status!=='running')return;
   const content=typeof answer==='string'?answer:answer?.content;
   const validated=validateNavigationResponse(parseNavigationResponse(content),j),checkedAt=now();
   // AIが各ファイルを見た瞬間ではなく、全項目の有効な評価結果をアプリが受け取った日時。
   const result={...validated,createdAt:j.createdAt??checkedAt,updatedAt:checkedAt,checkedAt,navigationId:j.navigationId||j.id,selection:j.selection};
   if(!current(j)||j.status!=='running')return;
   temporary=join(dir,randomUUID()+'.tmp');await writeFile(temporary,JSON.stringify(result,null,2),{encoding:'utf8',flag:'wx'});
   if(!current(j)||j.status!=='running')return;
   // この代入から保存完了までは中止不可。非同期renameの直前を確定境界にする。
   j.committing=true;clearTimeout(timer);
   await replaceState(temporary,join(dir,'latest.json'));
   await atomicJSON(join(await historyDirectory(),result.navigationId+'.json'),result);
   j.status='complete';j.message='Naviを更新しました。';
  }catch(e){if((current(j)||j.committing)&&j.status==='running'){j.status='failed';j.message=e.code==='ENOENT'?'AIの結果JSONを確認できませんでした。':e.message;}}
  finally{clearTimeout(timer);j.controller.signal.removeEventListener('abort',abort);if(temporary)await rm(temporary,{force:true});}
 }
 async function start(goal,action='navigate',clientRequestId){
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
   const ready=await availability(await readModel());if(interrupted())return {job:describeJob(j)};if(!ready.available)throw Error(ready.reason||'実行環境が利用できません。');
   const selection=await readModel();if(interrupted())return {job:describeJob(j)};
   const id=j.id;
   Object.assign(j,{navigationId:previous?.navigationId,createdAt:previous?.createdAt,selection,items:previous?.items,goal:previous?previous.goal:goal.trim(),inferred:previous?previous.inferred:goal.trim()===DEFAULT_NAVIGATION_GOAL});
   const recentScan=await scan(project,{filter:'backup',limits:{timeMs:3000,maxFiles:10000}});
   if(interrupted())return {job:describeJob(j)};
   if(closed||!state().active||state().startedAt!==session)throw Error('IDEの利用状態が変わりました。');
   const recent=latestFiles(recentScan.tree,0).sort((a,b)=>b.mtime-a.mtime).slice(0,30).map(({path,mtime})=>({path,updatedAt:new Date(mtime).toISOString()}));
   j.prompt=`プロジェクトを読み取り調査し、開発目標の案内を作成してください。秘密や私的情報を結果に含めないでください。\n開発目標（調査対象）: ${j.inferred&&!previous?'既定の調査指示。最近の変更と関連内容から意図を推測し、仮の開発目標をgoalに設定してください。推測の根拠と不確実さを各reasonにも明記してください。':JSON.stringify(j.goal)}\n観測日時: ${new Date(now()).toISOString()}。最近の更新（相対パスと日時、${recentScan.truncated?'走査上限による一部のみ':'除外規則適用済み'}）: ${JSON.stringify(recent)}。日時だけで達成を断定せず、関連ファイルの内容を読んで判断してください。手掛かりが不足なら不足を明記し、完了を推測しないでください。\n${previous?'保存済み全項目の達成度だけを再評価し、':'やることを最大50項目に分け、'}現状の根拠から達成度progressを整数0〜100で推定してください。未実施・未評価・根拠不足で判定できない項目は0%にしてください。nullは使わず、すべて数値で評価してください。0%は未確認部分がないという意味ではありません。${previous?'各明細はprogressの数値だけを置き換え、id・name・reason・weight・weightReasonは保存済みの値を一字も変えず維持してください。最新の根拠と未確認部分はoverall.reasonとnextPromptに記載してください。工数比率を再配分しないでください。':'reasonに未実施・未評価の区別、根拠と未確認部分を書いてください。各項目のweightは目標達成までの全体の見積工数に占める相対比率（整数1〜100%、非空なら合計100%）です。残工数だけの比率や重要度と混同せず、規模・難しさ・検証範囲からAIが推定し、weightReasonに具体的な配分理由と不確実さを書いてください。実時間は根拠なしに断定しないでください。'}総合overall.progressもAIが算出します。未実施・未評価を0%として全項目を含め、sum(weight*progress)/100を四捨五入した整数にしてください。項目なしなら0です。nullは使いません。overall.reasonに全体の工数配分・総合値の理由・残る大きな作業と不確実さを簡潔に書いてください。schemaVersionは必ず3です。旧形式は受け付けません。おすすめプロンプトは、itemsを上から順に見て最初にprogressが100未満となる項目1つだけを対象にし、そのidをnextItemIdに設定してください。未評価は0%として対象選択に含めます。nextPromptは、別のAIにそのまま渡せる自然で実用的な依頼文をあなた自身が作成してください。本文の上から「今回の目標」「対処しようとしている内容」「今回の作業」の流れで、目標の意図、対象項目で残っている課題と確認済みの根拠、今回その1項目を進める具体的な作業と確認方法を含めてください。目標や項目名を機械的に転記するだけにせず、調査で得た文脈を踏まえて文章にしてください。未確認のことは断定せず明記してください。画面・コピー側では説明を追加しないので、依頼文だけで目標と対象が分かるようにしてください。全体目標は背景の説明にとどめ、作業の依頼には後続項目・複数項目・一般的な追加作業を含めないでください。全項目が100%または項目がない場合、nextItemIdはnull、nextPromptは空文字にし、新たな仕事を作らないでください。自動実行はしません。`;
   // 保存済みJSONは今回のrequestIdを持つ出力形式として1回だけ渡し、複数結果の出力を誘発しない。
   j.prompt+=`\n${previous?'評価モードです。以下の保存済み目標・全項目をそのまま使い、目標・項目ID・項目名・順序・項目数・根拠reason・工数比率weight・配分理由weightReasonを変えないでください。明細はprogressの数値だけを最新状態から評価し更新してください。総合overall.progressは保存済みの工数比率と更新した達成度の加重平均から算出し、overall.reasonには最新の根拠・未確認部分を書いてください。更新した達成度から最初の100%未満の項目を選び直し、nextItemIdをその1項目だけに合わせ、nextPromptも最新の根拠から「今回の目標」「対処しようとしている内容」「今回の作業」を含む依頼文として書き直してください。保存済みの提案を機械的に再利用しないでください。全項目100%ならnextItemIdはnull、nextPromptは空文字です。schemaVersion:3の形式は維持してください。':'以下は形式を示す出力例です。例の項目名・割合を固定で転記せず、実目標に応じた適切な粒度の複数項目を生成してください。'}`;
   j.prompt+=`\nおすすめプロンプトの決め方（新規・再評価共通）:
1. まず今回返すitemsの全progressを確定してください。その配列を先頭から見て、最初にprogressが100未満となる項目で止めます。最小の達成率・重要度・weight・IDの大小では選びません。未評価の0%も通常の未完了項目です。再評価では保存済みの順序を変えません。
2. 見つかった項目のid文字列を一字も変えずnextItemIdに入れてください。配列の位置・項目名・新しいID・複数IDの配列ではありません。例えばidが文字列の"2"ならnextItemIdも"2"であり、数値の2ではありません。nextPromptはその1項目だけの残作業を依頼する、空白だけではない1〜8000文字の文字列にしてください。
3. 見つからなければnextItemIdはJSONのnull（文字列の"null"ではない）、nextPromptは厳密に空文字""です。「完了しました」・空白・改行・追加改善案を書かず、どちらのキーも省略しないでください。overall.progressでは対象の有無を決めません。総合が四捨五入で100でも、99%の項目があればその項目を選びます。
対象選択の具体例（idとprogressだけを抜粋した説明用の例です。最終回答には例を並べず、実際の全項目・全必須キーを含むJSONを1つ返してください。例のIDや依頼文を実データへ転記しないでください）:
- 例1: itemsが [step-1:100%, step-2:70%, step-3:0%] の順ならnextItemIdは"step-2"。0%のstep-3は選ばず、nextPromptではstep-2の残作業だけを依頼します。
- 例2: itemsが [z-last:0%（未評価）, a-first:30%] の順ならnextItemIdは"z-last"。ID順に並べ替えず、先頭の未評価項目を対象にします。
- 例3: itemsが [done:100%, remaining:99%] ならnextItemIdは"remaining"。overall.progressが100に丸められてもnextPromptを空にしません。
- 例4: itemsが [step-1:100%, step-2:100%] ならnextItemIdはnull、nextPromptは""です。
- 例5: itemsが [] ならnextItemIdはnull、nextPromptは""、overall.progressは0です。
- 例6（再評価）: 前回 [step-1:60%, step-2:0%] でnextItemIdが"step-1"でも、今回 [step-1:100%, step-2:20%] になったらnextItemIdを"step-2"へ変更し、nextPromptもstep-2の残作業だけに書き直します。今回両方100%になったらnullと""へ変更します。保存済みのnextItemId・nextPromptは前回値であり、固定してはいけません。
出力前の照合: 今回返すitemsを先頭から再確認し、最初の100%未満のidとnextItemIdが完全一致し、nextPromptがその項目だけの非空文字列か確認してください。対象なしならnextItemIdがnull、nextPromptが""か確認してください。`;
   j.prompt+=`\n回答形式（厳守）: 調査を終えてから、最終回答は「{」で始まり「}」で終わる完成したJSONオブジェクト1つだけを出力してください。アプリは回答全体をJSONとして解析し、解析できない場合は最初の「{」から最後の「}」まで（括弧を含む）を抽出して読み取ります。複数のJSONから1件を選ぶことはできません。前置き・調査経過・JSON外の説明・Markdown・コードフェンスは出力しないでください。入力例や保存済みJSONを別掲したり、途中版・修正版・複数案を並べたりしないでください。差分だけやJSONを包む配列・文字列ではなく、必須キーと全項目を含む最終結果1つを返してください。\n文字列内の改行・二重引用符・バックスラッシュはJSONの規則でエスケープし、コメント・末尾カンマ・省略記号を使わないでください。新しく書く説明は簡潔にし、全項目と閉じ括弧を省略せず最後まで出力してください。再評価で固定する保存済みの値は短縮しないでください。出力前にJSON構文と必須キーを確認し、requestIdは下の出力形式の値をそのまま使ってください。結果の保存はアプリ側で行います。ファイルの作成・変更はしないでください。\n${previous?'出力形式: ':''}${JSON.stringify(previous?{schemaVersion:3,requestId:id,goal:previous.goal,items:previous.items,overall:previous.overall,nextItemId:previous.nextItemId,nextPrompt:previous.nextPrompt}:{schemaVersion:3,requestId:id,goal:j.inferred?'仮の開発目標':j.goal,items:[{id:'step-1',name:'バックエンド調整',progress:100,reason:'必要なAPIと関連試験を確認済みの場合の例',weight:50,weightReason:'複数APIとデータ整合性の検証が全体工数の半分を占める見積例'},{id:'step-2',name:'フロントエンド',progress:70,reason:'基本画面は確認済みで残る表示確認がある場合の例',weight:30,weightReason:'画面実装と状態遷移の検証範囲から3割と見積もる例'},{id:'step-3',name:'セルフテスト',progress:0,reason:'計画された試験が未実施と確認できた場合の例',weight:20,weightReason:'結合試験と回帰確認に2割を見積もる例'}],overall:{progress:71,reason:'工数配分50:30:20の加重平均は71%。残作業は画面確認と結合試験が中心。工数比率はAIの推定です。'},nextItemId:'step-2',nextPrompt:'今回の目標は、利用者が画面を迷わず使える状態に仕上げることです。\n対処しようとしている内容は、基本画面の実装後に残っている表示確認です。現在の調査では表示の検証結果を確認できていません。\n今回の作業では、フロントエンドの対象画面とその検証手順を確認し、表示崩れの有無を調べ、必要な修正と表示の再確認を行ってください。確認できた内容と未確認部分を報告してください。今回はこの項目だけを対象にしてください。'})}`;
   j.deadline=now()+waitMs;j.done=execute(j,dir);return {job:describe()};
  }catch(error){if(interrupted())return {job:describeJob(j)};if(current(j)){j.status='failed';j.message=error.message;}throw error;}finally{if(starting===j)starting=null;}
 }
 return {get,start,cancel,saveModel,list,select,fresh,close(){closed=true;job?.controller.abort();},async handle(req,res,url){
  if(url.pathname!=='/api/navigation')return false;
  const reply=(status,data)=>res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}).end(JSON.stringify(data));
  try{
   if(req.method==='GET')reply(200,url.searchParams.get('providers')==='1'?await providerList():url.searchParams.has('catalog')?await navigationCatalog(url.searchParams.get('catalog')):url.searchParams.get('list')==='1'?{items:await list()}:await get());
   else if(req.method==='POST'||req.method==='PUT'){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>20000)throw Error('入力が大きすぎます。');chunks.push(Buffer.from(chunk));}const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(req.method==='PUT')reply(200,{selection:await saveModel(data)});else if(data.action==='cancel')reply(200,await cancel(data));else if(data.action==='select')reply(200,await select(data.id));else if(data.action==='new')reply(200,await fresh());else reply(202,await start(data.goal,data.action,data.clientRequestId));}
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

