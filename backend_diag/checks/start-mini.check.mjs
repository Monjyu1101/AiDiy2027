// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import miniWindow from '../起動/ミニ表示.cjs';
import {起動ミニ表示を作成} from '../ui/src/components/ウィンドウ/起動ミニ表示.mjs';
import {起動状態を作成} from '../ui/src/components/起動/起動状態.mjs';

function fakeWindow(maximized=false){
 const window={bounds:{x:140,y:100,width:1160,height:820},minimum:[420,320],maximized,maximizable:true,resizes:0,minimumChanges:0,
  isAlwaysOnTop(){return !!this.top;},setAlwaysOnTop(value){this.top=value;},isDestroyed(){return !!this.destroyed;},getBounds(){return {...this.bounds};},getNormalBounds(){return {...this.bounds};},getMinimumSize(){return [...this.minimum];},isMaximized(){return this.maximized;},isMaximizable(){return this.maximizable;},
  unmaximize(){this.maximized=false;},maximize(){this.maximized=true;},setMinimumSize(...value){this.minimumChanges++;this.minimum=value;},setMaximizable(value){this.maximizable=value;},setBounds(value){this.resizes++;this.bounds={...value,width:Math.max(value.width,this.minimum[0]),height:Math.max(value.height,this.minimum[1])};}};
 return window;
}
test('mini window has fixed width and compact fallback height, restoring original bounds and minimum',()=>{
 const window=fakeWindow(),controller=miniWindow.ミニ表示を作成(window),original=structuredClone(window.bounds);
 assert.equal(controller.set(true),true);assert.equal(controller.active,true);assert.deepEqual(window.bounds,{...original,width:330,height:134});assert.deepEqual(window.minimum,[330,134]);assert.equal(window.maximizable,false);
 controller.set(true);controller.set(false);assert.deepEqual(window.bounds,original);assert.deepEqual(window.minimum,[420,320]);assert.equal(window.maximizable,true);assert.equal(controller.active,false);
});
test('最大化からミニにした後も、現在のフォーム左肩から通常寸法へ戻る',()=>{
 const window=fakeWindow(true),controller=miniWindow.ミニ表示を作成(window);controller.set(true);assert.equal(window.maximized,false);window.bounds.x=260;window.bounds.y=180;controller.set(false);assert.equal(window.maximized,false);assert.deepEqual(window.bounds,{x:260,y:180,width:1160,height:820});
});

test('startup mini preserves pin and bottom-right margin through resize and restore',()=>{
 for(const top of [true,false]){
  const window=fakeWindow();window.top=top;const original=structuredClone(window.bounds),controller=miniWindow.ミニ表示を作成(window,{screen:{getPrimaryDisplay:()=>({workArea:{x:-1920,y:32,width:1920,height:1080}}),getDisplayMatching:()=>({workArea:{x:-1920,y:32,width:1920,height:1080}})}});
  controller.set(true,{initial:true});assert.deepEqual(window.bounds,{x:-338,y:970,width:330,height:134});assert.equal(window.top,top);
  controller.resize(200);assert.deepEqual(window.bounds,{x:-338,y:904,width:330,height:200});controller.set(false);assert.deepEqual(window.bounds,{...original,x:-1168,y:284});assert.equal(window.top,top);
 }
});

