// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {createSpace} from '../src/components/開発スペース/宇宙描画.js';
import {cameraPosition} from '../src/components/開発スペース/ワープ視点.js';

const flush=async()=>{for(let n=0;n<20;n++)await Promise.resolve();};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const reply=value=>({ok:true,json:async()=>structuredClone(value)});
const directory=(n,f=[],d=[])=>({n,f:f.map(name=>[name,20,1000]),d});
const snapshot=(tree=directory('project',['root.js'],[
  directory('src',['main.js'],[directory('nested',['deep.js'])]),directory('別のフォルダ',['資料.txt']),
]),extra={})=>({root:'/project',tree,truncated:false,...extra});
const event=(type,values={})=>Object.assign(new Event(type,{cancelable:true}),values);

function space(t,{fetcher=async()=>reply(snapshot()),holdAnimations=false,hash=''}={}) {
  const old=new Map(),frames=new Map(),timers=new Map(),animations=[],changes=[],requests=[],history=[];
  const window=new EventTarget(),document=new EventTarget(),canvas=new EventTarget();
  const classes=new Set(),attributes=new Map(),storage=new Map();
  let clock=0,id=0,layoutCalls=0,draws=0,captures=0,explorerToggles=0;
  document.hidden=false;
  const context=new Proxy({font:'',createRadialGradient:()=>({addColorStop(){}}),measureText:text=>({width:text.length*6}),fillRect(){draws++;}},{get:(object,key)=>key in object?object[key]:()=>{}});
  Object.assign(canvas,{
    getContext:()=>context,
    classList:{add:value=>classes.add(value),remove:value=>classes.delete(value),toggle(value,on){on?classes.add(value):classes.delete(value);}},
    style:{removeProperty(key){delete this[key];}},setAttribute:(name,value)=>attributes.set(name,value),
    setPointerCapture(){captures++;},
    animate(){
      const done=deferred(),animation={finished:done.promise,cancelled:false,cancel(){this.cancelled=true;done.reject(Error('cancelled'));},finish:done.resolve};
      animations.push(animation);if(!holdAnimations)done.resolve();return animation;
    },
  });
  document.createElement=()=>({getContext:()=>context});
  const location={hash};
  Object.assign(window,{devicePixelRatio:1,history:{pushState(_a,_b,next){history.push(next);location.hash=next;}},
    requestAnimationFrame:callback=>{frames.set(++id,callback);return id;},cancelAnimationFrame:key=>frames.delete(key)});
  for(const [key,value] of Object.entries({
    window,document,location,innerWidth:1280,innerHeight:800,Element:class Element {},
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
    fetch:(url,options)=>{requests.push({url,...options});return fetcher(url,options);},
    setTimeout:(callback,ms)=>{timers.set(++id,{callback,ms,due:clock+Math.max(0,ms||0)});return id;},clearTimeout:key=>timers.delete(key),
  })) {
    old.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  }
  t.mock.method(performance,'now',()=>clock);
  const engine=createSpace(canvas,{tooltip:{}},{change:value=>changes.push(value),layout:()=>{layoutCalls++;return{};},toggleExplorer:()=>explorerToggles++});
  const pump=async(ms=100)=>{
    clock+=ms;
    const callbacks=[...frames.values()];frames.clear();for(const callback of callbacks)callback(clock);
    const waiting=[...timers.entries()];for(const [key,{callback,due}] of waiting){if(due>clock||!timers.delete(key))continue;callback();}
    await flush();
  };
  const finish=async promise=>{
    let done=false,result,error;promise.then(value=>{done=true;result=value;},value=>{done=true;error=value;});
    for(let n=0;n<200&&!done;n++)await pump();
    assert.equal(done,true,'navigation completes');if(error)throw error;return result;
  };
  return {engine,frames,timers,animations,changes,requests,history,window,document,canvas,location,attributes,pump,finish,
    state:()=>changes.filter(value=>'scan'in value).at(-1),
    metrics:()=>({layoutCalls,draws,captures,explorerToggles}),
    visibility(hidden){document.hidden=hidden;document.dispatchEvent(new Event('visibilitychange'));},
    dispose(){engine.dispose();for(const [key,descriptor] of old)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];},
  };
}

test('選択星の周回: 3分で1周し、距離・選択を保って手動と表示停止を優先する',async t=>{
  const h=space(t);
  const advance=async seconds=>{for(let n=0;n<seconds*4;n++)await h.pump(250);};
  const offset=()=>{const eye=cameraPosition(h.engine.cam),star=h.engine.selected;return ['x','y','z'].map(key=>eye[key]-star[key]);};
  const near=(a,b,message)=>assert.ok(Math.hypot(...a.map((v,i)=>v-b[i]))<1e-6,message);
  try{
    await h.engine.refresh(1);h.engine.setAutoSpin(false);
    await h.finish(h.engine.goTo({type:'file',path:'root.js'}));await advance(3);
    const initial=offset(),radius=Math.hypot(...initial),distance=h.engine.cam.dist;
    h.engine.setAutoSpin(true);
    await advance(90);near(offset(),initial.map(v=>-v),'90秒で星の反対側');
    assert.ok(Math.abs(Math.hypot(...offset())-radius)<1e-6,'星との距離を維持');
    await advance(90);near(offset(),initial,'3分で元の位置');
    assert.equal(h.engine.selected.path,'root.js');assert.equal(h.engine.cam.dist,distance);
    assert.equal(h.state().explorationStatus,'観測中');
    for(const mode of ['off','2d','hidden']){
      if(mode==='off')h.engine.setAutoSpin(false);
      if(mode==='2d')h.engine.setViewMode('2d');
      if(mode==='hidden')h.visibility(true);
      const held={...h.engine.cam};await advance(5);assert.deepEqual(h.engine.cam,held,mode+'中は停止');
      h.engine.setAutoSpin(true);h.engine.setViewMode('3d');h.visibility(false);
    }
    h.canvas.dispatchEvent(event('pointerdown',{pointerId:1,clientX:300,clientY:300}));
    const held={...h.engine.cam};await advance(5);assert.deepEqual(h.engine.cam,held,'押下中は周回しない');
    h.canvas.dispatchEvent(event('pointermove',{pointerId:1,clientX:330,clientY:310}));
    h.canvas.dispatchEvent(event('pointerup',{pointerId:1,clientX:330,clientY:310}));
    await advance(5);const resumed=offset();await advance(1);
    assert.ok(Math.hypot(...offset().map((v,i)=>v-resumed[i]))>0.01,'手動操作後に周回を再開');
    await h.finish(h.engine.goTo({type:'file',path:'src/main.js'}));await advance(3);
    const next=offset();await advance(180);near(offset(),next,'別の星への移動後は新しい星を中心に1周');
    assert.equal(h.engine.selected.path,'src/main.js');
    const pivot={...h.engine.selected};h.engine.interact();h.engine.clear();assert.equal(h.engine.selected,null);
    const beforeClose=cameraPosition(h.engine.cam);await advance(45);
    const afterClose=cameraPosition(h.engine.cam);
    assert.ok(Math.hypot(...['x','y','z'].map(key=>afterClose[key]-beforeClose[key]))>1,'閉じた直後も低速回転する');
    assert.ok(Math.abs(Math.hypot(...['x','y','z'].map(key=>afterClose[key]-pivot[key]))-Math.hypot(...['x','y','z'].map(key=>beforeClose[key]-pivot[key])))<1e-6,'閲覧を閉じても中心星との距離を維持する');
  }finally{h.dispose();}
});

