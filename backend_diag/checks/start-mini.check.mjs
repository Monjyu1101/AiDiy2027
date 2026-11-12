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
test('mini starts at 400×250 and restores the previous dimensions and minimum',()=>{
 const window=fakeWindow(),controller=miniWindow.ミニ表示を作成(window),original=window.getBounds();
 assert.deepEqual(miniWindow.ミニ寸法,{width:400,height:250});
 assert.deepEqual(controller.演出範囲(true),{...original,...miniWindow.ミニ寸法});
 assert.equal(controller.set(true),true);assert.equal(controller.active,true);
 assert.deepEqual(window.bounds,{...original,...miniWindow.ミニ寸法});assert.deepEqual(window.minimum,[400,250]);assert.equal(window.maximizable,false);
 window.bounds.width=460;
 controller.set(true);assert.equal(window.bounds.width,460);assert.equal(window.bounds.height,250);
 controller.set(false);assert.deepEqual(window.bounds,original);assert.deepEqual(window.minimum,[420,320]);assert.equal(window.maximizable,true);assert.equal(controller.active,false);
});

test('最大化からミニにした後も、現在のフォーム左肩から通常寸法へ戻る',()=>{
 const window=fakeWindow(true),controller=miniWindow.ミニ表示を作成(window);controller.set(true);assert.equal(window.maximized,false);window.bounds.x=260;window.bounds.y=180;controller.set(false);assert.equal(window.maximized,false);assert.deepEqual(window.bounds,{x:260,y:180,width:1160,height:820});
});

test('startup mini keeps the pin and the bottom-right margin when restored',()=>{
 for(const top of [true,false]){
  const window=fakeWindow();window.top=top;const original=window.getBounds(),controller=miniWindow.ミニ表示を作成(window,{screen:{getPrimaryDisplay:()=>({workArea:{x:-1920,y:32,width:1920,height:1080}}),getDisplayMatching:()=>({workArea:{x:-1920,y:32,width:1920,height:1080}})}});
  controller.set(true,{initial:true});assert.deepEqual(window.bounds,{x:-408,y:854,width:400,height:250});assert.equal(window.top,top);
  controller.set(false);assert.deepEqual(window.bounds,{...original,x:-1168,y:284});assert.equal(window.top,top);
 }
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

test('右下ミニは通常復帰で余白を保ち、移動後は基準を選び直す',()=>{
 const window=fakeWindow(),screen={getDisplayMatching:()=>({workArea:{x:-1920,y:-1040,width:1920,height:1040}})};
 window.bounds={x:-1180,y:-852,width:1160,height:820};
 const original=window.getBounds(),controller=miniWindow.ミニ表示を作成(window,{screen});
 controller.set(true);assert.deepEqual(window.bounds,{x:-420,y:-282,width:400,height:250});
 assert.deepEqual(controller.演出範囲(false),original);
 controller.set(false);assert.deepEqual(window.bounds,original);
 controller.set(true);window.bounds.x=-1850;window.bounds.y=-980;
 controller.set(false);assert.deepEqual(window.bounds,{...original,x:-1850,y:-980});
});
