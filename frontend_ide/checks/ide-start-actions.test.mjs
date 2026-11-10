// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const app=read('../src/App.vue'),welcome=read('../src/components/コンソール/開始表示.vue'),css=read('../src/style.css');

test('開始ボタンは3行案内のslotだけに置き、利用中は従来の終了を表示する',()=>{
 const heading=app.slice(app.indexOf('<div v-show="!allDisplayState.active"'),app.indexOf('<template v-if="allDisplayState.active">'));
 assert.doesNotMatch(heading,/start\('(connect|offline)'\)/);
 assert.match(heading,/<nav v-if="state.active"><button :disabled="pending" @click="start\('disconnect'\)"/);
 const startup=app.match(/<TerminalWelcome v-if="!state.active"[\s\S]+?<\/TerminalWelcome>/)?.[0];
 assert.ok(startup);assert.match(startup,/<template #actions>/);
 assert.match(startup,/role="group" aria-label="利用方法を選択" :aria-busy="pending" lang="ja"/);
 for(const [action,label] of [['connect','AiDiy接続利用'],['offline','オフライン利用']]){
  assert.ok(startup.includes(`<button type="button" :disabled="pending" @click="start('${action}')">${label}</button>`));
  assert.equal(app.split(`@click="start('${action}')"`).length-1,1);
 }
 assert.match(welcome,/<p class="welcome-caption">[^\n]+<\/p>\s*<slot name="actions" \/>/);
});
test('開始ボタンは大きな操作領域・狭幅の縦並び・低い画面のスクロールを持つ',()=>{
 assert.match(css,/\.ide-start-actions\{[^}]*gap:12px[^}]*margin-top:28px/);
 assert.match(css,/\.ide-start-actions button\{[^}]*min-height:52px[^}]*font-size:16px/);
 assert.match(css,/@media\(max-width:431px\)\{\.ide-start-actions\{flex-direction:column/);
 assert.match(css,/\.development-app\.ide>\.terminal-welcome\{[^}]*height:100%[^}]*overflow:auto[^}]*justify-content:safe center/);
 assert.match(css,/\.ide-start-actions button:focus-visible\{outline:2px/);
});
function menuFixture(mode='offline',active=true,connected=false){
 const context={ref:value=>({value}),desktop:false,window:{},cpuOpen:{value:false},runningApps:{value:[]},openCpu(){},computed:fn=>({get value(){return fn();}}),state:{value:{mode,active,connected}},launching:{value:''},liveOpen:{value:false},panelOpen:{value:false},tab:{value:'code'},openWindow(){},openPanel(){},openNavigation(){}};
 vm.runInNewContext(app.slice(app.indexOf('const browserAvailable='),app.indexOf("provide('browserAvailable'"))+app.slice(app.indexOf('const launchText='),app.indexOf('async function openWindow'))+';globalThis.desktopItems=desktopLaunchItems;globalThis.webItems=panelLaunchItems;globalThis.available=browserAvailable;',context);return context;
}
test('オフラインメニューはCPU・Console・Browser・CodeだけでBrowserは接続なしでも有効',()=>{
 for(const mode of ['offline','online']){
  const f=menuFixture(mode);
  const expected=mode==='offline'?['console','browser','code','cpu']:['console','browser','navigation','code','live','avatar','task','team','cpu'];
  assert.deepEqual(Array.from(f.desktopItems.value,x=>x.key),expected);
  if(mode==='offline')assert.deepEqual(Array.from(f.webItems.value,x=>x.key),expected);
  assert.equal(f.available.value,true);
  for(const items of [f.desktopItems,f.webItems])assert.equal(items.value.find(x=>x.key==='browser').disabled,false);
  f.launching.value='code';assert.equal(f.desktopItems.value.find(x=>x.key==='browser').disabled,true);
  f.state.value.active=false;assert.equal(f.available.value,false);
 }
 assert.match(app,/<button v-if="state.mode==='online'" class="navigation-launch"/);
});
function startFixture(desktop=false){
 let resolve;const calls=[],updates=[];let layoutRefreshes=0;
 const context={pending:{value:false},error:{value:''},statusError:{value:''},revision:0,desktop,refreshLayout:()=>{layoutRefreshes++;},window:{aidiyWindow:{endSession:async()=>calls.push('endSession')}},AbortSignal,update:state=>updates.push(state),fetch:(url,options)=>{calls.push({url,options});return new Promise(done=>{resolve=done;});}};
 vm.runInNewContext(app.slice(app.indexOf('async function start(action)'),app.indexOf('const navigationWindows='))+';globalThis.run=start;',context);
 return{context,calls,updates,get layoutRefreshes(){return layoutRefreshes;},respond:response=>resolve(response)};
}
test('開始連打は1回だけ送り、応答待ちは両ボタン無効、失敗後に再試行できる',async()=>{
 const f=startFixture();const pending=f.context.run('connect');
 assert.equal(f.context.pending.value,true);await f.context.run('offline');assert.equal(f.calls.length,1);
 f.respond({ok:false,text:async()=> '接続失敗'});await pending;
 assert.equal(f.context.pending.value,false);assert.equal(f.context.error.value,'接続失敗');assert.equal(f.updates.length,0);
 const retry=f.context.run('offline');f.respond({ok:true,json:async()=>({active:true,mode:'offline'})});await retry;
 assert.equal(f.calls.length,2);assert.equal(f.context.error.value,'');assert.equal(f.updates[0].mode,'offline');
});
test('終了時は子窓を終了して初期画面へ戻し、接続を再開できる',async()=>{
 const f=startFixture(true);const ending=f.context.run('disconnect');await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.calls[0],'endSession');assert.equal(f.updates[0].active,false);
 f.respond({ok:true,json:async()=>({active:false})});await ending;
 const restarting=f.context.run('connect');f.respond({ok:true,json:async()=>({active:true,mode:'online'})});await restarting;
 assert.equal(f.updates.at(-1).mode,'online');assert.equal(f.context.pending.value,false);
});

test('接続開始応答の直後に配置状態を取得し、Load表示を定期確認まで待たせない',async()=>{
 const f=startFixture(true);const starting=f.context.run('connect');
 assert.equal(f.layoutRefreshes,0);
 f.respond({ok:true,json:async()=>({active:true,mode:'online'})});await starting;
 assert.equal(f.context.pending.value,false);assert.equal(f.layoutRefreshes,1);
});
