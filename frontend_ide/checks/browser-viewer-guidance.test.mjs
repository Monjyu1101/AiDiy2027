// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,symlink,readFile,readdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import bridgeModule from '../デスクトップ/下書き共有.cjs';
import analysisModule from '../デスクトップ/ブラウザ解析連携.cjs';
const {createSharedDraftBridge}=bridgeModule,{createBrowserAnalysisContext}=analysisModule;
const context={url:'https://example.test/form',projectPath:'/project',canSelectSource:false};
const deferred=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return{resolve,promise};};

test('Browser解析案内: IDE検出は未連携のままで、起動元がある場合は他IDEを探さない',async()=>{
 const record={kind:'browser'};let page={...context},calls=0;
 const action=createBrowserAnalysisContext({trustedEvent:e=>e.record,context:()=>page,discover:async()=>{calls++;return{ideRunning:true,viewerAvailable:true};}});
 assert.deepEqual((await action({record})).context,{...context,ideRunning:true,viewerAvailable:true});
 assert.equal(record.owner,undefined);assert.equal(calls,1);
 page={...context,canSelectSource:true};assert.deepEqual(await action({record}),{ok:true,context:page});assert.equal(calls,1);
 assert.equal((await action({record:{kind:'code'}})).ok,false);assert.equal(calls,1);
});
test('Browser解析案内: 検出失敗でも解析可能、遅い応答はページ変更・閉鎖・送信元変更後に破棄',async()=>{
 const record={kind:'browser'};
 const failed=createBrowserAnalysisContext({trustedEvent:e=>e.record,context:()=>context,discover:async()=>{throw Error('offline');}});
 assert.deepEqual((await failed({record})).context,{...context,ideRunning:false,viewerAvailable:false});
 for(const mode of ['page','closed','sender','quitting','linked']){
  const pending=deferred();let page={...context},trusted=record,quitting=false;
  const action=createBrowserAnalysisContext({trustedEvent:()=>trusted,context:()=>page,isQuitting:()=>quitting,discover:()=>pending.promise});
  const result=action({record});
  if(mode==='page')page={...page,url:'https://example.test/other'};
  if(mode==='closed')page=null;
  if(mode==='sender')trusted=null;
  if(mode==='quitting')quitting=true;
  if(mode==='linked')page={...page,canSelectSource:true};
  pending.resolve({ideRunning:true,viewerAvailable:true});assert.equal((await result).ok,false,mode);
 }
});
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'aidiy-viewer-guidance-')),project=join(root,'project'),other=join(root,'other'),alias=join(root,'alias'),directory=join(root,'registry');
 await mkdir(project);await mkdir(other);await symlink(project,alias,process.platform==='win32'?'junction':'dir');
 const bridges=[];t.after(async()=>{await Promise.all(bridges.map(b=>b.close()));await rm(root,{recursive:true,force:true});});
 const records=new Map(),state={active:true,mode:'online',connected:true,startedAt:1,project:{path:project}},source={kind:'browser',window:{isDestroyed:()=>false}};
 const ide={kind:'ide',window:{isDestroyed:()=>false}},ideState={...state};records.set('ide',ide);
 const key=s=>s.active?`${s.mode}:${s.startedAt}`:'';
 let beforeRead=()=>{};
 const readState=async record=>{await beforeRead(record);return structuredClone(record===ide?ideState:state);};
 const router={list:()=>assert.fail('状態確認では下書きを列挙しない'),insert:()=>assert.fail('状態確認では下書きを送信しない')};
 const remote=await createSharedDraftBridge({directory,records,router,readState,sessionKey:key});bridges.push(remote);
 const sender=await createSharedDraftBridge({directory,records:new Map(),router,readState,sessionKey:key});bridges.push(sender);
 return{root,project,other,alias,directory,state,ide,ideState,records,remote,sender,source,beforeRead:fn=>beforeRead=fn};
}
test('Browser解析案内: Codeなしの同じ実パスのIDEだけを検出、オンライン利用と起動中を区別',async t=>{
 const f=await fixture(t);
 assert.deepEqual(await f.sender.viewerStatus(f.source),{ideRunning:true,viewerAvailable:true});
 f.state.project={path:f.alias};assert.equal((await f.sender.viewerStatus(f.source)).viewerAvailable,true);
 f.ideState.active=false;assert.deepEqual(await f.sender.viewerStatus(f.source),{ideRunning:true,viewerAvailable:false});
 f.ideState.active=true;f.ideState.connected=false;assert.equal((await f.sender.viewerStatus(f.source)).viewerAvailable,false);
 f.ideState.connected=true;f.ideState.mode='offline';assert.equal((await f.sender.viewerStatus(f.source)).viewerAvailable,false);
 f.ideState.project={path:f.other};assert.deepEqual(await f.sender.viewerStatus(f.source),{ideRunning:false,viewerAvailable:false});
 f.ideState.project={path:f.project};f.ide.window.isDestroyed=()=>true;assert.equal((await f.sender.viewerStatus(f.source)).ideRunning,false);
 f.ide.window.isDestroyed=()=>false;f.ide.kind='code';assert.equal((await f.sender.viewerStatus(f.source)).ideRunning,false);
 assert.equal(f.source.owner,undefined);
});
test('Browser解析案内: 終了済み・不正な登録と中断を無視し、セッション変更時の案内を返さない',async t=>{
 const f=await fixture(t);f.records.clear();
 await writeFile(join(f.directory,'1-invalid.json'),'{broken');
 assert.deepEqual(await f.sender.viewerStatus(f.source),{ideRunning:false,viewerAvailable:false});
 f.records.set('ide',f.ide);f.beforeRead(record=>{if(record===f.ide)f.state.startedAt++;});
 await assert.rejects(f.sender.viewerStatus(f.source),/利用状態/);
 f.beforeRead(()=>{});f.state.active=false;await assert.rejects(f.sender.viewerStatus(f.source),/終了/);
});
test('Browser解析案内: localhostトークン認証とOrigin拒否を維持し、秘密や接続先を画面へ返さない',async t=>{
 const f=await fixture(t),name=(await readdir(f.directory))[0],peer=JSON.parse(await readFile(join(f.directory,name),'utf8'));
 const endpoint=`http://127.0.0.1:${peer.port}/${peer.token}/viewer-status`,options={method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({projectPath:f.project})};
 assert.equal((await fetch(endpoint,{...options,headers:{...options.headers,origin:'https://example.test'}})).status,403);
 assert.equal((await fetch(endpoint.replace(peer.token,'wrong'),options)).status,403);
 const response=await fetch(endpoint,options);assert.equal(response.status,200);
 assert.deepEqual(Object.keys(await response.json()).sort(),['ideRunning','ok','viewerAvailable']);
});
