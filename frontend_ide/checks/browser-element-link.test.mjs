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
 let attached=false,url='https://example.test/page',available=true,picked=0,shown=0,closed=0;
 const calls=[],updates=[],errors=[],pending=[];
 const debug=Object.assign(new EventEmitter(),{isAttached:()=>attached,attach(){attached=true;},sendCommand:async(method,params)=>{
  calls.push({method,params});
  if(method==='Page.getFrameTree')return {frameTree:{frame:{id:'frame'}}};
  if(method==='Page.createIsolatedWorld')return {executionContextId:9};
  if(method==='DOM.resolveNode')return {object:{objectId:String(params.nodeId||params.backendNodeId)}};
  if(method==='Runtime.callFunctionOn'){if(f.hold)return new Promise(resolve=>pending.push(resolve));return {result:{value}};}
  return {};
 }});
 const contents=Object.assign(new EventEmitter(),{debugger:debug,isDestroyed:()=>false,getURL:()=>url,focus(){}}),window=Object.assign(new EventEmitter(),{isDestroyed:()=>false,webContents:new EventEmitter()});
 const picker=createBrowserElementLink({contents,record:{window},available:()=>available,onChange(){},onSelected(){picked++;},onError:error=>errors.push(error),panelFactory:()=>({open(){shown++;},close(){closed++;},update:value=>updates.push(value)})});
 const f={picker,debug,contents,window,calls,updates,errors,pending,hold:false,get picked(){return picked;},get shown(){return shown;},get closed(){return closed;},disconnect(){available=false;return picker.stop();},navigate(target=url){url=target;contents.emit('did-start-navigation',{},url,false,true);},message(method,params){debug.emit('message',{},method,params);}};return f;
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
 assert.ok(vue.indexOf('class="browser-element-link"')<vue.indexOf('class="browser-analysis"'));
 assert.match(vue,/要素連携/);assert.match(vue,/onBrowserElementSelected/);assert.match(vue,/element===true\?'element-draft':'draft'/);assert.match(desktop,/elementId===undefined\?'draft':'element-draft'/);assert.match(desktop,/text:draft.request.text/);
 assert.match(browserElementText(value),/HTML:\n<button/);
});
