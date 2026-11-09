// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as mazeLogic from '../src/components/開発スペース/ナビ迷路.js';
import {navigationKeyActive,bindNavigationKeys} from '../src/components/開発スペース/ナビ入力.js';

// VueのライフサイクルとWebGL境界だけを模擬し、SFC内の実スクリプトをそのまま実行する。
class Vector {set(){return this;}setScalar(){return this;}}
class Color {
 constructor(value){this.value=value;}copy(color){assert.ok(color,'範囲外ブロックの色を参照しない');this.value=color.value;return this;}
 offsetHSL(){return this;}lerp(){return this;}setHex(){return this;}
}
class Object3D {
 constructor(){this.position=new Vector();this.rotation=new Vector();this.scale=new Vector();this.matrix={};}
 add(){}updateMatrix(){}lookAt(){}updateProjectionMatrix(){}dispose(){}
}
class Material {constructor(options={}){Object.assign(this,options);this.color=new Color(options.color);}dispose(){}}
class Geometry {translate(){return this;}dispose(){}}
class Light extends Object3D {constructor(){super();this.color=new Color();this.shadow={mapSize:new Vector(),camera:new Object3D()};}}
class InstancedMesh extends Object3D {
 constructor(geometry,material,count){super();this.count=count;this.instanceMatrix={};this.instanceColor={};}
 setMatrixAt(){}setColorAt(index,color){assert.ok(color);}
}
const THREE={Color,Object3D,InstancedMesh,Scene:Object3D,Group:Object3D,PerspectiveCamera:Object3D,FogExp2:Object3D,
 AmbientLight:Light,DirectionalLight:Light,PointLight:Light,PlaneGeometry:Geometry,BoxGeometry:Geometry,
 MeshStandardMaterial:Material,SpriteMaterial:Material,CanvasTexture:Geometry,Matrix4:class {makeScale(){return this;}},
 Mesh:class extends Object3D {constructor(geometry,material){super();this.material=material;}},
 Sprite:class extends Object3D {constructor(material){super();this.material=material;}}};
const seeded=seed=>()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};
function fixture() {
  const mounted=[],unmounted=[],timers=new Set(),frames=new Map(),rounds=[],meshes=[];
  let frameId=0,clock=0,random=.999,renderCount=0,failRender=false;
  const owner=Object.assign(new EventTarget(),{requestAnimationFrame:fn=>(frames.set(++frameId,fn),frameId),cancelAnimationFrame:id=>frames.delete(id),devicePixelRatio:1});
  const doc=Object.assign(new EventTarget(),{defaultView:owner,hidden:false});
  const rect={left:0,top:0,width:800,height:600};
  const el=Object.assign(new EventTarget(),{ownerDocument:doc,getBoundingClientRect:()=>rect,contains:target=>target===el});doc.activeElement=el;
  const canvas={getContext:()=>({createRadialGradient:()=>({addColorStop(){}}),fillRect(){}})};
  const timerClock={setInterval:fn=>(timers.add(fn),fn),clearInterval:fn=>timers.delete(fn)};
  class Renderer {
    shadowMap={};setClearColor(){}setPixelRatio(){}setSize(){}dispose(){}forceContextLoss(){}
    render(){if(failRender){failRender=false;throw Error('test renderer failure');}renderCount++;}
  }
  class Mesh extends THREE.InstancedMesh {
    constructor(...args){super(...args);meshes.push(this);}
    setColorAt(index,color){assert.ok(color,'ブロックの色が存在する');super.setColorAt(index,color);}
  }
  const source=readFileSync(new URL('../src/components/開発スペース/ナビ迷路.vue',import.meta.url),'utf8');
  const script=source.match(/<script setup>([\s\S]*?)<\/script>/)[1]
    .replace(/import \{([^}]+)\} from '([^']+)';/g,(_,names,id)=>`const {${names}}=require('${id}');`)
    .replace(/import \* as THREE from 'three';/,"const THREE=require('three');");
  const data=vm.runInNewContext(`(()=>{${script};return {stage,canvas,labelBuild,labelSolve,labelCheck};})()`,{
    defineEmits:()=>()=>{},
    document:{createElement:()=>canvas},Math:Object.assign(Object.create(Math),{random:()=>random}),performance:{now:()=>clock},...timerClock,clearTimeout(){},console,
    require:id=>{
      if(id==='vue')return {ref:value=>({value}),onMounted:fn=>mounted.push(fn),onBeforeUnmount:fn=>unmounted.push(fn)};
      if(id==='three')return {...THREE,WebGLRenderer:Renderer,InstancedMesh:Mesh};
      if(id==='./ナビ入力.js')return {navigationKeyActive,bindNavigationKeys:(element,handlers)=>bindNavigationKeys(element,handlers,timerClock)};
      if(id==='./ナビ迷路.js')return {...mazeLogic,MAZE_ALGORITHMS:['wilson','dfs'].map(id=>mazeLogic.MAZE_ALGORITHMS.find(a=>a.id===id)),buildMaze:(cells,id)=>{const maze=mazeLogic.buildMaze(cells,id,seeded(42));rounds.push({cells,id,maze});return maze;}};
      throw Error(id);
    }
  });
  data.stage.value=el;data.canvas.value=canvas;mounted.forEach(fn=>fn());
  return {data,doc,owner,el,rect,rounds,frames,timers,meshes,failNextRender:()=>{failRender=true;},setRandom:value=>{random=value;},setClock:ms=>{clock=ms;},get clock(){return clock;},get renderCount(){return renderCount;},
    frame:(delta=50,rafNow)=>{clock+=delta;const callbacks=[...frames.values()];frames.clear();callbacks.forEach(fn=>fn(rafNow??clock));},
    tick:()=>{for(const fn of [...timers])fn();},
    skip:()=>{const event=new Event('keydown',{cancelable:true});Object.assign(event,{code:'Space'});el.ownerDocument.dispatchEvent(event);return event;},
    dispose:()=>unmounted.forEach(fn=>fn())};
}

