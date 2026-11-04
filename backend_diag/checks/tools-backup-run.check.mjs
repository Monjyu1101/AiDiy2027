// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {EventEmitter,getEventListeners} from 'node:events';
import {Readable} from 'node:stream';
import {createHandler} from '../diag_main.mjs';
import {createToolsRepresentativeBridge,createToolsSettingsBridge,TOOLS_SETTINGS_BODY_LIMIT,TOOLS_REPRESENTATIVE_BYTE_LIMIT,BACKUP_REPRESENTATIVE_TIMEOUT_MS,BACKUP_REPRESENTATIVE_RESPONSE_TIMEOUT_MS} from '../Tools/設定接続.mjs';
import {DIAG_TRANSPORT_BYTE_LIMIT} from '../runtime/transport_limit.mjs';
import {Tools代表テスト} from '../ui/src/components/Tools/Tools代表テスト.mjs';
const reader=async()=>JSON.stringify({PORT_CORE:8091,PORT_TOOLS:8095});
const envelope=(batch)=>({token:'fixture.jwt',data:{operation:'test',tool:'aidiy_backup',...(batch===undefined?{}:{batch})}});
const answer=(batch=false)=>({ok:true,batch,全件数:6000,バックアップ件数:3,バックアップ先:'/private/not-shown'});
const state={status:'OK',data:{tools:[{id:'aidiy_backup',enabled:true,available:true}]}};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{resolve,promise};};
const tick=()=>new Promise(r=>setImmediate(r));
function setup(response=answer(),options={}){
 const calls=[];
 const bridge=createToolsRepresentativeBridge({reader,...options,requestFn:async request=>{
  calls.push(request);
  if(request.path==='/core/auth/現在利用者')return{status:'OK'};
  if(request.path==='/management/enabled')return state;
  return typeof response==='function'?response(request):response;
 }});
 return{bridge,calls};
}
for(const batch of [undefined,false,true])test(`Backup ${String(batch)}: fixed save/run, exact batch and scoped 5-minute wait`,async()=>{
 const {bridge,calls}=setup(answer(batch??false));const result=await bridge(envelope(batch));
 assert.equal(result.status,'OK');assert.deepEqual(calls.map(r=>r.path),['/core/auth/現在利用者','/management/enabled','/aidiy_backup/save/run']);
 assert.deepEqual(calls[2].data,{batch:batch??false});assert.deepEqual(calls.map(r=>r.timeoutMs),[30000,30000,300000]);
 assert.ok(calls.every(r=>r.responseLimit===20*1024*1024));
 assert.match(result.data.summary,batch?/受付.*予定 3件.*完了は未確認/:/バックアップ完了: 3件/);
 assert.doesNotMatch(JSON.stringify(result),/private|バックアップ先|全件数/);
});
test('Backup batch is strict and unavailable/unauthenticated work never executes',async()=>{
 const {bridge,calls}=setup();
 for(const batch of [null,0,1,'true',{},[]])await assert.rejects(bridge(envelope(batch)),e=>e.status===400);
 for(const key of ['path','url','timeoutMs','destination'])await assert.rejects(bridge({...envelope(true),data:{...envelope(true).data,[key]:'bad'}}),e=>e.status===400);
 await assert.rejects(bridge({token:'fixture.jwt',data:{operation:'test',tool:'aidiy_logs',batch:true}}),e=>e.status===400);
 assert.equal(calls.length,0);
 for(const status of [{authExpired:true},{status:'OK',data:{tools:[{id:'aidiy_backup',enabled:false,available:true}]}}]){
  const paths=[];const gated=createToolsRepresentativeBridge({reader,requestFn:async r=>{paths.push(r.path);return r.path.includes('/core/')?status.authExpired?status:{status:'OK'}:status;}});
  assert.equal((await gated(envelope(true))).status,'NG');assert.ok(!paths.some(p=>p.endsWith('/save/run')));
 }
});
test('Backup rejects missing/mismatched batch and invalid or failed counts',async()=>{
 const cases=[{...answer(true),batch:false},{...answer(true),batch:undefined},{...answer(true),ok:false},{...answer(true),バックアップ件数:-1},{...answer(true),バックアップ件数:0.5},{...answer(true),全件数:NaN},{...answer(true),全件数:2},{...answer(true),全件数:Infinity},{...answer(true),バックアップ件数:Number.MAX_SAFE_INTEGER+1}];
 for(const response of cases)assert.equal((await setup(response).bridge(envelope(true))).status,'NG');
});
test('Backup UI defaults true, preserves false and describes real copies and acceptance',async()=>{
 const definition=Tools代表テスト.aidiy_backup;assert.deepEqual(definition.defaults,{batch:true});assert.equal(definition.batch,true);
 assert.match(definition.description,/実際に作成/);assert.match(definition.description,/開始済みコピーは止まりません/);assert.match(definition.description,/最長5分/);
 for(const input of [undefined,{batch:false},{batch:true}]){
  let sent;const result=await definition.run({input,call:async(action,data)=>{assert.equal(action,'Tools/representative');sent=data;return{summary:'fixture summary'};}});
  assert.equal(sent.batch,input?.batch??true);assert.deepEqual(Object.keys(sent).sort(),['batch','operation','tool']);assert.equal(result.message,'fixture summary');
 }
});
test('Backup timeout/cancel releases bridge ownership, never claims copy cancellation',async()=>{
 let pending=true;const {bridge}=setup(()=>pending?new Promise(()=>{}):answer(true),{backupTimeoutMs:5});
 await assert.rejects(bridge(envelope(true)),e=>e.status===503&&/継続している場合/.test(e.message));
 pending=false;assert.equal((await bridge(envelope(true))).status,'OK');
 const wait=deferred();const second=setup(()=>wait.promise,{backupTimeoutMs:1000});const controller=new AbortController();const run=second.bridge(envelope(true),{signal:controller.signal});await tick();controller.abort();
 await assert.rejects(run,e=>e.status===503&&/Toolsログ/.test(e.message));assert.equal(getEventListeners(controller.signal,'abort').length,0);
 wait.resolve(answer(true));await tick();assert.equal((await second.bridge(envelope(true))).status,'OK');
});

