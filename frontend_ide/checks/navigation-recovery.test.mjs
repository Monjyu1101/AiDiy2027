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
import {ref,computed} from 'vue';
import {localDateTimeInput} from '../src/components/ファイル閲覧/ファイル日時.js';
const source=readFileSync(new URL('../src/components/開発スペース/Naviパネル.vue',import.meta.url),'utf8').split('<script setup>')[1].split('</script>')[0].replace(/^import .*;\r?\n/gm,'');
function fixture({props={},draftActions=null,native=false}={}){
 const calls=[],requests=[],pending=[],timers=new Map();let serial=0;
 const api=vm.runInNewContext(source+`;({navigate,refresh,selectHistory,goal,editGoal,canEvaluate,recommendedPrompt,nextItem,copy,copied,copying,copyError,panel,busy,job,error,visible,availability,result,overall,checkedAt,nextNavigationAction,history,autopilot,submitting,reconciling,savingModel,toolsState,handoff,canHandoff,draftRequest})`,{
  ref,computed,createNavigationPopupSizer,createNavigationMessage,localDateTimeInput,inject:()=>draftActions,watch(){},onMounted(){},onBeforeUnmount(){},nextTick:async()=>{},defineProps:()=>({instance:'navi-1',standalone:false,...props}),defineEmits:()=>()=>{},window:native?{aidiyWindow:{}}:{},DEFAULT_NAVIGATION_GOAL:'目標',AbortController,AbortSignal,
  setTimeout:fn=>{timers.set(++serial,fn);return serial;},clearTimeout:id=>timers.delete(id),
  fetch:(url,options)=>{calls.push(options.method);requests.push({url,...options});return new Promise((resolve,reject)=>pending.push({resolve,reject}));},
 });
 api.visible.value=true;api.availability.value={available:true};
 const settle=async()=>{for(let n=0;n<15;n++)await Promise.resolve();};
 const answer=async(data)=>{pending.shift().resolve({ok:true,json:async()=>data});await settle();};
 return {api,calls,requests,pending,timers,settle,answer};
}
const state=job=>({result:null,job,availability:{available:true},selection:{provider:'aidiy_hermes',model:'auto'}});
test('確認日時は端末の日時を秒まで表示し、記録・再評価の切替に追従する',()=>{
 const {api}=fixture(),at=new Date(2026,10,5,9,7,3).getTime();api.result.value={checkedAt:at};
 assert.equal(api.checkedAt.value.text,'2026-11-05 09:07:03');assert.equal(api.checkedAt.value.iso,new Date(at).toISOString());
 api.result.value={checkedAt:at+61000};assert.equal(api.checkedAt.value.text,'2026-11-05 09:08:04');
 for(const checkedAt of [undefined,null,'2026-11-05',NaN,Infinity,1e20]){api.result.value={checkedAt,createdAt:at,updatedAt:at};assert.equal(api.checkedAt.value,null);}
 api.result.value=null;assert.equal(api.checkedAt.value,null);
});
test('開始応答を失っても状態確認を再開し、確認前・実行中の再送を防止する',async()=>{
 const f=fixture();const request=f.api.navigate();assert.deepEqual(f.calls,['POST']);
 f.pending.shift().reject(Error('response lost'));await request;await f.settle();
 assert.deepEqual(f.calls,['POST','GET']);assert.equal(f.api.busy.value,true);
 await f.api.navigate();assert.deepEqual(f.calls,['POST','GET']);
 await f.answer(state({id:'accepted',status:'running'}));assert.equal(f.api.busy.value,true);assert.equal(f.timers.size,1);
 await f.api.navigate();assert.equal(f.calls.filter(x=>x==='POST').length,1);
 const poll=[...f.timers.values()][0];f.timers.clear();void poll();await f.answer(state({id:'accepted',status:'complete'}));
 assert.equal(f.api.busy.value,false);assert.equal(f.api.job.value.status,'complete');assert.equal(f.timers.size,1);
});
test('状態取得も失敗した場合は再送禁止のまま定期確認し、未受理確認後だけ再試行できる',async()=>{
 const f=fixture();const request=f.api.navigate();f.pending.shift().reject(Error('POST failed'));await request;
 f.pending.shift().reject(Error('GET failed'));await f.settle();assert.equal(f.api.busy.value,true);assert.equal(f.timers.size,1);
 await f.api.navigate();assert.equal(f.calls.filter(x=>x==='POST').length,1);
 const poll=[...f.timers.values()][0];f.timers.clear();void poll();await f.answer(state(null));
 assert.equal(f.api.busy.value,false);
 const retry=f.api.navigate();assert.equal(f.calls.filter(x=>x==='POST').length,2);
 await f.answer({job:{id:'retry',status:'running'}});await retry;await f.answer(state({id:'retry',status:'running'}));
 assert.equal(f.api.busy.value,true);assert.equal(f.timers.size,1);
});

