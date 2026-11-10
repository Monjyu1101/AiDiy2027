// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {EventEmitter} from 'node:events';
import vm from 'node:vm';
import launchDisplay from '../デスクトップ/起動画面.cjs';
const {起動画面を読む}=launchDisplay;
test('起動画面はDIP矩形だけを受け入れ、負座標を保ち、不正な環境値を無視する',()=>{
 const area={x:-1920,y:-200,width:1920,height:1040};
 assert.deepEqual(起動画面を読む(area),area);assert.deepEqual(起動画面を読む(JSON.stringify(area)),area);
 for(const value of [undefined,null,[],true,'bad','x'.repeat(257),{}, {...area,x:'0'},{...area,y:NaN},{...area,width:Infinity},{...area,width:0},{...area,height:-1},{...area,x:10000001},{...area,height:100001},{...area,x:.5},{...area,command:'bad'}])assert.equal(起動画面を読む(value),null);
});
test('CPUの切離しNodeとElectronまでDiagの画面指定を引き継ぐ',async t=>{
 const project=mkdtempSync(join(tmpdir(),'cpu-launch-display-'));t.after(()=>rmSync(project,{recursive:true,force:true}));
 const launchPath=new URL('../launch.mjs',import.meta.url),require=createRequire(launchPath);
 const {transformSync}=require('esbuild');
 const {code}=transformSync(readFileSync(launchPath,'utf8').replaceAll('import.meta.url',JSON.stringify(launchPath.href)),{format:'cjs'});
 const realOptions=await import('../viewer/launch-options.mjs');
 const area=JSON.stringify({x:-1920,y:40,width:1920,height:1040});
 for(const foreground of [false,true]){
  const calls=[],module={exports:{}},fakeProcess=new EventEmitter();
  Object.assign(fakeProcess,{execPath:process.execPath,env:{AIDIY_DEVELOPMENT_DISPLAY_AREA:area},argv:[],cwd:()=>project});
  const child=new EventEmitter();child.connected=true;child.disconnect=()=>{child.connected=false;};child.unref=()=>{};
  const spawn=(command,args,options)=>{calls.push({command,args,options});queueMicrotask(()=>child.emit('message',foreground?{existingWindow:true}:{launchReady:true}));return child;};
  const load=name=>name==='node:fs'?{...require(name),existsSync:path=>String(path).endsWith('/dist/app.js')||require(name).existsSync(path)}
   :name==='node:child_process'?{spawn}
   :name==='./server.mjs'?{startDevelopment:async()=>({url:'http://127.0.0.1:12345/',publicUrl:'http://127.0.0.1:12345/',close:async()=>{}})}
   :name==='./デスクトップ/desktop-process.mjs'?{spawnDesktop:spawn}
   :name==='./viewer/launch-options.mjs'?{...realOptions,useBrowser:()=>false,electronExecutable:()=>'/mock/electron'}:require(name);
  vm.runInNewContext(code,{module,exports:module.exports,require:load,process:fakeProcess,console:{log(){},warn(){}},setTimeout,clearTimeout,URL});
  await module.exports.launch('cpu',['--project',project,...(foreground?['--foreground']:[])]);
  assert.equal(calls.length,1);assert.equal(calls[0].options.env.AIDIY_DEVELOPMENT_DISPLAY_AREA,area);
  assert.equal(calls[0].options.cwd,project);
 }
});