test('待機中の基本表示: 未選択でも中心を180秒で1周し、航行の待機期限と表示停止を守る',async t=>{
  const h=space(t);
  const advance=async seconds=>{for(let n=0;n<seconds*4;n++)await h.pump(250);};
  const eye=()=>Object.values(cameraPosition(h.engine.cam));
  const near=(a,b,message)=>assert.ok(Math.hypot(...a.map((v,i)=>v-b[i]))<1e-6,message);
  try{
    h.engine.setViewMode('2d');await h.engine.refresh(1);h.engine.setViewMode('3d');
    h.engine.interact();const initial=eye(),radius=Math.hypot(...initial);
    assert.equal(h.state().explorationStatus,'周回軌道航行中');
    // ユーザー操作で待機が続いても低速回転自体は止めない。
    for(let n=0;n<4;n++){
      await advance(45);
      assert.equal(h.engine.orbitPhase,'idle');assert.equal(h.engine.orbitPath,null);
      assert.equal(h.engine.selected,null);assert.equal(h.frames.size,1);
      assert.ok(Math.abs(Math.hypot(...eye())-radius)<1e-6,'中心からの距離を維持');
      if(n===1)near(eye(),initial.map(v=>-v),'90秒で中心の反対側');
      h.engine.interact();
    }
    near(eye(),initial,'180秒で元の位置');
    for(const mode of ['off','2d','hidden']){
      if(mode==='off')h.engine.setAutoSpin(false);
      if(mode==='2d')h.engine.setViewMode('2d');
      if(mode==='hidden')h.visibility(true);
      const held={...h.engine.cam};await advance(5);assert.deepEqual(h.engine.cam,held,mode+'中は停止');
      h.engine.setAutoSpin(true);h.engine.setViewMode('3d');h.visibility(false);h.engine.interact();
    }
    await advance(59.75);assert.equal(h.engine.orbitPhase,'idle');
    const before=eye();await advance(.25);assert.equal(h.engine.orbitPhase,'centering','手動待機が明けると通常航行へ移る');
    assert.equal(h.state().explorationStatus,'軌道計算と姿勢制御中');
    near(eye(),before,'航行開始の姿勢合わせで船体位置を飛ばさない');
  }finally{h.dispose();}
});

test('自動探索の表示: 起動・移動・閲覧・手動・再開待ち・軌道航行を実状態から通知する',async t=>{
  let pending;
  const h=space(t,{fetcher:async()=>pending?pending.promise:reply(snapshot())});
  const advance=async seconds=>{for(let n=0;n<seconds*4;n++)await h.pump(250);};
  try{
    await h.engine.refresh(1);assert.equal(h.state().explorationStatus,'出航準備中');
    await advance(10);assert.equal(h.state().explorationStatus,'探索軌道航行中');
    const moving=h.engine.goTo({type:'file',path:'root.js'});await h.pump();
    assert.equal(h.state().explorationStatus,'目的地へ接近中');
    await h.finish(moving);await advance(1);assert.equal(h.state().explorationStatus,'観測中');
    h.canvas.dispatchEvent(event('pointerdown',{pointerId:1,clientX:300,clientY:300}));await h.pump();
    assert.equal(h.state().explorationStatus,'手動操縦中');
    h.canvas.dispatchEvent(event('pointercancel',{pointerId:1,clientX:300,clientY:300}));await advance(1);
    assert.equal(h.state().explorationStatus,'観測中');
    h.engine.interact();h.engine.clear();assert.equal(h.state().explorationStatus,'周回軌道航行中');
    h.engine.setAutoSpin(false);assert.equal(h.state().explorationStatus,'');
    h.engine.setAutoSpin(true);assert.equal(h.state().explorationStatus,'周回軌道航行中');
    const warp=h.engine.goTo({type:'file',path:'src/main.js'});await h.pump();
    assert.equal(h.state().explorationStatus,'目的地へワープ中');await h.finish(warp);
    h.engine.setAutoSpin(true);pending=deferred();const following=h.engine.follow('root.js');await flush();
    assert.equal(h.state().explorationStatus,'航路確認中','更新先を読み直している間は航路確認');
    pending.resolve(reply(snapshot()));pending=null;await h.finish(following);await advance(1);
    assert.equal(h.state().explorationStatus,'観測中');
  }finally{h.dispose();}
});

test('既定3D: オープニングと軌道飛行は維持し、2D中だけ描画・軌道の進行を止める',async t=>{
  const h=space(t);
  try{
    assert.equal(h.engine.viewMode,'3d');assert.equal(h.frames.size,1);
    await h.engine.refresh(1);assert.equal(h.state().autoSpin,true);
    for(let n=0;n<100;n++)await h.pump();
    assert.ok(h.engine.orbitPath?.length>0);assert.equal(h.frames.size,1);
    const camera={...h.engine.cam},world=h.engine.world,path=h.engine.orbitPath,phase=h.engine.orbitPhase;
    h.engine.setViewMode('2d');assert.equal(h.state().driving,true);assert.equal(h.frames.size,0);
    const before=h.metrics();for(let n=0;n<100;n++)await h.pump();
    assert.deepEqual(h.metrics(),before);assert.deepEqual(h.engine.cam,camera);assert.equal(h.engine.world,world);
    assert.equal(h.engine.orbitPath,path);assert.equal(h.engine.orbitPhase,phase);
    h.engine.setViewMode('3d');assert.equal(h.frames.size,1);assert.equal(h.engine.world,world);assert.deepEqual(h.engine.cam,camera);
    await h.pump();assert.equal(h.frames.size,1);assert.ok(h.metrics().layoutCalls>before.layoutCalls);
  }finally{h.dispose();}
});

