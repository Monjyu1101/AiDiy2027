// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import micro from '../起動/マイクロ表示.cjs';
import pinModule from '../../frontend_ide/デスクトップ/最前面ピン.cjs';
import layout from '../ui/src/components/アプリ起動/円周配置.cjs';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('透過判定のDOM応答待ちにカーソルが変わったら古い判定を捨てる',async()=>{
 const {w,screen,control}=fixture();let point={x:110,y:90},resolve,called=false;
 screen.getCursorScreenPoint=()=>point;
 w.webContents.executeJavaScript=()=>{called=true;return new Promise(done=>resolve=done);};
 control.set(true);
 try{
  for(let n=0;n<20&&!called;n++)await sleep(10);
  assert.ok(called);point={x:150,y:130};resolve(false);await sleep(1);
  assert.notEqual(w.ignored,true,'旧位置のfalseで新位置のクリックを透過しない');
 }finally{control.set(false);resolve?.(false);}
});
test('有効数に応じて最小半径80から広げ、回転中も48pxクリック領域同士が重ならない',()=>{
 let previous=0;
 for(let n=0;n<=32;n++){
  const {半径,幅,内半径,内側数,外側数}=layout.円周配置(n);assert.ok(半径>=80&&半径>=previous);previous=半径;
  assert.equal(幅,2*(半径+38));
  assert.equal(内側数,n>=11?Math.round(n*.4):n);assert.equal(内側数+外側数,n);
  if(内側数>1)assert.ok(2*内半径*Math.sin(Math.PI/内側数)>=48*Math.SQRT2);
  if(外側数){assert.ok(半径-内半径>=70);assert.ok(2*半径*Math.sin(Math.PI/外側数)>=48*Math.SQRT2);}
 }
 assert.equal(layout.円周配置(6).幅,236);assert.equal(layout.円周配置(13).幅,376);
 for(const n of [-1,33,NaN,'13',1.5])assert.equal(layout.円周配置(n),null);
});
test('展開中の有効数変更でも画面内に収まり、収納位置と移動量を保持',()=>{
 const {w,control}=fixture();control.set(true);w.bounds={x:1792,y:952,width:128,height:128};
 control.expand(true,6);assert.equal(w.bounds.width,236);
 w.bounds.x-=20;w.bounds.y-=30;
 control.expand(true,13);assert.equal(w.bounds.width,376);assert.ok(w.bounds.x+376<=1920&&w.bounds.y+376<=1080);
 control.expand(true,6);assert.equal(w.bounds.width,236);
 assert.equal(control.expand(true,33),false);assert.equal(w.bounds.width,236);
 control.expand(false);assert.deepEqual(w.bounds,{x:1772,y:922,width:128,height:128});control.set(false);
});
function fixture({strict=false}={}){
 const w=new EventEmitter();Object.assign(w,{bounds:{x:100,y:80,width:800,height:600},minimum:[420,320],maximizable:true,resizable:true,top:false,
 isDestroyed(){return false;},isAlwaysOnTop(){return !!this.top;},getBounds(){return {...this.bounds};},getNormalBounds(){return this.getBounds();},getMinimumSize(){return this.minimum;},isMaximized(){return !!this.maximized;},isMaximizable(){return this.maximizable;},isResizable(){return this.resizable;},setMinimumSize(...v){this.minimum=v;},setBounds(v){this.bounds=v;},setMaximizable(v){this.maximizable=v;},setResizable(v){this.resizable=v;},setAlwaysOnTop(v){this.top=v;},setIgnoreMouseEvents(v){this.ignored=v;},maximize(){this.maximized=true;},unmaximize(){this.maximized=false;},webContents:{executeJavaScript:async()=>false}});
 if(strict){
  const contents=Object.assign(new EventEmitter(),{executeJavaScript:async()=>false});
  Object.defineProperty(w,'webContents',{get(){if(this.destroyed)throw new TypeError('Object has been destroyed');return contents;}});
  w.isDestroyed=()=>!!w.destroyed;
  w.destroy=()=>{w.destroyed=true;w.emit('closed');};
 }
 const pins=pinModule.createWindowPins();pins.register(w);
 const screen={getDisplayMatching:()=>({workArea:{x:0,y:0,width:1920,height:1080}}),getCursorScreenPoint:()=>({x:0,y:0})};
 return {w,pins,screen,control:micro.マイクロ表示を作成(w,{screen,pins})};
}
test('アイコン化は最前面をロックし、展開・収納・復帰で元のピンと通常寸法を保持',()=>{
 for(const pinned of [false,true]){
  const {w,pins,control}=fixture(),original=w.getBounds();if(pinned)pins.toggle(w);
  assert.equal(control.expand(true),false);assert.equal(control.set('true'),false);
  control.set(true);assert.equal(w.bounds.x,original.x);assert.equal(w.bounds.y,original.y);assert.equal(w.bounds.width,128);assert.deepEqual(pins.state(w),{pinned:true,locked:true});pins.toggle(w);assert.equal(w.top,true);
  const center=[w.bounds.x+64,w.bounds.y+64];control.expand(true);assert.equal(w.bounds.width,376);assert.deepEqual([w.bounds.x+188,w.bounds.y+188],center.map(value=>Math.max(188,value)));
  control.expand(false);assert.equal(w.bounds.width,128);control.set(false);assert.deepEqual(w.bounds,original);assert.equal(w.top,pinned);assert.equal(w.resizable,true);assert.equal(pins.state(w).locked,false);
 }
});
test('透明部分は背後へ通し、操作対象で解除。復帰後に遅れた判定を適用しない',async()=>{
 const {w,control,screen}=fixture();let finish;
 try{
  control.set(true);await sleep(90);assert.equal(w.ignored,true);
  screen.getCursorScreenPoint=()=>({x:w.bounds.x+64,y:w.bounds.y+64});w.webContents.executeJavaScript=async()=>true;
  await sleep(90);assert.equal(w.ignored,false);
  w.webContents.executeJavaScript=()=>new Promise(resolve=>finish=resolve);await sleep(90);assert.ok(finish);
  control.set(false);finish(false);await sleep(20);assert.equal(w.ignored,false);
 }finally{control.set(false);w.emit('closed');}
});
test('画面端の展開は領域内に収まり、右下に達した展開窓から通常復帰も右下を保持',()=>{
 const {w,control}=fixture();w.bounds={x:1700,y:900,width:800,height:600};w.maximized=true;
 control.set(true);control.expand(true);assert.ok(w.bounds.x>=0&&w.bounds.x+376<=1920);assert.ok(w.bounds.y>=0&&w.bounds.y+376<=1080);
 const origin=w.getBounds();control.set(false);assert.equal(w.maximized,false);assert.equal(w.bounds.x+w.bounds.width,origin.x+origin.width);assert.equal(w.bounds.y+w.bounds.height,origin.y+origin.height);assert.equal(w.bounds.width,800);
});