test('総合評価はAIの値・根拠を直接表示し、等分平均や項目からの再計算を行わない',()=>{
 const {api}=fixture();
 api.result.value={schemaVersion:3,items:[{progress:100,weight:90},{progress:0,weight:10}],overall:{progress:90,reason:'主要作業の比率90%を完了'}};
 assert.equal(api.overall.value.progress,90);assert.equal(api.overall.value.reason,'主要作業の比率90%を完了');
 // API検証済み値が画面の唯一の情報源。画面側では再計算しない。
 api.result.value.overall.progress=73;assert.equal(api.overall.value.progress,73);
 api.result.value.overall={progress:0,reason:'未着手を確認'};assert.equal(api.overall.value.progress,0);
 delete api.result.value.overall;assert.equal(api.overall.value,undefined);
 api.result.value=null;assert.equal(api.overall.value,undefined);
 assert.doesNotMatch(source,/Math\.round|items\.reduce/);
});


test('旧記録の取得失敗後も新規操作で即座に実行可能状態と既定目標へ戻る',async()=>{
 const f=fixture();f.api.availability.value={available:false,reason:'実行環境を確認しています…'};f.api.goal.value='旧目標';
 const refresh=f.api.refresh();
 f.pending.shift().resolve({ok:false,json:async()=>({error:'旧形式です。「＋ 新規」で記録を切り替えてから「ナビ」で再作成してください。'})});
 await refresh;assert.match(f.api.error.value,/旧形式/);assert.equal(f.api.availability.value.available,false);
 const fresh=f.api.selectHistory();assert.deepEqual(f.calls,['GET','POST']);
 await f.answer(state(null));await fresh;
 assert.equal(f.api.goal.value,'目標');assert.equal(f.api.result.value,null);assert.equal(f.api.job.value,null);assert.equal(f.api.error.value,'');
 assert.equal(f.api.availability.value.available,true);assert.equal(f.api.busy.value,false);
 // 定期GETを実行する前にナビを送信できることを確認する。
 const navigate=f.api.navigate();assert.deepEqual(f.calls,['GET','POST','POST']);
 await f.answer({job:{id:'recreated',status:'running'}});await navigate;await f.answer(state({id:'recreated',status:'running'}));
 assert.equal(f.api.busy.value,true);
});


for(const [name,result] of [['総合null',{schemaVersion:3,items:[{progress:0}],overall:{progress:null}}],['総合欠損',{schemaVersion:3,items:[{progress:0}]}],['項目null',{schemaVersion:3,items:[{progress:null}],overall:{progress:0}}],['旧形式',{items:[{progress:0}],overall:{progress:0}}]])test('旧APIや不正応答を数値のない成功表示へ流さない: '+name,async()=>{
 const f=fixture(),saved={schemaVersion:3,items:[{progress:25}],overall:{progress:25}};f.api.result.value=saved;
 const refresh=f.api.refresh();await f.answer({...state(null),result});await refresh;assert.deepEqual(f.api.result.value,saved);assert.match(f.api.error.value,/数値評価/);
 const select=f.api.selectHistory('old');await f.answer({...state(null),result});await select;assert.deepEqual(f.api.result.value,saved);assert.match(f.api.error.value,/数値評価/);
});
test('初回の不正API応答を0%へ補完せず明示的に拒否する',async()=>{
 const f=fixture();const refresh=f.api.refresh();await f.answer({...state(null),result:{overall:{progress:null}}});await refresh;assert.equal(f.api.result.value,null);assert.match(f.api.error.value,/数値評価/);
});