test('同階層3D→2D→3D: カメラ・同じworld・grep位置・閲覧履歴・マーク・AI軌跡を保持する',async t=>{
  const h=space(t);
  try{
    await h.engine.refresh(1);h.engine.setAutoSpin(false);
    const entry={type:'file',path:'root.js',line:7,column:3,query:'日本語',caseSensitive:true,matchMtime:1000,matchLength:3};
    assert.equal(await h.finish(h.engine.goTo(entry)),true);
    h.engine.marks({mode:'grep',paths:['src/main.js'],since:null});h.engine.route({mode:'ai',paths:['src/main.js']});
    const camera={...h.engine.cam},world=h.engine.world,selected=h.engine.selected,journal=h.state().journal;
    assert.equal(world.galaxies.find(g=>g.name==='src').fresh,1);
    h.engine.setViewMode('2d');assert.equal(h.engine.viewMode,'2d');assert.equal(h.state().viewMode,'2d');
    assert.equal(h.engine.selected,selected);assert.equal(h.state().selected,selected);assert.equal(h.state().journal,journal);
    assert.deepEqual(h.engine.cam,camera);assert.equal(h.engine.world,world);assert.equal(h.timers.size,0);
    h.engine.setViewMode('3d');assert.equal(h.engine.selected,selected);assert.equal(h.engine.world,world);assert.deepEqual(h.engine.cam,camera);
    assert.deepEqual(h.engine.routeState,{mode:'ai',paths:['src/main.js']});assert.equal(h.state().autoSpin,false);
    await h.pump();assert.deepEqual(h.engine.cam,camera);assert.equal(h.frames.size,1);
    h.engine.setViewMode('invalid');assert.equal(h.engine.viewMode,'3d');
  }finally{h.dispose();}
});

test('高速切替とvisibility: 2D/非表示のRAFはゼロ、3D復帰は常に1本、古い予約は復活しない',async t=>{
  const h=space(t);
  try{
    await h.engine.refresh(1);
    for(let n=0;n<30;n++){
      const cancelled=[...h.frames.values()];
      h.engine.setViewMode('2d');h.engine.setViewMode('2d');h.visibility(true);h.visibility(false);h.visibility(false);
      assert.equal(h.frames.size,0);for(const callback of cancelled)callback(100000);assert.equal(h.frames.size,0);
      h.engine.setViewMode('3d');h.engine.setViewMode('3d');h.visibility(false);assert.equal(h.frames.size,1);
      for(const callback of cancelled)callback(100000);assert.equal(h.frames.size,1);
      await h.pump();assert.equal(h.frames.size,1);
    }
    h.visibility(true);h.engine.setViewMode('2d');h.engine.setViewMode('3d');assert.equal(h.frames.size,0);
    h.visibility(false);assert.equal(h.frames.size,1);h.engine.dispose();assert.equal(h.frames.size,0);
    h.visibility(false);h.engine.setViewMode('2d');h.engine.setViewMode('3d');assert.equal(h.frames.size,0);
  }finally{h.dispose();}
});

test('2D: 初回取得・ファイル/フォルダ・親・ルート・戻る進むはワープなしで同じ選択を通知する',async t=>{
  const h=space(t);
  try{
    h.engine.setViewMode('2d');await h.engine.refresh(1);h.engine.setFastWarp(true);
    const camera={...h.engine.cam};
    const run=h.engine.goTo({type:'file',path:'root.js'});
    assert.equal(h.engine.selected.path,'root.js','既知ファイルは待機フレームなしで選択する');assert.equal(await run,true);
    assert.deepEqual(h.engine.cam,camera);
    await h.engine.goTo({type:'dir',path:'src'});assert.deepEqual(h.engine.trail,['src']);assert.equal(h.engine.selected,null);assert.equal(h.location.hash,'#/src');
    await h.engine.approach(h.engine.world.planets[0]);assert.equal(h.engine.selected.path,'src/main.js');
    await h.engine.dive(h.engine.world.galaxies[0]);assert.deepEqual(h.engine.trail,['src','nested']);assert.equal(h.engine.selected,null);
    await h.engine.goTo({type:'file',path:'src/nested/deep.js',line:2,column:4,query:'x',matchMtime:1000});
    assert.equal(h.engine.selected.line,2);const navigationId=h.engine.selected.navigationId;
    await h.engine.goTo({type:'file',path:'src/nested/deep.js',line:9,column:1,query:'y'});
    assert.equal(h.engine.selected.line,9);assert.notEqual(h.engine.selected.navigationId,navigationId);
    await h.engine.ascend(1);assert.deepEqual(h.engine.trail,['src']);assert.equal(h.engine.selected,null);
    await h.engine.ascend(0);assert.deepEqual(h.engine.trail,[]);assert.equal(h.location.hash,'#/');
    const pushes=h.history.length;h.location.hash='#/'+encodeURIComponent('別のフォルダ');h.window.dispatchEvent(new Event('popstate'));
    assert.deepEqual(h.engine.trail,['別のフォルダ']);assert.equal(h.history.length,pushes);
    await h.engine.goTo({type:'file',path:'別のフォルダ/資料.txt'});assert.equal(h.engine.selected.path,'別のフォルダ/資料.txt');
    h.location.hash='#/src';h.window.dispatchEvent(new Event('popstate'));assert.deepEqual(h.engine.trail,['src']);assert.equal(h.engine.selected,null);
    await h.engine.flyHome();assert.deepEqual(h.engine.trail,['src']);assert.equal(h.engine.selected,null);
    assert.equal(h.timers.size,1,'手動猶予後の探索表示復帰だけを単発予約する');await h.pump(60000);
    assert.equal(h.frames.size,0);assert.equal(h.timers.size,0);assert.equal(h.animations.length,0);
  }finally{h.dispose();}
});

