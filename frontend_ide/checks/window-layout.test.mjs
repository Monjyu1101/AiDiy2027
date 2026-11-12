// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import layout from '../デスクトップ/window-layout.cjs';
const {windowBounds,windowMinimumSize,allWindowBounds}=layout;
test('CLI付きConsoleは800×600で下端中央に置き、小画面では作業領域へ収める',()=>{
 for(const area of [{x:0,y:0,width:1920,height:1040},{x:-1600,y:80,width:1600,height:900},{x:0,y:-900,width:1024,height:728},{x:-1080,y:-300,width:1080,height:1880},{x:120,y:50,width:640,height:640},{x:0,y:0,width:640,height:480},{x:40,y:-240,width:240,height:240},{x:-1537,y:37,width:1537,height:865}]){
  for(const slot of [0,1,4,127]){
   const b=windowBounds('console',area,undefined,slot,true);
   assert.equal(b.width,Math.min(800,area.width-16));assert.equal(b.height,Math.min(600,area.height-16));
   assert.equal(b.x,Math.round(area.x+(area.width-b.width)/2));
   assert.equal(b.y+b.height,area.y+area.height-8);
   assert.ok(b.x>=area.x+8&&b.y>=area.y+8);
   assert.ok(b.x+b.width<=area.x+area.width-8&&b.y+b.height<=area.y+area.height-8);
  }
 }
});
test('ALL選択画面: 負座標・縦画面・狭い画面でもConsole左下、Code右上、Live左上',()=>{
 for(const area of [{x:-1920,y:-1080,width:1920,height:1040},{x:0,y:90,width:1080,height:1880},{x:0,y:0,width:320,height:240}]){
  const consoleWindow=allWindowBounds('console',area),code=allWindowBounds('code',area),live=allWindowBounds('live',area);
  assert.equal(consoleWindow.width,Math.min(600,area.width-16));assert.equal(consoleWindow.height,Math.min(400,area.height-16));
  assert.equal(consoleWindow.x,area.x+8);assert.equal(consoleWindow.y+consoleWindow.height,area.y+area.height-8);
  assert.equal(code.x+code.width,area.x+area.width-8);assert.equal(code.y,area.y+8);
  assert.equal(live.x,area.x+8);assert.equal(live.y,area.y+8);
  assert.equal(code.height,Math.min(900,area.height-16));assert.equal(live.height,code.height);
  for(const kind of ['console','code','live'])for(let slot=0;slot<12;slot++){
   const b=allWindowBounds(kind,area,slot);
   assert.ok(b.x>=area.x&&b.y>=area.y&&b.x+b.width<=area.x+area.width&&b.y+b.height<=area.y+area.height);
  }
 }
});

