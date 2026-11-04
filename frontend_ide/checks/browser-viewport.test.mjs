// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFileSync} from 'node:fs';
import sizing from '../デスクトップ/ブラウザ表示領域.cjs';

// ElectronのAPIだけを置換する。CSSレイアウト・innerWidthの実測試験ではない。
function fixture({zoom=1,frame={width:8,height:10},area={x:-800,y:20,width:800,height:600},deferred=false,deferredMaximize=false}={}){
 const calls=[],pending=[];let normal;
 const window=Object.assign(new EventEmitter(),{
  bounds:{x:0,y:0,width:1000,height:700},fullscreen:false,maximized:false,
  webContents:{getZoomFactor:()=>zoom},isDestroyed(){return !!this.destroyed;},isFullScreen(){return this.fullscreen;},isMaximized(){return this.maximized;},
  getBounds(){return {...this.bounds};},getContentBounds(){return {...this.bounds,width:this.bounds.width-frame.width,height:this.bounds.height-frame.height};},
  setBounds(value){this.bounds={...value};calls.push({...value});this.emit('resize');},
  setFullScreen(value){const run=()=>{if(value){normal={...this.bounds};this.fullscreen=true;this.bounds={x:area.x,y:area.y,width:area.width,height:area.height};}else{this.fullscreen=false;this.bounds=normal;}this.emit(value?'enter-full-screen':'leave-full-screen');this.emit('resize');};if(deferred)pending.push(run);else run();},
  maximize(){const run=()=>{normal={...this.bounds};this.maximized=true;this.bounds={...area};this.emit('maximize');this.emit('resize');};if(deferredMaximize)pending.push(run);else run();},
  unmaximize(){const run=()=>{this.maximized=false;this.bounds=normal||this.bounds;this.emit('unmaximize');this.emit('resize');};if(deferred)pending.push(run);else run();},
 });
 const view={webContents:{setZoomFactor(value){this.zoom=value;}},setBounds(value){this.bounds={...value};}};
 const control=sizing.createBrowserSizing({window,view,screen:{getDisplayMatching:()=>({workArea:area})},duration:0});
 const rect=({top=101,left=1,right=1,bottom=1,fullscreen=window.fullscreen}={})=>{
  const b=window.getContentBounds(),viewportWidth=b.width/zoom,viewportHeight=b.height/zoom;
  return {left,top,width:viewportWidth-left-right,height:viewportHeight-top-bottom,viewportWidth,viewportHeight,fullscreen};
 };
 const measure=value=>control.measure(rect(value));
 return {window,view,control,measure,rect,calls,pending,frame,area,close:()=>control.dispose()};
}
for(const zoom of [1,1.25])for(const [name,width,height]of [['fhd',1920,945],['portrait',1080,1785]])test(`Browser本文: ${name}・host倍率${zoom}は本文寸法に枠/操作欄/OS枠を加え、小画面でも縮めない`,()=>{
 const f=fixture({zoom});try{
  f.measure();f.control.preset(name);
  assert.deepEqual(f.view.bounds,{x:Math.round(zoom),y:Math.round(101*zoom),width,height});
  assert.equal(f.window.bounds.width,width+2*Math.round(zoom)+f.frame.width);
  assert.equal(f.window.bounds.height,height+Math.round(101*zoom)+Math.round(zoom)+f.frame.height);
  assert.ok(f.window.bounds.width>f.area.width);assert.ok(f.window.bounds.height>f.area.height);
  assert.equal(f.window.bounds.x,f.area.x);assert.equal(f.window.bounds.y,f.area.y);
  assert.equal(f.view.webContents.zoom,1);
  f.measure({top:141});assert.equal(f.view.bounds.height,height,'エラー等で操作欄が高くなっても本文を保持');
 }finally{f.close();}
});
test('Browser本文: 初回測定待ち・後着した旧サイズ/別modeの矩形で窓が膨張しない',()=>{
 const f=fixture();try{
  f.control.preset('fhd');assert.equal(f.calls.length,0);
  const old=f.rect();f.measure();assert.equal(f.view.bounds.width,1920);
  const stable={...f.window.bounds},count=f.calls.length;
  for(let i=0;i<3;i++){assert.equal(f.control.measure(old),false);assert.equal(f.control.measure({...f.rect(),fullscreen:true}),false);}
  assert.deepEqual(f.window.bounds,stable);assert.equal(f.calls.length,count);
  assert.equal(f.measure(),true);assert.equal(f.calls.length,count);
 }finally{f.close();}
});
test('Browser本文: 非同期F11解除中のプリセット連打は最後の本文寸法だけ適用する',()=>{
 const f=fixture({deferred:true});try{
  f.measure();f.window.setFullScreen(true);f.pending.shift()();
  const oldFull=f.rect({top:0,left:0,right:0,bottom:0});
  f.control.preset('fhd');f.control.preset('portrait');assert.equal(f.calls.length,0);assert.equal(f.pending.length,1);
  f.pending.shift()();assert.equal(f.view.bounds.width,1080);assert.equal(f.view.bounds.height,1785);
  assert.equal(f.control.measure(oldFull),false);
 }finally{f.close();}
});
test('Browser本文: 最大化からのプリセットはunmaximize完了後に適用する',()=>{
 const f=fixture({deferred:true});try{
  f.measure();f.window.maximize();f.control.preset('portrait');assert.equal(f.calls.length,0);
  f.pending.shift()();assert.equal(f.window.isMaximized(),false);assert.equal(f.view.bounds.height,1785);
 }finally{f.close();}
});
test('Browser本文: F11・🔲最大化/通常復帰・手動resizeはその時の実領域に追従',()=>{
 const f=fixture();try{
  f.measure();f.control.preset('portrait');
  f.control.actual();f.window.setFullScreen(true);
  let b=f.window.getContentBounds();assert.deepEqual(f.view.bounds,{x:0,y:0,width:b.width,height:b.height});
  f.control.maximize();assert.equal(f.window.isFullScreen(),false);assert.equal(f.window.isMaximized(),true);
  f.measure();b=f.window.getContentBounds();assert.equal(f.view.bounds.width,b.width-2);assert.equal(f.view.bounds.height,b.height-102);
  f.control.maximize();assert.equal(f.window.isMaximized(),false);f.measure();
  f.control.preset('fhd');f.window.emit('will-resize');f.window.setBounds({x:10,y:20,width:650,height:550});f.measure();
  b=f.window.getContentBounds();assert.equal(f.view.bounds.width,b.width-2);assert.equal(f.view.bounds.height,b.height-102);
  assert.equal(f.window.bounds.width,650,'新しい手動寸法をプリセットへ戻さない');
 }finally{f.close();}
});
test('Browser本文: fullscreen解除待ちを🔲で置き換えたら古いプリセットを適用しない',()=>{
 const f=fixture({deferred:true});try{
  f.measure();f.window.setFullScreen(true);f.pending.shift()();
  f.control.preset('fhd');f.control.maximize();f.pending.shift()();
  assert.equal(f.window.isMaximized(),true);assert.equal(f.calls.length,0);
  f.measure();assert.ok(f.view.bounds.width<1920);
 }finally{f.close();}
});
test('Browser本文: 破棄後の保留解除と古い測定は窓を動かさない',()=>{
 const f=fixture({deferred:true});f.measure();f.window.setFullScreen(true);f.pending.shift()();f.control.preset('portrait');f.close();f.pending.shift()();
 assert.equal(f.calls.length,0);assert.equal(f.control.measure(f.rect()),false);assert.equal(f.window.listenerCount('resize'),0);
});
test('Browser本文: rendererは同一時点のviewport/modeを渡し、Browserだけ画面外拡大を許可',()=>{
 const panel=readFileSync(new URL('../src/components/ブラウザ/ブラウザパネル.vue',import.meta.url),'utf8'),desktop=readFileSync(new URL('../desktop.cjs',import.meta.url),'utf8');
 assert.match(panel,/viewportWidth:viewport.width,viewportHeight:viewport.height,fullscreen:!!page.value.fullscreen/);
 assert.match(desktop,/kind==='browser'\?\{enableLargerThanScreen:true\}:\{\}/);
 assert.match(desktop,/record.kind==='browser'&&browserViews\)return browserViews.maximize\(record\)/);
});
test('Browser本文: 遅いenter-full-screen通知で新しい通常プリセットを消さない',()=>{
 const f=fixture({deferred:true});try{
  f.measure();f.window.setFullScreen(true);f.pending.shift()();f.control.preset('portrait');
  f.window.emit('enter-full-screen');f.pending.shift()();assert.equal(f.view.bounds.width,1080);assert.equal(f.view.bounds.height,1785);
 }finally{f.close();}
});
test('Browser本文: 同サイズでも古い操作欄測定を拒否し、端数倍率の反復測定で拡大し続けない',()=>{
 const f=fixture({zoom:1.25});try{
  assert.equal(f.control.measure({...f.rect({top:101}),measuredAt:2}),true);
  assert.equal(f.control.measure({...f.rect({top:141}),measuredAt:1}),false);
  f.control.preset('fhd');const count=f.calls.length,bounds={...f.window.bounds};
  for(let i=0;i<10;i++)f.control.measure({...f.rect(),measuredAt:3+i});
  assert.deepEqual(f.window.bounds,bounds);assert.equal(f.calls.length,count);assert.equal(f.view.bounds.width,1920);assert.equal(f.view.bounds.height,945);
 }finally{f.close();}
});
test('Browser本文: F11入場途中で選んだプリセットを退場完了後に適用する',()=>{
 const f=fixture({deferred:true});try{
  f.measure();f.control.toggleFullscreen();assert.equal(f.window.isFullScreen(),false);f.control.preset('portrait');
  f.pending.shift()();assert.equal(f.window.isFullScreen(),true);assert.equal(f.calls.length,0);
  f.pending.shift()();assert.equal(f.window.isFullScreen(),false);assert.equal(f.view.bounds.height,1785);
 }finally{f.close();}
});
test('Browser本文: 以前のunmaximize完了より後から選んだ🔲最大化を優先する',()=>{
 const f=fixture({deferred:true});try{
  f.measure();f.window.maximize();f.control.preset('portrait');f.control.maximize();
  assert.equal(f.pending.length,1);f.pending.shift()();assert.equal(f.window.isMaximized(),true);assert.equal(f.calls.length,0);
 }finally{f.close();}
});
test('Browser本文: 遷移中のF11連打でも最後の全画面要求へ収束する',()=>{
 const f=fixture({deferred:true});try{
  f.measure();f.control.toggleFullscreen();f.control.toggleFullscreen();f.control.toggleFullscreen();
  f.pending.shift()();assert.equal(f.window.isFullScreen(),true);assert.equal(f.pending.length,0);
  f.control.toggleFullscreen();f.control.toggleFullscreen();f.pending.shift()();f.pending.shift()();assert.equal(f.window.isFullScreen(),true);
 }finally{f.close();}
});
test('Browser本文: プリセット後に移動した窓を操作欄の再測定で元の位置へ戻さない',()=>{
 const f=fixture();try{
  f.measure();f.control.preset('fhd');f.window.setBounds({...f.window.bounds,x:250,y:300});f.measure({top:141});
  assert.equal(f.window.bounds.x,250);assert.equal(f.window.bounds.y,300);assert.equal(f.view.bounds.height,945);
 }finally{f.close();}
});
test('Browser本文: 遅いmaximize完了より後から選んだプリセットを優先する',()=>{
 const f=fixture({deferredMaximize:true});try{
  f.measure();f.control.maximize();f.control.preset('portrait');assert.equal(f.calls.length,0);
  f.pending.shift()();assert.equal(f.window.isMaximized(),false);assert.equal(f.view.bounds.width,1080);assert.equal(f.view.bounds.height,1785);
 }finally{f.close();}
});
test('Browser本文: 🔲の最大化待ち中の再押下は通常表示へ戻す',()=>{
 const f=fixture({deferredMaximize:true});try{
  f.measure();f.control.maximize();f.control.maximize();f.pending.shift()();assert.equal(f.window.isMaximized(),false);assert.equal(f.pending.length,0);
 }finally{f.close();}
});
