// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {createVRPanelPlacement} from '../デスクトップ/VRパネル配置.cjs';

function fixture(){
 let clock=0,area={x:-1000,y:0,width:3000,height:1200};
 const owner={revision:1,window:{isDestroyed:()=>false,webContents:{executeJavaScript:async()=>{}}}},windows=new Map(),events=[],timers=new Map();let tick=0;
 const add=(kind,x,y)=>{const child={owner,kind,shown:true};let bounds={x,y,width:kind==='explorer'?430:450,height:kind==='explorer'?800:48};
  child.window={isDestroyed:()=>!!child.destroyed,isMaximized:()=>false,getBounds:()=>({...bounds}),setBounds:next=>{bounds={...next};events.push({kind,bounds:{...next}});},webContents:{executeJavaScript:async()=>{}}};
  windows.set(child,child);return child;
 };
 const create=()=>createVRPanelPlacement({windows,screen:{getDisplayMatching:()=>({workArea:area})},isActive:()=>true,now:()=>clock,
  setTimer:fn=>{const id=++tick;timers.set(id,fn);return id;},clearTimer:id=>timers.delete(id),
  feedback:contents=>{const kind=[...windows.values()].find(c=>c.window.webContents===contents).kind;events.push({show:kind});let removed=false;return{ready:Promise.resolve(),remove:async()=>{if(!removed){events.push({hide:kind});removed=true;}}};}});
 const manager=create();
 const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
 const finish=async promise=>{await flush();for(let i=0;i<100&&timers.size;i++){clock+=80;const pending=[...timers.values()];timers.clear();pending.forEach(fn=>fn());await flush();}await promise;};
 return{owner,windows,events,add,create,manager,flush,finish,timers,area:value=>area=value};
}

test('初回は現在位置、次回は再生成した2窓を順番に移動しサイズを維持',async()=>{
 const f=fixture(),a=f.add('explorer',100,120),b=f.add('panel-routes',650,180);
 await f.manager.restore(f.owner);assert.deepEqual(f.events,[]);
 f.manager.remember(f.owner);f.windows.clear();const x=f.add('explorer',-300,30),y=f.add('panel-routes',250,50),viewer=f.add('panel-viewer',1200,200);
 const sizes=[x,y].map(c=>c.window.getBounds());await f.finish(f.manager.restore(f.owner));
 assert.deepEqual(x.window.getBounds(),a.window.getBounds());assert.deepEqual(y.window.getBounds(),b.window.getBounds());
 assert.deepEqual(f.events.filter(e=>e.show||e.hide),[{show:'explorer'},{hide:'explorer'},{show:'panel-routes'},{hide:'panel-routes'}]);
 for(const [index,child] of [x,y].entries()){const frames=f.events.filter(e=>e.kind===child.kind);assert.ok(frames.length>3);for(const {bounds}of frames){assert.equal(bounds.width,sizes[index].width);assert.equal(bounds.height,sizes[index].height);}}
 assert.equal(viewer.window.getBounds().x,1200);assert.equal(f.owner.vrPanelMoving,false);assert.equal(f.timers.size,0);
});

test('前回と同じ位置ではマーカーも移動も開始しない',async()=>{
 const f=fixture();f.add('explorer',100,100);f.manager.remember(f.owner);await f.manager.restore(f.owner);assert.deepEqual(f.events,[]);
});

test('Web側の消去描画を待ってからマーカーと移動を開始する',async()=>{
 const f=fixture(),child=f.add('explorer',700,100);f.manager.remember(f.owner);
 child.window.setBounds({...child.window.getBounds(),x:10});f.events.length=0;
 let painted;f.owner.window.webContents.executeJavaScript=()=>new Promise(resolve=>{painted=resolve;});
 const pending=f.manager.restore(f.owner);await f.flush();
 assert.deepEqual(f.events,[]);assert.equal(f.timers.size,0);
 painted();await f.finish(pending);assert.equal(child.window.getBounds().x,700);assert.equal(f.events.some(event=>event.show),true);
});

