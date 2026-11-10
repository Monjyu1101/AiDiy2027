// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import capture from '../デスクトップ/ブラウザ撮影.cjs';
import browser from '../デスクトップ/ブラウザ.cjs';
import layout from '../デスクトップ/window-layout.cjs';
import pins from '../デスクトップ/最前面ピン.cjs';
import {openBrowser} from '../src/components/ブラウザ/起動.js';
const {HOME,browserURL,createBrowserViews}=browser;
test('Browser: ローカル既定、検索語・URL・開発サーバーの解決、実行スキーム拒否',()=>{
 assert.equal(browserURL(''),HOME);
 assert.equal(browserURL('宇宙 IDE'),'https://www.google.com/ai?q='+encodeURIComponent('宇宙 IDE'));
 assert.equal(browserURL('example.com/a'),'https://example.com/a');
 assert.equal(browserURL('example.com:8080/a'),'https://example.com:8080/a');
 assert.equal(browserURL('localhost:8090/'),'http://localhost:8090/');
 assert.equal(browserURL('http://127.0.0.1:8090/'),'http://127.0.0.1:8090/');
 assert.equal(browserURL('file:///C:/project/index.html'),'file:///C:/project/index.html');
 for(const value of ['javascript:alert(1)','data:text/html,test','https://user:pass@example.com',null])assert.throws(()=>browserURL(value));
});

