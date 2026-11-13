// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {stopRevision,watchStop} from '../diag/起動/lifecycle.mjs';
test('cleanup marker persists across short cleanup, old marker does not stop new instance',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'diag-stop-')),file=path.join(directory,'stop');let stop=()=>{};
 try {await writeFile(file,'a'.repeat(32));const initial=await stopRevision(file);let closed=0;stop=watchStop(initial,()=>closed++,file,10);await new Promise(r=>setTimeout(r,30));assert.equal(closed,0);await writeFile(file,'b'.repeat(32));for(let i=0;i<200&&!closed;i++)await new Promise(r=>setTimeout(r,10));assert.equal(closed,1);assert.equal(await stopRevision(file),'b'.repeat(32));}
 finally {stop();await rm(directory,{recursive:true,force:true});}
});

test('停止通知は既定1秒で監視し、解除済みの進行中確認からcloseしない',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'diag-stop-cancel-')),file=path.join(directory,'stop');
 t.after(()=>rm(directory,{recursive:true,force:true}));await writeFile(file,'b'.repeat(32));
 let tick,period,closed=0,cleared=0;
 t.mock.method(globalThis,'setInterval',(callback,ms)=>{tick=callback;period=ms;return {unref(){}};});
 t.mock.method(globalThis,'clearInterval',()=>{cleared++;});
 const stop=watchStop('a'.repeat(32),()=>closed++,file);assert.equal(period,1000);
 const inFlight=tick();stop();await inFlight;await tick();assert.equal(closed,0);assert.equal(cleared,1);
});
