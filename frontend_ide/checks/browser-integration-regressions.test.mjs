// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import browserModule from '../デスクトップ/ブラウザ.cjs';
import displaysModule from '../デスクトップ/全画面横断.cjs';
import pinsModule from '../デスクトップ/最前面ピン.cjs';
import routerModule from '../デスクトップ/draft-router.cjs';
import * as draftModule from '../src/components/下書き連携/下書き受け渡し.js';

const require=createRequire(import.meta.url),vue=require('vue');
const {parse,compileScript}=require('@vue/compiler-sfc'),{transformSync}=require('esbuild');

// Vueの実setup・受信部品・preload・mainのRouterを接続する。
// 音声・AI通信は起動せず、接続準備と会話状態だけをテストから更新する。
function draftPanel(kind,{desktop=true,linked=false}={}){
 const ipc=new EventEmitter(),registrations=[],deliveries=[];
 const state={active:true,mode:'online',startedAt:1,project:{path:'/project'}};
 const key=value=>`${value.mode}:${value.startedAt}`;
 const record={kind,slot:0,revision:0,window:{isDestroyed:()=>false,webContents:{send(channel,value){deliveries.push(value);ipc.emit(channel,{},value);}}}};
 const owner=linked?{kind:'ide',revision:0,window:{isDestroyed:()=>false}}:record;
 if(linked){record.owner=owner;record.linkKey=key(state);}
 const records=new Map([[owner.window,owner],[record.window,record]]);
 const router=routerModule.createDraftRouter({records,readState:async()=>state,sessionKey:key,focusWindow(){}});
 ipc.invoke=async(channel,value)=>{
  assert.equal(channel,'development:draft-target-register');
  registrations.push(value);return router.register(record,value);
 };
 ipc.send=(channel,value)=>{assert.equal(channel,'development:draft-result');router.acknowledge(record,value);};
 let api;
 vm.runInNewContext(readFileSync(new URL('../デスクトップ/preload.cjs',import.meta.url),'utf8'),{
  require:()=>({contextBridge:{exposeInMainWorld(_name,value){api=value;}},ipcRenderer:ipc}),
 });
 const modules={
  'markdown-it':class{constructor(){this.renderer={rules:{}};this.utils={escapeHtml:value=>value};}},
  '../コード/コード通信.js':{codeTransport:()=>({saveDraft(){}})},
  '../ライブ/ライブ通信':{LiveEnvironment:class{}},
  '../コード/会話到着演出':{chatArrival:()=>({reset(){}})},
  '../下書き連携/下書き受け渡し.js':draftModule,
 };
 const path=kind==='code'?'../src/components/コード/コードパネル.vue':'../src/components/ライブ/ライブパネル.vue';
 const {descriptor}=parse(readFileSync(new URL(path,import.meta.url),'utf8'));
 const script=compileScript(descriptor,{id:path,genDefaultAs:'component'}),module={exports:{}};
 vm.runInNewContext(transformSync(script.content+'\nmodule.exports=component;',{format:'cjs'}).code,{
  module,console,URL,location:{href:'http://localhost/'},window:{aidiyWindow:api},requestAnimationFrame:()=>1,
  require:id=>id==='vue'?{...vue,onMounted(){},onBeforeUnmount(){}}:modules[id]||{},
 });
 const scope=vue.effectScope(),panel=scope.run(()=>module.exports.setup({desktop,linked,host:false,config:{},visible:true},{expose(){}}));
 const ready=()=>{
  if(kind==='code')Object.assign(panel.state,{信頼済み:true,画面接続済み:true,作業フォルダ:{パス:'/project'},会話ID:'conversation-1'});
  else{panel.project.value={パス:'/project'};panel.modelLoading.value=false;}
 };
 return{panel,router,owner,ipc,registrations,deliveries,ready,
  changeContext(){if(kind==='code')panel.state.会話ID='conversation-2';else panel.draftGeneration.value++;},
  setBusy(value){if(kind==='code')panel.pending.value=value;else panel.busy.value=value;},
  close(){panel.draftReceiver.dispose();scope.stop();},
 };
}