test('Browser: 選択ファイルは実絶対パスのfile URL、相対リソースはプロジェクト内だけ許可',t=>{
 const root=mkdtempSync(join(tmpdir(),'aidiy-browser-files-'));
 t.after(()=>{assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep));rmSync(root,{recursive:true,force:true});});
 const name='宇宙 # 100%.html',file=join(root,name);writeFileSync(file,'<h1>test</h1>');writeFileSync(join(root,'style.css'),'body{}');
 const url=pathToFileURL(file).href;assert.equal(browser.browserFileURL(root,name),url);assert.equal(browserURL(file),url);assert.equal(browserURL(url),url);
 assert.throws(()=>browser.browserFileURL(root,'../outside.html'));assert.throws(()=>browser.browserFileURL(root,'missing.html'));
 let filter;const isolated={setPermissionRequestHandler(){},setPermissionCheckHandler(){},webRequest:{onBeforeRequest(fn){filter=fn;}}};
 const views=createBrowserViews({session:{fromPartition:()=>isolated},projectRoot:root});
 assert.equal(views.allowedURL(url),true);assert.equal(views.allowedURL(url+'#section'),true);assert.equal(views.allowedURL(pathToFileURL(join(root,'../outside.html')).href),false);
 filter({url:pathToFileURL(join(root,'style.css')).href},result=>assert.equal(result.cancel,false));
 filter({url:pathToFileURL(join(root,'../outside.css')).href},result=>assert.equal(result.cancel,true));
});
test('Browser: ページを権限なしで分離し、IDEへの要求と別画面IPCを拒否、終了で解放',async()=>{
 let view,filter;const sent=[];
 const isolated={setPermissionRequestHandler(fn){this.request=fn;},setPermissionCheckHandler(fn){this.check=fn;},webRequest:{onBeforeRequest(fn){filter=fn;}}};
 class View{
  constructor(options){view=this;this.options=options;this.webContents=new EventEmitter();Object.assign(this.webContents,{url:'',getURL(){return this.url;},getTitle:()=>'',isLoading:()=>false,isDestroyed:()=>false,navigationHistory:{canGoBack:()=>false,canGoForward:()=>false},loadURL:async function(url){this.url=url;},setWindowOpenHandler(fn){this.popup=fn;},stop(){this.stops=(this.stops||0)+1;},close(options){this.closed=options;}});}
  setVisible(value){this.visible=value;}setBounds(value){this.bounds=value;}
 }
 const window=new EventEmitter();Object.assign(window,{bounds:{x:0,y:0,width:1000,height:700},isDestroyed:()=>false,isMaximized:()=>!!window.maximized,unmaximize(){this.maximized=false;this.emit('unmaximize');},getBounds(){return this.bounds;},setBounds(bounds){this.bounds=bounds;this.size=[bounds.width,bounds.height];this.emit('resize');},contentView:{addChildView(){}},getContentBounds:()=>window.bounds,webContents:{getZoomFactor:()=>1.25,send:(...args)=>sent.push(args)}});
 const record={kind:'browser',window,url:'http://127.0.0.1:1234/',browserSession:'aidiy_ide 2',browserTabId:'sender-tab'},event={record};
 window.webContents=Object.assign(new EventEmitter(),window.webContents);
 window.setAlwaysOnTop=value=>{window.top=value;};
 const windowPins=pins.createWindowPins();windowPins.register(window);
 window.isFullScreen=()=>!!window.fullscreen;window.setFullScreen=value=>{window.fullscreen=value;window.emit(value?'enter-full-screen':'leave-full-screen');};
 let area={x:0,y:0,width:1920,height:2000};
 const captures=[];let release;
 const control=createBrowserViews({projectRoot:resolve('.'),WebContentsView:View,session:{fromPartition:name=>{assert.equal(name,'aidiy-browser');return isolated;}},screen:{getDisplayMatching:()=>({workArea:area}),getCursorScreenPoint:()=>({x:-100,y:-100})},windowPins,captureImage:async value=>{captures.push(value);return{path:'temp/input/browser.png'};},trustedEvent:event=>event.record});
 control.attach(record,HOME,false);assert.equal(view.webContents.url,'');
 assert.equal((await control.action(event,'state')).available,false);
 control.setAvailable(record,true);assert.equal(view.webContents.url,HOME);
 assert.equal((await control.action(event,'draft')).request.text,'session: aidiy_ide 2\ntab_id: sender-tab\n'+HOME);
 assert.equal((await control.action({record:{...record}},'draft')).ok,false,'他レコードでは送信元を解決しない');
 control.setAvailable(record,true,false);
 assert.equal((await control.action(event,'state')).connected,false);
 assert.equal((await control.action(event,'state')).mode,'online','Tools喪失は復帰待ちのonlineモード');
 control.setAvailable(record,true,false,'offline');
 assert.equal((await control.action(event,'state')).mode,'offline');
 control.setAvailable(record,true,false);
 assert.equal((await control.action(event,'state')).mode,'offline','一時エラーで孤立モードを上書きしない');
 control.setAvailable(record,true,false,'online');
 assert.equal((await control.action(event,'state')).mode,'online');
 assert.equal((await control.action(event,'navigate','https://example.test/offline')).ok,true);
 assert.equal((await control.action(event,'draft')).ok,true);
 assert.equal((await control.action(event,'open-analysis')).ok,false);
 await control.navigate(record,HOME);
 control.setAvailable(record,false);assert.equal(view.webContents.stops,1);control.setAvailable(record,true);assert.equal(view.webContents.url,HOME);
 assert.equal(view.options.webPreferences.sandbox,true);assert.equal(view.options.webPreferences.nodeIntegration,false);assert.equal(view.options.webPreferences.preload,undefined);
 assert.equal(isolated.check(),false);isolated.request(null,'media',allowed=>assert.equal(allowed,false));
 filter({url:record.url+'api/connection'},result=>assert.equal(result.cancel,true));
 assert.equal((await control.action({record:{kind:'ide'}},'navigate',HOME)).ok,false);
 assert.equal((await control.action(event,'navigate',record.url)).ok,false);
 assert.equal((await control.action(event,'navigate','file:///tmp/a.html')).ok,false);
 await control.action(event,'bounds',{left:0,top:90,width:800,height:470});assert.equal(view.visible,true);assert.equal(view.bounds.y,113);assert.ok(view.bounds.height+view.bounds.y<=700);
 window.maximized=true;
 assert.equal((await control.action(event,'size','portrait')).ok,true);assert.equal(window.maximized,false);assert.deepEqual(window.size,[1080,1898]);
 assert.equal((await control.action(event,'size','fhd')).ok,true);assert.deepEqual(window.size,[1920,1058]);
 assert.equal((await control.action(event,'size','unknown')).ok,false);assert.deepEqual(window.size,[1920,1058]);
 assert.equal((await control.action({record:{kind:'ide'}},'size','portrait')).ok,false);
 control.setAvailable(record,false);
 assert.equal((await control.action(event,'fullscreen')).fullscreen,true);
 assert.equal(window.top,true);assert.equal(windowPins.state(window).locked,true);
 assert.equal(sent.at(-1)[1].fullscreen,true);
 assert.equal((await control.action(event,'fullscreen')).fullscreen,false);
 assert.equal(window.top,false);assert.equal(windowPins.state(window).locked,false);
 for(const contents of [window.webContents,view.webContents]){
  let prevented=false;contents.emit('before-input-event',{preventDefault(){prevented=true;}},{type:'keyDown',key:'F11'});
  assert.equal(prevented,true);assert.equal(window.isFullScreen(),true);
  contents.emit('before-input-event',{preventDefault(){}},{type:'keyDown',key:'F11',isAutoRepeat:true});assert.equal(window.isFullScreen(),true);
  contents.emit('before-input-event',{preventDefault(){}},{type:'keyDown',key:'F11'});assert.equal(window.isFullScreen(),false);
 }
 assert.equal((await control.action({record:{kind:'ide'}},'fullscreen')).ok,false);
 for(area of [{x:-1920,y:32,width:1920,height:1048},{x:0,y:-1920,width:1080,height:1880},{x:1500,y:0,width:800,height:600}]){
  for(const name of ['fhd','portrait']){
   window.setFullScreen(true);assert.equal((await control.action(event,'size',name)).ok,true);assert.equal(window.isFullScreen(),false);
   const b=window.getBounds();assert.ok(b.x>=area.x&&b.y>=area.y);assert.equal(view.bounds.width,name==='fhd'?1920:1080);assert.equal(view.bounds.height,name==='fhd'?945:1785);
  }
 }
 control.setAvailable(record,true);
 view.webContents.capturePage=()=>new Promise(resolve=>{release=()=>resolve({isEmpty:()=>false,toPNG:()=>Buffer.from('png'),getSize:()=>({width:800,height:600})});});
 const saving=control.action(event,'capture');assert.equal((await control.action(event,'capture')).ok,false);release();
 assert.equal((await saving).path,'temp/input/browser.png');assert.equal(captures.length,1);assert.equal(captures[0].record,record);
 const stale=control.action(event,'capture');control.setAvailable(record,false);release();assert.equal((await stale).ok,false);assert.equal(captures.length,1);
 assert.equal((await control.action(event,'capture')).ok,false);
 assert.equal((await control.action({record:{kind:'ide'}},'capture')).ok,false);
 control.setAvailable(record,true);
 let prevented=false;view.webContents.emit('will-navigate',{preventDefault(){prevented=true;}},'javascript:alert(1)');assert.equal(prevented,true);
 assert.deepEqual(view.webContents.popup({url:'https://example.com/'}),{action:'deny'});assert.equal(view.webContents.url,'https://example.com/');
 // 利用者の停止による遅延rejectは通信障害にしない。通常の読込失敗は表示する。
 let rejectNavigation;
 const originalLoad=view.webContents.loadURL;
 view.webContents.loadURL=()=>new Promise((_,reject)=>{rejectNavigation=reject;});
 await control.action(event,'navigate','https://example.com/slow');
 await control.action(event,'stop');
 rejectNavigation(new Error('net::ERR_FAILED'));
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal((await control.action(event,'state')).error,'','手動停止後に届く失敗を表示しない');
 await control.action(event,'navigate','https://example.com/fail');
 rejectNavigation(new Error('net::ERR_FAILED'));
 await new Promise(resolve=>setImmediate(resolve));
 assert.match((await control.action(event,'state')).error,/ページを読み込めません/,'停止していない通信失敗は表示する');
 view.webContents.loadURL=originalLoad;
 await control.action(event,'navigate',HOME);
 assert.equal((await control.action(event,'state')).error,'');
 await control.navigate(record,'https://example.com/reused');assert.equal(view.webContents.url,'https://example.com/reused');
 await assert.rejects(control.navigate(record,record.url),/このURL/,'再利用もIDEのAPIオリジンへ移動させない');
 control.setAvailable(record,false);await assert.rejects(control.navigate(record,HOME),/このURL/);control.setAvailable(record,true);
 const hostContents=window.webContents;Object.defineProperty(window,'webContents',{get(){throw Error('Object has been destroyed');}});
 assert.doesNotThrow(()=>window.emit('closed'));assert.equal(hostContents.listenerCount('before-input-event'),0);assert.equal(view.webContents.listenerCount('before-input-event'),0);
 assert.throws(()=>control.navigate(record,HOME),/終了/);
 assert.deepEqual(view.webContents.closed,{waitForBeforeUnload:false});assert.equal((await control.action(event,'state')).ok,false);
});