test('四隅では展開だけ内側へ補正し、収納後は元のアイコン位置へ戻る',()=>{
 for(const point of [{x:0,y:0},{x:1792,y:0},{x:0,y:952},{x:1792,y:952}]){
  const {w,control}=fixture();control.set(true);w.bounds={...point,width:128,height:128};const before=w.getBounds();
  control.expand(true);assert.ok(w.bounds.x>=0&&w.bounds.y>=0&&w.bounds.x+376<=1920&&w.bounds.y+376<=1080);
  control.expand(false);assert.deepEqual(w.getBounds(),before);
  control.set(false);
 }
});

test('端数DPIの寸法差を補正し、上中央の反復収納と別画面への移動を保持',()=>{
 const {w,control,screen}=fixture();
 screen.getDisplayMatching=()=>({workArea:{x:-1280,y:0,width:1280,height:720}});
 w.setBounds=b=>{w.bounds={...b,height:b.height+1};};
 control.set(true);w.bounds={x:-704,y:0,width:128,height:128};
 for(let i=0;i<5;i++){
  control.expand(true);assert.deepEqual(w.bounds,{x:-828,y:0,width:376,height:376});
  control.expand(false);assert.deepEqual(w.bounds,{x:-704,y:0,width:128,height:128});
 }
 control.expand(true);w.bounds.x+=60;w.bounds.y+=40;control.expand(false);
 assert.deepEqual(w.bounds,{x:-644,y:40,width:128,height:128});control.set(false);
});

