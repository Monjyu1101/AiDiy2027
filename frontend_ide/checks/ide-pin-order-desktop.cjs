// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
'use strict';
const {app,BrowserWindow,screen}=require('electron');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {createWindowPins}=require('../デスクトップ/最前面ピン.cjs');
app.setPath('userData',process.env.AIDIY_TEST_PROFILE);app.disableHardwareAcceleration();
app.on('window-all-closed',()=>{});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const windows=[],results=[];
const timer=setTimeout(()=>app.exit(2),20000);timer.unref();
(async()=>{
 await app.whenReady();assert.equal(process.platform,'win32','Windows実窓の重なりを検証する');
 const display=screen.getPrimaryDisplay(),area=display.workArea;
 const origin={x:area.x+120,y:area.y+140};
 const make=async(title,color,bounds)=>{
  const window=new BrowserWindow({title,...bounds,show:false,frame:false,skipTaskbar:true,backgroundColor:color,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});windows.push(window);window.setBounds(bounds);
  await window.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(`<!doctype html><html><style>html,body{margin:0;width:100%;height:100%;background:${color}}</style></html>`));return window;
 };
 const owner=await make('AiDiy IDE pin test','#003399',{...origin,width:240,height:180});
 const child=await make('AiDiy module pin test','#cc2200',{x:origin.x+30,y:origin.y+30,width:120,height:90});
 const pins=createWindowPins();pins.register(owner,{pinned:true});pins.register(child,{owner,pinned:true});
 owner.showInactive();child.showInactive();
 const handle=window=>{const buffer=window.getNativeWindowHandle();return(buffer.length===8?buffer.readBigUInt64LE():BigInt(buffer.readUInt32LE())).toString();};
 // 画像取得の成否に依存せず、Win32の実際のトップレベルZ順を読み取る。入力・focusは送らない。
 const readOrder=`import ctypes,json,sys
u=ctypes.WinDLL('user32',use_last_error=True)
u.GetTopWindow.argtypes=[ctypes.c_void_p];u.GetTopWindow.restype=ctypes.c_void_p
u.GetWindow.argtypes=[ctypes.c_void_p,ctypes.c_uint];u.GetWindow.restype=ctypes.c_void_p
u.GetWindowLongPtrW.argtypes=[ctypes.c_void_p,ctypes.c_int];u.GetWindowLongPtrW.restype=ctypes.c_ssize_t
targets={int(sys.argv[1]):'child',int(sys.argv[2]):'owner'};result={};hwnd=u.GetTopWindow(None);index=0
while hwnd and index<10000:
 if hwnd in targets:result[targets[hwnd]]=index
 hwnd=u.GetWindow(hwnd,2);index+=1
result['childTopmost']=bool(u.GetWindowLongPtrW(int(sys.argv[1]),-20)&8)
result['ownerTopmost']=bool(u.GetWindowLongPtrW(int(sys.argv[2]),-20)&8)
print(json.dumps(result))`;
 async function verify(label,above,selected=owner){
  selected.moveTop();await sleep(250);
  const response=spawnSync('python',['-c',readOrder,handle(child),handle(owner)],{encoding:'utf8',windowsHide:true});assert.equal(response.status,0,response.stderr);
  const order=JSON.parse(response.stdout);assert.ok(Number.isInteger(order.child)&&Number.isInteger(order.owner));
  assert.equal(order.child<order.owner,above,label+': '+JSON.stringify(order));
  results.push({label,order,childPinned:pins.state(child).pinned,nativeTopmostReported:child.isAlwaysOnTop(),owned:child.getParentWindow()!==null});
 }
 assert.equal(child.getParentWindow(),null);
 await verify('pinned-ide-selected',false);
 await verify('pinned-panel-selected',true,child);
 pins.toggle(child);await verify('off-behind-pinned-ide',false);
 pins.toggle(child);await verify('on-again-ide-selected',false);await verify('on-again-panel-selected',true,child);
 pins.toggle(owner);await verify('ide-unpinned-panel-stays-on',true);
 pins.toggle(owner);await verify('ide-pinned-selected',false);
 pins.toggle(child);pins.setLocked(child,true);assert.equal(child.getParentWindow(),null);
 await verify('vr-lock-ide-selected',false);await verify('vr-lock-panel-selected',true,child);
 pins.setLocked(child,false);assert.equal(child.getParentWindow(),null);await verify('vr-exit-restores-off',false);
 process.send?.({testPassed:true,results});console.log(JSON.stringify({testPassed:true,results}));
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{clearTimeout(timer);for(const window of windows)if(!window.isDestroyed())window.destroy();app.exit(process.exitCode||0);});
