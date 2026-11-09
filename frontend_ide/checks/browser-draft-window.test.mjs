// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const {createBrowserViews}=require('../デスクトップ/ブラウザ.cjs');
const flush=async()=>{for(let i=0;i<100;i++)await Promise.resolve();};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const element={tag:'button',selector:'#save',attributes:{id:'save'},rect:{x:10,y:20,width:80,height:30},html:'<button id="save">保存</button>',css:{color:'black'},text:'保存',url:'https://example.test/form',notice:'表示中DOM'};
function fixture(fullscreen=false){
 const windows=[],sent=[];let view,nextLoad=Promise.resolve(),attached=false;
 const parent=Object.assign(new EventEmitter(),{isDestroyed:()=>false,isFullScreen:()=>fullscreen,getBounds:()=>({x:20,y:30,width:1200,height:800}),getContentBounds:()=>({x:20,y:30,width:1200,height:800}),webContents:Object.assign(new EventEmitter(),{getZoomFactor:()=>1.25,send:(...args)=>sent.push(args)}),contentView:{addChildView(){}}});
 const debug=Object.assign(new EventEmitter(),{isAttached:()=>attached,attach(){attached=true;},sendCommand:async method=>{
  if(method==='Page.getFrameTree')return{frameTree:{frame:{id:'frame'}}};
  if(method==='Page.createIsolatedWorld')return{executionContextId:1};
  if(method==='DOM.resolveNode')return{object:{objectId:'node'}};
  if(method==='Runtime.callFunctionOn')return{result:{value:element}};
  return{};
 }});
 class View{
  constructor(){view=this;this.visibility=[];this.webContents=Object.assign(new EventEmitter(),{debugger:debug,url:'',getURL(){return this.url;},getTitle:()=> '入力画面',isLoading:()=>false,isDestroyed:()=>false,navigationHistory:{canGoBack:()=>false,canGoForward:()=>false},loadURL:async function(url){this.url=url;},setWindowOpenHandler(){},close(){},stop(){},focus(){}});}
  setVisible(value){this.visible=value;this.visibility.push(value);}setBounds(value){this.bounds=value;}
 }
 class Window extends EventEmitter{
  constructor(options){super();this.options=options;this.shown=0;this.focused=0;this.load=nextLoad;windows.push(this);this.webContents=Object.assign(new EventEmitter(),{mainFrame:{url:''},setZoomFactor:value=>{this.zoom=value;},setWindowOpenHandler:handler=>{this.newWindow=handler;},executeJavaScript:async()=>{}});}
  loadURL(url){this.url=url;return this.load.then(()=>{this.webContents.mainFrame.url=url;});}
  isDestroyed(){return !!this.destroyed;}show(){this.shown++;}showInactive(){this.shown++;}focus(){this.focused++;}
  destroy(){if(this.destroyed)return;this.destroyed=true;this.emit('closed');}
 }
 const record={kind:'browser',window:parent,url:'http://127.0.0.1:12345/',browserSession:'aidiy_ide 1',browserTabId:'tab-1'};
 const screen={getDisplayMatching:()=>({workArea:{x:0,y:0,width:1280,height:900}})};
 let browser;browser=createBrowserViews({BrowserWindow:Window,WebContentsView:View,screen,projectRoot:'/fixture',session:{fromPartition:()=>({setPermissionRequestHandler(){},setPermissionCheckHandler(){},webRequest:{onBeforeRequest(){}}})},trustedEvent:event=>event.record||browser.trustedDraft(event)||browser.trustedAnalysis(event)});
 browser.attach(record,'https://example.test/form');
 const host={record};
 return{browser,record,parent,host,view,windows,sent,debug,setLoad:value=>{nextLoad=value;},event:(window=windows.at(-1))=>({sender:window.webContents,senderFrame:window.webContents.mainFrame}),async select(){assert.equal((await browser.action(host,'element-toggle')).ok,true);debug.emit('message',{},'Overlay.inspectNodeRequested',{backendNodeId:1});await flush();assert.ok(sent.some(([name])=>name==='development:browser-element-selected'));},dispose(){parent.emit('closed');}};
}
for(const fullscreen of [false,true])for(const elementMode of [false,true])test(`Browser下書き: ${fullscreen?'F11':'通常'}/${elementMode?'要素':'ページ'}は背景と寸法を保ち専用子窓へ`,async t=>{
 const f=fixture(fullscreen);t.after(()=>f.dispose());await f.browser.action(f.host,'bounds',{left:0,top:100,width:960,height:540,viewportWidth:960,viewportHeight:640,fullscreen});
 if(elementMode)await f.select();const bounds={...f.view.bounds};f.view.visibility.length=0;
 assert.equal((await f.browser.action(f.host,'open-draft',elementMode)).ok,true);
 const w=f.windows.at(-1),event=f.event();assert.equal(w.options.parent,f.parent);assert.equal(w.options.frame,false);assert.equal(w.options.modal,undefined);assert.equal(w.options.webPreferences.nodeIntegration,false);assert.equal(w.zoom,1.25);assert.equal(w.options.width,760);
 assert.equal(f.view.visible,true);assert.ok(!f.view.visibility.includes(false));assert.deepEqual(f.view.bounds,bounds);
 assert.equal(f.browser.trustedDraft(event),f.record);const result=await f.browser.action(event,'draft-window-context');assert.equal(result.ok,true);assert.equal(!!result.request.browserElementId,elementMode);assert.match(result.request.text,/session: aidiy_ide 1\ntab_id: tab-1/);
 const count=f.windows.length;await f.browser.action(f.host,'open-draft',elementMode);assert.equal(f.windows.length,count);assert.equal((await f.browser.action(f.host,'element-toggle')).ok,false,'確定内容を別の要素で差し替えない');
 assert.equal((await f.browser.action(f.host,'draft-window-close')).ok,false);assert.equal((await f.browser.action(event,'draft-window-close')).ok,true);assert.equal(f.view.visible,true);assert.deepEqual(f.view.bounds,bounds);assert.equal(f.browser.trustedDraft(event),null);
 if(elementMode)assert.equal((await f.browser.action(f.host,'element-draft')).ok,false,'取消後は古い選択IDを捨てる');
});
test('Browser下書き: 遷移・再読込・接続喪失・最小化・終了で旧窓と選択を破棄し再開できる',async t=>{
 for(const cancel of [f=>f.view.webContents.emit('did-start-navigation',{},'https://other.test/',false,true),f=>f.browser.action(f.host,'reload'),f=>f.browser.setAvailable(f.record,false),f=>f.parent.emit('minimize'),f=>f.parent.emit('closed')]){
  const f=fixture();t.after(()=>f.dispose());f.view.webContents.reload=()=>{};await f.select();await f.browser.action(f.host,'open-draft',true);const w=f.windows.at(-1),event=f.event();await cancel(f);await flush();assert.equal(w.destroyed,true);assert.equal(f.browser.trustedDraft(event),null);assert.throws(()=>f.browser.draftWindowRequest(event));
 }
 const f=fixture();t.after(()=>f.dispose());await f.select();await f.browser.action(f.host,'open-draft',true);const old=f.event();f.browser.setAvailable(f.record,false);f.browser.setAvailable(f.record,true);assert.equal(f.view.visible,true);await f.select();await f.browser.action(f.host,'open-draft',true);assert.notEqual(f.event().sender,old.sender);assert.equal(f.browser.trustedDraft(old),null);
});
test('Browser下書き: 子窓・親の読込中終了と失敗を回収し、古い応答で再表示しない',async t=>{
 const f=fixture();t.after(()=>f.dispose());const load=deferred();f.setLoad(load.promise);const first=f.browser.action(f.host,'open-draft'),second=f.browser.action(f.host,'open-draft');await flush();assert.equal(f.windows.length,1);const w=f.windows[0];assert.equal(w.shown,0);w.destroy();load.resolve();await Promise.all([first,second]);assert.equal(w.shown,0);
 f.setLoad(Promise.resolve());assert.equal((await f.browser.action(f.host,'open-draft')).ok,true);assert.equal(f.windows.length,2);assert.equal(f.windows.at(-1).shown,1);
 f.windows.at(-1).destroy();const fail=deferred();f.setLoad(fail.promise);const failed=f.browser.action(f.host,'open-draft');await flush();fail.reject(Error('load failed'));assert.equal((await failed).ok,false);assert.equal(f.windows.at(-1).destroyed,true);
 f.setLoad(Promise.resolve());assert.equal((await f.browser.action(f.host,'open-draft')).ok,true);
});
test('Browser下書き: 別sender・subframe・別URLには権限を与えずページ遷移後は無効',async t=>{
 const f=fixture();t.after(()=>f.dispose());await f.browser.action(f.host,'open-draft');const event=f.event();
 assert.equal(f.browser.trustedDraft({...event,senderFrame:{url:event.senderFrame.url}}),null);assert.equal((await f.browser.action(f.host,'draft-window-context')).ok,false);
 event.senderFrame.url='https://external.test/';assert.equal(f.browser.trustedDraft(event),null);event.senderFrame.url=f.windows.at(-1).url;
 const newWindow=f.windows.at(-1).newWindow;assert.deepEqual(newWindow(),{action:'deny'});let prevented=false;event.sender.emit('will-navigate',{preventDefault(){prevented=true;}});assert.equal(prevented,true);
 f.view.webContents.url='https://different.test/';assert.throws(()=>f.browser.draftWindowRequest(event),/変わりました/);
});
test('Browser下書き: 子窓IPCは文脈・閉じる・下書きだけへ限定し本文をmainで確定する',()=>{
 const source=readFileSync(new URL('../desktop.cjs',import.meta.url),'utf8');
 assert.match(source,/isDraftSender\?\.\(event.sender\).*\['draft-window-context','draft-window-close'\]/);
 assert.match(source,/const source=trustedEvent\(event\)\|\|browserViews\?\.trustedDraft\?\.\(event\)/);
 assert.match(source,/child\?browserViews.draftWindowRequest\(event\).browserElementId:value\?\.browserElementId/);
 assert.match(source,/if\(child\)browserViews.draftWindowRequest\(event\)/);assert.match(source,/text:draft.request.text/);
 const app=readFileSync(new URL('../src/App.vue',import.meta.url),'utf8');assert.match(app,/if\(browserAnalysis\|\|browserDraft\)return/);
});

