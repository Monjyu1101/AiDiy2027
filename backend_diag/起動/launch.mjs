// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {desktopLogPath} from './desktop-log.mjs';

// 秘密 URL は常駐側だけで生成する。起動元へは固定の状態通知だけを返す。
export async function launchDetached(args, {spawnFn=spawn, timeout=30000,
  entry=fileURLToPath(new URL('../diag_main.mjs',import.meta.url))}={}) {
  const env={...process.env,AIDIY_DIAG_LAUNCHER_CHILD:'1'};
  for(const key of Object.keys(env))if(/^(ELECTRON_RUN_AS_NODE|NODE_OPTIONS|NODE_PATH)$/i.test(key))delete env[key];
  const child=spawnFn(process.execPath,[entry,'--foreground',...args],{
    cwd:process.cwd(),env,detached:true,windowsHide:true,shell:false,stdio:['ignore','ignore','ignore','ipc']
  });
  try {
    let existing=false;
    await new Promise((resolve,reject)=>{
      let done=false;
      const finish=error=>{if(done)return;done=true;clearTimeout(timer);child.off('message',message);child.off('exit',exit);child.off('error',failure);child.off('disconnect',disconnect);error?reject(error):resolve();};
      const failure=()=>finish(Object.assign(Error('Diagnostic startup failed'),{diagCode:'DESKTOP'}));
      const exit=failure,disconnect=failure;
      const message=value=>{
        if(value?.type==='diag-launch-ready') {
          try {child.send({type:'diag-launch-release'},error=>error?failure():finish());}catch{failure();}
        } else if(value?.type==='diag-launch-existing') {
          existing=true;finish();
        } else if(value?.type==='diag-launch-error') {
          const codes=['ARGUMENTS','UI','ELECTRON','DESKTOP','CATALOG','EADDRINUSE','EACCES'];
          finish(Object.assign(Error('Diagnostic startup failed'),{diagCode:codes.includes(value.code)?value.code:'DESKTOP'}));
        }
      };
      const timer=setTimeout(failure,timeout);
      child.on('message',message);child.once('exit',exit);child.once('error',failure);child.once('disconnect',disconnect);
    });
    if(child.connected)child.disconnect();
    child.unref();
    if(existing){console.log('AiDiy 診断は既に起動しています。既存のウィンドウを前面に表示しました。');return;}
    console.log('AiDiy 診断を起動しました。ウィンドウを閉じると終了します。');
    console.log('診断 NG / ERR・異常終了の記録（保存可能な場合）: '+desktopLogPath);
    console.log('ターミナルで起動状態を確認する場合: aidiy_diag --foreground');
  } catch(error) {
    if(child.connected)child.disconnect();
    // 起動確認に失敗した常駐側も所有する。SIGTERM を無視する場合は期限付きで停止。
    await new Promise(resolve=>{
      if(child.exitCode!==null && child.exitCode!==undefined || child.signalCode)return resolve();
      let timer,deadline;
      const finish=()=>{clearTimeout(timer);clearTimeout(deadline);child.off('exit',finish);resolve();};
      child.once('exit',finish);
      try{child.kill('SIGTERM');}catch{}
      timer=setTimeout(()=>{try{child.kill('SIGKILL');}catch{}deadline=setTimeout(finish,1000);},1000);
    });
    throw error;
  }
}
