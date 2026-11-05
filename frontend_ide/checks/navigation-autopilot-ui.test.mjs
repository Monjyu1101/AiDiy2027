// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createNavigationPopupSizer} from '../src/components/開発スペース/Navigation窓サイズ.js';
import {ref,computed,toRaw} from 'vue';
import {runNavigationAutopilot} from '../src/components/開発スペース/Navigation自動運転.js';
const source=readFileSync(new URL('../src/components/開発スペース/Navigationパネル.vue',import.meta.url),'utf8').split('<script setup>')[1].split('</script>')[0].replace(/^import .*;\r?\n/gm,'');
const makeResult=(progress,requestId='initial')=>({schemaVersion:3,navigationId:'test-nav',requestId,goal:'goal',items:[{id:'work',name:'task',progress}],overall:{progress},nextItemId:progress<100?'work':null,nextPrompt:progress<100?'execute task':''});
const reply=data=>({ok:true,json:async()=>data});
const flush=async()=>{for(let i=0;i<80;i++)await Promise.resolve();};
function fixture(handler,props={}){
 const calls=[],resizes=[],timers=new Map();let id=0,evaluations=0,state=makeResult(0),job=null;
 const api=vm.runInNewContext(source+`;({title,normalTitle,syncCruiseTitle,toggleAutopilot,stopAutopilot,toggleCode,ensureCode,releaseCode,codeDriving,codeOpen,codeOpening,codeBase,codePanel,autopilot,autopilotStatus,availability,result,goal,panel,visible,detached,job,refresh,canAutopilot})`,{ref,computed,createNavigationPopupSizer,inject:()=>null,watch(){},onMounted(){},onBeforeUnmount(){},nextTick:async()=>{},defineProps:()=>({instance:'navi-1',standalone:true,project:{path:'/project'},...props}),defineEmits:()=>()=>{},window:{aidiyWindow:{navigationCode:async value=>{resizes.push(value);return {ok:true};}}},DEFAULT_NAVIGATION_GOAL:'goal',AbortController,AbortSignal,runNavigationAutopilot,navigationWait:async(_ms,signal)=>{if(signal.aborted)throw Error('aborted');},setTimeout:fn=>{timers.set(++id,fn);return id;},clearTimeout:id=>timers.delete(id),fetch:async(url,options={})=>{
  const method=options.method||'GET';calls.push({url,method});const custom=await handler?.(url,options);if(custom)return custom;
  if(url==='/api/connection')return reply({active:true,startedAt:1});
  if(url.startsWith('/api/navigation/code'))return reply({url:'/panels/code/navi-1/test/'});
  if(method==='POST'){job={id:'evaluate-'+(++evaluations),status:'complete'};state=makeResult(Math.min(100,evaluations*50),job.id);return reply({job});}
  return reply({job,result:state,availability:{available:true}});
 }});
 api.visible.value=true;api.panel.value={style:{},ownerDocument:{visibilityState:'visible'}};api.result.value=state;api.goal.value='goal';api.availability.value={available:true};
 return {api,calls,resizes,timers};
}
test('Vue handlers open only on demand, run two rounds, stop at100 and retain hidden Code until Navigator release',async()=>{
 const f=fixture(),prompts=[];f.api.codePanel.value={navigationReadiness:()=>({ready:true}),runNavigationPrompt:async request=>prompts.push(request.text)};
 assert.equal(f.calls.length,0);await f.api.toggleAutopilot();await flush();assert.deepEqual(prompts,['execute task','execute task']);assert.equal(f.api.autopilot.value,false);assert.match(f.api.autopilotStatus.value,/100%/);assert.equal(f.api.result.value.overall.progress,100);
 f.api.toggleCode();await flush();assert.equal(f.api.codeBase.value,'/panels/code/navi-1/test/');assert.deepEqual(f.resizes,[true,false]);assert.equal(f.calls.filter(x=>x.method==='DELETE').length,0);await f.api.releaseCode();assert.equal(f.calls.at(-1).method,'DELETE');
});
test('OFF aborts Code and never starts reevaluation',async()=>{
 const f=fixture();let signal;f.api.codePanel.value={navigationReadiness:()=>({ready:true}),runNavigationPrompt:request=>{signal=request.signal;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('stopped')),{once:true}));}};
 const run=f.api.toggleAutopilot();await flush();assert.ok(signal);f.api.stopAutopilot();await run;assert.equal(signal.aborted,true);assert.equal(f.calls.filter(x=>x.method==='POST'&&x.url.startsWith('/api/navigation?')).length,0);assert.equal(f.api.autopilot.value,false);
});
test('open-hide-show during initialization retains one POST and restores expansion',async()=>{
 let resolve;let first=true;const f=fixture((url,options)=>{if(first&&url.startsWith('/api/navigation/code')&&options.method==='POST'){first=false;return new Promise(done=>resolve=done);}});
 f.api.toggleCode();await flush();assert.ok(resolve);f.api.toggleCode();f.api.toggleCode();await flush();resolve(reply({url:'/panels/code/navi-1/old/'}));await flush();
 assert.deepEqual(f.calls.filter(x=>x.url.startsWith('/api/navigation/code')).map(x=>x.method),['POST']);assert.equal(f.api.codeBase.value,'/panels/code/navi-1/old/');assert.equal(f.api.codeOpen.value,true);assert.deepEqual(f.resizes,[true,false,true]);
});
test('failed Code initialization collapses and reports error without running',async()=>{
 const f=fixture(url=>url.startsWith('/api/navigation/code')?{ok:false,json:async()=>({error:'cannot launch'})}:undefined);await f.api.toggleAutopilot();assert.equal(f.api.codeOpen.value,false);assert.equal(f.api.autopilot.value,false);assert.match(f.api.autopilotStatus.value,/cannot launch/);assert.deepEqual(f.resizes,[true,false]);
});
test('Codeの接続確定を待ち、未対応サーバーは理由を出して送信せず停止する',async()=>{
 const f=fixture();let checks=0,sends=0;
 f.api.codePanel.value={navigationReadiness:()=>++checks<3?{ready:false,reason:'Codeのオンライン接続・セッション確定を待っています…'}:{ready:true},runNavigationPrompt:async()=>{sends++;}};
 await f.api.toggleAutopilot();assert.equal(checks,3);assert.equal(sends,2);assert.equal(f.api.autopilot.value,false);
 const old=fixture();old.api.codePanel.value={navigationReadiness:()=>({ready:false,fatal:true,reason:'Code実行サーバーが自動航行に未対応です。'}),runNavigationPrompt:()=>assert.fail('must not send')};
 await old.api.toggleAutopilot();assert.equal(old.api.autopilot.value,false);assert.match(old.api.autopilotStatus.value,/未対応/);
});

