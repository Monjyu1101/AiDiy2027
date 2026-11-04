// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createServer} from '../diag_main.mjs';
async function fixture(fn){const server=createServer({token:'fixture',toolsStatusFn:fn});await new Promise(r=>server.listen(0,'127.0.0.1',r));return {server,url:`http://127.0.0.1:${server.address().port}/api/tools-status`,close:()=>{server.closeAllConnections();server.close();}};}
test('Tools route requires auth, uses relative route, and exposes boolean only',async()=>{
 let calls=0;const f=await fixture(async()=>{calls++;return {online:true,secret:'NEVER'};});
 try{assert.equal((await fetch(f.url)).status,401);assert.equal(calls,0);const r=await fetch(f.url,{headers:{Authorization:'Bearer fixture'}});assert.deepEqual(await r.json(),{online:true});assert.equal(calls,1);assert.equal((await fetch(f.url+'?port=1',{headers:{Authorization:'Bearer fixture'}})).status,400);}finally{f.close();}
});
test('closing request cancels pending local Tools check',async()=>{
 let started;const ready=new Promise(r=>started=r);let aborted;const stopped=new Promise(r=>aborted=r);const f=await fixture(({signal})=>{started();return new Promise(resolve=>signal.addEventListener('abort',()=>{aborted();resolve({online:false});}));});
 try{const request=http.get(f.url,{headers:{Authorization:'Bearer fixture'}});request.on('error',()=>{});await ready;request.destroy();await stopped;}finally{f.close();}
});
