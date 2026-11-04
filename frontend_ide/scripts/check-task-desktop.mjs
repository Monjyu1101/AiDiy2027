// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startDevelopment } from '../server.mjs';
import { electronExecutable } from '../viewer/launch-options.mjs';
const project=mkdtempSync(join(tmpdir(),'aidiy-task-project-')),profile=mkdtempSync(join(tmpdir(),'aidiy-task-electron-'));
const server=await startDevelopment(project,{kind:'task'});
try{
 const env={...process.env,AIDIY_DEVELOPMENT_URL:server.url,AIDIY_DEVELOPMENT_KIND:'task',AIDIY_TEST_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;
 const child=spawn(electronExecutable(),[fileURLToPath(new URL('../checks/task-desktop-probe.cjs',import.meta.url))],{env,windowsHide:false,stdio:['ignore','inherit','inherit','ipc']});
 let passed=false;child.on('message',v=>{if(v.testPassed)passed=true;});
 const [code]=await once(child,'exit');if(code!==0||!passed)throw Error(`Task実機試験失敗: ${code}`);
 console.log('Task実Electron: 認証・全主画面再表示・ログアウト復元・再ログイン・全終了 OK');
}finally{
 await server.close();
 for(const path of [profile,project]){if(!path.startsWith(join(tmpdir(),'aidiy-task-')))throw Error('一時パス不正');rmSync(path,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
}
