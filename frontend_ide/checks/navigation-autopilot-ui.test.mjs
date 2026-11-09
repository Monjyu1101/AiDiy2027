// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createNavigationPopupSizer} from '../src/components/開発スペース/Navi窓サイズ.js';
import {createNavigationMessage} from '../src/components/開発スペース/Naviメッセージ.js';
import {ref,computed,toRaw} from 'vue';
import {runNavigationAutopilot} from '../src/components/開発スペース/Navi自動運転.js';
const source=readFileSync(new URL('../src/components/開発スペース/Naviパネル.vue',import.meta.url),'utf8').split('<script setup>')[1].split('</script>')[0].replace(/^import .*;\r?\n/gm,'');
const makeResult=(progress,requestId='initial')=>({schemaVersion:3,navigationId:'test-nav',requestId,goal:'goal',items:[{id:'work',name:'task',progress}],overall:{progress},nextItemId:progress<100?'work':null,nextPrompt:progress<100?'execute task':''});
const reply=data=>({ok:true,json:async()=>data});
const flush=async()=>{for(let i=0;i<80;i++)await Promise.resolve();};
function fixture(handler,props={}){
 const calls=[],resizes=[],sounds=[],watchers=[],timers=new Map();let id=0,evaluations=0,state=makeResult(0),job=null;
 const api=vm.runInNewContext(source+`;({title,normalTitle,syncCruiseTitle,toggleAutopilot,stopAutopilot,toggleCode,ensureCode,releaseCode,codeDriving,soundOn,codeOpen,codeToggleLabel,codeOpening,codeBase,codePanel,autopilot,autopilotStatus,autopilotMessage,availability,result,goal,panel,visible,detached,job,refresh,canAutopilot,busy,routing})`,{ref,computed,createNavigationPopupSizer,createNavigationMessage,inject:()=>null,watch:(source,callback)=>{watchers.push({source,callback});},onMounted(){},onBeforeUnmount(){},nextTick:async()=>{},defineProps:()=>({instance:'navi-1',standalone:true,project:{path:'/project'},...props}),defineEmits:()=>()=>{},window:{aidiyWindow:{navigationCode:async value=>{resizes.push(value);return {ok:true};}}},DEFAULT_NAVIGATION_GOAL:'goal',AbortController,AbortSignal,runNavigationAutopilot,navigationWait:async(_ms,signal)=>{if(signal.aborted)throw Error('aborted');},setTimeout:fn=>{timers.set(++id,fn);return id;},clearTimeout:id=>timers.delete(id),fetch:async(url,options={})=>{
  const method=options.method||'GET';calls.push({url,method});const custom=await handler?.(url,options);if(custom)return custom;
  if(url==='/api/connection')return reply({active:true,startedAt:1});
  if(url.startsWith('/api/navigation/code'))return reply({url:'/panels/code/navi-1/test/'});
  if(url==='/api/navigation/sound'){sounds.push(JSON.parse(options.body).kind);return reply({});}
  if(method==='POST'){job={id:'evaluate-'+(++evaluations),status:'complete'};state=makeResult(Math.min(100,evaluations*50),job.id);return reply({job});}
  return reply({job,result:state,availability:{available:true}});
 }});
 api.visible.value=true;api.panel.value={style:{},ownerDocument:{visibilityState:'visible'}};api.result.value=state;api.goal.value='goal';api.availability.value={available:true};
 return {api,calls,resizes,sounds,watchers,timers};
}
test('Vue handlers open only on demand, run two rounds, stop at100 and retain hidden Code until Navi release',async()=>{
 const f=fixture(),prompts=[];f.api.codePanel.value={navigationReadiness:()=>({ready:true}),runNavigationPrompt:async request=>prompts.push(request.text)};
 assert.equal(f.calls.length,0);await f.api.toggleAutopilot();await flush();assert.deepEqual(prompts,['execute task','execute task']);assert.equal(f.api.autopilot.value,false);assert.match(f.api.autopilotStatus.value,/100%/);assert.equal(f.api.result.value.overall.progress,100);
 assert.deepEqual(f.sounds,['注意','完了']); // 評価50%=注意、評価100%=完了（100%で終わるときに完了音を重ねない）
 f.api.toggleCode();await flush();assert.equal(f.api.codeBase.value,'/panels/code/navi-1/test/');assert.deepEqual(f.resizes,[true,false]);assert.equal(f.calls.filter(x=>x.method==='DELETE').length,0);await f.api.releaseCode();assert.equal(f.calls.at(-1).method,'DELETE');
});
test('OFF aborts Code and never starts reevaluation',async()=>{
 const f=fixture();let signal;f.api.codePanel.value={navigationReadiness:()=>({ready:true}),runNavigationPrompt:request=>{signal=request.signal;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('stopped')),{once:true}));}};
 const run=f.api.toggleAutopilot();await flush();assert.ok(signal);f.api.toggleAutopilot();await run;assert.equal(signal.aborted,true);assert.equal(f.calls.filter(x=>x.method==='POST'&&x.url.startsWith('/api/navigation?')).length,0);assert.equal(f.api.autopilot.value,false);
 assert.deepEqual(f.sounds,['注意']); // 100%未満で止まったときは注意
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
 const run=f.api.toggleAutopilot();assert.equal(f.api.codeOpen.value,true);await flush();const base=f.api.codeBase.value;f.api.toggleCode();await flush();assert.equal(f.api.codeOpen.value,false);assert.equal(signal.aborted,false);assert.equal(f.api.codeDriving.value,true);assert.equal(f.calls.filter(x=>x.method==='DELETE').length,0);f.api.toggleAutopilot();await run;assert.equal(signal.aborted,true);assert.equal(f.api.codeOpen.value,false);f.api.toggleCode();await flush();assert.equal(f.api.codeOpen.value,true);assert.equal(f.api.codeBase.value,base);assert.equal(toRaw(f.api.codePanel.value),code);assert.equal(f.calls.filter(x=>x.method==='POST'&&x.url.startsWith('/api/navigation/code')).length,1);
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
 const full=readFileSync(new URL('../src/components/開発スペース/Naviパネル.vue',import.meta.url),'utf8');
 assert.match(full,/<template #connection-tools><button[^>]+class="navigation-code-toggle"/);assert.match(full,/titleTools:.*navigation-code-toggle/);assert.doesNotMatch(full,/:disabled="autopilot" @click="toggleCode"/);assert.match(full,/<aside v-show="codeOpen"/);assert.doesNotMatch(full,/@click="stopAutopilot/);assert.doesNotMatch(full,/:base="codeBase"[^>]*:desktop=/);
});