test('mini height follows zero CLI, CLI, error and zero CLI without losing saved normal state',()=>{
 for(const maximized of [false,true])for(const top of [false,true]){
  const window=fakeWindow(maximized);window.top=top;window.maximizable=!top;
  const original=window.getBounds(),minimum=window.getMinimumSize(),maximizable=window.maximizable,controller=miniWindow.ミニ表示を作成(window);
  controller.set(true);
  // ミニ移動後の高さ変更と通常復帰のどちらでも、現在のフォーム左肩を保つ。
  window.bounds.x=-400;window.bounds.y=20;
  for(const height of [134,186,200,134]){
   const before=window.resizes,minimumBefore=window.minimumChanges;
   const previous=window.bounds.height;
   assert.equal(controller.resize(height),true);assert.deepEqual(window.bounds,{x:-400,y:20,width:330,height});assert.deepEqual(window.minimum,[330,height]);
   assert.equal(window.resizes,before+(previous===height?0:1));assert.equal(window.minimumChanges,minimumBefore+(previous===height?0:1));
   assert.equal(controller.set(true),true);assert.equal(controller.resize(height),true);assert.equal(window.resizes,before+(previous===height?0:1),'同じ高さで再度リサイズしない');
  }
  assert.deepEqual(controller.演出範囲(false),{...original,x:-400,y:20});
  assert.equal(controller.set(false),true);assert.deepEqual(window.bounds,{...original,x:-400,y:20});assert.deepEqual(window.minimum,minimum);assert.equal(window.maximized,false);assert.equal(window.maximizable,maximizable);assert.equal(window.top,top);
  assert.equal(controller.resize(186),false);assert.deepEqual(window.bounds,{...original,x:-400,y:20});
 }
});

test('mini resizing accepts only bounded integer heights on a live active mini window',()=>{
 const window=fakeWindow(),controller=miniWindow.ミニ表示を作成(window),normal=window.getBounds();
 assert.equal(controller.resize(186),false);assert.deepEqual(window.bounds,normal);
 controller.set(true);const mini=window.getBounds(),before=window.resizes;
 for(const height of [undefined,null,false,true,'134',{},[],[134],NaN,Infinity,-Infinity,0,79,361,134.5,Number.MAX_SAFE_INTEGER])assert.equal(controller.resize(height),false);
 assert.deepEqual(window.bounds,mini);assert.equal(window.resizes,before);
 for(const height of [80,360,80]){assert.equal(controller.resize(height),true);assert.equal(window.bounds.height,height);assert.deepEqual(window.minimum,[330,height]);}
 window.destroyed=true;assert.equal(controller.resize(134),false);assert.equal(window.bounds.height,80);
});

test('initial mini renders immediately even before connection and can restore without resetting the mode first',async()=>{
 const calls=[];const state=起動ミニ表示を作成({利用可能:()=>true,初期表示:true,切替:async value=>{calls.push(value);return true;}});
 assert.equal(state.表示中.value,true);assert.equal(state.切替中.value,false);await state.変更(false);assert.equal(state.表示中.value,false);assert.deepEqual(calls,[false]);
});
test('invalid requests and destroyed windows cannot change bounds',()=>{
 const window=fakeWindow(),controller=miniWindow.ミニ表示を作成(window);assert.equal(controller.set({width:999}),false);assert.equal(window.bounds.width,1160);window.destroyed=true;assert.equal(controller.set(true),false);
});
test('mini view requires a connection but has no tab restriction',async()=>{
 const calls=[];let allowed=false;const state=起動ミニ表示を作成({利用可能:()=>allowed,切替:async value=>{calls.push(value);return true;}});
 await state.変更(true);assert.equal(state.表示中.value,false);assert.deepEqual(calls,[]);
 allowed=true;await state.変更(true);assert.equal(state.表示中.value,true);await state.変更(false);assert.equal(state.表示中.value,false);assert.deepEqual(calls,[true,false]);
});
test('disconnecting during a pending native resize restores the full window',async()=>{
 let release,allowed=true;const calls=[];const state=起動ミニ表示を作成({利用可能:()=>allowed,切替:value=>{calls.push(value);return value?new Promise(resolve=>release=resolve):Promise.resolve(true);}});
 const pending=state.変更(true);allowed=false;await state.変更(false);release(true);await pending;assert.equal(state.表示中.value,false);assert.equal(state.切替中.value,false);assert.deepEqual(calls,[true,false]);
});
test('failed native switch keeps UI in the current mode and exposes a message',async()=>{
 const state=起動ミニ表示を作成({利用可能:()=>true,切替:async()=>false});assert.equal(await state.変更(true),false);assert.equal(state.表示中.value,false);assert.ok(state.エラー.value);
});
test('mini polling refreshes statuses without reading logs or mutating services',async t=>{
 const calls=[],scheduled=[],cleared=[];let open=true;
 const state=起動状態を作成({setTimer:(callback,ms)=>{const handle={callback,ms};scheduled.push(handle);return handle;},clearTimer:timer=>cleared.push(timer),api:async route=>{calls.push(route);return route==='api/起動'?{対象:[{id:'core',名前:'Core',状態:'未起動',設定:{起動対象:true}}],実行中:false}:route==='api/起動/ポート'?{対象:[{id:'core',名前:'Core',ポート:8091,開放:open}]}: {ログ:'fixture',位置:7};}});
 t.after(()=>state.終了());state.表示(true,false);await delay(30);
 assert.equal(state.項目.value[0].状態,'未起動');assert.equal(state.ポート項目.value[0].開放,true,'Diagが管理していない外部サーバーの開放も表示する');assert.ok(calls.every(route=>['api/起動','api/起動/ポート'].includes(route)));
 assert.equal(scheduled.at(-1).ms,5000);open=false;await scheduled.at(-1).callback();assert.equal(state.ポート項目.value[0].開放,false);assert.equal(scheduled.at(-1).ms,5000);
 const timer=scheduled.at(-1);state.表示(false);assert.ok(cleared.includes(timer));const portCalls=calls.filter(route=>route==='api/起動/ポート').length;
 state.表示(true,true);await delay(30);state.表示(false);assert.ok(calls.includes('api/起動/ログ'));assert.ok(!calls.some(route=>/設定|再起動|停止/.test(route)));
 assert.ok(calls.filter(route=>route==='api/起動/ポート').length>portCalls,'通常画面でも一括起動・停止の判定にポートを確認する');
});