test('完了応答の評価が不正でも実行中ロックを解放し新規作成で復帰できる',async()=>{
 const f=fixture();f.api.job.value={id:'old',status:'running'};assert.equal(f.api.busy.value,true);
 const refresh=f.api.refresh();await f.answer({...state({id:'old',status:'complete'}),result:{schemaVersion:3,items:[{progress:0}],overall:{progress:null}}});await refresh;
 assert.match(f.api.error.value,/数値評価/);assert.equal(f.api.busy.value,false);
 const fresh=f.api.selectHistory();await f.answer(state(null));await fresh;assert.equal(f.api.result.value,null);assert.equal(f.api.error.value,'');assert.equal(f.api.busy.value,false);
});

test('AI生成本文は入力編集で変わらず、履歴・コピーでも加筆しない',async()=>{
 const f=fixture();assert.equal(f.api.recommendedPrompt.value,'');
 f.api.result.value={schemaVersion:3,goal:'保存済みの目標',items:[{id:'1',name:'最初の項目',progress:0}],overall:{progress:0},nextItemId:'1',nextPrompt:'今回の目標: 保存済みの意図\n対処しようとしている内容: 未確認の表示\n今回の作業: <確認>を行ってください。  '};
 f.api.goal.value='編集中の別目標';assert.equal(f.api.recommendedPrompt.value,'今回の目標: 保存済みの意図\n対処しようとしている内容: 未確認の表示\n今回の作業: <確認>を行ってください。  ');
 const texts=[];f.api.panel.value={ownerDocument:{defaultView:{navigator:{clipboard:{writeText:async text=>texts.push(text)}}}}};
 await f.api.copy();assert.deepEqual(texts,['今回の目標: 保存済みの意図\n対処しようとしている内容: 未確認の表示\n今回の作業: <確認>を行ってください。  ']);
 const select=f.api.selectHistory('history');await f.answer({...state(null),result:{schemaVersion:3,goal:'履歴の目標',items:[{id:'2',name:'履歴の項目',progress:0}],overall:{progress:0},nextItemId:'2',nextPrompt:'履歴の提案'}});await select;
 assert.equal(f.api.recommendedPrompt.value,'履歴の提案');
 const fresh=f.api.selectHistory();await f.answer(state(null));await fresh;assert.equal(f.api.recommendedPrompt.value,'');
});

test('先頭未完了のAI本文だけを表示・コピーし、全件完了で提案をなくす',()=>{
 const {api}=fixture();api.result.value={goal:'目的',items:[{id:'a',name:'完了',progress:100},{id:'b',name:'対象',progress:99},{id:'c',name:'後続',progress:0}],nextItemId:'b',nextPrompt:'対象だけ確認'};
 assert.equal(api.nextItem.value.id,'b');assert.equal(api.recommendedPrompt.value,'対象だけ確認');
 api.result.value.items.forEach(item=>item.progress=100);api.result.value.nextItemId=null;api.result.value.nextPrompt='';assert.equal(api.nextItem.value,undefined);assert.equal(api.recommendedPrompt.value,'');
});
test('APIから対象不一致の提案が届いても表示に採用しない',async()=>{
 const f=fixture();const refresh=f.api.refresh();await f.answer({...state(null),result:{schemaVersion:3,goal:'目標',items:[{id:'1',progress:0},{id:'2',progress:50}],overall:{progress:25},nextItemId:'2',nextPrompt:'後続の作業'}});await refresh;
 assert.equal(f.api.result.value,null);assert.match(f.api.error.value,/対象が一致しません/);
});

