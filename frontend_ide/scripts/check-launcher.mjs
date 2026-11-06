// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=mkdtempSync(join(tmpdir(),'aidiy-launch-check-'));
const kind=process.argv[2]||'code';
assert.ok(['console','code','live','ide'].includes(kind),'対象はconsole / code / live / ide');
const entry=fileURLToPath(new URL(kind==='console'?'../aidiy_console/launch.mjs':kind==='ide'?'../viewer/launch.mjs':`../host/aidiy_${kind}/launch.mjs`,import.meta.url));
const hook=fileURLToPath(new URL('../checks/launcher-preload.cjs',import.meta.url));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check){for(let i=0;i<150;i++){if(await check())return;await sleep(100);}throw Error('ランチャー確認がタイムアウトしました');}
const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
const started=[];
function launch(folder,args=[],monitor=folder){
 const env={...process.env,AIDIY_LAUNCH_TEST:monitor,NODE_OPTIONS:`--require "${hook.replaceAll('\\','/')}"`};delete env.ELECTRON_RUN_AS_NODE;
 const child=spawn(process.execPath,[entry,...(kind==='code'?['--offline']:[]),'--project',folder,'--ready-file',join(monitor,'ready.json'),...args],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 let output='';child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>output+=data);
 started.push(child);
 return{child,output:()=>output,exit:once(child,'exit').then(([code])=>code)};
}
async function close(folder){
 writeFileSync(join(folder,'close'),'');
 const ready=JSON.parse(readFileSync(join(folder,'ready.json'),'utf8'));
 await until(()=>!alive(ready.pid));
 await assert.rejects(()=>fetch(ready.url,{signal:AbortSignal.timeout(1000)}));
}
try{
 for(const mode of ['detached','--foreground','--wait']){
  const folder=join(root,`project with spaces ${mode}`);mkdirSync(join(folder,'profile'),{recursive:true});
  const run=launch(folder,mode==='detached'?[]:[mode]);
  await until(()=>{if(run.child.exitCode!==null&&run.child.exitCode!==0)throw Error(run.output());return existsSync(join(folder,'ready.json'))&&existsSync(join(folder,'window.json'));});
  const ready=JSON.parse(readFileSync(join(folder,'ready.json'),'utf8'));
  const window=JSON.parse(readFileSync(join(folder,'window.json'),'utf8'));
  assert.equal(window.visible,true);assert.equal(ready.project,folder);assert.equal(ready.kind,kind);
  assert.equal((await fetch(ready.url)).status,200);
  if(mode==='detached'){
   await until(()=>run.child.exitCode!==null);assert.equal(await run.exit,0);
   assert.ok(alive(ready.pid),'コマンド終了後もサーバーが動作する');
   assert.doesNotMatch(run.output(),/プロジェクト:/);
   if(kind==='console'){
    const monitor=join(folder,'second');mkdirSync(join(monitor,'profile'),{recursive:true});
    const second=launch(folder,[],monitor);await until(()=>second.child.exitCode!==null&&existsSync(join(monitor,'window.json')));
    assert.equal(await second.exit,0);assert.doesNotMatch(second.output(),/起動済み/);
    const next=JSON.parse(readFileSync(join(monitor,'window.json'),'utf8'));
    assert.notEqual(next.pid,window.pid);assert.notEqual(next.url,window.url);
    // WindowsのDPI丸めによる外枠の1〜2論理px差を許容する。
    assert.ok(Math.abs(window.bounds.width-Math.round(window.area.width*2/3))<=2);assert.ok(Math.abs(window.bounds.height-Math.round(window.area.height/(window.area.width>window.area.height?3:4)))<=2);
    assert.ok(Math.abs(window.bounds.x-window.area.x-8)<=2);assert.ok(Math.abs(window.bounds.y+window.bounds.height-window.area.y-window.area.height+8)<=2);
    assert.ok(Math.abs(next.bounds.x-window.bounds.x-28)<=2);assert.ok(Math.abs(next.bounds.y-window.bounds.y+28)<=2);
    await close(monitor);assert.equal((await fetch(ready.url)).status,200);
    console.log('LAUNCH PASS: Consoleの同一プロジェクト複数起動・幅2/3・横画面高さ1/3／縦画面1/4・左下から右上配置・個別終了');
   }else{
    const second=launch(folder);await until(()=>second.child.exitCode!==null);
    assert.equal(await second.exit,0);assert.match(second.output(),/起動済み/);
    assert.equal(JSON.parse(readFileSync(join(folder,'window.json'),'utf8')).pid,window.pid);
   }
  }else assert.equal(run.child.exitCode,null,'待機指定時はプロンプトへ戻らない');
  let children=[];
  if(kind==='ide'&&mode==='detached'){
   writeFileSync(join(folder,'open-child'),'');
   await until(()=>existsSync(join(folder,'children.json')));
   const result=JSON.parse(readFileSync(join(folder,'children.json'),'utf8'));
   assert.equal(result.error,undefined);children=result.children;assert.equal(children.length,1);
   for(const url of children)assert.equal((await fetch(url)).status,200);
  }
  await close(folder);assert.equal(await run.exit,0);
  await until(()=>!alive(window.pid));
  for(const url of children)await assert.rejects(()=>fetch(url,{signal:AbortSignal.timeout(1000)}));
  if(children.length)console.log('LAUNCH PASS: 分離起動したIDEの×でCode子窓と子サーバーも終了');
  console.log(`LAUNCH PASS: ${kind} ${mode} / 表示 / プロジェクト引継ぎ / ×でサーバー終了`);
 }
 const folder=join(root,'startup failure');mkdirSync(folder);
 const occupied=createServer();await new Promise(r=>occupied.listen(0,'127.0.0.1',r));
 try{
  const failure=launch(folder,['--port',String(occupied.address().port),'--strict-port']);
  await until(()=>failure.child.exitCode!==null);assert.notEqual(await failure.exit,0);
  assert.match(failure.output(),/EADDRINUSE|使用中/);assert.equal(existsSync(join(folder,'ready.json')),false);
  console.log('LAUNCH PASS: 起動失敗を呼出元へ通知');
 }finally{await new Promise(r=>occupied.close(r));}
}catch(error){console.error(error);throw error;}finally{
 for(const child of started)if(child.exitCode===null)child.kill();
 // 失敗時もテストで作った画面へ終了を要求する。
 for(const mode of ['detached','--foreground','--wait']){const folder=join(root,`project with spaces ${mode}`);if(existsSync(folder))writeFileSync(join(folder,'close'),'');if(existsSync(join(folder,'second')))writeFileSync(join(folder,'second','close'),'');}
 await sleep(600);
 if(!resolve(root).startsWith(resolve(tmpdir())+sep))throw Error('一時パスが不正です');
 try{rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:200});}catch(error){console.warn('一時フォルダの削除を保留:',root,error.code);}
}
