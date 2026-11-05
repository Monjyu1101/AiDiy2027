// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {parse,compileScript} from '@vue/compiler-sfc';
import {transformSync} from 'esbuild';
import {createAquarium} from '../src/components/開発スペース/ナビ水槽.js';
import {createRipples} from '../src/components/開発スペース/ナビ風景.js';
import {navigationKeyActive,bindNavigationKeys} from '../src/components/開発スペース/ナビ入力.js';

function tank() {
  const aquarium=createAquarium(()=>.5);aquarium.fish.splice(1);
  Object.assign(aquarium.fish[0],{x:.5,y:.5,dir:1,phase:Math.PI/2});
  return aquarium;
}
test('アクアリウム: ポインターの上下左右から近づかず離れる',()=>{
  for(const point of [{x:.4,y:.5},{x:.6,y:.5},{x:.5,y:.4},{x:.5,y:.6},{x:.48,y:.48}]){
    const a=tank(),f=a.fish[0],before=Math.hypot((f.x-point.x)*400,(f.y-point.y)*320);
    a.setPointer(point);a.step(.05,400,320);
    assert.ok(Math.hypot((f.x-point.x)*400,(f.y-point.y)*320)>before);
    assert.ok((f.x-.5)*(.5-point.x)+(f.y-.5)*(.5-point.y)>0);
  }
});
test('アクアリウム: 魚とポインターが完全に重なっても離れ、遠方では通常遊泳を維持',()=>{
  const a=tank(),f=a.fish[0];a.setPointer({x:.5,y:.5});a.step(.05,400,320);
  assert.ok(Number.isFinite(f.x+f.y));assert.notEqual(f.x,.5);
  const calm=tank(),far=tank();far.setPointer({x:0,y:0});
  calm.step(.05,400,320);far.step(.05,400,320);assert.deepEqual(far.fish,calm.fish);
});
test('アクアリウム: 上下端に追い込まれても横へ逃げて停止しない',()=>{
  for(const bottom of [false,true]){
    const a=tank(),f=a.fish[0],minY=f.size*.45/320;
    f.y=bottom?.9:minY;a.setPointer({x:.5,y:bottom?.8:.1});
    a.step(.05,400,320);assert.notEqual(f.x,.5);assert.ok(f.y>=minY&&f.y<=.9);
    for(let i=0;i<120;i++)a.step(.05,400,320);
    assert.ok(Math.abs(f.x-.5)>.1);assert.ok(f.y>=minY&&f.y<=.9);
  }
});
test('アクアリウム: 餌よりホバー回避を優先し、ポインターを離すと餌に向かう',()=>{
  const a=tank(),f=a.fish[0];a.feed(.54);a.food.forEach(p=>{p.y=.56;});
  a.setPointer({x:.54,y:.56});a.step(.05,400,320);
  assert.ok(f.x<.5&&f.y<.5);
  const previous={...f};a.setPointer(null);a.step(.05,400,320);
  assert.ok(f.x>previous.x&&f.y>previous.y);
});
test('アクアリウム: 指定横位置の水面から餌を落とし、連打上限と寿命を守る',()=>{
  const a=tank();a.fish.length=0;a.feed(.73);
  assert.equal(a.food.length,4);assert.ok(a.food.every(p=>p.x===.73&&p.y===0));
  a.step(.05,400,320);assert.ok(a.food.every(p=>p.y>0&&p.y<.01));
  for(let i=0;i<30;i++)a.feed(.2);assert.equal(a.food.length,64);
  for(let i=0;i<370;i++)a.step(.05,400,10000);assert.equal(a.food.length,0);
  a.feed(.2);for(let i=0;i<100;i++)a.step(.05,400,50);assert.equal(a.food.length,0);
});
test('アクアリウム: 餌を食べ、リサイズ・不正座標・ゼロ時間でも状態を壊さず破棄する',()=>{
  const a=tank(),f=a.fish[0];a.feed(.5);a.food.forEach(p=>{p.y=.5;});
  a.step(.05,400,320);assert.equal(a.food.length,3);
  a.feed(NaN);assert.equal(a.food.length,3);a.setPointer({x:NaN,y:0});
  const before=JSON.stringify(a.fish);a.step(0,200,640);a.step(.05,0,640);assert.equal(JSON.stringify(a.fish),before);
  a.step(.05,1,1);assert.ok(f.x>=0&&f.x<1&&Number.isFinite(f.y));
  a.clear();assert.equal(a.food.length,0);assert.equal(a.fish.length,0);
});

