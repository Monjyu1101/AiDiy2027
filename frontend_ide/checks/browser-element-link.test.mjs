// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFileSync} from 'node:fs';
import {createBrowserElementLink} from '../デスクトップ/ブラウザ要素連携.cjs';
import {browserElementText} from '../デスクトップ/ブラウザ要素情報.cjs';
const value={tag:'button',selector:'#save',attributes:{id:'save'},rect:{x:10,y:20,width:80,height:30},html:'<button id="save">保存</button>',css:{color:'rgb(0, 0, 0)'},text:'保存',url:'https://example.test/page',notice:'表示中DOM。入力値は除外。'};
const flush=async()=>{for(let n=0;n<70;n++)await Promise.resolve();};
function fixture(){
 let attached=false,url='https://example.test/page',available=true,picked=0,shown=0,closed=0,inspectMode='none',highlighted=false,documentRequested=false,panelOptions;
 const calls=[],updates=[],errors=[],pending=[];
 const debug=Object.assign(new EventEmitter(),{isAttached:()=>attached,attach(){attached=true;},sendCommand:async(method,params)=>{
  calls.push({method,params});
  if(method==='DOM.getDocument'){if(f.failDocument)throw Error('fixture document failure');if(f.holdDocument)await new Promise(resolve=>pending.push(resolve));documentRequested=true;return {root:{nodeId:1}};}
  if(method==='Overlay.setInspectMode'&&f.failStop&&params.mode==='none')throw Error('fixture cleanup failure');
  // Chromiumと同じく、noneでもhighlightConfigが無い要求は失敗させる。
  if(method==='Overlay.setInspectMode'){if(!params.highlightConfig)throw Error('Internal error: highlight configuration parameter is missing');if(params.mode==='searchForNode'&&documentRequested&&f.hoverOnInspect)debug.emit('message',{},'Overlay.nodeHighlightRequested',{nodeId:f.hoverOnInspect});if(f.holdInspect)await new Promise(resolve=>pending.push(resolve));inspectMode=params.mode;highlighted=inspectMode!=='none';}
  if(method==='Overlay.hideHighlight')highlighted=false;
  if(method==='Page.getFrameTree')return {frameTree:{frame:{id:'frame'}}};
  if(method==='Page.createIsolatedWorld')return {executionContextId:9};
  if(method==='DOM.resolveNode')return {object:{objectId:String(params.nodeId||params.backendNodeId)}};
  if(method==='Runtime.callFunctionOn'){if(f.hold)return new Promise(resolve=>pending.push(resolve));return {result:{value:f.values[params.objectId]||value}};}
  return {};
 }});
 const contents=Object.assign(new EventEmitter(),{debugger:debug,isDestroyed:()=>false,getURL:()=>url,focus(){}}),window=Object.assign(new EventEmitter(),{isDestroyed:()=>false,webContents:new EventEmitter()});
 const picker=createBrowserElementLink({contents,record:{window},available:()=>available,onChange(){},onSelected(){picked++;},onError:error=>errors.push(error),panelFactory:options=>{panelOptions=options;return{open(){shown++;},close(){closed++;},update:value=>updates.push(value)};}});
 const f={picker,debug,contents,window,calls,updates,errors,pending,hold:false,values:{},hover(nodeId){if(documentRequested&&inspectMode==='searchForNode')debug.emit('message',{},'Overlay.nodeHighlightRequested',{nodeId});},get inspectMode(){return inspectMode;},get highlighted(){return highlighted;},get panelOptions(){return panelOptions;},get picked(){return picked;},get shown(){return shown;},get closed(){return closed;},disconnect(){available=false;return picker.stop();},navigate(target=url){documentRequested=false;url=target;contents.emit('did-start-navigation',{},url,false,true);},message(method,params){debug.emit('message',{},method,params);}};return f;
}
test('要素連携: ホバー、クリックの確定、main保持内容の下書き、解除と再選択',async()=>{
 const f=fixture();await f.picker.start();assert.equal(f.picker.active,true);assert.equal(f.shown,1);
 f.message('Overlay.nodeHighlightRequested',{nodeId:1});await flush();assert.equal(f.updates.length,1);
 f.message('Overlay.inspectNodeRequested',{backendNodeId:2});await flush();assert.equal(f.picked,1);assert.equal(f.picker.active,false);assert.equal(f.closed,1);
 const draft=f.picker.request('/project',{session:'aidiy_ide 1',tabId:'tab'});assert.equal(draft.selection,true);assert.ok(draft.browserElementId);assert.match(draft.text,/^session: aidiy_ide 1\ntab_id: tab\n【選択した画面要素】/);assert.match(draft.text,/<button/);
 assert.throws(()=>f.picker.request('/project',{session:'s',tabId:'t'},'偽のID'));
 await f.picker.stop();assert.throws(()=>f.picker.request('/project',{session:'s',tabId:'t'}));
 await f.picker.start();await f.picker.start();assert.equal(f.picker.active,false);assert.equal(f.shown,2);
 assert.ok(!f.calls.some(c=>/disable|detach/i.test(c.method)),'共有CDPは切断しない');f.picker.dispose();
 assert.equal(f.debug.listenerCount('message'),0);assert.equal(f.contents.listenerCount('before-input-event'),0);
});
test('要素連携: Esc、同じURLへの再読込、切断、終了で待機中の古い結果を破棄',async()=>{
 for(const cancel of [f=>f.picker.key({preventDefault(){}},{type:'keyDown',key:'Escape'}),f=>f.navigate(),f=>f.disconnect(),f=>f.picker.dispose(),f=>f.window.emit('minimize')]){
  const f=fixture();await f.picker.start();f.hold=true;f.message('Overlay.inspectNodeRequested',{backendNodeId:1});await flush();assert.equal(f.pending.length,1);cancel(f);f.pending[0]({result:{value}});await flush();assert.equal(f.picked,0);assert.equal(f.picker.active,false);assert.throws(()=>f.picker.request('/project',{session:'s',tabId:'t'}));f.picker.dispose();
 }
});
test('要素連携: 連続ホバーは並列収集せず最新要素だけ表示し、古い結果で選択を上書きしない',async()=>{
 const f=fixture();await f.picker.start();f.hold=true;f.message('Overlay.nodeHighlightRequested',{nodeId:1});await flush();f.message('Overlay.nodeHighlightRequested',{nodeId:2});f.message('Overlay.nodeHighlightRequested',{nodeId:3});assert.equal(f.pending.length,1);
 f.pending[0]({result:{value:{...value,selector:'#old'}}});await flush();assert.equal(f.updates.length,0);assert.equal(f.pending.length,2);f.pending[1]({result:{value:{...value,selector:'#latest'}}});await flush();assert.equal(f.updates[0].selector,'#latest');
 f.message('Overlay.inspectNodeRequested',{backendNodeId:4});f.message('Overlay.inspectNodeRequested',{backendNodeId:4});await flush();assert.equal(f.pending.length,3);f.pending[2]({result:{value}});await flush();assert.equal(f.picked,1);f.navigate();assert.throws(()=>f.picker.request('/project',{session:'s',tabId:'t'}));f.picker.dispose();
});
test('要素連携: 標準ボタンの順序、限定IPC、既存の通常下書きを維持',()=>{
 const vue=readFileSync(new URL('../src/components/ブラウザ/ブラウザパネル.vue',import.meta.url),'utf8'),desktop=readFileSync(new URL('../desktop.cjs',import.meta.url),'utf8');
 const order=['browser-analysis','browser-capture','browser-handoff','browser-element-link'].map(name=>vue.indexOf('class="'+name+'"'));assert.ok(order.every((at,index)=>at>=0&&(!index||at>order[index-1])));
 assert.match(vue,/要素連携/);assert.match(vue,/onBrowserElementSelected/);assert.match(vue,/browserAction\('open-draft',element===true\)/);assert.match(desktop,/elementId===undefined\?'draft':'element-draft'/);assert.match(desktop,/text:draft.request.text/);
 assert.match(browserElementText(value),/HTML:\n<button/);
});

