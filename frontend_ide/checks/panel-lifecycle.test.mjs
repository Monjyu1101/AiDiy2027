// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {createPanelWindow} from '../src/components/ファイル閲覧/パネル別窓.js';
const flush=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
function fixture(t,options={}){
 const intervals=new Map();let seq=0,opens=0,closed=0,recovered=0,block=false;
 t.mock.method(globalThis,'setInterval',fn=>{intervals.set(++seq,fn);return seq;});
 t.mock.method(globalThis,'clearInterval',id=>intervals.delete(id));
 class Node{
  constructor(doc,tag='DIV'){this.ownerDocument=doc;this.tagName=tag;this.children=[];this.style={};this.classList={add(){}};this.scrollTop=0;this.scrollLeft=0;}
  adopt(doc){this.ownerDocument=doc;for(const node of this.children)node.adopt(doc);}
  append(node){this.insertBefore(node,null);}
  insertBefore(node,anchor){node.remove();const at=this.children.indexOf(anchor);this.children.splice(at<0?this.children.length:at,0,node);node.parentNode=this;node.adopt(this.ownerDocument);}
  remove(){if(this.parentNode){this.parentNode.children.splice(this.parentNode.children.indexOf(this),1);this.parentNode=null;}}
  replaceChildren(...nodes){for(const child of [...this.children])child.remove();for(const node of nodes)this.append(node);}
  querySelectorAll(){return this.children.flatMap(node=>[node,...node.querySelectorAll()]);}
  getBoundingClientRect(){return{left:10,top:30,width:400,height:600};}
  setAttribute(){}async decode(){}
 }
 const doc=()=>{const d={baseURI:'http://localhost/',querySelectorAll:()=>[],createElement:tag=>new Node(d,tag.toUpperCase()),createComment:()=>new Node(d,'COMMENT')};d.head=new Node(d);d.body=new Node(d);d.documentElement=new Node(d);return d;};
 const win=new EventTarget();Object.assign(win,{document:doc(),screen:{availLeft:0,availTop:0,availWidth:1920,availHeight:1080},screenX:0,screenY:0,outerWidth:1280,innerWidth:1280,outerHeight:800,innerHeight:800,crypto:{randomUUID:()=>String(++seq)},matchMedia:()=>({matches:true})});
 let child;win.open=(_url,name)=>{opens++;if(block)return null;child=new EventTarget();Object.assign(child,{document:doc(),name,closed:false,focus(){},close(){this.dispatchEvent(new Event('beforeunload'));this.closed=true;}});return child;};
 const node=new Node(win.document),input=new Node(win.document);node.append(input);win.document.body.append(node);input.scrollTop=123;
 const changes=[],errors=[];const manager=createPanelWindow({element:()=>node,win,changed:value=>changes.push(value),report:value=>errors.push(value),closed:()=>closed++,recovered:()=>recovered++,...options});
 t.after(()=>manager.close());
 return{manager,win,node,input,changes,errors,intervals,get child(){return child;},get opens(){return opens;},get closed(){return closed;},get recovered(){return recovered;},block:value=>{block=value;},poll:async()=>{for(const fn of [...intervals.values()])fn();await flush();},reload:()=>{child.dispatchEvent(new Event('beforeunload'));child.document=doc();}};
}
test('別パネル: 連打は1窓、reloadは同じDOM/scroll、Xだけclose通知・参照解放',async t=>{
 const f=fixture(t);await Promise.all([f.manager.pin(),f.manager.pin()]);assert.equal(f.opens,1);assert.equal(f.intervals.size,1);
 assert.equal(f.node.ownerDocument,f.child.document);assert.equal(f.input.scrollTop,123);
 f.reload();assert.equal(f.node.ownerDocument,f.win.document);assert.equal(f.node.style.visibility,'hidden');
 await f.poll();assert.equal(f.node.ownerDocument,f.child.document);assert.equal(f.input.scrollTop,123);assert.equal(f.closed,0);
 f.child.close();await f.poll();assert.equal(f.closed,1);assert.equal(f.intervals.size,0);assert.equal(f.node.ownerDocument,f.win.document);
 assert.deepEqual(f.changes,[true,false]);await f.manager.pin();assert.equal(f.opens,2);assert.equal(f.intervals.size,1);
 f.win.dispatchEvent(new Event('pagehide'));assert.equal(f.child.closed,true);assert.equal(f.closed,1);assert.equal(f.intervals.size,0);
});
test('別パネル: popup失敗とnative表示失敗はXと区別し本体を保持',async t=>{
 const f=fixture(t);f.block(true);assert.equal(await f.manager.pin(),false);assert.equal(f.closed,0);assert.equal(f.node.ownerDocument,f.win.document);assert.equal(f.intervals.size,0);
 f.block(false);f.win.aidiyWindow={prepareExplorer:async()=>({ok:true,name:'reserved'}),showExplorer:async()=>({ok:false,error:'表示失敗'})};
 assert.equal(await f.manager.pin(),false);assert.equal(f.child.closed,true);assert.equal(f.node.ownerDocument,f.win.document);assert.equal(f.node.style.visibility,'');assert.equal(f.closed,0);assert.equal(f.recovered,2);
 assert.equal(f.intervals.size,0);assert.match(f.errors.at(-1),/表示失敗/);
});
test('ピン留め: 元位置の画像を表示完了まで保持し、成功・失敗・親終了で片付ける',async t=>{
 for(const outcome of ['shown','failed','disposed']){
  const f=fixture(t);let finish;
  f.win.aidiyWindow={prepareExplorer:async()=>({ok:true,name:'reserved',preview:{src:'data:image/png;base64,fixture',rect:{left:10,top:30,width:400,height:600}}}),showExplorer:()=>new Promise(resolve=>{finish=resolve;})};
  const opening=f.manager.pin();await flush();
  const second=f.manager.pin();assert.equal(second,opening,'ALL移行は手動ピン留めの表示完了も待つ');
  const preview=f.win.document.body.children.find(node=>node.className==='panel-pin-preview');
  assert.ok(preview);assert.equal(preview.style.left,'10px');assert.equal(preview.style.width,'400px');assert.equal(f.node.ownerDocument,f.child.document);
  if(outcome==='disposed'){f.manager.close();assert.equal(preview.parentNode,null);}
  finish({ok:outcome==='shown',error:'表示失敗'});await opening;
  assert.equal(preview.parentNode,null);
  if(outcome==='failed')assert.equal(f.node.ownerDocument,f.win.document);
  f.manager.close();
 }
});

