// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// HTTP は全てメモリ上の偽transport。待受・API・CLIを起動しない。
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import {EventEmitter,getEventListeners} from 'node:events';
import {StringDecoder} from 'node:string_decoder';
import {Readable} from 'node:stream';
import {createHandler} from '../diag/diag_main.mjs';
import {createModelRunner} from '../runtime/model_runner.mjs';
import {createRequire} from 'node:module';
import {DIAG_TRANSPORT_BYTE_LIMIT as LIMIT} from '../runtime/transport_limit.mjs';
import {AI_SETTINGS_BODY_LIMIT,createCoreSettingsBridge} from '../diag/AI設定/コア設定接続.mjs';
import {TOOLS_RESPONSE_LIMIT,createToolsStatusChecker} from '../diag/診断/tools_status.mjs';
import {createTaskTeamStatus} from '../diag/起動/TaskTeam接続.mjs';
import {CONFIG_LIMIT,RESPONSE_LIMIT,PUBLIC_RESPONSE_LIMIT,fetchMetadata,readConfig,readCodexLocal} from '../runtime/model_probe.mjs';
import {localRequest} from '../diag/モデル試行/trials.mjs';
const {起動状態を読む}=createRequire(import.meta.url)('../diag/起動/終了確認.cjs');

// 日本語を含め、指定byte数ぴったりの正当なJSONを作る。UTF-8途中でも分割して配送する。
function jsonBytes(body,size){
 const base=JSON.stringify({...body,padding:''}),remaining=size-Buffer.byteLength(base);
 assert.ok(remaining>=0);
 const bytes=Buffer.from(JSON.stringify({...body,padding:'あ'.repeat(Math.floor(remaining/3))+' '.repeat(remaining%3)}));
 assert.equal(bytes.length,size);return bytes;
}
async function fakeTransport(handler,run){
 const original={request:http.request,get:http.get,secure:https.request};
 const proxy=Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(https?_proxy|no_proxy)$/i.test(key)));
 for(const key of Object.keys(proxy))delete process.env[key];
 const requests=[],responses=[];
 function request(options,callback){
  const req=new EventEmitter();req.options=options;req.destroyed=false;req.destroyCount=0;
  req.destroy=()=>{req.destroyed=true;req.destroyCount++;};
  req.end=()=>queueMicrotask(()=>handler(options,callback,req));requests.push(req);return req;
 }
 function incoming(callback,headers={'content-type':'application/json'}){
  const res=new EventEmitter();Object.assign(res,{statusCode:200,headers,complete:false,destroyed:false,destroyCount:0});
  let decoder;
  res.setEncoding=encoding=>{decoder=new StringDecoder(encoding);};
  res.destroy=()=>{res.destroyed=true;res.destroyCount++;};
  res.deliver=bytes=>{
   for(let offset=0;offset<bytes.length&&!res.destroyed;offset+=65537){const chunk=bytes.subarray(offset,offset+65537);res.emit('data',decoder?decoder.write(chunk):chunk);}
   if(!res.destroyed){if(decoder){const tail=decoder.end();if(tail)res.emit('data',tail);}res.complete=true;res.emit('end');}
  };
  responses.push(res);callback(res);return res;
 }
 http.request=https.request=request;
 http.get=(url,options,callback)=>{const req=request({...options,url},callback);req.end();return req;};
 try{await run({incoming,requests,responses});}finally{http.request=original.request;http.get=original.get;https.request=original.secure;Object.assign(process.env,proxy);}
}
const cases=[
 {name:'Core settings',body:{status:'OK',data:{利用者ID:'fixture'}},call:signal=>createCoreSettingsBridge({reader:()=> '{}'})('現在利用者',{token:'fixture.jwt',data:{}},{signal}),ok:r=>r.status==='OK',rejects:true},
 {name:'Tools ping',body:{status:'ok',name:'aidiy_code_agents'},call:signal=>createToolsStatusChecker({reader:()=> '{}'} )({signal}),ok:r=>r.online===true},
 {name:'TaskTeam health',body:{status:'OK',service:'backend_taskteam'},call:()=>createTaskTeamStatus({root:'/synthetic',reader:()=> '{}'})(),ok:r=>r.利用可能===true},
 {name:'model metadata',body:{data:[]},call:signal=>fetchMetadata('openai',{},undefined,signal),ok:r=>Array.isArray(r.data),rejects:true},
 {name:'public metadata',body:{data:[]},call:signal=>fetchMetadata('openrouter',{},undefined,signal),ok:r=>Array.isArray(r.data),rejects:true},
 {name:'model trial',body:{id:1,result:{ok:true}},call:signal=>localRequest({port:8095,path:'/mcp',id:1,signal}),ok:r=>r.body.result.ok===true,rejects:true},
 {name:'close status',body:{終了時停止あり:false},call:()=>起動状態を読む('http://127.0.0.1:8097/#token=fixture'),ok:r=>r.終了時停止あり===false,rejects:true},
];
test('transport constants are exactly 20 MiB; configuration file and model-cache limits stay separate',async()=>{
 assert.equal(LIMIT,20*1024*1024);
 for(const value of [AI_SETTINGS_BODY_LIMIT,TOOLS_RESPONSE_LIMIT,RESPONSE_LIMIT,PUBLIC_RESPONSE_LIMIT])assert.equal(value,LIMIT);
 assert.equal(CONFIG_LIMIT,128*1024);
 assert.equal((await readConfig(()=> ' '.repeat(CONFIG_LIMIT+1)))[0],'読込不可');
 const oversized=JSON.stringify({models:[{slug:'synthetic/model'}],padding:' '.repeat(1024*1024)});
 assert.deepEqual((await readCodexLocal(name=>name==='config.toml'?'model="synthetic/default"':oversized,{},'/synthetic')).cacheIds,[]);
});
for(const item of cases)for(const delta of [-1,0,1])test(`${item.name}: UTF-8 response ${delta<0?'under':delta===0?'exact':'over'} 20 MiB`,async()=>{
 const bytes=jsonBytes(item.body,LIMIT+delta);let wire;
 await fakeTransport((_options,callback)=>wire.incoming(callback).deliver(bytes),async fixture=>{
  wire=fixture;
  if(delta>0&&item.rejects)await assert.rejects(item.call());
  else assert.equal(item.ok(await item.call()),delta<=0);
  assert.equal(fixture.requests.length,1);assert.equal(fixture.responses.length,1);
  assert.equal(fixture.requests[0].destroyed,true);assert.equal(fixture.responses[0].destroyed,true);
  // 終了後の余分なdata/endが再解釈・蓄積されないことも確認。
  fixture.responses[0].emit('data',Buffer.from('late'));fixture.responses[0].emit('end');
 });
});
for(const item of cases.filter(x=>!['TaskTeam health','close status'].includes(x.name)))test(`${item.name}: cancellation destroys both streams and detaches abort listener`,async()=>{
 const controller=new AbortController();let wire;
 await fakeTransport((_options,callback)=>{
  const res=wire.incoming(callback);res.emit('data',Buffer.from('{"padding":"あ'));
  controller.abort();res.emit('data',Buffer.from('late'));res.emit('end');
 },async fixture=>{
  wire=fixture;
  if(item.rejects)await assert.rejects(item.call(controller.signal));else assert.equal(item.ok(await item.call(controller.signal)),false);
  assert.equal(fixture.requests[0].destroyed,true);assert.equal(fixture.responses[0].destroyed,true);
  assert.equal(getEventListeners(controller.signal,'abort').length,0);
 });
});
test('close status rejects interrupted body and refuses remote targets before any transport',async()=>{
 let wire;
 await fakeTransport((_options,callback)=>{const res=wire.incoming(callback);res.emit('data',Buffer.from('{'));res.emit('aborted');},async fixture=>{
  wire=fixture;await assert.rejects(起動状態を読む('http://127.0.0.1:8097/#token=fixture'),/interrupted/);
  assert.equal(fixture.requests[0].destroyed,true);assert.equal(fixture.responses[0].destroyed,true);
  assert.throws(()=>起動状態を読む('https://example.invalid/#token=fixture'),/invalid/);
  assert.equal(fixture.requests.length,1);
 });
});
test('trial SSE uses the same bounded total bytes, not per-event allowance',async()=>{
 let wire;
 const message='data: '+JSON.stringify({id:1,result:{ok:true}})+'\n\n';
 await fakeTransport((_options,callback)=>{
  const res=wire.incoming(callback,{'content-type':'text/event-stream'});
  res.emit('data',':'+ ' '.repeat(LIMIT-message.length-4)+'\n\n');
  res.emit('data',message);res.emit('end');
 },async fixture=>{wire=fixture;assert.equal((await localRequest({port:8095,path:'/mcp',id:1})).body.result.ok,true);});
 await fakeTransport((_options,callback)=>{
  const res=wire.incoming(callback,{'content-type':'text/event-stream'});
  res.emit('data',':'+ ' '.repeat(LIMIT-message.length)+'\n\n');
  res.emit('data',message);res.emit('end');
 },async fixture=>{wire=fixture;await assert.rejects(localRequest({port:8095,path:'/mcp',id:1}),/上限/);assert.equal(fixture.responses[0].destroyed,true);});
});