function copyFixture({writeText,legacy=true,throws=false}={}){
 const {api}=fixture(),events=[],writes=[];const range={cloneRange(){return this;}};
 const selection={rangeCount:1,getRangeAt:()=>range,removeAllRanges(){events.push('clear');},addRange(r){assert.equal(r,range);events.push('restore-range');}};
 const input={style:{},focus(){events.push('focus-input');},select(){events.push('select');},setSelectionRange(a,b){assert.equal(a,0);assert.equal(b,input.value.length);},remove(){events.push('remove');}};
 const doc={defaultView:{navigator:{clipboard:writeText?{writeText}:undefined}},activeElement:{focus(){events.push('restore-focus');}},getSelection:()=>selection,createElement(tag){assert.equal(tag,'textarea');return input;},body:{appendChild(){events.push('append');}},execCommand(command){assert.equal(command,'copy');writes.push(input.value);if(throws)throw Error('denied');return legacy;}};
 api.panel.value={ownerDocument:doc};api.result.value={items:[{id:'a',progress:0}],nextPrompt:'今回の目標\n対処内容\n今回の作業 <そのまま>  '};
 return {api,events,writes,doc};
}
test('Clipboard API成功では本文そのままを書き込み従来方式を呼ばない',async()=>{
 const writes=[],f=copyFixture({writeText:async text=>writes.push(text)});await f.api.copy();assert.deepEqual(writes,[f.api.recommendedPrompt.value]);assert.equal(f.api.copied.value,true);assert.deepEqual(f.events,[]);assert.equal(f.api.copyError.value,'');
});
for(const mode of ['missing','reject'])test(`Clipboard API ${mode}でも表示先documentの従来コピーを使用する`,async()=>{
 const f=copyFixture({writeText:mode==='reject'?async()=>{throw Error('NotAllowedError');}:undefined});await f.api.copy();assert.deepEqual(f.writes,[f.api.recommendedPrompt.value]);assert.equal(f.api.copied.value,true);assert.deepEqual(f.events,['append','focus-input','select','remove','restore-focus','clear','restore-range']);
});
for(const mode of ['false','throws'])test(`両方式が失敗(${mode})すると成功表示せず手動コピー方法を示す`,async()=>{
 const f=copyFixture({legacy:false,throws:mode==='throws'});f.api.copied.value=true;await f.api.copy();assert.equal(f.api.copied.value,false);assert.equal(f.api.copying.value,false);assert.match(f.api.copyError.value,/Ctrl\+C.*⌘C/);assert.ok(f.events.includes('remove'));assert.ok(f.events.includes('restore-focus'));
});
test('コピー連打は重複せず、完了前に結果が変わると成功表示を付けない',async()=>{
 let resolve,calls=0;const f=copyFixture({writeText:()=>{calls++;return new Promise(r=>resolve=r);}});const pending=f.api.copy();await f.api.copy();assert.equal(calls,1);assert.equal(f.api.copying.value,true);f.api.result.value={items:[],nextPrompt:''};resolve();await pending;assert.equal(f.api.copied.value,false);assert.equal(f.api.copying.value,false);
});
test('コピー失敗後の再試行成功で通知を消し、空の提案をコピーしない',async()=>{
 const f=copyFixture({legacy:false});await f.api.copy();assert.ok(f.api.copyError.value);f.doc.execCommand=()=>true;await f.api.copy();assert.equal(f.api.copyError.value,'');assert.equal(f.api.copied.value,true);f.api.result.value={items:[],nextPrompt:''};f.doc.execCommand=()=>{throw Error('must not call');};await f.api.copy();
});

for(const mode of ['web-ide','desktop-ide','desktop-navi'])test(`CODE/LIVEへ: ${mode}は共通選択用の要求だけを作り本文を改変しない`,()=>{
 let calls=0;const actions={loadTargets(){calls++;},insertDraft(){calls++;}};
 const f=fixture({props:{project:{path:'/project'},standalone:mode==='desktop-navi'},native:mode!=='web-ide',draftActions:actions});
 const text='今回の目標\n対処内容\n今回の作業 <本文>  ';
 f.api.result.value={items:[{progress:0}],nextPrompt:text};f.api.handoff();
 assert.equal(f.api.draftRequest.value.projectPath,'/project');assert.equal(f.api.draftRequest.value.text,text);assert.equal(calls,0);
 const first=f.api.draftRequest.value;f.api.handoff();assert.equal(f.api.draftRequest.value,first);
 f.api.goal.value='未反映の編集';assert.equal(first.text,text);
});
for(const options of [{props:{project:{path:'/p'},standalone:true}},{props:{project:null}},{draftActions:null}])test('利用できない連携・プロジェクト未確定では受け渡しを作らない '+JSON.stringify(options),()=>{
 const f=fixture({props:{project:{path:'/p'}},draftActions:{},...options});f.api.result.value={items:[{progress:0}],nextPrompt:'本文'};f.api.handoff();assert.equal(f.api.draftRequest.value,null);
});
test('全件完了でおすすめがないときは受け渡しを作らない',()=>{
 const f=fixture({props:{project:{path:'/p'}},draftActions:{}});f.api.result.value={items:[{progress:100}],nextPrompt:''};f.api.handoff();assert.equal(f.api.draftRequest.value,null);
});

