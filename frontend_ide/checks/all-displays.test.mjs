// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import native from '../デスクトップ/全画面横断.cjs';
const {displayBounds,createAllDisplays}=native;
const display=(x,y,width=1920,height=1080,scaleFactor=1)=>({bounds:{x,y,width,height},workArea:{x,y,width,height:height-40},scaleFactor});
const four=[display(-1920,-1080),display(0,-1080,1920,1080,1.5),display(-1920,0,1920,1080,2),display(0,0)];
function fixture(displays=four,platform='linux',options={}){
 const screen=new EventEmitter();let current=displays;
 Object.assign(screen,{getAllDisplays:()=>current,getPrimaryDisplay:()=>current.at(-1),getDisplayMatching:()=>current.at(-1)});
 class Window extends EventEmitter{
  constructor(){super();this.bounds={x:40,y:60,width:900,height:700};this.normal={...this.bounds};this.movable=true;this.resizable=true;this.messages=[];this.webContents={send:(...args)=>this.messages.push(args)};}
  getBounds(){return{...this.bounds};}getNormalBounds(){return{...this.normal};}setBounds(bounds){this.bounds={...bounds};if(!this.maximized)this.normal={...bounds};}
  isMaximized(){return !!this.maximized;}maximize(){this.maximized=true;this.bounds={...screen.getPrimaryDisplay().workArea};}unmaximize(){this.maximized=false;this.bounds={...this.normal};}
  isMinimized(){return !!this.minimized;}restore(){this.minimized=false;this.emit('restore');}
  isMovable(){return this.movable;}setMovable(value){this.movable=value;}isResizable(){return this.resizable;}setResizable(value){this.resizable=value;}
  isDestroyed(){return !!this.destroyed;}close(){this.destroyed=true;this.emit('closed');}
 }
 const record={kind:'ide',window:new Window()},event={record};
 const synced=[];
 const controller=createAllDisplays({screen,platform,trustedEvent:e=>e?.record&&!e.record.window.isDestroyed()?e.record:null,syncChildren:record=>synced.push(record),...options});controller.register(record);
 return{controller,record,window:record.window,screen,event,synced,displays:next=>{current=next;screen.emit('display-removed');},toggle:()=>controller.handle(event,'toggle')};
}
test('F11は本体・子パネル・Browser本文から所属IDEのVRを解除し、通常時は開始しない',()=>{
 for(const kind of ['ide','code','console','live','viewer','explorer','panel-routes','browser']){
  const f=fixture(),contents=new EventEmitter(),original=f.window.getBounds();
  const record=kind==='ide'?f.record:{kind,owner:f.record};
  const dispose=f.controller.attachExitKey(record,contents);
  let prevented=0;
  const press=input=>contents.emit('before-input-event',{preventDefault(){prevented++;}},{type:'keyDown',key:'F11',...input});
  press();assert.equal(f.controller.state(f.record).active,false);assert.equal(prevented,0);
  f.toggle();
  for(const input of [{key:'F10'},{type:'keyUp'},{control:true},{alt:true},{shift:true},{meta:true}])press(input);
  assert.equal(f.controller.state(f.record).active,true);assert.equal(prevented,0);
  press();assert.equal(f.controller.state(f.record).active,false,kind);assert.equal(prevented,1);assert.deepEqual(f.window.getBounds(),original);
  press({isAutoRepeat:true});assert.equal(f.controller.state(f.record).active,false,'押し続けても再移行しない');
  contents.emit('destroyed');assert.equal(contents.listenerCount('before-input-event'),0);dispose();f.window.close();
 }
});

test('4画面の負座標・DPI混在: 全画面の外接矩形をDIPのまま使う',()=>{
 assert.deepEqual(displayBounds(four),{x:-1920,y:-1080,width:3840,height:2160});
 assert.deepEqual(displayBounds([display(-1280,200,1280,1024,1.5),display(0,0,1920,1080,2)]),{x:-1280,y:0,width:3200,height:1224});
 assert.throws(()=>displayBounds([]),/取得できません/);
});

