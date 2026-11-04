// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {createSpace} from '../src/components/開発スペース/宇宙描画.js';
import {cockpitLook,framingDistance,WARP_APPROACH_WIDTH,WARP_PEAK_WIDTH} from '../src/components/開発スペース/ワープ視点.js';
import {warpMotion} from '../viewer/web/layout.js';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const flush=async()=>{for(let n=0;n<20;n++)await Promise.resolve();};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const directory=(n,f=[],d=[])=>({n,f,d});
const sizes=[['small.js',10,100],['large.py',102400,100],['picture.png',102400,100],['song.mp3',102400,100]];
const fixture={root:'/project',tree:directory('project',[['root.js',10,100]],[
  directory('src',sizes,[directory('empty'),directory('many',Array.from({length:100},(_,n)=>[`file-${n}.js`,10,100]))]),
])};
const viewports=[[1280,800],[768,1000],[390,844],[2560,720]];
const peak=motion=>Number(motion.exit.frames.at(-1).transform.match(/scale\((.*)\)/)[1]);

for(const [width,height] of viewports)test(`中央の星の距離計算 ${width}×${height}: 視線オフセットによらず外周25%/50%`,()=>{
  const focal=Math.min(width,height)*1.05;
  for(const [x,y] of [[0,0],[-width*.2,0],[0,-height*.2],[-width*.2,-height*.2]]){
    const distance=framingDistance(120,width,focal,x,y),depth=cockpitLook(x,y,focal)(0,0,distance)[2];
    near(120*focal/depth/width,WARP_APPROACH_WIDTH);
    const scale=peak(warpMotion('in',{inwardScale:WARP_PEAK_WIDTH/WARP_APPROACH_WIDTH}));
    near(scale,2);near(120*focal/depth/width*scale,WARP_PEAK_WIDTH);
  }
  near(peak(warpMotion('in')),2.6);near(peak(warpMotion('out')),0.38);
});

// 実エンジンと描画関数を使用する。Canvas・API・時計だけをメモリ内へ置き換え、ブラウザは起動しない。
function space(t,{width=1280,height=800,offset=false}={}){
  const old=new Map(),frames=new Map(),timers=new Map(),animations=[],draws=[],arcs=[],sprites=[];
  const window=new EventTarget(),document=new EventTarget(),canvas=new EventTarget(),location={hash:''};
  let clock=0,id=0,busy=false;
  document.hidden=false;
  const context=new Proxy({font:'',createRadialGradient:()=>({addColorStop(){}}),measureText:text=>({width:text.length*6}),
    drawImage:(image,x,y,w,h)=>draws.push({image,x,y,width:w,height:h,alpha:context.globalAlpha}),
    arc:(...args)=>arcs.push(Object.assign(args,{lineWidth:context.lineWidth})),
  },{get:(object,key)=>key in object?object[key]:()=>{}});
  const scratch=new Proxy({createRadialGradient:()=>({addColorStop(){}})},{get:(object,key)=>key in object?object[key]:()=>{}});
  document.createElement=()=>{const sprite={getContext:()=>scratch};sprites.push(sprite);return sprite;};
  Object.assign(canvas,{getContext:()=>context,style:{removeProperty(key){delete this[key];}},classList:{add(){},remove(){},toggle(){}},
    setAttribute:(name,value)=>{if(name==='aria-busy')busy=value==='true';},
    animate(keyframes,options){const done=deferred(),animation={keyframes,options,finished:done.promise,finish:done.resolve,cancelled:false,
      cancel(){this.cancelled=true;done.reject(Error('cancelled'));}};animations.push(animation);return animation;},
  });
  Object.assign(window,{devicePixelRatio:1,history:{pushState(_a,_b,hash){location.hash=hash;}},requestAnimationFrame:callback=>{frames.set(++id,callback);return id;},cancelAnimationFrame:key=>frames.delete(key)});
  for(const [key,value] of Object.entries({window,document,location,innerWidth:width,innerHeight:height,Element:class Element{},
    localStorage:{getItem:()=>null,setItem(){}},fetch:async()=>({ok:true,json:async()=>structuredClone(fixture)}),
    setTimeout:(callback,ms=0)=>{timers.set(++id,{callback,at:clock+ms});return id;},clearTimeout:key=>timers.delete(key),
  })){
    old.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  }
  t.mock.method(performance,'now',()=>clock);t.mock.method(Date,'now',()=>Date.UTC(2026,9,23,3)+clock);
  const engine=createSpace(canvas,{tooltip:{style:{},querySelector:()=>({})}},{layout:()=>({centerX:width*(offset?.3:.5),centerY:height*(offset?.3:.5)})});
  engine.setAutoSpin(false);
  const pump=async(ms=16)=>{
    clock+=ms;draws.length=0;arcs.length=0;
    const pending=[...frames.values()];frames.clear();for(const callback of pending)callback(clock);
    for(const [key,timer] of [...timers])if(timer.at<=clock&&timers.delete(key))timer.callback();
    await flush();
  };
  const until=async(predicate,ms=16)=>{for(let n=0;n<600&&!predicate();n++)await pump(ms);assert.ok(predicate(),'navigation progresses');};
  return{engine,canvas,frames,timers,animations,draws,arcs,sprites,pump,until,
    async ready(folder='src'){engine.setViewMode('2d');await engine.refresh(150);if(folder)await engine.goTo({type:'dir',path:folder});engine.setViewMode('3d');for(let n=0;n<40;n++)await pump(100);},
    async complete(navigation){let done=false;navigation.then(()=>done=true);for(let n=0;n<600&&!done;n++){for(const animation of animations)animation.finish();await pump();}assert.equal(done,true);return navigation;},
    idle:()=>!busy,
    dispose(){engine.dispose();for(const [key,descriptor] of old)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];},
  };
}
function ringDiameter(h){
  const ring=h.arcs.find(([, , ,start,end])=>Math.abs(end-start-Math.PI*1.2)<1e-8);
  assert.ok(ring,'帰還ゲートの実arc外周を測る');return ring[2]*2+ring.lineWidth;
}