for(const kind of ['code','live'])for(const linked of [false,true]){
 test(`Browser下書き: 実${kind}パネルの${linked?'IDE所属':'単独起動'}が準備後に登録しIPCを受信する`,async()=>{
  const f=draftPanel(kind,{linked});
  try{
   f.panel.draftReceiver.mount();
   assert.equal(f.ipc.listenerCount('development:draft-handoff'),1);
   assert.equal((await f.router.list(f.owner)).targets.length,0,'準備前は連携先にしない');
   f.ready();await vue.nextTick();
   const list=await f.router.list(f.owner);assert.equal(list.targets.length,1);
   const target=list.targets[0];assert.equal(target.kind,kind);
   const payload={targetId:target.id,contextId:target.contextId,projectPath:list.projectPath,sessionKey:list.sessionKey,text:'https://example.test/資料'};
   f.panel.prompt.value='既存の下書き';
   assert.equal((await f.router.insert(f.owner,payload)).ok,true);
   assert.equal(f.panel.prompt.value,'既存の下書き\n\n'+payload.text);
   f.ipc.emit('development:draft-handoff',{},f.deliveries[0]);
   assert.equal(f.panel.prompt.value,'既存の下書き\n\n'+payload.text,'同じ配送を再受信しても二重追記しない');
   f.changeContext();await vue.nextTick();
   assert.equal((await f.router.insert(f.owner,payload)).ok,false,'前の会話には追加しない');
   assert.notEqual((await f.router.list(f.owner)).targets[0].contextId,target.contextId);
   f.setBusy(true);await vue.nextTick();assert.equal((await f.router.list(f.owner)).targets.length,0);
   f.setBusy(false);await vue.nextTick();assert.equal((await f.router.list(f.owner)).targets.length,1);
  }finally{f.close();}
  assert.equal(f.ipc.listenerCount('development:draft-handoff'),0);
  assert.equal((await f.router.list(f.owner)).targets.length,0,'破棄時に登録を解除する');
 });
}
for(const kind of ['code','live'])test(`Browser下書き: Webの${kind}はElectronの登録・購読を行わない`,async()=>{
 const f=draftPanel(kind,{desktop:false});
 try{f.panel.draftReceiver.mount();f.ready();await vue.nextTick();assert.ok(f.panel.draftReceiver.target());assert.equal(f.registrations.length,0);assert.equal(f.ipc.listenerCount('development:draft-handoff'),0);}
 finally{f.close();}
});

