const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {createChildProcessMonitor}=require('../デスクトップ/子窓状態確認.cjs');
test('initial scan is immediate, successful scans are shared for 30 seconds without sharing mutable results',async()=>{
 let calls=0,time=0;
 const read=createChildProcessMonitor({scan:async()=>{calls++;return new Set(['cpu']);},now:()=>time});
 const first=await read();first.add('task');
 time=29999;assert.deepEqual(await read(),new Set(['cpu']));assert.equal(calls,1);
 time=30000;await read();assert.equal(calls,2);
});
test('slow scan coalesces callers and caches from completion, not start',async()=>{
 let resolve,calls=0,time=0;
 const read=createChildProcessMonitor({scan:()=>{calls++;return new Promise(done=>resolve=done);},now:()=>time});
 const a=read(),b=read();await Promise.resolve();assert.equal(calls,1);
 time=19000;resolve(new Set(['team']));assert.deepEqual(await a,new Set(['team']));assert.deepEqual(await b,new Set(['team']));
 time=48000;await read();assert.equal(calls,1);
});
test('failure is reported, not converted into no running apps; next request retries',async()=>{
 let fail=false,time=0,calls=0;
 const read=createChildProcessMonitor({scan:async()=>{calls++;if(fail)throw Error('timeout');return new Set(['cpu']);},now:()=>time});
 await read();time=30000;fail=true;await assert.rejects(read(),/timeout/);
 fail=false;assert.deepEqual(await read(),new Set(['cpu']));assert.equal(calls,3);
});
test('monitor timeouts are isolated from explicit launch safety checks',()=>{
 const source=readFileSync(new URL('../desktop.cjs',`file://${__filename}`),'utf8');
 assert.match(source,/python:false,timeout:20000/);
 assert.match(source,/起動枠の使用中\(type,\{timeout:3000\}\)/);
 assert.match(source,/const running=await 単独起動中の部品\(__dirname\)/);
});
test('OS scan uses monitoring deadline without changing default launch deadline',async()=>{
 const vm=require('node:vm');const calls=[],module={exports:{}};
 vm.runInNewContext(readFileSync(require.resolve('../../scripts/アプリプロセス.cjs'),'utf8'),{
  module,process,Buffer,require:id=>id==='node:util'?{promisify:()=>async(file,args,options)=>{calls.push({file,options});return{stdout:'[]'};}}:require(id),
 });
 await module.exports.タスク一覧('win32',{python:false,timeout:20000});
 await module.exports.タスク一覧('win32',{python:false});
 assert.deepEqual(calls.map(x=>x.options.timeout),[20000,10000]);
});
test('port monitoring allows 3 seconds and timeout rejects rather than marking stopped',async()=>{
 const vm=require('node:vm'),{EventEmitter}=require('node:events');const sockets=[],module={exports:{}};
 vm.runInNewContext(readFileSync(require.resolve('../../scripts/アプリプロセス.cjs'),'utf8'),{
  module,process,Buffer,require:id=>id==='node:net'?{createServer(){},connect(){const s=new EventEmitter();s.setTimeout=(ms,fn)=>{s.ms=ms;s.expire=fn;};s.destroy=()=>{s.destroyed=true;};sockets.push(s);return s;}}:require(id),
 });
 const slow=module.exports.起動枠の使用中('cpu',{timeout:3000});assert.equal(sockets[0].ms,3000);
 sockets[0].expire();await assert.rejects(slow,/起動状態/);assert.equal(sockets[0].destroyed,true);
 const normal=module.exports.起動枠の使用中('cpu');assert.equal(sockets[1].ms,1000);
 sockets[1].emit('error',{code:'ECONNREFUSED'});assert.equal(await normal,false);
});