test('autopilot opens Code, allows hiding, stops while hidden and restores the same session',async()=>{
 const f=fixture();let signal;const code={navigationReadiness:()=>({ready:true}),runNavigationPrompt:request=>{signal=request.signal;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('stopped')),{once:true}));}};f.api.codePanel.value=code;
 const run=f.api.toggleAutopilot();assert.equal(f.api.codeOpen.value,true);await flush();const base=f.api.codeBase.value;f.api.toggleCode();await flush();assert.equal(f.api.codeOpen.value,false);assert.equal(signal.aborted,false);assert.equal(f.api.codeDriving.value,true);assert.equal(f.calls.filter(x=>x.method==='DELETE').length,0);f.api.stopAutopilot();await run;assert.equal(signal.aborted,true);assert.equal(f.api.codeOpen.value,false);f.api.toggleCode();await flush();assert.equal(f.api.codeOpen.value,true);assert.equal(f.api.codeBase.value,base);assert.equal(toRaw(f.api.codePanel.value),code);assert.equal(f.calls.filter(x=>x.method==='POST'&&x.url.startsWith('/api/navigation/code')).length,1);
});
test('hidden Code finishes both rounds and reopens with the same state without sending again',async()=>{
 const f=fixture();let finish;const prompts=[];const code={navigationReadiness:()=>({ready:true}),runNavigationPrompt:request=>{prompts.push(request.text);return prompts.length===1?new Promise(resolve=>finish=resolve):Promise.resolve();}};f.api.codePanel.value=code;
 const run=f.api.toggleAutopilot();await flush();f.api.toggleCode();await flush();const base=f.api.codeBase.value;finish();await run;assert.equal(f.api.codeOpen.value,false);assert.equal(f.api.result.value.overall.progress,100);assert.equal(f.api.autopilot.value,false);assert.equal(f.api.codeDriving.value,false);assert.equal(prompts.length,2);f.api.toggleCode();await flush();assert.equal(f.api.codeBase.value,base);assert.equal(toRaw(f.api.codePanel.value),code);assert.equal(prompts.length,2);assert.equal(f.calls.filter(x=>x.method==='DELETE').length,0);assert.equal(f.calls.filter(x=>x.method==='POST'&&x.url.startsWith('/api/navigation/code')).length,1);
});
test('hiding during Code launch still mounts one session and continues navigation',async()=>{
 let finish;const f=fixture((url,options)=>url.startsWith('/api/navigation/code')&&options.method==='POST'?new Promise(resolve=>finish=resolve):undefined);let count=0;f.api.codePanel.value={navigationReadiness:()=>({ready:true}),runNavigationPrompt:async()=>{count++;}};
 const run=f.api.toggleAutopilot();await flush();f.api.toggleCode();await flush();finish(reply({url:'/panels/code/navi-1/retained/'}));await run;assert.equal(f.api.codeOpen.value,false);assert.equal(f.api.codeBase.value,'/panels/code/navi-1/retained/');assert.equal(count,2);assert.equal(f.api.result.value.overall.progress,100);assert.equal(f.calls.filter(x=>x.method==='DELETE').length,0);
});
test('Code toggle lives in title slots and embedded Code does not control the owner OS window',()=>{
 const full=readFileSync(new URL('../src/components/開発スペース/Navigationパネル.vue',import.meta.url),'utf8');
 assert.match(full,/<template #window-tools><button[^>]+class="navigation-code-toggle"/);assert.match(full,/titleTools:.*navigation-code-toggle/);assert.doesNotMatch(full,/:disabled="autopilot" @click="toggleCode"/);assert.match(full,/<aside v-show="codeOpen"/);assert.match(full,/v-if="autopilot&&!codeOpen"[^>]*type="button" @click="stopAutopilot/);assert.doesNotMatch(full,/:base="codeBase"[^>]*:desktop=/);
});

test('Code orbit light is enabled only while autopilot is on and total is below100',()=>{
 const f=fixture();assert.equal(f.api.codeDriving.value,false);f.api.autopilot.value=true;assert.equal(f.api.codeDriving.value,true);f.api.result.value=makeResult(100);assert.equal(f.api.codeDriving.value,false);f.api.result.value=makeResult(50);assert.equal(f.api.codeDriving.value,true);f.api.stopAutopilot();assert.equal(f.api.codeDriving.value,false);
});
test('Code light reuses exploration orbit with reduced-motion fallback and no overlay loop',()=>{
 const full=readFileSync(new URL('../src/components/開発スペース/Navigationパネル.vue',import.meta.url),'utf8');const shared=readFileSync(new URL('../src/style.css',import.meta.url),'utf8');
 assert.match(full,/:class="\{driving:codeDriving\}"/);assert.match(full,/animation:motion-spin 1\.6s linear infinite/);assert.match(shared,/@keyframes motion-spin/);assert.match(full,/@media\(prefers-reduced-motion:reduce\)\{\.navigation-code\.driving,\.navigation-panel>\.navigation-overall\.driving\{animation:none/);assert.doesNotMatch(full,/requestAnimationFrame/);
});

test('opening Code with autopilot OFF never inserts or submits the suggested prompt',async()=>{
 const f=fixture(),automated=[];f.api.codePanel.value={navigationReadiness:()=>({ready:true}),runNavigationPrompt:async request=>automated.push(request),insertDraft:request=>automated.push(request)};
 f.api.toggleCode();await flush();assert.equal(f.api.codeOpen.value,true);assert.equal(f.api.autopilot.value,false);assert.equal(f.api.codeDriving.value,false);assert.deepEqual(automated,[]);assert.equal(f.calls.filter(x=>x.method==='POST'&&x.url.startsWith('/api/navigation?')).length,0);
 f.api.toggleCode();await flush();assert.deepEqual(automated,[]);
});

test('active standalone title retains AiDiy and restores the original Navigator title',()=>{
 const f=fixture();assert.equal(f.api.title.value,'AiDiy Navigator');f.api.autopilot.value=true;assert.equal(f.api.title.value,'AiDiy Navigation Cruise');f.api.syncCruiseTitle();assert.equal(f.api.panel.value.ownerDocument.title,'AiDiy Navigation Cruise');f.api.stopAutopilot();assert.equal(f.api.title.value,'AiDiy Navigator');f.api.syncCruiseTitle();assert.equal(f.api.panel.value.ownerDocument.title,'AiDiy Navigator');
});

for(const allDisplays of [false,true])test(`IDE Navigator retains AiDiy IDE and its window number during Cruise (VR=${allDisplays})`,()=>{
 const f=fixture(undefined,{standalone:false,instance:'navi-7',allDisplays});assert.equal(f.api.title.value,'AiDiy IDE / Navigator 7');f.api.autopilot.value=true;assert.equal(f.api.title.value,'AiDiy IDE / Navigation Cruise 7');f.api.detached.value=true;f.api.syncCruiseTitle();assert.equal(f.api.panel.value.ownerDocument.title,'AiDiy IDE / Navigation Cruise 7');f.api.stopAutopilot();assert.equal(f.api.title.value,'AiDiy IDE / Navigator 7');f.api.syncCruiseTitle();assert.equal(f.api.panel.value.ownerDocument.title,'AiDiy IDE / Navigator 7');
});

test('starting cruise from a previously hidden Code reopens the existing session',async()=>{
 const f=fixture();let finish;f.api.codePanel.value={navigationReadiness:()=>({ready:true}),runNavigationPrompt:()=>new Promise(resolve=>finish=resolve)};
 f.api.toggleCode();await flush();f.api.toggleCode();await flush();assert.equal(f.api.codeOpen.value,false);const base=f.api.codeBase.value;
 const run=f.api.toggleAutopilot();assert.equal(f.api.codeOpen.value,true);await flush();assert.equal(f.api.codeBase.value,base);assert.equal(f.resizes.at(-1),true);assert.equal(f.calls.filter(x=>x.method==='POST'&&x.url.startsWith('/api/navigation/code')).length,1);f.api.stopAutopilot();finish();await run;
});
