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
for(const kind of ['ide','code','live']){
 const profile=mkdtempSync(join(tmpdir(),'aidiy-single-check-'));
 const project=fileURLToPath(new URL('../',import.meta.url));
 const server=await startDevelopment(project,{kind,offline:kind==='code'});
 try{
  const env={...process.env,AIDIY_TEST_PROFILE:profile,AIDIY_DEVELOPMENT_URL:server.url,AIDIY_DEVELOPMENT_KIND:kind,AIDIY_DEVELOPMENT_PROJECT:project};delete env.ELECTRON_RUN_AS_NODE;
  const child=spawn(electronExecutable(),[fileURLToPath(new URL('../checks/single-instance-probe.cjs',import.meta.url))],{env,windowsHide:false,stdio:['ignore','inherit','inherit','ipc']});
  const [code]=await once(child,'exit');if(code!==0)throw Error(`${kind}: 二重起動検証失敗 ${code}`);
 }finally{await server.close();rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
}
