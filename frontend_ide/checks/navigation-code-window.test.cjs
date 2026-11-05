// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const test=require('node:test'),assert=require('node:assert/strict');
const {createNavigationCodeWindow}=require('../デスクトップ/navigation-code-window.cjs');
function fixture({kind='navi',bounds={x:8,y:192,width:480,height:600},area={x:0,y:0,width:1920,height:1080}}={}){
 let current={...bounds},source,reads,sets=0,maximized=false,fullscreen=false,normal={...bounds};
 const win={isDestroyed:()=>false,isMaximized:()=>maximized,isFullScreen:()=>fullscreen,setFullScreen:value=>{fullscreen=value;},unmaximize:()=>{maximized=false;},getNormalBounds:()=>({...normal}),getBounds:()=>({...current}),setBounds:value=>{sets++;current={...value};}};
 const record={kind,revision:1,window:win};source=record;
 const children=new Map();
 const state={active:true,mode:'online',startedAt:4};
 const change=createNavigationCodeWindow({trustedEvent:()=>source,panelTarget:(owner,name)=>children.get(name)?.owner===owner?children.get(name):null,readState:()=>reads?reads():Promise.resolve(state),sessionKey:s=>`${s.mode}:${s.startedAt}`,screen:{getDisplayMatching:()=>({workArea:area})}});
 return{record,children,state,change,win,get bounds(){return current;},get sets(){return sets;},move:value=>{current={...current,...value};},source:value=>{source=value;},read:value=>{reads=value;},max:value=>{if(value&&!maximized)normal={...current};maximized=value;},full:value=>{if(value&&!fullscreen)normal={...current};fullscreen=value;}};
}
test('Navi grows to the right once, then restores original dimensions after movement',async()=>{
 const f=fixture();assert.equal((await f.change({},true)).ok,true);
 assert.deepEqual(f.bounds,{x:8,y:192,width:960,height:600});
 await f.change({},true);assert.equal(f.sets,1);
 f.move({x:180,y:220,height:700});await f.change({},false);
 assert.deepEqual(f.bounds,{x:180,y:220,width:480,height:600});
 await f.change({},false);assert.equal(f.sets,2);
});
test('Navi stays within the matching display work area, including negative origins and narrow screens',async()=>{
 const f=fixture({bounds:{x:-200,y:200,width:480,height:600},area:{x:-1024,y:0,width:1024,height:768}});
 await f.change({},true);assert.deepEqual(f.bounds,{x:-968,y:160,width:960,height:600});
 const small=fixture({bounds:{x:8,y:8,width:480,height:600},area:{x:0,y:0,width:640,height:480}});
 await small.change({},true);assert.deepEqual(small.bounds,{x:8,y:8,width:624,height:464});
 await small.change({},false);assert.equal(small.bounds.width,480);assert.equal(small.bounds.height,464);
});
test('Only the named Navigator belonging to the current IDE session can expand',async()=>{
 const f=fixture({kind:'ide'}),n=fixture();n.record.kind='panel-navigation';n.record.owner=f.record;n.record.ownerRevision=1;n.record.linkKey='online:4';
 f.children.set('navi-a',n.record);
 assert.equal((await f.change({},true)).ok,false);
 assert.equal((await f.change({},true,'missing')).ok,false);
 assert.equal((await f.change({},true,'navi-a')).ok,true);assert.equal(n.bounds.width,960);assert.equal(f.sets,0);
 n.record.linkKey='online:3';assert.equal((await f.change({},false,'navi-a')).ok,false);
 n.record.linkKey='online:4';f.record.vrPanelMoving=true;assert.equal((await f.change({},false,'navi-a')).ok,false);
 f.record.vrPanelMoving=false;assert.equal((await f.change({},false,'navi-a')).ok,true);
});
test('Newer close request wins while state lookup for opening is pending',async()=>{
 const f=fixture(),pending=[];f.read(()=>new Promise(done=>pending.push(done)));
 const open=f.change({},true),close=f.change({},false);
 pending[1](f.state);assert.equal((await close).ok,true);
 pending[0](f.state);assert.equal((await open).ok,false);assert.equal(f.sets,0);
});
test('Maximized Navigator uses its existing viewport and stale/inactive calls never resize',async()=>{
 const f=fixture();f.max(true);await f.change({},true);assert.equal(f.sets,0);
 f.max(false);f.state.active=false;assert.equal((await f.change({},true)).ok,false);assert.equal(f.sets,0);
 assert.equal((await f.change({},'true')).ok,false);
});

test('Closing Code after maximizing an expanded Navi restores the original normal dimensions',async()=>{
 const f=fixture();await f.change({},true);f.max(true);f.move({x:0,y:0,width:1920,height:1080});
 await f.change({},false);assert.deepEqual(f.bounds,{x:8,y:192,width:480,height:600});assert.equal(f.win.isMaximized(),false);
});


