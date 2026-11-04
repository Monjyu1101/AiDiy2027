// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTaskTeamProxy, taskTeamTarget } from '../タスクチーム/api-proxy.mjs';
async function fixture(t, fetcher, options={}) {
  const root=await mkdtemp(join(tmpdir(),'aidiy-taskteam-'));
  await mkdir(join(root,'_config'));
  await writeFile(join(root,'_config/AiDiy_key.json'),JSON.stringify({PORT_CORE:19091,PORT_TASKTEAM:19093,SECRET:'never-forward'}));
  if(options.projectFixed){
    await mkdir(join(root,'backend_server'));
    await writeFile(join(root,'backend_server/core_main.py'),'# fixture');
    await mkdir(join(root,'_AIDIY/backend_core'),{recursive:true});
    await writeFile(join(root,'_AIDIY/backend_core/internal_auth.json'),JSON.stringify({token_type:'bearer',access_token:'fixture-internal-credential',expires_at:new Date(Date.now()+60000).toISOString()}));
  }
  const proxy=createTaskTeamProxy(root,root,{fetcher,...options});
  const server=createServer(async(req,res)=>{if(!await proxy.handle(req,res,new URL(req.url,'http://localhost')))res.writeHead(404).end();});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{proxy.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});});
  return {base:`http://127.0.0.1:${server.address().port}`,root,proxy};
}
const post=(body={})=>({method:'POST',headers:{'content-type':'application/json',authorization:'Bearer test-token'},body:JSON.stringify(body)});

test('IDE fixed project rejects changed folder before upstream; existing foreign requests cannot be retargeted',async t=>{
 let calls=[];
 const {base,root}=await fixture(t,async(url,opts)=>{
  calls.push(decodeURIComponent(url.pathname));
  assert.equal(opts.headers.authorization,'Bearer fixture-internal-credential');
  if(calls.at(-1)==='/task/タスク要求/取得')return Response.json({status:'OK',data:{item:{プロジェクト:root+'-other'}}});
  return Response.json({status:'OK'});
 },{projectFixed:true});
 const send=(path,body)=>fetch(base+'/taskteam-api'+path,post(body));
 for(const path of ['/task/タスク要求/AI登録','/task/タスク要求/更新登録','/team/依頼/登録','/team/依頼/変更']){
  assert.equal((await send(path,{プロジェクト:root+'-other'})).status,409);
 }
 assert.equal(calls.length,0);
 assert.equal((await send('/task/タスク要求/更新登録',{タスクID:'fixture',プロジェクト:root})).status,409);
 assert.deepEqual(calls,['/task/タスク要求/取得']);
 assert.equal((await send('/team/依頼/登録',{プロジェクト:root})).status,200);
 assert.deepEqual(calls,['/task/タスク要求/取得','/team/依頼/登録']);
});

test('IDE internal auth reloads credentials once on 401 and never forwards renderer credentials',async t=>{
 let root,calls=0;
 const f=await fixture(t,async(url,opts)=>{
  calls++;
  assert.equal(opts.headers.authorization,calls===1?'Bearer fixture-internal-credential':'Bearer rotated-fixture-credential');
  if(calls===1){
   await writeFile(join(root,'_AIDIY/backend_core/internal_auth.json'),JSON.stringify({token_type:'bearer',access_token:'rotated-fixture-credential',expires_at:new Date(Date.now()+60000).toISOString()}));
   return Response.json({status:'NG'},{status:401});
  }
  return Response.json({status:'OK',data:{利用者ID:'backend_core:code_live'}});
 },{projectFixed:true});root=f.root;
 const response=await fetch(f.base+'/taskteam-api/core/auth/現在利用者',post());
 assert.equal(response.status,200);assert.equal(calls,2);
 assert.doesNotMatch(await response.text(),/credential|Bearer/);
});
test('Task/Team target uses shared configured port, no credentials exposed',async t=>{
 const {base,root}=await fixture(t,async(url,opts)=>{assert.equal(url.href,'http://127.0.0.1:19093/health');assert.equal(opts.headers,undefined);return Response.json({status:'OK',service:'backend_taskteam'});});
 assert.equal(taskTeamTarget(root),'http://127.0.0.1:19093');
 assert.deepEqual(await fetch(base+'/taskteam-api/status').then(r=>r.json()),{connected:true,port:19093});
});
test('service identity and failed health never produce cyan-connected state',async t=>{
 const {base}=await fixture(t,async()=>Response.json({status:'OK',service:'other'}));
 assert.equal((await fetch(base+'/taskteam-api/status').then(r=>r.json())).connected,false);
});
test('Core login and Task/Team requests preserve caller JWT and body only',async t=>{
 const calls=[];const {base}=await fixture(t,async(url,opts)=>{calls.push([url,opts]);return Response.json({status:'OK'});});
 for(const path of ['/core/auth/ログイン','/task/タスク要求/一覧','/team/要員/一覧'])assert.equal((await fetch(base+'/taskteam-api'+path,post({利用者ID:'sample'}))).status,200);
 assert.deepEqual(calls.map(([url])=>url.port),['19091','19093','19093']);
 for(const[,opts]of calls){assert.equal(opts.headers.authorization,'Bearer test-token');assert.equal(opts.redirect,'error');assert.deepEqual(JSON.parse(opts.body),{利用者ID:'sample'});assert.equal(JSON.stringify(opts).includes('never-forward'),false);}
});
test('unknown Core API, GET writes, wrong content type and malformed JSON rejected',async t=>{
 const {base}=await fixture(t,()=>{assert.fail('upstream must not be called');});
 assert.equal((await fetch(base+'/taskteam-api/core/unknown',post())).status,404);
 assert.equal((await fetch(base+'/taskteam-api/task/%252e%252e/health',post())).status,404);
 assert.equal((await fetch(base+'/taskteam-api/task/test')).status,405);
 assert.equal((await fetch(base+'/taskteam-api/team/test',{method:'POST',body:'{}'})).status,415);
 assert.equal((await fetch(base+'/taskteam-api/team/test',{...post(),body:'not-json'})).status,400);
 assert.equal((await fetch(base+'/taskteam-api/team/test',{...post(),body:' '.repeat(20*1024*1024+1)})).status,413);
});
test('upstream errors are bounded and return safe feedback',async t=>{
 const {base}=await fixture(t,async()=>{throw Error('secret-detail');});
 assert.deepEqual(await fetch(base+'/taskteam-api/status').then(r=>r.json()),{connected:false,port:19093});
 const response=await fetch(base+'/taskteam-api/task/test',post());assert.equal(response.status,502);assert.equal((await response.text()).includes('secret-detail'),false);
});
test('invalid shared port rejects configuration rather than arbitrary destination',async t=>{
 const {root}=await fixture(t,async()=>Response.json({}));
 await writeFile(join(root,'_config/AiDiy_key.json'),JSON.stringify({PORT_TASKTEAM:'https://external.invalid'}));
 assert.throws(()=>taskTeamTarget(root),/PORT_TASKTEAM/);
});
