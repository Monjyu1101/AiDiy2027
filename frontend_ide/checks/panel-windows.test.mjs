// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import native from '../デスクトップ/panel-windows.cjs';
import pinModule from '../デスクトップ/最前面ピン.cjs';
import {popupFeatures,fadePanel} from '../src/components/ファイル閲覧/パネル別窓.js';
const {panelBounds,createPanelWindows}=native;
test('表示開始フェード: opacityだけ260ms、再実行で古い演出解除、OS設定にかかわらず表示',()=>{
 let reduced=false,cancelled=0;const calls=[];
 const element={ownerDocument:{defaultView:{matchMedia:()=>({matches:reduced})}},animate:(frames,options)=>{calls.push({frames,options});return{cancel:()=>cancelled++,finished:new Promise(()=>{})};}};
 fadePanel(element);assert.deepEqual(calls,[{frames:[{opacity:0},{opacity:1}],options:{duration:260,easing:'ease-out'}}]);
 fadePanel(element);assert.equal(cancelled,1);reduced=true;fadePanel(element);assert.equal(cancelled,2);assert.equal(calls.length,3);
});
for(const zoom of [.8,1,1.25,2])test(`パネル配置: zoom=${zoom}、負座標・別画面・画面外をDIPへ変換`,()=>{
 const area={x:-1600,y:-100,width:1600,height:1000};let requested;
 const screen={getDisplayMatching:rect=>{requested=rect;return{workArea:area};}};
 const owner={window:{getContentBounds:()=>({x:-1400,y:0}),webContents:{getZoomFactor:()=>zoom}}};
 const rect={left:200,top:100,width:380,height:500},bounds=panelBounds(rect,owner,screen);
 assert.equal(requested.x,-1400+200*zoom);assert.equal(requested.y,100*zoom);
 assert.equal(bounds.width,Math.round(380*zoom));
 for(const input of [rect,{left:-9000,top:9000,width:9000,height:9000}]){
  const result=panelBounds(input,owner,screen);assert.ok(result.x>=area.x&&result.y>=area.y);assert.ok(result.x+result.width<=area.x+area.width);assert.ok(result.y+result.height<=area.y+area.height);
 }
 assert.equal(panelBounds({...rect,width:NaN},owner,screen),null);
});
test('ブラウザー配置: 負座標画面でも範囲内、OSのdevicePixelRatioで二重拡大しない',()=>{
 const win={screen:{availLeft:-1600,availTop:-100,availWidth:1600,availHeight:1000},screenX:-1500,screenY:0,innerWidth:1000,outerWidth:1020,innerHeight:700,outerHeight:780,devicePixelRatio:2};
 const input={left:100,top:100,width:380,height:500},features=popupFeatures(input,win);
 assert.equal(features,'popup,left=-1390,top=170,width=380,height=500');
 assert.equal(features,popupFeatures(input,{...win,devicePixelRatio:1}));
 assert.equal(popupFeatures({...input,left:5000,top:5000},win),'popup,left=-388,top=340,width=380,height=500');
});
function fixture({all=false,area={x:0,y:0,width:1920,height:1040}}={}){
 const windows=new Map();let state={active:true,mode:'offline',startedAt:1},animations=0,quitting=false;
 class Window extends EventEmitter{
  constructor(){super();this.webContents=new EventEmitter();Object.assign(this.webContents,{executeJavaScript:async()=>{},getZoomFactor:()=>1,setWindowOpenHandler:fn=>{this.handler=fn;}});}
  setParentWindow(value){this.parent=value;}
  isAlwaysOnTop(){return !!this.top;}
  isDestroyed(){return !!this.dead;}destroy(){this.dead=true;this.emit('closed');}close(){this.destroy();}minimize(){this.minimized=true;}maximize(){this.maximized=true;}unmaximize(){this.maximized=false;}isMaximized(){return !!this.maximized;}setBounds(value){this.bounds=value;}setAlwaysOnTop(value){this.top=value;}getContentBounds(){return this.bounds||{x:100,y:100,width:420,height:360};}getBounds(){return this.getContentBounds();}show(){this.shown=true;}focus(){}
 }
 const owner={window:new Window(),kind:'ide',revision:0},event={owner},key=state=>state.active?`${state.mode}:${state.startedAt}`:'';
 const windowPins=pinModule.createWindowPins();
 const controller=createPanelWindows({windowPins,registerWindowPin:record=>windowPins.register(record.window,{pinned:true,locked:all,owner:record.owner?.window}),windows,trustedEvent:e=>e.owner,readState:async()=>state,sessionKey:key,screen:{getDisplayMatching:()=>({workArea:area}),getDisplayNearestPoint:()=>({workArea:area}),getCursorScreenPoint:()=>({x:area.x+100,y:area.y+100})},BrowserWindow:Window,拡大表示:async()=>{animations++;},isQuitting:()=>quitting,isAllDisplays:()=>all});
 return{windows,Window,owner,event,controller,rect:{left:16,top:78,width:380,height:650},state:next=>{state=next;},animations:()=>animations,quit:()=>{quitting=true;}};
}
test('ALL中の新規パネルは仮想領域でなく操作画面へ収め、元画面のキャプチャを要求しない',async()=>{
 const area={x:-1280,y:350,width:1280,height:984},f=fixture({all:true,area});
 for(const kind of ['panel-viewer','panel-routes','panel-navigation','explorer']){
  const request=await f.controller.prepare(f.event,{left:9000,top:-9000,width:8000,height:4000},kind,{left:9000,top:-9000,width:8000,height:4000});assert.equal(request.ok,true);assert.equal(request.preview,undefined);
  const details={url:'about:blank',frameName:request.name},bounds=f.controller.open(f.owner,details).overrideBrowserWindowOptions;
  assert.ok(bounds.x>=area.x&&bounds.y>=area.y&&bounds.x+bounds.width<=area.x+area.width&&bounds.y+bounds.height<=area.y+area.height);assert.ok(bounds.width<=680);
  if(kind==='panel-navigation'){assert.equal(bounds.x,area.x+8);assert.ok(Math.abs(bounds.y+bounds.height/2-area.y-area.height/2)<=.5);}
  const child=new f.Window();f.controller.created(f.owner,child,details);assert.equal(child.parent,null);child.destroy();
 }
});

