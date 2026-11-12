// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {createPanelCollapse}=require('../デスクトップ/パネル折り畳み.cjs');
function fixture(kind='code',options={}){
 let time=0,id=0;const timers=new Map(),frames=[];
 const win=new EventEmitter();Object.assign(win,{bounds:{x:10,y:20,width:700,height:600},minimum:[320,200],resizable:true,maximizable:true,maximized:false,destroyed:false,webContents:new EventEmitter(),isDestroyed(){return this.destroyed;},isFullScreen:()=>false,isMaximized(){return this.maximized;},isResizable(){return this.resizable;},isMaximizable(){return this.maximizable;},getMinimumSize(){return this.minimum;},setMinimumSize(...v){this.minimum=v;},setResizable(v){this.resizable=v;},setMaximizable(v){this.maximizable=v;},getBounds(){return {...this.bounds};},getNormalBounds(){return {height:600};},setBounds(v){this.bounds=v;frames.push(v.height);},unmaximize(){this.maximized=false;},maximize(){this.maximized=true;}});
 win.webContents.getZoomFactor=()=>1;
 const record={kind,window:win},collapse=createPanelCollapse({trustedEvent:event=>event===record?record:null,now:()=>time,setTimer:fn=>{timers.set(++id,fn);return id;},clearTimer:key=>timers.delete(key),...options});
 const step=ms=>{time+=ms;const callbacks=[...timers.values()];timers.clear();callbacks.forEach(fn=>fn());};
 return{win,record,frames,timers,step,toggle:value=>collapse(record,value),collapse};
}
for(const kind of ['ide','code','live','console','browser','navi','task','team','diag','panel-navigation','explorer','panel-viewer','viewer'])test(kind+': animate to title only and restore size at dragged position',async()=>{
 const f=fixture(kind),p=f.toggle(true);f.step(100);assert.ok(f.win.bounds.height>31&&f.win.bounds.height<600);f.step(200);assert.deepEqual(await p,{ok:true});assert.equal(f.win.bounds.height,31);assert.equal(f.win.resizable,false);
 f.win.bounds.x=123;f.win.bounds.y=234;const restore=f.toggle(false);f.step(100);assert.ok(f.win.bounds.height>31&&f.win.bounds.height<600);f.step(200);await restore;
 assert.deepEqual(f.win.bounds,{x:123,y:234,width:700,height:600});assert.deepEqual(f.win.minimum,[320,200]);assert.equal(f.win.resizable,true);assert.equal(f.win.listenerCount('closed'),0);
});
test('reverse rapid toggles, restore maximized state, and release closed windows',async()=>{
 const f=fixture();f.win.maximized=true;const a=f.toggle(true);f.step(80);const b=f.toggle(false);assert.equal((await a).superseded,true);f.step(40);const c=f.toggle(true);assert.equal((await b).superseded,true);f.step(240);await c;const d=f.toggle(false);f.step(240);await d;assert.equal(f.win.maximized,true);
 const e=f.toggle(true);f.win.destroyed=true;f.win.emit('closed');assert.equal((await e).ok,false);assert.equal(f.timers.size,0);
});
test('reject untrusted, other apps and full screen; restore on reload',async()=>{
 const f=fixture('unsupported');assert.equal((await f.toggle(true)).ok,false);assert.equal((await f.collapse({},true)).ok,false);
 const g=fixture();g.win.isFullScreen=()=>true;assert.equal((await g.toggle(true)).ok,false);g.win.isFullScreen=()=>false;
 const p=g.toggle(true);g.step(240);await p;g.win.webContents.emit('did-start-navigation');assert.equal(g.win.bounds.height,600);assert.equal(g.win.resizable,true);assert.equal(g.timers.size,0);
});
test('renderer: rapid native replies cannot hide a newly expanded panel; errors revert state',async()=>{
 const fs=require('node:fs'),vm=require('node:vm');let dispose;const requests=[];
 let source=fs.readFileSync(require('node:path').join(__dirname,'../src/components/共通表示/パネル折り畳み.js'),'utf8').replace(/import .* from 'vue';/, '').replace('export function','function');
 const context={ref:value=>({value}),onBeforeUnmount:fn=>{dispose=fn;},window:{aidiyWindow:{collapsePanel:value=>new Promise(resolve=>requests.push({value,resolve}))}}};
 vm.runInNewContext(source+'\nthis.usePanelCollapse=usePanelCollapse;',context);
 const panel=context.usePanelCollapse({desktop:true});panel.panelElement.value={};
 const first=panel.togglePanel(),second=panel.togglePanel();requests[0].resolve({ok:true});await first;assert.equal(panel.panelHidden.value,false);requests[1].resolve({ok:true});await second;assert.equal(panel.panelCollapsed.value,false);
 const denied=panel.togglePanel();requests[2].resolve({ok:false});await denied;assert.equal(panel.panelCollapsed.value,false);
 const pending=panel.togglePanel();dispose();requests[3].resolve({ok:true});await pending;assert.equal(panel.panelHidden.value,false);
});

