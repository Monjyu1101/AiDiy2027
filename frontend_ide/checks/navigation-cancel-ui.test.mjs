// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {ref,computed} from 'vue';
import {createNavigationPopupSizer} from '../src/components/開発スペース/Navi窓サイズ.js';
import {createNavigationMessage} from '../src/components/開発スペース/Naviメッセージ.js';
import {runNavigationAutopilot} from '../src/components/開発スペース/Navi自動運転.js';
const full=readFileSync(new URL('../src/components/開発スペース/Naviパネル.vue',import.meta.url),'utf8');
const source=full.split('<script setup>')[1].split('</script>')[0].replace(/^import .*;\r?\n/gm,'');
const saved={schemaVersion:3,navigationId:'saved',requestId:'old',goal:'保存目標',items:[{id:'one',name:'項目',progress:20}],overall:{progress:20},nextItemId:'one',nextPrompt:'次の作業'};
const state=job=>({job,result:saved,availability:{available:true}});
const flush=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
function fixture(){
 const requests=[],timers=new Map(),unmount=[];let serial=0;
 const api=vm.runInNewContext(source+`;request=new AbortController();({navigate,cancelNavigation,refresh,toggleAutopilot,evaluating,operationLabel,canStop,activeRun,pendingCancel,stopping,reconciling,submitting,job,result,goal,error,availability,visible,panel,autopilot,autopilotStatus,codePanel,failureDialog,busy,routing})`,{
  ref,computed,createNavigationPopupSizer,createNavigationMessage,runNavigationAutopilot,navigationWait:async(_ms,signal)=>{if(signal.aborted)throw Error('stopped');},
  inject:()=>null,watch(){},onMounted(){},onBeforeUnmount:fn=>unmount.push(fn),nextTick:async()=>{},defineExpose(){},defineProps:()=>({instance:'navi-1',project:{path:'/project'},startedAt:1}),defineEmits:()=>()=>{},window:{},DEFAULT_NAVIGATION_GOAL:'保存目標',AbortController,AbortSignal,
  setTimeout:fn=>{timers.set(++serial,fn);return serial;},clearTimeout:id=>timers.delete(id),clearInterval(){},
  fetch:(url,options={})=>new Promise((resolve,reject)=>requests.push({url,...options,data:options.body?JSON.parse(options.body):null,resolve,reject})),
 });
 api.visible.value=true;api.availability.value={available:true};api.result.value=saved;api.panel.value={style:{},ownerDocument:{visibilityState:'visible'}};
 const answer=async(request,data,ok=true)=>{request.resolve({ok,json:async()=>data});await flush();};
 return{api,requests,timers,answer,unmount};
}
for(const [action,label] of [['navigate','調査中'],['evaluate','評価中']])test(`${label}: 開始応答前から停止でき、旧POST完了でも再開・失敗表示しない`,async()=>{
 const f=fixture(),run=f.api.navigate(action),start=f.requests[0];assert.equal(f.api.operationLabel.value,label);assert.equal(f.api.evaluating.value,action==='evaluate');assert.equal(f.api.canStop.value,true);
 const cancel=f.api.cancelNavigation(),stop=f.requests[1];assert.equal(start.signal.aborted,true);assert.equal(f.api.stopping.value,true);assert.equal(f.api.busy.value,true);
 assert.deepEqual(stop.data,{action:'cancel',clientRequestId:start.data.clientRequestId});await f.api.cancelNavigation();assert.equal(f.requests.length,2);
 await f.answer(stop,{job:{id:null,clientRequestId:start.data.clientRequestId,action,status:'cancelled'}});await cancel;
 await f.answer(f.requests[2],state(null));assert.equal(f.api.busy.value,false);assert.equal(f.api.canStop.value,false);assert.deepEqual(f.api.result.value,saved);
 await f.answer(start,{job:{id:'late',action,status:'running'}});await run;assert.equal(f.requests.length,3);assert.equal(f.api.job.value,null);assert.equal(f.api.failureDialog.value,null);assert.equal(f.api.error.value,'');
});
test('古いGETの遅延応答は中止後の実行中状態を復活させない',async()=>{
 const f=fixture();f.api.job.value={id:'active',action:'evaluate',status:'running'};assert.equal(f.api.operationLabel.value,'評価中');assert.equal(f.api.evaluating.value,true);
 const old=f.api.refresh(),get=f.requests[0],cancel=f.api.cancelNavigation();assert.deepEqual(f.requests[1].data,{action:'cancel',jobId:'active'});
 await f.answer(f.requests[1],{job:{id:'active',action:'evaluate',status:'cancelled'}});await cancel;
 await f.answer(f.requests[2],state({id:'active',action:'evaluate',status:'cancelled'}));await f.answer(get,state({id:'active',status:'running'}));await old;
 assert.equal(f.api.job.value.status,'cancelled');assert.equal(f.api.busy.value,false);assert.equal(f.api.failureDialog.value,null);
});
test('中止応答を失うと起動禁止を保ち、空のGETで解除せず同じIDで再試行する',async()=>{
 const f=fixture();void f.api.navigate('evaluate');const token=f.requests[0].data.clientRequestId;
 const cancel=f.api.cancelNavigation();f.requests[1].reject(Error('network down'));await cancel;assert.match(f.api.error.value,/中止を確認できません/);
 await f.answer(f.requests[2],state(null));assert.equal(f.api.busy.value,true);assert.equal(f.api.stopping.value,false);assert.equal(f.api.operationLabel.value,'評価中');assert.equal(f.api.evaluating.value,true);
 await f.api.navigate();assert.equal(f.requests.length,3);
 const retry=f.api.cancelNavigation();assert.equal(f.requests[3].data.clientRequestId,token);
 await f.answer(f.requests[3],{job:null});await retry;await f.answer(f.requests[4],state(null));assert.equal(f.api.busy.value,false);assert.equal(f.api.error.value,'');
});
test('中止応答喪失後でもGETの対応cancelled確認でロックを解除する',async()=>{
 const f=fixture();void f.api.navigate();const token=f.requests[0].data.clientRequestId;
 const cancel=f.api.cancelNavigation();f.requests[1].reject(Error('lost'));await cancel;
 await f.answer(f.requests[2],state({id:'current',clientRequestId:token,status:'cancelled'}));assert.equal(f.api.busy.value,false);assert.equal(f.api.canStop.value,false);assert.equal(f.api.failureDialog.value,null);
});
test('中止の直前に保存完了した結果は完了として案内する',async()=>{
 const f=fixture();f.api.job.value={id:'current',status:'running'};const cancel=f.api.cancelNavigation();
 await f.answer(f.requests[0],{job:{id:'current',status:'complete'}});await cancel;assert.match(f.api.autopilotStatus.value,/中止前に完了/);await f.answer(f.requests[1],state({id:'current',status:'complete'}));assert.equal(f.api.busy.value,false);
});
test('自動航行の再評価を中止すると即OFF、Codeの次周回を送らず、遅延応答も無視する',async()=>{
 const f=fixture();let codeRuns=0,signal;
 f.api.codePanel.value={navigationReadiness:()=>({ready:true}),runNavigationPrompt:async request=>{signal=request.signal;codeRuns++;}};
 const cruise=f.api.toggleAutopilot();await flush();assert.equal(f.requests[0].url,'/api/connection');await f.answer(f.requests[0],{active:true,startedAt:1});await f.answer(f.requests[1],{url:'/panels/code/navi-1/test/'});
 const start=f.requests[2];assert.equal(start.data.action,'evaluate');assert.equal(f.api.operationLabel.value,'評価中');assert.equal(f.api.evaluating.value,true);assert.equal(codeRuns,1);
 const cancel=f.api.cancelNavigation();assert.equal(f.api.autopilot.value,false);assert.equal(signal.aborted,true);assert.equal(f.api.stopping.value,true);
 const stop=f.requests[3];assert.deepEqual(stop.data,{action:'cancel',clientRequestId:start.data.clientRequestId});await f.answer(stop,{job:{id:'eval',status:'cancelled',clientRequestId:start.data.clientRequestId,action:'evaluate'}});await cancel;await f.answer(f.requests[4],state({id:'eval',status:'cancelled'}));
 await f.answer(start,{job:{id:'eval',status:'running'}});await cruise;assert.equal(codeRuns,1);assert.equal(f.api.autopilot.value,false);assert.equal(f.api.busy.value,false);assert.equal(f.api.reconciling.value,false);assert.equal(f.api.job.value.status,'cancelled');
});
test('非実行時の停止は何も送らず、アンマウント後の停止結果を反映しない',async()=>{
 const f=fixture();await f.api.cancelNavigation();assert.equal(f.requests.length,0);
 f.api.job.value={id:'running',status:'running'};const cancel=f.api.cancelNavigation();for(const fn of f.unmount)fn();const count=f.requests.length;await f.answer(f.requests[0],{job:{id:'running',status:'cancelled'}});await cancel;assert.equal(f.requests.length,count);assert.equal(f.api.job.value.status,'running');
});
test('停止は白い！の下に処理中名を置いたネイティブボタンで、長押しやシーン入力を使わない',()=>{
 const buttons=[...full.matchAll(/<button v-if="routing&&canStop&&!?evaluating"[\s\S]*?<\/button>/g)].map(match=>match[0]);assert.equal(buttons.length,2);
 for(const markup of buttons){
  assert.match(markup,/type="button"/);assert.match(markup,/:disabled="stopping"/);assert.match(markup,/@click="cancelNavigation"/);assert.match(markup,/:aria-label=/);assert.match(markup,/<img :src="stopIcon"[^>]*><span class="navigation-stop-label">/);assert.doesNotMatch(markup,/pointerdown|contextmenu|keydown/);
 }
 assert.match(full,/new URL\('abort.png',sendIcon.value\)/);assert.match(full,/\.navigation-stop img\{position:static/);
});