function browserVR({initialPin=false,standalone=false,deferHeaderLoad=false}={}){
 let header,popup,finishHeaderLoad,pointer={x:-1,y:-1},inspectMode='none';
 const commands=[];let attached=false;
 const debug=Object.assign(new EventEmitter(),{isAttached:()=>attached,attach(){attached=true;},async sendCommand(method,params={}){
  commands.push({method,params});if(method==='Overlay.setInspectMode'){if(!params.highlightConfig)throw Error('Internal error: highlight configuration parameter is missing');inspectMode=params.mode;}return{};
 }});
 class Window extends EventEmitter{
  constructor(options={}){super();if(options.parent){if(options.title==='要素連携')popup=this;else header=this;}this.options=options;this.bounds={x:0,y:0,width:1000,height:700,...options};this.fullscreen=false;this.movable=true;this.resizable=true;this.webContents=Object.assign(new EventEmitter(),{sent:[],send(channel,value){this.sent.push([channel,value]);},getZoomFactor:()=>1,setZoomFactor(){},setWindowOpenHandler(){},isDestroyed:()=>this.isDestroyed(),executeJavaScriptInIsolatedWorld:async()=>false});this.contentView={addChildView(){}};}
  isDestroyed(){return !!this.destroyed;}getBounds(){return{...this.bounds};}getContentBounds(){return{...this.bounds};}setBounds(value){this.bounds={...value};}getNormalBounds(){return{...this.bounds};}
  isMaximized(){return false;}isMinimized(){return false;}isFullScreen(){return this.fullscreen;}setFullScreen(value){this.fullscreen=value;this.emit(value?'enter-full-screen':'leave-full-screen');}
  isMovable(){return this.movable;}isResizable(){return this.resizable;}setMovable(value){this.movable=value;}setResizable(value){this.resizable=value;}
  setAlwaysOnTop(value){this.alwaysOnTop=value;}isAlwaysOnTop(){return!!this.alwaysOnTop;}showInactive(){this.visible=true;}moveTop(){}hide(){this.visible=false;}
  async loadURL(url){this.webContents.mainFrame={url};if(this.options.parent&&deferHeaderLoad)await new Promise(resolve=>{finishHeaderLoad=resolve;});}
  destroy(){this.destroyed=true;this.emit('closed');this.webContents.emit('destroyed');}
 }
 let page,view;
 class View{
  constructor(){view=this;page=this.webContents=Object.assign(new EventEmitter(),{debugger:debug,executeJavaScriptInIsolatedWorld:async()=>true,focus(){},loadURL:async()=>{},getURL:()=>'',getTitle:()=>'',isLoading:()=>false,isDestroyed:()=>false,stop(){},close(){},setWindowOpenHandler(){},navigationHistory:{canGoBack:()=>false,canGoForward:()=>false}});}
  setVisible(value){this.visible=value;}setBounds(value){this.bounds=value;}
 }
 const display={bounds:{x:0,y:0,width:1920,height:1080},workArea:{x:0,y:0,width:1920,height:1040}};
 const screen=Object.assign(new EventEmitter(),{getAllDisplays:()=>[display],getPrimaryDisplay:()=>display,getDisplayMatching:()=>display,getCursorScreenPoint:()=>pointer});
 const owner={kind:'ide',window:new Window()},record={kind:'browser',owner:standalone?undefined:owner,window:new Window(),url:'http://127.0.0.1:12345/'};
 const windows=new Map([[owner.window.webContents,owner],[record.window.webContents,record]]);
 const windowPins=pinsModule.createWindowPins();windowPins.register(owner.window);windowPins.register(record.window,{pinned:initialPin});
 // desktop.cjsの実syncChildrenを使う。テスト内へロック合成の条件式を複製しない。
 const source=readFileSync(new URL('../desktop.cjs',import.meta.url),'utf8');
 const declaration=source.match(/const allDisplays=createAllDisplays\(\{[\s\S]*?\n\}\}\);/)?.[0];assert.ok(declaration);
 const displays=vm.runInNewContext(declaration+'\nallDisplays;',{
  createAllDisplays:displaysModule.createAllDisplays,screen,trustedEvent:event=>event.record,vrPanels:undefined,windows,windowPins,vrPanelStacking:{refresh(){}},
 });displays.register(owner);
 // desktop.cjsと同じ順序: hostのVR解除 → BrowserのF11 → 本文のVR解除。
 const stopHost=displays.attachExitKey(record,record.window.webContents);
 const browser=browserModule.createBrowserViews({BrowserWindow:Window,WebContentsView:View,screen,windowPins,session:{fromPartition:()=>({setPermissionRequestHandler(){},setPermissionCheckHandler(){},webRequest:{onBeforeRequest(){}}})},trustedEvent:event=>event.record,isVRActive:item=>displays.isActive(item.owner||item),leaveVR:item=>displays.leave(item.owner||item)});
 browser.attach(record,'about:blank',false);
 const stopPage=displays.attachExitKey(record,page);
 return{owner,record,displays,browser,windowPins,windows,view,host:record.window.webContents,page,commands,get inspectMode(){return inspectMode;},get popup(){return popup;},get header(){return header;},
  enterVR:()=>displays.handle({record:owner},'toggle'),
  finishHeaderLoad:()=>finishHeaderLoad?.(),
  movePointer:value=>{pointer=value;},
  press(contents,input={},prevented=false){const event={defaultPrevented:prevented,count:0,preventDefault(){this.defaultPrevented=true;this.count++;}};contents.emit('before-input-event',event,{type:'keyDown',key:'F11',...input});return event;},
  close(){record.window.emit('closed');stopHost();stopPage();owner.window.emit('closed');},
 };
}
for(const standalone of [false,true])for(const focus of ['host','page','header'])test(`Browser F11連打: ${standalone?'単独':'IDE所属'}/${focus}は遅いヘッダー読込・表示途中でも最後の通常状態へ戻る`,async t=>{
 t.mock.timers.enable({apis:['setInterval','Date']});
 const f=browserVR({standalone,deferHeaderLoad:true});
 try{
  const bounds={left:0,top:96,width:1000,height:604,chromeHeight:96};
  await f.browser.action({record:f.record},'bounds',bounds);
  f.movePointer({x:500,y:1});f.press(f.host);t.mock.timers.tick(80);
  assert.ok(f.header);f.press(f.host);f.finishHeaderLoad();await Promise.resolve();await Promise.resolve();t.mock.timers.tick(240);
  assert.equal(!!f.header.visible,false,'全画面終了後に初期読込が完了してもヘッダーを出さない');
  for(let cycle=0;cycle<3;cycle++){
   const source=focus==='header'?f.header.webContents:f[focus];
   f.press(source);t.mock.timers.tick(80);t.mock.timers.tick(32);
   f.press(source);f.press(source);f.press(source);t.mock.timers.tick(240);
   const updates=f.host.sent.filter(([channel])=>channel==='development:browser-changed').map(([,value])=>value);
   assert.equal(updates.at(-1).fullscreen,false);
   assert.ok(updates.every((value,i)=>i===0||value.stateRevision>updates[i-1].stateRevision),'状態通知の順序が単調増加する');
   assert.equal(f.record.window.isFullScreen(),false);assert.equal(f.header.visible,false);
   const result=await f.browser.action({record:f.record},'bounds',bounds);
   assert.equal(result.fullscreen,false);assert.ok(result.stateRevision>updates.at(-1).stateRevision);
   assert.deepEqual(f.view.bounds,{x:0,y:96,width:1000,height:604},'通常操作欄の領域を本文で覆わない');
  }
 }finally{f.close();}
});
for(const standalone of [false,true])test(`Browser全画面ヘッダー: ${standalone?'単独':'IDE所属'}は幅800で収納・ピン解除・F11再入場後に上端中央へ戻す`,async t=>{
 t.mock.timers.enable({apis:['setInterval','Date']});
 const f=browserVR({standalone});
 try{
  const tick=()=>t.mock.timers.tick(240);
  f.press(f.host);f.movePointer({x:500,y:1});tick();await Promise.resolve();tick();
  assert.equal(f.header.visible,true);assert.equal(f.header.options.roundedCorners,false,'OS側にも角丸を付けない');
  assert.deepEqual(f.header.getBounds(),{x:100,y:0,width:800,height:100});
  for(let cycle=0;cycle<3;cycle++){
   const base=f.record.window.getContentBounds();
   f.header.setBounds({x:base.x+12,y:base.y+130,width:800,height:100});f.header.emit('move');
   f.movePointer({x:base.x+500,y:base.y+500});tick();tick();assert.equal(f.header.visible,false);
   f.movePointer({x:base.x+500,y:base.y+1});tick();tick();
   assert.equal(f.header.visible,true);assert.deepEqual(f.header.getBounds(),{x:base.x+100,y:base.y,width:800,height:100},'収納後のホバー再表示は上端中央へ戻す');
   await f.browser.action({record:f.record},'header-toggle-pin');
   f.header.setBounds({x:base.x+24,y:base.y+180,width:800,height:100});f.header.emit('move');
   f.movePointer({x:base.x+50,y:base.y+200});
   await f.browser.action({record:f.record},'header-toggle-pin');tick();assert.equal(f.header.visible,false,'移動先でピン解除すると収納する');
   f.movePointer({x:base.x+500,y:base.y+500});tick();f.movePointer({x:base.x+500,y:base.y+1});tick();tick();
   assert.deepEqual(f.header.getBounds(),{x:base.x+100,y:base.y,width:800,height:100},'ピン解除・収納後も移動先でなく上端中央から出す');
   await f.browser.action({record:f.record},'header-toggle-pin');
   f.press(f.header.webContents);tick();assert.equal(f.record.window.isFullScreen(),false);
   f.record.window.setBounds({x:-1200-cycle*20,y:80+cycle*10,width:1000,height:700});
   const current=f.record.window.getContentBounds();f.movePointer({x:current.x+500,y:current.y+500});
   f.press(f.host);tick();tick();
   assert.equal(f.header.visible,true,'ピン留めはF11を跨いでも保持する');
   assert.deepEqual(f.header.getBounds(),{x:current.x+100,y:current.y,width:800,height:100},'前回位置でなく現在の画面上端中央に表示する');
   assert.deepEqual(f.record.window.getContentBounds(),current,'本文側の窓位置は変更しない');
   await f.browser.action({record:f.record},'header-toggle-pin');tick();
   f.movePointer({x:current.x+500,y:current.y+1});tick();tick();
  }
 }finally{f.close();}
});
for(const focus of ['host','page'])test(`Browser F11: ${focus==='host'?'URL欄':'本文'}のVR解除を二重処理せず反復・次の押下を区別する`,()=>{
 const f=browserVR();
 try{
  f.enterVR();
  for(const input of [{key:'F10'},{type:'keyUp'},{control:true},{alt:true},{shift:true},{meta:true}]){
   assert.equal(f.press(f[focus],input).count,0);assert.equal(f.displays.isActive(f.owner),true);assert.equal(f.record.window.isFullScreen(),false);
  }
  assert.equal(f.press(f[focus]).count,1);
  assert.equal(f.displays.isActive(f.owner),false);assert.equal(f.record.window.isFullScreen(),false,'VR解除と同じF11ではBrowserを全画面にしない');
  for(const contents of [f.host,f.page]){f.press(contents,{isAutoRepeat:true});assert.equal(f.record.window.isFullScreen(),false,'フォーカスが移っても反復で再移行しない');}
  assert.equal(f.press(f[focus],{},true).count,0,'既に消費された入力は扱わない');
  f.press(f[focus]);assert.equal(f.record.window.isFullScreen(),true,'次の独立したF11はBrowserの全画面操作');
  f.press(f[focus],{isAutoRepeat:true});f.press(f[focus],{type:'keyUp'});assert.equal(f.record.window.isFullScreen(),true);
  f.press(f[focus]);assert.equal(f.record.window.isFullScreen(),false);
  f.enterVR();f.press(f[focus]);assert.equal(f.displays.isActive(f.owner),false);assert.equal(f.record.window.isFullScreen(),false,'VRへ再入場しても同じ優先順位');
 }finally{f.close();}
 assert.equal(f.host.listenerCount('before-input-event'),0);assert.equal(f.page.listenerCount('before-input-event'),0);
});
test('Browser F11: 実全画面ヘッダーの購読もVR解除を優先し、次の押下だけBrowserを戻す',async()=>{
 const f=browserVR();let contents;
 try{
  f.enterVR();
  assert.equal((await f.browser.action({record:f.record},'fullscreen')).fullscreen,true);
  await f.browser.action({record:f.record},'header-toggle-pin');
  contents=f.header.webContents;
  assert.equal(f.browser.trustedHeader({sender:contents,senderFrame:contents.mainFrame}),f.record,'実ヘッダーURLから所有Browserを解決する');
  assert.equal(f.browser.trustedHeader({sender:contents,senderFrame:{url:contents.mainFrame.url}}),null);
  assert.equal(f.press(contents,{control:true}).count,0);assert.equal(f.displays.isActive(f.owner),true);
  assert.equal(f.press(contents).count,1);assert.equal(f.displays.isActive(f.owner),false);
  assert.equal(f.record.window.isFullScreen(),true,'VR解除と同じキーではBrowserの全画面状態を変えない');
  for(const target of [contents,f.host,f.page]){f.press(target,{isAutoRepeat:true});assert.equal(f.record.window.isFullScreen(),true);}
  f.press(contents,{type:'keyUp'});assert.equal(f.record.window.isFullScreen(),true);
  f.press(contents);assert.equal(f.record.window.isFullScreen(),false);
 }finally{f.close();}
 assert.equal(contents.listenerCount('before-input-event'),0);assert.equal(f.header.isDestroyed(),true);
 assert.equal(f.browser.trustedHeader({sender:contents,senderFrame:contents.mainFrame}),null);
});