// No socket is opened: HTTP's request factory emits controlled byte chunks only.
function mockHttp(t,finalPayload,{stall=false}={}){
 const requests=[];const responses=[];let final;
 t.mock.method(http,'request',(options,callback)=>{
  const req=new EventEmitter();req.destroy=()=>{req.destroyed=true;};
  req.end=()=>queueMicrotask(()=>{
   const res=new EventEmitter();res.statusCode=200;res.complete=true;res.destroy=()=>{res.destroyed=true;};responses.push(res);callback(res);
   const path=decodeURI(options.path);let payload;
   if(path==='/core/auth/現在利用者')payload=Buffer.from('{"status":"OK"}');
   else if(path==='/management/enabled')payload=Buffer.from(JSON.stringify(state));
   else{final={req,res};if(stall){res.emit('data',Buffer.alloc(1024,32));return;}payload=finalPayload;}
   for(let start=0;start<payload.length;start+=32767){if(res.destroyed)break;res.emit('data',payload.subarray(start,start+32767));}
   if(!res.destroyed)res.emit('end');
  });requests.push(req);return req;
 });
 return{requests,responses,get final(){return final;}};
}
function sizedJson(size){
 const base=Buffer.from(JSON.stringify({...answer(true),padding:''}));
 // Include UTF-8 multibyte content crossing chunk boundaries; then valid trailing JSON whitespace.
 const prefix=Buffer.from(JSON.stringify({...answer(true),padding:'日本語'.repeat(12000)}));
 assert.ok(size>=prefix.length&&size>=base.length);return Buffer.concat([prefix,Buffer.alloc(size-prefix.length,32)]);
}
for(const delta of [-1,0,1])test(`Tools response cap 20MiB ${delta<0?'minus one':delta?'plus one':'exact'} uses bytes`,async t=>{
 assert.equal(DIAG_TRANSPORT_BYTE_LIMIT,20*1024*1024);assert.equal(TOOLS_SETTINGS_BODY_LIMIT,DIAG_TRANSPORT_BYTE_LIMIT);assert.equal(TOOLS_REPRESENTATIVE_BYTE_LIMIT,DIAG_TRANSPORT_BYTE_LIMIT);
 const io=mockHttp(t,sizedJson(DIAG_TRANSPORT_BYTE_LIMIT+delta));const controller=new AbortController();const bridge=createToolsRepresentativeBridge({reader});
 if(delta>0)await assert.rejects(bridge(envelope(true),{signal:controller.signal}),e=>e.status===503);
 else assert.equal((await bridge(envelope(true),{signal:controller.signal})).status,'OK');
 assert.ok(io.requests.every(r=>r.destroyed));assert.ok(io.responses.every(r=>r.destroyed));assert.equal(getEventListeners(controller.signal,'abort').length,0);
 // A late event cannot reopen a completed request or retain received chunk buffers.
 io.final.res.emit('data',Buffer.alloc(1024));io.final.res.emit('end');
});
test('formerly failing 401KB Backup response now succeeds with compact result',async t=>{
 mockHttp(t,sizedJson(401000));const result=await createToolsRepresentativeBridge({reader})(envelope(true));
 assert.equal(result.status,'OK');assert.ok(Buffer.byteLength(JSON.stringify(result))<1024);
});
test('mid-response cancel destroys request/response and removes listeners',async t=>{
 const io=mockHttp(t,Buffer.alloc(0),{stall:true});const controller=new AbortController();const bridge=createToolsRepresentativeBridge({reader});const run=bridge(envelope(true),{signal:controller.signal});await tick();
 assert.ok(io.final);controller.abort();await assert.rejects(run,e=>e.status===503);assert.ok(io.final.req.destroyed&&io.final.res.destroyed);assert.equal(getEventListeners(controller.signal,'abort').length,0);
});
test('Tools management response also accepts above old 256KiB and rejects over 20MiB',async t=>{
 for(const size of [400000,DIAG_TRANSPORT_BYTE_LIMIT+1]){
  const fixture=Buffer.from('{"status":"OK","data":{}}');const io=mockHttp(t,Buffer.concat([fixture,Buffer.alloc(size-fixture.length,32)]));
  const bridge=createToolsSettingsBridge({reader});
  // Use defaults, not the representative /management/enabled fixture interception.
  if(size>DIAG_TRANSPORT_BYTE_LIMIT)await assert.rejects(bridge('defaults',{token:'fixture.jwt',data:{}}),e=>e.status===503);
  else assert.equal((await bridge('defaults',{token:'fixture.jwt',data:{}})).status,'OK');
  assert.ok(io.requests.every(r=>r.destroyed));t.mock.restoreAll();
 }
});

