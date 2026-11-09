// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPanels} from '../viewer/panels.mjs';
import {startDevelopment} from '../server.mjs';

test('Navi Code is isolated from normal Code and every other instance',async()=>{
 let state={active:true,mode:'offline',startedAt:1};const starts=[],closed=[];
 const panels=createPanels('.',()=>state,async(kind,folder,snapshot,{instance})=>{
  starts.push(instance);return {url:`http://127.0.0.1:12345/token-${starts.length}/`,close:async()=>closed.push(instance)};
 });
 try{
  const normal=await panels.open('code');
  const [a,repeated,b]=await Promise.all([panels.open('code','navi-1'),panels.open('code','navi-1'),panels.open('code','navi-2')]);
  assert.equal(a,repeated);assert.notEqual(a,b);assert.notEqual(a,normal);assert.deepEqual(starts,['','navi-1','navi-2']);
  await panels.release('code','navi-1');assert.deepEqual(closed,['navi-1']);
  assert.equal(await panels.open('code'),normal);assert.equal(await panels.open('code','navi-2'),b);
  assert.notEqual(await panels.open('code','navi-1'),a);
  await assert.rejects(panels.open('live','navi-1'));await assert.rejects(panels.open('code','../navi-1'));
  state={...state,startedAt:2};panels.sync();await new Promise(done=>setImmediate(done));
  assert.equal(closed.length,4);
 }finally{await panels.close();}
});

test('releasing pending Navi Code cannot resurrect it or close a replacement',async()=>{
 const launches=[],closed=[];
 const panels=createPanels('.',()=>({active:true,mode:'online',startedAt:1}),()=>new Promise(done=>launches.push(done)));
 const a=panels.open('code','navi-1');const rejection=assert.rejects(a);
 const release=panels.release('code','navi-1');const b=panels.open('code','navi-1');
 launches[0]({url:'http://127.0.0.1:12345/old/',close:async()=>closed.push('old')});
 launches[1]({url:'http://127.0.0.1:12345/new/',close:async()=>closed.push('new')});
 await rejection;await release;assert.match(await b,/\/new\/$/);assert.deepEqual(closed,['old']);
 await panels.close();assert.deepEqual(closed,['old','new']);
});

for(const kind of ['ide','navi'])test(`${kind} Navi Code endpoint enforces instance/session/origin and preserves Code mode guard`,async()=>{
 const root=await mkdtemp(join(tmpdir(),'navi-code-host-'));let app;
 let snapshot={active:true,mode:'offline',startedAt:42,connected:false,project:{name:'fixture',path:root}};
 const connection={state:()=>snapshot,offline:()=>snapshot,connect:async()=>snapshot,close(){snapshot={...snapshot,active:false};}};
 try{
  app=await startDevelopment(root,{kind,offline:true,connection});
  const config=await fetch(app.url+'development/config').then(r=>r.json());
  const instance=config.navigationInstance||'navi-1';
  const endpoint=`${app.url}api/navigation/code?instance=${instance}&session=42`;
  assert.equal((await fetch(endpoint)).status,405);
  assert.equal((await fetch(endpoint,{method:'POST',headers:{origin:'https://foreign.invalid'}})).status,403);
  assert.equal((await fetch(endpoint.replace('session=42','session=41'),{method:'POST'})).status,409);
  assert.equal((await fetch(endpoint.replace(`instance=${instance}`,'instance=invalid'),{method:'POST'})).status,400);
  if(kind==='navi'){
   assert.equal((await fetch(endpoint.replace(`instance=${instance}`,'instance=navi-999999'),{method:'POST'})).status,400);
   assert.equal((await fetch(app.url+'api/panels/code',{method:'POST'})).status,404);
   assert.equal((await fetch(app.url+'api/files/create',{method:'POST'})).status,404);
  }
  const opened=await fetch(endpoint,{method:'POST'});assert.equal(opened.status,200,opened.ok ? undefined : await opened.clone().text());
  const {url}=await opened.json();assert.match(url,new RegExp(`/panels/code/${instance}/`));
  const base=new URL(url,app.url);
  assert.equal((await fetch(new URL('catalog',base))).status,200);
  assert.equal((await fetch(new URL('message',base),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({メッセージ識別:'executionMode',mode:'online'})})).status,409);
  assert.equal((await fetch(endpoint,{method:'DELETE'})).status,200);
  assert.equal((await fetch(new URL('catalog',base))).status,403);
  const next=await fetch(endpoint,{method:'POST'}).then(r=>r.json());assert.notEqual(next.url,url);
  snapshot={...snapshot,startedAt:43};
  assert.equal((await fetch(endpoint,{method:'DELETE'})).status,409);
  assert.equal((await fetch(new URL(next.url+'catalog',app.url))).status,403);
 }finally{await app?.close();await rm(root,{recursive:true,force:true});}
});
