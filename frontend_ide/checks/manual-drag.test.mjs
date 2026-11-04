// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {createSpace} from '../src/components/開発スペース/宇宙描画.js';
import {cameraPosition} from '../src/components/開発スペース/ワープ視点.js';
const near=(a,b,tolerance=1e-7)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);
const flush=async()=>{for(let n=0;n<20;n++)await Promise.resolve();};

// 実エンジンのpointerイベントからCanvas描画まで通す。ブラウザー・画面撮影の代用ではない。
function space(t,{offset=false}={}){
  const old=new Map(),frames=new Map(),timers=new Map(),draws=[],arcs=[],sprites=[];
  const window=new EventTarget(),document=new EventTarget(),canvas=new EventTarget();
  let clock=0,id=0;
  document.hidden=false;
  const context=new Proxy({font:'',createRadialGradient:()=>({addColorStop(){}}),measureText:text=>({width:text.length*6}),
    drawImage:(image,x,y,width,height)=>draws.push({image,x:x+width/2,y:y+height/2,width,height}),
    arc:(...args)=>arcs.push(args),
  },{get:(object,key)=>key in object?object[key]:()=>{}});
  document.createElement=()=>{const sprite={getContext:()=>context};sprites.push(sprite);return sprite;};
  Object.assign(canvas,{getContext:()=>context,setPointerCapture(){},classList:{add(){},remove(){},toggle(){}},
    style:{removeProperty(){}},setAttribute(){},animate:()=>({finished:Promise.resolve(),cancel(){}})});
  Object.assign(window,{devicePixelRatio:1,history:{pushState(){}},requestAnimationFrame:callback=>{frames.set(++id,callback);return id;},cancelAnimationFrame:key=>frames.delete(key)});
  for(const [key,value] of Object.entries({window,document,location:{hash:''},innerWidth:1280,innerHeight:800,Element:class Element{},
    localStorage:{getItem:()=>null,setItem(){}},fetch:async()=>({ok:true,json:async()=>({root:'/project',tree:{n:'project',d:[],f:[['planet.png',200,0]]}})}),
    setTimeout:(callback,ms=0)=>{timers.set(++id,{callback,at:clock+ms});return id;},clearTimeout:key=>timers.delete(key),
  })){old.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});}
  t.mock.method(performance,'now',()=>clock);
  const engine=createSpace(canvas,{tooltip:{style:{},querySelector:()=>({})}},{layout:()=>({centerX:offset?384:640,centerY:offset?240:400})});
  const pump=async(ms=16)=>{clock+=ms;draws.length=0;arcs.length=0;const callbacks=[...frames.values()];frames.clear();for(const callback of callbacks)callback(clock);
    for(const [key,timer] of [...timers])if(timer.at<=clock&&timers.delete(key))timer.callback();await flush();};
  return{engine,frames,timers,pump,
    pointer(type,x,y,pointerId=1){canvas.dispatchEvent(Object.assign(new Event(type,{cancelable:true}),{pointerId,clientX:x,clientY:y}));},
    wheel(ctrlKey,deltaY){const event=Object.assign(new Event('wheel',{cancelable:true}),{ctrlKey,deltaY});canvas.dispatchEvent(event);return event;},
    // 更新オーラ2枚、STAR 10枚、DISK 10枚、CORE/FLAREの後に、種類別PLANETを生成する。
    planet:()=>draws.find(draw=>draw.image===sprites[24+engine.world.planets[0].kind]),
    gate:()=>arcs.find(([, , ,start,end])=>Math.abs(end-start-Math.PI*1.2)<1e-8),
    async ready(view={yaw:.6,pitch:.35,roll:0},side=0){engine.setAutoSpin(false);engine.setViewMode('2d');await engine.refresh(1);engine.setViewMode('3d');
      Object.assign(engine.cam,{tx:0,ty:0,tz:0,dist:2500,...view});Object.assign(engine.goal,engine.cam);
      const eye=cameraPosition(engine.cam),planet=engine.world.planets[0];
      Object.assign(planet,{x:eye.x*.3+side*Math.cos(view.yaw),y:eye.y*.3,z:eye.z*.3-side*Math.sin(view.yaw)});
      await pump(100);},
    dispose(){engine.dispose();for(const [key,descriptor] of old)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];},
  };
}

