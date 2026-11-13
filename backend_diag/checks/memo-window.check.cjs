// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// See LICENSE for full terms.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {createServer}=require('node:http');
const {メモ窓を作成,付箋範囲,メモ一覧を読む}=require('../memo/ウィンドウ.cjs');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const sources=[{id:'launch:1',名前:'起動'},{id:'project:2',名前:'プロジェクト'}];
const note={id:'a.memo.json',保存先:'project:2',本文:'既存',色:'blue'};
function fixture(snapshot={保存先:sources,メモ:[]},systemSnapshot={保存先:[sources[0]],メモ:[]}){
 const windows=[],handlers={},dialogs=[];let response=1;
 class Window extends EventEmitter{
  constructor(options){super();this.options=options;this.bounds={x:options.x,y:options.y,width:options.width,height:options.height};this.contents=new EventEmitter();this.contents.mainFrame={};this.contents.isDestroyed=()=>this.isDestroyed();this.sent=[];this.contents.send=(...args)=>{this.sent.push(args);};this.contents.setWindowOpenHandler=fn=>this.openHandler=fn;windows.push(this);}
  get webContents(){if(this.destroyed)throw Error('destroyed getter');return this.contents;}
  getBounds(){return {...this.bounds};} isDestroyed(){return !!this.destroyed;}isFocused(){return true;}isAlwaysOnTop(){return this.top;}
  setAlwaysOnTop(value){this.top=value;}setMenuBarVisibility(){}show(){this.emit('show');}focus(){}async loadURL(value){this.url=value;}
  destroy(){this.destroyed=true;this.emit('closed');}
  close(){const event={preventDefault(){this.prevented=true;}};this.emit('close',event);if(!event.prevented)this.destroy();}
 }
 const screen={getPrimaryDisplay:()=>({workArea:{x:0,y:0,width:1920,height:1080}}),getDisplayMatching:b=>({workArea:b.x<0?{x:-1280,y:-100,width:1280,height:720}:{x:0,y:0,width:1920,height:1080}})};
 const control=メモ窓を作成({BrowserWindow:Window,ipcMain:{handle:(name,handler)=>handlers[name]=handler},dialog:{showMessageBox:async(...args)=>{dialogs.push(args.at(-1));return{response};}},screen,session:{},url:new URL('http://127.0.0.1:1234/proxy/9000/#token='+'x'.repeat(43)),readSnapshot:async()=>snapshot,readSystemSnapshot:async()=>systemSnapshot});
 const invoke=(w,action,value)=>handlers['diag:memo-window']({sender:w.contents,senderFrame:w.contents.mainFrame},action,value);
 return{control,windows,handlers,dialogs,invoke,screen,setResponse:value=>{response=value;}};
}
test('empty startup creates no container; + creates blank project note without file operations',async()=>{
 const f=fixture();await f.control.open();assert.equal(f.windows.length,0);assert.equal(await f.control.open('true'),false);
 await f.control.open(true);const w=f.windows[0],state=f.invoke(w,'getInitialState');assert.equal(state.note,null);assert.equal(state.sourceId,'project:2');assert.equal(w.options.frame,false);assert.equal(w.top,true);assert.equal(w.options.minHeight,140);assert.equal(w.options.webPreferences.sandbox,true);assert.equal(w.options.webPreferences.nodeIntegration,false);assert.match(w.url,/memo.html#token=/);assert.doesNotMatch(w.url,/既存|project/);assert.deepEqual(w.openHandler(),{action:'deny'});
});
test('saved notes have independent windows; startup reload never duplicates or resets an existing window',async()=>{
 const f=fixture({保存先:sources,メモ:[note,{...note,id:'b.memo.json'}]});await f.control.open();assert.equal(f.windows.length,2);const w=f.windows[0];assert.equal(f.invoke(w,'getInitialState').note.本文,'既存');await f.control.open();assert.equal(f.windows.length,2);await f.control.open(true);assert.equal(f.windows.length,3);assert.equal(w.isDestroyed(),false);
 assert.equal(f.handlers['diag:memo-window']({sender:w.contents,senderFrame:{}},'close'),false);
});
test('new saved identity is retained for dedup',async()=>{
 const snapshot={保存先:sources,メモ:[]},f=fixture(snapshot);await f.control.open(true);assert.equal(f.invoke(f.windows[0],'setNoteIdentity',{id:note.id,sourceId:note.保存先}),true);snapshot.メモ.push(note);await f.control.open();assert.equal(f.windows.length,1);assert.equal(f.invoke(f.windows[0],'setNoteIdentity',{id:'../bad',sourceId:note.保存先}),false);
});
test('close waits for flush; failure defaults to preserving note and Diag; explicit discard closes',async()=>{
 const f=fixture({保存先:sources,メモ:[note]});await f.control.open();const w=f.windows[0];f.invoke(w,'getInitialState');
 const pending=f.control.closeForParent();await flush();const request=w.sent.find(args=>args[0]==='memo:close-requested')[1];assert.equal(w.isDestroyed(),false);assert.equal(f.invoke(w,'completeClose',{requestId:'wrong',ok:true}),false);
 f.invoke(w,'completeClose',{...request,ok:false});assert.equal(await pending,false);assert.equal(w.isDestroyed(),false);assert.equal(f.dialogs[0].defaultId,1);
 f.setResponse(0);const retry=f.control.closeForParent();await flush();const next=w.sent.at(-1)[1];f.invoke(w,'completeClose',{...next,ok:false});assert.equal(await retry,true);assert.equal(w.isDestroyed(),true);
});
test('successful flush closes cleanly without reading destroyed webContents',async()=>{
 const f=fixture();await f.control.open(true);const w=f.windows[0];f.invoke(w,'getInitialState');w.close();const request=w.sent.at(-1)[1];assert.equal(w.isDestroyed(),false);f.invoke(w,'completeClose',{...request,ok:true});assert.equal(w.isDestroyed(),true);assert.equal(await f.control.closeForParent(),true);
});
test('negative monitor coordinates preserved; offscreen and oversized bounds clamped',()=>{
 const {screen}=fixture();assert.deepEqual(付箋範囲({位置:{x:-1000,y:-50},サイズ:{width:300,height:200}},screen),{x:-1000,y:-50,width:300,height:200});assert.deepEqual(付箋範囲({位置:{x:8000,y:5000},サイズ:{width:1400,height:1900}},screen),{x:720,y:0,width:1200,height:1080});
});
test('startup HTTP uses fixed authenticated endpoint and refuses redirects',async t=>{
 let redirect=false;const server=createServer((req,res)=>{assert.equal(req.url,'/proxy/api/'+encodeURIComponent('メモ'));assert.equal(req.headers.authorization,'Bearer '+ 'x'.repeat(43));if(redirect){res.writeHead(302,{Location:'https://invalid.invalid'});res.end();}else res.end(JSON.stringify({保存先:[],メモ:[]}));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));const url=`http://127.0.0.1:${server.address().port}/proxy/#token=${'x'.repeat(43)}`;assert.deepEqual(await メモ一覧を読む(url),{保存先:[],メモ:[]});redirect=true;await assert.rejects(()=>メモ一覧を読む(url));assert.throws(()=>メモ一覧を読む('https://invalid.invalid/#token=x'));
});
test('blur and close flush latest native bounds before renderer save; parent close rejects new windows',async()=>{
 const f=fixture();await f.control.open(true);const w=f.windows[0];f.invoke(w,'getInitialState');
 w.bounds={x:-100,y:100,width:250,height:150};w.emit('resize');w.emit('blur');assert.deepEqual(w.sent.slice(-2),[['memo:bounds',w.bounds],['memo:blur',{bounds:w.bounds}]]);
 w.bounds={x:-200,y:200,width:260,height:160};w.emit('move');const closing=f.control.closeForParent();assert.equal(await f.control.open(true),false);await flush();assert.deepEqual(w.sent.at(-2),['memo:bounds',w.bounds]);const request=w.sent.at(-1)[1];f.invoke(w,'completeClose',{...request,ok:true});assert.equal(await closing,true);assert.equal(f.windows.length,1);
});
test('new and existing saved snapshots survive renderer reload; invalid updates never replace them',async()=>{
 const complete={...note,タイトル:'保存済',本文:'保存後の本文',形式:'memo',revision:'a'.repeat(64),位置:{x:-200,y:30},サイズ:{width:250,height:150}};
 for(const existing of [false,true]){
  const f=fixture({保存先:sources,メモ:existing?[{...complete,本文:'起動時'}]:[]});await f.control.open(!existing);const w=f.windows[0];
  assert.equal(f.invoke(w,'updateSavedNote',complete),true);complete.本文='入力は別のコピー';const state=f.invoke(w,'getInitialState');assert.notEqual(state.note.本文,complete.本文);complete.本文='保存後の本文';
  assert.equal(state.note.id,note.id);assert.equal(state.note.revision,'a'.repeat(64));assert.equal(state.sourceId,'project:2');
  for(const invalid of [{...complete,保存先:'launch:1'},{...complete,id:'other.memo.json'},{...complete,revision:'invalid'},{...complete,本文:'x'.repeat(1024*1024)},{...complete,位置:{x:Infinity,y:0}},{...complete,サイズ:{width:1,height:2}},{...complete,extra:'not allowed'},null])assert.equal(f.invoke(w,'updateSavedNote',invalid),false);
  assert.equal(f.invoke(w,'getInitialState').note.本文,'保存後の本文');
 }
});

test('standalone uses only system snapshot, creates blank when empty, and canonical dedup avoids same-root alias',async()=>{
 const f=fixture({保存先:sources,メモ:[note]});await f.control.openSystem();assert.equal(f.windows.length,1);const state=f.invoke(f.windows[0],'getInitialState');assert.equal(state.scope,'system');assert.equal(state.sourceId,'launch:1');assert.equal(state.note,null);assert.match(f.windows[0].url,/scope=system/);await f.control.openSystem();assert.equal(f.windows.length,1);await f.control.openSystem(true);assert.equal(f.windows.length,2);
 const normal={...note,保存先:'project:shared'},system={...note,保存先:'launch:shared'};
 const g=fixture({保存先:[{id:'project:shared'}],メモ:[normal]},{保存先:[{id:'launch:shared'}],メモ:[system]});await g.control.open();await g.control.openSystem();assert.equal(g.windows.length,1);assert.equal(g.invoke(g.windows[0],'getInitialState').scope,'normal');
});