test('2Dの寄り道: 訪問済みフォルダの3Dカメラをそれぞれ復元する',async t=>{
  const h=space(t);
  try{
    await h.engine.refresh(1);h.engine.setAutoSpin(false);
    Object.assign(h.engine.cam,{tx:10,ty:-20,tz:30,yaw:1.2,pitch:.25,dist:1500,roll:.1});Object.assign(h.engine.goal,h.engine.cam);
    const rootCamera={...h.engine.cam};h.engine.setViewMode('2d');await h.engine.goTo({type:'dir',path:'src'});
    h.engine.setViewMode('3d');Object.assign(h.engine.cam,{tx:-5,ty:80,tz:60,yaw:-.8,pitch:.6,dist:550,roll:-.2});Object.assign(h.engine.goal,h.engine.cam);
    const srcCamera={...h.engine.cam};h.engine.setViewMode('2d');await h.engine.ascend(0);assert.deepEqual(h.engine.cam,rootCamera);
    h.engine.setViewMode('3d');assert.deepEqual(h.engine.cam,rootCamera);
    h.engine.setViewMode('2d');await h.engine.goTo({type:'dir',path:'src'});h.engine.setViewMode('3d');assert.deepEqual(h.engine.cam,srcCamera);
    assert.equal(h.frames.size,1);assert.equal(h.animations.length,0);
  }finally{h.dispose();}
});

test('2D手動閲覧中: Canvas・3Dキー・自動追跡はカメラ、選択、取得を変更しない',async t=>{
  const h=space(t);
  try{
    await h.engine.refresh(1);h.engine.setViewMode('2d');await h.engine.goTo({type:'file',path:'src/main.js'});
    const selected=h.engine.selected,camera={...h.engine.cam},calls=h.requests.length;
    for(const name of ['pointerdown','pointermove','pointerup','dblclick'])h.canvas.dispatchEvent(event(name,{pointerId:1,clientX:20,clientY:30}));
    const wheel=event('wheel',{ctrlKey:true,deltaY:100});h.canvas.dispatchEvent(wheel);assert.equal(wheel.defaultPrevented,false);
    for(const key of ['Escape','Backspace',' ','r','c'])h.window.dispatchEvent(event('keydown',{key}));
    h.engine.requestFollow(['root.js']);assert.equal(h.engine.canFollow(),false);assert.equal(await h.engine.follow('root.js'),false);
    assert.equal(await h.engine.goTo({type:'file',path:'root.js'},{automatic:true}),false);
    for(let n=0;n<100;n++)await h.pump();
    assert.equal(h.engine.selected,selected);assert.deepEqual(h.engine.trail,['src']);assert.deepEqual(h.engine.cam,camera);
    assert.equal(h.requests.length,calls);assert.equal(h.metrics().captures,0);assert.equal(h.frames.size,0);assert.equal(h.timers.size,0);
    h.window.dispatchEvent(event('keydown',{key:'b',ctrlKey:true}));assert.equal(h.metrics().explorerToggles,1);
  }finally{h.dispose();}
});

for(const phase of ['turn','animation'])for(const action of ['2d','clear','dispose'])test(`3D中断 ${phase}/${action}: 待機タイマーとアニメーションを即時解除し、古い選択を開かない`,async t=>{
  const h=space(t,{holdAnimations:true});
  try{
    await h.engine.refresh(1);h.engine.setAutoSpin(false);
    const navigation=h.engine.goTo({type:'file',path:'src/main.js'});
    if(phase==='turn')assert.equal(h.timers.size,1);
    else {for(let n=0;n<100&&!h.animations.length;n++)await h.pump();assert.equal(h.animations.length,1);}
    if(action==='2d')h.engine.setViewMode('2d');else if(action==='clear')h.engine.clear();else h.engine.dispose();
    assert.equal(h.timers.size,0);assert.equal(h.attributes.get('aria-busy'),'false');
    if(action!=='clear')assert.equal(h.frames.size,0);
    assert.ok(h.animations.every(animation=>animation.cancelled));
    let done=false;navigation.then(()=>{done=true;});await flush();assert.equal(done,true,'中断後にタイマーを進めなくても移動Promiseが完了する');
    assert.notEqual(await navigation,true);assert.equal(h.engine.selected,null);
    for(const animation of h.animations)animation.finish();await flush();assert.equal(h.engine.selected,null);assert.deepEqual(h.engine.trail,[]);
    if(action==='2d'){h.engine.setViewMode('3d');assert.equal(h.frames.size,1);await h.pump();assert.equal(h.timers.size,0);}
  }finally{h.dispose();}
});

test('2D最新/grep: fresh走査で新規階層を開き、grepのメタデータとフィルター外の参照を保持する',async t=>{
  let data=snapshot();const h=space(t,{fetcher:async()=>reply(data)});
  try{
    h.engine.setViewMode('2d');await h.engine.refresh(1);
    data=snapshot(directory('project',['root.js'],[directory('new',[],[directory('deep',['created.js'])])]));
    assert.equal(await h.engine.goTo({type:'file',path:'new/deep/created.js',source:'latest',mtime:2000}),true);
    assert.deepEqual(h.engine.trail,['new','deep']);assert.equal(h.engine.selected.path,'new/deep/created.js');assert.match(h.requests.at(-1).url,/fresh=1/);
    await h.engine.goTo({type:'file',path:'new/deep/created.js',source:'grep',line:5,column:2,query:'needle',caseSensitive:true,matchMtime:1000,matchLength:6});
    await h.engine.refresh();assert.equal(h.engine.selected.line,5);assert.equal(h.engine.selected.matchLength,6);
    const camera={...h.engine.cam};
    assert.equal(await h.engine.goTo({type:'file',path:'ignored/hidden.txt',source:'grep',line:8,column:3,query:'needle',mtime:1000}),true);
    assert.equal(h.engine.selected.unlisted,true);assert.equal(h.engine.selected.path,'ignored/hidden.txt');assert.deepEqual(h.engine.cam,camera);
    await h.engine.refresh();assert.equal(h.engine.selected.line,8);
    assert.equal(h.frames.size,0);assert.equal(h.timers.size,0);assert.equal(h.animations.length,0);
  }finally{h.dispose();}
});

test('2D最新: 古い共有走査は必要時だけ再取得し、新しいクリックだけを採用する',async t=>{
  let calls=0;const pending=deferred();
  const h=space(t,{fetcher:()=>{calls++;return calls===2?pending.promise:Promise.resolve(reply(snapshot(directory('project',calls===1?['root.js']:['root.js','new.js']))));}});
  try{
    h.engine.setViewMode('2d');await h.engine.refresh(1);
    const background=h.engine.refresh(undefined,{fresh:false}),first=h.engine.goTo({type:'file',path:'lost.js',source:'latest'}),latest=h.engine.goTo({type:'file',path:'new.js',source:'latest'});
    assert.equal(calls,2);pending.resolve(reply(snapshot(directory('project',['root.js']))));await background;
    assert.equal(await first,false);assert.equal(await latest,true);assert.equal(calls,3);assert.equal(h.engine.selected.path,'new.js');assert.equal(h.frames.size,0);
  }finally{h.dispose();}
});

