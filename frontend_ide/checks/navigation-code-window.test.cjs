// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const test=require('node:test'),assert=require('node:assert/strict');
const {createNavigationCodeWindow}=require('../デスクトップ/navigation-code-window.cjs');
function fixture({kind='navi',bounds={x:8,y:192,width:480,height:600},area={x:0,y:0,width:1920,height:1080}}={}){
 let current={...bounds},source,reads,sets=0,maximized=false;
 const win={isDestroyed:()=>false,isMaximized:()=>maximized,isFullScreen:()=>false,unmaximize:()=>{maximized=false;},getBounds:()=>({...current}),setBounds:value=>{sets++;current={...value};}};
 const record={kind,revision:1,window:win};source=record;
 const children=new Map();
 const state={active:true,mode:'online',startedAt:4};
 const change=createNavigationCodeWindow({trustedEvent:()=>source,panelTarget:(owner,name)=>children.get(name)?.owner===owner?children.get(name):null,readState:()=>reads?reads():Promise.resolve(state),sessionKey:s=>`${s.mode}:${s.startedAt}`,screen:{getDisplayMatching:()=>({workArea:area})}});
 return{record,children,state,change,win,get bounds(){return current;},get sets(){return sets;},move:value=>{current={...current,...value};},source:value=>{source=value;},read:value=>{reads=value;},max:value=>{maximized=value;}};
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