test('Explorer: 承認済みabout:blankを一回だけ許可し、OS親子関係なしで起動元へ登録',async()=>{
 const f=fixture(),request=await f.controller.prepare(f.event,f.rect);assert.equal(request.ok,true);
 assert.equal(f.controller.open(f.owner,{url:'https://example.invalid',frameName:request.name}),null);
 assert.equal(f.controller.open(f.owner,{url:'about:blank',frameName:'wrong'}),null);
 const details={url:'about:blank',frameName:request.name},result=f.controller.open(f.owner,details);assert.equal(result.action,'allow');assert.equal(result.overrideBrowserWindowOptions.webPreferences.nodeIntegration,false);
 assert.equal(f.controller.open(f.owner,details),null);
 const child=new f.Window();f.controller.created(f.owner,child,details);
 assert.equal(f.controller.dragTarget(f.owner,request.name),null,'表示前は移動対象にしない');
 assert.equal(child.parent,null);
 assert.equal(f.windows.get(child.webContents).owner,f.owner);assert.equal(f.windows.get(child.webContents).linkKey,'offline:1');
 assert.equal((await f.controller.show(f.event,request.name,false)).ok,true);assert.equal(f.animations(),1);
 assert.equal(f.controller.dragTarget(f.owner,request.name),f.windows.get(child.webContents));
 assert.equal(f.controller.dragTarget({...f.owner},request.name),null);assert.equal(f.controller.dragTarget(f.owner,'wrong'),null);
 f.owner.revision++;assert.equal(f.controller.dragTarget(f.owner,request.name),null);f.owner.revision--;
 await f.controller.show(f.event,request.name,false);assert.equal(f.animations(),1,'子リロードでネイティブ演出を重複しない');
 child.destroy();assert.equal(f.windows.size,0);
});
test('元表示の保持: zoomだけを掛けて撮影し、画面外を切り取り、撮影中の世代変更を拒否',async()=>{
 const f=fixture(),captures=[];
 f.owner.window.webContents.getZoomFactor=()=>1.25;
 f.owner.window.webContents.capturePage=async rect=>{captures.push(rect);return{isEmpty:()=>false,toDataURL:()=> 'data:image/png;base64,fixture'};};
 const rect={left:10,top:20,width:200,height:100};
 const result=await f.controller.prepare(f.event,rect,'panel-viewer',rect);
 assert.equal(result.ok,true);assert.deepEqual(captures,[{x:12,y:25,width:251,height:125}]);
 assert.deepEqual(result.preview.rect,{left:9.6,top:20,width:200.8,height:100});
 f.owner.window.webContents.capturePage=async()=>{f.owner.revision++;return{isEmpty:()=>false,toDataURL:()=>''};};
 assert.equal((await f.controller.prepare(f.event,rect,'panel-viewer',rect)).ok,false);
});

