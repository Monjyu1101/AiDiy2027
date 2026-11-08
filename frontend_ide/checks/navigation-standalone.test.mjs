// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,readdir} from 'node:fs/promises';
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
 const root=await mkdtemp(join(tmpdir(),'navi-server-test-'));let a,b,c;
 try{
  const options={kind:'navi',navigationOptions:{defaultModel:async()=>({provider:'aidiy_hermes',model:'auto'}),stateRoot:join(root,'states'),runAgent:()=>{throw Error('No AI calls expected');}}};
  a=await startDevelopment(root,options);b=await startDevelopment(root,options);
  const ca=await(await fetch(a.url+'development/config')).json(),cb=await(await fetch(b.url+'development/config')).json();
  assert.equal(ca.kind,'navi');assert.equal(ca.project.path,root);assert.notEqual(ca.navigationInstance,cb.navigationInstance);
  const icon=await fetch(new URL(ca.icon,a.url));assert.equal(icon.status,200);assert.equal(icon.headers.get('content-type'),'image/png');
  const png=Buffer.from(await icon.arrayBuffer());assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.ok(png.readUInt32BE(16)>0&&png.readUInt32BE(20)>0,'AiDiy画像の寸法が有効');
  const endpoint=app=>app.url+'api/navigation?instance='+ (app===a?ca.navigationInstance:cb.navigationInstance);
  assert.equal((await fetch(a.url+'api/files/create',{method:'POST'})).status,404);
  assert.equal((await(await fetch(endpoint(b))).json()).selection.model,'auto'); // bを先に開く（最初の読み取り）。保存済みの値はまだない
  assert.equal((await fetch(endpoint(a),{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({provider:'aidiy_hermes',model:'openai_oauth/test'})})).status,200);
  assert.equal((await(await fetch(endpoint(a))).json()).selection.model,'openai_oauth/test');
  assert.equal((await(await fetch(endpoint(b))).json()).selection.model,'auto'); // bは確定前に開いた窓。他の窓の確定では変わらない
  // 最後に確定した値は、Code / Liveと同じ形式で プロジェクトの _AIDIY/aidiy_navi/ 相当の aidiy_navi_model.json（ここでは states の1つ上）へ保存される。窓別の model.json は作らない。
  assert.deepEqual(JSON.parse(await readFile(join(root,'aidiy_navi_model.json'),'utf8')),{provider:'aidiy_hermes',model:'openai_oauth/test'});
  assert.equal(JSON.stringify(await readdir(join(root,'states'),{recursive:true})).includes('model.json'),false);
  // 次に開く窓（c）は最後の選択値で始まる。
  c=await startDevelopment(root,options);const cc=await(await fetch(c.url+'development/config')).json();
  assert.equal((await(await fetch(c.url+'api/navigation?instance='+cc.navigationInstance)).json()).selection.model,'openai_oauth/test');
 }finally{await a?.close();await b?.close();await c?.close();await rm(root,{recursive:true,force:true});}
});