function assertBrowserPin(f,requested){
 const locked=!!f.record.owner&&f.displays.isActive(f.owner)||f.record.window.isFullScreen();
 assert.deepEqual(f.windowPins.state(f.record.window),{pinned:requested||locked,locked});
 assert.equal(f.record.window.isAlwaysOnTop(),requested||locked);
}
async function browserMode(f,mode,active){
 if(mode==='vr'){if(active)f.enterVR();else f.displays.leave(f.owner);}
 else{if(f.record.window.isFullScreen()!==active)assert.equal((await f.browser.action({record:f.record},'fullscreen')).ok,true);}
}
for(const initialPin of [false,true])for(const firstIn of ['vr','browser'])for(const firstOut of ['vr','browser']){
 test(`Browserピン: 初期${initialPin?'ON':'OFF'}・${firstIn}先入り/${firstOut}先抜けでも両方解除後だけ元へ戻る`,async()=>{
  const f=browserVR({initialPin});let requested=initialPin;
  try{
   for(let cycle=0;cycle<3;cycle++){
    assertBrowserPin(f,requested);
    for(const mode of [firstIn,firstIn==='vr'?'browser':'vr']){
     await browserMode(f,mode,true);assertBrowserPin(f,requested);
     assert.equal(f.windowPins.toggle(f.record.window).locked,true,'ロック中のtoggleで利用者の元の選択を変えない');
    }
    for(const mode of [firstOut,firstOut==='vr'?'browser':'vr']){await browserMode(f,mode,false);assertBrowserPin(f,requested);}
    requested=!requested;assert.equal(f.windowPins.toggle(f.record.window).pinned,requested,'最後の解除後は通常のピン操作に戻る');
   }
  }finally{f.close();}
 });
}
for(const initialPin of [false,true])test(`Browserピン: 初期${initialPin?'ON':'OFF'}のVR再入場と全画面再入場を古い状態で上書きしない`,async()=>{
 const f=browserVR({initialPin});
 try{
  for(const [mode,active] of [['vr',true],['browser',true],['vr',false],['vr',true],['browser',false],['browser',true],['vr',false],['browser',false],['browser',true],['vr',true],['browser',false],['vr',false]]){
   await browserMode(f,mode,active);assertBrowserPin(f,initialPin);
  }
 }finally{f.close();}
});
for(const initialPin of [false,true])for(const firstIn of ['vr','browser'])for(const focus of ['host','page','header']){
 test(`Browserピン/F11: 初期${initialPin?'ON':'OFF'}・${firstIn}先入り・${focus}操作の解除と反復`,async()=>{
  const f=browserVR({initialPin});
  try{
   for(let cycle=0;cycle<3;cycle++){
    for(const mode of [firstIn,firstIn==='vr'?'browser':'vr']){await browserMode(f,mode,true);assertBrowserPin(f,initialPin);}
    if(focus==='header'&&!f.header)await f.browser.action({record:f.record},'header-toggle-pin');
    const contents=focus==='header'?f.header.webContents:f[focus];
    f.press(contents);assert.equal(f.displays.isActive(f.owner),false);assert.equal(f.record.window.isFullScreen(),true);assertBrowserPin(f,initialPin);
    f.press(contents,{isAutoRepeat:true});assert.equal(f.record.window.isFullScreen(),true);assertBrowserPin(f,initialPin);
    f.press(contents);assert.equal(f.record.window.isFullScreen(),false);assertBrowserPin(f,initialPin);
    f.press(contents,{isAutoRepeat:true});assert.equal(f.record.window.isFullScreen(),false);assertBrowserPin(f,initialPin);
   }
  }finally{f.close();}
 });
}
test('Browserピン: desktopのVR同期は破棄済み・別所有者のBrowserを参照しない',()=>{
 const f=browserVR();
 try{
  for(const [owner,destroyed] of [[f.owner,true],[{},false]]){
   const window={isDestroyed:()=>destroyed,isFullScreen(){throw Error('参照してはいけないBrowser');}};
   f.windows.set(window,{kind:'browser',owner,window});
  }
  assert.doesNotThrow(()=>f.enterVR());assert.doesNotThrow(()=>f.displays.leave(f.owner));assertBrowserPin(f,false);
 }finally{f.close();}
});
for(const initialPin of [false,true])test(`単独Browserピン: 初期${initialPin?'ON':'OFF'}を保ち、無関係のIDEのVRとは独立する`,()=>{
 const f=browserVR({initialPin,standalone:true});
 try{
  for(let cycle=0;cycle<3;cycle++){
   f.enterVR();assertBrowserPin(f,initialPin);
   f.press(f.host);assert.equal(f.record.window.isFullScreen(),true);assert.equal(f.displays.isActive(f.owner),true);assertBrowserPin(f,initialPin);
   assert.equal(f.windowPins.toggle(f.record.window).locked,true);
   f.press(f.page,{isAutoRepeat:true});assert.equal(f.record.window.isFullScreen(),true);assertBrowserPin(f,initialPin);
   f.press(f.page);assert.equal(f.record.window.isFullScreen(),false);assert.equal(f.displays.isActive(f.owner),true);assertBrowserPin(f,initialPin);
   f.displays.leave(f.owner);assertBrowserPin(f,initialPin);
  }
 }finally{f.close();}
});