test('WindowsのVR外枠は画面外へ出し、復帰サイズと画面ごとのメニュー位置を維持する',()=>{
 const f=fixture(four,'win32'),original=f.window.getBounds(),area=displayBounds(four);
 for(let i=0;i<3;i++){
  const state=f.toggle(),bounds=f.window.getBounds();
  assert.deepEqual(bounds,{x:area.x-2,y:area.y-2,width:area.width+4,height:area.height+4});
  state.toolbars.forEach((bar,index)=>{
   const target=four[index].workArea;
   assert.ok(Math.abs(bounds.x+bounds.width*bar.left/100-target.x)<1e-8);
   assert.ok(Math.abs(bounds.y+bounds.height*bar.top/100-target.y)<1e-8);
  });
  f.screen.emit('display-metrics-changed');assert.deepEqual(f.window.getBounds(),bounds,'再計算で余白を累積しない');
  f.toggle();assert.deepEqual(f.window.getBounds(),original);assert.equal(f.window.resizable,true);
 }
 f.window.close();
});
test('ALL再押下: 元位置・サイズへ復帰し、移動・リサイズを再度有効にする',()=>{
 const f=fixture(),original=f.window.getBounds(),result=f.toggle();
 assert.equal(result.ok,true);assert.equal(result.active,true);assert.equal(result.displayCount,4);assert.deepEqual(f.window.getBounds(),displayBounds(four));
 assert.equal(f.window.movable,false);assert.equal(f.window.resizable,false);
 assert.deepEqual(result.toolbar,{left:50,top:50,width:50});
 assert.deepEqual(result.toolbars.map(({displayId,...position})=>position),[{left:0,top:0,width:50},{left:50,top:0,width:50},{left:0,top:50,width:50},{left:50,top:50,width:50}]);
 assert.equal(f.toggle().active,false);assert.deepEqual(f.window.getBounds(),original);assert.equal(f.window.movable,true);assert.equal(f.window.resizable,true);
 assert.deepEqual(f.synced,[f.record,f.record],'ALLの拡張・復帰後に子窓の前後関係も再確認する');
 f.window.close();assert.equal(f.screen.listenerCount('display-removed'),0);
});
test('最大化からALL→元の最大化、最大化ボタンではALL解除して1画面へ戻る',()=>{
 const f=fixture(),normal=f.window.getBounds();f.window.maximize();f.toggle();assert.equal(f.window.isMaximized(),false);
 f.toggle();assert.equal(f.window.isMaximized(),true);f.window.unmaximize();assert.deepEqual(f.window.getBounds(),normal);
 f.toggle();assert.equal(f.controller.leave(f.record,{maximize:true}),true);assert.equal(f.window.isMaximized(),true);assert.equal(f.controller.state(f.record).active,false);f.window.close();
});
test('ネイティブの寸法丸めがあってもALLの往復で窓が広がらない',()=>{
 const f=fixture(),original=f.window.getBounds(),set=f.window.setBounds.bind(f.window);
 f.window.setBounds=bounds=>set({...bounds,width:bounds.width+2,height:bounds.height+1});
 for(let i=0;i<3;i++){f.toggle();assert.deepEqual(f.window.getBounds(),displayBounds(four));f.toggle();assert.deepEqual(f.window.getBounds(),original);}
 f.window.close();
});

test('画面移動時に旧DPIで縮む場合は保存寸法を再適用してから端数だけ補正する',()=>{
 const f=fixture(four,'win32'),original=f.window.getBounds(),set=f.window.setBounds.bind(f.window);
 f.window.setBounds=bounds=>{
  const moved=bounds.x!==f.window.bounds.x;
  set({...bounds,width:Math.round(bounds.width*(moved?2/3:1))+2,height:Math.round(bounds.height*(moved?2/3:1))+1});
 };
 for(let i=0;i<3;i++){f.toggle();f.toggle();assert.deepEqual(f.window.getBounds(),original);}
 f.window.close();
});

test('125%で補正後も同じ幅になる場合、残差を直前の指定値へ加えて毎回同じ寸法へ戻す',()=>{
 const f=fixture(four,'win32'),set=f.window.setBounds.bind(f.window);
 set({x:21,y:21,width:1496,height:786});const original=f.window.getBounds();
 // 実機での幅1496→1497、1495→1497、1494→1496という段差を再現する。
 f.window.setBounds=bounds=>set({...bounds,width:bounds.width+1+(bounds.width%4>=2?1:0),height:bounds.height+2});
 for(let i=0;i<10;i++){f.toggle();f.toggle();assert.deepEqual(f.window.getBounds(),original);}
 f.window.close();
});

test('整数DIPで一致できない寸法では補正を打ち切り、最も近い寸法を維持する',()=>{
 const f=fixture(),set=f.window.setBounds.bind(f.window);let calls=0;
 f.window.setBounds=bounds=>{calls++;set({...bounds,width:2*Math.floor(bounds.width/2)+1});};
 for(let i=0;i<10;i++){
  const before=calls;f.toggle();f.toggle();assert.ok(calls-before<=12,'補正が無限に続かない');
  assert.ok(Math.abs(f.window.getBounds().width-900)<=1,'一致不能な幅の誤差が累積しない');
 }
 f.window.close();
});
test('画面取り外し・最小化復帰: ALL領域を更新し、復帰先も見える画面内へ戻す',()=>{
 const f=fixture();f.window.setBounds({x:-1800,y:-1000,width:900,height:700});f.toggle();
 f.window.minimized=true;f.displays([display(0,0)]);f.window.restore();assert.deepEqual(f.window.getBounds(),displayBounds([display(0,0)]));
 assert.equal(f.controller.state(f.record).displayCount,1);f.toggle();const bounds=f.window.getBounds();assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=1920&&bounds.y+bounds.height<=1040);f.window.close();
});
test('IDE本体以外・不明操作は拒否し、子窓を操作しない',()=>{
 const f=fixture();assert.equal(f.controller.handle({},'toggle').ok,false);
 for(const kind of ['code','viewer','explorer','panel-routes']){
  const record={kind,window:f.window};f.controller.register(record);assert.equal(f.controller.handle({record},'toggle').ok,false);
 }
 const child={kind:'ide',owner:f.record,window:f.window};f.controller.register(child);assert.equal(f.controller.handle({record:child},'toggle').ok,false);
 assert.equal(f.controller.handle(f.event,'setBounds').ok,false);assert.equal(f.controller.state(f.record).active,false);f.window.close();
});

test('VRの応答はパネル移動を待ち、終了位置は親窓を戻す前に記憶する',async()=>{
 let finish,remembered,forgotten=false;
 const f=fixture(four,'linux',{panels:{restore:()=>new Promise(resolve=>finish=resolve),remember:record=>remembered=record.window.getBounds(),cancel(){},forget:()=>forgotten=true}});
 const pending=f.toggle();assert.equal(f.controller.isActive(f.record),true);assert.equal(typeof pending.then,'function');
 f.controller.leave(f.record);assert.deepEqual(remembered,displayBounds(four));finish();assert.equal((await pending).active,false,'途中解除後に古いactive状態を返さない');
 f.window.close();assert.equal(forgotten,true);
});