test('Explorer: 旧省略フラグでも共通ズーム、終了済み・別親のshowを拒否',async()=>{
 const f=fixture(),request=await f.controller.prepare(f.event,f.rect),details={url:'about:blank',frameName:request.name};
 f.controller.open(f.owner,details);const child=new f.Window();f.controller.created(f.owner,child,details);
 assert.equal((await f.controller.show({owner:{kind:'ide'}},request.name,true)).ok,false);
 assert.equal((await f.controller.show(f.event,request.name,true)).ok,true);assert.equal(f.animations(),1);
 f.state({active:false});assert.equal((await f.controller.show(f.event,request.name,true)).ok,false);child.destroy();
});
test('Explorer: 非IDE・無効位置・セッション終了・古い起動予約を拒否',async()=>{
 const f=fixture();assert.equal((await f.controller.prepare({owner:{kind:'viewer'}},f.rect)).ok,false);
 assert.equal((await f.controller.prepare(f.event,{...f.rect,height:-1})).ok,false);
 const request=await f.controller.prepare(f.event,f.rect);f.owner.revision++;
 assert.equal(f.controller.open(f.owner,{url:'about:blank',frameName:request.name}),null);
 f.state({active:false});assert.equal((await f.controller.prepare(f.event,f.rect)).ok,false);
});
test('Viewer/比較/軌跡: Explorerと共存し、同じ予約・配置・ズーム・終了境界を使う',async()=>{
 const f=fixture(),children=[];
 for(const kind of ['explorer','panel-viewer','panel-viewer','panel-routes']){
  const request=await f.controller.prepare(f.event,f.rect,kind);assert.equal(request.ok,true);
  const details={url:'about:blank',frameName:request.name};assert.equal(f.controller.open(f.owner,details).action,'allow');
  const child=new f.Window();f.controller.created(f.owner,child,details);children.push(child);
  assert.equal(f.windows.get(child.webContents).kind,kind);
  assert.equal((await f.controller.show(f.event,request.name,false)).ok,true);
 }
 assert.equal(f.windows.size,4);assert.equal(f.animations(),4,'軌跡の別窓も表示開始ズームを共用する');
 assert.equal((await f.controller.prepare(f.event,f.rect,'explorer')).ok,false);
 assert.equal((await f.controller.prepare(f.event,f.rect,'untrusted')).ok,false);
 for(const child of children)child.destroy();assert.equal(f.windows.size,0);
});

test('軌跡: 透明枠なしの小さいバーから先に領域確保、上端維持・画面下端制限・閉じると縮小',async()=>{
 const f=fixture(),request=await f.controller.prepare(f.event,{left:16,top:78,width:360,height:68},'panel-routes');
 const details={url:'about:blank',frameName:request.name},options=f.controller.open(f.owner,details).overrideBrowserWindowOptions;
 assert.equal(options.height,68);assert.equal(options.frame,false);assert.equal(options.transparent,true);assert.equal(options.backgroundColor,'#00000000');
 const child=new f.Window();f.controller.created(f.owner,child,details);child.setBounds({x:116,y:900,width:360,height:68});
 const expanded=f.controller.resizeRoutes(f.event,request.name,368);assert.equal(expanded.ok,true);assert.equal(child.bounds.y,900);assert.equal(child.bounds.height,132);assert.equal(expanded.height,132);
 f.controller.resizeRoutes(f.event,request.name,68);assert.equal(child.bounds.y,900);assert.equal(child.bounds.height,68);
 assert.equal(f.controller.resizeRoutes({owner:{kind:'ide'}},request.name,360).ok,false);
 assert.equal(f.controller.resizeRoutes(f.event,request.name,NaN).ok,false);assert.equal(f.controller.resizeRoutes(f.event,request.name,9000).ok,false);
 f.owner.revision++;assert.equal(f.controller.resizeRoutes(f.event,request.name,360).ok,false);child.destroy();
});