function socket(){return{timeout:305000,destroyed:false,changes:[],setTimeout(value){this.timeout=value;this.changes.push(value);}};}
function request(handler,{body=envelope(true),route='Tools/representative',sock=socket(),auth=true,raw,unassigned=false}={}){
 const req=Readable.from([raw??Buffer.from(JSON.stringify(body))]);Object.assign(req,{socket:sock,url:'/api/'+route,method:'POST',headers:{authorization:auth?'Bearer diag-fixture':'','content-type':'application/json',host:'127.0.0.1:8097'}});
 const res=unassigned?new http.ServerResponse(req):new EventEmitter();Object.assign(res,{writeHead(status){this.status=status;},end(value){this.body=JSON.parse(value);if(!unassigned)this.writableEnded=true;}});
 if(!unassigned)res.setTimeout=value=>sock.setTimeout(value);
 return{req,res,sock,done:handler(req,res)};
}
test('Backup outer wait is route-only and restores on success/error/disconnect',async()=>{
 for(const ending of ['success','error','cancel']){
  const wait=deferred();let signal;const handler=createHandler({token:'diag-fixture',toolsRepresentativeBridge:async(_body,options)=>{signal=options.signal;await wait.promise;if(ending==='error')throw Error('secret');return{status:'OK'};}});
  const run=request(handler);await tick();assert.equal(run.sock.timeout,BACKUP_REPRESENTATIVE_RESPONSE_TIMEOUT_MS);assert.equal(BACKUP_REPRESENTATIVE_TIMEOUT_MS,300000);
  if(ending==='cancel'){run.res.destroyed=true;run.res.emit('close');assert.equal(signal.aborted,true);}
  wait.resolve();await run.done;assert.equal(run.sock.timeout,305000);assert.equal(run.res.listenerCount('close'),0);assert.deepEqual(run.sock.changes,[370000,305000]);
 }
 for(const options of [{auth:false},{body:{token:'fixture.jwt',data:{operation:'test',tool:'aidiy_logs'}}},{route:'Tools/enabled',body:{token:'fixture.jwt',data:{}}}]){
  const run=request(createHandler({token:'diag-fixture',toolsRepresentativeBridge:async()=>({status:'OK'}),toolsSettingsBridge:async()=>({status:'OK'})}),options);await run.done;assert.deepEqual(run.sock.changes,[]);
 }
});
test('Backup overlapping and reused socket restores only final owner and never overwrites external timeout',async()=>{
 const waits=[deferred(),deferred(),deferred()];let count=0;const handler=createHandler({token:'diag-fixture',toolsRepresentativeBridge:()=>waits[count++].promise});const shared=socket();
 const first=request(handler,{sock:shared});const second=request(handler,{sock:shared});await tick();assert.equal(shared.timeout,370000);
 waits[1].resolve({status:'OK'});await second.done;assert.equal(shared.timeout,370000);waits[0].resolve({status:'OK'});await first.done;assert.equal(shared.timeout,305000);
 const reused=request(handler,{sock:shared});await tick();assert.equal(shared.timeout,370000);shared.setTimeout(123456);waits[2].resolve({status:'OK'});await reused.done;assert.equal(shared.timeout,123456);
 const wait=deferred();const closed=request(createHandler({token:'diag-fixture',toolsRepresentativeBridge:()=>wait.promise}));await tick();closed.sock.destroyed=true;wait.resolve({status:'OK'});await closed.done;assert.deepEqual(closed.sock.changes,[370000]);
});
test('Diag request cap is 20MiB across Tools, AI settings, launch, start and manual models',async()=>{
 const routes=['Tools/representative','Tools/enabled','AI設定/ログイン','CLI起動/開始','VSCode起動/開始','アプリ起動/フォルダ','起動/設定','AIモデル/開始'];
 const handler=createHandler({token:'diag-fixture',toolsRepresentativeBridge:async()=>({status:'OK'}),toolsSettingsBridge:async()=>({status:'OK'}),coreSettingsBridge:async()=>({status:'OK'}),cliLauncher:{launch:async()=>({})},vscodeLauncher:{launch:async()=>({})},appLauncher:{folders:async()=>({})},startManager:{save:async()=>({})},modelTrials:{start:async()=>({})}});
 for(const route of routes){
  for(const delta of [-1,0,1]){
   const raw=Buffer.alloc(DIAG_TRANSPORT_BYTE_LIMIT+delta,32);raw.write('{}');const run=request(handler,{route,raw});await run.done;
   assert.equal(run.res.status,delta>0?413:route.includes('起動/開始')?202:200,route+' '+delta);
  }
 }
});

