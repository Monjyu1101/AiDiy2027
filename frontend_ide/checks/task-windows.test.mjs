// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import manager from '../デスクトップ/task-windows.cjs';
const {createTaskWindows,taskWindowBounds,copyPayload}=manager;
function fixture(authenticated=false){
 const records=new Map();let created=0,focused=0,ended=0,gate,controller;const messages=[];
 const make=(kind='task',view='request',payload)=>{const window={dead:false,webContents:{send:(...v)=>messages.push(v)},isDestroyed(){return this.dead;},destroy(){this.dead=true;records.delete(this);controller?.closed(record);}};const record={window,kind,taskView:view,taskPayload:payload};records.set(window,record);return record;};
 const root=make();
 controller=createTaskWindows({authenticated,records,trustedEvent:e=>e?.record,focusWindow:()=>focused++,onLastClosed:()=>ended++,createWindow:async(view,payload)=>{created++;const r=make('task',view,payload);if(gate)await gate;return r.window;}});
 const call=(action,payload,record=root)=>controller.handle({record},action,payload);
 const login=()=>controller.session({record:root},'set',{token:'test-token',expectedRevision:0});
 return{records,root,make,controller,call,login,messages,get created(){return created;},get focused(){return focused;},get ended(){return ended;},gate(promise){gate=promise;}};
}
test('Task three peers reopen closed request from surviving flow, ending only after all three close',async()=>{
 const f=fixture();assert.equal((await f.login()).ok,true);assert.equal((await f.call('open-all')).ok,true);assert.equal(f.created,2);
 const flow=[...f.records.values()].find(r=>r.taskView==='flow');f.root.window.destroy();assert.equal(f.ended,0);
 assert.deepEqual((await f.call('state',undefined,flow)).views.sort(),['detail','flow']);
 await f.call('open',{view:'request'},flow);assert.equal(f.created,3);assert.equal(f.ended,0);
 await f.call('open-all',undefined,flow);assert.equal(f.created,3);
 for(const r of [...f.records.values()])r.window.destroy();assert.equal(f.ended,1);
});
test('Task concurrent open deduplicates, last-close invalidates pending creation',async()=>{
 const f=fixture();await f.login();for(const r of [...f.records.values()])if(r!==f.root)r.window.destroy();let release;f.gate(new Promise(resolve=>release=resolve));
 const a=f.call('open',{view:'flow'}),b=f.call('open',{view:'flow'});assert.equal(f.created,1);
 for(const r of [...f.records.values()])r.window.destroy();release();
 assert.equal((await a).ok,false);assert.equal((await b).ok,false);assert.equal(f.ended,1);
});
test('Task dialog replaces prior window, payload is editor-only and editor cannot keep process alive',async()=>{
 const f=fixture();await f.login();for(const r of [...f.records.values()])if(r!==f.root)r.window.destroy();const payload={kind:'request',利用者ID:'tester',編集タスク:{要求内容:'sample'}};
 await f.call('dialog',payload);let editor=[...f.records.values()].find(r=>r.taskView==='dialog');
 payload.編集タスク.要求内容='mutated';assert.equal((await f.call('dialog-payload',undefined,editor)).payload.編集タスク.要求内容,'sample');
 assert.equal((await f.call('dialog-payload')).ok,false);
 await f.call('dialog',{kind:'detail',編集明細:{明細SEQ:1}});assert.equal(editor.window.isDestroyed(),true);
 editor=[...f.records.values()].find(r=>r.taskView==='dialog');assert.equal((await f.call('dialog-payload',undefined,editor)).payload.kind,'detail');
 f.root.window.destroy();assert.equal(f.ended,1);assert.equal(editor.window.isDestroyed(),true);
});
test('Task manager rejects other apps, invalid actions and untrusted contents',async()=>{
 const f=fixture();for(const kind of ['ide','team','code'])assert.equal((await f.call('open-all',undefined,f.make(kind))).ok,false);
 assert.equal((await f.controller.handle({},'open-all')).ok,false);
 for(const payload of [null,{}, {view:'http://evil.invalid'}, {view:'../code'}])assert.equal((await f.call('open',payload)).ok,false);
 for(const payload of [null,[],{kind:'code'},{kind:'request',text:'x'.repeat(2*1024*1024)}])assert.equal((await f.call('dialog',payload)).ok,false);
});
test('Task memory session logout recreates primary before closing surviving peers and editors',async()=>{
 const f=fixture();await f.login();await f.call('open',{view:'flow'});const flow=[...f.records.values()].find(r=>r.taskView==='flow');const other=f.make('team');
 const session=(record,action,value)=>f.controller.session({record},action,value);
 assert.equal((await session(other,'get')).ok,false);f.root.window.destroy();
 assert.equal((await session(flow,'get')).token,'test-token');
 await f.call('dialog',{kind:'request'},flow);
 assert.equal((await session(flow,'set',{token:'',expectedRevision:1})).revision,2);
 const taskRecords=[...f.records.values()].filter(r=>r.kind==='task');
 assert.deepEqual(taskRecords.map(r=>r.taskView),['request']);assert.equal(f.ended,0);
 const primary=taskRecords[0];assert.equal((await session(primary,'get')).token,'');
 assert.equal((await session(primary,'set',{token:'bad\ntoken',expectedRevision:2})).ok,false);
 assert.equal(other.window.isDestroyed(),false);
});
test('Task windows and editor preserve original sizing while clamping small/negative screens',()=>{
 for(const area of [{x:0,y:0,width:1920,height:1040},{x:-1000,y:-500,width:800,height:600},{x:0,y:0,width:320,height:240}])for(const view of ['request','flow','detail','dialog']){
  const b=taskWindowBounds(view,area);assert.ok(b.x>=area.x&&b.y>=area.y&&b.x+b.width<=area.x+area.width&&b.y+b.height<=area.y+area.height);assert.ok(b.minWidth<=b.width&&b.minHeight<=b.height);
 }
 assert.equal(taskWindowBounds('request',{x:0,y:0,width:1920,height:1040}).width,520);
 assert.equal(taskWindowBounds('dialog',{x:0,y:0,width:1920,height:1040}).width,1280);
 assert.throws(()=>copyPayload({kind:'unknown'}));
});

