// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {existsSync,readFileSync} from 'node:fs';
import sizing from '../デスクトップ/ブラウザ表示領域.cjs';

function fixture({zoom=1}={}){
 let time=0,id=0;const timers=new Map(),frames=[],native=[],zooms=[];
 const window=Object.assign(new EventEmitter(),{
  bounds:{x:200,y:100,width:1000,height:700},webContents:new EventEmitter(),
  isDestroyed(){return !!this.destroyed;},getBounds(){return {...this.bounds};},getContentBounds(){return {...this.bounds};},
  setBounds(value){this.bounds={...value};frames.push({...value});this.emit('resize');},
  isFullScreen(){return !!this.fullscreen;},isMaximized(){return !!this.maximized;},
  maximize(){native.push('maximize');this.saved={...this.bounds};this.maximized=true;this.setBounds({x:0,y:0,width:1600,height:900});this.emit('maximize');},
  unmaximize(){native.push('unmaximize');this.maximized=false;this.setBounds(this.saved);this.emit('unmaximize');},
  setFullScreen(value){native.push(value?'fullscreen':'normal');if(value){this.saved={...this.bounds};this.fullscreen=true;this.setBounds({x:0,y:0,width:1600,height:1000});}else{this.fullscreen=false;this.setBounds(this.saved);}this.emit(value?'enter-full-screen':'leave-full-screen');},
  setOpacity(){assert.fail('サイズ変更で透明度を変えない');},focus(){assert.fail('サイズ変更でfocusを奪わない');},
 });
 Object.assign(window.webContents,{getZoomFactor:()=>zoom,capturePage(){assert.fail('操作欄の撮影は不要');}});
 const view={webContents:Object.assign(new EventEmitter(),{setZoomFactor:value=>zooms.push(value),capturePage(){assert.fail('本文の撮影は不要');}}),setBounds(value){this.bounds={...value};}};
 const control=sizing.createBrowserSizing({window,view,screen:{getDisplayMatching:()=>({workArea:{x:0,y:0,width:1600,height:900}})},now:()=>time,setTimer:(fn,ms)=>{timers.set(++id,{fn,at:time+ms});return id;},clearTimer:key=>timers.delete(key)});
 const measure=(top=101)=>{const b=window.getContentBounds();return control.measure({left:1,top,width:b.width/zoom-2,height:b.height/zoom-top-1,viewportWidth:b.width/zoom,viewportHeight:b.height/zoom,fullscreen:window.isFullScreen(),measuredAt:time});};
 const advance=ms=>{const end=time+ms;while(true){const next=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>end)break;time=next[1].at;timers.delete(next[0]);next[1].fn();}time=end;};
 measure();return{window,view,control,frames,native,zooms,timers,advance,measure,close:()=>control.dispose()};
}
for(const zoom of [1,1.25])test(`Browser直接変形: host倍率${zoom}でも窓と本文が途中寸法を通り、FHD最終viewportは1920×945`,async()=>{
 const f=fixture({zoom});try{
  const p=f.control.preset('fhd');assert.equal(f.frames.length,0);assert.equal(f.control.isSettled(),false);
  f.advance(96);assert.ok(f.window.bounds.width>1000&&f.window.bounds.width<1920+2*Math.round(zoom));
  assert.equal(f.view.bounds.width,f.window.bounds.width-2*Math.round(zoom));
  assert.equal(f.view.bounds.height,f.window.bounds.height-Math.round(101*zoom)-Math.round(zoom));
  f.advance(144);await p;assert.deepEqual(f.view.bounds,{x:Math.round(zoom),y:Math.round(101*zoom),width:1920,height:945});
  assert.equal(f.control.isSettled(),true);assert.ok(f.frames.length>=10&&f.frames.length<=16);assert.deepEqual(f.zooms,[1],'page zoomは最初の等倍指定だけ');
 }finally{f.close();}
});
test('Browser直接変形: 縦→FHDでは実窓の幅が増え高さが縮む、小画面でもclampしない',async()=>{
 const f=fixture();try{
  let p=f.control.preset('portrait');f.advance(240);await p;assert.equal(f.view.bounds.height,1785);assert.ok(f.window.bounds.height>900);
  const start={...f.window.bounds};p=f.control.preset('fhd');f.advance(80);
  assert.ok(f.window.bounds.width>start.width&&f.window.bounds.width<1922);assert.ok(f.window.bounds.height<start.height&&f.window.bounds.height>1047);
  f.advance(160);await p;assert.equal(f.view.bounds.width,1920);assert.equal(f.view.bounds.height,945);
 }finally{f.close();}
});
test('Browser直接変形: 最新プリセットへ現在の途中寸法から反転、古いtimerは無効',async()=>{
 const f=fixture();try{
  const a=f.control.preset('fhd');f.advance(64);const at={...f.window.bounds},old=[...f.timers.values()][0].fn;
  const b=f.control.preset('portrait');await a;assert.deepEqual(f.window.bounds,at);old();assert.deepEqual(f.window.bounds,at);
  f.advance(240);await b;assert.equal(f.view.bounds.width,1080);assert.equal(f.view.bounds.height,1785);assert.equal(f.timers.size,0);
 }finally{f.close();}
});
test('Browser直接変形: 測定IPCの反復で補間を始め直さず、220ms後に収束',async()=>{
 const f=fixture();try{
  const p=f.control.preset('portrait');for(let i=0;i<15;i++){f.advance(16);f.measure();}await p;
  assert.equal(f.view.bounds.width,1080);assert.equal(f.view.bounds.height,1785);assert.equal(f.timers.size,0);
 }finally{f.close();}
});
test('Browser直接変形: 古い寸法IPCを拒否し、操作欄高さの更新は最新の終点へ反映',async()=>{
 const f=fixture();try{
  const p=f.control.preset('fhd');f.advance(64);
  assert.equal(f.control.measure({left:1,top:101,width:998,height:598,viewportWidth:1000,viewportHeight:700,fullscreen:false,measuredAt:0}),false);
  f.measure(141);f.advance(240);await p;assert.equal(f.view.bounds.height,945);assert.equal(f.window.bounds.height,1087);
 }finally{f.close();}
});
for(const type of ['fullscreen','maximize'])test(`Browser直接変形: 途中の${type}は補間を取消しCode同様native処理へ進む`,async()=>{
 const f=fixture();try{
  const p=f.control.preset('portrait');f.advance(64);const old=[...f.timers.values()][0].fn;
  if(type==='fullscreen')f.control.toggleFullscreen();else f.control.maximize();await p;
  const end={...f.window.bounds};old();f.advance(1000);assert.deepEqual(f.window.bounds,end);assert.deepEqual(f.native,[type]);
  assert.equal(f.view.bounds.width,type==='fullscreen'?1600:1598);assert.equal(f.view.bounds.height,type==='fullscreen'?1000:798);assert.equal(f.timers.size,0);
 }finally{f.close();}
});
test('Browser直接変形: F11/🔲二回押下を遅延・合成せず元へ戻す',()=>{
 const f=fixture();try{
  const start={...f.window.bounds};f.control.toggleFullscreen();f.control.toggleFullscreen();assert.deepEqual(f.window.bounds,start);
  f.control.maximize();f.control.maximize();assert.deepEqual(f.window.bounds,start);assert.deepEqual(f.native,['fullscreen','normal','maximize','unmaximize']);
 }finally{f.close();}
});
for(const event of ['will-resize','will-move','close'])test(`Browser直接変形: ${event}で取消、古いtimerが手動操作/閉鎖を戻さない`,async()=>{
 const f=fixture();try{
  const p=f.control.preset('fhd');f.advance(48);const old=[...f.timers.values()][0].fn;
  f.window.emit(event);await p;f.window.setBounds({x:30,y:50,width:600,height:500});const count=f.frames.length;
  old();f.advance(1000);assert.equal(f.frames.length,count);assert.equal(f.timers.size,0);
 }finally{f.close();}
});
test('Browser直接変形: タイプ/クリックを吸収せず、読込中も生きた本文を維持',async()=>{
 const f=fixture();try{
  const p=f.control.preset('fhd');f.advance(64);const event={preventDefault(){assert.fail('入力を演出終了操作へ変換しない');}};
  f.window.webContents.emit('before-input-event',event,{type:'keyDown',key:'a'});f.view.webContents.emit('before-mouse-event',event,{type:'mouseDown'});f.view.webContents.emit('did-start-loading');
  f.advance(176);await p;assert.equal(f.view.bounds.width,1920);assert.equal(f.view.webContents.listenerCount('before-mouse-event'),0);
 }finally{f.close();}
});
test('Browser直接変形: 破棄でtimer/購読/待機を回収',async()=>{
 const f=fixture();const p=f.control.preset('portrait');f.advance(32);const old=[...f.timers.values()][0].fn;f.window.destroyed=true;f.close();await p;
 const count=f.frames.length;old();f.advance(500);assert.equal(f.frames.length,count);assert.equal(f.timers.size,0);assert.equal(f.window.listenerCount('resize'),0);
});
test('Browser直接変形: native bounds失敗を要求へ返し、timerを残さない',async()=>{
 const f=fixture();try{
  f.window.setBounds=()=>{throw Error('bounds failed');};const p=f.control.preset('fhd');f.advance(16);await assert.rejects(p,/bounds failed/);assert.equal(f.timers.size,0);
 }finally{f.close();}
});
test('Browser直接変形: 同じ最終寸法の再指定は即完了し、timerを作らない',async()=>{
 const f=fixture();try{
  const p=f.control.preset('fhd');f.advance(240);await p;const count=f.frames.length;
  await f.control.preset('fhd');assert.equal(f.control.isSettled(),true);assert.equal(f.timers.size,0);assert.equal(f.frames.length,count);
 }finally{f.close();}
});
test('Browser直接変形: page zoom準備失敗も要求へ返し、待機を残さない',async()=>{
 const f=fixture();try{
  f.view.webContents.setZoomFactor=()=>{throw Error('zoom failed');};await assert.rejects(f.control.preset('portrait'),/zoom failed/);
  assert.equal(f.control.isSettled(),true);assert.equal(f.timers.size,0);
 }finally{f.close();}
});
test('Browser直接変形: サイズ変更snapshotを撤去し、共通登場モーション入口は保持',()=>{
 assert.equal(existsSync(new URL('../デスクトップ/ブラウザサイズ演出.cjs',import.meta.url)),false);
 const browser=readFileSync(new URL('../デスクトップ/ブラウザ.cjs',import.meta.url),'utf8'),desktop=readFileSync(new URL('../desktop.cjs',import.meta.url),'utf8');
 assert.doesNotMatch(browser,/createBrowserResizeMotion|entry\.motion|setOpacity/);assert.match(browser,/entry\.sizing\.preset\(value\)/);
 assert.match(desktop,/require\('\.\/host\/scripts\/window-opening\.cjs'\)/);assert.match(desktop,/await 拡大表示\(BrowserWindow,window/);
});
