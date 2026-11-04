// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {electronExecutable} from '../viewer/launch-options.mjs';
const profile=await mkdtemp(join(tmpdir(),'aidiy-pin-order-'));
try{
 const env={...process.env,AIDIY_TEST_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;
 const child=spawn(electronExecutable(),[fileURLToPath(new URL('../checks/ide-pin-order-desktop.cjs',import.meta.url))],{env,windowsHide:true,stdio:['ignore','inherit','inherit','ipc']});
 let result;child.on('message',value=>{if(value.testPassed)result=value;});const [code]=await once(child,'exit');assert.equal(code,0);assert.ok(result?.testPassed);
}finally{assert.ok(resolve(profile).startsWith(resolve(tmpdir())+sep));await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
