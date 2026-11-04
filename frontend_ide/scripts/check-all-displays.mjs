// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {startDevelopment} from '../server.mjs';
import {electronExecutable} from '../viewer/launch-options.mjs';
const project=mkdtempSync(join(tmpdir(),'aidiy-all-project-')),profile=mkdtempSync(join(tmpdir(),'aidiy-all-electron-'));
for(const folder of ['ソース','資料','画像']){mkdirSync(join(project,folder));for(let i=0;i<8;i++)writeFileSync(join(project,folder,`sample-${i}.txt`),'ALL display fixture');}
writeFileSync(join(project,'sample.txt'),'ALL current source');
writeFileSync(join(project,'second.txt'),'ALL new panel source');
const history=join(project,'.aidiy_backup','20261010','120000.all');mkdirSync(history,{recursive:true});writeFileSync(join(history,'sample.txt'),'ALL previous source');
writeFileSync(join(history,'second.txt'),'ALL previous second source');
const launcherOnly=process.env.AIDIY_ALL_LAUNCHERS_ONLY==='1';
// メニュー検証のオンライン状態は固定fixture。実AIコア・音声へ接続しない。
let state={active:false,connected:false,project:{name:'ALL fixture',path:project}};
const connection=launcherOnly?{state:()=>state,connect:async()=>state={...state,active:true,mode:'online',startedAt:1},offline:async()=>state={...state,active:true,mode:'offline',startedAt:1},disconnect:async()=>state={...state,active:false},close(){}}:undefined;
const server=await startDevelopment(project,{connection});
try{
 const env={...process.env,AIDIY_DEVELOPMENT_URL:server.url,AIDIY_DEVELOPMENT_KIND:'ide',AIDIY_DEVELOPMENT_PROJECT:project,AIDIY_TEST_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;
 const probe=launcherOnly?'all-launchers-desktop-probe.cjs':'all-displays-desktop-probe.cjs';
 const child=spawn(process.env.ELECTRON_PATH||electronExecutable(),[fileURLToPath(new URL('../checks/'+probe,import.meta.url))],{env,windowsHide:true,stdio:['ignore','inherit','inherit','ipc']});
 let result;child.on('message',value=>{if(value.testPassed)result=value;});
 const [code]=await once(child,'exit');if(code!==0||!result)throw Error(`Electron ALL確認失敗: ${code}`);console.log(JSON.stringify(result,null,2));
}finally{
 await server.close();
 for(const folder of [profile,project]){if(!resolve(folder).startsWith(resolve(tmpdir())+sep))throw Error('一時パスが不正です');rmSync(folder,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
}
