// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {tmpdir} from 'node:os';
import {resolve,join,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {desktopBinary} from '../../backend_diag/起動/desktop.mjs';
const profile=await mkdtemp(join(tmpdir(),'discord-window-'));let child;
try{
 const env={...process.env,DISCORD_WINDOW_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;
 child=spawn(await desktopBinary(),[fileURLToPath(new URL('./window-behavior-probe.cjs',import.meta.url))],{env,windowsHide:true,stdio:['ignore','ignore','pipe','ipc']});
 let result,stderr='';child.stderr.on('data',chunk=>stderr+=chunk);child.on('message',message=>{if(message.testPassed)result=message;});
 const [code]=await once(child,'exit');assert.equal(code,0,stderr);assert.ok(result);console.log(JSON.stringify(result));
}finally{
 if(child?.exitCode===null){const ended=once(child,'exit');child.kill();await ended;}
 assert.ok(resolve(profile).startsWith(resolve(tmpdir())+sep));await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
