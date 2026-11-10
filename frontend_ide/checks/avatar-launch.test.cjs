// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {createAvatarLauncher,stopAvatarProcess}=require('../デスクトップ/Avatar起動.cjs');
function fixture(options={}){
 const children=[],calls=[];
 const launcher=createAvatarLauncher({executable:'/electron',environment:{TEST:'yes'},spawnProcess:(...args)=>{calls.push(args);const child=new EventEmitter();child.pid=children.length+1;child.kills=0;child.kill=()=>child.kills++;children.push(child);return child;},...options});
 return{launcher,children,calls,owner:{}};
}
test('Avatar launcher: project arguments, IPC readiness and lifetime are independent',async()=>{
 const f=fixture(),opening=f.launcher.open(f.owner,'/日本語 project');
 assert.equal(f.launcher.active(f.owner),true);assert.equal((await f.launcher.open(f.owner,'/other')).ok,false);assert.equal(f.children.length,1);
 const [exe,args,options]=f.calls[0];assert.equal(exe,'/electron');assert.deepEqual(args.slice(1),['--alone','--project','/日本語 project','--foreground','--initial-pinned']);assert.match(args[0],/frontend_avatar[/\\]launch.mjs$/);
 assert.equal(options.cwd,'/日本語 project');assert.equal(options.env.ELECTRON_RUN_AS_NODE,'1');assert.equal(options.env.AIDIY_LAUNCHER_CHILD,'1');assert.equal(options.stdio[3],'ipc');
 f.children[0].emit('message',{launchReady:true});assert.equal((await opening).ok,true);assert.equal(f.launcher.active(f.owner),true);
 f.children[0].emit('disconnect');assert.equal(f.launcher.active(f.owner),true);
 f.children[0].emit('exit',0);assert.equal(f.launcher.active(f.owner),false);
 const retry=f.launcher.open(f.owner,'/other');f.children[1].emit('message',{launchReady:true});assert.equal((await retry).ok,true);f.children[1].emit('exit',0);
});
test('Avatar launcher: errors, early exit and timeout release only exited processes',async()=>{
 for(const mode of ['message','exit','error','timeout']){
  const f=fixture({timeout:5}),opening=f.launcher.open(f.owner,'/p'),child=f.children[0];
  if(mode==='message')child.emit('message',{launchError:'missing setup'});
  if(mode==='exit')child.emit('exit',3);
  if(mode==='error'){delete child.pid;child.emit('error',Error('spawn failure'));}
  assert.equal((await opening).ok,false);
  assert.equal(f.launcher.active(f.owner),!['exit','error'].includes(mode));
  if(['message','timeout'].includes(mode)){assert.equal(child.kills,1);child.emit('exit',1);}
  assert.equal(f.launcher.active(f.owner),false);
 }
});
test('Avatar launcher: owner close cancels pending readiness and isolates other owners',async()=>{
 const f=fixture(),other={},a=f.launcher.open(f.owner,'/a'),b=f.launcher.open(other,'/b');
 f.launcher.close(f.owner);assert.equal((await a).ok,false);assert.equal(f.children[0].kills,1);assert.equal(f.children[1].kills,0);
 f.children[0].emit('message',{launchReady:true});f.children[0].emit('exit',0);assert.equal(f.launcher.active(f.owner),false);
 f.children[1].emit('message',{launchReady:true});assert.equal((await b).ok,true);assert.equal(f.launcher.active(other),true);f.launcher.close(other);f.children[1].emit('exit',0);
});
test('Avatar launcher: synchronous spawn failure leaves no reservation',async()=>{
 const launcher=createAvatarLauncher({spawnProcess:()=>{throw Error('missing');}}),owner={};assert.equal((await launcher.open(owner,'/a')).ok,false);assert.equal(launcher.active(owner),false);
});

test('Windows Avatar stop: launcher PIDだけのkillではなく所有ツリーをtaskkillで回収する',()=>{
 const calls=[],child={pid:123,kill:()=>assert.fail('Windowsではkillを使わない')};
 stopAvatarProcess(child,{platform:'win32',spawnProcess:(...args)=>{calls.push(args);return new EventEmitter();}});
 assert.deepEqual(calls,[['taskkill',['/PID','123','/T','/F'],{windowsHide:true,stdio:'ignore'}]]);
 stopAvatarProcess({pid:undefined},{platform:'win32',spawnProcess:()=>assert.fail('PIDなし')});
});
test('Windows Avatar close/error/timeout: 同じ所有ツリーを一度だけ停止し終了まで占有する',async()=>{
 for(const mode of ['close','message','timeout']){
  const stopped=[],f=fixture({timeout:5,stopProcess:child=>stopAvatarProcess(child,{platform:'win32',spawnProcess:(...args)=>{stopped.push(args);return new EventEmitter();}})});
  const opening=f.launcher.open(f.owner,'/p'),child=f.children[0];
  if(mode==='close')f.launcher.close(f.owner);
  if(mode==='message')child.emit('message',{launchError:'bad'});
  assert.equal((await opening).ok,false);f.launcher.close(f.owner);
  assert.equal(stopped.length,1);assert.equal(stopped[0][1][1],String(child.pid));assert.equal(f.launcher.active(f.owner),true);
  child.emit('exit',1);assert.equal(f.launcher.active(f.owner),false);
 }
});
test('Avatar reused standalone: IDE終了でも既存アプリのツリーを終了しない',async()=>{
 const f=fixture({stopProcess:()=>assert.fail('既存窓は所有しない')}),opening=f.launcher.open(f.owner,'/p');
 f.children[0].emit('message',{launchReady:true,existingWindow:true});assert.equal((await opening).reused,true);
 f.launcher.close(f.owner);f.children[0].emit('exit',0);assert.equal(f.launcher.active(f.owner),false);
});