test('ALL起動先: IDEがALL中の実在する画面IDだけを許可する',()=>{
 const source=readFileSync(new URL('../desktop.cjs',import.meta.url),'utf8');
 const body=source.slice(source.indexOf('function selectedAllDisplay('),source.indexOf('async function createWindow('));
 const owner={},display={id:17,workArea:{x:-1600,y:0,width:1600,height:900}};let active=true,displays=[display];
 const context={taskWindows:{},cliConsoleWindow:false,allDisplays:{state:record=>({active:record===owner&&active})},screen:{getAllDisplays:()=>displays}};
 vm.runInNewContext(body+';globalThis.select=selectedAllDisplay;',context);
 assert.equal(context.select(owner,undefined),null);assert.equal(context.select(owner,17),display);
 for(const id of [null,'17',{},18])assert.throws(()=>context.select(owner,id));
 active=false;assert.throws(()=>context.select(owner,17));active=true;displays=[];assert.throws(()=>context.select(owner,17));
});
for(const area of [{x:0,y:0,width:1920,height:1040},{x:-1600,y:80,width:1600,height:900},{x:0,y:-900,width:1024,height:728},{x:0,y:0,width:640,height:480},{x:-1080,y:-300,width:1080,height:1880},{x:120,y:50,width:640,height:640}]){
 test(`配置が画面内に収まり、IDEに余白を残す: ${JSON.stringify(area)}`,()=>{
  const ide=windowBounds('ide',area);
  assert.ok(ide.x>area.x&&ide.y>area.y);
  assert.ok(ide.width>area.width*.9&&ide.height>area.height*.9);
  for(const owner of [undefined,ide,{x:area.x-150,y:area.y-100,width:900,height:800}]){
   const code=windowBounds('code',area,owner),live=windowBounds('live',area,owner);
   assert.equal(code.width,480);assert.equal(live.width,480);
   assert.equal(code.height,Math.min(900,area.height-16));assert.equal(live.height,code.height);
   assert.equal(code.x,area.x+8);assert.equal(live.x,area.x+area.width-480-8);assert.equal(code.y,area.y+8);assert.equal(live.y,code.y);
   for(const b of [ide,code,live,windowBounds('console',area,owner),windowBounds('console',area,owner,3)]){
    assert.ok(b.x>=area.x&&b.y>=area.y);
    assert.ok(b.x+b.width<=area.x+area.width&&b.y+b.height<=area.y+area.height);
   }
   const consoleWindow=windowBounds('console',area,owner),next=windowBounds('console',area,owner,1);
   assert.equal(consoleWindow.width,Math.min(600,area.width-16));assert.equal(consoleWindow.height,Math.min(400,area.height-16));
   assert.equal(consoleWindow.x,area.x+8);
   assert.equal(consoleWindow.y+consoleWindow.height,area.y+area.height-8);
   const offset=Math.min(area.width-16-consoleWindow.width,area.height-16-consoleWindow.height)>=28?28:0;
   assert.equal(next.x,consoleWindow.x+offset);assert.equal(next.y,consoleWindow.y-offset);
   if(area.width>1000&&owner===ide){
    assert.equal(code.x,area.x+8);assert.equal(live.x+live.width,area.x+area.width-8);
    assert.ok(code.x<live.x);assert.equal(code.y,live.y);assert.equal(code.height,live.height);
   }
  }
 });
}
test('Consoleは左下から28pxずつ右上へ並び、画面端で初期位置へ戻る',()=>{
 for(const area of [{x:0,y:0,width:1920,height:1040},{x:-1080,y:40,width:1080,height:1880},{x:40,y:-240,width:240,height:240}]){
  const first=windowBounds('console',area);
  const steps=Math.max(1,Math.floor(Math.min(area.x+area.width-8-first.width-first.x,first.y-area.y-8)/28)+1);
  for(let slot=0;slot<steps*2+1;slot++){
   const offset=(slot%steps)*28,bounds=windowBounds('console',area,undefined,slot);
   assert.equal(bounds.x,first.x+offset);assert.equal(bounds.y,first.y-offset);
  }
  assert.deepEqual(windowBounds('console',area,undefined,steps),first);
 }
});