test('画面取り外しでは作業領域へ収め、移動先をマーカーで示す',async()=>{
 const f=fixture(),a=f.add('explorer',-900,150);f.manager.remember(f.owner);a.window.setBounds({...a.window.getBounds(),x:200,y:50});f.events.length=0;
 f.area({x:0,y:0,width:1000,height:900});await f.finish(f.manager.restore(f.owner));
 assert.equal(a.window.getBounds().x,8);assert.equal(a.window.getBounds().y,92);assert.equal(f.events.some(e=>e.show),true);
});

test('移行中の解除はタイマーとマーカーを解除し、目的地を通過点で上書きしない',async()=>{
 const f=fixture(),a=f.add('explorer',700,180);f.manager.remember(f.owner);a.window.setBounds({...a.window.getBounds(),x:10,y:10});
 const pending=f.manager.restore(f.owner);await f.flush();assert.equal(f.owner.vrPanelMoving,true);f.manager.remember(f.owner);await pending;
 assert.equal(f.timers.size,0);assert.equal(f.owner.vrPanelMoving,false);assert.equal(f.events.filter(e=>e.hide).length,1);
 await f.finish(f.manager.restore(f.owner));assert.equal(a.window.getBounds().x,700);assert.equal(a.window.getBounds().y,180);
});

test('窓の終了・利用世代変更では移動を止める',async()=>{
 for(const close of [true,false]){
  const f=fixture(),a=f.add('explorer',700,100);f.manager.remember(f.owner);a.window.setBounds({...a.window.getBounds(),x:10});f.events.length=0;
  const pending=f.manager.restore(f.owner);await f.flush();if(close)a.destroyed=true;else f.owner.revision++;
  await f.finish(pending);assert.equal(f.events.filter(e=>e.kind).length,0);assert.equal(f.events.filter(e=>e.hide).length,1);assert.equal(f.timers.size,0);
 }
});

test('IDE終了・新しい管理インスタンス・別IDEでは位置を引き継がない',async()=>{
 const f=fixture(),a=f.add('explorer',700,100);f.manager.remember(f.owner);a.window.setBounds({...a.window.getBounds(),x:10});f.events.length=0;
 await f.create().restore(f.owner);assert.equal(a.window.getBounds().x,10);
 await f.manager.restore({...f.owner});assert.equal(a.window.getBounds().x,10);
 f.manager.forget(f.owner);await f.manager.restore(f.owner);assert.deepEqual(f.events,[]);
});

test('複数Navigatorを窓ごとに復元し、新規窓へ古い位置を流用しない',async()=>{
 const f=fixture(),a=f.add('panel-navigation',100,100),b=f.add('panel-navigation',700,200);
 f.manager.remember(f.owner);
 a.window.setBounds({...a.window.getBounds(),x:20,y:20});b.window.setBounds({...b.window.getBounds(),x:30,y:30});
 const fresh=f.add('panel-navigation',900,300);
 await f.finish(f.manager.restore(f.owner));
 assert.equal(a.window.getBounds().x,100);assert.equal(a.window.getBounds().y,100);
 assert.equal(b.window.getBounds().x,700);assert.equal(b.window.getBounds().y,200);
 assert.equal(fresh.window.getBounds().x,900);
 a.destroyed=true;f.windows.delete(a);f.manager.remember(f.owner);
 b.window.setBounds({...b.window.getBounds(),x:40});await f.finish(f.manager.restore(f.owner));
 assert.equal(b.window.getBounds().x,700);assert.equal(f.timers.size,0);
});

test('Navigator VR placement preserves both the new 900 height and a manually chosen height',async()=>{
 for(const height of [900,800,650]){
  const f=fixture(),child=f.add('panel-navigation',100,100);
  child.window.setBounds({x:100,y:100,width:480,height});f.manager.remember(f.owner);
  child.window.setBounds({x:250,y:200,width:600,height});await f.finish(f.manager.restore(f.owner));
  assert.deepEqual(child.window.getBounds(),{x:100,y:100,width:600,height});
 }
});