test('Navi右側はCode見出し・空のタイトル行・重複する停止ボタンを出さない',()=>{
 const full=readFileSync(new URL('../src/components/開発スペース/Naviパネル.vue',import.meta.url),'utf8');
 const aside=full.match(/<aside v-show="codeOpen"[\s\S]*?<\/aside>/)?.[0];
 assert.ok(aside);assert.doesNotMatch(aside,/<strong>Code<\/strong>/);
 assert.doesNotMatch(aside,/<header|自動航行をオフ/);
 assert.match(aside,/<CodePanel[^>]+embedded hide-status-bar/);
});

test('Code orbit light is enabled only while autopilot is on and total is below100',()=>{
 const f=fixture();assert.equal(f.api.codeDriving.value,false);f.api.autopilot.value=true;assert.equal(f.api.codeDriving.value,true);f.api.result.value=makeResult(100);assert.equal(f.api.codeDriving.value,false);f.api.result.value=makeResult(50);assert.equal(f.api.codeDriving.value,true);f.api.stopAutopilot();assert.equal(f.api.codeDriving.value,false);
});
test('Code and overall light share a calm five-second orbit without slowing IDE exploration',()=>{
 const full=readFileSync(new URL('../src/components/開発スペース/Naviパネル.vue',import.meta.url),'utf8');const shared=readFileSync(new URL('../src/style.css',import.meta.url),'utf8');
 assert.match(full,/:class="\{driving:codeDriving\}"/);assert.match(full,/\.navigation-code\.driving,\.navigation-panel>\.navigation-overall\.driving\{[^}]*animation:motion-spin 5s linear infinite/);assert.match(shared,/\.space-motion-toggle\.driving\{[^}]*animation:motion-spin 1\.6s linear infinite/);assert.match(shared,/@keyframes motion-spin/);assert.doesNotMatch(full,/prefers-reduced-motion/);assert.doesNotMatch(full,/requestAnimationFrame/);
});