test('Browser撮影: 選択プロジェクトのtemp/inputにPNGを重複せず保存する',async t=>{
 const root=mkdtempSync(join(tmpdir(),'aidiy-browser-capture-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOioAAAAASUVORK5CYII=','base64');
 const [first,second]=await Promise.all([capture.saveBrowserCapture(root,png),capture.saveBrowserCapture(root,png)]);
 assert.match(first.path,/^temp\/input\/browser-[\da-f-]+\.png$/);assert.notEqual(first.path,second.path);
 const {readFile}=await import('node:fs/promises');assert.deepEqual(await readFile(join(root,first.path)),png);
 await assert.rejects(capture.saveBrowserCapture(root,Buffer.from('not an image')),/不正/);
});
test('Browser: 負座標・縦画面と小画面でも選択画面内に配置する',()=>{
 for(const area of [{x:-1920,y:0,width:1920,height:1040},{x:0,y:-1080,width:1080,height:1880},{x:0,y:0,width:320,height:240}])for(let slot=0;slot<9;slot++){
  const b=layout.allWindowBounds('browser',area,slot);assert.ok(b.x>=area.x&&b.y>=area.y&&b.x+b.width<=area.x+area.width&&b.y+b.height<=area.y+area.height);
 }
});
test('Web: HTML予約タブのopenerを切り離し、プレビュー失敗時は空タブを閉じる',async()=>{
 const popup={opener:{},location:{replace(url){this.url=url;}},close(){this.closed=true;}};
 const win={open:()=>popup,fetch:async url=>({ok:true,json:async()=>url==='/api/connection'?{active:true,mode:'online',connected:true}:{url:'http://127.0.0.1:9000/test.html'}})};
 assert.equal((await openBrowser('test.html',undefined,win)).ok,true);assert.equal(popup.opener,null);assert.equal(popup.location.url,'http://127.0.0.1:9000/test.html');
 win.fetch=async()=>({ok:true,json:async()=>({active:true,mode:'offline',connected:false})});assert.equal((await openBrowser('missing.htm',undefined,win)).ok,false);assert.equal(popup.closed,true);
});
