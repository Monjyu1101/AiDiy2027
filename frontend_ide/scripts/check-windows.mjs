// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {startDevelopment} from '../server.mjs';
import {electronExecutable} from '../viewer/launch-options.mjs';
const project=fileURLToPath(new URL('../',import.meta.url));
let state={active:false,mode:'idle',project:{path:project,name:'frontend_ide'}},counter=0;
const start=mode=>(state={...state,mode,active:true,connected:mode==='online',startedAt:Date.now()+(counter++)});
const connection={state:()=>state,connect:async()=>start('online'),offline:()=>start('offline'),disconnect:()=>state={...state,active:false,connected:false},close(){}};
const server=await startDevelopment(project,{connection});
const profile=mkdtempSync(join(tmpdir(),'aidiy-windows-check-'));
try{
 const env={...process.env,AIDIY_DEVELOPMENT_URL:server.url,AIDIY_DEVELOPMENT_KIND:'ide',AIDIY_TEST_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;
 const child=spawn(electronExecutable(),[fileURLToPath(new URL('../checks/windows-probe.cjs',import.meta.url)),'--use-fake-device-for-media-stream'],{env,windowsHide:false,stdio:['ignore','inherit','inherit','ipc']});
 let result;child.on('message',message=>{if(message.testPassed)result=message;});
 const [code]=await once(child,'exit');if(code!==0||!result)throw Error(`別ウィンドウ検証失敗: ${code}`);
 for(const url of result.urls){let alive=false;try{await fetch(url,{signal:AbortSignal.timeout(2000)});alive=true;}catch{}if(alive)throw Error('子サーバーが終了していません。');}
}finally{await server.close();rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