test('opening Code with autopilot OFF never inserts or submits the suggested prompt',async()=>{
 const f=fixture(),automated=[];f.api.codePanel.value={navigationReadiness:()=>({ready:true}),runNavigationPrompt:async request=>automated.push(request),insertDraft:request=>automated.push(request)};
 f.api.toggleCode();await flush();assert.equal(f.api.codeOpen.value,true);assert.equal(f.api.autopilot.value,false);assert.equal(f.api.codeDriving.value,false);assert.deepEqual(automated,[]);assert.equal(f.calls.filter(x=>x.method==='POST'&&x.url.startsWith('/api/navigation?')).length,0);
 f.api.toggleCode();await flush();assert.deepEqual(automated,[]);
});

test('active standalone title retains AiDiy and restores the original Navi title',()=>{
 const f=fixture();assert.equal(f.api.title.value,'AiDiy Navi');f.api.autopilot.value=true;assert.equal(f.api.title.value,'AiDiy Navi Cruise');f.api.syncCruiseTitle();assert.equal(f.api.panel.value.ownerDocument.title,'AiDiy Navi Cruise');f.api.stopAutopilot();assert.equal(f.api.title.value,'AiDiy Navi');f.api.syncCruiseTitle();assert.equal(f.api.panel.value.ownerDocument.title,'AiDiy Navi');
});

for(const allDisplays of [false,true])test(`IDE Navi retains AiDiy IDE and its window number during Cruise (VR=${allDisplays})`,()=>{
 const f=fixture(undefined,{standalone:false,instance:'navi-7',allDisplays});assert.equal(f.api.title.value,'AiDiy IDE / Navi 7');f.api.autopilot.value=true;assert.equal(f.api.title.value,'AiDiy IDE / Navi Cruise 7');f.api.detached.value=true;f.api.syncCruiseTitle();assert.equal(f.api.panel.value.ownerDocument.title,'AiDiy IDE / Navi Cruise 7');f.api.stopAutopilot();assert.equal(f.api.title.value,'AiDiy IDE / Navi 7');f.api.syncCruiseTitle();assert.equal(f.api.panel.value.ownerDocument.title,'AiDiy IDE / Navi 7');
});

test('starting cruise from a previously hidden Code reopens the existing session',async()=>{
 const f=fixture();let finish;f.api.codePanel.value={navigationReadiness:()=>({ready:true}),runNavigationPrompt:()=>new Promise(resolve=>finish=resolve)};
 f.api.toggleCode();await flush();f.api.toggleCode();await flush();assert.equal(f.api.codeOpen.value,false);const base=f.api.codeBase.value;
 const run=f.api.toggleAutopilot();assert.equal(f.api.codeOpen.value,true);await flush();assert.equal(f.api.codeBase.value,base);assert.equal(f.resizes.at(-1),true);assert.equal(f.calls.filter(x=>x.method==='POST'&&x.url.startsWith('/api/navigation/code')).length,1);f.api.stopAutopilot();finish();await run;
});


test('最下部通知の消去だけでは航行・Codeを止めず、同じクリックで生じた停止通知は保持する',async()=>{
 const f=fixture();let signal;
 f.api.codePanel.value={navigationReadiness:()=>({ready:true}),runNavigationPrompt:request=>{signal=request.signal;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('stopped')),{once:true}));}};
 const run=f.api.toggleAutopilot();await flush();const base=f.api.codeBase.value;assert.ok(f.api.autopilotStatus.value);
 f.api.autopilotMessage.dismiss({type:'click',pointerType:'touch'});await new Promise(resolve=>setTimeout(resolve,5));
 assert.equal(f.api.autopilotStatus.value,'');assert.equal(f.api.autopilot.value,true);assert.equal(signal.aborted,false);assert.equal(f.api.codeBase.value,base);
 f.api.autopilotMessage.show('実行中');f.api.autopilotMessage.dismiss({type:'click'});f.api.toggleAutopilot();await run;await new Promise(resolve=>setTimeout(resolve,5));
 assert.match(f.api.autopilotStatus.value,/停止を要求/);assert.equal(signal.aborted,true);
});


