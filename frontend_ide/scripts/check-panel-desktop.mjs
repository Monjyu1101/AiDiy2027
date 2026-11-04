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
const server=await startDevelopment(project);
try{
 const env={...process.env,AIDIY_DEVELOPMENT_URL:server.url,AIDIY_DEVELOPMENT_KIND:'ide',AIDIY_DEVELOPMENT_PROJECT:project,AIDIY_TEST_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;
 const child=spawn(process.env.ELECTRON_PATH||electronExecutable(),[fileURLToPath(new URL('../checks/panel-desktop-probe.cjs',import.meta.url))],{env,windowsHide:true,stdio:['ignore','inherit','inherit','ipc']});
 let result;child.on('message',value=>{if(value.testPassed)result=value;});const [code]=await once(child,'exit');if(code!==0||!result)throw Error(`Electron pin失敗: ${code}`);console.log(JSON.stringify(result,null,2));
}finally{
 await server.close();
 for(const folder of [profile,project]){if(!resolve(folder).startsWith(resolve(tmpdir())+sep))throw Error('一時パスが不正です');rmSync(folder,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
}