for(const action of ['selection','clear','filter','session','mode','dispose'])test(`2D最新の古い応答: ${action}後には選択を取り戻さない`,async t=>{
  let delaying=false;const requests=[];
  const h=space(t,{fetcher:()=>{if(!delaying)return Promise.resolve(reply(snapshot()));const request=deferred();requests.push(request);return request.promise;}});
  try{
    h.engine.setViewMode('2d');await h.engine.refresh(1);delaying=true;
    const first=h.engine.goTo({type:'file',path:'new.js',source:'latest'});assert.equal(requests.length,1);
    let newer;
    if(action==='selection')newer=h.engine.goTo({type:'file',path:'root.js'});
    if(action==='clear')h.engine.clear();
    if(action==='filter')h.engine.setFilter(false);
    if(action==='session')newer=h.engine.refresh(2);
    if(action==='mode')h.engine.setViewMode('3d');
    if(action==='dispose')h.engine.dispose();
    for(const request of requests)request.resolve(reply(snapshot(directory('project',['root.js','new.js']))));
    assert.equal(await first,false);if(newer)await newer;
    assert.notEqual(h.engine.selected?.path,'new.js');if(action==='selection')assert.equal(h.engine.selected.path,'root.js');
    if(action==='filter'||action==='session'||action==='dispose')assert.equal(h.requests[1].signal.aborted,true);
    const flashExpiry=Object.keys(h.engine.updateMarks.flashes).length?1:0;
    assert.equal(h.timers.size,(['clear','filter','session'].includes(action)?1:0)+flashExpiry,'新規ファイルの発光期限と猶予終了の表示復帰だけが残る');assert.equal(h.animations.length,0);assert.equal(h.frames.size,action==='mode'?1:0);
  }finally{h.dispose();}
});

test('2D再走査: 削除ファイルは閉じ、削除・フィルター除外された現在地は存在する親へ戻る',async t=>{
  let data=snapshot();const h=space(t,{fetcher:async()=>reply(data)});
  try{
    h.engine.setViewMode('2d');await h.engine.refresh(1);await h.engine.goTo({type:'file',path:'src/nested/deep.js'});
    data=snapshot(directory('project',['root.js'],[directory('src',[],[directory('nested')])]));await h.engine.refresh();
    assert.equal(h.engine.selected,null);assert.deepEqual(h.engine.trail,['src','nested']);
    data=snapshot(directory('project',['root.js'],[directory('src',['main.js'])]));await h.engine.refresh();
    assert.deepEqual(h.engine.trail,['src']);assert.equal(h.location.hash,'#/src');assert.equal(h.engine.selected,null);
    await h.engine.goTo({type:'file',path:'src/main.js'});
    data=snapshot(directory('project',['root.js']));h.engine.setFilter(false);await flush();
    assert.deepEqual(h.engine.trail,[]);assert.equal(h.location.hash,'#/');assert.equal(h.engine.selected,null);assert.doesNotMatch(h.requests.at(-1).url,/filter=/);
    assert.equal(h.frames.size,0);assert.equal(h.timers.size,1);await h.pump(60000);assert.equal(h.timers.size,0);
    data=snapshot(directory('project',['later.js']));await h.engine.refresh();await h.engine.goTo({type:'file',path:'later.js'});
    data=snapshot(directory('project'),{truncated:true});await h.engine.refresh();assert.equal(h.engine.selected.path,'later.js');
    data=snapshot(directory('project'));await h.engine.refresh();assert.equal(h.engine.selected,null);
  }finally{h.dispose();}
});


test('2D自動探索: 更新通知から親ページと共有ビューアを開き、待機中のRAF・タイマー・ポーリングはゼロ',async t=>{
  let data=snapshot();const h=space(t,{fetcher:async()=>reply(data)});
  try{
    h.engine.setViewMode('2d');await h.engine.refresh(1);
    data=snapshot(directory('project',['root.js'],[directory('generated',[],[directory('deep',['new.js'])])]));
    h.engine.requestFollow(['generated/deep/new.js']);await flush();
    assert.deepEqual(h.engine.trail,['generated','deep']);assert.equal(h.engine.selected.path,'generated/deep/new.js');
    assert.equal(h.state().driving,true);assert.match(h.requests.at(-1).url,/fresh=1/);
    assert.equal(h.frames.size,0);assert.equal(h.timers.size,0);assert.equal(h.animations.length,0);
    const calls=h.requests.length;await h.pump(600000);assert.equal(h.requests.length,calls);
    h.engine.requestFollow('root.js');await flush();assert.equal(h.engine.selected.path,'root.js');assert.deepEqual(h.engine.trail,[]);
    assert.equal(h.timers.size,0);assert.equal(h.frames.size,0);
    h.engine.clear();await flush();assert.equal(h.engine.selected,null);assert.equal(h.state().driving,true);assert.equal(h.timers.size,0);
    await h.pump(600000);assert.equal(h.engine.selected,null,'閉じた同じ最終更新は勝手に開き直さない');
  }finally{h.dispose();}
});

test('2D自動探索: 手動フォルダ移動の1分猶予だけ単発予約し、新しい更新で予約を置き換える',async t=>{
  const h=space(t);
  try{
    h.engine.setViewMode('2d');await h.engine.refresh(1);await h.engine.goTo({type:'dir',path:'src'});
    h.engine.requestFollow(['root.js']);assert.equal(h.timers.size,1);const oldTimer=[...h.timers.keys()][0];
    assert.equal([...h.timers.values()][0].ms,60000);const calls=h.requests.length;
    await h.pump(59999);assert.equal(h.engine.selected,null);assert.equal(h.requests.length,calls);assert.equal(h.timers.size,1);
    h.engine.requestFollow(['src/nested/deep.js']);assert.equal(h.timers.size,1);assert.equal(h.timers.has(oldTimer),false);
    assert.equal([...h.timers.values()][0].ms,1);await h.pump(1);
    assert.equal(h.engine.selected.path,'src/nested/deep.js');assert.deepEqual(h.engine.trail,['src','nested']);
    assert.ok(h.state().journal.some(value=>value.path==='root.js'),'移動しなかった先行更新の軌跡も残す');
    assert.equal(h.frames.size,0);assert.equal(h.timers.size,0);assert.equal(h.animations.length,0);
    const completedCalls=h.requests.length;await h.pump(600000);assert.equal(h.requests.length,completedCalls);
  }finally{h.dispose();}
});