test('First Code on uses twice the standard width and never narrows an already wide Navi',async()=>{
 for(const width of [360,480,700,960,1200]){
  const f=fixture({bounds:{x:8,y:20,width,height:600}});
  await f.change({},true);assert.equal(f.bounds.width,Math.max(960,width));
  await f.change({},false);assert.equal(f.bounds.width,width);
 }
});
test('Both modes remember independent manual width and height at the current position',async()=>{
 const f=fixture();await f.change({},true);
 f.move({x:60,y:90,width:1100,height:800});await f.change({},false);
 assert.deepEqual(f.bounds,{x:60,y:90,width:480,height:600});
 f.move({x:70,y:100,width:650,height:700});await f.change({},true);
 assert.deepEqual(f.bounds,{x:70,y:100,width:1100,height:800});
 await f.change({},true);assert.equal(f.sets,3);
 await f.change({},false);assert.deepEqual(f.bounds,{x:70,y:100,width:650,height:700});
 await f.change({},false);assert.equal(f.sets,4);
});
test('A manually narrowed Code mode is remembered rather than forced back to the default',async()=>{
 const f=fixture();await f.change({},true);f.move({width:720,height:550});await f.change({},false);await f.change({},true);
 assert.equal(f.bounds.width,720);assert.equal(f.bounds.height,550);
});
test('Display clamping does not replace either preferred size',async()=>{
 const area={x:0,y:0,width:1920,height:1080},f=fixture({area});
 await f.change({},true);f.move({width:1100,height:800});await f.change({},false);
 area.width=640;area.height=480;await f.change({},true);assert.equal(f.bounds.width,624);assert.equal(f.bounds.height,464);
 await f.change({},false);assert.equal(f.bounds.width,480);assert.equal(f.bounds.height,464);
 area.width=1920;area.height=1080;await f.change({},true);assert.equal(f.bounds.width,1100);assert.equal(f.bounds.height,800);
 await f.change({},false);assert.equal(f.bounds.width,480);assert.equal(f.bounds.height,600);
});
test('First opening on a narrow screen preserves the intended expanded size',async()=>{
 const area={x:0,y:0,width:640,height:480},f=fixture({area});
 await f.change({},true);await f.change({},false);area.width=1920;area.height=1080;
 await f.change({},true);assert.equal(f.bounds.width,960);assert.equal(f.bounds.height,600);
});
test('Multiple IDE Navi windows and newly opened windows do not share remembered sizes',async()=>{
 const f=fixture({kind:'ide'}),a=fixture(),b=fixture();
 for(const [name,n] of [['a',a],['b',b]]){n.record.kind='panel-navigation';n.record.owner=f.record;n.record.ownerRevision=1;n.record.linkKey='online:4';f.children.set(name,n.record);}
 await f.change({},true,'a');a.move({width:1200,height:800});await f.change({},false,'a');a.move({width:600});
 await f.change({},true,'b');assert.equal(b.bounds.width,960);b.move({width:1000,height:700});await f.change({},false,'b');
 await f.change({},true,'a');assert.equal(a.bounds.width,1200);assert.equal(a.bounds.height,800);
 await f.change({},true,'b');assert.equal(b.bounds.width,1000);assert.equal(b.bounds.height,700);assert.equal(f.sets,0);
 const reopened=fixture();await reopened.change({},true);assert.equal(reopened.bounds.width,960);
});
test('Maximized and fullscreen viewports never overwrite a manually chosen expanded size',async()=>{
 for(const mode of ['max','full']){
  const f=fixture();await f.change({},true);f.move({x:35,y:55,width:1100,height:800});f[mode](true);f.move({x:0,y:0,width:1920,height:1080});
  await f.change({},false);assert.deepEqual(f.bounds,{x:35,y:55,width:480,height:600});
  await f.change({},true);assert.deepEqual(f.bounds,{x:35,y:55,width:1100,height:800});
 }
});
test('A first Code on/off while maximized or fullscreen retains the existing viewport',async()=>{
 for(const mode of ['max','full']){
  const f=fixture();f[mode](true);f.move({x:0,y:0,width:1920,height:1080});await f.change({},true);assert.equal(f.sets,0);
  await f.change({},false);assert.equal(f.sets,0);assert.equal(mode==='max'?f.win.isMaximized():f.win.isFullScreen(),true);
  f[mode](false);f.move({x:8,y:192,width:480,height:600});await f.change({},true);assert.equal(f.bounds.width,960);
 }
});
test('Rejected VR changes and failed setBounds do not corrupt either mode memory',async()=>{
 const f=fixture();await f.change({},true);f.move({width:1100,height:800});
 f.record.vrPanelMoving=true;assert.equal((await f.change({},false)).ok,false);assert.equal(f.bounds.width,1100);
 f.record.vrPanelMoving=false;const set=f.win.setBounds;f.win.setBounds=()=>{throw Error('window rejected resize');};assert.equal((await f.change({},false)).ok,false);
 f.win.setBounds=set;await f.change({},false);assert.equal(f.bounds.width,480);await f.change({},true);assert.equal(f.bounds.width,1100);assert.equal(f.bounds.height,800);
});


test('Already-wide compact mode takes priority over a smaller remembered Code width without forgetting it',async()=>{
 const f=fixture();await f.change({},true);f.move({width:850,height:750});await f.change({},false);
 f.move({width:1200,height:700});await f.change({},true);assert.equal(f.bounds.width,1200);assert.equal(f.bounds.height,750);
 await f.change({},false);assert.equal(f.bounds.width,1200);assert.equal(f.bounds.height,700);
 f.move({width:500});await f.change({},true);assert.equal(f.bounds.width,850);assert.equal(f.bounds.height,750);
 await f.change({},false);f.move({width:960});await f.change({},true);assert.equal(f.bounds.width,960);
});
