// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const test=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {mkdtempSync,rmSync,readFileSync,writeFileSync,symlinkSync}=require('node:fs');
const {tmpdir}=require('node:os'),{join}=require('node:path');
const {onScreen,applyPlacement,validate,readLayout,writeLayout,createLayoutManager}=require('../デスクトップ/配置保存.cjs');
const {windowBounds}=require('../デスクトップ/window-layout.cjs');
const rect={x:20,y:30,width:400,height:600},initial={x:60,y:70,width:480,height:650};
const renderer=()=>({version:1,viewMode:'3d',navigation:[],space:{explorer:{},viewers:[]}});
const snapshot=()=>({version:1,ide:{bounds:rect,maximized:false},panels:[{kind:'code',bounds:rect,maximized:false}],renderer:renderer()});
function fixture(){
 const windows=new Map(),owner={kind:'ide',revision:0,pending:new Map()},state={active:true,mode:'online',startedAt:1,project:{path:'/project'}},written=[];
 let saved=snapshot(),manager,gate,avatar=false,captured=renderer(),restored={panels:[]},opening,readError,avatarCapture={windows:[{role:'core',bounds:rect}]},vr=false;
 const screen={getAllDisplays:()=>[{workArea:{x:0,y:0,width:1920,height:1080}}],getDisplayNearestPoint:()=>({workArea:{x:0,y:0,width:1920,height:1080}}),getCursorScreenPoint:()=>({x:100,y:100})};
 function window(record,rectangle=initial){const win=new EventEmitter();Object.assign(win,{rectangle:{...rectangle},isDestroyed:()=>!!win.dead,getBounds:()=>({...win.rectangle}),getNormalBounds:()=>({...win.rectangle}),isMaximized:()=>!!win.maximized,isMinimized:()=>false,unmaximize(){win.maximized=false;},maximize(){win.maximized=true;},setBounds(value){win.rectangle={...value};},destroy(){win.dead=true;windows.delete(win.webContents);win.emit('closed');},webContents:{send(channel,value){if(channel==='development:layout-request')queueMicrotask(()=>manager.reply({record:owner},{requestId:value.requestId,ok:true,result:value.action==='capture'?captured:restored}));}}});record.window=win;windows.set(win.webContents,record);return record;}
 window(owner);const add=(kind='code',more={})=>window({kind,owner,linkKey:'online:1',...more});
 manager=createLayoutManager({windows,screen,trustedEvent:event=>event.record,readState:async()=>structuredClone(state),sessionKey:s=>s.active?s.mode+':'+s.startedAt:'',allDisplays:{isActive:()=>vr},avatarLauncher:{active:()=>avatar,capture:async()=>avatarCapture,restore:async()=>({ok:true})},
 read:()=>{if(readError)throw readError;return structuredClone(saved);},write:(_project,value,guard)=>{guard();written.push(value);saved=structuredClone(value);},
 openNative:async(_event,panels)=>{opening=(opening||0)+1;if(gate)await gate;return panels.map(p=>add(p.kind,p.kind==='task'?{taskView:p.view}:{}));},timeout:100});
 return{manager,owner,state,windows,screen,add,fill:()=>[add(),add(),add()],written,run:action=>manager.handle({record:owner},action),save:value=>saved=value,gate:value=>gate=value,get opening(){return opening||0;},avatar:value=>avatar=value,capture:value=>captured=value,restore:value=>restored=value,readError:value=>readError=value,avatarCapture:value=>avatarCapture=value,vr:value=>vr=value};
}
test('screen coverage accepts negative/adjacent monitors and rejects removed screens, clipped bounds and gaps',()=>{
 const areas=[{x:-1920,y:0,width:1920,height:1080},{x:0,y:0,width:1920,height:1080}];
 assert.equal(onScreen({x:-200,y:20,width:400,height:500},areas),true);
 assert.equal(onScreen({x:-1900,y:20,width:400,height:500},areas.slice(1)),false);
 assert.equal(onScreen({x:1700,y:20,width:400,height:500},areas),false);
 assert.equal(onScreen({x:-100,y:20,width:300,height:500},[{x:-1920,y:0,width:1820,height:1080},areas[1]]),false);
});
test('offscreen saved child keeps initial placement, onscreen restores exact normal and maximized bounds, IDE uses initial position',()=>{
 const f=fixture(),child=f.add();const out={x:4000,y:0,width:400,height:600};
 assert.equal(applyPlacement(child,{bounds:out,maximized:true},f.screen),false);assert.deepEqual(child.window.getBounds(),initial);assert.equal(child.window.isMaximized(),false);
 assert.equal(applyPlacement(child,{bounds:rect,maximized:true},f.screen),true);assert.deepEqual(child.window.getBounds(),rect);assert.equal(child.window.isMaximized(),true);
 f.owner.window.setBounds(out);applyPlacement(f.owner,{bounds:out,maximized:true},f.screen);assert.equal(onScreen(f.owner.window.getBounds(),f.screen.getAllDisplays().map(d=>d.workArea)),true);assert.notDeepEqual(f.owner.window.getBounds(),out);
});
test('project layout round trips atomically, isolates projects and does not persist unknown data',()=>{
 const root=mkdtempSync(join(tmpdir(),'aidiy-layout-'));
 try{const value=snapshot();value.token='secret';value.panels[0].url='http://sensitive.invalid';writeLayout(root,value);assert.deepEqual(readLayout(root),snapshot());assert.equal(readLayout(join(root,'other')),null);const filename=join(root,'_AIDIY/aidiy_ide/window-layout.json');assert.doesNotMatch(readFileSync(filename,'utf8'),/secret|sensitive/);assert.throws(()=>writeLayout(root,value,()=>{throw Error('session changed');}),/session changed/);assert.deepEqual(readLayout(root),snapshot());writeFileSync(filename,'broken');assert.throws(()=>readLayout(root),/読み込めません/);}finally{rmSync(root,{recursive:true,force:true});}
});
test('layout storage rejects symlinked private folders and invalid/unbounded values',()=>{
 const root=mkdtempSync(join(tmpdir(),'aidiy-layout-')),other=mkdtempSync(join(tmpdir(),'aidiy-layout-other-'));
 try{symlinkSync(other,join(root,'_AIDIY'));assert.throws(()=>writeLayout(root,snapshot()),/リンク/);}finally{rmSync(root,{recursive:true,force:true});rmSync(other,{recursive:true,force:true});}
 for(const value of [{}, {...snapshot(),version:2},{...snapshot(),panels:[{kind:'shell',bounds:rect}]},{...snapshot(),ide:{bounds:{...rect,width:Infinity}}},{...snapshot(),panels:Array(101).fill(snapshot().panels[0])}])assert.throws(()=>validate(value));
});
test('Save captures IDE and owned panels, omits unrelated applications and Task editor data',async()=>{
 const f=fixture();f.fill();f.add('task',{taskView:'dialog',taskPayload:{token:'secret'}});f.add('team',{owner:undefined});
 assert.equal((await f.run('state')).count,3);assert.equal((await f.run('save')).ok,true);assert.deepEqual(f.written[0].panels.map(p=>p.kind),['code','code','code']);assert.deepEqual(f.written[0].ide.bounds,initial);
});
test('Load restores each saved native window and refuses repeat or simultaneous loads',async()=>{
 const f=fixture();let release;f.gate(new Promise(resolve=>release=resolve));const first=f.run('load');await new Promise(resolve=>setImmediate(resolve));assert.equal((await f.run('load')).ok,false);release();assert.equal((await first).ok,true);assert.deepEqual(f.owner.window.getBounds(),rect);assert.equal(f.opening,1);assert.equal((await f.run('load')).ok,false);assert.equal(f.opening,1);
 const child=[...f.windows.values()].find(r=>r.owner===f.owner);assert.deepEqual(child.window.getBounds(),rect);
});
test('empty/missing layouts and offline/foreign requests are rejected without starting apps',async()=>{
 const f=fixture();assert.equal((await f.run('save')).ok,false);f.save(null);assert.equal((await f.run('load')).ok,false);f.state.mode='offline';assert.equal((await f.run('load')).ok,false);assert.equal((await f.manager.handle({record:f.add()},'save')).ok,false);assert.equal(f.opening,0);
});
test('end-session during native restore stops later launches and renderer restore',async()=>{
 const f=fixture();f.save({...snapshot(),panels:[snapshot().panels[0],{kind:'console',bounds:rect}]});let release;f.gate(new Promise(resolve=>release=resolve));const loading=f.run('load');await new Promise(resolve=>setImmediate(resolve));f.owner.revision++;f.state.active=false;release();assert.equal((await loading).ok,false);assert.equal(f.opening,1);
});
test('Save rejects late renderer result after session/project switches without overwriting layout',async()=>{
 const f=fixture();f.fill();f.owner.window.webContents.send=(_channel,value)=>{f.state.project.path='/other';f.manager.reply({record:f.owner},{requestId:value.requestId,ok:true,result:renderer()});};
 assert.equal((await f.run('save')).ok,false);assert.equal(f.written.length,0);
});
test('renderer replies are bound to the trusted IDE and timeout cannot save partial data',async()=>{
 const f=fixture();f.fill();f.owner.window.webContents.send=(_channel,value)=>f.manager.reply({record:{kind:'ide'}},{requestId:value.requestId,ok:true,result:renderer()});assert.match((await f.run('save')).error,/タイムアウト/);assert.equal(f.written.length,0);
});
test('DOM restored names map to native bounds and Avatar participates in count/capture',async()=>{
 const f=fixture(),value=snapshot();value.panels=[{kind:'panel-navigation',name:'previous',bounds:rect}];value.renderer.navigation=[{name:'previous'}];f.save(value);
 f.owner.window.webContents.send=(_channel,request)=>{const child=f.add('panel-navigation',{name:'next'});f.manager.reply({record:f.owner},{requestId:request.requestId,ok:true,result:{panels:[{previousName:'previous',name:'next'}]}});};
 assert.equal((await f.run('load')).ok,true);assert.deepEqual([...f.windows.values()].find(r=>r.name==='next').window.getBounds(),rect);
 const g=fixture();g.avatar(true);g.add();g.add();assert.equal((await g.run('state')).count,3);assert.equal((await g.run('save')).ok,true);assert.equal(g.written[0].avatar.windows[0].role,'core');
});