test('2D自動探索: ユーザーのプレビューを保護し、閉じた後も残りの手動猶予を守る',async t=>{
  const h=space(t);
  try{
    h.engine.setViewMode('2d');await h.engine.refresh(1);await h.engine.goTo({type:'file',path:'src/main.js',line:4,column:2,query:'x'});
    h.engine.requestFollow('root.js');assert.equal(h.timers.size,0);const calls=h.requests.length;
    await h.pump(10000);assert.equal(h.engine.selected.path,'src/main.js');assert.equal(h.engine.selected.line,4);assert.equal(h.requests.length,calls);
    h.engine.clear();assert.equal(h.timers.size,1);assert.equal([...h.timers.values()][0].ms,50000);
    await h.pump(49999);assert.equal(h.engine.selected,null);await h.pump(1);assert.equal(h.engine.selected.path,'root.js');
    await h.engine.goTo({type:'file',path:'src/main.js'});h.engine.requestFollow('src/nested/deep.js');
    await h.pump(120000);assert.equal(h.engine.selected.path,'src/main.js');assert.equal(h.timers.size,0);
    h.engine.setAutoSpin(false);h.engine.setAutoSpin(true);await flush();assert.equal(h.engine.selected.path,'src/main.js');
    h.engine.clear();await flush();assert.equal(h.engine.selected.path,'src/nested/deep.js');assert.equal(h.frames.size,0);
  }finally{h.dispose();}
});

test('2D自動探索OFF: 予約と実行を止め、手動Latestは引き続き開き、ON時は保護条件を守って再開する',async t=>{
  const h=space(t);
  try{
    h.engine.setViewMode('2d');await h.engine.refresh(1);await h.engine.goTo({type:'dir',path:'src'});
    h.engine.requestFollow('src/nested/deep.js');assert.equal(h.timers.size,1);
    h.engine.setAutoSpin(false);assert.equal(h.timers.size,0);const calls=h.requests.length;
    await h.pump(120000);assert.equal(h.engine.selected,null);assert.equal(h.requests.length,calls);
    await h.engine.goTo({type:'file',path:'root.js',source:'latest'});assert.equal(h.engine.selected.path,'root.js');assert.equal(h.state().autoSpin,false);
    h.engine.setAutoSpin(true);await flush();assert.equal(h.engine.selected.path,'root.js','ONにしてもユーザーが開いたファイルを奪わない');
    h.engine.clear();await flush();assert.equal(h.engine.selected.path,'src/nested/deep.js');
    assert.equal(h.frames.size,0);assert.equal(h.timers.size,0);assert.equal(h.animations.length,0);
  }finally{h.dispose();}
});

test('2D自動探索: 初回走査前の予約と非表示中の更新を、表示復帰時に一度だけ進める',async t=>{
  const h=space(t);
  try{
    h.engine.setViewMode('2d');h.engine.requestFollow('src/main.js');assert.equal(h.requests.length,0);assert.equal(h.timers.size,0);
    await h.engine.refresh(1);await flush();assert.equal(h.engine.selected.path,'src/main.js');
    h.visibility(true);h.engine.requestFollow('src/nested/deep.js');const calls=h.requests.length;
    await h.pump(120000);assert.equal(h.engine.selected.path,'src/main.js');assert.equal(h.requests.length,calls);assert.equal(h.timers.size,0);
    h.visibility(false);h.visibility(false);await flush();assert.equal(h.engine.selected.path,'src/nested/deep.js');
    assert.equal(h.requests.length,calls+1);assert.equal(h.frames.size,0);assert.equal(h.timers.size,0);
  }finally{h.dispose();}
});

test('2D自動探索: 進行中の古い一覧へ合流しても新規ファイルを再確認し、連続通知では最後だけ開く',async t=>{
  const stale=deferred();let calls=0;
  const h=space(t,{fetcher:()=>{
    calls++;
    if(calls===2)return stale.promise;
    return Promise.resolve(reply(calls===1?snapshot():snapshot(directory('project',['root.js'],[directory('new',['latest.js'])]))));
  }});
  try{
    h.engine.setViewMode('2d');await h.engine.refresh(1);
    h.engine.requestFollow('src/main.js');await flush();assert.equal(calls,2);
    h.engine.requestFollow('new/latest.js');await flush();assert.equal(calls,2,'同時走査を増やさない');
    stale.resolve(reply(snapshot()));await flush();
    assert.equal(calls,3);assert.equal(h.engine.selected.path,'new/latest.js');assert.deepEqual(h.engine.trail,['new']);
    assert.equal(h.changes.some(value=>value.selected?.path==='src/main.js'),false);assert.equal(h.frames.size,0);assert.equal(h.timers.size,0);
  }finally{h.dispose();}
});

for(const action of ['mode','off','manual','filter','session','dispose'])test(`2D自動探索の遅い応答: ${action}で古い航行を中断し、モード変更だけは再検証して続ける`,async t=>{
  const pending=deferred();let calls=0;
  const h=space(t,{fetcher:()=>++calls===2?pending.promise:Promise.resolve(reply(snapshot()))});
  try{
    h.engine.setViewMode('2d');await h.engine.refresh(1);h.engine.requestFollow('src/nested/deep.js');await flush();assert.equal(calls,2);
    if(action==='mode')h.engine.setViewMode('3d');
    if(action==='off')h.engine.setAutoSpin(false);
    if(action==='manual')await h.engine.goTo({type:'file',path:'root.js'});
    if(action==='filter')h.engine.setFilter(false);
    if(action==='session')await h.engine.refresh(2);
    if(action==='dispose')h.engine.dispose();
    pending.resolve(reply(snapshot()));await flush();
    assert.notEqual(h.engine.selected?.path,'src/nested/deep.js');assert.deepEqual(h.engine.trail,[]);
    assert.equal(h.frames.size,action==='mode'?1:0);assert.equal(h.timers.size,0);assert.equal(h.animations.length,0);
    if(action==='mode'){const before=calls;await h.pump();assert.ok(calls>before,'新モードの走査で更新先を再検証する');for(let n=0;n<160&&h.engine.selected?.path!=='src/nested/deep.js';n++)await h.pump();assert.equal(h.engine.selected?.path,'src/nested/deep.js');assert.equal(h.timers.size,0);}
    if(action==='off'){h.engine.setAutoSpin(true);await flush();assert.equal(h.engine.selected.path,'src/nested/deep.js');}
    if(action==='manual')assert.equal(h.engine.selected.path,'root.js');
  }finally{h.dispose();}
});

