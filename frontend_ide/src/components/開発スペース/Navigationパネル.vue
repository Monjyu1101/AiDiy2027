<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
import {h,ref,computed,inject,nextTick,onBeforeUnmount,watch,onMounted} from 'vue';
import CodePanel from '../コード/コードパネル.vue';
import {runNavigationAutopilot,navigationWait} from './Navigation自動運転.js';
import {DEFAULT_NAVIGATION_GOAL} from './Navigation既定値.js';
import StatusBar from '../共通表示/状態バー.vue';
import TerminalWelcome from '../ターミナル/開始表示.vue';
import ModalDialog from '../../dialog/共通ダイアログ.vue';
import DraftHandoffDialog from '../../dialog/下書き連携ダイアログ.vue';
import {createPanelWindow} from '../ファイル閲覧/パネル別窓.js';
import {localDateTimeInput} from '../ファイル閲覧/ファイル日時.js';
const props=defineProps({standalone:Boolean,startedAt:Number,allDisplays:Boolean,project:Object,instance:{type:String,required:true}});
const emit=defineEmits(['closed']);
const normalTitle=computed(()=>props.standalone?'AiDiy Navigator':'AiDiy IDE / Navigator '+props.instance.slice(5));
const title=computed(()=>autopilot.value?normalTitle.value.replace('Navigator','Navigation Cruise'):normalTitle.value);
const native=!!window.aidiyWindow;
// Code同様、ビルド後に配布される画像を実行時URLで参照する。静的srcはViteのimport対象になる。
const sendIcon=computed(()=>new URL('sending.png',new URL('/development/AiDiy.png',location.href)).href);
const visible=ref(false),detached=ref(false),panel=ref(),goal=ref(DEFAULT_NAVIGATION_GOAL),result=ref(null),job=ref(null),error=ref(''),submitting=ref(false),copied=ref(false),copyError=ref(''),copying=ref(false);
const openingWindow=ref(!props.standalone);
const selection=ref({provider:'aidiy_hermes',model:'same'}),modelOpen=ref(false),chosenProvider=ref('aidiy_hermes'),chosenModel=ref('same'),savingModel=ref(false),modelChoice=ref('same');
const modelItems=ref([]),catalogBusy=ref(false),catalogNotice=ref(''),providerItems=ref([]),providerBusy=ref(false),providerNotice=ref('');let catalogVersion=0,providerVersion=0;
const toolsState=ref({connected:false,mode:'online'});
const availability=ref({available:false,reason:'実行環境を確認しています…'});
const history=ref(false),historyItems=ref([]);
const failureDialog=ref(null);let notifiedFailureId=null;
const scored=value=>Number.isInteger(value)&&value>=0&&value<=100;
const progressStyle=value=>scored(value)?{'--progress-width':value+'%','--progress-fill':`hsl(${value*1.2} 65% 28%)`,'--progress-accent':`hsl(${value*1.2} 65% 72%)`}: {'--progress-width':'0%','--progress-fill':'#263445','--progress-accent':'#b3c5d8'};
// APIの旧版・不正応答を数値のない成功表示へ流さない。保存済み結果を画面で補完しない。
function verifiedResult(value){
 if(value===null)return null;
 if(value?.schemaVersion!==3||!scored(value.overall?.progress)||!Array.isArray(value.items)||value.items.some(item=>!scored(item?.progress)))throw Error('Navigator結果の形式または数値評価を確認できません。最新版へ更新し、「＋ 新規」からナビを再作成してください。');
 const next=value.items.find(item=>item.progress<100);
 if(value.nextItemId!==(next?.id??null)||(next?typeof value.nextPrompt!=='string'||!value.nextPrompt.trim():value.nextPrompt!==''))throw Error('おすすめプロンプトの対象が一致しません。「＋ 新規」からナビを再作成してください。');
 return value;
}
// 総合値・理由はAIの検証済み回答をそのまま表示する。旧形式を補完しない。
const overall=computed(()=>result.value?.overall);
const checkedAt=computed(()=>{const at=result.value?.checkedAt,text=localDateTimeInput(at).replace('T',' ');return text?{text,iso:new Date(at).toISOString()}:null;});
const nextItem=computed(()=>result.value?.items.find(item=>item.progress<100));
const recommendedPrompt=computed(()=>result.value&&nextItem.value?result.value.nextPrompt:'');
const draftActions=inject('fileDraftActions',null),draftRequest=ref(null);
const canHandoff=computed(()=>!!draftActions&&!!props.project?.path&&(!props.standalone||native));
function handoff(){
 if(!canHandoff.value||!recommendedPrompt.value||draftRequest.value)return;
 draftRequest.value={projectPath:props.project.path,path:'Navigator / おすすめプロンプト(案)',text:recommendedPrompt.value};
}
watch(()=>[props.project?.path,props.startedAt,recommendedPrompt.value],()=>{draftRequest.value=null;});

const matchesResult=computed(()=>!!result.value&&goal.value.trim()===result.value.goal);
const canEvaluate=computed(()=>!busy.value&&availability.value.available&&matchesResult.value);
let draftInitialized=false,draftEdited=false,pendingGoal=null;
function editGoal(){draftEdited=true;stopAutopilot('目標が編集されたため停止しました。');}
// 応答を失った開始要求はGETで状態を確認するまで再送しない。
const reconciling=ref(false);
const busy=computed(()=>savingModel.value||submitting.value||reconciling.value||job.value?.status==='running');
const routing=computed(()=>submitting.value||reconciling.value||job.value?.status==='running');
let windowPanel,timer,disposed=false,version=0,request;