test('corrupt stored layout still reports children so Save can repair it',async()=>{
 const f=fixture();f.fill();f.readError(Error('broken'));const state=await f.run('state');assert.equal(state.ok,true);assert.equal(state.count,3);assert.equal(state.saved,false);assert.equal((await f.run('save')).ok,true);
});
test('owned Avatar capture failure preserves the last saved layout',async()=>{
 const f=fixture();f.avatar(true);f.add();f.add();f.avatarCapture(null);assert.equal((await f.run('save')).ok,false);assert.equal(f.written.length,0);
});
test('VR starting while capture is pending cannot save virtual desktop bounds',async()=>{
 const f=fixture();f.fill();f.owner.window.webContents.send=(_channel,value)=>{f.vr(true);f.manager.reply({record:f.owner},{requestId:value.requestId,ok:true,result:renderer()});};assert.match((await f.run('save')).error,/VR/);assert.equal(f.written.length,0);
});
test('ending the IDE session cancels renderer wait and releases the operation lock immediately',async()=>{
 const f=fixture();f.fill();let request;f.owner.window.webContents.send=(_channel,value)=>request=value;const saving=f.run('save');await new Promise(resolve=>setImmediate(resolve));assert.ok(request);f.owner.revision++;f.manager.invalidate(f.owner);assert.equal((await saving).ok,false);assert.equal((await f.run('state')).busy,false);assert.equal(f.written.length,0);
});