for(const action of ['mode','off','dispose'])test(`2D自動探索の猶予タイマー: ${action}で即時解除し、古いコールバックを再利用しない`,async t=>{
  const h=space(t);
  try{
    h.engine.setViewMode('2d');await h.engine.refresh(1);await h.engine.goTo({type:'dir',path:'src'});h.engine.requestFollow('root.js');
    assert.equal(h.timers.size,1);const cancelled=[...h.timers.values()][0].callback,calls=h.requests.length;
    if(action==='mode')h.engine.setViewMode('3d');
    if(action==='off')h.engine.setAutoSpin(false);
    if(action==='dispose')h.engine.dispose();
    assert.equal(h.timers.size,0);cancelled();await flush();assert.equal(h.requests.length,calls);assert.equal(h.engine.selected,null);
    assert.equal(h.frames.size,action==='mode'?1:0);assert.equal(h.animations.length,0);
  }finally{h.dispose();}
});

test('2D自動探索の失敗: 欠落パスを無限再試行せず、後続の新しい更新通知で再開する',async t=>{
  const h=space(t);
  try{
    h.engine.setViewMode('2d');await h.engine.refresh(1);h.engine.requestFollow('missing.js');await flush();
    assert.equal(h.engine.selected,null);assert.equal(h.timers.size,0);const calls=h.requests.length;
    await h.pump(600000);assert.equal(h.requests.length,calls);assert.equal(h.frames.size,0);
    h.engine.requestFollow('src/main.js');await flush();assert.equal(h.engine.selected.path,'src/main.js');assert.equal(h.timers.size,0);
  }finally{h.dispose();}
});

test('3D自動探索の互換性: 最終更新通知は従来の旋回・ワープで開き、描画ループは1本のまま',async t=>{
  const h=space(t);
  try{
    await h.engine.refresh(1);for(let n=0;n<25;n++)await h.pump();
    h.engine.requestFollow('src/nested/deep.js');
    for(let n=0;n<160&&h.engine.selected?.path!=='src/nested/deep.js';n++)await h.pump();
    assert.equal(h.engine.selected?.path,'src/nested/deep.js');assert.deepEqual(h.engine.trail,['src','nested']);
    assert.ok(h.animations.length>=4);assert.equal(h.frames.size,1);assert.equal(h.timers.size,0);
    assert.equal(h.engine.viewMode,'3d');assert.equal(h.state().autoSpin,true);
  }finally{h.dispose();}
});


test('grepの一覧外ファイル: 2Dは既知の親ページへ移動し、3Dは既存の現在地・カメラを維持する',async t=>{
  for(const mode of ['2d','3d']){
    const h=space(t);
    try{
      h.engine.setViewMode(mode);await h.engine.refresh(1);const camera={...h.engine.cam};
      await h.engine.goTo({type:'file',path:'src/filtered-out.txt',source:'grep',line:8,column:2,query:'needle',matchMtime:1000});
      assert.equal(h.engine.selected.path,'src/filtered-out.txt');assert.equal(h.engine.selected.unlisted,true);assert.equal(h.engine.selected.line,8);
      assert.deepEqual(h.engine.trail,mode==='2d'?['src']:[]);
      if(mode==='3d')assert.deepEqual(h.engine.cam,camera);
      else assert.equal(h.frames.size,0);
      assert.equal(h.animations.length,0);assert.equal(h.timers.size,0);
    }finally{h.dispose();}
  }
});


test('2Dの一覧外AI/履歴/フォルダ: フィルターを勝手に変えず、OFFまたは更新の案内を出す',async t=>{
  const h=space(t);
  try{
    h.engine.setViewMode('2d');await h.engine.refresh(1);
    for(const entry of [{type:'file',path:'ignored/result.js',source:'ai'},{type:'file',path:'deleted/old.js'},{type:'dir',path:'ignored'}]){
      assert.equal(await h.engine.goTo(entry),false);assert.deepEqual(h.engine.trail,[]);assert.equal(h.engine.selected,null);
      const note=h.changes.filter(value=>value.error).at(-1).error;
      assert.match(note,/フィルターをOFF/);assert.match(note,/一覧を更新/);assert.match(h.requests.at(-1).url,/filter=backup/);
    }
    assert.equal(h.timers.size,1);const calls=h.requests.length;await h.pump(60000);assert.equal(h.requests.length,calls);
    assert.equal(h.frames.size,0);assert.equal(h.timers.size,0);assert.equal(h.animations.length,0);
  }finally{h.dispose();}
});


test('3Dの直接follow API: frameの自動条件を二重適用せず、従来どおり明示されたファイルへ移動する',async t=>{
  const h=space(t);
  try{
    await h.engine.refresh(1);h.engine.setAutoSpin(false);
    await h.finish(h.engine.goTo({type:'file',path:'root.js'}));h.engine.setAutoSpin(true);
    assert.equal(h.engine.canFollow(),false,'手動プレビュー中なのでframeの自動追跡は停止');
    assert.equal(await h.finish(h.engine.follow('src/main.js')),true);
    assert.equal(h.engine.selected.path,'src/main.js');assert.deepEqual(h.engine.trail,['src']);
    assert.ok(h.animations.length>=2);assert.equal(h.frames.size,1);assert.equal(h.timers.size,0);
  }finally{h.dispose();}
});

test('2D自動探索表示: 3Dと同じ開始・手動待機・OFF・非表示条件で枠を回し、待機解除は単発だけ', async t=>{
  const h=space(t);
  try {
    h.engine.setViewMode('2d');await h.engine.refresh(1);
    assert.equal(h.state().driving,true,'対象通知を待つ間も自動探索中を示す');
    assert.equal(h.frames.size,0);assert.equal(h.timers.size,0);
    await h.engine.goTo({type:'dir',path:'src'});assert.equal(h.state().driving,false);assert.equal(h.timers.size,1);
    await h.pump(59999);assert.equal(h.state().driving,false);await h.pump(1);assert.equal(h.state().driving,true);
    assert.equal(h.timers.size,0);assert.equal(h.frames.size,0);
    h.engine.interact();assert.equal(h.state().driving,false);assert.equal(h.timers.size,1);
    h.engine.setAutoSpin(false);assert.equal(h.state().driving,false);assert.equal(h.timers.size,0);
    h.engine.setAutoSpin(true);assert.equal(h.state().driving,true);assert.equal(h.timers.size,0);
    h.visibility(true);assert.equal(h.state().driving,false);h.visibility(false);assert.equal(h.state().driving,true);
    await h.engine.goTo({type:'file',path:'root.js'});await h.pump(60000);assert.equal(h.state().driving,false);assert.equal(h.timers.size,0);
    h.engine.clear();assert.equal(h.state().driving,true);assert.equal(h.frames.size,0);
    h.engine.dispose();assert.equal(h.timers.size,0);
  } finally {h.dispose();}
});


