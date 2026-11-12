// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import browser from '../デスクトップ/ブラウザ.cjs';
const flush=async()=>{for(let n=0;n<20;n++)await Promise.resolve();};
const deferred=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return{promise,resolve};};
const image={isEmpty:()=>false,toPNG:()=>Buffer.from('png'),getSize:()=>({width:800,height:600})};
function fixture(options={}){
 let page;const views=[],registered=[],sent=[],writes=[],images=[];
 class View{
  constructor(){views.push(this);page=this.webContents=Object.assign(new EventEmitter(),{url:'',getURL(){return this.url;},getTitle:()=>'',isLoading:()=>false,isDestroyed(){return !!this.destroyed;},navigationHistory:{canGoBack:()=>false,canGoForward:()=>false},loadURL:async function(url){this.url=url;},setWindowOpenHandler(handler){this.popup=handler;},stop(){this.stopped=true;},close(){this.destroyed=true;this.emit('destroyed');},capturePage(){const job=deferred();images.push(job);return job.promise;}});}
  setVisible(value){this.visible=value;}setBounds(value){this.bounds=value;}
 }
 const window=Object.assign(new EventEmitter(),{isDestroyed:()=>false,isFullScreen:()=>false,getContentBounds:()=>({x:0,y:0,width:900,height:700}),contentView:{addChildView(){}},webContents:Object.assign(new EventEmitter(),{send:(_channel,value)=>sent.push(value)})});
 const record={kind:'browser',window,url:'http://127.0.0.1:1234/',browserSession:'aidiy_browser test',browserTabId:'page'};
 const control=browser.createBrowserViews({projectRoot:'/fixture',WebContentsView:View,session:{fromPartition:()=>({setPermissionRequestHandler(){},setPermissionCheckHandler(){},webRequest:{onBeforeRequest(){}}})},trustedEvent:event=>event.record,captureImage:()=>{const job=deferred();writes.push(job);return job.promise;}});
 control.attach(record,Object.hasOwn(options,'initialURL')?options.initialURL:'https://example.test/',true,options.connected??true,'online',(contents,controls)=>registered.push({contents,controls}));
 const action=(name,value)=>control.action({record},name,value);
 const save=async()=>{const result=action('capture');await flush();images.at(-1).resolve(image);await flush();writes.at(-1).resolve({path:'temp/input/browser.png'});return result;};
 return{control,views,registered,page,window,record,sent,writes,images,action,save,close:()=>window.emit('closed')};
}