test('共通タイトルバー: 所有する別窓だけ操作し、別親・古い世代・未許可操作を拒否',async()=>{
 const f=fixture(),request=await f.controller.prepare(f.event,f.rect,'panel-viewer');
 const details={url:'about:blank',frameName:request.name},options=f.controller.open(f.owner,details).overrideBrowserWindowOptions;
 assert.equal(options.frame,false);assert.equal(options.roundedCorners,false);
 const child=new f.Window();f.controller.created(f.owner,child,details);
 assert.equal(f.controller.action({owner:{kind:'ide'}},request.name,'maximize'),false);assert.equal(child.isMaximized(),false);
 assert.equal(f.controller.action(f.event,request.name,'maximize'),true);assert.equal(child.isMaximized(),true);
 assert.equal(f.controller.action(f.event,request.name,'maximize'),false);assert.equal(child.isMaximized(),false);
 f.controller.action(f.event,request.name,'minimize');assert.equal(child.minimized,true);
 assert.equal(f.controller.action(f.event,request.name,'destroy'),false);
 f.owner.revision++;assert.equal(f.controller.action(f.event,request.name,'close'),false);assert.equal(child.isDestroyed(),false);
 f.owner.revision--;f.controller.action(f.event,request.name,'close');assert.equal(child.isDestroyed(),true);assert.equal(f.windows.size,0);
});

test('別窓ピン: Explorer・比較Viewer・軌跡はIDE由来ON、OFF後の再表示・高さ変更で再固定しない',async()=>{
 for(const kind of ['explorer','panel-viewer','panel-routes','panel-navigation']){
  const f=fixture(),request=await f.controller.prepare(f.event,f.rect,kind),details={url:'about:blank',frameName:request.name};
  f.controller.open(f.owner,details);const child=new f.Window();f.controller.created(f.owner,child,details);
  assert.deepEqual(f.controller.action(f.event,request.name,'pin-state'),{pinned:true,locked:false});assert.equal(child.parent,null);
  assert.deepEqual(f.controller.action(f.event,request.name,'toggle-pin'),{pinned:false,locked:false});
  await f.controller.show(f.event,request.name);await f.controller.show(f.event,request.name);
  if(kind==='panel-routes')f.controller.resizeRoutes(f.event,request.name,200);
  assert.equal(child.top,false);assert.equal(child.parent,null);
  assert.equal(f.controller.action({owner:{kind:'ide'}},request.name,'toggle-pin'),false);
  f.owner.revision++;assert.equal(f.controller.action(f.event,request.name,'toggle-pin'),false);assert.equal(child.top,false);
  child.destroy();
 }
});

test('VR中に作成する全別窓はON固定、軌跡の最小化・最大化は拒否する',async()=>{
 for(const kind of ['explorer','panel-viewer','panel-routes','panel-navigation']){
  const f=fixture({all:true}),request=await f.controller.prepare(f.event,f.rect,kind),details={url:'about:blank',frameName:request.name};
  f.controller.open(f.owner,details);const child=new f.Window();f.controller.created(f.owner,child,details);
  assert.deepEqual(f.controller.action(f.event,request.name,'toggle-pin'),{pinned:true,locked:true});assert.equal(child.top,true);assert.equal(child.parent,null);
  f.controller.action(f.event,request.name,'minimize');assert.equal(!!child.minimized,kind!=='panel-routes');
  f.controller.action(f.event,request.name,'maximize');assert.equal(!!child.maximized,kind!=='panel-routes');
  child.destroy();
 }
});

test('Viewerパネル: 負座標の実画面内へ収め、DPI倍率を二重適用しない',()=>{
 const screens=[{x:-1600,y:200,width:1500,height:860},{x:0,y:0,width:1920,height:1040}];
 for(const zoom of [.8,1,1.5,2]){
  const owner={window:{getContentBounds:()=>({x:-1500,y:220}),webContents:{getZoomFactor:()=>zoom}}};
  const result=panelBounds({left:1400,top:800,width:420,height:360},owner,{getDisplayMatching:()=>({workArea:screens[0]})},'panel-viewer');
  assert.ok(result.x>=-1600&&result.x+result.width<=-100);assert.ok(result.y>=200&&result.y+result.height<=1060);
  assert.equal(result.width,420*zoom);
  // 高さは元パネルやzoomによらず900 DIP。高さ860の作業領域では余白16を引いた844へ縮む。
  assert.equal(result.height,844);
  assert.equal(panelBounds({left:1400,top:100,width:420,height:360},owner,{getDisplayMatching:()=>({workArea:{x:-1600,y:0,width:1500,height:1400}})},'panel-viewer').height,900);
 }
});