test('2D監視スナップショット: 対象フォルダだけ更新し選択保持、古い条件・OFF・3Dを拒否',async t=>{
 const h=space(t);
 try {
  h.engine.setViewMode('2d');await h.engine.refresh(1);await h.engine.goTo({type:'file',path:'src/main.js'});
  const context={path:'src',filter:'backup'}, tree=directory('src',['main.js','new.js']);
  assert.equal(h.engine.applyFolderSnapshot(context,{tree,truncated:false}),true);
  assert.equal(h.engine.selected.path,'src/main.js');assert.equal(h.state().scan.tree.f[0][0],'root.js');
  assert.deepEqual(h.state().scan.tree.d.find(d=>d.n==='src').f.map(f=>f[0]),['main.js','new.js']);
  assert.equal(h.engine.applyFolderSnapshot({...context,path:''},{tree}),false);
  assert.equal(h.engine.applyFolderSnapshot(context,{tree,truncated:true}),false);
  h.engine.setAutoSpin(false);assert.equal(h.engine.applyFolderSnapshot(context,{tree}),false);
  h.engine.setAutoSpin(true);h.engine.setViewMode('3d');assert.equal(h.engine.applyFolderSnapshot(context,{tree}),false);
  h.engine.setViewMode('2d');assert.equal(h.engine.applyFolderSnapshot(context,{tree:directory('src',[])}),false);
  await flush();assert.equal(h.engine.selected.path,'src/main.js','監視一覧の欠落だけでは解除せず全体走査で再確認する');
 }finally{h.dispose();}
});

for(const mode of ['2d','3d'])for(const removed of [false,true])test(`${mode}更新: 選択ファイルの一時欠落を公開せず、再走査後の${removed?'削除だけを解除':'存在で選択を保持'}する`,async t=>{
 let pending,confirming,requests=0;
 const h=space(t,{fetcher:()=>pending?++requests===1?pending.promise:confirming.promise:reply(snapshot())});
 try{
  h.engine.setViewMode(mode);await h.engine.refresh(1);h.engine.setAutoSpin(false);
  await h.finish(h.engine.goTo({type:'file',path:'src/main.js',line:3,column:2,query:'日本語'}));
  const before=h.engine.selected,changed=h.changes.length;
  pending=deferred();confirming=deferred();const updating=h.engine.refresh(undefined,{fresh:false});
  assert.equal(h.engine.selected,before);
  pending.resolve(reply(snapshot(directory('project',['root.js'],[directory('src')]))));await flush();
  assert.equal(requests,2);assert.match(h.requests.at(-1).url,/fresh=1/);
  assert.equal(h.engine.selected,before,'再確認中も選択と検索位置を保持');
  assert.ok(h.changes.slice(changed).filter(value=>'scan'in value).every(value=>value.selected?.path==='src/main.js'));
  confirming.resolve(reply(removed?snapshot(directory('project',['root.js'],[directory('src')])):snapshot()));
  assert.equal(await updating,true);
  if(removed)assert.equal(h.engine.selected,null);
  else {assert.equal(h.engine.selected.path,'src/main.js');assert.equal(h.engine.selected.line,3);assert.equal(h.engine.selected.column,2);assert.equal(h.engine.selected.query,'日本語');}
 }finally{h.dispose();}
});

for(const action of ['select','clear','failure'])test(`更新の再確認待ち: ${action}を古い選択の復元で上書きしない`,async t=>{
 let calls=0,checking=false,confirmation=deferred();
 const h=space(t,{fetcher:()=>!checking?reply(snapshot()):++calls===1?reply(snapshot(directory('project',['root.js'],[directory('src')]))):confirmation.promise});
 try{
  h.engine.setViewMode('2d');await h.engine.refresh(1);h.engine.setAutoSpin(false);await h.engine.goTo({type:'file',path:'src/main.js'});
  checking=true;const updating=h.engine.refresh();await flush();assert.equal(calls,2);
  if(action==='select')await h.engine.goTo({type:'file',path:'root.js'});
  if(action==='clear')h.engine.clear();
  if(action==='failure')confirmation.reject(Error('確認失敗'));else confirmation.resolve(reply(snapshot()));
  assert.equal(await updating,action!=='failure');
  assert.equal(h.engine.selected?.path,action==='select'?'root.js':action==='failure'?'src/main.js':undefined);
 }finally{h.dispose();}
});

test('更新が走査上限に達して現在フォルダを含まない場合は閲覧と階層を保持する',async t=>{
 let data=snapshot();const h=space(t,{fetcher:async()=>reply(data)});
 try{
  h.engine.setViewMode('2d');await h.engine.refresh(1);await h.engine.goTo({type:'file',path:'src/nested/deep.js'});
  data=snapshot(directory('project'),{truncated:true});assert.equal(await h.engine.refresh(),false);
  assert.equal(h.engine.selected.path,'src/nested/deep.js');assert.deepEqual(h.engine.trail,['src','nested']);
 }finally{h.dispose();}
});

test('複数チェックによる停止: 取得中の結果と監視を捨て、解除まで再取得・自動追跡しない',async t=>{
 let pending;const h=space(t,{fetcher:()=>pending?pending.promise:reply(snapshot())});
 try{
  h.engine.setViewMode('2d');await h.engine.refresh(1);await h.engine.goTo({type:'file',path:'src/main.js'});
  pending=deferred();const updating=h.engine.refresh();h.engine.setRefreshPaused(true);
  assert.equal(h.requests.at(-1).signal.aborted,true);
  const before=h.requests.length,scan=h.state().scan;
  assert.equal(await h.engine.refresh(),false);assert.equal(await h.engine.follow('root.js'),false);
  assert.equal(h.engine.applyFolderSnapshot({path:'src',filter:'backup'},{tree:directory('src',['new.js'])}),false);
  pending.resolve(reply(snapshot(directory('project',['new.js']))));assert.equal(await updating,false);
  assert.equal(h.state().scan,scan);assert.equal(h.engine.selected.path,'src/main.js');assert.equal(h.requests.length,before);
  pending=null;h.engine.setRefreshPaused(false);assert.equal(await h.engine.refresh(),true);
 }finally{h.dispose();}
});