for(const [width,height] of viewports)for(const offset of [false,true])test(`帰還ゲート実描画 ${width}×${height} offset=${offset}: 外周は接近約1/4、拡大後約1/2`,async t=>{
  const h=space(t,{width,height,offset});
  try{
    await h.ready();h.engine.marks({mode:'since',since:0});
    const navigation=h.engine.ascend(0);
    await h.until(()=>h.animations.length===1);
    const diameter=ringDiameter(h),fraction=diameter/width;
    assert.ok(fraction>=.235&&fraction<=.253,`実描画の幅比=${fraction}`);
    const scale=Number(h.animations[0].keyframes.at(-1).transform.match(/scale\((.*)\)/)[1]);
    near(scale,2);assert.ok(fraction*scale<=.506,`ワープ最大幅比=${fraction*scale}`);
    // 中心球は外周中心線の35%、淡いDISKの透明な外縁は中心線の2.4倍。主要な外周と混同しない。
    assert.ok(h.arcs.some(([, ,r,start,end])=>Math.abs(r*2-diameter/1.035*.35)<1e-8&&end-start===Math.PI*2));
    const halo=h.draws.find(draw=>h.sprites.includes(draw.image)&&Math.abs(draw.width-diameter/1.035*2.4)<1e-8);
    assert.ok(halo);assert.ok(halo.alpha<=.64+1e-10);
    const camera={...h.engine.cam};for(let n=0;n<8;n++)await h.pump(100);
    assert.deepEqual(h.engine.cam,camera,'フェード中に追加で接近しない');
    assert.equal(await h.complete(navigation),true);assert.equal(h.idle(),true);assert.equal(h.timers.size,0);assert.equal(h.frames.size,1);
    t.diagnostic(`Canvas ring ${(fraction*100).toFixed(2)}%; ×2 warp ${(fraction*scale*100).toFixed(2)}%; opaque core ${(fraction/1.035*.35*100).toFixed(2)}% (not browser screenshots)`);
  }finally{h.dispose();}
});