test('application gate and visibility callbacks preserve content until expansion ends',async()=>{
 const changes=[];let allowed=false;const f=fixture('browser',{canCollapse:()=>allowed,onChange:(_record,value)=>changes.push(value)});
 assert.equal((await f.toggle(true)).ok,false);assert.deepEqual(changes,[]);allowed=true;
 const first=f.toggle(true);assert.deepEqual(changes,[true]);f.step(240);await first;
 const restore=f.toggle(false);f.step(80);assert.deepEqual(changes,[true]);f.step(240);await restore;assert.deepEqual(changes,[true,false]);
});
test('named Navi windows require an authorized owner and resolver; unrelated names are denied',async()=>{
 const owner={kind:'ide'},f=fixture('panel-navigation',{trustedEvent:event=>event===owner?owner:null,resolvePanel:(source,name)=>source===owner&&name==='navi-1'?f.record:null});
 assert.equal((await f.collapse({},true,'navi-1')).ok,false);assert.equal((await f.collapse(owner,true,'viewer')).ok,false);
 const p=f.collapse(owner,true,'navi-1');f.step(240);assert.equal((await p).ok,true);
 const r=f.collapse(owner,false,'navi-1');f.step(240);await r;
});

// Windowsのフレームレス窓・端数DPIで発生するsetBounds/getBoundsの非対称を模擬する。
// 理想的なsetBoundsモックだけでは、毎フレームの読戻しによる幅の累積を見逃す。
for(const kind of ['ide','code','live','console','browser','navi','task','team','diag','panel-navigation','explorer','panel-viewer','viewer'])test(kind+': repeated collapse preserves width across native rounding and frame-style changes',async()=>{
 const f=fixture(kind);f.win.getNormalBounds=()=>({...f.win.bounds});
 f.win.setBounds=v=>{f.win.bounds={...v,width:v.width+1,height:v.height+1};};
 f.win.setResizable=v=>{if(f.win.resizable!==v)f.win.bounds.width+=2;f.win.resizable=v;};
 for(let n=0;n<30;n++){
  const close=f.toggle(true);f.step(60);f.step(60);f.step(240);await close;
  assert.equal(f.win.bounds.width,700);assert.equal(f.win.bounds.height,31);
  f.win.bounds.x=100+n;f.win.bounds.y=200+n;
  const open=f.toggle(false);f.step(60);f.step(60);f.step(240);await open;
  assert.deepEqual(f.win.bounds,{x:100+n,y:200+n,width:700,height:600});
 }
 const close=f.toggle(true);f.step(240);await close;f.win.webContents.emit('did-start-navigation');
 assert.equal(f.win.bounds.width,700);assert.equal(f.win.bounds.height,600);
});

for(const kind of ['ide','code','live','console','browser','navi','task','team','diag','panel-navigation','explorer','panel-viewer','viewer'])for(const phase of ['collapsing','collapsed','expanding'])test(kind+': close safely while '+phase,async()=>{
 const f=fixture(kind,{onChange:record=>assert.equal(record.window.isDestroyed(),false)}),contents=f.win.webContents;
 Object.defineProperty(f.win,'webContents',{get(){if(this.destroyed)throw Error('Object has been destroyed');return contents;}});
 let pending=f.toggle(true);
 if(phase!=='collapsing'){f.step(240);await pending;if(phase==='expanding')pending=f.toggle(false);}
 f.win.destroyed=true;
 assert.doesNotThrow(()=>f.win.emit('closed'));
 assert.equal((await pending).ok,phase==='collapsed');
 f.step(500);
 assert.equal(f.timers.size,0);assert.equal(contents.listenerCount('did-start-navigation'),0);assert.equal(f.win.listenerCount('closed'),0);
});
