// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// See LICENSE for full terms.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {createServer}=require('node:http');
const {メモ窓を作成,付箋範囲,追加付箋範囲,メモ一覧を読む}=require('../memo/ウィンドウ.cjs');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const sources=[{id:'launch:1',名前:'起動'},{id:'project:2',名前:'プロジェクト'}];
const note={id:'a.memo.json',保存先:'project:2',本文:'既存',色:'blue'};
function fixture(snapshot={保存先:sources,メモ:[]},systemSnapshot={保存先:[sources[0]],メモ:[]},options={}){
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
 const control=メモ窓を作成({BrowserWindow:Window,ipcMain:{handle:(name,handler)=>handlers[name]=handler},dialog:{showMessageBox:async(...args)=>{dialogs.push(args.at(-1));return{response};}},screen,session:{},url:new URL('http://127.0.0.1:1234/proxy/9000/#token='+'x'.repeat(43)),readSnapshot:async()=>snapshot,readSystemSnapshot:async()=>systemSnapshot,...options});
 const invoke=(w,action,value)=>handlers['diag:memo-window']({sender:w.contents,senderFrame:w.contents.mainFrame},action,value);
 return{control,windows,handlers,dialogs,invoke,screen,setResponse:value=>{response=value;}};
}
test('empty startup creates no container; + creates blank project note without file operations',async()=>{
 const f=fixture();await f.control.open();assert.equal(f.windows.length,0);assert.equal(await f.control.open('true'),false);
 await f.control.open(true);const w=f.windows[0],state=f.invoke(w,'getInitialState');assert.equal(state.note,null);assert.equal(state.sourceId,'project:2');assert.match(w.options.icon,/AiDiy_memo\.png$/);assert.equal(w.options.frame,false);assert.equal(w.top,true);assert.equal(w.options.minHeight,84);assert.equal(w.options.webPreferences.sandbox,true);assert.equal(w.options.webPreferences.nodeIntegration,false);assert.match(w.url,/memo.html#token=/);assert.doesNotMatch(w.url,/既存|project/);assert.deepEqual(w.openHandler(),{action:'deny'});
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
 const g=fixture({保存先:[{id:'project:shared'}],メモ:[normal]},{保存先:[{id:'launch:shared'}],メモ:[system]});await g.control.open();await g.control.openSystem();assert.equal(g.windows.length,1);assert.equal(g.invoke(g.windows[0],'getInitialState').scope,'system');
});

async function finishClose(f,w,ok=true){
 await flush();const request=w.sent.filter(args=>args[0]==='memo:close-requested').at(-1)?.[1];assert.ok(request);f.invoke(w,'completeClose',{...request,ok});await flush();
}
test('project refresh flushes old project, rereads latest data, and keeps system and launch windows',async()=>{
 const launch={...note,id:'launch.memo.json',保存先:'launch:1'},system={...note,id:'system.memo.json',保存先:'launch:sys'};
 const snapshot={保存先:sources,メモ:[launch,note]},f=fixture(snapshot,{保存先:[{id:'launch:sys'}],メモ:[system]});
 await f.control.open();const [sw,lw,pw]=f.windows;f.invoke(pw,'getInitialState');
 snapshot.保存先=[sources[0],{id:'project:3'}];snapshot.メモ=[launch,{...note,保存先:'project:3',本文:'new'}];
 const pending=f.control.refresh();await flush();assert.equal(pw.isDestroyed(),false);assert.equal(sw.isDestroyed(),false);assert.equal(lw.isDestroyed(),false);
 assert.equal(pw.sent.at(-1)[1].waitOnly,true);assert.equal('bounds' in pw.sent.at(-1)[1],false);assert.equal(pw.sent.some(args=>args[0]==='memo:bounds'),false);
 snapshot.メモ[1].本文='latest';await finishClose(f,pw);assert.equal(await pending,true);
 assert.equal(pw.isDestroyed(),true);assert.equal(f.control.count,3);assert.equal(f.invoke(f.windows[3],'getInitialState').note.本文,'latest');assert.equal(f.windows[3].top,true);
 assert.equal(sw.sent.some(args=>args[0]==='memo:close-requested'),false);
});
test('failed/conflicting save preserves old note and aborts reload; retry can reconcile',async()=>{
 const snapshot={保存先:sources,メモ:[note]},f=fixture(snapshot);await f.control.open();const old=f.windows[0];f.invoke(old,'getInitialState');
 snapshot.保存先=[sources[0],{id:'project:3'}];snapshot.メモ=[{...note,保存先:'project:3'}];
 const failed=f.control.refresh();await finishClose(f,old,false);assert.equal(await failed,false);assert.equal(old.isDestroyed(),false);assert.equal(f.windows.length,1);
 const retry=f.control.refresh();await finishClose(f,old);assert.equal(await retry,true);assert.equal(f.control.count,1);
});
test('rapid queued refresh and new note cannot race a project flush',async()=>{
 const snapshot={保存先:sources,メモ:[note]},f=fixture(snapshot);await f.control.open();const old=f.windows[0];f.invoke(old,'getInitialState');
 snapshot.保存先=[sources[0],{id:'project:3'}];snapshot.メモ=[];
 const first=f.control.refresh(),second=f.control.refresh(),add=f.control.open(true);await flush();assert.equal(f.windows.length,1);
 snapshot.保存先=[sources[0],{id:'project:4'}];await finishClose(f,old);assert.equal(await first,true);assert.equal(await second,true);assert.equal(await add,true);
 assert.equal(f.control.count,1);assert.equal(f.invoke(f.windows[1],'getInitialState').sourceId,'project:4');
});
test('empty new project note is asked to flush/close; partial listing preserves all windows',async()=>{
 const snapshot={保存先:sources,メモ:[]},f=fixture(snapshot);await f.control.open(true);const blank=f.windows[0];f.invoke(blank,'getInitialState');snapshot.警告=['unavailable'];
 assert.equal(await f.control.refresh(),false);assert.equal(blank.isDestroyed(),false);assert.equal(blank.sent.length,0);
 snapshot.警告=[];snapshot.保存先=[sources[0]];const refreshed=f.control.refresh();await finishClose(f,blank);assert.equal(await refreshed,true);assert.equal(f.control.count,0);
});

test('prepare completes while old source is valid; opens blocked until refresh, failed update can restore old project',async()=>{
 const snapshot={保存先:sources,メモ:[]},f=fixture(snapshot);await f.control.open(true);const blank=f.windows[0];f.invoke(blank,'getInitialState');
 const prepared=f.control.prepareRefresh();assert.equal(await f.control.open(true),false);await flush();
 // A nonempty new note is created by its renderer before the project API changes.
 snapshot.メモ.push(note);await finishClose(f,blank);assert.equal(await prepared,true);assert.equal(await f.control.open(true),false);
 // Simulate failed project API: same snapshot is re-opened, never lost.
 assert.equal(await f.control.refresh(),true);assert.equal(f.control.count,1);assert.equal(f.invoke(f.windows[1],'getInitialState').note.id,note.id);
});
test('system deleted while project flush is waiting is not resurrected by stale snapshot',async()=>{
 const system={保存先:[{id:'launch:sys'}],メモ:[{...note,保存先:'launch:sys'}]},snapshot={保存先:sources,メモ:[note]},f=fixture(snapshot,system);
 await f.control.open();const [sw,pw]=f.windows;f.invoke(pw,'getInitialState');const refreshed=f.control.refresh();await flush();system.メモ=[];sw.destroy();snapshot.メモ=[];await finishClose(f,pw);assert.equal(await refreshed,true);assert.equal(f.control.count,0);assert.equal(f.windows.length,2);
});
test('partial prepare failure restores previously saved windows and blocks wrongly targeted new notes',async()=>{
 const snapshot={保存先:sources,メモ:[note,{...note,id:'b.memo.json'}]},f=fixture(snapshot);await f.control.open();const [a,b]=f.windows;f.invoke(a,'getInitialState');f.invoke(b,'getInitialState');
 const prepared=f.control.prepareRefresh();await finishClose(f,a);await finishClose(f,b,false);assert.equal(await prepared,false);assert.equal(f.control.count,2);assert.equal(b.isDestroyed(),false);assert.equal(await f.control.open(true),false);
});

test('failed API update refresh keeps normal creation blocked until successful sync',async()=>{
 const f=fixture();assert.equal(await f.control.prepareRefresh(),true);assert.equal(await f.control.refresh(false),true);assert.equal(await f.control.open(true),false);
 assert.equal(await f.control.prepareRefresh(),true);assert.equal(await f.control.refresh(true),true);assert.equal(await f.control.open(true),true);
});

test('sticky plus uses selected project in Diag and only system in standalone; repeated clicks serialize',async()=>{
 let standalone=false;const f=fixture({保存先:sources,メモ:[note]},{保存先:[{id:'launch:sys'}],メモ:[{...note,保存先:'launch:sys'}]},{isStandalone:()=>standalone});
 await f.control.open();const systemWindow=f.windows[0];f.invoke(systemWindow,'getInitialState');
 const first=f.invoke(systemWindow,'newMemo');assert.equal(f.invoke(systemWindow,'newMemo'),false);assert.equal(await first,true);const normal=f.windows.at(-1);assert.equal(f.invoke(normal,'getInitialState').sourceId,'project:2');
 assert.equal(systemWindow.sent.some(args=>args[0]==='memo:close-requested'),false);
 standalone=true;assert.equal(await f.invoke(systemWindow,'newMemo'),true);const single=f.windows.at(-1);assert.equal(f.invoke(single,'getInitialState').sourceId,'launch:sys');assert.equal(f.invoke(single,'getInitialState').scope,'system');
 assert.equal(f.handlers['diag:memo-window']({sender:systemWindow.contents,senderFrame:{}},'newMemo'),false);
});
test('sticky plus survives blank source blur/close while new window opens',async()=>{
 const f=fixture();await f.control.open(true);const blank=f.windows[0];f.invoke(blank,'getInitialState');const adding=f.invoke(blank,'newMemo');blank.close();const request=blank.sent.at(-1)[1];f.invoke(blank,'completeClose',{...request,ok:true});assert.equal(await adding,true);assert.equal(blank.isDestroyed(),true);assert.equal(f.control.count,1);assert.equal(f.invoke(f.windows[1],'getInitialState').note,null);
});

test('plus places blank note right, below, then top-left of source display work area',async()=>{
 const f=fixture(),screen=f.screen;
 assert.deepEqual(追加付箋範囲({x:40,y:40,width:280,height:230},screen),{x:328,y:40,width:280,height:230});
 assert.deepEqual(追加付箋範囲({x:1600,y:40,width:280,height:230},screen),{x:1600,y:278,width:280,height:230});
 assert.deepEqual(追加付箋範囲({x:1600,y:800,width:280,height:230},screen),{x:0,y:0,width:280,height:230});
 assert.deepEqual(追加付箋範囲({x:-400,y:300,width:280,height:230},screen),{x:-1280,y:-100,width:280,height:230});
 assert.deepEqual(追加付箋範囲({x:-1200,y:-80,width:280,height:230},screen),{x:-912,y:-80,width:280,height:230});
 await f.control.open(true);const original=f.windows[0];original.bounds={x:1600,y:40,width:280,height:230};
 assert.equal(await f.invoke(original,'newMemo'),true);const added=f.windows[1];assert.deepEqual(added.bounds,{x:1600,y:278,width:280,height:230});assert.equal(f.invoke(added,'getInitialState').note,null);
});
