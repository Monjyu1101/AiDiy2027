// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// GUI起動ではnpm/concurrentlyの入れ子のcmd.exeを作らず、開発用の3プロセスを直接管理する。
'use strict';
const {spawn,execFile}=require('node:child_process');
const {join,dirname}=require('node:path');
const root=join(__dirname,'..');

function background(command,args,options={}){
 return spawn(command,args,{...options,shell:false,windowsHide:true});
}
function terminate(child){
 if(child.exitCode!==null||child.signalCode)return Promise.resolve();
 if(process.platform==='win32')return new Promise(resolve=>execFile('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,timeout:8000},()=>resolve()));
 child.kill('SIGTERM');return Promise.resolve();
}
async function startDevelopment({launch=background,wait=require('wait-on'),stop=terminate,node=process.execPath}={}){
 const children=[];let stopping=false,stopRequest,resolveExit,rejectExit;
 const exited=new Promise((resolve,reject)=>{resolveExit=resolve;rejectExit=reject;});
 const shutdown=(code=0)=>stopRequest??=(async()=>{
  stopping=true;await Promise.all(children.map(child=>stop(child)));resolveExit(code);
 })();
 const launchWorker=(args,extra={})=>{
  const child=launch(node,args,{cwd:root,env:{...process.env,...extra},stdio:['ignore','inherit','inherit']});children.push(child);
  child.once('error',error=>{void shutdown(1);rejectExit(error);});
  child.once('exit',code=>{if(!stopping)void shutdown(code??1);});return child;
 };
 const signals=['SIGINT','SIGTERM'];const interrupted=()=>void shutdown(0);
 for(const signal of signals)process.once(signal,interrupted);
 try{
  launchWorker([join(dirname(require.resolve('vite/package.json')),'bin/vite.js')]);
  launchWorker([require.resolve('typescript/bin/tsc'),'-p','tsconfig.electron.json','--watch','--preserveWatchOutput']);
  await Promise.race([wait({resources:['tcp:127.0.0.1:8092','file:'+join(root,'dist-electron/main.js')],timeout:60000}),exited.then(()=>{throw Error('Avatarの起動準備中にプロセスが終了しました。');})]);
  if(!stopping)launchWorker([join(__dirname,'dev-filter.cjs'),'dist-electron/main.js'],{VITE_DEV_SERVER_URL:'http://127.0.0.1:8092'});
  return await exited;
 }catch(error){await shutdown(1);throw error;}
 finally{for(const signal of signals)process.removeListener(signal,interrupted);}
}
module.exports={background,startDevelopment};
if(require.main===module)startDevelopment().then(code=>process.exit(code),error=>{console.error(error.message);process.exit(1);});
