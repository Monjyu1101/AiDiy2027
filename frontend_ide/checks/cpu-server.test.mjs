// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {startDevelopment} from '../server.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
test('IDE metrics require active session, reject other methods and origins, return actual sample',async t=>{
 const project=await mkdtemp(join(tmpdir(),'cpu-server-'));let active=false;
 const app=await startDevelopment(project,{connection:{state:()=>({active,mode:'offline',startedAt:1,project:{path:project,name:'test'}}),close(){}}});
 t.after(async()=>{await app.close();await rm(project,{recursive:true,force:true});});
 const url=new URL('/api/system-metrics',app.url);
 assert.equal((await fetch(url)).status,409);active=true;
 assert.equal((await fetch(url,{method:'POST'})).status,405);
 assert.equal((await fetch(url,{headers:{Origin:'http://evil.example'}})).status,403);
 const response=await fetch(url);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
 const data=await response.json();assert.ok(Number.isFinite(data.timestamp));
 for(const key of ['cpu','gpu','ram'])assert.ok(data[key]===null||typeof data[key]==='number'&&data[key]>=0&&data[key]<=100);
 assert.equal(data.gpuStatus,data.gpu===null?'unavailable':'available');
});


test('standalone CPU needs no Core/Tools and exposes no file or AI actions',async t=>{
 const project=await mkdtemp(join(tmpdir(),'cpu-standalone-'));
 const app=await startDevelopment(project,{kind:'cpu'});
 t.after(async()=>{await app.close();await rm(project,{recursive:true,force:true});});
 const get=path=>fetch(new URL(path,app.url));
 const config=await get('/development/config').then(r=>r.json());assert.equal(config.kind,'cpu');
 const state=await get('/api/connection').then(r=>r.json());assert.equal(state.active,true);assert.equal(state.connected,false);assert.equal(state.mode,'offline');
 assert.equal((await get('/api/system-metrics')).status,200);
 for(const path of ['/api/tree','/api/file','/api/navigation','/api/browser-analysis','/api/connection/connect','/arbitrary'])assert.equal((await get(path)).status,404,path);
 for(const path of ['/api/connection/connect','/api/connection/disconnect','/api/panels/code','/api/system-metrics'])assert.equal((await fetch(new URL(path,app.url),{method:'POST'})).status,405,path);
});

test('CPU launcher rejects unrelated connection, model and CLI flags',async()=>{
 const {launch}=await import('../launch.mjs');
 for(const flags of [['--connect'],['--offline'],['--provider','openai'],['--model','auto'],['--cli','codex'],['--cli-auto-approve']])await assert.rejects(launch('cpu',flags),/CPUはシステム計測専用/);
});
