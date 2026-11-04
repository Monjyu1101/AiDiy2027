// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {electronExecutable} from '../viewer/launch-options.mjs';
const profile=mkdtempSync(join(tmpdir(),'aidiy-code-drag-native-'));
try{
 const env={...process.env,AIDIY_TEST_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;
 const child=spawn(process.env.ELECTRON_PATH||electronExecutable(),[fileURLToPath(new URL('../checks/code-drag-desktop-probe.cjs',import.meta.url))],{env,windowsHide:true,stdio:['ignore','inherit','inherit','ipc']});
 let result;child.on('message',value=>{if(value.testPassed)result=value;});
 const [code]=await once(child,'exit');if(code!==0||!result)throw Error(`Electron Code移動確認失敗: ${code}`);
 console.log(JSON.stringify(result,null,2));
}finally{
 if(!resolve(profile).startsWith(resolve(tmpdir())+sep))throw Error('一時パスが不正です');
 rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