test('最小寸法: Consoleだけ高さ180、横幅・Code/Live/IDE/ビューアは従来どおり',()=>{
 const bounds={width:1000,height:900};
 for(const [kind,minWidth,minHeight] of [['console',360,180],['code',360,480],['live',360,480],['ide',400,550],['viewer',360,480]]){
  assert.deepEqual(windowMinimumSize(kind,bounds),{minWidth,minHeight});
  for(const small of [{width:320,height:160},{width:360,height:180},{width:1,height:1}]){
   assert.deepEqual(windowMinimumSize(kind,small),{minWidth:Math.min(minWidth,small.width),minHeight:Math.min(minHeight,small.height)});
  }
 }
});
test('Electron生成: 単独Console・IDE子Consoleの双方へ最小寸法を渡し、通常600×400・CLI800×600を使い分ける',async()=>{
 const source=readFileSync(new URL('../desktop.cjs',import.meta.url),'utf8');
 const body=source.slice(source.indexOf('function selectedAllDisplay(owner,displayId){'),source.indexOf("process.on('disconnect'"));
 const area={x:0,y:0,width:1920,height:1040},windows=new Map();
 class Window{
  constructor(options){this.options=options;this.webContents={on(){},setWindowOpenHandler(){},async executeJavaScript(){}};}
  once(){} on(){} setBounds(bounds){this.bounds=bounds;} getBounds(){return this.bounds;} setAlwaysOnTop(){} isDestroyed(){return false;} async loadURL(){}
 }
 const context={taskWindows:{},cliConsoleWindow:false,allDisplays:{register(){}},BrowserWindow:Window,windows,windowBounds,windowMinimumSize,screen:{getDisplayMatching:()=>({workArea:area}),getDisplayNearestPoint:()=>({workArea:area}),getCursorScreenPoint:()=>({x:0,y:0})},reserveConsoleSlot:async()=>({slot:0,close(){}}),quitting:false,join:(...parts)=>parts.join('/'),__dirname:'/fixture',拡大表示:async()=>true,setInterval:()=>({unref(){}})};
 context.registerWindowPin=()=>{};context.attachWindowMove=()=>{};
 vm.runInNewContext(body+';globalThis.create=createWindow;',context);
 const owner={window:{getBounds:()=>windowBounds('ide',area),isDestroyed:()=>false},revision:0};
 for(const parent of [undefined,owner])for(const kind of ['navi','console','code','live','ide','viewer']){
  const window=await context.create(kind,'http://127.0.0.1:1234/',undefined,parent,'offline:1');
  const bounds=windowBounds(kind,area,parent?.window.getBounds());
  assert.deepEqual(window.bounds,bounds);
  assert.equal(window.options.minHeight,kind==='console'?180:kind==='ide'?550:480);
  assert.equal(window.options.minWidth,kind==='ide'?400:360);
  assert.equal(window.options.height,bounds.height);assert.equal(window.options.width,bounds.width);
  if(kind==='console'){assert.equal(window.bounds.width,600);assert.equal(window.bounds.height,400);}
  assert.equal(window.options.frame,false);assert.notEqual(window.options.resizable,false);
 }
 context.cliConsoleWindow=true;context.process={env:{}};
 for(const parent of [undefined,owner]){
  const window=await context.create('console','http://127.0.0.1:1234/',undefined,parent,'offline:1');
  assert.deepEqual(window.bounds,windowBounds('console',area,parent?.window.getBounds(),0,!parent));
  assert.equal(window.bounds.width,parent?600:800);assert.equal(window.bounds.height,parent?400:600);
  if(parent){
   assert.equal(window.bounds.x,area.x+8);assert.equal(window.bounds.y+window.bounds.height,area.y+area.height-8);
  }else{
   assert.equal(window.bounds.x,Math.round(area.x+(area.width-window.bounds.width)/2));
   assert.equal(window.bounds.y+window.bounds.height,area.y+area.height-8);
  }
 }

});

test('IDE連携Codeだけ2枚目以降を24pxずらし、親窓の移動や寸法に依存しない',()=>{
 const area={x:-1600,y:40,width:1600,height:1000},owner={x:-1450,y:200,width:800,height:700};
 const first=windowBounds('code',area,owner);
 assert.deepEqual(first,windowBounds('code',area));
 for(let slot=1;slot<20;slot++){
  const offset=((slot-1)%5+1)*24,bounds=windowBounds('code',area,owner,slot);
  assert.equal(bounds.x,first.x+offset);assert.equal(bounds.y,Math.min(first.y+offset,area.y+area.height-first.height-8));
  assert.deepEqual(bounds,windowBounds('code',area,{x:900,y:800,width:600,height:600},slot));
  assert.deepEqual(windowBounds('code',area,undefined,slot),first);
  assert.deepEqual(windowBounds('live',area,owner,slot),windowBounds('live',area));
 }
});

