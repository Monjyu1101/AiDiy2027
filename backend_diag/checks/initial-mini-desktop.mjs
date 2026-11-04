// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 合成Tools稼働・実Electron。実サービスやAIへは接続しない。
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {tmpdir} from 'node:os';
import {resolve,join,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from '../diag_main.mjs';
import {desktopBinary} from '../起動/desktop.mjs';
import {createAppLauncher} from '../起動/アプリ起動.mjs';
const profile=await mkdtemp(join(tmpdir(),'diag-initial-mini-')),output=resolve('temp/diag-initial-mini.png');await mkdir(resolve('temp'),{recursive:true});
const catalog=JSON.parse(await readFile(new URL('../../scripts/起動対象.json',import.meta.url),'utf8')).filter(item=>item.起動管理!==false);
const token='a'.repeat(43),server=createServer({token,entries:[],coverage:{},toolsStatusFn:async()=>({online:true}),appLauncher:createAppLauncher({root:profile,taskTeamStatus:async()=>({利用可能:false}),portStatusFn:async()=>({対象:[]})}),
 portStatusFn:async()=>({対象:catalog.map(item=>({...item,開放:item.id==='tools'}))}),
 startManager:{snapshot:async()=>({対象:catalog.map(item=>({...item,状態:'未起動',設定:item.初期設定})),終了時停止あり:false}),logSnapshot:async()=>({ログ:'',位置:0}),close(){}},
 previousResults:{snapshot:async()=>({})},publicCache:{snapshot:()=>({状態:'未取得'})},modelTrials:{close(){}}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let child;
try{
 const env={...process.env,DIAG_TEST_PROFILE:profile,DIAG_TEST_SHOT:output};delete env.ELECTRON_RUN_AS_NODE;
 child=spawn(await desktopBinary(),[fileURLToPath(new URL('./initial-mini-probe.cjs',import.meta.url))],{env,windowsHide:true,stdio:['ignore','ignore','pipe','ipc']});
 let result,stderr='';child.stderr.on('data',chunk=>stderr+=chunk);
 child.on('message',message=>{
  if(message.type==='diag-ready')child.send({type:'diag-start',url:`http://127.0.0.1:${server.address().port}/#token=${token}`});
  if(message.testPassed)result=message;
 });
 const [code]=await once(child,'exit');assert.equal(code,0,stderr);assert.ok(result);console.log(JSON.stringify(result));
}finally{
 if(child?.exitCode===null){const ended=once(child,'exit');child.kill();await ended;}
 await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
 assert.ok(resolve(profile).startsWith(resolve(tmpdir())+sep));await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