for(const lengthHeader of [false,true])for(const delta of [-1,0,1])test(`Core settings request: ${lengthHeader?'Content-Length':'chunked'} ${delta} byte boundary`,async()=>{
 const bytes=jsonBytes({data:{利用者ID:'fixture',パスワード:'fixture'}},LIMIT+delta);let called=0;
 const handler=createHandler({token:'fixture',coreSettingsBridge:async()=>{called++;return {status:'OK'};}});
 const chunks=[];for(let offset=0;offset<bytes.length;offset+=65537)chunks.push(bytes.subarray(offset,offset+65537));
 const req=Readable.from(chunks);
 Object.assign(req,{url:'/api/AI設定/'+encodeURIComponent('ログイン'),method:'POST',headers:{authorization:'Bearer fixture','content-type':'application/json',host:'127.0.0.1:8097',...(lengthHeader?{'content-length':String(bytes.length)}:{})}});
 const res={writeHead(status){this.status=status;},end(){}};
 await handler(req,res);assert.equal(res.status,delta>0?413:200);assert.equal(called,delta>0?0:1);
});
for(const delta of [-1,0,1])test(`model runner relay input: ${delta} byte boundary`,async()=>{
 const input=JSON.parse(jsonBytes({},LIMIT+delta).toString('utf8'));
 const result=await createModelRunner().run('test','local',{input,reader:()=>assert.fail('fixed local model must not read config'),fetch:()=>assert.fail('fixed local model must not fetch')});
 assert.equal(result.error,delta>0?'input':undefined);if(delta<=0)assert.equal(result.data.状態,'PASS');
});
test('close status keeps finite timeout, releases incomplete response, and next request can succeed',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let wire;
 await fakeTransport((_options,callback)=>{wire.incoming(callback);t.mock.timers.tick(3000);},async fixture=>{
  wire=fixture;await assert.rejects(起動状態を読む('http://127.0.0.1:8097/#token=fixture'),/timeout/);
  assert.equal(fixture.requests[0].destroyed,true);assert.equal(fixture.responses[0].destroyed,true);
 });
 t.mock.timers.reset();
 await fakeTransport((_options,callback)=>wire.incoming(callback).deliver(Buffer.from('{"終了時停止あり":false}')),async fixture=>{
  wire=fixture;assert.equal((await 起動状態を読む('http://127.0.0.1:8097/#token=fixture')).終了時停止あり,false);
 });
});
