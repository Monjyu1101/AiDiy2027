// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const test=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {createNavigationCruiseWindow,registerNavigationCruiseTitle,navigationWindowTitle}=require('../デスクトップ/navigation-code-window.cjs');
function fixture(kind='navi'){
 const window=()=>{let title='';return{webContents:new EventEmitter(),isDestroyed:()=>false,getTitle:()=>title,setTitle:value=>{title=value;}};};
 const source={kind:kind==='navi'?'navi':'ide',revision:1,window:window()};
 const record=kind==='navi'?source:{kind:'panel-navigation',owner:source,ownerRevision:1,linkKey:'online:42',window:window(),name:'navi-window'};
 const state={active:true,mode:'online',startedAt:42};let pending;
 const change=createNavigationCruiseWindow({trustedEvent:()=>source,panelTarget:(owner,name)=>owner===source&&name==='navi-window'?record:null,readState:()=>pending?pending():Promise.resolve(state),sessionKey:s=>`${s.mode}:${s.startedAt}`});
 record.window.setTitle(kind==='navi'?'AiDiy Navigator':'AiDiy IDE / Explorer');
 registerNavigationCruiseTitle(record);
 const page=title=>{let prevented=false;record.window.webContents.emit('page-title-updated',{preventDefault(){prevented=true;}},title);if(!prevented)record.window.setTitle(title);};
 if(kind!=='navi')page('AiDiy IDE / Navigator 7');
 return{source,record,state,page,change:active=>change({},active,kind==='navi'?undefined:'navi-window'),raw:change,pending:fn=>{pending=fn;}};
}
for(const kind of ['navi','panel-navigation'])for(const vr of [false,true])test(`${kind} title retains AiDiy and the window number (VR=${vr})`,async()=>{
 const f=fixture(kind),original=f.record.window.getTitle(),cruise=kind==='navi'?'AiDiy Navigation Cruise':'AiDiy IDE / Navigation Cruise 7';f.source.vrPanelMoving=vr;
 assert.equal((await f.change(true)).title,cruise);assert.equal(f.record.window.getTitle(),cruise);
 await f.change(true);assert.equal(f.record.navigationNormalTitle,original);
 if(kind==='panel-navigation'){f.page('unexpected title');f.page('AiDiy IDE / Navigator 99');assert.equal(f.record.window.getTitle(),cruise);}
 else assert.equal(navigationWindowTitle(f.record,'ignored'),cruise);
 assert.equal((await f.change(false)).title,original);assert.equal(f.record.window.getTitle(),original);
 if(kind==='panel-navigation'){f.page('Navigation Cruise');assert.equal(f.record.window.getTitle(),original);}
 await f.change(true);await f.change(false);assert.equal(f.record.window.getTitle(),original);
});
test('Cruise title rejects other windows, names, stale owner/session and non-boolean input',async()=>{
 const f=fixture('panel-navigation'),original=f.record.window.getTitle();
 assert.equal((await f.raw({},true)).ok,false);assert.equal((await f.raw({},true,'other')).ok,false);
 assert.equal((await f.change('true')).ok,false);
 f.record.ownerRevision=0;assert.equal((await f.change(true)).ok,false);f.record.ownerRevision=1;
 f.state.startedAt=43;assert.equal((await f.change(true)).ok,false);f.state.startedAt=42;
 f.state.active=false;assert.equal((await f.change(true)).ok,false);f.state.active=true;
 assert.equal(f.record.window.getTitle(),original);assert.equal(f.source.window.getTitle(),'');
});
test('Late active-title request cannot overwrite newer stop or changed ownership',async()=>{
 const f=fixture('panel-navigation'),pending=[];f.pending(()=>new Promise(done=>pending.push(done)));
 const active=f.change(true),stop=f.change(false);pending[1](f.state);assert.equal((await stop).ok,true);pending[0](f.state);assert.equal((await active).ok,false);
 assert.equal(f.record.window.getTitle(),'AiDiy IDE / Navigator 7');
 const stale=f.change(true);f.source.revision++;pending[2](f.state);assert.equal((await stale).ok,false);
});