test('Browser tabs: independent pages, selection, draft IDs, background updates and close',async t=>{
 const f=fixture();t.after(f.close);
 const first=await f.action('state'),second=await f.action('tab-new','https://second.test/');
 assert.equal(second.ok,true);assert.equal(second.tabs.length,2);assert.notEqual(first.activeTabId,second.activeTabId);
 assert.equal(f.views[0].visible,false);assert.equal(f.views[1].visible,true);
 assert.equal(f.registered[1].controls.id,second.activeTabId);
 assert.match((await f.action('draft')).request.text,new RegExp('tab_id: '+second.activeTabId));
 assert.equal((await f.action('analysis-context')).context.activeTabId,second.activeTabId);
 await f.action('tab-select',first.activeTabId);
 assert.equal((await f.action('state')).url,first.url);
 f.views[1].webContents.url='https://second.test/background';f.views[1].webContents.emit('did-navigate');
 assert.equal((await f.action('state')).url,first.url);
 assert.equal((await f.action('tab-select','missing')).ok,false);
 await f.action('tab-close',second.activeTabId);assert.equal(f.views[1].webContents.destroyed,true);
 const last=await f.action('tab-close',first.activeTabId);
 assert.equal(last.tabs.length,1);assert.equal(last.url,'about:blank');assert.notEqual(last.activeTabId,first.activeTabId);
 assert.equal(f.views[0].webContents.destroyed,true);
});
test('Browser tabs: collapse and offline hide all pages, closing window disposes every page',async()=>{
 const f=fixture();await f.action('tab-new');f.control.setPanelCollapsed(f.record,true);
 assert.ok(f.views.every(view=>!view.visible));
 f.control.setAvailable(f.record,false);assert.ok(f.views.every(view=>view.webContents.stopped));
 f.control.setAvailable(f.record,true);assert.ok(f.views.every(view=>!view.visible));
 f.control.setPanelCollapsed(f.record,false);assert.equal(f.views.filter(view=>view.visible).length,1);
 f.close();assert.ok(f.views.every(view=>view.webContents.destroyed));
});
test('Browser tabs: popup opens new tab but unsafe URLs and host origin remain blocked',async t=>{
 const f=fixture();t.after(f.close);
 assert.deepEqual(f.page.popup({url:'https://popup.test/'}),{action:'deny'});
 assert.equal((await f.action('state')).tabs.length,2);
 for(const url of ['javascript:alert(1)','http://127.0.0.1:1234/private','file:///outside.html']){
  assert.equal((await f.action('tab-new',url)).ok,false);
 }
 assert.equal((await f.action('state')).tabs.length,2);
});
test('Browser tabs: switching away and back invalidates pending capture at same URL',async t=>{
 const f=fixture();t.after(f.close);const first=await f.action('state');
 const pending=f.action('capture');await flush();assert.equal(f.images.length,1);
 await f.action('tab-new',first.url);await f.action('tab-select',first.activeTabId);
 f.images[0].resolve(image);const result=await pending;
 assert.equal(result.ok,false);assert.equal(f.writes.length,0);
});

test('Browser tabs: availability round-trip invalidates an in-flight capture',async t=>{
 const f=fixture();t.after(f.close);const pending=f.action('capture');await flush();
 f.control.setAvailable(f.record,false);f.control.setAvailable(f.record,true);
 f.images[0].resolve(image);assert.equal((await pending).ok,false);assert.equal(f.writes.length,0);
});
test('Browser tabs: an action waiting for element cleanup cannot operate on a switched tab',async t=>{
 const f=fixture();t.after(f.close);const pending=f.action('capture');
 await f.action('tab-new','https://second.test/');
 assert.equal((await pending).ok,false);assert.equal(f.images.length,0);
});

test('Browser tabs: X close after collapse never accesses destroyed parent/View handles',async()=>{
 const f=fixture();await f.action('tab-new');f.control.setPanelCollapsed(f.record,true);
 const pages=f.views.map(view=>view.webContents);
 f.window.isDestroyed=()=>true;
 Object.defineProperty(f.window,'contentView',{get(){throw Error('Object has been destroyed: contentView');}});
 for(const view of f.views){
  view.setVisible=()=>{throw Error('Object has been destroyed: View');};
  Object.defineProperty(view,'webContents',{get(){throw Error('Object has been destroyed: WebContentsView');}});
 }
 assert.doesNotThrow(f.close);
 assert.ok(pages.every(page=>page.destroyed),'all surviving WebContents are explicitly released');
 assert.equal(f.record.openBrowserTab,undefined);
 assert.equal((await f.action('state')).ok,false);
});

test('ホームは窓初期URLを固定し、接続状態変更やタブ切替でも選択タブだけを初期URLへ戻す',async t=>{
 const f=fixture();t.after(f.close);const first=await f.action('state');await f.action('tab-new','https://second.test/');
 for(const [mode,connected] of [['online',true],['online',false],['offline',false],['online',true]]){
  f.control.setAvailable(f.record,true,connected,mode);const result=await f.action('home');assert.equal(result.ok,true);assert.equal(result.url,first.url);assert.equal(result.homeURL,first.url);assert.equal(f.views[0].webContents.url,first.url);
 }
 await f.action('tab-select',first.activeTabId);await f.action('navigate','https://changed.test/');assert.equal((await f.action('home')).url,first.url);
 f.control.setAvailable(f.record,false,false);assert.equal((await f.action('home')).ok,false);
});

