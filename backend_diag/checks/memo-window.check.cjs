// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// See LICENSE for full terms.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {メモ窓を作成}=require('../memo/ウィンドウ.cjs');
const {終了確認を作成}=require('../diag/起動/終了確認.cjs');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
 const windows=[],handlers={},dialogs=[];let response=1;
 class Window extends EventEmitter{
  constructor(options){super();this.options=options;this.webContents=new EventEmitter();this.webContents.mainFrame={};this.sent=[];this.webContents.send=(...args)=>this.sent.push(args);this.webContents.setWindowOpenHandler=fn=>this.openHandler=fn;windows.push(this);}
  isDestroyed(){return !!this.destroyed;} isMinimized(){return !!this.minimized;}
  isFocused(){return true;} isAlwaysOnTop(){return this.top;}
  setAlwaysOnTop(value){this.top=value;} setMenuBarVisibility(){} show(){this.emit('show');} focus(){}
  restore(){this.minimized=false;} minimize(){this.minimized=true;} async loadURL(value){this.url=value;}
  destroy(){this.destroyed=true;this.emit('closed');}
  close(){if(this.dirty){const event={preventDefault(){this.allowed=true;}};this.webContents.emit('will-prevent-unload',event);if(!event.allowed)return;}this.destroy();}
 }
 const control=メモ窓を作成({BrowserWindow:Window,ipcMain:{handle:(name,handler)=>handlers[name]=handler},dialog:{showMessageBox:async(win,options)=>{dialogs.push(options);return{response};}},screen:{},session:{},url:new URL('http://127.0.0.1:1234/proxy/9000/#token='+'x'.repeat(43))});
 return{control,windows,handlers,dialogs,setResponse:value=>{response=value;}};
}
test('same-origin sandboxed memo opens once, always on top, reopens after close',async()=>{
 const f=fixture();assert.equal(await f.control.open(),true);await f.control.open();assert.equal(f.windows.length,1);
 const w=f.windows[0];assert.match(w.url,/\/proxy\/9000\/memo.html#token=/);assert.equal(w.options.webPreferences.nodeIntegration,false);assert.equal(w.options.webPreferences.sandbox,true);assert.equal(w.options.webPreferences.contextIsolation,true);assert.equal(w.top,true);
 assert.deepEqual(w.openHandler(),{action:'deny'});
 const event={sender:w.webContents,senderFrame:w.webContents.mainFrame};
 const invoke=f.handlers['diag:memo-window'];assert.equal(invoke({},'close'),false);assert.equal(w.isDestroyed(),false);
 assert.equal(invoke(event,'togglePin').locked,true);assert.equal(w.top,true);assert.equal(invoke(event,'collapsePanel','false').ok,false);
 assert.equal(await f.control.closeForParent(),true);await f.control.open();assert.equal(f.windows.length,2);
});
test('dirty memo cancels parent close by default, explicit discard resolves closure',async()=>{
 const f=fixture();await f.control.open();const w=f.windows[0];w.dirty=true;
 const first=f.control.closeForParent(),second=f.control.closeForParent();assert.equal(first,second);assert.equal(await first,false);assert.equal(w.isDestroyed(),false);assert.equal(f.dialogs.length,1);assert.equal(f.dialogs[0].defaultId,1);assert.equal(f.dialogs[0].cancelId,1);
 await flush();f.setResponse(0);assert.equal(await f.control.closeForParent(),true);assert.equal(w.isDestroyed(),true);
});
test('Diag close waits for child agreement; cancellation permits a later retry',async()=>{
 const window=new EventEmitter();window.isDestroyed=()=>false;let allowed=false,calls=0;
 window.close=()=>{const event={preventDefault(){this.prevented=true;}};window.emit('close',event);if(!event.prevented)window.closed=true;};
 終了確認を作成({window,状態取得:async()=>({終了時停止あり:false}),確認:async()=>({response:0}),終了前確認:async()=>{calls++;return allowed;}});
 window.close();await flush();assert.equal(window.closed,undefined);assert.equal(calls,1);
 allowed=true;window.close();await flush();assert.equal(window.closed,true);assert.equal(calls,2);
});

test('new memo request uses fixed notification without reloading or accepting arbitrary arguments',async()=>{
 const f=fixture();assert.equal(await f.control.open('true'),false);assert.equal(f.windows.length,0);
 await f.control.open(true);const w=f.windows[0];assert.deepEqual(w.sent,[['memo:new']]);
 w.dirty=true;await f.control.open(false);assert.equal(w.sent.length,1);
 await f.control.open(true);assert.equal(f.windows.length,1);assert.equal(w.dirty,true);assert.deepEqual(w.sent,[['memo:new'],['memo:new']]);
});