test('別パネル: 表示演出中に閉じた窓は終了し、表示失敗として復元しない',async t=>{
 const f=fixture(t);let finish;
 f.win.aidiyWindow={showExplorer:()=>new Promise(resolve=>{finish=resolve;})};
 const opening=f.manager.pin();await flush();f.child.close();finish({ok:false});await opening;
 assert.equal(f.closed,1);assert.equal(f.recovered,0);assert.deepEqual(f.errors,['']);assert.equal(f.intervals.size,0);
});

test('別パネル: 本体へ戻すは保持、閉じるは終了通知、破棄後に再起動しない',async t=>{
 const f=fixture(t);await f.manager.pin();f.manager.restore();assert.equal(f.closed,0);assert.equal(f.input.scrollTop,123);
 await f.manager.pin();f.manager.dismiss();assert.equal(f.closed,1);assert.equal(f.intervals.size,0);
 f.manager.close();await f.manager.pin();assert.equal(f.opens,2);
});

test('軌跡領域: native IPC結果・失敗を反映し、閉じた窓へ送信しない',async t=>{
 const f=fixture(t,{kind:'panel-routes'}),calls=[];
 f.win.aidiyWindow={resizeRoutes:async(name,height)=>{calls.push({name,height});return{ok:true,height:132};}};
 await f.manager.pin();assert.deepEqual(await f.manager.reserveRouteHeight(368),{ok:true,height:132});assert.equal(calls[0].name,f.child.name);
 f.win.aidiyWindow.resizeRoutes=async()=>({ok:false,error:'終了済み'});await assert.rejects(f.manager.reserveRouteHeight(368),/終了済み/);
 f.manager.close();assert.equal(await f.manager.reserveRouteHeight(368),null);assert.equal(f.intervals.size,0);
});
test('軌跡領域: Webのresize拒否では現窓の実高さを返し、待機中の破棄も無効化',async t=>{
 const f=fixture(t,{kind:'panel-routes'});await f.manager.pin();Object.assign(f.child,{screen:{availTop:0,availHeight:1080},screenY:900,outerWidth:360,outerHeight:168,innerHeight:100,resizeTo(){throw Error('browser denied');}});
 assert.deepEqual(await f.manager.reserveRouteHeight(368),{height:100});
 const waiting=f.manager.reserveRouteHeight(368);f.manager.close();assert.equal(await waiting,null);assert.equal(f.intervals.size,0);
});