test('Browser page failure: trusted body View preserves URL/tab ID, switches, recovers and stays out of CDP',async t=>{
 const f=fixture();t.after(f.close);const first=await f.action('state');
 f.window.webContents.getZoomFactor=()=>1;
 await f.action('bounds',{left:6,top:80,width:888,height:610});
 f.page.emit('did-fail-load',{},-105,'ERR_NAME_NOT_RESOLVED',first.url,true);
 const status=f.views.at(-1);
 assert.equal((await f.action('state')).pageLoadFailed,true);
 f.page.emit('did-finish-load');assert.equal((await f.action('state')).pageLoadFailed,true,'Chromium error-page finish must not hide failure');
 assert.equal((await f.action('state')).url,first.url);assert.equal((await f.action('state')).activeTabId,first.activeTabId);
 assert.equal(f.registered.length,1);assert.equal(f.views[0].visible,false);assert.equal(status.visible,true);
 assert.deepEqual(status.bounds,{x:6,y:80,width:888,height:610});
 f.window.isFullScreen=()=>true;await f.action('bounds',{left:0,top:0,width:900,height:700});
 assert.deepEqual(status.bounds,{x:0,y:0,width:900,height:700});
 assert.match(decodeURIComponent(status.webContents.url),/default-src 'none'/);
 assert.equal((await f.action('capture')).ok,false);
 let prevented=false;status.webContents.emit('will-navigate',{preventDefault(){prevented=true;}},'https://evil.test/');assert.equal(prevented,true);
 assert.deepEqual(status.webContents.popup({url:'https://evil.test/'}),{action:'deny'});
 await f.action('tab-new','https://second.test/');assert.equal(status.visible,false);
 await f.action('tab-select',first.activeTabId);assert.equal(status.visible,true);
 f.control.setPanelCollapsed(f.record,true);assert.equal(status.visible,false);
 f.control.setPanelCollapsed(f.record,false);assert.equal(status.visible,true);
 f.control.setAvailable(f.record,false);assert.equal(status.visible,false);
 f.control.setAvailable(f.record,true);assert.equal(status.visible,true);
 f.page.emit('did-start-navigation',{},first.url,false,true);assert.equal(status.visible,false);
 f.page.emit('did-finish-load');assert.equal((await f.action('state')).pageLoadFailed,false);assert.equal(f.views[0].visible,true);
});
test('Browser page failure: ignore aborted/subframe/stale failures; native overlay cleanup after destroyed window',async()=>{
 const f=fixture();const url=(await f.action('state')).url;
 f.page.emit('did-fail-load',{},-3,'ERR_ABORTED',url,true);
 f.page.emit('did-fail-load',{},-105,'ERR_NAME_NOT_RESOLVED',url,false);
 f.page.emit('did-fail-load',{},-105,'ERR_NAME_NOT_RESOLVED','https://stale.test/',true);
 assert.equal(f.views.length,1);
 f.page.emit('did-fail-load',{},-105,'ERR_NAME_NOT_RESOLVED',url,true);
 const pages=f.views.map(view=>view.webContents);f.window.isDestroyed=()=>true;
 Object.defineProperty(f.window,'contentView',{get(){throw Error('destroyed');}});
 for(const view of f.views){view.setVisible=()=>{throw Error('destroyed');};Object.defineProperty(view,'webContents',{get(){throw Error('destroyed');}});}
 assert.doesNotThrow(f.close);assert.ok(pages.every(page=>page.destroyed));
});

