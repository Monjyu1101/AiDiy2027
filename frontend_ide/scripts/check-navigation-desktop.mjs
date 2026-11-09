// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {startDevelopment} from '../server.mjs';
import {electronExecutable} from '../viewer/launch-options.mjs';
const project=mkdtempSync(join(tmpdir(),'aidiy-panel-project-')),profile=mkdtempSync(join(tmpdir(),'aidiy-panel-electron-'));
writeFileSync(join(project,'sample.txt'),'Electron pin fixture');
writeFileSync(join(project,'sample.html'),'<!doctype html><meta charset="utf-8"><style>body{padding:20px;background:#081426;color:white}</style><p>別オリジンのHTML本文</p><a href="sample.txt">選択は離した時だけ</a>');
const history=join(project,'.aidiy_backup','20261010','120000.all');mkdirSync(history,{recursive:true});writeFileSync(join(history,'sample.txt'),'Previous Electron fixture');
const kind=process.env.TEST_NAVI_STANDALONE==='1'?'navi':'ide';
// 寸法確認では常駐サービスへ接続せず、誤操作でも実AIを呼ばせない。
let agentCalls=0;
const dimensionsOnly=process.env.AIDIY_TEST_NAVIGATION_DIMENSIONS_ONLY==='1';
const server=await startDevelopment(project,{kind,...(dimensionsOnly?{offline:true}:{}),navigationOptions:{stateRoot:join(profile,'navigation-state'),...(dimensionsOnly?{runAgent:()=>{agentCalls++;throw Error('寸法試験ではAIを呼び出せません。');}}:{})}});
try{
 const env={...process.env,AIDIY_DEVELOPMENT_URL:server.url,AIDIY_DEVELOPMENT_KIND:kind,AIDIY_DEVELOPMENT_PROJECT:project,AIDIY_TEST_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;
 const child=spawn(process.env.ELECTRON_PATH||electronExecutable(),[fileURLToPath(new URL(kind==='navi'?'../checks/navigation-standalone-probe.cjs':'../checks/navigation-desktop-probe.cjs',import.meta.url))],{env,windowsHide:true,stdio:['ignore','inherit','inherit','ipc']});
 let result;child.on('message',value=>{if(value.testPassed)result=value;});const [code]=await once(child,'exit');if(code!==0||!result)throw Error(`Navi失敗: ${code}`);if(agentCalls)throw Error(`寸法試験のAI呼び出し試行: ${agentCalls}`);console.log(JSON.stringify({...result,...(dimensionsOnly?{agentCalls}:{} )},null,2));
}finally{
 await server.close();
 for(const folder of [profile,project]){if(!resolve(folder).startsWith(resolve(tmpdir())+sep))throw Error('一時パスが不正です');rmSync(folder,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
}
