// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { startDevelopment } from '../server.mjs';
import { codeTransport } from '../src/components/コード/コード通信.js';
const project=fileURLToPath(new URL('../',import.meta.url));

test('IDEの旧アプリ名は互換起動せず拒否する',async()=>{
 const {launch}=await import('../launch.mjs');
 await assert.rejects(()=>launch('dev',['--help']),/code \/ live \/ ide/);
 await assert.rejects(()=>launch('ide',['--app','dev','--help']),/code \/ live \/ ide/);
});

test('Vue IDE: 手動開始、旧セッション破棄、オフラインCodeとLive制限',async()=>{
 const app=await startDevelopment(project);let reader;
 try{
  assert.match(await fetch(app.url).then(r=>r.text()),/development\/app.js/);
  assert.equal((await fetch(app.url+'api/galaxy')).status,503);
  assert.equal((await fetch(app.url+'development/app.js',{headers:{origin:'https://foreign.invalid'}})).status,403);
  let state=await fetch(app.url+'api/connection/offline',{method:'POST'}).then(r=>r.json());
  assert.equal(state.mode,'offline');const first=state.startedAt;
  assert.equal((await fetch(app.url+'api/galaxy')).status,200);
  const panel=await fetch(app.url+'api/panels/code',{method:'POST'}).then(r=>r.json());const base=new URL(panel.url,app.url);
  reader=(await fetch(new URL('events',base))).body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value),/"実行モード":"offline"/);
  await reader.cancel();reader=null;
  assert.equal((await fetch(new URL('message',base),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'autoConnect',enabled:true})})).status,409);
  assert.equal((await fetch(app.url+'api/panels/live',{method:'POST'})).status,403);
  await fetch(app.url+'api/connection/disconnect',{method:'POST'});
  assert.equal((await fetch(base)).status,403);
  state=await fetch(app.url+'api/connection/offline',{method:'POST'}).then(r=>r.json());assert.ok(state.startedAt>first);
 }finally{await reader?.cancel();await app.close();}
});

test('Code transport: VS Codeの送信・下書き・通知と破棄',async()=>{
 const old=globalThis.window,window=new EventTarget();globalThis.window=window;
 const sent=[],received=[];let saved={下書き:'保存済み'};
 try{
  const transport=codeTransport({host:true,api:{getState:()=>saved,setState:value=>saved=value,postMessage:value=>sent.push(value)}},value=>received.push(value));
  assert.equal(transport.draft(),'保存済み');await transport.start();assert.equal(sent[0].type,'ready');
  await transport.send({type:'input_text',メッセージ内容:'依頼'});assert.equal(sent[1].メッセージ内容,'依頼');
  transport.saveDraft('次の依頼');assert.equal(saved.下書き,'次の依頼');
  window.dispatchEvent(new MessageEvent('message',{data:{type:'state'}}));assert.equal(received.length,1);
  transport.link('javascript:alert(1)');assert.equal(sent.length,2);
  transport.dispose();window.dispatchEvent(new MessageEvent('message',{data:{type:'state'}}));assert.equal(received.length,1);
 }finally{globalThis.window=old;}
});

// 実際の互換入口を起動する。AIへの送信や外部ブラウザ起動は行わない。
for(const [kind,entry] of [['code','frontend_ide/host/aidiy_code/launch.mjs'],['live','frontend_ide/host/aidiy_live/launch.mjs'],['ide','frontend_ide/viewer/launch.mjs'],['console','frontend_ide/aidiy_console/launch.mjs']]){
 test(`互換CLI ${kind}: 起動フォルダ・自動ポート・Vue画面`,{timeout:15000},async()=>{
  const child=spawn(process.execPath,[fileURLToPath(new URL('../../'+entry,import.meta.url)),'--no-open',...(kind==='code'?['--offline','--provider','aidiy_hermes']:[])],{cwd:project,windowsHide:true,stdio:['ignore','pipe','pipe']});
  const ended=once(child,'exit');let output='';
  try{
   const url=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(output)),8000);child.on('error',reject);child.stderr.on('data',b=>output+=b);child.stdout.on('data',b=>{output+=b;const match=output.match(/http:\/\/127\.0\.0\.1:\d+\//);if(match){clearTimeout(timer);resolve(match[0]);}});});
   assert.equal((await fetch(url+'development/config').then(r=>r.json())).kind,kind);
   assert.equal((await fetch(url+'api/connection').then(r=>r.json())).project.path.replace(/\\/g,'/').replace(/\/$/,''),project.replace(/\\/g,'/').replace(/\/$/,''));
   assert.match(await fetch(url).then(r=>r.text()),/development\/app.js/);
   if(kind!=='ide')assert.equal((await fetch(url+'api/panels/'+(kind==='code'?'live':'code'),{method:'POST'})).ok,false);
  }finally{child.kill();await ended;}
 });
}

test('Vueが管理するCodeサーバーは画面を閉じても勝手に終了しない',async t=>{
 const {単独起動}=require('../host/dist/aidiy_code/server.cjs');
 t.mock.timers.enable({apis:['setTimeout']});
 const app=await 単独起動(project,'http://127.0.0.1:1',{offline:true,keepAlive:true});let reader;
 try{
  t.mock.timers.tick(180001);
  assert.equal((await fetch(new URL('catalog',app.url))).status,200);
  reader=(await fetch(new URL('events',app.url))).body.getReader();await reader.read();await reader.cancel();reader=null;
  await new Promise(resolve=>setImmediate(resolve));t.mock.timers.tick(60001);
  assert.equal((await fetch(new URL('catalog',app.url))).status,200);
 }finally{t.mock.timers.reset();await reader?.cancel();await app.close();}
});

test('Live拡張の単独表示にもVue画面と配布資産を使う',async()=>{
 const {ライブ起動}=require('../host/dist/aidiy_live/server.cjs');
 const app=await ライブ起動(fileURLToPath(new URL('../host/aidiy_live/',import.meta.url)),'http://127.0.0.1:1',true);
 try{
  assert.match(await fetch(app.url).then(r=>r.text()),/development-config/);
  for(const asset of ['development/app.js','development/app.css','development/THIRD_PARTY_NOTICES.txt'])assert.equal((await fetch(new URL(asset,app.url))).status,200);
 }finally{await app.close();}
});

test('IDEの別窓Codeは親の利用モードを固定し、直接API操作でも変更させない',async()=>{
 const app=await startDevelopment(project,{kind:'code',offline:true,linked:true});
 try{
  assert.equal((await fetch(app.url+'development/config').then(r=>r.json())).linked,true);
  const panel=await fetch(app.url+'api/panels/code',{method:'POST'}).then(r=>r.json());
  for(const type of ['autoConnect','connect','disconnect','executionMode']){
   const response=await fetch(new URL(panel.url+'message',app.url),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type,enabled:true,mode:'online'})});
   assert.equal(response.status,409);
  }
 }finally{await app.close();}
});