test('デスクトップのNaviは共有下書き経路を使いBrowserの本文取得・通常Routerを呼ばない',async()=>{
 const desktop=readFileSync(new URL('../desktop.cjs',import.meta.url),'utf8'),start=desktop.indexOf(" ipcMain.handle('development:draft-targets'"),end=desktop.indexOf(" ipcMain.on('development:draft-result'",start);
 const handlers={},calls=[],source={kind:'navi'},value={text:'AI本文\nそのまま  ',projectPath:'/project'};
 vm.runInNewContext(desktop.slice(start,end),{ipcMain:{handle:(name,fn)=>handlers[name]=fn},trustedEvent:()=>source,sharedDrafts:async()=>({list:async s=>{assert.equal(s,source);calls.push('list');return{ok:true};},insert:async(s,v)=>{assert.equal(s,source);assert.equal(v,value);calls.push('insert');return{ok:true};}}),draftRouter:{list(){throw Error('wrong router');},insert(){throw Error('wrong router');}},browserViews:{action(){throw Error('wrong browser');}}});
 assert.equal((await handlers['development:draft-targets']({})).ok,true);assert.equal((await handlers['development:draft-insert']({},value)).ok,true);assert.deepEqual(calls,['list','insert']);
});


test('次の操作の強調は初期・保存結果・入力変更・入力を戻した場合に一方だけへ切り替わる',()=>{
 const {api}=fixture();api.availability.value={available:false};assert.equal(api.nextNavigationAction.value,'');
 api.availability.value={available:true};assert.equal(api.nextNavigationAction.value,'navigate','未実行で有効な目標があればナビ');
 api.result.value={goal:'目標'};assert.equal(api.nextNavigationAction.value,'evaluate');
 api.goal.value='変更した目標';assert.equal(api.nextNavigationAction.value,'navigate');
 api.goal.value=' 目標 ';assert.equal(api.nextNavigationAction.value,'evaluate','既存のtrim比較と同じ扱い');
 for(const goal of ['', '   ', '\n\t']){api.goal.value=goal;assert.equal(api.nextNavigationAction.value,'');}
 api.goal.value='新しい目標';assert.equal(api.nextNavigationAction.value,'navigate');
});

for(const field of ['submitting','reconciling','savingModel','autopilot','history'])test(`${field}中はナビ・再評価のどちらも強調せず、解除後に戻す`,()=>{
 const {api}=fixture();api.result.value={goal:'目標'};assert.equal(api.nextNavigationAction.value,'evaluate');
 api[field].value=true;assert.equal(api.nextNavigationAction.value,'');api.goal.value='変更';assert.equal(api.nextNavigationAction.value,'');
 api[field].value=false;assert.equal(api.nextNavigationAction.value,'navigate');
});

test('実行環境の利用不可・toolsオフライン・ジョブ実行中は次の操作を強調しない',()=>{
 const {api}=fixture();api.result.value={goal:'目標'};
 api.toolsState.value={connected:false,mode:'offline'};api.availability.value={available:false};assert.equal(api.nextNavigationAction.value,'');
 api.toolsState.value={connected:true,mode:'online'};api.availability.value={available:true};api.job.value={status:'running'};assert.equal(api.nextNavigationAction.value,'');
 api.job.value={status:'complete'};assert.equal(api.nextNavigationAction.value,'evaluate');
});