test('至近距離からの帰還: ジャンプせず離れ、巨大な接写をワープへ持ち越さない',async t=>{
  const h=space(t);
  try{
    await h.ready();Object.assign(h.engine.cam,{tx:0,ty:0,tz:0,dist:50,yaw:0,pitch:0,roll:0});Object.assign(h.engine.goal,h.engine.cam);await h.pump();
    const navigation=h.engine.ascend(0);near(h.engine.cam.dist,50);let previous=50;
    for(let n=0;n<500&&!h.animations.length;n++){
      await h.pump();assert.ok(h.engine.cam.dist>=previous-1e-8,'徐々に離れ、近づき直す反動がない');previous=h.engine.cam.dist;
    }
    assert.equal(h.animations.length,1);assert.ok(ringDiameter(h)/1280<=.253);assert.equal(await h.complete(navigation),true);
  }finally{h.dispose();}
});

test('子フォルダ銀河と種類別ファイルの距離・ワープ倍率は従来どおり',async t=>{
  const h=space(t);
  try{
    await h.ready('');const g=h.engine.world.galaxies[0],navigation=h.engine.dive(g);
    await h.until(()=>h.engine.cam.tx===g.x&&h.engine.goal.dist<h.engine.cam.dist);near(h.engine.goal.dist,g.R*1.1*1.05);
    await h.until(()=>h.animations.length===1);near(Number(h.animations[0].keyframes.at(-1).transform.match(/scale\((.*)\)/)[1]),2.6);
    assert.equal(await h.complete(navigation),true);
    for(const [name] of sizes){
      h.engine.clear();Object.assign(h.engine.cam,{tx:0,ty:0,tz:0,dist:4500,yaw:0,pitch:0,roll:0});Object.assign(h.engine.goal,h.engine.cam);
      const body=h.engine.world.byPath.get(`src/${name}`),run=h.engine.goTo({type:'file',path:body.path});
      await h.until(()=>h.engine.cam.tx===body.x&&h.engine.goal.dist<h.engine.cam.dist);
      near(h.engine.goal.dist,Math.max(180,body.R*22)*1.05);assert.equal(await h.complete(run),true);
      assert.equal(h.animations.length,2,'同階層ファイルの接近にワープを増やさない');
    }
  }finally{h.dispose();}
});

for(const action of ['clear','2d','replace','dispose'])test(`帰還の接近中の${action}: 古いワープ・プレビューを復活させない`,async t=>{
  const h=space(t);
  try{
    await h.ready();const navigation=h.engine.ascend(0);
    await h.until(()=>h.engine.goal.dist<h.engine.cam.dist&&h.engine.cam.tx===0&&h.engine.cam.ty===0);assert.equal(h.animations.length,0);
    let replacement;
    if(action==='clear')h.engine.clear();else if(action==='2d')h.engine.setViewMode('2d');else if(action==='replace')replacement=h.engine.goTo({type:'file',path:'src/small.js'});else h.engine.dispose();
    assert.notEqual(await navigation,true);
    if(replacement){assert.equal(await h.complete(replacement),true);assert.equal(h.engine.selected.path,'src/small.js');}
    else{const camera={...h.engine.cam};await h.pump(10000);assert.deepEqual(h.engine.cam,camera);assert.equal(h.engine.selected,null);}
    assert.equal(h.animations.length,0);assert.equal(h.timers.size,0);assert.equal(h.idle(),true);
  }finally{h.dispose();}
});

for(const source of ['double-click','fast-warp'])test(`中央の星を使う${source}: 同じ距離規則で親へ戻る`,async t=>{
  const h=space(t);
  try{
    await h.ready();let navigation;
    if(source==='double-click'){
      const {x,y}=h.engine.projection;
      h.canvas.dispatchEvent(Object.assign(new Event('dblclick'),{clientX:x,clientY:y}));
    }else{h.engine.setFastWarp(true);navigation=h.engine.goTo({type:'file',path:'root.js',line:9,column:2,query:'root'});}
    await h.until(()=>h.animations.length===1);
    assert.ok(ringDiameter(h)/1280<=.253);near(Number(h.animations[0].keyframes.at(-1).transform.match(/scale\((.*)\)/)[1]),2);
    if(navigation){assert.equal(await h.complete(navigation),true);assert.equal(h.engine.selected.path,'root.js');assert.equal(h.engine.selected.line,9);}
    else{h.animations[0].finish();await h.until(()=>h.animations.length===2);h.animations[1].finish();await h.until(h.idle);}
    assert.deepEqual(h.engine.trail,[]);assert.equal(h.animations.length,2);assert.equal(h.timers.size,0);
  }finally{h.dispose();}
});