test('狭い画面でも全窓と最小寸法を作業領域内へ収め、Consoleの600×400を必要な分だけ縮小する',()=>{
 for(const area of [{x:0,y:40,width:640,height:480},{x:-320,y:0,width:320,height:480},{x:0,y:-300,width:320,height:300},{x:0,y:0,width:240,height:240}]){
  for(const kind of ['code','live','console','viewer'])for(let slot=0;slot<20;slot++){
   const b=windowBounds(kind,area,windowBounds('ide',area),slot),min=windowMinimumSize(kind,b);
   assert.ok(b.x>=area.x+8&&b.y>=area.y+8);
   assert.ok(b.x+b.width<=area.x+area.width-8&&b.y+b.height<=area.y+area.height-8);
   assert.ok(min.minWidth<=b.width&&min.minHeight<=b.height);
   if(kind==='console'){assert.equal(b.width,Math.min(600,area.width-16));assert.equal(b.height,Math.min(400,area.height-16));}
  }
 }
});

test('Electron生成: 親IDE側の画面を選び、Code番号・閉鎖後のslot再利用・手動配置を維持する',async()=>{
 const source=readFileSync(new URL('../desktop.cjs',import.meta.url),'utf8');
 const body=source.slice(source.indexOf('function selectedAllDisplay(owner,displayId){'),source.indexOf("process.on('disconnect'"));
 const primary={x:0,y:0,width:1920,height:1040},secondary={x:-1080,y:-200,width:1080,height:1880},windows=new Map(),matched=[];
 let cursorArea=primary;
 class Window{
  constructor(options){this.options=options;this.closed=[];this.webContents={on(){},setWindowOpenHandler(){},async executeJavaScript(){}};}
  once(name,fn){if(name==='closed')this.closed.push(fn);} on(){} setBounds(bounds){this.bounds=bounds;} getBounds(){return this.bounds;} setAlwaysOnTop(){} isDestroyed(){return !!this.destroyed;} async loadURL(){}
  destroy(){this.destroyed=true;for(const fn of this.closed)fn();} isMinimized(){return true;} restore(){} show(){} focus(){}
 }
 const context={launchDisplayArea:null,taskWindows:{},cliConsoleWindow:false,allDisplays:{register(){}},BrowserWindow:Window,windows,windowBounds,windowMinimumSize,screen:{getPrimaryDisplay:()=>({workArea:primary}),getDisplayMatching:bounds=>{matched.push(bounds);return{workArea:bounds.x<0?secondary:primary};},getDisplayNearestPoint:()=>({workArea:cursorArea}),getCursorScreenPoint:()=>({x:cursorArea.x+20,y:cursorArea.y+20})},reserveConsoleSlot:async()=>({slot:0,close(){}}),quitting:false,join:(...parts)=>parts.join('/'),__dirname:'/fixture',拡大表示:async()=>true,setInterval:()=>({unref(){}}),clearInterval(){},draftRouter:{invalidate(){}},nativePreviewActions:{invalidate(){}},closeChildren(){},closeServer(){},setWindowBounds:(window,bounds)=>window.setBounds(bounds)};
 context.registerWindowPin=()=>{};context.attachWindowMove=()=>{};
 vm.runInNewContext(body+';globalThis.create=createWindow;',context);
 const owner={window:{getBounds:()=>({x:-900,y:150,width:700,height:800}),isDestroyed:()=>false},revision:0};
 const create=kind=>context.create(kind,'http://127.0.0.1:1234/',undefined,owner,'offline:1');
 const first=await create('code'),second=await create('code'),third=await create('code');
 assert.equal(first.options.parent,undefined);
 assert.deepEqual([first,second,third].map(w=>w.options.title),['AiDiy IDE / Code 1','AiDiy IDE / Code 2','AiDiy IDE / Code 3']);
 assert.deepEqual(first.bounds,windowBounds('code',secondary));
 assert.equal(second.bounds.x,first.bounds.x+24);assert.equal(second.bounds.y,first.bounds.y+24);
 second.destroy();const reopened=await create('code');assert.deepEqual(reopened.bounds,second.bounds);assert.equal(reopened.options.title,second.options.title);
 const live=await create('live'),consoleWindow=await create('console');
 assert.equal(live.options.parent,undefined);assert.equal(consoleWindow.options.parent,undefined);
 assert.deepEqual(live.bounds,windowBounds('live',secondary));assert.equal(consoleWindow.bounds.width,600);assert.equal(consoleWindow.bounds.height,400);
 assert.ok(matched.length>=6);assert.deepEqual(matched[0],owner.window.getBounds());
 const standalone=await context.create('code','http://127.0.0.1:1234/');assert.deepEqual(standalone.bounds,windowBounds('code',primary));
 const navi=await create('navi');assert.deepEqual(navi.bounds,windowBounds('navi',secondary));
 const cpu=await create('cpu');assert.deepEqual(cpu.bounds,windowBounds('cpu',secondary),'IDE子CPUはカーソルではなく親IDEの画面');
 // Diagの画面を受け取ると、ポインターが別画面へ移ってもその画面内の定位置を使う。
 for(const area of [secondary,primary]){
  context.launchDisplayArea=area;cursorArea=area===primary?secondary:primary;
  const standaloneCpu=await context.create('cpu','http://127.0.0.1:1234/');
  assert.deepEqual(standaloneCpu.bounds,windowBounds('cpu',area));
  const standaloneIde=await context.create('ide','http://127.0.0.1:1234/');
  assert.deepEqual(standaloneIde.bounds,windowBounds('ide',cursorArea),'IDEの既存画面選択は変更しない');
  assert.deepEqual((await create('cpu')).bounds,windowBounds('cpu',secondary),'親IDEの画面を起動元指定より優先する');
 }
 context.launchDisplayArea=null;cursorArea=secondary;
 assert.deepEqual((await context.create('cpu','http://127.0.0.1:1234/')).bounds,windowBounds('cpu',primary),'Diag指定なしの単独CPUは従来の主画面');
 const manual={x:-750,y:100,width:500,height:700};
 vm.runInNewContext(source.slice(source.indexOf('function focusWindow(window){'),source.indexOf("app.on('second-instance'"))+';globalThis.focus=focusWindow;',context);
 for(const window of [first,live,navi,consoleWindow,cpu]){window.setBounds(manual);context.focus(window);assert.deepEqual(window.bounds,manual);}
});

