// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {cp,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
test('default Node runtime starts without Python on PATH and serves anonymous models plus config status',{timeout:30000},async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'diag-node-only-'));let child;
 try {
  const diag=path.join(root,'backend_diag');
  await cp(new URL('../',import.meta.url),diag,{recursive:true,filter:source=>!/(?:^|[/\\])(?:node_modules|tests|__pycache__)(?:[/\\]|$)/.test(source)});
  await cp(new URL('../../scripts/opencode-npm.mjs',import.meta.url),path.join(root,'scripts/opencode-npm.mjs'));
  await mkdir(path.join(root,'_config'));await writeFile(path.join(root,'_config/AiDiy_key.json'),JSON.stringify({gemini_key_id:'synthetic-gemini-key'}));
  await mkdir(path.join(root,'empty-path'));
  // Keep production startup/cache/runner/catalog. Replace HTTPS transport alone, not model behavior.
  const preload=path.join(root,'mock-public.mjs');
  await writeFile(preload,`import https from 'node:https';import {EventEmitter} from 'node:events';
https.request=(options,callback)=>{if(options.hostname!=='openrouter.ai'||options.path!=='/api/v1/models'||options.headers.Authorization)throw new Error('unexpected request');const request=new EventEmitter();request.destroy=()=>{};request.end=()=>queueMicrotask(()=>{const response=new EventEmitter();response.statusCode=200;response.destroy=()=>{};callback(response);response.emit('data',Buffer.from(JSON.stringify({data:[{id:'openai/synthetic-model',created:Math.floor(Date.now()/1000),context_length:100,architecture:{modality:'text->text'}}]})));response.emit('end');});return request;};`);
  child=spawn(process.execPath,['--import',pathToFileURL(preload).href,path.join(diag,'diag_main.mjs'),'--no-open','--port','0'],{env:{...process.env,PATH:path.join(root,'empty-path'),NODE_OPTIONS:'',CODESPACES:'',CI:'1'},stdio:['ignore','pipe','pipe'],windowsHide:true});
  const exited=once(child,'exit');let output='',stderr='';child.stderr.on('data',chunk=>stderr+=chunk);
  const url=await new Promise((resolve,reject)=>{child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127\.0\.0\.1:\d+\/#token=[^\s]+/);if(match)resolve(new URL(match[0]));});child.once('exit',()=>reject(new Error('Unexpected startup exit')));});
  const token=new URLSearchParams(url.hash.slice(1)).get('token');url.hash='';
  const api=async(route,method='GET')=>{const result=await fetch(new URL('api/'+route,url),{method,headers:{Authorization:'Bearer '+token}});assert.equal(result.status,200);return result.json();};
  assert.equal((await fetch(url)).status,200);
  let publicStatus;for(let i=0;i<100;i++){publicStatus=await api(encodeURIComponent('公開モデル'));if(publicStatus.状態==='取得済')break;await new Promise(resolve=>setTimeout(resolve,10));}
  assert.equal(publicStatus.状態,'取得済');assert.equal(publicStatus.件数,1);
  const status=await api(encodeURIComponent('キー設定'));assert.equal(status.設定状態,'読込済み');assert.equal(status.項目.find(row=>row.id==='gemini').設定済み,true);assert.ok(!JSON.stringify(status).includes('synthetic-gemini-key'));
  const result=await api(encodeURIComponent('キーテスト')+'/openrt_chat','POST');assert.equal(result.状態,'未実施');assert.deepEqual(result.モデル,[]);
  child.kill('SIGTERM');await exited;
  // Windows の SIGTERM は TerminateProcess で、終了コードではなくシグナル終了として報告される。
  if(process.platform==='win32')assert.equal(child.signalCode,'SIGTERM');else assert.equal(child.exitCode,0);assert.equal(stderr,'');
 }finally{if(child?.exitCode===null)child.kill('SIGKILL');await rm(root,{recursive:true,force:true});}
});

test('actual headless entrypoint works with missing config and no credentials, using bundled catalog only',{timeout:20000},async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'diag-no-config-'));let child;
 try {
  const diag=path.join(root,'backend_diag');
  await cp(new URL('../',import.meta.url),diag,{recursive:true,filter:source=>!/(?:^|[/\\])(?:node_modules|tests|__pycache__)(?:[/\\]|$)/.test(source)});
  await mkdir(path.join(root,'home'));await mkdir(path.join(root,'empty-path'));
  await cp(new URL('../../scripts/opencode-npm.mjs',import.meta.url),path.join(root,'scripts/opencode-npm.mjs'));
  // 本物の設定・OAuthを読ませない。通信は匿名公開一覧とloopbackのみ許容し、接続せず失敗させる。
  const preload=path.join(root,'offline.mjs');
  await writeFile(preload,`import https from 'node:https';import http from 'node:http';import net from 'node:net';import {EventEmitter} from 'node:events';
let toolsChecks=0;const connect=net.createConnection;net.createConnection=(...args)=>{if(args[0]?.port===8095||args[0]===8095){toolsChecks++;throw Error('headless must not check Tools startup');}return connect(...args);};net.Server.prototype.listen=function(){process.exitCode=89;throw Error('headless must not open a listener');};process.on('exit',()=>{if(toolsChecks)process.exitCode=90;});
const offline=(options)=>{if(options.headers?.Authorization||options.headers?.['x-goog-api-key']||!['openrouter.ai','127.0.0.1'].includes(options.hostname))throw Error('unexpected authenticated request');const request=new EventEmitter();request.destroy=()=>{};request.end=()=>queueMicrotask(()=>request.emit('error',Object.assign(Error('offline fixture'),{code:'ENETUNREACH'})));return request;};https.request=offline;http.request=offline;`);
  child=spawn(process.execPath,['--import',pathToFileURL(preload).href,path.join(diag,'diag_main.mjs'),'--headless'],{env:{PATH:path.join(root,'empty-path'),HOME:path.join(root,'home'),USERPROFILE:path.join(root,'home'),CODEX_HOME:path.join(root,'home','.codex'),NODE_OPTIONS:'',CI:'1'},stdio:['ignore','pipe','pipe'],windowsHide:true});
  let output='',stderr='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
  await once(child,'exit');assert.equal(child.exitCode,0,output+'\n'+stderr);
  const {readFile,access}=await import('node:fs/promises');
  await assert.rejects(access(path.join(root,'_config','AiDiy_key.json')),{code:'ENOENT'});
  const load=async group=>JSON.parse(await readFile(path.join(root,'_AIDIY','aidiy_diag',group+'_models_info.json'),'utf8'));
  const chat=await load('chat');assert.deepEqual(Object.keys(chat),['local_chat']);assert.equal(Object.keys(chat.local_chat.models).length,4);
  assert.deepEqual(await load('live'),{});
  const voices=JSON.parse(await readFile(path.join(root,'_AIDIY','aidiy_diag','live_voices_info.json'),'utf8'));
  assert.deepEqual(Object.keys(voices),['freeai_live','gemini_live','openai_live']);
  assert.equal(Object.keys(voices.freeai_live.voices).length,30);
  assert.equal(Object.keys(voices.gemini_live.voices).length,30);
  assert.equal(Object.keys(voices.openai_live.voices).length,13);
  assert.deepEqual(await load('code'),{aidiy_hermes:{models:{auto:'仮設定（未検証） - auto'}}});
  assert.match(output,/完了しました/);
 }finally{if(child?.exitCode===null)child.kill('SIGKILL');await rm(root,{recursive:true,force:true});}
});
