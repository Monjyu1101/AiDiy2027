// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {launch} from '../launch.mjs';
import {startDevelopment} from '../server.mjs';
import {createCoreConnection} from '../viewer/core-connection.mjs';
const project=fileURLToPath(new URL('../',import.meta.url));

test('BrowserはElectron専用でありWebフォールバック・AI/CLI起動を受け付けない',async()=>{
 for(const flags of [['--browser'],['--no-open'],['--serve'],['--connect'],['--provider','openai'],['--model','auto'],['--cli','codex'],['--cli-auto-approve']])await assert.rejects(launch('browser',flags),/Electron専用/);
});

test('Browserは起動時にtools未接続でも同じセッションを保ち再接続する',async t=>{
 let healthy=false,calls=0;
 const connection=createCoreConnection(project,{keepActive:true,target:'http://127.0.0.1:8095',fetcher:async()=>{calls++;return{ok:healthy,status:503,json:async()=>({status:'ok',name:'aidiy_code_agents'})};}});
 t.after(()=>connection.close());
 const start=connection.state().startedAt;
 assert.equal(connection.state().active,true);
 assert.equal((await connection.connect()).connected,false);
 assert.equal(connection.state().wanted,true);
 healthy=true;await connection.check();
 assert.equal(connection.state().connected,true);
 assert.equal(connection.state().startedAt,start);
 healthy=false;await connection.check();
 assert.equal(connection.state().active,true);
 assert.equal(connection.state().connected,false);
 healthy=true;await connection.check();
 assert.equal(connection.state().startedAt,start);
 assert.equal(connection.state().connected,true);
 connection.close();const count=calls;await connection.check();assert.equal(calls,count);
});

test('Browser配信は共通画面と接続状態を使い、他アプリの開始や接続変更を拒否する',async t=>{
 let connected=0,closed=0;
 const state={active:true,mode:'online',startedAt:Date.now(),connected:true,project:{name:'browser',path:project}};
 const app=await startDevelopment(project,{kind:'browser',connection:{state:()=>state,connect:async()=>{connected++;return state;},close:()=>{closed++;},disconnect:()=>{throw Error('unexpected');},offline:()=>{throw Error('unexpected');}}});
 t.after(()=>app.close());
 assert.equal(connected,1);
 const get=path=>fetch(new URL(path,app.url));
 const config=await get('/development/config').then(r=>r.json());
 assert.equal(config.kind,'browser');assert.equal(config.icon,'/development/AiDiy.png');
 assert.match(await get('/').then(r=>r.text()),/development\/app.js/);
 assert.equal((await get('/api/connection').then(r=>r.json())).startedAt,state.startedAt);
 for(const action of ['connect','offline','disconnect'])assert.equal((await fetch(new URL('/api/connection/'+action,app.url),{method:'POST'})).status,405);
 for(const path of ['/api/galaxy','/api/file?path=package.json','/api/explorer'])assert.equal((await get(path)).status,404);
 for(const kind of ['code','live','console'])assert.notEqual((await fetch(new URL('/api/panels/'+kind,app.url),{method:'POST'})).status,200);
 await app.close();assert.ok(closed>=1);
});

test('Browser --offline starts an active session without checking tools',async t=>{
 let checks=0;const state={active:true,connected:false,mode:'offline',startedAt:1,project:{path:project}};
 const app=await startDevelopment(project,{kind:'browser',offline:true,connection:{state:()=>state,connect:async()=>{checks++;},offline:()=>state,close(){}}});t.after(()=>app.close());
 assert.equal(checks,0);assert.equal((await fetch(new URL('/api/connection',app.url)).then(r=>r.json())).active,true);
});


test('Browser --offline はToolsが復旧しても監視・再接続を開始しない',async t=>{
 let calls=0;
 const connection=createCoreConnection(project,{keepActive:true,target:'http://127.0.0.1:8095',fetcher:async()=>{calls++;return{ok:true,json:async()=>({status:'ok',name:'aidiy_code_agents'})};}});
 const app=await startDevelopment(project,{kind:'browser',offline:true,connection});t.after(()=>app.close());
 await connection.check();
 const state=await fetch(new URL('/api/connection',app.url)).then(r=>r.json());
 assert.equal(calls,0);assert.equal(state.mode,'offline');assert.equal(state.wanted,false);assert.equal(state.connected,false);assert.equal(state.active,true);
 for(const action of ['connect','offline','disconnect'])assert.equal((await fetch(new URL('/api/connection/'+action,app.url),{method:'POST'})).status,405);
});
