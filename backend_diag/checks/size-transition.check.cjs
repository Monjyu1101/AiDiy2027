// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {画面サイズ演出を作成}=require('../起動/サイズ切替.cjs');
function fixture({offset={x:0,y:0}}={}){
 const windows=[],scripts=[],calls=[];
 const window={bounds:{x:-120,y:40,width:800,height:600},opacity:1,isDestroyed(){return !!this.destroyed;},isVisible:()=>true,isMinimized:()=>false,isAlwaysOnTop:()=>false,getOpacity(){return this.opacity;},setOpacity(value){this.opacity=value;calls.push(value);},moveAbove(id){this.above=id;},getBounds(){return {...this.bounds};},getNormalBounds(){return {...this.bounds};},setBounds(value){this.bounds={...value};this.resizes=(this.resizes||0)+1;},setMinimumSize(){},setMaximizable(){},setResizable(){},unmaximize(){this.maximized=false;},isMaximized(){return !!this.maximized;},getContentBounds(){return {...this.bounds};},webContents:{executeJavaScript:async()=>{},capturePage:async()=>({isEmpty:()=>false,toDataURL:()=> 'data:image/png;base64,fixture'})}};
 class Canvas{
  constructor(options){this.options=options;windows.push(this);this.webContents={executeJavaScript:async script=>scripts.push(script)};}
  setOpacity(value){this.opacity=value;}getMediaSourceId(){return 'window:overlay:0';}setAlwaysOnTop(){}
  setBounds(value){this.bounds={...value,x:value.x+offset.x,y:value.y+offset.y};}getContentBounds(){return {...this.bounds};}async loadURL(url){this.html=decodeURIComponent(url.split(',')[1]);}showInactive(){this.shown=true;}isDestroyed(){return !!this.dead;}destroy(){this.dead=true;}
 }
 return {window,windows,scripts,calls,effect:画面サイズ演出を作成(Canvas,window)};
}
test('縮小・拡大は元画面と完成画面の画像を使い、実窓の連続リサイズを行わない',async()=>{
 const f=fixture(),mini={x:-121,y:40,width:384,height:184};
 for(const target of [mini,{x:-120,y:40,width:800,height:600}]){
  assert.equal(await f.effect.準備(target),true);assert.equal(f.window.opacity,0);
  const canvas=f.windows.at(-1);assert.equal(canvas.options.transparent,true);assert.equal(canvas.options.alwaysOnTop,false);assert.equal(canvas.shown,true);
  assert.ok(canvas.bounds.width>=800);assert.ok(canvas.bounds.height>=600);assert.match(canvas.html,/transform-origin:0 0/);
  f.window.bounds=target;assert.equal(await f.effect.完了(),true);assert.equal(f.window.opacity,1);assert.equal(f.effect.active,false);assert.equal(canvas.dead,true);
 }
 assert.ok(f.scripts.some(script=>script.includes('scale(0.48,0.30666666666666664)')));
 assert.ok(f.scripts.some(script=>script.includes('scale(2.0833333333333335,3.260869565217391)')));
 assert.ok(f.scripts.some(script=>script.includes('duration:380')));
});
test('撮影失敗・中止・破棄でも透明な実窓や演出窓を残さない',async()=>{
 for(const mode of ['capture','cancel','destroy']){
  const f=fixture();
  if(mode==='capture')f.window.webContents.capturePage=async()=>{throw Error('capture failed');};
  assert.equal(await f.effect.準備({x:0,y:0,width:384,height:360}),true);
  if(mode==='cancel')f.effect.中止();
  if(mode==='destroy'){f.window.destroyed=true;f.effect.中止();}
  await f.effect.完了();assert.equal(f.effect.active,false);assert.ok(f.windows.every(canvas=>canvas.dead));
  if(mode!=='destroy')assert.equal(f.window.opacity,1);
 }
});
test('非表示の初期窓には切替演出を重ねず、ピンONは同じ層を継承する',async()=>{
 const f=fixture();f.window.isVisible=()=>false;await f.effect.準備({...f.window.bounds,x:f.window.bounds.x-1});assert.equal(f.windows.length,0);assert.equal(f.window.opacity,1);
 f.window.isVisible=()=>true;f.window.isAlwaysOnTop=()=>true;await f.effect.準備({...f.window.bounds,x:f.window.bounds.x-1});assert.equal(f.windows[0].options.alwaysOnTop,true);f.effect.中止();
});
test('撮影待ちに再読込・中止された切替を後から適用しない',async()=>{
 for(const rejected of [false,true]){
  const f=fixture();let resolve,reject;
  f.window.webContents.capturePage=()=>new Promise((yes,no)=>{resolve=yes;reject=no;});
  const preparing=f.effect.準備({...f.window.bounds,x:f.window.bounds.x-1});f.effect.中止();
  if(rejected)reject(Error('late capture failure'));else resolve({isEmpty:()=>false});
  assert.equal(await preparing,false);assert.equal(f.window.opacity,1);assert.equal(f.windows.length,0);
 }
});
test('UIはミニ描画後に演出完了を通知し、完了までは切替中を保つ',async()=>{
 const {起動ミニ表示を作成}=await import('../ui/src/components/ウィンドウ/起動ミニ表示.mjs');
 const calls=[];let release;
 const state=起動ミニ表示を作成({利用可能:()=>true,切替:async value=>{calls.push(value);return true;},反映:()=>{calls.push(state.表示中.value?'mini-ready':'normal-ready');return new Promise(resolve=>release=resolve);}});
 const pending=state.変更(true);await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(calls,[true,'mini-ready']);assert.equal(state.表示中.value,true);assert.equal(state.切替中.value,true);
 // 演出中に接続が切れた場合も、演出を終えてから最後に要求された通常表示へ戻す。
 state.変更(false);release(true);await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(calls,[true,'mini-ready',false,'normal-ready']);assert.equal(state.切替中.value,true);
 release(true);await pending;assert.equal(state.表示中.value,false);assert.equal(state.切替中.value,false);
});

