// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
//
// 実Electronの隔離窓で共有ピン制御を確認する。アプリ本体・AI・ネットワークは起動しない。
// 実行: frontend_avatar/node_modules/.bin/electron --ozone-platform=headless frontend_ide/checks/window-pin-desktop.cjs
// 合成画面の撮影と実isAlwaysOnTopを検証する。Windows実機の重なり順・実UIの検証ではない。
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {app,BrowserWindow,ipcMain,session,nativeImage}=require('electron');
const {createWindowPins,pinLevel}=require('../デスクトップ/最前面ピン.cjs');

const output=fs.mkdtempSync(path.join(os.tmpdir(),'aidiy-window-pin-'));
const profile=path.join(output,'profile');
const preload=path.join(output,'preload.cjs');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const windows=[];
const owners=new Map();
const nativeCalls=[];
const focusEvents=[];
const blockedRequests=[];
const screenshots=[];
const checks=[];
let teardownComplete=false;
let nativeTopmostSupported=false;
let fixtureSession;
let result;
let exitCode=0;

fs.mkdirSync(profile);
fs.writeFileSync(preload,`
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('pinFixture',{
 security:{sandboxed:process.sandboxed===true,contextIsolated:process.contextIsolated===true},
 state:()=>ipcRenderer.invoke('pin-fixture:state'),
 toggle:()=>ipcRenderer.invoke('pin-fixture:toggle'),
 onChanged:callback=>ipcRenderer.on('pin-fixture:changed',(_event,value)=>callback(value))
});
`);
app.disableHardwareAcceleration();
app.setPath('userData',profile);
app.on('window-all-closed',()=>{});
function finish() {
 let profileRemoved=false;
 try {
  fs.rmSync(profile,{recursive:true,force:true});
  fs.rmSync(preload,{force:true});
  profileRemoved=!fs.existsSync(profile);
 } catch(error) {
  if(result){result.passed=false;result.cleanupError=String(error);}
  exitCode=1;
 }
 if(result){
  result.teardown={windowsDestroyed:teardownComplete,profileRemoved};
  fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(result,null,2));
  console.log('WINDOW_PIN_PROBE_RESULT '+JSON.stringify(result));
 }
 app.exit(exitCode);
}