function fixture(kind='aquarium') {
  const mounted=[],unmounted=[],timers=new Set(),frames=new Map(),models=[],ripples=[];let frameId=0;
  const owner=Object.assign(new EventTarget(),{requestAnimationFrame:fn=>(frames.set(++frameId,fn),frameId),cancelAnimationFrame:id=>frames.delete(id),matchMedia:()=>({matches:false}),devicePixelRatio:1});
  const doc=Object.assign(new EventTarget(),{defaultView:owner,hidden:false});
  const rect={left:80,top:120,width:400,height:320};
  const el=Object.assign(new EventTarget(),{ownerDocument:doc,getBoundingClientRect:()=>rect,contains:()=>false});
  const ctx=new Proxy({},{get:(object,key)=>object[key]??(()=>{}),set:(object,key,value)=>(object[key]=value,true)});
  const canvas={width:0,height:0,getContext:()=>ctx};
  const source=readFileSync(new URL('../src/components/開発スペース/ナビ風景.vue',import.meta.url),'utf8');
  const {descriptor}=parse(source),script=compileScript(descriptor,{id:'aquarium'}),module={exports:{}};
  vm.runInNewContext(transformSync(script.content,{format:'cjs'}).code,{module,require:id=>{
    if(id==='vue')return {ref:()=>({value:undefined}),onMounted:fn=>mounted.push(fn),onBeforeUnmount:fn=>unmounted.push(fn)};
    if(id==='./ナビ入力.js')return {navigationKeyActive,bindNavigationKeys:(element,handlers)=>bindNavigationKeys(element,handlers,{setInterval:fn=>(timers.add(fn),fn),clearInterval:fn=>timers.delete(fn)})};
    if(id==='./ナビ風景.js')return {createRipples:()=>{const model=createRipples(()=>.5);ripples.push(model);return model;}};
    if(id==='./ナビ水槽.js')return {createAquarium:()=>{const model=tank();models.push(model);return model;}};
    // 他の風景が独立した描画モジュールを持つ場合も、実装を呼ばないこの試験には影響しない。
    return {};
  }});
  const data=module.exports.default.setup({kind},{expose(){},emit(){}});data.stage.value=el;data.canvas.value=canvas;mounted.forEach(fn=>fn());
  const dispatch=(type,values={})=>{const event=new Event(type,{cancelable:true});Object.assign(event,{clientX:280,clientY:280,pointerType:'mouse',button:0,...values});el.dispatchEvent(event);return event;};
  return {el,doc,owner,models,ripples,frames,timers,rect,dispatch,frame:now=>{const callbacks=[...frames.values()];frames.clear();callbacks.forEach(fn=>fn(now));},dispose:()=>unmounted.forEach(fn=>fn())};
}
test('アクアリウム実Vue: 深いクリックも水面から投入し、右クリック・取消・他演出は無視',()=>{
  const f=fixture();try{
    const a=f.models[0];f.dispatch('click',{clientX:380,clientY:410});
    assert.ok(a.food.every(p=>p.x===.75&&p.y===0));assert.equal(a.food.length,4);
    f.dispatch('click',{button:2});assert.equal(a.food.length,4);
    // EventTargetのcapture順に依存せず、事前に取消されたクリックを渡す。
    const event=new Event('click',{cancelable:true});event.preventDefault();Object.assign(event,{button:0,clientX:200,clientY:300});f.el.dispatchEvent(event);
    assert.equal(a.food.length,4);
  }finally{f.dispose();}
  const other=fixture('water');try{other.dispatch('click');assert.equal(other.models.length,0);}finally{other.dispose();}
});
test('アクアリウム実Vue: hover回避・leave/cancel/blur解除とタッチ後の通常遊泳',()=>{
  for(const reset of ['pointerleave','pointercancel','blur','touch']){
    const f=fixture();try{
      const a=f.models[0],fish=a.fish[0];f.dispatch('pointermove',{clientX:260,clientY:280});f.frame(100);f.frame(150);
      assert.ok(fish.x>.5);const escaped=fish.x;
      if(reset==='blur')f.owner.dispatchEvent(new Event('blur'));else f.dispatch(reset==='touch'?'pointermove':reset,{pointerType:reset==='touch'?'touch':'mouse'});
      f.frame(200);assert.ok(fish.x-escaped<.005,'回避解除後は通常速度');
    }finally{f.dispose();}
  }
});
test('アクアリウム実Vue: 非表示中は進めず、終了時に餌・購読・描画を全て片付ける',()=>{
  const f=fixture(),a=f.models[0];f.dispatch('click');f.frame(100);const before=JSON.stringify(a.food);
  f.doc.hidden=true;f.frame(150);assert.equal(JSON.stringify(a.food),before);
  f.dispose();assert.equal(f.frames.size,0);assert.equal(f.timers.size,0);assert.equal(a.food.length,0);assert.equal(a.fish.length,0);
  f.dispatch('click');f.dispatch('pointermove');assert.equal(a.food.length,0);
});

test('水面実Vue: ホバー位置から優先して波紋を出し、移動連打は制限して最新位置に追従',()=>{
  const f=fixture('water');try{
    const points=f.ripples[0].points;
    f.dispatch('pointerenter',{clientX:380,clientY:200});f.frame(100);
    assert.equal(points.at(-1).x,.75);assert.equal(points.at(-1).y,.25);
    const count=points.length;
    for(let i=0;i<100;i++)f.dispatch('pointermove',{clientX:180,clientY:360});
    f.frame(150);assert.equal(points.length,count);
    f.frame(200);f.frame(250);assert.equal(points.length,count+1);
    assert.equal(points.at(-1).x,.25);assert.equal(points.at(-1).y,.75);
    for(let i=0;i<60;i++)f.frame(300+i*50);
    assert.equal(points.at(-1).x,.25);assert.equal(points.at(-1).y,.75);
  }finally{f.dispose();}
});
test('水面実Vue: Spaceのランダム追加を残し、leave・blur後は自動ランダム波紋へ戻す',()=>{
  for(const reset of ['pointerleave','blur']){
    const f=fixture('water');try{
      const points=f.ripples[0].points;f.dispatch('pointerenter',{clientX:380,clientY:200});f.frame(100);
      const key=new Event('keydown',{cancelable:true});Object.assign(key,{code:'Space'});f.doc.dispatchEvent(key);
      assert.equal(key.defaultPrevented,true);assert.equal(points.at(-1).x,.5);assert.equal(points.at(-1).y,.5);
      if(reset==='blur')f.owner.dispatchEvent(new Event('blur'));else f.dispatch(reset);
      for(let i=0;i<60;i++)f.frame(150+i*50);
      assert.equal(points.at(-1).x,.5);assert.equal(points.at(-1).y,.5);
    }finally{f.dispose();}
  }
});
