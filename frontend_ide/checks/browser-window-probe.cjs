// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const {app,BrowserWindow,WebContentsView,session,ipcMain,screen}=require('electron');
const {resolve,join}=require('node:path');
const {mkdtempSync,mkdirSync,writeFileSync,readFileSync}=require('node:fs');
const {tmpdir}=require('node:os');
const assert=require('node:assert/strict');
const {createBrowserViews}=require('../デスクトップ/ブラウザ.cjs');
const {createBrowserCDP}=require('../デスクトップ/ブラウザCDP.cjs');
const {createWindowPins}=require('../デスクトップ/最前面ピン.cjs');
const {saveBrowserCapture}=require('../デスクトップ/ブラウザ撮影.cjs');
const {pathToFileURL}=require('node:url');
const {createDraftRouter}=require('../デスクトップ/draft-router.cjs');
const {createSharedDraftBridge}=require('../デスクトップ/下書き共有.cjs');
const captureRoot=mkdtempSync(join(tmpdir(),'aidiy-browser-capture-'));
const output=resolve('.aidiy_cache/selftest/aidiy_browser');mkdirSync(output,{recursive:true});
const selftest=process.env.AIDIY_BROWSER_SELFTEST==='1';
process.on('uncaughtException',error=>{console.error(error);app.exit(1);});
writeFileSync(join(captureRoot,'index.html'),'<!doctype html><meta charset="utf-8"><style>body{background:#123047;color:#c8f8ff;font:30px sans-serif;margin:0;padding:40px}h1{color:#6fffd2}</style><h1>Browser 撮影確認</h1><p>このWebページだけをPNGへ保存します。</p>');
let captureResult;
let clock=Date.now();
app.setPath('userData',mkdtempSync(join(tmpdir(),'aidiy-browser-size-')));
app.disableHardwareAcceleration();
let server;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
 try{
  const {startDevelopment}=await import('../server.mjs');
  const state={active:true,mode:'online',connected:true,startedAt:1,project:{path:captureRoot,name:'Browser試験'}};
  server=await startDevelopment(captureRoot,{kind:'browser',connection:{state:()=>state,connect:async()=>state,close(){}}});
  const win=new BrowserWindow({show:false,frame:false,enableLargerThanScreen:true,width:1000,height:700,webPreferences:{backgroundThrottling:false,preload:resolve('frontend_ide/デスクトップ/preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
  const record={kind:'browser',window:win,url:server.url};
  const windowPins=createWindowPins();windowPins.register(win);
  let pointer={x:-9999,y:-9999};
  const control=createBrowserViews({BrowserWindow,WebContentsView,session,screen:{getDisplayMatching:r=>screen.getDisplayMatching(r),getCursorScreenPoint:()=>pointer},windowPins,captureImage:async({png})=>{captureResult=await saveBrowserCapture(captureRoot,png);return captureResult;},trustedEvent:event=>event.sender===win.webContents?record:control.trustedHeader(event),projectRoot:captureRoot,now:()=>clock});
  const cdp=await createBrowserCDP({directory:join(captureRoot,'cdp-registry'),sessionPrefix:process.env.AIDIY_BROWSER_SESSION_KIND==='ide'?'aidiy_ide':'aidiy_browser',canUse:async()=>true,allowedURL:control.allowedURL,openPanel:async()=>{throw Error('試験では追加窓を開きません。');}});
  record.browserSession=cdp.name;
  const page=control.attach(record,pathToFileURL(join(captureRoot,'index.html')).href,true);cdp.add(record,page);
  app.once('will-quit',()=>cdp.close());
  ipcMain.handle('development:browser-action',(event,name,value)=>control.action(event,name,value));
  ipcMain.handle('development:window',(_event,name)=>name==='title'?'AiDiy Browser':name==='pin-state'?{pinned:false,ready:true}:name==='isMaximized'?win.isMaximized():name==='maximize'?control.maximize(record):false);
  let bridge,router;const records=new Map(),targets=[];
  if(selftest||process.env.AIDIY_HANDOFF_ONLY==='1'){
   const current={active:true,mode:'online',startedAt:1,project:{path:captureRoot}},key=s=>s.mode+':'+s.startedAt;
   router=createDraftRouter({records,readState:async()=>current,sessionKey:key,focusWindow:()=>{}});
   bridge=await createSharedDraftBridge({directory:join(captureRoot,'registry'),records,router,readState:async()=>current,sessionKey:key});
   ipcMain.handle('development:draft-target-register',(event,value)=>router.register(records.get(event.sender),value));
   ipcMain.on('development:draft-result',(event,value)=>router.acknowledge(records.get(event.sender),value));
   ipcMain.handle('development:draft-targets',()=>bridge.list(record));
   ipcMain.handle('development:draft-insert',async(event,value)=>{const latest=await control.action(event,'draft');return bridge.insert(record,{...value,text:latest.request.text});});
   writeFileSync(join(captureRoot,'receiver.js'),readFileSync(resolve('frontend_ide/src/components/下書き連携/下書き受け渡し.js')));
   for(const kind of ['code','live']){
    writeFileSync(join(captureRoot,kind+'.html'),`<textarea id="draft">既存の下書き</textarea><script type="module">import{createDraftReceiver}from'./receiver.js';const input=document.querySelector('textarea');createDraftReceiver({kind:'${kind}',project:()=>${JSON.stringify(captureRoot)},scope:()=>'fixture',ready:()=>true,draft:()=>input.value,setDraft:value=>input.value=value,focus:()=>{},api:window.aidiyWindow}).mount();</script>`);
    const target=new BrowserWindow({show:false,webPreferences:{preload:resolve('frontend_ide/デスクトップ/preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
    const item={kind,window:target,revision:0,slot:0};records.set(target.webContents,item);targets.push(item);await target.loadFile(join(captureRoot,kind+'.html'));
   }
  }
  await win.loadURL(server.url+'#browser');
  win.setSkipTaskbar(true);win.setIgnoreMouseEvents(true);win.showInactive();
  async function shot(name){
   if(!selftest)return;
   if(name==='Browser_401_連携先選択'){
    const r=await win.webContents.executeJavaScript(`(()=>{const r=document.querySelector('dialog').getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})()`),zoom=win.webContents.getZoomFactor();
    const image=await win.webContents.capturePage({x:Math.floor(r.x*zoom),y:Math.floor(r.y*zoom),width:Math.ceil(r.width*zoom),height:Math.ceil(r.height*zoom)},{stayHidden:true,stayAwake:true});
    writeFileSync(join(output,name+'.png'),image.toPNG());return;
   }
   const top=win.isAlwaysOnTop();win.setAlwaysOnTop(true);win.setTitle('AiDiy Browser セルフテスト');win.moveTop();await delay(200);
   try{const response=await fetch('http://127.0.0.1:8095/aidiy_desktop_capture/screenshot',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({window_title:'AiDiy Browser セルフテスト',save_path:join(output,name+'.png'),shutter_sounds:'none'}),signal:AbortSignal.timeout(15000)});const value=await response.json();if(!response.ok||value.error)throw Error(JSON.stringify(value));}
   finally{win.setAlwaysOnTop(top);}
  }
  const evaluate=code=>win.webContents.executeJavaScript(code,true);
  const pageMetrics=()=>page.executeJavaScript(`({width:innerWidth,height:innerHeight,dpr:devicePixelRatio})`);
  async function until(check){for(let i=0;i<60;i++){if(await check())return;await delay(50);}throw Error('画面遷移が完了しません。');}
  for(let i=0;i<100;i++){if(await evaluate(`document.querySelectorAll('.browser-window-sizes button').length===3`))break;await delay(100);}
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.browser-window-sizes button')].map(b=>b.textContent)`),['FHD','縦表示','F11']);
  for(const [index,width,height,label] of [[0,1920,945,'fhd'],[1,1080,1785,'portrait']]){
   const area=screen.getDisplayMatching(win.getBounds()).workArea;
   await evaluate(`document.querySelectorAll('.browser-window-sizes button')[${index}].click()`);await delay(500);
   await until(async()=>{const p=await pageMetrics();return p.width===width&&p.height===height;});assert.equal(win.getOpacity(),1);
   const b=win.getBounds(),pageBounds=win.contentView.children.find(v=>v.webContents===page).getBounds();
   assert.equal(pageBounds.width,width);assert.equal(pageBounds.height,height);
   assert.ok(b.width>=width&&b.height>height);assert.ok(b.x>=area.x&&b.y>=area.y);
   const geometry=await evaluate(`[...document.querySelectorAll('.browser-window-sizes button')].map(b=>{const r=b.getBoundingClientRect();return {text:b.textContent,x:r.x,y:r.y,right:r.right,bottom:r.bottom,drag:getComputedStyle(b.parentElement).webkitAppRegion,fits:b.scrollWidth<=b.clientWidth}})`);
   assert.ok(geometry.every(r=>r.x>=0&&r.right<=width&&r.y>=0&&r.bottom<50&&r.drag==='no-drag'&&r.fits));
   writeFileSync(resolve('temp/browser-size-'+label+'.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
   console.log(JSON.stringify({preset:label,bounds:b,pageBounds,pageViewport:await pageMetrics(),buttons:geometry}));
   await shot(index===0?'Browser_102_FHD':'Browser_103_縦表示');
  }
  await control.maximize(record);await until(()=>win.isMaximized());await delay(250);
  let pageSize=await pageMetrics(),v=win.contentView.children.find(v=>v.webContents===page).getBounds();assert.equal(pageSize.width,v.width);assert.equal(pageSize.height,v.height);
  await control.maximize(record);await until(()=>!win.isMaximized());await delay(250);
  pageSize=await pageMetrics();v=win.contentView.children.find(v=>v.webContents===page).getBounds();assert.equal(pageSize.width,v.width);assert.equal(pageSize.height,v.height);
  const before=win.getBounds();
  await evaluate(`document.querySelector('.browser-capture').click()`);await until(()=>!!captureResult);
  await until(()=>evaluate(`!!document.querySelector('.browser-capture-status')`));
  assert.equal(await evaluate(`document.querySelector('.browser-capture-status').getBoundingClientRect().right<document.querySelector('.panel-brand strong').getBoundingClientRect().left`),true);
  console.log(JSON.stringify({capture:join(captureRoot,captureResult.path)}));
  writeFileSync(resolve('temp/browser-capture-button.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
  if(selftest)writeFileSync(join(output,'Browser_301_Web撮影.png'),readFileSync(join(captureRoot,captureResult.path)));
  if(selftest||process.env.AIDIY_HANDOFF_ONLY==='1'){
   await until(()=>[...records.values()].every(r=>!!r.draftTarget));
   for(const kind of ['code','live']){
    if(kind==='live')clock+=60001;
    await evaluate(`document.querySelector('.browser-handoff').click()`);
    await until(()=>evaluate(`!!document.querySelector('.draft-target-row select')`));
    assert.equal(win.contentView.children.find(v=>v.webContents===page).getVisible(),false);
    await evaluate(`{const select=document.querySelector('.draft-target-row select');select.value=[...select.options].find(o=>o.textContent.startsWith('${kind==='code'?'Code':'Live'}')).value;select.dispatchEvent(new Event('change',{bubbles:true}));}`);
    await delay(50);if(kind==='code')await shot('Browser_401_連携先選択');await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='下書きへ追加').click()`);
    await until(()=>evaluate(`!document.querySelector('.draft-target-row')`));
    const text=await targets.find(t=>t.kind===kind).window.webContents.executeJavaScript(`document.querySelector('textarea').value`);
    assert.ok(text.startsWith(`既存の下書き\n\nsession: ${record.browserSession}\ntab_id: ${record.browserTabId}\nfile:`));assert.equal(text.includes(captureResult.path.split('/').at(-1)),kind==='code');
    console.log(JSON.stringify({handoff:kind,imageAttached:kind==='code',draft:text}));
   }
   writeFileSync(resolve('temp/browser-handoff-button.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
   await bridge.close();console.log('HANDOFF_OK');if(!selftest){app.exit(0);return;}
  }
  if(process.env.AIDIY_CAPTURE_ONLY==='1'){console.log('CAPTURE_OK');app.exit(0);return;}
  await evaluate(`document.querySelectorAll('.browser-window-sizes button')[2].click()`);await delay(500);
  assert.equal(win.isFullScreen(),true);assert.equal(await evaluate(`document.querySelectorAll('.browser-window-sizes button')[2].getAttribute('aria-pressed')`),'true');
  assert.equal(win.isAlwaysOnTop(),true);
  await until(()=>evaluate(`getComputedStyle(document.querySelector('.browser-chrome')).display==='none'`));
  const view=win.contentView.children.find(v=>v.webContents===page);
  assert.equal(view.getBounds().y,0);assert.equal(view.getBounds().height,win.getContentBounds().height);
  writeFileSync(resolve('temp/browser-size-fullscreen.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
  await shot('Browser_201_全面表示');
  const fullscreenBounds=win.getContentBounds(),viewport=view.getBounds();pointer={x:fullscreenBounds.x+200,y:fullscreenBounds.y+1};
  let header;
  await until(()=>{header=BrowserWindow.getAllWindows().find(w=>w.getParentWindow()===win);return !!header;});
  const headerEval=code=>header.webContents.executeJavaScript(code,true);
  await until(()=>headerEval(`!!document.querySelector('.browser-header-only .browser-handoff')`));await delay(400);
  assert.equal(header.isVisible(),true);assert.deepEqual(view.getBounds(),viewport);
  assert.equal(await headerEval(`getComputedStyle(document.querySelector('.panel-brand')).webkitAppRegion`),'no-drag');
  writeFileSync(resolve('temp/browser-fullscreen-header.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
  await shot('Browser_202_上端ヘッダー');
  pointer={x:fullscreenBounds.x+200,y:fullscreenBounds.y+500};await until(()=>!header.isVisible());assert.deepEqual(view.getBounds(),viewport);
  pointer={x:fullscreenBounds.x+200,y:fullscreenBounds.y+1};await until(()=>header.isVisible());await delay(300);
  await headerEval(`document.querySelector('.window-pin').click()`);await until(()=>headerEval(`document.querySelector('.window-pin').getAttribute('aria-pressed')==='true'`));
  pointer={x:fullscreenBounds.x+200,y:fullscreenBounds.y+500};await delay(400);assert.equal(header.isVisible(),true);
  const pinBounds=header.getBounds();pointer={x:pinBounds.x+50,y:pinBounds.y+20};
  await headerEval(`document.querySelector('.window-pin').click()`);await until(()=>!header.isVisible());
  await delay(250);assert.equal(header.isVisible(),false);assert.deepEqual(view.getBounds(),viewport);
  pointer={x:fullscreenBounds.x+200,y:fullscreenBounds.y+500};await delay(100);
  pointer={x:fullscreenBounds.x+200,y:fullscreenBounds.y+1};await until(()=>header.isVisible());await delay(300);
  const beforeHeader=header.getBounds(),mainBounds=win.getBounds(),zoom=header.webContents.getZoomFactor();
  const p=await headerEval(`(()=>{const r=document.querySelector('.panel-brand strong').getBoundingClientRect();return{x:Math.round((r.x+r.width/2)*${zoom}),y:Math.round((r.y+r.height/2)*${zoom})}})()`);
  pointer={x:beforeHeader.x+p.x,y:beforeHeader.y+p.y};const focused=header.isFocused;header.isFocused=()=>true;
  header.webContents.sendInputEvent({type:'mouseDown',...p,button:'left',clickCount:1});await delay(400);
  assert.deepEqual(header.getBounds(),beforeHeader);assert.equal((await control.action({sender:win.webContents},'state')).headerPinned,false);
  await until(()=>headerEval(`!!document.querySelector('[data-aidiy-window-move]:popover-open')`));
  assert.equal((await control.action({sender:win.webContents},'state')).headerPinned,true);
  pointer={x:pointer.x+48,y:pointer.y+80};header.webContents.sendInputEvent({type:'mouseMove',...p,button:'left',modifiers:['leftButtonDown']});await delay(100);
  header.webContents.sendInputEvent({type:'mouseUp',...p,button:'left',clickCount:1});header.isFocused=focused;
  assert.ok(Math.abs(header.getBounds().x-beforeHeader.x-48)<=2);assert.ok(Math.abs(header.getBounds().y-beforeHeader.y-80)<=2);
  assert.deepEqual(win.getBounds(),mainBounds);assert.deepEqual(view.getBounds(),viewport);
  pointer={x:fullscreenBounds.x+200,y:fullscreenBounds.y+500};await delay(300);assert.equal(header.isVisible(),true);
  await shot('Browser_203_移動と常時表示');
  await headerEval(`document.querySelector('.browser-handoff').click()`);await until(()=>evaluate(`!!document.querySelector('.draft-target-row')`));await until(()=>!header.isVisible());assert.equal(view.getVisible(),false);
  await evaluate(`[...document.querySelectorAll('dialog button')].find(b=>b.textContent==='キャンセル').click()`);await until(()=>view.getVisible());
  assert.deepEqual(view.getBounds(),viewport);
  await until(()=>header.isVisible());await delay(300);
  const previousCapture=captureResult.path;await headerEval(`document.querySelector('.browser-capture').click()`);await until(()=>captureResult.path!==previousCapture);
  assert.deepEqual(view.getBounds(),viewport);
  console.log(JSON.stringify({overlay:true,viewportUnchanged:true,longPressMs:500,autoPinOnMove:true,headerBounds:header.getBounds()}));
  // 本文とホストの双方から、実Electronのキー入力イベントを送る。
  page.sendInputEvent({type:'keyDown',keyCode:'F11'});page.sendInputEvent({type:'keyUp',keyCode:'F11'});await delay(350);assert.equal(win.isFullScreen(),false);assert.equal(win.isAlwaysOnTop(),false);
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'F11'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'F11'});await delay(350);assert.equal(win.isFullScreen(),true);
  await until(()=>header.isVisible());await delay(300);await headerEval(`document.querySelectorAll('.browser-window-sizes button')[2].click()`);await delay(500);assert.equal(win.isFullScreen(),false);
  console.log(JSON.stringify({fullscreen:true,restored:win.getBounds(),before}));
  win.destroy();for(const target of targets)target.window.destroy();void server.close();process.send?.({testPassed:true,output,windowClosed:true});app.exit(0);
 }catch(error){console.error(error);for(const win of BrowserWindow.getAllWindows())win.destroy();app.exit(1);}
});