test('Tools late headers after cancel are destroyed and synchronous transport errors clean listeners',async t=>{
 let respond;const pendingRequest=new EventEmitter();pendingRequest.end=()=>{};pendingRequest.destroy=()=>{pendingRequest.destroyed=true;};
 t.mock.method(http,'request',(_options,callback)=>{respond=callback;return pendingRequest;});
 const controller=new AbortController();const bridge=createToolsSettingsBridge({reader});const run=bridge('defaults',{token:'fixture.jwt',data:{}},{signal:controller.signal});await tick();controller.abort();await assert.rejects(run,e=>e.status===503);
 const late=new EventEmitter();late.destroy=()=>{late.destroyed=true;};respond(late);assert.equal(late.destroyed,true);assert.equal(late.listenerCount('data'),0);assert.equal(getEventListeners(controller.signal,'abort').length,0);
 t.mock.restoreAll();t.mock.method(http,'request',()=>{throw Error('private transport error');});const next=new AbortController();await assert.rejects(bridge('defaults',{token:'fixture.jwt',data:{}},{signal:next.signal}),e=>e.status===503&&!e.message.includes('private'));assert.equal(getEventListeners(next.signal,'abort').length,0);
});

test('pipelined ServerResponse without assigned socket cannot restore a stale long timeout later',async()=>{
 const waits=[deferred(),deferred()];let count=0;const handler=createHandler({token:'diag-fixture',toolsRepresentativeBridge:()=>waits[count++].promise});const shared=socket();
 const first=request(handler,{sock:shared});const second=request(handler,{sock:shared,unassigned:true});await tick();
 assert.equal(second.res.socket,null);assert.equal(second.res.listenerCount('socket'),0);assert.equal(shared.timeout,370000);
 waits[1].resolve({status:'OK'});await second.done;waits[0].resolve({status:'OK'});await first.done;assert.equal(shared.timeout,305000);
 second.res.emit('socket',shared);assert.equal(shared.timeout,305000);assert.equal(second.res.listenerCount('socket'),0);
});