for(const focus of ['page','host','cdp'])test(`要素連携: ${focus}からのEscでCDP選択・強調を解除し再開始できる`,async()=>{
 const f=fixture();
 for(let cycle=0;cycle<2;cycle++){
  await f.picker.start();assert.equal(f.inspectMode,'searchForNode');
  const event={prevented:false,preventDefault(){this.prevented=true;}},input={type:'keyDown',key:'Escape'};
  if(focus==='cdp')f.message('Overlay.inspectModeCanceled',{});
  else (focus==='page'?f.contents:f.window.webContents).emit('before-input-event',event,input);
  await flush();assert.equal(f.picker.active,false);assert.equal(f.inspectMode,'none','UIだけでなくCDPの選択モードも解除する');assert.equal(f.highlighted,false);assert.equal(f.closed,cycle+1);assert.equal(event.prevented,focus!=='cdp');
  f.message('Overlay.nodeHighlightRequested',{nodeId:1});f.message('Overlay.inspectNodeRequested',{backendNodeId:1});await flush();assert.equal(f.updates.length,0);assert.equal(f.picked,0);
 }
 assert.deepEqual(f.errors,[]);f.picker.dispose();
});
test('要素連携: 開始コマンド待機中のEscと直後の再開始は解除を追い越さない',async()=>{
 const f=fixture();f.holdInspect=true;const starting=f.picker.start();await flush();assert.equal(f.pending.length,1);
 f.picker.key({preventDefault(){}},{type:'keyDown',key:'Escape'});f.holdInspect=false;const restarting=f.picker.start();f.pending.shift()();await starting;await restarting;
 assert.deepEqual(f.calls.filter(c=>c.method==='Overlay.setInspectMode').map(c=>c.params.mode),['searchForNode','none','searchForNode']);assert.equal(f.inspectMode,'searchForNode');
 await f.picker.stop();assert.equal(f.inspectMode,'none');assert.equal(f.highlighted,false);f.picker.dispose();
});
test('要素連携: 解除のCDP失敗を握り潰さず利用者へ通知する',async()=>{
 const f=fixture();await f.picker.start();f.failStop=true;await f.picker.stop();assert.match(f.errors.at(-1),/要素連携を解除できませんでした/);f.picker.dispose();
});