for(const [yaw,pitch,roll] of [[.6,.35,0],[2.4,.8,Math.PI],[-7,Math.PI/2,Math.PI/2],[.7,Math.PI+.2,7.5]]) {
  for(const offset of [false,true])test(`実pointer→描画: yaw=${yaw}, pitch=${pitch}, roll=${roll}, panel=${offset}`,async t=>{
    const h=space(t,{offset});
    try{
      for(const [dx,dy] of [[-80,0],[80,0],[0,-80],[0,80]]){
        await h.ready({yaw,pitch,roll});const before={...h.planet()},gate=[...h.gate()];
        h.pointer('pointerdown',650,420);h.pointer('pointermove',650+dx,420+dy);h.pointer('pointerup',650+dx,420+dy);
        for(let n=0;n<45;n++){
          await h.pump(100);const planet=h.planet();assert.ok(planet);
          if(dx)assert.ok((planet.x-before.x)*dx>0,'画面の星は左右ドラッグと同方向');
          if(dy)assert.ok((planet.y-before.y)*dy>0,'画面の星は上下ドラッグと同方向');
          near(h.gate()[0],gate[0]);near(h.gate()[1],gate[1]);near(h.gate()[2],gate[2]);
          near(Math.hypot(...Object.values(cameraPosition(h.engine.cam))),2500);
        }
        assert.equal(h.engine.selected,null,'ドラッグ終了をファイル選択として扱わない');
        assert.equal(h.engine.viewMode,'3d');assert.equal(h.frames.size,1);
      }
    }finally{h.dispose();}
  });
}

test('実pointer: クリック閾値・取消・Ctrlホイール・ピンチを維持する',async t=>{
  const h=space(t);
  try{
    await h.ready({yaw:0,pitch:0,roll:0},300);const point=h.planet();assert.ok(point);
    h.pointer('pointerdown',point.x,point.y);h.pointer('pointermove',point.x+2,point.y);h.pointer('pointercancel',point.x+2,point.y);
    assert.equal(h.engine.selected,null);
    const distance=h.engine.goal.dist;assert.equal(h.wheel(false,100).defaultPrevented,false);near(h.engine.goal.dist,distance);
    assert.equal(h.wheel(true,100).defaultPrevented,true);assert.ok(h.engine.goal.dist>distance);
    await h.ready();h.pointer('pointerdown',500,400,1);h.pointer('pointerdown',600,400,2);
    const pinchDistance=h.engine.goal.dist;h.pointer('pointermove',700,400,2);near(h.engine.goal.dist,pinchDistance/2);
    h.pointer('pointerup',700,400,2);h.pointer('pointerup',500,400,1);assert.equal(h.engine.selected,null);
    await h.ready({yaw:0,pitch:0,roll:0},300);const clicked=h.planet();
    h.pointer('pointerdown',clicked.x,clicked.y);h.pointer('pointermove',clicked.x+2,clicked.y);h.pointer('pointerup',clicked.x+2,clicked.y);
    for(let n=0;n<90&&!h.engine.selected;n++)await h.pump(100);
    assert.equal(h.engine.selected?.path,'planet.png','5px未満はファイルクリックとして旋回・接近する');
  }finally{h.dispose();}
});

test('実pointer: 手動終了から1分の自動探索停止、2D中断・復帰で古いドラッグを残さない',async t=>{
  const h=space(t);
  try{
    await h.ready({yaw:.5,pitch:1.4,roll:2.8});h.engine.setAutoSpin(true);
    h.pointer('pointerdown',650,420);h.pointer('pointermove',570,430);h.pointer('pointerup',570,430);
    for(let n=0;n<80;n++)await h.pump(100);const stopped={...h.engine.cam};
    await h.pump(51000);assert.equal(h.engine.orbitPath,null);
    assert.ok(Math.hypot(...Object.values(cameraPosition(h.engine.cam)).map((v,i)=>v-Object.values(cameraPosition(stopped))[i]))>.01,'手動後の待機中も低速回転する');
    near(Math.hypot(...Object.values(cameraPosition(h.engine.cam))),Math.hypot(...Object.values(cameraPosition(stopped))),1e-6);
    await h.pump(1001);assert.ok(h.engine.orbitPath?.length>0,'最後の操作から60秒経つと再開する');
    h.pointer('pointerdown',650,420);h.pointer('pointermove',600,470);await h.pump();
    h.engine.setViewMode('2d');const frozen={...h.engine.cam};h.pointer('pointermove',400,600);h.pointer('pointerup',400,600);
    for(let n=0;n<10;n++)await h.pump(1000);assert.deepEqual(h.engine.cam,frozen);assert.equal(h.frames.size,0);
    h.engine.setViewMode('3d');await h.pump();assert.notDeepEqual(h.engine.cam,frozen,'3D復帰後は低速回転を再開');assert.equal(h.frames.size,1);
  }finally{h.dispose();}
});
