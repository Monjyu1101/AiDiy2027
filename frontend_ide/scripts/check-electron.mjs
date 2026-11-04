// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {startDevelopment} from '../server.mjs';
import {electronExecutable} from '../viewer/launch-options.mjs';
let codeContent;
for(const kind of ['code','live','ide']){
 const profile=mkdtempSync(join(tmpdir(),'aidiy-desktop-check-'));
 const app=await startDevelopment(fileURLToPath(new URL('../',import.meta.url)),{kind,offline:kind==='code'});
 try{
  const env={...process.env,AIDIY_TEST_PROFILE:profile,AIDIY_DEVELOPMENT_URL:app.url,AIDIY_DEVELOPMENT_KIND:kind};delete env.ELECTRON_RUN_AS_NODE;
  const child=spawn(electronExecutable(),[fileURLToPath(new URL('../checks/desktop-probe.cjs',import.meta.url)),'--use-fake-device-for-media-stream'],{env,windowsHide:false,stdio:['ignore','pipe','pipe','ipc']});
  child.stdout.on('data',data=>process.stdout.write(data));child.stderr.on('data',data=>{if(String(data).includes('Error'))process.stderr.write(data);});
  let tested=false,contentSize;child.on('message',message=>{tested||=message.tested===true;if(message.contentSize)contentSize=message.contentSize;});
  const [code]=await once(child,'exit');if(code!==0||!tested)throw Error(`${kind}: Electron確認失敗 ${code}`);
  if(kind==='code')codeContent=contentSize;
  if(kind==='live'){if(JSON.stringify(contentSize)!==JSON.stringify(codeContent))throw Error('Code / Liveの表示領域サイズが不一致');console.log('Code / Live content size matched '+JSON.stringify(contentSize));}
 }finally{await app.close();if(!resolve(profile).startsWith(resolve(tmpdir())+sep))throw Error('一時パスが不正です');rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
}
