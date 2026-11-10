// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const {spawn}=require('node:child_process');
const {join}=require('node:path');

// WindowsのkillはNodeのSIGTERM処理を通さないため、所有PIDの子孫も回収する。
function stopAvatarProcess(child,{platform=process.platform,spawnProcess=spawn}={}){
 if(platform!=='win32'){child.kill();return;}
 if(!Number.isSafeInteger(child.pid)||child.pid<=0)return;
 const killer=spawnProcess('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
 killer.on('error',error=>console.error('Avatarの終了に失敗しました:',error.message));
}

// IDE単位で所有するランチャー。起動完了とプロセス終了を別々に追跡する。
function createAvatarLauncher({spawnProcess=spawn,executable=process.execPath,environment=process.env,timeout=60000,stopProcess=stopAvatarProcess}={}){
 const processes=new WeakMap();
 function active(owner){return processes.has(owner);}
 function close(owner){const entry=processes.get(owner);if(entry){entry.cancel();entry.stop();}}
 function open(owner,project){
  if(active(owner))return Promise.resolve({ok:false,error:'Live / Avatarはすでに起動中です。'});
  let child;
  try{child=spawnProcess(executable,[join(__dirname,'../../frontend_avatar/launch.mjs'),'--alone','--project',project,'--foreground','--initial-pinned'],{cwd:project,env:{...environment,ELECTRON_RUN_AS_NODE:'1',AIDIY_LAUNCHER_CHILD:'1',AIDIY_AVATAR_IDE_OWNED:'1'},windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});}
  catch(error){return Promise.resolve({ok:false,error:error.message});}
  return new Promise(resolve=>{
   let settled=false;
   const finish=result=>{if(settled)return;settled=true;clearTimeout(timer);child.off('message',message);resolve(result);};
   let stopping=false,reused=false;
   const entry={child,cancel:()=>finish({ok:false,error:'IDEの利用状態が変わりました。'}),stop:()=>{if(stopping||reused)return;stopping=true;stopProcess(child);}};
   processes.set(owner,entry);
   const release=()=>{if(processes.get(owner)===entry)processes.delete(owner);};
   const fail=error=>{finish({ok:false,error});entry.stop();};
   const message=value=>{
    if(value?.launchError)fail(String(value.launchError));
    else if(value?.launchReady){reused=!!value.existingWindow;finish({ok:true,...(reused?{reused:true}:{})});}
   };
   const timer=setTimeout(()=>fail('Avatarの起動がタイムアウトしました。'),timeout);
   child.on('message',message);
   child.once('exit',code=>{release();finish({ok:false,error:`Avatarを起動できませんでした（終了コード: ${code}）。`});});
   child.on('error',error=>{if(!child.pid){release();finish({ok:false,error:error.message});}else fail(error.message);});
  });
 }
 return{active,open,close};
}
module.exports={createAvatarLauncher,stopAvatarProcess};