test('mini restore keeps pin changes made while compact instead of restoring a stale topmost value',()=>{
 for(const top of [false,true]){
  const window=fakeWindow();window.top=top;const controller=miniWindow.ミニ表示を作成(window);
  controller.set(true);assert.equal(window.top,top);window.setAlwaysOnTop(!top);
  controller.set(false);assert.equal(window.top,!top);
 }
});

test('右下ミニは高さの増減と通常復帰で余白を保ち、移動後は基準を選び直す',()=>{
 const window=fakeWindow(),screen={getDisplayMatching:()=>({workArea:{x:-1920,y:-1040,width:1920,height:1040}})};
 window.bounds={x:-1180,y:-852,width:1160,height:820};
 const original=window.getBounds(),controller=miniWindow.ミニ表示を作成(window,{screen});
 controller.set(true);
 for(const height of [134,186,80,360,134]){
  controller.resize(height);
  assert.deepEqual(window.bounds,{x:-350,y:-32-height,width:330,height});
 }
 assert.deepEqual(controller.演出範囲(false),original);
 controller.set(false);assert.deepEqual(window.bounds,original);
 controller.set(true);window.bounds.x=-1850;window.bounds.y=-980;
 controller.resize(200);controller.set(false);
 assert.deepEqual(window.bounds,{...original,x:-1850,y:-980});
});

test('低い画面で上下余白が同じ高さまで広げても、下基準を失わない',()=>{
 const window=fakeWindow(),screen={getDisplayMatching:()=>({workArea:{x:0,y:0,width:800,height:400}})};
 const controller=miniWindow.ミニ表示を作成(window,{screen});controller.set(true);
 window.bounds={x:450,y:246,width:330,height:134};
 controller.resize(360);assert.deepEqual(window.bounds,{x:450,y:20,width:330,height:360});
 controller.resize(134);assert.deepEqual(window.bounds,{x:450,y:246,width:330,height:134});
 // 通常寸法が画面より大きくても、続くミニ復帰は元の角と余白を使う。
 controller.set(false);assert.deepEqual(window.bounds,{x:0,y:0,width:1160,height:820});
 controller.set(true);assert.deepEqual(window.bounds,{x:450,y:246,width:330,height:134});
 // ユーザー移動があれば、保持していた下基準を引き継がない。
 window.bounds.y=20;controller.resize(360);controller.resize(134);assert.equal(window.bounds.y,20);
});
