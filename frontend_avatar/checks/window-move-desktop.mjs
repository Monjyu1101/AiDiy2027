// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// Diagと共有する導入済みElectronで、隔離プロファイルの窓だけを生成する。
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {tmpdir} from 'node:os';
import {resolve,join,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {desktopBinary} from '../../frontend_diag/diag/起動/desktop.mjs';
const profile=await mkdtemp(join(tmpdir(),'avatar-window-move-'));let child;
try{
 const env={...process.env,AVATAR_MOVE_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;
 child=spawn(await desktopBinary(),[fileURLToPath(new URL('./window-move-probe.cjs',import.meta.url))],{env,windowsHide:true,stdio:['ignore','ignore','pipe','ipc']});
 let result,stderr='';child.stderr.on('data',chunk=>stderr+=chunk);child.on('message',message=>{if(message.testPassed)result=message;});
 const [code]=await once(child,'exit');assert.equal(code,0,stderr);assert.ok(result);
 await mkdir(resolve('temp/window-move-check'),{recursive:true});await writeFile(resolve('temp/window-move-check/avatar-result.json'),JSON.stringify(result,null,2));
 console.log(JSON.stringify({testPassed:true,roles:result.roles,count:result.results.length,openingCount:result.openingCount}));
}finally{
 if(child?.exitCode===null){const ended=once(child,'exit');child.kill();await ended;}
 assert.ok(resolve(profile).startsWith(resolve(tmpdir())+sep));await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