test('アイコン化と通常復帰は切替開始時のフォーム左肩を引き継ぐ',()=>{
 const {w,control}=fixture(),normal=w.getBounds();
 control.set(true,{origin:{x:600,y:350,width:330,height:188}});
 assert.deepEqual(w.bounds,{x:600,y:350,width:128,height:128});
 w.bounds.x=720;w.bounds.y=400;control.set(false);assert.deepEqual(w.bounds,{...normal,x:720,y:400});
});

test('移動は所有トークンとOSカーソルだけを使い、解除後は移動させない',()=>{
 const {w,control,screen}=fixture();w.isFullScreen=()=>false;w.isFocused=()=>true;
 w.webContents=Object.assign(new EventEmitter(),{getZoomFactor:()=>1,executeJavaScript:async()=>true});
 let cursor={x:130,y:110};screen.getCursorScreenPoint=()=>cursor;
 assert.equal(control.beginMove(),null);control.set(true);const before=w.getBounds(),token=control.beginMove();assert.ok(token);
 assert.equal(control.move('foreign'),false);cursor={x:190,y:140};assert.equal(control.move(token),true);
 assert.equal(w.bounds.x,before.x+60);assert.equal(w.bounds.y,before.y+30);
 control.endMove(token);assert.equal(control.move(token),false);control.set(false);
});
test('Windowsのfloating未反映でもアイコン化の最前面を確立し、解除時は元へ戻す',()=>{
 const {w,control}=fixture();const calls=[];w.setAlwaysOnTop=(value,level)=>{calls.push([value,level]);w.top=value&&level==='pop-up-menu';};
 control.set(true);if(process.platform==='win32')assert.equal(w.top,true);
 assert.ok(calls.some(([value])=>value===false));control.set(false);assert.equal(w.top,false);
});
test('native mouseDownから開始位置を保持し、IPC到着前の高速移動を取りこぼさない',()=>{
 const {w,screen,pins}=fixture();w.isFullScreen=()=>false;w.isFocused=()=>true;
 w.webContents=Object.assign(new EventEmitter(),{getZoomFactor:()=>1,executeJavaScript:async()=>true});
 const control=micro.マイクロ表示を作成(w,{screen,pins});control.set(true);const b=w.getBounds();
 w.webContents.emit('before-mouse-event',{}, {type:'mouseDown',button:'left',x:52,y:52});
 screen.getCursorScreenPoint=()=>({x:b.x+88,y:b.y+80});const token=control.beginMove();control.move(token);control.endMove(token);
 assert.deepEqual(w.bounds,{...b,x:b.x+36,y:b.y+28});control.set(false);
});