test('履歴の選択中は強調せず、選択完了は再評価、新規作成はナビへ戻す',async()=>{
 const f=fixture();f.api.history.value=true;f.api.result.value={goal:'以前の目標'};assert.equal(f.api.nextNavigationAction.value,'');
 const selected=f.api.selectHistory('saved');assert.equal(f.api.nextNavigationAction.value,'');
 await f.answer({...state(null),result:{schemaVersion:3,goal:'保存済みの目標',items:[],overall:{progress:100},nextItemId:null,nextPrompt:''}});await selected;
 assert.equal(f.api.goal.value,'保存済みの目標');assert.equal(f.api.nextNavigationAction.value,'evaluate');
 const fresh=f.api.selectHistory();assert.equal(f.api.nextNavigationAction.value,'');await f.answer(state(null));await fresh;
 assert.equal(f.api.nextNavigationAction.value,'navigate');
});

const evaluatedResult=(goal='最終実行時の目標',progress=25)=>({schemaVersion:3,goal,navigationId:'saved-navigation',requestId:'previous',items:[{id:'work',name:'保存済みの作業',progress,reason:'保存済みの説明',weight:100,weightReason:'保存済みの配分'}],overall:{progress,reason:'前回の根拠'},nextItemId:progress<100?'work':null,nextPrompt:progress<100?'次の作業を確認してください。':''});

test('未実行・初回失敗では目標を変更しても再評価せず、ナビだけを案内する',async()=>{
 const f=fixture();f.api.job.value={status:'failed'};
 for(const goal of ['目標','変更した目標','','   ']){
  f.api.goal.value=goal;assert.equal(f.api.canEvaluate.value,false);
  await f.api.navigate('evaluate');assert.equal(f.api.goal.value,goal);
 }
 assert.deepEqual(f.calls,[]);
});

for(const draft of ['新しいテーマ','',' \n\t '])test('編集済み目標を復元し保存済みナビだけを再評価する: '+JSON.stringify(draft),async()=>{
 const f=fixture(),saved=evaluatedResult();f.api.result.value=saved;f.api.goal.value=draft;f.api.editGoal();
 assert.equal(f.api.canEvaluate.value,true);assert.equal(f.api.nextNavigationAction.value,draft.trim()?'navigate':'');
 const run=f.api.navigate('evaluate');
 assert.equal(f.api.goal.value,saved.goal);assert.deepEqual(JSON.parse(f.requests[0].body),{goal:saved.goal,action:'evaluate',clientRequestId:JSON.parse(f.requests[0].body).clientRequestId});assert.match(JSON.parse(f.requests[0].body).clientRequestId,/^navi-1-/);
 assert.deepEqual(f.api.result.value,saved,'送信開始では既存の明細を変更しない');assert.equal(f.api.canEvaluate.value,false);
 await f.api.navigate('evaluate');assert.equal(f.calls.filter(method=>method==='POST').length,1,'連打は重複送信しない');
 await f.answer({job:{id:'reevaluation',status:'running'}});await run;
 const updated={...evaluatedResult(saved.goal,60),requestId:'reevaluation'};
 await f.answer({...state({id:'reevaluation',status:'complete'}),result:updated});
 assert.equal(f.api.goal.value,saved.goal);assert.equal(f.api.result.value.items[0].progress,60);
 assert.equal(f.api.canEvaluate.value,true);assert.equal(f.api.nextNavigationAction.value,'evaluate');
});

for(const outcome of ['failed','invalid'])test('再評価の'+outcome+'応答は既存明細を保ち復元目標を維持する',async()=>{
 const f=fixture(),saved=evaluatedResult();f.api.result.value=saved;f.api.goal.value='誤って変更した目標';
 const run=f.api.navigate('evaluate');await f.answer({job:{id:'reevaluation',status:'running'}});await run;
 const invalid={...saved,items:[{...saved.items[0],progress:null}]};
 await f.answer({...state({id:'reevaluation',status:outcome==='failed'?'failed':'complete',message:'結果を確認できません。'}),result:outcome==='failed'?saved:invalid});
 assert.deepEqual(f.api.result.value,saved);assert.equal(f.api.goal.value,saved.goal);assert.equal(f.api.canEvaluate.value,true);
 if(outcome==='invalid')assert.match(f.api.error.value,/数値評価/);
});

