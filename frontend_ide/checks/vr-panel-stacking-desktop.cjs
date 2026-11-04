// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 実行: frontend_avatar/node_modules/.bin/electron --ozone-platform=headless frontend_ide/checks/vr-panel-stacking-desktop.cjs
// Windowsでは実窓のZ順とWS_EX_TOPMOSTも照合する。headlessではAPI確認だけを行う。
const {app,BrowserWindow}=require('electron');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createWindowPins}=require('../デスクトップ/最前面ピン.cjs');
const {createVRPanelStacking}=require('../デスクトップ/VRパネル前面.cjs');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'aidiy-vr-stacking-'));
app.setPath('userData',path.join(directory,'profile'));app.disableHardwareAcceleration();
app.on('window-all-closed',()=>{});
app.once('quit',()=>{
 if(!path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep)||!path.basename(directory).startsWith('aidiy-vr-stacking-'))throw Error('一時パスが不正です');
 try{fs.rmSync(directory,{recursive:true,force:true,maxRetries:2});}catch(error){console.warn('Electron終了後の削除が必要:',directory,error.code);}
});
setTimeout(()=>{console.error('VR stacking smoke timed out');app.exit(1);},20000).unref();
const pause=()=>new Promise(resolve=>setTimeout(resolve,250));
app.whenReady().then(async()=>{
 const windows=new Map(),calls=[],errors=[],nativeChecks=[];let active=false,newPanels=[];
 const pins=createWindowPins(),stack=createVRPanelStacking({windows,isActive:()=>active,onError:error=>errors.push(error.message)});
 async function create(kind,owner){
  const window=new BrowserWindow({show:false,width:640,height:400,frame:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
  const record={kind,owner,window};windows.set(window.webContents,record);
  const moveTop=window.moveTop.bind(window);window.moveTop=()=>{if(active&&owner)calls.push([kind,'moveTop']);moveTop();};
  const moveAbove=window.moveAbove.bind(window);window.moveAbove=id=>{calls.push([kind,id]);moveAbove(id);};
  pins.register(window,{pinned:!!owner,locked:!!owner&&active});stack.register(record);
  await window.loadURL('data:text/html,'+encodeURIComponent(`<body style="background:#142139;color:white;font:24px sans-serif"><h1>${kind}</h1>VR panel stacking test fixture.</body>`));
  window.show();await pause();return record;
 }
 try{
  const ide=await create('ide'),explorer=await create('explorer',ide),routes=await create('panel-routes',ide),code=await create('code',ide),other=await create('external');
  async function nativeOrder(label){
   if(process.platform!=='win32')return;
   const records=[ide,explorer,routes,code,other,...newPanels];
   const handles=records.map(record=>{const b=record.window.getNativeWindowHandle();return(b.length===8?b.readBigUInt64LE():BigInt(b.readUInt32LE())).toString();});
   const result=spawnSync('python',['-c',`import ctypes,json,sys
u=ctypes.WinDLL('user32',use_last_error=True)
u.GetTopWindow.argtypes=[ctypes.c_void_p];u.GetTopWindow.restype=ctypes.c_void_p
u.GetWindow.argtypes=[ctypes.c_void_p,ctypes.c_uint];u.GetWindow.restype=ctypes.c_void_p
u.GetWindowLongPtrW.argtypes=[ctypes.c_void_p,ctypes.c_int];u.GetWindowLongPtrW.restype=ctypes.c_ssize_t
targets={int(h):i for i,h in enumerate(sys.argv[1:])};order={};h=u.GetTopWindow(None);i=0
while h and i<10000:
 if h in targets:order[str(targets[h])]=i
 h=u.GetWindow(h,2);i+=1
print(json.dumps({'order':order,'topmost':[bool(u.GetWindowLongPtrW(h,-20)&8) for h in targets]}))`,...handles],{encoding:'utf8',windowsHide:true});
   assert.equal(result.status,0,result.stderr);const value=JSON.parse(result.stdout);console.log(JSON.stringify({label,...value,errors,calls:calls.slice(-6)}));
   for(const i of [1,2,3,...newPanels.map((_,i)=>i+5)]){assert.ok(value.order[i]<value.order[0],label+': VR本体より前面');assert.ok(value.order[i]<value.order[4],label+': 通常の別窓より前面');assert.equal(value.topmost[i],true);}
   nativeChecks.push({label,...value});
  }
  assert.equal(calls.length,0);active=true;
  for(const record of [ide,explorer,routes,code])pins.setLocked(record.window,true);
  ide.window.show();await pause();stack.refresh(ide);await pause();assert.ok(calls.some(([kind])=>kind==='explorer'));assert.ok(calls.some(([kind])=>kind==='panel-routes'));
  for(const event of ['focus','show','restore','maximize','unmaximize']){const before=calls.length;ide.window.emit(event);await pause();assert.ok(calls.length>before,event);}
  for(const record of [ide,explorer,routes])assert.equal(record.window.getParentWindow(),null);
  const originalFocus=BrowserWindow.getFocusedWindow();stack.refresh(ide);await pause();assert.equal(BrowserWindow.getFocusedWindow(),originalFocus,'相対順変更でフォーカスを盗まない');
  newPanels=[await create('panel-viewer',ide),await create('live',ide),await create('console',ide)];
  for(const record of newPanels){assert.deepEqual(pins.state(record.window),{pinned:true,locked:true});pins.toggle(record.window);assert.equal(pins.state(record.window).pinned,true);}
  for(const selected of [ide,code,other,explorer,routes,...newPanels,other,ide,ide]){selected.window.focus();await pause();await nativeOrder('選択:'+selected.kind);}
  const settled=calls.length;await pause();await pause();assert.equal(calls.length,settled,'待機中に再配置を繰り返さない');
  active=false;for(const record of windows.values())pins.setLocked(record.window,false);
  const before=calls.length;ide.window.emit('focus');await pause();assert.equal(calls.length,before);
  assert.equal(errors.length,0,errors.join('\n'));
  console.log(JSON.stringify({passed:true,platform:process.platform,relativeMoves:calls.length,nativeChecks,scope:nativeChecks.length?'Windows実窓のZ順・最前面フラグを照合':'Native Electron API smoke only'}));
 }finally{for(const record of windows.values())record.window.destroy();}
 app.quit();
}).catch(error=>{console.error(error);app.exit(1);});