// Electron は closed の時点で BrowserWindow.webContents の取得自体が例外になる。
test('通常・アイコン表示の破棄後は窓を再参照せず、登録済み入力リスナーと移動を解除',()=>{
 for(const active of [false,true]){
  const {w,control}=fixture({strict:true}),contents=w.webContents;
  assert.equal(contents.listenerCount('before-mouse-event'),1);
  if(active){w.isFullScreen=()=>false;w.isFocused=()=>true;control.set(true);assert.ok(control.beginMove());}
  let completed=false;w.once('closed',()=>{completed=true;});
  assert.doesNotThrow(()=>w.destroy());
  assert.equal(completed,true);assert.equal(control.active,false);
  assert.equal(contents.listenerCount('before-mouse-event'),0);
  assert.equal(contents.listenerCount('did-start-navigation'),0);
  assert.equal(contents.listenerCount('render-process-gone'),0);
  assert.equal(control.beginMove(),null);assert.equal(control.set(false),false);
 }
});
test('破棄後に遅れて届くヒット判定の成功・失敗は窓に触れず、タイマーも停止',async()=>{
 for(const reject of [false,true]){
  const {w,control,screen}=fixture({strict:true}),contents=w.webContents;let finish,calls=0;
  const pending=new Promise(resolve=>{
   contents.executeJavaScript=()=>{calls++;return new Promise((yes,no)=>{finish=reject?()=>no(Error('renderer destroyed')):()=>yes(false);resolve();});};
  });
  control.set(true);screen.getCursorScreenPoint=()=>({x:w.bounds.x+64,y:w.bounds.y+64});
  await Promise.race([pending,sleep(500).then(()=>assert.ok(finish,'hit test must start'))]);
  assert.doesNotThrow(()=>w.destroy());finish();await sleep(90);
  assert.equal(calls,1);assert.equal(control.active,false);assert.equal(w.ignored,undefined);
 }
});


test('名前の折り返し高さだけ縦に広げ、中央アイコンの位置と展開収納・短名復帰を維持',()=>{
 const {w,control}=fixture();assert.equal(control.resizeLabel(54),false);control.set(true);
 const original=w.getBounds();assert.equal(control.resizeLabel(90),true);
 assert.deepEqual(w.bounds,{...original,height:210});
 control.expand(true,13);assert.equal(w.bounds.width,376);
 assert.equal(w.bounds.x+188,Math.max(188,original.x+64));
 assert.equal(w.bounds.y+188,Math.max(188,original.y+64));
 assert.equal(control.resizeLabel(18),false);control.expand(false);
 assert.deepEqual(w.bounds,{...original,height:210});
 // 1行の名前は回転枠の下に置くため、収納窓は 112+18+8=138px。
 assert.equal(control.resizeLabel(18),true);assert.deepEqual(w.bounds,{...original,height:138});
 for(const v of [17,4097,NaN,'54',54.5])assert.equal(control.resizeLabel(v),false);
 w.bounds.y=1000;control.resizeLabel(180);assert.equal(w.bounds.height,300);assert.equal(w.bounds.y,780);
 control.set(false);
});

test('右下アイコンは長短の名前・展開収納・通常復帰で右下の余白を保つ',()=>{
 const {w,control,screen}=fixture();
 const area={x:-1280,y:-720,width:1280,height:720};screen.getDisplayMatching=()=>({workArea:area,scaleFactor:1.25});
 w.bounds={x:-820,y:-632,width:800,height:600};const original=w.getBounds();
 control.set(true);
 for(const height of [18,90,180,18]){
  control.resizeLabel(height);assert.deepEqual(w.bounds,{x:-148,y:-32-(120+height),width:128,height:120+height});
 }
 const folded=w.getBounds();
 control.expand(true,13);control.expand(false);assert.deepEqual(w.getBounds(),folded);
 control.set(false);assert.deepEqual(w.bounds,original);
});

test('名前が画面の高さ上限に達しても、短名復帰時は元の下余白へ戻る',()=>{
 const {w,control}=fixture();control.set(true);
 w.bounds={x:1772,y:922,width:128,height:138};
 control.resizeLabel(1000);assert.deepEqual(w.bounds,{x:1772,y:0,width:128,height:1080});
 control.resizeLabel(18);assert.deepEqual(w.bounds,{x:1772,y:922,width:128,height:138});
 w.bounds.y=20;control.resizeLabel(1000);control.resizeLabel(18);assert.equal(w.bounds.y,20);
 control.set(false);
});

test('角基準ではない画面外位置のアイコン化は補正後の左肩から通常へ戻る',()=>{
 const {w,control}=fixture();w.bounds={x:-300,y:200,width:800,height:600};
 control.set(true);assert.equal(w.bounds.x,0);control.set(false);assert.deepEqual(w.bounds,{x:0,y:200,width:800,height:600});
});