test('旧画像のdecode後に演出窓を表示し、相補合成で途中の背景抜けを作らない',async()=>{
 const f=fixture();await f.effect.準備({x:-121,y:40,width:384,height:184});
 const canvas=f.windows[0];
 assert.equal(f.scripts[0],"document.querySelector('#old').decode()");
 assert.match(canvas.html,/isolation:isolate/);
 assert.match(canvas.html,/mix-blend-mode:plus-lighter/);
 f.window.bounds={x:-120,y:40,width:384,height:184};await f.effect.完了();
 const animation=f.scripts.find(script=>script.includes('const motion='));
 const frames={},elements=Object.fromEntries(['image','next','old'].map(id=>[id,{
  decode:async()=>{},animate(keyframes,options){frames[id]={keyframes,options};return {finished:Promise.resolve()};},
 }]));
 await vm.runInNewContext(animation,{document:{querySelector:selector=>elements[selector.slice(1)]}});
 assert.deepEqual(Array.from(frames.next.keyframes,x=>x.opacity),[0,1]);
 assert.deepEqual(Array.from(frames.old.keyframes,x=>x.opacity),[1,0]);
 assert.equal(frames.next.options,frames.old.options);
 assert.equal(frames.next.options,frames.image.options);
 // 加算合成では両方不透明な画素が途中で暗くならず、アイコンの透明画素は滑らかに消える。
 for(const progress of [0,.1,.2,.5,.8,1]){
  const old=1-progress,next=progress;
  assert.equal(old+next,1);
  assert.equal(old+next*0,1-progress);
 }
});
test('旧画像decode中の中止で遅れて実窓を透明化しない',async()=>{
 const f=fixture();let release;
 // captureの後で作成される演出窓のdecodeだけを保留する。
 const prepare=f.effect.準備({...f.window.bounds,x:f.window.bounds.x-1});
 await Promise.resolve();
 const canvas=f.windows[0];
 canvas.webContents.executeJavaScript=()=>new Promise(resolve=>release=resolve);
 await new Promise(resolve=>setImmediate(resolve));
 f.effect.中止();release();
 assert.equal(await prepare,false);assert.equal(f.window.opacity,1);assert.equal(canvas.dead,true);
});