// 実mainの通常窓・本文・F11ヘッダーの購読を通す。説明はページ内で別窓を作らない。OS入力の試験ではない。
for(const fullscreen of [false,true])for(const focus of fullscreen?['host','page','header']:['host','page'])test(`要素連携Esc配線: ${fullscreen?'F11':'通常'}/${focus}から選択を解除する`,async t=>{
 t.mock.timers.enable({apis:['setInterval','Date']});
 const f=browserVR({standalone:true}),flush=async()=>{for(let i=0;i<50;i++)await Promise.resolve();};
 try{
  f.browser.setAvailable(f.record,true);await flush();
  if(fullscreen){f.press(f.host);f.movePointer({x:500,y:1});t.mock.timers.tick(240);await flush();}
  for(let cycle=0;cycle<2;cycle++){
   const result=await f.browser.action({record:f.record},'element-toggle');assert.equal(result.ok,true);assert.equal(result.elementPicking,true);assert.equal(f.inspectMode,'searchForNode');
   const source=focus==='header'?f.header.webContents:f[focus];
   assert.equal(f.press(source,{key:'Escape'}).count,1);await flush();
   assert.equal(f.inspectMode,'none');assert.equal(f.popup,undefined,'要素選択中のElectronダイアログを作らない');assert.equal((await f.browser.action({record:f.record},'state')).elementPicking,false);assert.equal(f.record.window.isFullScreen(),fullscreen,'EscではF11状態を変えない');
  }
  assert.ok(f.commands.some(c=>c.method==='Overlay.hideHighlight'));assert.ok(f.commands.some(c=>c.method==='Overlay.disable'));assert.ok(!f.commands.some(c=>/^(DOM\.disable|.*detach)$/i.test(c.method)),'共有CDPとDOMを維持する');
 }finally{f.close();}
});
