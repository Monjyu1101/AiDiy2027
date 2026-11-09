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
const require=createRequire(import.meta.url);
const {createBrowserAnalysisWindows}=require('../デスクトップ/ブラウザ解析窓.cjs');
const {createBrowserViews}=require('../デスクトップ/ブラウザ.cjs');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
function fixture(){
 const windows=[];let nextLoad=Promise.resolve(),target={url:'https://example.test/form',title:'入力画面'};
 const parent=Object.assign(new EventEmitter(),{isDestroyed:()=>false,isFullScreen:()=>false,getBounds:()=>({x:20,y:30,width:1200,height:800}),getContentBounds:()=>({x:20,y:30,width:1200,height:800}),webContents:Object.assign(new EventEmitter(),{getZoomFactor:()=>1.25,send(){}}),contentView:{addChildView(){}}});
 class Window extends EventEmitter{
  constructor(options){super();this.options=options;this.destroyed=false;this.shown=0;this.focused=0;this.load=nextLoad;windows.push(this);this.webContents=Object.assign(new EventEmitter(),{mainFrame:{url:''},setZoomFactor:value=>{this.zoom=value;},setWindowOpenHandler:handler=>{this.newWindow=handler;}});}
  loadURL(url){this.url=url;return this.load.then(()=>{this.webContents.mainFrame.url=url;});}
  isDestroyed(){return this.destroyed;}
  show(){this.shown++;}
  focus(){this.focused++;}
  destroy(){if(this.destroyed)return;this.destroyed=true;this.emit('closed');}
 }
 const record={kind:'browser',window:parent,url:'http://127.0.0.1:12345/'},screen={getDisplayMatching:()=>({workArea:{x:0,y:0,width:1280,height:900}})};
 const options={BrowserWindow:Window,screen,context:()=>({...target})},manager=createBrowserAnalysisWindows(options);
 return{manager,windows,parent,record,options,setLoad:value=>{nextLoad=value;},setTarget:value=>{target=value;},event:(window=windows.at(-1))=>({sender:window.webContents,senderFrame:window.webContents.mainFrame})};
}
test('analysis opens one parented window, preserves context and reuses repeated opens',async()=>{
 const f=fixture(),load=deferred();f.setLoad(load.promise);
 const first=f.manager.open(f.record),second=f.manager.open(f.record);assert.equal(f.windows.length,1);assert.equal(f.windows[0].shown,0);
 load.resolve();await Promise.all([first,second]);const w=f.windows[0];
 assert.equal(w.options.parent,f.parent);assert.equal(w.options.frame,false);assert.equal(w.options.webPreferences.nodeIntegration,false);assert.equal(w.zoom,1.25);
 assert.deepEqual(w.newWindow(),{action:'deny'});assert.equal(f.manager.trusted(f.event()),f.record);
 f.setTarget({url:'https://other.test/',title:'別画面'});assert.equal(f.manager.context(f.event()).url,'https://example.test/form');
 await f.manager.open(f.record);assert.equal(f.windows.length,1);assert.ok(w.focused>=2);
});
test('analysis rejects other frames/URLs/senders and removes sender authority on close',async()=>{
 const f=fixture();await f.manager.open(f.record);const event=f.event();
 assert.equal(f.manager.trusted({...event,senderFrame:{url:event.senderFrame.url}}),null);
 event.senderFrame.url='https://example.test/';assert.equal(f.manager.trusted(event),null);
 event.senderFrame.url=f.windows[0].url;assert.equal(f.manager.hasSender(event.sender),true);
 f.manager.close(f.record);assert.equal(f.manager.trusted(event),null);assert.equal(f.manager.hasSender(event.sender),false);assert.equal(f.parent.listenerCount('closed'),0);
 await f.manager.open(f.record);assert.equal(f.windows.length,2);
});
test('parent closed during loading cleans up the child and never shows it late',async()=>{
 const f=fixture(),load=deferred();f.setLoad(load.promise);const opened=f.manager.open(f.record);
 f.parent.emit('closed');load.resolve();await opened;
 assert.equal(f.windows[0].destroyed,true);assert.equal(f.windows[0].shown,0);assert.equal(f.manager.hasSender(f.windows[0].webContents),false);
});
test('failed load cleans up and retry works; old rejection never closes a newer child',async()=>{
 const f=fixture(),load=deferred();f.setLoad(load.promise);const old=f.manager.open(f.record);f.manager.close(f.record);
 f.setLoad(Promise.resolve());await f.manager.open(f.record);load.reject(Error('cancelled'));await assert.rejects(old,/cancelled/);
 assert.equal(f.windows[1].destroyed,false);
 f.manager.close(f.record);f.setLoad(Promise.reject(Error('load failed')));await assert.rejects(f.manager.open(f.record),/load failed/);
 assert.equal(f.windows[2].destroyed,true);f.setLoad(Promise.resolve());await f.manager.open(f.record);assert.equal(f.windows[3].shown,1);
});
test('native page remains visible with the same bounds during analysis, including reopen and tools reconnect',async()=>{
 const f=fixture();let view;
 class View{constructor(){view=this;this.webContents=Object.assign(new EventEmitter(),{url:'',getURL(){return this.url;},getTitle:()=> '入力画面',isLoading:()=>false,isDestroyed:()=>false,navigationHistory:{canGoBack:()=>false,canGoForward:()=>false},loadURL:async function(url){this.url=url;},setWindowOpenHandler(){},close(){},stop(){}});}setVisible(value){this.visible=value;}setBounds(value){this.bounds=value;}}
 let browser;
 browser=createBrowserViews({...f.options,WebContentsView:View,projectRoot:'C:/fixture',session:{fromPartition:()=>({setPermissionRequestHandler(){},setPermissionCheckHandler(){},webRequest:{onBeforeRequest(){}}})},trustedEvent:event=>event.record||browser.trustedAnalysis(event)});
 browser.attach(f.record,'https://example.test/form');
 const host={record:f.record};await browser.action(host,'bounds',{left:0,top:100,width:960,height:540,viewportWidth:960,viewportHeight:640});
 assert.equal(view.visible,true);const bounds={...view.bounds};await browser.action(host,'open-analysis');
 assert.equal(view.visible,true);assert.deepEqual(view.bounds,bounds);
 const child=f.event();assert.equal(browser.trustedAnalysis(child),f.record);assert.equal((await browser.action(child,'analysis-window-context')).context.url,'https://example.test/form');
 assert.equal((await browser.action(host,'analysis-window-context')).ok,false);
 assert.equal((await browser.action(host,'analysis-window-close')).ok,false);
 assert.equal((await browser.action(child,'analysis-window-close')).ok,true);assert.equal(view.visible,true);
 await browser.action(host,'open-analysis');browser.setAvailable(f.record,false);assert.equal(view.visible,false);browser.setAvailable(f.record,true);assert.equal(view.visible,true);
 assert.equal((await browser.action(host,'draft-dialog',true)).ok,false);assert.equal(view.visible,true);
 f.parent.emit('closed');assert.equal(f.windows.at(-1).destroyed,true);
});
test('analysis IPC is narrowly routed and title styling does not change shared headers',()=>{
 const desktop=readFileSync(new URL('../desktop.cjs',import.meta.url),'utf8');
 assert.match(desktop,/isAnalysisSender\(event.sender\).*analysis-window-context.*analysis-window-close.*analysis-select-source/);
 assert.match(desktop,/function trustedBrowserEvent\(event\)\{return trustedEvent\(event\)\|\|browserViews\?\.trustedAnalysis\(event\)\|\|browserViews\?\.trustedDraft\?\.\(event\);\}/);
 const source=readFileSync(new URL('../src/dialog/ブラウザ解析ダイアログ.vue',import.meta.url),'utf8');
 assert.match(source,/\.browser-analysis-dialog header\{[^}]*min-height:26px;[^}]*padding:0/);
 assert.match(source,/\.browser-analysis-dialog header button\{width:24px;height:24px;padding:0/);
 assert.match(source,/\.browser-analysis-native>header button\{-webkit-app-region:no-drag\}/);
});