test('要素連携: 新規CDP接続でdocumentを登録してから検査し、移動先の要素情報を次々と更新する',async()=>{
 const f=fixture();
 f.values[11]={...value,selector:'#first',html:'<button id="first">一つ目</button>',rect:{x:40,y:60,width:120,height:30}};
 f.values[12]={...value,selector:'#second',html:'<button id="second">二つ目</button>',rect:{x:500,y:300,width:80,height:40}};
 try{
  await f.picker.start();
  const methods=f.calls.map(call=>call.method);
  assert.ok(methods.indexOf('DOM.enable')<methods.indexOf('DOM.getDocument'));
  assert.ok(methods.indexOf('DOM.getDocument')<methods.indexOf('Overlay.setInspectMode'));
  assert.deepEqual(f.calls.find(call=>call.method==='DOM.getDocument').params,{depth:0},'全文DOMではなくrootだけ登録する');
  f.hover(11);await flush();f.hover(12);await flush();f.hover(11);await flush();
  assert.deepEqual(f.updates.map(item=>item.selector),['#first','#second','#first']);
  assert.deepEqual(f.updates[1].rect,f.values[12].rect);assert.equal(f.updates[1].html,f.values[12].html);
  f.navigate();await flush();await f.picker.start();f.hover(12);await flush();
  assert.equal(f.calls.filter(call=>call.method==='DOM.getDocument').length,2,'遷移後もdocumentを再登録する');
  assert.equal(f.updates.at(-1).selector,'#second');
 }finally{f.picker.dispose();}
});
test('要素連携: 開始応答より先に届く最初のホバーを取りこぼさない',async()=>{
 const f=fixture();f.hoverOnInspect=11;f.holdInspect=true;
 try{
  const opening=f.picker.start();await flush();
  assert.equal(f.pending.length,1);assert.equal(f.updates.length,1,'開始応答を待たず最初の要素を表示する');
  f.holdInspect=false;f.pending.shift()();await opening;
  assert.equal(f.picker.active,true);
 }finally{f.picker.dispose();}
});
test('要素連携: document登録中の取消や登録失敗で固定の説明枠を残さない',async()=>{
 const f=fixture();f.holdDocument=true;
 const opening=f.picker.start();await flush();assert.equal(f.pending.length,1);
 await f.picker.stop();f.pending.shift()();await opening;
 assert.equal(f.picker.active,false);assert.equal(f.shown,0);
 assert.ok(!f.calls.some(call=>call.method==='Overlay.setInspectMode'&&call.params.mode==='searchForNode'));
 f.picker.dispose();
 const failed=fixture();failed.failDocument=true;
 await assert.rejects(failed.picker.start(),/fixture document failure/);
 assert.equal(failed.picker.active,false);assert.equal(failed.shown,0);failed.picker.dispose();
});