test('再評価の開始応答喪失中は復元目標と前回結果を保持し確認完了まで再送しない',async()=>{
 const f=fixture(),saved=evaluatedResult();f.api.result.value=saved;f.api.goal.value='誤入力';
 const run=f.api.navigate('evaluate');f.pending.shift().reject(Error('response lost'));await run;
 assert.equal(f.api.goal.value,saved.goal);assert.deepEqual(f.api.result.value,saved);assert.equal(f.api.canEvaluate.value,false);
 await f.api.navigate('evaluate');assert.equal(f.calls.filter(method=>method==='POST').length,1);
 await f.answer({...state(null),result:saved});assert.equal(f.api.canEvaluate.value,true);assert.equal(f.api.nextNavigationAction.value,'evaluate');
});

test('再評価を押した後の新たな編集は完了時に上書きしない',async()=>{
 const f=fixture(),saved=evaluatedResult();f.api.result.value=saved;f.api.goal.value='押下前の編集';
 const run=f.api.navigate('evaluate');assert.equal(f.api.goal.value,saved.goal);
 f.api.goal.value='押下後に入力した新テーマ';f.api.editGoal();
 await f.answer({job:{id:'reevaluation',status:'running'}});await run;
 await f.answer({...state({id:'reevaluation',status:'complete'}),result:{...evaluatedResult(saved.goal,60),requestId:'reevaluation'}});
 assert.equal(f.api.goal.value,'押下後に入力した新テーマ');assert.equal(f.api.result.value.goal,saved.goal);
 assert.equal(f.api.canEvaluate.value,true);assert.equal(f.api.nextNavigationAction.value,'navigate');
});

test('履歴選択後の再評価はその履歴の目標へ戻し、新規作成後は再評価できない',async()=>{
 const f=fixture(),saved=evaluatedResult('選択した履歴の目標');
 f.api.result.value=evaluatedResult('直前の別ナビ');
 const select=f.api.selectHistory('history');await f.answer({...state(null),result:saved});await select;
 f.api.goal.value='誤入力';const run=f.api.navigate('evaluate');
 assert.equal(f.api.goal.value,saved.goal);assert.deepEqual(JSON.parse(f.requests.at(-1).body),{goal:saved.goal,action:'evaluate',clientRequestId:JSON.parse(f.requests.at(-1).body).clientRequestId});assert.match(JSON.parse(f.requests.at(-1).body).clientRequestId,/^navi-1-/);
 await f.answer({job:{id:'reevaluation',status:'running'}});await run;await f.answer({...state({id:'reevaluation',status:'failed'}),result:saved});
 const fresh=f.api.selectHistory();await f.answer(state(null));await fresh;
 assert.equal(f.api.canEvaluate.value,false);assert.equal(f.api.nextNavigationAction.value,'navigate');
 const count=f.calls.length;await f.api.navigate('evaluate');assert.equal(f.calls.length,count);
});

test('利用不可・実行中・自動航行中の再評価では編集を勝手に戻さない',async()=>{
 for(const blocked of ['unavailable','running','autopilot']){
  const f=fixture();f.api.result.value=evaluatedResult();f.api.goal.value='編集中';
  if(blocked==='unavailable')f.api.availability.value={available:false};
  if(blocked==='running')f.api.job.value={status:'running'};
  if(blocked==='autopilot')f.api.autopilot.value=true;
  await f.api.navigate('evaluate');assert.equal(f.api.goal.value,'編集中');assert.deepEqual(f.calls,[]);
 }
});

test('保存済みの推測目標に前後空白があっても再評価では原文を復元し再評価側を強調する',async()=>{
 const f=fixture(),saved={...evaluatedResult(' \n仮の目標\t '),inferred:true};f.api.result.value=saved;f.api.goal.value='別のテーマ';
 const run=f.api.navigate('evaluate');assert.equal(f.api.goal.value,saved.goal);assert.equal(JSON.parse(f.requests[0].body).goal,saved.goal);
 await f.answer({job:{id:'reevaluation',status:'running'}});await run;await f.answer({...state({id:'reevaluation',status:'complete'}),result:saved});
 assert.equal(f.api.goal.value,saved.goal);assert.equal(f.api.canEvaluate.value,true);assert.equal(f.api.nextNavigationAction.value,'evaluate');
 f.api.goal.value='仮の目標';assert.equal(f.api.nextNavigationAction.value,'evaluate','入力と保存目標は双方の前後空白だけを除いて比較する');
});
