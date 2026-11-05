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
import {reserveNavigationSlot} from '../ファイル機能/navigation-slot.mjs';
import {startDevelopment} from '../server.mjs';
test('standalone slots remain independent and released slots retain identity',async()=>{
 const root=await mkdtemp(join(tmpdir(),'navi-slots-test-'));let a,b,c;
 try{[a,b]=await Promise.all([reserveNavigationSlot(root,{root:join(root,'locks')}),reserveNavigationSlot(root,{root:join(root,'locks')})]);assert.notEqual(a.instance,b.instance);await a.close();c=await reserveNavigationSlot(root,{root:join(root,'locks')});assert.equal(c.instance,a.instance);}
 finally{await a?.close();await b?.close();await c?.close();await rm(root,{recursive:true,force:true});}
});
test('standalone config, API, model persistence and no file mutation API',async()=>{
 const root=await mkdtemp(join(tmpdir(),'navi-server-test-'));let a,b;
 try{
  const options={kind:'navi',navigationOptions:{defaultModel:async()=>({provider:'aidiy_hermes',model:'auto'}),stateRoot:join(root,'states'),runAgent:()=>{throw Error('No AI calls expected');}}};
  a=await startDevelopment(root,options);b=await startDevelopment(root,options);
  const ca=await(await fetch(a.url+'development/config')).json(),cb=await(await fetch(b.url+'development/config')).json();
  assert.equal(ca.kind,'navi');assert.equal(ca.project.path,root);assert.notEqual(ca.navigationInstance,cb.navigationInstance);
  const icon=await fetch(new URL(ca.icon,a.url));assert.equal(icon.status,200);assert.equal(icon.headers.get('content-type'),'image/png');
  const png=Buffer.from(await icon.arrayBuffer());assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.ok(png.readUInt32BE(16)>0&&png.readUInt32BE(20)>0,'AiDiy画像の寸法が有効');
  const endpoint=app=>app.url+'api/navigation?instance='+ (app===a?ca.navigationInstance:cb.navigationInstance);
  assert.equal((await fetch(a.url+'api/files/create',{method:'POST'})).status,404);
  assert.equal((await fetch(endpoint(a),{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({provider:'aidiy_hermes',model:'openai_oauth/test'})})).status,200);
  assert.equal((await(await fetch(endpoint(a))).json()).selection.model,'openai_oauth/test');
  assert.equal((await(await fetch(endpoint(b))).json()).selection.model,'auto');
 }finally{await a?.close();await b?.close();await rm(root,{recursive:true,force:true});}
});