test('透明化後の描画を待つまでnativeサイズ変更へ進めず、中止後も遅延変更しない',async()=>{
 for(const cancel of [false,true]){
  const f=fixture();let release,completed=false;
  const preparing=f.effect.準備({...f.window.bounds,x:f.window.bounds.x-1}).then(ready=>{completed=true;return ready;});
  await Promise.resolve();
  f.windows[0].webContents.executeJavaScript=async script=>{
   f.scripts.push(script);
   if(f.window.opacity===0)await new Promise(resolve=>release=resolve);
  };
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.window.opacity,0);assert.equal(typeof release,'function');assert.equal(completed,false);
  if(cancel)f.effect.中止();
  release();assert.equal(await preparing,!cancel);
  f.effect.中止();assert.equal(f.window.opacity,1);assert.ok(f.windows.every(canvas=>canvas.dead));
 }
});

test('演出窓のDPI補正後の実座標から画像を配置し、表示開始時に左肩が跳ねない',async()=>{
 const f=fixture({offset:{x:1,y:-1}}),target={x:0,y:0,width:1920,height:1080};
 await f.effect.準備(target);
 const canvas=f.windows[0],origin=canvas.getContentBounds();
 assert.match(canvas.html,new RegExp(`transform:translate\\(${f.window.bounds.x-origin.x}px,${f.window.bounds.y-origin.y}px\\)`));
 f.window.bounds=target;await f.effect.完了();
 const animation=f.scripts.find(script=>script.includes('const motion='));
 const finalOrigin=canvas.getContentBounds();
 assert.ok(animation.includes(`translate(${target.x-finalOrigin.x}px,${target.y-finalOrigin.y}px)`));
 assert.ok(animation.includes(`translate(${-120-finalOrigin.x}px,${40-finalOrigin.y}px)`));
});

test('内包される縮小も別窓で演出し、実画面のCSPに抵触するDOMを注入しない',async()=>{
 const f=fixture(),from={...f.window.bounds},mainScripts=[];
 f.window.webContents.executeJavaScript=async script=>{mainScripts.push(script);};
 await f.effect.準備({...from,width:384,height:360});
 assert.equal(f.windows.length,1);assert.equal(f.window.opacity,0);
 assert.equal(f.effect.window,f.window);
 f.effect.window.setBounds({...from,width:384,height:186});
 await f.effect.完了();
 assert.equal(f.window.bounds.height,186);assert.equal(f.window.opacity,1);
 assert.ok(f.scripts.some(script=>script.includes('scale(0.48,0.31)')));
 assert.ok(mainScripts.every(script=>!/(data:image|createElement|aidiy-size-|style)/.test(script)));
 assert.equal(f.windows[0].dead,true);
});
test('通常・ミニ・長い名称のアイコン化の全方向で最終寸法へ演出する',async()=>{
 const forms=[{width:800,height:600},{width:384,height:186},{width:128,height:240}];
 for(const from of forms)for(const to of forms){
  if(from===to)continue;
  const f=fixture();Object.assign(f.window.bounds,from);
  const target={...f.window.bounds,...to};await f.effect.準備(target);
  f.effect.window.setBounds(target);await f.effect.完了();
  assert.ok(f.scripts.some(script=>script.includes(`scale(${to.width/from.width},${to.height/from.height})`)));
  assert.deepEqual(f.window.bounds,target);assert.equal(f.window.opacity,1);assert.equal(f.windows[0].dead,true);
 }
});
test('最大化解除は覆った実窓へ適用し、通常寸法を完成画像に使う',async()=>{
 const f=fixture(),target={x:0,y:80,width:400,height:300};f.window.maximized=true;
 await f.effect.準備(target);assert.equal(f.window.opacity,0);
 f.effect.window.unmaximize();f.effect.window.setBounds(target);
 await f.effect.完了();assert.equal(f.window.maximized,false);assert.deepEqual(f.window.bounds,target);
 assert.equal(f.window.opacity,1);assert.equal(f.windows[0].dead,true);
});
test('拡大用窓は透明状態で背面へ配置してから表示し、focusやshowで実窓を奪わない',async()=>{
 const f=fixture(),events=[];
 f.window.moveAbove=id=>{events.push(['above',id]);assert.equal(f.windows[0].opacity,0);assert.equal(f.windows[0].shown,true);};
 await f.effect.準備({x:-120,y:40,width:1920,height:1080});
 assert.deepEqual(events,[['above','window:overlay:0']]);assert.equal(f.windows[0].opacity,1);assert.equal(f.window.opacity,0);
 f.effect.中止();assert.equal(f.window.opacity,1);
});

