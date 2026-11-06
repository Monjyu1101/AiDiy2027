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

function tank(now=()=>0) {
  const aquarium=createAquarium(()=>.5,now);aquarium.fish.splice(1);
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

test('アクアリウム: ホバー位置からぽつぽつ気泡が上昇し、静止中も続く',()=>{
  const a=tank();a.step(.05,400,320);assert.equal(a.bubbles.length,0);
  a.setPointer({x:.73,y:.8});a.step(.05,400,320);
  const first=a.bubbles[0];assert.equal(a.bubbles.length,1);assert.equal(first.x,.73);assert.equal(first.y,.8);
  a.step(.05,400,320);assert.ok(first.y<.8);assert.equal(a.bubbles.length,1);
  for(let i=0;i<12;i++)a.step(.05,400,320);
  assert.equal(a.bubbles.length,2);assert.ok(a.bubbles[1].y>first.y);
});
test('アクアリウム: move連打で気泡を増やさず、次の気泡は最新位置から発生',()=>{
  const a=tank();a.setPointer({x:.2,y:.7});a.step(.05,400,320);
  for(let i=0;i<1000;i++)a.setPointer({x:.8,y:.6});
  a.step(.05,400,320);assert.equal(a.bubbles.length,1);
  for(let i=0;i<12;i++)a.step(.05,400,320);
  assert.equal(a.bubbles.length,2);assert.ok(Math.abs(a.bubbles[1].x-.8)<.001);assert.ok(a.bubbles[1].y<=.6);
});
test('アクアリウム: 離脱・不正座標後は気泡を追加せず、水面到達と寿命で除去',()=>{
  for(const reset of [null,{x:NaN,y:.4}]){
    const a=tank();a.setPointer({x:.4,y:.9});a.step(.05,400,10000);a.setPointer(reset);
    for(let i=0;i<150;i++)a.step(.05,400,10000);
    assert.equal(a.bubbles.length,1);
    for(let i=0;i<12;i++)a.step(.05,400,10000);
    assert.equal(a.bubbles.length,0);
  }
  const a=tank();a.setPointer({x:.4,y:0});a.step(.05,400,320);a.setPointer(null);
  for(let i=0;i<10;i++)a.step(.05,400,320);assert.equal(a.bubbles.length,0);
});
test('アクアリウム: ホバー出入り連打でも気泡は32個以内、リサイズ・無効時間・破棄に安全',()=>{
  const a=tank();
  for(let i=0;i<100;i++){a.setPointer(null);a.setPointer({x:2,y:2});a.step(.05,400,10000);assert.ok(a.bubbles.length<=32);}
  assert.equal(a.bubbles.length,32);assert.ok(a.bubbles.every(p=>Number.isFinite(p.x+p.y)&&p.x<=1&&p.y<=1));
  const before=JSON.stringify(a.bubbles);
  for(const [dt,w,h] of [[0,200,640],[NaN,200,640],[.05,0,640],[.05,400,Infinity]])a.step(dt,w,h);
  assert.equal(JSON.stringify(a.bubbles),before);
  a.step(.05,200,640);assert.ok(a.bubbles.every(p=>Number.isFinite(p.x+p.y)));
  a.clear();assert.equal(a.bubbles.length,0);a.step(.05,400,320);assert.equal(a.bubbles.length,0);
});
test('アクアリウム: 一粒を食べた個体は15秒未満なら追わず食べず、15秒後に再開',()=>{
  let clock=1000;const a=tank(()=>clock),f=a.fish[0];
  a.feed(.5);a.food.forEach(p=>{p.y=.5;});a.step(.05,400,320);
  assert.equal(a.food.length,3);assert.equal(f.foodReadyAt,16000);
  a.food.forEach(p=>{p.x=.2;p.y=.5;});const x=f.x;
  clock=15999;a.step(.05,400,320);assert.ok(f.x>x,'満腹中は左の餌を追わず通常遊泳');
  a.food.forEach(p=>{p.x=f.x;p.y=f.y;});a.step(.05,400,320);assert.equal(a.food.length,3);
  clock=16000;a.step(.05,400,320);assert.equal(a.food.length,2);assert.equal(f.foodReadyAt,31000);
  a.step(.05,400,320);assert.equal(a.food.length,2,'再び食べても一粒で止まる');
});
test('アクアリウム: 食後の待機は個体別で、別の魚の食事や餌追加では延長しない',()=>{
  let clock=1000;const a=tank(()=>clock),first=a.fish[0];
  a.fish.push({...first,x:.9,y:.8});const second=a.fish[1];
  a.feed(.5);a.food.forEach(p=>{p.y=.5;});a.step(.05,400,320);
  assert.equal(first.foodReadyAt,16000);assert.equal(second.foodReadyAt,0);assert.equal(a.food.length,3);
  clock=5000;Object.assign(second,{x:first.x,y:first.y});a.food.forEach(p=>{p.x=first.x;p.y=first.y;});a.step(.05,400,320);
  assert.equal(a.food.length,2);assert.equal(first.foodReadyAt,16000);assert.equal(second.foodReadyAt,20000);
  a.feed(.3);assert.equal(first.foodReadyAt,16000);
  clock=16000;a.food.forEach(p=>{p.x=first.x;p.y=first.y;});a.step(.05,400,320);
  assert.equal(a.food.length,5);assert.equal(first.foodReadyAt,31000);assert.equal(second.foodReadyAt,20000);
});
test('アクアリウム: 満腹中もホバー回避を優先し、食欲は描画時間で早まらない',()=>{
  const a=tank(),f=a.fish[0];a.feed(.5);a.food.forEach(p=>{p.y=.5;});a.step(.05,400,320);
  const before={...f};a.setPointer({x:f.x+.04,y:f.y});a.step(.05,400,320);assert.ok(f.x<before.x);
  a.setPointer(null);for(let i=0;i<400;i++)a.step(.05,400,10000);
  a.feed(f.x);a.food.forEach(p=>{p.y=f.y;});const count=a.food.length;
  a.step(.05,400,10000);assert.equal(a.food.length,count,'描画時計だけ20秒進めても食後15秒の期限前');
});

function fixture(kind='aquarium') {
  const mounted=[],unmounted=[],timers=new Set(),frames=new Map(),models=[],ripples=[],drawnBubbles=[];let frameId=0,clock=0,arc;
  const owner=Object.assign(new EventTarget(),{requestAnimationFrame:fn=>(frames.set(++frameId,fn),frameId),cancelAnimationFrame:id=>frames.delete(id),matchMedia:()=>({matches:false}),devicePixelRatio:1});
  const doc=Object.assign(new EventTarget(),{defaultView:owner,hidden:false});
  const rect={left:80,top:120,width:400,height:320};
  const el=Object.assign(new EventTarget(),{ownerDocument:doc,getBoundingClientRect:()=>rect,contains:()=>false});
  const ctx=new Proxy({fillRect:()=>{drawnBubbles.length=0;},arc:(x,y,r)=>{arc={x,y,r};},stroke:()=>{if(ctx.strokeStyle==='#5fadc4')drawnBubbles.push({...arc,alpha:ctx.globalAlpha});}},{get:(object,key)=>object[key]??(()=>{}),set:(object,key,value)=>(object[key]=value,true)});
  const canvas={width:0,height:0,getContext:()=>ctx};
  const source=readFileSync(new URL('../src/components/開発スペース/ナビ風景.vue',import.meta.url),'utf8');
  const {descriptor}=parse(source),script=compileScript(descriptor,{id:'aquarium'}),module={exports:{}};
  vm.runInNewContext(transformSync(script.content,{format:'cjs'}).code,{module,require:id=>{
    if(id==='vue')return {ref:()=>({value:undefined}),onMounted:fn=>mounted.push(fn),onBeforeUnmount:fn=>unmounted.push(fn)};
    if(id==='./ナビ入力.js')return {navigationKeyActive,bindNavigationKeys:(element,handlers)=>bindNavigationKeys(element,handlers,{setInterval:fn=>(timers.add(fn),fn),clearInterval:fn=>timers.delete(fn)})};
    if(id==='./ナビ風景.js')return {createRipples:()=>{const model=createRipples(()=>.5);ripples.push(model);return model;}};
    if(id==='./ナビ水槽.js')return {createAquarium:()=>{const model=tank(()=>clock);models.push(model);return model;}};
    // 他の風景が独立した描画モジュールを持つ場合も、実装を呼ばないこの試験には影響しない。
    return {};
  }});
  const data=module.exports.default.setup({kind},{expose(){},emit(){}});data.stage.value=el;data.canvas.value=canvas;mounted.forEach(fn=>fn());
  const dispatch=(type,values={})=>{const event=new Event(type,{cancelable:true});Object.assign(event,{clientX:280,clientY:280,pointerType:'mouse',button:0,...values});el.dispatchEvent(event);return event;};
  return {el,doc,owner,models,ripples,frames,timers,rect,dispatch,ctx,drawnBubbles,setClock:ms=>{clock=ms;},frame:now=>{const callbacks=[...frames.values()];frames.clear();callbacks.forEach(fn=>fn(now));},dispose:()=>unmounted.forEach(fn=>fn())};
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
      for(let i=0;i<20;i++)f.frame(250+i*50);assert.equal(a.bubbles.length,1,'離脱後は気泡を追加しない');
    }finally{f.dispose();}
  }
});
test('アクアリウム実Vue: 非表示中は進めず、終了時に餌・購読・描画を全て片付ける',()=>{
  const f=fixture(),a=f.models[0];f.dispatch('click');f.dispatch('pointerenter');f.frame(100);f.frame(150);const before=JSON.stringify([a.food,a.bubbles,a.fish]);
  f.doc.hidden=true;f.frame(200);assert.equal(JSON.stringify([a.food,a.bubbles,a.fish]),before);
  f.dispose();assert.equal(f.frames.size,0);assert.equal(f.timers.size,0);assert.equal(a.food.length,0);assert.equal(a.fish.length,0);assert.equal(a.bubbles.length,0);
  f.dispatch('click');f.dispatch('pointermove');a.step(.05,400,320);assert.equal(a.food.length,0);assert.equal(a.bubbles.length,0);
});
test('アクアリウム実Vue: 表示位置から気泡を描画し、縮小動作ではゆっくり上昇する',()=>{
  const regular=fixture(),reduced=fixture();reduced.owner.matchMedia=()=>({matches:true});
  try{
    for(const f of [regular,reduced]){
      f.dispatch('pointerenter',{clientX:380,clientY:360});f.frame(100);f.frame(150);
      assert.equal(f.drawnBubbles.length,1);assert.equal(f.drawnBubbles[0].x,300);assert.equal(f.drawnBubbles[0].y,240);
      assert.ok(f.drawnBubbles[0].alpha>0&&f.drawnBubbles[0].alpha<1);assert.equal(f.ctx.globalAlpha,1);
      f.frame(200);
    }
    assert.ok(regular.drawnBubbles[0].y<reduced.drawnBubbles[0].y);assert.ok(reduced.drawnBubbles[0].y<240);
  }finally{regular.dispose();reduced.dispose();}
});
test('アクアリウム実Vue: 動きを減らす設定や非表示でも食後の実時間15秒を延ばさない',()=>{
  const f=fixture(),a=f.models[0],fish=a.fish[0];f.owner.matchMedia=()=>({matches:true});
  try{
    f.frame(100);f.setClock(1000);a.feed(.5);a.food.forEach(p=>{p.y=.5;});f.frame(150);
    assert.equal(a.food.length,3);assert.equal(fish.foodReadyAt,16000);
    f.setClock(15999);f.frame(200);assert.equal(a.food.length,3);
    f.doc.hidden=true;f.setClock(16000);f.frame(250);assert.equal(a.food.length,3);
    f.doc.hidden=false;f.frame(300);assert.equal(a.food.length,2);
  }finally{f.dispose();}
});
test('アクアリウム実Vue: 別Documentへ移動・復帰すると旧ポインターを解除し新位置で再開',()=>{
  const f=fixture(),a=f.models[0],original=f.doc;
  try{
    f.dispatch('pointerenter',{clientX:180,clientY:360});f.frame(100);f.frame(150);assert.equal(a.bubbles.length,1);
    const owner=Object.assign(new EventTarget(),{requestAnimationFrame:f.owner.requestAnimationFrame,cancelAnimationFrame:f.owner.cancelAnimationFrame,matchMedia:f.owner.matchMedia,devicePixelRatio:1});
    f.el.ownerDocument=Object.assign(new EventTarget(),{defaultView:owner,hidden:false});
    for(const sync of f.timers)sync();
    for(let i=0;i<20;i++)f.frame(200+i*50);assert.equal(a.bubbles.length,1);
    f.rect.left=200;f.rect.top=50;f.dispatch('pointerenter',{clientX:500,clientY:210});f.frame(1250);
    assert.equal(a.bubbles.at(-1).x,.75);assert.equal(a.bubbles.at(-1).y,.5);
    f.el.ownerDocument=original;for(const sync of f.timers)sync();
    for(let i=0;i<20;i++)f.frame(1300+i*50);assert.equal(a.bubbles.length,2);
  }finally{f.dispose();}
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
