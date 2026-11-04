// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {startDevelopment} from '../server.mjs';
import {createCoreConnection} from '../viewer/core-connection.mjs';
import {electronExecutable} from '../viewer/launch-options.mjs';
// 利用者のバックエンドは停止せず、検証用コアのHTTPサーバーだけを停止・再起動する。
const core=createServer((req,res)=>{req.resume();res.setHeader('content-type','application/json');res.end(JSON.stringify({status:'OK',data:{available_models:{},モデル設定:{}}}));});
const listen=port=>new Promise((done,reject)=>{core.once('error',reject);core.listen(port,'127.0.0.1',()=>{core.off('error',reject);done();});});
const closeCore=async()=>{if(core.listening){core.closeAllConnections();await new Promise(done=>core.close(done));}};
await listen(0);const port=core.address().port;
const project=fileURLToPath(new URL('../',import.meta.url));
const connection=createCoreConnection(project,{target:`http://127.0.0.1:${port}`,interval:200,timeout:300});
const server=await startDevelopment(project,{connection});
const profile=mkdtempSync(join(tmpdir(),'aidiy-core-stop-check-'));
try{
 const env={...process.env,AIDIY_DEVELOPMENT_URL:server.url,AIDIY_DEVELOPMENT_KIND:'ide',AIDIY_TEST_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;
 const child=spawn(electronExecutable(),[fileURLToPath(new URL('../checks/core-stop-probe.cjs',import.meta.url))],{env,windowsHide:false,stdio:['ignore','inherit','inherit','ipc']});
 let result,control=Promise.resolve();
 child.on('message',message=>{if(message.testPassed)result=message;if(message.core)control=control.then(()=>message.core==='stop'?closeCore():listen(port));});
 const [code]=await once(child,'exit');await control;if(code!==0||!result)throw Error(`コア停止・作業継続検証失敗: ${code}`);
 for(const url of result.urls){let alive=false;try{await fetch(url,{signal:AbortSignal.timeout(1000)});alive=true;}catch{}if(alive)throw Error('IDE明示終了後に子サーバーが残っています');}
 console.log('CORE STOP PASS: IDEの明示終了ではCode子窓と全サーバーを終了');
}finally{
 await server.close();connection.close();await closeCore();
 if(!resolve(profile).startsWith(resolve(tmpdir())+sep))throw Error('一時パスが不正です');
 rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