async function api(method='GET',body,signal){
 const response=await fetch('/api/navigation?instance='+encodeURIComponent(props.instance),{method,cache:'no-store',headers:body?{'content-type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,signal:AbortSignal.any([...(request?[request.signal]:[]),...(signal?[signal]:[]),AbortSignal.timeout(15000)])});
 const data=await response.json();if(!response.ok)throw Error(data.error||'Navigatorを取得できません。');return data;
}
async function refresh(){
 const generation=version;
 try{if(props.standalone){try{const r=await fetch('/api/connection',{signal:AbortSignal.timeout(3000)});if(r.ok)toolsState.value=await r.json();else toolsState.value.connected=false;}catch{toolsState.value.connected=false;}}const data=await api();if(disposed||generation!==version)return;if(data.job?.status==='failed'&&data.job.id!==notifiedFailureId&&(pendingGoal?.id===data.job.id||(job.value?.id===data.job.id&&job.value.status==='running'))){notifiedFailureId=data.job.id;failureDialog.value=data.job.message||'';}job.value=data.job;reconciling.value=false;result.value=verifiedResult(data.result);availability.value=data.availability||{available:true,reason:""};selection.value=data.selection||selection.value;if(!draftInitialized){draftInitialized=true;if(!draftEdited&&data.result)goal.value=data.result.goal;}if(pendingGoal&&data.job?.id===pendingGoal.id&&data.job.status!=='running'){if(data.job.status==='complete'&&goal.value===pendingGoal.text&&!draftEdited)goal.value=data.result.goal;pendingGoal=null;}}
 catch(e){if(!disposed&&generation===version&&e.name!=='AbortError')error.value=e.message;}
 finally{if(!disposed&&generation===version&&visible.value){clearTimeout(timer);timer=setTimeout(refresh,job.value?.status==='running'?2000:5000);}}
}
async function open(){
 visible.value=true;request=new AbortController();void refresh();await nextTick();
 if(!props.standalone){try{await pin();}finally{openingWindow.value=false;}}
}
onMounted(open);
async function pin(){
 await nextTick();
 windowPanel??=createPanelWindow({element:()=>panel.value,title:'Navigator '+props.instance.slice(5),kind:'panel-navigation',className:'navigation-window',displayTitle:()=>title.value,titleTools:()=>h('button',{type:'button',class:'navigation-code-toggle',role:'switch','aria-label':'Codeパネルを表示','aria-checked':codeOpen.value,onClick:toggleCode},'Code '+(codeOpen.value?'オン':'オフ')),changed:value=>detached.value=value,closed:()=>{stopAutopilot('Navigatorを閉じたため停止しました。');void releaseCode();visible.value=false;clearTimeout(timer);emit('closed');},report:message=>error.value=message});
 return windowPanel.pin();
}
function close(){stopAutopilot('Navigatorを閉じたため停止しました。');void releaseCode();draftRequest.value=null;if(detached.value)windowPanel.dismiss();else{visible.value=false;emit('closed');}clearTimeout(timer);}
async function navigate(action='navigate'){
 if(autopilot.value)return;
 if(busy.value||!availability.value.available||(action==='evaluate'&&!canEvaluate.value))return;
 if(!goal.value.trim()){error.value='開発目標を入力してください。';return;}
 const submittedGoal=goal.value;draftEdited=false;submitting.value=true;error.value='';copied.value=false;const generation=++version;clearTimeout(timer);
 try{const data=await api('POST',{goal:submittedGoal,action});if(generation===version){job.value=data.job;pendingGoal={id:data.job.id,text:submittedGoal};}}
 catch(e){if(generation===version){error.value=e.message;reconciling.value=true;}}
 finally{if(generation===version){submitting.value=false;void refresh();}}
}
async function toggleHistory(){if(busy.value||autopilot.value)return;history.value=!history.value;if(history.value)try{const r=await fetch('/api/navigation?instance='+encodeURIComponent(props.instance)+'&list=1',{cache:'no-store'});const data=await r.json();if(!r.ok)throw Error(data.error);historyItems.value=data.items;}catch(e){error.value=e.message;}}
async function selectHistory(id){if(busy.value||autopilot.value)return;submitting.value=true;try{const data=await api('POST',{action:id?'select':'new',id});result.value=verifiedResult(data.result);job.value=data.job;availability.value=data.availability||availability.value;goal.value=data.result?.goal||DEFAULT_NAVIGATION_GOAL;draftInitialized=true;draftEdited=false;pendingGoal=null;selection.value=data.selection||selection.value;history.value=false;error.value='';}catch(e){error.value=e.message;}finally{submitting.value=false;}}
async function loadModels(){const version=++catalogVersion;catalogBusy.value=true;try{const r=await fetch('/api/navigation?instance='+encodeURIComponent(props.instance)+'&catalog='+encodeURIComponent(chosenProvider.value));const data=await r.json();if(!r.ok)throw Error(data.error);if(version===catalogVersion){modelItems.value=data.items;catalogNotice.value=data.notice||'';if(modelChoice.value==='__custom__'&&data.items.some(item=>item.id===chosenModel.value))modelChoice.value=chosenModel.value;}}catch(e){if(version===catalogVersion)error.value=e.message;}finally{if(version===catalogVersion)catalogBusy.value=false;}}
function changeProvider(){chosenModel.value='auto';modelChoice.value='auto';modelItems.value=[];void loadModels();}
async function chooseModel(){
 if(autopilot.value)return;
 modelOpen.value=true;providerBusy.value=true;providerNotice.value='';providerItems.value=[];modelItems.value=[];const run=++providerVersion;
 try{const r=await fetch('/api/navigation?instance='+encodeURIComponent(props.instance)+'&providers=1');const data=await r.json();if(!r.ok)throw Error(data.error);if(run!==providerVersion||!modelOpen.value)return;providerItems.value=data.providers||[];providerNotice.value=data.notice||'';const selected=providerItems.value.includes(selection.value.provider)?selection.value.provider:providerItems.value[0];if(selected){chosenProvider.value=selected;chosenModel.value=selected===selection.value.provider?selection.value.model:'auto';modelChoice.value=['same','auto'].includes(chosenModel.value)?chosenModel.value:'__custom__';void loadModels();}}
 catch(e){if(run===providerVersion)providerNotice.value=e.message;}
 finally{if(run===providerVersion)providerBusy.value=false;}
}
async function saveModel(){if(busy.value)return;savingModel.value=true;error.value='';try{const data=await api('PUT',{provider:chosenProvider.value,model:modelChoice.value==='__custom__'?chosenModel.value:modelChoice.value});selection.value=data.selection;modelOpen.value=false;}catch(e){error.value=e.message;}finally{savingModel.value=false;}}
// 別窓でも、現在表示しているdocumentの選択・クリップボードを使う。
function legacyCopy(doc,text){
 const active=doc.activeElement,selection=doc.getSelection?.(),ranges=[];
 for(let i=0;i<(selection?.rangeCount||0);i++)ranges.push(selection.getRangeAt(i).cloneRange());
 const input=doc.createElement('textarea');input.value=text;input.readOnly=true;
 input.style.cssText='position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
 try{doc.body.appendChild(input);input.focus({preventScroll:true});input.select();input.setSelectionRange(0,text.length);return doc.execCommand?.('copy')===true;}
 finally{input.remove();active?.focus?.({preventScroll:true});if(selection){selection.removeAllRanges();for(const range of ranges)selection.addRange(range);}}
}
async function copy(){
 if(copying.value||!recommendedPrompt.value)return;
 const text=recommendedPrompt.value,record=result.value,doc=panel.value?.ownerDocument;
 copied.value=false;copyError.value='';copying.value=true;
 try{
  let success=false;
  try{const clipboard=doc?.defaultView?.navigator?.clipboard;if(clipboard?.writeText){await clipboard.writeText(text);success=true;}}catch{/* API未提供・許可拒否時は表示先documentで従来方式を試す。 */}
  if(!success)success=!!doc&&legacyCopy(doc,text);
  if(!success)throw Error('copy failed');
  if(result.value===record&&recommendedPrompt.value===text)copied.value=true;
 }catch{if(result.value===record&&recommendedPrompt.value===text)copyError.value='コピーできませんでした。下の本文を選択し、Ctrl+C（Macは⌘C）または右クリックの「コピー」を使ってください。';}
 finally{copying.value=false;}
}
watch(recommendedPrompt,()=>{copied.value=false;copyError.value='';});

// 自動航行の許可はメモリ内だけに保持し、履歴・再表示から復元しない。
const codeOpen=ref(false),codeBase=ref(''),codePanel=ref(),codeOpening=ref(false),autopilot=ref(false),autopilotStatus=ref(''),autopilotPhase=ref('');
let codeSession,codePromise,autopilotController,visibilityTimer,codeGeneration=0;
let codeQueue=Promise.resolve(),codeReleaseUncertain=false;
let codeResizeQueue=Promise.resolve();
function resizeCode(expanded){
 const operation=codeResizeQueue.catch(()=>{}).then(()=>performCodeResize(expanded));
 codeResizeQueue=operation;return operation;
}
async function performCodeResize(expanded){
 const owner=panel.value?.ownerDocument?.defaultView;
 if(window.aidiyWindow?.navigationCode&&(props.standalone||detached.value)){const response=await window.aidiyWindow.navigationCode(expanded,detached.value?owner?.name:undefined);if(!response?.ok)throw Error(response?.error||'Navigatorの幅を変更できません。');}
 else if(detached.value&&owner&&owner!==window){if(expanded){owner.__navigationWidth??=owner.outerWidth;owner.resizeTo?.(Math.min(owner.screen.availWidth,owner.outerWidth+480),owner.outerHeight);}else if(owner.__navigationWidth){owner.resizeTo?.(owner.__navigationWidth,owner.outerHeight);delete owner.__navigationWidth;}}
}
function syncCruiseTitle(){
 const doc=panel.value?.ownerDocument||(props.standalone?window.document:null);
 if(doc&&(props.standalone||detached.value))doc.title=title.value;
 if(window.aidiyWindow?.navigationCruise&&(props.standalone||detached.value)){
  const active=autopilot.value;
  void window.aidiyWindow.navigationCruise(active,detached.value?doc?.defaultView?.name:undefined).then(response=>{if(active&&autopilot.value&&!response?.ok)stopAutopilot(response?.error||'自動航行のタイトルを更新できません。');}).catch(()=>{if(active&&autopilot.value)stopAutopilot('自動航行のタイトルを更新できません。');});
 }
}
watch(()=>[autopilot.value,detached.value],syncCruiseTitle,{immediate:true});
const codeDriving=computed(()=>autopilot.value&&overall.value?.progress<100);
const canAutopilot=computed(()=>!busy.value&&!history.value&&matchesResult.value&&availability.value.available&&overall.value?.progress<100&&!!recommendedPrompt.value);
const codeEndpoint=session=>'/api/navigation/code?instance='+encodeURIComponent(props.instance)+'&session='+encodeURIComponent(session);
async function ensureCode(){
 if(codeReleaseUncertain)throw Error('Codeを閉じた結果を確認できません。Navigatorを開き直してください。');
 if(codeBase.value){await resizeCode(codeOpen.value);return;}
 if(codeOpening.value&&codePromise){const pending=codePromise;await resizeCode(codeOpen.value);return pending;}
 const generation=++codeGeneration;codeOpening.value=true;
 const current=()=>!disposed&&generation===codeGeneration&&visible.value;
 const operation=codeQueue.catch(()=>{}).then(async()=>{
  if(!current())return;
  if(codeReleaseUncertain)throw Error('Codeを閉じた結果を確認できません。Navigatorを開き直してください。');
  try{
   await resizeCode(codeOpen.value);if(!current())return;
   const response=await fetch('/api/connection',{cache:'no-store',signal:AbortSignal.timeout(10000)});
   const connection=await response.json();if(!response.ok||!connection.active||!connection.startedAt)throw Error('Codeを開く利用セッションを確認できません。');
   if(!current())return;
   codeSession=connection.startedAt;
   const opened=await fetch(codeEndpoint(codeSession),{method:'POST',signal:AbortSignal.timeout(15000)});
   const data=await opened.json();if(!opened.ok)throw Error(data.error||'Codeを開けません。');
   if(!current())return; // 後続の直列化したcloseが、この要求だけを回収する。
   if(typeof data.url!=='string'||!data.url.startsWith('/panels/code/'))throw Error('Codeの接続先を確認できません。');
   codeBase.value=data.url;await nextTick();
  }catch(e){
   const session=codeSession;codeSession=undefined;
   if(session)try{const response=await fetch(codeEndpoint(session),{method:'DELETE',keepalive:true,signal:AbortSignal.timeout(15000)});if(!response.ok)codeReleaseUncertain=true;}catch{codeReleaseUncertain=true;}
   if(current()){codeOpen.value=false;codeBase.value='';await resizeCode(false).catch(()=>{});}
   throw e;
  }
 });
 codeQueue=operation;codePromise=operation;
 try{await operation;}finally{if(generation===codeGeneration){codePromise=null;codeOpening.value=false;}}
}
async function releaseCode(){
 ++codeGeneration;codeBase.value='';codeOpening.value=false;
 const operation=codeQueue.catch(()=>{}).then(async()=>{
  const session=codeSession;codeSession=undefined;
  await resizeCode(false).catch(()=>{});
  if(session){const response=await fetch(codeEndpoint(session),{method:'DELETE',keepalive:true,signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('Codeの終了を確認できません。');}
 });
 // 終了の結果不明時は次の作成を許可しない。新規openにも同じエラーを渡す。
 codeQueue=operation;try{await operation;}catch{codeReleaseUncertain=true;autopilotStatus.value='Codeを閉じた結果を確認できません。Navigatorを開き直してください。';}
}
function toggleCode(){
 // 表示だけを切り替える。実行・会話・下書きはNavigatorを閉じるまで保持する。
 codeOpen.value=!codeOpen.value;
 if(codeOpen.value)void ensureCode().catch(e=>{autopilotStatus.value=e.message;});
 else void resizeCode(false).catch(e=>{autopilotStatus.value=e.message;});
}
function stopAutopilot(reason='自動航行をオフにしました。実行中のCodeには停止を要求しました。'){
 if(!autopilot.value)return;
 autopilot.value=false;autopilotStatus.value=reason;autopilotController?.abort();
}
function shown(){
 const element=panel.value,doc=element?.ownerDocument;
 return visible.value&&!!element&&doc?.visibilityState!=='hidden'&&element.style?.visibility!=='hidden';
}
async function evaluateForAutopilot(signal){
 if(!matchesResult.value||!availability.value.available||busy.value)throw Error('現在のナビを再評価できないため停止しました。');
 const generation=++version;clearTimeout(timer);submitting.value=true;error.value='';
 try{
  const started=await api('POST',{goal:result.value.goal,action:'evaluate'},signal);
  if(signal.aborted||generation!==version)throw Error('自動航行を停止しました。');
  if(!started.job?.id)throw Error('再評価の受付を確認できません。');
  job.value=started.job;
  const deadline=Date.now()+330000;
  while(true){
   await navigationWait(1500,signal);
   if(generation!==version)throw Error('対象が変わったため停止しました。');
   const data=await api('GET',undefined,signal);
   if(signal.aborted||generation!==version)throw Error('自動航行を停止しました。');
   if(data.job?.id!==started.job.id)throw Error('再評価の依頼が変わったため停止しました。');
   job.value=data.job;
   if(data.job.status==='failed')throw Error(data.job.message||'再評価に失敗しました。');
   if(data.job.status==='complete'){
    const updated=verifiedResult(data.result);
    if(updated?.requestId!==started.job.id)throw Error('今回の再評価結果を確認できません。');
    result.value=updated;return updated;
   }
   if(data.job.status!=='running'||Date.now()>deadline)throw Error('再評価の完了を確認できないため停止しました。');
  }
 }catch(e){reconciling.value=true;throw e;}
 finally{submitting.value=false;if(!disposed&&visible.value)void refresh();}
}
async function toggleAutopilot(){
 if(autopilot.value){stopAutopilot();return;}
 if(!canAutopilot.value||autopilotController)return;
 const controller=new AbortController();autopilotController=controller;autopilot.value=true;codeOpen.value=true;
 const projectPath=props.project?.path,startedAt=props.startedAt,initial=result.value;
 const current=()=>autopilot.value&&!disposed&&shown()&&props.project?.path===projectPath&&props.startedAt===startedAt&&matchesResult.value&&result.value?.navigationId===initial.navigationId&&goal.value.trim()===initial.goal;
 const doc=panel.value?.ownerDocument,owner=doc?.defaultView;
 const hidden=()=>{if(!shown())stopAutopilot('Navigatorが非表示になったため停止しました。再開にはオンにしてください。');};
 const leaving=()=>{stopAutopilot('Navigatorを離れたため停止しました。');syncCruiseTitle();if(codeSession)void fetch(codeEndpoint(codeSession),{method:'DELETE',keepalive:true}).catch(()=>{});};
 doc?.addEventListener?.('visibilitychange',hidden);owner?.addEventListener?.('pagehide',leaving);
 autopilotStatus.value='専用Codeパネルを準備しています…';autopilotPhase.value='opening';
 try{
  await ensureCode();
  const deadline=Date.now()+30000;
  while(true){
   const readiness=codePanel.value?.navigationReadiness?.(projectPath);
   if(readiness?.ready)break;
   if(!current()||controller.signal.aborted)throw Error('自動航行を停止しました。');
   if(readiness?.fatal||Date.now()>deadline)throw Error(readiness?.reason||'Codeが実行可能になりませんでした。接続・モデル・信頼状態を確認してください。');
   autopilotStatus.value=readiness?.reason||'専用Codeパネルの状態通知を待っています…';
   await navigationWait(200,controller.signal);
  }
  const message=await runNavigationAutopilot({initial,signal:controller.signal,isCurrent:current,
   runCode:(text,signal)=>codePanel.value.runNavigationPrompt({text,projectPath,signal}),evaluate:evaluateForAutopilot,
   report:({phase,text})=>{autopilotPhase.value=phase;autopilotStatus.value=text;}});
  if(autopilot.value)autopilotStatus.value=message;
 }catch(e){if(autopilot.value)autopilotStatus.value=e.message||'自動航行を停止しました。';}
 finally{doc?.removeEventListener?.('visibilitychange',hidden);owner?.removeEventListener?.('pagehide',leaving);autopilot.value=false;autopilotController=null;autopilotPhase.value='';}
}
watch(()=>props.project?.path,()=>{stopAutopilot('プロジェクトが変わったため停止しました。');void releaseCode();codeOpen.value=false;});
onMounted(()=>{visibilityTimer=setInterval(()=>{if(autopilot.value&&!shown())stopAutopilot('Navigatorが非表示になったため停止しました。再開にはオンにしてください。');},250);});
onBeforeUnmount(()=>{stopAutopilot('Navigatorを閉じたため停止しました。');clearInterval(visibilityTimer);void releaseCode();});

watch(()=>props.startedAt,()=>{stopAutopilot('利用セッションが変わったため停止しました。');void releaseCode();codeOpen.value=false;version++;request?.abort();close();windowPanel?.close();windowPanel=null;draftInitialized=false;draftEdited=false;pendingGoal=null;failureDialog.value=null;notifiedFailureId=null;goal.value=DEFAULT_NAVIGATION_GOAL;result.value=null;job.value=null;error.value='';submitting.value=false;modelOpen.value=false;selection.value={provider:'aidiy_hermes',model:'same'};});
onBeforeUnmount(()=>{void fetch('/api/navigation?instance='+encodeURIComponent(props.instance),{method:'DELETE'}).catch(()=>{});disposed=true;version++;request?.abort();clearTimeout(timer);windowPanel?.close();});

</script>
<template>
 <section ref="panel" v-show="visible" class="navigation-panel" :class="{detached,standalone,'has-code':codeOpen}" :style="{visibility:openingWindow?'hidden':undefined}" aria-label="Navigator">
  <DraftHandoffDialog v-if="draftRequest" :request="draftRequest" :load-targets="draftActions.loadTargets" :insert-draft="draftActions.insertDraft" :launch-target="standalone?undefined:draftActions.launchTarget" :empty-hint="standalone?'同じプロジェクトで aidiy_code または aidiy_live を起動してください。':undefined" @close="draftRequest=null" />
  <StatusBar v-if="standalone" :title="title" :desktop="native" :connected="toolsState.connected" :mode="toolsState.mode" clock-pulse><template #window-tools><button type="button" class="navigation-code-toggle" role="switch" aria-label="Codeパネルを表示" :aria-checked="codeOpen" @click="toggleCode">Code {{codeOpen?'オン':'オフ'}}</button></template><template v-if="!native" #connection-tools><button type="button" class="navigation-code-toggle" role="switch" aria-label="Codeパネルを表示" :aria-checked="codeOpen" @click="toggleCode">Code {{codeOpen?'オン':'オフ'}}</button></template></StatusBar>
  <header class="navigation-local-header" v-else-if="!detached||!native"><span class="navigation-emblem" aria-hidden="true">◇</span><strong>{{title}}</strong><span class="navigation-header-space"></span><button type="button" class="navigation-code-toggle" role="switch" aria-label="Codeパネルを表示" :aria-checked="codeOpen" @click="toggleCode">Code {{codeOpen?'オン':'オフ'}}</button><button v-if="!detached" aria-label="Navigatorを別窓にピン留め" title="別窓にピン留め" @click="pin">📌</button><button aria-label="Navigatorを閉じる" @click="close">×</button></header>
  <div class="component-toolbar navigation-project"><span :title="project?.path">プロジェクト: {{project?.name || project?.path}}</span><nav><small>評価は読取専用</small><button :disabled="busy||autopilot" @click="selectHistory()">＋ 新規</button><button :disabled="busy||autopilot" :aria-expanded="history" @click="toggleHistory">{{history?'戻る':'一覧'}}</button></nav></div>
   <form class="navigation-goal-form" @submit.prevent="navigate()">
    <label :for="instance+'-goal'">目標<small v-if="result?.inferred&&matchesResult">（AIの推測・編集できます）</small></label>
    <textarea :id="instance+'-goal'" v-model="goal" :readonly="autopilot" maxlength="4000" rows="4" @input="editGoal" placeholder="目標を入力してください"></textarea>
    <div class="navigation-form-foot"><div class="navigation-input-meta"><small class="navigation-input-hint">ナビ・再評価は読取専用です。自動航行オンではCodeがファイルを変更します。</small><p v-if="result&&!matchesResult" class="navigation-draft-note" role="status">入力が保存済みの目標と異なります。ナビを作成すると評価できます。</p><div class="navigation-model-line composer-meta"><button type="button" :disabled="busy||autopilot" :aria-expanded="modelOpen" @click="chooseModel"><span class="model-caption">モデル</span> ▾</button><span class="model-label" :title="selection.provider+' / '+selection.model">{{selection.provider}} / {{selection.model}}</span></div></div><div class="navigation-run-actions"><button type="submit" class="navigation-start navigation-run" :class="{'is-routing':routing}" :disabled="busy||autopilot||!availability.available"><img :src="sendIcon" alt="" /><span class="navigation-button-label">{{routing?'調査中…':'ナビ'}}</span></button><button type="button" class="navigation-evaluate navigation-run" :disabled="!canEvaluate||autopilot" title="保存済みの作業項目を変えずに再採点" @click="navigate('evaluate')">再評価</button></div></div>
   </form>
  <div v-if="history" class="navigation-history" role="list"><p v-if="!historyItems.length">このフォルダにナビ履歴はありません</p><button v-for="item in historyItems" :key="item.id" :disabled="busy||autopilot" @click="selectHistory(item.id)"><time>{{new Date(item.updatedAt).toLocaleString()}}</time><span>{{item.goal}}</span></button></div>
  <div v-show="!history" class="navigation-display" :class="{running:submitting||job?.status==='running'}"><div class="navigation-content">
   <p v-if="!availability.available" role="status" class="navigation-unavailable">{{availability.reason}}</p>
   <p v-if="error" role="alert" class="navigation-error">{{error}}</p>
   <p v-if="job?.status==='failed'&&!routing" role="status" aria-live="polite" class="navigation-error">{{job.message}}</p>
   <TerminalWelcome v-if="routing" kind="navi" icon="/development/AiDiy.png" :routing="true" :started="true" />
   <template v-else-if="result">
    <h2 class="navigation-task-heading">タスク<time v-if="checkedAt" class="navigation-checked-at" :datetime="checkedAt.iso" title="AI評価結果の確定日時（表示端末の時刻）"> ({{checkedAt.text}})</time><small v-else class="navigation-checked-at"> (確認日時不明)</small></h2>
    <p v-if="!result.items.length">対象の作業項目はありません。</p>
    <ol class="navigation-items" :key="result.navigationId||result.requestId"><li v-for="item in result.items" :key="item.id"><details class="navigation-disclosure">
     <summary>
     <span class="navigation-progress" :style="progressStyle(item.progress)" role="progressbar" :aria-label="item.name" :aria-valuenow="item.progress" :aria-valuetext="item.progress+'%（AIの推定）'" aria-valuemin="0" aria-valuemax="100"><span class="navigation-fill" aria-hidden="true"></span><span class="navigation-disclosure-arrow" aria-hidden="true"></span><span class="navigation-name">{{item.name}}</span><strong>{{item.progress}}<small>%</small></strong></span>
     </summary><div class="navigation-reasons"><p>{{item.reason}}</p><div class="navigation-effort"><strong>工数比率 {{item.weight}}%</strong><span>{{item.weightReason}}</span></div>
     </div></details></li></ol>
    <small class="navigation-estimate-note">達成度はAIの推定です。根拠と実際の状態を確認してください。</small>

   </template>
   <TerminalWelcome v-else-if="!busy" kind="navi" icon="/development/AiDiy.png" :started="draftEdited" />
  </div>
  </div>
    <section v-if="result&&!history" v-show="!routing||codeDriving" class="navigation-overall" :class="{driving:codeDriving}" aria-label="総合評価の詳細"><details :key="result.navigationId||result.requestId" class="navigation-disclosure">
     <summary>
     <span class="navigation-progress" :style="progressStyle(overall.progress)" role="progressbar" aria-label="総合評価" :aria-valuenow="overall.progress" :aria-valuetext="overall.progress+'%（AIの工数比率による加重評価）'" aria-valuemin="0" aria-valuemax="100"><span class="navigation-fill" aria-hidden="true"></span><span class="navigation-disclosure-arrow" aria-hidden="true"></span><span class="navigation-name">総合評価</span><strong>{{overall.progress}}<small>%</small></strong></span>
     </summary><div class="navigation-reasons"><small>AIが見積もった工数比率による総合評価。実測値ではありません。</small><p class="navigation-overall-reason">{{overall.reason}}</p></div></details><p v-if="codeDriving" class="navigation-overall-cruise-status" role="status">自動航行中</p>
    </section>
    <section v-if="result&&!history" v-show="!routing" class="navigation-next" aria-label="プロンプト(案)"><div class="navigation-prompt-actions"><h2>プロンプト(案)</h2><button v-if="nextItem" class="navigation-handoff" :disabled="!canHandoff" :title="canHandoff?'Code / Liveの入力欄へ追加します。送信はしません。':'デスクトップ版、またはIDE内のNavigatorで利用できます。'" @click="handoff">CODE/LIVEへ</button><button v-if="nextItem" :disabled="copying" @click="copy">{{copied?'コピーしました':'コピー'}}</button><button type="button" class="navigation-autopilot-toggle" role="switch" title="Navi Cruise" aria-label="自動航行（Navi Cruise）" :aria-checked="autopilot" :disabled="!autopilot&&(!canAutopilot||!!autopilotController)" @click="toggleAutopilot">自動航行 {{autopilot?'オン':'オフ'}}</button></div><p v-if="copyError" class="navigation-copy-error" role="alert">{{copyError}}</p><p class="navigation-prompt"><span v-if="nextItem">{{recommendedPrompt}}</span><span v-else>{{result.items.length?'全項目が100%です。おすすめの追加作業はありません。':'作業項目がないため、おすすめプロンプトはありません。'}}</span></p></section>

  <p v-if="autopilotStatus" class="navigation-autopilot-status" role="status" aria-live="polite">{{autopilotStatus}}<button v-if="autopilot&&!codeOpen" type="button" @click="stopAutopilot()">自動航行をオフ</button></p>
  <aside v-show="codeOpen" class="navigation-code" :class="{driving:codeDriving}" aria-label="Navigator専用Code"><header><strong>Code</strong><button v-if="autopilot" type="button" @click="stopAutopilot()">自動航行をオフ</button></header><p v-if="codeOpening">Codeを準備しています…</p><CodePanel v-if="codeBase" ref="codePanel" :key="codeBase" :base="codeBase" icon="/development/AiDiy.png" embedded hide-status-bar project-notice="Navigator制御下です。自動航行オンならここで実行し、完了後に再評価します。評価が3回改善しない場合は停止します。" /></aside>
  <ModalDialog v-if="failureDialog!==null" label="ナビの実行に失敗しました" @close="failureDialog=null">
   <h3>ナビの実行に失敗しました</h3>
   <p>別のエージェントをお試しください。</p>
   <p v-if="failureDialog" class="navigation-error">{{failureDialog}}</p>
   <button type="button" @click="failureDialog=null">閉じる</button>
  </ModalDialog>
  <ModalDialog v-if="modelOpen" label="モデル選択" :locked="savingModel" @close="modelOpen=false">
   <h3>コードAIとモデル</h3><p>Navigatorは読取専用で調査します。この窓の選択だけを保存します。</p>
   <form class="navigation-model-picker" @submit.prevent="saveModel">
    <label>コードAI<select v-model="chosenProvider" :disabled="busy||providerBusy||!providerItems.length" @change="changeProvider"><option v-for="provider in providerItems" :key="provider" :value="provider">{{provider}}</option></select></label>
    <p v-if="providerBusy">候補を読み込んでいます…</p><p v-else-if="providerNotice" role="status">{{providerNotice}}</p>
    <label>モデル<select class="navigation-model-choice" v-model="modelChoice" :disabled="busy||autopilot"><option value="same">same（前回のモデル）</option><option value="auto">auto（自動選択）</option><option v-for="item in modelItems.filter(item=>!['same','auto'].includes(item.id))" :key="item.id" :value="item.id">{{item.label}}</option><option value="__custom__">一覧にないモデル ID を入力…</option></select></label>
    <input v-if="modelChoice==='__custom__'" v-model="chosenModel" maxlength="300" autocomplete="off" spellcheck="false" aria-label="モデル名" :disabled="busy||autopilot" />
    <p v-if="catalogBusy">読み込み中…</p><p v-if="catalogNotice" role="status">{{catalogNotice}}</p><p v-if="error" role="alert" class="error">{{error}}</p>
    <div><button type="submit" :disabled="busy||providerBusy||!providerItems.includes(chosenProvider)||(modelChoice==='__custom__'&&!chosenModel.trim())">選択する</button><button type="button" :disabled="busy||autopilot" @click="modelOpen=false">閉じる</button></div>
   </form>
  </ModalDialog>
 </section>
</template>
<style>
.navigation-display{position:relative;display:flex;flex:1;min-height:0;--stream:#00ffff}.navigation-history{flex:1;overflow:auto;padding:12px}.navigation-history>button{display:flex;width:100%;gap:16px;padding:12px;text-align:left}.navigation-history time{flex:none;color:#98a6b8}.navigation-project nav{display:flex;align-items:center;gap:8px;margin-left:auto;}
.navigation-panel.standalone{position:relative;inset:auto;width:100%;height:100%;max-height:none;max-width:none;border:0;border-radius:0;}
.navigation-model-line{display:flex;align-items:center;gap:8px;font-size:11px}.navigation-model-line>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.navigation-model-picker{display:grid;gap:8px;max-height:50vh;overflow:auto}.navigation-model-picker label{display:grid;gap:4px}.navigation-model-picker select,.navigation-model-picker input{width:100%;box-sizing:border-box;font:inherit;background:#142235;color:#edf5ff;border:1px solid #47637b;padding:6px}.navigation-model-picker small{color:#b3c5d8}.navigation-model-picker>div{display:flex;gap:8px}
.navigation-panel{position:fixed;left:16px;top:var(--workspace-top,78px);bottom:auto;width:min(480px,calc(100vw - 32px));height:min(600px,calc(100vh - var(--workspace-top,78px) - 16px));box-sizing:border-box;z-index:42;display:flex;flex-direction:column;background:#0b1220;color:#e5edf8;border:1px solid #395069;border-radius:10px;box-shadow:0 12px 40px #0008;overflow:hidden;font-size:13px}
.navigation-panel .navigation-local-header{display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid #29394f}.navigation-emblem{color:#7de2cf}.navigation-header-space{flex:1}.navigation-content{padding:14px;overflow:auto;min-height:0;flex:1}.navigation-goal-form label{display:block;font-weight:600;margin-bottom:8px}.navigation-goal-form textarea{width:100%;resize:vertical;min-height:48px;max-height:120px}.navigation-form-foot{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:end;margin-top:3px}.navigation-input-meta{display:flex;flex-direction:column;gap:6px;min-width:0}.navigation-input-hint{display:block;margin:0;color:#afc2d8;font-size:10px;overflow-wrap:anywhere}.navigation-form-foot .navigation-model-line{min-width:0;flex-wrap:wrap}.navigation-run-actions{display:flex;gap:6px}.navigation-goal-form .navigation-run{box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;width:40.6px;height:40.6px;padding:2px;border:1px solid #667eea;border-radius:0;background:rgba(255,255,255,.95);color:#000;font:inherit;font-size:10px;line-height:1.25}.navigation-start{position:relative}.navigation-run img{position:absolute;inset:2px;width:35px;height:35px;object-fit:contain;filter:brightness(0)}.navigation-button-label{position:relative;z-index:1;margin-top:14px;padding:1px 2px;font-weight:700;background:rgba(255,255,255,.95);color:#000}.navigation-run:not(:disabled) .navigation-button-label{background:#667eea;color:#fff}.navigation-run:not(:disabled):hover .navigation-button-label{background:#5a6fd8}.navigation-goal-form .navigation-run:not(:disabled){background:#667eea;color:#fff}.navigation-run:not(:disabled) img{filter:brightness(0) invert(1)}.navigation-goal-form .navigation-run:not(:disabled):hover{background:#5a6fd8;border-color:#5a6fd8}.navigation-goal-form .navigation-run:disabled{opacity:1;cursor:not-allowed}.navigation-content button:focus-visible,.navigation-panel .navigation-local-header button:focus-visible{outline:2px solid #8de8e0;outline-offset:2px}.navigation-content button:disabled{opacity:.55;cursor:default}.navigation-error{color:#ffb7ad}.navigation-result-heading{margin:22px 0 14px}.navigation-content h2{font-size:16px;line-height:1.5;margin:4px 0 8px}.navigation-result-heading small{color:#b3c5d8}.navigation-items{padding:0;list-style:none;margin:0}.navigation-items li{margin-bottom:4px;border:1px solid #32465d;border-radius:0;overflow:hidden}.navigation-items .navigation-progress{border-width:0 0 0 3px;border-radius:0}.navigation-items .navigation-reasons>p{padding:0 9px;font-size:12px}.navigation-progress{position:relative;isolation:isolate;display:flex;align-items:center;gap:8px;overflow:hidden;border:1px solid #32465d;border-radius:0;background:#142235;padding:6px 10px}.navigation-fill{position:absolute;z-index:-1;inset:0 auto 0 0;width:var(--progress-width);background:var(--progress-fill)}.navigation-name{flex:1;overflow-wrap:anywhere}.navigation-progress strong{white-space:nowrap;color:var(--progress-accent)}.navigation-progress{border-left:3px solid var(--progress-accent);color:#f5f7fb;line-height:1.5}.navigation-name{min-width:0}.navigation-progress strong small{font-size:10px;margin-left:2px}.navigation-items .navigation-reasons>p{color:#b8cadc;line-height:1.6;margin:4px 3px;white-space:pre-wrap;overflow-wrap:anywhere}.navigation-next{margin-top:22px;padding:14px;border:1px solid #3e6b7b;border-radius:10px;background:linear-gradient(135deg,#122d3b,#172238)}.navigation-next>.navigation-prompt-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.navigation-prompt-actions h2{margin:0}.navigation-prompt-actions button:last-child{margin-left:auto}.navigation-copy-error{color:#ffb7ad;margin:6px 0;font-size:12px}.navigation-prompt{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.8;user-select:text}.navigation-empty{text-align:center;padding:26px 8px;color:#b5c6db;line-height:1.7}.navigation-empty>span{font-size:36px;color:#7de2cf}
.navigation-window{height:100vh;display:flex;flex-direction:column}.navigation-window .navigation-panel{position:relative;inset:auto;width:100%;height:100%;min-height:0;flex:1;box-sizing:border-box;border-radius:0}.navigation-window.native-panel-window .navigation-panel{height:calc(100vh - 34px)}
</style>

<style>
.navigation-display{position:relative;display:flex;flex:1;min-height:0;--stream:#00ffff}.navigation-history{flex:1;overflow:auto;padding:12px}.navigation-history>button{display:flex;width:100%;gap:16px;padding:12px;text-align:left}.navigation-history time{flex:none;color:#98a6b8}.navigation-project nav{display:flex;align-items:center;gap:8px;margin-left:auto;}
.navigation-panel.standalone{position:relative;inset:auto;width:100%;height:100%;max-height:none;max-width:none;border:0;border-radius:0;}
.navigation-project{flex:none;justify-content:space-between}.navigation-project>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.navigation-project small{flex:none;color:#a9b8cc}.navigation-panel .model-dialog{max-width:min(440px,calc(100vw - 40px));box-sizing:border-box}.navigation-model-picker{max-height:none}.navigation-model-line .model-label{min-width:0}
</style>

<style>
.navigation-goal-form{flex:none;padding:10px 12px 3px;border-bottom:1px solid var(--aidiy-titlebar-background);background:#0b1220}.navigation-goal-form label{margin-bottom:5px}.navigation-goal-form button:disabled{opacity:.55;cursor:default}.navigation-goal-form button:focus-visible{outline:2px solid #8de8e0;outline-offset:2px}.navigation-draft-note{font-size:11px;color:#f5cf85;margin:0;overflow-wrap:anywhere}.navigation-form-foot button{flex:none}.navigation-estimate-note{display:block;margin-top:8px;color:#b3c5d8}.navigation-content{padding:10px 12px}.navigation-content .navigation-task-heading{margin:0 0 5px;font-size:inherit;font-weight:600;line-height:inherit}
.navigation-goal-form .navigation-run.is-routing{background:#667eea;color:#fff}.navigation-run.is-routing img{display:none}.navigation-run.is-routing .navigation-button-label{margin-top:0;background:#667eea;color:#fff;font-size:9px;letter-spacing:-.5px;padding:0 1px;white-space:nowrap}
</style>

<style>
.navigation-content > .terminal-welcome{box-sizing:border-box;padding:24px 0;min-height:100%}
</style>

<style>
.navigation-panel,.navigation-goal-form,.navigation-next{background:#000}
.navigation-goal-form textarea,.navigation-model-picker input,.navigation-model-picker select{background:#000}
.navigation-window{border:1px solid var(--aidiy-titlebar-background);box-sizing:border-box}
.navigation-window .navigation-panel{border:0}
.navigation-window .panel-window-title .panel-brand{grid-template-columns:minmax(0,1fr) auto minmax(0,1fr)}
.navigation-panel .panel-brand strong,.navigation-window .panel-brand strong{font-size:14px}
</style>

<style>
.navigation-panel .model-caption{padding:0 4px;font-size:11px;font-weight:400;line-height:calc(1.65em - 2px);background:#fff;color:#000}
.navigation-panel .composer-meta button{flex:none;padding:2px 6px;border-color:var(--border,#343943);font-size:10px;line-height:1.4}
</style>

<style>
.navigation-panel>.navigation-overall{flex:none;display:flex;flex-direction:column;min-height:0;max-height:25%;box-sizing:border-box;margin:0;padding:5px 12px;border-top:1px solid var(--aidiy-titlebar-background);background:#000}.navigation-content,.navigation-overall>.navigation-disclosure{scrollbar-gutter:stable}.navigation-overall>.navigation-disclosure{min-height:0;overflow:auto}.navigation-overall .navigation-reasons>small{display:block;margin-top:4px;color:#b3c5d8;font-size:10px}
.navigation-panel>.navigation-next{flex:none;display:flex;flex-direction:column;min-height:0;max-height:30%;box-sizing:border-box;margin:0;padding:5px 12px;border:0;border-top:1px solid #3e6b7b;border-radius:0}
.navigation-panel>.navigation-next>div,.navigation-panel>.navigation-next>small{flex:none}
.navigation-panel>.navigation-next h2{font-size:13px;margin:0}
.navigation-panel .navigation-prompt-actions button{padding:2px 6px;font-size:10px;line-height:1.4}
.navigation-panel>.navigation-next .navigation-prompt{height:calc(6em + 22px);min-height:0;overflow:auto;overflow-wrap:anywhere;margin:4px 0}
.navigation-goal-form textarea,.navigation-panel>.navigation-next .navigation-prompt{box-sizing:border-box;background:#000;color:#edf5ff;border:1px solid #454545;border-radius:0;padding:10px;font:inherit;line-height:1.5}
.navigation-panel>.navigation-next>small{font-size:10px}
</style>

<style>
.navigation-fill{background:linear-gradient(to right,#606060 0%,#606060 40%,var(--progress-fill) 100%)}
.navigation-overall-reason{margin:6px 0 0;color:#c5d7e6;font-size:12px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere}
.navigation-effort{display:grid;gap:3px;margin:4px 10px 6px;font-size:11px;line-height:1.5;color:#b8cadc;white-space:pre-wrap;overflow-wrap:anywhere}.navigation-effort strong{color:#d4e8f8}
</style>


<style>
.navigation-disclosure>summary{display:block;list-style:none;cursor:pointer}.navigation-disclosure>summary::-webkit-details-marker{display:none}.navigation-disclosure>summary:focus-visible{outline:2px solid #8de8e0;outline-offset:-2px}.navigation-disclosure-arrow{flex:none;width:1em;font-size:11px}.navigation-disclosure-arrow::before{content:'▶'}.navigation-disclosure[open]>summary .navigation-disclosure-arrow::before{content:'▽'}
.navigation-overall>.navigation-disclosure>summary{position:sticky;top:0;z-index:1;background:#000}
</style>

<style>
.navigation-panel.has-code{width:min(1000px,calc(100vw - 32px));display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);grid-template-rows:auto auto auto minmax(0,1fr) auto auto auto}
.navigation-panel.has-code>*{grid-column:1;min-width:0}.has-code>.navigation-local-header,.has-code>.panel-brand{grid-column:1/-1;grid-row:1}.has-code>.connection-bar{grid-column:1/-1;grid-row:1;align-self:end}.has-code>.navigation-project{grid-row:2}.has-code>.navigation-goal-form{grid-row:3}.has-code>.navigation-display,.has-code>.navigation-history{grid-row:4}.has-code>.navigation-overall{grid-row:5;max-height:150px}.has-code>.navigation-next{grid-row:6;max-height:180px}.has-code>.navigation-autopilot-status{grid-row:7}
.navigation-panel.standalone.has-code,.navigation-window .navigation-panel.has-code{width:100%}
.navigation-code{grid-column:2!important;grid-row:2/8;width:auto;box-sizing:border-box;border-left:1px solid var(--aidiy-titlebar-background,#395069);display:flex;flex-direction:column;min-width:0;background:#000;overflow:hidden}
.navigation-code>header{display:flex;align-items:center;justify-content:space-between;padding:6px 10px;background:var(--aidiy-titlebar-background,#30343a)}
.navigation-code .code-project-notice{flex:none;margin:0;padding:5px 8px;line-height:1.5;color:#b3c5d8;font-size:10px}.navigation-code>.code-component{flex:1;min-height:0;min-width:0}
.navigation-autopilot-status{flex:none;margin:0;padding:6px 12px;color:#b9e8df;font-size:11px;overflow-wrap:anywhere}
.navigation-autopilot-toggle[aria-checked="true"]{border-color:#7de2cf;background:#144d42;color:#fff}
.navigation-prompt-actions .navigation-autopilot-toggle{margin-left:0}.navigation-project nav{flex-wrap:wrap;justify-content:flex-end}
@media(max-width:650px){.navigation-panel.has-code{grid-template-columns:minmax(220px,1fr) minmax(240px,1fr);overflow-x:auto}}
</style>

<style>
.navigation-code-toggle,.window-actions .navigation-code-toggle{flex:none;width:auto;min-width:62px;font-size:10px;padding:2px 6px;border:1px solid #8b9baa;border-radius:0;white-space:nowrap}.navigation-code-toggle[aria-checked="true"]{border-color:#7de2cf}.navigation-code-toggle:disabled{opacity:.6;cursor:not-allowed}
</style>

<style>
/* IDEの自動探索と同じ光色・周回速度。Codeと総合評価の外枠だけを描き、本文操作は覆わない。 */
.navigation-code{border:2px solid var(--aidiy-titlebar-background,#395069)}
.navigation-code.driving,.navigation-panel>.navigation-overall.driving{border-color:transparent;background:linear-gradient(#000,#000) padding-box,conic-gradient(from var(--motion-spin),#2c5a5c 0deg,#2c5a5c 200deg,#85e9e9 300deg,#e8ffff 340deg,#2c5a5c 360deg) border-box;box-shadow:0 0 10px #85e9e940;animation:motion-spin 1.6s linear infinite}
@media(prefers-reduced-motion:reduce){.navigation-code.driving,.navigation-panel>.navigation-overall.driving{animation:none;border-color:#85e9e9;background:#000;box-shadow:none}}
</style>

<style>
.navigation-panel>.navigation-overall.driving{border-width:2px;border-style:solid;border-radius:0}
.navigation-overall-cruise-status{flex:none;margin:4px 0 0;text-align:center;color:#b9eeee;font-size:11px;line-height:1.4;pointer-events:none}
.navigation-checked-at{font-size:10px;font-weight:normal;color:#b3c5d8;white-space:nowrap}
</style>