test('NaviのCodeボタンは現在の状態でなく押すと行う表示・非表示を案内する',()=>{
 const f=fixture();assert.equal(f.api.codeToggleLabel.value,'CODE');
 for(let i=0;i<2;i++){
  f.api.codeOpen.value=true;assert.equal(f.api.codeToggleLabel.value,'CODE非表示');
  f.api.autopilot.value=true;assert.equal(f.api.codeToggleLabel.value,'CODE非表示');
  f.api.codeOpen.value=false;assert.equal(f.api.codeToggleLabel.value,'CODE');
  f.api.autopilot.value=false;assert.equal(f.api.codeToggleLabel.value,'CODE');
 }
});


test('唯一の自動航行トグルはCode準備中にも停止でき、遅れた起動完了後に送信しない',async()=>{
 let finish;
 const f=fixture((url,options)=>url.startsWith('/api/navigation/code')&&options.method==='POST'?new Promise(resolve=>finish=resolve):undefined);
 let runs=0;f.api.codePanel.value={navigationReadiness:()=>({ready:true}),runNavigationPrompt:async()=>{runs++;}};
 const run=f.api.toggleAutopilot();await flush();assert.ok(finish);assert.equal(f.api.autopilot.value,true);
 await f.api.toggleAutopilot();assert.equal(f.api.autopilot.value,false);finish(reply({url:'/panels/code/navi-1/delayed/'}));await run;assert.equal(runs,0);
});

for(const codeVisible of [true,false])test(`唯一の自動航行トグルは再評価中にも停止できる（Code表示=${codeVisible}）`,async()=>{
 let finish;
 const f=fixture((url,options)=>url.startsWith('/api/navigation?')&&options.method==='POST'?new Promise(resolve=>finish=resolve):undefined);
 let runs=0;f.api.codePanel.value={navigationReadiness:()=>({ready:true}),runNavigationPrompt:async()=>{runs++;}};
 const run=f.api.toggleAutopilot();await flush();assert.ok(finish);assert.equal(f.api.routing.value,true);assert.equal(f.api.busy.value,true);assert.equal(runs,1);
 f.api.codeOpen.value=codeVisible;await f.api.toggleAutopilot();assert.equal(f.api.autopilot.value,false);
 finish(reply({job:{id:'late-evaluation',status:'running'}}));await run;assert.equal(runs,1);assert.match(f.api.autopilotStatus.value,/停止を要求/);
});

test('通常の調査・再評価の終了音: 100%は完了、100%未満と失敗は注意、中止と途中経過は鳴らさない',async()=>{
 const f=fixture(),watcher=f.watchers.find(item=>String(item.source).includes('clientRequestId')).callback;
 const end=async(status,progress,previousStatus='running',id='job-1')=>{f.sounds.length=0;f.api.result.value=makeResult(progress);watcher([id,status,'client-1'],['job-1',previousStatus,'client-1']);await flush();return [...f.sounds];};
 assert.deepEqual(await end('complete',100),['完了']);
 assert.deepEqual(await end('complete',60),['注意']);
 assert.deepEqual(await end('failed',100),['注意']);
 assert.deepEqual(await end('cancelled',100),[]);
 assert.deepEqual(await end('running',100),[]);
 assert.deepEqual(await end('complete',100,'complete'),[]); // 実行中を見ていない完了（再表示・履歴）は鳴らさない
 assert.deepEqual(await end('complete',100,'running','job-2'),[]); // 別の依頼へ切り替わった場合
});

test('通知音のトグル: 初期値はオンで、オフにすると評価・停止の音を一切鳴らさない',async()=>{
 const f=fixture();assert.equal(f.api.soundOn.value,true);f.api.soundOn.value=false;
 const watcher=f.watchers.find(item=>String(item.source).includes('clientRequestId')).callback;
 f.api.result.value=makeResult(100);watcher(['job-1','complete','client-1'],['job-1','running','client-1']);
 f.api.codePanel.value={navigationReadiness:()=>({ready:true}),runNavigationPrompt:async()=>{}};
 await f.api.toggleAutopilot();await flush();
 assert.deepEqual(f.sounds,[]);
 f.api.soundOn.value=true;f.sounds.length=0;f.api.result.value=makeResult(40);watcher(['job-2','failed','client-2'],['job-2','running','client-2']);await flush();
 assert.deepEqual(f.sounds,['注意']); // オンに戻すと鳴る
});