test('迷路Vueスクリプト: 大きい迷路から小さいWilson法へ切り替えても描画が止まらない',()=>{
 const f=fixture();try{
  assert.equal(f.rounds[0].cells,14);
  for(let i=0;i<50;i++)f.frame();f.setRandom(0);f.skip();
  for(let i=0;i<30;i++)f.frame();
  assert.equal(f.rounds[1].cells,8);assert.equal(f.rounds[1].id,'wilson');
  assert.equal(f.frames.size,1);assert.ok(f.renderCount>25);
 }finally{f.dispose();}
});


test('迷路Vueスクリプト: 自動完了でも盤面を縮め、Wilson法の生成・探索・答え合わせまで進む',()=>{
 const f=fixture();try{
  f.setRandom(0);
  for(let i=0;i<2000&&f.rounds.length<2;i++)f.frame();
  assert.equal(f.rounds.length,2);assert.equal(f.rounds[1].id,'wilson');assert.equal(f.rounds[1].cells,8);
  let checked=false;
  for(let i=0;i<2000&&f.rounds.length===2;i++){
   f.frame();if(f.data.labelCheck.value.includes('OK'))checked=true;
  }
  assert.ok(checked,'Wilson法の答え合わせがOK');assert.equal(f.rounds.length,3);assert.equal(f.frames.size,1);
 }finally{f.dispose();}
});

test('迷路Vueスクリプト: RAF停止中も10分未満は維持し、ちょうど10分で別アルゴリズムへ復帰',()=>{
 const f=fixture();try{
  f.frame();const stoppedAt=f.clock;f.frames.clear();f.setRandom(0);
  f.setClock(stoppedAt+599999);f.tick();assert.equal(f.rounds.length,1);assert.equal(f.frames.size,0);
  f.setClock(stoppedAt+600000);f.tick();assert.equal(f.rounds.length,2);assert.notEqual(f.rounds[0].id,f.rounds[1].id);assert.equal(f.frames.size,1);
  f.tick();assert.equal(f.rounds.length,2);assert.equal(f.frames.size,1,'RAFを二重登録しない');
  f.frame();assert.ok(f.renderCount>1);
 }finally{f.dispose();}
});

test('迷路Vueスクリプト: 回転だけでは監視を延長せず、表示中の進行だけが10分を数え直す',()=>{
 const f=fixture();try{
  f.frame();const initial=f.clock;
  // RAFの差分は短いまま、監視用の実時間だけ10分進める。盤面が回っても生成段階はまだ変わらない。
  f.setClock(initial+600000);f.frame(0,100);f.tick();assert.equal(f.rounds.length,2);
  for(let i=0;i<40;i++)f.frame();
  const before=f.clock;f.setClock(before+599999);f.frame();f.tick();
  assert.equal(f.rounds.length,2,'生成が実際に進めば前の期限を取り消す');
  const progressedAt=f.clock;
  f.setClock(progressedAt+599999);f.tick();assert.equal(f.rounds.length,2);
  f.setClock(progressedAt+600000);f.tick();assert.equal(f.rounds.length,3);
 }finally{f.dispose();}
});

test('迷路Vueスクリプト: 非表示・サイズ0では作り直さず、再表示後は期限切れを回収',()=>{
 for(const hidden of [true,false]){
  const f=fixture();try{
   f.frame();if(hidden)f.doc.hidden=true;else f.rect.width=0;
   f.setClock(f.clock+600000);f.tick();assert.equal(f.rounds.length,1);
   f.doc.hidden=false;f.rect.width=800;f.tick();assert.equal(f.rounds.length,2);assert.equal(f.frames.size,1);
  }finally{f.dispose();}
 }
});

test('迷路Vueスクリプト: 別Documentへ移動しても時計と監視を維持し、終了時に全て解除',()=>{
 const f=fixture();
 f.frame();const movedAt=f.clock;
 const owner=Object.assign(new EventTarget(),{requestAnimationFrame:f.owner.requestAnimationFrame,cancelAnimationFrame:f.owner.cancelAnimationFrame,devicePixelRatio:1});
 f.el.ownerDocument=Object.assign(new EventTarget(),{defaultView:owner,hidden:false,activeElement:f.el});f.tick();
 assert.equal(f.frames.size,1);f.setClock(movedAt+600000);f.tick();assert.equal(f.rounds.length,2);
 const pending=[...f.timers];f.dispose();assert.equal(f.frames.size,0);assert.equal(f.timers.size,0);
 f.setClock(f.clock+600000);pending.forEach(fn=>fn());assert.equal(f.rounds.length,2);
});


test('迷路Vueスクリプト: 描画例外は進行と数えず、最後の成功から10分で回復する',()=>{
 const f=fixture();try{
  for(let i=0;i<50;i++)f.frame();const lastSuccess=f.clock;
  f.setClock(lastSuccess+599950);f.failNextRender();
  assert.throws(()=>f.frame(),/test renderer failure/);assert.equal(f.frames.size,0);
  f.tick();assert.equal(f.rounds.length,2);assert.equal(f.frames.size,1);
  f.frame();assert.equal(f.frames.size,1,'描画を再開');
 }finally{f.dispose();}
});