test('Task stays primary-only on login and renewal; peers open only on explicit request',async()=>{
 const f=fixture();await f.controller.start();assert.equal(f.records.size,1);
 for(const action of ['open-all','dialog'])assert.equal((await f.call(action,{kind:'request'})).ok,false);
 assert.equal((await f.call('open',{view:'flow'})).ok,false);
 await f.login();assert.equal(f.records.size,1);
 await f.call('open-all');assert.equal(f.records.size,3);
 const flow=[...f.records.values()].find(r=>r.taskView==='flow');flow.window.destroy();
 await f.controller.session({record:f.root},'set',{token:'renewed',expectedRevision:1});assert.equal(f.records.size,2);
 await f.controller.session({record:f.root},'set',{token:'',expectedRevision:2});assert.equal(f.records.size,1);
 await f.controller.session({record:f.root},'set',{token:'again',expectedRevision:3});assert.equal(f.records.size,1);
});

test('Task prelogin primary closure exits without creating hidden windows',async()=>{
 const f=fixture();await f.controller.start();f.root.window.destroy();assert.equal(f.ended,1);assert.equal(f.created,0);
});

test('Task logout invalidates windows still opening after a login',async()=>{
 const f=fixture();let release;f.gate(new Promise(resolve=>release=resolve));
 await f.login();const opening=f.call('open',{view:'flow'});assert.equal(f.records.size,2);
 const logout=f.controller.session({record:f.root},'set',{token:'',expectedRevision:1});
 release();await Promise.all([opening,logout]);assert.deepEqual([...f.records.values()].map(r=>r.taskView),['request']);assert.equal(f.ended,0);
});

test('Task stale logout cannot clear newer login token',async()=>{
 const f=fixture();const event={record:f.root};
 await f.controller.session(event,'set',{token:'newer',expectedRevision:0});
 const stale=await f.controller.session(event,'set',{token:'',expectedRevision:0});
 assert.equal(stale.ok,false);assert.equal(stale.token,'newer');assert.equal(stale.revision,1);
 assert.equal((await f.controller.session(event,'get')).token,'newer');
});

// IDEの配置復元は主画面の認証を流用し、残す窓を先に開く。
test('Task layout restores flow/detail without leaving request or ending the shared service',async()=>{
 const f=fixture(true);
 assert.equal((await f.controller.restoreViews(['flow','detail'])).ok,true);
 assert.deepEqual([...f.records.values()].map(r=>r.taskView).sort(),['detail','flow']);assert.equal(f.ended,0);
 assert.equal((await f.controller.restoreViews(['flow','detail'])).ok,true);assert.equal(f.created,2);
 assert.equal((await f.controller.restoreViews(['dialog'])).ok,false);
 assert.equal((await fixture().controller.restoreViews(['flow'])).ok,false);
});
