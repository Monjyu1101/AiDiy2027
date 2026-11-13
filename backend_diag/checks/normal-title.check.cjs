// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {通常窓サイズを作成}=require('../diag/起動/通常窓サイズ.cjs');
const {標準タイトル操作を取り付け,標準タイトル対象}=require('../diag/起動/標準タイトル操作.cjs');
const {ミニ表示を作成}=require('../diag/起動/ミニ表示.cjs');
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function fixture({platform='win32',eligible=async()=>1,zoom=1}={}){
 let bounds={x:48,y:48,width:800,height:600},cursor={x:448,y:62},enabled=true,fullscreen=false,focused=true,toggles=0;
 const window=new EventEmitter(),contents=new EventEmitter(),writes=[];
 Object.assign(contents,{isDestroyed:()=>false,getZoomFactor:()=>zoom,executeJavaScriptInIsolatedWorld:(_id,[script])=>script.code.startsWith('(function 標準タイトル捕捉')?Promise.resolve(1):eligible(script.code)});
 Object.assign(window,{webContents:contents,getBounds:()=>({...bounds}),getNormalBounds:()=>({...bounds}),setBounds:v=>{bounds={...v};writes.push({...v});window.emit('resize');},isMaximized:()=>false,isMinimized:()=>false,isFullScreen:()=>fullscreen,isFocused:()=>focused,isDestroyed:()=>false,getMinimumSize:()=>[420,320],setMinimumSize(){},isMaximizable:()=>true,setMaximizable(){}});
 const area={x:-1920,y:28,width:1920,height:1052},screen={getCursorScreenPoint:()=>({...cursor}),getDisplayMatching:()=>({workArea:area})};
 const sizing=通常窓サイズを作成(window,screen,'win32');
 const controller=標準タイトル操作を取り付け(sizing,screen,{platform,enabled:()=>enabled,toggleMaximize(){toggles++;if(sizing.isMaximized())sizing.unmaximize();else sizing.maximize();}});
 const emit=(type,extra={})=>contents.emit('before-mouse-event',{}, {type,button:'left',x:400*zoom,y:14*zoom,clickCount:1,...extra});
 return {window,contents,sizing,screen,area,writes,controller,emit,point:value=>cursor=value,enable:value=>enabled=value,fullscreen:value=>fullscreen=value,focus:value=>focused=value,get bounds(){return {...bounds};},get toggles(){return toggles;}};
}
test('Windows standard native clickCount doubles toggle exactly once and preserve original bounds repeatedly',async()=>{
 const f=fixture(),original=f.bounds;
 for(let i=0;i<3;i++){
  f.emit('mouseDown',{clickCount:2});await flush();f.emit('mouseUp');assert.equal(f.sizing.isMaximized(),true);assert.deepEqual(f.sizing.getNormalBounds(),original);
  f.emit('mouseDown',{clickCount:2});await flush();f.emit('mouseUp');assert.equal(f.sizing.isMaximized(),false);assert.deepEqual(f.bounds,original);
 }
 assert.equal(f.toggles,6);f.controller.dispose();
});
test('maximized drag restores normal size at current pointer anchor, negative display coordinates and zoom, without doubled delta',async()=>{
 for(const zoom of [1,1.5,2]){
  const f=fixture({zoom});f.sizing.maximize();f.point({x:-960,y:48});f.emit('mouseDown');await flush();
  f.point({x:-950,y:58});f.emit('mouseMove');await flush();assert.equal(f.sizing.isMaximized(),false);assert.deepEqual(f.bounds,{x:-1350,y:38,width:800,height:600});
  f.point({x:100,y:100});f.emit('mouseMove');await flush();assert.deepEqual(f.bounds,{x:-300,y:80,width:800,height:600});f.emit('mouseUp');
  f.point({x:400,y:200});f.emit('mouseMove');await flush();assert.deepEqual(f.bounds,{x:-300,y:80,width:800,height:600});f.controller.dispose();
 }
});
test('ordinary title drag moves immediately after threshold but a stationary click never moves',async()=>{
 const f=fixture();f.emit('mouseDown');await flush();assert.equal(f.writes.length,0);
 f.point({x:450,y:63});f.emit('mouseMove');await flush();assert.equal(f.writes.length,0);
 f.point({x:460,y:70});f.emit('mouseMove');await flush();assert.deepEqual(f.bounds,{x:60,y:56,width:800,height:600});f.emit('mouseUp');await flush();f.controller.dispose();
});
test('late eligibility never resurrects blurred, navigated, mode-switched, closed or superseded gesture',async()=>{
 for(const reason of ['blur','navigate','mode','closed','escape','superseded']){
  let resolve;const f=fixture({eligible:()=>new Promise(r=>resolve=r)});f.emit('mouseDown',{clickCount:2});
  if(reason==='released')f.emit('mouseUp');if(reason==='blur')f.window.emit('blur');if(reason==='navigate')f.contents.emit('did-start-navigation',{},'',false,true);
  if(reason==='mode'){f.enable(false);f.controller.cancel();}if(reason==='closed')f.window.emit('closed');if(reason==='escape')f.contents.emit('before-input-event',{}, {key:'Escape'});
  if(reason==='superseded'){const old=resolve;f.emit('mouseDown');resolve=old;}
  resolve(1);await flush();assert.equal(f.toggles,0,reason);assert.equal(f.writes.length,0,reason);f.controller.dispose();
 }
});
test('special display, fullscreen, unfocused, non-Windows and excluded target cannot maximize or drag',async()=>{
 for(const mode of ['mini','micro','animation','fullscreen','unfocused','linux','darwin','button']){
  const f=fixture({platform:['linux','darwin'].includes(mode)?mode:'win32',eligible:async()=>mode==='button'?0:1});
  if(['mini','micro','animation'].includes(mode))f.enable(false);if(mode==='fullscreen')f.fullscreen(true);if(mode==='unfocused')f.focus(false);
  f.emit('mouseDown',{clickCount:2});await flush();f.point({x:800,y:400});f.emit('mouseMove');await flush();assert.equal(f.toggles,0,mode);assert.equal(f.writes.length,0,mode);f.controller.dispose();
 }
});
test('maximized standard to mini cancels title gesture and retains original normal dimensions on return',async()=>{
 const f=fixture();f.sizing.maximize();f.point({x:-1000,y:45});f.emit('mouseDown');await flush();f.controller.cancel();f.enable(false);
 const mini=ミニ表示を作成(f.sizing,{screen:f.screen});mini.set(true);f.point({x:300,y:400});f.emit('mouseMove');await flush();assert.equal(f.bounds.width,400);
 mini.set(false);f.enable(true);assert.equal(f.bounds.width,800);assert.equal(f.bounds.height,600);f.controller.dispose();
});
test('isolated title target rejects controls/popups/outside and accepts only standard header background',()=>{
 const oldDocument=global.document,oldStyle=global.getComputedStyle;
 try{
  for(const kind of ['title','button','input','select','popup','mini','body']){
   global.document={elementFromPoint:()=>({closest:selector=>selector.startsWith('header')?!['mini','body'].includes(kind):['button','input','select'].includes(kind)}),querySelectorAll:()=>kind==='popup'?[{getClientRects:()=>[{}]}]:[]};global.getComputedStyle=()=>({visibility:'visible'});
   assert.equal(標準タイトル対象(20,20),kind==='title',kind);
  }
 }finally{global.document=oldDocument;global.getComputedStyle=oldStyle;}
});