test('Code / Liveは900 DIPを初期高さとし、余白込みで収まらない時だけ縮小する',()=>{
 for(const height of [1040,917,916,915,768,480,240]){
  const area={x:-1280,y:-300,width:1280,height};
  for(const kind of ['code','live'])for(const owner of [undefined,windowBounds('ide',area)])for(let slot=0;slot<12;slot++){
   const b=windowBounds(kind,area,owner,slot),minimum=windowMinimumSize(kind,b);
   assert.equal(b.height,Math.min(900,height-16));assert.equal(b.width,480);
   assert.ok(b.x>=area.x+8&&b.x+b.width<=area.x+area.width-8);
   assert.ok(b.y>=area.y+8&&b.y+b.height<=area.y+height-8);
   assert.equal(minimum.minHeight,Math.min(480,b.height));
  }
 }
});

 test('CPUは400×125、Diagミニ250の上に33 DIPを空け、小画面へ収める',()=>{
 for(const area of [{x:0,y:0,width:1920,height:1040},{x:-1600,y:80,width:1600,height:900},{x:0,y:-300,width:320,height:300},{x:20,y:40,width:200,height:90}]){
  const b=windowBounds('cpu',area);
  assert.equal(b.width,Math.min(400,area.width-16));assert.equal(b.height,Math.min(125,area.height-16));
  assert.equal(b.x+b.width,area.x+area.width-8);
  assert.equal(b.y,Math.max(area.y+8,area.y+area.height-8-b.height-250-33));
  assert.ok(b.y+b.height<=area.y+area.height-8);
  assert.deepEqual(windowMinimumSize('cpu',b),{minWidth:Math.min(240,b.width),minHeight:Math.min(125,b.height)});
 }
});
