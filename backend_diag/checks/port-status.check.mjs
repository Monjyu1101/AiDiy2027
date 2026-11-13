// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer as tcpServer} from 'node:net';
import {EventEmitter} from 'node:events';
import {createPortStatusChecker,checkPort} from '../diag/起動/ポート状態.mjs';
import {createServer} from '../diag/diag_main.mjs';

test('actual TCP open/closed/reopened server is detected without payload or ownership',async()=>{
 let bytes=0;const sockets=new Set();
 const server=tcpServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('data',data=>bytes+=data.length);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
 const check=createPortStatusChecker({targets:[{id:'core',名前:'Core',ポート:port}]});
 try{
  assert.equal((await check()).対象[0].開放,true);
  for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));
  assert.equal((await check()).対象[0].開放,false);
  await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));assert.equal((await check()).対象[0].開放,true);
  assert.equal(server.listening,true);assert.equal(bytes,0);
 }finally{for(const socket of sockets)socket.destroy();if(server.listening)await new Promise(resolve=>server.close(resolve));}
});
test('timeouts, failures and cancellation are unknown, not a stale open result; sockets are destroyed',async()=>{
 const sockets=[],connect=options=>{assert.equal(options.host,'127.0.0.1');const socket=new EventEmitter();socket.destroy=()=>{socket.destroyed=true;};sockets.push(socket);return socket;};
 assert.equal(await checkPort(8091,{timeoutMs:15,connect}),null);assert.equal(sockets[0].destroyed,true);
 const controller=new AbortController(),pending=checkPort(8091,{connect,signal:controller.signal});controller.abort();assert.equal(await pending,null);assert.equal(sockets[1].destroyed,true);
 assert.equal(await checkPort(8091,{connect,signal:controller.signal}),null);assert.equal(sockets.length,2);
 assert.equal(await checkPort(8091,{connect(){throw Error('private details');}}),null);
});
test('catalog selects only six server targets; all checks are parallel with fixed loopback ports',async()=>{
 const seen=[],release=[];const check=createPortStatusChecker({probe:(port,{signal})=>{seen.push(port);assert.equal(signal,undefined);return new Promise(resolve=>release.push(resolve));}});
 const pending=check();while(release.length<6)await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(seen,[8096,8095,8091,8098,8093,8090]);for(const [i,done] of release.entries())done(i%2===0);
 const result=await pending;assert.deepEqual(result.対象.map(item=>item.id),['local','tools','core','apps','taskteam','web']);assert.ok(result.確認日時);assert.ok(result.対象.every(item=>Object.keys(item).length===4));
});
test('port API authenticates and accepts no caller-selected host, port, body or mutation',async()=>{
 let samples=0;const server=createServer({token:'fixture',portStatusFn:async({signal})=>{samples++;assert.ok(signal);return {対象:[{id:'core',ポート:8091,開放:true}]};},modelTrials:{close(){}},startManager:{close(){}}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}/api/起動/ポート`,headers={Authorization:'Bearer fixture'};
 try{
  assert.equal((await fetch(base)).status,401);assert.equal(samples,0);
  assert.equal((await fetch(base+'?port=1',{headers})).status,400);assert.equal((await fetch(base,{method:'POST',headers,body:'{}'})).status,404);assert.equal(samples,0);
  const response=await fetch(base,{headers});assert.equal(response.status,200);assert.equal((await response.json()).対象[0].開放,true);assert.equal(samples,1);
 }finally{await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});}
});