test('completed native double click survives delayed eligibility after ordinary release, but drag does not',async()=>{
 for(const double of [true,false]){
  let resolve;const f=fixture({eligible:()=>new Promise(r=>resolve=r)});f.emit('mouseDown',{clickCount:double?2:1});f.emit('mouseUp');resolve(1);await flush();assert.equal(f.toggles,double?1:0);f.controller.dispose();
 }
});
test('asynchronous own resize keeps the drag and lost pointer capture cancels it',async()=>{
 let capture=1;const f=fixture({eligible:async()=>capture});f.sizing.maximize();f.point({x:-960,y:48});f.emit('mouseDown');await flush();f.point({x:-940,y:68});f.emit('mouseMove');await flush();
 const first=f.bounds;f.window.emit('resize');f.point({x:-930,y:78});f.emit('mouseMove');await flush();assert.equal(f.bounds.x,first.x+10);
 capture=0;const released=f.bounds;f.point({x:400,y:300});f.emit('mouseMove');await flush();assert.deepEqual(f.bounds,released);
 f.controller.dispose();
});

test('last native movement is applied at release even when its frame query is pending',async()=>{
 const f=fixture();f.emit('mouseDown');await flush();f.point({x:480,y:85});f.emit('mouseMove');f.emit('mouseUp');f.point({x:1000,y:1000});await flush();assert.deepEqual(f.bounds,{x:80,y:71,width:800,height:600});f.controller.dispose();
});