test('Browser下書き実IPC: renderer本文・選択IDを採用せず、閉じた窓から遅れて追加しない',async t=>{
 const f=fixture();t.after(()=>f.dispose());const handlers=new Map(),inserted=[];let bridgeReady=Promise.resolve();
 const desktop=readFileSync(new URL('../desktop.cjs',import.meta.url),'utf8');
 const source=desktop.slice(desktop.indexOf(" ipcMain.handle('development:draft-targets'"),desktop.indexOf(" ipcMain.on('development:draft-result'"));
 vm.runInNewContext(source,{ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},trustedEvent:event=>event.record,browserViews:f.browser,draftRouter:{insert:async()=>({ok:false}),list:async()=>({ok:false})},sharedDrafts:async()=>{await bridgeReady;return{list:async()=>({ok:true,targets:[]}),insert:async(record,value)=>{inserted.push({record,value});return{ok:true};}};}});
 const insert=handlers.get('development:draft-insert');
 await f.select();await f.browser.action(f.host,'open-draft',true);let event=f.event();
 assert.equal((await insert(event,{targetId:'code',text:'FORGED',browserElementId:'FORGED'})).ok,true);assert.equal(inserted[0].record,f.record);assert.match(inserted[0].value.text,/<button id="save">保存/);assert.ok(!inserted[0].value.text.includes('FORGED'));
 await f.browser.action(event,'draft-window-close');await f.browser.action(f.host,'open-draft');event=f.event();
 assert.equal((await insert(event,{targetId:'live',text:'FORGED',browserElementId:'FORGED'})).ok,true);assert.equal(inserted[1].value.text,'session: aidiy_ide 1\ntab_id: tab-1\nhttps://example.test/form');
 const pending=deferred();bridgeReady=pending.promise;const late=insert(event,{targetId:'code'});await flush();await f.browser.action(event,'draft-window-close');pending.resolve();assert.equal((await late).ok,false);assert.equal(inserted.length,2);
 assert.equal((await insert(event,{targetId:'code'})).ok,false);
});

test('Browser下書き: 要素ダイアログを開いたまま通常連携を押すと古い要素を流用しない',async t=>{
 const f=fixture();t.after(()=>f.dispose());await f.select();await f.browser.action(f.host,'open-draft',true);const old=f.event(),oldWindow=f.windows.at(-1);
 await f.browser.action(f.host,'open-draft',false);assert.equal(oldWindow.destroyed,true);assert.equal(f.browser.trustedDraft(old),null);assert.equal(f.browser.draftWindowRequest(f.event()).browserElementId,undefined);assert.equal((await f.browser.action(f.host,'element-draft')).ok,false);
});