test('Browser new tabs share immutable window home, not explicit tab URL or changed tools state',async t=>{
 const f=fixture();t.after(f.close);
 f.control.setAvailable(f.record,true,false);
 assert.equal((await f.action('tab-new')).url,'https://example.test/');
 assert.equal((await f.action('tab-new','https://explicit.test/')).url,'https://explicit.test/');
 assert.equal((await f.action('home')).url,'https://example.test/');
 f.control.setAvailable(f.record,true,true);
 assert.equal((await f.action('tab-new')).url,'https://example.test/');
});
test('Browser initial URL without tools stays Google; second window keeps its own explicit home',async t=>{
 const f=fixture({initialURL:undefined,connected:false});t.after(f.close);
 const first=await f.action('state');assert.equal(first.homeURL,'https://www.google.com/ai');assert.equal(first.url,first.homeURL);
 f.control.setAvailable(f.record,true,true);assert.equal((await f.action('home')).url,first.homeURL);
 const window=Object.assign(new EventEmitter(),{isDestroyed:()=>false,isFullScreen:()=>false,getContentBounds:()=>({x:0,y:0,width:900,height:700}),contentView:{addChildView(){}},webContents:Object.assign(new EventEmitter(),{send(){}})});
 const record={kind:'browser',window,url:'http://127.0.0.1:1234/',browserSession:'second'};
 f.control.attach(record,'https://custom.test/start?query=1',true,true);t.after(()=>window.emit('closed'));
 const action=(name,value)=>f.control.action({record},name,value);
 await action('navigate','https://elsewhere.test/');
 assert.equal((await action('home')).url,'https://custom.test/start?query=1');
 assert.equal((await action('tab-new')).homeURL,'https://custom.test/start?query=1');
 assert.equal((await f.action('tab-new')).url,first.homeURL);
});

test('Browser page failure: main redirect destination fails, but stale and iframe redirects do not replace it',async t=>{
 const f=fixture();t.after(f.close);const initial=(await f.action('state')).url;
 f.page.emit('did-start-navigation',{},'https://link.test/',false,true);
 f.page.emit('did-redirect-navigation',{},'https://destination.test/',false,true);
 f.page.emit('did-redirect-navigation',{},'https://iframe.test/',false,false);
 f.page.emit('did-fail-load',{},-105,'ERR_NAME_NOT_RESOLVED',initial,true);
 f.page.emit('did-fail-load',{},-105,'ERR_NAME_NOT_RESOLVED','https://link.test/',true);
 assert.equal((await f.action('state')).pageLoadFailed,false);
 f.page.emit('did-fail-load',{},-105,'ERR_NAME_NOT_RESOLVED','https://destination.test/',true);
 assert.equal((await f.action('state')).pageLoadFailed,true);
 f.page.emit('did-start-navigation',{},'https://new.test/',false,true);
 f.page.emit('did-fail-load',{},-105,'ERR_NAME_NOT_RESOLVED','https://destination.test/',true);
 assert.equal((await f.action('state')).pageLoadFailed,false);
});

for(const synchronousStart of [false,true])test('Browser delayed loadURL reject cannot fail another navigation or same-URL revisit; synchronous start='+synchronousStart,async t=>{
 const f=fixture();t.after(f.close);let reject;
 const target='https://pending.test/';
 f.page.loadURL=url=>{if(synchronousStart)f.page.emit('did-start-navigation',{},url,false,true);return new Promise((_,no)=>{reject=no;});};
 await f.action('navigate',target);
 if(!synchronousStart)f.page.emit('did-start-navigation',{},target,false,true);
 f.page.emit('did-start-navigation',{},'https://other.test/',false,true);
 f.page.emit('did-start-navigation',{},target,false,true);
 reject(new Error('net::ERR_FAILED'));await flush();
 assert.equal((await f.action('state')).pageLoadFailed,false);assert.equal(f.views.length,1);
 f.page.emit('did-fail-load',{},-105,'ERR_NAME_NOT_RESOLVED',target,true);
 assert.equal((await f.action('state')).pageLoadFailed,true,'current main-frame failure still surfaces');
});