test('Save requires three owned panels and never counts the IDE or unrelated apps',async()=>{
 const f=fixture();f.add('team',{owner:undefined});
 for(let n=0;n<3;n++){assert.equal((await f.run('state')).count,n);assert.equal((await f.run('save')).ok,false);f.add();}
 assert.equal((await f.run('save')).ok,true);assert.equal(f.written.length,1);
});

test('Load applies the IDE position and normal size before child launch, including saved maximized state',async()=>{
 const f=fixture(),value=snapshot(),saved={x:300,y:120,width:950,height:800};
 value.ide={bounds:saved,maximized:true};f.save(value);let release;f.gate(new Promise(resolve=>release=resolve));
 const loading=f.run('load');await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.opening,1);assert.deepEqual(f.owner.window.getBounds(),saved);assert.equal(f.owner.window.isMaximized(),true);
 release();assert.equal((await loading).ok,true);assert.deepEqual(f.owner.window.getBounds(),saved);
});
test('Load uses the exact existing initial IDE placement when its saved display is gone',async()=>{
 const f=fixture(),value=snapshot();value.ide={bounds:{x:-1800,y:50,width:1000,height:800},maximized:true};f.save(value);
 const expected=windowBounds('ide',f.screen.getDisplayNearestPoint(f.screen.getCursorScreenPoint()).workArea);
 assert.equal((await f.run('load')).ok,true);assert.deepEqual(f.owner.window.getBounds(),expected);assert.equal(f.owner.window.isMaximized(),false);
});