// 別窓の固定URLとIDE案内を両立し、閉じた子窓の遅延応答は再利用しない。
test('native analysis context keeps the original page during IDE discovery and rejects closed or replaced child senders',async()=>{
 const {createBrowserAnalysisContext}=require('../デスクトップ/ブラウザ解析連携.cjs');
 const f=fixture();f.setTarget({url:'https://example.test/a',title:'A',projectPath:'/fixture',canSelectSource:false});await f.manager.open(f.record);
 let pending=deferred();const action=createBrowserAnalysisContext({trustedEvent:f.manager.trusted,context:(_record,event)=>f.manager.context(event),discover:()=>pending.promise});
 const event=f.event(),first=action(event);f.setTarget({url:'https://example.test/b',title:'B',projectPath:'/fixture',canSelectSource:false});pending.resolve({ideRunning:true,viewerAvailable:true});
 assert.deepEqual((await first).context,{url:'https://example.test/a',title:'A',projectPath:'/fixture',canSelectSource:false,ideRunning:true,viewerAvailable:true});
 pending=deferred();const late=action(event);f.manager.close(f.record);await f.manager.open(f.record);pending.resolve({ideRunning:true,viewerAvailable:true});assert.equal((await late).ok,false);assert.equal(f.manager.context(f.event()).url,'https://example.test/b');f.manager.close(f.record);
});