test('遅いラベル測定を撮影前に反映し、予定範囲外でも完成画像を切り取らない',async()=>{
 const f=fixture();f.window.bounds={x:20,y:40,width:384,height:186};
 await f.effect.準備({x:20,y:40,width:128,height:128});
 f.window.setBounds({x:20,y:40,width:128,height:128});let captured;
 f.window.webContents.capturePage=async()=>{captured={...f.window.bounds};return {isEmpty:()=>false,toDataURL:()=> 'data:image/png;base64,next'};};
 await f.effect.完了({beforeCapture:()=>f.window.setBounds({x:20,y:10,width:128,height:700})});
 assert.equal(captured.height,700);const area=f.windows[0].getContentBounds();
 assert.ok(area.y<=10&&area.y+area.height>=710);
 assert.ok(f.scripts.some(s=>s.includes('translate(0px,30px)')));
 assert.ok(f.scripts.some(s=>s.includes('scale(0.3333333333333333,3.763440860215054)')));
});
test('完成撮影・decode・アニメーションの失敗でも表示を復元する',async()=>{
 for(const mode of ['capture','empty','decode','animate']){
  const f=fixture();await f.effect.準備({...f.window.bounds,width:128,height:128});
  if(mode==='capture')f.window.webContents.capturePage=async()=>{throw Error('capture');};
  if(mode==='empty')f.window.webContents.capturePage=async()=>({isEmpty:()=>true});
  if(mode==='decode'||mode==='animate')f.windows[0].webContents.executeJavaScript=async script=>{if(script.includes('const motion='))throw Error(mode);};
  await f.effect.完了();assert.equal(f.window.opacity,1);assert.equal(f.effect.active,false);assert.equal(f.windows[0].dead,true);
 }
});
test('完了通知が来ない場合は期限で実窓と演出窓を回収する',async()=>{
 const f=fixture();await f.effect.準備({...f.window.bounds,width:128,height:128});
 assert.equal(f.window.opacity,0);await new Promise(resolve=>setTimeout(resolve,2550));
 assert.equal(f.window.opacity,1);assert.equal(f.effect.active,false);assert.equal(f.windows[0].dead,true);
});
test('アニメーション待ちの再読込・終了後に遅れて実窓へ反映しない',async()=>{
 for(const destroyed of [false,true]){
  const f=fixture();await f.effect.準備({...f.window.bounds,width:128,height:128});let release;
  f.windows[0].webContents.executeJavaScript=async script=>{if(script.includes('const motion='))await new Promise(resolve=>release=resolve);};
  const finishing=f.effect.完了();await new Promise(resolve=>setTimeout(resolve,80));
  assert.equal(typeof release,'function');f.window.destroyed=destroyed;f.effect.中止();const calls=f.calls.length;
  release();await finishing;assert.equal(f.calls.length,calls);assert.equal(f.effect.active,false);assert.equal(f.windows[0].dead,true);
 }
});