test('Navi別窓は通常・VR・小画面とも専用の初期高さと従来の最小寸法を使う',async()=>{
 const {windowBounds,windowMinimumSize}=await import('../デスクトップ/window-layout.cjs');
 for(const all of [false,true])for(const area of [{x:0,y:0,width:1920,height:1040},{x:-300,y:-200,width:320,height:240}]){
  const f=fixture({all,area}),request=await f.controller.prepare(f.event,f.rect,'panel-navigation');
  const {overrideBrowserWindowOptions:options}=f.controller.open(f.owner,{url:'about:blank',frameName:request.name});
  const code=windowBounds('code',area);
  assert.deepEqual([options.width,options.height],[Math.min(480,area.width-16),Math.min(900,area.height-16)]);
  assert.deepEqual({minWidth:options.minWidth,minHeight:options.minHeight},windowMinimumSize('code',code));
  assert.equal(options.x,area.x+8);assert.ok(Math.abs(options.y+options.height/2-area.y-area.height/2)<=.5);
  assert.notEqual(options.resizable,false);
 }
});

test('Navi native and VR launch at 900 DIP without resetting a manually resized window on show',async()=>{
 for(const all of [false,true])for(const height of [1040,700,480]){
  const f=fixture({all,area:{x:-1280,y:350,width:1280,height}});
  const request=await f.controller.prepare(f.event,f.rect,'panel-navigation');assert.equal(request.ok,true);
  const details={url:'about:blank',frameName:request.name},options=f.controller.open(f.owner,details).overrideBrowserWindowOptions;
  assert.equal(options.width,480);assert.equal(options.height,Math.min(900,height-16));
  const child=new f.Window();f.controller.created(f.owner,child,details);await f.controller.show(f.event,request.name);
  const manual={...child.getBounds(),width:520,height:420};child.setBounds(manual);
  await f.controller.show(f.event,request.name);assert.deepEqual(child.getBounds(),manual);child.destroy();
 }
});

test('Explorer連携別窓は通常・ALLとも900 DIPを基準に画面内へ収め、手動リサイズを保持する',async()=>{
  for(const all of [false,true])for(const height of [1200,916,900,700,240])for(const zoom of [.8,1,1.25,2]){
   const area={x:-1280,y:-350,width:1280,height},f=fixture({all,area});
   f.owner.window.webContents.getZoomFactor=()=>zoom;
   for(let cycle=0;cycle<2;cycle++){
    const request=await f.controller.prepare(f.event,f.rect,'explorer');assert.equal(request.ok,true);
    const details={url:'about:blank',frameName:request.name},options=f.controller.open(f.owner,details).overrideBrowserWindowOptions;
    assert.equal(options.height,Math.min(900,height-16));
    assert.ok(options.y>=area.y+8&&options.y+options.height<=area.y+height-8);
    assert.equal(options.width,all?340:Math.round(f.rect.width*zoom));
    assert.ok(options.minHeight<=options.height);assert.ok(options.minWidth<=options.width);
    const child=new f.Window();f.controller.created(f.owner,child,details);await f.controller.show(f.event,request.name);
    assert.equal(child.getBounds().height,options.height);
    const manual={...child.getBounds(),height:180};child.setBounds(manual);
    await f.controller.show(f.event,request.name);assert.deepEqual(child.getBounds(),manual);child.destroy();
   }
  }
 });

for(const [kind,icon] of [['explorer','ide'],['panel-viewer','ide'],['panel-routes','ide'],['panel-navigation','navi']])test(`${kind}: 初回・閉じて再表示とも所有元のアイコンを指定する`,async()=>{
 const f=fixture();
 for(let attempt=0;attempt<2;attempt++){
  const request=await f.controller.prepare(f.event,f.rect,kind);assert.equal(request.ok,true);
  const details={url:'about:blank',frameName:request.name};
  const result=f.controller.open(f.owner,details);assert.equal(result.action,'allow');
  const expected=fileURLToPath(new URL(`../public/AiDiy_${icon}.png`,import.meta.url));
  assert.equal(result.overrideBrowserWindowOptions.icon,expected);
  assert.deepEqual(readFileSync(expected),readFileSync(new URL(`../aidiy_${icon}/AiDiy_${icon}.png`,import.meta.url)));
  assert.equal(f.controller.open(f.owner,details),null,'再利用は拒否したまま');
  const child=new f.Window();f.controller.created(f.owner,child,details);child.destroy();
 }
});