function html(title) {
 return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
*{box-sizing:border-box}body{margin:0;font:16px sans-serif;color:#e2e8f0;background:#101827}
header{display:flex;align-items:center;gap:4px;padding:10px;background:#1e293b}
button{width:40px;height:34px;border:1px solid #334155;border-radius:5px;background:#263449;color:#e2e8f0;font:20px sans-serif}
#pin{background:#131d2e;box-shadow:inset 0 2px 4px #0009;filter:grayscale(1);opacity:.65}
#pin[aria-pressed=true]{background:#0f6073;box-shadow:none;filter:none;opacity:1;border-color:#38bdf8}
#pin:disabled{cursor:not-allowed}header span{margin-left:14px;font-size:14px}
main{padding:30px}h1{font-size:22px;margin:0 0 20px}p{line-height:1.6}
#value{padding:16px;background:#1e293b;border-radius:8px;font:18px monospace}
.note{color:#94a3b8;font-size:13px}
</style></head><body>
<header><button aria-label="Minimize">−</button><button aria-label="Maximize">□</button><button id="pin" aria-label="Pin window" aria-pressed="false">📌</button><button aria-label="Close">×</button><span>${title}</span></header>
<main><h1>Native Electron pin verification</h1><p id="value">Loading...</p>
<p class="note">Synthetic controls, real BrowserWindow + shared pin controller.<br>Not a production UI screenshot or desktop stacking-order proof.</p></main>
<script>
window.pinEvents=[];
window.renderPin=value=>{
 document.querySelector('#pin').setAttribute('aria-pressed',String(value.pinned));
 document.querySelector('#pin').disabled=value.locked;
 document.querySelector('#value').textContent='pinned: '+value.pinned+' | VR locked: '+value.locked;
 pinEvents.push(value);
};
pinFixture.onChanged(renderPin);
pinFixture.state().then(renderPin);
document.querySelector('#pin').onclick=()=>pinFixture.toggle().then(renderPin);
</script></body></html>`;
}

async function until(predicate,label) {
 const deadline=Date.now()+4000;
 while(Date.now()<deadline) {
  if(await predicate())return;
  await sleep(20);
 }
 throw new Error('Timed out: '+label);
}

function instrument(window,label) {
 for(const method of ['setAlwaysOnTop','moveTop','focus']) {
  const native=window[method].bind(window);
  window[method]=(...args)=>{
   nativeCalls.push({window:label,method,args});
   return native(...args);
  };
 }
 window.on('focus',()=>focusEvents.push(label));
}

async function makeWindow(controller,label,options) {
 const window=new BrowserWindow({
  title:label,show:false,frame:false,width:680,height:320,
  webPreferences:{preload,session:fixtureSession,sandbox:true,contextIsolation:true,nodeIntegration:false,offscreen:true}
 });
 windows.push(window);
 owners.set(window.webContents.id,{controller,window,label});
 instrument(window,label);
 assert.equal(window.isAlwaysOnTop(),false,label+' native default');
 controller.register(window,options);
 const contents=window.webContents;
 await window.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html(label)));
 contents.enableDeviceEmulation({
  screenPosition:'desktop',screenSize:{width:680,height:320},
  viewPosition:{x:0,y:0},viewSize:{width:680,height:320},deviceScaleFactor:1,scale:1
 });
 window.show();
 await until(()=>contents.executeJavaScript('pinEvents.length>0'),label+' renderer ready');
 const security=await contents.executeJavaScript(`({
  ...pinFixture.security,nodeGlobal:typeof require,nodeIntegration:typeof process
 })`);
 assert.deepEqual(security,{sandboxed:true,contextIsolated:true,nodeGlobal:'undefined',nodeIntegration:'undefined'});
 return window;
}

async function verify(controller,window,expected,label) {
 await until(()=>{
  const state=controller.state(window);
  return state.pinned===expected.pinned&&state.locked===expected.locked;
 },label+' controller state');
 assert.deepEqual(controller.state(window),expected,label+' shared state');
 if(nativeTopmostSupported||!expected.pinned)
  assert.equal(window.isAlwaysOnTop(),expected.pinned,label+' native isAlwaysOnTop');
 await until(async()=>{
  const state=await window.webContents.executeJavaScript(`({
   pinned:document.querySelector('#pin').getAttribute('aria-pressed')==='true',
   locked:document.querySelector('#pin').disabled
  })`);
  return state.pinned===expected.pinned&&state.locked===expected.locked;
 },label+' renderer state');
 checks.push({label,...expected,nativeAlwaysOnTop:window.isAlwaysOnTop(),
  nativeExpectationVerified:nativeTopmostSupported||!expected.pinned});
}

async function clickPin(window) {
 const point=await window.webContents.executeJavaScript(`(()=>{
  const r=document.querySelector('#pin').getBoundingClientRect();
  return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};
 })()`);
 if(window.getBounds().width<=1){
  // headlessの1px実窓ではnative入力が届かない。DOM有効/無効とIPC経路だけを確認する。
  await window.webContents.executeJavaScript(`document.querySelector('#pin').click()`);
 }else{
  window.webContents.sendInputEvent({type:'mouseDown',...point,button:'left',clickCount:1});
  window.webContents.sendInputEvent({type:'mouseUp',...point,button:'left',clickCount:1});
 }
}

async function capture(window,name) {
 window.webContents.invalidate();
 await sleep(150);
 let image=await window.webContents.capturePage();
 let method='webContents.capturePage';
 if(image.getSize().width<=1||image.getSize().height<=1){
  // Ozone headlessのnative窓は1pxになるため、隔離rendererの描画だけをCDPで撮影する。
  const debug=window.webContents.debugger;
  debug.attach('1.3');
  try{
   await debug.sendCommand('Emulation.setDeviceMetricsOverride',{
    width:680,height:320,deviceScaleFactor:1,mobile:false
   });
   const shot=await debug.sendCommand('Page.captureScreenshot',{
    format:'png',fromSurface:true,captureBeyondViewport:true
   });
   image=nativeImage.createFromBuffer(Buffer.from(shot.data,'base64'));
   method='CDP emulated renderer capture; native window surface is 1px';
  }finally{debug.detach();}
 }
 const size=image.getSize();
 assert.ok(size.width>100&&size.height>100,'usable screenshot: '+name);
 const file=path.join(output,name+'.png');
 fs.writeFileSync(file,image.toPNG());
 screenshots.push({file,size,method,scope:'synthetic controls, not production UI or desktop z-order'});
}

async function run() {
 await app.whenReady();
 fixtureSession=session.fromPartition('window-pin-fixture');
 fixtureSession.webRequest.onBeforeRequest(
  {urls:['http://*/*','https://*/*','ws://*/*','wss://*/*']},
  (details,callback)=>{blockedRequests.push(details.url);callback({cancel:true});}
 );
 // Ozone headlessはon要求後もisAlwaysOnTopがfalseのため、事前に本物の窓で能力を確認する。
 // 通常デスクトップで失敗した場合はスキップせず失敗にする。
 const capability=new BrowserWindow({
  show:false,width:200,height:100,
  webPreferences:{session:fixtureSession,sandbox:true,contextIsolation:true,nodeIntegration:false}
 });
 windows.push(capability);
 capability.show();
 capability.setAlwaysOnTop(true,pinLevel);
 nativeTopmostSupported=capability.isAlwaysOnTop();
 capability.setAlwaysOnTop(false);
 assert.equal(capability.isAlwaysOnTop(),false,'native off capability');
 capability.destroy();
 if(!nativeTopmostSupported){
  assert.equal(process.platform,'linux','native pin-on state is required outside Linux headless');
  assert.equal(app.commandLine.getSwitchValue('ozone-platform'),'headless',
   'native pin-on state is required outside Ozone headless');
 }
 const onChanged=(window,state)=>{
  if(!window.isDestroyed()&&!window.webContents.isDestroyed())window.webContents.send('pin-fixture:changed',state);
 };
 // 独立controllerを2個用意し、別Electronアプリで共有する方針を模擬する。
 // 同一プロセス内のfixtureであり、別プロセスのOS重なり順は保証しない。
 const first=createWindowPins({onChanged});
 const second=createWindowPins({onChanged});
 for(const [name,method] of [['state','state'],['toggle','toggle']]){
  ipcMain.handle('pin-fixture:'+name,event=>{
   const owner=owners.get(event.sender.id);
   assert.ok(owner,'fixture-owned sender only');
   return owner.controller[method](owner.window);
  });
 }
 const normal=await makeWindow(first,'Standalone app');
 const child=await makeWindow(first,'IDE-launched child',{pinned:true});
 const other=await makeWindow(second,'Independent app');
 await verify(first,normal,{pinned:false,locked:false},'Standalone starts unpinned');
 await verify(first,child,{pinned:true,locked:false},'IDE child starts pinned');
 await verify(second,other,{pinned:false,locked:false},'Independent app starts unpinned');
 await capture(normal,'01-default-off');
 await capture(child,'02-ide-child-on');

 await clickPin(normal);
 await verify(first,normal,{pinned:true,locked:false},'Renderer button activation pins standalone');
 await clickPin(normal);
 await verify(first,normal,{pinned:false,locked:false},'Renderer button activation unpins standalone');
 await clickPin(child);
 await verify(first,child,{pinned:false,locked:false},'IDE child can unpin outside VR');

 first.setLocked(normal,true);
 await verify(first,normal,{pinned:true,locked:true},'VR locks initially unpinned window on');
 const beforeLocked=nativeCalls.length;
 await clickPin(normal);
 assert.deepEqual(await normal.webContents.executeJavaScript('pinFixture.toggle()'),{pinned:true,locked:true});
 first.setLocked(normal,true);
 assert.equal(nativeCalls.length,beforeLocked,'VR rejects renderer/API toggle without native reapply');
 await verify(first,normal,{pinned:true,locked:true},'VR blocks UI and IPC toggles');
 await capture(normal,'03-vr-locked');
 first.setLocked(normal,false);
 await verify(first,normal,{pinned:false,locked:false},'VR exit restores prior off');

 first.toggle(child);
 first.setLocked(child,true);
 await verify(first,child,{pinned:true,locked:true},'VR locks previously pinned child');
 first.toggle(child);
 first.setLocked(child,false);
 await verify(first,child,{pinned:true,locked:false},'VR exit restores prior on');
 second.toggle(other);
 await verify(second,other,{pinned:true,locked:false},'Independent app pins separately');
 await verify(first,normal,{pinned:false,locked:false},'Other controller does not change standalone');

 // 実BrowserWindowのfocusイベントを明示発火し、moveTopは本物へ委譲する。
 // headlessではユーザーによるOS選択・クリック後のz-orderとは区別する。
 const orderStart=nativeCalls.length;
 for(const window of [child,other,child])window.emit('focus');
 const ordered=nativeCalls.slice(orderStart);
 assert.deepEqual(ordered,[
  {window:'IDE-launched child',method:'moveTop',args:[]},
  {window:'Independent app',method:'moveTop',args:[]},
  {window:'IDE-launched child',method:'moveTop',args:[]}
 ],'only selected pinned window requests moveTop, never focus');
 const offStart=nativeCalls.length;
 normal.emit('focus');
 assert.equal(nativeCalls.length,offStart,'unpinned focus does not raise');
 const quietStart=nativeCalls.length;
 await sleep(250);
 assert.equal(nativeCalls.length,quietStart,'no periodic focus or topmost reassertion while idle');
 assert.ok(nativeCalls.filter(call=>call.method==='setAlwaysOnTop'&&call.args[0])
  .every(call=>call.args.length===2&&call.args[1]===pinLevel),'same platform level for both controllers');
 assert.equal(nativeCalls.filter(call=>call.method==='focus').length,0,'controller never steals focus');
 checks.push({label:'Explicit focus-event raise order',order:ordered.map(call=>call.window),
  scope:'instrumented focus events and native moveTop calls only; not observed OS z-order'});

 const unregisterStart=nativeCalls.length;
 first.unregister(child);
 child.emit('focus');
 assert.deepEqual(first.toggle(child),{pinned:false,locked:false});
 assert.equal(nativeCalls.length,unregisterStart,'unregister removes controller listeners');
 other.destroy();
 assert.deepEqual(second.state(other),{pinned:false,locked:false});
 assert.deepEqual(second.toggle(other),{pinned:false,locked:false});
 assert.deepEqual(second.setLocked(other,true),{pinned:false,locked:false});
 checks.push({label:'Unregister and closed-window operations are safe'});
 assert.deepEqual(blockedRequests,[],'fixture never attempts external requests');
 result={
  passed:true,electron:process.versions.electron,chrome:process.versions.chrome,
  platform:process.platform,output,sandbox:true,contextIsolation:true,nodeIntegration:false,
  nativeTopmostVerification:{
   defaultOff:'verified',
   on:nativeTopmostSupported?'verified':'unsupported: Linux Ozone headless reports false after native pin-on',
   off:'verified',
   calls:'verified: real native setters invoked with shared floating level'
  },
  checks,screenshots,nativeCalls,focusEvents,blockedRequests,
  limitations:[
   'Synthetic renderer, not production application controls.',
   'Two independent controllers in one Electron process, not two launched applications.',
   'When native bounds are 1px, button activation is programmatic DOM click and screenshots use CDP viewport emulation.',
   'Explicit focus events verify moveTop invocation order, not native OS selection or stacking order.',
   'Linux headless execution does not validate Windows desktop z-order or taskbar behavior.'
  ]
 };
}

const watchdog=setTimeout(()=>{
 console.error('Window pin fixture exceeded 30 seconds');
 for(const window of windows)if(!window.isDestroyed())window.destroy();
 teardownComplete=BrowserWindow.getAllWindows().length===0;
 exitCode=2;
 result={passed:false,output,error:'Window pin fixture exceeded 30 seconds',checks,screenshots,nativeCalls,blockedRequests};
 finish();
},30000);
watchdog.unref();
run().catch(error=>{
 exitCode=1;
 console.error(error);
 result={passed:false,output,error:String(error.stack||error),checks,screenshots,nativeCalls,blockedRequests};
}).finally(async()=>{
 clearTimeout(watchdog);
 for(const window of windows)if(!window.isDestroyed())window.destroy();
 owners.clear();
 ipcMain.removeHandler('pin-fixture:state');
 ipcMain.removeHandler('pin-fixture:toggle');
 teardownComplete=BrowserWindow.getAllWindows().length===0;
 try {
  if(fixtureSession)await fixtureSession.clearStorageData();
 } catch(error) {
  exitCode=1;
  if(result){result.passed=false;result.cleanupError=String(error);}
 }
 finish();
});
